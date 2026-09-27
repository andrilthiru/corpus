# Corpus v0.11.2.2 — restore proven v0.9 upload flow

This hotfix was made by comparing the current Stage 1 logic directly with v0.9.1, which previously worked.

## Root difference
v0.9 file selection was non-destructive: it only loaded the file, updated the preview/metadata, and then the Process button moved to Stage 2.

Later versions added OCR reset/progress/autosave work inside the file-selection path. That created more ways for the file handler to abort before Stage 2.

## Fix
- File selection again follows the v0.9 pattern and does not reset OCR state.
- `Process document` moves to Stage 2 *before* any preview or backend call.
- Preview failure cannot block OCR processing.
- The page-by-page v0.10+ OCR pipeline remains unchanged after Stage 2 opens.
- Autosave, the new review UI, annotation stage and Insights remain intact.

## Deployment
Frontend-only. Replace root `app.js` (or upload the full package). No Cloud Run redeploy is required for this fix.
