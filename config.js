// Public Cloud Run endpoint. API secrets remain server-side.
window.CORPUS_OCR_API_URL = "https://corpus-ocr-970342682197.asia-southeast1.run.app";

// ---- Team storage (records service + Google sign-in) ----
// Leave these empty to keep "local mode" (records saved in this browser only).
// Fill them in after following SETUP-STORAGE.md. None of these values are secret.
window.CORPUS_RECORDS_API_URL = "";          // e.g. "https://corpus-records-xxxxxxxx.asia-southeast1.run.app"
window.CORPUS_FIREBASE = null;               // paste the firebaseConfig object from the Firebase console, e.g.
// window.CORPUS_FIREBASE = { apiKey: "…", authDomain: "themozhi-tamil-corpus.firebaseapp.com", projectId: "themozhi-tamil-corpus", appId: "…" };
