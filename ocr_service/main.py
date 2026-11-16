import os
import tempfile
import time
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF for strict PDF page count validation
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from paddleocr import PPStructureV3

from parser import parse_purchase_bill_structure

MAX_FILE_BYTES = 15 * 1024 * 1024  # 15 MB
MAX_PDF_PAGES = 10
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "application/pdf",
}

app = FastAPI(title="DronaInvoice PaddleOCR PP-StructureV3 Service", version="1.0.0")

_pipeline: Optional[PPStructureV3] = None


def get_pipeline() -> PPStructureV3:
    global _pipeline
    if _pipeline is None:
        _pipeline = PPStructureV3(
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_textline_orientation=True,
        )
    return _pipeline


@app.get("/health")
def health():
    return {"ok": True, "engine": "PaddleOCR PP-StructureV3"}


@app.post("/ocr/purchase-bill")
async def extract_purchase_bill(
    file: UploadFile = File(...),
    x_ocr_secret: Optional[str] = Header(default=None),
):
    expected_secret = os.getenv("PADDLE_OCR_API_KEY", "").strip()
    if expected_secret and (x_ocr_secret or "").strip() != expected_secret:
        raise HTTPException(status_code=401, detail="Invalid OCR service credentials")

    filename = file.filename or "document"
    ext = Path(filename).suffix.lower()
    content_type = (file.content_type or "").lower()

    if ext not in ALLOWED_EXTENSIONS and content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload JPG, JPEG, PNG, or PDF.",
        )

    if not ext:
        ext = ".pdf" if content_type == "application/pdf" else ".png"

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(payload) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {MAX_FILE_BYTES // (1024 * 1024)} MB",
        )

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(payload)
            tmp_path = tmp.name

        if ext == ".pdf":
            with fitz.open(tmp_path) as doc:
                if doc.page_count > MAX_PDF_PAGES:
                    raise HTTPException(
                        status_code=400,
                        detail=f"PDF exceeds maximum limit of {MAX_PDF_PAGES} pages",
                    )

        started = time.perf_counter()
        pipeline = get_pipeline()
        output = list(pipeline.predict(input=tmp_path))
        processing_ms = int((time.perf_counter() - started) * 1000)

        return parse_purchase_bill_structure(output, processing_ms)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PaddleOCR processing error: {exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
