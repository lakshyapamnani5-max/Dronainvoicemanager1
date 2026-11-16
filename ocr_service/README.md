# DronaInvoice PaddleOCR (PP-StructureV3) Service

Standalone Python FastAPI microservice executing **PaddleOCR PP-StructureV3** (`PPStructureV3`) for supplier purchase bill OCR, document layout analysis, and HTML table extraction.

## Local Development

```bash
cd ocr_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export PADDLE_OCR_API_KEY="your-shared-secret"
uvicorn main:app --host 0.0.0.0 --port 8001
```

Then configure the DronaInvoice Node / Vercel backend environment variables:

```env
PADDLE_OCR_SERVICE_URL="http://127.0.0.1:8001"
PADDLE_OCR_API_KEY="your-shared-secret"
```

## Security & Limits

- Allowed file formats: `.jpg`, `.jpeg`, `.png`, `.pdf`
- Maximum file size: `15 MB`
- Maximum PDF pages: `10`
- Temporary files are automatically deleted immediately after inference.
- Optional shared header check via `x-ocr-secret`.
