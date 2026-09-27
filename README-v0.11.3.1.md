# Corpus v0.11.3.1 — error-engine fixes

The direct `/api/detect-errors` response identified three independent issues.

## Sarvam
Observed:
`the JSON object must be str, bytes or bytearray, not NoneType`

Cause:
Sarvam-105B reasoning is enabled by default. Reasoning tokens can consume the
completion budget and leave `message.content` empty.

Fix:
- `reasoning_effort: null`
- larger visible-output budget
- JSON-object fallback if structured-output content is unexpectedly empty

## Gemini
Observed:
`response_json_schema Extra inputs are not permitted`

Cause:
The deployed `google-genai` SDK is older than the current docs for
`response_json_schema`.

Fix:
Use backward-compatible `response_schema` with `GenerateContentConfig`.
Default detector model is `gemini-2.5-flash`.

## Tamilinaiya/Vaani
Observed:
`No module named 'tamilinayavaani'`

The package is correctly listed in this version's `backend/requirements.txt`:

`tamilinayavaani==0.14`

The health endpoint now performs a real runtime import check and reports:

```json
"vaani_runtime": {
  "importable": true,
  "error": null
}
```

If it still reports false after deployment, confirm Cloud Shell is using the
new requirements file:

```bash
grep -n tamilinayavaani backend/requirements.txt
```

It must show `tamilinayavaani==0.14` before redeploying.

## Deploy

Upload at least:
- `backend/ocr_api.py`
- `backend/requirements.txt`
- `app.js`
- `style.css`

Then:

```bash
cd ~/corpus
git pull

grep -n tamilinayavaani backend/requirements.txt

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

After deployment:

```bash
curl https://corpus-ocr-970342682197.asia-southeast1.run.app/health
```

Expected:
- version `0.11.3.1`
- Sarvam configured `true`
- Gemini model `gemini-2.5-flash`
- Vaani runtime `importable: true`

Then rerun the QA document's candidate detection.
