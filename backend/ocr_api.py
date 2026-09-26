import base64
import io
import json
import os
import shutil
import tempfile
import time
import zipfile
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

import cv2
import httpx
import numpy as np
import pymupdf
import regex as re
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from sarvamai import SarvamAI
from google.cloud import vision
from google import genai
from google.genai import types as genai_types
import google.auth

app = FastAPI(title="Themozhi Corpus OCR API", version="0.11")

# Prototype setting. Restrict this to your GitHub Pages origin before production.
allowed_origins = [x.strip() for x in os.getenv("CORPUS_ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_surya_detector = None
_google_vision_client = None


def get_surya_detector():
    global _surya_detector
    if _surya_detector is None:
        from surya.detection import DetectionPredictor
        _surya_detector = DetectionPredictor()
    return _surya_detector



def get_google_vision_client():
    """
    On Cloud Run this uses Application Default Credentials from the service.
    For local testing you may instead set GOOGLE_APPLICATION_CREDENTIALS.
    """
    global _google_vision_client
    if _google_vision_client is None:
        _google_vision_client = vision.ImageAnnotatorClient()
    return _google_vision_client


def confidence_band(v: Optional[float]) -> str:
    if v is None:
        return "UNKNOWN"
    if v < 0.60:
        return "SUPER_LOW"
    if v < 0.80:
        return "LOW"
    if v < 0.90:
        return "NORMAL"
    return "HIGH"


def get_bbox(block):
    c = block.get("coordinates")
    if isinstance(c, dict):
        vals = [c.get("x1"), c.get("y1"), c.get("x2"), c.get("y2")]
        if all(v is not None for v in vals):
            return [float(v) for v in vals]
    b = block.get("bbox")
    if isinstance(b, list) and len(b) == 4:
        return [float(v) for v in b]
    return None


def get_ocr_conf(block):
    for k in ("ocr_confidence", "confidence"):
        v = block.get(k)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def run_sarvam_digitise(file_path: str, mime_type: str, output_dir: Path, language: str = "ta-IN"):
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise RuntimeError("SARVAM_API_KEY is not configured on the OCR server.")

    client = SarvamAI(api_subscription_key=api_key)
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(file_path, "rb") as f:
        job = client.doc_ai.digitise(
            file=[(Path(file_path).name, f, mime_type)],
            language=language,
            output_format="json",
        )

    terminal = {"completed", "partially_completed", "failed", "rejected"}
    started = time.time()

    while True:
        st = client.doc_ai.get_status(job_id=job.job_id)
        status = str(st.status).lower()
        if status in terminal:
            break
        if time.time() - started > 600:
            raise TimeoutError("Sarvam OCR timed out after 10 minutes.")
        time.sleep(3)

    if status not in {"completed", "partially_completed"}:
        raise RuntimeError(f"Sarvam OCR failed with status: {status}")

    dl = client.doc_ai.get_download_url(job_id=job.job_id)
    resp = httpx.request(
        getattr(dl, "method", "GET") or "GET",
        dl.url,
        timeout=180.0,
        follow_redirects=True,
    )
    resp.raise_for_status()

    raw_path = output_dir / "result.bin"
    raw_path.write_bytes(resp.content)

    if resp.content[:2] == b"PK":
        with zipfile.ZipFile(raw_path) as z:
            z.extractall(output_dir)
        json_files = list(output_dir.rglob("*.json"))
    else:
        p = output_dir / "result.json"
        p.write_bytes(resp.content)
        json_files = [p]

    candidates = []
    for p in json_files:
        try:
            obj = json.loads(p.read_text(encoding="utf-8", errors="replace"))
            if isinstance(obj, dict):
                if isinstance(obj.get("pages"), list):
                    candidates.append(obj)
                elif isinstance(obj.get("result"), dict) and isinstance(obj["result"].get("pages"), list):
                    candidates.append(obj["result"])
        except Exception:
            pass

    if not candidates:
        raise RuntimeError("Sarvam returned no page-level JSON.")

    candidates.sort(key=lambda x: len(x.get("pages", [])), reverse=True)
    return candidates[0]


def render_pages(file_path: str, mime_type: str):
    pages = []
    if mime_type == "application/pdf" or file_path.lower().endswith(".pdf"):
        doc = pymupdf.open(file_path)
        try:
            for i in range(len(doc)):
                page = doc.load_page(i)
                pix = page.get_pixmap(matrix=pymupdf.Matrix(3.0, 3.0), alpha=False)
                img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
                pages.append(img)
        finally:
            doc.close()
    else:
        pages = [Image.open(file_path).convert("RGB")]
    return pages



def upload_page_count(file_path: str, mime_type: str) -> int:
    if mime_type == "application/pdf" or file_path.lower().endswith(".pdf"):
        doc = pymupdf.open(file_path)
        try:
            return len(doc)
        finally:
            doc.close()
    return 1


def render_single_page(file_path: str, mime_type: str, page_number: int) -> Image.Image:
    """Render one 1-indexed page. Images are treated as a single-page document."""
    if page_number < 1:
        raise ValueError("page_number must be 1 or greater.")

    if mime_type == "application/pdf" or file_path.lower().endswith(".pdf"):
        doc = pymupdf.open(file_path)
        try:
            if page_number > len(doc):
                raise ValueError(f"Page {page_number} is outside this {len(doc)}-page PDF.")
            page = doc.load_page(page_number - 1)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(3.0, 3.0), alpha=False)
            return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        finally:
            doc.close()

    if page_number != 1:
        raise ValueError("Image uploads contain only page 1.")
    return Image.open(file_path).convert("RGB")



def page_preview_payload(page_img: Image.Image):
    """
    Return a compressed browser preview in the same coordinate system used by
    Surya polygons, so the frontend can highlight exact OCR regions.
    """
    preview = page_img.copy()
    max_width = 1400
    if preview.width > max_width:
        ratio = max_width / float(preview.width)
        preview = preview.resize(
            (max_width, max(1, int(round(preview.height * ratio)))),
            Image.Resampling.LANCZOS,
        )

    buf = io.BytesIO()
    preview.save(buf, format="JPEG", quality=78, optimize=True)
    return {
        "data_url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
        "display_width": preview.width,
        "display_height": preview.height,
        "source_width": page_img.width,
        "source_height": page_img.height,
    }


def process_one_page(
    input_path: Path,
    mime_type: str,
    page_number: int,
    work_dir: Path,
):
    """
    Process one page only:
      Sarvam page OCR + Google Vision page OCR + Surya line geometry.
    This keeps each browser request bounded and lets the UI reveal completed
    pages immediately.
    """
    page_img = render_single_page(str(input_path), mime_type, page_number)

    page_png = work_dir / f"page_{page_number}.png"
    page_img.save(page_png, format="PNG")

    sarvam_doc = run_sarvam_digitise(
        str(page_png),
        "image/png",
        work_dir / f"sarvam_page_{page_number}",
    )
    sarvam_pages = sarvam_doc.get("pages", [])
    if not sarvam_pages:
        raise RuntimeError(f"Sarvam returned zero pages for page {page_number}.")

    google_page = run_google_vision(page_img)
    blocks = normalize_sarvam_blocks(sarvam_pages[0], page_img)
    surya_lines = detect_surya_lines(page_img)
    records = map_blocks_to_lines(blocks, surya_lines, page_number)

    # Existing helpers index by original page number. Supply sparse arrays so
    # the same review logic works for an independently processed page.
    google_pages = [{"words": [], "full_text": ""} for _ in range(page_number)]
    google_pages[page_number - 1] = google_page
    page_images = [None for _ in range(page_number)]
    page_images[page_number - 1] = page_img

    attach_google_to_lines(records, google_pages)
    apply_visual_review(records, page_images)
    return {
        "lines": finalise_review(records),
        "page_preview": page_preview_payload(page_img),
    }


def detect_surya_lines(page_img: Image.Image):
    pred = get_surya_detector()([page_img])[0]
    if hasattr(pred, "model_dump"):
        raw = pred.model_dump()
    elif hasattr(pred, "dict"):
        raw = pred.dict()
    else:
        raise RuntimeError(f"Unexpected Surya result type: {type(pred)}")

    lines = []
    for idx, b in enumerate(raw.get("bboxes", []), start=1):
        poly = b.get("polygon")
        bbox = b.get("bbox")
        if not poly and bbox:
            x1, y1, x2, y2 = bbox
            poly = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
        if not poly:
            continue
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        lines.append({
            "surya_index": idx,
            "polygon": poly,
            "bbox": [min(xs), min(ys), max(xs), max(ys)],
            "confidence": b.get("confidence"),
            "cy": sum(ys) / len(ys),
            "width_px": max(xs) - min(xs),
        })
    return lines


def normalize_sarvam_blocks(page, page_img: Image.Image):
    sw = page.get("image_width", page.get("width"))
    sh = page.get("image_height", page.get("height"))
    if not sw or not sh:
        raise RuntimeError("Sarvam page dimensions unavailable.")

    sx = page_img.width / float(sw)
    sy = page_img.height / float(sh)
    blocks = []

    for idx, b in enumerate(page.get("blocks", []), start=1):
        text = (b.get("text") or "").strip()
        bbox = get_bbox(b)
        if not text or not bbox:
            continue
        x1, y1, x2, y2 = bbox
        conf = get_ocr_conf(b)
        blocks.append({
            "block_index": idx,
            "type": b.get("layout_tag", b.get("type")),
            "reading_order": b.get("reading_order"),
            "text": text,
            "ocr_confidence": conf,
            "confidence_band": confidence_band(conf),
            "page_bbox": [x1 * sx, y1 * sy, x2 * sx, y2 * sy],
        })

    blocks.sort(key=lambda b: (
        b["reading_order"] is None,
        b["reading_order"] if b["reading_order"] is not None else 9999
    ))
    return blocks


def map_blocks_to_lines(blocks, surya_lines, page_number: int):
    records = []
    for block in blocks:
        x1, y1, x2, y2 = block["page_bbox"]
        block_h = max(1, y2 - y1)
        tol = max(8, 0.15 * block_h)

        candidates = [
            l for l in surya_lines
            if (y1 - tol) <= l["cy"] <= (y2 + tol)
            and not (l["bbox"][2] < x1 - 40 or l["bbox"][0] > x2 + 40)
        ]
        candidates.sort(key=lambda l: l["cy"])

        text_lines = [t.strip() for t in block["text"].splitlines() if t.strip()]
        if not text_lines:
            continue

        n = len(text_lines)
        expected_y = [y1 + ((i + 0.5) / n) * (y2 - y1) for i in range(n)]
        unused = list(candidates)
        mismatch = len(text_lines) != len(candidates)

        for local_idx, (txt, ey) in enumerate(zip(text_lines, expected_y), start=1):
            line = None
            alignment_distance = None
            if unused:
                nearest = min(unused, key=lambda l: abs(l["cy"] - ey))
                alignment_distance = abs(nearest["cy"] - ey) / max(1, block_h / n)
                line = nearest
                unused.remove(nearest)

            records.append({
                "line_id": f"P{page_number}-B{block['block_index']}-L{local_idx}",
                "page_number": page_number,
                "primary_text": txt,
                "sarvam_block_index": block["block_index"],
                "sarvam_ocr_confidence": block["ocr_confidence"],
                "confidence_band": block["confidence_band"],
                "block_type": block["type"],
                "polygon": line["polygon"] if line else None,
                "surya_index": line["surya_index"] if line else None,
                "surya_confidence": line["confidence"] if line else None,
                "line_width_px": line["width_px"] if line else None,
                "cy": line["cy"] if line else None,
                "alignment_distance": alignment_distance,
                "alignment_count_mismatch": mismatch,
            })
    return records


def grapheme_count(text):
    return max(1, len(re.findall(r"\X", text or "")))


def crop_polygon(page_img: Image.Image, polygon, target_height=120, hpad=20):
    arr = np.array(page_img)
    xs = [int(p[0]) for p in polygon]
    ys = [int(p[1]) for p in polygon]
    poly_h = max(ys) - min(ys)
    dilation = max(4, min(12, int(round(poly_h * 0.08))))

    mask = np.zeros((arr.shape[0], arr.shape[1]), dtype=np.uint8)
    pts = np.array([[int(p[0]), int(p[1])] for p in polygon], dtype=np.int32)
    cv2.fillPoly(mask, [pts], 255)
    kernel = np.ones((2 * dilation + 1, 2 * dilation + 1), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)

    nz = cv2.findNonZero(mask)
    if nz is None:
        return None
    x, y, w, h = cv2.boundingRect(nz)
    white = np.full_like(arr, 255)
    isolated = np.where(mask[:, :, None] > 0, arr, white)
    tight = Image.fromarray(isolated[y:y+h, x:x+w]).convert("RGB")

    if tight.height < target_height:
        extra = target_height - tight.height
        top = extra // 2
        bottom = extra - top
    else:
        top = bottom = 0

    return ImageOps.expand(tight, border=(hpad, top, hpad, bottom), fill="white")


def visual_metrics(crop: Image.Image, text: str):
    im = np.array(crop.convert("L"))
    sharpness = float(cv2.Laplacian(im, cv2.CV_64F).var())
    contrast = float(im.std())
    _, th = cv2.threshold(im, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink_ratio = float((th > 0).mean())
    g = grapheme_count(text)
    return {
        "sharpness": sharpness,
        "contrast": contrast,
        "ink_ratio": ink_ratio,
        "width_per_grapheme": float(im.shape[1] / g),
        "graphemes": g,
    }


def apply_visual_review(records, page_images):
    by_page = {}
    for r in records:
        if not r.get("polygon"):
            r["visual_metrics"] = None
            continue
        crop = crop_polygon(page_images[r["page_number"] - 1], r["polygon"])
        if crop is None:
            r["visual_metrics"] = None
            continue
        r["visual_metrics"] = visual_metrics(crop, r["primary_text"])
        by_page.setdefault(r["page_number"], []).append(r)

    for page_num, page_records in by_page.items():
        ms = [r["visual_metrics"] for r in page_records if r.get("visual_metrics")]
        if not ms:
            continue

        sharp_vals = [m["sharpness"] for m in ms]
        contrast_vals = [m["contrast"] for m in ms]
        ink_vals = [m["ink_ratio"] for m in ms]
        wpg_vals = [m["width_per_grapheme"] for m in ms]

        sharp_p15 = float(np.percentile(sharp_vals, 15))
        contrast_p15 = float(np.percentile(contrast_vals, 15))
        wpg_med = float(np.median(wpg_vals))
        wpg_mad = float(np.median(np.abs(np.array(wpg_vals) - wpg_med))) or 1.0
        ink_med = float(np.median(ink_vals))
        ink_mad = float(np.median(np.abs(np.array(ink_vals) - ink_med))) or 0.001

        for r in page_records:
            m = r.get("visual_metrics")
            if not m:
                continue
            flags = []
            penalty = 0
            if m["sharpness"] < sharp_p15:
                flags.append("LOW_SHARPNESS")
                penalty += 25
            if m["contrast"] < contrast_p15:
                flags.append("LOW_CONTRAST")
                penalty += 20

            wpg_z = abs(m["width_per_grapheme"] - wpg_med) / (1.4826 * wpg_mad)
            ink_z = abs(m["ink_ratio"] - ink_med) / (1.4826 * ink_mad)
            if wpg_z > 2.5:
                flags.append("TEXT_WIDTH_SHAPE_ANOMALY")
                penalty += 25
            if ink_z > 2.5:
                flags.append("INK_DENSITY_ANOMALY")
                penalty += 10

            sc = r.get("surya_confidence")
            if sc is not None and sc < 0.80:
                flags.append("SURYA_GEOMETRY_LOW_CONFIDENCE")
                penalty += 20

            r["visual_legibility_score"] = max(0, 100 - penalty)
            r["visual_flags"] = flags
            r["width_per_grapheme_robust_z"] = float(wpg_z)
            r["ink_ratio_robust_z"] = float(ink_z)

    for r in records:
        if "visual_legibility_score" not in r:
            r["visual_legibility_score"] = 0
            r["visual_flags"] = ["NO_VISUAL_CROP"]
            r["width_per_grapheme_robust_z"] = None
            r["ink_ratio_robust_z"] = None



def google_bbox(vertices):
    xs = [v.x for v in vertices]
    ys = [v.y for v in vertices]
    return [min(xs), min(ys), max(xs), max(ys)]


def run_google_vision(page_img: Image.Image):
    """
    Runs Google Cloud Vision DOCUMENT_TEXT_DETECTION once for a rendered page.
    Returns word/symbol text, confidence, and geometry.
    """
    buf = io.BytesIO()
    page_img.save(buf, format="PNG")

    image = vision.Image(content=buf.getvalue())
    response = get_google_vision_client().document_text_detection(
        image=image,
        image_context={"language_hints": ["ta"]},
    )

    if response.error.message:
        raise RuntimeError(f"Google Vision failed: {response.error.message}")

    annotation = response.full_text_annotation
    words = []

    for page in annotation.pages:
        for block in page.blocks:
            for para in block.paragraphs:
                for word in para.words:
                    text = "".join(sym.text for sym in word.symbols)
                    if not text:
                        continue

                    symbols = []
                    for sym in word.symbols:
                        symbols.append({
                            "text": sym.text,
                            "confidence": float(sym.confidence),
                            "bbox": google_bbox(sym.bounding_box.vertices),
                        })

                    words.append({
                        "text": text,
                        "confidence": float(word.confidence),
                        "bbox": google_bbox(word.bounding_box.vertices),
                        "symbols": symbols,
                    })

    return {
        "full_text": annotation.text or "",
        "words": words,
    }


def polygon_bbox(polygon):
    if not polygon:
        return None
    xs = [float(p[0]) for p in polygon]
    ys = [float(p[1]) for p in polygon]
    return [min(xs), min(ys), max(xs), max(ys)]


def text_compare_form(text):
    # Comparison only; raw OCR is never changed.
    return re.sub(r"[\s\p{P}\p{S}]+", "", text or "").casefold()


def text_similarity(a, b):
    a = text_compare_form(a)
    b = text_compare_form(b)
    if not a or not b:
        return None
    return float(SequenceMatcher(None, a, b).ratio())


def texts_disagree(a, b):
    """
    Ignore spacing/punctuation only. Any remaining character difference is an
    OCR-model disagreement. This catches subtle cases such as மணலியில் vs மனைலியில்.
    """
    a = text_compare_form(a)
    b = text_compare_form(b)
    if not a or not b:
        return False
    return a != b


def attach_google_to_lines(records, google_pages):
    """
    Maps Google word boxes to the same Surya line polygons already associated
    with Sarvam text, then derives independent OCR disagreement/confidence signals.
    """
    for r in records:
        page_num = r["page_number"]
        polygon = r.get("polygon")
        pb = polygon_bbox(polygon)

        if not pb or page_num > len(google_pages):
            r["google_text"] = ""
            r["google_words"] = []
            r["google_similarity"] = None
            r["google_models_disagree"] = False
            r["google_min_word_confidence"] = None
            r["google_min_symbol_confidence"] = None
            continue

        x1, y1, x2, y2 = pb
        ypad = max(8.0, (y2 - y1) * 0.25)
        xpad = 20.0

        matched = []
        for w in google_pages[page_num - 1]["words"]:
            wx1, wy1, wx2, wy2 = w["bbox"]
            cx = (wx1 + wx2) / 2.0
            cy = (wy1 + wy2) / 2.0
            if (
                (x1 - xpad) <= cx <= (x2 + xpad)
                and (y1 - ypad) <= cy <= (y2 + ypad)
            ):
                matched.append(w)

        matched.sort(key=lambda w: w["bbox"][0])
        gtext = " ".join(w["text"] for w in matched).strip()

        word_confs = [w["confidence"] for w in matched if isinstance(w.get("confidence"), (int, float))]
        symbol_confs = [
            s["confidence"]
            for w in matched
            for s in w.get("symbols", [])
            if isinstance(s.get("confidence"), (int, float))
        ]

        r["google_text"] = gtext
        r["google_words"] = matched
        r["google_similarity"] = text_similarity(r["primary_text"], gtext)
        r["google_models_disagree"] = texts_disagree(r["primary_text"], gtext)
        r["google_min_word_confidence"] = min(word_confs) if word_confs else None
        r["google_min_symbol_confidence"] = min(symbol_confs) if symbol_confs else None



def finalise_review(records):
    GOOGLE_DISAGREE_THRESHOLD = "exact_after_spacing_punctuation_normalisation"
    GOOGLE_LOW_WORD_THRESHOLD = 0.80
    GOOGLE_LOW_SYMBOL_THRESHOLD = 0.60

    lines = []
    for r in records:
        flags = []

        if r["confidence_band"] == "SUPER_LOW":
            flags.append("SARVAM_SUPER_LOW_CONFIDENCE")
        elif r["confidence_band"] == "LOW":
            flags.append("SARVAM_LOW_CONFIDENCE")

        flags.extend(r.get("visual_flags", []))

        if r.get("alignment_count_mismatch"):
            flags.append("SARVAM_SURYA_LINE_COUNT_MISMATCH")

        ad = r.get("alignment_distance")
        if ad is not None and ad > 0.75:
            flags.append("SARVAM_SURYA_ALIGNMENT_UNCERTAIN")

        if not r.get("polygon"):
            flags.append("NO_LINE_GEOMETRY")

        gtext = r.get("google_text") or ""
        gsim = r.get("google_similarity")
        gword = r.get("google_min_word_confidence")
        gsym = r.get("google_min_symbol_confidence")

        models_disagree = bool(r.get("google_models_disagree"))
        if gtext and models_disagree:
            flags.append("OCR_MODEL_DISAGREEMENT")

        if gword is not None and gword < GOOGLE_LOW_WORD_THRESHOLD:
            flags.append("GOOGLE_LOW_WORD_CONFIDENCE")

        if gsym is not None and gsym < GOOGLE_LOW_SYMBOL_THRESHOLD:
            flags.append("GOOGLE_LOW_SYMBOL_CONFIDENCE")

        # v0.11: disagreement is a review signal, but not automatically HIGH.
        # HIGH is reserved for genuinely weak OCR/geometry evidence.
        if (
            r["confidence_band"] == "SUPER_LOW"
            or (gsym is not None and gsym < 0.45)
            or (gword is not None and gword < 0.60)
            or r["visual_legibility_score"] < 50
            or "NO_LINE_GEOMETRY" in flags
        ):
            priority = "HIGH"
        elif (
            "OCR_MODEL_DISAGREEMENT" in flags
            or r["confidence_band"] == "LOW"
            or r["visual_legibility_score"] < 80
            or "GOOGLE_LOW_WORD_CONFIDENCE" in flags
            or "GOOGLE_LOW_SYMBOL_CONFIDENCE" in flags
            or any("ALIGNMENT" in f or "COUNT_MISMATCH" in f for f in flags)
        ):
            priority = "MEDIUM"
        else:
            priority = "NORMAL"

        lines.append({
            "line_id": r["line_id"],
            "page_number": r["page_number"],
            "geometry": {
                "polygon": r.get("polygon"),
                "surya_index": r.get("surya_index"),
                "surya_confidence": r.get("surya_confidence"),
            },
            "primary_ocr": {
                "engine": "sarvam_vision",
                "source": "full_document",
                "raw_text": r["primary_text"],
                "block_confidence": r["sarvam_ocr_confidence"],
                "confidence_band": r["confidence_band"],
                "sarvam_block_index": r["sarvam_block_index"],
            },
            "secondary_ocr": {
                "engine": "google_cloud_vision",
                "source": "full_page",
                "raw_text": gtext,
                "min_word_confidence": gword,
                "min_symbol_confidence": gsym,
                "words": r.get("google_words", []),
            },
            "comparison": {
                "sarvam_google_similarity": gsim,
                "disagreement_rule": GOOGLE_DISAGREE_THRESHOLD,
                "models_disagree": models_disagree,
            },
            "visual_review": {
                "legibility_score": r["visual_legibility_score"],
                "metrics": r.get("visual_metrics"),
                "width_shape_robust_z": r.get("width_per_grapheme_robust_z"),
                "ink_ratio_robust_z": r.get("ink_ratio_robust_z"),
                "flags": r.get("visual_flags", []),
            },
            "review": {
                "priority": priority,
                "flags": flags,
                "include_in_corpus": True,
                "needs_alternative_ocr": False,
                "verified_text": None,
                "status": "PENDING",
            },
        })

    return lines



ERROR_CATEGORIES = [
    "SPELLING",
    "GRAMMAR",
    "PUNCTUATION",
    "WORD_CHOICE",
    "WORD_FORM",
    "MISSING_WORD",
    "EXTRA_WORD",
    "OTHER",
]

ERROR_SCHEMA = {
    "type": "object",
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "learner_form": {"type": "string"},
                    "category": {"type": "string", "enum": ERROR_CATEGORIES},
                    "suggested_correction": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["learner_form", "category", "suggested_correction", "note"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["candidates"],
    "additionalProperties": False,
}


def error_detection_prompt(text: str, level: str = "", task: str = ""):
    return f"""
You are reviewing a HUMAN-VERIFIED transcription of a Tamil learner's writing.
The text below is learner language. Detect only plausible learner-language errors.

Important rules:
- Do not rewrite the full passage.
- Do not "improve" style merely because another wording sounds better.
- Accept valid Tamil variants, names and context-dependent forms.
- learner_form should copy the exact learner span from the supplied text whenever possible.
- Use only these categories: {", ".join(ERROR_CATEGORIES)}.
- For MISSING_WORD, use a short exact surrounding span as learner_form and show the proposed insertion in suggested_correction.
- Return no candidate when uncertain.

Learner level: {level or "unspecified"}
Task type: {task or "unspecified"}

Verified learner text:
{text}
""".strip()


def clean_error_candidate(item, engine: str):
    if not isinstance(item, dict):
        return None
    form = str(item.get("learner_form", "") or "").strip()
    category = str(item.get("category", "OTHER") or "OTHER").strip().upper()
    suggested = str(item.get("suggested_correction", "") or "").strip()
    note = str(item.get("note", "") or "").strip()
    if category not in ERROR_CATEGORIES:
        category = "OTHER"
    if not form:
        return None
    return {
        "learner_form": form,
        "category": category,
        "suggested_correction": suggested,
        "note": note,
        "engines": [engine],
        "agreement": False,
    }


def detect_rule_candidates(text: str):
    """Very small deterministic checker: adjacent duplicate words / punctuation."""
    out = []
    # Exact adjacent duplicate token, allowing ordinary punctuation/space between.
    token_pattern = re.compile(r"(?P<w>[\p{Tamil}\p{L}\p{M}]+)(?P<gap>\s+)(?P=w)(?![\p{L}\p{M}])", re.IGNORECASE)
    for match in token_pattern.finditer(text or ""):
        form = match.group(0).strip()
        word = match.group("w")
        out.append({
            "learner_form": form,
            "category": "EXTRA_WORD",
            "suggested_correction": word,
            "note": "Adjacent repeated word detected by deterministic rule.",
            "engines": ["rules"],
            "agreement": False,
        })

    punct_pattern = re.compile(r"([!?.,;:])\1{1,}")
    for match in punct_pattern.finditer(text or ""):
        out.append({
            "learner_form": match.group(0),
            "category": "PUNCTUATION",
            "suggested_correction": match.group(1),
            "note": "Repeated punctuation detected by deterministic rule.",
            "engines": ["rules"],
            "agreement": False,
        })
    return out


def detect_errors_sarvam(text: str, level: str = "", task: str = ""):
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise RuntimeError("SARVAM_API_KEY is not configured.")

    payload = {
        "model": "sarvam-105b",
        "messages": [
            {
                "role": "system",
                "content": "You are a conservative Tamil learner-corpus error annotator. Return only defensible candidate annotations.",
            },
            {"role": "user", "content": error_detection_prompt(text, level, task)},
        ],
        "temperature": 0.1,
        "max_tokens": 1800,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "tamil_error_candidates",
                "strict": True,
                "schema": ERROR_SCHEMA,
            },
        },
    }

    response = httpx.post(
        "https://api.sarvam.ai/v1/chat/completions",
        headers={
            "api-subscription-key": api_key,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    response.raise_for_status()
    body = response.json()
    content = body["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    return [
        c for item in parsed.get("candidates", [])
        if (c := clean_error_candidate(item, "sarvam"))
    ]


def detect_errors_gemini(text: str, level: str = "", task: str = ""):
    _, detected_project = google.auth.default()
    project = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCLOUD_PROJECT") or detected_project
    if not project:
        raise RuntimeError("Google Cloud project could not be determined for Vertex AI.")

    location = os.getenv("VERTEX_LOCATION", "global")
    model = os.getenv("VERTEX_GEMINI_MODEL", "gemini-3.5-flash")

    client = genai.Client(
        vertexai=True,
        project=project,
        location=location,
        http_options=genai_types.HttpOptions(api_version="v1"),
    )
    response = client.models.generate_content(
        model=model,
        contents=error_detection_prompt(text, level, task),
        config={
            "temperature": 0.1,
            "max_output_tokens": 1800,
            "response_mime_type": "application/json",
            "response_json_schema": ERROR_SCHEMA,
        },
    )
    parsed = json.loads(response.text or '{"candidates":[]}')
    return [
        c for item in parsed.get("candidates", [])
        if (c := clean_error_candidate(item, "gemini"))
    ]


def normalise_candidate_span(value: str):
    return re.sub(r"[\s\p{P}\p{S}]+", "", (value or "").normalize("NFC").casefold())


def merge_error_candidates(*groups):
    """
    Merge exact/near-identical spans while preserving engine provenance.
    Same span + same category from Sarvam and Gemini becomes agreement=True.
    """
    merged = []

    for group in groups:
        for cand in group:
            span_key = normalise_candidate_span(cand["learner_form"])
            found = None
            for existing in merged:
                if normalise_candidate_span(existing["learner_form"]) == span_key:
                    found = existing
                    break

            if not found:
                item = dict(cand)
                item["category_options"] = [cand["category"]]
                merged.append(item)
                continue

            for engine in cand.get("engines", []):
                if engine not in found["engines"]:
                    found["engines"].append(engine)
            if cand["category"] not in found["category_options"]:
                found["category_options"].append(cand["category"])

            # Prefer a non-empty correction/note if the first engine omitted one.
            if not found.get("suggested_correction") and cand.get("suggested_correction"):
                found["suggested_correction"] = cand["suggested_correction"]
            if not found.get("note") and cand.get("note"):
                found["note"] = cand["note"]

            found["agreement"] = (
                "sarvam" in found["engines"]
                and "gemini" in found["engines"]
                and cand["category"] == found["category"]
            )

    for item in merged:
        item["agreement"] = bool(
            "sarvam" in item["engines"]
            and "gemini" in item["engines"]
            and len(item.get("category_options", [])) == 1
        )
    return merged


@app.get("/health")
def health():
    return {
        "ok": True,
        "sarvam_configured": bool(os.getenv("SARVAM_API_KEY")),
        "google_vision": "application_default_credentials",
        "gemini_model": os.getenv("VERTEX_GEMINI_MODEL", "gemini-3.5-flash"),
        "error_detection": "sarvam + gemini + rules",
    }




@app.post("/api/detect-errors")
async def detect_errors(payload: dict = Body(...)):
    text = str(payload.get("text", "") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Verified learner text is required.")

    level = str(payload.get("level", "") or "")
    task = str(payload.get("task", "") or "")

    engines = {}
    rules = detect_rule_candidates(text)

    try:
        sarvam = detect_errors_sarvam(text, level, task)
        engines["sarvam"] = {"ok": True, "count": len(sarvam)}
    except Exception as exc:
        sarvam = []
        engines["sarvam"] = {"ok": False, "error": str(exc)}

    try:
        gemini = detect_errors_gemini(text, level, task)
        engines["gemini"] = {"ok": True, "count": len(gemini)}
    except Exception as exc:
        gemini = []
        engines["gemini"] = {"ok": False, "error": str(exc)}

    engines["rules"] = {"ok": True, "count": len(rules)}
    candidates = merge_error_candidates(sarvam, gemini, rules)

    return {
        "categories": ERROR_CATEGORIES,
        "candidate_count": len(candidates),
        "engines": engines,
        "candidates": candidates,
        "note": "All results are candidate annotations and require human review.",
    }


@app.post("/api/page-count")
async def page_count(file: UploadFile = File(...)):
    name = file.filename or "upload.bin"
    suffix = Path(name).suffix.lower()
    supported = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
    if suffix not in supported:
        raise HTTPException(status_code=400, detail="OCR API currently accepts PDF and image files.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    mime = file.content_type or ("application/pdf" if suffix == ".pdf" else "image/png")

    try:
        with tempfile.TemporaryDirectory(prefix="corpus_count_") as td:
            input_path = Path(td) / name
            input_path.write_bytes(data)
            return {
                "source_filename": name,
                "page_count": upload_page_count(str(input_path), mime),
            }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/transcribe-page")
async def transcribe_page(
    file: UploadFile = File(...),
    page_number: int = Form(...),
    document_id: str = Form("DRAFT-001"),
    source_type: str = Form("auto"),
):
    name = file.filename or "upload.bin"
    suffix = Path(name).suffix.lower()
    supported = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
    if suffix not in supported:
        raise HTTPException(status_code=400, detail="OCR API currently accepts PDF and image files.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    mime = file.content_type or ("application/pdf" if suffix == ".pdf" else "image/png")

    try:
        with tempfile.TemporaryDirectory(prefix=f"corpus_p{page_number}_") as td_raw:
            td = Path(td_raw)
            input_path = td / name
            input_path.write_bytes(data)

            total_pages = upload_page_count(str(input_path), mime)
            if page_number < 1 or page_number > total_pages:
                raise HTTPException(
                    status_code=400,
                    detail=f"page_number must be between 1 and {total_pages}.",
                )

            started = time.time()
            page_result = process_one_page(input_path, mime, page_number, td)
            lines = page_result["lines"]

            return {
                "schema_version": "1.3-page-by-page-review",
                "document_id": document_id,
                "source_filename": name,
                "source_type": source_type,
                "page_number": page_number,
                "page_count": total_pages,
                "elapsed_seconds": round(time.time() - started, 2),
                "page_preview": page_result["page_preview"],
                "pipeline": {
                    "primary_ocr": "sarvam_vision_single_page",
                    "secondary_ocr": "google_cloud_vision_single_page",
                    "comparison": "sarvam_google_line_disagreement",
                    "line_geometry": "surya",
                    "automatic_fallback_ocr": False,
                    "manual_review_required": True,
                    "processing_mode": "page_by_page",
                },
                "lines": lines,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    document_id: str = Form("DRAFT-001"),
    source_type: str = Form("auto"),
):
    name = file.filename or "upload.bin"
    suffix = Path(name).suffix.lower()
    supported = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
    if suffix not in supported:
        raise HTTPException(status_code=400, detail="OCR API currently accepts PDF and image files.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    mime = file.content_type or ("application/pdf" if suffix == ".pdf" else "image/png")

    try:
        with tempfile.TemporaryDirectory(prefix="corpus_ocr_") as td:
            td = Path(td)
            input_path = td / name
            input_path.write_bytes(data)

            sarvam_doc = run_sarvam_digitise(str(input_path), mime, td / "sarvam")
            page_images = render_pages(str(input_path), mime)
            sarvam_pages = sarvam_doc.get("pages", [])

            if not sarvam_pages:
                raise RuntimeError("Sarvam returned zero pages.")

            page_count = min(len(page_images), len(sarvam_pages))
            records = []
            google_pages = []

            for i in range(page_count):
                img = page_images[i]

                # Independent full-page OCR from Google Vision.
                google_pages.append(run_google_vision(img))

                # Sarvam remains the primary transcription.
                blocks = normalize_sarvam_blocks(sarvam_pages[i], img)
                surya_lines = detect_surya_lines(img)
                records.extend(map_blocks_to_lines(blocks, surya_lines, i + 1))

            attach_google_to_lines(records, google_pages)
            apply_visual_review(records, page_images)
            lines = finalise_review(records)

            return {
                "schema_version": "1.2.1-sarvam-google-line-review",
                "document_id": document_id,
                "source_filename": name,
                "source_type": source_type,
                "page_count": page_count,
                "pipeline": {
                    "primary_ocr": "sarvam_vision_full_document",
                    "secondary_ocr": "google_cloud_vision_full_page",
                    "comparison": "sarvam_google_line_disagreement",
                    "line_geometry": "surya",
                    "automatic_fallback_ocr": False,
                    "visual_legibility": "local_page_relative_heuristic",
                    "manual_review_required": True,
                },
                "confidence_bands": {
                    "SUPER_LOW": "<0.60",
                    "LOW": "0.60-0.80",
                    "NORMAL": "0.80-0.90",
                    "HIGH": ">=0.90",
                },
                "lines": lines,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
