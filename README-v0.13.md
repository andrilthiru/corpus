# Corpus v0.13: crossed-out words + Sarvam answer budget

## Crossed-out words (learner self-corrections)
When a learner crosses out a word and rewrites it, OCR used to read both, and the error detectors
then flagged the same mistake twice.

* **Backend (`backend/strike_detect.py`, called from `process_one_page`).** Every Google Vision word
  box is cropped from the page and scored for a long near-horizontal stroke through the letters
  (single or double strike, allowing hand-drawn wobble and slope) or dense over-writing. Underlines
  and ordinary Tamil letter strokes are ignored. Words of two letters or fewer need stronger
  evidence. The result is stored on each word as `strike = {score, kind, level}`, where `level` is `high` or `maybe`.
* **Stage 3.**
  * `high`: the word is removed from the transcript automatically before review. It appears under
    "Resolved on this page" as *crossed out · removed automatically*, with **Undo**.
  * `maybe`: a one-click review item, **Remove word** / **Keep**.
  * Crossed-out words no longer create "OCR engines disagree" or low-confidence items.
  * Tick **Show excluded text & crossed-out words** to see them struck through in the transcript.
* **Record.** `transcription_review.lines[].review.struck_out[]` keeps every crossed-out word
  (text, score, kind, box). Self-corrections are useful learner-corpus data in their own right.
* **Tested on synthetic pages** (Noto Tamil fonts, 372 words per condition):
  * no strike: 0 marked
  * underlined: 0 marked
  * hand-drawn single strike: 372/372 caught
  Handwriting differs from fonts, so check the first real scans and adjust `STRIKE_HIGH` /
  `STRIKE_MAYBE` at the top of `strike_detect.py` if needed.

## Sarvam error detection
The call already matched Sarvam's documentation (`/v1/chat/completions`, `api-subscription-key`,
`sarvam-105b`, reasoning off, JSON schema). `max_tokens` is raised from 2400 to 6000 so long
essays with many candidates are not cut off.

## Deploy
Frontend: upload `index.html`, `stage3.js`, `style.css`.
Backend: upload `backend/ocr_api.py`, `backend/strike_detect.py` and (from v0.12)
`backend/tamil_taxonomy.py`, then redeploy with the usual `gcloud run deploy` command.
No new Python packages are needed (OpenCV, NumPy and regex are already in `requirements.txt`).
Crossed-out detection applies to pages processed after the backend redeploy.
