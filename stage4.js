/* =========================================================
   THEMOZHI — Stage 4: Error Annotation (v0.12)
   Original learner text | Corrected / annotated text + cards.
   One card per underlying error (overlapping detector spans are
   merged, all evidence kept). Tamil taxonomy is shared with
   automatic suggestions (taxonomy.js).

   Relies on app.js globals: $, escapeHtml, normalizeTamilText,
   errorCandidates, draftAnnotations, scheduleDraftAutosave,
   consolidatedVerifiedText.
   ========================================================= */

let annotationItems = [];          // unified review list of error cards
let annotationFilter = "pending";  // pending (default: reviewed cards drop out of the list) | all | accepted | rejected
let activeAnnotationId = null;
let previewPendingCorrections = false;
let annotationItemSeq = 0;
let annotationBaseText = null;     // the exact text error detection ran on (to spot later transcript edits)

const ENGINE_LABELS = { iyal: "Iyal", ddspell_style: "DDSpell-style", sarvam: "Sarvam", gemini: "Gemini", openai: "GPT",
                        rules: "Tamil rules", lexicon: "Dictionary neighbour", tamilvu: "TamilVU", vaani: "Vaani",
                        muril: "MuRIL", manual: "Manual" };
const GATE_LABELS = { mechanical_rule: "certain rule", agreement: "2 checks agree", ai_confirmed: "Sarvam confirmed",
                      unverified_rule: "rule · not AI-checked", ai_discovery: "AI suggestion" };

function annotationText() {
  // with a structured transcript, Stage 4 always shows its current text (never the original machine reading)
  const raw = importedTranscriptionReview ? consolidatedVerifiedText() : $("verifiedText").value;
  return normalizeTamilText(raw || "").trim();
}
function isInsertion(item) { return item.start != null && item.start === item.end && !item.text; }
function newItemId() { annotationItemSeq += 1; return `A${Date.now().toString(36)}${annotationItemSeq}`; }
function itemGroup(item) { return subtypeGroup(item.subtype) || "NONE"; }
function itemTypeLabel(item) {
  return subtypeLabel(item.subtype);
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
    const exact = Number.isInteger(c.start) && text.slice(c.start, c.end) === c.learner_form ? [c.start, c.end] : null;
    if (exact && !occ.some(([s]) => s === exact[0])) occ.push(exact);
    const free = exact || occ.find(([s, e]) => !taken.some((t) => t.form === c.learner_form && t.s === s)) || occ[0] || null;
    if (free) taken.push({ form: c.learner_form, s: free[0] });
    const subtype = inferSubtype(c);
    placed.push({
      id: newItemId(), kind: "error", status: "pending", origin: null,
      start: free ? free[0] : null, end: free ? free[1] : null, occurrences: occ,
      text: c.learner_form || "", suggested: c.suggested_correction || "",
      subtype, auto_subtype: subtype, note: c.note || "",
      tag_source: c.tag_source || (c.subtype ? "detector" : "browser_inference"),
      tag_confidence: c.tag_confidence || null,
      subtype_options: Array.isArray(c.subtype_options) ? c.subtype_options : [],
      sources: Array.isArray(c.engines) ? [...c.engines] : [],
      evidence: (Array.isArray(c.evidence) && c.evidence.length ? c.evidence : [{
        engines: c.engines || [], category: c.category, suggested_correction: c.suggested_correction, note: c.note
      }]).map((e) => ({ ...e, subtype: e.subtype || inferSubtype({ ...c, category: e.category, suggested_correction: e.suggested_correction }) })),
      agreement: Boolean(c.agreement),
      tier: c.tier || "likely", gate_reason: c.gate_reason || null
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
      tier: cl.some((x) => x.tier !== "possible") ? "likely" : "possible",
      merged_spans: cl.map((x) => x.text)
    };
  });
  return merged.concat(unlocated);
}

/* ---------- state sync with app.js ---------- */
function toAnnotationRecord(item) {
  const group = itemGroup(item);
  return {
    kind: item.kind,
    text: item.text,
    insertion: isInsertion(item) || undefined,
    start: item.start, end: item.end,
    suggested: item.suggested || "",
    category: SUBTYPE_TO_LEGACY[item.subtype] || "OTHER",   // legacy field (dashboard)
    subtype: item.subtype,
    subtype_ta: TAMIL_SUBTYPES[item.subtype]?.ta,
    group,
    group_ta: groupInfo(group)?.ta,
    origin: item.origin || "learner_error",
    auto_subtype: item.auto_subtype || null,
    subtype_changed_by_annotator: Boolean(item.auto_subtype && item.auto_subtype !== item.subtype),
    tag_source: item.tag_source || (item.sources.includes("manual") ? "annotator" : null),
    detection_tier: item.sources.includes("manual") ? "manual" : (item.tier || null),
    gate_reason: item.gate_reason || null,
    tag_confidence: item.tag_confidence || null,
    subtype_options: item.subtype_options || [],
    note: item.note || "",
    source: item.sources.join("+") || "manual",
    evidence: item.evidence || []
  };
}
function syncDraftAnnotations() {
  draftAnnotations = annotationItems.filter((i) => i.status === "accepted" && !i.stale).map(toAnnotationRecord);
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
    .sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
  let html = "", pos = 0;
  for (const it of items) {
    if (it.start < pos) continue;                   // nested/overlapping marks: first wins (cards still list all)
    html += escapeHtml(text.slice(pos, it.start));
    if (isInsertion(it)) {                         // missing word: a caret between words (drawn by CSS, adds no text)
      html += `<mark class="${markClass(it)} a-ins" data-annotation-id="${it.id}" title="Missing word${it.suggested ? `: ${escapeHtml(it.suggested)}` : ""}"></mark>`;
      pos = it.start; continue;
    }
    html += `<mark class="${markClass(it)}" data-annotation-id="${it.id}" title="${escapeHtml(itemTypeLabel(it))}">${escapeHtml(text.slice(it.start, it.end))}</mark>`;
    pos = it.end;
  }
  return html + escapeHtml(text.slice(pos));
}
function renderCorrectedText(text) {
  const apply = annotationItems.filter((i) => i.start != null && i.suggested != null &&
    (i.status === "accepted" || (previewPendingCorrections && i.status === "pending")))
    .sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
  let html = "", pos = 0;
  for (const it of apply) {
    if (it.start < pos) continue;
    html += escapeHtml(text.slice(pos, it.start));
    if (isInsertion(it)) {
      const pre = it.start > 0 && !/\s/.test(text[it.start - 1]) ? " " : "";
      const post = it.start < text.length && !/\s/.test(text[it.start]) ? " " : "";
      html += `${pre}<mark class="${markClass(it)} corrected a-ins-text" data-annotation-id="${it.id}" title="missing word added">${escapeHtml(it.suggested || "＋?")}</mark>${post}`;
      pos = it.start; continue;
    }
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

const TAG_SOURCE_LABELS = {
  rule: "rule", correction_analysis: "correction analysis", llm_consensus: "Sarvam + Gemini agree",
  llm: "single model", correction_analysis_weak: "correction analysis (weak)", default: "default mapping",
  detector: "detector", browser_inference: "inferred in browser"
};
function tagChip(item) {
  if (!item.tag_source || item.sources.includes("manual")) return "";
  const alts = [...new Set((item.subtype_options || []).map((o) => o.subtype).filter((c) => c && c !== item.auto_subtype))];
  const title = (item.subtype_options || []).map((o) => `${o.proposed_by}: ${o.subtype_ta || o.subtype}`).join("\n");
  return `<span class="a-chip tag-${escapeHtml(item.tag_confidence || "na")}" title="${escapeHtml(title)}">tag: ${escapeHtml(TAG_SOURCE_LABELS[item.tag_source] || item.tag_source)}${item.tag_confidence ? ` · ${escapeHtml(item.tag_confidence)}` : ""}</span>${
    alts.length ? `<span class="a-chip" title="${escapeHtml(title)}">also proposed: ${alts.map((c) => escapeHtml(subtypeLabel(c))).join(", ")}</span>` : ""}`;
}

function cardHtml(item, n) {
  const g = itemGroup(item);
  const active = item.id === activeAnnotationId;
  const statusLabel = { pending: "Pending", accepted: "Accepted", rejected: item.origin === "ocr_error" ? "Rejected · OCR error" : "Rejected · not an error" }[item.status];
  const typeSelect = `<select data-a-type>${taxonomyOptionsHtml(item.subtype)}</select>`;
  const occ = item.occurrences?.length > 1
    ? `<span class="small a-occ">occurrence ${item.occurrences.findIndex(([s]) => s === item.start) + 1} of ${item.occurrences.length}
         <button type="button" class="text-button" data-a-next-occ>next ›</button></span>` : "";
  return `<article class="a-card g-${g.toLowerCase()} s-${item.status} ${active ? "active" : ""} ${item.stale ? "stale" : ""} ${item.tier === "possible" ? "possible" : ""}" data-annotation-card="${item.id}">
    ${item.stale ? '<div class="a-stale small">No longer in the text (edited in the transcript). Not saved.</div>' : ""}
    <div class="a-card-head">
      <span class="a-num">${n}</span>
      <span class="tamil a-orig">${item.text ? escapeHtml(item.text) : `<em class="a-ins-label">missing word${insertionContext(item)}</em>`}</span>
      ${`<span class="a-arrow">→</span><input class="tamil a-sugg" data-a-sugg value="${escapeHtml(item.suggested || "")}" placeholder="${item.text ? "correction" : "word to add"}" />`}
      <span class="a-status">${statusLabel}</span>
    </div>
    <div class="a-card-meta">
      <span class="a-group-dot"></span>${typeSelect}
    </div>
    <div class="small a-prov">${item.sources.map((s) => `<span class="a-chip">${escapeHtml(ENGINE_LABELS[s] || s)}</span>`).join("")}
      ${item.tier === "possible" ? '<span class="a-chip possible">possible · AI only</span>' : ""}
      ${item.gate_reason && item.tier !== "possible" ? `<span class="a-chip gate">${escapeHtml(GATE_LABELS[item.gate_reason] || item.gate_reason)}</span>` : ""}
      ${item.agreement && item.gate_reason !== "agreement" ? '<span class="a-chip agree">independent agreement</span>' : ""}
      ${tagChip(item)}
      ${item.auto_subtype && item.auto_subtype !== item.subtype ? `<span class="a-chip">changed from auto: ${escapeHtml(subtypeLabel(item.auto_subtype))}</span>` : ""}
      ${item.start == null ? '<span class="a-chip warn">not found in text</span>' : ""} ${occ}</div>
    ${active ? `${item.note ? `<div class="small a-note">${escapeHtml(item.note)}</div>` : ""}
      <label class="small a-note-edit hidden">Note <input data-a-note value="${escapeHtml(item.note || "")}" /></label>
      ${evidenceHtml(item)}` : ""}
    <div class="a-actions">
      <button type="button" class="primary-btn" data-a-accept>Accept</button>
      <button type="button" data-a-edit>Edit</button>
      ${`<span class="a-reject-group"><button type="button" data-a-reject="not_error" title="The learner's form is correct">Not an error</button><button type="button" data-a-reject="ocr_error" title="Transcription mistake — fix it in Stage 3">OCR error</button></span>`}
      ${item.status !== "pending" ? '<button type="button" class="text-button" data-a-undo>Undo</button>' : ""}
      ${item.sources.includes("manual") ? '<button type="button" class="text-button a-delete" data-a-delete title="Remove this card you added">Delete</button>' : ""}
    </div>
  </article>`;
}

function insertionContext(item) {
  if (!isInsertion(item)) return "";
  const text = annotationText();
  const before = text.slice(0, item.start).trim().split(/\s+/).pop();
  const after = text.slice(item.end).trim().split(/\s+/)[0];
  if (before) return ` after <span class="tamil">${escapeHtml(before)}</span>`;
  return after ? ` before <span class="tamil">${escapeHtml(after)}</span>` : "";
}
function acceptProblem(item) {
  if (isInsertion(item) && !item.suggested) return "Type the missing word first.";
  if (item.kind === "error" && item.text && item.suggested === item.text) return "The correction is the same as the learner's text. Type the corrected form (or clear the box if the word should be deleted).";
  return "";
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
  const emptyMsg = !annotationItems.length
    ? (errorDetectionRunning ? "Detection is running…" : "No cards yet. Select words on the left to add an error, or click between two words to add a missing word.")
    : annotationFilter === "pending"
      ? "✓ All cards reviewed. Open <b>All</b> or <b>Accepted</b> to look at them again."
      : "Nothing in this filter.";
  target.innerHTML = visible.length ? visible.map((it, i) => cardHtml(it, i + 1)).join("")
    : `<div class="empty">${emptyMsg}</div>`;

  target.querySelectorAll("[data-annotation-card]").forEach((card) => {
    const item = annotationItems.find((i) => i.id === card.dataset.annotationCard);
    if (!item) return;
    card.addEventListener("click", (ev) => { if (!ev.target.closest("button, input, select, summary, a")) selectAnnotation(item.id); });
    const read = () => {
      const t = card.querySelector("[data-a-type]")?.value || "";
      if (t) item.subtype = t;
      const sg = card.querySelector("[data-a-sugg]");
      if (sg) item.suggested = sg.value.trim();
      const nt = card.querySelector("[data-a-note]");
      if (nt) item.note = nt.value.trim();
    };
    card.querySelector("[data-a-type]")?.addEventListener("change", () => { read(); afterAnnotationChange(); });
    card.querySelector("[data-a-sugg]")?.addEventListener("change", () => { read(); afterAnnotationChange(false); });
    card.querySelector("[data-a-accept]").addEventListener("click", () => {
      read();
      const problem = acceptProblem(item);
      if (problem) { alert(problem); card.querySelector("[data-a-sugg]")?.focus(); return; }
      item.status = "accepted"; item.origin = "learner_error";
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
    card.querySelector("[data-a-delete]")?.addEventListener("click", () => {
      annotationItems = annotationItems.filter((x) => x.id !== item.id);
      if (activeAnnotationId === item.id) activeAnnotationId = null;
      afterAnnotationChange();
    });
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

/* The transcript can change after detection (edits in Stage 3). Re-anchor every card to the CURRENT
   text so neither panel ever shows an old reading; cards whose words are gone are flagged, not shown. */
function relocateAnnotationItems(text) {
  let moved = 0, lost = 0;
  annotationItems.forEach((it) => {
    if (!it.text && it.anchor) {                   // missing-word card: re-find the gap by the words around it
      if (it.start != null && text.slice(Math.max(0, it.start - it.anchor.before.length), it.start) === it.anchor.before) { it.stale = false; return; }
      // try the text around the gap, widest first: 24 chars before, 24 after, then just the word before / after
      const wb = (it.anchor.before.trim().split(/\s+/).pop() || ""), wa = (it.anchor.after.trim().split(/\s+/)[0] || "");
      let cands = [];
      for (const [key, useEnd] of [[it.anchor.before, true], [it.anchor.after.trim() && it.anchor.after, false], [wb, true], [wa, false]]) {
        if (!key || !key.trim()) continue;
        // after the text before the gap → its end; before the text after the gap → its start (less a space)
        cands = occurrencesOf(text, key).map(([s0, e]) => useEnd ? e : Math.max(0, s0 - (/\s/.test(text[s0 - 1] || "") ? 1 : 0)));
        if (cands.length) break;
      }
      if (cands.length) {
        const p = cands.sort((a, b) => Math.abs(a - (it.start ?? 0)) - Math.abs(b - (it.start ?? 0)))[0];
        if (it.start != null && it.start !== p) moved++;
        it.start = p; it.end = p; it.occurrences = [[p, p]]; it.stale = false;
      } else { it.start = null; it.end = null; it.stale = true; lost++; }
      return;
    }
    if (it.start != null && text.slice(it.start, it.end) === it.text) { it.stale = false; return; }
    const occ = occurrencesOf(text, it.text);
    if (occ.length) {
      const near = occ.slice().sort((a, b) => Math.abs(a[0] - (it.start ?? 0)) - Math.abs(b[0] - (it.start ?? 0)))[0];
      if (it.start != null) moved++;
      it.start = near[0]; it.end = near[1]; it.occurrences = occ; it.stale = false;
    } else if (it.text) {
      it.start = null; it.end = null; it.occurrences = []; it.stale = true; lost++;
    }
  });
  return { moved, lost };
}
function renderStaleBanner(text) {
  const el = $("s4StaleBanner");
  if (!el) return;
  const changed = annotationBaseText != null && annotationBaseText.trim() !== text.trim();
  const lost = annotationItems.filter((i) => i.stale).length;
  if (!changed && !lost) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.innerHTML = `<span><strong>The transcript was edited after detection ran.</strong>
    ${lost ? `${lost} card${lost === 1 ? " refers" : "s refer"} to words that are no longer in the text and are set aside.` : "Cards have been re-matched to the new text."}
    Re-run detection to check the edited words.</span>
    <button type="button" class="primary-btn" data-s4-rerun>Re-run detection</button>`;
  el.querySelector("[data-s4-rerun]").addEventListener("click", runErrorDetection);
  el.classList.remove("hidden");
}

function renderUnreviewedNote() {
  const el = $("s4UnreviewedNote");
  if (!el) return;
  const n = importedTranscriptionReview
    ? reviewLines().filter((l) => l?.review?.include_in_corpus !== false && l?.review?.status !== "CONFIRMED").length : 0;
  el.classList.toggle("hidden", !n);
  el.innerHTML = n ? `${n} line${n === 1 ? " is" : "s are"} still open in the transcription step. They are included here as currently read;
    <button type="button" class="text-button" data-back-to-s3>finish them in step 3</button> if the reading is wrong.` : "";
  el.querySelector("[data-back-to-s3]")?.addEventListener("click", () => goUploadStep(3));
}

function renderAnnotationWorkspace() {
  ensureAnnotationItems();
  const text = annotationText();
  relocateAnnotationItems(text);
  renderStaleBanner(text);
  renderUnreviewedNote();
  const hidden = $("annotationSourceText");
  if (hidden) hidden.value = text;
  renderAnnotationTexts();
  renderAnnotationCards();
  syncDraftAnnotations();
  const accepted = annotationItems.filter((i) => i.status === "accepted").length;
  const pend = annotationItems.filter((i) => i.status === "pending").length;
  $("annotationStatus").textContent = annotationItems.length
    ? `${accepted} accepted · ${pend} pending`
    : "Ready for review";
}
function renderErrorCandidates() { renderAnnotationWorkspace(); }   // legacy name used by app.js
function renderDraftAnnotations() { syncDraftAnnotations(); }       // accepted list now lives in the cards

function afterAnnotationChange(rerenderCards = true) {
  syncDraftAnnotations();
  renderAnnotationTexts();
  if (rerenderCards) renderAnnotationCards();
  const pend = annotationItems.filter((i) => i.status === "pending").length;
  $("annotationStatus").textContent = `${draftAnnotations.length} accepted · ${pend} pending`;
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
/* A click (no selection) between words: the gap nearest to the caret. */
const TRAIL_PUNCT = /[.,!?;:”’"')\]]/;
function caretGapIn(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer)) return null;
  const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  if (node?.closest("mark.a-mark")) return null;   // clicks on a marked word open its card
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const text = annotationText();
  let p = pre.toString().length;
  // snap to the nearest word boundary (the gap before or after the word the caret landed in)
  const isW = (c) => c != null && WORD_CHAR.test(c);
  if (isW(text[p - 1]) && isW(text[p])) {
    let l = p, r = p;
    while (isW(text[l - 1])) l--;
    while (isW(text[r])) r++;
    p = (p - l) <= (r - p) ? l : r;
  }
  // keep punctuation with its word: "வந்தான்.|" rather than "வந்தான்|."
  while (p < text.length && TRAIL_PUNCT.test(text[p]) && !/\s/.test(text[p - 1] || " ")) p++;
  return { start: p, end: p, rect: range.getBoundingClientRect() };
}
function placeTools(tools, box, rect) {
  const host = box.closest(".s4-textcol").getBoundingClientRect();
  tools.style.left = `${Math.max(0, rect.left - host.left)}px`;
  tools.style.top = `${rect.bottom - host.top + 6}px`;
  tools.classList.remove("hidden");
}
function showSelectionTools() {
  const box = $("s4Original");
  const tools = $("s4SelectionTools");
  if (!box || !tools) return;
  const off = selectionOffsetsIn(box);
  const text = annotationText();
  if (!off) {
    const gap = caretGapIn(box);
    if (!gap || !text) { tools.classList.add("hidden"); return; }
    tools.dataset.start = gap.start; tools.dataset.end = gap.end; tools.dataset.mode = "gap";
    const before = text.slice(0, gap.start).trim().split(/\s+/).pop() || "";
    tools.querySelector(".s4-sel-text").textContent = before ? `after “${before.slice(0, 24)}”` : "at the start";
    $("s4AddError").classList.add("hidden");
    $("s4AddMissing").textContent = "+ Missing word here";
    placeTools(tools, box, gap.rect);
    return;
  }
  // trim surrounding whitespace from the selection
  let { start, end } = off;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  tools.dataset.start = start; tools.dataset.end = end; tools.dataset.mode = "range";
  $("s4AddError").classList.remove("hidden");
  $("s4AddMissing").textContent = "+ Missing word after";
  tools.querySelector(".s4-sel-text").textContent = text.slice(start, end).slice(0, 40);
  placeTools(tools, box, off.rect);
}
function addManualItem(kind = "error") {
  const tools = $("s4SelectionTools");
  const start = Number(tools.dataset.start), end = Number(tools.dataset.end);
  const text = annotationText();
  const item = { id: newItemId(), kind, status: "pending", origin: null, start, end,
    occurrences: [[start, end]], text: text.slice(start, end), suggested: text.slice(start, end),
    subtype: "EZ_GEN",
    note: "", sources: ["manual"], evidence: [] };
  annotationItems.push(item);
  tools.classList.add("hidden");
  window.getSelection()?.removeAllRanges();
  if (annotationFilter !== "all") annotationFilter = "pending";
  afterAnnotationChange();
  selectAnnotation(item.id);
  requestAnimationFrame(() => {
    const c = document.querySelector(`[data-annotation-card="${item.id}"]`);
    (c?.querySelector("[data-a-sugg]") || c?.querySelector("[data-a-type]"))?.focus();
  });
}

function addMissingWord() {
  const tools = $("s4SelectionTools");
  const text = annotationText();
  let p = Number(tools.dataset.mode === "gap" ? tools.dataset.start : tools.dataset.end);
  while (p < text.length && TRAIL_PUNCT.test(text[p]) && !/\s/.test(text[p - 1] || " ")) p++;
  const item = { id: newItemId(), kind: "error", status: "pending", origin: null, start: p, end: p,
    occurrences: [[p, p]], text: "", suggested: "", subtype: "MISSING",
    anchor: { before: text.slice(Math.max(0, p - 24), p), after: text.slice(p, p + 24) },
    note: "", sources: ["manual"], evidence: [] };
  annotationItems.push(item);
  tools.classList.add("hidden");
  window.getSelection()?.removeAllRanges();
  if (annotationFilter !== "all") annotationFilter = "pending";
  afterAnnotationChange();
  selectAnnotation(item.id);
  requestAnimationFrame(() => document.querySelector(`[data-annotation-card="${item.id}"] [data-a-sugg]`)?.focus());
}

/* Detection runs by itself when the annotator arrives at this step: the first time, and again after the
   transcript has changed (accepted/rejected decisions and manual cards are kept). */
function maybeAutoDetect() {
  if (errorDetectionRunning || !ocrApiUrl()) return;
  const text = annotationText();
  if (!text) return;
  const never = annotationBaseText == null && !annotationItems.some((i) => !i.sources.includes("manual"));
  const changed = annotationBaseText != null && annotationBaseText.trim() !== text.trim();
  if (never || changed) runErrorDetection({ auto: true });
}

/* ---------- detection ---------- */
async function runErrorDetection(opts = {}) {
  const auto = opts && opts.auto === true;          // (from a click, opts is the click event)
  if (errorDetectionRunning) return;
  const text = annotationText().trim();
  if (!text) { if (!auto) alert("No verified learner text is available."); return; }
  const base = ocrApiUrl();
  if (!base) { if (!auto) alert("Backend is not configured."); return; }
  if (!auto && annotationItems.some((i) => i.status !== "pending") &&
      !confirm("Re-running detection keeps your accepted/rejected decisions and manual items, and replaces pending suggestions. Continue?")) return;

  errorDetectionRunning = true;
  $("runErrorDetectionBtn").disabled = true;
  $("errorDetectionStatus").textContent = `${auto ? "Checking automatically" : "Checking"}: Tamil rules, dictionary, morphology, TamilVU, MuRIL → Sarvam verifies… (about a minute). You can add your own cards meanwhile.`;
  renderAnnotationCards();
  $("annotationStatus").textContent = "Detecting…";
  try {
    const response = await fetch(`${base}/api/detect-errors`, {
      method: "POST", headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text, level: $("uploadLevel").value, task: $("uploadTask").value, mode: "standard" })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail || `Error detector returned HTTP ${response.status}`);

    annotationBaseText = text;
    // cards for words that were edited away are dropped on re-run (manual ones too: their words are gone)
    annotationItems = annotationItems.filter((i) => !i.stale);
    errorCandidates = Array.isArray(payload?.candidates) ? payload.candidates.map((c) => ({ ...c, review_status: "PENDING" })) : [];
    const keep = annotationItems.filter((i) => i.status !== "pending" || i.sources.includes("manual"));
    const fresh = itemsFromCandidates(errorCandidates, text)
      .filter((n) => !keep.some((k) => k.start != null && n.start != null && n.start < k.end && n.end > k.start && k.kind === n.kind));
    annotationItems = keep.concat(fresh);

    const engineText = Object.entries(payload?.engines || {}).map(([n, info]) => `${ENGINE_LABELS[n] || n}: ${info.ok ? "ok" : "unavailable"}`).join(" · ");
    const hidden = Number(payload?.suppressed || 0);
    $("errorDetectionStatus").textContent = `${fresh.length} error card(s)${hidden ? ` · ${hidden} weak flag(s) hidden (not confirmed)` : ""}${payload?.seconds ? ` · ${payload.seconds}s` : ""} · ${engineText}`;
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
    $("runErrorDetectionBtn").textContent = annotationBaseText != null ? "Re-run detection" : "Run error detection";
  }
}

/* Open-ended AI suggestions: only when the annotator asks. Shown as "possible", never mixed into the gated list. */
let discoveryRunning = false;
async function runDiscovery() {
  if (discoveryRunning) return;
  const text = annotationText().trim();
  const base = ocrApiUrl();
  if (!text || !base) return;
  discoveryRunning = true;
  const btn = $("runDiscoveryBtn");
  btn.disabled = true; btn.textContent = "Asking AI… (up to 2 min)";
  try {
    const response = await fetch(`${base}/api/detect-errors`, {
      method: "POST", headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text, level: $("uploadLevel").value, task: $("uploadTask").value, mode: "discovery" })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail || `HTTP ${response.status}`);
    const got = (payload?.candidates || []).map((c) => ({ ...c, tier: "possible", gate_reason: "ai_discovery", review_status: "PENDING" }));
    const fresh = itemsFromCandidates(got, text).map((n) => ({ ...n, tier: "possible", gate_reason: "ai_discovery" }))
      .filter((n) => !annotationItems.some((k) => k.start != null && n.start != null && n.start < k.end && n.end > k.start));
    annotationItems = annotationItems.concat(fresh);
    annotationBaseText = annotationBaseText || text;
    const eng = Object.entries(payload?.engines || {});
    const ok = eng.filter(([, i]) => i.ok).map(([n]) => ENGINE_LABELS[n] || n);
    const bad = eng.filter(([, i]) => !i.ok).map(([n]) => ENGINE_LABELS[n] || n);
    const found = (payload?.candidates || []).length;
    $("errorDetectionStatus").textContent = `AI suggestions (${ok.join(" + ") || "no AI available"}): ${found} found, ${fresh.length} new “possible” card(s)`
      + `${found > fresh.length ? ` — ${found - fresh.length} already had a card` : ""}${bad.length ? ` · ${bad.join(", ")} did not answer` : ""}.`;
    renderAnnotationWorkspace();
    scheduleDraftAutosave();
  } catch (error) {
    $("errorDetectionStatus").textContent = `AI suggestions failed: ${error.message}`;
  } finally {
    discoveryRunning = false;
    btn.disabled = false; btn.textContent = "Ask AI for more (possible errors)";
  }
}

function wireStage4() {
  $("runDiscoveryBtn")?.addEventListener("click", runDiscovery);
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
  $("s4AddMissing")?.addEventListener("click", addMissingWord);
}
