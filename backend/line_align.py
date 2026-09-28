"""
Physical-line alignment for handwritten pages (v0.19).

Problem it solves: Sarvam returns paragraph blocks whose internal line breaks do not follow the
learner's handwritten lines, so matching those "lines" to detected line boxes put the transcript
next to the wrong part of the scan, and the Google reading attached to it came from a different line.

Approach:
  1. Physical lines come from where the ink is: Google Vision's word boxes are grouped into lines
     (left-to-right growth with a slope-aware prediction, so slanted handwriting stays on one line).
  2. Sarvam's text (the primary reading) is aligned word-by-word to Google's words with a banded
     global alignment on character similarity, then cut at Google's line boundaries.
  3. Each physical line therefore has: the ink box, Sarvam's words for that line, Google's words for
     that line. Nothing in the learner's text is changed — only where lines are split.
Falls back to the earlier Sarvam-block + Surya mapping when Google returns no words.
"""
from __future__ import annotations

from difflib import SequenceMatcher
from statistics import median

import regex as re

_PUNCT = re.compile(r"[\s\p{P}\p{S}]+")


def _norm(t: str) -> str:
    return _PUNCT.sub("", t or "").casefold()


def _centre(b):
    return (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0


def cluster_lines(words):
    """Group word boxes into physical lines. Returns [{'words': [...], 'bbox': [x1,y1,x2,y2]}] top→bottom."""
    ws = [w for w in words if w.get("bbox") and (w.get("text") or "").strip()]
    if not ws:
        return []
    H = max(8.0, median([w["bbox"][3] - w["bbox"][1] for w in ws]))
    lines = []

    def predict(L, cx):
        pts = L["pts"][-6:]
        if len(pts) >= 3:
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
            sxx = sum((x - mx) ** 2 for x in xs)
            slope = (sum((x - mx) * (y - my) for x, y in pts) / sxx) if sxx else 0.0
            slope = max(-0.15, min(0.15, slope))
            return my + slope * (cx - mx)
        return pts[-1][1]

    for w in sorted(ws, key=lambda w: _centre(w["bbox"])[0]):
        cx, cy = _centre(w["bbox"])
        best, bd = None, None
        for L in lines:
            # a line only grows to the right (small overlap allowed for touching words)
            if w["bbox"][0] < L["right"] - 0.5 * H:
                continue
            d = abs(cy - predict(L, cx))
            if d < 0.6 * H and (bd is None or d < bd):
                best, bd = L, d
        if best is None:
            lines.append({"pts": [(cx, cy)], "words": [w], "right": w["bbox"][2]})
        else:
            best["pts"].append((cx, cy)); best["words"].append(w); best["right"] = max(best["right"], w["bbox"][2])

    out = []
    for L in lines:
        L["words"].sort(key=lambda w: w["bbox"][0])
        xs1 = [w["bbox"][0] for w in L["words"]]; ys1 = [w["bbox"][1] for w in L["words"]]
        xs2 = [w["bbox"][2] for w in L["words"]]; ys2 = [w["bbox"][3] for w in L["words"]]
        out.append({"words": L["words"], "bbox": [min(xs1), min(ys1), max(xs2), max(ys2)],
                    "cy": median([p[1] for p in L["pts"]])})
    out.sort(key=lambda L: (L["cy"], L["bbox"][0]))
    return out


def _sim(a: str, b: str) -> float:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def align(S, G, band_min=25):
    """Banded Needleman–Wunsch on word similarity. Returns [(i or None, j or None, sim)] in order."""
    n, m = len(S), len(G)
    if not n or not m:
        return [(i, None, 0.0) for i in range(n)] + [(None, j, 0.0) for j in range(m)]
    GAP = -0.45
    band = max(band_min, abs(n - m) + band_min)
    NEG = float("-inf")
    score = {(0, 0): 0.0}
    back = {}
    for i in range(0, n + 1):
        centre = int(i * m / n)
        lo, hi = max(0, centre - band), min(m, centre + band)
        for j in range(lo, hi + 1):
            if i == 0 and j == 0:
                continue
            best, arg = NEG, None
            if i > 0 and j > 0 and (i - 1, j - 1) in score:
                s = _sim(S[i - 1], G[j - 1])
                v = score[(i - 1, j - 1)] + (2.0 * s - 0.7)
                if v > best: best, arg = v, ("m", s)
            if i > 0 and (i - 1, j) in score:
                v = score[(i - 1, j)] + GAP
                if v > best: best, arg = v, ("s", 0.0)
            if j > 0 and (i, j - 1) in score:
                v = score[(i, j - 1)] + GAP
                if v > best: best, arg = v, ("g", 0.0)
            if arg is not None:
                score[(i, j)] = best; back[(i, j)] = arg
    if (n, m) not in score:                         # band too narrow for this pair: widen once
        return align(S, G, band_min=band_min * 4) if band_min < 200 else [(i, None, 0.0) for i in range(n)]
    path, i, j = [], n, m
    while i > 0 or j > 0:
        k, s = back[(i, j)]
        if k == "m": path.append((i - 1, j - 1, s)); i -= 1; j -= 1
        elif k == "s": path.append((i - 1, None, 0.0)); i -= 1
        else: path.append((None, j - 1, 0.0)); j -= 1
    return path[::-1]


def build_physical_lines(blocks, google_words, page_number, confidence_band, text_similarity, texts_disagree):
    """Returns records in the shape used by apply_visual_review/finalise_review, with Google fields filled."""
    lines = cluster_lines(google_words)
    if not lines:
        return None
    # Sarvam tokens in reading order, remembering their block
    S, S_block = [], []
    for b in blocks:
        for tok in (b.get("text") or "").split():
            S.append(tok); S_block.append(b)
    G, G_line = [], []
    for li, L in enumerate(lines):
        for w in L["words"]:
            G.append(w["text"]); G_line.append(li)

    pairs = align(S, G)
    line_of = [None] * len(S)
    sims = [0.0] * len(S)
    for i, j, s in pairs:
        if i is not None and j is not None and s >= 0.35:
            line_of[i] = G_line[j]; sims[i] = s
    # words Sarvam read that Google has no counterpart for stay with their neighbours
    last = None
    for i in range(len(S)):
        if line_of[i] is None: line_of[i] = last
        else: last = line_of[i]
    nxt = None
    for i in range(len(S) - 1, -1, -1):
        if line_of[i] is None: line_of[i] = nxt
        else: nxt = line_of[i]
    # keep reading order monotonic: a word never jumps back to an earlier line
    for i in range(1, len(S)):
        if line_of[i] is not None and line_of[i - 1] is not None and line_of[i] < line_of[i - 1]:
            line_of[i] = line_of[i - 1]

    records = []
    for li, L in enumerate(lines):
        idx = [i for i in range(len(S)) if line_of[i] == li]
        prim = " ".join(S[i] for i in idx)
        gwords = L["words"]
        gtext = " ".join(w["text"] for w in gwords)
        extra = []
        if not prim:
            prim = gtext
            extra.append("ONLY_SECOND_READING")
        elif sum(1 for i in idx if sims[i] >= 0.5) < 0.5 * len(idx):
            extra.append("LINE_ALIGNMENT_UNCERTAIN")
        blks = [S_block[i] for i in idx] or [blocks[0] if blocks else {}]
        confs = [b.get("ocr_confidence") for b in blks if isinstance(b.get("ocr_confidence"), (int, float))]
        conf = min(confs) if confs else None
        x1, y1, x2, y2 = L["bbox"]
        pad = 4
        poly = [[x1 - pad, y1 - pad], [x2 + pad, y1 - pad], [x2 + pad, y2 + pad], [x1 - pad, y2 + pad]]
        wconf = [w["confidence"] for w in gwords if isinstance(w.get("confidence"), (int, float))]
        sconf = [s["confidence"] for w in gwords for s in w.get("symbols", []) if isinstance(s.get("confidence"), (int, float))]
        records.append({
            "line_id": f"P{page_number}-L{li + 1}",
            "page_number": page_number,
            "primary_text": prim,
            "sarvam_block_index": blks[0].get("block_index"),
            "sarvam_ocr_confidence": conf,
            "confidence_band": confidence_band(conf),
            "block_type": blks[0].get("type"),
            "polygon": poly,
            "surya_index": None, "surya_confidence": None,
            "line_width_px": x2 - x1, "cy": L["cy"],
            "alignment_distance": None, "alignment_count_mismatch": False,
            "line_source": "google_word_geometry",
            "extra_flags": extra,
            "google_prefilled": True,
            "google_text": gtext,
            "google_words": gwords,
            "google_similarity": text_similarity(prim, gtext),
            "google_models_disagree": texts_disagree(prim, gtext) if "ONLY_SECOND_READING" not in extra else False,
            "google_min_word_confidence": min(wconf) if wconf else None,
            "google_min_symbol_confidence": min(sconf) if sconf else None,
        })
    return records
