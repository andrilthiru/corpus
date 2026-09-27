/* =========================================================
   THEMOZHI — Corpus intelligence (v0.18)
   Insights → Intelligence. Three layers:
     1. Findings the system discovers (key findings · development · errors that travel together)
     2. Diagnosis (learner progress · schools · writing quality · prompts)
     3. Action (teaching priorities · Ask the corpus)
   Built for thousands of scripts: every rate is per 100 words with a 95% interval, every
   comparison is a rate ratio with a 95% interval, and a finding is only reported when the
   interval clears a threshold and the support is large enough.
   A clearly labelled SIMULATED data set shows how the analyses behave at scale.
   Depends on taxonomy.js, corpus-stats.js and app.js globals.
   ========================================================= */

const INTEL = { source: null, view: "findings", learner: "", cache: null, cacheKey: "" };
const SUBTYPE_CODES = Object.keys(TAMIL_SUBTYPES);
const MIN_SCRIPTS = 8;           // below this, a group is not compared
const MIN_EVENTS = 8;            // errors needed before a rate ratio is trusted

/* ---------- statistics ---------- */
function z95() { return 1.96; }
function rateCI(n, w) {           // Poisson 95% interval (Byar), per 100 words
  if (!w) return [0, 0];
  const lo = n === 0 ? 0 : n * Math.pow(1 - 1 / (9 * n) - z95() / (3 * Math.sqrt(n)), 3);
  const n1 = n + 1;
  const hi = n1 * Math.pow(1 - 1 / (9 * n1) + z95() / (3 * Math.sqrt(n1)), 3);
  return [(100 * lo) / w, (100 * hi) / w];
}
function rateRatio(a, wa, b, wb) {  // (a/wa) / (b/wb) with 95% CI on the log scale
  if (!wa || !wb) return null;
  const A = a || 0.5, B = b || 0.5;
  const rr = (A / wa) / (B / wb);
  const se = Math.sqrt(1 / A + 1 / B);
  return { rr, lo: rr * Math.exp(-z95() * se), hi: rr * Math.exp(z95() * se), a, b };
}
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const fx = (v, d = 1) => (v == null || !isFinite(v) ? "—" : Number(v).toFixed(d));
const pct = (v) => `${Math.round(100 * v)}%`;
const subTa = (s) => TAMIL_SUBTYPES[s]?.ta || s;
const subEn = (s) => TAMIL_SUBTYPES[s]?.en || s;
const levelShort = (l) => ({ P4: "P4", P6: "P6", SEC2: "Sec 2", SEC4: "Sec 4", JC1: "JC1", JC2: "JC2" })[l] || l;
const levelIndex = (l) => LEVEL_ORDER.indexOf(l);

/* ---------- data preparation (one pass; cached) ---------- */
function guiraud(text) {
  const toks = tokenize(text || "");
  return toks.length ? new Set(toks).size / Math.sqrt(toks.length) : null;
}
function prepDocs(docs) {
  return docs.map((d) => {
    const counts = {};
    if (d.counts) Object.assign(counts, d.counts);
    else learnerErrors(d).forEach((a) => { const s = annSubtype(a); counts[s] = (counts[s] || 0) + 1; });
    const words = d.word_count || docWordCount(d);
    const errors = Object.values(counts).reduce((s, v) => s + v, 0);
    return { d, id: d.id, level: d.level, year: Number(d.year) || null, task: d.task || "Unspecified",
             school: d.school_code || "", learner: d.learner_code || "", prompt: d.prompt || "",
             words, errors, counts, rate: words ? (100 * errors) / words : 0,
             richness: d.guiraud ?? guiraud(d.text) };
  }).filter((p) => p.words > 0);
}
function sumBy(rows, pred, sub) {
  let n = 0, w = 0, k = 0;
  rows.forEach((r) => { if (!pred || pred(r)) { n += sub ? (r.counts[sub] || 0) : r.errors; w += r.words; k += 1; } });
  return { n, w, k };
}

/* ---------- simulated data set (seeded, labelled) ---------- */
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function simulateCorpus() {
  if (simulateCorpus.cache) return simulateCorpus.cache;
  const rnd = mulberry32(20260928);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const poisson = (lam) => { if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss())); let L = Math.exp(-lam), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  // base rates per 100 words at P4, P6, Sec2, Sec4, JC1, JC2
  const BASE = {
    KURIL: [1.2, .8, .45, .3, .2, .15], UYIR: [.9, .6, .35, .25, .15, .12], PULLI: [.8, .5, .3, .2, .12, .1],
    EZ_GEN: [1.4, 1.0, .7, .5, .4, .35], OTTRU: [1.3, 1.25, 1.2, 1.1, 1.05, 1.0], LLZH: [.7, .65, .6, .58, .55, .5],
    NNN: [.5, .48, .45, .42, .4, .4], RR: [.4, .35, .3, .28, .25, .22], PUNAR: [.3, .35, .4, .42, .45, .45],
    WFORM: [.5, .45, .4, .35, .3, .3], CASE: [.6, .5, .45, .4, .35, .3], WCHOICE: [.2, .3, .45, .55, .6, .65],
    TENSE: [.5, .45, .35, .3, .25, .2], NUMBER: [.4, .3, .2, .15, .1, .1], SV_AGR: [.35, .35, .33, .3, .3, .28],
    PGN: [.4, .35, .3, .25, .2, .2], CONSTR: [.05, .1, .2, .3, .35, .4], GRAM_GEN: [.2, .2, .2, .2, .2, .2],
    MISSING: [.3, .25, .2, .2, .18, .18], EXTRA: [.3, .2, .12, .1, .08, .06], ORDER: [.1, .12, .15, .18, .2, .2],
    PUNCT: [.8, .6, .5, .4, .35, .3], SPACE: [.5, .4, .3, .25, .2, .2]
  };
  const TASK_X = { "Narrative": { TENSE: 2.2 }, "Situational Writing": { PGN: 2.5, CASE: 1.4 },
    "Argumentative Writing": { CONSTR: 1.9, WCHOICE: 1.3 }, "Reflective Writing": { WCHOICE: 1.2 }, "Expository Writing": { ORDER: 1.4 } };
  const PROMPTS = {
    "Composition": ["என் பள்ளி", "என் குடும்பம்", "பள்ளித் தோட்டம்"], "Narrative": ["மறக்க முடியாத ஒரு நாள்", "ஒரு பயணம்"],
    "Situational Writing": ["நண்பருக்குக் கடிதம்", "முதல்வருக்கு மின்னஞ்சல்"], "Argumentative Writing": ["கைப்பேசி பள்ளியில் வேண்டுமா?", "இணையவழிக் கல்வி"],
    "Reflective Writing": ["நான் கற்ற பாடம்"], "Expository Writing": ["நீர் சேமிப்பு", "சிங்கப்பூரின் பண்டிகைகள்"]
  };
  const PROMPT_X = { "முதல்வருக்கு மின்னஞ்சல்": { PGN: 1.5 }, "மறக்க முடியாத ஒரு நாள்": { TENSE: 1.3 } };
  const TASKS = { P4: ["Composition", "Narrative", "Situational Writing"], P6: ["Composition", "Narrative", "Situational Writing"],
    SEC2: ["Narrative", "Situational Writing", "Argumentative Writing", "Reflective Writing"],
    SEC4: ["Narrative", "Situational Writing", "Argumentative Writing", "Reflective Writing"],
    JC1: ["Argumentative Writing", "Expository Writing", "Reflective Writing", "Situational Writing"],
    JC2: ["Argumentative Writing", "Expository Writing", "Reflective Writing", "Situational Writing"] };
  const WORDS = { P4: 150, P6: 220, SEC2: 300, SEC4: 380, JC1: 450, JC2: 500 };
  const RICH = { P4: 5.4, P6: 6.2, SEC2: 6.9, SEC4: 7.5, JC1: 8.1, JC2: 8.4 };
  const COHORTS = [["P4", 2024, "P6", 2026, 200], ["SEC2", 2024, "SEC4", 2026, 180], ["JC1", 2025, "JC2", 2026, 140]];
  const docs = [];
  let lid = 0;
  COHORTS.forEach(([l1, y1, l2, y2, nLearners]) => {
    for (let i = 0; i < nLearners; i++) {
      lid += 1;
      const learner = `SIM-L${String(lid).padStart(4, "0")}`;
      const ability = Math.exp(0.35 * gauss());          // >1 = more errors
      const consonant = Math.exp(0.45 * gauss());        // shared driver of ல/ள/ழ, ந/ன/ண, ர/ற → co-occurrence
      const growth = Math.exp(0.25 * gauss());           // individual improvement between the two levels
      const plan = [[l1, y1, 1], [l2, y2, growth]];
      if (rnd() < 0.3) plan.push([l2, y2, growth]);       // some learners have a second script at the later level
      plan.forEach(([level, year, g], k) => {
        const task = pick(TASKS[level]);
        const prompt = pick(PROMPTS[task]);
        const words = Math.max(60, Math.round(WORDS[level] * (1 + 0.25 * gauss())));
        const counts = {};
        SUBTYPE_CODES.forEach((s) => {
          let lam = BASE[s][levelIndex(level)] * ability * (k ? 1 / g : 1);
          if (["LLZH", "NNN", "RR"].includes(s)) lam *= consonant;
          lam *= (TASK_X[task]?.[s] || 1) * (PROMPT_X[prompt]?.[s] || 1);
          const n = poisson((lam * words) / 100);
          if (n) counts[s] = n;
        });
        docs.push({ id: `SIM-${String(docs.length + 1).padStart(4, "0")}`, simulated: true, level, year: String(year), task, prompt,
          learner_code: learner, word_count: words,
          guiraud: Math.max(3, RICH[level] - 0.9 * Math.log(ability) + 0.5 * gauss()), counts });
      });
    }
  });
  simulateCorpus.cache = docs;
  return docs;
}

/* ---------- analyses ---------- */
function developmentTable(rows) {
  const levels = LEVEL_ORDER.filter((l) => sumBy(rows, (r) => r.level === l).k >= MIN_SCRIPTS);
  return SUBTYPE_CODES.map((s) => {
    const per = levels.map((l) => { const x = sumBy(rows, (r) => r.level === l, s); return { level: l, n: x.n, w: x.w, rate: x.w ? (100 * x.n) / x.w : 0 }; });
    const total = per.reduce((t, p) => t + p.n, 0);
    let cls = "thin", rr = null;
    if (per.length >= 2 && total >= 2 * MIN_EVENTS) {
      const first = per[0], last = per[per.length - 1];
      rr = rateRatio(last.n, last.w, first.n, first.w);
      if (rr.hi < 0.6) cls = "outgrown";
      else if (rr.lo > 1.4) cls = "emerging";
      else if (rr.lo > 0.6 && rr.hi < 1.7) cls = "persistent";
      else cls = "mixed";
    }
    return { s, per, total, cls, rr };
  }).filter((x) => x.total > 0);
}
function cooccurrence(rows) {
  /* Which error types rise and fall together in the same learner's script, beyond what level, script length and
     general accuracy explain. Per script: log-rate of each type, centred within its stratum (level × length third);
     then the partial correlation of two types controlling for the script's other errors. */
  const N = rows.length;
  if (N < 40) return [];
  const strata = {};
  LEVEL_ORDER.concat(["?"]).forEach((l) => {
    const lr = rows.map((r, i) => ({ r, i })).filter((x) => (LEVEL_ORDER.includes(x.r.level) ? x.r.level : "?") === l).sort((a, b) => a.r.words - b.r.words);
    lr.forEach((x, k) => { (strata[`${l}|${Math.floor((3 * k) / Math.max(1, lr.length))}`] ||= []).push(x.i); });
  });
  const centred = (vals) => { const out = new Array(N).fill(0); Object.values(strata).forEach((idx) => {
    const m = idx.reduce((t, k) => t + vals[k], 0) / idx.length; idx.forEach((k) => { out[k] = vals[k] - m; }); }); return out; };
  const lr = (n, w) => Math.log((n + 0.5) / w);
  const freq = Object.fromEntries(SUBTYPE_CODES.map((s) => [s, rows.filter((r) => r.counts[s]).length]));
  const cands = SUBTYPE_CODES.filter((s) => freq[s] >= Math.max(10, 0.05 * N));
  const R = Object.fromEntries(cands.map((s) => [s, centred(rows.map((r) => lr(r.counts[s] || 0, r.words)))]));
  const out = [];
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
    const A = cands[i], B = cands[j];
    const T = centred(rows.map((r) => lr(r.errors - (r.counts[A] || 0) - (r.counts[B] || 0), r.words)));
    const rab = pearson(R[A], R[B]), rat = pearson(R[A], T), rbt = pearson(R[B], T);
    if (rab == null || rat == null || rbt == null) continue;
    const pr = (rab - rat * rbt) / Math.sqrt(Math.max(1e-9, (1 - rat * rat) * (1 - rbt * rbt)));
    const t = pr * Math.sqrt((N - 3) / Math.max(1e-9, 1 - pr * pr));
    if (pr >= 0.08 && t >= 3.3) {
      const both = rows.filter((r) => r.counts[A] && r.counts[B]).length;
      let hiA = 0, hiAB = 0;
      for (let k = 0; k < N; k++) if (R[A][k] > 0) { hiA++; if (R[B][k] > 0) hiAB++; }
      const pBgA = hiAB / Math.max(1, hiA);
      out.push({ A, B, both, lift: pBgA / 0.5, pBgA, pB: 0.5, r: pr, t });
    }
  }
  return out.sort((x, y) => y.r - x.r);
}
function effects(rows, key, minK = MIN_SCRIPTS) {
  // every (value of key) × subtype: rate ratio vs all other scripts
  const values = [...new Set(rows.map((r) => r[key]).filter(Boolean))];
  const out = [];
  values.forEach((v) => {
    const inV = sumBy(rows, (r) => r[key] === v);
    if (inV.k < minK || inV.k > rows.length - minK) return;
    SUBTYPE_CODES.forEach((s) => {
      const a = sumBy(rows, (r) => r[key] === v, s), b = sumBy(rows, (r) => r[key] !== v, s);
      if (a.n < MIN_EVENTS) return;
      const rr = rateRatio(a.n, a.w, b.n, b.w);
      if (rr && rr.lo >= 1.3) out.push({ key, value: v, s, rr, scripts: a.k, rateIn: (100 * a.n) / a.w, rateOut: (100 * b.n) / b.w });
    });
  });
  return out.sort((x, y) => y.rr.lo - x.rr.lo);
}
function learnerProgress(rows) {
  const by = {};
  rows.filter((r) => r.learner).forEach((r) => (by[r.learner] ||= []).push(r));
  const series = Object.entries(by).filter(([, rs]) => rs.length >= 2).map(([id, rs]) => {
    rs.sort((a, b) => (a.year - b.year) || (levelIndex(a.level) - levelIndex(b.level)));
    const first = rs[0], last = rs[rs.length - 1];
    const byGroup = Object.fromEntries(GROUP_ORDER.map((g) => {
      const n = (r) => Object.entries(r.counts).filter(([s]) => subtypeGroup(s) === g).reduce((t, [, v]) => t + v, 0);
      return [g, [(100 * n(first)) / first.words, (100 * n(last)) / last.words]];
    }));
    return { id, rs, first, last, change: last.rate - first.rate, byGroup };
  });
  return series;
}
function teachingPriorities(rows, dev) {
  const devCls = Object.fromEntries(dev.map((x) => [x.s, x.cls]));
  return LEVEL_ORDER.map((l) => {
    const lr = rows.filter((r) => r.level === l);
    if (lr.length < MIN_SCRIPTS) return { level: l, items: [], scripts: lr.length };
    const w = lr.reduce((t, r) => t + r.words, 0);
    const items = SUBTYPE_CODES.map((s) => {
      const n = lr.reduce((t, r) => t + (r.counts[s] || 0), 0);
      const reach = lr.filter((r) => (r.counts[s] || 0) > 0).length / lr.length;
      const rate = (100 * n) / w;
      const weight = { persistent: 1.4, emerging: 1.3, mixed: 1.1, outgrown: 0.8, thin: 1 }[devCls[s] || "thin"];
      return { s, n, rate, reach, cls: devCls[s] || "thin", score: rate * Math.sqrt(reach) * weight };
    }).filter((x) => x.n >= 3).sort((a, b) => b.score - a.score).slice(0, 3);
    return { level: l, items, scripts: lr.length };
  });
}
const TEACHING_TIPS = {
  OTTRU: "Doubling after case endings (-ஐ, -கு) and after அந்த/இந்த before க ச த ப. Practise noun + case + verb frames.",
  LLZH: "Minimal-pair listening and dictation for ல/ள/ழ (வாலை/வாழை, மலை/மழை).",
  NNN: "Position rules and minimal pairs for ந/ன/ண (மனம்/மணம்).",
  RR: "Read-aloud contrast drills for ர/ற (அரு/அறு, கரி/கறி).",
  KURIL: "Short/long vowel pairs (கலை/காலை); clap and mark syllable length.",
  UYIR: "Vowel-sign families (ெ/ே, ொ/ோ); copying and dictation by sign.",
  PULLI: "Proof-read word endings for the pulli (மரம், அவன்).",
  EZ_GEN: "Personal spelling lists from the learner's own errors; weekly dictation.",
  PUNAR: "When words join and when they stay apart (மரக்கிளை vs மரம் கிளை).",
  WFORM: "Choosing verb forms: verbal participle vs verbal noun (ஓடி vs ஓடுதல்).",
  CASE: "Case markers for place, purpose and motion (-க்கு, -இல், -ஐ) using sentence frames.",
  WCHOICE: "Topic word banks with model sentences; collocation practice.",
  TENSE: "Keeping narratives in the past tense; time adverbs with past forms.",
  NUMBER: "Plural after numerals and plural subjects (இரண்டு மரங்கள்).",
  SV_AGR: "Agreement with plural non-human subjects (பூக்கள் இருந்தன).",
  PGN: "Person/gender/number and respect endings (வந்தான்/வந்தாள்/வந்தார்), esp. in letters.",
  CONSTR: "Connectives: do not combine -ஆல் with ஆனால்; sentence-combining exercises.",
  GRAM_GEN: "Model sentences and guided rewriting.",
  MISSING: "Read-aloud proof-reading for missing words.",
  EXTRA: "Proof-reading for repeated or extra words.",
  ORDER: "Rebuilding sentences: adjective before noun, verb last.",
  PUNCT: "An editing checklist for full stops and commas.",
  SPACE: "Word-boundary practice: joining and splitting words."
};

function computeIntel(docs) {
  const rows = prepDocs(docs);
  const dev = developmentTable(rows);
  return { rows, dev, co: cooccurrence(rows), tasks: effects(rows, "task"), schools: effects(rows, "school"),
           prompts: effects(rows, "prompt", 5), progress: learnerProgress(rows), priorities: teachingPriorities(rows, dev),
           total: sumBy(rows) };
}
function intelData() {
  const real = corpus.filter((d) => !d.sample && !d.simulated);
  if (!INTEL.source) INTEL.source = real.length >= 30 ? "corpus" : "simulated";
  const docs = INTEL.source === "simulated" ? simulateCorpus() : corpus;
  const key = `${INTEL.source}|${docs.length}|${corpus.length}`;
  if (INTEL.cacheKey !== key) { INTEL.cache = computeIntel(docs); INTEL.cacheKey = key; }
  return INTEL.cache;
}

/* ---------- findings (plain language) ---------- */
function rowsLabel(I) { return `${I.total.k.toLocaleString()} scripts`; }
function keyFindings(I) {
  const F = [];
  const t = I.total;
  if (!t.k) return F;
  const all = {}; I.rows.forEach((r) => Object.entries(r.counts).forEach(([s, n]) => { all[s] = (all[s] || 0) + n; }));
  const top = Object.entries(all).sort((a, b) => b[1] - a[1])[0];
  if (top) F.push({ kind: "overview", strength: 999, html: `<b>${fx((100 * t.n) / t.w, 1)} errors per 100 words</b> across ${t.k.toLocaleString()} scripts.
    The most common type is <span class="tamil">${escapeHtml(subTa(top[0]))}</span> (${escapeHtml(subEn(top[0]))}) — ${pct(top[1] / t.n)} of all errors.`, support: `${t.k} scripts · ${t.w.toLocaleString()} words` });
  I.dev.filter((x) => x.cls === "outgrown").sort((a, b) => a.rr.rr - b.rr.rr).slice(0, 2).forEach((x) => {
    const f = x.per[0], l = x.per[x.per.length - 1];
    F.push({ kind: "development", strength: 50 + 1 / x.rr.rr, s: x.s, html: `Learners <b>grow out of</b> <span class="tamil">${escapeHtml(subTa(x.s))}</span>:
      ${fx(f.rate, 2)} per 100 words at ${levelShort(f.level)} → ${fx(l.rate, 2)} at ${levelShort(l.level)} (${fx(1 / x.rr.rr, 1)}× lower).`, support: `rate ratio ${fx(x.rr.rr, 2)} (95% CI ${fx(x.rr.lo, 2)}–${fx(x.rr.hi, 2)})` });
  });
  I.dev.filter((x) => x.cls === "persistent").sort((a, b) => b.total - a.total).slice(0, 2).forEach((x) => {
    F.push({ kind: "persistent", strength: 60 + x.total / 100, s: x.s, html: `<span class="tamil">${escapeHtml(subTa(x.s))}</span> is <b>persistent</b>: about
      ${fx(x.per[x.per.length - 1].rate, 2)} per 100 words from ${levelShort(x.per[0].level)} to ${levelShort(x.per[x.per.length - 1].level)} — it does not fade with age, so it needs explicit teaching.`,
      support: `rate ratio ${fx(x.rr.rr, 2)} (95% CI ${fx(x.rr.lo, 2)}–${fx(x.rr.hi, 2)})` });
  });
  I.dev.filter((x) => x.cls === "emerging").slice(0, 1).forEach((x) => {
    F.push({ kind: "emerging", strength: 55, s: x.s, html: `<span class="tamil">${escapeHtml(subTa(x.s))}</span> <b>increases</b> with level
      (${fx(x.per[0].rate, 2)} → ${fx(x.per[x.per.length - 1].rate, 2)} per 100 words) — typical of longer, more complex writing.`, support: `rate ratio ${fx(x.rr.rr, 2)} (95% CI ${fx(x.rr.lo, 2)}–${fx(x.rr.hi, 2)})` });
  });
  I.tasks.slice(0, 2).forEach((e) => F.push({ kind: "task", strength: 40 + e.rr.lo, s: e.s, html: `<b>${escapeHtml(e.value)}</b> scripts have
    <b>${fx(e.rr.rr, 1)}×</b> the <span class="tamil">${escapeHtml(subTa(e.s))}</span> errors of other tasks (${fx(e.rateIn, 2)} vs ${fx(e.rateOut, 2)} per 100 words).`,
    support: `${e.scripts} scripts · 95% CI ${fx(e.rr.lo, 1)}–${fx(e.rr.hi, 1)}×` }));
  I.schools.slice(0, 1).forEach((e) => F.push({ kind: "school", strength: 45 + e.rr.lo, s: e.s, html: `School <b>${escapeHtml(e.value)}</b> stands out:
    <b>${fx(e.rr.rr, 1)}×</b> the <span class="tamil">${escapeHtml(subTa(e.s))}</span> rate of other schools — worth a closer look with that school.`,
    support: `${e.scripts} scripts · 95% CI ${fx(e.rr.lo, 1)}–${fx(e.rr.hi, 1)}×` }));
  I.co.slice(0, 1).forEach((c) => F.push({ kind: "co", strength: 42, html: `Errors <b>travel together</b>: learners with more
    <span class="tamil">${escapeHtml(subTa(c.A))}</span> than their peers also tend to have more <span class="tamil">${escapeHtml(subTa(c.B))}</span>
    (partial r = ${fx(c.r, 2)}, beyond level, length and overall accuracy) — likely one underlying skill to teach together.`,
    support: `${rowsLabel(I)} · t = ${fx(c.t, 1)}` }));
  if (I.progress.length >= 10) {
    const improved = I.progress.filter((p) => p.change < 0).length / I.progress.length;
    F.push({ kind: "progress", strength: 41, html: `Of ${I.progress.length.toLocaleString()} learners with more than one script, <b>${pct(improved)}</b> made fewer errors per 100 words in their later script
      (median change ${fx(median(I.progress.map((p) => p.change)), 2)}).`, support: "paired, same learner code" });
  }
  return F.sort((a, b) => b.strength - a.strength);
}

/* ---------- charts ---------- */
function sparkline(values, { w = 120, h = 28, max = null } = {}) {
  if (!values.length) return "";
  const m = max ?? Math.max(0.01, ...values);
  const pts = values.map((v, i) => [values.length === 1 ? w / 2 : (i * (w - 6)) / (values.length - 1) + 3, h - 3 - (v / m) * (h - 6)]);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none"/>
    ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.2"/>`).join("")}</svg>`;
}
function ciBar(rate, lo, hi, max) {
  const x = (v) => `${Math.min(100, (v / max) * 100)}%`;
  return `<span class="ci-track"><span class="ci-range" style="left:${x(lo)};width:calc(${x(hi)} - ${x(lo)})"></span><span class="ci-dot" style="left:${x(rate)}"></span></span>`;
}
function scatter(points, { xLabel, yLabel, w = 520, h = 300 }) {
  if (points.length < 3) return '<div class="empty">Not enough scripts yet.</div>';
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], y1 = Math.max(0.5, ...ys);
  const L = 44, B = 36, T = 10, R = 10, W = w - L - R, H = h - T - B;
  const px = (v) => L + ((v - x0) / (x1 - x0 || 1)) * W, py = (v) => T + H - (v / y1) * H;
  const lvlColor = (l) => `lv-${levelIndex(l)}`;
  return `<svg class="scatter" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(yLabel)} against ${escapeHtml(xLabel)}">
    <line x1="${L}" y1="${T + H}" x2="${L + W}" y2="${T + H}" class="ax"/><line x1="${L}" y1="${T}" x2="${L}" y2="${T + H}" class="ax"/>
    ${points.map((p) => `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="2.6" class="${lvlColor(p.level)}"/>`).join("")}
    <text x="${L + W / 2}" y="${h - 6}" text-anchor="middle" class="axl">${escapeHtml(xLabel)}</text>
    <text x="12" y="${T + H / 2}" transform="rotate(-90 12 ${T + H / 2})" text-anchor="middle" class="axl">${escapeHtml(yLabel)}</text>
    <text x="${L}" y="${T + H + 14}" class="axt">${fx(x0, 0)}</text><text x="${L + W}" y="${T + H + 14}" text-anchor="end" class="axt">${fx(x1, 0)}</text>
    <text x="${L - 4}" y="${T + 8}" text-anchor="end" class="axt">${fx(y1, 0)}</text><text x="${L - 4}" y="${T + H}" text-anchor="end" class="axt">0</text>
  </svg>`;
}
function levelKey() {
  return `<div class="lv-key small">${LEVEL_ORDER.map((l, i) => `<span><i class="lv-${i}"></i>${levelShort(l)}</span>`).join("")}</div>`;
}

/* ---------- views ---------- */
const INTEL_VIEWS = [
  ["findings", "Key findings"], ["development", "Grow out of / persistent"], ["together", "Errors that travel together"],
  ["learners", "Learner progress"], ["schools", "Schools"], ["quality", "Writing quality"], ["prompts", "Prompts & tasks"],
  ["priorities", "Teaching priorities"], ["ask", "Ask the corpus"]
];

function intelHeader(I) {
  const real = corpus.filter((d) => !d.sample && !d.simulated).length;
  return `
    <div class="intel-top">
      <div class="seg intel-source">
        <button type="button" data-intel-source="corpus" class="${INTEL.source === "corpus" ? "active" : ""}">Corpus data <span>${corpus.length}</span></button>
        <button type="button" data-intel-source="simulated" class="${INTEL.source === "simulated" ? "active" : ""}">Simulated demo <span>${simulateCorpus().length.toLocaleString()}</span></button>
      </div>
      <div class="small muted">${I.total.k.toLocaleString()} scripts · ${I.total.w.toLocaleString()} words · ${I.total.n.toLocaleString()} errors</div>
    </div>
    ${INTEL.source === "simulated" ? `<div class="sim-banner"><strong>SIMULATED DEMO DATA — not real learners.</strong>
      ${simulateCorpus().length.toLocaleString()} synthetic scripts generated to show how these analyses behave at the scale of a funded project.
      Patterns were deliberately built into the simulation (persistent ஒற்று errors, tense errors in narratives, person/number errors in formal emails, ல/ள/ழ and ந/ன/ண errors moving together), so you can check that the engine finds them.
      ${real < 30 ? `Switch to <em>Corpus data</em> once real scripts are saved (${real} so far).` : ""}</div>`
      : sampleBannerHtml(corpus) + (I.total.k < 30 ? `<div class="small muted thin-note">Only ${I.total.k} scripts: most analyses need more data and will stay quiet until then.</div>` : "")}
    <nav class="intel-nav">${INTEL_VIEWS.filter(([k]) => k !== "schools" || I.rows.some((r) => r.school)).map(([k, l]) => `<button type="button" data-intel-view="${k}" class="${INTEL.view === k ? "active" : ""}">${l}</button>`).join("")}</nav>`;
}

function viewFindings(I) {
  const F = keyFindings(I);
  if (F.length <= 1) return `${F.map(findingCard).join("")}<div class="empty">No statistically solid patterns yet. Findings appear automatically as scripts are added.</div>`;
  return `<div class="findings">${F.map(findingCard).join("")}</div>
    <div class="small muted">Only patterns whose 95% interval clears the threshold are reported; each card shows its evidence.</div>`;
}
function findingCard(f) {
  const icon = { overview: "◎", development: "↘", persistent: "■", emerging: "↗", task: "✎", school: "⌂", co: "⇄", progress: "✓" }[f.kind] || "•";
  return `<div class="finding k-${f.kind}"><span class="f-icon">${icon}</span><div><div class="f-text">${f.html}</div>
    <div class="small muted f-sup">${escapeHtml(f.support || "")}</div></div></div>`;
}
function viewDevelopment(I) {
  if (!I.dev.length) return '<div class="empty">No errors yet.</div>';
  const levels = I.dev[0].per.map((p) => p.level);
  if (levels.length < 2) return '<div class="empty">Needs scripts from at least two levels (8+ scripts each).</div>';
  const lab = { outgrown: "grow out of", persistent: "persistent", emerging: "increasing", mixed: "unclear", thin: "too little data" };
  const order = { persistent: 0, emerging: 1, outgrown: 2, mixed: 3, thin: 4 };
  const rows = [...I.dev].sort((a, b) => order[a.cls] - order[b.cls] || b.total - a.total);
  return `<div class="small muted">Errors per 100 words at each level (${levels.map(levelShort).join(" → ")}). Classified by the ratio between the last and the first level and its 95% interval.</div>
    <table class="table dev-table"><thead><tr><th>Error type</th><th>Trend</th>${levels.map((l) => `<th>${levelShort(l)}</th>`).join("")}<th>Pattern</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td><span class="lg g-${subtypeGroup(x.s).toLowerCase()} tamil">${escapeHtml(subTa(x.s))}</span><div class="small muted">${escapeHtml(subEn(x.s))}</div></td>
      <td>${sparkline(x.per.map((p) => p.rate))}</td>${x.per.map((p) => `<td class="num">${fx(p.rate, 2)}</td>`).join("")}
      <td><span class="cls cls-${x.cls}">${lab[x.cls]}</span>${x.rr ? `<div class="small muted">×${fx(x.rr.rr, 2)} (${fx(x.rr.lo, 2)}–${fx(x.rr.hi, 2)})</div>` : ""}</td></tr>`).join("")}
    </tbody></table>`;
}
function viewTogether(I) {
  if (!I.co.length) return '<div class="empty">No pairs clearly above chance yet (needs more scripts).</div>';
  return `<div class="small muted">Error types that rise and fall together in the same script, after allowing for level, script length and the learner's
    other errors (partial correlation r, shown when p &lt; 0.001). A strong pair usually points to one underlying skill — teach them together.</div>
    <table class="table"><thead><tr><th>Error type</th><th>moves with</th><th>Partial r</th><th>When the first is above average, the second is too</th><th>Scripts with both</th></tr></thead><tbody>
    ${I.co.slice(0, 15).map((c) => `<tr><td class="tamil">${escapeHtml(subTa(c.A))}</td><td class="tamil">${escapeHtml(subTa(c.B))}</td>
      <td><b>${fx(c.r, 2)}</b></td><td>${pct(c.pBgA)} <span class="small muted">(50% by chance)</span></td><td>${c.both}</td></tr>`).join("")}
    </tbody></table>`;
}
function viewLearners(I) {
  const P = I.progress;
  if (!P.length) return `<div class="empty">No learner has two or more scripts yet. Use the optional <em>learner code</em> on the upload page (a pseudonym such as L017) to follow learners over time.</div>`;
  const q = INTEL.learner.trim().toUpperCase();
  const list = (q ? P.filter((p) => p.id.includes(q)) : [...P].sort((a, b) => a.change - b.change)).slice(0, 12);
  const improved = P.filter((p) => p.change < 0).length;
  const groupChange = GROUP_ORDER.map((g) => ({ g, d: median(P.map((p) => p.byGroup[g][1] - p.byGroup[g][0])) }));
  return `<div class="insight-grid">
      <div class="insight-card"><span>Learners followed</span><strong>${P.length.toLocaleString()}</strong></div>
      <div class="insight-card"><span>Fewer errors later</span><strong>${pct(improved / P.length)}</strong></div>
      <div class="insight-card"><span>Median change</span><strong>${fx(median(P.map((p) => p.change)), 2)}</strong></div>
    </div>
    <div class="panel"><h3>Median change per group <span class="small muted">later minus earlier script, per 100 words</span></h3>
      ${hbarRows(groupChange.map((x) => ({ labelHtml: `<span class="tamil">${escapeHtml(groupTa(x.g))}</span>`, value: Math.abs(x.d), g: x.g,
        })), { decimals: 2, colorOf: (r) => `g-${r.g.toLowerCase()}` })}
      <div class="small muted">${groupChange.map((x) => `${escapeHtml(groupTa(x.g))}: ${x.d <= 0 ? "▼" : "▲"} ${fx(Math.abs(x.d), 2)}`).join(" · ")}</div></div>
    <div class="panel"><h3>Individual learners</h3>
      <input type="search" data-intel-learner placeholder="Find a learner code…" value="${escapeHtml(INTEL.learner)}" class="intel-search" />
      <table class="table"><thead><tr><th>Learner code</th><th>Scripts</th><th>Errors / 100 words over time</th><th>First → last</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><code>${escapeHtml(p.id)}</code></td><td class="small">${p.rs.map((r) => `${levelShort(r.level)} ${r.year || ""}`).join(" → ")}</td>
        <td>${sparkline(p.rs.map((r) => r.rate))}</td><td><b class="${p.change < 0 ? "good" : "bad"}">${fx(p.first.rate, 1)} → ${fx(p.last.rate, 1)}</b></td></tr>`).join("")}
      </tbody></table>
      <div class="small muted">${q ? "" : "Showing the learners who improved most. "}Learner codes are pseudonyms; the key to real names stays outside the platform.</div></div>`;
}
function viewSchools(I) {
  const schools = [...new Set(I.rows.map((r) => r.school).filter(Boolean))].sort();
  if (schools.length < 2) return `<div class="empty">Needs scripts from at least two schools. Add the optional <em>school code</em> on the upload page (e.g. SCH-A).</div>`;
  const stats = schools.map((s) => { const x = sumBy(I.rows, (r) => r.school === s); const [lo, hi] = rateCI(x.n, x.w); return { s, ...x, rate: (100 * x.n) / x.w, lo, hi }; });
  const max = Math.max(...stats.map((x) => x.hi)) * 1.05;
  return `<div class="panel"><h3>Overall error rate by school <span class="small muted">per 100 words, with 95% interval</span></h3>
      <table class="table ci-table"><tbody>${stats.map((x) => `<tr><td><b>${escapeHtml(x.s)}</b><div class="small muted">${x.k} scripts</div></td>
        <td class="ci-cell">${ciBar(x.rate, x.lo, x.hi, max)}</td><td class="num">${fx(x.rate, 2)}</td></tr>`).join("")}</tbody></table>
      <div class="small muted">Overlapping bars mean the difference could be chance. Note that schools may also differ in level and task mix.</div></div>
    <div class="panel"><h3>Where a school stands out</h3>
      ${I.schools.length ? `<table class="table"><thead><tr><th>School</th><th>Error type</th><th>Rate there</th><th>Elsewhere</th><th>Ratio (95% CI)</th></tr></thead><tbody>
        ${I.schools.slice(0, 12).map((e) => `<tr><td><b>${escapeHtml(e.value)}</b></td><td class="tamil">${escapeHtml(subTa(e.s))}</td><td>${fx(e.rateIn, 2)}</td><td class="muted">${fx(e.rateOut, 2)}</td>
          <td><b>${fx(e.rr.rr, 1)}×</b> <span class="small muted">(${fx(e.rr.lo, 1)}–${fx(e.rr.hi, 1)})</span></td></tr>`).join("")}</tbody></table>`
        : '<div class="empty">No school differs clearly from the others.</div>'}</div>`;
}
function viewQuality(I) {
  const rows = I.rows.filter((r) => r.richness != null);
  const r1 = pearson(I.rows.map((r) => r.words), I.rows.map((r) => r.rate));
  const r2 = pearson(rows.map((r) => r.richness), rows.map((r) => r.rate));
  const qs = [...rows].sort((a, b) => a.richness - b.richness);
  const quart = [0, 1, 2, 3].map((q) => qs.slice(Math.floor((q * qs.length) / 4), Math.floor(((q + 1) * qs.length) / 4)));
  const groupRate = (rs, g) => { const w = rs.reduce((t, r) => t + r.words, 0); const n = rs.reduce((t, r) => t + Object.entries(r.counts).filter(([s]) => subtypeGroup(s) === g).reduce((u, [, v]) => u + v, 0), 0); return w ? (100 * n) / w : 0; };
  const sample = (arr) => arr.length > 1500 ? arr.filter((_, i) => i % Math.ceil(arr.length / 1500) === 0) : arr;
  return `<div class="insight-panels">
      <div class="panel"><h3>Length vs error rate <span class="small muted">r = ${fx(r1, 2)}</span></h3>
        ${scatter(sample(I.rows).map((r) => ({ x: r.words, y: r.rate, level: r.level })), { xLabel: "words in the script", yLabel: "errors per 100 words" })}${levelKey()}</div>
      <div class="panel"><h3>Vocabulary richness vs error rate <span class="small muted">r = ${fx(r2, 2)}</span></h3>
        ${scatter(sample(rows).map((r) => ({ x: r.richness, y: r.rate, level: r.level })), { xLabel: "vocabulary richness (distinct words ÷ √words)", yLabel: "errors per 100 words" })}${levelKey()}</div>
    </div>
    ${rows.length >= 40 ? `<div class="panel"><h3>Do richer writers make fewer errors — or different ones?</h3>
      <div class="small muted">Scripts split into four equal groups by vocabulary richness. Errors per 100 words by error group.</div>
      <table class="table"><thead><tr><th>Error group</th><th>Least rich</th><th>2nd</th><th>3rd</th><th>Richest</th></tr></thead><tbody>
      ${GROUP_ORDER.map((g) => `<tr><td><span class="lg g-${g.toLowerCase()} tamil">${escapeHtml(groupTa(g))}</span></td>${quart.map((q) => `<td class="num">${fx(groupRate(q, g), 2)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>` : ""}
    <div class="small muted">Correlation is not cause: longer and richer scripts also come from older learners. Compare within a level using the level tabs of Analyze.</div>`;
}
function viewPrompts(I) {
  const both = [...I.tasks.map((e) => ({ ...e, label: "Task" })), ...I.prompts.map((e) => ({ ...e, label: "Prompt" }))].sort((a, b) => b.rr.lo - a.rr.lo);
  const prompts = [...new Set(I.rows.map((r) => r.prompt).filter(Boolean))];
  return `<div class="panel"><h3>Which tasks and prompts trigger which errors</h3>
      ${both.length ? `<table class="table"><thead><tr><th></th><th>Task / prompt</th><th>Error type</th><th>Rate</th><th>Other scripts</th><th>Ratio (95% CI)</th></tr></thead><tbody>
        ${both.slice(0, 15).map((e) => `<tr><td class="small muted">${e.label}</td><td class="${e.label === "Prompt" ? "tamil" : ""}">${escapeHtml(e.value)}</td>
          <td class="tamil">${escapeHtml(subTa(e.s))}</td><td>${fx(e.rateIn, 2)}</td><td class="muted">${fx(e.rateOut, 2)}</td>
          <td><b>${fx(e.rr.rr, 1)}×</b> <span class="small muted">(${fx(e.rr.lo, 1)}–${fx(e.rr.hi, 1)})</span></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty">No task or prompt differs clearly yet${prompts.length ? "" : " — record the prompt on the upload page to enable this"}.</div>`}
      <div class="small muted">Useful for exam and task design: a prompt that triggers many errors of one type is also a good diagnostic item.</div></div>`;
}
function viewPriorities(I) {
  const examples = {};
  errorsOf(corpus).forEach(({ a }) => { const s = annSubtype(a); if (a.text && a.suggested && (examples[s] ||= []).length < 3) examples[s].push(`${a.text} → ${a.suggested}`); });
  const lab = { outgrown: "fades with age", persistent: "persistent across levels", emerging: "grows with level", mixed: "", thin: "" };
  const cards = I.priorities.filter((p) => p.items.length);
  if (!cards.length) return '<div class="empty">Needs at least 8 scripts at a level.</div>';
  return `<div class="small muted">Ranked by how often the error occurs, how many learners it affects, and whether learners grow out of it on their own.</div>
    <div class="prio-grid">${cards.map((p) => `<div class="panel prio">
      <h3>${escapeHtml(levelLabel(p.level))} <span class="small muted">${p.scripts} scripts</span></h3>
      ${p.items.map((x, i) => `<div class="prio-item"><span class="prio-n">${i + 1}</span><div>
        <div><span class="lg g-${subtypeGroup(x.s).toLowerCase()} tamil">${escapeHtml(subTa(x.s))}</span> <span class="small muted">${escapeHtml(subEn(x.s))}</span></div>
        <div class="small">Affects <b>${pct(x.reach)}</b> of scripts · ${fx(x.rate, 2)} per 100 words${lab[x.cls] ? ` · ${lab[x.cls]}` : ""}</div>
        <div class="small prio-tip">${escapeHtml(TEACHING_TIPS[x.s] || "")}</div>
        ${examples[x.s] ? `<div class="small tamil muted">e.g. ${examples[x.s].map(escapeHtml).join(" · ")}</div>` : ""}
        ${INTEL.source === "corpus" ? `<button type="button" class="text-button small" data-intel-examples="${x.s}" data-level="${p.level}">See learner examples →</button>` : ""}
      </div></div>`).join("")}</div>`).join("")}</div>`;
}
function corpusSummaryForAI(I) {
  const lv = {};
  LEVEL_ORDER.forEach((l) => {
    const x = sumBy(I.rows, (r) => r.level === l); if (!x.k) return;
    const top = SUBTYPE_CODES.map((s) => [s, sumBy(I.rows, (r) => r.level === l, s).n]).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([s, n]) => ({ type: `${subTa(s)} (${subEn(s)})`, per100: +(100 * n / x.w).toFixed(2) }));
    lv[l] = { scripts: x.k, words: x.w, errors_per100: +(100 * x.n / x.w).toFixed(2), top_types: top };
  });
  const tasks = {};
  [...new Set(I.rows.map((r) => r.task))].forEach((t) => { const x = sumBy(I.rows, (r) => r.task === t); tasks[t] = { scripts: x.k, errors_per100: +(100 * x.n / x.w).toFixed(2) }; });
  return {
    data: INTEL.source === "simulated" ? "SIMULATED demo data (not real learners)" : "corpus data",
    totals: { scripts: I.total.k, words: I.total.w, errors: I.total.n },
    by_level: lv, by_task: tasks,
    development: I.dev.filter((x) => x.cls !== "thin").map((x) => ({ type: `${subTa(x.s)} (${subEn(x.s)})`, pattern: x.cls, per100_by_level: Object.fromEntries(x.per.map((p) => [p.level, +p.rate.toFixed(2)])) })),
    task_effects: I.tasks.slice(0, 10).map((e) => ({ task: e.value, type: subEn(e.s), ratio: +e.rr.rr.toFixed(2), ci: [+e.rr.lo.toFixed(2), +e.rr.hi.toFixed(2)] })),
    school_effects: I.schools.slice(0, 10).map((e) => ({ school: e.value, type: subEn(e.s), ratio: +e.rr.rr.toFixed(2), ci: [+e.rr.lo.toFixed(2), +e.rr.hi.toFixed(2)] })),
    co_occurring: I.co.slice(0, 8).map((c) => ({ a: subEn(c.A), b: subEn(c.B), lift: +c.lift.toFixed(2), both: c.both })),
    learners_followed: I.progress.length,
    learners_improved_share: I.progress.length ? +(I.progress.filter((p) => p.change < 0).length / I.progress.length).toFixed(2) : null,
    teaching_priorities: Object.fromEntries(I.priorities.filter((p) => p.items.length).map((p) => [p.level, p.items.map((x) => subEn(x.s))]))
  };
}
function viewAsk() {
  const qs = ["Which errors should P6 teachers focus on?", "Which errors do learners not grow out of?", "How do narrative scripts differ from other tasks?",
              "Is any school unusual?", "எந்தப் பிழைகள் உயர்நிலையிலும் தொடர்கின்றன?"];
  return `<div class="panel ask-panel"><h3>Ask the corpus</h3>
      <div class="small muted">The question is answered by Sarvam from the corpus <b>statistics</b> on this page (rates, trends, comparisons) — no learner text is sent.
        Answers quote the figures they rely on.</div>
      <div class="ask-row"><input type="text" data-intel-ask-q class="tamil" placeholder="Ask in English or Tamil…" />
        <button type="button" class="primary-btn" data-intel-ask>Ask</button></div>
      <div class="ask-examples">${qs.map((q) => `<button type="button" class="text-button small tamil" data-intel-ask-ex>${escapeHtml(q)}</button>`).join("")}</div>
      <div data-intel-answer class="ask-answer"></div></div>`;
}

function renderIntelligence() {
  const I = intelData();
  if (INTEL.view === "schools" && !I.rows.some((r) => r.school)) INTEL.view = "findings";   // school view only if school codes are collected
  const body = { findings: viewFindings, development: viewDevelopment, together: viewTogether, learners: viewLearners, schools: viewSchools,
                 quality: viewQuality, prompts: viewPrompts, priorities: viewPriorities, ask: viewAsk }[INTEL.view](I);
  return `${intelHeader(I)}<div class="intel-body">${body}</div>`;
}

function wireIntelligence() {
  const out = $("insightOutput");
  const rerender = () => { out.innerHTML = renderIntelligence(); wireIntelligence(); };
  out.querySelectorAll("[data-intel-source]").forEach((b) => b.addEventListener("click", () => { INTEL.source = b.dataset.intelSource; rerender(); }));
  out.querySelectorAll("[data-intel-view]").forEach((b) => b.addEventListener("click", () => { INTEL.view = b.dataset.intelView; rerender(); }));
  out.querySelector("[data-intel-learner]")?.addEventListener("input", (e) => {
    INTEL.learner = e.target.value; const pos = e.target.selectionStart; rerender();
    const inp = out.querySelector("[data-intel-learner]"); inp.focus(); inp.setSelectionRange(pos, pos);
  });
  out.querySelectorAll("[data-intel-examples]").forEach((b) => b.addEventListener("click", () => {
    concFilters.group = ""; concFilters.subtype = b.dataset.intelExamples; concFilters.task = ""; concFilters.year = "";
    analyzeLevel = b.dataset.level || "";
    document.querySelectorAll("#analyzeLevelTabs .levelbtn").forEach((x) => x.classList.toggle("active", x.dataset.level === analyzeLevel));
    analyzeTool = "errors";
    document.querySelectorAll(".toolbtn").forEach((x) => x.classList.toggle("active", x.dataset.tool === "errors"));
    switchSection("analyze"); renderAnalyze();
  }));
  const ask = async (q) => {
    const box = out.querySelector("[data-intel-answer]");
    if (!q.trim()) return;
    box.innerHTML = '<div class="small muted">Thinking…</div>';
    try {
      const base = ocrApiUrl();
      const response = await fetch(`${base}/api/ask-corpus`, { method: "POST", headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ question: q, summary: corpusSummaryForAI(intelData()) }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || (response.status === 404 ? "The server has not been updated for this feature yet." : `HTTP ${response.status}`));
      box.innerHTML = `<div class="ask-q tamil">${escapeHtml(q)}</div><div class="ask-a tamil">${escapeHtml(payload.answer || "").replace(/\n/g, "<br>")}</div>
        <div class="small muted">Answered by ${escapeHtml(payload.model || "Sarvam")} from ${INTEL.source === "simulated" ? "the SIMULATED demo statistics" : "the corpus statistics"}. Check important figures on the other tabs.</div>`;
    } catch (error) { box.innerHTML = `<div class="field-error">${escapeHtml(error.message)}</div>`; }
  };
  out.querySelector("[data-intel-ask]")?.addEventListener("click", () => ask(out.querySelector("[data-intel-ask-q]").value));
  out.querySelector("[data-intel-ask-q]")?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) ask(e.target.value); });
  out.querySelectorAll("[data-intel-ask-ex]").forEach((b) => b.addEventListener("click", () => { out.querySelector("[data-intel-ask-q]").value = b.textContent; ask(b.textContent); }));
}
