THEMOZHI — STAGE 3 THREE-PANEL UI PATCH
======================================

PURPOSE
-------
This is a UI prototype for the Transcription Review screen.

It adds:
1. A genuinely wider Stage 3 workspace.
2. Three columns:
      Original scan | Transcribed text | Review
3. A compact transcript panel with:
      Current page / Full document
      Copy button
      Approved segments
      Live preview of the current unsaved edit
4. The transcript view persists in browser localStorage while you test.
5. Existing OCR, review buttons, app.js, annotation logic and detector logic are untouched.

IMPORTANT
---------
This version is intentionally UI-first.

The new "Transcribed text" panel mirrors the review decisions you make while testing.
It is NOT yet the authoritative corpus transcript stored in the application data model.

The next step, after you approve the layout, is to wire this panel to the application's
real OCR/review state and replace mandatory line-by-line review with an exception queue
(suspicious word/span review).

HOW TO INSTALL
--------------
1. Download/extract your current GitHub corpus repository.
2. Extract this ZIP.
3. Put the folder "corpus-stage3-three-panel-patch" inside the repo folder.
   It should sit beside index.html, app.js and style.css.
4. Double-click APPLY_STAGE3_PATCH.bat.
5. Upload these THREE files to the ROOT of GitHub:
      index.html
      stage3-three-panel.css
      stage3-three-panel.js
6. Replace index.html when GitHub asks.
7. Wait for GitHub Pages to deploy.
8. Open the site and press Ctrl+F5.

WHAT YOU SHOULD SEE
-------------------
On a wide desktop screen, Stage 3 should become:

[ ORIGINAL SCAN ]  [ TRANSCRIBED TEXT ]  [ COMPACT REVIEW ]

Approximate width:
40% scan / 38% transcript / 22% review.

As you click Save change, that segment should appear in the middle panel.
Ignore/Exclude removes that segment from the prototype transcript.
Current page and Full document views are available.

MULTI-PAGE
----------
The panel detects "Page X of Y" from the existing screen.
Approved text is stored separately for each page, so when you navigate:
Page 1 -> Page 2 -> Page 3
the transcript view keeps the text you approved on earlier pages.

RESET TEST DATA
---------------
The prototype transcript is stored only in browser localStorage.
If you need to reset it, open DevTools Console and run:

ThemozhiStage3TranscriptPrototype.reset()

UNDO
----
Run UNDO_STAGE3_PATCH.bat, then upload the restored index.html.
Delete stage3-three-panel.css and stage3-three-panel.js from GitHub if they remain.

NEXT AFTER UI APPROVAL
----------------------
- Connect transcript panel to the real document state.
- Pre-populate clear OCR automatically.
- Show only suspicious words/spans in the review rail.
- Status changes from "0/39 reviewed" to something like:
      39 regions processed · 5 need human review · 0/5 resolved
- Keep a "Review all regions" option for exhaustive QA.