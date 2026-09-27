# Tamil Error Detection Pipeline v3.1
#
# v3.1 changes (after the first full Colab run):
#   * LLM verifier calls fixed: Sarvam (reasoning ate the token budget → empty answers; now called like
#     the corpus backend: reasoning off, large max_tokens, api-subscription-key header), Gemini (client was
#     closed before the request), Claude/others (robust JSON extraction; raw answers kept in LLM_RAW).
#   * Names allowlist (people + Singapore places + ThamizhiMorph proper-noun lexicon) respected by every
#     lexical / contextual detector.
#   * Confusable+MLM is stricter: suggestions need Hunspell/frequency support, may not swap a common word
#     for a much rarer one, and never touch emphatic -ஏ/-ஓ endings. All Δ scores are kept so the margin can
#     be chosen from a threshold table instead of guessed.
#   * Vaani is a second opinion: alone it is low priority; style swaps (ஒரு→ஓர்) are ignored.
#   * New layer: Tamil Virtual Academy spell/sandhi checker (tamilinayavaani, GPL, runs offline).
#   * Tense rule generates the past form with ThamizhiMorph; construction rule covers concessive -ஆலும்.
#
#
# Changes from v2:
#   1. ThamizhiMorph (finite-state morphology) added as a third POSITIVE validity signal,
#      plus a "guessed form with a known root and a real case ending" rule (fixes குடுவையை).
#      Morphology failure is recorded as evidence only — it never becomes an error by itself.
#   2. Agreement rules (PGN / SV_AGR) now read person-number-gender from ThamizhiMorph and
#      GENERATE the corrected verb with the transducer; suffix regexes remain as fallback.
#   3. New detector `lexical_neighbour`: a word unknown to every lexicon AND one Tamil-specific
#      edit away from a known word (தோடத்தில் → தோட்டத்தில்). Unknown alone is never flagged.
#   4. Review grouping: overlapping flags from different tools become ONE review item with all
#      evidence kept (v2 made two items for "இரண்டு மரம்" + "மரம்").
#   5. Fuller subtype inference from a suggestion (PGN, TENSE, NUMBER, ORDER, CONSTR …).
#   6. Optional LLM verifier (Sarvam-105B, Claude, GPT, Gemini) — report-only, benchmarked separately.
#
# NOTHING is auto-corrected. Every output is a candidate for human review.

from __future__ import annotations
import os, re, json, time, unicodedata, difflib, subprocess, shutil
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Tuple, Iterable
from functools import lru_cache

try:
    import regex
except ImportError:
    regex = None

# ─────────────────────────────────────────────────────────────────────────────
# 1. Taxonomy
# ─────────────────────────────────────────────────────────────────────────────
SUBTYPES = {
    'EZ_GEN':  ('எழுத்துப் பிழை',                  'எழுத்தியல்'),
    'OTTRU':   ('ஒற்றுப் பிழை',                    'எழுத்தியல்'),
    'KURIL':   ('குறில்–நெடில் பிழை',              'எழுத்தியல்'),
    'LLZH':    ('ல/ள/ழ பிழை',                     'எழுத்தியல்'),
    'RR':      ('ர/ற பிழை',                       'எழுத்தியல்'),
    'NNN':     ('ந/ன/ண பிழை',                     'எழுத்தியல்'),
    'UYIR':    ('உயிர்க்குறிப் பிழை',              'எழுத்தியல்'),
    'PULLI':   ('புள்ளிப் பிழை',                   'எழுத்தியல்'),
    'PUNAR':   ('புணர்ச்சிப் பிழை',                'சொல்லியல்'),
    'WFORM':   ('சொல் வடிவப் பிழை',                'சொல்லியல்'),
    'CASE':    ('வேற்றுமை உருபுப் பிழை',           'சொல்லியல்'),
    'WCHOICE': ('சொல் தேர்வுப் பிழை',              'சொல்லியல்'),
    'TENSE':   ('காலப் பிழை',                     'இலக்கணம்'),
    'NUMBER':  ('ஒருமை–பன்மைப் பிழை',              'இலக்கணம்'),
    'SV_AGR':  ('எழுவாய்–பயனிலை இயைபுப் பிழை',    'இலக்கணம்'),
    'PGN':     ('பால்/திணை/எண்/நபர் இயைபுப் பிழை', 'இலக்கணம்'),
    'CONSTR':  ('தொடரமைப்புப் பிழை',               'இலக்கணம்'),
    'GRAM_GEN':('இலக்கணப் பிழை',                   'இலக்கணம்'),
    'MISSING': ('சொல் விடுபட்ட பிழை',              'வாக்கிய/எழுத்து நடை'),
    'EXTRA':   ('மிகைச் சொல் பிழை',                'வாக்கிய/எழுத்து நடை'),
    'ORDER':   ('சொல் வரிசைப் பிழை',               'வாக்கிய/எழுத்து நடை'),
    'PUNCT':   ('நிறுத்தற்குறிப் பிழை',            'வாக்கிய/எழுத்து நடை'),
    'SPACE':   ('இடைவெளிப் பிழை',                  'வாக்கிய/எழுத்து நடை'),
}
TOP_OF = {k: v[1] for k, v in SUBTYPES.items()}
TA_OF = {k: v[0] for k, v in SUBTYPES.items()}

# ─────────────────────────────────────────────────────────────────────────────
# 2. Config
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class Config:
    run_rules: bool = True
    run_neighbour: bool = True
    run_vaani: bool = True
    run_mlm: bool = True
    run_tamilvu: bool = True                # Tamil Virtual Academy spell/sandhi checker (tamilinayavaani)
    run_llm_verifier: bool = False          # benchmark separately; needs a key
    names_path: Optional[str] = None        # extra names (people/places), one per line
    use_names: bool = True                  # v3 baseline: False
    mlm_strict: bool = True                 # v3 baseline: False (no surface/frequency/clitic guards)
    tamilvu_mode: str = 'sandhi'            # 'sandhi' = only ஒற்று add/remove suggestions; 'all' = every suggestion

    # positive validity signals (none of them declares an error)
    use_hunspell_for_validity: bool = True
    use_morph_for_validity: bool = True
    hunspell_dict_dir: str = '/content/dict'
    morph_dir: str = '/content/thamizhi-morph/FST-Models'
    min_zipf: float = 1.0
    extra_lexicon_path: Optional[str] = None   # Iyal / custom list, one word per line

    mlm_models: Tuple[str, ...] = ('google/muril-base-cased', 'ai4bharat/IndicBERTv2-MLM-only')
    mlm_margin: float = 2.0
    mlm_store_min: float = 0.5               # all candidates above this are kept for the threshold table
    mlm_max_zipf_drop: float = 1.0           # a suggestion may not be >1 zipf point rarer than the original
    mlm_max_length: int = 256

    vaani_api_key: Optional[str] = None
    vaani_timeout: int = 60

    # LLM verifier — provider: 'sarvam' | 'claude' | 'openai' | 'gemini'
    llm_provider: str = 'sarvam'
    llm_models: Dict[str, str] = field(default_factory=lambda: {
        'sarvam': 'sarvam-105b', 'claude': 'claude-sonnet-5', 'openai': 'gpt-5', 'gemini': 'gemini-2.5-pro'})
    sarvam_url: str = 'https://api.sarvam.ai/v1/chat/completions'
    sarvam_reasoning_effort: Optional[str] = None     # None = off (recommended); 'low' | 'high' | 'max'
    llm_max_tokens: int = 12000

    auto_correct: bool = False   # research guardrail — never apply suggestions

CFG = Config()

def get_secret(name):
    try:
        from google.colab import userdata
        v = userdata.get(name)
        if v: return v
    except Exception:
        pass
    return os.environ.get(name, '')

# ─────────────────────────────────────────────────────────────────────────────
# 3. Tamil text utilities
# ─────────────────────────────────────────────────────────────────────────────
TA_CHARS = '஀-௿‌‍'
WORD_RE = re.compile(f'[{TA_CHARS}]+')
CONS = set('கஙசஞடணதநபமயரலவழளறனஜஷஸஹ')
SIGNS = ['', 'ா', 'ி', 'ீ', 'ு', 'ூ', 'ெ', 'ே', 'ை', 'ொ', 'ோ', 'ௌ']
PULLI = '்'
VALLINAM = set('கசடதபற')
SHORT_LONG = {'': 'ா', 'ா': '', 'ி': 'ீ', 'ீ': 'ி', 'ு': 'ூ', 'ூ': 'ு', 'ெ': 'ே', 'ே': 'ெ', 'ொ': 'ோ', 'ோ': 'ொ'}
VOWEL_SL = {'அ': 'ஆ', 'ஆ': 'அ', 'இ': 'ஈ', 'ஈ': 'இ', 'உ': 'ஊ', 'ஊ': 'உ', 'எ': 'ஏ', 'ஏ': 'எ', 'ஒ': 'ஓ', 'ஓ': 'ஒ'}
CONF_GROUPS = [('லளழ', 'LLZH'), ('ரற', 'RR'), ('நனண', 'NNN')]

def norm(s: str) -> str:
    return unicodedata.normalize('NFC', s or '')

def tokens(text: str):
    return [(m.group(), m.start(), m.end()) for m in WORD_RE.finditer(text)]

def sentences(text: str):
    out, start = [], 0
    for m in re.finditer(r'[.!?]+[”"’]?', text):
        s = text[start:m.end()]
        if s.strip():
            lead = len(s) - len(s.lstrip())
            out.append((s.strip(), start + lead, m.end()))
        start = m.end()
    if text[start:].strip():
        lead = len(text[start:]) - len(text[start:].lstrip())
        out.append((text[start:].strip(), start + lead, len(text)))
    return out

def clauses(text: str):
    out, start = [], 0
    for m in re.finditer(r'[.!?,;“”"\n]+', text):
        if text[start:m.start()].strip(): out.append((start, m.start()))
        start = m.end()
    if text[start:].strip(): out.append((start, len(text)))
    return out

def letters(word: str):
    if regex is None: return list(word)
    return regex.findall(r'\p{L}\p{M}*|.', word)

def split_letter(L: str):
    if L and L[0] in CONS: return L[0], L[1:]
    return L, None

def confusable_variants(word: str):
    """Single Tamil-aware edits → [(candidate, subtype)]. Candidates, not corrections."""
    L = letters(word)
    out = []
    def emit(new_letters, st):
        c = ''.join(new_letters)
        if c != word: out.append((c, st))
    for i, l in enumerate(L):
        base, sign = split_letter(l)
        if sign is None:
            if base in VOWEL_SL: emit(L[:i] + [VOWEL_SL[base]] + L[i + 1:], 'KURIL')
            continue
        for grp, code in CONF_GROUPS:
            if base in grp:
                for b2 in grp.replace(base, ''):
                    emit(L[:i] + [b2 + sign] + L[i + 1:], code)
        if sign != PULLI:
            if sign in SHORT_LONG: emit(L[:i] + [base + SHORT_LONG[sign]] + L[i + 1:], 'KURIL')
            for s2 in SIGNS:
                if s2 != sign and SHORT_LONG.get(sign) != s2:
                    emit(L[:i] + [base + s2] + L[i + 1:], 'UYIR')
        if sign == '': emit(L[:i] + [base + PULLI] + L[i + 1:], 'PULLI')
        if sign == PULLI:
            emit(L[:i] + [base] + L[i + 1:], 'PULLI')
            if base in VALLINAM and i + 1 < len(L) and split_letter(L[i + 1])[0] == base:
                emit(L[:i] + L[i + 1:], 'OTTRU')
        if i > 0 and base in VALLINAM and sign != PULLI and L[i - 1] != base + PULLI:
            emit(L[:i] + [base + PULLI] + L[i:], 'OTTRU')
    seen, res = set(), []
    for c, st in out:
        if c not in seen: seen.add(c); res.append((c, st))
    return res

# ─────────────────────────────────────────────────────────────────────────────
# 4. Subtype inference from (wrong → suggested)
# ─────────────────────────────────────────────────────────────────────────────
CONNECTIVES = {'ஆனால்', 'ஆனாலும்', 'மற்றும்', 'எனவே', 'ஆகவே', 'அதனால்', 'இருந்தாலும்', 'ஏனெனில்', 'அல்லது'}

def classify_correction(orig, corr):
    if not corr or orig == corr: return None
    o, c = orig.strip(), corr.strip()
    po, pc = re.sub(f'[{TA_CHARS}\\s]', '', o), re.sub(f'[{TA_CHARS}\\s]', '', c)
    if re.sub(r'[^\w]', '', o) == re.sub(r'[^\w]', '', c) and po != pc: return 'PUNCT'
    if o.replace(' ', '') == c.replace(' ', ''): return 'SPACE'
    ow, cw = o.split(), c.split()
    if len(ow) == len(cw) + 1 and any(ow[i] == ow[i + 1] for i in range(len(ow) - 1)): return 'EXTRA'
    strip_ottru = lambda ws: sorted(re.sub('[கசதப]்$', '', re.sub(r'[^\w஀-௿]', '', x)) for x in ws)
    if len(ow) > 1 and strip_ottru(ow) == strip_ottru(cw) and ow != cw: return 'ORDER'
    if len(ow) == len(cw) + 1:
        ops = difflib.SequenceMatcher(None, ow, cw).get_opcodes()
        dele = [ow[i1:i2] for t, i1, i2, j1, j2 in ops if t == 'delete']
        if len(dele) == 1 and len(dele[0]) == 1 and all(t in ('equal', 'delete') for t, *_ in ops):
            return 'CONSTR' if dele[0][0] in CONNECTIVES else 'EXTRA'
    if len(ow) > 1 and len(cw) == 1 and ' ' in o: return 'PUNAR'
    if len(cw) > len(ow): return 'MISSING'
    if len(ow) == len(cw) and len(ow) > 1:
        diffs = [(a, b) for a, b in zip(ow, cw) if a != b]
        if len(diffs) == 1: return classify_correction(*diffs[0])
        return 'GRAM_GEN'
    if re.search('(கிற|கின்ற)', o) != re.search('(கிற|கின்ற)', c) and bool(re.search('(கிற|கின்ற)', o)) != bool(re.search('(கிற|கின்ற)', c)):
        return 'TENSE'
    pgn = r'(ான்|ாள்|ார்|ார்கள்|ேன்|ோம்|ாய்|ீர்கள்|னர்)$'
    mo, mc = re.search(pgn, o), re.search(pgn, c)
    if mo and mc and mo.group(1) != mc.group(1) and o[:mo.start()] == c[:mc.start()]: return 'PGN'
    lo, lc = letters(o), letters(c)
    if lc[:len(lo)] == lo and ''.join(lc[len(lo):]) == 'கள்': return 'NUMBER'
    if o.endswith('ம்') and c.endswith('ங்கள்') and o[:-2] == c[:-5]: return 'NUMBER'
    if len(lo) == len(lc):
        d = [(a, b) for a, b in zip(lo, lc) if a != b]
        if len(d) == 1:
            (bo, so), (bc, sc) = split_letter(d[0][0]), split_letter(d[0][1])
            if so is None or sc is None:
                return 'KURIL' if VOWEL_SL.get(bo) == bc else 'EZ_GEN'
            if bo == bc:
                if PULLI in (so, sc): return 'PULLI'
                if SHORT_LONG.get(so) == sc: return 'KURIL'
                return 'UYIR'
            if so == sc:
                for grp, code in CONF_GROUPS:
                    if bo in grp and bc in grp: return code
                return 'EZ_GEN'
    ops = [op for op in difflib.SequenceMatcher(None, lo, lc).get_opcodes() if op[0] != 'equal']
    if len(ops) == 1:
        tag, i1, i2, j1, j2 = ops[0]
        ins = lc[j1:j2] if tag == 'insert' else lo[i1:i2] if tag == 'delete' else None
        if ins and len(ins) == 1 and ins[0].endswith(PULLI):
            return 'OTTRU' if ins[0][0] in VALLINAM else 'EZ_GEN'
    common = len(os.path.commonprefix([o, c]))
    if common >= 2:
        eo, ec = o[common:], c[common:]
        if eo.endswith('து') and ec.endswith('ன'): return 'SV_AGR'
        if re.search('(க்கு|க்குத்|க்குச்|க்குப்|இல்|ில்)$', c) and not re.search('(க்கு|இல்|ில்)$', o): return 'CASE'
        return 'WFORM'
    if difflib.SequenceMatcher(None, o, c).ratio() >= 0.6: return 'EZ_GEN'
    return 'WCHOICE'

# ─────────────────────────────────────────────────────────────────────────────
# 5. Candidate model
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class Candidate:
    source: str
    start: int
    end: int
    error_text: str
    correction: Optional[str] = None
    subtype: Optional[str] = None
    note: str = ''
    score: Optional[float] = None
    evidence: List[dict] = field(default_factory=list)

    @property
    def group(self): return TOP_OF.get(self.subtype, 'தெரியவில்லை')
    @property
    def tamil_type(self): return TA_OF.get(self.subtype, 'வகைப்படுத்தப்படவில்லை')

def make_candidate(source, text, start, end, correction=None, subtype=None, note='', score=None):
    if subtype is None and correction:
        subtype = classify_correction(text[start:end], correction)
    return Candidate(source, start, end, text[start:end], correction, subtype, note, score)

# ─────────────────────────────────────────────────────────────────────────────
# 6. ThamizhiMorph (foma FSTs)
# ─────────────────────────────────────────────────────────────────────────────
MORPH_FSTS = ['noun', 'pronoun', 'adj', 'adv', 'part',
              'verb-c3', 'verb-c4', 'verb-c11', 'verb-c12', 'verb-c62', 'verb-c-rest']
VERB_FSTS = [f for f in MORPH_FSTS if f.startswith('verb')]
GUESS_FSTS = ['noun-guess', 'verb-guess', 'adj-guess', 'adv-guess']
REAL_CASE_TAGS = ('+acc', '+dat', '+loc', '+abl', '+gen', '+soc', '+inst', '+pl')

class Morph:
    """Thin wrapper over `flookup`. analyse → {word: [analysis strings]}; generate(tagstring) → surface."""
    def __init__(self, fst_dir):
        self.dir = fst_dir
        self.ok = bool(shutil.which('flookup')) and os.path.exists(os.path.join(fst_dir, 'noun.fst'))
        self._a, self._g, self._gen = {}, {}, {}

    def _run(self, fst, words, inverse=False):
        args = ['flookup'] + (['-i'] if inverse else []) + [os.path.join(self.dir, fst + '.fst')]
        out = subprocess.run(args, input='\n'.join(words) + '\n', capture_output=True, text=True).stdout
        res = {}
        for line in out.splitlines():
            if '\t' not in line: continue
            w, a = line.split('\t', 1)
            if a != '+?': res.setdefault(w, []).append(f'{fst}:{a}')
        return res

    def analyse_many(self, words, guess=False):
        cache = self._g if guess else self._a
        todo = [w for w in dict.fromkeys(words) if w not in cache]
        if todo and self.ok:
            got = {w: [] for w in todo}
            for f in (GUESS_FSTS if guess else MORPH_FSTS):
                for w, a in self._run(f, todo).items():
                    if w in got: got[w].extend(a)
            cache.update(got)
        return {w: cache.get(w, []) for w in words}

    def analyse(self, w): return self.analyse_many([w])[w]

    def generate(self, tagstring, fsts=VERB_FSTS):
        if tagstring in self._gen: return self._gen[tagstring]
        res = None
        for f in fsts:
            r = self._run(f, [tagstring], inverse=True)
            if r:
                res = next(iter(r.values()))[0].split(':', 1)[1]; break
        self._gen[tagstring] = res
        return res

    def status(self, words, lexicon_known):
        """'analysed' | 'guess_known_root' | 'guess_only' | 'none' — evidence, never a verdict."""
        A = self.analyse_many(words)
        G = self.analyse_many([w for w in words if not A[w]], guess=True)
        out = {}
        for w in words:
            if A[w]: out[w] = 'analysed'; continue
            gs = G.get(w, [])
            ok = False
            for g in gs:
                ana = g.split(':', 1)[1]
                lemma = ana.split('+')[0]
                if lemma != w and any(t in ana for t in REAL_CASE_TAGS) and lexicon_known(lemma):
                    ok = True; break
            out[w] = 'guess_known_root' if ok else ('guess_only' if gs else 'none')
        return out

# person/number/gender tags of finite verbs, and what each subject allows
VERB_PNG = re.compile(r'\+(1sg|1pl|2sg|2pl|3sgm|3sgf|3sghe|3ple|3sgn|3pln)=')
PNG_TARGET = {'1sg': '1sg=ஏன்', '1pl': '1pl=ஓம்', '2sg': '2sg=ஆய்', '2pl': '2pl=ஈர்கள்', '3sgm': '3sgm=ஆன்',
              '3sgf': '3sgf=ஆள்', '3sghe': '3sghe=ஆர்', '3ple': '3ple=ஆர்கள்', '3pln': '3pln=அன', '3sgn': '3sgn=அது'}
SUBJ_ALLOWS = {'1sg': {'1sg'}, '1pl': {'1pl'}, '2sg': {'2sg'}, '2plh': {'2pl'}, '2pl': {'2pl'},
               '3sgm': {'3sgm'}, '3sgf': {'3sgf'}, '3sgh': {'3sghe', '3ple'}, '3pl': {'3ple', '3sghe'},
               'npl': {'3pln'}, 'npl_hum': {'3ple', '3sghe'}}
SUBJ_TARGET = {'1sg': '1sg', '1pl': '1pl', '2sg': '2sg', '2plh': '2pl', '2pl': '2pl', '3sgm': '3sgm', '3sgf': '3sgf',
               '3sgh': '3sghe', '3pl': '3ple', 'npl': '3pln', 'npl_hum': '3ple'}

# ─────────────────────────────────────────────────────────────────────────────
# 7. Positive lexicon gate (Hunspell + wordfreq + ThamizhiMorph + custom list)
# ─────────────────────────────────────────────────────────────────────────────
class LexiconGate:
    """Answers only 'is there POSITIVE evidence this form is valid?'. Unknown ≠ misspelled."""
    def __init__(self, cfg: Config = CFG):
        self.cfg = cfg
        self.extra = set()
        self._hs_cache = {}
        self.hunspell_ok = False
        if cfg.extra_lexicon_path and os.path.exists(cfg.extra_lexicon_path):
            self.extra = {norm(x.strip()) for x in open(cfg.extra_lexicon_path, encoding='utf-8') if x.strip()}
        try:
            from wordfreq import zipf_frequency
            self._zipf_fn = zipf_frequency
        except Exception:
            self._zipf_fn = None
        if cfg.use_hunspell_for_validity: self._prepare_hunspell()
        self.morph = Morph(cfg.morph_dir) if cfg.use_morph_for_validity else None
        self._morph_status = {}

    @lru_cache(maxsize=200000)
    def zipf(self, w):
        if self._zipf_fn is None: return 0.0
        try: return float(self._zipf_fn(w, 'ta'))
        except Exception: return 0.0

    def _prepare_hunspell(self):
        if not shutil.which('hunspell'): return
        src = self.cfg.hunspell_dict_dir
        out = os.path.join(src, 'ta_fixed')
        for ext in ('aff', 'dic'):
            raw = os.path.join(src, f'ta_IN_raw.{ext}')
            if not os.path.exists(raw): return
            s = open(raw, encoding='utf-8-sig').read().replace('\r\n', '\n').replace('\r', '\n')
            if ext == 'aff' and 'WORDCHARS' not in s:
                s = s.replace('SET UTF-8', 'SET UTF-8\nWORDCHARS ' + ''.join(chr(c) for c in range(0x0B80, 0x0C00)) + '‌‍', 1)
            open(f'{out}.{ext}', 'w', encoding='utf-8').write(s)
        self.hunspell_dict, self.hunspell_ok = out, True

    def hunspell_many(self, words):
        """Validity only. `hunspell -l` lists misspelled words without generating suggestions
        (suggestion generation was ~13 ms/word in v3; -l checks ~1,500 words in ~35 ms)."""
        words = list(dict.fromkeys(words))
        if not self.hunspell_ok: return {w: False for w in words}
        todo = [w for w in words if w not in self._hs_cache and w.strip() and not re.search(r'\s', w)]
        if todo:
            out = subprocess.run(['hunspell', '-i', 'UTF-8', '-d', self.hunspell_dict, '-l'],
                                 input='\n'.join(todo) + '\n', capture_output=True, text=True,
                                 env={**os.environ, 'LANG': 'C.UTF-8'}).stdout
            bad = set(out.split())
            for w in todo: self._hs_cache[w] = w not in bad
        return {w: self._hs_cache.get(w, False) for w in words}

    def _surface_known(self, words):
        hs = self.hunspell_many(words)
        return {w: (w in self.extra) or self.zipf(w) >= self.cfg.min_zipf or hs.get(w, False) for w in words}

    def morph_status(self, words):
        words = list(dict.fromkeys(words))
        if not (self.morph and self.morph.ok): return {w: 'off' for w in words}
        todo = [w for w in words if w not in self._morph_status]
        if todo:
            # roots proposed by the guesser need a lexicon check too
            self._morph_status.update(self.morph.status(todo, lambda r: self._surface_known([r])[r]))
        return {w: self._morph_status[w] for w in words}

    def valid_many(self, words: Iterable[str]) -> Dict[str, bool]:
        words = list(dict.fromkeys(norm(w) for w in words))
        known = self._surface_known(words)
        need = [w for w in words if not known[w]]
        ms = self.morph_status(need) if need else {}
        return {w: known[w] or ms.get(w) in ('analysed', 'guess_known_root') for w in words}

    def evidence(self, w):
        return {'extra_lexicon': w in self.extra, 'zipf': round(self.zipf(w), 3),
                'hunspell': self.hunspell_many([w])[w], 'morph': self.morph_status([w])[w],
                'valid': self.valid_many([w])[w]}

# ─────────────────────────────────────────────────────────────────────────────
# 8. Generic Tamil rules (morphology-aware)
# ─────────────────────────────────────────────────────────────────────────────
FEMALE_NAMES = {'லதா', 'மீனா', 'கவிதா', 'பிரியா', 'சீதா', 'கீதா', 'ராதா', 'லட்சுமி', 'தேவி', 'மாலா', 'உமா', 'வள்ளி', 'அனிதா', 'சுதா'}
MALE_NAMES = {'ராமு', 'குமார்', 'முருகன்', 'கண்ணன்', 'ரவி', 'அருண்', 'பாலு', 'கார்த்திக்', 'வேலன்', 'சுரேஷ்'}
SUFFIX_SUBJ = {'நான்': ['ேன்'], 'நாங்கள்': ['ோம்'], 'நாம்': ['ோம்'], 'நீ': ['ாய்'], 'நீங்கள்': ['ீர்கள்', 'ீர்'],
               'அவன்': ['ான்'], 'அவள்': ['ாள்'], 'அவர்': ['ார்'], 'அவர்கள்': ['ார்கள்', 'னர்'],
               **{n: ['ாள்'] for n in FEMALE_NAMES}, **{n: ['ான்'] for n in MALE_NAMES}}
PERSON_ENDINGS = ['ார்கள்', 'ீர்கள்', 'ேன்', 'ோம்', 'ாய்', 'ான்', 'ாள்', 'ார்', 'னர்']
NUMERALS = {'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது', 'பத்து', 'நூறு', 'பல', 'பல்வேறு'}
MEASURE = ('மணி', 'நாள்', 'ஆண்டு', 'வயது', 'முறை', 'ரூபாய்', 'கிலோ', 'மீட்டர்', 'நிமிட', 'வாரம்', 'மாதம்', 'அடி', 'லிட்டர்')
CASE_SUFFIX = ('க்கு', 'கு', 'ில்', 'இல்', 'ால்', 'ோடு', 'ின்', 'ிடம்', 'உடன்', 'ுடன்', 'ை')
PRESENT2PAST = {'வருகிற': 'வந்த', 'போகிற': 'போன', 'செய்கிற': 'செய்த', 'படிக்கிற': 'படித்த', 'பார்க்கிற': 'பார்த்த',
                'கொடுக்கிற': 'கொடுத்த', 'இருக்கிற': 'இருந்த', 'சாப்பிடுகிற': 'சாப்பிட்ட', 'விளையாடுகிற': 'விளையாடிய',
                'எழுதுகிற': 'எழுதிய', 'ஓடுகிற': 'ஓடிய', 'சொல்கிற': 'சொன்ன', 'கேட்கிற': 'கேட்ட', 'நடக்கிற': 'நடந்த'}
PAST_ADVERBS = ('நேற்று', 'நேற்றைய', 'முந்தைய', 'கடந்த', 'முன்பு', 'அன்று')
MOTION_STEMS = ('திரும்ப', 'திரும்பி', 'சென்ற', 'சென்றோம்', 'செல்', 'போன', 'போனோம்', 'போக', 'புறப்பட')
BARE_OK_BEFORE_MOTION = {'வீடு', 'ஊர்', 'நாடு', 'வெளியே', 'உள்ளே', 'அங்கே', 'இங்கே', 'மேலே', 'கீழே'}
FINITE_END = re.compile('(ான்|ாள்|ார்|ார்கள்|ேன்|ோம்|ாய்|ீர்கள்|னர்|து|ன|ும்|ை|வில்லை|இல்லை|லாம்|வேண்டும்|உண்டு|ங்கள்|ு)$')
OBLIQUE_END = re.compile('(ில்|இல்|க்கு|ுக்கு|ிடம்|ால்|ோடு|ுடன்)$')

STANDALONE_WORDS = {'ஒரு', 'ஒவ்வொரு', 'அந்த', 'இந்த', 'எந்த', 'சில', 'பல', 'எல்லா', 'மிக', 'மிகவும்', 'மிகுந்த', 'என்', 'உன்', 'அவன்', 'அவள்', 'அவர்', 'நான்', 'நாம்'}

# Names are never "corrected". Extend via Config.names_path (one per line) or add_names([...]).
SG_PLACES = {'சிங்கப்பூர்', 'ஜூரோங்', 'புக்கிட்', 'திமா', 'பாஞ்சாங்', 'பாத்தோக்', 'தெம்பனிஸ்', 'பீஷான்', 'செங்காங்',
             'பொங்கோல்', 'உட்லண்ட்ஸ்', 'ஈசூன்', 'யீஷூன்', 'அங்', 'மோ', 'கியோ', 'தோ', 'பாயோ', 'சாங்கி', 'கிளமெண்டி',
             'சிராங்கூன்', 'பாசிர்', 'ரிஸ்', 'கேலாங்', 'மரீன்', 'பரேட்', 'செம்பவாங்', 'செந்தோசா', 'லிட்டில்', 'இந்தியா',
             'தஞ்சோங்', 'பகார்', 'ஹவ்காங்', 'குவீன்ஸ்டவுன்', 'புவாங்கொக்', 'கல்லாங்', 'ஆர்ச்சர்ட்', 'டெக்கர்', 'கிராஞ்சி',
             'பூன்', 'லே', 'லிம்', 'சூ', 'காங்', 'மலேசியா', 'இந்தியா', 'தமிழ்நாடு', 'சென்னை'}
NAMES = set(FEMALE_NAMES) | set(MALE_NAMES) | SG_PLACES
_CASE_TAIL = re.compile('(இல்|ில்|க்கு|ுக்கு|கு|ை|ின்|இன்|ிடம்|உடன்|ுடன்|ோடு|ால்|ும்|உம்|ஐ)$')

def add_names(words):
    NAMES.update(norm(w).strip() for w in words if str(w).strip())

def load_names_file(path):
    if path and os.path.exists(path):
        add_names(l.split('\t')[0].split(',')[0] for l in open(path, encoding='utf-8'))

def is_name(tok):
    if tok in NAMES: return True
    base = _CASE_TAIL.sub('', tok)                      # ஜூரோங்கில் → ஜூரோங்க… also try the bare stem
    return any(base == n or (len(n) >= 3 and tok.startswith(n) and len(tok) - len(n) <= 6) for n in NAMES if n)

def _vallinam_start(w): return bool(w) and w[0] in VALLINAM and (len(w) == 1 or w[1] != PULLI)
def _ottru_for(w): return w[0] + PULLI

def _subject_class(tok, morph):
    """Person/number class of a clause subject, from ThamizhiMorph first, word lists second."""
    if tok.endswith('ும்'): return None            # coordinated subject (நானும் …) — person is ambiguous
    if tok in FEMALE_NAMES: return '3sgf'
    if tok in MALE_NAMES: return '3sgm'
    if morph and morph.ok:
        for a in morph.analyse(tok):
            if '+pron+' in a and '+nom' in a and '+pssd' not in a:   # என்/எங்கள் are possessive, not subjects
                m = re.search(r'\+(1sg|1pl|2sg|2plh|2pl|3sgm|3sgf|3sgh|3pl)\b', a)
                if m: return m.group(1)
    return None

def _plural_noun_subject(tok, morph):
    if tok.endswith('ர்கள்'): return 'npl_hum'
    if morph and morph.ok and any('+noun+pl+nom' in a for a in morph.analyse(tok)): return 'npl'
    if re.search('(கள்|களும்)$', tok): return 'npl'
    return None

def _verb_png(tok, morph):
    """[(analysis, png)] for finite verb readings of tok."""
    if not (morph and morph.ok): return []
    out = []
    for a in morph.analyse(tok):
        if '+verb+fin+' in a and '+imp=' not in a:
            m = VERB_PNG.search(a)
            if m: out.append((a, m.group(1)))      # 'fst:analysis'
    return out

def _regenerate(fst_analysis, target_png, morph):
    fst, analysis = fst_analysis.split(':', 1)
    tag = re.sub(r'\+(1sg|1pl|2sg|2pl|3sgm|3sgf|3sghe|3ple|3sgn|3pln)=[^+]*$', '+' + PNG_TARGET[target_png], analysis)
    return morph.generate(tag, fsts=[fst] + [f for f in VERB_FSTS if f != fst])  # same paradigm first

PAST_MORPHEMES = ['த்', 'ந்த்', 'ற்', 'ட்', 'இன்', 'ன்', 'ண்ட்']

def _generate_past(pres_analyses, morph):
    """Swap the present-tense morpheme for each candidate past morpheme and let the same FST generate."""
    for fa in pres_analyses:
        fst, analysis = fa.split(':', 1)
        for pm in PAST_MORPHEMES:
            tag = re.sub(r'\+pres=[^+]*', f'+past={pm}', analysis)
            out = morph.generate(tag, fsts=[fst])
            if out: return out
    return None

def rules_generic(text: str, lexicon: LexiconGate) -> List[Candidate]:
    T = 'rules_generic'
    morph = lexicon.morph
    preds = []
    toks = tokens(text)
    if morph and morph.ok:
        morph.analyse_many([t[0] for t in toks])      # one batched FST pass instead of one call per word
    for m in re.finditer(r'([,.!?;:])\1+', text):
        preds.append(make_candidate(T, text, m.start(), m.end(), m.group(1), 'PUNCT', 'repeated punctuation'))
    for (a, s, e), (b, s2, e2) in zip(toks, toks[1:]):
        if a == b and text[e:s2].strip() == '':
            preds.append(make_candidate(T, text, s, e2, a, 'EXTRA', 'adjacent repeated word'))

    for i, (w, s, e) in enumerate(toks):
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        gap = text[e:nxt[1]] if nxt else ''
        same_clause = nxt is not None and not re.search(r'[.!?,;“”"\n]', gap)
        if w in NUMERALS and same_clause:
            n, ns, ne = nxt
            if 'கள' not in n and not n.startswith(MEASURE) and not n.endswith(CASE_SUFFIX) and n.endswith('ம்'):
                corr = None
                if morph and morph.ok and any('+noun+nom' in a for a in morph.analyse(n)):
                    corr = morph.generate(f'{n}+noun+pl+nom', fsts=['noun'])
                corr = corr or n[:-2] + 'ங்கள்'
                preds.append(make_candidate(T, text, s, ne, f'{w} {corr}', 'NUMBER', 'numeral + singular noun'))
        if same_clause and re.search('(களை|க்கு|ற்கு)$', w) and _vallinam_start(nxt[0]):
            preds.append(make_candidate(T, text, s, e, w + _ottru_for(nxt[0]), 'OTTRU', 'வல்லினம் மிகும் after case marker'))
        if same_clause and re.search('(ால்|ாலும்|ந்தும்|த்தும்|ட்டும்)$', w) and w not in ('ஆனால்', 'ஆனாலும்') \
                and nxt[0] in ('ஆனால்', 'ஆனாலும்'):
            preds.append(make_candidate(T, text, s, nxt[2], w, 'CONSTR', 'causal/concessive clause + contrastive connective'))
        if same_clause and nxt[0].startswith(MOTION_STEMS) and w not in BARE_OK_BEFORE_MOTION and re.search('(ை|ம்)$', w) \
                and not w.endswith(CASE_SUFFIX[:-1]):
            corr = w + 'க்கு' if w.endswith('ை') else w[:-2] + 'த்துக்கு'
            if _vallinam_start(nxt[0]): corr += _ottru_for(nxt[0])
            preds.append(make_candidate(T, text, s, e, corr, 'CASE', 'motion verb likely needs dative marker'))
        if same_clause and w.endswith('ை') and re.search('(ான|ிய|ற்ற)$', nxt[0]) and i + 2 < len(toks):
            v = toks[i + 2][0]
            noun = w + (_ottru_for(v) if _vallinam_start(v) else '')
            preds.append(make_candidate(T, text, s, nxt[2], f'{nxt[0]} {noun}', 'ORDER', 'adjective follows noun'))
        if w.endswith('தல்') and i > 0 and toks[i - 1][0].endswith('ாக') and same_clause:
            corr = w[:-4] + 'ி' if w.endswith('ுதல்') else (w[:-5] + 'த்து' if w.endswith('த்தல்') else None)
            preds.append(make_candidate(T, text, s, e, corr, 'WFORM', 'verbal noun where participle expected'))
        if same_clause and w.endswith('ம்') and not w.endswith('ும்') and _vallinam_start(nxt[0]) \
                and re.search('(ில்|ை|க்கு|ின்|ால்)$', nxt[0]) and w not in NUMERALS:
            preds.append(make_candidate(T, text, s, nxt[2], w[:-2] + _ottru_for(nxt[0]) + nxt[0], 'PUNAR', 'noun compound join'))

    # clause-level agreement — morphology first, suffix fallback
    for c0, c1 in clauses(text):
        ct = [t for t in toks if c0 <= t[1] < c1]
        if len(ct) < 2: continue
        last, ls, le = ct[-1]
        vpng = _verb_png(last, morph)
        subj_cls, subj_tok = None, None
        for t in ct[:-1]:
            subj_cls = _subject_class(t[0], morph) or _plural_noun_subject(t[0], morph)
            if subj_cls:
                subj_tok = t[0]; break
        flagged = False
        coordinated = sum(1 for t in ct[:-1] if t[0].endswith('ும்') and t[0] not in ('மிகவும்', 'மீண்டும்')) >= 1 \
            and not any(_plural_noun_subject(t[0], morph) for t in ct[:-1])
        if subj_cls and not subj_cls.startswith('npl') and all(p in ('3sgn', '3pln') for _, p in vpng):
            subj_cls = None      # neuter verb: the pronoun is a possessor/other argument (அவள் கையில் … இருந்தது)
        if subj_cls and vpng and not coordinated:
            allowed = SUBJ_ALLOWS[subj_cls]
            if not any(p in allowed for _, p in vpng):
                # only judge neuter verbs against plural-noun subjects, and personal verbs against pronouns/names
                if not (subj_cls.startswith('npl') and not any(p == '3sgn' for _, p in vpng)):
                    corr = _regenerate(vpng[0][0], SUBJ_TARGET[subj_cls], morph)
                    st = 'SV_AGR' if subj_cls.startswith('npl') else 'PGN'
                    preds.append(make_candidate(T, text, ls, le, corr, st,
                                                f'morph: subject {subj_tok}[{subj_cls}] vs verb [{vpng[0][1]}]'))
                    flagged = True
        if flagged: continue
        # suffix fallback when the verb has no finite analysis
        if not vpng:
            subj = next((t for t in ct[:-1] if t[0] in SUFFIX_SUBJ), None)
            pe = next((x for x in PERSON_ENDINGS if last.endswith(x)), None)
            if subj and pe and last not in SUFFIX_SUBJ:
                exp = SUFFIX_SUBJ[subj[0]]
                if pe not in exp and not (pe == 'னர்' and 'ார்கள்' in exp):
                    preds.append(make_candidate(T, text, ls, le, last[:-len(pe)] + exp[0], 'PGN', f'suffix: subject {subj[0]} ≠ -{pe}'))
            plural = any(re.search('(கள்|களும்)$', t[0]) and not t[0].endswith('ர்கள்') for t in ct[:-1])
            if plural and re.search('(ந்தது|த்தது|ட்டது|ன்றது|கிறது|உள்ளது|ள்ளது)$', last):
                corr = last[:-5] + 'கின்றன' if last.endswith('கிறது') else last[:-2] + 'ன'
                preds.append(make_candidate(T, text, ls, le, corr, 'SV_AGR', 'suffix: plural subject + singular verb'))

    for sent, s0, s1 in sentences(text):
        st = [t for t in toks if s0 <= t[1] < s1]
        if not st: continue
        if any(t[0].startswith(PAST_ADVERBS) for t in st):
            for w, s, e in st:
                pres = [a for a in (morph.analyse(w) if morph and morph.ok else []) if '+pres=' in a and '+fin+' in a]
                m = re.search('(கிற|கின்ற)', w)
                if pres or m:
                    corr = _generate_past(pres, morph)
                    if not corr and m:
                        key = w[:m.start()] + 'கிற'
                        corr = PRESENT2PAST[key] + w[m.end():] if key in PRESENT2PAST else None
                    preds.append(make_candidate(T, text, s, e, corr, 'TENSE', 'past-time adverb + present-tense verb'))
        last, ls, le = st[-1]
        if OBLIQUE_END.search(last):
            has_finite = any(FINITE_END.search(t[0]) and not OBLIQUE_END.search(t[0]) and not t[0].endswith(('க்கு', 'ை'))
                             for t in st[1:-1])
            if not has_finite:
                preds.append(make_candidate(T, text, ls, le, None, 'MISSING', 'sentence ends without a finite verb'))

    ws = [t[0] for t in toks]
    joins = [a[0] + b[0] for a, b in zip(toks, toks[1:])]
    pulli = [w + PULLI for w in ws if w and w[-1] in CONS]
    V = lexicon.valid_many(ws + joins + pulli)
    HS = lexicon.hunspell_many(ws + joins)
    MS = lexicon.morph_status(joins)
    for (a, s, e), (b, s2, e2) in zip(toks, toks[1:]):
        joined_strong = HS.get(a + b, False) or MS.get(a + b) == 'analysed'   # wordfreq alone is too noisy for joins
        if text[e:s2] == ' ' and joined_strong and a not in STANDALONE_WORDS:
            weak = lambda x: not HS.get(x, False) or lexicon.zipf(x) == 0   # a half lacks one of the two surface signals
            if weak(a) or weak(b):
                preds.append(make_candidate(T, text, s, e2, a + b, 'SPACE', 'joined form has positive lexical support'))
    for w, s, e in toks:
        if w and w[-1] in CONS and not V.get(w, False) and V.get(w + PULLI, False):
            preds.append(make_candidate(T, text, s, e, w + PULLI, 'PULLI', 'pulli form has positive lexical support'))
    return exact_span_merge(preds, text)

# ─────────────────────────────────────────────────────────────────────────────
# 9. Lexical neighbour detector (new in v3)
# ─────────────────────────────────────────────────────────────────────────────
def tool_neighbour(text: str, lexicon: LexiconGate) -> List[Candidate]:
    """Flag a word ONLY when (a) no lexicon/morphology supports it AND (b) one Tamil-specific edit
    gives a form that IS supported. Suggestion = best-supported neighbour."""
    toks = tokens(text)
    ws = [w for w, _, _ in toks]
    V = lexicon.valid_many(ws)
    unknown = [w for w in dict.fromkeys(ws) if not V[w] and not (lexicon.cfg.use_names and is_name(w))]
    cand = {w: confusable_variants(w) for w in unknown}
    allc = [c for L in cand.values() for c, _ in L]
    HS = lexicon.hunspell_many(allc)
    # a SUGGESTION needs surface evidence (Hunspell or corpus frequency); morphology alone over-generates (துரும்பினோம்)
    CV = {c: HS[c] or lexicon.zipf(c) >= lexicon.cfg.min_zipf or c in lexicon.extra for c in allc}
    preds = []
    for w, s, e in toks:
        if w not in cand: continue
        good = [(HS[c], lexicon.zipf(c), c, st) for c, st in cand[w] if CV[c]]
        if not good: continue
        good.sort(reverse=True)
        _, z, c, st = good[0]
        alts = [g[2] for g in good[1:4]]
        preds.append(make_candidate('lexical_neighbour', text, s, e, c, st,
                                    f'unknown form; known neighbour (zipf={z:.1f}); alts={alts}'))
    return exact_span_merge(preds, text)

# ─────────────────────────────────────────────────────────────────────────────
# 10. Vaani — report-only (unchanged from v2 apart from subtype inference)
# ─────────────────────────────────────────────────────────────────────────────
VAANI_ENDPOINTS = ['https://vaani.neechalkaran.com/spellcheck', 'http://vaani.neechalkaran.com/spellcheck']
VAANI_KEYED = 'https://vaanieditor.com/SpellCheck.asmx/TamilSpellCheck'

VAANI_STYLE_ONLY = {'ஒரு', 'ஓர்'}

def _vaani_parse(body):
    import xml.etree.ElementTree as ET
    body = body.strip().lstrip('﻿')
    if body.startswith('['): return json.loads(body)
    if body.startswith('{'):
        obj = json.loads(body)
        return obj.get('d', obj.get('result', obj)) if isinstance(obj, dict) else obj
    root = ET.fromstring(body)
    return [{ch.tag.split('}')[-1]: (ch.text or '') for ch in sol} for sol in root.iter() if sol.tag.endswith('Sol')]

def tool_vaani(text: str, cfg: Config = CFG) -> List[Candidate]:
    import requests
    api_key = cfg.vaani_api_key or get_secret('VAANI_API_KEY')
    toks = tokens(text)
    sent_toks = [[t for t in toks if s0 <= t[1] < s1] for _, s0, s1 in sentences(text)]
    data = {'tamilwords': '||'.join('|'.join(w for w, _, _ in st) for st in sent_toks), 'sandhi': 'true',
            'translated': 'true', 'unicode_error': 'true', 'colloquial': 'false', 'apikey': api_key}
    sols, errs = None, []
    for url in ([VAANI_KEYED] if api_key else []) + VAANI_ENDPOINTS:
        try:
            r = requests.post(url, data=data, timeout=cfg.vaani_timeout, headers={'User-Agent': 'Mozilla/5.0'})
            if r.status_code != 200: errs.append(f'{url} HTTP {r.status_code}'); continue
            sols = _vaani_parse(r.text)
            if sols: break
        except Exception as e:
            errs.append(f'{url}: {type(e).__name__}: {e}')
    if not sols: raise RuntimeError('Vaani unavailable: ' + ' | '.join(errs))
    flat = [t for st in sent_toks for t in st]
    preds, ptr = [], 0
    for sol0 in sols:
        sol = {str(k).lower(): v for k, v in sol0.items()}
        uw = (sol.get('userword') or '').strip()
        j = next((k for k in range(ptr, min(ptr + 5, len(flat))) if flat[k][0] == uw), None)
        if j is None: continue
        span = max(1, int(float(sol.get('solspan') or 1)))
        ptr = j + 1
        if str(sol.get('flag')).lower() in ('true', '1'): continue
        if cfg.use_names and is_name(flat[j][0]): continue
        sugg = [x.strip() for x in re.split('[,+]', sol.get('suggestions') or '') if x.strip()]
        if sugg and {flat[j][0], sugg[0]} <= VAANI_STYLE_ONLY: continue     # ஒரு ↔ ஓர் is a style choice
        k2 = min(j + span, len(flat)) - 1
        preds.append(make_candidate('vaani', text, flat[j][1], flat[k2][2], sugg[0] if sugg else None, None,
                                    f"suggestions={sugg[:5]}; sandhi_doubt={sol.get('sandhi_doubt', '')}"))
    return exact_span_merge(preds, text)

def manual_flags(text: str, pasted: str, source='manual_vaani') -> List[Candidate]:
    preds, used = [], set()
    for line in (pasted or '').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or ('=>' not in line and '→' not in line): continue
        wrong, rest = re.split(r'=>|→', line, maxsplit=1)
        wrong = wrong.strip()
        corr, sep, label = rest.partition('|')
        loc = next(((m.start(), m.end()) for m in re.finditer(re.escape(wrong), text) if (m.start(), m.end()) not in used), None)
        if not loc: continue
        used.add(loc)
        label = label.strip()
        preds.append(make_candidate(source, text, loc[0], loc[1], corr.strip() or None,
                                    label if label in SUBTYPES else None, 'manual paste'))
    return exact_span_merge(preds, text)

# ─────────────────────────────────────────────────────────────────────────────
# 11. Confusable + MLM (real-word only; unchanged logic from v2)
# ─────────────────────────────────────────────────────────────────────────────
_MLM = None
def load_mlm(cfg: Config = CFG):
    global _MLM
    if _MLM is not None: return _MLM
    import torch
    from transformers import AutoTokenizer, AutoModelForMaskedLM
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    errs = []
    for name in cfg.mlm_models:
        try:
            tok = AutoTokenizer.from_pretrained(name)
            model = AutoModelForMaskedLM.from_pretrained(name).to(dev).eval()
            _MLM = (name, tok, model, dev)
            print('MLM loaded:', name, 'on', dev)
            return _MLM
        except Exception as e:
            errs.append(f'{name}: {e}')
    raise RuntimeError('No MLM loaded. ' + ' | '.join(errs))

def mlm_window_score(sent, w_start, w_end, cand, cfg: Config = CFG, batch=64):
    import torch
    name, tok, model, dev = load_mlm(cfg)
    s = sent[:w_start] + cand + sent[w_end:]
    enc = tok(s, return_offsets_mapping=True, return_tensors='pt', truncation=True, max_length=cfg.mlm_max_length)
    offs = enc.pop('offset_mapping')[0].tolist()
    ids = enc['input_ids'][0]
    lo = max(0, sent.rfind(' ', 0, max(0, w_start - 1)))
    hi_m = re.search(r'\s\S+', s[w_start + len(cand):])
    hi = w_start + len(cand) + (hi_m.end() if hi_m else 0)
    pos = [i for i, (a, b) in enumerate(offs) if b > a and a < hi and b > lo]
    if not pos: return -1e9
    total = 0.0
    for k in range(0, len(pos), batch):
        chunk = pos[k:k + batch]
        x = ids.repeat(len(chunk), 1)
        for r, p in enumerate(chunk): x[r, p] = tok.mask_token_id
        with torch.no_grad():
            logits = model(input_ids=x.to(dev), attention_mask=torch.ones_like(x).to(dev)).logits
        lp = torch.log_softmax(logits, -1)
        for r, p in enumerate(chunk): total += lp[r, p, ids[p]].item()
    return total

MLM_SCORES = {}      # (text, strict, names) → [(start, end, orig, cand, subtype, delta)] for the threshold table

def tool_mlm(text: str, lexicon: LexiconGate, cfg: Config = CFG, scorer=None, margin=None) -> List[Candidate]:
    """Real-word contextual detector. v3.1 guards: suggestion must have surface support (Hunspell/frequency),
    must not be much rarer than the original, never edits emphatic -ஏ/-ஓ endings, never touches names."""
    margin = cfg.mlm_margin if margin is None else margin
    key = (text, cfg.mlm_strict, cfg.use_names)
    if key not in MLM_SCORES:
        scorer = scorer or (lambda sent, s, e, c: mlm_window_score(sent, s, e, c, cfg))
        toks = tokens(text)
        allw = [w for w, _, _ in toks]
        allc = [c for w in allw for c, _ in confusable_variants(w)]
        V = lexicon.valid_many(allw)
        HS = lexicon.hunspell_many(allc)
        surface = lambda c: HS.get(c, False) or lexicon.zipf(c) >= cfg.min_zipf or c in lexicon.extra
        scored = []
        for sent, s0, s1 in sentences(text):
            for w, rs, re_ in tokens(sent):
                if not V.get(w, False) or (cfg.use_names and is_name(w)): continue
                zw = lexicon.zipf(w)
                last = letters(w)[-1] if w else ''
                cands = []
                Vc = None if cfg.mlm_strict else lexicon.valid_many([c for c, _ in confusable_variants(w)])
                for c, st in confusable_variants(w):
                    if not cfg.mlm_strict:                       # v3 behaviour: any lexicon/morphology support
                        if Vc.get(c): cands.append((c, st))
                        continue
                    if not surface(c): continue
                    if lexicon.zipf(c) < zw - cfg.mlm_max_zipf_drop: continue
                    lc = letters(c)
                    if last and last[-1:] in ('ே', 'ோ') and lc[:-1] == letters(w)[:-1]: continue   # emphatic clitic
                    cands.append((c, st))
                if not cands: continue
                base = scorer(sent, rs, re_, w)
                delta, c, st = max(((scorer(sent, rs, re_, c) - base, c, st) for c, st in cands), key=lambda x: x[0])
                if delta > cfg.mlm_store_min:
                    scored.append((s0 + rs, s0 + re_, w, c, st, delta))
        MLM_SCORES[key] = scored
    preds = [make_candidate('confusable_mlm', text, s, e, c, st, f'real-word contextual alternative; Δ={d:.2f}', d)
             for s, e, w, c, st, d in MLM_SCORES[key] if d > margin]
    return exact_span_merge(preds, text)

# ─────────────────────────────────────────────────────────────────────────────
# 11b. Tamil Virtual Academy spell + sandhi checker (tamilinayavaani, GPL v2)
# ─────────────────────────────────────────────────────────────────────────────
def _is_ottru_edit(w, c):
    """True when c = w plus/minus one word-final வல்லின ஒற்று (க்/ச்/த்/ப்)."""
    return bool(re.fullmatch(re.escape(w) + '[கசதப]்', c) or re.fullmatch(re.escape(c) + '[கசதப]்', w))

def tool_tamilvu(text: str, lexicon: LexiconGate = None) -> List[Candidate]:
    from tamilinayavaani import SpellChecker
    cfg = lexicon.cfg if lexicon else CFG
    toks = tokens(text)
    preds, errors = [], 0
    for i, (w, s, e) in enumerate(toks):
        if cfg.use_names and is_name(w): continue
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        same = nxt is not None and not re.search(r'[.!?,;“”"\n]', text[e:nxt[1]])
        try:
            ok, sugg = SpellChecker.REST_interface(w, nxt[0] if same else None)
        except Exception:
            errors += 1
            continue
        if ok or not sugg: continue
        first = str(sugg[0]).split(',')[0].strip()
        if not first or first == w: continue
        if cfg.tamilvu_mode == 'sandhi' and not _is_ottru_edit(w, first): continue
        preds.append(make_candidate('tamilvu', text, s, e, first, None, f'TamilVU suggestions: {sugg[0]}'))
    if errors: print(f'  (tamilvu: {errors} word(s) raised inside the library and were skipped)')
    return exact_span_merge(preds, text)

# ─────────────────────────────────────────────────────────────────────────────
# 12. LLM verifier (Sarvam / Claude / GPT / Gemini) — report-only
# ─────────────────────────────────────────────────────────────────────────────
VERIFY_PROMPT = """நீங்கள் ஒரு தமிழ் மொழி ஆசிரியர். Automatic tools flagged the candidate errors below in a learner's Tamil text.
Some are false alarms; some errors were missed. Do this:
1. Keep real errors (fix correction / subtype if needed). Drop false alarms.
2. ADD errors the tools missed (spelling, sandhi, grammar, agreement, tense, case, word choice, order, missing/extra word, punctuation, spacing).
Standard written Tamil. Do not flag style preferences.

Taxonomy (use the code):
{tax}

Candidates (JSON): {cands}

Return ONLY JSON: {{"errors": [{{"sentence": "<sentence copied exactly>", "error_text": "<exact substring>",
"correction": "...", "subtype": "<code>", "source": "kept|fixed|added", "explanation": "<short, Tamil>"}}]}}

TEXT:
{text}"""

LLM_RAW = {}   # (provider, label) → raw text, for inspection

def call_llm(prompt, cfg: Config = CFG):
    p = cfg.llm_provider
    model = cfg.llm_models[p]
    if p == 'sarvam':
        # Same call shape as the corpus backend. Reasoning is OFF: with reasoning on, the thinking tokens use up
        # max_tokens and the visible answer comes back empty (documented Sarvam behaviour).
        import requests
        body = {'model': model, 'messages': [
                    {'role': 'system', 'content': 'You are a conservative Tamil learner-corpus error annotator. Return one JSON object only.'},
                    {'role': 'user', 'content': prompt}],
                'temperature': 0.1, 'max_tokens': cfg.llm_max_tokens,
                'reasoning_effort': cfg.sarvam_reasoning_effort, 'response_format': {'type': 'json_object'}}
        r = requests.post(cfg.sarvam_url, json=body, timeout=300,
                          headers={'api-subscription-key': get_secret('SARVAM_API_KEY'), 'Content-Type': 'application/json'})
        r.raise_for_status()
        msg = (r.json().get('choices') or [{}])[0].get('message') or {}
        content = msg.get('content') or ''
        if not content.strip():
            raise RuntimeError(f"Sarvam returned empty content (reasoning chars={len(msg.get('reasoning_content') or '')}); "
                               "raise llm_max_tokens or keep reasoning off")
        return content
    if p == 'openai':
        from openai import OpenAI
        client = OpenAI(api_key=get_secret('OPENAI_API_KEY'))
        kw = dict(model=model, messages=[{'role': 'user', 'content': prompt}])
        try:
            r = client.chat.completions.create(**kw, response_format={'type': 'json_object'})
        except Exception:
            r = client.chat.completions.create(**kw)
        return r.choices[0].message.content
    if p == 'claude':
        import anthropic
        client = anthropic.Anthropic(api_key=get_secret('ANTHROPIC_API_KEY'))
        r = client.messages.create(model=model, max_tokens=cfg.llm_max_tokens,
                                   messages=[{'role': 'user', 'content': prompt}])
        if getattr(r, 'stop_reason', '') == 'max_tokens':
            print('  (claude: answer hit max_tokens — raise llm_max_tokens)')
        return ''.join(b.text for b in r.content if getattr(b, 'type', '') == 'text')
    if p == 'gemini':
        from google import genai
        client = genai.Client(api_key=get_secret('GEMINI_API_KEY'))      # keep a reference: closed clients fail
        r = client.models.generate_content(model=model, contents=prompt,
                                           config={'response_mime_type': 'application/json', 'temperature': 0,
                                                   'max_output_tokens': cfg.llm_max_tokens})
        return r.text
    raise ValueError(p)

def extract_errors(raw):
    """Pull the errors list out of an LLM answer: plain JSON, fenced JSON, or JSON embedded in prose."""
    raw = (raw or '').strip()
    fence = re.search(r'```(?:json)?\s*(.*?)```', raw, re.S)
    texts = [raw] + ([fence.group(1)] if fence else [])
    dec = json.JSONDecoder()
    for t in texts:
        for k in [0] + [m.start() for m in re.finditer(r'[\[{]', t)]:
            try:
                obj, _ = dec.raw_decode(t[k:])
            except Exception:
                continue
            if isinstance(obj, list): return obj
            if isinstance(obj, dict):
                for key in ('errors', 'candidates', 'items', 'results'):
                    if isinstance(obj.get(key), list): return obj[key]
    return None

def _locate(text, err, sentence=None, used=()):
    err = norm(err or '').strip()
    if not err: return None
    if sentence:
        i = text.find(norm(sentence).strip()[:25])
        if i >= 0:
            j = text.find(err, i)
            if j >= 0 and (j, j + len(err)) not in used: return j, j + len(err)
    for m in re.finditer(re.escape(err), text):
        if (m.start(), m.end()) not in used: return m.start(), m.end()
    # tolerate spacing / zero-width differences
    squash = lambda x: re.sub(r'[\s\u200c\u200d]+', '', x)
    target = squash(err)
    if target:
        pos = [k for k, ch in enumerate(text) if not re.match(r'[\s\u200c\u200d]', ch)]
        flat = ''.join(text[k] for k in pos)
        f = flat.find(target)
        if f >= 0:
            a, b = pos[f], pos[f + len(target) - 1] + 1
            if (a, b) not in used: return a, b
    return None

def tool_llm_verifier(text, candidates: List[Candidate], cfg: Config = CFG, label=None) -> List[Candidate]:
    tax = '\n'.join(f'- {k}: {v[0]} ({v[1]})' for k, v in SUBTYPES.items())
    cands = [{'error_text': c.error_text, 'correction': c.correction, 'subtype': c.subtype} for c in candidates]
    raw = call_llm(VERIFY_PROMPT.format(tax=tax, cands=json.dumps(cands, ensure_ascii=False), text=text), cfg)
    LLM_RAW[(cfg.llm_provider, label or text[:30])] = raw
    errs = extract_errors(raw)
    if errs is None:
        raise RuntimeError(f'could not parse {cfg.llm_provider} answer (first 300 chars): {str(raw)[:300]!r}')
    preds, used, unlocated = [], set(), 0
    for e in errs:
        if not isinstance(e, dict): continue
        loc = _locate(text, e.get('error_text') or e.get('learner_form'), e.get('sentence'), used)
        if not loc:
            unlocated += 1
            continue
        used.add(loc)
        st = e.get('subtype') if e.get('subtype') in SUBTYPES else None
        preds.append(make_candidate(f'llm_{cfg.llm_provider}', text, loc[0], loc[1],
                                    e.get('correction') or e.get('suggested_correction'), st,
                                    f"{e.get('source', '')}: {e.get('explanation', '')}"))
    if unlocated: print(f'  ({cfg.llm_provider}: {unlocated} item(s) quoted text not found in the passage)')
    return preds

# ─────────────────────────────────────────────────────────────────────────────
# 13. Merging and review grouping
# ─────────────────────────────────────────────────────────────────────────────
SRC_PRIORITY = {'rules_generic': 3, 'lexical_neighbour': 2, 'tamilvu': 2, 'vaani': 1, 'confusable_mlm': 2}
SECOND_OPINION_ONLY = {'vaani', 'tamilvu'}     # alone → low priority until they prove themselves on unseen text

def exact_span_merge(preds: List[Candidate], text: str) -> List[Candidate]:
    groups = {}
    for p in preds: groups.setdefault((p.start, p.end), []).append(p)
    out = []
    for (s, e), items in sorted(groups.items()):
        def best(attr):
            vals = [getattr(x, attr) for x in items if getattr(x, attr)]
            if not vals: return None
            cnt = {v: sum(1 for x in items if getattr(x, attr) == v) for v in set(vals)}
            return max(vals, key=lambda v: (cnt[v], max(SRC_PRIORITY.get(x.source, 1) for x in items if getattr(x, attr) == v)))
        ev = []
        for x in items:
            ev.extend(x.evidence or [{'source': x.source, 'start': x.start, 'end': x.end, 'correction': x.correction,
                                      'subtype': x.subtype, 'note': x.note, 'score': x.score}])
        out.append(Candidate('+'.join(sorted({x.source for x in items})), s, e, text[s:e], best('correction'),
                             best('subtype'), 'multiple detectors' if len(items) > 1 else items[0].note,
                             max([x.score for x in items if x.score is not None], default=None), ev))
    return out

def group_overlaps(cands: List[Candidate], text: str) -> List[Candidate]:
    """One review item per cluster of overlapping flags. The representative span/correction comes from
    the most-supported member (then source priority, then the shorter span); all evidence is kept."""
    cands = sorted(cands, key=lambda c: (c.start, c.end))
    clusters, cur, cur_end = [], [], -1
    for c in cands:
        if cur and c.start < cur_end:
            cur.append(c); cur_end = max(cur_end, c.end)
        else:
            if cur: clusters.append(cur)
            cur, cur_end = [c], c.end
    if cur: clusters.append(cur)
    out = []
    for cl in clusters:
        if len(cl) == 1: out.append(cl[0]); continue
        rep = max(cl, key=lambda c: (len(set(c.source.split('+'))), max(SRC_PRIORITY.get(s, 1) for s in c.source.split('+')),
                                     c.correction is not None, -(c.end - c.start)))
        srcs = sorted({s for c in cl for s in c.source.split('+')})
        ev = [e for c in cl for e in c.evidence]
        out.append(Candidate('+'.join(srcs), rep.start, rep.end, rep.error_text, rep.correction, rep.subtype,
                             f'{len(cl)} overlapping flags', rep.score, ev))
    return out

def merge_sources(text, *lists):
    return group_overlaps(exact_span_merge([p for L in lists for p in L], text), text)

def decision_strength(c: Candidate) -> str:
    sources = set(c.source.split('+'))
    corr_set = {e.get('correction') for e in c.evidence if e.get('correction')}
    sub_set = {e.get('subtype') for e in c.evidence if e.get('subtype')}
    if len(corr_set) > 1 or len(sub_set) > 1: return 'needs_review'
    if len(sources) >= 2: return 'high'
    if 'rules_generic' in sources and c.subtype in {'PUNCT', 'EXTRA', 'NUMBER', 'OTTRU', 'TENSE', 'PGN', 'SV_AGR', 'CASE',
                                                    'ORDER', 'SPACE', 'PULLI', 'PUNAR', 'CONSTR'}:
        return 'high'
    if sources <= SECOND_OPINION_ONLY:
        return 'low'
    if sources & {'confusable_mlm', 'lexical_neighbour', 'rules_generic'} or any(s.startswith('llm_') for s in sources):
        return 'medium'
    return 'low'

# ─────────────────────────────────────────────────────────────────────────────
# 14. Runner
# ─────────────────────────────────────────────────────────────────────────────
def run_pipeline(text: str, cfg: Config = CFG, verbose=True, extra_sources: Dict[str, List[Candidate]] = None,
                 lexicon: LexiconGate = None):
    text = norm(text)
    lex = lexicon or LexiconGate(cfg)
    load_names_file(cfg.names_path)
    results, runtimes = {}, {}
    def run(name, fn):
        t0 = time.time()
        try:
            results[name] = fn()
            if verbose: print(f'✓ {name}: {len(results[name])} flags ({time.time() - t0:.1f}s)')
        except Exception as e:
            results[name] = []
            if verbose: print(f'✗ {name}: {type(e).__name__}: {str(e)[:250]}')
        runtimes[name] = time.time() - t0
    if verbose:
        print(f"  lexicon: hunspell={'on' if lex.hunspell_ok else 'off'} · morph={'on' if lex.morph and lex.morph.ok else 'off'} · wordfreq={'on' if lex._zipf_fn else 'off'}")
    if cfg.run_rules: run('rules_generic', lambda: rules_generic(text, lex))
    if cfg.run_neighbour: run('lexical_neighbour', lambda: tool_neighbour(text, lex))
    if cfg.run_vaani: run('vaani', lambda: tool_vaani(text, cfg))
    if cfg.run_tamilvu: run('tamilvu', lambda: tool_tamilvu(text, lex))
    if cfg.run_mlm: run('confusable_mlm', lambda: tool_mlm(text, lex, cfg))
    for k, v in (extra_sources or {}).items(): results[k] = v
    if cfg.run_llm_verifier:
        cand = merge_sources(text, *results.values())
        run(f'llm_{cfg.llm_provider}', lambda: tool_llm_verifier(text, cand, cfg, label='pipeline'))
    merged = merge_sources(text, *[v for k, v in results.items() if not k.startswith('llm_')])
    return {'text': text, 'candidates': to_rows(merged), 'per_tool': results, 'runtimes': runtimes, 'lexicon': lex}

# ─────────────────────────────────────────────────────────────────────────────
# 14b. Tiered gating: who may interrupt the reviewer
# ─────────────────────────────────────────────────────────────────────────────
TIER1 = {'rules_generic'}                       # trusted: shown directly
FAMILY = {'rules_generic': 'rules', 'lexical_neighbour': 'lexicon', 'confusable_mlm': 'mlm',
          'vaani': 'neechalkaran', 'tamilvu': 'neechalkaran'}   # Vaani and TamilVU share a lineage → one vote

def families(detected_by):
    return {FAMILY.get(s, 'llm' if s.startswith('llm') else s) for s in detected_by.split('+')}

def gate(run, verdicts=None, tier1=TIER1):
    """Tier 1 flags pass. Other flags pass only with a second independent family, or an LLM 'yes'.
    Returns (shown, suppressed); each row gets gate_reason."""
    shown, suppressed = [], []
    for c in run['candidates']:
        srcs = set(c['detected_by'].split('+'))
        v = (verdicts or {}).get(c['candidate_id'])
        if srcs & tier1: reason = 'tier1'
        elif len(families(c['detected_by']) - {'llm'}) >= 2: reason = 'agreement'
        elif v and v.get('is_error'): reason = 'llm_confirmed'
        else: reason = None
        row = {**c, 'gate_reason': reason or ('llm_rejected' if v else 'unconfirmed')}
        if v and v.get('is_error') and reason == 'llm_confirmed':
            if v.get('correction'): row['suggested_correction'] = v['correction']
            if v.get('subtype') in SUBTYPES:
                row['subtype'] = v['subtype']; row['tamil_error_type'] = TA_OF[v['subtype']]; row['group'] = TOP_OF[v['subtype']]
        (shown if reason else suppressed).append(row)
    return shown, suppressed

VERIFY_CANDIDATES_PROMPT = """You are checking automatic flags on a Tamil school learner's writing (standard written Tamil).
For EACH candidate below, decide only one thing: is the learner's form actually an error in THIS sentence?
- Names of people and places are not errors. Valid spelling variants, emphatic -ஏ/-ஓ, and acceptable word choices are not errors.
- Do not improve style. Do not look for other errors.
- If it is an error, give the corrected form and one subtype code from the taxonomy.

Taxonomy:
{tax}

Candidates (JSON): {cands}

Return ONLY JSON: {{"verdicts": [{{"id": <id>, "is_error": true|false, "correction": "<corrected learner form or empty>",
"subtype": "<code or empty>", "reason": "<very short>"}}]}}"""

def llm_verify_candidates(run, cfg: Config = CFG, only_unconfirmed=True, label=None):
    """Ask the LLM about the candidates that the gate would otherwise suppress. Returns {candidate_id: verdict}."""
    text = run['text']
    sents = sentences(text)
    def sentence_of(pos):
        return next((t for t, a, b in sents if a <= pos < b), text[max(0, pos - 60):pos + 60])
    rows = run['candidates']
    if only_unconfirmed:
        rows = [c for c in rows if not (set(c['detected_by'].split('+')) & TIER1)
                and len(families(c['detected_by']) - {'llm'}) < 2]
    if not rows: return {}
    tax = '\n'.join(f'- {k}: {v[0]} ({v[1]})' for k, v in SUBTYPES.items())
    cands = [{'id': c['candidate_id'], 'sentence': sentence_of(c['start']), 'learner_form': c['error_text'],
              'proposed': c['suggested_correction'], 'proposed_subtype': c['subtype']} for c in rows]
    raw = call_llm(VERIFY_CANDIDATES_PROMPT.format(tax=tax, cands=json.dumps(cands, ensure_ascii=False)), cfg)
    LLM_RAW[(cfg.llm_provider, 'verify:' + (label or text[:30]))] = raw
    items = extract_errors(raw.replace('"verdicts"', '"errors"') if raw else raw)
    if items is None: raise RuntimeError(f'could not parse {cfg.llm_provider} verdicts: {str(raw)[:300]!r}')
    out = {}
    for v in items:
        if not isinstance(v, dict): continue
        try: cid = int(v.get('id'))
        except Exception: continue
        ie = v.get('is_error')
        out[cid] = {'is_error': ie is True or str(ie).lower() == 'true', 'correction': v.get('correction') or '',
                    'subtype': (v.get('subtype') or '').upper(), 'reason': v.get('reason', '')}
    return out

def to_rows(merged: List[Candidate]):
    return [{'candidate_id': i, 'start': c.start, 'end': c.end, 'error_text': c.error_text,
             'suggested_correction': c.correction, 'group': c.group, 'subtype': c.subtype,
             'tamil_error_type': c.tamil_type, 'detected_by': c.source, 'review_priority': decision_strength(c),
             'auto_correct': False, 'annotator_decision': None, 'error_origin': None, 'note': c.note,
             'evidence': c.evidence} for i, c in enumerate(merged, 1)]

def review_views(run):
    allc = run['candidates']
    return {
        'all_review': allc,
        'high_or_medium': [c for c in allc if c['review_priority'] in ('high', 'medium', 'needs_review')],   # hides single-source Vaani/TamilVU
        'high_priority_only': [c for c in allc if c['review_priority'] == 'high'],
        'consensus_2plus': [c for c in allc if len(set(c['detected_by'].split('+'))) >= 2],
    }

def export_results(run, stem='tamil_error_pipeline_v3_1'):
    import pandas as pd
    clean = {'text': run['text'], 'candidates': run['candidates'], 'runtimes': run['runtimes']}
    json.dump(clean, open(stem + '.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    flat = [{**{k: v for k, v in c.items() if k != 'evidence'}, 'evidence_json': json.dumps(c['evidence'], ensure_ascii=False)}
            for c in run['candidates']]
    df = pd.DataFrame(flat)
    df.to_csv(stem + '.csv', index=False, encoding='utf-8-sig')
    with pd.ExcelWriter(stem + '.xlsx', engine='openpyxl') as xw:
        df.to_excel(xw, index=False, sheet_name='Candidates')
        pd.DataFrame([{'tool': k, 'seconds': v} for k, v in run['runtimes'].items()]).to_excel(xw, index=False, sheet_name='Runtime')
    return stem + '.json', stem + '.csv', stem + '.xlsx'

def clean_text_flag_rate(text, run):
    n = max(1, len(tokens(text)))
    return {'words': n, 'flags': len(run['candidates']), 'flags_per_100_words': round(100 * len(run['candidates']) / n, 2)}

# ─────────────────────────────────────────────────────────────────────────────
# 15. Benchmark helpers
# ─────────────────────────────────────────────────────────────────────────────
LABEL_KEYWORDS = [
    ('குறில்', 'KURIL'), ('நெடில்', 'KURIL'), ('ஒற்று', 'OTTRU'), ('ல / ள / ழ', 'LLZH'), ('ல/ள/ழ', 'LLZH'),
    ('ர / ற', 'RR'), ('ர/ற', 'RR'), ('ந / ன / ண', 'NNN'), ('ந/ன/ண', 'NNN'), ('புள்ளி', 'PULLI'), ('உயிர்', 'UYIR'),
    ('புணர்ச்சி', 'PUNAR'), ('சந்தி', 'PUNAR'), ('சொல் தேர்வு', 'WCHOICE'), ('மிகை', 'EXTRA'), ('தேவையற்ற', 'EXTRA'),
    ('சொல் வடிவ', 'WFORM'), ('காலப்', 'TENSE'), ('நபர்', 'PGN'), ('பால்', 'PGN'), ('திணை', 'PGN'),
    ('எண் இயைபு', 'SV_AGR'), ('ஒருமை', 'NUMBER'), ('எழுவாய்', 'SV_AGR'), ('வரிசை', 'ORDER'), ('வேற்றுமை', 'CASE'),
    ('விடுபட்ட', 'MISSING'), ('விடுபாடு', 'MISSING'), ('தொடரமைப்பு', 'CONSTR'), ('நிறுத்தற்குறி', 'PUNCT'),
    ('இடைவெளி', 'SPACE'), ('எழுத்துப்', 'EZ_GEN'), ('இலக்கண', 'GRAM_GEN')]
COMPATIBLE = [{'SV_AGR', 'PGN', 'NUMBER'}, {'OTTRU', 'PUNAR'}, {'UYIR', 'KURIL', 'EZ_GEN'},
              {'LLZH', 'RR', 'NNN', 'EZ_GEN'}, {'CONSTR', 'EXTRA', 'GRAM_GEN'}, {'WFORM', 'NUMBER'}]

def label_to_codes(label):
    if label in SUBTYPES: return [label]
    hits = sorted((label.find(kw), code) for kw, code in LABEL_KEYWORDS if label.find(kw) >= 0)
    out = []
    for _, c in hits:
        if c not in out: out.append(c)
    if len(out) > 1 and 'EZ_GEN' in out: out.remove('EZ_GEN')
    return out or ['GRAM_GEN']

@dataclass
class Gold:
    id: int; start: int; end: int; text: str; correction: str; label: str; subtype: str; top: str
    alt_subtypes: list = field(default_factory=list)

KEY_LINE = re.compile(r'^\s*(\d+)\s*[.)]\s*(.+?)\s*(?:→|->|⟶|=>)\s*(.+?)\s+(?:—|–|-|:)\s+(.+?)\s*$')
PARSE_REPORT = {}

def parse_gold(annotated, key_text):
    annotated = norm(annotated).strip('\n')
    clean, pos, i = [], {}, 0
    for m in re.finditer(r'\[(\d+)\]\s?', annotated):
        clean.append(annotated[i:m.start()]); pos[int(m.group(1))] = sum(map(len, clean)); i = m.end()
    clean.append(annotated[i:])
    text = ''.join(clean)
    gold, skipped = [], []
    for line in norm(key_text).splitlines():
        m = KEY_LINE.match(line)
        if not m:
            if re.match(r'^\s*\d+\s*[.)]', line): skipped.append(('unreadable line', line.strip()))
            continue
        gid, err, corr, label = int(m.group(1)), m.group(2), m.group(3), m.group(4)
        p = pos.get(gid)
        truncated = err.endswith('…') or err.endswith('...')
        core = err.rstrip('…').rstrip('.').strip() if truncated else err
        if p is None or text[p:p + len(core)] != core:
            ms = [mm.start() for mm in re.finditer(re.escape(core), text)]
            if not ms:
                # tolerate spacing differences between key and passage
                sq = re.sub(r'\s+', r'\\s*', re.escape(core).replace('\\ ', ' '))
                mm = re.search(sq, text[max(0, (p or 0) - 5):]) if p is not None else re.search(sq, text)
                if mm:
                    base = max(0, (p or 0) - 5) if p is not None else 0
                    p, core = base + mm.start(), mm.group(0)
                    ms = [p]
            if not ms:
                skipped.append((f'#{gid} not found in passage', err)); continue
            p = min(ms, key=lambda c: abs(c - (p or 0)))
        end = p + len(core)
        if truncated:
            mm = re.compile(r'[.!?]').search(text, end); end = mm.end() if mm else len(text)
        codes = label_to_codes(label)
        alts = set(codes[1:])
        for g in COMPATIBLE:
            if codes[0] in g: alts |= g
        alts.discard(codes[0])
        gold.append(Gold(gid, p, end, text[p:end], corr, label, codes[0], TOP_OF[codes[0]], sorted(alts)))
    ids = [int(x) for x in re.findall(r'\[(\d+)\]', annotated)]
    missing = sorted(set(ids) - {g.id for g in gold})
    PARSE_REPORT.update({'markers': len(ids), 'parsed': len(gold), 'missing_ids': missing, 'skipped': skipped})
    if missing or skipped:
        print(f'⚠ answer key: {len(gold)} of {len(ids)} errors parsed. Missing: {missing}')
        for why, line in skipped: print('   ', why, '→', line)
    return text, gold

def load_annotated_docx(path):
    import docx
    d = docx.Document(path)
    cells = d.tables[0].rows[0].cells
    return cells[0].text, cells[1].text

def overlap(a0, a1, b0, b1): return max(0, min(a1, b1) - max(a0, b0))

def _norm_fix(s):
    return re.sub(r'\s+([,.!?])', r'\1', re.sub(r'\s+', ' ', s).strip())

def _correction_match(text, p, g):
    if not p.get('suggested_correction'): return False
    rs, re_ = min(p['start'], g.start), max(p['end'], g.end)
    mine = _norm_fix(text[rs:p['start']] + p['suggested_correction'] + text[p['end']:re_])
    gold = _norm_fix(text[rs:g.start] + g.correction + text[g.end:re_])
    return mine == gold

def benchmark(run, gold: List[Gold], candidates=None, secondary_spans=()):
    import pandas as pd
    preds = run['candidates'] if candidates is None else candidates
    pairs = []
    for pi, p in enumerate(preds):
        for gi, g in enumerate(gold):
            ov = overlap(p['start'], p['end'], g.start, g.end)
            if ov > 0:
                pairs.append((ov / min(p['end'] - p['start'], g.end - g.start),
                              ov / (max(p['end'], g.end) - min(p['start'], g.start)), pi, gi))
    pairs.sort(reverse=True)
    usedp, usedg, matches = set(), set(), {}
    for _, _, pi, gi in pairs:
        if pi in usedp or gi in usedg: continue
        usedp.add(pi); usedg.add(gi); matches[gi] = pi
    rows = []
    for gi, g in enumerate(gold):
        p = preds[matches[gi]] if gi in matches else None
        rows.append({'id': g.id, 'gold_error': g.text, 'gold_type': g.subtype, 'gold_group': g.top,
                     'detected': p is not None,
                     'correction_ok': bool(p) and _correction_match(run['text'], p, g),
                     'subtype_ok': bool(p) and (p.get('subtype') == g.subtype or p.get('subtype') in g.alt_subtypes),
                     'group_ok': bool(p) and p.get('group') == g.top,
                     'predicted': (p.get('error_text'), p.get('suggested_correction'), p.get('subtype')) if p else None,
                     'detected_by': p.get('detected_by') if p else None,
                     'review_priority': p.get('review_priority') if p else None})
    df = pd.DataFrame(rows)
    unmatched = [p for i, p in enumerate(preds) if i not in usedp]
    unkeyed = [p for p in unmatched if any(overlap(p['start'], p['end'], s0, s1) > 0 for s0, s1 in secondary_spans)]
    n = len(preds)
    tp = int(df.detected.sum())
    P = tp / n if n else 0.0
    PL = (tp + len(unkeyed)) / n if n else 0.0
    R = tp / len(gold) if gold else 0.0
    f05 = lambda p, r: 1.25 * p * r / (0.25 * p + r) if p + r else 0.0
    summary = {'gold_errors': len(gold), 'flags': n, 'detected': tp, 'recall': R, 'precision': P,
               'precision_lenient': PL, 'F0.5_lenient': f05(PL, R),
               'correction_exact': float(df.correction_ok.mean()), 'subtype_end_to_end': float(df.subtype_ok.mean()),
               'group_end_to_end': float(df.group_ok.mean()), 'false_flags': n - tp - len(unkeyed),
               'unkeyed_real_errors': len(unkeyed)}
    return summary, df, [p for p in unmatched if p not in unkeyed]

def benchmark_views(run, gold, secondary_spans=()):
    import pandas as pd
    rows, detail = [], {}
    for name, cands in review_views(run).items():
        s, df, ff = benchmark(run, gold, cands, secondary_spans)
        rows.append({'view': name, **s}); detail[name] = (df, ff)
    return pd.DataFrame(rows), detail

def group_recall(df):
    return (df.groupby('gold_group').agg(errors=('id', 'count'), detected=('detected', 'sum'),
                                         corrected=('correction_ok', 'sum'), labelled=('subtype_ok', 'sum'))
              .assign(recall=lambda x: x.detected / x.errors).reset_index())

def as_rows_from_tool(text, cands: List[Candidate]):
    """Score a single tool's raw output with the same benchmark()."""
    return to_rows(group_overlaps(cands, text))
