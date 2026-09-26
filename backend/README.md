# OCR backend

The GitHub Pages frontend must not contain the Sarvam API key. This FastAPI service receives the uploaded PDF/image, runs Sarvam once on the full document, runs Surya locally for line geometry, computes review signals, and returns the `transcription_review` JSON directly to the browser.

## Local start

```bash
pip install -r requirements.txt
export SARVAM_API_KEY='...'
uvicorn ocr_api:app --host 0.0.0.0 --port 8000
```

Then set `window.CORPUS_OCR_API_URL` in the frontend `config.js` to the public HTTPS URL of this service.

For production, restrict `CORPUS_ALLOWED_ORIGINS` to the GitHub Pages origin and place the service behind HTTPS.


## v0.9 Google Vision
This backend now also calls Google Cloud Vision once per rendered page.
On Cloud Run it uses Application Default Credentials automatically; do not upload a Google service-account JSON key to GitHub.
For local testing only, set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.

The API returns Sarvam as primary OCR, Google as secondary OCR, and line-level disagreement/confidence flags.


### v0.9.1
Google text comparison is line-based. Within each Surya line, Google words are sorted
left-to-right. Model disagreement is based on exact normalized character disagreement
(after ignoring spacing and punctuation), not a coarse paragraph similarity threshold.


## v0.11
- `/api/transcribe-page` now returns a compressed page preview for exact review highlighting.
- `/api/detect-errors` runs Sarvam-105B + Gemini 3.5 Flash + deterministic rules.
- Automatic linguistic findings are candidates only and require human acceptance.
- Gemini uses Vertex AI Application Default Credentials; no Gemini API key is stored in GitHub.
