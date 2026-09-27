#!/usr/bin/env bash
# One-time setup of team storage for the Themozhi corpus, then deploy of the records service.
# Run in Google Cloud Shell (console.cloud.google.com → the >_ icon), from the repo's records-api folder:
#
#     cd ~/corpus && git pull && cd records-api
#     OWNER_EMAIL="you@gmail.com" bash setup_gcp.sh
#
# Safe to run again: steps that already happened are skipped. Re-running also redeploys the service.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-themozhi-tamil-corpus}"
REGION="${REGION:-asia-southeast1}"                       # Singapore
BUCKET="${BUCKET:-${PROJECT_ID}-corpus}"
SERVICE="${SERVICE:-corpus-records}"
SITE_ORIGIN="${SITE_ORIGIN:-https://andrilthiru.github.io}"
OWNER_EMAIL="${OWNER_EMAIL:?Set OWNER_EMAIL to the Google account(s) that own the corpus, comma-separated}"

echo "▶ Project ${PROJECT_ID} · region ${REGION} · bucket gs://${BUCKET}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "▶ Enabling services (Firestore, Cloud Storage, Cloud Run, build, sign-in)…"
gcloud services enable firestore.googleapis.com storage.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com identitytoolkit.googleapis.com

echo "▶ Firestore database (Native mode, Singapore)…"
if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create --database="(default)" --location="${REGION}" --type=firestore-native
else
  echo "  already exists"
fi

echo "▶ Private bucket for scans and records…"
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --location="${REGION}" \
    --uniform-bucket-level-access --public-access-prevention
else
  echo "  already exists"
fi
# keep every earlier version of each record.json / scan, so a bad save can always be undone
gcloud storage buckets update "gs://${BUCKET}" --versioning >/dev/null

echo "▶ Permissions for the service…"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUN_SA}" --role="roles/datastore.user" --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${RUN_SA}" --role="roles/storage.objectAdmin" >/dev/null

echo "▶ Deploying ${SERVICE}…"
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 512Mi --cpu 1 --max-instances 3 --timeout 120 \
  --set-env-vars "^;^CORPUS_BUCKET=${BUCKET};FIREBASE_PROJECT_ID=${PROJECT_ID};OWNER_EMAILS=${OWNER_EMAIL};CORPUS_ALLOWED_ORIGINS=${SITE_ORIGIN}" \
  --set-build-env-vars GOOGLE_PYTHON_VERSION=3.12.x,GOOGLE_ENTRYPOINT="uvicorn main:app --host 0.0.0.0 --port 8080"

URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)')"
echo
echo "✔ Done. Records service: ${URL}"
echo "  Check it:  curl ${URL}/health"
echo "  Next: put this URL in config.js as window.CORPUS_RECORDS_API_URL (see SETUP-STORAGE.md, step 4)."
