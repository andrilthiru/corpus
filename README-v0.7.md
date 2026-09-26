# Corpus v0.7 — Transcription Review integration

This update integrates the final Sarvam + Surya transcription-review JSON into the existing Upload workflow.

## Workflow
Upload → OCR/HTR import → Transcription Review → Error Annotation → Record Review.

## Stage 2
Run the external Sarvam + Surya Colab/backend pipeline and import `transcription_review.json`. The browser never stores a Sarvam API key.

## Stage 3
Every imported region shows raw Sarvam OCR, confidence band, legibility score, manual verified text, Include/Ignore, alternative-OCR flag, and confirmation status. High-confidence OCR is not auto-accepted.

## Handoff
Only confirmed + included regions are consolidated into the verified learner text passed to error annotation. Raw OCR remains preserved under `transcription_review`.

## Files
Replace `index.html`, `style.css`, and `app.js` in the existing GitHub Pages repo. Keep the existing `data/` folder and `data/corpus.json`.
