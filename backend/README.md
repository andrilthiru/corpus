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
