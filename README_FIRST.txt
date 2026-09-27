THEMOZHI CORPUS — WIDE UI PATCH

This patch changes ONLY the UI width/layout. It does not change:
- OCR
- error detection
- Iyal / DDSpell
- Sarvam / Gemini
- annotation logic
- corpus data

HOW TO USE

1. Download your current corpus repository from GitHub as a ZIP and extract it.
2. Extract this patch ZIP.
3. Put the folder "corpus-ui-wide-patch" inside the extracted corpus repository folder.
   It should be beside index.html, app.js and style.css.
4. Double-click:
       APPLY_UI_FIX.bat
5. A backup named:
       style.css.before-wide-ui.bak
   will be created automatically.
6. Upload the UPDATED style.css to the root of your GitHub repository,
   replacing the existing style.css.
7. Wait for GitHub Pages to refresh, then hard-refresh the site (Ctrl+F5).

WHAT CHANGES

- Main workspace expands to a maximum of 1560px.
- Processing screen gives more horizontal room to the document preview.
- Review/transcription screen uses a wider document area.
- Source previews are taller on desktop.
- Smaller screens automatically return to a single-column layout.

UNDO

Double-click UNDO_UI_FIX.bat, then upload the restored style.css to GitHub.

NEXT

After this UI-width change is confirmed, the next planned work is:
- side-by-side Original vs Corrected annotation panel
- Tamil-specific error taxonomy
- matching manual annotation dropdown
- colour-coded error types
