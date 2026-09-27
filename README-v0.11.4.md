# Corpus v0.11.4 — Iyal + DDSpell-style Tamil lexical detection

This version replaces the failing standalone `tamilinayavaani` PyPI dependency.

## Tamil error-detection stack

1. **Iyal lexical layer**
   - Loads the official Kaniyam Foundation Iyal high-frequency Tamil word bank
     and manually collected word list.
   - Resource is loaded lazily and cached in the Cloud Run instance.

2. **DDSpell-style suggestion ranker**
   - Independent implementation of the algorithmic signals described in the
     2019 DDSpell paper:
     - character/grapheme bigram similarity
     - minimum edit distance
     - word frequency
   - The original DDSpell source implementation is **not bundled**, because a
     current verifiable source/runtime interface could not be established.
   - UI/backend therefore identify this detector as `ddspell_style`, not as the
     original DDSpell software.

3. **Sarvam-105B**
   - Contextual Tamil learner-error candidates.

4. **Gemini 2.5 Flash**
   - Independent contextual candidates.

5. **Deterministic rules**
   - Adjacent duplicate words.
   - Repeated punctuation.

All results remain candidate annotations and require human review.

## Tag precedence

When engines disagree:
- deterministic `PUNCTUATION` / `EXTRA_WORD` takes precedence;
- Iyal + DDSpell-style `SPELLING` / `WORD_FORM` takes precedence over an LLM
  word-choice guess;
- grammar and contextual word choice remain model-supported;
- all alternate classifications remain visible under Evidence.

This specifically improves cases such as:

`தோடத்தில் → தோட்டத்தில்`

where a Tamil lexical layer should favour `SPELLING` rather than accepting an
LLM's contextual `WORD_CHOICE` label.

## Deployment

Upload:
- `backend/ocr_api.py`
- `backend/requirements.txt`
- `index.html`
- `app.js`
- `style.css`
- `THIRD_PARTY_NOTICE.md`

Then:

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

Check:

```bash
curl https://corpus-ocr-970342682197.asia-southeast1.run.app/health
```

Expected backend version:

`0.11.4`

The Iyal word bank loads on the first error-detection request, so the first run
can take longer than later runs.

## Direct QA test

```bash
curl -s -X POST \
  "https://corpus-ocr-970342682197.asia-southeast1.run.app/api/detect-errors" \
  -H "Content-Type: application/json" \
  -d '{
    "text":"நான் நான் பள்ளிக்கு சென்றேன். என் நண்பன் என்னுடன் வந்தார்கள். நான் தோடத்தில் இரண்டு மரம் நட்டேன்..",
    "level":"P6",
    "task":"Composition"
  }'
```

Look for:
- `iyal: ok`
- `ddspell_style: ok`
- `sarvam: ok`
- `gemini: ok`
- `rules: ok`
