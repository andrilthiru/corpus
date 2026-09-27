/* =========================================================
   THEMOZHI — Stage 4: Error Annotation (v0.12)
   Original learner text | Corrected / annotated text + cards.
   One card per underlying error (overlapping detector spans are
   merged, all evidence kept). Tamil taxonomy is shared with
   automatic suggestions (taxonomy.js). Language FEATURES such as
   proverbs are tagged separately from errors.

   Relies on app.js globals: $, escapeHtml, normalizeTamilText,
   errorCandidates, draftAnnotations, scheduleDraftAutosave,
   consolidatedVerifiedText.
   ========================================================= */

let annotationItems = [];          // unified review list (errors + features)
let annotationFilter = "all";      // all | pending | accepted | rejected
let activeAnnotationId = null;
let previewPendingCorrections = false;
let annotationItemSeq = 0;

const ENGINE_LABELS = { iyal: "Iyal", ddspell_style: "DDSpell-style", sarvam: "Sarvam", gemini: "Gemini",
                        rules: "Rules", manual: "Manual", lexicon: "Feature lexicon", script: "Script check" };

function annotationText() {
  return normalizeTamilText(consolidatedVerifiedText() || $("verifiedText").value || "");
}
function newItemId() { annotationItemSeq += 1; return `A${Date.now().toString(36)}${annotationItemSeq}`; }
function isFeature(item) { return item.kind === "feature"; }
function itemGroup(item) { return isFeature(item) ? "FEATURE" : (subtypeGroup(item.subtype) || "NONE"); }
function itemTypeLabel(item) {
  return isFeature(item) ? (FEATURE_TYPES[item.feature]?.ta || "கூறு") : subtypeLabel(item.subtype);
}

/* ---------- locating spans in the verified text ---------- */
/* Tamil-aware boundaries: a match must not start or end inside a word, and must never cut a letter
   from its vowel sign / pulli (e.g. "மரம" must not match inside "மரம்"). Falls back to raw
   substring matches only when no whole-word match exists (e.g. a detector flagged a suffix). */
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const COMBINING = /\p{M}/u;
function occurrencesOf(text, form) {
  const f = normalizeTamilText(String(form || "")).trim();
  if (!f) return [];
  const raw = [];
  let i = text.indexOf(f);
  while (i >= 0) { raw.push([i, i + f.length]); i = text.indexOf(f, i + 1); }
  const clean = raw.filter(([s, e]) => !COMBINING.test(text[e] || "") && !COMBINING.test(text[s] || ""));
  const whole = clean.filter(([s, e]) =>
    !(WORD_CHAR.test(f[0]) && WORD_CHAR.test(text[s - 1] || "")) &&
    !(WORD_CHAR.test(f[f.length - 1]) && WORD_CHAR.test(text[e] || "")));
  return whole.length ? whole : clean;
}

/* Build review items from detector candidates: locate, then merge overlapping spans into one card. */
function itemsFromCandidates(candidates, text) {
  const placed = [];
  const taken = [];
  candidates.forEach((c) => {
    const occ = occurrencesOf(text, c.learner_form);
    const free = occ.find(([s, e]) => !taken.some((t) => t.form === c.learner_form && t.s === s)) || occ[0] || null;
    if (free) taken.push({ form: c.learner_form, s: free[0] });
    const subtype = inferSubtype(c);
    placed.push({
      id: newItemId(), kind: "error", status: "pending", origin: null,
      start: free ? free[0] : null, end: free ? free[1] : null, occurrences: occ,
      text: c.learner_form || "", suggested: c.suggested_correction || "",
      subtype, auto_subtype: subtype, note: c.note || "",
      sources: Array.isArray(c.engines) ? [...c.engines] : [],
      evidence: (Array.isArray(c.evidence) && c.evidence.length ? c.evidence : [{
        engines: c.engines || [], category: c.category, suggested_correction: c.suggested_correction, note: c.note
      }]).map((e) => ({ ...e, subtype: inferSubtype({ ...c, category: e.category, suggested_correction: e.suggested_correction }) })),
      agreement: Boolean(c.agreement)
    });
  });
  return mergeOverlappingItems(placed, text);
}

function mergeOverlappingItems(items, text) {
  const located = items.filter((i) => i.start != null).sort((a, b) => a.start - b.start || b.end - a.end);
  const unlocated = items.filter((i) => i.start == null);
  const clusters = [];
  for (const it of located) {
    const last = clusters[clusters.length - 1];
    if (last && it.kind === last[0].kind && it.start < Math.max(...last.map((x) => x.end))) last.push(it);
    else clusters.push([it]);
  }
  const merged = clusters.map((cl) => {
    if (cl.length === 1) return cl[0];
    // representative: most engines, then has a correction, then the shorter (more precise) span
    const rep = [...cl].sort((a, b) => (b.sources.length - a.sources.length) || (Boolean(b.suggested) - Boolean(a.suggested))
      || ((a.end - a.start) - (b.end - b.start)))[0];
    return {
      ...rep,
      sources: [...new Set(cl.flatMap((x) => x.sources))],
      evidence: cl.flatMap((x) => x.evidence.map((e) => ({ ...e, span: x.text }))),
      agreement: new Set(cl.flatMap((x) => x.sources.map((s) => (s === "ddspell_style" ? "iyal" : s)))).size >= 2,
      merged_spans: cl.map((x) => x.text)
    };
  });
  return merged.concat(unlocated);
}

/* ---------- automatic FEATURE suggestions (proverbs, quotations, code-mixing) ---------- */
function featureKey(s) {
  // compare ignoring spaces/punctuation and word-final ஒற்று (க்/ச்/த்/ப்) so "காலைப் போல" ≈ "காலை போல"
  return normalizeTamilText(s).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{M}]/gu, "").replace(/[கசதப]்$/, "")).join("");
}
function detectFeatureSuggestions(text) {
  const out = [];
  // map a compacted text back to original offsets
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ w: m[0], s: m.index, e: m.index + m[0].length }));
  const keys = words.map((x) => featureKey(x.w));
  PROVERB_SEED.forEach(({ text: prov, type }) => {
    const pk = featureKey(prov);
    const n = prov.split(/\s+/).length;
    for (let i = 0; i + n <= words.length; i++) {
      for (const len of [n - 1, n, n + 1]) {                  // tolerate one split/merged word
        if (len < 1 || i + len > words.length) continue;
        if (keys.slice(i, i + len).join("") === pk) {
          out.push({ id: newItemId(), kind: "feature", feature: type, status: "pending", origin: null,
                     start: words[i].s, end: words[i + len - 1].e, text: text.slice(words[i].s, words[i + len - 1].e),
                     suggested: "", note: `Matches: ${prov}`, sources: ["lexicon"], evidence: [] });
          i += len - 1;
          break;
        }
      }
    }
  });
  for (const m of text.matchAll(/[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)*/g)) {
    out.push({ id: newItemId(), kind: "feature", feature: "CODE_MIX", status: "pending", origin: null,
               start: m.index, end: m.index + m[0].length, text: m[0], suggested: "",
               note: "Latin-script word(s) in Tamil text", sources: ["script"], evidence: [] });
  }
  return out;
}

/* ---------- state sync with app.js ---------- */
function toAnnotationRecord(item) {
  const group = itemGroup(item);
  return {
    kind: item.kind,
    text: item.text,
    start: item.start, end: item.end,
    suggested: item.suggested || "",
    category: isFeature(item) ? "FEATURE" : (SUBTYPE_TO_LEGACY[item.subtype] || "OTHER"),   // legacy field (dashboard)
    subtype: isFeature(item) ? null : item.subtype,
    subtype_ta: isFeature(item) ? null : TAMIL_SUBTYPES[item.subtype]?.ta,
    feature: isFeature(item) ? item.feature : null,
    feature_ta: isFeature(item) ? FEATURE_TYPES[item.feature]?.ta : null,
    group: isFeature(item) ? null : group,
    group_ta: isFeature(item) ? null : groupInfo(group)?.ta,
    origin: item.origin || (isFeature(item) ? null : "learner_error"),
    auto_subtype: item.auto_subtype || null,
    note: item.note || "",
    source: item.sources.join("+") || "manual",
    evidence: item.evidence || []
  };
}
function syncDraftAnnotations() {
  draftAnnotations = annotationItems.filter((i) => i.status === "accepted").map(toAnnotationRecord);
}
function ensureAnnotationItems() {
  if (annotationItems.length || (!errorCandidates.length && !draftAnnotations.length)) return;
  // legacy drafts: rebuild from candidates + accepted annotations
  const text = annotationText();
  annotationItems = itemsFromCandidates(errorCandidates, text);
  draftAnnotations.forEach((a) => {
    const occ = occurrencesOf(text, a.text);
    annotationItems.push({ id: newItemId(), kind: a.kind || "error", status: "accepted", origin: a.origin || "learner_error",
      start: occ[0]?.[0] ?? null, end: occ[0]?.[1] ?? null, occurrences: occ, text: a.text, suggested: a.suggested || "",
      subtype: a.subtype || LEGACY_TO_SUBTYPE[a.category] || "GRAM_GEN", note: a.note || "",
      sources: String(a.source || "manual").split("+"), evidence: a.evidence || [] });
  });
}

/* ---------- rendering ---------- */
function markClass(item) {
  return `a-mark g-${itemGroup(item).toLowerCase()} s-${item.status} ${item.id === activeAnnotationId ? "active" : ""}`;
}
function renderOriginalText(text) {
  const items = annotationItems.filter((i) => i.start != null && i.status !== "rejected")
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let html = "", pos = 0;
  for (const it of items) {
    if (it.start < pos) continue;                   // nested/overlapping marks: first wins (cards still list all)
    html += escapeHtml(text.slice(pos, it.start));
    html += `<mark class="${markClass(it)}" data-annotation-id="${it.id}" title="${escapeHtml(itemTypeLabel(it))}">${escapeHtml(text.slice(it.start, it.end))}</mark>`;
    pos = it.end;
  }
  return html + escapeHtml(text.slice(pos));
}
function renderCorrectedText(text) {
  const apply = annotationItems.filter((i) => !isFeature(i) && i.start != null && i.suggested != null &&
    (i.status === "accepted" || (previewPendingCorrections && i.status === "pending")))
    .sort((a, b) => a.start - b.start);
  let html = "", pos = 0;
  for (const it of apply) {
    if (it.start < pos) continue;
    html += escapeHtml(text.slice(pos, it.start));
    const shown = it.suggested === "" ? "∅" : it.suggested;
    html += `<mark class="${markClass(it)} corrected" data-annotation-id="${it.id}" title="${escapeHtml(it.text)} → ${escapeHtml(it.suggested)}">${escapeHtml(shown)}</mark>`;
    pos = it.end;
  }
  return html + escapeHtml(text.slice(pos));
}

function evidenceHtml(item) {
  if (!item.evidence?.length) return "";
  return `<details class="a-evidence"><summary>Evidence · ${item.evidence.length} result${item.evidence.length > 1 ? "s" : ""}</summary>
    ${item.evidence.map((e) => `<div class="small a-evidence-row">
      <strong>${escapeHtml((e.engines || []).map((x) => ENGINE_LABELS[x] || x).join(" + ") || "detector")}</strong>
      · ${escapeHtml(e.category || "")}${e.subtype ? ` (${escapeHtml(subtypeLabel(e.subtype))})` : ""}
      ${e.span && e.span !== item.text ? ` · span <span class="tamil">${escapeHtml(e.span)}</span>` : ""}
      ${e.suggested_correction ? ` → <span class="tamil">${escapeHtml(e.suggested_correction)}</span>` : ""}
      ${e.note ? `<div class="a-evidence-note">${escapeHtml(e.note)}</div>` : ""}</div>`).join("")}
  </details>`;
}

function cardHtml(item, n) {
  const g = itemGroup(item);
  const active = item.id === activeAnnotationId;
  const statusLabel = { pending: "Pending", accepted: "Accepted", rejected: item.origin === "ocr_error" ? "Rejected · OCR error" : "Rejected · not an error" }[item.status];
  const typeSelect = isFeature(item)
    ? `<select data-a-type>${taxonomyOptionsHtml("FEAT:" + item.feature, { includeFeatures: true })}</select>`
    : `<select data-a-type>${taxonomyOptionsHtml(item.subtype, { includeFeatures: true })}</select>`;
  const occ = item.occurrences?.length > 1
    ? `<span class="small a-occ">occurrence ${item.occurrences.findIndex(([s]) => s === item.start) + 1} of ${item.occurrences.length}
         <button type="button" class="text-button" data-a-next-occ>next ›</button></span>` : "";
  return `<article class="a-card g-${g.toLowerCase()} s-${item.status} ${active ? "active" : ""}" data-annotation-card="${item.id}">
    <div class="a-card-head">
      <span class="a-num">${n}</span>
      <span class="tamil a-orig">${escapeHtml(item.text) || "<em>(insertion)</em>"}</span>
      ${isFeature(item) ? "" : `<span class="a-arrow">→</span><input class="tamil a-sugg" data-a-sugg value="${escapeHtml(item.suggested || "")}" placeholder="correction" />`}
      <span class="a-status">${statusLabel}</span>
    </div>
    <div class="a-card-meta">
      <span class="a-group-dot"></span>${typeSelect}
    </div>
    <div class="small a-prov">${item.sources.map((s) => `<span class="a-chip">${escapeHtml(ENGINE_LABELS[s] || s)}</span>`).join("")}
      ${item.agreement ? '<span class="a-chip agree">independent agreement</span>' : ""}
      ${item.auto_subtype && item.auto_subtype !== item.subtype && !isFeature(item) ? `<span class="a-chip">auto: ${escapeHtml(subtypeLabel(item.auto_subtype))}</span>` : ""}
      ${item.start == null ? '<span class="a-chip warn">not found in text</span>' : ""} ${occ}</div>
    ${active ? `${item.note ? `<div class="small a-note">${escapeHtml(item.note)}</div>` : ""}
      <label class="small a-note-edit hidden">Note <input data-a-note value="${escapeHtml(item.note || "")}" /></label>
      ${evidenceHtml(item)}` : ""}
    <div class="a-actions">
      <button type="button" class="primary-btn" data-a-accept>${isFeature(item) ? "Confirm" : "Accept"}</button>
      <button type="button" data-a-edit>Edit</button>
      ${isFeature(item) ? '<button type="button" data-a-reject="not_error">Reject</button>' :
        `<span class="a-reject-group"><button type="button" data-a-reject="not_error" title="The learner's form is correct">Not an error</button><button type="button" data-a-reject="ocr_error" title="Transcription mistake — fix it in Stage 3">OCR error</button></span>`}
      ${item.status !== "pending" ? '<button type="button" class="text-button" data-a-undo>Undo</button>' : ""}
    </div>
  </article>`;
}

function renderAnnotationCards() {
  const target = $("errorCandidateList");
  if (!target) return;
  const visible = annotationItems
    .filter((i) => annotationFilter === "all" || i.status === annotationFilter)
    .sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
  const counts = { all: annotationItems.length };
  ["pending", "accepted", "rejected"].forEach((s) => { counts[s] = annotationItems.filter((i) => i.status === s).length; });
  document.querySelectorAll("[data-a-filter]").forEach((b) => {
    b.classList.toggle("active", b.dataset.aFilter === annotationFilter);
    b.querySelector("span").textContent = counts[b.dataset.aFilter];
  });
  target.innerHTML = visible.length ? visible.map((it, i) => cardHtml(it, i + 1)).join("")
    : `<div class="empty">${annotationItems.length ? "Nothing in this filter." : "Run candidate detection, or select text on the left to annotate manually."}</div>`;

  target.querySelectorAll("[data-annotation-card]").forEach((card) => {
    const item = annotationItems.find((i) => i.id === card.dataset.annotationCard);
    if (!item) return;
    card.addEventListener("click", (ev) => { if (!ev.target.closest("button, input, select, summary, a")) selectAnnotation(item.id); });
    const read = () => {
      const t = card.querySelector("[data-a-type]")?.value || "";
      if (t.startsWith("FEAT:")) { item.kind = "feature"; item.feature = t.slice(5); }
      else if (t) { item.kind = "error"; item.subtype = t; }
      const sg = card.querySelector("[data-a-sugg]");
      if (sg) item.suggested = sg.value.trim();
      const nt = card.querySelector("[data-a-note]");
      if (nt) item.note = nt.value.trim();
    };
    card.querySelector("[data-a-type]")?.addEventListener("change", () => { read(); afterAnnotationChange(); });
    card.querySelector("[data-a-sugg]")?.addEventListener("change", () => { read(); afterAnnotationChange(false); });
    card.querySelector("[data-a-accept]").addEventListener("click", () => {
      read(); item.status = "accepted"; item.origin = isFeature(item) ? null : "learner_error";
      afterAnnotationChange(); selectNextPending(item.id);
    });
    card.querySelectorAll("[data-a-reject]").forEach((b) => b.addEventListener("click", () => {
      read(); item.status = "rejected"; item.origin = b.dataset.aReject;
      afterAnnotationChange(); selectNextPending(item.id);
    }));
    card.querySelector("[data-a-edit]").addEventListener("click", () => {
      selectAnnotation(item.id);
      const c = document.querySelector(`[data-annotation-card="${item.id}"]`);
      c?.querySelector(".a-note-edit")?.classList.remove("hidden");
      (c?.querySelector("[data-a-sugg]") || c?.querySelector("[data-a-type]"))?.focus();
    });
    card.querySelector("[data-a-undo]")?.addEventListener("click", () => { item.status = "pending"; item.origin = null; afterAnnotationChange(); });
    card.querySelector("[data-a-next-occ]")?.addEventListener("click", () => {
      const k = item.occurrences.findIndex(([s]) => s === item.start);
      const [s, e] = item.occurrences[(k + 1) % item.occurrences.length];
      item.start = s; item.end = e;
      afterAnnotationChange();
    });
  });
}

function renderAnnotationTexts() {
  const text = annotationText();
  const o = $("s4Original"), c = $("s4Corrected");
  if (!o || !c) return;
  o.innerHTML = renderOriginalText(text) || '<span class="empty">No verified text.</span>';
  c.innerHTML = renderCorrectedText(text);
  [o, c].forEach((el) => el.querySelectorAll("[data-annotation-id]").forEach((m) =>
    m.addEventListener("click", () => selectAnnotation(m.dataset.annotationId, { fromText: true }))));
}

function renderAnnotationWorkspace() {
  ensureAnnotationItems();
  const text = annotationText();
  const hidden = $("annotationSourceText");
  if (hidden) hidden.value = text;
  renderAnnotationTexts();
  renderAnnotationCards();
  syncDraftAnnotations();
  const errs = annotationItems.filter((i) => !isFeature(i));
  const feats = annotationItems.filter(isFeature);
  const pend = annotationItems.filter((i) => i.status === "pending").length;
  $("annotationStatus").textContent = annotationItems.length
    ? `${errs.filter((i) => i.status === "accepted").length} errors · ${feats.filter((i) => i.status === "accepted").length} features accepted · ${pend} pending`
    : "Ready for review";
}
function renderErrorCandidates() { renderAnnotationWorkspace(); }   // legacy name used by app.js
function renderDraftAnnotations() { syncDraftAnnotations(); }       // accepted list now lives in the cards

function afterAnnotationChange(rerenderCards = true) {
  syncDraftAnnotations();
  renderAnnotationTexts();
  if (rerenderCards) renderAnnotationCards();
  const pend = annotationItems.filter((i) => i.status === "pending").length;
  $("annotationStatus").textContent = `${draftAnnotations.filter((a) => a.kind !== "feature").length} errors · ${draftAnnotations.filter((a) => a.kind === "feature").length} features accepted · ${pend} pending`;
  scheduleDraftAutosave();
}
function selectAnnotation(id, { fromText = false } = {}) {
  activeAnnotationId = id;
  const item = annotationItems.find((i) => i.id === id);
  if (item && annotationFilter !== "all" && item.status !== annotationFilter) annotationFilter = "all";
  renderAnnotationTexts();
  renderAnnotationCards();
  requestAnimationFrame(() => {
    document.querySelector(`[data-annotation-card="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!fromText) document.querySelector(`#s4Original [data-annotation-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}
function selectNextPending(afterId) {
  const list = annotationItems.slice().sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
  const i = list.findIndex((x) => x.id === afterId);
  const next = list.slice(i + 1).find((x) => x.status === "pending") || list.find((x) => x.status === "pending");
  if (next) selectAnnotation(next.id);
}

/* ---------- manual annotation from a text selection ---------- */
function selectionOffsetsIn(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return end > start ? { start, end, rect: range.getBoundingClientRect() } : null;
}
function showSelectionTools() {
  const box = $("s4Original");
  const tools = $("s4SelectionTools");
  const off = box && selectionOffsetsIn(box);
  if (!off) { tools?.classList.add("hidden"); return; }
  const text = annotationText();
  // trim surrounding whitespace from the selection
  let { start, end } = off;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  tools.dataset.start = start; tools.dataset.end = end;
  tools.querySelector(".s4-sel-text").textContent = text.slice(start, end).slice(0, 40);
  const host = box.closest(".s4-textcol").getBoundingClientRect();
  tools.style.left = `${Math.max(0, off.rect.left - host.left)}px`;
  tools.style.top = `${off.rect.bottom - host.top + 6}px`;
  tools.classList.remove("hidden");
}
function addManualItem(kind) {
  const tools = $("s4SelectionTools");
  const start = Number(tools.dataset.start), end = Number(tools.dataset.end);
  const text = annotationText();
  const item = { id: newItemId(), kind, status: "pending", origin: null, start, end,
    occurrences: [[start, end]], text: text.slice(start, end), suggested: kind === "error" ? text.slice(start, end) : "",
    subtype: kind === "error" ? "EZ_GEN" : null, feature: kind === "feature" ? "PROVERB" : null,
    note: "", sources: ["manual"], evidence: [] };
  annotationItems.push(item);
  tools.classList.add("hidden");
  window.getSelection()?.removeAllRanges();
  annotationFilter = "all";
  afterAnnotationChange();
  selectAnnotation(item.id);
  requestAnimationFrame(() => {
    const c = document.querySelector(`[data-annotation-card="${item.id}"]`);
    (c?.querySelector("[data-a-sugg]") || c?.querySelector("[data-a-type]"))?.focus();
  });
}

/* ---------- detection ---------- */
async function runErrorDetection() {
  if (errorDetectionRunning) return;
  const text = annotationText().trim();
  if (!text) { alert("No verified learner text is available."); return; }
  const base = ocrApiUrl();
  if (!base) { alert("Backend is not configured."); return; }
  if (annotationItems.some((i) => i.status !== "pending") &&
      !confirm("Re-running detection keeps your accepted/rejected decisions and manual items, and replaces pending suggestions. Continue?")) return;

  errorDetectionRunning = true;
  $("runErrorDetectionBtn").disabled = true;
  $("errorDetectionStatus").textContent = "Running Iyal + DDSpell-style + Sarvam + Gemini + rules…";
  $("annotationStatus").textContent = "Detecting…";
  try {
    const response = await fetch(`${base}/api/detect-errors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, level: $("uploadLevel").value, task: $("uploadTask").value })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail || `Error detector returned HTTP ${response.status}`);

    errorCandidates = Array.isArray(payload?.candidates) ? payload.candidates.map((c) => ({ ...c, review_status: "PENDING" })) : [];
    const keep = annotationItems.filter((i) => i.status !== "pending" || i.sources.includes("manual"));
    const fresh = itemsFromCandidates(errorCandidates, text).concat(detectFeatureSuggestions(text))
      .filter((n) => !keep.some((k) => k.start != null && n.start != null && n.start < k.end && n.end > k.start && k.kind === n.kind));
    annotationItems = keep.concat(fresh);

    const engineText = Object.entries(payload?.engines || {}).map(([n, info]) => `${ENGINE_LABELS[n] || n}: ${info.ok ? "ok" : "unavailable"}`).join(" · ");
    const errorsN = fresh.filter((i) => !isFeature(i)).length, featN = fresh.filter(isFeature).length;
    $("errorDetectionStatus").textContent = `${errorCandidates.length} detector result(s) → ${errorsN} error card(s), ${featN} feature suggestion(s) · ${engineText}`;
    const failures = Object.entries(payload?.engines || {}).filter(([, i]) => !i?.ok).map(([n, i]) => `${n}: ${i?.error || "unavailable"}`);
    let diag = $("engineDiagnostics");
    if (!diag) { diag = document.createElement("div"); diag.id = "engineDiagnostics"; diag.className = "engine-diagnostics small"; $("errorDetectionStatus").insertAdjacentElement("afterend", diag); }
    diag.innerHTML = failures.length ? `<details><summary>Engine diagnostics (${failures.length})</summary><pre>${escapeHtml(failures.join("\n\n"))}</pre></details>` : "";
    activeAnnotationId = null;
    renderAnnotationWorkspace();
    const first = annotationItems.filter((i) => i.status === "pending").sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9))[0];
    if (first) selectAnnotation(first.id);
    scheduleDraftAutosave();
  } catch (error) {
    $("errorDetectionStatus").textContent = `Detection failed: ${error.message}`;
    $("annotationStatus").textContent = "Detection error";
  } finally {
    errorDetectionRunning = false;
    $("runErrorDetectionBtn").disabled = false;
  }
}

function runFeatureScanOnly() {
  const text = annotationText();
  const fresh = detectFeatureSuggestions(text).filter((n) => !annotationItems.some((k) => isFeature(k) && k.start === n.start && k.end === n.end));
  annotationItems = annotationItems.concat(fresh);
  afterAnnotationChange();
  $("errorDetectionStatus").textContent = `${fresh.length} new feature suggestion(s) from the proverb/quotation list and script check.`;
}

function wireStage4() {
  document.querySelectorAll("[data-a-filter]").forEach((b) => b.addEventListener("click", () => {
    annotationFilter = b.dataset.aFilter; renderAnnotationCards();
  }));
  $("s4PreviewPending")?.addEventListener("change", (e) => { previewPendingCorrections = e.target.checked; renderAnnotationTexts(); });
  $("s4Original")?.addEventListener("mouseup", () => setTimeout(showSelectionTools, 0));
  $("s4Original")?.addEventListener("keyup", () => setTimeout(showSelectionTools, 0));
  document.addEventListener("mousedown", (ev) => {
    if (!ev.target.closest("#s4SelectionTools, #s4Original")) $("s4SelectionTools")?.classList.add("hidden");
  });
  $("s4AddError")?.addEventListener("click", () => addManualItem("error"));
  $("s4AddFeature")?.addEventListener("click", () => addManualItem("feature"));
  $("s4FeatureScan")?.addEventListener("click", runFeatureScanOnly);
}
