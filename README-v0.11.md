# Corpus v0.11 — focused review, dual error candidates, Insights charts

## What changed

### Stage 3 — Transcription Review
- Page-by-page review only.
- Previous / next page controls.
- Zoom out / fit / zoom in.
- Processed page image is returned by the backend in the same coordinate system as Surya.
- The active handwriting region is highlighted.
- Click a highlighted region to review it.
- Review one item at a time:
  - Use Option A
  - Use Option B (when different)
  - Correct / override and Save change
  - Ignore
- Engine/confidence information is moved under Details.
- Actions auto-advance to the next item.
- OCR disagreement alone is now MEDIUM priority rather than automatically HIGH.

### Stage 4 — Basic Error Detection & Annotation
The endpoint `/api/detect-errors` runs three independent sources:
1. Sarvam-105B
2. Gemini 3.5 Flash on Vertex AI
3. A small deterministic rule checker for adjacent repeated words / repeated punctuation

All automatic results are candidate annotations only.

Tags:
- SPELLING
- GRAMMAR
- PUNCTUATION
- WORD_CHOICE
- WORD_FORM
- MISSING_WORD
- EXTRA_WORD
- OTHER

Candidates can be Accept / Edit manually / Reject. Manual annotation is always available.

### Insights
The Overview now shows two illustrative SVG charts:
- Most frequent annotation categories
- Annotation rate by learner level

When corpus annotations exist, the charts use corpus data.
When there is not enough annotation data, the charts explicitly display illustrative demo data and label it as such.

## Google Vertex AI
v0.11 uses `gemini-3.5-flash` by default and Application Default Credentials.

Before using Gemini error detection on Cloud Run:
```bash
gcloud services enable aiplatform.googleapis.com
```

The Cloud Run runtime service account also needs permission to call Vertex AI.
For this prototype, grant Vertex AI User to the runtime service account.

The error endpoint is fault-tolerant: if Gemini is unavailable, Sarvam + deterministic rules still return candidates.

## Deployment
After committing the v0.11 files:

```bash
cd ~/corpus
git pull

gcloud run deploy corpus-ocr \
  --source ./backend \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 900 \
  --concurrency 1 \
  --max-instances 1 \
  --set-build-env-vars GOOGLE_PYTHON_VERSION=3.13.x,GOOGLE_ENTRYPOINT="uvicorn ocr_api:app --host 0.0.0.0 --port 8080"
```

Existing `SARVAM_API_KEY` remains server-side.
