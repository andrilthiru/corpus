/* =========================================================
   THEMOZHI — Tamil error taxonomy (single source of truth)
   Used by automatic suggestions AND the manual dropdowns so
   the two can never diverge. Codes match the Python pipeline
   (tamil_error_pipeline_v3.py).
   ========================================================= */

const TAMIL_GROUPS = [
  { id: "EZHUTHU", ta: "எழுத்தியல்", en: "Orthography" },
  { id: "SOL", ta: "சொல்லியல்", en: "Morphology / word" },
  { id: "ILAKKANAM", ta: "இலக்கணம்", en: "Grammar" },
  { id: "NADAI", ta: "வாக்கிய/எழுத்து நடை", en: "Sentence / mechanics" }
];

const TAMIL_SUBTYPES = {
  EZ_GEN:   { ta: "எழுத்துப் பிழை", en: "Spelling (general)", group: "EZHUTHU" },
  OTTRU:    { ta: "ஒற்றுப் பிழை", en: "Consonant doubling (ஒற்று)", group: "EZHUTHU" },
  KURIL:    { ta: "குறில்–நெடில் பிழை", en: "Short/long vowel", group: "EZHUTHU" },
  LLZH:     { ta: "ல/ள/ழ பிழை", en: "ல/ள/ழ confusion", group: "EZHUTHU" },
  RR:       { ta: "ர/ற பிழை", en: "ர/ற confusion", group: "EZHUTHU" },
  NNN:      { ta: "ந/ன/ண பிழை", en: "ந/ன/ண confusion", group: "EZHUTHU" },
  UYIR:     { ta: "உயிர்க்குறிப் பிழை", en: "Vowel sign", group: "EZHUTHU" },
  PULLI:    { ta: "புள்ளிப் பிழை", en: "Pulli", group: "EZHUTHU" },
  PUNAR:    { ta: "புணர்ச்சிப் பிழை", en: "Sandhi / joining", group: "SOL" },
  WFORM:    { ta: "சொல் வடிவப் பிழை", en: "Word form", group: "SOL" },
  CASE:     { ta: "வேற்றுமை உருபுப் பிழை", en: "Case marker", group: "SOL" },
  WCHOICE:  { ta: "சொல் தேர்வுப் பிழை", en: "Word choice", group: "SOL" },
  TENSE:    { ta: "காலப் பிழை", en: "Tense", group: "ILAKKANAM" },
  NUMBER:   { ta: "ஒருமை–பன்மைப் பிழை", en: "Singular/plural", group: "ILAKKANAM" },
  SV_AGR:   { ta: "எழுவாய்–பயனிலை இயைபுப் பிழை", en: "Subject–verb agreement", group: "ILAKKANAM" },
  PGN:      { ta: "பால்/திணை/எண்/நபர் இயைபுப் பிழை", en: "Gender/class/number/person agreement", group: "ILAKKANAM" },
  CONSTR:   { ta: "தொடரமைப்புப் பிழை", en: "Sentence construction", group: "ILAKKANAM" },
  GRAM_GEN: { ta: "இலக்கணப் பிழை", en: "Grammar (general)", group: "ILAKKANAM" },
  MISSING:  { ta: "சொல் விடுபட்ட பிழை", en: "Missing word", group: "NADAI" },
  EXTRA:    { ta: "மிகைச் சொல் பிழை", en: "Extra word", group: "NADAI" },
  ORDER:    { ta: "சொல் வரிசைப் பிழை", en: "Word order", group: "NADAI" },
  PUNCT:    { ta: "நிறுத்தற்குறிப் பிழை", en: "Punctuation", group: "NADAI" },
  SPACE:    { ta: "இடைவெளிப் பிழை", en: "Spacing", group: "NADAI" }
};

/* Language FEATURES — not errors. Tagged for analysis (e.g. proverb use by level). */
const FEATURE_TYPES = {
  PROVERB:    { ta: "பழமொழி", en: "Proverb" },
  IDIOM:      { ta: "மரபுத்தொடர்", en: "Idiom" },
  QUOTATION:  { ta: "மேற்கோள் (திருக்குறள் முதலியன)", en: "Quotation (Thirukkural etc.)" },
  FIGURATIVE: { ta: "உவமை / உருவகம்", en: "Simile / metaphor" },
  CONNECTIVE: { ta: "இணைப்புச் சொல்", en: "Discourse connective" },
  CODE_MIX:   { ta: "பிறமொழிக் கலப்பு", en: "Code-mixing (English etc.)" },
  COLLOQUIAL: { ta: "பேச்சு வழக்கு", en: "Colloquial form" }
};

/* Legacy backend categories → default Tamil subtype (refined from the correction when possible). */
const LEGACY_TO_SUBTYPE = {
  SPELLING: "EZ_GEN", GRAMMAR: "GRAM_GEN", PUNCTUATION: "PUNCT", WORD_CHOICE: "WCHOICE",
  WORD_FORM: "WFORM", MISSING_WORD: "MISSING", EXTRA_WORD: "EXTRA", OTHER: "GRAM_GEN"
};
const SUBTYPE_TO_LEGACY = {
  EZ_GEN: "SPELLING", OTTRU: "SPELLING", KURIL: "SPELLING", LLZH: "SPELLING", RR: "SPELLING", NNN: "SPELLING",
  UYIR: "SPELLING", PULLI: "SPELLING", PUNAR: "SPELLING", WFORM: "WORD_FORM", CASE: "GRAMMAR",
  WCHOICE: "WORD_CHOICE", TENSE: "GRAMMAR", NUMBER: "GRAMMAR", SV_AGR: "GRAMMAR", PGN: "GRAMMAR",
  CONSTR: "GRAMMAR", GRAM_GEN: "GRAMMAR", MISSING: "MISSING_WORD", EXTRA: "EXTRA_WORD", ORDER: "GRAMMAR",
  PUNCT: "PUNCTUATION", SPACE: "SPELLING"
};

function subtypeGroup(code) {
  return TAMIL_SUBTYPES[code]?.group || null;
}
function groupInfo(groupId) {
  return TAMIL_GROUPS.find((g) => g.id === groupId) || null;
}
function subtypeLabel(code) {
  const s = TAMIL_SUBTYPES[code];
  return s ? `${s.ta}` : "வகைப்படுத்தப்படவில்லை";
}

/* <select> options grouped by the four top-level groups (+ features when asked). */
function taxonomyOptionsHtml(selected = "", { includeFeatures = false } = {}) {
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let html = TAMIL_GROUPS.map((g) => `
    <optgroup label="${esc(g.ta)} · ${esc(g.en)}">
      ${Object.entries(TAMIL_SUBTYPES).filter(([, s]) => s.group === g.id).map(([code, s]) =>
        `<option value="${code}" ${code === selected ? "selected" : ""}>${esc(s.ta)} — ${esc(s.en)}</option>`).join("")}
    </optgroup>`).join("");
  if (includeFeatures) {
    html += `<optgroup label="மொழிக் கூறுகள் · Language features (not errors)">
      ${Object.entries(FEATURE_TYPES).map(([code, f]) =>
        `<option value="FEAT:${code}" ${("FEAT:" + code) === selected ? "selected" : ""}>${esc(f.ta)} — ${esc(f.en)}</option>`).join("")}
    </optgroup>`;
  }
  return html;
}

/* ---------- Tamil letters + automatic subtype from (wrong → corrected) ----------
   Port of classify_correction() in the Python pipeline. */
const TA_CONS = new Set("கஙசஞடணதநபமயரலவழளறனஜஷஸஹ");
const TA_PULLI = "்";
const TA_VALLINAM = new Set("கசடதபற");
const TA_SHORT_LONG = { "": "ா", "ா": "", "ி": "ீ", "ீ": "ி", "ு": "ூ", "ூ": "ு", "ெ": "ே", "ே": "ெ", "ொ": "ோ", "ோ": "ொ" };
const TA_VOWEL_SL = { "அ": "ஆ", "ஆ": "அ", "இ": "ஈ", "ஈ": "இ", "உ": "ஊ", "ஊ": "உ", "எ": "ஏ", "ஏ": "எ", "ஒ": "ஓ", "ஓ": "ஒ" };
const TA_CONF_GROUPS = [["லளழ", "LLZH"], ["ரற", "RR"], ["நனண", "NNN"]];
const TA_CONNECTIVES = new Set(["ஆனால்", "ஆனாலும்", "மற்றும்", "எனவே", "ஆகவே", "அதனால்", "இருந்தாலும்", "ஏனெனில்", "அல்லது"]);

function taLetters(word = "") {
  return String(word).match(/\p{L}\p{M}*|./gu) || [];
}
function taSplitLetter(L) {
  return L && TA_CONS.has(L[0]) ? [L[0], L.slice(1)] : [L, null];
}
function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
/* Minimal sequence diff (LCS) returning opcodes like Python's difflib. */
function diffOpcodes(a, b, eq = (x, y) => x === y) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  const push = (tag, i1, i2, j1, j2) => {
    const last = ops[ops.length - 1];
    if (last && last[0] === tag && last[2] === i1 && last[4] === j1) { last[2] = i2; last[4] = j2; }
    else ops.push([tag, i1, i2, j1, j2]);
  };
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { push("equal", i, i + 1, j, j + 1); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("delete", i, i + 1, j, j); i++; }
    else { push("insert", i, i, j, j + 1); j++; }
  }
  if (i < n) push("delete", i, n, j, j);
  if (j < m) push("insert", i, i, j, m);
  // merge adjacent delete+insert into replace
  const out = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (prev && prev[0] !== "equal" && op[0] !== "equal" && prev[2] === op[1] && prev[4] === op[3]) {
      out[out.length - 1] = ["replace", prev[1], op[2], prev[3], op[4]];
    } else out.push([...op]);
  }
  return out;
}

function classifyTamilCorrection(orig = "", corr = "") {
  if (!corr || orig === corr) return null;
  const o = String(orig).trim(), c = String(corr).trim();
  const stripTa = (s) => s.replace(/[஀-௿\s]/g, "");
  const word = (s) => s.replace(/[^\p{L}\p{M}\p{N}]/gu, "");
  if (word(o) === word(c) && stripTa(o) !== stripTa(c)) return "PUNCT";
  if (o.replace(/ /g, "") === c.replace(/ /g, "")) return "SPACE";
  const ow = o.split(/\s+/), cw = c.split(/\s+/);
  if (ow.length === cw.length + 1 && ow.some((w, i) => i < ow.length - 1 && w === ow[i + 1])) return "EXTRA";
  const stripOttru = (ws) => ws.map((x) => word(x).replace(/[கசதப]்$/, "")).sort().join("|");
  if (ow.length > 1 && stripOttru(ow) === stripOttru(cw) && ow.join(" ") !== cw.join(" ")) return "ORDER";
  if (ow.length === cw.length + 1) {
    const ops = diffOpcodes(ow, cw);
    const del = ops.filter((op) => op[0] === "delete");
    if (del.length === 1 && del[0][2] - del[0][1] === 1 && ops.every((op) => op[0] === "equal" || op[0] === "delete"))
      return TA_CONNECTIVES.has(ow[del[0][1]]) ? "CONSTR" : "EXTRA";
  }
  if (ow.length > 1 && cw.length === 1) return "PUNAR";
  if (cw.length > ow.length) return "MISSING";
  if (ow.length === cw.length && ow.length > 1) {
    const d = ow.map((w, i) => [w, cw[i]]).filter(([a, b]) => a !== b);
    return d.length === 1 ? classifyTamilCorrection(d[0][0], d[0][1]) : "GRAM_GEN";
  }
  const pres = /(கிற|கின்ற)/;
  if (pres.test(o) !== pres.test(c)) return "TENSE";
  const pgn = /(ான்|ாள்|ார்|ார்கள்|ேன்|ோம்|ாய்|ீர்கள்|னர்)$/;
  const mo = o.match(pgn), mc = c.match(pgn);
  if (mo && mc && mo[1] !== mc[1] && o.slice(0, mo.index) === c.slice(0, mc.index)) return "PGN";
  const lo = taLetters(o), lc = taLetters(c);
  if (lc.slice(0, lo.length).join("") === lo.join("") && lc.slice(lo.length).join("") === "கள்") return "NUMBER";
  if (o.endsWith("ம்") && c.endsWith("ங்கள்") && o.slice(0, -2) === c.slice(0, -5)) return "NUMBER";
  if (lo.length === lc.length) {
    const d = lo.map((l, i) => [l, lc[i]]).filter(([a, b]) => a !== b);
    if (d.length === 1) {
      const [bo, so] = taSplitLetter(d[0][0]), [bc, sc] = taSplitLetter(d[0][1]);
      if (so === null || sc === null) return TA_VOWEL_SL[bo] === bc ? "KURIL" : "EZ_GEN";
      if (bo === bc) {
        if (so === TA_PULLI || sc === TA_PULLI) return "PULLI";
        if (TA_SHORT_LONG[so] === sc) return "KURIL";
        return "UYIR";
      }
      if (so === sc) {
        for (const [grp, code] of TA_CONF_GROUPS) if (grp.includes(bo) && grp.includes(bc)) return code;
        return "EZ_GEN";
      }
    }
  }
  const ops = diffOpcodes(lo, lc).filter((op) => op[0] !== "equal");
  if (ops.length === 1) {
    const [tag, i1, i2, j1, j2] = ops[0];
    const ins = tag === "insert" ? lc.slice(j1, j2) : tag === "delete" ? lo.slice(i1, i2) : null;
    if (ins && ins.length === 1 && ins[0].endsWith(TA_PULLI)) return TA_VALLINAM.has(ins[0][0]) ? "OTTRU" : "EZ_GEN";
  }
  const cp = commonPrefixLen(o, c);
  if (cp >= 2) {
    const eo = o.slice(cp), ec = c.slice(cp);
    if (eo.endsWith("து") && ec.endsWith("ன")) return "SV_AGR";
    if (/(க்கு|க்குத்|க்குச்|க்குப்|இல்|ில்)$/.test(c) && !/(க்கு|இல்|ில்)$/.test(o)) return "CASE";
    return "WFORM";
  }
  const la = taLetters(o), lb = taLetters(c);
  const same = diffOpcodes(la, lb).filter((op) => op[0] === "equal").reduce((n, op) => n + (op[2] - op[1]), 0);
  return (2 * same) / Math.max(1, la.length + lb.length) >= 0.6 ? "EZ_GEN" : "WCHOICE";
}

/* Best Tamil subtype for a detector candidate: exact subtype if supplied, else refine the legacy
   category from the correction (spelling-family and form-family only), else legacy mapping. */
function inferSubtype(candidate) {
  if (candidate?.subtype && TAMIL_SUBTYPES[candidate.subtype]) return candidate.subtype;
  const legacy = String(candidate?.category || "OTHER").toUpperCase();
  const fromDiff = classifyTamilCorrection(candidate?.learner_form || "", candidate?.suggested_correction || "");
  const base = LEGACY_TO_SUBTYPE[legacy] || "GRAM_GEN";
  if (!fromDiff) return base;
  // trust the diff when it is compatible with (or more specific than) the detector's family
  const family = { SPELLING: "EZHUTHU", WORD_FORM: "SOL", GRAMMAR: "ILAKKANAM", PUNCTUATION: "NADAI",
                   EXTRA_WORD: "NADAI", MISSING_WORD: "NADAI", WORD_CHOICE: "SOL" }[legacy];
  if (legacy === "WORD_CHOICE" && subtypeGroup(fromDiff) === "EZHUTHU") return fromDiff; // lexical specialist beats a context guess
  if (legacy === "SPELLING" || legacy === "OTHER" || subtypeGroup(fromDiff) === family) return fromDiff;
  if (["GRAMMAR", "WORD_FORM"].includes(legacy) && ["PGN", "SV_AGR", "TENSE", "NUMBER", "CASE", "ORDER", "CONSTR"].includes(fromDiff)) return fromDiff;
  return base;
}

/* ---------- Seed proverb list for automatic FEATURE suggestions ----------
   A starter list only — replace/extend with a vetted list (e.g. from your teachers or a
   published பழமொழி collection). Matching ignores spacing, punctuation and word-final ஒற்று. */
const PROVERB_SEED = [
  { text: "சிறு துளி பெரு வெள்ளம்", type: "PROVERB" },
  { text: "கற்றது கைமண் அளவு கல்லாதது உலகளவு", type: "PROVERB" },
  { text: "ஆழம் தெரியாமல் காலை விடாதே", type: "PROVERB" },
  { text: "அகத்தின் அழகு முகத்தில் தெரியும்", type: "PROVERB" },
  { text: "தாயைப் போல பிள்ளை நூலைப் போல சேலை", type: "PROVERB" },
  { text: "காலம் பொன் போன்றது", type: "PROVERB" },
  { text: "ஒற்றுமையே பலம்", type: "PROVERB" },
  { text: "முயற்சி திருவினையாக்கும்", type: "QUOTATION" },
  { text: "யாதும் ஊரே யாவரும் கேளிர்", type: "QUOTATION" },
  { text: "அன்னையும் பிதாவும் முன்னறி தெய்வம்", type: "QUOTATION" }
];
