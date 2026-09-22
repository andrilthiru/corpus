let corpus = [];

const $ = (id) => document.getElementById(id);

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[c]));
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const safeText = escapeHtml(text);
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return safeText.replace(new RegExp(safeQuery, "giu"), m => `<mark>${m}</mark>`);
  } catch {
    return safeText;
  }
}

function populateStats() {
  $("statDocs").textContent = corpus.length;
  $("statWords").textContent = corpus.reduce((n, d) => n + countWords(d.text), 0).toLocaleString();
  $("statAnnotations").textContent = corpus.reduce((n, d) => n + (d.annotations?.length || 0), 0);
  $("statLevels").textContent = new Set(corpus.map(d => d.level)).size;
}

function populateErrorTypes() {
  const types = [...new Set(
    corpus.flatMap(d => (d.annotations || []).map(a => a.category))
  )].sort();

  $("errorFilter").innerHTML =
    '<option value="">All annotation types</option>' +
    types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
}

function render() {
  const q = $("searchInput").value.trim();
  const level = $("levelFilter").value;
  const error = $("errorFilter").value;

  const filtered = corpus.filter(doc => {
    const matchesText = !q || doc.text.toLocaleLowerCase().includes(q.toLocaleLowerCase());
    const matchesLevel = !level || doc.level === level;
    const matchesError = !error || (doc.annotations || []).some(a => a.category === error);
    return matchesText && matchesLevel && matchesError;
  });

  $("resultSummary").textContent = `${filtered.length} document${filtered.length === 1 ? "" : "s"} found`;

  if (!filtered.length) {
    $("results").innerHTML = '<div class="empty">No documents match your search.</div>';
    return;
  }

  $("results").innerHTML = filtered.map(doc => `
    <article class="result-item">
      <div class="result-top">
        <div>
          <div class="result-id">${escapeHtml(doc.id)} — ${escapeHtml(doc.title)}</div>
          <div class="meta-row">
            <span class="badge">${escapeHtml(doc.level)}</span>
            <span class="badge">${escapeHtml(String(doc.year))}</span>
            <span class="badge">${escapeHtml(doc.task)}</span>
            <span class="badge">${(doc.annotations || []).length} annotation(s)</span>
          </div>
        </div>
        <button class="view-button" onclick="openDocument('${doc.id}')">View document</button>
      </div>
      <div class="snippet">${highlight(doc.text, q)}</div>
    </article>
  `).join("");
}

window.openDocument = function(id) {
  const doc = corpus.find(d => d.id === id);
  if (!doc) return;

  $("dialogId").textContent = doc.id;
  $("dialogTitle").textContent = doc.title;
  $("dialogMeta").innerHTML = `
    <span class="badge">${escapeHtml(doc.level)}</span>
    <span class="badge">${escapeHtml(String(doc.year))}</span>
    <span class="badge">${escapeHtml(doc.task)}</span>
  `;
  $("dialogText").textContent = doc.text;

  const anns = doc.annotations || [];
  $("dialogAnnotations").innerHTML = anns.length
    ? anns.map(a => `
        <div class="annotation">
          <strong>${escapeHtml(a.text)}</strong>
          <div class="small">Category: ${escapeHtml(a.category)}</div>
          ${a.suggested ? `<div class="small">Suggested/standard form: ${escapeHtml(a.suggested)}</div>` : ""}
          ${a.note ? `<div class="small">Note: ${escapeHtml(a.note)}</div>` : ""}
        </div>
      `).join("")
    : '<div class="empty">No annotations for this document.</div>';

  $("docDialog").showModal();
}

async function init() {
  const response = await fetch("data/corpus.json");
  corpus = await response.json();

  populateStats();
  populateErrorTypes();
  render();

  ["searchInput", "levelFilter", "errorFilter"].forEach(id => {
    $(id).addEventListener("input", render);
    $(id).addEventListener("change", render);
  });

  $("clearBtn").addEventListener("click", () => {
    $("searchInput").value = "";
    $("levelFilter").value = "";
    $("errorFilter").value = "";
    render();
  });

  $("closeDialog").addEventListener("click", () => $("docDialog").close());
}

init().catch(err => {
  console.error(err);
  $("results").innerHTML = '<div class="empty">Could not load corpus data.</div>';
});
