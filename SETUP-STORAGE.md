# Turning on team storage (about 20 minutes, done once)

Until this is done, the app runs in **local mode**: records are saved only in the browser that made them.
After it's done, team members sign in with Google, and every saved record goes to your Google Cloud project `themozhi-tamil-corpus` in Singapore:

| What | Where |
|---|---|
| Record summaries (metadata, final text, errors) | Firestore → `records` |
| Full record, scan, page images | Cloud Storage → `gs://themozhi-tamil-corpus-corpus/corpus/<year>/<level>/<ID>/` |
| Who may use the app | Firestore → `members` (managed in the app under *Team members*) |
| Readable IDs that are already used | Firestore → `ids` (IDs are never reused) |

Expected cost at this scale: close to **US$0 a month**. The Firestore, Cloud Run and Cloud Storage free tiers cover thousands of scripts.

---

## 1. Add Firebase to the project (for Google sign-in)
1. Open <https://console.firebase.google.com> and choose **Add project**.
2. Pick your **existing** Google Cloud project `themozhi-tamil-corpus` from the list; don't create a new one.
3. Continue through the prompts. Google Analytics is not needed.
4. Go to **Build → Authentication → Get started → Sign-in method → Google**. Turn it on, choose your support e-mail, and save.
5. Go to **Authentication → Settings → Authorized domains → Add domain** and add `andrilthiru.github.io`.
6. Go to **Project settings** (the gear icon) **→ Your apps → Web (`</>`)**. Register an app called `corpus-web`; Firebase Hosting is not needed.
7. Firebase shows a `firebaseConfig = { … }` block. Keep it open; you need it in step 4.

## 2. Create the database and bucket, and deploy the records service
Open **Cloud Shell** (the `>_` icon at the top right of <https://console.cloud.google.com>) and run the commands below. Replace the e-mail with your own Google account; to add a second owner, separate the two with a comma.

```bash
cd ~/corpus && git pull && cd records-api
OWNER_EMAIL="your.name@gmail.com" bash setup_gcp.sh
```

At the end it prints a line like `Records service: https://corpus-records-xxxxx.asia-southeast1.run.app`. Copy that URL.

## 3. Check it
```bash
curl https://corpus-records-xxxxx.asia-southeast1.run.app/health
```
The reply should include `"auth": "firebase"` and `"owners_configured": 1`.

## 4. Point the website at it
Edit `config.js` in the repo (the GitHub website editor is fine):

```js
window.CORPUS_RECORDS_API_URL = "https://corpus-records-xxxxx.asia-southeast1.run.app";
window.CORPUS_FIREBASE = {
  apiKey: "…", authDomain: "themozhi-tamil-corpus.firebaseapp.com",
  projectId: "themozhi-tamil-corpus", appId: "…"
};
```
None of these values are secret. The Firebase `apiKey` only identifies the project; access is controlled by sign-in and the team list. Commit the change; GitHub Pages updates within a minute or two.

## 5. First sign-in
1. Open the site and click **Sign in with Google** at the top right, using the owner account.
2. Open the menu under your e-mail and choose **Team members…**. Invite colleagues as *Annotator* (can upload and save) or *Admin* (can also invite people and download backups).
3. Save a test script and check in the Cloud console, under Cloud Storage, that the bucket now has `corpus/2026/…`.

## 6. Optional: protect the paid OCR and AI calls
When sign-in works, redeploy the OCR service so that only signed-in users can run OCR and error detection: use the usual `gcloud run deploy corpus-ocr …` command from the README, with these two settings added:

```
--update-env-vars REQUIRE_SIGN_IN=1,FIREBASE_PROJECT_ID=themozhi-tamil-corpus
```

## Local development without Google (optional)
```bash
cd records-api && pip install -r requirements.txt
STORE=local DEV_AUTH_EMAIL=me@example.com OWNER_EMAILS=me@example.com uvicorn main:app --port 8766
```
Then set `window.CORPUS_RECORDS_API_URL = "http://localhost:8766"; window.CORPUS_DEV_AUTH_EMAIL = "me@example.com";` in a local copy of `config.js`. The server refuses these development settings when it runs on Cloud Run.
