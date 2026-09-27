(() => {
  'use strict';

  const STORAGE_KEY = 'themozhi.stage3.transcript.prototype.v1';
  const state = loadState();
  let mode = 'page';
  let activeRoot = null;
  let activeTextarea = null;
  let observerTimer = null;

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"pages":{}}');
    } catch (_) {
      return { pages: {} };
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function txt(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function stageHeading() {
    return [...document.querySelectorAll('h1,h2,h3,h4')]
      .find(el => /Transcription Review/i.test(txt(el)));
  }

  function findStageRoot() {
    const h = stageHeading();
    if (!h) return null;

    // Prefer a substantial card/section that contains the scan and review controls.
    let node = h.parentElement;
    let best = node;
    for (let i = 0; i < 7 && node; i++, node = node.parentElement) {
      const hasTextarea = !!node.querySelector('textarea');
      const hasImage = !!node.querySelector('img,canvas,iframe,object');
      if (hasTextarea && hasImage) best = node;
      if (node.tagName === 'SECTION' && hasTextarea) return node;
    }
    return best;
  }

  function findReviewTextarea(root) {
    if (!root) return null;
    const labels = [...root.querySelectorAll('label')];
    const label = labels.find(l => /Correct\s*\/\s*override/i.test(txt(l)));
    if (label) {
      const id = label.getAttribute('for');
      if (id) {
        const t = root.querySelector(`#${CSS.escape(id)}`);
        if (t) return t;
      }
      const near = label.parentElement?.querySelector('textarea');
      if (near) return near;
    }
    return root.querySelector('textarea');
  }

  function findLargestVisual(root) {
    const els = [...root.querySelectorAll('img,canvas,iframe,object')];
    if (!els.length) return null;
    return els.sort((a,b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
  }

  function childUnder(ancestor, node) {
    let cur = node;
    while (cur && cur.parentElement !== ancestor) cur = cur.parentElement;
    return cur;
  }

  function commonLayoutParent(a, b, root) {
    if (!a || !b) return null;
    const ancestors = [];
    let n = a.parentElement;
    while (n && n !== document.body) {
      ancestors.push(n);
      if (n === root) break;
      n = n.parentElement;
    }
    for (const anc of ancestors) {
      if (!anc.contains(b)) continue;
      const ca = childUnder(anc, a);
      const cb = childUnder(anc, b);
      if (ca && cb && ca !== cb) return { parent: anc, left: ca, right: cb };
    }
    return null;
  }

  function currentPageInfo(root) {
    const all = txt(root);
    const m = all.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    return {
      page: m ? Number(m[1]) : 1,
      total: m ? Number(m[2]) : 1
    };
  }

  function currentSegmentId(root) {
    const candidates = [...root.querySelectorAll('*')]
      .map(el => txt(el))
      .filter(s => /^P\d+-B\d+-L\d+\b/i.test(s));
    if (candidates.length) return candidates[0].match(/^P\d+-B\d+-L\d+/i)[0];
    const p = currentPageInfo(root).page;
    return `P${p}-CURRENT`;
  }

  function ensurePage(page) {
    const k = String(page);
    if (!state.pages[k]) state.pages[k] = { segments: {} };
    if (!state.pages[k].segments) state.pages[k].segments = {};
    return state.pages[k];
  }

  function recordCurrent(root, status) {
    const ta = findReviewTextarea(root);
    if (!ta) return;

    const { page } = currentPageInfo(root);
    const id = currentSegmentId(root);
    const pg = ensurePage(page);

    if (status === 'ignored') {
      pg.segments[id] = { id, text: '', status: 'ignored', updated: Date.now() };
    } else {
      pg.segments[id] = {
        id,
        text: ta.value.trim(),
        status: 'approved',
        updated: Date.now()
      };
    }
    saveState();
    renderTranscript(root);
  }

  function pageSegments(page) {
    const pg = state.pages[String(page)];
    if (!pg?.segments) return [];
    return Object.values(pg.segments)
      .filter(x => x.status !== 'ignored' && x.text)
      .sort((a,b) => {
        const na = Number((a.id.match(/L(\d+)/i)||[])[1] || 999999);
        const nb = Number((b.id.match(/L(\d+)/i)||[])[1] || 999999);
        return na - nb || (a.updated||0) - (b.updated||0);
      });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[ch]));
  }

  function transcriptPanel(root) {
    return root.querySelector('.stage3-transcript-panel');
  }

  function createTranscriptPanel(root) {
    const panel = document.createElement('aside');
    panel.className = 'stage3-transcript-panel';
    panel.innerHTML = `
      <div class="stage3-transcript-head">
        <div class="stage3-transcript-title-row">
          <h3 class="stage3-transcript-title">Transcribed text</h3>
          <span class="stage3-transcript-count"></span>
        </div>
        <div class="stage3-transcript-sub">
          Approved text appears here as you review each page.
        </div>
        <div class="stage3-transcript-toolbar">
          <div class="stage3-transcript-tabs">
            <button type="button" class="stage3-transcript-tab active" data-transcript-mode="page">Current page</button>
            <button type="button" class="stage3-transcript-tab" data-transcript-mode="document">Full document</button>
          </div>
          <button type="button" class="stage3-copy-btn">Copy</button>
        </div>
      </div>
      <div class="stage3-transcript-body"></div>
      <div class="stage3-transcript-foot">
        Prototype view: this mirrors review decisions locally and does not replace the corpus record yet.
      </div>
    `;

    panel.addEventListener('click', e => {
      const tab = e.target.closest('[data-transcript-mode]');
      if (tab) {
        mode = tab.dataset.transcriptMode;
        panel.querySelectorAll('.stage3-transcript-tab')
          .forEach(b => b.classList.toggle('active', b === tab));
        renderTranscript(root);
      }
      if (e.target.closest('.stage3-copy-btn')) {
        const body = panel.querySelector('.stage3-transcript-body');
        navigator.clipboard?.writeText(body.innerText || '').then(() => {
          const btn = panel.querySelector('.stage3-copy-btn');
          const old = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => btn.textContent = old, 1000);
        }).catch(() => {});
      }
    });

    return panel;
  }

  function renderTranscript(root) {
    const panel = transcriptPanel(root);
    if (!panel) return;
    const body = panel.querySelector('.stage3-transcript-body');
    const count = panel.querySelector('.stage3-transcript-count');
    const info = currentPageInfo(root);
    const currentId = currentSegmentId(root);
    const ta = findReviewTextarea(root);

    const approvedCount = Object.values(state.pages)
      .flatMap(p => Object.values(p.segments || {}))
      .filter(x => x.status === 'approved' && x.text).length;

    count.textContent = `${approvedCount} approved`;

    let pages = mode === 'page'
      ? [info.page]
      : Array.from({length: info.total}, (_,i) => i + 1);

    const blocks = [];
    for (const p of pages) {
      const segs = pageSegments(p);
      const pageHtml = segs.length
        ? segs.map(s => `
            <div class="stage3-segment ${s.id === currentId ? 'is-current' : ''}">
              <span class="stage3-segment-id">${esc(s.id)}</span>
              ${esc(s.text)}
            </div>`).join('')
        : `<div class="stage3-transcript-empty">${
            p === info.page
              ? 'No approved text recorded for this page yet.<br>Save a review item and it will appear here.'
              : `Page ${p} has not been reviewed in this prototype yet.`
          }</div>`;

      blocks.push(`
        <section class="stage3-page-block">
          <div class="stage3-page-label">Page ${p} of ${info.total}</div>
          ${pageHtml}
        </section>
      `);
    }

    let live = '';
    if (ta && ta.value.trim()) {
      const saved = pageSegments(info.page).some(s => s.id === currentId && s.text === ta.value.trim());
      if (!saved) {
        live = `
          <div class="stage3-current-edit">
            <div class="stage3-current-edit-label">Current edit — not saved yet</div>
            <div class="stage3-current-edit-text">${esc(ta.value.trim())}</div>
          </div>`;
      }
    }

    body.innerHTML = blocks.join('') + live;
  }

  function bindReviewActions(root) {
    if (root.dataset.stage3ActionsBound === '1') return;
    root.dataset.stage3ActionsBound = '1';

    root.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const label = txt(btn);

      if (/Save change|Save changes|Accept|Confirm/i.test(label)) {
        // Record the value just before/after the existing app handler runs.
        setTimeout(() => recordCurrent(root, 'approved'), 80);
      } else if (/Ignore|Exclude/i.test(label)) {
        setTimeout(() => recordCurrent(root, 'ignored'), 80);
      } else if (/Previous page|Next page/i.test(label)) {
        setTimeout(() => renderTranscript(root), 160);
      }
    }, true);

    root.addEventListener('input', e => {
      if (e.target.matches('textarea')) {
        activeTextarea = e.target;
        renderTranscript(root);
      }
    });
  }

  function install() {
    const root = findStageRoot();
    if (!root) return;

    activeRoot = root;
    const ta = findReviewTextarea(root);
    const visual = findLargestVisual(root);
    if (!ta || !visual) return;

    const layout = commonLayoutParent(visual, ta, root);
    if (!layout) return;

    document.querySelector('main')?.classList.add('themozhi-stage3-wide');

    layout.parent.dataset.stage3ThreePanel = '1';
    layout.left.dataset.stage3ScanPanel = '1';
    layout.right.dataset.stage3ReviewPanel = '1';

    let panel = layout.parent.querySelector(':scope > .stage3-transcript-panel');
    if (!panel) {
      panel = createTranscriptPanel(root);
      layout.parent.insertBefore(panel, layout.right);
    }

    bindReviewActions(root);
    renderTranscript(root);
  }

  const obs = new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(install, 90);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      install();
      obs.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    install();
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // Expose a tiny reset helper for QA/testing from DevTools if needed.
  window.ThemozhiStage3TranscriptPrototype = {
    reset() {
      localStorage.removeItem(STORAGE_KEY);
      state.pages = {};
      if (activeRoot) renderTranscript(activeRoot);
    },
    state
  };
})();