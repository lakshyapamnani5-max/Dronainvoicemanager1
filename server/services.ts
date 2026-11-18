import { db } from './db.ts';
import { generateId } from './cryptoUtils.ts';
import { mapUserRow, type AuthContext } from './auth.ts';
import {
  computeDocumentTotals,
  fromPaise,
  toPaise,
} from '../src/shared/gstCalculator.ts';
import { isValidGstin } from '../src/shared/indianStates.ts';
import type {
  ActivityLog,
  AdminDashboardData,
  BusinessProfile,
  BusinessSnapshot,
  ComputedLineItem,
  Customer,
  CustomerAnalyticsData,
  CustomerSnapshot,
  Invoice,
  InvoiceStatus,
  LineItemInput,
  NotificationItem,
  OutstandingReportRow,
  Payment,
  PaymentMethod,
  PlatformSettings,
  Quotation,
  QuotationStatus,
  TaxPricingMode,
  TaxSupplyMode,
  TemplateId,
  UserRecord,
} from '../src/shared/types.ts';

export function sanitizeStr(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(dateIso: string, days: number): string {
  const base = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return todayISO();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function logActivity(params: {
  actor: UserRecord;
  targetTenantUid?: string | null;
  impersonationSessionId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}): void {
  db.prepare(`
    INSERT INTO activity_logs (
      id, actor_uid, actor_email, actor_role, target_tenant_uid,
      impersonation_session_id, action, entity_type, entity_id, summary, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId('log'),
    params.actor.uid,
    params.actor.email,
    params.actor.role,
    params.targetTenantUid ?? null,
    params.impersonationSessionId ?? null,
    params.action,
    params.entityType,
    params.entityId ?? null,
    params.summary,
    JSON.stringify(params.metadata ?? {}),
    new Date().toISOString()
  );
}

export function createNotification(params: {
  userUid: string;
  type: NotificationItem['type'];
  title: string;
  message: string;
  entityType?: NotificationItem['entityType'];
  entityId?: string | null;
}): void {
  db.prepare(`
    INSERT INTO notifications (
      id, user_uid, type, title, message, entity_type, entity_id,
      is_read, email_status, whatsapp_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'not_configured', 'not_configured', ?)
  `).run(
    generateId('ntf'),
    params.userUid,
    params.type,
    params.title,
    params.message,
    params.entityType ?? null,
    params.entityId ?? null,
    new Date().toISOString()
  );
}

export function allocateDocumentNumber(
  userUid: string,
  docType: 'INV' | 'QUO' | 'RCP',
  prefix: string,
  dateStr: string
): string {
  const parsedYear = Number(dateStr.slice(0, 4));
  const year = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
    ? parsedYear
    : new Date().getFullYear();

  const existing = db
    .prepare('SELECT last_seq FROM document_counters WHERE user_uid = ? AND doc_type = ? AND year = ?')
    .get(userUid, docType, year) as { last_seq: number } | undefined;

  const nextSeq = existing ? existing.last_seq + 1 : 1;
  if (existing) {
    db.prepare(
      'UPDATE document_counters SET last_seq = ? WHERE user_uid = ? AND doc_type = ? AND year = ?'
    ).run(nextSeq, userUid, docType, year);
  } else {
    db.prepare(
      'INSERT INTO document_counters (user_uid, doc_type, year, last_seq) VALUES (?, ?, ?, ?)'
    ).run(userUid, docType, year, nextSeq);
  }

  const cleanPrefix = (prefix || docType).replace(/[^A-Za-z0-9_-]/g, '').toUpperCase() || docType;
  return `${cleanPrefix}-${year}-${String(nextSeq).padStart(4, '0')}`;
}

export function getPlatformSettings(): PlatformSettings {
  const row = db.prepare('SELECT * FROM platform_settings WHERE id = 1').get() as {
    allow_self_registration: number;
    platform_name: string;
    support_email: string;
    default_currency: string;
    default_invoice_prefix: string;
    default_quotation_prefix: string;
    default_subscription_monthly: number;
    maintenance_mode: number;
    updated_at: string;
  };
  return {
    allowSelfRegistration: Boolean(row.allow_self_registration),
    platformName: row.platform_name,
    supportEmail: row.support_email,
    defaultCurrency: row.default_currency,
    defaultInvoicePrefix: row.default_invoice_prefix,
    defaultQuotationPrefix: row.default_quotation_prefix,
    defaultSubscriptionMonthly: row.default_subscription_monthly,
    maintenanceMode: Boolean(row.maintenance_mode),
    updatedAt: row.updated_at,
  };
}

export function getBusinessProfile(userUid: string): BusinessProfile | null {
  const row = db
    .prepare('SELECT * FROM business_profiles WHERE user_uid = ?')
    .get(userUid) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    userUid: String(row.user_uid),
    businessName: String(row.business_name),
    ownerName: String(row.owner_name),
    logoDataUrl: String(row.logo_data_url || ''),
    address: String(row.address || ''),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    gstin: String(row.gstin || ''),
    pan: String(row.pan || ''),
    state: String(row.state || 'Maharashtra'),
    bankName: String(row.bank_name || ''),
    accountNumber: String(row.account_number || ''),
    ifsc: String(row.ifsc || ''),
    upiId: String(row.upi_id || ''),
    upiQrDataUrl: String(row.upi_qr_data_url || ''),
    invoicePrefix: String(row.invoice_prefix || 'INV'),
    quotationPrefix: String(row.quotation_prefix || 'QUO'),
    defaultIsGst: Boolean(row.default_is_gst),
    defaultTaxRate: Number(row.default_tax_rate ?? 18),
    defaultTaxMode: (row.default_tax_mode as TaxPricingMode) || 'exclusive',
    defaultPaymentTermsDays: Number(row.default_payment_terms_days ?? 15),
    defaultInvoiceTemplate: (row.default_invoice_template as TemplateId) || 'classic_gst',
    defaultQuotationTemplate: (row.default_quotation_template as TemplateId) || 'classic_gst',
    termsAndConditions: String(row.terms_and_conditions || ''),
    signatureLabel: String(row.signature_label || 'Authorized Signatory'),
    updatedAt: String(row.updated_at),
  };
}

export function updateBusinessProfile(
  auth: AuthContext,
  payload: Partial<BusinessProfile>
): BusinessProfile {
  const tenantUid = auth.effectiveUser.uid;
  const current = getBusinessProfile(tenantUid);
  if (!current) {
    throw new Error('Business profile not found');
  }

  const gstin = sanitizeStr(payload.gstin ?? current.gstin, 20).toUpperCase();
  if (gstin && !isValidGstin(gstin)) {
    throw new Error('Invalid GSTIN format (expected 15-character GSTIN)');
  }

  const updated: BusinessProfile = {
    ...current,
    businessName: sanitizeStr(payload.businessName ?? current.businessName, 160) || current.businessName,
    ownerName: sanitizeStr(payload.ownerName ?? current.ownerName, 120) || current.ownerName,
    logoDataUrl: typeof payload.logoDataUrl === 'string' ? payload.logoDataUrl.slice(0, 350000) : current.logoDataUrl,
    address: sanitizeStr(payload.address ?? current.address, 400),
    email: sanitizeStr(payload.email ?? current.email, 160),
    phone: sanitizeStr(payload.phone ?? current.phone, 32),
    gstin,
    pan: sanitizeStr(payload.pan ?? current.pan, 16).toUpperCase(),
    state: sanitizeStr(payload.state ?? current.state, 64) || current.state,
    bankName: sanitizeStr(payload.bankName ?? current.bankName, 120),
    accountNumber: sanitizeStr(payload.accountNumber ?? current.accountNumber, 40),
    ifsc: sanitizeStr(payload.ifsc ?? current.ifsc, 20).toUpperCase(),
    upiId: sanitizeStr(payload.upiId ?? current.upiId, 100),
    upiQrDataUrl: typeof payload.upiQrDataUrl === 'string' ? payload.upiQrDataUrl.slice(0, 350000) : current.upiQrDataUrl,
    invoicePrefix: sanitizeStr(payload.invoicePrefix ?? current.invoicePrefix, 12).toUpperCase() || 'INV',
    quotationPrefix: sanitizeStr(payload.quotationPrefix ?? current.quotationPrefix, 12).toUpperCase() || 'QUO',
    defaultIsGst: payload.defaultIsGst !== undefined ? Boolean(payload.defaultIsGst) : current.defaultIsGst,
    defaultTaxRate: payload.defaultTaxRate !== undefined ? Math.min(28, Math.max(0, Number(payload.defaultTaxRate) || 0)) : current.defaultTaxRate,
    defaultTaxMode: payload.defaultTaxMode === 'inclusive' ? 'inclusive' : payload.defaultTaxMode === 'exclusive' ? 'exclusive' : current.defaultTaxMode,
    defaultPaymentTermsDays: payload.defaultPaymentTermsDays !== undefined ? Math.min(365, Math.max(0, Math.round(Number(payload.defaultPaymentTermsDays) || 0))) : current.defaultPaymentTermsDays,
    defaultInvoiceTemplate: (payload.defaultInvoiceTemplate && ['classic_gst', 'executive_minimal', 'compact_commercial'].includes(payload.defaultInvoiceTemplate))
      ? payload.defaultInvoiceTemplate
      : current.defaultInvoiceTemplate,
    defaultQuotationTemplate: (payload.defaultQuotationTemplate && ['classic_gst', 'executive_minimal', 'compact_commercial'].includes(payload.defaultQuotationTemplate))
      ? payload.defaultQuotationTemplate
      : current.defaultQuotationTemplate,
    termsAndConditions: sanitizeStr(payload.termsAndConditions ?? current.termsAndConditions, 1500),
    signatureLabel: sanitizeStr(payload.signatureLabel ?? current.signatureLabel, 120) || 'Authorized Signatory',
    updatedAt: new Date().toISOString(),
  };

  db.transaction(() => {
    db.prepare(`
      UPDATE business_profiles SET
        business_name = ?, owner_name = ?, logo_data_url = ?, address = ?, email = ?, phone = ?,
        gstin = ?, pan = ?, state = ?, bank_name = ?, account_number = ?, ifsc = ?, upi_id = ?,
        upi_qr_data_url = ?, invoice_prefix = ?, quotation_prefix = ?, default_is_gst = ?,
        default_tax_rate = ?, default_tax_mode = ?, default_payment_terms_days = ?,
        default_invoice_template = ?, default_quotation_template = ?, terms_and_conditions = ?,
        signature_label = ?, updated_at = ?
      WHERE user_uid = ?
    `).run(
      updated.businessName,
      updated.ownerName,
      updated.logoDataUrl,
      updated.address,
      updated.email,
      updated.phone,
      updated.gstin,
      updated.pan,
      updated.state,
      updated.bankName,
      updated.accountNumber,
      updated.ifsc,
      updated.upiId,
      updated.upiQrDataUrl,
      updated.invoicePrefix,
      updated.quotationPrefix,
      updated.defaultIsGst ? 1 : 0,
      updated.defaultTaxRate,
      updated.defaultTaxMode,
      updated.defaultPaymentTermsDays,
      updated.defaultInvoiceTemplate,
      updated.defaultQuotationTemplate,
      updated.termsAndConditions,
      updated.signatureLabel,
      updated.updatedAt,
      tenantUid
    );

    db.prepare(`
      UPDATE users SET business_name = ?, owner_name = ?, phone = ?, gstin = ?, updated_at = ?
      WHERE uid = ?
    `).run(updated.businessName, updated.ownerName, updated.phone, updated.gstin, updated.updatedAt, tenantUid);

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'BUSINESS_PROFILE_UPDATED',
      entityType: 'business_profile',
      entityId: tenantUid,
      summary: `Updated business profile & preferences for ${updated.businessName}`,
    });
  })();

  return updated;
}

export function syncOverdueInvoices(tenantUid?: string): void {
  const today = todayISO();
  const sql = tenantUid
    ? `SELECT id, user_uid, invoice_number, customer_snapshot_json FROM invoices
       WHERE user_uid = ? AND status IN ('unpaid', 'partially_paid') AND due_date < ? AND balance_due_paise > 0`
    : `SELECT id, user_uid, invoice_number, customer_snapshot_json FROM invoices
       WHERE status IN ('unpaid', 'partially_paid') AND due_date < ? AND balance_due_paise > 0`;

  const overdueRows = (tenantUid
    ? db.prepare(sql).all(tenantUid, today)
    : db.prepare(sql).all(today)) as Array<{
    id: string;
    user_uid: string;
    invoice_number: string;
    customer_snapshot_json: string;
  }>;

  if (overdueRows.length === 0) return;

  db.transaction(() => {
    for (const row of overdueRows) {
      db.prepare(`UPDATE invoices SET status = 'overdue', updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        row.id
      );

      const existsNtf = db
        .prepare(
          `SELECT id FROM notifications WHERE user_uid = ? AND type = 'invoice_overdue' AND entity_id = ?`
        )
        .get(row.user_uid, row.id);
      if (!existsNtf) {
        const cust = JSON.parse(row.customer_snapshot_json) as CustomerSnapshot;
        createNotification({
          userUid: row.user_uid,
          type: 'invoice_overdue',
          title: 'Invoice overdue',
          message: `Invoice ${row.invoice_number} for ${cust.companyName || cust.name} is past due.`,
          entityType: 'invoice',
          entityId: row.id,
        });
      }
    }
  })();
}

export function syncExpiredQuotations(tenantUid?: string): void {
  const today = todayISO();
  const sql = tenantUid
    ? `SELECT id, user_uid, quotation_number, valid_until FROM quotations
       WHERE user_uid = ? AND status = 'sent' AND valid_until < ?`
    : `SELECT id, user_uid, quotation_number, valid_until FROM quotations
       WHERE status = 'sent' AND valid_until < ?`;

  const rows = (tenantUid
    ? db.prepare(sql).all(tenantUid, today)
    : db.prepare(sql).all(today)) as Array<{
    id: string;
    user_uid: string;
    quotation_number: string;
    valid_until: string;
  }>;

  if (rows.length > 0) {
    db.transaction(() => {
      for (const r of rows) {
        db.prepare(`UPDATE quotations SET status = 'expired', updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          r.id
        );
      }
    })();
  }

  // Also notify on quotations expiring within 3 days
  const soonDate = addDaysISO(today, 3);
  const expiringSql = tenantUid
    ? `SELECT id, user_uid, quotation_number, valid_until FROM quotations
       WHERE user_uid = ? AND status = 'sent' AND valid_until >= ? AND valid_until <= ?`
    : `SELECT id, user_uid, quotation_number, valid_until FROM quotations
       WHERE status = 'sent' AND valid_until >= ? AND valid_until <= ?`;
  const expiring = (tenantUid
    ? db.prepare(expiringSql).all(tenantUid, today, soonDate)
    : db.prepare(expiringSql).all(today, soonDate)) as Array<{
    id: string;
    user_uid: string;
    quotation_number: string;
    valid_until: string;
  }>;

  for (const q of expiring) {
    const exists = db
      .prepare(`SELECT id FROM notifications WHERE user_uid = ? AND type = 'quotation_expiring' AND entity_id = ?`)
      .get(q.user_uid, q.id);
    if (!exists) {
      createNotification({
        userUid: q.user_uid,
        type: 'quotation_expiring',
        title: 'Quotation expiring soon',
        message: `Quotation ${q.quotation_number} expires on ${q.valid_until}.`,
        entityType: 'quotation',
        entityId: q.id,
      });
    }
  }
}

export function listCustomers(
  tenantUid: string,
  opts?: { search?: string; includeArchived?: boolean }
): Customer[] {
  syncOverdueInvoices(tenantUid);
  const includeArchived = opts?.includeArchived ? 1 : 0;
  const rows = db
    .prepare(
      `SELECT c.*,
        COALESCE((SELECT SUM(grand_total_paise) FROM invoices i WHERE i.customer_id = c.id AND i.user_uid = c.user_uid AND i.status NOT IN ('draft', 'cancelled')), 0) AS total_sales_paise,
        COALESCE((SELECT SUM(amount_paid_paise) FROM invoices i WHERE i.customer_id = c.id AND i.user_uid = c.user_uid AND i.status NOT IN ('draft', 'cancelled')), 0) AS total_paid_paise,
        COALESCE((SELECT SUM(balance_due_paise) FROM invoices i WHERE i.customer_id = c.id AND i.user_uid = c.user_uid AND i.status NOT IN ('draft', 'cancelled')), 0) AS outstanding_paise,
        COALESCE((SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.user_uid = c.user_uid), 0) AS invoice_count,
        COALESCE((SELECT COUNT(*) FROM quotations q WHERE q.customer_id = c.id AND q.user_uid = c.user_uid), 0) AS quotation_count
       FROM customers c
       WHERE c.user_uid = ? AND (? = 1 OR c.archived = 0)
       ORDER BY c.created_at DESC`
    )
    .all(tenantUid, includeArchived) as Array<Record<string, unknown>>;

  const search = (opts?.search || '').trim().toLowerCase();
  return rows
    .map((r) => ({
      id: String(r.id),
      userUid: String(r.user_uid),
      name: String(r.name),
      companyName: String(r.company_name || ''),
      email: String(r.email || ''),
      phone: String(r.phone || ''),
      gstin: String(r.gstin || ''),
      billingAddress: String(r.billing_address || ''),
      shippingAddress: String(r.shipping_address || ''),
      state: String(r.state || 'Maharashtra'),
      notes: String(r.notes || ''),
      archived: Boolean(r.archived),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      totalSales: fromPaise(Number(r.total_sales_paise || 0)),
      totalPaid: fromPaise(Number(r.total_paid_paise || 0)),
      outstandingBalance: fromPaise(Number(r.outstanding_paise || 0)),
      invoiceCount: Number(r.invoice_count || 0),
      quotationCount: Number(r.quotation_count || 0),
    }))
    .filter((c) => {
      if (!search) return true;
      return (
        c.name.toLowerCase().includes(search) ||
        c.companyName.toLowerCase().includes(search) ||
        c.email.toLowerCase().includes(search) ||
        c.phone.toLowerCase().includes(search) ||
        c.gstin.toLowerCase().includes(search)
      );
    });
}

export function createCustomer(auth: AuthContext, input: Partial<Customer>): Customer {
  const tenantUid = auth.effectiveUser.uid;
  const name = sanitizeStr(input.name, 140);
  if (!name) throw new Error('Customer name is required');
  const gstin = sanitizeStr(input.gstin, 20).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new Error('Invalid customer GSTIN format');

  const id = generateId('cus');
  const now = new Date().toISOString();
  const state = sanitizeStr(input.state, 64) || 'Maharashtra';

  db.transaction(() => {
    db.prepare(`
      INSERT INTO customers (
        id, user_uid, name, company_name, email, phone, gstin,
        billing_address, shipping_address, state, notes, archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      tenantUid,
      name,
      sanitizeStr(input.companyName, 160),
      sanitizeStr(input.email, 160),
      sanitizeStr(input.phone, 32),
      gstin,
      sanitizeStr(input.billingAddress, 400),
      sanitizeStr(input.shippingAddress || input.billingAddress, 400),
      state,
      sanitizeStr(input.notes, 1000),
      now,
      now
    );

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: id,
      summary: `Added customer ${input.companyName || name}`,
    });
  })();

  const created = listCustomers(tenantUid, { includeArchived: true }).find((c) => c.id === id);
  if (!created) throw new Error('Failed to retrieve created customer');
  return created;
}

export function updateCustomer(
  auth: AuthContext,
  customerId: string,
  input: Partial<Customer>
): Customer {
  const tenantUid = auth.effectiveUser.uid;
  const existing = db
    .prepare('SELECT * FROM customers WHERE id = ? AND user_uid = ?')
    .get(customerId, tenantUid) as Record<string, unknown> | undefined;
  if (!existing) throw new Error('Customer not found');

  const name = sanitizeStr(input.name ?? existing.name, 140);
  if (!name) throw new Error('Customer name is required');
  const gstin = sanitizeStr(input.gstin ?? existing.gstin, 20).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw new Error('Invalid customer GSTIN format');

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE customers SET
        name = ?, company_name = ?, email = ?, phone = ?, gstin = ?,
        billing_address = ?, shipping_address = ?, state = ?, notes = ?,
        archived = ?, updated_at = ?
      WHERE id = ? AND user_uid = ?
    `).run(
      name,
      sanitizeStr(input.companyName ?? existing.company_name, 160),
      sanitizeStr(input.email ?? existing.email, 160),
      sanitizeStr(input.phone ?? existing.phone, 32),
      gstin,
      sanitizeStr(input.billingAddress ?? existing.billing_address, 400),
      sanitizeStr(input.shippingAddress ?? existing.shipping_address, 400),
      sanitizeStr(input.state ?? existing.state, 64) || 'Maharashtra',
      sanitizeStr(input.notes ?? existing.notes, 1000),
      input.archived !== undefined ? (input.archived ? 1 : 0) : Number(existing.archived),
      now,
      customerId,
      tenantUid
    );

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: customerId,
      summary: `Updated customer ${name}`,
    });
  })();

  const updated = listCustomers(tenantUid, { includeArchived: true }).find((c) => c.id === customerId);
  if (!updated) throw new Error('Customer not found after update');
  return updated;
}

export function archiveOrDeleteCustomer(auth: AuthContext, customerId: string): { archived: boolean } {
  const tenantUid = auth.effectiveUser.uid;
  const existing = db
    .prepare('SELECT id, name FROM customers WHERE id = ? AND user_uid = ?')
    .get(customerId, tenantUid) as { id: string; name: string } | undefined;
  if (!existing) throw new Error('Customer not found');

  // Preserve historical financial integrity: always archive if customer has invoices/quotations/payments
  const invCount = (db
    .prepare('SELECT COUNT(*) as c FROM invoices WHERE customer_id = ? AND user_uid = ?')
    .get(customerId, tenantUid) as { c: number }).c;
  const quoCount = (db
    .prepare('SELECT COUNT(*) as c FROM quotations WHERE customer_id = ? AND user_uid = ?')
    .get(customerId, tenantUid) as { c: number }).c;

  db.transaction(() => {
    if (invCount > 0 || quoCount > 0) {
      db.prepare('UPDATE customers SET archived = 1, updated_at = ? WHERE id = ? AND user_uid = ?').run(
        new Date().toISOString(),
        customerId,
        tenantUid
      );
      logActivity({
        actor: auth.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: auth.impersonationSession?.id,
        action: 'CUSTOMER_ARCHIVED',
        entityType: 'customer',
        entityId: customerId,
        summary: `Archived customer ${existing.name} (historical documents preserved)`,
      });
    } else {
      db.prepare('DELETE FROM customers WHERE id = ? AND user_uid = ?').run(customerId, tenantUid);
      logActivity({
        actor: auth.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: auth.impersonationSession?.id,
        action: 'CUSTOMER_DELETED',
        entityType: 'customer',
        entityId: customerId,
        summary: `Deleted customer ${existing.name}`,
      });
    }
  })();

  return { archived: invCount > 0 || quoCount > 0 };
}

function mapLineItemRows(rows: Array<Record<string, unknown>>): ComputedLineItem[] {
  return rows.map((r) => ({
    id: String(r.id),
    sortOrder: Number(r.sort_order),
    name: String(r.name),
    description: String(r.description || ''),
    hsnSac: String(r.hsn_sac || ''),
    quantity: Number(r.quantity),
    unit: String(r.unit || 'Nos'),
    rate: fromPaise(Number(r.rate_paise)),
    discountType: (r.discount_type as 'percent' | 'fixed') || 'percent',
    discountValue: Number(r.discount_value || 0),
    taxRate: Number(r.tax_rate || 0),
    grossAmount: fromPaise(Number(r.gross_paise)),
    discountAmount: fromPaise(Number(r.discount_paise)),
    taxableAmount: fromPaise(Number(r.taxable_paise)),
    cgstAmount: fromPaise(Number(r.cgst_paise)),
    sgstAmount: fromPaise(Number(r.sgst_paise)),
    igstAmount: fromPaise(Number(r.igst_paise)),
    taxAmount: fromPaise(Number(r.tax_paise)),
    totalAmount: fromPaise(Number(r.total_paise)),
  }));
}

function mapInvoiceRow(row: Record<string, unknown>, items: ComputedLineItem[], payments?: Payment[]): Invoice {
  return {
    id: String(row.id),
    userUid: String(row.user_uid),
    invoiceNumber: String(row.invoice_number),
    status: row.status as InvoiceStatus,
    customerId: String(row.customer_id),
    customerSnapshot: JSON.parse(String(row.customer_snapshot_json)) as CustomerSnapshot,
    businessSnapshot: JSON.parse(String(row.business_snapshot_json)) as BusinessSnapshot,
    invoiceDate: String(row.invoice_date),
    dueDate: String(row.due_date),
    paymentTerms: String(row.payment_terms || ''),
    referenceNumber: String(row.reference_number || ''),
    placeOfSupply: String(row.place_of_supply || ''),
    isGst: Boolean(row.is_gst),
    taxMode: (row.tax_mode as TaxPricingMode) || 'exclusive',
    taxSupplyMode: (row.tax_supply_mode as TaxSupplyMode) || 'auto',
    isInterState: Boolean(row.is_inter_state),
    roundOffEnabled: Boolean(row.round_off_enabled),
    subtotal: fromPaise(Number(row.subtotal_paise)),
    totalDiscount: fromPaise(Number(row.discount_paise)),
    taxableAmount: fromPaise(Number(row.taxable_paise)),
    cgstTotal: fromPaise(Number(row.cgst_paise)),
    sgstTotal: fromPaise(Number(row.sgst_paise)),
    igstTotal: fromPaise(Number(row.igst_paise)),
    totalTax: fromPaise(Number(row.total_tax_paise)),
    roundOff: fromPaise(Number(row.round_off_paise)),
    grandTotal: fromPaise(Number(row.grand_total_paise)),
    amountPaid: fromPaise(Number(row.amount_paid_paise)),
    balanceDue: fromPaise(Number(row.balance_due_paise)),
    amountInWords: String(row.amount_in_words || ''),
    templateId: (row.template_id as TemplateId) || 'classic_gst',
    notes: String(row.notes || ''),
    terms: String(row.terms || ''),
    sourceQuotationId: row.source_quotation_id ? String(row.source_quotation_id) : null,
    cancellationReason: row.cancellation_reason ? String(row.cancellation_reason) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items,
    payments,
  };
}

export function listInvoices(
  tenantUid: string,
  filters?: {
    search?: string;
    status?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }
): Invoice[] {
  syncOverdueInvoices(tenantUid);
  let sql = 'SELECT * FROM invoices WHERE user_uid = ?';
  const params: unknown[] = [tenantUid];

  if (filters?.status && filters.status !== 'all') {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.customerId && filters.customerId !== 'all') {
    sql += ' AND customer_id = ?';
    params.push(filters.customerId);
  }
  if (filters?.startDate) {
    sql += ' AND invoice_date >= ?';
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    sql += ' AND invoice_date <= ?';
    params.push(filters.endDate);
  }
  sql += ' ORDER BY invoice_date DESC, created_at DESC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const search = (filters?.search || '').trim().toLowerCase();

  const invoices = rows.map((row) => {
    const items = mapLineItemRows(
      db
        .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC')
        .all(String(row.id)) as Array<Record<string, unknown>>
    );
    return mapInvoiceRow(row, items);
  });

  if (!search) return invoices;
  return invoices.filter(
    (inv) =>
      inv.invoiceNumber.toLowerCase().includes(search) ||
      inv.customerSnapshot.name.toLowerCase().includes(search) ||
      inv.customerSnapshot.companyName.toLowerCase().includes(search) ||
      inv.referenceNumber.toLowerCase().includes(search)
  );
}

export function getInvoiceById(tenantUid: string, invoiceId: string): Invoice | null {
  syncOverdueInvoices(tenantUid);
  const row = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND user_uid = ?')
    .get(invoiceId, tenantUid) as Record<string, unknown> | undefined;
  if (!row) return null;

  const items = mapLineItemRows(
    db
      .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC')
      .all(invoiceId) as Array<Record<string, unknown>>
  );

  const payRows = db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? AND user_uid = ? ORDER BY payment_date DESC, created_at DESC')
    .all(invoiceId, tenantUid) as Array<Record<string, unknown>>;

  const cust = JSON.parse(String(row.customer_snapshot_json)) as CustomerSnapshot;
  const payments: Payment[] = payRows.map((p) => ({
    id: String(p.id),
    userUid: String(p.user_uid),
    invoiceId: String(p.invoice_id),
    invoiceNumber: String(row.invoice_number),
    customerId: String(p.customer_id),
    customerName: cust.companyName || cust.name,
    paymentDate: String(p.payment_date),
    amount: fromPaise(Number(p.amount_paise)),
    paymentMethod: p.payment_method as PaymentMethod,
    referenceId: String(p.reference_id || ''),
    notes: String(p.notes || ''),
    receiptNumber: String(p.receipt_number),
    createdAt: String(p.created_at),
  }));

  return mapInvoiceRow(row, items, payments);
}

export interface SaveDocumentInput {
  customerId: string;
  invoiceDate?: string;
  dueDate?: string;
  quotationDate?: string;
  validUntil?: string;
  paymentTerms?: string;
  referenceNumber?: string;
  placeOfSupply?: string;
  isGst: boolean;
  taxMode: TaxPricingMode;
  taxSupplyMode: TaxSupplyMode;
  roundOffEnabled: boolean;
  templateId?: TemplateId;
  notes?: string;
  terms?: string;
  saveAsDraft?: boolean;
  logoDataUrl?: string;
  saveLogoToProfile?: boolean;
  upiId?: string;
  saveUpiToProfile?: boolean;
  items: LineItemInput[];
}

function resolveDocumentLogo(profileLogo: string, inputLogo?: string): string {
  if (inputLogo === undefined) return profileLogo;
  const trimmed = inputLogo.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('data:image/')) {
    throw new Error('Logo must be a valid image data URL');
  }
  if (trimmed.length > 1_500_000) {
    throw new Error('Logo file is too large');
  }
  return trimmed;
}

function buildSnapshots(
  tenantUid: string,
  customerId: string,
  logoOverride?: string,
  upiOverride?: string
): {
  customerSnap: CustomerSnapshot;
  businessSnap: BusinessSnapshot;
  profile: BusinessProfile;
} {
  const profile = getBusinessProfile(tenantUid);
  if (!profile) throw new Error('Business profile not configured');

  const custRow = db
    .prepare('SELECT * FROM customers WHERE id = ? AND user_uid = ?')
    .get(customerId, tenantUid) as Record<string, unknown> | undefined;
  if (!custRow) throw new Error('Selected customer does not belong to this workspace');

  const customerSnap: CustomerSnapshot = {
    id: String(custRow.id),
    name: String(custRow.name),
    companyName: String(custRow.company_name || ''),
    email: String(custRow.email || ''),
    phone: String(custRow.phone || ''),
    gstin: String(custRow.gstin || ''),
    billingAddress: String(custRow.billing_address || ''),
    shippingAddress: String(custRow.shipping_address || ''),
    state: String(custRow.state || 'Maharashtra'),
  };

  const resolvedLogo = resolveDocumentLogo(profile.logoDataUrl, logoOverride);
  const resolvedUpiId = upiOverride !== undefined ? sanitizeStr(upiOverride, 120) : profile.upiId;

  const businessSnap: BusinessSnapshot = {
    businessName: profile.businessName,
    ownerName: profile.ownerName,
    logoDataUrl: resolvedLogo,
    address: profile.address,
    email: profile.email,
    phone: profile.phone,
    gstin: profile.gstin,
    pan: profile.pan,
    state: profile.state,
    bankName: profile.bankName,
    accountNumber: profile.accountNumber,
    ifsc: profile.ifsc,
    upiId: resolvedUpiId,
    upiQrDataUrl: resolvedUpiId ? '' : profile.upiQrDataUrl,
    signatureLabel: profile.signatureLabel,
  };

  return { customerSnap, businessSnap, profile };
}

function validateLineItems(items: LineItemInput[]): LineItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one line item is required');
  }
  return items.map((item, idx) => {
    const name = sanitizeStr(item.name, 160);
    if (!name) throw new Error(`Item #${idx + 1} name is required`);
    const quantity = Number(item.quantity);
    const rate = Number(item.rate);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Item "${name}" must have quantity > 0`);
    }
    if (!Number.isFinite(rate) || rate < 0) {
      throw new Error(`Item "${name}" must have rate >= 0`);
    }
    return {
      name,
      description: sanitizeStr(item.description, 400),
      hsnSac: sanitizeStr(item.hsnSac, 16),
      quantity,
      unit: sanitizeStr(item.unit, 24) || 'Nos',
      rate,
      discountType: item.discountType === 'fixed' ? 'fixed' : 'percent',
      discountValue: Math.max(0, Number(item.discountValue) || 0),
      taxRate: Math.min(28, Math.max(0, Number(item.taxRate) || 0)),
    };
  });
}

export function saveInvoice(
  auth: AuthContext,
  input: SaveDocumentInput,
  existingInvoiceId?: string
): Invoice {
  const tenantUid = auth.effectiveUser.uid;
  const cleanItems = validateLineItems(input.items);
  const { customerSnap, businessSnap, profile } = buildSnapshots(
    tenantUid,
    input.customerId,
    input.logoDataUrl,
    input.upiId
  );

  const invoiceDate = sanitizeStr(input.invoiceDate, 10) || todayISO();
  const dueDate =
    sanitizeStr(input.dueDate, 10) || addDaysISO(invoiceDate, profile.defaultPaymentTermsDays);
  const placeOfSupply = sanitizeStr(input.placeOfSupply, 64) || customerSnap.state || profile.state;

  const calc = computeDocumentTotals({
    items: cleanItems,
    businessState: profile.state,
    placeOfSupply,
    isGst: Boolean(input.isGst),
    taxMode: input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
    taxSupplyMode: ['auto', 'intra', 'inter'].includes(input.taxSupplyMode)
      ? input.taxSupplyMode
      : 'auto',
    roundOffEnabled: input.roundOffEnabled !== false,
  });

  const isDraft = Boolean(input.saveAsDraft);
  const templateId: TemplateId =
    input.templateId && ['classic_gst', 'executive_minimal', 'compact_commercial'].includes(input.templateId)
      ? input.templateId
      : profile.defaultInvoiceTemplate;

  const now = new Date().toISOString();
  let targetId = existingInvoiceId || generateId('inv');

  db.transaction(() => {
    if (input.saveLogoToProfile && input.logoDataUrl !== undefined) {
      db.prepare('UPDATE business_profiles SET logo_data_url = ?, updated_at = ? WHERE user_uid = ?').run(
        businessSnap.logoDataUrl,
        now,
        tenantUid
      );
    }
    if (input.saveUpiToProfile && input.upiId !== undefined) {
      db.prepare('UPDATE business_profiles SET upi_id = ?, updated_at = ? WHERE user_uid = ?').run(
        businessSnap.upiId,
        now,
        tenantUid
      );
    }

    if (existingInvoiceId) {
      const existing = db
        .prepare('SELECT id, status, invoice_number FROM invoices WHERE id = ? AND user_uid = ?')
        .get(existingInvoiceId, tenantUid) as
        | { id: string; status: InvoiceStatus; invoice_number: string }
        | undefined;
      if (!existing) throw new Error('Invoice not found');
      if (existing.status !== 'draft') {
        throw new Error(
          'Finalized invoices are immutable and cannot be edited. Cancel the invoice and issue a replacement instead.'
        );
      }

      let finalNumber = existing.invoice_number;
      let status: InvoiceStatus = 'draft';
      let finalizedAt: string | null = null;

      if (!isDraft) {
        finalNumber = allocateDocumentNumber(tenantUid, 'INV', profile.invoicePrefix, invoiceDate);
        status = dueDate < todayISO() ? 'overdue' : 'unpaid';
        finalizedAt = now;
      }

      db.prepare(`
        UPDATE invoices SET
          invoice_number = ?, status = ?, customer_id = ?, customer_snapshot_json = ?, business_snapshot_json = ?,
          invoice_date = ?, due_date = ?, payment_terms = ?, reference_number = ?, place_of_supply = ?,
          is_gst = ?, tax_mode = ?, tax_supply_mode = ?, is_inter_state = ?, round_off_enabled = ?,
          subtotal_paise = ?, discount_paise = ?, taxable_paise = ?, cgst_paise = ?, sgst_paise = ?,
          igst_paise = ?, total_tax_paise = ?, round_off_paise = ?, grand_total_paise = ?,
          amount_paid_paise = 0, balance_due_paise = ?, amount_in_words = ?, template_id = ?,
          notes = ?, terms = ?, finalized_at = ?, updated_at = ?
        WHERE id = ? AND user_uid = ?
      `).run(
        finalNumber,
        status,
        customerSnap.id,
        JSON.stringify(customerSnap),
        JSON.stringify(businessSnap),
        invoiceDate,
        dueDate,
        sanitizeStr(input.paymentTerms, 64) || `Net ${profile.defaultPaymentTermsDays}`,
        sanitizeStr(input.referenceNumber, 64),
        placeOfSupply,
        input.isGst ? 1 : 0,
        input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
        input.taxSupplyMode || 'auto',
        calc.isInterState ? 1 : 0,
        input.roundOffEnabled !== false ? 1 : 0,
        calc.subtotalPaise,
        calc.totalDiscountPaise,
        calc.taxableAmountPaise,
        calc.cgstTotalPaise,
        calc.sgstTotalPaise,
        calc.igstTotalPaise,
        calc.totalTaxPaise,
        calc.roundOffPaise,
        calc.grandTotalPaise,
        calc.grandTotalPaise,
        calc.amountInWords,
        templateId,
        sanitizeStr(input.notes, 1000),
        sanitizeStr(input.terms ?? profile.termsAndConditions, 1500),
        finalizedAt,
        now,
        existingInvoiceId,
        tenantUid
      );

      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ? AND user_uid = ?').run(
        existingInvoiceId,
        tenantUid
      );

      for (const item of calc.items) {
        db.prepare(`
          INSERT INTO invoice_items (
            id, invoice_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
            rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
            taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId('itm'),
          existingInvoiceId,
          tenantUid,
          item.sortOrder,
          item.name,
          item.description,
          item.hsnSac,
          item.quantity,
          item.unit,
          toPaise(item.rate),
          item.discountType,
          item.discountValue,
          item.taxRate,
          toPaise(item.grossAmount),
          toPaise(item.discountAmount),
          toPaise(item.taxableAmount),
          toPaise(item.cgstAmount),
          toPaise(item.sgstAmount),
          toPaise(item.igstAmount),
          toPaise(item.taxAmount),
          toPaise(item.totalAmount)
        );
      }

      if (!isDraft) {
        createNotification({
          userUid: tenantUid,
          type: 'invoice_created',
          title: 'New invoice generated',
          message: `Invoice ${finalNumber} issued to ${customerSnap.companyName || customerSnap.name}.`,
          entityType: 'invoice',
          entityId: existingInvoiceId,
        });
      }

      logActivity({
        actor: auth.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: auth.impersonationSession?.id,
        action: isDraft ? 'INVOICE_DRAFT_UPDATED' : 'INVOICE_FINALIZED',
        entityType: 'invoice',
        entityId: existingInvoiceId,
        summary: isDraft
          ? `Updated draft invoice ${finalNumber}`
          : `Finalized invoice ${finalNumber} (${calc.grandTotal.toFixed(2)})`,
      });
    } else {
      const invoiceNumber = isDraft
        ? `DRAFT-${generateId().slice(0, 6).toUpperCase()}`
        : allocateDocumentNumber(tenantUid, 'INV', profile.invoicePrefix, invoiceDate);
      const status: InvoiceStatus = isDraft
        ? 'draft'
        : dueDate < todayISO()
          ? 'overdue'
          : 'unpaid';

      db.prepare(`
        INSERT INTO invoices (
          id, user_uid, invoice_number, status, customer_id, customer_snapshot_json, business_snapshot_json,
          invoice_date, due_date, payment_terms, reference_number, place_of_supply, is_gst, tax_mode,
          tax_supply_mode, is_inter_state, round_off_enabled, subtotal_paise, discount_paise, taxable_paise,
          cgst_paise, sgst_paise, igst_paise, total_tax_paise, round_off_paise, grand_total_paise,
          amount_paid_paise, balance_due_paise, amount_in_words, template_id, notes, terms,
          finalized_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetId,
        tenantUid,
        invoiceNumber,
        status,
        customerSnap.id,
        JSON.stringify(customerSnap),
        JSON.stringify(businessSnap),
        invoiceDate,
        dueDate,
        sanitizeStr(input.paymentTerms, 64) || `Net ${profile.defaultPaymentTermsDays}`,
        sanitizeStr(input.referenceNumber, 64),
        placeOfSupply,
        input.isGst ? 1 : 0,
        input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
        input.taxSupplyMode || 'auto',
        calc.isInterState ? 1 : 0,
        input.roundOffEnabled !== false ? 1 : 0,
        calc.subtotalPaise,
        calc.totalDiscountPaise,
        calc.taxableAmountPaise,
        calc.cgstTotalPaise,
        calc.sgstTotalPaise,
        calc.igstTotalPaise,
        calc.totalTaxPaise,
        calc.roundOffPaise,
        calc.grandTotalPaise,
        calc.grandTotalPaise,
        calc.amountInWords,
        templateId,
        sanitizeStr(input.notes, 1000),
        sanitizeStr(input.terms ?? profile.termsAndConditions, 1500),
        isDraft ? null : now,
        now,
        now
      );

      for (const item of calc.items) {
        db.prepare(`
          INSERT INTO invoice_items (
            id, invoice_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
            rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
            taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId('itm'),
          targetId,
          tenantUid,
          item.sortOrder,
          item.name,
          item.description,
          item.hsnSac,
          item.quantity,
          item.unit,
          toPaise(item.rate),
          item.discountType,
          item.discountValue,
          item.taxRate,
          toPaise(item.grossAmount),
          toPaise(item.discountAmount),
          toPaise(item.taxableAmount),
          toPaise(item.cgstAmount),
          toPaise(item.sgstAmount),
          toPaise(item.igstAmount),
          toPaise(item.taxAmount),
          toPaise(item.totalAmount)
        );
      }

      if (!isDraft) {
        createNotification({
          userUid: tenantUid,
          type: 'invoice_created',
          title: 'New invoice generated',
          message: `Invoice ${invoiceNumber} issued to ${customerSnap.companyName || customerSnap.name}.`,
          entityType: 'invoice',
          entityId: targetId,
        });
      }

      logActivity({
        actor: auth.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: auth.impersonationSession?.id,
        action: isDraft ? 'INVOICE_DRAFT_CREATED' : 'INVOICE_CREATED',
        entityType: 'invoice',
        entityId: targetId,
        summary: isDraft
          ? `Saved draft invoice ${invoiceNumber}`
          : `Issued invoice ${invoiceNumber} for INR ${calc.grandTotal.toFixed(2)}`,
      });
    }
  })();

  const inv = getInvoiceById(tenantUid, targetId);
  if (!inv) throw new Error('Invoice retrieval failed');
  return inv;
}

export function finalizeDraftInvoice(auth: AuthContext, invoiceId: string): Invoice {
  const tenantUid = auth.effectiveUser.uid;
  const profile = getBusinessProfile(tenantUid);
  if (!profile) throw new Error('Business profile not configured');

  db.transaction(() => {
    const existing = db
      .prepare('SELECT id, status, invoice_date, due_date, customer_snapshot_json FROM invoices WHERE id = ? AND user_uid = ?')
      .get(invoiceId, tenantUid) as
      | { id: string; status: InvoiceStatus; invoice_date: string; due_date: string; customer_snapshot_json: string }
      | undefined;

    if (!existing) throw new Error('Invoice not found');
    if (existing.status !== 'draft') throw new Error('Only draft invoices can be finalized');

    const officialNumber = allocateDocumentNumber(
      tenantUid,
      'INV',
      profile.invoicePrefix,
      existing.invoice_date
    );
    const nextStatus: InvoiceStatus = existing.due_date < todayISO() ? 'overdue' : 'unpaid';
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE invoices SET invoice_number = ?, status = ?, finalized_at = ?, updated_at = ?
      WHERE id = ? AND user_uid = ?
    `).run(officialNumber, nextStatus, now, now, invoiceId, tenantUid);

    const cust = JSON.parse(existing.customer_snapshot_json) as CustomerSnapshot;
    createNotification({
      userUid: tenantUid,
      type: 'invoice_created',
      title: 'New invoice generated',
      message: `Invoice ${officialNumber} finalized for ${cust.companyName || cust.name}.`,
      entityType: 'invoice',
      entityId: invoiceId,
    });

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'INVOICE_FINALIZED',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `Finalized draft into official invoice ${officialNumber}`,
    });
  })();

  const updated = getInvoiceById(tenantUid, invoiceId);
  if (!updated) throw new Error('Invoice not found');
  return updated;
}

export function cancelInvoice(auth: AuthContext, invoiceId: string, reason: string): Invoice {
  const tenantUid = auth.effectiveUser.uid;
  const cleanReason = sanitizeStr(reason, 300) || 'Cancelled by business user';

  db.transaction(() => {
    const existing = db
      .prepare('SELECT id, invoice_number, status, amount_paid_paise FROM invoices WHERE id = ? AND user_uid = ?')
      .get(invoiceId, tenantUid) as
      | { id: string; invoice_number: string; status: InvoiceStatus; amount_paid_paise: number }
      | undefined;
    if (!existing) throw new Error('Invoice not found');
    if (existing.status === 'cancelled') throw new Error('Invoice is already cancelled');
    if (existing.amount_paid_paise > 0) {
      throw new Error('Cannot cancel an invoice that has recorded payments');
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE invoices SET status = 'cancelled', cancellation_reason = ?, cancelled_at = ?, balance_due_paise = 0, updated_at = ?
      WHERE id = ? AND user_uid = ?
    `).run(cleanReason, now, now, invoiceId, tenantUid);

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'INVOICE_CANCELLED',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `Cancelled invoice ${existing.invoice_number}: ${cleanReason}`,
    });
  })();

  const updated = getInvoiceById(tenantUid, invoiceId);
  if (!updated) throw new Error('Invoice not found');
  return updated;
}

export function deleteInvoice(auth: AuthContext, invoiceId: string) {
  const tenantUid = auth.effectiveUser.uid;
  db.transaction(() => {
    const existing = db
      .prepare('SELECT id, invoice_number FROM invoices WHERE id = ? AND user_uid = ?')
      .get(invoiceId, tenantUid) as { id: string; invoice_number: string } | undefined;
    if (!existing) throw new Error('Invoice not found');

    db.prepare('DELETE FROM invoices WHERE id = ? AND user_uid = ?').run(invoiceId, tenantUid);
    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'INVOICE_DELETED',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `Deleted invoice ${existing.invoice_number}`,
    });
  })();
  return { ok: true };
}

function mapQuotationRow(row: Record<string, unknown>, items: ComputedLineItem[]): Quotation {
  return {
    id: String(row.id),
    userUid: String(row.user_uid),
    quotationNumber: String(row.quotation_number),
    status: row.status as QuotationStatus,
    customerId: String(row.customer_id),
    customerSnapshot: JSON.parse(String(row.customer_snapshot_json)) as CustomerSnapshot,
    businessSnapshot: JSON.parse(String(row.business_snapshot_json)) as BusinessSnapshot,
    quotationDate: String(row.quotation_date),
    validUntil: String(row.valid_until),
    referenceNumber: String(row.reference_number || ''),
    placeOfSupply: String(row.place_of_supply || ''),
    isGst: Boolean(row.is_gst),
    taxMode: (row.tax_mode as TaxPricingMode) || 'exclusive',
    taxSupplyMode: (row.tax_supply_mode as TaxSupplyMode) || 'auto',
    isInterState: Boolean(row.is_inter_state),
    roundOffEnabled: Boolean(row.round_off_enabled),
    subtotal: fromPaise(Number(row.subtotal_paise)),
    totalDiscount: fromPaise(Number(row.discount_paise)),
    taxableAmount: fromPaise(Number(row.taxable_paise)),
    cgstTotal: fromPaise(Number(row.cgst_paise)),
    sgstTotal: fromPaise(Number(row.sgst_paise)),
    igstTotal: fromPaise(Number(row.igst_paise)),
    totalTax: fromPaise(Number(row.total_tax_paise)),
    roundOff: fromPaise(Number(row.round_off_paise)),
    grandTotal: fromPaise(Number(row.grand_total_paise)),
    amountInWords: String(row.amount_in_words || ''),
    templateId: (row.template_id as TemplateId) || 'classic_gst',
    notes: String(row.notes || ''),
    terms: String(row.terms || ''),
    convertedInvoiceId: row.converted_invoice_id ? String(row.converted_invoice_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items,
  };
}

export function listQuotations(
  tenantUid: string,
  filters?: { search?: string; status?: string; customerId?: string; startDate?: string; endDate?: string }
): Quotation[] {
  syncExpiredQuotations(tenantUid);
  let sql = 'SELECT * FROM quotations WHERE user_uid = ?';
  const params: unknown[] = [tenantUid];

  if (filters?.status && filters.status !== 'all') {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.customerId && filters.customerId !== 'all') {
    sql += ' AND customer_id = ?';
    params.push(filters.customerId);
  }
  if (filters?.startDate) {
    sql += ' AND quotation_date >= ?';
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    sql += ' AND quotation_date <= ?';
    params.push(filters.endDate);
  }
  sql += ' ORDER BY quotation_date DESC, created_at DESC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const search = (filters?.search || '').trim().toLowerCase();

  const list = rows.map((row) => {
    const items = mapLineItemRows(
      db
        .prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC')
        .all(String(row.id)) as Array<Record<string, unknown>>
    );
    return mapQuotationRow(row, items);
  });

  if (!search) return list;
  return list.filter(
    (q) =>
      q.quotationNumber.toLowerCase().includes(search) ||
      q.customerSnapshot.name.toLowerCase().includes(search) ||
      q.customerSnapshot.companyName.toLowerCase().includes(search) ||
      q.referenceNumber.toLowerCase().includes(search)
  );
}

export function getQuotationById(tenantUid: string, quotationId: string): Quotation | null {
  syncExpiredQuotations(tenantUid);
  const row = db
    .prepare('SELECT * FROM quotations WHERE id = ? AND user_uid = ?')
    .get(quotationId, tenantUid) as Record<string, unknown> | undefined;
  if (!row) return null;

  const items = mapLineItemRows(
    db
      .prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC')
      .all(quotationId) as Array<Record<string, unknown>>
  );
  return mapQuotationRow(row, items);
}

export function saveQuotation(
  auth: AuthContext,
  input: SaveDocumentInput,
  existingQuotationId?: string
): Quotation {
  const tenantUid = auth.effectiveUser.uid;
  const cleanItems = validateLineItems(input.items);
  const { customerSnap, businessSnap, profile } = buildSnapshots(
    tenantUid,
    input.customerId,
    input.logoDataUrl,
    input.upiId
  );

  const quotationDate = sanitizeStr(input.quotationDate, 10) || todayISO();
  const validUntil = sanitizeStr(input.validUntil, 10) || addDaysISO(quotationDate, 30);
  const placeOfSupply = sanitizeStr(input.placeOfSupply, 64) || customerSnap.state || profile.state;

  const calc = computeDocumentTotals({
    items: cleanItems,
    businessState: profile.state,
    placeOfSupply,
    isGst: Boolean(input.isGst),
    taxMode: input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
    taxSupplyMode: ['auto', 'intra', 'inter'].includes(input.taxSupplyMode)
      ? input.taxSupplyMode
      : 'auto',
    roundOffEnabled: input.roundOffEnabled !== false,
  });

  const isDraft = Boolean(input.saveAsDraft);
  const templateId: TemplateId =
    input.templateId && ['classic_gst', 'executive_minimal', 'compact_commercial'].includes(input.templateId)
      ? input.templateId
      : profile.defaultQuotationTemplate;

  const now = new Date().toISOString();
  const targetId = existingQuotationId || generateId('quo');

  db.transaction(() => {
    if (input.saveLogoToProfile && input.logoDataUrl !== undefined) {
      db.prepare('UPDATE business_profiles SET logo_data_url = ?, updated_at = ? WHERE user_uid = ?').run(
        businessSnap.logoDataUrl,
        now,
        tenantUid
      );
    }
    if (input.saveUpiToProfile && input.upiId !== undefined) {
      db.prepare('UPDATE business_profiles SET upi_id = ?, updated_at = ? WHERE user_uid = ?').run(
        businessSnap.upiId,
        now,
        tenantUid
      );
    }

    if (existingQuotationId) {
      const existing = db
        .prepare('SELECT id, status, quotation_number FROM quotations WHERE id = ? AND user_uid = ?')
        .get(existingQuotationId, tenantUid) as
        | { id: string; status: QuotationStatus; quotation_number: string }
        | undefined;
      if (!existing) throw new Error('Quotation not found');
      if (existing.status !== 'draft') {
        throw new Error('Only draft quotations can be edited');
      }

      const finalNumber = isDraft
        ? existing.quotation_number
        : allocateDocumentNumber(tenantUid, 'QUO', profile.quotationPrefix, quotationDate);
      const status: QuotationStatus = isDraft
        ? 'draft'
        : validUntil < todayISO()
          ? 'expired'
          : 'sent';

      db.prepare(`
        UPDATE quotations SET
          quotation_number = ?, status = ?, customer_id = ?, customer_snapshot_json = ?, business_snapshot_json = ?,
          quotation_date = ?, valid_until = ?, reference_number = ?, place_of_supply = ?, is_gst = ?,
          tax_mode = ?, tax_supply_mode = ?, is_inter_state = ?, round_off_enabled = ?,
          subtotal_paise = ?, discount_paise = ?, taxable_paise = ?, cgst_paise = ?, sgst_paise = ?,
          igst_paise = ?, total_tax_paise = ?, round_off_paise = ?, grand_total_paise = ?,
          amount_in_words = ?, template_id = ?, notes = ?, terms = ?, updated_at = ?
        WHERE id = ? AND user_uid = ?
      `).run(
        finalNumber,
        status,
        customerSnap.id,
        JSON.stringify(customerSnap),
        JSON.stringify(businessSnap),
        quotationDate,
        validUntil,
        sanitizeStr(input.referenceNumber, 64),
        placeOfSupply,
        input.isGst ? 1 : 0,
        input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
        input.taxSupplyMode || 'auto',
        calc.isInterState ? 1 : 0,
        input.roundOffEnabled !== false ? 1 : 0,
        calc.subtotalPaise,
        calc.totalDiscountPaise,
        calc.taxableAmountPaise,
        calc.cgstTotalPaise,
        calc.sgstTotalPaise,
        calc.igstTotalPaise,
        calc.totalTaxPaise,
        calc.roundOffPaise,
        calc.grandTotalPaise,
        calc.amountInWords,
        templateId,
        sanitizeStr(input.notes, 1000),
        sanitizeStr(input.terms ?? profile.termsAndConditions, 1500),
        now,
        existingQuotationId,
        tenantUid
      );

      db.prepare('DELETE FROM quotation_items WHERE quotation_id = ? AND user_uid = ?').run(
        existingQuotationId,
        tenantUid
      );

      for (const item of calc.items) {
        db.prepare(`
          INSERT INTO quotation_items (
            id, quotation_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
            rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
            taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId('qit'),
          existingQuotationId,
          tenantUid,
          item.sortOrder,
          item.name,
          item.description,
          item.hsnSac,
          item.quantity,
          item.unit,
          toPaise(item.rate),
          item.discountType,
          item.discountValue,
          item.taxRate,
          toPaise(item.grossAmount),
          toPaise(item.discountAmount),
          toPaise(item.taxableAmount),
          toPaise(item.cgstAmount),
          toPaise(item.sgstAmount),
          toPaise(item.igstAmount),
          toPaise(item.taxAmount),
          toPaise(item.totalAmount)
        );
      }

      logActivity({
        actor: auth.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: auth.impersonationSession?.id,
        action: isDraft ? 'QUOTATION_DRAFT_UPDATED' : 'QUOTATION_SENT',
        entityType: 'quotation',
        entityId: existingQuotationId,
        summary: `Updated quotation ${finalNumber}`,
      });
    } else {
      const quotationNumber = isDraft
        ? `QDRAFT-${generateId().slice(0, 5).toUpperCase()}`
        : allocateDocumentNumber(tenantUid, 'QUO', profile.quotationPrefix, quotationDate);
      const status: QuotationStatus = isDraft
        ? 'draft'
        : validUntil < todayISO()
          ? 'expired'
          : 'sent';

      db.prepare(`
        INSERT INTO quotations (
          id, user_uid, quotation_number, status, customer_id, customer_snapshot_json, business_snapshot_json,
          quotation_date, valid_until, reference_number, place_of_supply, is_gst, tax_mode, tax_supply_mode,
          is_inter_state, round_off_enabled, subtotal_paise, discount_paise, taxable_paise, cgst_paise,
          sgst_paise, igst_paise, total_tax_paise, round_off_paise, grand_total_paise, amount_in_words,
          template_id, notes, terms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetId,
        tenantUid,
        quotationNumber,
        status,
        customerSnap.id,
        JSON.stringify(customerSnap),
        JSON.stringify(businessSnap),
        quotationDate,
        validUntil,
        sanitizeStr(input.referenceNumber, 64),
        placeOfSupply,
        input.isGst ? 1 : 0,
        input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
        input.taxSupplyMode || 'auto',
        calc.isInterState ? 1 : 0,
        input.roundOffEnabled !== false ? 1 : 0,
        calc.subtotalPaise,
        calc.totalDiscountPaise,
        calc.taxableAmountPaise,
        calc.cgstTotalPaise,
        calc.sgstTotalPaise,
        calc.igstTotalPaise,
        calc.totalTaxPaise,
        calc.roundOffPaise,
        calc.grandTotalPaise,
        calc.amountInWords,
        templateId,
        sanitizeStr(input.notes, 1000),
        sanitizeStr(input.terms ?? profile.termsAndConditions, 1500),
        now,
        now
      );

      for (const item of calc.items) {
        db.prepare(`
          INSERT INTO quotation_items (
            id, quotation_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
            rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
            taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId('qit'),
          targetId,
          tenantUid,
          item.sortOrder,
          item.name,
          item.description,
          item.hsnSac,
          item.quantity,
          item.unit,
          toPaise(item.rate),
          item.discountType,
          item.discountValue,
          item.taxRate,
          toPaise(item.grossAmount),
          toPaise(item.discountAmount),
          toPaise(item.taxableAmount),
          toPaise(item.cgstAmount),
          toPaise(item.sgstAmount),
          toPaise(item.igstAmount),
          toPaise(item.taxAmount),
          toPaise(item.totalAmount)
        );
      }

      logActivity({
        actor: auth.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: auth.impersonationSession?.id,
        action: isDraft ? 'QUOTATION_DRAFT_CREATED' : 'QUOTATION_CREATED',
        entityType: 'quotation',
        entityId: targetId,
        summary: `Created quotation ${quotationNumber} for INR ${calc.grandTotal.toFixed(2)}`,
      });
    }
  })();

  const quo = getQuotationById(tenantUid, targetId);
  if (!quo) throw new Error('Failed to load quotation');
  return quo;
}

export function updateQuotationStatus(
  auth: AuthContext,
  quotationId: string,
  nextStatus: 'sent' | 'accepted' | 'rejected'
): Quotation {
  const tenantUid = auth.effectiveUser.uid;
  const profile = getBusinessProfile(tenantUid);
  if (!profile) throw new Error('Business profile missing');

  db.transaction(() => {
    const existing = db
      .prepare('SELECT id, quotation_number, quotation_date, status, customer_snapshot_json FROM quotations WHERE id = ? AND user_uid = ?')
      .get(quotationId, tenantUid) as
      | { id: string; quotation_number: string; quotation_date: string; status: QuotationStatus; customer_snapshot_json: string }
      | undefined;

    if (!existing) throw new Error('Quotation not found');
    if (existing.status === 'converted') {
      throw new Error('Converted quotation status cannot be modified');
    }

    let numberToUse = existing.quotation_number;
    if (existing.status === 'draft' && nextStatus !== 'rejected') {
      numberToUse = allocateDocumentNumber(
        tenantUid,
        'QUO',
        profile.quotationPrefix,
        existing.quotation_date
      );
    }

    db.prepare('UPDATE quotations SET quotation_number = ?, status = ?, updated_at = ? WHERE id = ? AND user_uid = ?').run(
      numberToUse,
      nextStatus,
      new Date().toISOString(),
      quotationId,
      tenantUid
    );

    if (nextStatus === 'accepted') {
      const cust = JSON.parse(existing.customer_snapshot_json) as CustomerSnapshot;
      createNotification({
        userUid: tenantUid,
        type: 'quotation_accepted',
        title: 'Quotation accepted',
        message: `Quotation ${numberToUse} was accepted by ${cust.companyName || cust.name}.`,
        entityType: 'quotation',
        entityId: quotationId,
      });
    }

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: `QUOTATION_${nextStatus.toUpperCase()}`,
      entityType: 'quotation',
      entityId: quotationId,
      summary: `Marked quotation ${numberToUse} as ${nextStatus}`,
    });
  })();

  const updated = getQuotationById(tenantUid, quotationId);
  if (!updated) throw new Error('Quotation not found');
  return updated;
}

export function convertQuotationToInvoice(auth: AuthContext, quotationId: string): Invoice {
  const tenantUid = auth.effectiveUser.uid;
  const profile = getBusinessProfile(tenantUid);
  if (!profile) throw new Error('Business profile missing');

  let createdInvoiceId = '';

  db.transaction(() => {
    const quo = db
      .prepare('SELECT * FROM quotations WHERE id = ? AND user_uid = ?')
      .get(quotationId, tenantUid) as Record<string, unknown> | undefined;

    if (!quo) throw new Error('Quotation not found');
    if (quo.status === 'converted' || quo.converted_invoice_id) {
      throw new Error('Quotation has already been converted to an invoice');
    }
    if (quo.status === 'rejected' || quo.status === 'expired') {
      throw new Error(`Cannot convert a ${quo.status} quotation`);
    }

    const qItems = db
      .prepare('SELECT * FROM quotation_items WHERE quotation_id = ? AND user_uid = ? ORDER BY sort_order ASC')
      .all(quotationId, tenantUid) as Array<Record<string, unknown>>;

    if (qItems.length === 0) throw new Error('Quotation has no line items');

    const invoiceDate = todayISO();
    const dueDate = addDaysISO(invoiceDate, profile.defaultPaymentTermsDays);
    const invoiceNumber = allocateDocumentNumber(
      tenantUid,
      'INV',
      profile.invoicePrefix,
      invoiceDate
    );
    const now = new Date().toISOString();
    createdInvoiceId = generateId('inv');

    db.prepare(`
      INSERT INTO invoices (
        id, user_uid, invoice_number, status, customer_id, customer_snapshot_json, business_snapshot_json,
        invoice_date, due_date, payment_terms, reference_number, place_of_supply, is_gst, tax_mode,
        tax_supply_mode, is_inter_state, round_off_enabled, subtotal_paise, discount_paise, taxable_paise,
        cgst_paise, sgst_paise, igst_paise, total_tax_paise, round_off_paise, grand_total_paise,
        amount_paid_paise, balance_due_paise, amount_in_words, template_id, notes, terms,
        source_quotation_id, finalized_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createdInvoiceId,
      tenantUid,
      invoiceNumber,
      String(quo.customer_id),
      String(quo.customer_snapshot_json),
      String(quo.business_snapshot_json),
      invoiceDate,
      dueDate,
      `Net ${profile.defaultPaymentTermsDays}`,
      String(quo.reference_number || quo.quotation_number),
      String(quo.place_of_supply || ''),
      Number(quo.is_gst),
      String(quo.tax_mode),
      String(quo.tax_supply_mode),
      Number(quo.is_inter_state),
      Number(quo.round_off_enabled),
      Number(quo.subtotal_paise),
      Number(quo.discount_paise),
      Number(quo.taxable_paise),
      Number(quo.cgst_paise),
      Number(quo.sgst_paise),
      Number(quo.igst_paise),
      Number(quo.total_tax_paise),
      Number(quo.round_off_paise),
      Number(quo.grand_total_paise),
      Number(quo.grand_total_paise),
      String(quo.amount_in_words),
      profile.defaultInvoiceTemplate,
      String(quo.notes || ''),
      String(quo.terms || profile.termsAndConditions),
      quotationId,
      now,
      now,
      now
    );

    for (const item of qItems) {
      db.prepare(`
        INSERT INTO invoice_items (
          id, invoice_id, user_uid, sort_order, name, description, hsn_sac, quantity, unit,
          rate_paise, discount_type, discount_value, tax_rate, gross_paise, discount_paise,
          taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId('itm'),
        createdInvoiceId,
        tenantUid,
        Number(item.sort_order),
        String(item.name),
        String(item.description || ''),
        String(item.hsn_sac || ''),
        Number(item.quantity),
        String(item.unit || 'Nos'),
        Number(item.rate_paise),
        String(item.discount_type),
        Number(item.discount_value),
        Number(item.tax_rate),
        Number(item.gross_paise),
        Number(item.discount_paise),
        Number(item.taxable_paise),
        Number(item.cgst_paise),
        Number(item.sgst_paise),
        Number(item.igst_paise),
        Number(item.tax_paise),
        Number(item.total_paise)
      );
    }

    db.prepare(`
      UPDATE quotations SET status = 'converted', converted_invoice_id = ?, updated_at = ?
      WHERE id = ? AND user_uid = ?
    `).run(createdInvoiceId, now, quotationId, tenantUid);

    createNotification({
      userUid: tenantUid,
      type: 'quotation_converted',
      title: 'Quotation converted',
      message: `Quotation ${String(quo.quotation_number)} converted to invoice ${invoiceNumber}.`,
      entityType: 'invoice',
      entityId: createdInvoiceId,
    });

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'QUOTATION_CONVERTED',
      entityType: 'quotation',
      entityId: quotationId,
      summary: `Converted quotation ${String(quo.quotation_number)} into invoice ${invoiceNumber}`,
    });
  })();

  const inv = getInvoiceById(tenantUid, createdInvoiceId);
  if (!inv) throw new Error('Converted invoice not found');
  return inv;
}

export function listPayments(
  tenantUid: string,
  filters?: { search?: string; customerId?: string; method?: string; startDate?: string; endDate?: string }
): Payment[] {
  let sql = `
    SELECT p.*, i.invoice_number, c.name AS customer_name, c.company_name AS customer_company
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    JOIN customers c ON c.id = p.customer_id
    WHERE p.user_uid = ?
  `;
  const params: unknown[] = [tenantUid];

  if (filters?.customerId && filters.customerId !== 'all') {
    sql += ' AND p.customer_id = ?';
    params.push(filters.customerId);
  }
  if (filters?.method && filters.method !== 'all') {
    sql += ' AND p.payment_method = ?';
    params.push(filters.method);
  }
  if (filters?.startDate) {
    sql += ' AND p.payment_date >= ?';
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    sql += ' AND p.payment_date <= ?';
    params.push(filters.endDate);
  }
  sql += ' ORDER BY p.payment_date DESC, p.created_at DESC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const search = (filters?.search || '').trim().toLowerCase();

  return rows
    .map((r) => ({
      id: String(r.id),
      userUid: String(r.user_uid),
      invoiceId: String(r.invoice_id),
      invoiceNumber: String(r.invoice_number),
      customerId: String(r.customer_id),
      customerName: String(r.customer_company || r.customer_name),
      paymentDate: String(r.payment_date),
      amount: fromPaise(Number(r.amount_paise)),
      paymentMethod: r.payment_method as PaymentMethod,
      referenceId: String(r.reference_id || ''),
      notes: String(r.notes || ''),
      receiptNumber: String(r.receipt_number),
      createdAt: String(r.created_at),
    }))
    .filter((p) => {
      if (!search) return true;
      return (
        p.receiptNumber.toLowerCase().includes(search) ||
        (p.invoiceNumber || '').toLowerCase().includes(search) ||
        (p.customerName || '').toLowerCase().includes(search) ||
        p.referenceId.toLowerCase().includes(search)
      );
    });
}

export function recordPayment(
  auth: AuthContext,
  input: {
    invoiceId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceId?: string;
    notes?: string;
  }
): Payment {
  const tenantUid = auth.effectiveUser.uid;
  const amountPaise = toPaise(Number(input.amount));
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }
  const paymentDate = sanitizeStr(input.paymentDate, 10) || todayISO();
  const referenceId = sanitizeStr(input.referenceId, 80);
  const validMethods: PaymentMethod[] = [
    'Cash',
    'UPI',
    'Bank Transfer',
    'Credit/Debit Card',
    'Cheque',
    'Other',
  ];
  if (!validMethods.includes(input.paymentMethod)) {
    throw new Error('Invalid payment method');
  }

  const paymentId = generateId('pay');

  db.transaction(() => {
    const inv = db
      .prepare('SELECT id, invoice_number, customer_id, status, due_date, grand_total_paise, amount_paid_paise, balance_due_paise, customer_snapshot_json FROM invoices WHERE id = ? AND user_uid = ?')
      .get(input.invoiceId, tenantUid) as
      | {
          id: string;
          invoice_number: string;
          customer_id: string;
          status: InvoiceStatus;
          due_date: string;
          grand_total_paise: number;
          amount_paid_paise: number;
          balance_due_paise: number;
          customer_snapshot_json: string;
        }
      | undefined;

    if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'draft' || inv.status === 'cancelled') {
      throw new Error(`Cannot record payment against a ${inv.status} invoice`);
    }
    if (inv.balance_due_paise <= 0 || inv.status === 'paid') {
      throw new Error('Invoice is already paid in full');
    }
    if (amountPaise > inv.balance_due_paise) {
      throw new Error(
        `Payment exceeds remaining balance of INR ${fromPaise(inv.balance_due_paise).toFixed(2)}`
      );
    }

    if (referenceId) {
      const dup = db
        .prepare('SELECT id FROM payments WHERE user_uid = ? AND reference_id = ?')
        .get(tenantUid, referenceId);
      if (dup) {
        throw new Error(`Duplicate transaction reference ID "${referenceId}" already recorded`);
      }
    }

    const receiptNumber = allocateDocumentNumber(tenantUid, 'RCP', 'RCP', paymentDate);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO payments (id, user_uid, invoice_id, customer_id, payment_date, amount_paise, payment_method, reference_id, notes, receipt_number, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      tenantUid,
      inv.id,
      inv.customer_id,
      paymentDate,
      amountPaise,
      input.paymentMethod,
      referenceId,
      sanitizeStr(input.notes, 400),
      receiptNumber,
      now
    );

    // Authoritatively recalculate paid total from ledger
    const sumRow = db
      .prepare('SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM payments WHERE invoice_id = ? AND user_uid = ?')
      .get(inv.id, tenantUid) as { paid: number };

    const newPaidPaise = sumRow.paid;
    const newBalancePaise = Math.max(0, inv.grand_total_paise - newPaidPaise);
    const newStatus: InvoiceStatus =
      newBalancePaise === 0
        ? 'paid'
        : inv.due_date < todayISO()
          ? 'overdue'
          : 'partially_paid';

    db.prepare(`
      UPDATE invoices SET amount_paid_paise = ?, balance_due_paise = ?, status = ?, updated_at = ?
      WHERE id = ? AND user_uid = ?
    `).run(newPaidPaise, newBalancePaise, newStatus, now, inv.id, tenantUid);

    const cust = JSON.parse(inv.customer_snapshot_json) as CustomerSnapshot;
    createNotification({
      userUid: tenantUid,
      type: 'payment_received',
      title: 'Payment received',
      message: `Received INR ${fromPaise(amountPaise).toFixed(2)} for ${inv.invoice_number} (${cust.companyName || cust.name}).`,
      entityType: 'payment',
      entityId: paymentId,
    });

    logActivity({
      actor: auth.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: auth.impersonationSession?.id,
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: paymentId,
      summary: `Recorded ${input.paymentMethod} payment of INR ${fromPaise(amountPaise).toFixed(2)} against ${inv.invoice_number}`,
    });
  })();

  const created = listPayments(tenantUid).find((p) => p.id === paymentId);
  if (!created) throw new Error('Failed to load payment');
  return created;
}

export function getDateWindow(
  range: string,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string; prevStartDate: string; prevEndDate: string } {
  const today = todayISO();
  const now = new Date(`${today}T00:00:00Z`);

  let startDate = today;
  let endDate = today;

  if (range === 'today') {
    startDate = today;
    endDate = today;
  } else if (range === 'week') {
    const day = now.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    startDate = addDaysISO(today, -diff);
    endDate = today;
  } else if (range === 'month') {
    startDate = `${today.slice(0, 7)}-01`;
    endDate = today;
  } else if (range === 'year') {
    startDate = `${today.slice(0, 4)}-01-01`;
    endDate = today;
  } else if (range === 'custom' && customStart && customEnd) {
    startDate = customStart;
    endDate = customEnd;
  } else {
    // all_time or default 90 days
    startDate = '2000-01-01';
    endDate = '2099-12-31';
  }

  const sMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const eMs = new Date(`${endDate}T00:00:00Z`).getTime();
  const spanDays = Math.max(1, Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);
  const prevEndDate = addDaysISO(startDate, -1);
  const prevStartDate = addDaysISO(prevEndDate, -(spanDays - 1));

  return { startDate, endDate, prevStartDate, prevEndDate };
}

export function getCustomerDashboardAnalytics(
  tenantUid: string,
  range = 'month',
  customStart?: string,
  customEnd?: string
): CustomerAnalyticsData {
  syncOverdueInvoices(tenantUid);
  syncExpiredQuotations(tenantUid);

  const { startDate, endDate, prevStartDate, prevEndDate } = getDateWindow(
    range,
    customStart,
    customEnd
  );

  const invAgg = db
    .prepare(
      `SELECT
        COUNT(*) AS total_invoices,
        COALESCE(SUM(grand_total_paise), 0) AS total_sales_paise,
        COALESCE(SUM(amount_paid_paise), 0) AS total_received_paise,
        COALESCE(SUM(balance_due_paise), 0) AS total_outstanding_paise,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN balance_due_paise ELSE 0 END), 0) AS overdue_paise
       FROM invoices
       WHERE user_uid = ? AND status NOT IN ('draft', 'cancelled')
         AND invoice_date >= ? AND invoice_date <= ?`
    )
    .get(tenantUid, startDate, endDate) as Record<string, number>;

  const prevAgg = db
    .prepare(
      `SELECT COALESCE(SUM(grand_total_paise), 0) AS prev_sales_paise
       FROM invoices
       WHERE user_uid = ? AND status NOT IN ('draft', 'cancelled')
         AND invoice_date >= ? AND invoice_date <= ?`
    )
    .get(tenantUid, prevStartDate, prevEndDate) as { prev_sales_paise: number };

  const quoAgg = db
    .prepare(
      `SELECT
        COUNT(*) AS total_quotations,
        COALESCE(SUM(CASE WHEN status IN ('accepted', 'converted') THEN 1 ELSE 0 END), 0) AS accepted_quotations,
        COALESCE(SUM(CASE WHEN status IN ('draft', 'sent') THEN 1 ELSE 0 END), 0) AS pending_quotations
       FROM quotations
       WHERE user_uid = ? AND quotation_date >= ? AND quotation_date <= ?`
    )
    .get(tenantUid, startDate, endDate) as Record<string, number>;

  const totalSales = fromPaise(invAgg.total_sales_paise || 0);
  const previousPeriodSales = fromPaise(prevAgg.prev_sales_paise || 0);
  const salesGrowthPct =
    previousPeriodSales > 0
      ? Math.round(((totalSales - previousPeriodSales) / previousPeriodSales) * 1000) / 10
      : totalSales > 0
        ? 100
        : 0;

  // Build time series (group by month for year/all, by day for today/week/month/custom)
  const useMonthly = range === 'year' || range === 'all';
  const groupExpr = useMonthly ? `substr(invoice_date, 1, 7)` : `invoice_date`;
  const payGroupExpr = useMonthly ? `substr(payment_date, 1, 7)` : `payment_date`;

  const invSeriesRows = db
    .prepare(
      `SELECT ${groupExpr} AS period, COALESCE(SUM(grand_total_paise), 0) AS invoiced_paise, COUNT(*) AS cnt
       FROM invoices
       WHERE user_uid = ? AND status NOT IN ('draft', 'cancelled')
         AND invoice_date >= ? AND invoice_date <= ?
       GROUP BY period ORDER BY period ASC`
    )
    .all(tenantUid, startDate, endDate) as Array<{ period: string; invoiced_paise: number; cnt: number }>;

  const paySeriesRows = db
    .prepare(
      `SELECT ${payGroupExpr} AS period, COALESCE(SUM(amount_paise), 0) AS collected_paise
       FROM payments
       WHERE user_uid = ? AND payment_date >= ? AND payment_date <= ?
       GROUP BY period ORDER BY period ASC`
    )
    .all(tenantUid, startDate, endDate) as Array<{ period: string; collected_paise: number }>;

  const seriesMap = new Map<string, { invoiced: number; collected: number; invoiceCount: number }>();
  for (const r of invSeriesRows) {
    seriesMap.set(r.period, {
      invoiced: fromPaise(r.invoiced_paise),
      collected: 0,
      invoiceCount: r.cnt,
    });
  }
  for (const p of paySeriesRows) {
    const existing = seriesMap.get(p.period) || { invoiced: 0, collected: 0, invoiceCount: 0 };
    existing.collected = fromPaise(p.collected_paise);
    seriesMap.set(p.period, existing);
  }

  const salesSeries = Array.from(seriesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, val]) => ({
      period,
      label: period,
      ...val,
    }));

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(grand_total_paise), 0) AS amt_paise
       FROM invoices WHERE user_uid = ? AND invoice_date >= ? AND invoice_date <= ?
       GROUP BY status`
    )
    .all(tenantUid, startDate, endDate) as Array<{ status: InvoiceStatus; cnt: number; amt_paise: number }>;

  const topSalesRows = db
    .prepare(
      `SELECT c.id AS customer_id, c.name, c.company_name,
        COALESCE(SUM(i.grand_total_paise), 0) AS sales_paise,
        COUNT(i.id) AS cnt
       FROM customers c
       JOIN invoices i ON i.customer_id = c.id
       WHERE i.user_uid = ? AND i.status NOT IN ('draft', 'cancelled')
         AND i.invoice_date >= ? AND i.invoice_date <= ?
       GROUP BY c.id ORDER BY sales_paise DESC LIMIT 5`
    )
    .all(tenantUid, startDate, endDate) as Array<{
    customer_id: string;
    name: string;
    company_name: string;
    sales_paise: number;
    cnt: number;
  }>;

  const topOutRows = db
    .prepare(
      `SELECT c.id AS customer_id, c.name, c.company_name,
        COALESCE(SUM(i.balance_due_paise), 0) AS outstanding_paise,
        COALESCE(SUM(CASE WHEN i.status = 'overdue' THEN i.balance_due_paise ELSE 0 END), 0) AS overdue_paise
       FROM customers c
       JOIN invoices i ON i.customer_id = c.id
       WHERE i.user_uid = ? AND i.status NOT IN ('draft', 'cancelled') AND i.balance_due_paise > 0
       GROUP BY c.id ORDER BY outstanding_paise DESC LIMIT 5`
    )
    .all(tenantUid) as Array<{
    customer_id: string;
    name: string;
    company_name: string;
    outstanding_paise: number;
    overdue_paise: number;
  }>;

  const recentCustomers = listCustomers(tenantUid).slice(0, 5);
  const recentInvoices = listInvoices(tenantUid).slice(0, 6);

  return {
    summary: {
      totalSales,
      previousPeriodSales,
      salesGrowthPct,
      totalInvoices: invAgg.total_invoices || 0,
      totalAmountReceived: fromPaise(invAgg.total_received_paise || 0),
      totalOutstanding: fromPaise(invAgg.total_outstanding_paise || 0),
      overdueAmount: fromPaise(invAgg.overdue_paise || 0),
      totalQuotations: quoAgg.total_quotations || 0,
      acceptedQuotations: quoAgg.accepted_quotations || 0,
      pendingQuotations: quoAgg.pending_quotations || 0,
    },
    salesSeries,
    invoiceStatusBreakdown: statusRows.map((s) => ({
      status: s.status,
      count: s.cnt,
      amount: fromPaise(s.amt_paise),
    })),
    topCustomersBySales: topSalesRows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      companyName: r.company_name,
      totalSales: fromPaise(r.sales_paise),
      invoiceCount: r.cnt,
    })),
    topCustomersByOutstanding: topOutRows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      companyName: r.company_name,
      outstanding: fromPaise(r.outstanding_paise),
      overdue: fromPaise(r.overdue_paise),
    })),
    recentCustomers,
    recentInvoices,
  };
}

export function getOutstandingReport(
  tenantUid: string,
  filters?: { filter?: 'all' | 'not_due' | 'overdue'; customerId?: string; startDate?: string; endDate?: string }
): OutstandingReportRow[] {
  syncOverdueInvoices(tenantUid);
  let sql = `
    SELECT c.id AS customer_id, c.name, c.company_name, c.email, c.phone,
      COALESCE(SUM(i.grand_total_paise), 0) AS total_invoiced_paise,
      COALESCE(SUM(i.amount_paid_paise), 0) AS amount_paid_paise,
      COALESCE(SUM(i.balance_due_paise), 0) AS outstanding_paise,
      COALESCE(SUM(CASE WHEN i.balance_due_paise > 0 THEN 1 ELSE 0 END), 0) AS unpaid_cnt,
      COALESCE(SUM(CASE WHEN i.status = 'overdue' THEN i.balance_due_paise ELSE 0 END), 0) AS overdue_paise,
      MIN(CASE WHEN i.balance_due_paise > 0 THEN i.due_date ELSE NULL END) AS oldest_due_date
    FROM customers c
    JOIN invoices i ON i.customer_id = c.id
    WHERE i.user_uid = ? AND i.status NOT IN ('draft', 'cancelled') AND i.balance_due_paise > 0
  `;
  const params: unknown[] = [tenantUid];

  if (filters?.customerId && filters.customerId !== 'all') {
    sql += ' AND c.id = ?';
    params.push(filters.customerId);
  }
  if (filters?.startDate) {
    sql += ' AND i.invoice_date >= ?';
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    sql += ' AND i.invoice_date <= ?';
    params.push(filters.endDate);
  }
  if (filters?.filter === 'overdue') {
    sql += ` AND i.status = 'overdue'`;
  } else if (filters?.filter === 'not_due') {
    sql += ` AND i.status != 'overdue'`;
  }

  sql += ' GROUP BY c.id HAVING outstanding_paise > 0 ORDER BY outstanding_paise DESC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    customerId: String(r.customer_id),
    customerName: String(r.name),
    companyName: String(r.company_name || ''),
    email: String(r.email || ''),
    phone: String(r.phone || ''),
    totalInvoiced: fromPaise(Number(r.total_invoiced_paise)),
    amountPaid: fromPaise(Number(r.amount_paid_paise)),
    outstandingBalance: fromPaise(Number(r.outstanding_paise)),
    unpaidInvoiceCount: Number(r.unpaid_cnt),
    overdueAmount: fromPaise(Number(r.overdue_paise)),
    oldestDueDate: r.oldest_due_date ? String(r.oldest_due_date) : null,
  }));
}

// ==================== ADMIN SERVICES ====================

export function getAdminDashboardData(
  range = 'all',
  customStart?: string,
  customEnd?: string
): AdminDashboardData {
  syncOverdueInvoices();
  const { startDate, endDate } = getDateWindow(range, customStart, customEnd);

  const bizStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_cnt,
        COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS inactive_cnt,
        COALESCE(SUM(CASE WHEN status = 'active' THEN subscription_amount ELSE 0 END), 0) AS drona_mrr
       FROM users WHERE role = 'business'`
    )
    .get() as Record<string, number>;

  const invStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total_invoices,
        COALESCE(SUM(CASE WHEN status NOT IN ('draft', 'cancelled') THEN grand_total_paise ELSE 0 END), 0) AS invoiced_paise
       FROM invoices WHERE invoice_date >= ? AND invoice_date <= ?`
    )
    .get(startDate, endDate) as Record<string, number>;

  const quoStats = db
    .prepare(
      `SELECT COUNT(*) AS total_quotations FROM quotations WHERE quotation_date >= ? AND quotation_date <= ?`
    )
    .get(startDate, endDate) as { total_quotations: number };

  const payStats = db
    .prepare(
      `SELECT COALESCE(SUM(amount_paise), 0) AS payments_paise
       FROM payments WHERE payment_date >= ? AND payment_date <= ?`
    )
    .get(startDate, endDate) as { payments_paise: number };

  const useMonthly = range === 'year' || range === 'all';
  const grp = useMonthly ? `substr(invoice_date, 1, 7)` : `invoice_date`;
  const pGrp = useMonthly ? `substr(payment_date, 1, 7)` : `payment_date`;

  const invRows = db
    .prepare(
      `SELECT ${grp} AS period,
        COALESCE(SUM(CASE WHEN status NOT IN ('draft', 'cancelled') THEN grand_total_paise ELSE 0 END), 0) AS val_paise,
        COUNT(*) AS cnt
       FROM invoices WHERE invoice_date >= ? AND invoice_date <= ?
       GROUP BY period ORDER BY period ASC`
    )
    .all(startDate, endDate) as Array<{ period: string; val_paise: number; cnt: number }>;

  const payRows = db
    .prepare(
      `SELECT ${pGrp} AS period, COALESCE(SUM(amount_paise), 0) AS val_paise
       FROM payments WHERE payment_date >= ? AND payment_date <= ?
       GROUP BY period ORDER BY period ASC`
    )
    .all(startDate, endDate) as Array<{ period: string; val_paise: number }>;

  const map = new Map<string, { invoicedValue: number; paymentsRecorded: number; dronaRevenue: number; invoiceCount: number }>();
  const mrr = bizStats.drona_mrr || 0;
  for (const r of invRows) {
    map.set(r.period, {
      invoicedValue: fromPaise(r.val_paise),
      paymentsRecorded: 0,
      dronaRevenue: mrr,
      invoiceCount: r.cnt,
    });
  }
  for (const p of payRows) {
    const existing = map.get(p.period) || {
      invoicedValue: 0,
      paymentsRecorded: 0,
      dronaRevenue: mrr,
      invoiceCount: 0,
    };
    existing.paymentsRecorded = fromPaise(p.val_paise);
    map.set(p.period, existing);
  }

  const recentBizRows = db
    .prepare(
      `SELECT u.*,
        COALESCE((SELECT COUNT(*) FROM invoices i WHERE i.user_uid = u.uid), 0) AS invoice_count,
        COALESCE((SELECT COUNT(*) FROM quotations q WHERE q.user_uid = u.uid), 0) AS quotation_count,
        COALESCE((SELECT SUM(grand_total_paise) FROM invoices i WHERE i.user_uid = u.uid AND i.status NOT IN ('draft', 'cancelled')), 0) AS total_sales_paise
       FROM users u WHERE u.role = 'business'
       ORDER BY u.created_at DESC LIMIT 6`
    )
    .all() as Array<Record<string, unknown>>;

  const recentLogs = listActivityLogs(12);

  return {
    summary: {
      totalBusinesses: bizStats.total || 0,
      activeAccounts: bizStats.active_cnt || 0,
      inactiveAccounts: bizStats.inactive_cnt || 0,
      totalInvoicesGenerated: invStats.total_invoices || 0,
      totalQuotationsGenerated: quoStats.total_quotations || 0,
      platformInvoicedValue: fromPaise(invStats.invoiced_paise || 0),
      platformPaymentsRecorded: fromPaise(payStats.payments_paise || 0),
      dronaSubscriptionRevenue: mrr,
    },
    usageSeries: Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, val]) => ({ period, label: period, ...val })),
    recentBusinesses: recentBizRows.map((r) => ({
      ...mapUserRow(r as never),
      invoiceCount: Number(r.invoice_count || 0),
      quotationCount: Number(r.quotation_count || 0),
      totalSales: fromPaise(Number(r.total_sales_paise || 0)),
    })),
    recentActivity: recentLogs,
  };
}

export function listActivityLogs(limit = 100, tenantUid?: string): ActivityLog[] {
  const sql = tenantUid
    ? `SELECT * FROM activity_logs WHERE target_tenant_uid = ? OR actor_uid = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?`;
  const rows = (tenantUid
    ? db.prepare(sql).all(tenantUid, tenantUid, limit)
    : db.prepare(sql).all(limit)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    actorUid: String(r.actor_uid),
    actorEmail: String(r.actor_email),
    actorRole: r.actor_role as 'super_admin' | 'business',
    targetTenantUid: r.target_tenant_uid ? String(r.target_tenant_uid) : null,
    impersonationSessionId: r.impersonation_session_id ? String(r.impersonation_session_id) : null,
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: r.entity_id ? String(r.entity_id) : null,
    summary: String(r.summary),
    metadata: JSON.parse(String(r.metadata_json || '{}')),
    createdAt: String(r.created_at),
  }));
}
