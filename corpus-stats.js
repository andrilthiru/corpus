/* =========================================================
   THEMOZHI — corpus statistics on the Tamil error taxonomy (v0.17)
   Used by Dashboard, Analyze (error concordance) and Insights.
   Loaded after taxonomy.js and before app.js; relies on app.js helpers
   ($, escapeHtml, countWords, levelLabel, docsFor, corpus) at call time.
   ========================================================= */

const LEVEL_ORDER = ["P4", "P6", "SEC2", "SEC4", "JC1", "JC2"];
const GROUP_ORDER = ["EZHUTHU", "SOL", "ILAKKANAM", "NADAI"];
const MIN_WORDS_FOR_RATE = 150;      // below this a rate is shown but flagged as too little data

/* ---------- basic accessors ---------- */
function annSubtype(a) {
  if (a?.subtype && TAMIL_SUBTYPES[a.subtype]) return a.subtype;
  return LEGACY_TO_SUBTYPE[a?.category] || "GRAM_GEN";
}
function annGroup(a) { return subtypeGroup(annSubtype(a)) || "ILAKKANAM"; }
function learnerErrors(d) {
  return (d.annotations || []).filter((a) => (a.kind || "error") === "error" && (a.origin || "learner_error") === "learner_error");
}
function docWordCount(d) {
  if (d._words == null) d._words = countWords(d.text || "");
  return d._words;
}
function wordsOf(docs) { return docs.reduce((s, d) => s + docWordCount(d), 0); }
function errorsOf(docs) { return docs.flatMap((d) => learnerErrors(d).map((a) => ({ doc: d, a }))); }
function per100(n, words) { return words ? (100 * n) / words : 0; }
function fmtRate(n, words) { return words ? per100(n, words).toFixed(1) : "—"; }
function groupTa(g) { return groupInfo(g)?.ta || g; }
function groupEn(g) { return groupInfo(g)?.en || ""; }
function hasSample(docs = corpus) { return docs.some((d) => d.sample); }

function sampleBannerHtml(docs = corpus) {
  if (!hasSample(docs)) return "";
  return `<div class="sample-banner"><strong>Sample data.</strong> These figures come from the QA test script and its answer key
    (plus a few demo texts), not from real learners. They are replaced automatically once real records are saved.</div>`;
}
function thinDataNote(words, docs) {
  return words < MIN_WORDS_FOR_RATE || docs < 3
    ? `<div class="small muted thin-note">Only ${docs} text${docs === 1 ? "" : "s"} / ${words.toLocaleString()} words — too little for firm conclusions.</div>` : "";
}

/* ---------- small visual building blocks ---------- */
function groupCounts(rows) {
  const c = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0]));
  rows.forEach(({ a }) => { c[annGroup(a)] = (c[annGroup(a)] || 0) + 1; });
  return c;
}
function stackedBar(counts, scaleMax) {
  const total = GROUP_ORDER.reduce((s, g) => s + (counts[g] || 0), 0);
  if (!total) return '<div class="stack empty-stack"></div>';
  return `<div class="stack" style="width:${Math.max(4, (total / (scaleMax || total)) * 100)}%">${GROUP_ORDER.map((g) => counts[g]
    ? `<span class="seg g-${g.toLowerCase()}" style="flex:${counts[g]}" title="${escapeHtml(groupTa(g))}: ${counts[g]}"></span>` : "").join("")}</div>`;
}
function groupLegendHtml() {
  return `<div class="s4-legend small">${GROUP_ORDER.map((g) => `<span class="lg g-${g.toLowerCase()}">${escapeHtml(groupTa(g))}</span>`).join("")}</div>`;
}
function hbarRows(rows, { unit = "", decimals = 0, colorOf = null } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar-row">
      <span class="hbar-label">${r.labelHtml || escapeHtml(r.label)}</span>
      <span class="hbar-track"><span class="hbar-fill ${colorOf ? colorOf(r) : ""}" style="width:${(r.value / max) * 100}%"></span></span>
      <strong class="hbar-val">${Number(r.value).toFixed(decimals)}${unit}</strong>
    </div>`).join("")}</div>`;
}

/* ---------- Dashboard ---------- */
function renderDashboardV2() {
  const docs = corpus;
  const words = wordsOf(docs);
  const errs = errorsOf(docs);
  $("statDocs").textContent = docs.length;
  $("statWords").textContent = words.toLocaleString();
  $("statAnnotations").textContent = errs.length;
  $("statLevels").textContent = words ? per100(errs.length, words).toFixed(1) : "—";

  const banner = $("dashSampleBanner");
  if (banner) banner.innerHTML = sampleBannerHtml(docs);

  // levels: texts, words, errors / 100 words, profile
  const maxRate = Math.max(0.1, ...LEVEL_ORDER.map((l) => { const ld = docsFor(l); return per100(errorsOf(ld).length, wordsOf(ld)); }));
  $("levelBreakdown").innerHTML = `
    <div class="lvl-table">
      <div class="lvl-row head"><span>Level</span><span>Texts</span><span>Words</span><span>Errors / 100 words</span></div>
      ${LEVEL_ORDER.map((l) => {
        const ld = docsFor(l); const w = wordsOf(ld); const e = errorsOf(ld);
        return `<div class="lvl-row ${ld.length ? "" : "none"} ${w && w < MIN_WORDS_FOR_RATE ? "thin" : ""}" ${w && w < MIN_WORDS_FOR_RATE ? 'title="Fewer than 150 words: not reliable"' : ""}><span>${escapeHtml(levelLabel(l))}</span><span>${ld.length}</span>
          <span>${w.toLocaleString()}</span>
          <span class="lvl-rate">${w ? stackedBar(groupCounts(e), (maxRate * w) / 100) : ""}<b>${fmtRate(e.length, w)}</b></span></div>`;
      }).join("")}
    </div>`;

  // error types on the Tamil taxonomy
  const gc = groupCounts(errs);
  const bySub = {};
  errs.forEach(({ a }) => { const s = annSubtype(a); bySub[s] = (bySub[s] || 0) + 1; });
  $("annotationBreakdown").innerHTML = errs.length ? `
    ${GROUP_ORDER.map((g) => {
      const subs = Object.entries(bySub).filter(([s]) => subtypeGroup(s) === g).sort((x, y) => y[1] - x[1]);
      return `<div class="grp-block">
        <div class="grp-head"><span class="lg g-${g.toLowerCase()}">${escapeHtml(groupTa(g))}</span>
          <span class="small muted">${escapeHtml(groupEn(g))}</span><strong>${gc[g]}</strong></div>
        ${subs.length ? `<div class="grp-subs small">${subs.slice(0, 4).map(([s, n]) =>
          `<span class="tamil">${escapeHtml(subtypeLabel(s))}</span> <b>${n}</b>`).join(" · ")}</div>` : ""}
      </div>`;
    }).join("")}` : '<div class="empty">No annotated errors yet.</div>';

  // coverage: level × task
  const tasks = [...new Set(docs.map((d) => d.task).filter(Boolean))].sort();
  const cov = $("coverageMatrix");
  if (cov) cov.innerHTML = tasks.length ? `
    <div class="table-wrap"><table class="table cov-table">
      <thead><tr><th>Task type</th>${LEVEL_ORDER.map((l) => `<th>${escapeHtml(l)}</th>`).join("")}<th>Total</th></tr></thead>
      <tbody>${tasks.map((t) => `<tr><td>${escapeHtml(t)}</td>${LEVEL_ORDER.map((l) => {
        const n = docs.filter((d) => d.task === t && d.level === l).length;
        return `<td class="${n ? "has" : "gap"}">${n || "·"}</td>`;
      }).join("")}<td><b>${docs.filter((d) => d.task === t).length}</b></td></tr>`).join("")}</tbody>
    </table></div>
    <div class="small muted">Empty cells are gaps in the corpus: no scripts yet for that level and task.</div>` : '<div class="empty">No texts yet.</div>';

  const recent = $("recentRecords");
  if (recent) {
    const rows = docs.filter((d) => !d.sample).slice().sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || ""))).slice(0, 6);
    recent.innerHTML = rows.length ? rows.map((d) => `<div class="metric-row"><button type="button" class="linkbtn" onclick="openDocument('${escapeHtml(d.id)}')">${escapeHtml(d.id)}</button>
      <span class="small muted">${docWordCount(d)} words · ${learnerErrors(d).length} errors${d.saved_at ? ` · ${escapeHtml(new Date(d.saved_at).toLocaleDateString())}` : ""}</span></div>`).join("")
      : '<div class="empty">No real records saved yet.</div>';
  }
}

/* ---------- Analyze: error concordance ---------- */
const concFilters = { group: "", subtype: "", task: "", year: "" };

function locateAnnotation(d, a) {
  const text = d.text || "";
  if (Number.isInteger(a.start) && text.slice(a.start, a.end) === a.text) return [a.start, a.end];
  const i = a.text ? text.indexOf(a.text) : -1;
  return i >= 0 ? [i, i + a.text.length] : null;
}
function concordanceRows(docs, query = "") {
  const q = normalizeTamilText(query).trim();
  return errorsOf(docs).filter(({ doc, a }) =>
    (!concFilters.group || annGroup(a) === concFilters.group) &&
    (!concFilters.subtype || annSubtype(a) === concFilters.subtype) &&
    (!concFilters.task || doc.task === concFilters.task) &&
    (!concFilters.year || String(doc.year) === concFilters.year) &&
    (!q || (a.text || "").includes(q) || (a.suggested || "").includes(q))
  ).map(({ doc, a }) => {
    const pos = locateAnnotation(doc, a);
    const text = doc.text || "";
    // whole words only at the edges of the context window
    let left = pos ? text.slice(Math.max(0, pos[0] - 50), pos[0]).replace(/\s+/g, " ") : "";
    let right = pos ? text.slice(pos[1], pos[1] + 50).replace(/\s+/g, " ") : "";
    if (pos && pos[0] > 50) left = "… " + left.replace(/^\S*\s/, "");
    if (pos && pos[1] + 50 < text.length) right = right.replace(/\s\S*$/, "") + " …";
    return { doc, a, left, right, subtype: annSubtype(a), group: annGroup(a) };
  });
}
function renderErrorConcordanceTool(docs, query) {
  const all = errorsOf(docs);
  const tasks = [...new Set(docs.map((d) => d.task).filter(Boolean))].sort();
  const years = [...new Set(docs.map((d) => String(d.year || "")).filter(Boolean))].sort();
  const subtypes = Object.keys(TAMIL_SUBTYPES).filter((s) => !concFilters.group || subtypeGroup(s) === concFilters.group);
  const rows = concordanceRows(docs, query);
  const opt = (v, label, cur) => `<option value="${escapeHtml(v)}" ${v === cur ? "selected" : ""}>${escapeHtml(label)}</option>`;
  return `
    <div class="conc-filters">
      <label>Group <select data-conc="group">${opt("", "All groups", concFilters.group)}${GROUP_ORDER.map((g) => opt(g, `${groupTa(g)} · ${groupEn(g)}`, concFilters.group)).join("")}</select></label>
      <label>Error type <select data-conc="subtype" class="tamil">${opt("", "All types", concFilters.subtype)}${subtypes.map((s) => opt(s, `${TAMIL_SUBTYPES[s].ta} — ${TAMIL_SUBTYPES[s].en}`, concFilters.subtype)).join("")}</select></label>
      <label>Task <select data-conc="task">${opt("", "All tasks", concFilters.task)}${tasks.map((t) => opt(t, t, concFilters.task)).join("")}</select></label>
      <label>Year <select data-conc="year">${opt("", "All years", concFilters.year)}${years.map((y) => opt(y, y, concFilters.year)).join("")}</select></label>
      <button type="button" data-conc-csv ${rows.length ? "" : "disabled"}>Download CSV</button>
    </div>
    <div class="small">${rows.length} of ${all.length} annotated error${all.length === 1 ? "" : "s"}${query ? ` matching <span class="tamil">“${escapeHtml(query)}”</span>` : ""}. Level is chosen with the tabs above.</div>
    ${rows.length ? `<div class="table-wrap"><table class="table conc-table">
      <thead><tr><th>Text</th><th class="conc-left">Before</th><th>Learner form → correction</th><th>After</th><th>Type</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><button type="button" class="linkbtn" onclick="openDocument('${escapeHtml(r.doc.id)}')">${escapeHtml(r.doc.id)}</button>
          <div class="small muted">${escapeHtml(r.doc.level || "")}${r.doc.task ? ` · ${escapeHtml(r.doc.task)}` : ""}</div></td>
        <td class="tamil conc-left">${escapeHtml(r.left)}</td>
        <td class="tamil conc-key"><mark class="a-mark g-${r.group.toLowerCase()}">${escapeHtml(r.a.text || "∅")}</mark> → <b>${escapeHtml(r.a.suggested || "∅")}</b></td>
        <td class="tamil">${escapeHtml(r.right)}</td>
        <td><span class="lg g-${r.group.toLowerCase()} tamil">${escapeHtml(TAMIL_SUBTYPES[r.subtype]?.ta || r.subtype)}</span></td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty">No annotated errors match these filters.</div>`}`;
}
function wireErrorConcordance(rerender) {
  document.querySelectorAll("[data-conc]").forEach((sel) => sel.addEventListener("change", () => {
    concFilters[sel.dataset.conc] = sel.value;
    if (sel.dataset.conc === "group" && concFilters.subtype && subtypeGroup(concFilters.subtype) !== sel.value) concFilters.subtype = "";
    rerender();
  }));
  document.querySelector("[data-conc-csv]")?.addEventListener("click", () => {
    const rows = concordanceRows(docsFor(analyzeLevel), $("analyzeSearch").value.trim());
    const head = ["record_id", "level", "year", "task", "group", "group_ta", "subtype", "subtype_ta", "learner_form", "correction",
                  "left_context", "right_context", "tag_source", "detection_tier", "gate_reason", "sample"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.join(",")].concat(rows.map((r) => [r.doc.id, r.doc.level, r.doc.year, r.doc.task, r.group, groupTa(r.group),
      r.subtype, TAMIL_SUBTYPES[r.subtype]?.ta, r.a.text, r.a.suggested, r.left, r.right, r.a.tag_source, r.a.detection_tier,
      r.a.gate_reason, r.doc.sample ? "yes" : "no"].map(esc).join(","))).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `error-concordance-${analyzeLevel || "all"}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/* ---------- Insights ---------- */
const TA_GRAPHEME = /\p{L}\p{M}*/gu;
function confusionOf(a) {
  const w = a.text || "", c = a.suggested || "";
  if (!w || !c || w === c) return null;
  const g1 = w.match(TA_GRAPHEME) || [], g2 = c.match(TA_GRAPHEME) || [];
  if (g1.length === g2.length) {
    const diffs = g1.map((x, i) => [x, g2[i]]).filter(([x, y]) => x !== y);
    if (diffs.length === 1) return `${diffs[0][0]} → ${diffs[0][1]}`;
  }
  if (c.startsWith(w) && c.length - w.length <= 2) return `+ ${c.slice(w.length)} (added)`;
  if (w.startsWith(c) && w.length - c.length <= 2) return `− ${w.slice(c.length)} (removed)`;
  return null;
}

function insightOverviewHtml(docs) {
  const words = wordsOf(docs), errs = errorsOf(docs), gc = groupCounts(errs);
  const tasks = new Set(docs.map((d) => d.task).filter(Boolean)).size;
  return `${sampleBannerHtml(docs)}
    <div class="insight-grid">
      <div class="insight-card"><span>Learner texts</span><strong>${docs.length}</strong></div>
      <div class="insight-card"><span>Total words</span><strong>${words.toLocaleString()}</strong></div>
      <div class="insight-card"><span>Errors annotated</span><strong>${errs.length}</strong></div>
      <div class="insight-card"><span>Errors / 100 words</span><strong>${fmtRate(errs.length, words)}</strong></div>
      <div class="insight-card"><span>Task types</span><strong>${tasks}</strong></div>
      <div class="insight-card"><span>Error-free texts</span><strong>${docs.filter((d) => !learnerErrors(d).length).length}</strong></div>
    </div>
    ${thinDataNote(words, docs.length)}
    ${errs.length ? `<div class="insight-panels">
      <div class="panel"><h3>Errors by group <span class="small muted">per 100 words</span></h3>
        ${hbarRows(GROUP_ORDER.map((g) => ({ labelHtml: `<span class="tamil">${escapeHtml(groupTa(g))}</span> <span class="small muted">${escapeHtml(groupEn(g))}</span>`,
          value: per100(gc[g], words), g })), { decimals: 2, colorOf: (r) => `g-${r.g.toLowerCase()}` })}</div>
      <div class="panel"><h3>Most frequent error types</h3>${insightTopSubtypes(errs, words, 8)}</div>
    </div>` : '<div class="empty">No annotated errors yet. Annotate and save a script to see its error profile.</div>'}`;
}
function insightTopSubtypes(errs, words, n) {
  const c = {};
  errs.forEach(({ a }) => { const s = annSubtype(a); c[s] = (c[s] || 0) + 1; });
  const rows = Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, n)
    .map(([s, v]) => ({ labelHtml: `<span class="tamil">${escapeHtml(TAMIL_SUBTYPES[s].ta)}</span> <span class="small muted">${escapeHtml(TAMIL_SUBTYPES[s].en)}</span>`,
      value: v, s }));
  return hbarRows(rows, { colorOf: (r) => `g-${subtypeGroup(r.s).toLowerCase()}` });
}

function insightLevelsHtml() {
  const lv = LEVEL_ORDER.map((l) => { const d = docsFor(l); const w = wordsOf(d); const e = errorsOf(d); return { l, d, w, e, gc: groupCounts(e) }; });
  const maxRate = Math.max(0.1, ...lv.map((x) => per100(x.e.length, x.w)));
  const tasks = [...new Set(corpus.map((d) => d.task).filter(Boolean))].sort();
  const taskRows = tasks.map((t) => { const d = corpus.filter((x) => x.task === t); const w = wordsOf(d); const e = errorsOf(d); return { t, d, w, e, gc: groupCounts(e) }; });
  const maxT = Math.max(0.1, ...taskRows.map((x) => per100(x.e.length, x.w)));
  const row = (label, x, max) => `<div class="prof-row ${x.d.length ? "" : "none"} ${x.w && x.w < MIN_WORDS_FOR_RATE ? "thin" : ""}" ${x.w && x.w < MIN_WORDS_FOR_RATE ? 'title="Fewer than 150 words: not reliable"' : ""}>
      <span class="prof-label">${escapeHtml(label)}<span class="small muted">${x.d.length} text${x.d.length === 1 ? "" : "s"} · ${x.w.toLocaleString()} words</span></span>
      <span class="prof-bar">${x.w ? stackedBar(Object.fromEntries(GROUP_ORDER.map((g) => [g, per100(x.gc[g], x.w)])), max) : '<span class="small muted">no texts yet</span>'}</span>
      <strong>${fmtRate(x.e.length, x.w)}${x.w && x.w < MIN_WORDS_FOR_RATE ? '<span class="small muted few">few words</span>' : ""}</strong></div>`;
  return `${sampleBannerHtml()}
    <div class="panel"><h3>Error profile by level <span class="small muted">errors per 100 words, split by group</span></h3>
      ${groupLegendHtml()}${lv.map((x) => row(levelLabel(x.l), x, maxRate)).join("")}
      <div class="small muted">Read the bars top to bottom to see how the error profile changes as learners progress. Levels with few words are unreliable.</div></div>
    <div class="panel"><h3>Error profile by task type</h3>
      ${taskRows.length ? taskRows.map((x) => row(x.t, x, maxT)).join("") : '<div class="empty">No task types yet.</div>'}
      <div class="small muted">Different genres produce different errors (e.g. situational writing → register; narrative → tense).</div></div>`;
}

function insightConfusionsHtml(docs) {
  const errs = errorsOf(docs);
  const pairs = {};
  errs.forEach(({ doc, a }) => {
    if (annGroup(a) !== "EZHUTHU") return;           // letter-level (எழுத்தியல்) errors only
    const k = confusionOf(a);
    if (!k) return;
    const s = annSubtype(a);
    const key = `${s}|${k}`;
    (pairs[key] ||= { s, k, n: 0, ex: [] }).n += 1;
    if (pairs[key].ex.length < 3) pairs[key].ex.push(`${a.text} → ${a.suggested}`);
  });
  const rows = Object.values(pairs).sort((x, y) => y.n - x.n).slice(0, 25);
  const words = errs.filter(({ a }) => a.text && a.suggested).reduce((m, { a }) => {
    const k = `${a.text} → ${a.suggested}`; m[k] = (m[k] || 0) + 1; return m; }, {});
  const repeat = Object.entries(words).filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1]).slice(0, 15);
  return `${sampleBannerHtml(docs)}
    <div class="insight-panels">
      <div class="panel"><h3>Letter-level confusions</h3>
        <div class="small muted">Which letter the learner wrote → which the standard form needs, from annotated corrections.</div>
        ${rows.length ? `<table class="table"><thead><tr><th>Change</th><th>Type</th><th>Count</th><th>Examples</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td class="tamil conf-key">${escapeHtml(r.k)}</td>
            <td><span class="lg g-${subtypeGroup(r.s).toLowerCase()} tamil">${escapeHtml(TAMIL_SUBTYPES[r.s].ta)}</span></td>
            <td><b>${r.n}</b></td><td class="tamil small">${r.ex.map(escapeHtml).join(" · ")}</td></tr>`).join("")}
        </tbody></table>` : '<div class="empty">No single-letter corrections yet.</div>'}</div>
      <div class="panel"><h3>Recurring misspelt words</h3>
        ${repeat.length ? `<table class="table"><tbody>${repeat.map(([k, n]) => `<tr><td class="tamil">${escapeHtml(k)}</td><td><b>${n}</b></td></tr>`).join("")}</tbody></table>`
          : '<div class="empty">No word is corrected the same way more than once yet.</div>'}</div>
    </div>`;
}

/* How the automatic detection performed, judged by the annotators' own decisions. */
function reviewItemsOf(docs) {
  return docs.flatMap((d) => (d.annotation_review || d.detection || []).map((r) => ({ doc: d, r })));
}
function insightDetectionHtml(docs) {
  const items = reviewItemsOf(docs).filter(({ r }) => (r.kind || "error") === "error");
  if (!items.length) return `${sampleBannerHtml(docs)}<div class="empty">No detection history yet. It is collected when scripts are annotated in step 4 and saved.</div>`;
  const manual = items.filter(({ r }) => (r.sources || []).includes("manual"));
  const auto = items.filter(({ r }) => !(r.sources || []).includes("manual"));
  const outcome = (r) => r.status === "accepted" ? "accepted" : r.status === "rejected" ? (r.origin === "ocr_error" ? "ocr" : "rejected") : "pending";
  const table = (keyOf, labelOf) => {
    const m = {};
    auto.forEach(({ r }) => [].concat(keyOf(r)).forEach((k) => { if (!k) return; (m[k] ||= { accepted: 0, rejected: 0, ocr: 0, pending: 0 })[outcome(r)] += 1; }));
    const rows = Object.entries(m).sort((x, y) => (y[1].accepted + y[1].rejected) - (x[1].accepted + x[1].rejected));
    return `<table class="table det-table"><thead><tr><th></th><th>Suggested</th><th>Accepted</th><th>Not an error</th><th>OCR error</th><th>Precision</th></tr></thead><tbody>
      ${rows.map(([k, v]) => { const decided = v.accepted + v.rejected + v.ocr; const tot = decided + v.pending;
        return `<tr><td>${escapeHtml(labelOf(k))}</td><td>${tot}</td><td>${v.accepted}</td><td>${v.rejected}</td><td>${v.ocr}</td>
          <td><b>${decided ? Math.round((100 * v.accepted) / decided) + "%" : "—"}</b></td></tr>`; }).join("")}</tbody></table>`;
  };
  const engineName = (k) => (typeof ENGINE_LABELS !== "undefined" && ENGINE_LABELS[k]) || k;
  const gateName = (k) => (typeof GATE_LABELS !== "undefined" && GATE_LABELS[k]) || k || "earlier detector";
  const acc = auto.filter(({ r }) => r.status === "accepted").length;
  const decided = auto.filter(({ r }) => r.status !== "pending").length;
  return `${sampleBannerHtml(docs)}
    <div class="insight-grid">
      <div class="insight-card"><span>Automatic suggestions</span><strong>${auto.length}</strong></div>
      <div class="insight-card"><span>Accepted by annotators</span><strong>${decided ? Math.round((100 * acc) / decided) + "%" : "—"}</strong></div>
      <div class="insight-card"><span>Errors the tools missed</span><strong>${manual.length}</strong></div>
      <div class="insight-card"><span>Recall of tools</span><strong>${acc + manual.length ? Math.round((100 * acc) / (acc + manual.length)) + "%" : "—"}</strong></div>
    </div>
    <div class="small muted">"Missed" = errors the annotator added by hand. Recall = accepted suggestions ÷ (accepted + missed).</div>
    <div class="insight-panels">
      <div class="panel"><h3>By reason shown</h3>${table((r) => r.gate_reason || (r.tier === "possible" ? "ai_discovery" : null), gateName)}</div>
      <div class="panel"><h3>By detector</h3>${table((r) => (r.sources || []).filter((s) => s !== "manual"), engineName)}</div>
    </div>`;
}

function renderInsightsV2(tool, docs) {
  if (tool === "intelligence") return renderIntelligence();     // intelligence.js
  if (tool === "overview") return insightOverviewHtml(docs);
  if (tool === "compare") return insightLevelsHtml();
  if (tool === "confusions") return insightConfusionsHtml(docs);
  if (tool === "detection") return insightDetectionHtml(docs);
  if (tool === "errors") {
    const errs = errorsOf(docs), words = wordsOf(docs);
    if (!errs.length) return '<div class="empty">No annotated errors yet.</div>';
    return `${sampleBannerHtml(docs)}${GROUP_ORDER.map((g) => {
      const ge = errs.filter(({ a }) => annGroup(a) === g);
      return `<div class="panel"><h3><span class="lg g-${g.toLowerCase()}">${escapeHtml(groupTa(g))}</span>
        <span class="small muted">${escapeHtml(groupEn(g))} · ${ge.length} error${ge.length === 1 ? "" : "s"} · ${fmtRate(ge.length, words)} per 100 words</span></h3>
        ${ge.length ? insightTopSubtypes(ge, words, 12) : '<div class="small muted">None annotated.</div>'}</div>`;
    }).join("")}`;
  }
  return null;
}

/* ---------- document dialog: annotated text ---------- */
function annotatedTextHtml(d) {
  const text = d.text || "";
  const spans = learnerErrors(d).map((a) => ({ a, pos: locateAnnotation(d, a) })).filter((x) => x.pos).sort((x, y) => x.pos[0] - y.pos[0]);
  let html = "", at = 0;
  spans.forEach(({ a, pos }) => {
    if (pos[0] < at) return;
    html += escapeHtml(text.slice(at, pos[0]));
    html += `<mark class="a-mark g-${annGroup(a).toLowerCase()}" title="${escapeHtml(TAMIL_SUBTYPES[annSubtype(a)]?.ta || "")} → ${escapeHtml(a.suggested || "")}">${escapeHtml(text.slice(pos[0], pos[1]))}</mark>`;
    at = pos[1];
  });
  return html + escapeHtml(text.slice(at));
}
