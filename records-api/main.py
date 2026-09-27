"""
Themozhi corpus — records service.

Stores finished corpus records for the team:
  * Firestore  `records/{record_uid}`  — searchable summary (metadata, final text, accepted errors)
  * Firestore  `ids/{record_id}`        — reservation that keeps every readable ID unique, for ever
  * Firestore  `members/{email}`        — who may use the app (role: admin | annotator)
  * Cloud Storage  corpus/<year>/<level>/<ID>/
        record.json      full record (versioned by the bucket)
        <ID>.<ext>       the original scan, if uploaded
        pages/p<N>.jpg   page images used during transcription review

Sign-in is Google via Firebase Authentication. Every request carries a Firebase ID token;
only e-mails in OWNER_EMAILS or the `members` collection get through. No learner names are
stored anywhere: records are keyed by a random record_uid and a readable ID such as P6-2026-COMP-004.

Local development / tests: STORE=local keeps everything under ./local-data and DEV_AUTH_EMAIL
skips Google sign-in. Both are refused on Cloud Run.
"""
import base64
import datetime as dt
import hashlib
import io
import json
import os
import re
import threading
import time
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

VERSION = "1.0.0"
ON_CLOUD_RUN = bool(os.getenv("K_SERVICE"))
PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("FIREBASE_PROJECT_ID") or ""
FIREBASE_PROJECT = os.getenv("FIREBASE_PROJECT_ID") or PROJECT
BUCKET = os.getenv("CORPUS_BUCKET", "")
OWNER_EMAILS = {e.strip().lower() for e in os.getenv("OWNER_EMAILS", "").split(",") if e.strip()}
STORE_KIND = os.getenv("STORE", "gcp")
DEV_AUTH_EMAIL = os.getenv("DEV_AUTH_EMAIL", "").strip().lower()
MAX_SOURCE_BYTES = int(os.getenv("MAX_SOURCE_MB", "30")) * 1024 * 1024

if ON_CLOUD_RUN and (STORE_KIND != "gcp" or DEV_AUTH_EMAIL):
    raise RuntimeError("STORE=local and DEV_AUTH_EMAIL are for local development only.")

RECORD_ID = re.compile(r"^[A-Z0-9]+(?:-[A-Z0-9]+){1,6}$")
RECORD_UID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
LEVELS = {"P1", "P2", "P3", "P4", "P5", "P6", "SEC1", "SEC2", "SEC3", "SEC4", "SEC5", "JC1", "JC2"}
SOURCE_EXT = {"pdf", "png", "jpg", "jpeg", "tif", "tiff", "docx", "txt", "json"}
ROLES = {"admin", "annotator"}

app = FastAPI(title="Themozhi Corpus Records API", version=VERSION)
origins = [x.strip() for x in os.getenv("CORPUS_ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=["GET", "PUT", "POST", "DELETE", "OPTIONS"], allow_headers=["*"])


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Clash(Exception):
    pass


# =====================================================================================
# Storage back-ends
# =====================================================================================
class GcpStore:
    def __init__(self):
        from google.cloud import firestore, storage
        self._fs = firestore
        self.db = firestore.Client(project=PROJECT or None)
        self.gcs = storage.Client(project=PROJECT or None)
        if not BUCKET:
            raise RuntimeError("CORPUS_BUCKET is not set.")
        self.bucket = self.gcs.bucket(BUCKET)

    # --- documents
    def get(self, coll, key):
        snap = self.db.collection(coll).document(key).get()
        return snap.to_dict() if snap.exists else None

    def put(self, coll, key, data):
        self.db.collection(coll).document(key).set(data)

    def delete(self, coll, key):
        self.db.collection(coll).document(key).delete()

    def all(self, coll):
        return [d.to_dict() | {"_key": d.id} for d in self.db.collection(coll).stream()]

    def where(self, coll, field, op, value):
        from google.cloud.firestore_v1.base_query import FieldFilter
        q = self.db.collection(coll).where(filter=FieldFilter(field, op, value))
        return [d.to_dict() for d in q.stream()]

    def reserve_id(self, record_id, record_uid, email):
        ref = self.db.collection("ids").document(record_id)
        fs = self._fs

        @fs.transactional
        def run(tx):
            snap = ref.get(transaction=tx)
            if snap.exists and snap.to_dict().get("record_uid") != record_uid:
                raise Clash(snap.to_dict().get("record_uid"))
            if not snap.exists:
                tx.set(ref, {"id": record_id, "record_uid": record_uid, "reserved_at": now_iso(), "reserved_by": email})

        run(self.db.transaction())

    def ids_with_prefix(self, prefix):
        from google.cloud.firestore_v1.base_query import FieldFilter
        q = self.db.collection("ids").where(filter=FieldFilter("id", ">=", prefix)) \
                .where(filter=FieldFilter("id", "<", prefix + "\uf8ff"))
        return [d.id for d in q.stream()]

    # --- objects
    def write(self, path, data: bytes, content_type):
        self.bucket.blob(path).upload_from_string(data, content_type=content_type)

    def read(self, path) -> Optional[bytes]:
        blob = self.bucket.blob(path)
        return blob.download_as_bytes() if blob.exists() else None

    def list(self, prefix):
        return [b.name for b in self.gcs.list_blobs(BUCKET, prefix=prefix)]

    def move(self, src, dst):
        blob = self.bucket.blob(src)
        self.bucket.copy_blob(blob, self.bucket, dst)
        blob.delete()


class LocalStore:
    """Files on disk; same behaviour as GcpStore. For local development and automated tests."""

    def __init__(self, root="local-data"):
        self.root = Path(root)
        (self.root / "db").mkdir(parents=True, exist_ok=True)
        (self.root / "bucket").mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def _doc(self, coll, key):
        safe = base64.urlsafe_b64encode(key.encode()).decode()
        return self.root / "db" / coll / f"{safe}.json"

    def get(self, coll, key):
        p = self._doc(coll, key)
        return json.loads(p.read_text("utf-8")) if p.exists() else None

    def put(self, coll, key, data):
        p = self._doc(coll, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False), "utf-8")

    def delete(self, coll, key):
        p = self._doc(coll, key)
        if p.exists():
            p.unlink()

    def all(self, coll):
        d = self.root / "db" / coll
        out = []
        for p in sorted(d.glob("*.json")) if d.exists() else []:
            out.append(json.loads(p.read_text("utf-8")) | {"_key": base64.urlsafe_b64decode(p.stem.encode()).decode()})
        return out

    def where(self, coll, field, op, value):
        assert op == "=="
        return [x for x in self.all(coll) if x.get(field) == value]

    def reserve_id(self, record_id, record_uid, email):
        with self.lock:
            cur = self.get("ids", record_id)
            if cur and cur.get("record_uid") != record_uid:
                raise Clash(cur.get("record_uid"))
            if not cur:
                self.put("ids", record_id, {"record_uid": record_uid, "reserved_at": now_iso(), "reserved_by": email})

    def ids_with_prefix(self, prefix):
        return [x["_key"] for x in self.all("ids") if x["_key"].startswith(prefix)]

    def write(self, path, data, content_type):
        p = self.root / "bucket" / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def read(self, path):
        p = self.root / "bucket" / path
        return p.read_bytes() if p.exists() else None

    def list(self, prefix):
        base = self.root / "bucket"
        return sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file() and str(p.relative_to(base)).startswith(prefix))

    def move(self, src, dst):
        s, d = self.root / "bucket" / src, self.root / "bucket" / dst
        d.parent.mkdir(parents=True, exist_ok=True)
        s.replace(d)


_store = None


def store():
    global _store
    if _store is None:
        _store = LocalStore(os.getenv("LOCAL_DATA_DIR", "local-data")) if STORE_KIND == "local" else GcpStore()
    return _store


# =====================================================================================
# Sign-in and roles
# =====================================================================================
_role_cache: dict = {}
_google_request = None


def role_for(email: str) -> Optional[str]:
    if email in OWNER_EMAILS:
        return "admin"
    hit = _role_cache.get(email)
    if hit and hit[1] > time.time():
        return hit[0]
    member = store().get("members", email)
    role = member.get("role") if member and member.get("role") in ROLES else None
    _role_cache[email] = (role, time.time() + 60)
    return role


def verify_token(token: str) -> dict:
    global _google_request
    from google.oauth2 import id_token
    from google.auth.transport import requests as ga_requests
    if _google_request is None:
        _google_request = ga_requests.Request()
    if not FIREBASE_PROJECT:
        raise HTTPException(500, "FIREBASE_PROJECT_ID is not configured on the server.")
    try:
        return id_token.verify_firebase_token(token, _google_request, audience=FIREBASE_PROJECT)
    except Exception:
        raise HTTPException(401, "Your sign-in has expired. Please sign in again.")


def signed_in(authorization: Optional[str] = Header(None)) -> dict:
    if DEV_AUTH_EMAIL:
        email = (authorization or "").removeprefix("Bearer dev:").strip().lower() if (authorization or "").startswith("Bearer dev:") else DEV_AUTH_EMAIL
        role = role_for(email)
        if not role:
            raise HTTPException(403, {"code": "not_invited", "email": email})
        return {"email": email, "role": role}
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Please sign in.")
    claims = verify_token(authorization.split(" ", 1)[1])
    email = str(claims.get("email", "")).lower()
    if not email or not claims.get("email_verified"):
        raise HTTPException(403, {"code": "no_email", "email": email})
    role = role_for(email)
    if not role:
        raise HTTPException(403, {"code": "not_invited", "email": email})
    return {"email": email, "role": role, "name": claims.get("name", "")}


def admin_only(user: dict = Depends(signed_in)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Only an admin can do this.")
    return user


# =====================================================================================
# Helpers
# =====================================================================================
def record_prefix(rec: dict) -> str:
    return f"corpus/{rec['year']}/{rec['level']}/{rec['id']}/"


def summary_of(rec: dict, prev: Optional[dict], user: dict, version: int) -> dict:
    annotations = rec.get("annotations") or []
    return {
        "record_uid": rec["record_uid"], "id": rec["id"],
        "level": rec["level"], "year": str(rec["year"]), "task": rec.get("task", ""), "task_code": rec.get("task_code", ""),
        "school_code": rec.get("school_code", ""), "learner_code": rec.get("learner_code", ""),
        "topic": rec.get("topic", ""), "title": rec.get("title", ""), "prompt": rec.get("prompt", ""),
        "source_type": rec.get("source_type", ""),
        "text": rec.get("text", ""),
        "annotations": annotations,
        "words": len(str(rec.get("text", "")).split()),
        "errors": len(annotations),
        "pages": (rec.get("source_file") or {}).get("pages"),
        "sha256": (rec.get("source_file") or {}).get("sha256"),
        "scan_stored": bool((rec.get("source_file") or {}).get("object")),
        "storage_path": record_prefix(rec),
        "created_at": (prev or {}).get("created_at") or now_iso(),
        "created_by": (prev or {}).get("created_by") or user["email"],
        "saved_at": now_iso(), "saved_by": user["email"], "version": version,
        "deleted": False,
    }


def data_url_bytes(url: str):
    m = re.match(r"^data:(image/[a-z+.-]+);base64,(.*)$", url or "", re.S)
    if not m:
        return None, None
    return base64.b64decode(m.group(2)), m.group(1)


def check_record(rec: dict, uid: str):
    if not RECORD_UID.match(uid) or rec.get("record_uid") != uid:
        raise HTTPException(400, "record_uid is missing or does not match.")
    rec["id"] = str(rec.get("id", "")).strip().upper()
    if not RECORD_ID.match(rec["id"]):
        raise HTTPException(400, "The record ID may only contain capital letters, numbers and hyphens, e.g. P6-2026-COMP-001.")
    if rec.get("level") not in LEVELS:
        raise HTTPException(400, "Learner level is missing.")
    if not re.match(r"^\d{4}$", str(rec.get("year", ""))):
        raise HTTPException(400, "Year is missing.")
    if not rec.get("task"):
        raise HTTPException(400, "Task type is missing.")
    if not rec.get("consent_confirmed"):
        raise HTTPException(400, "The no-names / permission confirmation is missing.")
    if not str(rec.get("text", "")).strip():
        raise HTTPException(400, "The record has no learner text.")


# =====================================================================================
# Routes
# =====================================================================================
@app.get("/health")
def health():
    return {"ok": True, "version": VERSION, "store": STORE_KIND, "bucket": BUCKET or None,
            "auth": "dev" if DEV_AUTH_EMAIL else ("firebase" if FIREBASE_PROJECT else "not configured"),
            "owners_configured": len(OWNER_EMAILS)}


@app.get("/api/me")
def me(user: dict = Depends(signed_in)):
    return user


@app.get("/api/records")
def list_records(include_text: bool = True, user: dict = Depends(signed_in)):
    rows = [r for r in store().all("records") if not r.get("deleted")]
    rows.sort(key=lambda r: r.get("saved_at", ""), reverse=True)
    out = []
    for r in rows:
        r.pop("_key", None)
        if not include_text:
            r.pop("text", None)
            r.pop("annotations", None)
        out.append(r)
    return {"records": out}


@app.get("/api/records/next-id")
def next_id(prefix: str, user: dict = Depends(signed_in)):
    prefix = prefix.strip().upper()
    if not re.match(r"^[A-Z0-9]+(?:-[A-Z0-9]+){0,5}-$", prefix):
        raise HTTPException(400, "Bad prefix.")
    used = store().ids_with_prefix(prefix)
    n = max([int(x[len(prefix):]) for x in used if x[len(prefix):].isdigit()] or [0]) + 1
    return {"id": f"{prefix}{n:03d}"}


@app.get("/api/records/check")
def check(id: str = "", sha256: str = "", record_uid: str = "", user: dict = Depends(signed_in)):
    out = {"id_taken_by": None, "same_file": None}
    rid = id.strip().upper()
    if rid:
        res = store().get("ids", rid)
        if res and res.get("record_uid") != record_uid:
            owner = store().get("records", res["record_uid"]) or {}
            out["id_taken_by"] = {"record_uid": res["record_uid"], "id": rid, "saved_at": owner.get("saved_at"),
                                  "deleted": bool(owner.get("deleted"))}
    if sha256:
        same = [r for r in store().where("records", "sha256", "==", sha256) if r.get("record_uid") != record_uid and not r.get("deleted")]
        if same:
            out["same_file"] = {"id": same[0]["id"], "saved_at": same[0].get("saved_at")}
    return out


@app.get("/api/records/{uid}")
def get_record(uid: str, user: dict = Depends(signed_in)):
    summ = store().get("records", uid)
    if not summ or summ.get("deleted"):
        raise HTTPException(404, "Record not found.")
    raw = store().read(summ["storage_path"] + "record.json")
    if raw is None:
        raise HTTPException(404, "record.json is missing from storage.")
    return Response(raw, media_type="application/json")


@app.get("/api/records/{uid}/files/{name:path}")
def get_file(uid: str, name: str, user: dict = Depends(signed_in)):
    summ = store().get("records", uid)
    if not summ or summ.get("deleted"):
        raise HTTPException(404, "Record not found.")
    if ".." in name or name.startswith("/"):
        raise HTTPException(400, "Bad file name.")
    data = store().read(summ["storage_path"] + name)
    if data is None:
        raise HTTPException(404, "File not found.")
    kind = "image/jpeg" if name.endswith((".jpg", ".jpeg")) else "application/pdf" if name.endswith(".pdf") else "application/octet-stream"
    return Response(data, media_type=kind)


@app.put("/api/records/{uid}")
async def save_record(uid: str, record: UploadFile = File(...), source: Optional[UploadFile] = File(None),
                      user: dict = Depends(signed_in)):
    # the record arrives as a file part: with page images it is larger than a plain form field may be
    try:
        rec = json.loads((await record.read()).decode("utf-8"))
    except Exception:
        raise HTTPException(400, "The record is not valid JSON.")
    check_record(rec, uid)
    st = store()
    prev = st.get("records", uid)
    if prev and prev.get("deleted"):
        raise HTTPException(409, "This record was deleted by an admin.")

    # 1. the readable ID must belong to this record (IDs are never reused, even after deletion)
    try:
        st.reserve_id(rec["id"], uid, user["email"])
    except Clash:
        raise HTTPException(409, {"code": "id_taken", "message": f"{rec['id']} is already used by another record."})

    prefix = record_prefix(rec)
    # 2. ID / year / level changed since the last save: move the stored files along
    if prev and prev.get("storage_path") and prev["storage_path"] != prefix:
        for name in st.list(prev["storage_path"]):
            rest = name[len(prev["storage_path"]):]
            if rest.startswith(prev["id"] + "."):
                rest = rest.replace(prev["id"], rec["id"], 1)
            st.move(name, prefix + rest)

    # 3. page images → pages/p<N>.jpg ; the record keeps only the object name
    previews = (rec.get("transcription_review") or {}).get("page_previews") or {}
    for page, pv in list(previews.items()):
        if isinstance(pv, dict) and pv.get("data_url"):
            data, kind = data_url_bytes(pv["data_url"])
            if data:
                name = f"pages/p{int(page)}.jpg"
                st.write(prefix + name, data, kind or "image/jpeg")
                pv.pop("data_url", None)
                pv["object"] = name

    # 4. the original scan (optional). The learner's own file name is never kept.
    src = rec.get("source_file") or {}
    if source is not None:
        data = await source.read()
        if len(data) > MAX_SOURCE_BYTES:
            raise HTTPException(413, f"The scan is larger than {MAX_SOURCE_BYTES // (1024 * 1024)} MB.")
        ext = (Path(source.filename or "").suffix.lstrip(".").lower() or "bin")
        if ext not in SOURCE_EXT:
            raise HTTPException(400, f"Files of type .{ext} are not accepted.")
        digest = hashlib.sha256(data).hexdigest()
        stored = (json.loads(st.read(prefix + "record.json") or b"{}").get("source_file") or {}) if prev else {}
        if stored.get("sha256") == digest and stored.get("object"):
            source = None                       # same scan as last time: nothing to upload
            src.update({k: stored[k] for k in ("object", "stored_as", "size", "sha256", "type") if stored.get(k)})
            if prev.get("id") != rec["id"]:
                src["object"] = src["stored_as"] = stored["object"].replace(prev["id"], rec["id"], 1)
    if source is not None:
        for old in st.list(prefix):
            if re.match(re.escape(prefix + rec["id"]) + r"\.[a-z0-9]+$", old):
                st.move(old, prefix + "previous/" + old[len(prefix):])
        name = f"{rec['id']}.{ext}"
        st.write(prefix + name, data, source.content_type or "application/octet-stream")
        src.update({"object": name, "stored_as": name, "size": len(data), "sha256": digest,
                    "type": source.content_type or src.get("type", "")})
    elif prev and prev.get("scan_stored") and not src.get("object"):
        # re-saved from another session without the file: keep the scan that is already stored
        old = json.loads(st.read(prefix + "record.json") or b"{}")
        keep = old.get("source_file") or {}
        for k in ("object", "stored_as", "size", "sha256", "type"):
            if keep.get(k):
                src[k] = keep[k]
        if keep.get("object") and prev.get("id") != rec["id"]:
            src["object"] = src["stored_as"] = keep["object"].replace(prev["id"], rec["id"], 1)
    rec["source_file"] = src

    # 5. provenance
    version = int((prev or {}).get("version", 0)) + 1
    rec["created_at"] = (prev or {}).get("created_at") or now_iso()
    rec["created_by"] = (prev or {}).get("created_by") or user["email"]
    rec["saved_at"] = now_iso()
    rec["saved_by"] = user["email"]
    rec["version"] = version
    rec["storage_path"] = prefix

    st.write(prefix + "record.json", json.dumps(rec, ensure_ascii=False, indent=1).encode("utf-8"), "application/json; charset=utf-8")
    summary = summary_of(rec, prev, user, version)
    st.put("records", uid, summary)
    return {"ok": True, "record_uid": uid, "id": rec["id"], "version": version, "storage_path": prefix,
            "saved_at": summary["saved_at"], "scan_stored": summary["scan_stored"],
            "pages_stored": sum(1 for pv in previews.values() if isinstance(pv, dict) and pv.get("object"))}


@app.delete("/api/records/{uid}")
def delete_record(uid: str, user: dict = Depends(admin_only)):
    summ = store().get("records", uid)
    if not summ:
        raise HTTPException(404, "Record not found.")
    summ.pop("_key", None)
    summ.update({"deleted": True, "deleted_at": now_iso(), "deleted_by": user["email"]})
    store().put("records", uid, summ)          # soft delete: files stay; the ID stays reserved
    return {"ok": True}


# ----- team -----
@app.get("/api/members")
def list_members(user: dict = Depends(admin_only)):
    rows = [{"email": m["_key"], "role": m.get("role"), "added_by": m.get("added_by"), "added_at": m.get("added_at")}
            for m in store().all("members")]
    owners = [{"email": e, "role": "admin", "owner": True} for e in sorted(OWNER_EMAILS)]
    return {"members": owners + [r for r in rows if r["email"] not in OWNER_EMAILS]}


@app.put("/api/members/{email}")
def put_member(email: str, body: dict, user: dict = Depends(admin_only)):
    email = email.strip().lower()
    role = body.get("role", "annotator")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) or role not in ROLES:
        raise HTTPException(400, "Enter a valid e-mail and role.")
    store().put("members", email, {"role": role, "added_by": user["email"], "added_at": now_iso()})
    _role_cache.pop(email, None)
    return {"ok": True}


@app.delete("/api/members/{email}")
def delete_member(email: str, user: dict = Depends(admin_only)):
    email = email.strip().lower()
    if email in OWNER_EMAILS:
        raise HTTPException(400, "Owners are set on the server (OWNER_EMAILS) and cannot be removed here.")
    if email == user["email"]:
        raise HTTPException(400, "You cannot remove yourself.")
    store().delete("members", email)
    _role_cache.pop(email, None)
    return {"ok": True}


# ----- backup / handover -----
@app.get("/api/export")
def export_all(user: dict = Depends(admin_only)):
    """Every record.json plus a manifest, as one zip (scans stay in the bucket; see HANDOVER.md)."""
    buf = io.BytesIO()
    rows = [r for r in store().all("records") if not r.get("deleted")]
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        manifest = []
        for r in rows:
            raw = store().read(r["storage_path"] + "record.json")
            if raw:
                z.writestr(f"{r['id']}.json", raw)
            manifest.append({k: r.get(k) for k in ("record_uid", "id", "level", "year", "task", "words", "errors",
                                                  "storage_path", "created_by", "saved_by", "saved_at", "version")})
        z.writestr("manifest.json", json.dumps({"exported_at": now_iso(), "exported_by": user["email"],
                                                "records": manifest}, ensure_ascii=False, indent=1))
    buf.seek(0)
    name = f"corpus-export-{dt.date.today().isoformat()}.zip"
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})
