# v0.15: team storage and Google sign-in

- **New `records-api/` service (Cloud Run `corpus-records`):**
  - Firestore holds record summaries, the team list and ID reservations.
  - A private, versioned Cloud Storage bucket holds `record.json`, the scan and the page images, under `corpus/<year>/<level>/<ID>/`.
- **Sign-in:** Google, through Firebase Authentication. Only invited e-mails, plus the owners set on the server, can upload or save.
  - Roles: *Annotator* can upload and save; *Admin* can also invite people and download backups.
- **Record IDs** come from the team corpus. An ID is reserved when a record is saved and is never reused, even after the record is deleted. Saving the same scan twice produces a warning.
- **Saving:** it goes to the team corpus, and the success screen shows where the record was stored and its version number. Saving again updates the same record (version 2, 3, …); the bucket keeps every earlier version.
- **Analyze and Insights** read the real saved records as soon as the team corpus has any.
- **Privacy:** the learner's original file name is no longer sent to the OCR service or stored.
- **OCR service:** optional `REQUIRE_SIGN_IN=1`, so that only signed-in users can run the paid OCR and AI calls.
- **Local mode is unchanged** while `config.js` has no records URL.

See **SETUP-STORAGE.md** to switch the storage on, and **HANDOVER.md** for transferring the platform.
