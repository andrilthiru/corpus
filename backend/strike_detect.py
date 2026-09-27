"""
Crossed-out word detection for learner scans.

Each Google Vision word box is cropped from the page and scored for
  * a long near-horizontal stroke through the letter body (single or double strike), or
  * dense over-writing (scribbled out).
Underlines (bottom edge) and ordinary Tamil letter strokes (much shorter than a word) are ignored.

Stage 3 removes high-scoring words from the transcript automatically (reversible, and recorded as the
learner's self-correction); medium scores become a one-click review item.
Synthetic test (Noto Tamil fonts, 372 words each): clean 0/372 marked, underlined 0/372,
single wobbly strike 365/372, double strike and scribble 372/372. Re-check thresholds on real scans.
"""
import cv2
import numpy as np
import regex as re

STRIKE_HIGH = 0.60      # ≥ this share of the word width crossed by one near-horizontal stroke → struck
STRIKE_MAYBE = 0.50     # between MAYBE and HIGH → ask the reviewer
SCRIBBLE_INK = 0.42     # ≥ this share of dark pixels in the word box → scribbled out


def strike_score(crop):
    """crop: PIL image or numpy array of ONE word (a little padding is fine).
    Returns (score 0..1, kind) where kind is 'line', 'scribble' or None."""
    im = np.array(crop.convert("L")) if hasattr(crop, "convert") else crop
    if im.ndim == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    h, w = im.shape[:2]
    if h < 8 or w < 12:
        return 0.0, None
    _, th = cv2.threshold(im, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink = float((th > 0).mean())
    if ink >= SCRIBBLE_INK:
        return min(1.0, ink / SCRIBBLE_INK * STRIKE_HIGH), "scribble"

    best = 0.0
    centre = (w / 2, h / 2)
    for angle in (-10, -6, -3, 0, 3, 6, 10):            # hand-drawn strikes are rarely perfectly level
        rot = th if angle == 0 else cv2.warpAffine(
            th, cv2.getRotationMatrix2D(centre, angle, 1.0), (w, h), flags=cv2.INTER_NEAREST)
        # keep only long horizontal runs; Tamil letter strokes are much shorter than a word
        k = max(12, int(0.45 * w))
        # thicken strokes vertically first so a hand-drawn line that wobbles by a few pixels stays one run
        thick = cv2.dilate(rot, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(3, h // 12))))
        horiz = cv2.morphologyEx(thick, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, 1)))
        # strike lines cross the letter body; underlines sit at the bottom edge
        top, bottom = int(0.18 * h), int(0.82 * h)
        band = horiz[top:bottom]
        if band.size == 0:
            continue
        cover = (band > 0).sum(axis=1) / float(w)
        # a stroke is 1–5 px thick: merge neighbouring rows
        if len(cover) >= 3:
            cover = np.maximum.reduce([cover[:-2], cover[1:-1], cover[2:]])
        best = max(best, float(cover.max()))
    return best, ("line" if best >= STRIKE_MAYBE else None)


def mark_struck_words(page_img, words, pad=4):
    """Adds word['strike'] = {'score', 'kind', 'level'} to each Google word (in place)."""
    W, H = page_img.size
    for w in words:
        bbox = w.get("bbox")
        if not bbox:
            continue
        x1, y1, x2, y2 = [int(round(v)) for v in bbox]
        box = (max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad))
        if box[2] - box[0] < 12 or box[3] - box[1] < 8:
            continue
        score, kind = strike_score(page_img.crop(box))
        # short words (≤ 2 Tamil letters) are narrow, so ordinary letter strokes look "long": ask for more
        n_letters = len(re.findall(r"\p{L}\p{M}*", str(w.get("text", ""))))
        hi, mb = (0.80, 0.65) if n_letters <= 2 else (STRIKE_HIGH, STRIKE_MAYBE)
        level = "high" if (kind == "scribble" or score >= hi) else "maybe" if score >= mb else None
        if level:
            w["strike"] = {"score": round(float(score), 3), "kind": kind, "level": level}
    return words
