# Corpus v0.9.1 — Sarvam + Google Vision

## OCR architecture
Upload → Sarvam full-document OCR + Google Vision full-page OCR → Surya line geometry → automatic comparison → manual transcription review.

Sarvam remains the primary transcript. Google Vision is an independent checker and supplies word/symbol confidence.

### Automatic review signals
- `OCR_MODEL_DISAGREEMENT`: Sarvam and Google mapped line readings differ substantially.
- `GOOGLE_LOW_WORD_CONFIDENCE`
- `GOOGLE_LOW_SYMBOL_CONFIDENCE`
- Sarvam confidence bands
- Surya geometry/alignment warnings

`OCR_MODEL_DISAGREEMENT` creates HIGH review priority regardless of either model's confidence.

## Security
- `SARVAM_API_KEY` stays only on the backend.
- Google Vision uses Google Application Default Credentials on Cloud Run. Do not add a Google JSON key to GitHub.
- For local testing only, `GOOGLE_APPLICATION_CREDENTIALS` may point to a service-account JSON file.

## Cloud Run
The existing deployment command still uses `backend/` as the source.

After deployment:
1. Set `SARVAM_API_KEY` on the Cloud Run service.
2. Ensure Cloud Vision API is enabled in the same Google Cloud project.
3. Keep `config.js` pointing to the Cloud Run URL.
4. Test `/health`.
5. Upload one PDF through the web UI.

The frontend now shows both Sarvam and Google readings when available. Human verified text remains authoritative.


## v0.9.1 comparison correction
The Colab benchmark showed that reconstructing an entire Google paragraph can scramble word order.
The production backend therefore compares OCR at the **Surya line level**.

Within a detected line:
- Google words are ordered left-to-right by x-coordinate.
- spaces and punctuation are ignored for comparison only.
- any remaining character difference between Sarvam and Google creates
  `OCR_MODEL_DISAGREEMENT`.
- similarity is retained as an explanatory metric, but it no longer decides whether
  a disagreement exists.

This is specifically intended to catch subtle differences such as:
`மணலியில்` vs `மனைலியில்`, even when the character similarity is above 0.90.
