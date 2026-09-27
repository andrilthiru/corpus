# Corpus v0.12: exception-first transcription review + Tamil-taxonomy annotation

## What changed

### Width (the real fix)
The workspace was capped by `.container { max-width: 1180px }` in `style.css`. The earlier
`WIDE_UI_PATCH.css` / `stage3-three-panel.css` were never linked from `index.html`, so they had
no effect. v0.12 adds `body.wide-workspace`, which is toggled by `goUploadStep()` for Stages 2–4
and lifts the cap on `.container`, `.brandblock` and `.mainnav`. The topbar stops being sticky
and the page intro collapses, so the panels use the whole viewport.

### Stage 3: Original scan | Transcribed text | Review (40 / 38 / 22)
* **The transcript is the main object.** A line where Sarvam and Google agree and confidence is
  good is *clear*: it goes straight into the transcript (`review.method = "auto_clear"`).
* **Only exceptions are reviewed, at word level where possible:**
  * `DISAGREE`: a word-level diff of Sarvam vs Google. Option A / Option B / Edit.
    Google's word boxes give an exact highlight on the scan.
  * `LOW_CONF`: a Google word below 0.80 confidence. Accept / Edit.
  * `NON_LEARNER`: mostly Latin script, or a header/footer block type. Exclude / Keep.
  * `LINE_UNCERTAIN`: weak image or OCR evidence with no specific word. Accept / Edit.
  * If more than 4 word disagreements (or more than half the line) differ, the line becomes one whole-line issue.
  Thresholds are in `EXCEPTION_RULES` at the top of `stage3.js`.
* **Status line:** "39 regions · 34 clear · 5 need review · 0/5 resolved".
* **Live transcript:** Current page / Full document, Copy, word count, and
  "Page 2 of 5 · 2 pages reviewed · 1,284 words". Pages build up cumulatively. Unopened
  pages show "not reviewed yet"; pages still in OCR show "OCR in progress".
* **Panels are synchronised.** Clicking an issue, a transcript word or a scan region
  highlights the same place in all three panels.
* **"Review all OCR regions"** is still available as a secondary mode, with whole-line edit and exclude/include.
* **Keyboard shortcuts:** J/K next/previous · A accept / option A · B option B · E edit · X exclude.
* **OCR error vs learner error.** Stage 3 only records OCR corrections
  (`line.review.ocr_corrections`, and each issue's `resolution.origin` is `ocr_confirmed`,
  `ocr_corrected`, `excluded` or `kept`). The edit box reminds reviewers to keep the learner's own mistakes.
* **Continue to annotation** needs every OCR issue decided and every page opened at least once.

### Stage 4: Original learner text | Corrected / annotated text + one card per error
* Detector results are located in the text with Tamil-aware word boundaries, and
  overlapping spans are merged into **one card**. All detector evidence stays visible under
  "Evidence", and Iyal + DDSpell-style count as one evidence family.
* Every card shows the original form, the proposed correction (editable) and the Tamil type,
  plus provenance chips, Accept / Edit / **Not an error** / **OCR error**, and Undo.
* **One taxonomy** (`taxonomy.js`) drives both the automatic suggestion and the manual
  dropdown: 23 subtypes in 4 groups, the same codes as the Python pipeline. Legacy backend
  categories (SPELLING, GRAMMAR, …) are refined to a Tamil subtype from the correction
  (e.g. தோடத்தில் → தோட்டத்தில் = ஒற்றுப் பிழை).
* **Restrained colour:** the four groups (எழுத்தியல் · சொல்லியல் · இலக்கணம் · வாக்கிய/எழுத்து நடை)
  plus one neutral for features. Status uses neutral treatments: dashed = pending,
  filled = accepted, struck through = rejected.
* **Manual annotation:** select words in the original text, then **+ Error** or **+ Feature**.
* **Language features (not errors):** பழமொழி, மரபுத்தொடர், மேற்கோள், உவமை/உருவகம்,
  இணைப்புச் சொல், பிறமொழிக் கலப்பு, பேச்சு வழக்கு. **Find proverbs & features** suggests matches from
  `PROVERB_SEED` (a small starter list; replace it with a vetted list) and flags Latin-script code-mixing.

### Record (`currentUploadRecord()`)
* `annotations[]` keeps the legacy `category` (so the dashboard still works) and adds `kind`,
  `subtype`, `subtype_ta`, `group`, `group_ta`, `feature`, `origin` (`learner_error`), `start`/`end`,
  `auto_subtype` and `evidence`.
* `annotation_review[]` holds every card, including rejected ones with origin `not_error` or `ocr_error`.
* `transcription_review.lines[].review.issues[]` and `.ocr_corrections[]` keep the OCR audit trail.
* Drafts are version `0.12`. Older drafts still resume: their lines are re-prepared, and
  lines already confirmed stay confirmed.

## Files
New: `taxonomy.js`, `stage3.js`, `stage4.js`, `README-v0.12.md`
Changed: `index.html`, `app.js`, `style.css`, `backend/ocr_api.py` (one line: lines now carry
`primary_ocr.block_type`, which helps detect headers and footers; optional, and needs a backend redeploy)
Removed (obsolete overlay patches): `WIDE_UI_PATCH.css`, `stage3-three-panel.css`,
`stage3-three-panel.js`, `APPLY_*`/`UNDO_*` scripts, `README_FIRST.txt`

## Deploy
1. Upload `index.html`, `app.js`, `style.css`, `taxonomy.js`, `stage3.js` and `stage4.js` to the repo root.
2. Delete the obsolete files listed above from GitHub.
3. Wait for GitHub Pages, then hard-refresh (Ctrl+F5).
4. Optional: redeploy the backend (same `gcloud run deploy` command as v0.11.4) to get block types.
