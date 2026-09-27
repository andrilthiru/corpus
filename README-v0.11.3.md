# Corpus v0.11.3 — Tamilinaiya/Vaani error detector

This version adds a Tamil-specific deterministic language layer to Stage 4.

## Detection order

1. **Tamilinaiya/Vaani** — Tamil-specific rule/spell/sandhi-style suggestions
2. **Sarvam** — contextual Tamil candidate annotations when available
3. **Gemini** — independent contextual candidate annotations when available
4. **Local deterministic rules** — repeated words and repeated punctuation

All findings remain **candidate annotations only**. The verified learner text is never automatically changed.

## Why Tamilinaiya/Vaani

The Python package `tamilinayavaani` is the open-source Python port of the
Tamilinaiya spell checker released from the Tamil Virtual Academy work derived
from Vaani. Its documented API exposes `SpellChecker.REST_interface(word1, word2)`
for in-memory checks.

The integration runs the checker across adjacent Tamil word pairs while
preserving the exact learner span in the corpus annotation.

## License note

`tamilinayavaani` is GPL v2. This prototype references it as a backend
dependency. Review licensing/redistribution requirements before a production
MOE delivery or commercial deployment.

## Files changed

- `backend/ocr_api.py`
- `backend/requirements.txt`
- `index.html`
- `app.js`

## Deploy

Upload the changed files to GitHub, then:

```bash
cd ~/corpus
git pull

gcloud run deploy corpus-ocr \
  --source ./backend \
  --project themozhi-tamil-corpus \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 900 \
  --concurrency 1 \
  --max-instances 1 \
  --set-build-env-vars GOOGLE_PYTHON_VERSION=3.13.x,GOOGLE_ENTRYPOINT="uvicorn ocr_api:app --host 0.0.0.0 --port 8080"
```

Then:

```bash
curl https://corpus-ocr-970342682197.asia-southeast1.run.app/health
```

Expected additions:

```json
"version": "0.11.3",
"vaani_detector": "tamilinayavaani 0.14"
```

## Test

Resume the previously saved QA draft and run **Candidate detection** again.
The status line should now include:

`vaani: ok`

even if Sarvam/Gemini are temporarily unavailable.
