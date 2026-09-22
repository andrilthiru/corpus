let corpus = [];
let analyzeLevel = "";
let analyzeTool = "search";
let insightLevel = "";
let insightTool = "overview";

const $ = id => document.getElementById(id);

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

function escapeRegExp(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWords(text = "") {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function levelLabel(level) {
  return ({
    P4:"Primary 4", P6:"Primary 6", SEC2:"Secondary 2",
    SEC4:"Secondary 4", JC1:"JC1", JC2:"JC2"
  })[level] || level;
}

function docsFor(level) {
  return level ? corpus.filter(d => d.level === level) : corpus;
}

function annotationCount(docs) {
  return docs.reduce((n, d) => n + (d.annotations?.length || 0), 0);
}

function switchSection(section) {
  document.querySelectorAll(".page").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".navbtn").forEach(x => x.classList.remove("active"));
  $(section).classList.add("active");
  document.querySelector(`.navbtn[data-section="${section}"]`).classList.add("active");
}

function populateDashboard() {
  $("statDocs").textContent = corpus.length;
  $("statWords").textContent = corpus.reduce((n,d)=>n+countWords(d.text),0).toLocaleString();
  $("statAnnotations").textContent = annotationCount(corpus);
  $("statLevels").textContent = new Set(corpus.map(d=>d.level)).size;

  const order = ["P4","P6","SEC2","SEC4","JC1","JC2"];
  $("levelBreakdown").innerHTML = order.map(level => {
    const n = corpus.filter(d=>d.level===level).length;
    return `<div class="metric-row"><span>${levelLabel(level)}</span><span>${n}</span></div>`;
  }).join("");

  const counts = {};
  corpus.forEach(d => (d.annotations || []).forEach(a => {
    counts[a.category] = (counts[a.category] || 0) + 1;
  }));

  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  $("annotationBreakdown").innerHTML = entries.length
    ? entries.map(([k,v])=>`<div class="metric-row"><span>${escapeHtml(k)}</span><span>${v}</span></div>`).join("")
    : '<div class="empty">No annotation categories yet.</div>';
}

function updateAnalyzeStats() {
  const docs = docsFor(analyzeLevel);
  $("analyzeDocs").textContent = docs.length;
  $("analyzeWords").textContent = docs.reduce((n,d)=>n+countWords(d.text),0).toLocaleString();
  $("analyzeAnnotations").textContent = annotationCount(docs);
}

function renderAnalyze() {
  updateAnalyzeStats();
  const docs = docsFor(analyzeLevel);
  const query = $("analyzeSearch").value.trim();
  const q = query.toLocaleLowerCase();

  if (analyzeTool === "search") {
    const filtered = docs.filter(d => !q || (d.text || "").toLocaleLowerCase().includes(q));
    $("analyzeOutput").innerHTML = `
      <div class="small">${filtered.length} document(s) found</div>
      ${filtered.map(d => `
        <article class="result-item">
          <div class="result-top">
            <div>
              <div class="result-id">${escapeHtml(d.id)} — <span class="tamil">${escapeHtml(d.title)}</span></div>
              <div class="meta-row">
                <span class="badge">${levelLabel(d.level)}</span>
                <span class="badge">${escapeHtml(d.task)}</span>
              </div>
            </div>
            <button onclick="openDocument('${escapeHtml(d.id)}')">View</button>
          </div>
          <div class="snippet">${highlight(d.text || "", query)}</div>
        </article>
      `).join("") || '<div class="empty">No matching texts.</div>'}`;
    return;
  }

  if (analyzeTool === "kwic") {
    if (!query) {
      $("analyzeOutput").innerHTML = '<div class="empty">Enter a Tamil word or phrase above to generate concordance lines.</div>';
      return;
    }
    const rows = [];
    docs.forEach(d => {
      const text = d.text || "";
      const lower = text.toLocaleLowerCase();
      const idx = lower.indexOf(q);
      if (idx >= 0) {
        rows.push({
          d,
          left: text.slice(Math.max(0, idx-45), idx),
          key: text.slice(idx, idx+query.length),
          right: text.slice(idx+query.length, idx+query.length+45)
        });
      }
    });
    $("analyzeOutput").innerHTML = rows.length ? rows.map(r => `
      <div class="kwic">
        <div class="kwic-left">${escapeHtml(r.left)}</div>
        <div class="kwic-key"><mark>${escapeHtml(r.key)}</mark></div>
        <div class="kwic-right">${escapeHtml(r.right)}</div>
        <div class="kwic-meta"><button class="linkbtn" onclick="openDocument('${escapeHtml(r.d.id)}')">${escapeHtml(r.d.id)}</button><br>${levelLabel(r.d.level)}</div>
      </div>`).join("") : '<div class="empty">No concordance lines found.</div>';
    return;
  }

  if (analyzeTool === "wordlist") {
    const counts = {};
    docs.forEach(d => (d.text || "").split(/\s+/u).forEach(raw => {
      const w = raw.replace(/[.,!?;:"'“”‘’()]/g,"").trim();
      if (w) counts[w] = (counts[w] || 0) + 1;
    }));
    const rows = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,50);
    $("analyzeOutput").innerHTML = `
      <table class="table"><thead><tr><th>Word</th><th>Frequency</th></tr></thead>
      <tbody>${rows.map(([w,c])=>`<tr><td class="tamil">${escapeHtml(w)}</td><td>${c}</td></tr>`).join("")}</tbody></table>`;
    return;
  }

  if (analyzeTool === "ngrams") {
    const counts = {};
    docs.forEach(d => {
      const words = (d.text || "").replace(/[.,!?;:"'“”‘’()]/g,"").split(/\s+/u).filter(Boolean);
      for (let i=0; i<words.length-1; i++) {
        const pair = `${words[i]} ${words[i+1]}`;
        counts[pair] = (counts[pair] || 0) + 1;
      }
    });
    const rows = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,40);
    $("analyzeOutput").innerHTML = `
      <table class="table"><thead><tr><th>2-word N-gram</th><th>Frequency</th></tr></thead>
      <tbody>${rows.map(([w,c])=>`<tr><td class="tamil">${escapeHtml(w)}</td><td>${c}</td></tr>`).join("")}</tbody></table>`;
    return;
  }

  if (analyzeTool === "texts") {
    $("analyzeOutput").innerHTML = `
      <table class="table"><thead><tr><th>ID</th><th>Level</th><th>Task</th><th>Title</th><th>Words</th></tr></thead>
      <tbody>${docs.map(d=>`<tr>
        <td><button class="linkbtn" onclick="openDocument('${escapeHtml(d.id)}')">${escapeHtml(d.id)}</button></td>
        <td>${levelLabel(d.level)}</td><td>${escapeHtml(d.task)}</td>
        <td class="tamil">${escapeHtml(d.title)}</td><td>${countWords(d.text)}</td>
      </tr>`).join("")}</tbody></table>`;
    return;
  }

  if (analyzeTool === "annotations") {
    const rows = docs.flatMap(d => (d.annotations || []).map(a => ({d,a})));
    $("analyzeOutput").innerHTML = rows.length ? `
      <table class="table"><thead><tr><th>Document</th><th>Learner form</th><th>Category</th><th>Suggested form</th></tr></thead>
      <tbody>${rows.map(({d,a})=>`<tr>
        <td><button class="linkbtn" onclick="openDocument('${escapeHtml(d.id)}')">${escapeHtml(d.id)}</button></td>
        <td class="tamil">${escapeHtml(a.text || "")}</td><td>${escapeHtml(a.category || "")}</td>
        <td class="tamil">${escapeHtml(a.suggested || "—")}</td>
      </tr>`).join("")}</tbody></table>`
      : '<div class="empty">No annotations for this selection.</div>';
    return;
  }

  if (analyzeTool === "texttypes") {
    const counts = {};
    docs.forEach(d => counts[d.task] = (counts[d.task] || 0) + 1);
    const max = Math.max(1, ...Object.values(counts));
    $("analyzeOutput").innerHTML = Object.entries(counts).map(([k,v])=>`
      <div class="bar-row">
        <span>${escapeHtml(k)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(v/max)*100}%"></div></div>
        <strong>${v}</strong>
      </div>`).join("") || '<div class="empty">No task metadata available.</div>';
  }
}

function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  return safe.replace(new RegExp(escapeRegExp(query), "giu"), m => `<mark>${m}</mark>`);
}

function renderInsights() {
  const docs = docsFor(insightLevel);
  const words = docs.reduce((n,d)=>n+countWords(d.text),0);
  const anns = annotationCount(docs);

  const categoryCounts = {};
  docs.forEach(d => (d.annotations || []).forEach(a => {
    categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
  }));

  if (insightTool === "overview") {
    $("insightOutput").innerHTML = `
      <div class="insight-grid">
        <div class="insight-card"><span>Selected corpus</span><strong>${insightLevel ? levelLabel(insightLevel) : "Overall"}</strong></div>
        <div class="insight-card"><span>Learner texts</span><strong>${docs.length}</strong></div>
        <div class="insight-card"><span>Total words</span><strong>${words.toLocaleString()}</strong></div>
        <div class="insight-card"><span>Annotations</span><strong>${anns}</strong></div>
        <div class="insight-card"><span>Annotations / 1,000 words</span><strong>${words ? ((anns/words)*1000).toFixed(1) : "0.0"}</strong></div>
        <div class="insight-card"><span>Task types</span><strong>${new Set(docs.map(d=>d.task)).size}</strong></div>
      </div>`;
    return;
  }

  if (insightTool === "trends" || insightTool === "compare") {
    const levels = ["P4","P6","SEC2","SEC4","JC1","JC2"];
    const rows = levels.map(level => {
      const ds = docsFor(level);
      const w = ds.reduce((n,d)=>n+countWords(d.text),0);
      const a = annotationCount(ds);
      return {level, docs:ds.length, words:w, anns:a, rate:w ? (a/w)*1000 : 0};
    });
    const max = Math.max(1, ...rows.map(r=>r.rate));
    $("insightOutput").innerHTML = `
      <h3>Annotation rate by learner level</h3>
      <div class="small">Current prototype uses annotations per 1,000 words as a simple comparative measure.</div>
      ${rows.map(r=>`
        <div class="bar-row">
          <span>${levelLabel(r.level)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(r.rate/max)*100}%"></div></div>
          <strong>${r.rate.toFixed(1)}</strong>
        </div>`).join("")}`;
    return;
  }

  if (insightTool === "distribution" || insightTool === "errors") {
    const entries = Object.entries(categoryCounts).sort((a,b)=>b[1]-a[1]);
    const max = Math.max(1, ...entries.map(x=>x[1]));
    $("insightOutput").innerHTML = entries.length ? `
      <h3>${insightTool === "errors" ? "Error / annotation patterns" : "Annotation distribution"}</h3>
      ${entries.map(([k,v])=>`
        <div class="bar-row">
          <span>${escapeHtml(k)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(v/max)*100}%"></div></div>
          <strong>${v}</strong>
        </div>`).join("")}`
      : '<div class="empty">Add more annotations to generate meaningful patterns.</div>';
    return;
  }

  if (insightTool === "vocabulary") {
    const counts = {};
    docs.forEach(d => (d.text || "").replace(/[.,!?;:"'“”‘’()]/g,"").split(/\s+/u).filter(Boolean).forEach(w => {
      counts[w] = (counts[w] || 0) + 1;
    }));
    const unique = Object.keys(counts).length;
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,15);
    $("insightOutput").innerHTML = `
      <div class="insight-grid">
        <div class="insight-card"><span>Unique word forms</span><strong>${unique}</strong></div>
        <div class="insight-card"><span>Total words</span><strong>${words}</strong></div>
        <div class="insight-card"><span>Type-token ratio</span><strong>${words ? (unique/words).toFixed(3) : "0.000"}</strong></div>
      </div>
      <h3 style="margin-top:20px">Most frequent word forms</h3>
      <table class="table"><thead><tr><th>Word</th><th>Frequency</th></tr></thead>
      <tbody>${top.map(([w,c])=>`<tr><td class="tamil">${escapeHtml(w)}</td><td>${c}</td></tr>`).join("")}</tbody></table>`;
  }
}

window.openDocument = function(id) {
  const d = corpus.find(x=>x.id===id);
  if (!d) return;
  $("dialogId").textContent = d.id;
  $("dialogTitle").textContent = d.title;
  $("dialogMeta").innerHTML = `
    <span class="badge">${levelLabel(d.level)}</span>
    <span class="badge">${escapeHtml(d.task)}</span>
    <span class="badge">${countWords(d.text)} words</span>`;
  $("dialogText").textContent = d.text;

  $("dialogAnnotations").innerHTML = (d.annotations || []).length
    ? d.annotations.map(a=>`
      <div class="annotation">
        <strong class="tamil">${escapeHtml(a.text || "")}</strong>
        <div class="small">Category: ${escapeHtml(a.category || "")}</div>
        ${a.suggested ? `<div class="small">Suggested form: <span class="tamil">${escapeHtml(a.suggested)}</span></div>` : ""}
        ${a.note ? `<div class="small">Note: ${escapeHtml(a.note)}</div>` : ""}
      </div>`).join("")
    : '<div class="empty">No annotations for this document.</div>';

  $("docDialog").showModal();
};

async function init() {
  const res = await fetch("data/corpus.json");
  if (!res.ok) throw new Error(`Could not load data/corpus.json (${res.status})`);
  corpus = await res.json();

  populateDashboard();
  renderAnalyze();
  renderInsights();

  document.querySelectorAll(".navbtn").forEach(btn =>
    btn.addEventListener("click", ()=>switchSection(btn.dataset.section))
  );

  document.querySelectorAll("#analyzeLevelTabs .levelbtn").forEach(btn => {
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#analyzeLevelTabs .levelbtn").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      analyzeLevel = btn.dataset.level;
      renderAnalyze();
    });
  });

  document.querySelectorAll(".toolbtn").forEach(btn => {
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".toolbtn").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      analyzeTool = btn.dataset.tool;
      renderAnalyze();
    });
  });

  $("analyzeSearch").addEventListener("input", renderAnalyze);
  $("analyzeClear").addEventListener("click", ()=>{
    $("analyzeSearch").value = "";
    renderAnalyze();
  });

  document.querySelectorAll("#insightLevelTabs .levelbtn").forEach(btn => {
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#insightLevelTabs .levelbtn").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      insightLevel = btn.dataset.level;
      renderInsights();
    });
  });

  document.querySelectorAll(".insightbtn").forEach(btn => {
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".insightbtn").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      insightTool = btn.dataset.insight;
      renderInsights();
    });
  });

  $("uploadFile").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    $("uploadPreview").classList.remove("empty");
    $("uploadPreview").innerHTML = `
      <strong>${escapeHtml(file.name)}</strong><br>
      <span class="small">Assigned level: ${levelLabel($("uploadLevel").value)} · ${(file.size/1024).toFixed(1)} KB</span><br><br>
      <span class="small">Next production step: route image/PDF files to OCR/HTR, verify the transcription, anonymise and annotate before publishing to the corpus.</span>`;
  });

  $("uploadLevel").addEventListener("change", ()=>{
    const file = $("uploadFile").files?.[0];
    if (file) $("uploadFile").dispatchEvent(new Event("change"));
  });

  $("closeDialog").addEventListener("click", ()=>$("docDialog").close());
}

init().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML("beforeend",
    `<div style="max-width:900px;margin:30px auto;padding:20px;background:white;border:1px solid #ddd">
      Could not load <code>data/corpus.json</code>. Check the repository file structure.
    </div>`);
});
