/* =========================================================
   THEMOZHI — team storage and Google sign-in (v0.15)

   Off until config.js sets BOTH window.CORPUS_RECORDS_API_URL and
   window.CORPUS_FIREBASE. While off, the app works exactly as before:
   records are saved in this browser only.

   When on:
     • team members sign in with Google (Firebase Authentication);
     • only e-mails invited by an admin (or set as owners on the server) get in;
     • saved records go to the records service → Firestore + Cloud Storage (Singapore);
     • Analyze / Insights read the real saved records.
   ========================================================= */

const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.14.1";
const CLOUD = { enabled: false, status: "off", email: "", name: "", role: null, error: "", auth: null, listeners: [] };

function cloudConfigured() {
  return Boolean(window.CORPUS_DEV_AUTH_EMAIL || (window.CORPUS_RECORDS_API_URL && window.CORPUS_FIREBASE?.apiKey));
}
function cloudReady() { return CLOUD.enabled && CLOUD.status === "ready"; }
function cloudIsAdmin() { return cloudReady() && CLOUD.role === "admin"; }
function recordsApiBase() { return String(window.CORPUS_RECORDS_API_URL || "").replace(/\/+$/, ""); }
function onCloudChange(fn) { CLOUD.listeners.push(fn); }
function emitCloudChange() { renderAccountArea(); applyUploadGate(); CLOUD.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function cloudToken() {
  if (window.CORPUS_DEV_AUTH_EMAIL) return `dev:${window.CORPUS_DEV_AUTH_EMAIL}`;   // local testing only
  const user = CLOUD.auth?.currentUser;
  return user ? user.getIdToken() : null;       // Firebase refreshes the token automatically
}
async function authHeaders(extra = {}) {
  const token = CLOUD.enabled ? await cloudToken().catch(() => null) : null;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

async function recordsApi(path, { method = "GET", json, form } = {}) {
  const headers = await authHeaders(json !== undefined ? { "Content-Type": "application/json" } : {});
  const response = await fetch(`${recordsApiBase()}${path}`, {
    method, headers, body: json !== undefined ? JSON.stringify(json) : form
  });
  const isJson = (response.headers.get("content-type") || "").includes("json");
  const payload = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const d = payload?.detail;
    const err = new Error(typeof d === "string" ? d : d?.message || `The corpus service returned HTTP ${response.status}.`);
    err.status = response.status; err.code = d?.code || null;
    throw err;
  }
  return isJson ? payload : response;
}

async function refreshCloudUser() {
  try {
    const me = await recordsApi("/api/me");
    CLOUD.status = "ready"; CLOUD.role = me.role; CLOUD.email = me.email; CLOUD.error = "";
  } catch (error) {
    CLOUD.role = null;
    CLOUD.status = error.status === 403 ? "not_invited" : error.status === 401 ? "signed_out" : "error";
    CLOUD.error = error.message;
  }
}

async function initCloud() {
  if (!cloudConfigured()) { CLOUD.status = "off"; emitCloudChange(); return; }
  CLOUD.enabled = true;
  CLOUD.status = "loading";
  emitCloudChange();
  if (window.CORPUS_DEV_AUTH_EMAIL) {
    CLOUD.email = window.CORPUS_DEV_AUTH_EMAIL;
    await refreshCloudUser();
    emitCloudChange();
    return;
  }
  try {
    await loadScriptOnce(`${FIREBASE_SDK}/firebase-app-compat.js`);
    await loadScriptOnce(`${FIREBASE_SDK}/firebase-auth-compat.js`);
    if (!firebase.apps.length) firebase.initializeApp(window.CORPUS_FIREBASE);
    CLOUD.auth = firebase.auth();
    CLOUD.auth.onAuthStateChanged(async (user) => {
      if (!user) { CLOUD.status = "signed_out"; CLOUD.email = ""; CLOUD.role = null; emitCloudChange(); return; }
      CLOUD.email = user.email || ""; CLOUD.name = user.displayName || "";
      CLOUD.status = "loading"; emitCloudChange();
      await refreshCloudUser();
      emitCloudChange();
    });
  } catch (error) {
    CLOUD.status = "error"; CLOUD.error = `Sign-in could not start: ${error.message}`;
    emitCloudChange();
  }
}

async function cloudSignIn() {
  if (!CLOUD.auth) return;
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await CLOUD.auth.signInWithPopup(provider);
  } catch (error) {
    if (error?.code === "auth/popup-blocked" || error?.code === "auth/operation-not-supported-in-this-environment") {
      await CLOUD.auth.signInWithRedirect(provider);
    } else if (error?.code !== "auth/popup-closed-by-user" && error?.code !== "auth/cancelled-popup-request") {
      alert(`Sign-in failed: ${error.message}`);
    }
  }
}
async function cloudSignOut() {
  if (CLOUD.auth) await CLOUD.auth.signOut();
  else { CLOUD.status = "signed_out"; emitCloudChange(); }
}

/* ---------- header: account chip ---------- */
function renderAccountArea() {
  const el = document.getElementById("accountArea");
  if (!el) return;
  const s = CLOUD.status;
  if (s === "off") {
    el.innerHTML = `<span class="acct-chip muted" title="Team storage is not connected yet; records are saved in this browser only.">Local mode</span>`;
    return;
  }
  if (s === "loading") { el.innerHTML = `<span class="acct-chip muted">Connecting…</span>`; return; }
  if (s === "signed_out" || (s === "error" && !CLOUD.email)) {
    el.innerHTML = `<button type="button" class="acct-signin" data-acct-signin>Sign in with Google</button>`;
    el.querySelector("[data-acct-signin]").addEventListener("click", cloudSignIn);
    return;
  }
  const roleLabel = CLOUD.role === "admin" ? "Admin" : CLOUD.role === "annotator" ? "Annotator" : s === "not_invited" ? "Not invited" : "Offline";
  el.innerHTML = `
    <details class="acct-menu">
      <summary class="acct-chip ${s === "ready" ? "" : "warn"}"><span class="acct-dot"></span>${escapeHtml(CLOUD.email)} · ${escapeHtml(roleLabel)}</summary>
      <div class="acct-pop">
        ${s === "ready" ? `<div class="small muted">Records save to the team corpus (Google Cloud, Singapore).</div>` : ""}
        ${s === "not_invited" ? `<div class="small">This Google account has not been invited yet. Ask an admin to add <b>${escapeHtml(CLOUD.email)}</b>.</div>` : ""}
        ${s === "error" ? `<div class="small">${escapeHtml(CLOUD.error)}</div>` : ""}
        ${CLOUD.role === "admin" ? `<button type="button" data-acct-team>Team members…</button>
          <button type="button" data-acct-export>Download a backup of all records</button>` : ""}
        <button type="button" data-acct-signout>Sign out</button>
      </div>
    </details>`;
  el.querySelector("[data-acct-signout]")?.addEventListener("click", cloudSignOut);
  el.querySelector("[data-acct-team]")?.addEventListener("click", openTeamDialog);
  el.querySelector("[data-acct-export]")?.addEventListener("click", downloadCloudExport);
}

/* ---------- upload page gate ---------- */
function applyUploadGate() {
  const gate = document.getElementById("uploadGate");
  const section = document.getElementById("upload");
  if (!gate || !section) return;
  const locked = CLOUD.enabled && CLOUD.status !== "ready";
  section.classList.toggle("locked", locked);
  gate.classList.toggle("hidden", !locked);
  if (!locked) return;
  const s = CLOUD.status;
  gate.innerHTML = s === "loading" ? `<p>Checking your sign-in…</p>`
    : s === "not_invited" ? `<h3>Waiting for an invitation</h3>
        <p>You are signed in as <b>${escapeHtml(CLOUD.email)}</b>, but this account has not been invited to the corpus team yet.
        Ask an admin to add it under <em>Team members</em>, then reload this page.</p>
        <button type="button" data-gate-signout>Use a different Google account</button>`
    : s === "error" ? `<h3>The corpus service can't be reached</h3><p>${escapeHtml(CLOUD.error)}</p>
        <button type="button" data-gate-retry class="primary-btn">Try again</button>`
    : `<h3>Sign in to add scripts</h3>
        <p>Scripts and annotations are saved to the team's private corpus, so only invited team members can add them.</p>
        <button type="button" class="primary-btn" data-gate-signin>Sign in with Google</button>`;
  gate.querySelector("[data-gate-signin]")?.addEventListener("click", cloudSignIn);
  gate.querySelector("[data-gate-signout]")?.addEventListener("click", async () => { await cloudSignOut(); cloudSignIn(); });
  gate.querySelector("[data-gate-retry]")?.addEventListener("click", async () => { CLOUD.status = "loading"; emitCloudChange(); await refreshCloudUser(); emitCloudChange(); });
}

/* ---------- team members (admins) ---------- */
async function openTeamDialog() {
  const dlg = document.getElementById("teamDialog");
  if (!dlg) return;
  document.querySelector(".acct-menu")?.removeAttribute("open");
  dlg.showModal();
  await renderTeamList();
}
async function renderTeamList() {
  const box = document.getElementById("teamList");
  box.innerHTML = `<div class="small muted">Loading…</div>`;
  try {
    const { members } = await recordsApi("/api/members");
    box.innerHTML = `<table class="saved-table small"><thead><tr><th>E-mail</th><th>Role</th><th></th></tr></thead><tbody>
      ${members.map((m) => `<tr><td>${escapeHtml(m.email)}</td>
        <td>${m.owner ? "Owner (admin)" : `<select data-team-role="${escapeHtml(m.email)}">
            <option value="annotator" ${m.role === "annotator" ? "selected" : ""}>Annotator</option>
            <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option></select>`}</td>
        <td>${m.owner || m.email === CLOUD.email ? "" : `<button type="button" class="text-button" data-team-remove="${escapeHtml(m.email)}">Remove</button>`}</td></tr>`).join("")}
      </tbody></table>`;
    box.querySelectorAll("[data-team-role]").forEach((sel) => sel.addEventListener("change", async () => {
      await recordsApi(`/api/members/${encodeURIComponent(sel.dataset.teamRole)}`, { method: "PUT", json: { role: sel.value } }).catch((e) => alert(e.message));
    }));
    box.querySelectorAll("[data-team-remove]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Remove ${b.dataset.teamRemove} from the team?`)) return;
      await recordsApi(`/api/members/${encodeURIComponent(b.dataset.teamRemove)}`, { method: "DELETE" }).catch((e) => alert(e.message));
      renderTeamList();
    }));
  } catch (error) {
    box.innerHTML = `<div class="field-error">${escapeHtml(error.message)}</div>`;
  }
}
async function addTeamMember(ev) {
  ev.preventDefault();
  const email = document.getElementById("teamEmail").value.trim().toLowerCase();
  const role = document.getElementById("teamRole").value;
  if (!email) return;
  try {
    await recordsApi(`/api/members/${encodeURIComponent(email)}`, { method: "PUT", json: { role } });
    document.getElementById("teamEmail").value = "";
    renderTeamList();
  } catch (error) { alert(error.message); }
}

async function downloadCloudExport() {
  document.querySelector(".acct-menu")?.removeAttribute("open");
  try {
    const response = await recordsApi("/api/export");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `corpus-export-${new Date().toISOString().slice(0, 10)}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) { alert(error.message); }
}

function wireCloud() {
  document.getElementById("teamAddForm")?.addEventListener("submit", addTeamMember);
  document.getElementById("teamClose")?.addEventListener("click", () => document.getElementById("teamDialog").close());
  document.addEventListener("click", (ev) => {
    const menu = document.querySelector(".acct-menu[open]");
    if (menu && !menu.contains(ev.target)) menu.removeAttribute("open");
  });
}
