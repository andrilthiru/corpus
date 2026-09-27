# v0.16: Tamil error detection frozen for the prototype

**Detection (`backend/tamil_detect.py`, research code in `backend/tamil_pipeline.py`):**
- **Validity checks (never an error by themselves):** Hunspell ta_IN, wordfreq, ThamizhiMorph morphology and a names list.
- **Candidate sources:**
  - Tamil rules
  - dictionary neighbour
  - TamilVU (ஒற்று suggestions only)
  - Vaani (optional; 8-second limit)
  - MuRIL real-word check (margin 4.0; 75-second limit)
- **Who reaches the annotator:**
  1. Mechanical rules (repeated punctuation, repeated word) are shown directly.
  2. Items where two independent checks agree are shown.
  3. Everything else, including agreement, case, tense, sandhi and construction rules, goes to Sarvam, which answers "is this really an error in this sentence?". *Yes* means shown; *no* means hidden and counted.
  - If Sarvam is down, contextual rules are still shown (marked "not AI-checked"), and single weak flags stay hidden.
- **"Ask AI for more"** in step 4: open-ended AI suggestions (Sarvam + Gemini), shown as dashed **possible** cards. It runs only when clicked.
- Each card shows why it was shown: *certain rule*, *2 checks agree*, *Sarvam confirmed* or *rule · not AI-checked*. That label is also saved with each accepted error (`detection_tier`, `gate_reason`).
- **Fallbacks:** the old detector is still available with `mode: "legacy"`. It is also used automatically if the new one fails.

## Deploy (Cloud Shell)
```bash
cd ~/corpus && git pull
gcloud run deploy corpus-ocr --source ./backend \
  --project themozhi-tamil-corpus --region asia-southeast1 --allow-unauthenticated \
  --memory 8Gi --cpu 4 --timeout 900 --concurrency 1 --max-instances 1
```
- The service is now built from `backend/Dockerfile`, which installs hunspell, foma, the Tamil dictionary, the ThamizhiMorph models and MuRIL. Don't add the old `--set-build-env-vars` line.
- Existing settings such as `SARVAM_API_KEY` are kept.
- Check that it worked: `curl https://corpus-ocr-970342682197.asia-southeast1.run.app/health`. The reply should show `"version": "0.16.0"`, and every item under `tamil_detection` should be `true`.
