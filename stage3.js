/* =========================================================
   THEMOZHI — Stage 3: Transcription Review (v0.12)
   Original scan | Live transcript | Exception review

   The document transcript is the main object. Clear OCR goes
   straight into it; humans review only exceptions, at word/span
   level where possible. Stage 3 corrects OCR (what the learner
   actually wrote) — never the learner's own mistakes.

   Relies on app.js globals: $, escapeHtml, countWords,
   normalizeTamilText, importedTranscriptionReview, reviewPage,
   reviewZoom, activeReviewLineId, ocrPageStates,
   scheduleDraftAutosave, reviewLines, pageLines.
   ========================================================= */

/* ---------- tunable exception rules ---------- */
const EXCEPTION_RULES = {
  googleLowWordConfidence: 0.80,     // a Google word below this becomes a word-level issue
  weakLineWordConfidence: 0.90,      // on a hard-to-read line, words below this are flagged individually
  nonLearnerLatinShare: 0.5,         // ≥ this share of Latin letters → "possible non-learner text"
  nonLearnerBlockTypes: ["header", "footer", "page-header", "page-footer", "page_header", "page_footer",
                         "page-number", "page_number", "footnote", "caption"],
  weakLineVisualScore: 50            // legibility below this marks the line as hard to read
};

const ISSUE_KINDS = {
  DISAGREE:       { label: "OCR engines disagree", actions: ["optionA", "optionB", "edit"] },
  LOW_CONF:       { label: "OCR uncertainty", actions: ["accept", "edit"] },
  WEAK_WORD:      { label: "Hard-to-read line · least certain word", actions: ["accept", "edit"] },
  LINE_UNCERTAIN: { label: "No second OCR reading · check line", actions: ["accept", "edit"] },
  DISAGREE_LINE:  { label: "OCR engines disagree (whole line)", actions: ["optionA", "optionB", "edit"] },   // legacy drafts only
  NON_LEARNER:    { label: "Possible non-learner text", actions: ["exclude", "keep"] },
  STRUCK:         { label: "Crossed out by the learner?", actions: ["remove_word", "keep"] }
};

let activeIssueId = null;
let transcriptView = "page";        // "page" | "document" | "edit"
let wholePageEditing = false;
let typedPageSavedAt = null;
let reviewMode = "exceptions";      // "exceptions" | "all"
let showExcludedLines = false;

/* ---------- helpers ---------- */
function s3cmp(t = "") {
  return normalizeTamilText(String(t)).replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}
function tokensWithOffsets(text = "") {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}
function lineText(line) {
  return String(line?.review?.verified_text ?? line?.primary_ocr?.raw_text ?? "");
}
function lineIncluded(line) {
  return line?.review?.include_in_corpus !== false;
}
function lineIssues(line) {
  return Array.isArray(line?.review?.issues) ? line.review.issues : [];
}
function openIssues(line) {
  return lineIncluded(line) ? lineIssues(line).filter((i) => i.status === "open") : [];
}
function allIssues(lines = reviewLines()) {
  return lines.flatMap((l) => lineIssues(l).map((i) => ({ issue: i, line: l })));
}
function findIssue(id) {
  for (const line of reviewLines()) {
    const issue = lineIssues(line).find((i) => i.id === id);
    if (issue) return { issue, line };
  }
  return null;
}
function unionBbox(boxes) {
  const b = boxes.filter((x) => Array.isArray(x) && x.length === 4);
  if (!b.length) return null;
  return [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1])),
          Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))];
}

/* ---------- exception detection ---------- */
function looksNonLearner(line, text) {
  const type = String(line?.block_type || line?.primary_ocr?.block_type || "").toLowerCase();
  if (EXCEPTION_RULES.nonLearnerBlockTypes.includes(type)) return true;
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 3) return false;
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  return latin / letters.length >= EXCEPTION_RULES.nonLearnerLatinShare;
}

function isWeakLine(line) {
  const flags = Array.isArray(line?.review?.flags) ? line.review.flags : [];
  const legib = Number(line?.visual_review?.legibility_score ?? 100);
  const enginesAgree = line?.comparison && line.comparison.models_disagree === false && (line?.secondary_ocr?.raw_text || "").trim();
  const googleOk = (line?.secondary_ocr?.min_word_confidence ?? 1) >= EXCEPTION_RULES.googleLowWordConfidence;
  if (flags.includes("NO_LINE_GEOMETRY")) return true;
  // v0.19 physical-line alignment: a line only one engine read, or whose words could not be matched up
  if (flags.includes("ONLY_SECOND_READING") || flags.includes("LINE_ALIGNMENT_UNCERTAIN")) return true;
  if (legib < EXCEPTION_RULES.weakLineVisualScore) return true;
  if (line?.review?.priority === "HIGH" && !(enginesAgree && googleOk)) return true;
  return false;
}

function buildLineIssues(line) {
  const text = lineText(line);
  const A = tokensWithOffsets(text);
  const gWords = Array.isArray(line?.secondary_ocr?.words) ? line.secondary_ocr.words : [];
  const bRaw = (line?.secondary_ocr?.raw_text || "").trim();
  const isStruck = (w) => Boolean(w?.strike?.level);
  const B = gWords.length ? gWords.filter((w) => !isStruck(w)).map((w) => ({ text: String(w.text || ""), bbox: w.bbox, conf: w.confidence }))
                          : tokensWithOffsets(bRaw).map((t) => ({ text: t.text }));
  const issues = [];
  let n = 0;
  const add = (kind, start, end, extra = {}) => issues.push({
    id: `${line.line_id}#${++n}`, line_id: line.line_id, page: Number(line.page_number || 1), kind,
    start, end, text: text.slice(start, end), status: "open", resolution: null, ...extra
  });

  if (!text.trim()) return issues;

  const covered = (s, e) => issues.some((i) => s < i.end && e > i.start);
  if (looksNonLearner(line, text)) {
    add("NON_LEARNER", 0, text.length);
    return issues;
  }

  // 1. word-level disagreement between Sarvam (A) and Google (B)
  if (line?.comparison?.models_disagree && B.length) {
    const ops = diffOpcodes(A.map((t) => s3cmp(t.text)), B.map((t) => s3cmp(t.text)))
      .filter((op) => op[0] !== "equal")
      .filter((op) => {
        // ignore punctuation-only differences
        const a = A.slice(op[1], op[2]).map((t) => s3cmp(t.text)).join("");
        const b = B.slice(op[3], op[4]).map((t) => s3cmp(t.text)).join("");
        return a !== b;
      });
    // adjacent mismatches with the same word count on both sides → one item per word
    const perWord = ops.flatMap((op) => {
      const [tag, i1, i2, j1, j2] = op;
      if (tag === "replace" && i2 - i1 === j2 - j1 && i2 - i1 > 1) {
        return Array.from({ length: i2 - i1 }, (_, k) => ["replace", i1 + k, i1 + k + 1, j1 + k, j1 + k + 1])
          .filter(([, a1, a2, b1, b2]) => s3cmp(A[a1].text) !== s3cmp(B[b1].text));
      }
      return [op];
    });
    for (const [tag, i1, i2, j1, j2] of perWord) {
      let s, e, aText, bText;
      const bWords = B.slice(j1, j2);
      if (i2 > i1) {
        s = A[i1].start; e = A[i2 - 1].end;
        aText = text.slice(s, e);
        bText = bWords.map((w) => w.text).join(" ");
      } else {
        // Google has extra word(s) that Sarvam lacks → attach to the neighbouring token
        const k = Math.min(i1, A.length - 1);
        if (k < 0) continue;
        s = A[k].start; e = A[k].end; aText = A[k].text;
        bText = i1 < A.length ? `${bWords.map((w) => w.text).join(" ")} ${A[k].text}` : `${A[k].text} ${bWords.map((w) => w.text).join(" ")}`;
      }
      add("DISAGREE", s, e, {
        options: [{ key: "optionA", engine: line?.primary_ocr?.engine || "sarvam", text: aText },
                  { key: "optionB", engine: line?.secondary_ocr?.engine || "google", text: bText }],
        bbox: unionBbox(bWords.map((w) => w.bbox))
      });
    }
  }

  // 2. low-confidence words (Google confidence) that are not already covered
  // 0. "maybe" crossed-out words → one-click item (high-confidence ones were already removed in prepare)
  gWords.filter((w) => w?.strike?.level === "maybe").forEach((w) => {
    const tok = A.find((t) => s3cmp(t.text) === s3cmp(w.text) && !covered(t.start, t.end));
    if (tok) add("STRUCK", tok.start, tok.end, { bbox: w.bbox, confidence: w.strike.score });
  });

  gWords.forEach((w) => {
    if (isStruck(w)) return;
    if (typeof w.confidence !== "number" || w.confidence >= EXCEPTION_RULES.googleLowWordConfidence) return;
    const tok = A.find((t) => s3cmp(t.text) === s3cmp(w.text) && !covered(t.start, t.end));
    if (tok) add("LOW_CONF", tok.start, tok.end, { bbox: w.bbox, confidence: w.confidence });
  });

  // 3. hard-to-read line with no word flagged yet → flag its least certain word(s), still word-level
  if (!issues.length && isWeakLine(line)) {
    const scored = gWords.filter((w) => typeof w.confidence === "number")
      .map((w) => ({ w, tok: A.find((t) => s3cmp(t.text) === s3cmp(w.text) && !covered(t.start, t.end)) }))
      .filter((x) => x.tok)
      .sort((a, b) => a.w.confidence - b.w.confidence);
    const weak = scored.filter((x) => x.w.confidence < EXCEPTION_RULES.weakLineWordConfidence);
    (weak.length ? weak : scored.slice(0, 1)).forEach(({ w, tok }) =>
      add("WEAK_WORD", tok.start, tok.end, { bbox: w.bbox, confidence: w.confidence }));
    // no second reading at all: nothing to point at, so the line is checked as a whole
    if (!issues.length) add("LINE_UNCERTAIN", 0, text.length);
  }

  return issues;
}

/* Called from normaliseImportedReview for every line (new OCR pages, imported JSON, resumed drafts). */
/* High-confidence crossed-out words are taken out of the transcript before review. They are kept as
   line.review.struck_out (the learner's self-corrections) and as a resolved STRUCK issue with Undo. */
function removeStruckWords(line) {
  const gWords = Array.isArray(line?.secondary_ocr?.words) ? line.secondary_ocr.words : [];
  const struck = gWords.filter((w) => w?.strike?.level === "high");
  line.review.struck_out = line.review.struck_out || [];
  const autoIssues = [];
  let text = lineText(line);
  struck.forEach((w, k) => {
    const tok = tokensWithOffsets(text).find((t) => s3cmp(t.text) === s3cmp(w.text));
    const rec = { text: w.text, score: w.strike.score, kind: w.strike.kind, bbox: w.bbox, in_ocr_text: Boolean(tok) };
    line.review.struck_out.push(rec);
    if (!tok) return;                                   // Sarvam already left it out
    let s = tok.start, e = tok.end;
    if (/\s/.test(text[e] || "")) e += 1; else if (s > 0 && /\s/.test(text[s - 1])) s -= 1;
    const removed = text.slice(s, e);
    text = text.slice(0, s) + text.slice(e);
    // shift earlier auto issues that sit after this cut
    autoIssues.forEach((i) => { if (i.start > s) { i.start -= removed.length; i.end = i.start; } });
    autoIssues.push({ id: `${line.line_id}#s${k + 1}`, line_id: line.line_id, page: Number(line.page_number || 1),
      kind: "STRUCK", start: s, end: s, text: "", bbox: w.bbox, confidence: w.strike.score, status: "resolved",
      resolution: { action: "auto_remove", prev: removed, value: "", origin: "struck_out", auto: true } });
  });
  line.review.verified_text = text;
  return autoIssues;
}

function prepareLineForExceptionReview(line) {
  line.review = line.review || {};
  if (Array.isArray(line.review.issues)) return line;              // already prepared
  const legacyDone = line.review.status === "CONFIRMED" || line.review.status === "IGNORED";
  const auto = legacyDone || !lineIncluded(line) ? [] : removeStruckWords(line);
  line.review.issues = legacyDone || !lineIncluded(line) ? [] : auto.concat(buildLineIssues(line));
  line.review.ocr_corrections = line.review.ocr_corrections || [];
  if (!legacyDone) {
    if (!lineIncluded(line)) line.review.status = "IGNORED";
    else if (!line.review.issues.length) { line.review.status = "CONFIRMED"; line.review.method = "auto_clear"; }
    else line.review.status = "PENDING";
  }
  return line;
}

/* ---------- applying decisions ---------- */
function refreshLineStatus(line) {
  if (!lineIncluded(line)) { line.review.status = "IGNORED"; return; }
  const open = lineIssues(line).some((i) => i.status === "open");
  line.review.status = open ? "PENDING" : "CONFIRMED";
  if (!open && !line.review.method) line.review.method = "exceptions";
}

function replaceInLine(line, issue, newText) {
  const text = lineText(line);
  const oldText = text.slice(issue.start, issue.end);
  const delta = newText.length - oldText.length;
  line.review.verified_text = text.slice(0, issue.start) + newText + text.slice(issue.end);
  lineIssues(line).forEach((other) => {
    if (other === issue || other.start == null) return;
    if (other.start >= issue.end) { other.start += delta; other.end += delta; }
  });
  issue.end = issue.start + newText.length;
  issue.text = newText;
  return oldText;
}

function resolveIssue(issueId, action, value = null) {
  const found = findIssue(issueId);
  if (!found) return;
  const { issue, line } = found;
  const current = lineText(line).slice(issue.start, issue.end);

  if (action === "exclude") {
    line.review.include_in_corpus = false;
    lineIssues(line).forEach((i) => {
      if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "exclude", origin: "excluded" }; }
    });
  } else if (action === "remove_word") {
    const text = lineText(line);
    if (/\s/.test(text[issue.end] || "")) issue.end += 1; else if (issue.start > 0 && /\s/.test(text[issue.start - 1])) issue.start -= 1;
    const prev = replaceInLine(line, issue, "");
    issue.status = "resolved";
    issue.resolution = { action, prev, value: "", origin: "struck_out", at: new Date().toISOString() };
    line.review.struck_out = line.review.struck_out || [];
    line.review.struck_out.push({ text: prev.trim(), score: issue.confidence ?? null, kind: "reviewer", in_ocr_text: true });
  } else if (action === "keep") {
    issue.status = "resolved";
    issue.resolution = { action: "keep", origin: "kept" };
  } else {
    let target = current;
    if (action === "optionB") target = (issue.options || []).find((o) => o.key === "optionB")?.text ?? current;
    if (action === "edit") target = String(value ?? current);
    if (!target.trim() && issue.kind !== "NON_LEARNER") {
      alert("The transcription cannot be empty here. Use Exclude line for non-corpus content.");
      return;
    }
    const prev = target !== current ? replaceInLine(line, issue, target) : current;
    issue.status = "resolved";
    issue.resolution = {
      action, prev, value: target,
      origin: target !== current ? "ocr_corrected" : "ocr_confirmed",
      at: new Date().toISOString()
    };
    if (target !== current) {
      line.review.ocr_corrections.push({ issue_id: issue.id, from: prev, to: target, via: action });
    }
  }
  refreshLineStatus(line);
  const next = nextOpenIssueId(issueId);
  activeIssueId = next || issueId;
  if (next) activeReviewLineId = findIssue(next)?.line?.line_id || activeReviewLineId;
  scheduleDraftAutosave();
  renderStructuredReview();
}

function reopenIssue(issueId) {
  const found = findIssue(issueId);
  if (!found) return;
  const { issue, line } = found;
  const r = issue.resolution || {};
  if (r.action === "exclude") {
    line.review.include_in_corpus = true;
    lineIssues(line).forEach((i) => { if (i.resolution?.action === "exclude") { i.status = "open"; i.resolution = null; } });
  } else {
    if (r.origin === "struck_out") {
      line.review.struck_out = (line.review.struck_out || []).filter((x) => x.text !== String(r.prev || "").trim());
    }
    if (r.prev != null && r.value != null && r.prev !== r.value) {
      replaceInLine(line, issue, r.prev);
      line.review.ocr_corrections = line.review.ocr_corrections.filter((c) => c.issue_id !== issue.id);
    }
    issue.status = "open";
    issue.resolution = null;
  }
  line.review.method = null;
  refreshLineStatus(line);
  activeIssueId = issueId;
  scheduleDraftAutosave();
  renderStructuredReview();
}

/* whole-line edit / include / exclude (used by "Review all OCR regions") */
function saveWholeLine(lineId, text) {
  const line = reviewLines().find((l) => l.line_id === lineId);
  if (!line) return;
  const before = lineText(line);
  const after = String(text || "").trim();
  if (!after) { alert("Use Exclude for non-corpus content."); return; }
  if (after !== before) {
    line.review.ocr_corrections.push({ issue_id: null, from: before, to: after, via: "line_edit" });
    line.review.verified_text = after;
    lineIssues(line).forEach((i) => {
      if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "line_edit", origin: "ocr_corrected" }; }
      i.start = null; i.end = null;       // offsets no longer meaningful after a free edit
    });
  } else {
    lineIssues(line).forEach((i) => {
      if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "accept", origin: "ocr_confirmed" }; }
    });
  }
  line.review.method = "manual_line";
  refreshLineStatus(line);
  scheduleDraftAutosave();
  renderStructuredReview();
}
function setLineIncluded(lineId, included) {
  const line = reviewLines().find((l) => l.line_id === lineId);
  if (!line) return;
  line.review.include_in_corpus = included;
  if (!included) lineIssues(line).forEach((i) => {
    if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "exclude", origin: "excluded" }; }
  });
  refreshLineStatus(line);
  scheduleDraftAutosave();
  renderStructuredReview();
}

/* ---------- navigation between issues ---------- */
function pageOpenIssues(page = reviewPage) {
  return pageLines(page).flatMap((l) => openIssues(l));
}
function nextOpenIssueId(afterId = null, page = reviewPage) {
  const list = pageLines(page).flatMap((l) => lineIncluded(l) ? lineIssues(l) : []);
  const idx = afterId ? list.findIndex((i) => i.id === afterId) : -1;
  const after = list.slice(idx + 1).find((i) => i.status === "open");
  return (after || list.find((i) => i.status === "open"))?.id || null;
}
function selectIssue(issueId, { scroll = true } = {}) {
  activeIssueId = issueId;
  const found = issueId ? findIssue(issueId) : null;
  if (found) activeReviewLineId = found.line.line_id;
  renderReviewPage();
  renderTranscriptPanel();
  renderReviewRail();
  if (scroll) requestAnimationFrame(() => {
    scrollActiveRegionIntoView();
    document.querySelector(`#s3Transcript [data-issue-id="${CSS.escape(issueId || "")}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    document.querySelector(`#s3Rail [data-rail-issue="${CSS.escape(issueId || "")}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}
function selectLine(lineId, { scroll = true } = {}) {
  const line = reviewLines().find((l) => l.line_id === lineId);
  const firstOpen = line ? openIssues(line)[0] : null;
  if (firstOpen) return selectIssue(firstOpen.id, { scroll });
  activeIssueId = null;
  activeReviewLineId = lineId;
  renderReviewPage();
  renderTranscriptPanel();
  renderReviewRail();
  if (scroll) requestAnimationFrame(() => {
    scrollActiveRegionIntoView();
    document.querySelector(`#s3Transcript [data-line-id="${CSS.escape(lineId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    document.querySelector(`#s3Rail [data-rail-line="${CSS.escape(lineId)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

/* ---------- page status + stats ---------- */
function markPageVisited(page) {
  if (!importedTranscriptionReview) return;
  importedTranscriptionReview.pages_visited = importedTranscriptionReview.pages_visited || {};
  importedTranscriptionReview.pages_visited[String(page)] = true;
}
function pageOcrStatus(page) {
  return ocrPageStates?.[page - 1]?.status || (pageLines(page).length ? "ready" : "waiting");
}
function pageReviewStatus(page) {
  const ocr = pageOcrStatus(page);
  if (ocr === "failed") return "failed";
  if (ocr !== "ready" && !pageLines(page).length) return ocr === "processing" ? "processing" : "waiting";
  const open = pageOpenIssues(page).length;
  const visited = Boolean(importedTranscriptionReview?.pages_visited?.[String(page)]);
  if (!open && visited) return "reviewed";
  if (visited) return "in_progress";
  return "not_reviewed";
}
function stage3Stats() {
  const lines = reviewLines();
  const issues = allIssues(lines).filter(({ issue, line }) => !issue.resolution?.auto && (lineIncluded(line) || issue.status === "resolved"));
  const withIssues = new Set(issues.map(({ line }) => line.line_id));
  const total = issues.length;
  const resolved = issues.filter(({ issue }) => issue.status === "resolved").length;
  const pages = Number(importedTranscriptionReview?.page_count || 1);
  let reviewedPages = 0;
  for (let p = 1; p <= pages; p++) if (pageReviewStatus(p) === "reviewed") reviewedPages++;
  const words = countWords(transcriptPlainText("document"));
  return { regions: lines.length, clear: lines.length - withIssues.size, needReview: withIssues.size,
           issues: total, resolved, pages, reviewedPages, words };
}

/* ---------- transcript text ---------- */
function transcriptPlainText(scope = "document", page = reviewPage) {
  const pages = scope === "page" ? [page] : Array.from({ length: Number(importedTranscriptionReview?.page_count || 1) }, (_, i) => i + 1);
  return pages.map((p) => pageLines(p).filter(lineIncluded).map((l) => lineText(l).trim()).filter(Boolean).join("\n"))
    .filter(Boolean).join("\n\n");
}

function lineHtmlWithIssues(line) {
  const text = lineText(line);
  const issues = lineIssues(line).filter((i) => i.start != null && i.end != null && i.end >= i.start)
    .sort((a, b) => a.start - b.start);
  let html = "", pos = 0;
  for (const i of issues) {
    if (i.start < pos) continue;
    html += escapeHtml(text.slice(pos, i.start));
    if (i.kind === "STRUCK" && i.status === "resolved" && i.resolution?.origin === "struck_out") {
      if (showExcludedLines) html += `<s class="t-struck" data-issue-id="${escapeHtml(i.id)}" title="Crossed out by the learner — not in the transcript">${escapeHtml((i.resolution.prev || "").trim())}</s> `;
      pos = i.start;
      continue;
    }
    const cls = ["t-issue", i.status, i.resolution?.origin === "ocr_corrected" ? "corrected" : "", i.id === activeIssueId ? "active" : ""].join(" ");
    const title = i.status === "open" ? ISSUE_KINDS[i.kind]?.label
      : (i.resolution?.origin === "ocr_corrected" ? `OCR corrected: ${i.resolution.prev} → ${i.resolution.value}` : "Confirmed");
    html += `<mark class="${cls}" data-issue-id="${escapeHtml(i.id)}" title="${escapeHtml(title || "")}">${escapeHtml(text.slice(i.start, i.end)) || "&nbsp;"}</mark>`;
    pos = i.end;
  }
  return html + escapeHtml(text.slice(pos));
}

/* ---------- rendering: scan ---------- */
function renderReviewPage() {
  const totalPages = Number(importedTranscriptionReview?.page_count || 1);
  reviewPage = Math.max(1, Math.min(reviewPage, totalPages));
  markPageVisited(reviewPage);
  $("reviewPageLabel").textContent = `Page ${reviewPage} of ${totalPages}`;
  $("reviewPrevPage").disabled = reviewPage <= 1;
  $("reviewNextPage").disabled = reviewPage >= totalPages;

  const preview = importedTranscriptionReview?.page_previews?.[String(reviewPage)];
  const stage = $("reviewPageStage");
  const lines = pageLines();
  const found = activeIssueId ? findIssue(activeIssueId) : null;
  const activeLineId = found?.line?.line_id || activeReviewLineId;

  if (!preview?.data_url) {
    stage.style.width = "100%";
    const state = pageOcrStatus(reviewPage);
    stage.innerHTML = `<div class="review-preview-fallback"><div class="empty">${
      state === "ready" ? "This page has no image preview (reprocess it to enable highlights)." : `Page ${reviewPage} is ${escapeHtml(state)}…`
    }</div></div>`;
    return;
  }

  const width = Number(preview.display_width);
  const height = Number(preview.display_height);
  const sx = width / Number(preview.source_width || width);
  const sy = height / Number(preview.source_height || height);
  stage.style.width = `${Math.max(35, reviewZoom * 100)}%`;

  const regionClass = (line) => {
    if (!lineIncluded(line)) return "excluded";
    if (openIssues(line).length) return "needs-review";
    return "clear";
  };
  const bbox = found?.issue?.bbox;
  stage.innerHTML = `
    <div class="review-image-wrap" style="aspect-ratio:${width}/${height}">
      <img src="${preview.data_url}" alt="Learner page ${reviewPage}" />
      <svg class="review-overlay" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        ${lines.map((line) => {
          const points = polygonPoints(line, preview);
          if (!points) return "";
          return `<polygon points="${points}" class="review-region ${regionClass(line)} ${line.line_id === activeLineId ? "active" : ""}"
                   data-line-id="${escapeHtml(line.line_id)}"></polygon>`;
        }).join("")}
        ${Array.isArray(bbox) ? `<rect class="review-word-box" x="${bbox[0] * sx - 3}" y="${bbox[1] * sy - 3}"
              width="${(bbox[2] - bbox[0]) * sx + 6}" height="${(bbox[3] - bbox[1]) * sy + 6}" rx="4"></rect>` : ""}
      </svg>
    </div>`;
  stage.querySelectorAll("[data-line-id]").forEach((region) => {
    region.addEventListener("click", () => selectLine(region.dataset.lineId, { scroll: false }));
  });
}

/* ---------- rendering: live transcript ---------- */
function renderTranscriptPanel() {
  const target = $("s3Transcript");
  if (!target || !importedTranscriptionReview) return;
  const stats = stage3Stats();
  $("s3TranscriptMeta").textContent =
    `Page ${reviewPage} of ${stats.pages} · ${stats.reviewedPages} page${stats.reviewedPages === 1 ? "" : "s"} reviewed · ${stats.words.toLocaleString()} words`;
  document.querySelectorAll("[data-transcript-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.transcriptView === transcriptView));
  if (transcriptView === "edit" || transcriptView === "type") { renderTranscriptEditor(target); return; }

  const activeLineId = (activeIssueId && findIssue(activeIssueId)?.line?.line_id) || activeReviewLineId;
  const renderPage = (p, withHeader) => {
    const lines = pageLines(p);
    const status = pageReviewStatus(p);
    const label = { reviewed: "reviewed", in_progress: "in review", not_reviewed: "not reviewed yet",
                    processing: "OCR in progress", waiting: "waiting for OCR", failed: "OCR failed" }[status] || status;
    const body = lines.length ? lines.map((line) => {
      const inc = lineIncluded(line);
      if (!inc && !showExcludedLines) return "";
      const open = openIssues(line).length;
      return `<div class="t-line ${inc ? "" : "excluded"} ${open ? "has-open" : ""} ${line.line_id === activeLineId ? "active" : ""}"
                   data-line-id="${escapeHtml(line.line_id)}" data-page="${p}">${lineHtmlWithIssues(line) || "&nbsp;"}</div>`;
    }).join("") : `<div class="t-empty">${escapeHtml(label)}</div>`;
    return `<section class="t-page status-${status}" data-page="${p}">
      ${withHeader ? `<header class="t-page-head"><strong>Page ${p}</strong><span class="t-page-status">${escapeHtml(label)}</span></header>` : ""}
      <div class="t-page-body ${status === "not_reviewed" ? "muted" : ""}">${body}</div>
    </section>`;
  };
  target.innerHTML = transcriptView === "document"
    ? Array.from({ length: stats.pages }, (_, i) => renderPage(i + 1, true)).join("")
    : renderPage(reviewPage, false);

  target.querySelectorAll("[data-issue-id]").forEach((m) => m.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const f = findIssue(m.dataset.issueId);
    if (f && f.issue.page !== reviewPage) { reviewPage = f.issue.page; }
    selectIssue(m.dataset.issueId);
  }));
  target.querySelectorAll(".t-line").forEach((el) => el.addEventListener("click", () => {
    const p = Number(el.dataset.page);
    if (p !== reviewPage) reviewPage = p;
    selectLine(el.dataset.lineId);
  }));
}

/* ---------- transcript editing (any saved line, or the whole page) ---------- */
function editLineText(lineId, text, { silent = false } = {}) {
  const line = reviewLines().find((l) => l.line_id === lineId);
  if (!line) return;
  const before = lineText(line);
  const after = String(text || "").replace(/\s+/g, " ").trim();
  if (after === before.trim()) return;
  if (!after) { excludeLineQuiet(line); if (!silent) afterTranscriptEdit(); return; }
  line.review.ocr_corrections = line.review.ocr_corrections || [];
  line.review.ocr_corrections.push({ issue_id: null, from: before, to: after, via: "transcript_edit" });
  line.review.verified_text = after;
  lineIssues(line).forEach((i) => {
    if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "transcript_edit", origin: "ocr_corrected" }; }
    i.start = null; i.end = null;                    // positions no longer meaningful after a free edit
  });
  line.review.method = "transcript_edit";
  refreshLineStatus(line);
  if (!silent) afterTranscriptEdit();
}
function excludeLineQuiet(line) {
  line.review.include_in_corpus = false;
  lineIssues(line).forEach((i) => {
    if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "exclude", origin: "excluded" }; }
  });
  refreshLineStatus(line);
}
function afterTranscriptEdit() {
  // refresh everything except the editor itself, so the cursor is not lost
  renderReviewPage();
  renderReviewRail();
  updateReviewProgress();
  const s = stage3Stats();
  $("s3TranscriptMeta").textContent = `Page ${reviewPage} of ${s.pages} · ${s.reviewedPages} page${s.reviewedPages === 1 ? "" : "s"} reviewed · ${s.words.toLocaleString()} words`;
  scheduleDraftAutosave();
}
function applyPageText(page, text) {
  const lines = pageLines(page).filter(lineIncluded);
  const rows = String(text || "").split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  rows.forEach((row, i) => {
    if (i < lines.length) { editLineText(lines[i].line_id, row, { silent: true }); return; }
    // more rows than OCR regions: add typed lines (no scan geometry)
    const all = importedTranscriptionReview.lines;
    const lastIdx = all.map((l) => Number(l.page_number || 1)).lastIndexOf(page);
    const n = all.filter((l) => String(l.line_id).startsWith(`P${page}-M-`)).length + 1;
    const nl = { line_id: `P${page}-M-L${n}`, page_number: page, geometry: {}, primary_ocr: { engine: "typed", raw_text: "" },
                 secondary_ocr: {}, comparison: {}, visual_review: {},
                 review: { include_in_corpus: true, status: "CONFIRMED", method: "typed", verified_text: row, issues: [],
                           ocr_corrections: [{ issue_id: null, from: "", to: row, via: "typed_line" }] } };
    all.splice(lastIdx + 1, 0, nl);
  });
  lines.slice(rows.length).forEach((l) => excludeLineQuiet(l));   // fewer rows than regions: extra regions excluded
  // the reviewer has typed the whole page: every remaining review item on it is settled by that text
  pageLines(page).forEach((l) => {
    lineIssues(l).forEach((i) => {
      if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "page_typed", origin: "typed_page" }; }
    });
    if (lineIncluded(l)) l.review.method = l.review.method === "typed" ? "typed" : "page_typed";
    refreshLineStatus(l);
  });
  typedPageSavedAt = new Date();
  wholePageEditing = false;
  scheduleDraftAutosave();
  renderStructuredReview();
}
function renderTranscriptEditor(target) {
  const lines = pageLines(reviewPage);
  if (!lines.length) { target.innerHTML = '<div class="t-empty">No text on this page yet.</div>'; return; }
  if (transcriptView === "type") {
    const current = lines.filter(lineIncluded).map((l) => lineText(l)).join("\n");
    const justSaved = typedPageSavedAt && Date.now() - typedPageSavedAt.getTime() < 4000;
    target.innerHTML = `
      <div class="t-edit-tools small">For pages that are hard to read: type or paste <b>everything the learner wrote on this page</b>,
        one handwritten line per row, exactly as written (mistakes included). It starts from the current transcript — the machine reading
        with your corrections. <b>Save page text</b> replaces this page's transcript and settles all of its review items.</div>
      <textarea class="tamil t-edit-page" spellcheck="false">${escapeHtml(current)}</textarea>
      <div class="t-edit-actions">
        <button type="button" class="primary-btn" data-edit-page-save>Save page text</button>
        <button type="button" data-edit-page-revert>Undo unsaved changes</button>
        <button type="button" class="text-button" data-edit-page-blank>Start from a blank page</button>
        <span class="small t-type-status">${justSaved ? "✓ Saved — this page's transcript now comes from the typed text." : "<kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves"}</span>
      </div>`;
    const ta = target.querySelector(".t-edit-page");
    const save = () => applyPageText(reviewPage, ta.value);
    target.querySelector("[data-edit-page-save]").addEventListener("click", save);
    target.querySelector("[data-edit-page-revert]").addEventListener("click", () => { ta.value = current; });
    target.querySelector("[data-edit-page-blank]").addEventListener("click", () => {
      if (!ta.value.trim() || confirm("Clear the box and type this page from scratch?")) { ta.value = ""; ta.focus(); }
    });
    ta.addEventListener("keydown", (ev) => {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); save(); }
    });
    return;
  }
  target.innerHTML = `
    <div class="t-edit-tools small">Edit any line. It saves when you leave the box (or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).
      Page too hard to read? Use <button type="button" class="text-button" data-edit-mode="page">⌨ Type page</button> to enter it all at once.</div>
    ${lines.map((l, i) => `
      <div class="t-edit-row ${lineIncluded(l) ? "" : "excluded"} ${l.line_id === activeReviewLineId ? "active" : ""}" data-line-id="${escapeHtml(l.line_id)}">
        <span class="t-edit-num">${i + 1}</span>
        <textarea class="tamil t-edit-line" rows="1" ${lineIncluded(l) ? "" : "disabled"}>${escapeHtml(lineText(l))}</textarea>
        <button type="button" class="text-button" data-edit-include>${lineIncluded(l) ? "Exclude" : "Include"}</button>
      </div>`).join("")}`;
  const fit = (ta) => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };
  target.querySelector('[data-edit-mode="page"]').addEventListener("click", () => { transcriptView = "type"; renderTranscriptPanel(); });
  target.querySelectorAll(".t-edit-row").forEach((row) => {
    const id = row.dataset.lineId;
    const ta = row.querySelector("textarea");
    fit(ta);
    ta.addEventListener("input", () => fit(ta));
    ta.addEventListener("focus", () => {
      activeIssueId = null; activeReviewLineId = id;
      target.querySelectorAll(".t-edit-row").forEach((r) => r.classList.toggle("active", r === row));
      renderReviewPage(); requestAnimationFrame(scrollActiveRegionIntoView);
    });
    ta.addEventListener("change", () => editLineText(id, ta.value));
    ta.addEventListener("keydown", (ev) => {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ta.blur(); }
    });
    row.querySelector("[data-edit-include]").addEventListener("click", () => setLineIncluded(id, !lineIncluded(reviewLines().find((l) => l.line_id === id))));
  });
}

/* ---------- rendering: review rail ---------- */
function actionButton(action, issue) {
  const opt = (k) => (issue.options || []).find((o) => o.key === k);
  const labels = {
    optionA: `A · ${opt("optionA")?.engine?.replace(/_.*/, "") || "Sarvam"}`,
    optionB: `B · ${opt("optionB")?.engine?.replace(/_.*/, "") || "Google"}`,
    accept: "Accept", edit: "Edit", exclude: "Exclude", keep: "Keep", remove_word: "Remove word"
  };
  const primary = ["accept", "optionA", "exclude", "remove_word"].includes(action) ? "primary-btn" : "";
  return `<button type="button" class="rail-btn ${primary}" data-issue-action="${action}">${labels[action]}</button>`;
}

function contextHtml(line, issue) {
  const text = lineText(line);
  return `${escapeHtml(text.slice(0, issue.start))}<mark>${escapeHtml(text.slice(issue.start, issue.end)) || "&nbsp;"}</mark>${escapeHtml(text.slice(issue.end))}`;
}

function renderReviewRail() {
  const target = $("s3Rail");
  if (!target || !importedTranscriptionReview) return;
  const lines = pageLines();
  document.querySelectorAll("[data-review-mode]").forEach((b) => b.classList.toggle("active", b.dataset.reviewMode === reviewMode));

  if (reviewMode === "all") {
    target.innerHTML = `
      <div class="rail-head"><strong>ALL REGIONS — PAGE ${reviewPage}</strong><span class="small">${lines.length} regions</span></div>
      ${lines.map((line, idx) => {
        const inc = lineIncluded(line);
        const open = openIssues(line).length;
        const active = line.line_id === activeReviewLineId && !activeIssueId;
        return `<article class="rail-item ${active ? "active" : ""} ${inc ? "" : "excluded"}" data-rail-line="${escapeHtml(line.line_id)}">
          <div class="rail-item-head"><span class="rail-num">${idx + 1}</span>
            <span class="rail-status ${open ? "open" : inc ? "ok" : "excluded"}">${open ? `${open} issue${open > 1 ? "s" : ""}` : inc ? (line.review.method === "auto_clear" ? "clear" : "confirmed") : "excluded"}</span></div>
          ${active ? `
            <textarea class="tamil rail-line-edit" rows="2">${escapeHtml(lineText(line))}</textarea>
            <div class="rail-actions">
              <button type="button" class="rail-btn primary-btn" data-line-save>Save line</button>
              ${inc ? '<button type="button" class="rail-btn" data-line-exclude>Exclude</button>' : '<button type="button" class="rail-btn" data-line-include>Include</button>'}
            </div>` : `<div class="tamil rail-snippet">${escapeHtml(lineText(line)) || "—"}</div>`}
        </article>`;
      }).join("") || '<div class="empty">No OCR regions on this page yet.</div>'}`;
    target.querySelectorAll("[data-rail-line]").forEach((card) => {
      const id = card.dataset.railLine;
      card.addEventListener("click", (ev) => { if (!ev.target.closest("button, textarea")) selectLine(id); });
      card.querySelector("[data-line-save]")?.addEventListener("click", () => saveWholeLine(id, card.querySelector(".rail-line-edit").value));
      card.querySelector("[data-line-exclude]")?.addEventListener("click", () => setLineIncluded(id, false));
      card.querySelector("[data-line-include]")?.addEventListener("click", () => setLineIncluded(id, true));
    });
    return;
  }

  const items = lines.flatMap((line) => lineIssues(line).map((issue) => ({ issue, line })));
  const open = items.filter(({ issue, line }) => issue.status === "open" && lineIncluded(line));
  const done = items.filter(({ issue, line }) => !(issue.status === "open" && lineIncluded(line)));
  const totalPages = Number(importedTranscriptionReview.page_count || 1);

  const card = ({ issue, line }, n) => {
    const active = issue.id === activeIssueId;
    const kind = ISSUE_KINDS[issue.kind] || { label: issue.kind, actions: ["accept", "edit"] };
    const isOpen = issue.status === "open" && lineIncluded(line);
    if (!isOpen) {
      const r = issue.resolution || {};
      const what = r.action === "transcript_edit" ? "edited in transcript" : r.origin === "ocr_corrected" ? `→ ${r.value ?? ""}` : r.origin === "excluded" ? "excluded" : r.origin === "kept" ? "kept"
        : r.origin === "struck_out" ? (r.auto ? "crossed out · removed automatically" : "crossed out · removed")
        : r.origin === "typed_page" ? "settled by typed page" : "confirmed";
      return `<article class="rail-item resolved ${active ? "active" : ""}" data-rail-issue="${escapeHtml(issue.id)}">
        <div class="rail-item-head"><span class="tamil rail-span">${escapeHtml(r.prev ?? issue.text)}</span>
          <span class="rail-status ok tamil">${escapeHtml(what)}</span>
          <button type="button" class="text-button" data-issue-change title="Reopen and choose again">Change</button>
          ${issue.start != null || r.action === "exclude" ? '<button type="button" class="text-button" data-issue-reopen>Undo</button>' : ""}</div>
      </article>`;
    }
    const opts = issue.options || [];
    const typed = !["NON_LEARNER"].includes(issue.kind);
    // Active card: every choice is visible at once — A, B, or type the reading and press Enter.
    const choices = active ? `
        <div class="tamil rail-context">${contextHtml(line, issue)}</div>
        <div class="rail-choices">
          ${opts.map((o) => `<button type="button" class="rail-choice" data-issue-action="${o.key}">
              <span class="rail-option-key">${o.key === "optionA" ? "A" : "B"}</span>
              <span class="tamil rail-choice-text">${escapeHtml(o.text) || "<em>no reading</em>"}</span>
              <span class="rail-choice-src">${escapeHtml(String(o.engine || "").replace(/_.*/, ""))}</span></button>`).join("")}
          ${!opts.length && kind.actions.includes("accept") ? `<button type="button" class="rail-choice" data-issue-action="accept">
              <span class="rail-option-key">✓</span><span class="tamil rail-choice-text">${escapeHtml(issue.text) || "—"}</span>
              <span class="rail-choice-src">as read</span></button>` : ""}
          ${kind.actions.includes("remove_word") ? `<button type="button" class="rail-choice" data-issue-action="remove_word">
              <span class="rail-option-key">⌫</span><span class="rail-choice-text">Remove crossed-out word</span></button>` : ""}
          ${typed ? `<label class="rail-choice rail-type"><span class="rail-option-key">✎</span>
              <input class="tamil rail-edit-input" placeholder="Neither? Type the word, press Enter" /></label>` : ""}
        </div>
        ${typed ? '<div class="small rail-hint">Type exactly what the learner wrote, mistakes included. Learner errors are annotated in Stage 4.</div>' : ""}
        <div class="rail-actions">
          ${kind.actions.filter((a) => ["exclude", "keep"].includes(a)).map((a) => actionButton(a, issue)).join("")}
          ${issue.kind !== "NON_LEARNER" ? '<button type="button" class="rail-btn subtle" data-issue-action="exclude">Exclude line</button>' : ""}
        </div>` : `
        <div class="rail-actions">${kind.actions.filter((a) => a !== "edit").map((a) => actionButton(a, issue)).join("")}
          ${typed ? '<button type="button" class="rail-btn" data-issue-action="edit">Type…</button>' : ""}
          ${issue.kind !== "NON_LEARNER" ? '<button type="button" class="rail-btn subtle" data-issue-action="exclude">Exclude line</button>' : ""}</div>`;
    return `<article class="rail-item ${active ? "active" : ""}" data-rail-issue="${escapeHtml(issue.id)}">
      <div class="rail-item-head"><span class="rail-num">${n}</span>
        <span class="tamil rail-span">${escapeHtml(issue.text.length > 60 ? issue.text.slice(0, 57) + "…" : issue.text) || "—"}</span></div>
      <div class="rail-kind">${escapeHtml(kind.label)}${issue.confidence != null ? ` · ${Math.round(issue.confidence * 100)}%` : ""}</div>
      ${choices}
    </article>`;
  };

  const pageDone = !open.length;
  target.innerHTML = `
    <div class="rail-head"><strong>REVIEW — PAGE ${reviewPage}</strong>
      <span class="small">${open.length ? `${open.length} ${open.length > 1 ? "items need" : "item needs"} attention` : "Nothing needs attention"}</span></div>
    ${open.map((x, i) => card(x, i + 1)).join("")}
    ${pageDone ? `<div class="rail-done">✓ Page ${reviewPage} is complete.${reviewPage < totalPages
        ? ' <button type="button" class="rail-btn primary-btn" data-rail-next-page>Next page →</button>'
        : ' All pages can now continue to error annotation.'}</div>` : ""}
    ${done.length ? `<details class="rail-resolved" ${pageDone ? "open" : ""}><summary>Resolved on this page (${done.length})</summary>${done.map((x) => card(x)).join("")}</details>` : ""}
    <div class="rail-foot small">Shortcuts: <kbd>J</kbd>/<kbd>K</kbd> next/previous · <kbd>A</kbd> option A / accept · <kbd>B</kbd> option B · <kbd>E</kbd> type · <kbd>X</kbd> exclude line</div>`;

  target.querySelectorAll("[data-rail-issue]").forEach((el) => {
    const id = el.dataset.railIssue;
    el.addEventListener("click", (ev) => { if (!ev.target.closest("button, input")) selectIssue(id); });
    el.querySelectorAll("[data-issue-action]").forEach((b) => b.addEventListener("click", () => {
      const action = b.dataset.issueAction;
      if (action === "edit") { focusTypeBox(id); return; }
      resolveIssue(id, action);
    }));
    const input = el.querySelector(".rail-edit-input");
    input?.addEventListener("keydown", (ev) => {
      // Tamil input methods use Enter to CONFIRM the composed word; only a plain Enter saves.
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === "Enter") {
        ev.preventDefault();
        const v = ev.target.value.trim();
        if (v) resolveIssue(id, "edit", v);
      }
      if (ev.key === "Escape") ev.target.blur();
    });
    el.querySelector("[data-issue-reopen]")?.addEventListener("click", () => reopenIssue(id));
    el.querySelector("[data-issue-change]")?.addEventListener("click", () => { reopenIssue(id); focusTypeBox(id); });
  });
  target.querySelector("[data-rail-next-page]")?.addEventListener("click", () => $("reviewNextPage").click());
}

function focusTypeBox(id) {
  if (id !== activeIssueId) selectIssue(id, { scroll: false });
  requestAnimationFrame(() => {
    const input = $("s3Rail").querySelector(`[data-rail-issue="${CSS.escape(id)}"] .rail-edit-input`);
    if (input) { input.focus(); }
  });
}

/* ---------- top-level ---------- */
function renderStructuredReview() {
  const structured = $("structuredReviewMode");
  const simple = $("simpleReviewMode");
  if (!importedTranscriptionReview) {
    structured.classList.add("hidden");
    simple.classList.remove("hidden");
    $("reviewProgress").textContent = "Manual verification";
    renderSourcePreview("simpleVerifySourcePreview");
    return;
  }
  structured.classList.remove("hidden");
  simple.classList.add("hidden");
  reviewLines().forEach(prepareLineForExceptionReview);

  const totalPages = Number(importedTranscriptionReview.page_count || 1);
  reviewPage = Math.max(1, Math.min(reviewPage, totalPages));
  if (activeIssueId) {
    const f = findIssue(activeIssueId);
    if (!f || f.issue.page !== reviewPage) activeIssueId = null;
  }
  if (!activeIssueId && reviewMode === "exceptions") activeIssueId = nextOpenIssueId(null);

  renderReviewPage();
  renderTranscriptPanel();
  renderReviewRail();
  updateReviewProgress();
}

function updateReviewProgress() {
  if (!importedTranscriptionReview) {
    $("reviewProgress").textContent = "Manual verification";
    return;
  }
  const s = stage3Stats();
  const summary = `${s.regions} regions · ${s.clear} clear · ${s.needReview} need review · ${s.resolved}/${s.issues} resolved`;
  $("reviewProgress").textContent = s.issues && s.resolved === s.issues ? `✓ ${s.issues}/${s.issues} resolved` : `${s.resolved}/${s.issues} resolved`;
  $("reviewSummary").textContent = summary;
  const openTotal = s.issues - s.resolved;
  const included = reviewLines().filter(lineIncluded);
  $("uploadToAnnotate").disabled = !included.length || openTotal > 0;
  $("uploadToAnnotate").title = openTotal ? `${openTotal} OCR issue(s) still open` : "";
}

/* old API kept for compatibility: "confirm everything that is included" */
function confirmAllIncludedLines() {
  reviewLines().forEach((line) => {
    if (!lineIncluded(line)) return;
    lineIssues(line).forEach((i) => { if (i.status === "open") { i.status = "resolved"; i.resolution = { action: "accept", origin: "ocr_confirmed" }; } });
    refreshLineStatus(line);
  });
  renderStructuredReview();
}

function copyTranscript() {
  const text = transcriptPlainText(transcriptView === "document" ? "document" : "page");
  navigator.clipboard?.writeText(text).then(() => {
    const b = $("s3CopyBtn");
    if (b) { b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = "Copy"), 1400); }
  });
}

function wireStage3() {
  document.querySelectorAll("[data-transcript-view]").forEach((b) => b.addEventListener("click", () => {
    transcriptView = b.dataset.transcriptView;
    renderTranscriptPanel();
  }));
  document.querySelectorAll("[data-review-mode]").forEach((b) => b.addEventListener("click", () => {
    reviewMode = b.dataset.reviewMode;
    if (reviewMode === "all") activeIssueId = null;
    renderStructuredReview();
  }));
  $("s3ShowExcluded")?.addEventListener("change", (e) => { showExcludedLines = e.target.checked; renderTranscriptPanel(); });
  $("s3CopyBtn")?.addEventListener("click", copyTranscript);

  document.addEventListener("keydown", (ev) => {
    if (uploadCurrentStep !== 3 || !importedTranscriptionReview || reviewMode !== "exceptions") return;
    if (ev.target.closest?.("input, textarea, select") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    const list = pageLines().flatMap((l) => openIssues(l));
    const idx = list.findIndex((i) => i.id === activeIssueId);
    if (k === "j" && list.length) { selectIssue(list[(idx + 1) % list.length].id); ev.preventDefault(); }
    if (k === "k" && list.length) { selectIssue(list[(idx - 1 + list.length) % list.length].id); ev.preventDefault(); }
    const cur = activeIssueId ? findIssue(activeIssueId) : null;
    if (!cur || cur.issue.status !== "open") return;
    const acts = ISSUE_KINDS[cur.issue.kind]?.actions || [];
    if (k === "a") resolveIssue(cur.issue.id, ["optionA", "accept", "remove_word", "keep"].find((x) => acts.includes(x)));
    if (k === "b" && acts.includes("optionB")) resolveIssue(cur.issue.id, "optionB");
    if (k === "x") resolveIssue(cur.issue.id, "exclude");
    if (k === "e") { ev.preventDefault(); focusTypeBox(cur.issue.id); }
  });
}
