import { GstinApi, GstinError, isValidGstin } from 'gstinapi';

interface VercelRequestLike {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface VercelResponseLike {
  status: (code: number) => VercelResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

const CODE_STATUS_MAP: Record<string, number> = {
  INVALID_FORMAT: 400,
  UNAUTHORIZED: 401,
  INSUFFICIENT_CREDITS: 402,
  ACCOUNT_DEACTIVATED: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 502,
  TIMEOUT: 504,
  NETWORK: 502,
};

const CODE_MESSAGE_MAP: Record<string, string> = {
  INVALID_FORMAT: 'Invalid GSTIN format or checksum. Please double-check the 15-character GST number.',
  UNAUTHORIZED: 'GSTIN API authentication failed. Check the server GSTIN_API_KEY configuration.',
  INSUFFICIENT_CREDITS: 'GSTIN lookup credits exhausted on gstinapi.in. Please top up credits.',
  ACCOUNT_DEACTIVATED: 'The gstinapi.in account is deactivated.',
  NOT_FOUND: 'No GST registration record found for this GSTIN.',
  RATE_LIMITED: 'GSTIN lookup rate limit reached. Please try again in a few seconds.',
  PROVIDER_UNAVAILABLE: 'GST network is temporarily unavailable. Please try again shortly.',
  TIMEOUT: 'GSTIN lookup timed out. Please try again.',
  NETWORK: 'Network error while contacting GST verification service.',
};

export default async function handler(req: VercelRequestLike, res: VercelResponseLike) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawQueryGstin = Array.isArray(req.query?.gstin) ? req.query?.gstin[0] : req.query?.gstin;
  const urlParams = new URL(req.url || '/api/gstin', 'http://localhost').searchParams;
  const gstin = String(rawQueryGstin ?? urlParams.get('gstin') ?? '')
    .trim()
    .toUpperCase();

  if (!gstin) {
    res.status(400).json({ error: 'GSTIN parameter is required', code: 'INVALID_FORMAT' });
    return;
  }

  if (!isValidGstin(gstin)) {
    res.status(400).json({
      error: CODE_MESSAGE_MAP.INVALID_FORMAT,
      code: 'INVALID_FORMAT',
    });
    return;
  }

  const apiKey = process.env.GSTIN_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({
      error: 'GSTIN_API_KEY environment variable is not configured on the server.',
      code: 'MISSING_API_KEY',
    });
    return;
  }

  const includeParam = Array.isArray(req.query?.include)
    ? req.query?.include[0]
    : req.query?.include ?? urlParams.get('include');

  try {
    const client = new GstinApi({
      apiKey,
      retries: 2,
      timeout: 15000,
      validateChecksum: true,
    });
    const result = await client.lookup(
      gstin,
      includeParam === 'profile' ? { include: 'profile' } : { include: 'profile' }
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof GstinError) {
      const status = (err.code && CODE_STATUS_MAP[err.code]) || err.status || 502;
      const message = (err.code && CODE_MESSAGE_MAP[err.code]) || err.message;
      res.status(status).json({ error: message, code: err.code || 'HTTP_ERROR' });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to verify GSTIN',
      code: 'INTERNAL_ERROR',
    });
  }
}
