import { Router } from 'express';
import { db } from './db.ts';
import {
  createSession,
  extractToken,
  mapUserRow,
  rateLimit,
  requireAuth,
  requireSuperAdmin,
  requireTenantWorkspace,
  revokeSessionByToken,
} from './auth.ts';
import { generateId, generateToken, hashPassword, sha256, verifyPassword } from './cryptoUtils.ts';
import {
  archiveOrDeleteCustomer,
  cancelInvoice,
  convertQuotationToInvoice,
  createCustomer,
  finalizeDraftInvoice,
  getAdminDashboardData,
  getBusinessProfile,
  getCustomerDashboardAnalytics,
  getInvoiceById,
  getOutstandingReport,
  getPlatformSettings,
  getQuotationById,
  listActivityLogs,
  listCustomers,
  listInvoices,
  listPayments,
  listQuotations,
  logActivity,
  recordPayment,
  sanitizeStr,
  saveInvoice,
  saveQuotation,
  updateBusinessProfile,
  updateCustomer,
  updateQuotationStatus,
} from './services.ts';
import { GstinApi, GstinError, isValidGstin as isValidGstinChecksum } from 'gstinapi';
import { fromPaise } from '../src/shared/gstCalculator.ts';
import { isValidGstin } from '../src/shared/indianStates.ts';
import { extractPurchaseBillWithPaddleJobsApi } from '../src/shared/paddleOcrParser.ts';

export const apiRouter = Router();

const GSTIN_CODE_STATUS: Record<string, number> = {
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

const GSTIN_CODE_MESSAGE: Record<string, string> = {
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

function setSessionCookie(res: import('express').Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('drona_session', token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function buildSessionPayload(auth: NonNullable<import('express').Request['auth']>) {
  const businessProfile =
    auth.effectiveUser.role === 'business'
      ? getBusinessProfile(auth.effectiveUser.uid)
      : null;

  return {
    actorUser: auth.actorUser,
    effectiveUser: auth.effectiveUser,
    businessProfile,
    isImpersonating: auth.isImpersonating,
    impersonationSession: auth.impersonationSession,
  };
}

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'drona-api', timestamp: new Date().toISOString() });
});

apiRouter.get('/public/settings', (_req, res) => {
  const s = getPlatformSettings();
  res.json({
    platformName: s.platformName,
    allowSelfRegistration: s.allowSelfRegistration,
    maintenanceMode: s.maintenanceMode,
    supportEmail: s.supportEmail,
  });
});

apiRouter.get('/gstin', rateLimit(40, 60_000), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const gstin = sanitizeStr(req.query?.gstin, 20).toUpperCase();

  if (!gstin) {
    res.status(400).json({ error: 'GSTIN parameter is required', code: 'INVALID_FORMAT' });
    return;
  }

  if (!isValidGstinChecksum(gstin)) {
    res.status(400).json({
      error: GSTIN_CODE_MESSAGE.INVALID_FORMAT,
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

  try {
    const client = new GstinApi({
      apiKey,
      retries: 2,
      timeout: 15000,
      validateChecksum: true,
    });
    const result = await client.lookup(gstin, { include: 'profile' });
    res.json(result);
  } catch (err) {
    if (err instanceof GstinError) {
      const status = (err.code && GSTIN_CODE_STATUS[err.code]) || err.status || 502;
      const message = (err.code && GSTIN_CODE_MESSAGE[err.code]) || err.message;
      res.status(status).json({ error: message, code: err.code || 'HTTP_ERROR' });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to verify GSTIN',
      code: 'INTERNAL_ERROR',
    });
  }
});

const ALLOWED_OCR_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
]);
const MAX_OCR_BYTES = 15 * 1024 * 1024;

apiRouter.post('/ocr/purchase', rateLimit(20, 60_000), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const fileName = sanitizeStr(req.body?.fileName || 'purchase-bill', 120) || 'purchase-bill';
  const mimeType = sanitizeStr(req.body?.mimeType, 80).toLowerCase();
  const base64Data = typeof req.body?.base64Data === 'string' ? req.body.base64Data.trim() : '';

  if (!ALLOWED_OCR_MIME.has(mimeType)) {
    res.status(400).json({
      error: 'Unsupported file format. Upload JPG, JPEG, PNG, or PDF.',
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
  if (buffer.length > MAX_OCR_BYTES) {
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
        timeoutMs: 75_000,
      });
      res.json(extracted);
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

    res.json(payload);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    res.status(isAbort ? 504 : 503).json({
      error: isAbort
        ? 'PaddleOCR extraction timed out. Try cropping or uploading fewer pages.'
        : 'PaddleOCR service is currently unreachable. Please check your OCR backend or continue manually.',
      code: isAbort ? 'OCR_TIMEOUT' : 'OCR_UNREACHABLE',
    });
  }
});

// ==================== AUTHENTICATION ====================

apiRouter.post('/auth/login', rateLimit(25, 60_000), (req, res) => {
  const email = sanitizeStr(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const expectedRole = req.body?.portal === 'admin' ? 'super_admin' : null;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | (Record<string, unknown> & { password_hash: string; role: string; status: string })
    | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  if (expectedRole && row.role !== expectedRole) {
    res.status(403).json({ error: 'This portal is restricted to Drona Administrators' });
    return;
  }

  if (row.status !== 'active') {
    res.status(403).json({ error: 'Your business account is inactive. Contact Drona Admin.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ? WHERE uid = ?').run(now, String(row.uid));

  const user = mapUserRow(row as never);
  const { token } = createSession(user.uid, 24);
  setSessionCookie(res, token);

  logActivity({
    actor: user,
    targetTenantUid: user.role === 'business' ? user.uid : null,
    action: 'USER_LOGIN',
    entityType: 'auth',
    entityId: user.uid,
    summary: `${user.email} signed in (${user.role})`,
  });

  const businessProfile = user.role === 'business' ? getBusinessProfile(user.uid) : null;
  res.json({
    token,
    session: {
      actorUser: user,
      effectiveUser: user,
      businessProfile,
      isImpersonating: false,
      impersonationSession: null,
    },
  });
});

apiRouter.post('/auth/register', rateLimit(10, 60_000), (req, res) => {
  const settings = getPlatformSettings();
  if (!settings.allowSelfRegistration) {
    res.status(403).json({ error: 'Self-registration is currently disabled by Drona Admin' });
    return;
  }

  const email = sanitizeStr(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ownerName = sanitizeStr(req.body?.ownerName, 120);
  const businessName = sanitizeStr(req.body?.businessName, 160);
  const phone = sanitizeStr(req.body?.phone, 32);
  const gstin = sanitizeStr(req.body?.gstin, 20).toUpperCase();
  const state = sanitizeStr(req.body?.state, 64) || 'Maharashtra';

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email is required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  if (!ownerName || !businessName) {
    res.status(400).json({ error: 'Owner name and business name are required' });
    return;
  }
  if (gstin && !isValidGstin(gstin)) {
    res.status(400).json({ error: 'Invalid GSTIN format' });
    return;
  }

  const existing = db.prepare('SELECT uid FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const uid = generateId('usr');
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (uid, email, password_hash, role, status, owner_name, business_name, phone, gstin, subscription_plan, subscription_amount, created_at, updated_at, last_login_at)
      VALUES (?, ?, ?, 'business', 'active', ?, ?, ?, ?, 'Growth', ?, ?, ?, ?)
    `).run(
      uid,
      email,
      hashPassword(password),
      ownerName,
      businessName,
      phone,
      gstin,
      settings.defaultSubscriptionMonthly,
      now,
      now,
      now
    );

    db.prepare(`
      INSERT INTO business_profiles (
        user_uid, business_name, owner_name, address, email, phone, gstin, state,
        invoice_prefix, quotation_prefix, signature_label, updated_at
      ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid,
      businessName,
      ownerName,
      email,
      phone,
      gstin,
      state,
      settings.defaultInvoicePrefix,
      settings.defaultQuotationPrefix,
      `For ${businessName}`,
      now
    );
  })();

  const createdRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as never;
  const user = mapUserRow(createdRow);
  const { token } = createSession(uid, 24);
  setSessionCookie(res, token);

  logActivity({
    actor: user,
    targetTenantUid: uid,
    action: 'BUSINESS_SELF_REGISTERED',
    entityType: 'user',
    entityId: uid,
    summary: `New business ${businessName} registered`,
  });

  res.status(201).json({
    token,
    session: {
      actorUser: user,
      effectiveUser: user,
      businessProfile: getBusinessProfile(uid),
      isImpersonating: false,
      impersonationSession: null,
    },
  });
});

apiRouter.post('/auth/logout', (req, res) => {
  const token = extractToken(req);
  if (token) revokeSessionByToken(token);
  res.clearCookie('drona_session', { path: '/' });
  res.json({ ok: true });
});

apiRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ session: buildSessionPayload(req.auth!) });
});

apiRouter.post('/auth/forgot-password', rateLimit(10, 60_000), (req, res) => {
  const email = sanitizeStr(req.body?.email, 160).toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const user = db.prepare('SELECT uid, email FROM users WHERE email = ?').get(email) as
    | { uid: string; email: string }
    | undefined;

  if (!user) {
    // Avoid user enumeration
    res.json({
      ok: true,
      emailDeliveryConfigured: Boolean(process.env.SMTP_HOST),
      message: 'If an account matches this email, password reset instructions have been prepared.',
    });
    return;
  }

  const resetToken = generateToken(16);
  const now = new Date();
  const expires = new Date(now.getTime() + 20 * 60 * 1000);
  db.prepare(`
    INSERT INTO password_resets (id, user_uid, token_hash, expires_at, used, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(generateId('rst'), user.uid, sha256(resetToken), expires.toISOString(), now.toISOString());

  const smtpConfigured = Boolean(process.env.SMTP_HOST);
  res.json({
    ok: true,
    emailDeliveryConfigured: smtpConfigured,
    message: smtpConfigured
      ? 'Password reset token dispatched to your email address.'
      : 'SMTP email transport is not configured on this server. Use the verification token below to complete reset.',
    resetToken: smtpConfigured ? undefined : resetToken,
  });
});

apiRouter.post('/auth/reset-password', rateLimit(15, 60_000), (req, res) => {
  const token = sanitizeStr(req.body?.token, 128);
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!token || newPassword.length < 8) {
    res.status(400).json({ error: 'Valid reset token and password (min 8 chars) are required' });
    return;
  }

  const row = db
    .prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0')
    .get(sha256(token)) as
    | { id: string; user_uid: string; expires_at: string }
    | undefined;

  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    res.status(400).json({ error: 'Reset token is invalid or expired' });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?').run(
      hashPassword(newPassword),
      new Date().toISOString(),
      row.user_uid
    );
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_uid = ?').run(row.user_uid);
  })();

  res.json({ ok: true, message: 'Password updated successfully. Please sign in.' });
});

apiRouter.post('/auth/change-password', requireAuth, (req, res) => {
  if (req.auth!.isImpersonating) {
    res.status(403).json({ error: 'Cannot change customer password during admin impersonation' });
    return;
  }
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const row = db.prepare('SELECT password_hash FROM users WHERE uid = ?').get(req.auth!.actorUser.uid) as {
    password_hash: string;
  };
  if (!verifyPassword(currentPassword, row.password_hash)) {
    res.status(400).json({ error: 'Current password is incorrect' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?').run(
    hashPassword(newPassword),
    new Date().toISOString(),
    req.auth!.actorUser.uid
  );

  res.json({ ok: true });
});

// ==================== CUSTOMER BUSINESS WORKSPACE ====================

apiRouter.get('/business/profile', requireAuth, requireTenantWorkspace, (req, res) => {
  const profile = getBusinessProfile(req.auth!.effectiveUser.uid);
  res.json({ profile });
});

apiRouter.put('/business/profile', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const profile = updateBusinessProfile(req.auth!, req.body || {});
    res.json({ profile });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update profile' });
  }
});

// Customers CRM
apiRouter.get('/customers', requireAuth, requireTenantWorkspace, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const includeArchived = req.query.includeArchived === 'true';
  const customers = listCustomers(req.auth!.effectiveUser.uid, { search, includeArchived });
  res.json({ customers });
});

apiRouter.post('/customers', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const customer = createCustomer(req.auth!, req.body || {});
    res.status(201).json({ customer });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create customer' });
  }
});

apiRouter.get('/customers/:id', requireAuth, requireTenantWorkspace, (req, res) => {
  const tenantUid = req.auth!.effectiveUser.uid;
  const customerId = String(req.params.id);
  const customer = listCustomers(tenantUid, { includeArchived: true }).find((c) => c.id === customerId);
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  const invoices = listInvoices(tenantUid, { customerId });
  const quotations = listQuotations(tenantUid, { customerId });
  const payments = listPayments(tenantUid, { customerId });
  res.json({ customer, invoices, quotations, payments });
});

apiRouter.put('/customers/:id', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const customer = updateCustomer(req.auth!, String(req.params.id), req.body || {});
    res.json({ customer });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update customer' });
  }
});

apiRouter.delete('/customers/:id', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const result = archiveOrDeleteCustomer(req.auth!, String(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete customer' });
  }
});

// Invoices
apiRouter.get('/invoices', requireAuth, requireTenantWorkspace, (req, res) => {
  const invoices = listInvoices(req.auth!.effectiveUser.uid, {
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  });
  res.json({ invoices });
});

apiRouter.post('/invoices', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const invoice = saveInvoice(req.auth!, req.body);
    res.status(201).json({ invoice });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create invoice' });
  }
});

apiRouter.get('/invoices/:id', requireAuth, requireTenantWorkspace, (req, res) => {
  const invoice = getInvoiceById(req.auth!.effectiveUser.uid, String(req.params.id));
  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  const auditLogs = db
    .prepare(
      `SELECT * FROM activity_logs WHERE entity_type = 'invoice' AND entity_id = ? AND target_tenant_uid = ? ORDER BY created_at DESC`
    )
    .all(invoice.id, req.auth!.effectiveUser.uid) as Array<Record<string, unknown>>;

  res.json({
    invoice,
    auditLogs: auditLogs.map((r) => ({
      id: String(r.id),
      actorEmail: String(r.actor_email),
      action: String(r.action),
      summary: String(r.summary),
      createdAt: String(r.created_at),
      impersonationSessionId: r.impersonation_session_id ? String(r.impersonation_session_id) : null,
    })),
  });
});

apiRouter.put('/invoices/:id', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const invoice = saveInvoice(req.auth!, req.body, String(req.params.id));
    res.json({ invoice });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update invoice' });
  }
});

apiRouter.post('/invoices/:id/finalize', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const invoice = finalizeDraftInvoice(req.auth!, String(req.params.id));
    res.json({ invoice });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to finalize invoice' });
  }
});

apiRouter.post('/invoices/:id/cancel', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const invoice = cancelInvoice(
      req.auth!,
      String(req.params.id),
      typeof req.body?.reason === 'string' ? req.body.reason : ''
    );
    res.json({ invoice });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to cancel invoice' });
  }
});

// Quotations
apiRouter.get('/quotations', requireAuth, requireTenantWorkspace, (req, res) => {
  const quotations = listQuotations(req.auth!.effectiveUser.uid, {
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  });
  res.json({ quotations });
});

apiRouter.post('/quotations', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const quotation = saveQuotation(req.auth!, req.body);
    res.status(201).json({ quotation });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create quotation' });
  }
});

apiRouter.get('/quotations/:id', requireAuth, requireTenantWorkspace, (req, res) => {
  const quotation = getQuotationById(req.auth!.effectiveUser.uid, String(req.params.id));
  if (!quotation) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }
  res.json({ quotation });
});

apiRouter.put('/quotations/:id', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const quotation = saveQuotation(req.auth!, req.body, String(req.params.id));
    res.json({ quotation });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update quotation' });
  }
});

apiRouter.post('/quotations/:id/status', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const status = req.body?.status;
    if (!['sent', 'accepted', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Invalid status transition' });
      return;
    }
    const quotation = updateQuotationStatus(req.auth!, String(req.params.id), status);
    res.json({ quotation });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update status' });
  }
});

apiRouter.post('/quotations/:id/convert', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const invoice = convertQuotationToInvoice(req.auth!, String(req.params.id));
    res.status(201).json({ invoice });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Conversion failed' });
  }
});

// Payments
apiRouter.get('/payments', requireAuth, requireTenantWorkspace, (req, res) => {
  const payments = listPayments(req.auth!.effectiveUser.uid, {
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
    method: typeof req.query.method === 'string' ? req.query.method : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  });
  res.json({ payments });
});

apiRouter.post('/payments', requireAuth, requireTenantWorkspace, (req, res) => {
  try {
    const payment = recordPayment(req.auth!, req.body || {});
    res.status(201).json({ payment });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to record payment' });
  }
});

// Analytics & Reports
apiRouter.get('/analytics/dashboard', requireAuth, requireTenantWorkspace, (req, res) => {
  const range = typeof req.query.range === 'string' ? req.query.range : 'month';
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
  const data = getCustomerDashboardAnalytics(req.auth!.effectiveUser.uid, range, startDate, endDate);
  res.json(data);
});

apiRouter.get('/reports/outstanding', requireAuth, requireTenantWorkspace, (req, res) => {
  const filter =
    req.query.filter === 'overdue' || req.query.filter === 'not_due' ? req.query.filter : 'all';
  const rows = getOutstandingReport(req.auth!.effectiveUser.uid, {
    filter,
    customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  });
  res.json({ rows });
});

// Notifications
apiRouter.get('/notifications', requireAuth, requireTenantWorkspace, (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM notifications WHERE user_uid = ? ORDER BY created_at DESC LIMIT 40`
    )
    .all(req.auth!.effectiveUser.uid) as Array<Record<string, unknown>>;

  res.json({
    notifications: rows.map((r) => ({
      id: String(r.id),
      userUid: String(r.user_uid),
      type: String(r.type),
      title: String(r.title),
      message: String(r.message),
      entityType: r.entity_type ? String(r.entity_type) : null,
      entityId: r.entity_id ? String(r.entity_id) : null,
      isRead: Boolean(r.is_read),
      emailStatus: String(r.email_status),
      whatsappStatus: String(r.whatsapp_status),
      createdAt: String(r.created_at),
    })),
  });
});

apiRouter.post('/notifications/:id/read', requireAuth, requireTenantWorkspace, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_uid = ?').run(
    String(req.params.id),
    req.auth!.effectiveUser.uid
  );
  res.json({ ok: true });
});

apiRouter.post('/notifications/read-all', requireAuth, requireTenantWorkspace, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_uid = ?').run(
    req.auth!.effectiveUser.uid
  );
  res.json({ ok: true });
});

// ==================== DRONA SUPER ADMIN ====================

apiRouter.get('/admin/dashboard', requireAuth, requireSuperAdmin, (req, res) => {
  const range = typeof req.query.range === 'string' ? req.query.range : 'all';
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
  const data = getAdminDashboardData(range, startDate, endDate);
  res.json(data);
});

apiRouter.get('/admin/users', requireAuth, requireSuperAdmin, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';

  const rows = db
    .prepare(
      `SELECT u.*,
        COALESCE((SELECT COUNT(*) FROM invoices i WHERE i.user_uid = u.uid), 0) AS invoice_count,
        COALESCE((SELECT COUNT(*) FROM quotations q WHERE q.user_uid = u.uid), 0) AS quotation_count,
        COALESCE((SELECT SUM(grand_total_paise) FROM invoices i WHERE i.user_uid = u.uid AND i.status NOT IN ('draft', 'cancelled')), 0) AS total_sales_paise,
        COALESCE((SELECT SUM(amount_paid_paise) FROM invoices i WHERE i.user_uid = u.uid AND i.status NOT IN ('draft', 'cancelled')), 0) AS total_collected_paise
       FROM users u WHERE u.role = 'business'
       ORDER BY u.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const users = rows
    .map((r) => ({
      ...mapUserRow(r as never),
      invoiceCount: Number(r.invoice_count || 0),
      quotationCount: Number(r.quotation_count || 0),
      totalSales: fromPaise(Number(r.total_sales_paise || 0)),
      totalCollected: fromPaise(Number(r.total_collected_paise || 0)),
    }))
    .filter((u) => {
      if (status !== 'all' && u.status !== status) return false;
      if (!search) return true;
      return (
        u.businessName.toLowerCase().includes(search) ||
        u.ownerName.toLowerCase().includes(search) ||
        u.email.toLowerCase().includes(search) ||
        u.phone.toLowerCase().includes(search) ||
        u.gstin.toLowerCase().includes(search)
      );
    });

  res.json({ users });
});

apiRouter.post('/admin/users', requireAuth, requireSuperAdmin, (req, res) => {
  const email = sanitizeStr(req.body?.email, 160).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ownerName = sanitizeStr(req.body?.ownerName, 120);
  const businessName = sanitizeStr(req.body?.businessName, 160);
  const phone = sanitizeStr(req.body?.phone, 32);
  const gstin = sanitizeStr(req.body?.gstin, 20).toUpperCase();
  const state = sanitizeStr(req.body?.state, 64) || 'Maharashtra';
  const subscriptionPlan = sanitizeStr(req.body?.subscriptionPlan, 40) || 'Growth';
  const subscriptionAmount = Math.max(0, Math.round(Number(req.body?.subscriptionAmount ?? 1999)));

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email is required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Initial password must be at least 8 characters' });
    return;
  }
  if (!ownerName || !businessName) {
    res.status(400).json({ error: 'Owner name and business name are required' });
    return;
  }
  if (gstin && !isValidGstin(gstin)) {
    res.status(400).json({ error: 'Invalid GSTIN format' });
    return;
  }

  const dup = db.prepare('SELECT uid FROM users WHERE email = ?').get(email);
  if (dup) {
    res.status(409).json({ error: 'A business account with this email already exists' });
    return;
  }

  const settings = getPlatformSettings();
  const uid = generateId('usr');
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (uid, email, password_hash, role, status, owner_name, business_name, phone, gstin, subscription_plan, subscription_amount, created_at, updated_at)
      VALUES (?, ?, ?, 'business', 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid,
      email,
      hashPassword(password),
      ownerName,
      businessName,
      phone,
      gstin,
      subscriptionPlan,
      subscriptionAmount,
      now,
      now
    );

    db.prepare(`
      INSERT INTO business_profiles (
        user_uid, business_name, owner_name, address, email, phone, gstin, state,
        invoice_prefix, quotation_prefix, signature_label, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid,
      businessName,
      ownerName,
      sanitizeStr(req.body?.address, 400),
      email,
      phone,
      gstin,
      state,
      settings.defaultInvoicePrefix,
      settings.defaultQuotationPrefix,
      `For ${businessName}`,
      now
    );

    logActivity({
      actor: req.auth!.actorUser,
      targetTenantUid: uid,
      action: 'ADMIN_CREATED_USER',
      entityType: 'user',
      entityId: uid,
      summary: `Drona Admin provisioned business account for ${businessName} (${email})`,
    });
  })();

  const user = mapUserRow(db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as never);
  res.status(201).json({ user });
});

apiRouter.get('/admin/users/:uid', requireAuth, requireSuperAdmin, (req, res) => {
  const uid = String(req.params.uid);
  const userRow = db.prepare(`SELECT * FROM users WHERE uid = ? AND role = 'business'`).get(uid) as never;
  if (!userRow) {
    res.status(404).json({ error: 'Business account not found' });
    return;
  }
  const user = mapUserRow(userRow);
  const profile = getBusinessProfile(uid);
  const invoices = listInvoices(uid);
  const quotations = listQuotations(uid);
  const analytics = getCustomerDashboardAnalytics(uid, 'all');
  const logs = listActivityLogs(50, uid);

  res.json({ user, profile, invoices, quotations, analytics, logs });
});

apiRouter.put('/admin/users/:uid', requireAuth, requireSuperAdmin, (req, res) => {
  const uid = String(req.params.uid);
  const existing = db.prepare(`SELECT * FROM users WHERE uid = ? AND role = 'business'`).get(uid) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Business account not found' });
    return;
  }

  const businessName = sanitizeStr(req.body?.businessName ?? existing.business_name, 160);
  const ownerName = sanitizeStr(req.body?.ownerName ?? existing.owner_name, 120);
  const phone = sanitizeStr(req.body?.phone ?? existing.phone, 32);
  const gstin = sanitizeStr(req.body?.gstin ?? existing.gstin, 20).toUpperCase();
  const subscriptionPlan = sanitizeStr(req.body?.subscriptionPlan ?? existing.subscription_plan, 40);
  const subscriptionAmount = Math.max(0, Math.round(Number(req.body?.subscriptionAmount ?? existing.subscription_amount)));

  if (gstin && !isValidGstin(gstin)) {
    res.status(400).json({ error: 'Invalid GSTIN format' });
    return;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET business_name = ?, owner_name = ?, phone = ?, gstin = ?, subscription_plan = ?, subscription_amount = ?, updated_at = ?
      WHERE uid = ?
    `).run(businessName, ownerName, phone, gstin, subscriptionPlan, subscriptionAmount, now, uid);

    db.prepare(`
      UPDATE business_profiles SET business_name = ?, owner_name = ?, phone = ?, gstin = ?, updated_at = ?
      WHERE user_uid = ?
    `).run(businessName, ownerName, phone, gstin, now, uid);

    logActivity({
      actor: req.auth!.actorUser,
      targetTenantUid: uid,
      action: 'ADMIN_UPDATED_USER',
      entityType: 'user',
      entityId: uid,
      summary: `Drona Admin updated profile for ${businessName}`,
    });
  })();

  const updated = mapUserRow(db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as never);
  res.json({ user: updated });
});

apiRouter.post('/admin/users/:uid/status', requireAuth, requireSuperAdmin, (req, res) => {
  const uid = String(req.params.uid);
  const status = req.body?.status === 'inactive' ? 'inactive' : req.body?.status === 'active' ? 'active' : null;
  if (!status) {
    res.status(400).json({ error: 'Status must be active or inactive' });
    return;
  }

  const user = db.prepare(`SELECT uid, business_name FROM users WHERE uid = ? AND role = 'business'`).get(uid) as
    | { uid: string; business_name: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'Business account not found' });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE uid = ?').run(
      status,
      new Date().toISOString(),
      uid
    );
    if (status === 'inactive') {
      db.prepare('UPDATE sessions SET revoked = 1 WHERE user_uid = ?').run(uid);
    }
    logActivity({
      actor: req.auth!.actorUser,
      targetTenantUid: uid,
      action: status === 'active' ? 'ADMIN_ACTIVATED_USER' : 'ADMIN_DEACTIVATED_USER',
      entityType: 'user',
      entityId: uid,
      summary: `Drona Admin marked ${user.business_name} as ${status}`,
    });
  })();

  res.json({ ok: true, status });
});

apiRouter.post('/admin/users/:uid/reset-password', requireAuth, requireSuperAdmin, (req, res) => {
  const uid = String(req.params.uid);
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  const user = db.prepare(`SELECT uid, business_name FROM users WHERE uid = ? AND role = 'business'`).get(uid) as
    | { uid: string; business_name: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'Business account not found' });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?').run(
      hashPassword(newPassword),
      new Date().toISOString(),
      uid
    );
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_uid = ?').run(uid);
    logActivity({
      actor: req.auth!.actorUser,
      targetTenantUid: uid,
      action: 'ADMIN_RESET_PASSWORD',
      entityType: 'user',
      entityId: uid,
      summary: `Drona Admin reset password for ${user.business_name}`,
    });
  })();

  res.json({ ok: true });
});

// Secure Admin Impersonation ("Login as Customer")
apiRouter.post('/admin/impersonate/:uid', requireAuth, requireSuperAdmin, rateLimit(20, 60_000), (req, res) => {
  const targetUid = String(req.params.uid);
  const targetRow = db
    .prepare(`SELECT * FROM users WHERE uid = ? AND role = 'business'`)
    .get(targetUid) as Record<string, unknown> | undefined;

  if (!targetRow) {
    res.status(404).json({ error: 'Target business workspace not found' });
    return;
  }

  const targetUser = mapUserRow(targetRow as never);
  const impId = generateId('imp');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(); // 2h short-lived session

  db.transaction(() => {
    // End any previous active impersonation attached to this session
    db.prepare(
      `UPDATE impersonation_sessions SET active = 0, ended_at = ? WHERE admin_uid = ? AND active = 1`
    ).run(now.toISOString(), req.auth!.actorUser.uid);

    db.prepare(`
      INSERT INTO impersonation_sessions (id, admin_uid, admin_email, target_uid, target_business_name, started_at, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      impId,
      req.auth!.actorUser.uid,
      req.auth!.actorUser.email,
      targetUser.uid,
      targetUser.businessName,
      now.toISOString(),
      expiresAt
    );

    db.prepare(
      `UPDATE sessions SET impersonating_uid = ?, impersonation_session_id = ? WHERE id = ?`
    ).run(targetUser.uid, impId, req.auth!.sessionId);

    logActivity({
      actor: req.auth!.actorUser,
      targetTenantUid: targetUser.uid,
      impersonationSessionId: impId,
      action: 'IMPERSONATION_STARTED',
      entityType: 'impersonation',
      entityId: impId,
      summary: `Admin ${req.auth!.actorUser.email} entered workspace for ${targetUser.businessName}`,
    });
  })();

  res.json({
    session: {
      actorUser: req.auth!.actorUser,
      effectiveUser: targetUser,
      businessProfile: getBusinessProfile(targetUser.uid),
      isImpersonating: true,
      impersonationSession: {
        id: impId,
        adminUid: req.auth!.actorUser.uid,
        adminEmail: req.auth!.actorUser.email,
        targetUid: targetUser.uid,
        targetBusinessName: targetUser.businessName,
        startedAt: now.toISOString(),
        expiresAt,
        endedAt: null,
        active: true,
      },
    },
  });
});

apiRouter.post('/admin/exit-impersonation', requireAuth, requireSuperAdmin, (req, res) => {
  const impId = req.auth!.impersonationSession?.id;
  const targetUid = req.auth!.isImpersonating ? req.auth!.effectiveUser.uid : null;
  const now = new Date().toISOString();

  db.transaction(() => {
    if (impId) {
      db.prepare('UPDATE impersonation_sessions SET active = 0, ended_at = ? WHERE id = ?').run(
        now,
        impId
      );
    }
    db.prepare(
      'UPDATE sessions SET impersonating_uid = NULL, impersonation_session_id = NULL WHERE id = ?'
    ).run(req.auth!.sessionId);

    if (impId) {
      logActivity({
        actor: req.auth!.actorUser,
        targetTenantUid: targetUid,
        impersonationSessionId: impId,
        action: 'IMPERSONATION_ENDED',
        entityType: 'impersonation',
        entityId: impId,
        summary: `Admin ${req.auth!.actorUser.email} exited customer workspace`,
      });
    }
  })();

  res.json({
    session: {
      actorUser: req.auth!.actorUser,
      effectiveUser: req.auth!.actorUser,
      businessProfile: null,
      isImpersonating: false,
      impersonationSession: null,
    },
  });
});

apiRouter.get('/admin/invoices', requireAuth, requireSuperAdmin, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const rows = db
    .prepare(
      `SELECT i.*, u.business_name AS tenant_business_name
       FROM invoices i
       JOIN users u ON u.uid = i.user_uid
       ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT 300`
    )
    .all() as Array<Record<string, unknown>>;

  const invoices = rows
    .map((r) => {
      const cust = JSON.parse(String(r.customer_snapshot_json)) as { name: string; companyName: string };
      return {
        id: String(r.id),
        userUid: String(r.user_uid),
        tenantBusinessName: String(r.tenant_business_name),
        invoiceNumber: String(r.invoice_number),
        customerName: cust.companyName || cust.name,
        invoiceDate: String(r.invoice_date),
        dueDate: String(r.due_date),
        status: String(r.status),
        grandTotal: fromPaise(Number(r.grand_total_paise)),
        amountPaid: fromPaise(Number(r.amount_paid_paise)),
        balanceDue: fromPaise(Number(r.balance_due_paise)),
      };
    })
    .filter((i) => {
      if (status !== 'all' && i.status !== status) return false;
      if (!search) return true;
      return (
        i.invoiceNumber.toLowerCase().includes(search) ||
        i.tenantBusinessName.toLowerCase().includes(search) ||
        i.customerName.toLowerCase().includes(search)
      );
    });

  res.json({ invoices });
});

apiRouter.get('/admin/quotations', requireAuth, requireSuperAdmin, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const rows = db
    .prepare(
      `SELECT q.*, u.business_name AS tenant_business_name
       FROM quotations q
       JOIN users u ON u.uid = q.user_uid
       ORDER BY q.quotation_date DESC, q.created_at DESC LIMIT 300`
    )
    .all() as Array<Record<string, unknown>>;

  const quotations = rows
    .map((r) => {
      const cust = JSON.parse(String(r.customer_snapshot_json)) as { name: string; companyName: string };
      return {
        id: String(r.id),
        userUid: String(r.user_uid),
        tenantBusinessName: String(r.tenant_business_name),
        quotationNumber: String(r.quotation_number),
        customerName: cust.companyName || cust.name,
        quotationDate: String(r.quotation_date),
        validUntil: String(r.valid_until),
        status: String(r.status),
        grandTotal: fromPaise(Number(r.grand_total_paise)),
      };
    })
    .filter((q) => {
      if (status !== 'all' && q.status !== status) return false;
      if (!search) return true;
      return (
        q.quotationNumber.toLowerCase().includes(search) ||
        q.tenantBusinessName.toLowerCase().includes(search) ||
        q.customerName.toLowerCase().includes(search)
      );
    });

  res.json({ quotations });
});

apiRouter.get('/admin/activity-logs', requireAuth, requireSuperAdmin, (req, res) => {
  const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 150));
  const logs = listActivityLogs(limit);
  res.json({ logs });
});

apiRouter.get('/admin/impersonation-history', requireAuth, requireSuperAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM impersonation_sessions ORDER BY started_at DESC LIMIT 200')
    .all() as Array<Record<string, unknown>>;
  res.json({
    sessions: rows.map((r) => ({
      id: String(r.id),
      adminUid: String(r.admin_uid),
      adminEmail: String(r.admin_email),
      targetUid: String(r.target_uid),
      targetBusinessName: String(r.target_business_name),
      startedAt: String(r.started_at),
      expiresAt: String(r.expires_at),
      endedAt: r.ended_at ? String(r.ended_at) : null,
      active: Boolean(r.active),
    })),
  });
});

apiRouter.get('/admin/settings', requireAuth, requireSuperAdmin, (_req, res) => {
  res.json({ settings: getPlatformSettings() });
});

apiRouter.put('/admin/settings', requireAuth, requireSuperAdmin, (req, res) => {
  const current = getPlatformSettings();
  const next = {
    allowSelfRegistration:
      req.body?.allowSelfRegistration !== undefined
        ? Boolean(req.body.allowSelfRegistration)
        : current.allowSelfRegistration,
    platformName: sanitizeStr(req.body?.platformName ?? current.platformName, 40) || 'DRONA',
    supportEmail: sanitizeStr(req.body?.supportEmail ?? current.supportEmail, 160),
    defaultCurrency: 'INR',
    defaultInvoicePrefix:
      sanitizeStr(req.body?.defaultInvoicePrefix ?? current.defaultInvoicePrefix, 10).toUpperCase() ||
      'INV',
    defaultQuotationPrefix:
      sanitizeStr(req.body?.defaultQuotationPrefix ?? current.defaultQuotationPrefix, 10).toUpperCase() ||
      'QUO',
    defaultSubscriptionMonthly: Math.max(
      0,
      Math.round(Number(req.body?.defaultSubscriptionMonthly ?? current.defaultSubscriptionMonthly))
    ),
    maintenanceMode:
      req.body?.maintenanceMode !== undefined
        ? Boolean(req.body.maintenanceMode)
        : current.maintenanceMode,
    updatedAt: new Date().toISOString(),
  };

  db.transaction(() => {
    db.prepare(`
      UPDATE platform_settings SET
        allow_self_registration = ?, platform_name = ?, support_email = ?, default_currency = ?,
        default_invoice_prefix = ?, default_quotation_prefix = ?, default_subscription_monthly = ?,
        maintenance_mode = ?, updated_at = ?
      WHERE id = 1
    `).run(
      next.allowSelfRegistration ? 1 : 0,
      next.platformName,
      next.supportEmail,
      next.defaultCurrency,
      next.defaultInvoicePrefix,
      next.defaultQuotationPrefix,
      next.defaultSubscriptionMonthly,
      next.maintenanceMode ? 1 : 0,
      next.updatedAt
    );

    logActivity({
      actor: req.auth!.actorUser,
      action: 'PLATFORM_SETTINGS_UPDATED',
      entityType: 'platform_settings',
      summary: 'Updated global DRONA platform settings',
    });
  })();

  res.json({ settings: next });
});
