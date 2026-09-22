let corpus = [];

let analyzeLevel = "";
let analyzeTool = "search";
let insightLevel = "";
let insightTool = "overview";

const $ = (id) => document.getElementById(id);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function levelLabel(level) {
  return ({
    P4: "Primary 4",
    P6: "Primary 6",
    SEC2: "Secondary 2",
    SEC4: "Secondary 4",
    JC1: "JC1",
    JC2: "JC2"
  })[level] || level || "Overall";
}

function normalizeTamilText(text = "") {
  return String(text).normalize("NFC");
}

function tokenize(text = "") {
  return normalizeTamilText(text)
    .replace(/[.,!?;:()"“”'‘’…\-–—/\\[\]{}<>|*_+=~`@#$%^&]/g, " ")
    .split(/\s+/u)
    .map((w) => w.trim())
    .filter(Boolean);
}

function countWords(text = "") {
  return tokenize(text).length;
}

function docsFor(level = "") {
  return level ? corpus.filter((d) => d.level === level) : corpus;
}

function annotationCount(docs) {
  return docs.reduce((sum, d) => sum + (Array.isArray(d.annotations) ? d.annotations.length : 0), 0);
}

function highlight(text = "", query = "") {
  const safe = escapeHtml(text);
  if (!query) return safe;

  try {
    const regex = new RegExp(escapeRegExp(query), "giu");
    return safe.replace(regex, (m) => `<mark>${m}</mark>`);
  } catch {
    return safe;
  }
}

function switchSection(section) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.querySelectorAll(".navbtn").forEach((button) => button.classList.remove("active"));

  const page = $(section);
  if (page) page.classList.add("active");

  const nav = document.querySelector(`.navbtn[data-section="${section}"]`);
  if (nav) nav.classList.add("active");
}

function populateDashboard() {
  $("statDocs").textContent = corpus.length;
  $("statWords").textContent = corpus
    .reduce((sum, d) => sum + countWords(d.text || ""), 0)
    .toLocaleString();
  $("statAnnotations").textContent = annotationCount(corpus);
  $("statLevels").textContent = new Set(corpus.map((d) => d.level).filter(Boolean)).size;

  const levels = ["P4", "P6", "SEC2", "SEC4", "JC1", "JC2"];
  $("levelBreakdown").innerHTML = levels.map((level) => {
    const n = corpus.filter((d) => d.level === level).length;
    return `<div class="metric-row"><span>${levelLabel(level)}</span><span>${n}</span></div>`;
  }).join("");

  const categories = {};
  corpus.forEach((doc) => {
    (doc.annotations || []).forEach((a) => {
      const key = a.category || "Uncategorised";
      categories[key] = (categories[key] || 0) + 1;
    });
  });

  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  $("annotationBreakdown").innerHTML = sorted.length
    ? sorted.map(([name, n]) =>
        `<div class="metric-row"><span>${escapeHtml(name)}</span><span>${n}</span></div>`
      ).join("")
    : '<div class="empty">No annotation categories yet.</div>';
}

function updateAnalyzeStats() {
  const docs = docsFor(analyzeLevel);

  $("analyzeDocs").textContent = docs.length;
  $("analyzeWords").textContent = docs
    .reduce((sum, d) => sum + countWords(d.text || ""), 0)
    .toLocaleString();
  $("analyzeAnnotations").textContent = annotationCount(docs);
}

function renderSearchTool(docs, query) {
  const q = normalizeTamilText(query).toLocaleLowerCase();

  const filtered = docs.filter((d) => {
    if (!q) return true;

    const haystack = [
      d.text || "",
      d.title || "",
      d.task || "",
      d.id || ""
    ].join(" ").normalize("NFC").toLocaleLowerCase();

    return haystack.includes(q);
  });

  return `
    <div class="small">${filtered.length} document(s) found</div>
    ${filtered.length ? filtered.map((d) => `
      <article class="result-item">
        <div class="result-top">
          <div>
            <div class="result-id">
              ${escapeHtml(d.id)} — <span class="tamil">${escapeHtml(d.title || "Untitled")}</span>
            </div>
            <div class="meta-row">
              <span class="badge">${escapeHtml(levelLabel(d.level))}</span>
              <span class="badge">${escapeHtml(d.task || "Unspecified task")}</span>
              <span class="badge">${countWords(d.text || "")} words</span>
            </div>
          </div>
          <button type="button" onclick="openDocument('${escapeHtml(d.id)}')">View</button>
        </div>
        <div class="snippet">${highlight(d.text || "", query)}</div>
      </article>
    `).join("") : '<div class="empty">No matching texts.</div>'}
  `;
}

function renderKwicTool(docs, query) {
  const q = normalizeTamilText(query).trim();

  if (!q) {
    return '<div class="empty">Enter a Tamil word or phrase above to generate concordance lines.</div>';
  }

  const rows = [];
  const qLower = q.toLocaleLowerCase();

  docs.forEach((d) => {
    const text = normalizeTamilText(d.text || "");
    const lower = text.toLocaleLowerCase();
    let start = 0;

    while (true) {
      const index = lower.indexOf(qLower, start);
      if (index < 0) break;

      rows.push({
        doc: d,
        left: text.slice(Math.max(0, index - 50), index),
        key: text.slice(index, index + q.length),
        right: text.slice(index + q.length, index + q.length + 50)
      });

      start = index + Math.max(q.length, 1);
    }
  });

  if (!rows.length) return '<div class="empty">No concordance lines found.</div>';

  return `
    <div class="small">${rows.length} occurrence(s) found</div>
    ${rows.map((r) => `
      <div class="kwic">
        <div class="kwic-left tamil">${escapeHtml(r.left)}</div>
        <div class="kwic-key tamil"><mark>${escapeHtml(r.key)}</mark></div>
        <div class="kwic-right tamil">${escapeHtml(r.right)}</div>
        <div class="kwic-meta">
          <button type="button" class="linkbtn" onclick="openDocument('${escapeHtml(r.doc.id)}')">
            ${escapeHtml(r.doc.id)}
          </button><br>
          ${escapeHtml(levelLabel(r.doc.level))}
        </div>
      </div>
    `).join("")}
  `;
}

function renderWordlistTool(docs) {
  const counts = {};
  let total = 0;

  docs.forEach((d) => {
    tokenize(d.text || "").forEach((word) => {
      counts[word] = (counts[word] || 0) + 1;
      total += 1;
    });
  });

  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ta"))
    .slice(0, 100);

  if (!rows.length) return '<div class="empty">No words available for this selection.</div>';

  return `
    <div class="small">${Object.keys(counts).length} unique word forms · ${total.toLocaleString()} total words</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>#</th><th>Word</th><th>Frequency</th><th>% of words</th></tr>
        </thead>
        <tbody>
          ${rows.map(([word, count], i) => `
            <tr>
              <td>${i + 1}</td>
              <td class="tamil">${escapeHtml(word)}</td>
              <td>${count}</td>
              <td>${total ? ((count / total) * 100).toFixed(2) : "0.00"}%</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderNgramsTool(docs) {
  const bigrams = {};

  docs.forEach((d) => {
    const words = tokenize(d.text || "");

    for (let i = 0; i < words.length - 1; i += 1) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      bigrams[phrase] = (bigrams[phrase] || 0) + 1;
    }
  });

  const rows = Object.entries(bigrams)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ta"))
    .slice(0, 100);

  if (!rows.length) return '<div class="empty">Not enough text to calculate N-grams.</div>';

  return `
    <div class="small">Showing the 100 most frequent 2-word sequences.</div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>#</th><th>2-word N-gram</th><th>Frequency</th></tr></thead>
        <tbody>
          ${rows.map(([phrase, count], i) => `
            <tr>
              <td>${i + 1}</td>
              <td class="tamil">${escapeHtml(phrase)}</td>
              <td>${count}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTextsTool(docs) {
  if (!docs.length) return '<div class="empty">No learner texts for this selection.</div>';

  return `
    <div class="small">${docs.length} learner text(s)</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>ID</th><th>Level</th><th>Year</th><th>Task</th><th>Title</th><th>Words</th></tr>
        </thead>
        <tbody>
          ${docs.map((d) => `
            <tr>
              <td>
                <button type="button" class="linkbtn" onclick="openDocument('${escapeHtml(d.id)}')">
                  ${escapeHtml(d.id)}
                </button>
              </td>
              <td>${escapeHtml(levelLabel(d.level))}</td>
              <td>${escapeHtml(d.year || "—")}</td>
              <td>${escapeHtml(d.task || "—")}</td>
              <td class="tamil">${escapeHtml(d.title || "Untitled")}</td>
              <td>${countWords(d.text || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAnnotationsTool(docs) {
  const rows = docs.flatMap((d) =>
    (d.annotations || []).map((a) => ({ doc: d, annotation: a }))
  );

  if (!rows.length) {
    return '<div class="empty">No annotations are available for this selection yet.</div>';
  }

  return `
    <div class="small">${rows.length} annotation(s)</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Level</th>
            <th>Learner form</th>
            <th>Category</th>
            <th>Suggested / standard form</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ doc, annotation: a }) => `
            <tr>
              <td>
                <button type="button" class="linkbtn" onclick="openDocument('${escapeHtml(doc.id)}')">
                  ${escapeHtml(doc.id)}
                </button>
              </td>
              <td>${escapeHtml(levelLabel(doc.level))}</td>
              <td class="tamil">${escapeHtml(a.text || "—")}</td>
              <td>${escapeHtml(a.category || "Uncategorised")}</td>
              <td class="tamil">${escapeHtml(a.suggested || "—")}</td>
              <td>${escapeHtml(a.note || "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTextTypeTool(docs) {
  const groups = {};

  docs.forEach((d) => {
    const task = d.task || "Unspecified";
    if (!groups[task]) groups[task] = { docs: 0, words: 0, annotations: 0 };

    groups[task].docs += 1;
    groups[task].words += countWords(d.text || "");
    groups[task].annotations += (d.annotations || []).length;
  });

  const rows = Object.entries(groups).sort((a, b) => b[1].docs - a[1].docs);

  if (!rows.length) return '<div class="empty">No text-type metadata available.</div>';

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Text / task type</th><th>Texts</th><th>Total words</th><th>Annotations</th></tr>
        </thead>
        <tbody>
          ${rows.map(([task, stats]) => `
            <tr>
              <td>${escapeHtml(task)}</td>
              <td>${stats.docs}</td>
              <td>${stats.words.toLocaleString()}</td>
              <td>${stats.annotations}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAnalyze() {
  updateAnalyzeStats();

  const docs = docsFor(analyzeLevel);
  const query = $("analyzeSearch").value.trim();

  let html = "";

  if (analyzeTool === "search") html = renderSearchTool(docs, query);
  else if (analyzeTool === "kwic") html = renderKwicTool(docs, query);
  else if (analyzeTool === "wordlist") html = renderWordlistTool(docs);
  else if (analyzeTool === "ngrams") html = renderNgramsTool(docs);
  else if (analyzeTool === "texts") html = renderTextsTool(docs);
  else if (analyzeTool === "annotations") html = renderAnnotationsTool(docs);
  else if (analyzeTool === "texttypes") html = renderTextTypeTool(docs);
  else html = '<div class="empty">Unknown analysis tool.</div>';

  $("analyzeOutput").innerHTML = html;
}

function renderInsights() {
  const docs = docsFor(insightLevel);
  const words = docs.reduce((sum, d) => sum + countWords(d.text || ""), 0);
  const anns = annotationCount(docs);

  const categoryCounts = {};
  docs.forEach((d) => {
    (d.annotations || []).forEach((a) => {
      const category = a.category || "Uncategorised";
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });
  });

  if (insightTool === "overview") {
    $("insightOutput").innerHTML = `
      <div class="insight-grid">
        <div class="insight-card"><span>Selected corpus</span><strong>${escapeHtml(levelLabel(insightLevel))}</strong></div>
        <div class="insight-card"><span>Learner texts</span><strong>${docs.length}</strong></div>
        <div class="insight-card"><span>Total words</span><strong>${words.toLocaleString()}</strong></div>
        <div class="insight-card"><span>Annotations</span><strong>${anns}</strong></div>
        <div class="insight-card"><span>Annotations / 1,000 words</span><strong>${words ? ((anns / words) * 1000).toFixed(1) : "0.0"}</strong></div>
        <div class="insight-card"><span>Text / task types</span><strong>${new Set(docs.map((d) => d.task).filter(Boolean)).size}</strong></div>
      </div>
    `;
    return;
  }

  if (insightTool === "trends" || insightTool === "compare") {
    const levels = ["P4", "P6", "SEC2", "SEC4", "JC1", "JC2"];

    const stats = levels.map((level) => {
      const levelDocs = docsFor(level);
      const levelWords = levelDocs.reduce((sum, d) => sum + countWords(d.text || ""), 0);
      const levelAnns = annotationCount(levelDocs);

      return {
        level,
        rate: levelWords ? (levelAnns / levelWords) * 1000 : 0
      };
    });

    const max = Math.max(1, ...stats.map((s) => s.rate));

    $("insightOutput").innerHTML = `
      <h3>Annotation rate by learner level</h3>
      <div class="small">Prototype measure: annotations per 1,000 words.</div>
      ${stats.map((s) => `
        <div class="bar-row">
          <span>${escapeHtml(levelLabel(s.level))}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(s.rate / max) * 100}%"></div>
          </div>
          <strong>${s.rate.toFixed(1)}</strong>
        </div>
      `).join("")}
    `;
    return;
  }

  if (insightTool === "distribution" || insightTool === "errors") {
    const entries = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      $("insightOutput").innerHTML =
        '<div class="empty">Add more annotations to generate meaningful error and annotation patterns.</div>';
      return;
    }

    const max = Math.max(...entries.map((x) => x[1]));

    $("insightOutput").innerHTML = `
      <h3>${insightTool === "errors" ? "Error / annotation patterns" : "Annotation distribution"}</h3>
      ${entries.map(([name, count]) => `
        <div class="bar-row">
          <span>${escapeHtml(name)}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(count / max) * 100}%"></div>
          </div>
          <strong>${count}</strong>
        </div>
      `).join("")}
    `;
    return;
  }

  if (insightTool === "vocabulary") {
    const counts = {};
    let total = 0;

    docs.forEach((d) => {
      tokenize(d.text || "").forEach((word) => {
        counts[word] = (counts[word] || 0) + 1;
        total += 1;
      });
    });

    const unique = Object.keys(counts).length;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);

    $("insightOutput").innerHTML = `
      <div class="insight-grid">
        <div class="insight-card"><span>Unique word forms</span><strong>${unique}</strong></div>
        <div class="insight-card"><span>Total words</span><strong>${total.toLocaleString()}</strong></div>
        <div class="insight-card"><span>Type-token ratio</span><strong>${total ? (unique / total).toFixed(3) : "0.000"}</strong></div>
      </div>

      <h3 style="margin-top:20px">Most frequent word forms</h3>

      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>#</th><th>Word</th><th>Frequency</th></tr></thead>
          <tbody>
            ${top.map(([word, count], i) => `
              <tr><td>${i + 1}</td><td class="tamil">${escapeHtml(word)}</td><td>${count}</td></tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  $("insightOutput").innerHTML = '<div class="empty">No insight view available.</div>';
}

window.openDocument = function (id) {
  const d = corpus.find((x) => x.id === id);
  if (!d) return;

  $("dialogId").textContent = d.id;
  $("dialogTitle").textContent = d.title || "Untitled";

  $("dialogMeta").innerHTML = `
    <span class="badge">${escapeHtml(levelLabel(d.level))}</span>
    <span class="badge">${escapeHtml(d.year || "—")}</span>
    <span class="badge">${escapeHtml(d.task || "—")}</span>
    <span class="badge">${countWords(d.text || "")} words</span>
  `;

  $("dialogText").textContent = d.text || "";

  const annotations = d.annotations || [];

  $("dialogAnnotations").innerHTML = annotations.length
    ? annotations.map((a) => `
        <div class="annotation">
          <strong class="tamil">${escapeHtml(a.text || "")}</strong>
          <div class="small">Category: ${escapeHtml(a.category || "Uncategorised")}</div>
          ${a.suggested
            ? `<div class="small">Suggested form: <span class="tamil">${escapeHtml(a.suggested)}</span></div>`
            : ""}
          ${a.note ? `<div class="small">Note: ${escapeHtml(a.note)}</div>` : ""}
        </div>
      `).join("")
    : '<div class="empty">No annotations for this document.</div>';

  $("docDialog").showModal();
};

function wireNavigation() {
  document.querySelectorAll(".navbtn").forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.section));
  });

  document.querySelectorAll("#analyzeLevelTabs .levelbtn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#analyzeLevelTabs .levelbtn")
        .forEach((x) => x.classList.remove("active"));

      button.classList.add("active");
      analyzeLevel = button.dataset.level || "";
      renderAnalyze();
    });
  });

  document.querySelectorAll(".toolbtn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".toolbtn").forEach((x) => x.classList.remove("active"));
      button.classList.add("active");
      analyzeTool = button.dataset.tool;
      renderAnalyze();
    });
  });

  $("analyzeSearch").addEventListener("input", () => {
    if (analyzeTool === "search" || analyzeTool === "kwic") renderAnalyze();
  });

  $("analyzeClear").addEventListener("click", () => {
    $("analyzeSearch").value = "";
    renderAnalyze();
  });

  document.querySelectorAll("#insightLevelTabs .levelbtn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#insightLevelTabs .levelbtn")
        .forEach((x) => x.classList.remove("active"));

      button.classList.add("active");
      insightLevel = button.dataset.level || "";
      renderInsights();
    });
  });

  document.querySelectorAll(".insightbtn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".insightbtn").forEach((x) => x.classList.remove("active"));
      button.classList.add("active");
      insightTool = button.dataset.insight;
      renderInsights();
    });
  });

  $("uploadFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    $("uploadPreview").classList.remove("empty");
    $("uploadPreview").innerHTML = `
      <strong>${escapeHtml(file.name)}</strong><br>
      <span class="small">
        Assigned level: ${escapeHtml(levelLabel($("uploadLevel").value))}
        · ${(file.size / 1024).toFixed(1)} KB
      </span><br><br>
      <span class="small">
        Prototype only: the next production step will route the file through OCR/HTR,
        human verification, anonymisation and annotation before it enters the corpus.
      </span>
    `;
  });

  $("uploadLevel").addEventListener("change", () => {
    const file = $("uploadFile").files?.[0];
    if (file) $("uploadFile").dispatchEvent(new Event("change"));
  });

  $("closeDialog").addEventListener("click", () => $("docDialog").close());
}

async function init() {
  const response = await fetch("data/corpus.json", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Could not load data/corpus.json (${response.status})`);
  }

  corpus = await response.json();

  if (!Array.isArray(corpus)) {
    throw new Error("corpus.json must contain a JSON array.");
  }

  populateDashboard();
  renderAnalyze();
  renderInsights();
  wireNavigation();
}

init().catch((error) => {
  console.error(error);

  document.body.insertAdjacentHTML(
    "beforeend",
    `<div style="max-width:900px;margin:30px auto;padding:20px;background:#fff;border:1px solid #ddd;border-radius:10px">
      <strong>Corpus could not be loaded.</strong><br>
      ${escapeHtml(error.message)}
    </div>`
  );
});
