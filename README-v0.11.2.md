# Corpus v0.11.2 — local autosave and resume

This version includes all v0.11.1 functionality plus browser-side IndexedDB persistence.

## Autosave behaviour

The current working draft is automatically saved after:
- metadata changes
- OCR page completion/failure
- transcription Accept / Save change / Ignore
- current review page / active region changes
- error-candidate detection
- annotation Accept / Edit / Reject
- manual annotation add/remove
- workflow-stage changes

There is also a **Save draft now** button.

## Resume behaviour

When the site opens and an unfinished draft exists in the same browser, Stage 1 shows:
- document ID / source filename
- current page
- reviewed regions
- annotation count
- last save time
- **Resume review**
- **Discard saved draft**

A resumed review restores:
- metadata
- OCR outputs
- page previews (subject to browser storage quota)
- verified transcription decisions
- ignored regions
- current review page and active line
- automatic error candidates and their statuses
- accepted/manual annotations
- current workflow stage

## Important limitation

IndexedDB is local to the browser/device. It is not a cloud database and does not sync across devices.

Browsers do not allow a website to restore the original local PDF/file input after a reload. For a completed OCR job this is not a problem because the OCR data and page previews are saved. If reprocessing is required, re-select the original source file.

If browser quota is too small for page previews, v0.11.2 falls back to saving the review/transcription/annotation state without the page images.

## Deployment

The autosave/resume change is frontend-only. If the v0.11 backend is already deployed, no Cloud Run redeploy is required.

Replace the GitHub Pages frontend files:
- `index.html`
- `app.js`
- `style.css`

`config.js` is unchanged.
