# Corpus v0.8 — Automatic transcription review population

## What changed
The user no longer imports `transcription_review.json` during the normal workflow.

Upload a PDF/image → frontend sends it to the OCR backend → backend runs Sarvam full-document OCR + Surya line geometry → returned review JSON automatically populates Transcription Review.

The JSON importer remains only under **Developer fallback**.

## Security
The Sarvam API key is never stored in GitHub Pages. It lives only in the OCR backend environment as `SARVAM_API_KEY`.

## Frontend configuration
Set the deployed backend URL in `config.js`:

```js
window.CORPUS_OCR_API_URL = "https://YOUR-OCR-BACKEND";
```

## Backend
`backend/ocr_api.py` provides:

- `GET /health`
- `POST /api/transcribe`

It accepts a PDF/image and returns the transcription-review JSON expected by the UI.

## Normal workflow
Upload → automatic OCR/HTR → Transcription Review → Error Detection / Annotation → Record Review.
