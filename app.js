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

function updateWorkspaceWidth() {
  const onUpload = $("upload")?.classList.contains("active");
  document.body.classList.toggle("wide-workspace", Boolean(onUpload && uploadCurrentStep >= 2 && uploadCurrentStep <= 4));
}

function switchSection(section) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.querySelectorAll(".navbtn").forEach((button) => button.classList.remove("active"));

  const page = $(section);
  if (page) page.classList.add("active");

  const nav = document.querySelector(`.navbtn[data-section="${section}"]`);
  if (nav) nav.classList.add("active");
  updateWorkspaceWidth();
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

function getMatchingDocs(docs, query) {
  const q = normalizeTamilText(query).trim().toLocaleLowerCase();
  if (!q) return docs;

  return docs.filter((d) =>
    normalizeTamilText(d.text || "").toLocaleLowerCase().includes(q)
  );
}

function countOccurrences(text = "", query = "") {
  const q = normalizeTamilText(query).trim().toLocaleLowerCase();
  if (!q) return 0;

  const haystack = normalizeTamilText(text).toLocaleLowerCase();
  let count = 0;
  let start = 0;

  while (true) {
    const index = haystack.indexOf(q, start);
    if (index < 0) break;
    count += 1;
    start = index + Math.max(q.length, 1);
  }

  return count;
}

function topicLabel(doc) {
  return doc.topic || doc.subject || "Unspecified";
}

function updateAnalyzeMode(query) {
  const q = normalizeTamilText(query).trim();

  if (q) {
    $("analyzeModeBanner").innerHTML = `
      <strong>Term View</strong>
      <span>Analyzing <span class="tamil">“${escapeHtml(q)}”</span> within ${escapeHtml(levelLabel(analyzeLevel))}.</span>
    `;
  } else {
    $("analyzeModeBanner").innerHTML = `
      <strong>Corpus View</strong>
      <span>Showing ${escapeHtml(levelLabel(analyzeLevel))} as a whole.</span>
    `;
  }
}

function renderTermSummary(docs, query) {
  const q = normalizeTamilText(query).trim();

  if (!q) {
    $("termSummary").innerHTML = "";
    return;
  }

  const matching = getMatchingDocs(docs, q);
  const occurrences = matching.reduce((sum, d) => sum + countOccurrences(d.text || "", q), 0);
  const totalWords = docs.reduce((sum, d) => sum + countWords(d.text || ""), 0);
  const rate = totalWords ? (occurrences / totalWords) * 1000 : 0;

  const levelCounts = {};
  matching.forEach((d) => {
    levelCounts[d.level] = (levelCounts[d.level] || 0) + countOccurrences(d.text || "", q);
  });

  const topicCounts = {};
  matching.forEach((d) => {
    const topic = topicLabel(d);
    topicCounts[topic] = (topicCounts[topic] || 0) + countOccurrences(d.text || "", q);
  });

  const sortedLevels = Object.entries(levelCounts).sort((a, b) => b[1] - a[1]);
  const sortedTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  $("termSummary").innerHTML = `
    <div class="term-summary-grid">
      <div class="term-stat"><span>Search term</span><strong class="tamil">${escapeHtml(q)}</strong></div>
      <div class="term-stat"><span>Total occurrences</span><strong>${occurrences}</strong></div>
      <div class="term-stat"><span>Texts containing term</span><strong>${matching.length}</strong></div>
      <div class="term-stat"><span>Occurrences / 1,000 words</span><strong>${rate.toFixed(2)}</strong></div>
    </div>

    <div class="breakdown-grid">
      <div class="breakdown-box">
        <h4>Occurrences by level</h4>
        ${sortedLevels.length
          ? sortedLevels.map(([level, count]) =>
              `<div class="breakdown-row"><span>${escapeHtml(levelLabel(level))}</span><strong>${count}</strong></div>`
            ).join("")
          : '<div class="small">No matching levels.</div>'}
      </div>

      <div class="breakdown-box">
        <h4>Occurrences by topic</h4>
        ${sortedTopics.length
          ? sortedTopics.map(([topic, count]) =>
              `<div class="breakdown-row"><span>${escapeHtml(topic)}</span><strong>${count}</strong></div>`
            ).join("")
          : '<div class="small">Topic metadata is not available yet.</div>'}
      </div>
    </div>
  `;
}

function renderSearchTool(docs, query) {
  const matching = getMatchingDocs(docs, query);

  return `
    <div class="small">${matching.length} document(s) found</div>
    ${matching.length ? matching.map((d) => `
      <article class="result-item">
        <div class="result-top">
          <div>
            <div class="result-id">
              ${escapeHtml(d.id)} — <span class="tamil">${escapeHtml(d.title || "Untitled")}</span>
            </div>
            <div class="meta-row">
              <span class="badge">${escapeHtml(levelLabel(d.level))}</span>
              <span class="badge">${escapeHtml(d.task || "Unspecified task")}</span>
              <span class="badge">${escapeHtml(topicLabel(d))}</span>
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
    return `
      <div class="require-search">
        <strong>Search term required</strong>
        <span>Enter a word or phrase above to see every occurrence in context.</span>
      </div>`;
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

  return rows.map((r) => `
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
  `).join("");
}

function renderWordlistTool(docs, query) {
  const counts = {};
  let total = 0;

  docs.forEach((d) => {
    tokenize(d.text || "").forEach((word) => {
      counts[word] = (counts[word] || 0) + 1;
      total += 1;
    });
  });

  const q = normalizeTamilText(query).trim();

  if (q) {
    const qLower = q.toLocaleLowerCase();

    const matchingForms = Object.entries(counts)
      .filter(([word]) => word.toLocaleLowerCase() === qLower)
      .sort((a, b) => b[1] - a[1]);

    const exactFrequency = matchingForms.reduce((sum, [, count]) => sum + count, 0);
    const percentage = total ? (exactFrequency / total) * 100 : 0;
    const perThousand = total ? (exactFrequency / total) * 1000 : 0;

    if (!matchingForms.length) {
      return `
        <h3>Wordlist result</h3>
        <div class="empty">The exact word <span class="tamil">“${escapeHtml(q)}”</span> does not appear as a standalone word in the selected corpus.</div>
      `;
    }

    return `
      <h3>Wordlist result</h3>
      <div class="small">Exact standalone word frequency within ${escapeHtml(levelLabel(analyzeLevel))}.</div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Word</th>
              <th>Frequency</th>
              <th>% of selected corpus</th>
              <th>Per 1,000 words</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="tamil">${escapeHtml(q)}</td>
              <td>${exactFrequency}</td>
              <td>${percentage.toFixed(2)}%</td>
              <td>${perThousand.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ta"))
    .slice(0, 100);

  if (!rows.length) return '<div class="empty">No words available for this selection.</div>';

  return `
    <h3>Wordlist</h3>
    <div class="small">${Object.keys(counts).length} unique word forms · ${total.toLocaleString()} total words</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>#</th><th>Word</th><th>Frequency</th><th>% of selected corpus</th><th>Per 1,000 words</th></tr>
        </thead>
        <tbody>
          ${rows.map(([word, count], i) => `
            <tr>
              <td>${i + 1}</td>
              <td class="tamil">${escapeHtml(word)}</td>
              <td>${count}</td>
              <td>${total ? ((count / total) * 100).toFixed(2) : "0.00"}%</td>
              <td>${total ? ((count / total) * 1000).toFixed(2) : "0.00"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderNgramsTool(docs, query) {
  const counts = {};
  const q = normalizeTamilText(query).trim().toLocaleLowerCase();

  docs.forEach((d) => {
    const words = tokenize(d.text || "");

    for (let i = 0; i < words.length - 1; i += 1) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (!q || bigram.toLocaleLowerCase().includes(q)) {
        counts[bigram] = (counts[bigram] || 0) + 1;
      }
    }

    for (let i = 0; i < words.length - 2; i += 1) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (!q || trigram.toLocaleLowerCase().includes(q)) {
        counts[trigram] = (counts[trigram] || 0) + 1;
      }
    }
  });

  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ta"))
    .slice(0, 100);

  if (!rows.length) {
    return query
      ? `<div class="empty">No 2-word or 3-word N-grams containing <span class="tamil">“${escapeHtml(query)}”</span> were found.</div>`
      : '<div class="empty">Not enough text to calculate N-grams.</div>';
  }

  return `
    <h3>${query ? `N-grams containing <span class="tamil">“${escapeHtml(query)}”</span>` : "Frequent N-grams"}</h3>
    <div class="small">Consecutive 2-word and 3-word sequences.</div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>#</th><th>N-gram</th><th>Frequency</th></tr></thead>
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

function renderCollocationsTool(docs, query) {
  const q = normalizeTamilText(query).trim();

  if (!q) {
    return `
      <div class="require-search">
        <strong>Search term required</strong>
        <span>Enter a word or phrase above to identify words that frequently occur near it.</span>
      </div>`;
  }

  const qLower = q.toLocaleLowerCase();
  const collocates = {};
  const windowSize = 5;

  docs.forEach((d) => {
    const words = tokenize(d.text || "");

    words.forEach((word, i) => {
      if (word.toLocaleLowerCase().includes(qLower)) {
        const start = Math.max(0, i - windowSize);
        const end = Math.min(words.length, i + windowSize + 1);

        for (let j = start; j < end; j += 1) {
          if (j === i) continue;
          const nearby = words[j];
          collocates[nearby] = (collocates[nearby] || 0) + 1;
        }
      }
    });
  });

  const rows = Object.entries(collocates)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ta"))
    .slice(0, 100);

  if (!rows.length) {
    return `<div class="empty">No collocates found around <span class="tamil">“${escapeHtml(q)}”</span>.</div>`;
  }

  return `
    <h3>Collocations around <span class="tamil">“${escapeHtml(q)}”</span></h3>
    <div class="small">Words occurring within 5 words before or after the search term.</div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>#</th><th>Nearby word</th><th>Occurrences near search term</th></tr></thead>
        <tbody>
          ${rows.map(([word, count], i) => `
            <tr>
              <td>${i + 1}</td>
              <td class="tamil">${escapeHtml(word)}</td>
              <td>${count}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTextsTool(docs, query) {
  const matching = query ? getMatchingDocs(docs, query) : docs;

  if (!matching.length) return '<div class="empty">No learner texts for this selection.</div>';

  return `
    <div class="small">${matching.length} learner text(s)</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>ID</th><th>Level</th><th>Year</th><th>Task</th><th>Topic</th><th>Title</th><th>Occurrences</th><th>Words</th></tr>
        </thead>
        <tbody>
          ${matching.map((d) => `
            <tr>
              <td>
                <button type="button" class="linkbtn" onclick="openDocument('${escapeHtml(d.id)}')">
                  ${escapeHtml(d.id)}
                </button>
              </td>
              <td>${escapeHtml(levelLabel(d.level))}</td>
              <td>${escapeHtml(d.year || "—")}</td>
              <td>${escapeHtml(d.task || "—")}</td>
              <td>${escapeHtml(topicLabel(d))}</td>
              <td class="tamil">${escapeHtml(d.title || "Untitled")}</td>
              <td>${query ? countOccurrences(d.text || "", query) : "—"}</td>
              <td>${countWords(d.text || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAnnotationsTool(docs, query) {
  const matching = query ? getMatchingDocs(docs, query) : docs;
  const rows = matching.flatMap((d) =>
    (d.annotations || []).map((a) => ({ doc: d, annotation: a }))
  );

  if (!rows.length) {
    return query
      ? `<div class="empty">No annotations are available in texts containing <span class="tamil">“${escapeHtml(query)}”</span>.</div>`
      : '<div class="empty">No annotations are available for this selection yet.</div>';
  }

  return `
    <div class="small">${rows.length} annotation(s) in ${matching.length} text(s)</div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Level</th>
            <th>Topic</th>
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
              <td>${escapeHtml(topicLabel(doc))}</td>
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

function renderTextTypeTool(docs, query) {
  const matching = query ? getMatchingDocs(docs, query) : docs;
  const groups = {};

  matching.forEach((d) => {
    const task = d.task || "Unspecified";
    if (!groups[task]) groups[task] = { docs: 0, words: 0, annotations: 0, occurrences: 0 };

    groups[task].docs += 1;
    groups[task].words += countWords(d.text || "");
    groups[task].annotations += (d.annotations || []).length;
    groups[task].occurrences += query ? countOccurrences(d.text || "", query) : 0;
  });

  const rows = Object.entries(groups).sort((a, b) =>
    query ? b[1].occurrences - a[1].occurrences : b[1].docs - a[1].docs
  );

  if (!rows.length) return '<div class="empty">No text-type metadata available.</div>';

  return `
    <h3>${query ? `Text types containing <span class="tamil">“${escapeHtml(query)}”</span>` : "Text Type Analysis"}</h3>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Text / task type</th>
            <th>Texts</th>
            ${query ? "<th>Term occurrences</th>" : ""}
            <th>Total words</th>
            <th>Annotations</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([task, stats]) => `
            <tr>
              <td>${escapeHtml(task)}</td>
              <td>${stats.docs}</td>
              ${query ? `<td>${stats.occurrences}</td>` : ""}
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

  updateAnalyzeMode(query);
  renderTermSummary(docs, query);

  let html = "";

  if (analyzeTool === "search") html = renderSearchTool(docs, query);
  else if (analyzeTool === "kwic") html = renderKwicTool(docs, query);
  else if (analyzeTool === "wordlist") html = renderWordlistTool(docs, query);
  else if (analyzeTool === "ngrams") html = renderNgramsTool(docs, query);
  else if (analyzeTool === "collocations") html = renderCollocationsTool(docs, query);
  else if (analyzeTool === "texts") html = renderTextsTool(docs, query);
  else if (analyzeTool === "annotations") html = renderAnnotationsTool(docs, query);
  else if (analyzeTool === "texttypes") html = renderTextTypeTool(docs, query);
  else html = '<div class="empty">Unknown analysis tool.</div>';

  $("analyzeOutput").innerHTML = html;
}


function svgBarChart(title, rows, { illustrative = false } = {}) {
  const width = 760;
  const height = Math.max(250, 70 + rows.length * 44);
  const left = 150;
  const right = 35;
  const top = 48;
  const rowH = 36;
  const usable = width - left - right;
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));

  return `
    <div class="insight-chart-card">
      <div class="chart-title-row">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${illustrative ? '<div class="small">Illustrative demo data only — not a corpus finding.</div>' : ""}
        </div>
      </div>
      <svg class="insight-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
        ${rows.map((r, i) => {
          const y = top + i * rowH;
          const barW = (Number(r.value || 0) / max) * usable;
          return `
            <text x="${left - 12}" y="${y + 17}" text-anchor="end" class="chart-label">${escapeHtml(r.label)}</text>
            <rect x="${left}" y="${y}" width="${usable}" height="24" rx="5" class="chart-track-svg"></rect>
            <rect x="${left}" y="${y}" width="${Math.max(2, barW)}" height="24" rx="5" class="chart-bar-svg"></rect>
            <text x="${Math.min(width - 8, left + barW + 8)}" y="${y + 17}" class="chart-value">${Number(r.value || 0).toFixed(r.decimals ?? 0)}</text>
          `;
        }).join("")}
      </svg>
    </div>
  `;
}

function svgLineChart(title, rows, { illustrative = false, suffix = "" } = {}) {
  const width = 760;
  const height = 300;
  const left = 55;
  const right = 30;
  const top = 45;
  const bottom = 55;
  const usableW = width - left - right;
  const usableH = height - top - bottom;
  const max = Math.max(1, ...rows.map((r) => Number(r.value || 0)));
  const points = rows.map((r, i) => {
    const x = left + (rows.length <= 1 ? usableW / 2 : (i / (rows.length - 1)) * usableW);
    const y = top + usableH - (Number(r.value || 0) / max) * usableH;
    return { ...r, x, y };
  });

  return `
    <div class="insight-chart-card">
      <div class="chart-title-row">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${illustrative ? '<div class="small">Illustrative demo data only — not a corpus finding.</div>' : ""}
        </div>
      </div>
      <svg class="insight-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
        <line x1="${left}" y1="${top + usableH}" x2="${width - right}" y2="${top + usableH}" class="chart-axis"></line>
        <polyline points="${points.map((p) => `${p.x},${p.y}`).join(" ")}" class="chart-line" fill="none"></polyline>
        ${points.map((p) => `
          <circle cx="${p.x}" cy="${p.y}" r="5" class="chart-point"></circle>
          <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" class="chart-value">${Number(p.value).toFixed(1)}${escapeHtml(suffix)}</text>
          <text x="${p.x}" y="${top + usableH + 28}" text-anchor="middle" class="chart-label">${escapeHtml(p.label)}</text>
        `).join("")}
      </svg>
    </div>
  `;
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

      <div class="insight-chart-grid">
        ${(() => {
          const actual = Object.entries(categoryCounts).sort((x, y) => y[1] - x[1]).slice(0, 6);
          const rows = actual.length
            ? actual.map(([label, value]) => ({ label: prettyCategory(label), value }))
            : [
                { label: "Spelling", value: 18 },
                { label: "Grammar", value: 11 },
                { label: "Punctuation", value: 8 },
                { label: "Word choice", value: 6 },
                { label: "Extra word", value: 4 }
              ];
          return svgBarChart("Most frequent annotation categories", rows, { illustrative: !actual.length });
        })()}

        ${(() => {
          const levels = ["P4","P6","SEC2","SEC4","JC1","JC2"];
          const actualRows = levels.map((level) => {
            const ld = docsFor(level);
            const lw = ld.reduce((sum, d) => sum + countWords(d.text || ""), 0);
            const la = annotationCount(ld);
            return { label: levelLabel(level).replace("Primary ", "P").replace("Secondary ", "Sec "), value: lw ? (la / lw) * 1000 : 0 };
          });
          const hasData = actualRows.some((r) => r.value > 0);
          const rows = hasData ? actualRows : [
            { label: "P4", value: 42.0 },
            { label: "P6", value: 35.5 },
            { label: "Sec 2", value: 29.0 },
            { label: "Sec 4", value: 24.5 },
            { label: "JC1", value: 20.0 },
            { label: "JC2", value: 17.5 }
          ];
          return svgLineChart("Annotation rate by learner level", rows, { illustrative: !hasData, suffix: "" });
        })()}
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
  }
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

  $("dialogTopic").innerHTML = `
    <strong>Topic:</strong> ${escapeHtml(topicLabel(d))}
    ${d.prompt ? `<br><strong>Prompt:</strong> <span class="tamil">${escapeHtml(d.prompt)}</span>` : ""}
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

let uploadCurrentStep = 1;
let uploadObjectUrl = null;
let draftAnnotations = [];
let importedTranscriptionReview = null;
let ocrProcessing = false;
let ocrPageStates = [];
let ocrRunSerial = 0;
let currentOcrController = null;
let reviewPage = 1;
let reviewZoom = 1;
let activeReviewLineId = null;
let errorCandidates = [];
let errorDetectionRunning = false;

// v0.11.2 local draft persistence
const DRAFT_DB_NAME = "themozhi-corpus-review";
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const ACTIVE_DRAFT_KEY = "active";
let draftDbPromise = null;
let draftAutosaveTimer = null;
let draftAutosaveEnabled = false;
let restoringDraft = false;
let savedSourceFileMeta = null;


function openDraftDb() {
  if (draftDbPromise) return draftDbPromise;

  draftDbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local draft storage."));
  });

  return draftDbPromise;
}

async function draftDbGet(key = ACTIVE_DRAFT_KEY) {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, "readonly");
    const request = tx.objectStore(DRAFT_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read saved draft."));
  });
}

async function draftDbPut(record) {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, "readwrite");
    tx.objectStore(DRAFT_STORE).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("Could not save draft."));
    tx.onabort = () => reject(tx.error || new Error("Draft save was aborted."));
  });
}

async function draftDbDelete(key = ACTIVE_DRAFT_KEY) {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, "readwrite");
    tx.objectStore(DRAFT_STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("Could not delete saved draft."));
  });
}

function setDraftSaveStatus(message, state = "") {
  const target = $("draftSaveStatus");
  if (!target) return;
  target.textContent = message;
  target.className = `draft-save-status ${state}`.trim();
}

function currentSourceFileMeta() {
  const file = $("uploadFile")?.files?.[0];
  if (file) {
    return {
      name: file.name,
      size: file.size,
      type: file.type || "",
      lastModified: file.lastModified || null
    };
  }
  return savedSourceFileMeta ? { ...savedSourceFileMeta } : null;
}

function draftSnapshot() {
  return {
    key: ACTIVE_DRAFT_KEY,
    version: "0.12",
    saved_at: new Date().toISOString(),
    workflow_stage: Number(uploadCurrentStep || 1),
    metadata: {
      id: $("uploadDocId").value.trim(),
      level: $("uploadLevel").value,
      year: String($("uploadYear").value || ""),
      task: $("uploadTask").value,
      topic: $("uploadTopic").value.trim(),
      title: $("uploadTitle").value.trim(),
      prompt: $("uploadPrompt").value.trim(),
      source_type: $("uploadSourceType").value
    },
    source_file: currentSourceFileMeta(),
    processing_route: $("processingRoute")?.textContent || "",
    transcription_review: reviewExportSnapshot(),
    ocr_page_states: JSON.parse(JSON.stringify(ocrPageStates || [])),
    review_state: {
      page: Number(reviewPage || 1),
      zoom: Number(reviewZoom || 1),
      active_line_id: activeReviewLineId || null
    },
    machine_text: $("machineText").value || "",
    verified_text: $("verifiedText").value || "",
    verification_checked: Boolean($("verificationChecked").checked),
    error_candidates: JSON.parse(JSON.stringify(errorCandidates || [])),
    annotations: JSON.parse(JSON.stringify(draftAnnotations || [])),
    annotation_items: JSON.parse(JSON.stringify(annotationItems || [])),
    stage3_ui: { transcript_view: transcriptView, review_mode: reviewMode, active_issue_id: activeIssueId }
  };
}

function draftIsMeaningful(snapshot) {
  const m = snapshot?.metadata || {};
  return Boolean(
    snapshot?.source_file?.name
    || snapshot?.transcription_review?.lines?.length
    || snapshot?.annotations?.length
    || snapshot?.error_candidates?.length
    || snapshot?.machine_text
    || snapshot?.verified_text
    || m.id
    || m.topic
    || m.title
    || m.prompt
    || Number(snapshot?.workflow_stage || 1) > 1
  );
}

async function saveDraftNow({ silent = false } = {}) {
  if (!draftAutosaveEnabled || restoringDraft) return false;

  const snapshot = draftSnapshot();
  if (!draftIsMeaningful(snapshot)) {
    if (!silent) setDraftSaveStatus("Nothing to save", "muted");
    return false;
  }

  setDraftSaveStatus("Saving…", "saving");

  try {
    await draftDbPut(snapshot);
    savedSourceFileMeta = snapshot.source_file ? { ...snapshot.source_file } : savedSourceFileMeta;
    const when = new Date(snapshot.saved_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setDraftSaveStatus(`Saved locally · ${when}`, "saved");
    return true;
  } catch (error) {
    // Page previews can be large. If browser quota is tight, preserve the
    // important review/annotation state without image previews.
    const quotaLike = error?.name === "QuotaExceededError"
      || /quota|space|storage/i.test(String(error?.message || ""));

    if (quotaLike && snapshot.transcription_review?.page_previews) {
      try {
        const slim = JSON.parse(JSON.stringify(snapshot));
        slim.transcription_review.page_previews = {};
        slim.storage_mode = "text_only_fallback";
        await draftDbPut(slim);
        setDraftSaveStatus("Saved review state · page images omitted", "saved");
        return true;
      } catch (fallbackError) {
        console.error("Draft fallback save failed", fallbackError);
      }
    }

    console.error("Draft autosave failed", error);
    setDraftSaveStatus("Autosave failed", "error");
    return false;
  }
}

function scheduleDraftAutosave() {
  if (!draftAutosaveEnabled || restoringDraft) return;
  clearTimeout(draftAutosaveTimer);
  setDraftSaveStatus("Changes pending…", "saving");
  draftAutosaveTimer = setTimeout(() => {
    saveDraftNow({ silent: true });
  }, 500);
}

function savedDraftStats(snapshot) {
  const lines = Array.isArray(snapshot?.transcription_review?.lines)
    ? snapshot.transcription_review.lines
    : [];
  const issues = lines.flatMap((line) => Array.isArray(line?.review?.issues) ? line.review.issues : []);
  const reviewed = issues.length
    ? issues.filter((i) => i.status === "resolved").length
    : lines.filter((line) => line?.review?.status === "CONFIRMED" || line?.review?.status === "IGNORED").length;
  const total = issues.length || lines.length;
  const pageCount = Number(snapshot?.transcription_review?.page_count || 0);
  const page = Number(snapshot?.review_state?.page || 1);
  const anns = Array.isArray(snapshot?.annotations) ? snapshot.annotations.length : 0;
  return { reviewed, total, pageCount, page, anns };
}

function renderSavedDraftOffer(snapshot) {
  const panel = $("draftResumePanel");
  if (!panel) return;

  if (!snapshot || !draftIsMeaningful(snapshot)) {
    panel.classList.add("hidden");
    return;
  }

  const stats = savedDraftStats(snapshot);
  const id = snapshot?.metadata?.id || "Draft";
  const filename = snapshot?.source_file?.name || snapshot?.transcription_review?.source_filename || "No source filename";
  const when = snapshot?.saved_at
    ? new Date(snapshot.saved_at).toLocaleString()
    : "Unknown save time";

  $("draftResumeSummary").innerHTML = `
    ${escapeHtml(id)} · ${escapeHtml(filename)}
    ${stats.pageCount ? ` · Page ${stats.page}/${stats.pageCount}` : ""}
    ${stats.total ? ` · ${stats.reviewed}/${stats.total} regions reviewed` : ""}
    ${stats.anns ? ` · ${stats.anns} annotation(s)` : ""}
    <br>Last saved: ${escapeHtml(when)}
    <br><span class="draft-local-note">Stored only in this browser on this device.</span>
  `;
  panel.classList.remove("hidden");
}

async function findAndOfferSavedDraft() {
  try {
    const saved = await draftDbGet();
    renderSavedDraftOffer(saved);
    if (saved && draftIsMeaningful(saved)) {
      setDraftSaveStatus("Saved draft available", "saved");
    } else {
      setDraftSaveStatus("Autosave ready", "muted");
    }
    return saved;
  } catch (error) {
    console.warn("Local draft storage unavailable", error);
    setDraftSaveStatus("Local autosave unavailable", "error");
    return null;
  }
}

function applySavedMetadata(metadata = {}) {
  $("uploadDocId").value = metadata.id || "";
  $("uploadLevel").value = metadata.level || "P4";
  $("uploadYear").value = metadata.year || "2026";
  $("uploadTask").value = metadata.task || "Composition";
  $("uploadTopic").value = metadata.topic || "";
  $("uploadTitle").value = metadata.title || "";
  $("uploadPrompt").value = metadata.prompt || "";
  $("uploadSourceType").value = metadata.source_type || "auto";
}

async function restoreSavedDraft(snapshot) {
  if (!snapshot) return;

  restoringDraft = true;
  clearTimeout(draftAutosaveTimer);

  try {
    applySavedMetadata(snapshot.metadata || {});
    savedSourceFileMeta = snapshot.source_file ? { ...snapshot.source_file } : null;
    $("uploadFile").value = "";

    importedTranscriptionReview = snapshot.transcription_review
      ? normaliseImportedReview(snapshot.transcription_review)
      : null;

    ocrPageStates = Array.isArray(snapshot.ocr_page_states)
      ? snapshot.ocr_page_states.map((x) => ({
          ...x,
          status: x.status === "processing" ? "waiting" : x.status
        }))
      : [];

    reviewPage = Math.max(1, Number(snapshot?.review_state?.page || 1));
    reviewZoom = Number(snapshot?.review_state?.zoom || 1);
    activeReviewLineId = snapshot?.review_state?.active_line_id || null;

    errorCandidates = Array.isArray(snapshot.error_candidates)
      ? JSON.parse(JSON.stringify(snapshot.error_candidates))
      : [];
    draftAnnotations = Array.isArray(snapshot.annotations)
      ? JSON.parse(JSON.stringify(snapshot.annotations))
      : [];
    annotationItems = Array.isArray(snapshot.annotation_items)
      ? JSON.parse(JSON.stringify(snapshot.annotation_items))
      : [];
    transcriptView = snapshot?.stage3_ui?.transcript_view || "page";
    reviewMode = snapshot?.stage3_ui?.review_mode || "exceptions";
    activeIssueId = snapshot?.stage3_ui?.active_issue_id || null;

    $("machineText").value = snapshot.machine_text || "";
    $("verifiedText").value = snapshot.verified_text || "";
    $("verificationChecked").checked = Boolean(snapshot.verification_checked);
    $("processingRoute").textContent = snapshot.processing_route || "Saved draft";
    ocrProcessing = false;

    updateUploadPreview();
    updateRecognitionImportStatus();
    renderOcrProgress();
    renderDraftAnnotations();
    renderStructuredReview();
    renderAnnotationWorkspace();

    let targetStep = Math.max(1, Math.min(5, Number(snapshot.workflow_stage || 1)));
    const hasReview = reviewLines().length > 0;
    if (targetStep === 2 && hasReview) targetStep = 3;

    goUploadStep(targetStep);

    const stats = savedDraftStats(snapshot);
    if (targetStep === 3 && stats.total) {
      requestAnimationFrame(scrollActiveRegionIntoView);
    }

    $("draftResumePanel").classList.add("hidden");
    const when = snapshot?.saved_at
      ? new Date(snapshot.saved_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
    setDraftSaveStatus(when ? `Resumed · saved ${when}` : "Draft resumed", "saved");
  } finally {
    restoringDraft = false;
  }
}

async function discardSavedDraft() {
  clearTimeout(draftAutosaveTimer);
  try {
    await draftDbDelete();
  } catch (error) {
    console.warn("Could not delete saved draft", error);
  }
  $("draftResumePanel")?.classList.add("hidden");
  setDraftSaveStatus("Autosave ready", "muted");
}

function reviewLines() {
  return Array.isArray(importedTranscriptionReview?.lines)
    ? importedTranscriptionReview.lines
    : [];
}

function reviewLineText(line) {
  return (line?.review?.verified_text ?? line?.primary_ocr?.raw_text ?? "").trim();
}

function consolidatedVerifiedText() {
  if (!importedTranscriptionReview) return $("verifiedText").value;

  const pages = Number(importedTranscriptionReview.page_count || 1);
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const text = pageLines(p)
      .filter((line) => line?.review?.include_in_corpus !== false && line?.review?.status === "CONFIRMED")
      .map(reviewLineText)
      .filter(Boolean)
      .join("\n");
    if (text) out.push(text);
  }
  return out.join("\n\n");
}

function transcriptionVerified() {
  if (!importedTranscriptionReview) return $("verificationChecked").checked;
  const included = reviewLines().filter((line) => line?.review?.include_in_corpus !== false);
  return included.length > 0 && included.every((line) => line?.review?.status === "CONFIRMED");
}

function reviewExportSnapshot() {
  if (!importedTranscriptionReview) return null;
  return JSON.parse(JSON.stringify(importedTranscriptionReview));
}

function currentUploadRecord() {
  return {
    id: $("uploadDocId").value.trim() || "DRAFT-001",
    level: $("uploadLevel").value,
    year: String($("uploadYear").value || ""),
    task: $("uploadTask").value,
    topic: $("uploadTopic").value.trim(),
    prompt: $("uploadPrompt").value.trim(),
    title: $("uploadTitle").value.trim() || "Untitled",
    source_type: $("uploadSourceType").value,
    source_filename: $("uploadFile").files?.[0]?.name || "",
    text: consolidatedVerifiedText(),
    transcription_verified: transcriptionVerified(),
    transcription_review: reviewExportSnapshot(),
    annotations: draftAnnotations,
    annotation_review: (annotationItems || []).map(({ occurrences, ...rest }) => rest),
    schema_version: "0.12"
  };
}

function goUploadStep(step) {
  uploadCurrentStep = Number(step);

  document.querySelectorAll(".upload-step-panel").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.uploadPanel) === uploadCurrentStep);
  });

  document.querySelectorAll("#uploadPipeline .pipe-step").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.uploadStep) === uploadCurrentStep);
  });

  updateWorkspaceWidth();
  if (uploadCurrentStep === 3 || uploadCurrentStep === 4) {
    // bring the workspace to the top of the window so the panels use the full height
    requestAnimationFrame(() => document.querySelector(`[data-upload-panel="${uploadCurrentStep}"]`)
      ?.scrollIntoView({ block: "start", behavior: restoringDraft ? "auto" : "smooth" }));
  }
  if (uploadCurrentStep === 3) renderStructuredReview();
  if (uploadCurrentStep === 4) renderAnnotationWorkspace();
  if (uploadCurrentStep === 5) renderRecordReview();
  scheduleDraftAutosave();
}

function normaliseImportedReview(parsed) {
  if (!parsed || !Array.isArray(parsed.lines)) {
    throw new Error("This JSON does not contain a transcription-review lines array.");
  }

  const clone = JSON.parse(JSON.stringify(parsed));

  clone.lines.forEach((line, index) => {
    line.line_id = line.line_id || `LINE-${index + 1}`;
    line.primary_ocr = line.primary_ocr || {};
    line.review = line.review || {};
    line.visual_review = line.visual_review || {};
    line.review.include_in_corpus = line.review.include_in_corpus !== false;
    line.review.needs_alternative_ocr = Boolean(line.review.needs_alternative_ocr);
    line.review.status = line.review.status || "PENDING";
    if (line.review.verified_text == null) line.review.verified_text = line.primary_ocr.raw_text || "";
    prepareLineForExceptionReview(line);        // stage3.js: clear lines auto-confirm, exceptions become issues
  });

  return clone;
}

function updateRecognitionImportStatus() {
  const target = $("recognitionImportStatus");

  if (!importedTranscriptionReview) {
    target.className = ocrProcessing ? "recognition-status processing" : "recognition-status empty";
    target.textContent = ocrProcessing
      ? "Preparing page-by-page recognition…"
      : "Recognition has not completed yet.";
    return;
  }

  const lines = reviewLines();
  const superLow = lines.filter((line) => line?.primary_ocr?.confidence_band === "SUPER_LOW").length;
  const low = lines.filter((line) => line?.primary_ocr?.confidence_band === "LOW").length;
  const highPriority = lines.filter((line) => line?.review?.priority === "HIGH").length;

  const totalPages = ocrPageStates.length || Number(importedTranscriptionReview.page_count || 0);
  const readyPages = ocrPageStates.length ? ocrReadyPages() : totalPages;
  const failedPages = ocrPageStates.length ? ocrFailedPages() : 0;

  target.className = ocrProcessing ? "recognition-status processing" : "recognition-status loaded";

  if (ocrProcessing) {
    target.innerHTML = `
      <strong>${readyPages}/${totalPages} page(s) ready for review</strong><br>
      <span class="small">
        ${lines.length} region(s) loaded so far. You can open Transcription Review now while later pages continue processing.
      </span>
    `;
    return;
  }

  target.innerHTML = `
    <strong>${failedPages ? "Recognition partially complete" : "Recognition review loaded"}</strong><br>
    <span class="small">
      ${readyPages}/${totalPages || readyPages} page(s) ready ·
      ${lines.length} region(s) · ${superLow} super-low confidence · ${low} low confidence · ${highPriority} high-priority review
      ${failedPages ? ` · ${failedPages} page(s) need retry` : ""}
    </span>
  `;
}


async function loadRecognitionReviewFile() {
  const file = $("recognitionJsonFile").files?.[0];
  if (!file) {
    importedTranscriptionReview = null;
    updateRecognitionImportStatus();
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    importedTranscriptionReview = normaliseImportedReview(parsed);

    $("machineText").value = reviewLines()
      .map((line) => line?.primary_ocr?.raw_text || "")
      .filter(Boolean)
      .join("\n");

    updateRecognitionImportStatus();
    renderStructuredReview();
  } catch (error) {
    importedTranscriptionReview = null;
    $("recognitionJsonFile").value = "";
    updateRecognitionImportStatus();
    alert(`Could not load recognition JSON: ${error.message}`);
  }
}


function ocrApiUrl() {
  return String(window.CORPUS_OCR_API_URL || "").replace(/\/$/, "");
}

function ocrReadyPages() {
  return ocrPageStates.filter((x) => x.status === "ready").length;
}

function ocrFailedPages() {
  return ocrPageStates.filter((x) => x.status === "failed").length;
}

function resetOcrPageProgress() {
  ocrRunSerial += 1;
  if (currentOcrController) {
    try { currentOcrController.abort(); } catch {}
  }
  currentOcrController = null;
  ocrPageStates = [];
  ocrProcessing = false;
  renderOcrProgress();
}

function renderOcrProgress() {
  const wrap = $("ocrProgress");
  const title = $("ocrProgressTitle");
  const detail = $("ocrProgressDetail");
  const count = $("ocrProgressCount");
  const fill = $("ocrProgressFill");
  const list = $("ocrPageStatusList");
  const spinner = $("ocrSpinner");
  const next = $("uploadToVerify");

  const total = ocrPageStates.length;
  const ready = ocrReadyPages();
  const failed = ocrFailedPages();
  const current = ocrPageStates.find((x) => x.status === "processing");
  const completed = ready + failed;

  if (wrap) wrap.classList.toggle("hidden", total === 0 && !ocrProcessing);
  if (spinner) spinner.classList.toggle("hidden", !ocrProcessing);

  if (count) count.textContent = total ? `${ready} / ${total} ready` : "0 / 0";
  if (fill) fill.style.width = total ? `${Math.round((ready / total) * 100)}%` : "0%";

  if (title) {
    if (current) title.textContent = `Processing page ${current.page} of ${total}`;
    else if (ocrProcessing) title.textContent = "Preparing document…";
    else if (failed) title.textContent = `${ready} page(s) ready · ${failed} need retry`;
    else if (total && ready === total) title.textContent = "Document recognition complete";
    else title.textContent = "Recognition";
  }

  if (detail) {
    if (current) {
      detail.textContent = "Running Sarvam + Google Vision + Surya for this page.";
    } else if (ocrProcessing) {
      detail.textContent = "Determining page count.";
    } else if (total) {
      detail.textContent = failed
        ? "Successful pages are available for review. Retry only the failed page(s)."
        : "All pages are ready for transcription review.";
    } else {
      detail.textContent = "Recognition has not started.";
    }
  }

  if (list) {
    list.innerHTML = ocrPageStates.map((state) => {
      const label = ({
        waiting: "Waiting",
        processing: "Processing",
        ready: "Ready for review",
        failed: "Failed"
      })[state.status] || state.status;

      const elapsed = typeof state.elapsed_seconds === "number"
        ? ` · ${state.elapsed_seconds.toFixed(1)}s`
        : "";

      return `
        <div class="ocr-page-row status-${escapeHtml(state.status)}">
          <span class="ocr-page-dot" aria-hidden="true"></span>
          <strong>Page ${state.page}</strong>
          <span>${escapeHtml(label)}${elapsed}</span>
          ${state.status === "failed" && !ocrProcessing
            ? `<button type="button" class="ocr-page-retry" data-retry-page="${state.page}">Retry page</button>`
            : ""}
        </div>
      `;
    }).join("");

    list.querySelectorAll("[data-retry-page]").forEach((button) => {
      button.addEventListener("click", async () => {
        const file = $("uploadFile").files?.[0];
        if (!file) return;
        await processSingleOcrPage(file, Number(button.dataset.retryPage), ocrRunSerial);
        const remainingFailed = ocrFailedPages();
        if (!remainingFailed && !ocrProcessing) updateRecognitionImportStatus();
      });
    });
  }

  if (next) next.disabled = reviewLines().length === 0;

  const retryAll = $("retryOcrBtn");
  if (retryAll) {
    retryAll.classList.toggle("hidden", ocrProcessing || failed === 0);
  }
}

function setOcrProcessing(active, message = "") {
  ocrProcessing = active;
  renderOcrProgress();

  if (message && $("recognitionImportStatus")) {
    $("recognitionImportStatus").className = "recognition-status error";
    $("recognitionImportStatus").textContent = message;
  }
}

function makeIncrementalReview(pageCount, file) {
  return normaliseImportedReview({
    schema_version: "1.3-page-by-page-review",
    document_id: $("uploadDocId").value.trim() || "DRAFT-001",
    source_filename: file.name,
    source_type: $("uploadSourceType").value || "auto",
    page_count: pageCount,
    page_previews: {},
    pipeline: {
      primary_ocr: "sarvam_vision_single_page",
      secondary_ocr: "google_cloud_vision_single_page",
      comparison: "sarvam_google_line_disagreement",
      line_geometry: "surya",
      processing_mode: "page_by_page",
      manual_review_required: true
    },
    lines: []
  });
}

function refreshMachineTextFromReview() {
  $("machineText").value = reviewLines()
    .map((line) => line?.primary_ocr?.raw_text || "")
    .filter(Boolean)
    .join("\n");
}

function mergeOcrPagePayload(payload) {
  if (!importedTranscriptionReview) return;

  const pageNumber = Number(payload?.page_number);
  const incoming = Array.isArray(payload?.lines)
    ? normaliseImportedReview({ lines: payload.lines }).lines
    : [];

  importedTranscriptionReview.lines = reviewLines()
    .filter((line) => Number(line?.page_number) !== pageNumber)
    .concat(incoming)
    .sort((x, y) => {
      const px = Number(x?.page_number || 0);
      const py = Number(y?.page_number || 0);
      if (px !== py) return px - py;
      return String(x?.line_id || "").localeCompare(String(y?.line_id || ""), undefined, { numeric: true });
    });

  importedTranscriptionReview.page_count = Number(payload?.page_count || importedTranscriptionReview.page_count || 1);
  importedTranscriptionReview.page_previews = importedTranscriptionReview.page_previews || {};
  if (payload?.page_preview) {
    importedTranscriptionReview.page_previews[String(pageNumber)] = payload.page_preview;
  }
  refreshMachineTextFromReview();
}

function rerenderReviewPreservingEditor() {
  if (uploadCurrentStep !== 3) return;
  const active = document.activeElement;
  // someone is typing in the review rail: refresh only the passive panels
  if (active?.closest?.("#s3Rail") && /INPUT|TEXTAREA/.test(active.tagName)) {
    renderTranscriptPanel();
    updateReviewProgress();
    return;
  }
  const scrollY = window.scrollY;
  renderStructuredReview();
  window.scrollTo({ top: scrollY, behavior: "instant" });
}

async function fetchPageCount(base, file, controller) {
  const form = new FormData();
  form.append("file", file, file.name);

  const response = await fetch(`${base}/api/page-count`, {
    method: "POST",
    body: form,
    signal: controller.signal
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail || `Page-count service returned HTTP ${response.status}`);
  }
  const n = Number(payload?.page_count);
  if (!Number.isInteger(n) || n < 1) throw new Error("OCR service returned an invalid page count.");
  return n;
}

async function processSingleOcrPage(file, pageNumber, runSerial) {
  const base = ocrApiUrl();
  const state = ocrPageStates.find((x) => x.page === pageNumber);
  if (!state) return false;

  state.status = "processing";
  state.error = "";
  renderOcrProgress();

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("page_number", String(pageNumber));
  form.append("document_id", $("uploadDocId").value.trim() || "DRAFT-001");
  form.append("source_type", $("uploadSourceType").value || "auto");

  const controller = new AbortController();
  currentOcrController = controller;

  try {
    const response = await fetch(`${base}/api/transcribe-page`, {
      method: "POST",
      body: form,
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    let payload = null;
    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      const text = await response.text();
      throw new Error(text || `OCR service returned HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(payload?.detail || payload?.error || `OCR service returned HTTP ${response.status}`);
    }

    if (runSerial !== ocrRunSerial) return false;

    mergeOcrPagePayload(payload);
    state.status = "ready";
    state.elapsed_seconds = Number(payload?.elapsed_seconds);
    state.error = "";

    updateRecognitionImportStatus();
    renderOcrProgress();
    rerenderReviewPreservingEditor();
    scheduleDraftAutosave();
    return true;
  } catch (error) {
    if (runSerial !== ocrRunSerial || error?.name === "AbortError") return false;
    state.status = "failed";
    state.error = error.message;
    renderOcrProgress();
    updateRecognitionImportStatus();
    scheduleDraftAutosave();
    return false;
  } finally {
    if (currentOcrController === controller) currentOcrController = null;
  }
}

async function processRecognitionAutomatically() {
  const file = $("uploadFile").files?.[0];
  if (!file) {
    alert("Select a learner document first.");
    return false;
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".json") || lower.endsWith(".docx")) {
    return false;
  }

  const base = ocrApiUrl();
  if (!base) {
    importedTranscriptionReview = null;
    setOcrProcessing(false, "OCR backend is not configured yet. Set CORPUS_OCR_API_URL in config.js.");
    return false;
  }

  resetOcrPageProgress();
  const runSerial = ocrRunSerial;
  importedTranscriptionReview = null;
  updateRecognitionImportStatus();

  $("recognitionImportStatus").className = "recognition-status processing";
  $("recognitionImportStatus").textContent = "Preparing page-by-page recognition…";
  setOcrProcessing(true);

  const countController = new AbortController();
  currentOcrController = countController;

  try {
    const pageCount = await fetchPageCount(base, file, countController);
    if (runSerial !== ocrRunSerial) return false;

    importedTranscriptionReview = makeIncrementalReview(pageCount, file);
    ocrPageStates = Array.from({ length: pageCount }, (_, i) => ({
      page: i + 1,
      status: "waiting",
      error: "",
      elapsed_seconds: null
    }));
    renderOcrProgress();
    updateRecognitionImportStatus();

    for (let page = 1; page <= pageCount; page += 1) {
      if (runSerial !== ocrRunSerial) return false;
      await processSingleOcrPage(file, page, runSerial);
    }

    if (runSerial !== ocrRunSerial) return false;
    setOcrProcessing(false);
    updateRecognitionImportStatus();
    renderOcrProgress();
    return ocrReadyPages() > 0;
  } catch (error) {
    if (runSerial !== ocrRunSerial || error?.name === "AbortError") return false;
    setOcrProcessing(false, `Automatic OCR failed: ${error.message}`);
    return false;
  } finally {
    if (currentOcrController === countController) currentOcrController = null;
  }
}



function reviewBandClass(band = "UNKNOWN") {
  return `band-${String(band).toLowerCase().replace(/[^a-z_]/g, "-")}`;
}

function pageLines(page = reviewPage) {
  return reviewLines().filter((line) => Number(line?.page_number || 1) === Number(page));
}

function reviewedLine(line) {
  return line?.review?.status === "CONFIRMED" || line?.review?.status === "IGNORED";
}

function activePageLine() {
  const lines = pageLines();
  return lines.find((line) => line.line_id === activeReviewLineId)
    || lines.find((line) => !reviewedLine(line))
    || lines[0]
    || null;
}

function polygonPoints(line, preview) {
  const polygon = line?.geometry?.polygon;
  if (!Array.isArray(polygon) || !polygon.length || !preview?.source_width || !preview?.source_height) return "";
  const sx = Number(preview.display_width) / Number(preview.source_width);
  const sy = Number(preview.display_height) / Number(preview.source_height);
  return polygon.map((p) => `${Number(p[0]) * sx},${Number(p[1]) * sy}`).join(" ");
}

function scrollActiveRegionIntoView() {
  const line = activePageLine();
  const preview = importedTranscriptionReview?.page_previews?.[String(reviewPage)];
  const viewport = $("reviewPageViewport");
  const stage = $("reviewPageStage");
  if (!line || !preview || !viewport || !stage) return;

  const poly = line?.geometry?.polygon;
  if (!Array.isArray(poly) || !poly.length) return;

  const minY = Math.min(...poly.map((p) => Number(p[1])));
  const sourceH = Number(preview.source_height || 1);
  const renderedH = stage.scrollHeight || stage.offsetHeight || viewport.scrollHeight;
  const targetY = (minY / sourceH) * renderedH;

  viewport.scrollTo({
    top: Math.max(0, targetY - viewport.clientHeight * 0.35),
    behavior: "smooth"
  });
}

function detectProcessingRoute(file) {
  if (!file) return "Awaiting file";

  const sourceType = $("uploadSourceType").value;
  if (sourceType === "handwritten") return "Handwriting → HTR";
  if (sourceType === "printed") return "Printed scan → OCR";
  if (sourceType === "digital") return "Digital text → Extract";

  const name = file.name.toLowerCase();
  const type = file.type || "";
  if (name.endsWith(".txt") || name.endsWith(".json")) return "Digital text → Extract";
  if (type.startsWith("image/") || name.endsWith(".pdf")) return "Scan / image → OCR or HTR";
  if (name.endsWith(".docx")) return "DOCX → Text extraction";
  return "Document processing";
}

function renderSourcePreview(targetId) {
  const target = $(targetId);

  // Some workflow versions do not render every historical preview panel.
  // Missing optional preview containers must never block upload/OCR.
  if (!target) return;

  const file = $("uploadFile").files?.[0];

  if (!file) {
    target.className = "source-preview empty";
    target.textContent = "No document selected.";
    return;
  }

  const name = file.name.toLowerCase();
  const type = file.type || "";

  if (type.startsWith("image/")) {
    if (!uploadObjectUrl) uploadObjectUrl = URL.createObjectURL(file);
    target.className = "source-preview";
    target.innerHTML = `<img src="${uploadObjectUrl}" alt="Uploaded learner document preview" />`;
    return;
  }

  if (name.endsWith(".pdf")) {
    if (!uploadObjectUrl) uploadObjectUrl = URL.createObjectURL(file);
    target.className = "source-preview";
    target.innerHTML = `<iframe src="${uploadObjectUrl}#toolbar=0" title="PDF preview"></iframe>`;
    return;
  }

  if (name.endsWith(".txt") || name.endsWith(".json")) {
    target.className = "source-preview";
    target.innerHTML = `<pre class="tamil">${escapeHtml($("machineText").value || "Text file selected. Continue to load/examine the extracted text.")}</pre>`;
    return;
  }

  target.className = "source-preview";
  target.innerHTML = `<div class="small"><strong>${escapeHtml(file.name)}</strong><br><br>Preview is not available in this browser prototype for this file type.</div>`;
}

async function loadSelectedFile() {
  const file = $("uploadFile").files?.[0];
  if (!file) return;

  // v0.11.2.2 deliberately follows the proven v0.9 upload path:
  // selecting a file should only prepare its preview/metadata. It must not
  // reset OCR state or touch the page-processing controller.
  savedSourceFileMeta = {
    name: file.name,
    size: file.size,
    type: file.type || "",
    lastModified: file.lastModified || null
  };

  if (uploadObjectUrl) {
    URL.revokeObjectURL(uploadObjectUrl);
    uploadObjectUrl = null;
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith(".txt")) {
    $("machineText").value = await file.text();
  } else if (lower.endsWith(".json")) {
    const raw = await file.text();
    try {
      const parsed = JSON.parse(raw);
      $("machineText").value = typeof parsed === "string" ? parsed : (parsed.text || raw);
    } catch {
      $("machineText").value = raw;
    }
  } else {
    $("machineText").value = "";
  }

  $("processingRoute").textContent = detectProcessingRoute(file);
  updateUploadPreview();
  renderSourcePreview("sourcePreview");
  renderSourcePreview("simpleVerifySourcePreview");
  scheduleDraftAutosave();
}

function updateUploadPreview() {
  const file = $("uploadFile").files?.[0];

  if (!file) {
    if (savedSourceFileMeta?.name) {
      $("uploadPreview").className = "upload-preview";
      $("uploadPreview").innerHTML = `
        <strong>${escapeHtml(savedSourceFileMeta.name)}</strong><br>
        <span class="small">
          Saved review draft restored. The browser cannot restore the original local file automatically.
          Existing OCR/review data remains available; re-select the source only if you need to process it again.
        </span>
      `;
    } else {
      $("uploadPreview").className = "upload-preview empty";
      $("uploadPreview").textContent = "Select a file to preview its metadata.";
    }
    return;
  }

  $("uploadPreview").classList.remove("empty");
  $("uploadPreview").innerHTML = `
    <strong>${escapeHtml(file.name)}</strong><br>
    <span class="small">
      ID: ${escapeHtml($("uploadDocId").value.trim() || "Draft")}
      · Level: ${escapeHtml(levelLabel($("uploadLevel").value))}
      · Year: ${escapeHtml($("uploadYear").value || "—")}
      · Task: ${escapeHtml($("uploadTask").value)}
      · Topic: ${escapeHtml($("uploadTopic").value || "Unspecified")}
      · Route: ${escapeHtml(detectProcessingRoute(file))}
      · ${(file.size / 1024).toFixed(1)} KB
    </span>
  `;
}


function prettyCategory(value = "") {
  return String(value || "OTHER")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function renderRecordReview() {
  const record = currentUploadRecord();
  const json = JSON.stringify(record, null, 2);

  $("recordReview").innerHTML = `
    <div class="record-review-grid">
      <div class="review-box">
        <h4>Metadata</h4>
        <div class="small">
          <strong>ID:</strong> ${escapeHtml(record.id)}<br>
          <strong>Level:</strong> ${escapeHtml(levelLabel(record.level))}<br>
          <strong>Year:</strong> ${escapeHtml(record.year || "—")}<br>
          <strong>Task:</strong> ${escapeHtml(record.task)}<br>
          <strong>Topic:</strong> ${escapeHtml(record.topic || "Unspecified")}<br>
          <strong>Title:</strong> <span class="tamil">${escapeHtml(record.title)}</span><br>
          <strong>Prompt:</strong> <span class="tamil">${escapeHtml(record.prompt || "—")}</span><br>
          <strong>Source:</strong> ${escapeHtml(record.source_filename || "—")}
        </div>
      </div>
      <div class="review-box">
        <h4>Record summary</h4>
        <div class="small">
          <strong>Verified words:</strong> ${countWords(record.text)}<br>
          <strong>Annotations:</strong> ${record.annotations.length}<br>
          <strong>Verification:</strong> ${transcriptionVerified() ? "Confirmed" : "Not confirmed"}
        </div>
      </div>
    </div>
    <div class="review-box">
      <h4>Verified learner text</h4>
      <div class="tamil learner-text">${escapeHtml(record.text || "No verified text entered.")}</div>
    </div>
    <h4 style="margin-top:18px">JSON record</h4>
    <pre class="review-json" id="reviewJson">${escapeHtml(json)}</pre>
  `;
}

function downloadRecordJson() {
  const record = currentUploadRecord();
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${record.id || "corpus-record"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyRecordJson() {
  const json = JSON.stringify(currentUploadRecord(), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    alert("Corpus record JSON copied.");
  } catch {
    alert("Copy was blocked by the browser. You can copy the JSON from the review box manually.");
  }
}

function resetUploadWorkflow({ clearSaved = true } = {}) {
  restoringDraft = true;
  clearTimeout(draftAutosaveTimer);

  $("uploadDocId").value = "";
  $("uploadYear").value = "2026";
  $("uploadTopic").value = "";
  $("uploadTitle").value = "";
  $("uploadPrompt").value = "";
  $("uploadSourceType").value = "auto";
  $("uploadFile").value = "";
  $("recognitionJsonFile").value = "";
  savedSourceFileMeta = null;
  importedTranscriptionReview = null;
  reviewPage = 1;
  reviewZoom = 1;
  activeReviewLineId = null;
  errorCandidates = [];
  annotationItems = [];
  activeIssueId = null;
  activeAnnotationId = null;
  resetOcrPageProgress();
  $("machineText").value = "";
  $("verifiedText").value = "";
  $("verificationChecked").checked = false;
  draftAnnotations = [];
  renderDraftAnnotations();
  updateUploadPreview();
  $("processingRoute").textContent = "Awaiting file";
  renderSourcePreview("sourcePreview");
  renderSourcePreview("simpleVerifySourcePreview");
  updateRecognitionImportStatus();
  setOcrProcessing(false);
  renderStructuredReview();
  goUploadStep(1);

  restoringDraft = false;

  if (clearSaved) {
    discardSavedDraft();
  } else {
    setDraftSaveStatus("Autosave ready", "muted");
  }
}


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

  $("analyzeSearch").addEventListener("input", renderAnalyze);

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

  document.querySelectorAll("#uploadPipeline [data-upload-step]").forEach((button) => {
    button.addEventListener("click", () => goUploadStep(button.dataset.uploadStep));
  });

  document.querySelectorAll("[data-prev-step]").forEach((button) => {
    button.addEventListener("click", () => goUploadStep(button.dataset.prevStep));
  });

  ["uploadDocId", "uploadLevel", "uploadYear", "uploadTask", "uploadTopic", "uploadTitle", "uploadPrompt", "uploadSourceType"].forEach((id) => {
    $(id).addEventListener("input", () => {
      updateUploadPreview();
      scheduleDraftAutosave();
    });
    $(id).addEventListener("change", () => {
      updateUploadPreview();
      scheduleDraftAutosave();
    });
  });

  $("draftSaveNowBtn").addEventListener("click", () => saveDraftNow());
  $("resumeDraftBtn").addEventListener("click", async () => {
    const saved = await draftDbGet().catch(() => null);
    if (saved) await restoreSavedDraft(saved);
  });
  $("discardDraftBtn").addEventListener("click", async () => {
    await discardSavedDraft();
  });

  $("machineText").addEventListener("input", scheduleDraftAutosave);
  $("verifiedText").addEventListener("input", scheduleDraftAutosave);
  $("verificationChecked").addEventListener("change", scheduleDraftAutosave);

  $("uploadFile").addEventListener("change", async () => {
    try {
      await loadSelectedFile();
    } catch (error) {
      console.error("Could not prepare selected file", error);
      const file = $("uploadFile").files?.[0];
      if (file) {
        savedSourceFileMeta = {
          name: file.name,
          size: file.size,
          type: file.type || "",
          lastModified: file.lastModified || null
        };
        $("processingRoute").textContent = detectProcessingRoute(file);
        updateUploadPreview();
      }
    }
  });
  $("recognitionJsonFile").addEventListener("change", loadRecognitionReviewFile);
  $("retryOcrBtn").addEventListener("click", processRecognitionAutomatically);

  $("uploadToProcess").addEventListener("click", async () => {
    const file = $("uploadFile").files?.[0];
    if (!file) {
      alert("Select a learner document first.");
      return;
    }

    // Important: Stage 2 opens first. A preview/autosave/backend error must
    // never make the Process document button appear dead.
    goUploadStep(2);
    $("processingRoute").textContent = detectProcessingRoute(file);
    $("recognitionImportStatus").className = "recognition-status processing";
    $("recognitionImportStatus").textContent = "Preparing page-by-page recognition…";

    try {
      await loadSelectedFile();
    } catch (error) {
      console.error("File preparation warning", error);
      // Continue: OCR can still operate on the File object even if an
      // optional preview failed.
    }

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".json") && !lower.endsWith(".docx")) {
      try {
        await processRecognitionAutomatically();
      } catch (error) {
        console.error("OCR start failed", error);
        setOcrProcessing(false, `Automatic OCR failed: ${error.message}`);
      }
    }
  });

  $("uploadToVerify").addEventListener("click", () => {
    if (!importedTranscriptionReview || reviewLines().length === 0) {
      const manual = $("machineText").value.trim();
      if (!manual) {
        alert(ocrProcessing
          ? "The first page is still processing. Transcription Review will be available as soon as one page is ready."
          : "Recognition has not completed yet.");
        return;
      }
      $("verifiedText").value = manual;
    }

    renderStructuredReview();
    goUploadStep(3);
  });

  $("uploadToAnnotate").addEventListener("click", () => {
    if (importedTranscriptionReview) {
      if (ocrProcessing || ocrPageStates.some((x) => x.status !== "ready")) {
        const waiting = ocrPageStates.filter((x) => x.status === "waiting" || x.status === "processing").length;
        const failed = ocrFailedPages();
        alert(
          waiting
            ? `OCR is still processing ${waiting} page(s). Finish recognition before error annotation.`
            : `${failed} page(s) failed recognition. Retry them before error annotation.`
        );
        return;
      }
      const included = reviewLines().filter((line) => line?.review?.include_in_corpus !== false);
      const openCount = included.flatMap((line) => (line?.review?.issues || []).filter((i) => i.status === "open")).length;
      const totalPages = Number(importedTranscriptionReview.page_count || 1);
      const unopened = [];
      for (let p = 1; p <= totalPages; p++) {
        if (!importedTranscriptionReview.pages_visited?.[String(p)]) unopened.push(p);
      }

      if (!included.length) {
        alert("No learner-text regions are currently included in the corpus.");
        return;
      }

      if (openCount) {
        alert(`${openCount} OCR issue(s) still need a decision in Transcription Review.`);
        return;
      }

      if (unopened.length) {
        alert(`Please look over page(s) ${unopened.join(", ")} before continuing — clear OCR was filled in automatically but the page hasn't been opened yet.`);
        return;
      }

      $("verifiedText").value = consolidatedVerifiedText();
      $("verificationChecked").checked = true;
      goUploadStep(4);
      renderAnnotationWorkspace();
      return;
    }

    if (!$("verifiedText").value.trim()) {
      alert("Enter or verify the learner transcription before continuing.");
      return;
    }
    if (!$("verificationChecked").checked) {
      const proceed = confirm("The transcription has not been marked as verified. Continue anyway?");
      if (!proceed) return;
    }
    goUploadStep(4);
  });

  $("reviewPrevPage").addEventListener("click", () => {
    reviewPage = Math.max(1, reviewPage - 1);
    activeIssueId = null;
    activeReviewLineId = null;
    renderStructuredReview();
    $("reviewPageViewport")?.scrollTo({ top: 0 });
    scheduleDraftAutosave();
  });

  $("reviewNextPage").addEventListener("click", () => {
    const total = Number(importedTranscriptionReview?.page_count || 1);
    reviewPage = Math.min(total, reviewPage + 1);
    activeIssueId = null;
    activeReviewLineId = null;
    renderStructuredReview();
    $("reviewPageViewport")?.scrollTo({ top: 0 });
    scheduleDraftAutosave();
  });

  $("reviewZoomOut").addEventListener("click", () => {
    reviewZoom = Math.max(0.45, reviewZoom - 0.15);
    renderReviewPage();
    requestAnimationFrame(scrollActiveRegionIntoView);
  });

  $("reviewZoomFit").addEventListener("click", () => {
    reviewZoom = 1;
    renderReviewPage();
    requestAnimationFrame(scrollActiveRegionIntoView);
  });

  $("reviewZoomIn").addEventListener("click", () => {
    reviewZoom = Math.min(2.5, reviewZoom + 0.15);
    renderReviewPage();
    requestAnimationFrame(scrollActiveRegionIntoView);
  });

  $("runErrorDetectionBtn").addEventListener("click", runErrorDetection);
  wireStage3();
  wireStage4();
  $("uploadToReview").addEventListener("click", () => goUploadStep(5));
  $("downloadRecordBtn").addEventListener("click", downloadRecordJson);
  $("copyRecordBtn").addEventListener("click", copyRecordJson);
  $("resetUploadBtn").addEventListener("click", () => resetUploadWorkflow({ clearSaved: true }));

  renderDraftAnnotations();
  updateRecognitionImportStatus();
  renderStructuredReview();
  goUploadStep(1);

  $("closeDialog").addEventListener("click", () => $("docDialog").close());
}

async function init() {
  // Wire the interface first. Upload/review must continue to work even when
  // the optional demo corpus file is missing or temporarily unavailable.
  wireNavigation();

  try {
    const response = await fetch("data/corpus.json", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Could not load data/corpus.json (${response.status})`);
    }

    const loaded = await response.json();

    if (!Array.isArray(loaded)) {
      throw new Error("corpus.json must contain a JSON array.");
    }

    corpus = loaded;
  } catch (error) {
    console.warn("Corpus seed data unavailable; continuing with an empty corpus.", error);
    corpus = [];
  }

  populateDashboard();
  renderAnalyze();
  renderInsights();

  await findAndOfferSavedDraft();
  draftAutosaveEnabled = true;
}

init().catch((error) => {
  console.error(error);

  document.body.insertAdjacentHTML(
    "beforeend",
    `<div style="max-width:900px;margin:30px auto;padding:20px;background:#fff;border:1px solid #ddd;border-radius:10px">
      <strong>Application initialization error.</strong><br>
      ${escapeHtml(error.message)}
    </div>`
  );
});
