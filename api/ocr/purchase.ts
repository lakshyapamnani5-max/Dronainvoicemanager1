import { extractPurchaseBillWithPaddleJobsApi } from '../../src/shared/paddleOcrParser';

interface VercelRequestLike {
  method?: string;
  body?: {
    fileName?: string;
    mimeType?: string;
    base64Data?: string;
  };
}

interface VercelResponseLike {
  status: (code: number) => VercelResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
]);
const MAX_BYTES = 15 * 1024 * 1024;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '22mb',
    },
  },
};

export default async function handler(req: VercelRequestLike, res: VercelResponseLike) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const fileName = String(req.body?.fileName || 'purchase-bill').trim().slice(0, 120);
  const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();
  const base64Data = String(req.body?.base64Data || '').trim();

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    res.status(400).json({
      error: 'Unsupported file format. Please upload JPG, JPEG, PNG, or PDF.',
      code: 'UNSUPPORTED_FILE',
    });
    return;
  }

  const pureBase64 = base64Data.includes(',') ? base64Data.split(',')[1] || '' : base64Data;
  if (!pureBase64) {
    res.status(400).json({ error: 'Document file content is missing', code: 'EMPTY_FILE' });
    return;
  }

  const buffer = Buffer.from(pureBase64, 'base64');
  if (buffer.length === 0) {
    res.status(400).json({ error: 'Uploaded file is empty', code: 'EMPTY_FILE' });
    return;
  }
  if (buffer.length > MAX_BYTES) {
    res.status(413).json({ error: 'Document exceeds 15 MB limit', code: 'FILE_TOO_LARGE' });
    return;
  }

  const paddleToken = process.env.PADDLE_OCR_TOKEN?.trim();
  const paddleJobUrl = process.env.PADDLE_OCR_JOB_URL?.trim();
  const serviceUrl = process.env.PADDLE_OCR_SERVICE_URL?.trim().replace(/\/+$/, '');

  if (paddleToken) {
    try {
      const extracted = await extractPurchaseBillWithPaddleJobsApi({
        buffer,
        fileName,
        mimeType,
        token: paddleToken,
        jobUrl: paddleJobUrl,
        timeoutMs: 52_000,
      });
      res.status(200).json(extracted);
      return;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      res.status(isAbort ? 504 : 502).json({
        error:
          err instanceof Error
            ? err.message
            : 'PaddleOCR PP-StructureV3 extraction failed.',
        code: isAbort ? 'OCR_TIMEOUT' : 'OCR_UPSTREAM_ERROR',
      });
      return;
    }
  }

  if (!serviceUrl) {
    res.status(503).json({
      error:
        'PaddleOCR (PP-StructureV3) backend service is not configured. Set PADDLE_OCR_TOKEN or PADDLE_OCR_SERVICE_URL on the server, or continue with manual entry.',
      code: 'OCR_SERVICE_UNCONFIGURED',
    });
    return;
  }

  try {
    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    form.append('file', blob, fileName);

    const headers: Record<string, string> = {};
    const apiKey = process.env.PADDLE_OCR_API_KEY?.trim();
    if (apiKey) headers['x-ocr-secret'] = apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    const upstream = await fetch(`${serviceUrl}/ocr/purchase-bill`, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      res.status(upstream.status || 502).json({
        error:
          (payload as { detail?: string; error?: string }).detail ||
          (payload as { error?: string }).error ||
          `PaddleOCR service failed (HTTP ${upstream.status})`,
        code: 'OCR_UPSTREAM_ERROR',
      });
      return;
    }

    res.status(200).json(payload);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    res.status(isAbort ? 504 : 503).json({
      error: isAbort
        ? 'PaddleOCR extraction timed out. Try cropping or uploading fewer pages.'
        : 'PaddleOCR service is currently unreachable. Please check your OCR backend or continue manually.',
      code: isAbort ? 'OCR_TIMEOUT' : 'OCR_UNREACHABLE',
    });
  }
}
