"""
Tamil learner-error taxonomy + automatic tagging for detector candidates.

Every candidate that leaves /api/detect-errors carries a Tamil sub-type, its group, and a
record of HOW the tag was decided, so later analysis can filter by tag reliability:

    subtype / subtype_ta / group / group_ta / family_ta
    tag_source      rule | correction_analysis | llm_consensus | llm | correction_analysis_weak | default
    tag_confidence  high | medium | low
    subtype_options every sub-type any detector proposed, with who proposed it

Tagging order of trust (most → least):
  1. deterministic rules (repeated word, repeated punctuation)
  2. correction analysis: the exact character/word difference between the learner form and
     the correction (reliable for letter-level, spacing, punctuation and ending changes)
  3. two independent LLMs agreeing on the same sub-type
  4. a single LLM's sub-type
  5. weak correction analysis (generic word-form / spelling fallback)
  6. mapping from the legacy English category
Codes are identical to taxonomy.js (frontend) and tamil_error_pipeline_v3.py (research).
"""
from __future__ import annotations

import difflib
import os
import unicodedata
from collections import Counter

import regex as re

GROUPS = {
    "EZHUTHU": "எழுத்தியல்",
    "SOL": "சொல்லியல்",
    "ILAKKANAM": "இலக்கணம்",
    "NADAI": "வாக்கிய/எழுத்து நடை",
}

# code: (Tamil label, group, family (optional), definition, example)
SUBTYPES = {
    "EZ_GEN":   ("எழுத்துப் பிழை", "EZHUTHU", None, "wrong letter / general spelling error", "தோடம் → தோட்டம்"),
    "OTTRU":    ("ஒற்றுப் பிழை", "EZHUTHU", None, "missing, unnecessary or incorrect consonant doubling / வல்லின ஒற்று (க்/ச்/த்/ப் at a junction)", "படத்தை பார்த்தேன் → படத்தைப் பார்த்தேன்"),
    "KURIL":    ("குறில்–நெடில் பிழை", "EZHUTHU", None, "short/long vowel error", "கலம் / காலம்"),
    "LLZH":     ("மெய்யெழுத்துப் பிழை (ல/ள/ழ)", "EZHUTHU", "மெய்யெழுத்துப் பிழை", "confusion between ல / ள / ழ", "பலம் → பழம் (fruit)"),
    "RR":       ("மெய்யெழுத்துப் பிழை (ர/ற)", "EZHUTHU", "மெய்யெழுத்துப் பிழை", "confusion between ர / ற", "கரி → கறி (curry)"),
    "NNN":      ("மெய்யெழுத்துப் பிழை (ந/ன/ண)", "EZHUTHU", "மெய்யெழுத்துப் பிழை", "confusion between ந / ன / ண", "பனி → பணி (work)"),
    "UYIR":     ("உயிர்மெய் / உயிர்க்குறிப் பிழை", "EZHUTHU", None, "wrong vowel sign attached to a consonant", "கெ / கே, கு / கூ"),
    "PULLI":    ("புள்ளிப் பிழை", "EZHUTHU", None, "omission/addition of the pulli", "க / க்; படம → படம்"),
    "PUNAR":    ("சந்திப்பிழை / புணர்ச்சிப் பிழை", "SOL", None, "error when words or morphemes join", "பள்ளி கூடம் → பள்ளிக்கூடம்"),
    "WFORM":    ("சொல் வடிவப் பிழை", "SOL", None, "incorrect inflected/derived form", "பாடம் படித்தல் முடித்தேன் → பாடம் படித்து முடித்தேன்"),
    "CASE":     ("வேற்றுமை உருபுப் பிழை", "SOL", None, "incorrect or missing case marker", "நான் கடை போனேன் → நான் கடைக்குப் போனேன்"),
    "WCHOICE":  ("சொல் தேர்வுப் பிழை", "SOL", None, "wrong word for the context", "புத்தகம் குடித்தான் → புத்தகம் படித்தான்"),
    "TENSE":    ("காலப் பிழை", "ILAKKANAM", None, "incorrect tense", "நாளை நான் வந்தேன் → நாளை நான் வருவேன்"),
    "NUMBER":   ("ஒருமை–பன்மைப் பிழை", "ILAKKANAM", None, "number agreement error", "மூன்று பூ → மூன்று பூக்கள்"),
    "SV_AGR":   ("எழுவாய்–பயனிலை இயைபுப் பிழை", "ILAKKANAM", None, "subject–verb agreement error", "மாடுகள் ஓடியது → மாடுகள் ஓடின"),
    "PGN":      ("பால் / திணை / எண் இயைபுப் பிழை", "ILAKKANAM", None, "gender/class/number/person agreement error", "அவர்கள் வந்தான் → அவர்கள் வந்தார்கள்"),
    "CONSTR":   ("தொடரமைப்புப் பிழை", "ILAKKANAM", None, "phrase/sentence construction error", ""),
    "GRAM_GEN": ("இலக்கணப் பிழை", "ILAKKANAM", None, "broader grammar error when no specific label fits", ""),
    "ORDER":    ("சொல் வரிசைப் பிழை", "NADAI", None, "incorrect word order", "சோறு சாப்பிட்டேன் நான் → நான் சோறு சாப்பிட்டேன்"),
    "MISSING":  ("சொல் விடுபட்ட பிழை", "NADAI", None, "missing word", "அவன் கடைக்கு. → அவன் கடைக்குச் சென்றான்."),
    "EXTRA":    ("தேவையற்ற சொல் / மிகைச் சொல் பிழை", "NADAI", None, "extra word", "நான் நான் → நான்"),
    "PUNCT":    ("நிறுத்தற்குறிப் பிழை", "NADAI", None, "punctuation error", ",, → ,"),
    "SPACE":    ("இடைவெளிப் பிழை", "NADAI", None, "incorrect spacing or word separation", "வீட்டு க்கு → வீட்டுக்கு"),
}
CODES = list(SUBTYPES)

LEGACY_TO_SUBTYPE = {"SPELLING": "EZ_GEN", "GRAMMAR": "GRAM_GEN", "PUNCTUATION": "PUNCT", "WORD_CHOICE": "WCHOICE",
                     "WORD_FORM": "WFORM", "MISSING_WORD": "MISSING", "EXTRA_WORD": "EXTRA", "OTHER": "GRAM_GEN"}
SUBTYPE_TO_LEGACY = {"EZ_GEN": "SPELLING", "OTTRU": "SPELLING", "KURIL": "SPELLING", "LLZH": "SPELLING",
                     "RR": "SPELLING", "NNN": "SPELLING", "UYIR": "SPELLING", "PULLI": "SPELLING", "PUNAR": "SPELLING",
                     "WFORM": "WORD_FORM", "CASE": "GRAMMAR", "WCHOICE": "WORD_CHOICE", "TENSE": "GRAMMAR",
                     "NUMBER": "GRAMMAR", "SV_AGR": "GRAMMAR", "PGN": "GRAMMAR", "CONSTR": "GRAMMAR",
                     "GRAM_GEN": "GRAMMAR", "ORDER": "GRAMMAR", "MISSING": "MISSING_WORD", "EXTRA": "EXTRA_WORD",
                     "PUNCT": "PUNCTUATION", "SPACE": "SPELLING"}


def taxonomy_prompt_block() -> str:
    """The taxonomy as it is shown to the LLM detectors."""
    lines = []
    for gid, gta in GROUPS.items():
        lines.append(f"{gta}:")
        for code, (ta, g, _fam, definition, example) in SUBTYPES.items():
            if g == gid:
                ex = f" — e.g. {example}" if example else ""
                lines.append(f"  {code}: {ta} — {definition}{ex}")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Correction analysis: sub-type from (learner form → correction)
# ─────────────────────────────────────────────────────────────────────────────
CONS = set("கஙசஞடணதநபமயரலவழளறனஜஷஸஹ")
PULLI = "்"
VALLINAM = set("கசடதபற")
SHORT_LONG = {"": "ா", "ா": "", "ி": "ீ", "ீ": "ி", "ு": "ூ", "ூ": "ு", "ெ": "ே", "ே": "ெ", "ொ": "ோ", "ோ": "ொ"}
VOWEL_SL = {"அ": "ஆ", "ஆ": "அ", "இ": "ஈ", "ஈ": "இ", "உ": "ஊ", "ஊ": "உ", "எ": "ஏ", "ஏ": "எ", "ஒ": "ஓ", "ஓ": "ஒ"}
CONF_GROUPS = [("லளழ", "LLZH"), ("ரற", "RR"), ("நனண", "NNN")]
CONNECTIVES = {"ஆனால்", "ஆனாலும்", "மற்றும்", "எனவே", "ஆகவே", "அதனால்", "இருந்தாலும்", "ஏனெனில்", "அல்லது"}

# sub-types the correction analysis can determine reliably from the edit alone
DIFF_TRUSTED = {"PUNCT", "SPACE", "EXTRA", "ORDER", "PUNAR", "PULLI", "KURIL", "LLZH", "RR", "NNN", "UYIR",
                "OTTRU", "NUMBER", "PGN", "TENSE", "SV_AGR", "MISSING", "CONSTR"}


def _letters(word: str):
    return re.findall(r"\p{L}\p{M}*|.", word)


def _split(letter: str):
    return (letter[0], letter[1:]) if letter and letter[0] in CONS else (letter, None)


def classify_correction(orig: str, corr: str):
    """Deterministic Tamil sub-type from the edit, or None."""
    if not corr or orig == corr:
        return None
    o = unicodedata.normalize("NFC", orig).strip()
    c = unicodedata.normalize("NFC", corr).strip()
    word_only = lambda s: re.sub(r"[^\p{L}\p{M}\p{N}]", "", s)
    punct_only = lambda s: re.sub(r"[\p{L}\p{M}\p{N}\s]", "", s)
    if word_only(o) == word_only(c) and punct_only(o) != punct_only(c):
        return "PUNCT"
    if o.replace(" ", "") == c.replace(" ", ""):
        return "SPACE"
    ow, cw = o.split(), c.split()
    if len(ow) == len(cw) + 1 and any(ow[i] == ow[i + 1] for i in range(len(ow) - 1)):
        return "EXTRA"
    strip_ottru = lambda ws: sorted(re.sub("[கசதப]்$", "", word_only(x)) for x in ws)
    if len(ow) > 1 and strip_ottru(ow) == strip_ottru(cw) and ow != cw:
        return "ORDER"
    if len(ow) == len(cw) + 1:
        ops = difflib.SequenceMatcher(None, ow, cw).get_opcodes()
        dele = [ow[i1:i2] for t, i1, i2, _j1, _j2 in ops if t == "delete"]
        if len(dele) == 1 and len(dele[0]) == 1 and all(t in ("equal", "delete") for t, *_ in ops):
            return "CONSTR" if dele[0][0] in CONNECTIVES else "EXTRA"
    if len(ow) > 1 and len(cw) == 1:
        return "PUNAR"
    if len(cw) > len(ow):
        return "MISSING"
    if len(ow) == len(cw) and len(ow) > 1:
        diffs = [(a, b) for a, b in zip(ow, cw) if a != b]
        return classify_correction(*diffs[0]) if len(diffs) == 1 else "GRAM_GEN"
    if bool(re.search("(கிற|கின்ற)", o)) != bool(re.search("(கிற|கின்ற)", c)):
        return "TENSE"
    pgn = r"(ான்|ாள்|ார்|ார்கள்|ேன்|ோம்|ாய்|ீர்கள்|னர்)$"
    mo, mc = re.search(pgn, o), re.search(pgn, c)
    if mo and mc and mo.group(1) != mc.group(1) and o[:mo.start()] == c[:mc.start()]:
        return "PGN"
    lo, lc = _letters(o), _letters(c)
    if lc[:len(lo)] == lo and "".join(lc[len(lo):]) == "கள்":
        return "NUMBER"
    if o.endswith("ம்") and c.endswith("ங்கள்") and o[:-2] == c[:-5]:
        return "NUMBER"
    if len(lo) == len(lc):
        d = [(a, b) for a, b in zip(lo, lc) if a != b]
        if len(d) == 1:
            (bo, so), (bc, sc) = _split(d[0][0]), _split(d[0][1])
            if so is None or sc is None:
                return "KURIL" if VOWEL_SL.get(bo) == bc else "EZ_GEN"
            if bo == bc:
                if PULLI in (so, sc):
                    return "PULLI"
                if SHORT_LONG.get(so) == sc:
                    return "KURIL"
                return "UYIR"
            if so == sc:
                for grp, code in CONF_GROUPS:
                    if bo in grp and bc in grp:
                        return code
                return "EZ_GEN"
    ops = [op for op in difflib.SequenceMatcher(None, lo, lc).get_opcodes() if op[0] != "equal"]
    if len(ops) == 1:
        tag, i1, i2, j1, j2 = ops[0]
        ins = lc[j1:j2] if tag == "insert" else lo[i1:i2] if tag == "delete" else None
        if ins and len(ins) == 1 and ins[0].endswith(PULLI):
            return "OTTRU" if ins[0][0] in VALLINAM else "EZ_GEN"
    common = len(os.path.commonprefix([o, c]))
    if common >= 2:
        eo, ec = o[common:], c[common:]
        if eo.endswith("து") and ec.endswith("ன"):
            return "SV_AGR"
        if re.search("(க்கு|க்குத்|க்குச்|க்குப்|இல்|ில்)$", c) and not re.search("(க்கு|இல்|ில்)$", o):
            return "CASE"
        return "WFORM"
    return "EZ_GEN" if difflib.SequenceMatcher(None, o, c).ratio() >= 0.6 else "WCHOICE"


# ─────────────────────────────────────────────────────────────────────────────
# Tag decision for a merged candidate
# ─────────────────────────────────────────────────────────────────────────────
LLM_ENGINES = {"sarvam", "gemini"}


def subtype_fields(code: str) -> dict:
    ta, group, family, _d, _e = SUBTYPES[code]
    return {"subtype": code, "subtype_ta": ta, "group": group, "group_ta": GROUPS[group],
            "family_ta": family or ta, "category": SUBTYPE_TO_LEGACY[code]}


def assign_tag(candidate: dict) -> dict:
    """Adds Tamil sub-type + provenance to a merged candidate (in place) and returns it."""
    evidence = candidate.get("evidence") or [{
        "engines": candidate.get("engines", []), "category": candidate.get("category"),
        "subtype": candidate.get("subtype"), "suggested_correction": candidate.get("suggested_correction", "")}]
    form = candidate.get("learner_form", "")

    options = []           # (code, source) pairs
    rule_code = None
    llm_votes = Counter()
    diff_codes = []
    for ev in evidence:
        engines = set(ev.get("engines") or [])
        code = ev.get("subtype") if ev.get("subtype") in SUBTYPES else None
        diff = classify_correction(form, ev.get("suggested_correction") or "")
        if diff:
            diff_codes.append(diff)
            ev["subtype_from_correction"] = diff
        if "rules" in engines and code:
            rule_code = code
            options.append((code, "rules"))
        elif engines & LLM_ENGINES and code:
            for e in engines & LLM_ENGINES:
                llm_votes[code] += 1
                options.append((code, e))
        elif code:
            options.append((code, "+".join(sorted(engines)) or "detector"))
    # the chosen correction gets the final say for correction analysis
    main_diff = classify_correction(form, candidate.get("suggested_correction") or "") or (diff_codes[0] if diff_codes else None)
    if main_diff:
        options.append((main_diff, "correction_analysis"))

    if rule_code:
        code, source, conf = rule_code, "rule", "high"
    elif main_diff in DIFF_TRUSTED:
        code, source = main_diff, "correction_analysis"
        conf = "high" if (not llm_votes or llm_votes.get(main_diff)) else "medium"
    elif llm_votes:
        (code, n), = llm_votes.most_common(1)
        if n >= 2:
            source, conf = "llm_consensus", "high" if main_diff in (None, code) else "medium"
        else:
            source, conf = "llm", "medium" if main_diff in (None, code) else "low"
    elif main_diff:
        code, source, conf = main_diff, "correction_analysis_weak", "low"
    else:
        code = LEGACY_TO_SUBTYPE.get(str(candidate.get("category") or "OTHER").upper(), "GRAM_GEN")
        source, conf = "default", "low"

    candidate.update(subtype_fields(code))
    candidate["tag_source"] = source
    candidate["tag_confidence"] = conf
    seen, opts = set(), []
    for c, s in options:
        if (c, s) not in seen:
            seen.add((c, s))
            opts.append({"subtype": c, "subtype_ta": SUBTYPES[c][0], "proposed_by": s})
    candidate["subtype_options"] = opts
    return candidate
