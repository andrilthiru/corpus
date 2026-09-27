# v0.14: upload page, save confirmation, transcript editing

## Upload (step 1)
- **Required fields:** script file, level, year, task type, and the "no names / may be used" confirmation. Everything else sits under *Optional details* and can be filled in later.
- **Record ID** is created automatically in the form `LEVEL-YEAR-TASK-NNN` (for example `P6-2026-COMP-004`). It is the next free number among records saved on this browser. You can type your own, but it may only use capital letters, numbers and hyphens.
- **Duplicates:**
  - Every record also gets a hidden `record_uid` (UUID), which is the real key.
  - Saving is refused if another saved record already uses the same ID.
  - The file's SHA-256 is compared with saved records, so uploading the same scan twice produces a warning.
- **The original file name is not stored**, because it often contains the learner's name. The scan is referred to as `<ID>.<ext>`.
- **Optional fields:**
  - school code and learner code (pseudonymous: the key that maps codes to names stays outside the app)
  - topic
  - the learner's own title
  - the task prompt (the question the class answered)
  - source type
- Proposed storage layout for the future backend: `corpus/<year>/<level>/<ID>/`, holding the scan file (`<ID>.pdf` or `.jpg`) and `record.json`.

## Transcription review (step 3)
- **Active card choices:** click A or B, or type the correct word straight into the box and press Enter. An Enter that confirms a word in a Tamil input method is ignored.
- **Every card** shows *Type…* and *Exclude line*. Resolved cards show *Change* and *Undo*.
- **New ✎ Edit tab:**
  - Any saved line can be edited. The edit saves when you leave the box, or on Ctrl+Enter.
  - Lines can be excluded or included again.
  - *Type the whole page instead* opens one box for the whole page: one written line per row, matched to the scan lines in order.

## Error annotation (step 4)
- **Transcript edits are always reflected:**
  - Cards are re-matched to the current text.
  - Cards whose words were edited away are set aside and not saved.
  - A banner offers to re-run detection.
- The colour key now sits above the panels.

## Save (step 5)
- A checklist before saving: transcript, detection, and pending suggestions.
- **Save record** stores the record in this browser's corpus store (IndexedDB `records`) and clears the draft. It then shows a success screen with:
  - Download / Copy JSON
  - *Start the next script* (keeps level, year, task, school and prompt, and moves on to the next ID)
  - a list of records saved on this computer
- Saving again later updates the same record.

## Resuming
- Work autosaves in this browser, including the scan previews.
- To pick up where you left off, open *Upload* on the same computer and browser and choose *Resume where I left off*.

## Font
- Tamil text uses Anjal InaiMathi when it is installed (InaiMathi comes with macOS).
- Other computers fall back to Noto Sans Tamil, loaded from Google Fonts, then to Nirmala UI or Latha.
