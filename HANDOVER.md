# Handing the corpus platform over

All the pieces sit in two places: this **GitHub repository**, and the Google Cloud project **`themozhi-tamil-corpus`**, which has its own billing account. Handing over means giving both to the new owner, then removing yourself.

## What the new owner receives
| Piece | Where it lives | Notes |
|---|---|---|
| Website | GitHub repo → GitHub Pages | `index.html`, `app.js`, `stage3.js`, `stage4.js`, `cloud.js`, `config.js` |
| OCR + error detection | Cloud Run `corpus-ocr` | uses the Sarvam key, Google Vision and Vertex Gemini |
| Records service | Cloud Run `corpus-records` (`records-api/`) | sign-in check, IDs, saving |
| Records and scans | Firestore + bucket `gs://themozhi-tamil-corpus-corpus` | bucket versioning keeps earlier versions |
| Sign-in | Firebase Authentication (same project) | Google accounts only |
| Team list | the app's **Team members** screen (Firestore `members`) | owners are set on the server (`OWNER_EMAILS`) |

## Steps
1. **Make a backup first.** In the app, open the menu under your e-mail and choose **Download a backup of all records** (a zip of every `record.json`). For the complete set including scans, run this in Cloud Shell:
   `gcloud storage cp -r gs://themozhi-tamil-corpus-corpus ./corpus-backup`
2. **GitHub:** go to the repo's Settings → *Transfer ownership*, or add the new owner as an admin collaborator. If the site's address changes, add the new domain to Firebase → Authentication → Authorized domains, and to `SITE_ORIGIN` when re-running `setup_gcp.sh`.
3. **Google Cloud:** go to IAM & Admin → *Grant access* and give the new owner's Google account the **Owner** role on `themozhi-tamil-corpus`. Firebase uses the same access list.
4. **Billing:** once the new owner has their own billing account, open Billing → *Change billing account* on the project.
5. **Owners of the app:** re-run `setup_gcp.sh` with `OWNER_EMAIL` set to the new owner's e-mail, or edit the `OWNER_EMAILS` variable on the `corpus-records` service. They can then manage the team themselves.
6. **Keys tied to you:** the Sarvam API key belongs to your Sarvam account. The new owner should get their own key and replace `SARVAM_API_KEY` on `corpus-ocr`. Google Vision and Gemini are billed to the project and need no key.
7. **Remove yourself** from the team list, from project IAM and from the GitHub repo, in that order, once everything works for them.

## Data protection
- Records contain children's writing but no names. Records use a random key and an ID like `P6-2026-COMP-004`, and the original file names are never stored.
- If you use learner codes, the list that maps codes to real names is **not** in the platform. Decide separately whether it is handed over, and to whom.
- Scans can show handwriting and occasionally a name written on the page. The bucket is private, and public access is blocked.
- Any permission from schools or parents covering data use should be passed on together with the platform, so the new owner knows the terms under which the data was collected.
