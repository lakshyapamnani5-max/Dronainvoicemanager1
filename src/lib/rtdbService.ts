import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  get,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from 'firebase/database';
import { firebaseAuth, getSecondaryAuth, rtdb } from './firebase';
import {
  computeDocumentTotals,
  fromPaise,
  toPaise,
} from '../shared/gstCalculator';
import { isValidGstin, isValidIfsc, isValidPan } from '../shared/indianStates';
import type {
  ActivityLog,
  AdminDashboardData,
  AuthSessionState,
  BusinessProfile,
  BusinessSnapshot,
  ComputedLineItem,
  Customer,
  CustomerAnalyticsData,
  CustomerSnapshot,
  ImpersonationSession,
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
  UserRole,
} from '../shared/types';
import type { AdminUserRow, SaveDocumentPayload } from './api';

const IMPERSONATION_STORAGE_KEY = 'drona_rtdb_impersonation_id';

const DEMO_ACCOUNTS = {
  admin: {
    email: 'admin@drona.in',
    pass: 'DronaAdmin@2026',
    ownerName: 'Vikramaditya Rao',
    businessName: 'DRONA Platform HQ',
    phone: '+91 98200 10001',
    gstin: '27AAACD1234F1Z5',
  },
  biz1: {
    email: 'arjun@vanguardtech.in',
    pass: 'Vanguard@2026',
    ownerName: 'Arjun Deshmukh',
    businessName: 'Vanguard Technologies Pvt Ltd',
    phone: '+91 98201 44550',
    gstin: '27AABCV4321M1Z2',
    pan: 'AABCV4321M',
    state: 'Maharashtra',
    address: '402, Pinnacle Corporate Park, BKC, Mumbai, Maharashtra 400051',
    bankName: 'HDFC Bank Ltd',
    accountNumber: '50200048192011',
    ifsc: 'HDFC0000142',
    upiId: 'vanguardtech@hdfcbank',
    subscriptionPlan: 'Enterprise',
    subscriptionAmount: 4999,
  },
  biz2: {
    email: 'meera@kaveriprecision.in',
    pass: 'Kaveri@2026',
    ownerName: 'Meera Sundaram',
    businessName: 'Kaveri Precision Works LLP',
    phone: '+91 98450 77812',
    gstin: '29AABFK8912P1Z9',
    pan: 'AABFK8912P',
    state: 'Karnataka',
    address: 'Plot 18, Peenya Industrial Area Phase II, Bengaluru, Karnataka 560058',
    bankName: 'ICICI Bank',
    accountNumber: '004205018821',
    ifsc: 'ICIC0000042',
    upiId: 'kaveriprecision@icici',
    subscriptionPlan: 'Growth',
    subscriptionAmount: 1999,
  },
};

function generateId(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return prefix ? `${prefix}_${rand}` : rand;
}

function sanitizeStr(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function mapFirebaseError(err: unknown, fallback = 'Operation failed'): Error {
  if (err instanceof Error) {
    const msg = err.message || '';
    if (
      msg.includes('auth/invalid-credential') ||
      msg.includes('auth/wrong-password') ||
      msg.includes('auth/user-not-found')
    ) {
      return new Error('Invalid email or password');
    }
    if (msg.includes('auth/email-already-in-use')) {
      return new Error('An account with this email already exists');
    }
    if (msg.includes('auth/weak-password')) {
      return new Error('Password must be at least 8 characters');
    }
    if (msg.includes('auth/too-many-requests')) {
      return new Error('Too many attempts. Please wait a moment and try again.');
    }
    if (msg.toLowerCase().includes('permission_denied') || msg.toLowerCase().includes('permission denied')) {
      return new Error(
        'Firebase Realtime Database permission denied. Ensure RTDB security rules allow access (see database.rules.json).'
      );
    }
    return err;
  }
  return new Error(fallback);
}

function defaultPlatformSettings(): PlatformSettings {
  return {
    allowSelfRegistration: true,
    platformName: 'DRONA Invoice Manager',
    supportEmail: 'support@drona.in',
    defaultCurrency: 'INR',
    defaultInvoicePrefix: 'INV',
    defaultQuotationPrefix: 'QTN',
    defaultSubscriptionMonthly: 1999,
    maintenanceMode: false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeUserRecord(uid: string, raw: Record<string, unknown>): UserRecord {
  return {
    uid: String(raw.uid || uid),
    email: String(raw.email || ''),
    role: (raw.role as UserRole) || 'business',
    status: (raw.status as 'active' | 'inactive') || 'active',
    ownerName: String(raw.ownerName || ''),
    businessName: String(raw.businessName || ''),
    phone: String(raw.phone || ''),
    gstin: String(raw.gstin || ''),
    subscriptionPlan: String(raw.subscriptionPlan || 'Growth'),
    subscriptionAmount: Number(raw.subscriptionAmount ?? 1999),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    lastLoginAt: raw.lastLoginAt ? String(raw.lastLoginAt) : null,
  };
}

function normalizeBusinessProfile(uid: string, raw: Record<string, unknown>): BusinessProfile {
  return {
    userUid: String(raw.userUid || uid),
    businessName: String(raw.businessName || ''),
    ownerName: String(raw.ownerName || ''),
    logoDataUrl: String(raw.logoDataUrl || ''),
    address: String(raw.address || ''),
    email: String(raw.email || ''),
    phone: String(raw.phone || ''),
    gstin: String(raw.gstin || ''),
    pan: String(raw.pan || ''),
    state: String(raw.state || 'Maharashtra'),
    bankName: String(raw.bankName || ''),
    accountNumber: String(raw.accountNumber || ''),
    ifsc: String(raw.ifsc || ''),
    upiId: String(raw.upiId || ''),
    upiQrDataUrl: String(raw.upiQrDataUrl || ''),
    invoicePrefix: String(raw.invoicePrefix || 'INV'),
    quotationPrefix: String(raw.quotationPrefix || 'QTN'),
    defaultIsGst: raw.defaultIsGst !== false,
    defaultTaxRate: Number(raw.defaultTaxRate ?? 18),
    defaultTaxMode: (raw.defaultTaxMode as TaxPricingMode) || 'exclusive',
    defaultPaymentTermsDays: Number(raw.defaultPaymentTermsDays ?? 15),
    defaultInvoiceTemplate: (raw.defaultInvoiceTemplate as TemplateId) || 'classic_gst',
    defaultQuotationTemplate: (raw.defaultQuotationTemplate as TemplateId) || 'classic_gst',
    termsAndConditions: String(
      raw.termsAndConditions ||
        '1. Goods/services once billed will not be taken back.\n2. Interest @18% p.a. will be charged on delayed payments beyond due date.\n3. Subject to local jurisdiction.'
    ),
    signatureLabel: String(raw.signatureLabel || `For ${String(raw.businessName || 'Business')}`),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
  };
}

function normalizeInvoice(raw: Record<string, unknown>): Invoice {
  const itemsRaw = Array.isArray(raw.items)
    ? raw.items
    : raw.items && typeof raw.items === 'object'
      ? Object.values(raw.items as Record<string, unknown>)
      : [];

  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    invoiceNumber: String(raw.invoiceNumber || ''),
    status: (raw.status as InvoiceStatus) || 'draft',
    customerId: String(raw.customerId || ''),
    customerSnapshot: (raw.customerSnapshot as CustomerSnapshot) || {
      id: '',
      name: '',
      companyName: '',
      email: '',
      phone: '',
      gstin: '',
      billingAddress: '',
      shippingAddress: '',
      state: 'Maharashtra',
    },
    businessSnapshot: (raw.businessSnapshot as BusinessSnapshot) || {
      businessName: '',
      ownerName: '',
      logoDataUrl: '',
      address: '',
      email: '',
      phone: '',
      gstin: '',
      pan: '',
      state: 'Maharashtra',
      bankName: '',
      accountNumber: '',
      ifsc: '',
      upiId: '',
      upiQrDataUrl: '',
      signatureLabel: 'Authorized Signatory',
    },
    invoiceDate: String(raw.invoiceDate || ''),
    dueDate: String(raw.dueDate || ''),
    paymentTerms: String(raw.paymentTerms || ''),
    referenceNumber: String(raw.referenceNumber || ''),
    placeOfSupply: String(raw.placeOfSupply || ''),
    isGst: Boolean(raw.isGst),
    taxMode: (raw.taxMode as TaxPricingMode) || 'exclusive',
    taxSupplyMode: (raw.taxSupplyMode as TaxSupplyMode) || 'auto',
    isInterState: Boolean(raw.isInterState),
    roundOffEnabled: raw.roundOffEnabled !== false,
    subtotal: Number(raw.subtotal ?? 0),
    totalDiscount: Number(raw.totalDiscount ?? 0),
    taxableAmount: Number(raw.taxableAmount ?? 0),
    cgstTotal: Number(raw.cgstTotal ?? 0),
    sgstTotal: Number(raw.sgstTotal ?? 0),
    igstTotal: Number(raw.igstTotal ?? 0),
    totalTax: Number(raw.totalTax ?? 0),
    roundOff: Number(raw.roundOff ?? 0),
    grandTotal: Number(raw.grandTotal ?? 0),
    amountPaid: Number(raw.amountPaid ?? 0),
    balanceDue: Number(raw.balanceDue ?? 0),
    amountInWords: String(raw.amountInWords || ''),
    templateId: (raw.templateId as TemplateId) || 'classic_gst',
    notes: String(raw.notes || ''),
    terms: String(raw.terms || ''),
    sourceQuotationId: raw.sourceQuotationId ? String(raw.sourceQuotationId) : null,
    cancellationReason: raw.cancellationReason ? String(raw.cancellationReason) : null,
    cancelledAt: raw.cancelledAt ? String(raw.cancelledAt) : null,
    finalizedAt: raw.finalizedAt ? String(raw.finalizedAt) : null,
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    items: itemsRaw as ComputedLineItem[],
    payments: Array.isArray(raw.payments) ? (raw.payments as Payment[]) : undefined,
  };
}

function normalizeQuotation(raw: Record<string, unknown>): Quotation {
  const itemsRaw = Array.isArray(raw.items)
    ? raw.items
    : raw.items && typeof raw.items === 'object'
      ? Object.values(raw.items as Record<string, unknown>)
      : [];
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    quotationNumber: String(raw.quotationNumber || ''),
    status: (raw.status as QuotationStatus) || 'draft',
    customerId: String(raw.customerId || ''),
    customerSnapshot: raw.customerSnapshot as CustomerSnapshot,
    businessSnapshot: raw.businessSnapshot as BusinessSnapshot,
    quotationDate: String(raw.quotationDate || ''),
    validUntil: String(raw.validUntil || ''),
    referenceNumber: String(raw.referenceNumber || ''),
    placeOfSupply: String(raw.placeOfSupply || ''),
    isGst: Boolean(raw.isGst),
    taxMode: (raw.taxMode as TaxPricingMode) || 'exclusive',
    taxSupplyMode: (raw.taxSupplyMode as TaxSupplyMode) || 'auto',
    isInterState: Boolean(raw.isInterState),
    roundOffEnabled: raw.roundOffEnabled !== false,
    subtotal: Number(raw.subtotal ?? 0),
    totalDiscount: Number(raw.totalDiscount ?? 0),
    taxableAmount: Number(raw.taxableAmount ?? 0),
    cgstTotal: Number(raw.cgstTotal ?? 0),
    sgstTotal: Number(raw.sgstTotal ?? 0),
    igstTotal: Number(raw.igstTotal ?? 0),
    totalTax: Number(raw.totalTax ?? 0),
    roundOff: Number(raw.roundOff ?? 0),
    grandTotal: Number(raw.grandTotal ?? 0),
    amountInWords: String(raw.amountInWords || ''),
    templateId: (raw.templateId as TemplateId) || 'classic_gst',
    notes: String(raw.notes || ''),
    terms: String(raw.terms || ''),
    convertedInvoiceId: raw.convertedInvoiceId ? String(raw.convertedInvoiceId) : null,
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    items: itemsRaw as ComputedLineItem[],
  };
}

function normalizeCustomer(raw: Record<string, unknown>): Customer {
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    name: String(raw.name || ''),
    companyName: String(raw.companyName || ''),
    email: String(raw.email || ''),
    phone: String(raw.phone || ''),
    gstin: String(raw.gstin || ''),
    billingAddress: String(raw.billingAddress || ''),
    shippingAddress: String(raw.shippingAddress || ''),
    state: String(raw.state || 'Maharashtra'),
    notes: String(raw.notes || ''),
    archived: Boolean(raw.archived),
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
  };
}

function normalizePayment(raw: Record<string, unknown>): Payment {
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    invoiceId: String(raw.invoiceId || ''),
    invoiceNumber: raw.invoiceNumber ? String(raw.invoiceNumber) : undefined,
    customerId: String(raw.customerId || ''),
    customerName: raw.customerName ? String(raw.customerName) : undefined,
    paymentDate: String(raw.paymentDate || ''),
    amount: Number(raw.amount ?? 0),
    paymentMethod: (raw.paymentMethod as PaymentMethod) || 'UPI',
    referenceId: String(raw.referenceId || ''),
    notes: String(raw.notes || ''),
    receiptNumber: String(raw.receiptNumber || ''),
    createdAt: String(raw.createdAt || ''),
  };
}

function normalizeNotification(raw: Record<string, unknown>): NotificationItem {
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    type: (raw.type as NotificationItem['type']) || 'invoice_created',
    title: String(raw.title || ''),
    message: String(raw.message || ''),
    entityType: (raw.entityType as NotificationItem['entityType']) || null,
    entityId: raw.entityId ? String(raw.entityId) : null,
    isRead: Boolean(raw.isRead),
    emailStatus: (raw.emailStatus as NotificationItem['emailStatus']) || 'not_configured',
    whatsappStatus: (raw.whatsappStatus as NotificationItem['whatsappStatus']) || 'not_configured',
    createdAt: String(raw.createdAt || ''),
  };
}

function normalizeActivityLog(raw: Record<string, unknown>): ActivityLog {
  return {
    id: String(raw.id || ''),
    actorUid: String(raw.actorUid || ''),
    actorEmail: String(raw.actorEmail || ''),
    actorRole: (raw.actorRole as UserRole) || 'business',
    targetTenantUid: raw.targetTenantUid ? String(raw.targetTenantUid) : null,
    impersonationSessionId: raw.impersonationSessionId ? String(raw.impersonationSessionId) : null,
    action: String(raw.action || ''),
    entityType: String(raw.entityType || ''),
    entityId: raw.entityId ? String(raw.entityId) : null,
    summary: String(raw.summary || ''),
    metadata: (raw.metadata as Record<string, unknown>) || {},
    createdAt: String(raw.createdAt || ''),
  };
}

function getStoredImpersonationId(): string | null {
  try {
    return sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredImpersonationId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, id);
    else sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

async function ensurePlatformSettings(): Promise<PlatformSettings> {
  const snap = await get(ref(rtdb, 'platformSettings'));
  if (snap.exists()) {
    return { ...defaultPlatformSettings(), ...(snap.val() as Partial<PlatformSettings>) };
  }
  const defaults = defaultPlatformSettings();
  await set(ref(rtdb, 'platformSettings'), stripUndefined(defaults));
  return defaults;
}

async function logActivity(params: {
  actor: UserRecord;
  targetTenantUid?: string | null;
  impersonationSessionId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const id = generateId('log');
  const entry: ActivityLog = {
    id,
    actorUid: params.actor.uid,
    actorEmail: params.actor.email,
    actorRole: params.actor.role,
    targetTenantUid: params.targetTenantUid ?? null,
    impersonationSessionId: params.impersonationSessionId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    summary: params.summary,
    metadata: params.metadata || {},
    createdAt: new Date().toISOString(),
  };

  const clean = stripUndefined(entry);
  await set(ref(rtdb, `activityLogs/${id}`), clean);
  if (entry.targetTenantUid) {
    await set(ref(rtdb, `tenants/${entry.targetTenantUid}/activityLogs/${id}`), clean);
  }
}

async function createNotification(params: {
  userUid: string;
  type: NotificationItem['type'];
  title: string;
  message: string;
  entityType?: 'invoice' | 'quotation' | 'payment' | null;
  entityId?: string | null;
}): Promise<void> {
  const id = generateId('ntf');
  const item: NotificationItem = {
    id,
    userUid: params.userUid,
    type: params.type,
    title: params.title,
    message: params.message,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    isRead: false,
    emailStatus: 'not_configured',
    whatsappStatus: 'not_configured',
    createdAt: new Date().toISOString(),
  };
  await set(ref(rtdb, `tenants/${params.userUid}/notifications/${id}`), stripUndefined(item));
}

async function allocateDocumentNumber(
  tenantUid: string,
  docType: 'INV' | 'QUO' | 'RCP',
  prefix: string,
  dateIso: string
): Promise<string> {
  const year = /^\d{4}/.test(dateIso) ? dateIso.slice(0, 4) : String(new Date().getFullYear());
  const counterRef = ref(rtdb, `tenants/${tenantUid}/counters/${docType}_${year}`);
  const result = await runTransaction(counterRef, (current) => {
    const val = typeof current === 'number' ? current : 0;
    return val + 1;
  });
  const seq = Number(result.snapshot.val() || 1);
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

async function seedDemoBusinessWorkspace(
  uid: string,
  cfg: typeof DEMO_ACCOUNTS.biz1,
  withSampleRecords: boolean
): Promise<void> {
  const now = new Date().toISOString();
  const userRec: UserRecord = {
    uid,
    email: cfg.email,
    role: 'business',
    status: 'active',
    ownerName: cfg.ownerName,
    businessName: cfg.businessName,
    phone: cfg.phone,
    gstin: cfg.gstin,
    subscriptionPlan: cfg.subscriptionPlan,
    subscriptionAmount: cfg.subscriptionAmount,
    createdAt: addDaysISO(todayISO(), -45) + 'T09:00:00.000Z',
    updatedAt: now,
    lastLoginAt: now,
  };

  const profileRec: BusinessProfile = {
    userUid: uid,
    businessName: cfg.businessName,
    ownerName: cfg.ownerName,
    logoDataUrl: '',
    address: cfg.address,
    email: cfg.email,
    phone: cfg.phone,
    gstin: cfg.gstin,
    pan: cfg.pan,
    state: cfg.state,
    bankName: cfg.bankName,
    accountNumber: cfg.accountNumber,
    ifsc: cfg.ifsc,
    upiId: cfg.upiId,
    upiQrDataUrl: '',
    invoicePrefix: 'INV',
    quotationPrefix: 'QTN',
    defaultIsGst: true,
    defaultTaxRate: 18,
    defaultTaxMode: 'exclusive',
    defaultPaymentTermsDays: 15,
    defaultInvoiceTemplate: 'classic_gst',
    defaultQuotationTemplate: 'classic_gst',
    termsAndConditions:
      '1. Goods/services once billed will not be taken back.\n2. Interest @18% p.a. will be charged on delayed payments beyond due date.\n3. Subject to local jurisdiction.',
    signatureLabel: `For ${cfg.businessName}`,
    updatedAt: now,
  };

  await set(ref(rtdb, `users/${uid}`), stripUndefined(userRec));
  await set(ref(rtdb, `businessProfiles/${uid}`), stripUndefined(profileRec));

  if (!withSampleRecords) return;

  const existingCust = await get(ref(rtdb, `tenants/${uid}/customers`));
  if (existingCust.exists()) return;

  const isBiz1 = cfg.email === DEMO_ACCOUNTS.biz1.email;
  const cust1Id = generateId('cus');
  const cust2Id = generateId('cus');
  const cust1: Customer = isBiz1
    ? {
        id: cust1Id,
        userUid: uid,
        name: 'Rohan Kulkarni',
        companyName: 'Orion Logistics India Pvt Ltd',
        email: 'accounts@orionlogistics.in',
        phone: '+91 98230 11223',
        gstin: '27AAACO7812Q1Z4',
        billingAddress: 'Plot 21, MIDC Chakan, Pune, Maharashtra 410501',
        shippingAddress: 'Plot 21, MIDC Chakan, Pune, Maharashtra 410501',
        state: 'Maharashtra',
        notes: '',
        archived: false,
        createdAt: now,
        updatedAt: now,
      }
    : {
        id: cust1Id,
        userUid: uid,
        name: 'Siddharth Iyer',
        companyName: 'Deccan Mobility Systems',
        email: 'ap@deccanmobility.in',
        phone: '+91 99001 66770',
        gstin: '29AAACD4509H1Z8',
        billingAddress: 'Hosur Road, Electronic City, Bengaluru, Karnataka 560100',
        shippingAddress: 'Hosur Road, Electronic City, Bengaluru, Karnataka 560100',
        state: 'Karnataka',
        notes: '',
        archived: false,
        createdAt: now,
        updatedAt: now,
      };

  const cust2: Customer = isBiz1
    ? {
        id: cust2Id,
        userUid: uid,
        name: 'Neha Verma',
        companyName: 'Apex Retail Ventures',
        email: 'finance@apexretail.in',
        phone: '+91 98111 33445',
        gstin: '07AAACA9011K1Z1',
        billingAddress: 'DLF Cyber Hub, Connaught Place, New Delhi, Delhi 110001',
        shippingAddress: 'DLF Cyber Hub, Connaught Place, New Delhi, Delhi 110001',
        state: 'Delhi',
        notes: '',
        archived: false,
        createdAt: now,
        updatedAt: now,
      }
    : {
        id: cust2Id,
        userUid: uid,
        name: 'Karan Mehta',
        companyName: 'Sahyadri Agro Exports',
        email: 'billing@sahyadriagro.in',
        phone: '+91 97654 22110',
        gstin: '27AABCS3210L1Z3',
        billingAddress: 'Gangapur Road, Nashik, Maharashtra 422013',
        shippingAddress: 'Gangapur Road, Nashik, Maharashtra 422013',
        state: 'Maharashtra',
        notes: '',
        archived: false,
        createdAt: now,
        updatedAt: now,
      };

  await set(ref(rtdb, `tenants/${uid}/customers/${cust1Id}`), stripUndefined(cust1));
  await set(ref(rtdb, `tenants/${uid}/customers/${cust2Id}`), stripUndefined(cust2));

  const businessSnap: BusinessSnapshot = {
    businessName: profileRec.businessName,
    ownerName: profileRec.ownerName,
    logoDataUrl: profileRec.logoDataUrl,
    address: profileRec.address,
    email: profileRec.email,
    phone: profileRec.phone,
    gstin: profileRec.gstin,
    pan: profileRec.pan,
    state: profileRec.state,
    bankName: profileRec.bankName,
    accountNumber: profileRec.accountNumber,
    ifsc: profileRec.ifsc,
    upiId: profileRec.upiId,
    upiQrDataUrl: '',
    signatureLabel: profileRec.signatureLabel,
  };

  const today = todayISO();
  const year = today.slice(0, 4);

  const createSeedInv = async (opts: {
    seq: number;
    cust: Customer;
    invDate: string;
    dueDate: string;
    items: LineItemInput[];
    paidRatio: number;
  }) => {
    const calc = computeDocumentTotals({
      items: opts.items,
      businessState: profileRec.state,
      placeOfSupply: opts.cust.state,
      isGst: true,
      taxMode: 'exclusive',
      taxSupplyMode: 'auto',
      roundOffEnabled: true,
    });
    const invId = generateId('inv');
    const invNum = `INV-${year}-${String(opts.seq).padStart(4, '0')}`;
    const paidPaise = Math.round(calc.grandTotalPaise * opts.paidRatio);
    const balPaise = calc.grandTotalPaise - paidPaise;
    const status: InvoiceStatus =
      balPaise === 0
        ? 'paid'
        : opts.dueDate < today
          ? 'overdue'
          : paidPaise > 0
            ? 'partially_paid'
            : 'unpaid';

    const inv: Invoice = {
      id: invId,
      userUid: uid,
      invoiceNumber: invNum,
      status,
      customerId: opts.cust.id,
      customerSnapshot: {
        id: opts.cust.id,
        name: opts.cust.name,
        companyName: opts.cust.companyName,
        email: opts.cust.email,
        phone: opts.cust.phone,
        gstin: opts.cust.gstin,
        billingAddress: opts.cust.billingAddress,
        shippingAddress: opts.cust.shippingAddress,
        state: opts.cust.state,
      },
      businessSnapshot: businessSnap,
      invoiceDate: opts.invDate,
      dueDate: opts.dueDate,
      paymentTerms: 'Net 15',
      referenceNumber: `PO-${year}-${100 + opts.seq}`,
      placeOfSupply: opts.cust.state,
      isGst: true,
      taxMode: 'exclusive',
      taxSupplyMode: 'auto',
      isInterState: calc.isInterState,
      roundOffEnabled: true,
      subtotal: calc.subtotal,
      totalDiscount: calc.totalDiscount,
      taxableAmount: calc.taxableAmount,
      cgstTotal: calc.cgstTotal,
      sgstTotal: calc.sgstTotal,
      igstTotal: calc.igstTotal,
      totalTax: calc.totalTax,
      roundOff: calc.roundOff,
      grandTotal: calc.grandTotal,
      amountPaid: fromPaise(paidPaise),
      balanceDue: fromPaise(balPaise),
      amountInWords: calc.amountInWords,
      templateId: 'classic_gst',
      notes: 'Thank you for your continued partnership.',
      terms: profileRec.termsAndConditions,
      sourceQuotationId: null,
      cancellationReason: null,
      cancelledAt: null,
      finalizedAt: `${opts.invDate}T10:00:00.000Z`,
      createdAt: `${opts.invDate}T10:00:00.000Z`,
      updatedAt: now,
      items: calc.items,
    };

    await set(ref(rtdb, `tenants/${uid}/invoices/${invId}`), stripUndefined(inv));

    if (paidPaise > 0) {
      const rcpNum = await allocateDocumentNumber(uid, 'RCP', 'RCP', opts.invDate);
      const payId = generateId('pay');
      const payment: Payment = {
        id: payId,
        userUid: uid,
        invoiceId: invId,
        invoiceNumber: invNum,
        customerId: opts.cust.id,
        customerName: opts.cust.companyName || opts.cust.name,
        paymentDate: addDaysISO(opts.invDate, 4),
        amount: fromPaise(paidPaise),
        paymentMethod: 'Bank Transfer',
        referenceId: `UTR${year}${opts.seq}9981`,
        notes: 'Settled via NEFT/IMPS',
        receiptNumber: rcpNum,
        createdAt: now,
      };
      await set(ref(rtdb, `tenants/${uid}/payments/${payId}`), stripUndefined(payment));
    }
  };

  await createSeedInv({
    seq: 1,
    cust: cust1,
    invDate: addDaysISO(today, -25),
    dueDate: addDaysISO(today, -10),
    paidRatio: 1,
    items: [
      {
        name: isBiz1 ? 'Cloud ERP Implementation' : 'CNC Machined Housing Batch',
        description: isBiz1 ? 'Multi-warehouse inventory module' : 'SS316 precision tolerance',
        hsnSac: isBiz1 ? '998314' : '848340',
        quantity: 1,
        unit: 'Nos',
        rate: isBiz1 ? 75000 : 48000,
        discountType: 'percent',
        discountValue: 5,
        taxRate: 18,
      },
    ],
  });

  await createSeedInv({
    seq: 2,
    cust: cust2,
    invDate: addDaysISO(today, -18),
    dueDate: addDaysISO(today, -3),
    paidRatio: 0.4,
    items: [
      {
        name: isBiz1 ? 'Annual SaaS Telemetry License' : 'Hydraulic Valve Assembly',
        description: 'Q4 production batch',
        hsnSac: isBiz1 ? '998313' : '848120',
        quantity: 2,
        unit: 'Units',
        rate: isBiz1 ? 22000 : 18500,
        discountType: 'fixed',
        discountValue: 1000,
        taxRate: 18,
      },
    ],
  });

  await set(ref(rtdb, `tenants/${uid}/counters/INV_${year}`), 2);

  // Sample quotation
  const quoItems: LineItemInput[] = [
    {
      name: isBiz1 ? 'Mobile Logistics App Suite' : 'Industrial Gearbox Upgrade',
      description: 'Scope includes QA & deployment',
      hsnSac: isBiz1 ? '998314' : '848340',
      quantity: 1,
      unit: 'Project',
      rate: isBiz1 ? 95000 : 64000,
      discountType: 'percent',
      discountValue: 5,
      taxRate: 18,
    },
  ];
  const qCalc = computeDocumentTotals({
    items: quoItems,
    businessState: profileRec.state,
    placeOfSupply: cust2.state,
    isGst: true,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    roundOffEnabled: true,
  });
  const quoId = generateId('quo');
  const quo: Quotation = {
    id: quoId,
    userUid: uid,
    quotationNumber: `QTN-${year}-0001`,
    status: 'sent',
    customerId: cust2.id,
    customerSnapshot: {
      id: cust2.id,
      name: cust2.name,
      companyName: cust2.companyName,
      email: cust2.email,
      phone: cust2.phone,
      gstin: cust2.gstin,
      billingAddress: cust2.billingAddress,
      shippingAddress: cust2.shippingAddress,
      state: cust2.state,
    },
    businessSnapshot: businessSnap,
    quotationDate: addDaysISO(today, -3),
    validUntil: addDaysISO(today, 27),
    referenceNumber: 'RFQ-2026-88',
    placeOfSupply: cust2.state,
    isGst: true,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    isInterState: qCalc.isInterState,
    roundOffEnabled: true,
    subtotal: qCalc.subtotal,
    totalDiscount: qCalc.totalDiscount,
    taxableAmount: qCalc.taxableAmount,
    cgstTotal: qCalc.cgstTotal,
    sgstTotal: qCalc.sgstTotal,
    igstTotal: qCalc.igstTotal,
    totalTax: qCalc.totalTax,
    roundOff: qCalc.roundOff,
    grandTotal: qCalc.grandTotal,
    amountInWords: qCalc.amountInWords,
    templateId: 'classic_gst',
    notes: 'Valid for 30 days from date of issue.',
    terms: profileRec.termsAndConditions,
    convertedInvoiceId: null,
    createdAt: now,
    updatedAt: now,
    items: qCalc.items,
  };
  await set(ref(rtdb, `tenants/${uid}/quotations/${quoId}`), stripUndefined(quo));
  await set(ref(rtdb, `tenants/${uid}/counters/QUO_${year}`), 1);

  await createNotification({
    userUid: uid,
    type: 'invoice_created',
    title: 'Workspace initialized in Firebase RTDB',
    message: `${profileRec.businessName} connected to Firebase Realtime Database.`,
    entityType: null,
    entityId: null,
  });
}

async function seedDemoBusinessesFromAdmin(): Promise<void> {
  const existingUsersSnap = await get(ref(rtdb, 'users'));
  const existingUsers = existingUsersSnap.exists()
    ? (existingUsersSnap.val() as Record<string, Record<string, unknown>>)
    : {};
  const emails = new Set(Object.values(existingUsers).map((u) => String(u.email || '').toLowerCase()));

  for (const cfg of [DEMO_ACCOUNTS.biz1, DEMO_ACCOUNTS.biz2]) {
    if (emails.has(cfg.email.toLowerCase())) continue;
    try {
      const secAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secAuth, cfg.email, cfg.pass);
      const newUid = cred.user.uid;
      await signOut(secAuth);
      await seedDemoBusinessWorkspace(newUid, cfg, true);
    } catch {
      // If auth account already exists in Firebase Auth without RTDB node, user will auto-hydrate on login
    }
  }
}

async function resolveCurrentAuthContext(): Promise<{
  actorUser: UserRecord;
  effectiveUser: UserRecord;
  businessProfile: BusinessProfile | null;
  isImpersonating: boolean;
  impersonationSession: ImpersonationSession | null;
}> {
  const fbUser = firebaseAuth.currentUser;
  if (!fbUser) throw new Error('Authentication required');

  const userSnap = await get(ref(rtdb, `users/${fbUser.uid}`));
  if (!userSnap.exists()) {
    throw new Error('User workspace profile not found');
  }
  const actorUser = normalizeUserRecord(fbUser.uid, userSnap.val() as Record<string, unknown>);
  if (actorUser.status !== 'active') {
    await signOut(firebaseAuth);
    throw new Error('Your account has been deactivated by Drona Admin.');
  }

  let effectiveUser = actorUser;
  let isImpersonating = false;
  let impersonationSession: ImpersonationSession | null = null;

  const storedImpId = getStoredImpersonationId();
  if (actorUser.role === 'super_admin' && storedImpId) {
    const impSnap = await get(ref(rtdb, `impersonationSessions/${storedImpId}`));
    if (impSnap.exists()) {
      const imp = impSnap.val() as ImpersonationSession;
      if (
        imp.active &&
        imp.adminUid === actorUser.uid &&
        new Date(imp.expiresAt).getTime() > Date.now()
      ) {
        const targetSnap = await get(ref(rtdb, `users/${imp.targetUid}`));
        if (targetSnap.exists()) {
          effectiveUser = normalizeUserRecord(
            imp.targetUid,
            targetSnap.val() as Record<string, unknown>
          );
          isImpersonating = true;
          impersonationSession = imp;
        }
      } else {
        setStoredImpersonationId(null);
      }
    } else {
      setStoredImpersonationId(null);
    }
  } else if (storedImpId && actorUser.role !== 'super_admin') {
    setStoredImpersonationId(null);
  }

  let businessProfile: BusinessProfile | null = null;
  if (effectiveUser.role === 'business') {
    const profSnap = await get(ref(rtdb, `businessProfiles/${effectiveUser.uid}`));
    if (profSnap.exists()) {
      businessProfile = normalizeBusinessProfile(
        effectiveUser.uid,
        profSnap.val() as Record<string, unknown>
      );
    }
  }

  return {
    actorUser,
    effectiveUser,
    businessProfile,
    isImpersonating,
    impersonationSession,
  };
}

async function requireTenantContext() {
  const ctx = await resolveCurrentAuthContext();
  if (ctx.effectiveUser.role !== 'business') {
    throw new Error('Business workspace access required');
  }
  if (ctx.effectiveUser.status !== 'active' && !ctx.isImpersonating) {
    throw new Error('Business account is inactive');
  }
  return ctx;
}

async function requireSuperAdminContext() {
  const ctx = await resolveCurrentAuthContext();
  if (ctx.actorUser.role !== 'super_admin') {
    throw new Error('Forbidden: Drona Super Admin privileges required');
  }
  return ctx;
}

async function syncOverdueInvoices(tenantUid: string): Promise<void> {
  const snap = await get(ref(rtdb, `tenants/${tenantUid}/invoices`));
  if (!snap.exists()) return;
  const rawMap = snap.val() as Record<string, Record<string, unknown>>;
  const today = todayISO();
  const now = new Date().toISOString();

  const notifSnap = await get(ref(rtdb, `tenants/${tenantUid}/notifications`));
  const existingNotifs = notifSnap.exists()
    ? Object.values(notifSnap.val() as Record<string, NotificationItem>)
    : [];

  for (const [id, raw] of Object.entries(rawMap)) {
    const inv = normalizeInvoice(raw);
    if (
      (inv.status === 'unpaid' || inv.status === 'partially_paid') &&
      inv.dueDate < today &&
      inv.balanceDue > 0
    ) {
      await update(ref(rtdb, `tenants/${tenantUid}/invoices/${id}`), {
        status: 'overdue',
        updatedAt: now,
      });
      const already = existingNotifs.some(
        (n) => n.type === 'invoice_overdue' && n.entityId === id
      );
      if (!already) {
        await createNotification({
          userUid: tenantUid,
          type: 'invoice_overdue',
          title: 'Invoice overdue',
          message: `Invoice ${inv.invoiceNumber} for ${
            inv.customerSnapshot.companyName || inv.customerSnapshot.name
          } is past due.`,
          entityType: 'invoice',
          entityId: id,
        });
      }
    }
  }
}

async function syncExpiredQuotations(tenantUid: string): Promise<void> {
  const snap = await get(ref(rtdb, `tenants/${tenantUid}/quotations`));
  if (!snap.exists()) return;
  const rawMap = snap.val() as Record<string, Record<string, unknown>>;
  const today = todayISO();
  const soonDate = addDaysISO(today, 3);
  const now = new Date().toISOString();

  const notifSnap = await get(ref(rtdb, `tenants/${tenantUid}/notifications`));
  const existingNotifs = notifSnap.exists()
    ? Object.values(notifSnap.val() as Record<string, NotificationItem>)
    : [];

  for (const [id, raw] of Object.entries(rawMap)) {
    const q = normalizeQuotation(raw);
    if (q.status === 'sent' && q.validUntil < today) {
      await update(ref(rtdb, `tenants/${tenantUid}/quotations/${id}`), {
        status: 'expired',
        updatedAt: now,
      });
    } else if (q.status === 'sent' && q.validUntil >= today && q.validUntil <= soonDate) {
      const already = existingNotifs.some(
        (n) => n.type === 'quotation_expiring' && n.entityId === id
      );
      if (!already) {
        await createNotification({
          userUid: tenantUid,
          type: 'quotation_expiring',
          title: 'Quotation expiring soon',
          message: `Quotation ${q.quotationNumber} expires on ${q.validUntil}.`,
          entityType: 'quotation',
          entityId: id,
        });
      }
    }
  }
}

async function listTenantInvoicesRaw(tenantUid: string): Promise<Invoice[]> {
  await syncOverdueInvoices(tenantUid);
  const snap = await get(ref(rtdb, `tenants/${tenantUid}/invoices`));
  if (!snap.exists()) return [];
  const list = Object.values(snap.val() as Record<string, Record<string, unknown>>).map(
    normalizeInvoice
  );
  return list.sort((a, b) =>
    `${b.invoiceDate}_${b.createdAt}`.localeCompare(`${a.invoiceDate}_${a.createdAt}`)
  );
}

async function listTenantQuotationsRaw(tenantUid: string): Promise<Quotation[]> {
  await syncExpiredQuotations(tenantUid);
  const snap = await get(ref(rtdb, `tenants/${tenantUid}/quotations`));
  if (!snap.exists()) return [];
  const list = Object.values(snap.val() as Record<string, Record<string, unknown>>).map(
    normalizeQuotation
  );
  return list.sort((a, b) =>
    `${b.quotationDate}_${b.createdAt}`.localeCompare(`${a.quotationDate}_${a.createdAt}`)
  );
}

async function listTenantPaymentsRaw(tenantUid: string): Promise<Payment[]> {
  const snap = await get(ref(rtdb, `tenants/${tenantUid}/payments`));
  if (!snap.exists()) return [];
  const list = Object.values(snap.val() as Record<string, Record<string, unknown>>).map(
    normalizePayment
  );
  return list.sort((a, b) =>
    `${b.paymentDate}_${b.createdAt}`.localeCompare(`${a.paymentDate}_${a.createdAt}`)
  );
}

async function listTenantCustomersRaw(
  tenantUid: string,
  opts?: { search?: string; includeArchived?: boolean }
): Promise<Customer[]> {
  const [custSnap, invoices, quotations] = await Promise.all([
    get(ref(rtdb, `tenants/${tenantUid}/customers`)),
    listTenantInvoicesRaw(tenantUid),
    listTenantQuotationsRaw(tenantUid),
  ]);

  if (!custSnap.exists()) return [];
  const rawList = Object.values(custSnap.val() as Record<string, Record<string, unknown>>).map(
    normalizeCustomer
  );

  const search = (opts?.search || '').trim().toLowerCase();
  const includeArchived = Boolean(opts?.includeArchived);

  return rawList
    .filter((c) => includeArchived || !c.archived)
    .map((c) => {
      const custInvoices = invoices.filter((i) => i.customerId === c.id);
      const activeInvoices = custInvoices.filter(
        (i) => i.status !== 'draft' && i.status !== 'cancelled'
      );
      const custQuotes = quotations.filter((q) => q.customerId === c.id);
      return {
        ...c,
        totalSales: fromPaise(
          activeInvoices.reduce((s, i) => s + toPaise(i.grandTotal), 0)
        ),
        totalPaid: fromPaise(
          activeInvoices.reduce((s, i) => s + toPaise(i.amountPaid), 0)
        ),
        outstandingBalance: fromPaise(
          activeInvoices.reduce((s, i) => s + toPaise(i.balanceDue), 0)
        ),
        invoiceCount: custInvoices.length,
        quotationCount: custQuotes.length,
      };
    })
    .filter((c) => {
      if (!search) return true;
      return (
        c.name.toLowerCase().includes(search) ||
        c.companyName.toLowerCase().includes(search) ||
        c.email.toLowerCase().includes(search) ||
        c.phone.toLowerCase().includes(search) ||
        c.gstin.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

function buildDateRangeBounds(range?: string, startDate?: string, endDate?: string) {
  const today = todayISO();
  const d = new Date(`${today}T00:00:00Z`);

  if (range === 'today') return { start: today, end: today };
  if (range === 'week') {
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const s = new Date(d);
    s.setUTCDate(s.getUTCDate() - diff);
    return { start: s.toISOString().slice(0, 10), end: today };
  }
  if (range === 'month') {
    return { start: `${today.slice(0, 7)}-01`, end: today };
  }
  if (range === 'year') {
    return { start: `${today.slice(0, 4)}-01-01`, end: today };
  }
  if (range === 'custom' && (startDate || endDate)) {
    return { start: startDate || '2000-01-01', end: endDate || '2099-12-31' };
  }
  return { start: '2000-01-01', end: '2099-12-31' };
}

function getPreviousPeriodBounds(start: string, end: string): { prevStart: string; prevEnd: string } {
  if (start === '2000-01-01') {
    return { prevStart: '1990-01-01', prevEnd: '1999-12-31' };
  }
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  const spanDays = Math.max(1, Math.round((e - s) / 86_400_000) + 1);
  const prevEnd = new Date(s - 86_400_000).toISOString().slice(0, 10);
  const prevStart = new Date(s - spanDays * 86_400_000).toISOString().slice(0, 10);
  return { prevStart, prevEnd };
}

async function computeCustomerAnalyticsForTenant(
  tenantUid: string,
  params?: { range?: string; startDate?: string; endDate?: string }
): Promise<CustomerAnalyticsData> {
  const { start, end } = buildDateRangeBounds(params?.range, params?.startDate, params?.endDate);
  const { prevStart, prevEnd } = getPreviousPeriodBounds(start, end);

  const [allInvoices, allQuotations, allPayments, customers] = await Promise.all([
    listTenantInvoicesRaw(tenantUid),
    listTenantQuotationsRaw(tenantUid),
    listTenantPaymentsRaw(tenantUid),
    listTenantCustomersRaw(tenantUid, { includeArchived: true }),
  ]);

  const nonDraftNonCancelled = allInvoices.filter(
    (i) => i.status !== 'draft' && i.status !== 'cancelled'
  );
  const rangedInvoices = nonDraftNonCancelled.filter(
    (i) => i.invoiceDate >= start && i.invoiceDate <= end
  );
  const prevRangedInvoices = nonDraftNonCancelled.filter(
    (i) => i.invoiceDate >= prevStart && i.invoiceDate <= prevEnd
  );
  const rangedPayments = allPayments.filter(
    (p) => p.paymentDate >= start && p.paymentDate <= end
  );
  const rangedQuotations = allQuotations.filter(
    (q) => q.quotationDate >= start && q.quotationDate <= end
  );

  const totalSales = fromPaise(
    rangedInvoices.reduce((s, i) => s + toPaise(i.grandTotal), 0)
  );
  const prevSales = fromPaise(
    prevRangedInvoices.reduce((s, i) => s + toPaise(i.grandTotal), 0)
  );
  const salesGrowthPct =
    prevSales > 0
      ? Number((((totalSales - prevSales) / prevSales) * 100).toFixed(1))
      : totalSales > 0
        ? 100
        : 0;

  const totalAmountReceived = fromPaise(
    rangedPayments.reduce((s, p) => s + toPaise(p.amount), 0)
  );
  const totalOutstanding = fromPaise(
    nonDraftNonCancelled.reduce((s, i) => s + toPaise(i.balanceDue), 0)
  );
  const overdueAmount = fromPaise(
    nonDraftNonCancelled
      .filter((i) => i.status === 'overdue')
      .reduce((s, i) => s + toPaise(i.balanceDue), 0)
  );

  const acceptedQuotations = rangedQuotations.filter(
    (q) => q.status === 'accepted' || q.status === 'converted'
  ).length;
  const pendingQuotations = rangedQuotations.filter(
    (q) => q.status === 'draft' || q.status === 'sent'
  ).length;

  const useDaily = params?.range === 'today' || params?.range === 'week';
  const bucketMap = new Map<
    string,
    { invoicedPaise: number; collectedPaise: number; invoiceCount: number }
  >();

  for (const inv of rangedInvoices) {
    const key = useDaily ? inv.invoiceDate : inv.invoiceDate.slice(0, 7);
    const cur = bucketMap.get(key) || { invoicedPaise: 0, collectedPaise: 0, invoiceCount: 0 };
    cur.invoicedPaise += toPaise(inv.grandTotal);
    cur.invoiceCount += 1;
    bucketMap.set(key, cur);
  }
  for (const pay of rangedPayments) {
    const key = useDaily ? pay.paymentDate : pay.paymentDate.slice(0, 7);
    const cur = bucketMap.get(key) || { invoicedPaise: 0, collectedPaise: 0, invoiceCount: 0 };
    cur.collectedPaise += toPaise(pay.amount);
    bucketMap.set(key, cur);
  }

  const salesSeries = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({
      period,
      label: useDaily ? period.slice(5) : period,
      invoiced: fromPaise(v.invoicedPaise),
      collected: fromPaise(v.collectedPaise),
      invoiceCount: v.invoiceCount,
    }));

  const statusMap = new Map<InvoiceStatus, { count: number; amountPaise: number }>();
  for (const inv of allInvoices) {
    const cur = statusMap.get(inv.status) || { count: 0, amountPaise: 0 };
    cur.count += 1;
    cur.amountPaise += toPaise(inv.grandTotal);
    statusMap.set(inv.status, cur);
  }

  const invoiceStatusBreakdown = Array.from(statusMap.entries()).map(([status, v]) => ({
    status,
    count: v.count,
    amount: fromPaise(v.amountPaise),
  }));

  const custSalesMap = new Map<
    string,
    {
      customerId: string;
      name: string;
      companyName: string;
      salesPaise: number;
      outstandingPaise: number;
      overduePaise: number;
      invoiceCount: number;
    }
  >();

  for (const inv of nonDraftNonCancelled) {
    const cur = custSalesMap.get(inv.customerId) || {
      customerId: inv.customerId,
      name: inv.customerSnapshot.name,
      companyName: inv.customerSnapshot.companyName,
      salesPaise: 0,
      outstandingPaise: 0,
      overduePaise: 0,
      invoiceCount: 0,
    };
    cur.salesPaise += toPaise(inv.grandTotal);
    cur.outstandingPaise += toPaise(inv.balanceDue);
    if (inv.status === 'overdue') cur.overduePaise += toPaise(inv.balanceDue);
    cur.invoiceCount += 1;
    custSalesMap.set(inv.customerId, cur);
  }

  const topCustomersBySales = Array.from(custSalesMap.values())
    .sort((a, b) => b.salesPaise - a.salesPaise)
    .slice(0, 6)
    .map((c) => ({
      customerId: c.customerId,
      name: c.name,
      companyName: c.companyName,
      totalSales: fromPaise(c.salesPaise),
      invoiceCount: c.invoiceCount,
    }));

  const topCustomersByOutstanding = Array.from(custSalesMap.values())
    .filter((c) => c.outstandingPaise > 0)
    .sort((a, b) => b.outstandingPaise - a.outstandingPaise)
    .slice(0, 6)
    .map((c) => ({
      customerId: c.customerId,
      name: c.name,
      companyName: c.companyName,
      outstanding: fromPaise(c.outstandingPaise),
      overdue: fromPaise(c.overduePaise),
    }));

  return {
    summary: {
      totalSales,
      previousPeriodSales: prevSales,
      salesGrowthPct,
      totalInvoices: rangedInvoices.length,
      totalAmountReceived,
      totalOutstanding,
      overdueAmount,
      totalQuotations: rangedQuotations.length,
      acceptedQuotations,
      pendingQuotations,
    },
    salesSeries,
    invoiceStatusBreakdown,
    topCustomersBySales,
    topCustomersByOutstanding,
    recentCustomers: customers.slice(0, 5),
    recentInvoices: allInvoices.slice(0, 6),
  };
}

export function subscribeRtdbPath(path: string, callback: () => void): () => void {
  const r = ref(rtdb, path);
  let initialized = false;
  return onValue(
    r,
    () => {
      if (!initialized) {
        initialized = true;
        return;
      }
      callback();
    },
    () => {}
  );
}

export const rtdbService = {
  getPublicSettings: async () => {
    try {
      const s = await ensurePlatformSettings();
      return {
        platformName: s.platformName,
        allowSelfRegistration: s.allowSelfRegistration,
        maintenanceMode: s.maintenanceMode,
        supportEmail: s.supportEmail,
      };
    } catch {
      const d = defaultPlatformSettings();
      return {
        platformName: d.platformName,
        allowSelfRegistration: d.allowSelfRegistration,
        maintenanceMode: d.maintenanceMode,
        supportEmail: d.supportEmail,
      };
    }
  },

  login: async (
    emailInput: string,
    password: string,
    portal?: 'admin' | 'customer'
  ): Promise<AuthSessionState> => {
    const email = sanitizeStr(emailInput, 160).toLowerCase();
    if (!email || !password) throw new Error('Email and password are required');

    try {
      let cred;
      const matchedDemo = [DEMO_ACCOUNTS.admin, DEMO_ACCOUNTS.biz1, DEMO_ACCOUNTS.biz2].find(
        (d) => d.email.toLowerCase() === email && d.pass === password
      );

      try {
        cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
      } catch (signInErr) {
        const msg = signInErr instanceof Error ? signInErr.message : '';
        const isMissingAuth =
          msg.includes('auth/user-not-found') || msg.includes('auth/invalid-credential');

        if (matchedDemo && isMissingAuth) {
          try {
            cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
          } catch (createErr) {
            throw mapFirebaseError(createErr, 'Invalid email or password');
          }
        } else {
          throw mapFirebaseError(signInErr, 'Invalid email or password');
        }
      }

      const uid = cred.user.uid;
      await ensurePlatformSettings();

      const userSnap = await get(ref(rtdb, `users/${uid}`));
      if (!userSnap.exists()) {
        const now = new Date().toISOString();
        if (email === DEMO_ACCOUNTS.admin.email) {
          const adminRec: UserRecord = {
            uid,
            email,
            role: 'super_admin',
            status: 'active',
            ownerName: DEMO_ACCOUNTS.admin.ownerName,
            businessName: DEMO_ACCOUNTS.admin.businessName,
            phone: DEMO_ACCOUNTS.admin.phone,
            gstin: DEMO_ACCOUNTS.admin.gstin,
            subscriptionPlan: 'Platform',
            subscriptionAmount: 0,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
          };
          await set(ref(rtdb, `users/${uid}`), stripUndefined(adminRec));
          await seedDemoBusinessesFromAdmin();
        } else if (email === DEMO_ACCOUNTS.biz1.email) {
          await seedDemoBusinessWorkspace(uid, DEMO_ACCOUNTS.biz1, true);
        } else if (email === DEMO_ACCOUNTS.biz2.email) {
          await seedDemoBusinessWorkspace(uid, DEMO_ACCOUNTS.biz2, true);
        } else {
          let roleToCreate: UserRole = 'business';
          if (portal === 'admin') {
            const allUsersSnap = await get(ref(rtdb, 'users'));
            const hasAdmin =
              allUsersSnap.exists() &&
              Object.values(allUsersSnap.val() as Record<string, Record<string, unknown>>).some(
                (u) => u.role === 'super_admin'
              );
            if (!hasAdmin) {
              roleToCreate = 'super_admin';
            } else {
              await signOut(firebaseAuth);
              throw new Error('This portal is restricted to Drona Administrators');
            }
          }

          const newRec: UserRecord = {
            uid,
            email,
            role: roleToCreate,
            status: 'active',
            ownerName: cred.user.displayName || email.split('@')[0] || 'User',
            businessName:
              roleToCreate === 'super_admin'
                ? 'DRONA Platform Admin'
                : `${email.split('@')[0] || 'My'} Business`,
            phone: '',
            gstin: '',
            subscriptionPlan: roleToCreate === 'super_admin' ? 'Platform' : 'Growth',
            subscriptionAmount: roleToCreate === 'super_admin' ? 0 : 1999,
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
          };
          await set(ref(rtdb, `users/${uid}`), stripUndefined(newRec));
          if (roleToCreate === 'business') {
            const prof: BusinessProfile = normalizeBusinessProfile(uid, {
              userUid: uid,
              businessName: newRec.businessName,
              ownerName: newRec.ownerName,
              email,
            });
            await set(ref(rtdb, `businessProfiles/${uid}`), stripUndefined(prof));
          }
        }
      } else {
        const existing = normalizeUserRecord(uid, userSnap.val() as Record<string, unknown>);
        if (portal === 'admin' && existing.role !== 'super_admin') {
          await signOut(firebaseAuth);
          throw new Error('This portal is restricted to Drona Administrators');
        }
        if (existing.status !== 'active') {
          await signOut(firebaseAuth);
          throw new Error('Your business account is inactive. Contact Drona Admin.');
        }
        await update(ref(rtdb, `users/${uid}`), {
          lastLoginAt: new Date().toISOString(),
        });
        if (existing.role === 'super_admin') {
          await seedDemoBusinessesFromAdmin();
        }
      }

      setStoredImpersonationId(null);
      const ctx = await resolveCurrentAuthContext();
      await logActivity({
        actor: ctx.actorUser,
        targetTenantUid: ctx.actorUser.role === 'business' ? ctx.actorUser.uid : null,
        action: 'USER_LOGIN',
        entityType: 'auth',
        entityId: ctx.actorUser.uid,
        summary: `${ctx.actorUser.email} signed in (${ctx.actorUser.role})`,
      });
      return ctx;
    } catch (err) {
      throw mapFirebaseError(err, 'Sign in failed');
    }
  },

  register: async (payload: {
    email: string;
    password: string;
    ownerName: string;
    businessName: string;
    phone: string;
    gstin: string;
    state: string;
  }): Promise<AuthSessionState> => {
    try {
      const settings = await ensurePlatformSettings();
      if (!settings.allowSelfRegistration) {
        throw new Error('Self-registration is currently disabled by Drona Admin');
      }
      const email = sanitizeStr(payload.email, 160).toLowerCase();
      const ownerName = sanitizeStr(payload.ownerName, 120);
      const businessName = sanitizeStr(payload.businessName, 160);
      const phone = sanitizeStr(payload.phone, 32);
      const gstin = sanitizeStr(payload.gstin, 20).toUpperCase();
      const state = sanitizeStr(payload.state, 64) || 'Maharashtra';

      if (!email || !email.includes('@')) throw new Error('Valid email is required');
      if ((payload.password || '').length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      if (!ownerName || !businessName) {
        throw new Error('Owner name and business name are required');
      }
      if (gstin && !isValidGstin(gstin)) throw new Error('Invalid GSTIN format');

      const cred = await createUserWithEmailAndPassword(firebaseAuth, email, payload.password);
      const uid = cred.user.uid;
      const now = new Date().toISOString();

      const userRec: UserRecord = {
        uid,
        email,
        role: 'business',
        status: 'active',
        ownerName,
        businessName,
        phone,
        gstin,
        subscriptionPlan: 'Growth',
        subscriptionAmount: settings.defaultSubscriptionMonthly,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      };
      const profileRec = normalizeBusinessProfile(uid, {
        userUid: uid,
        businessName,
        ownerName,
        email,
        phone,
        gstin,
        state,
        invoicePrefix: settings.defaultInvoicePrefix,
        quotationPrefix: settings.defaultQuotationPrefix,
        signatureLabel: `For ${businessName}`,
        updatedAt: now,
      });

      await set(ref(rtdb, `users/${uid}`), stripUndefined(userRec));
      await set(ref(rtdb, `businessProfiles/${uid}`), stripUndefined(profileRec));

      setStoredImpersonationId(null);
      const ctx = await resolveCurrentAuthContext();
      await logActivity({
        actor: ctx.actorUser,
        targetTenantUid: uid,
        action: 'BUSINESS_SELF_REGISTERED',
        entityType: 'user',
        entityId: uid,
        summary: `New business ${businessName} registered`,
      });
      return ctx;
    } catch (err) {
      throw mapFirebaseError(err, 'Registration failed');
    }
  },

  logout: async () => {
    setStoredImpersonationId(null);
    await signOut(firebaseAuth);
  },

  me: async (): Promise<{ session: AuthSessionState }> => {
    const session = await resolveCurrentAuthContext();
    return { session };
  },

  forgotPassword: async (emailInput: string) => {
    const email = sanitizeStr(emailInput, 160).toLowerCase();
    if (!email) throw new Error('Email is required');
    try {
      await sendPasswordResetEmail(firebaseAuth, email);
      return {
        ok: true,
        emailDeliveryConfigured: true,
        message: `Password reset email sent to ${email}. Follow the link in your inbox to set a new password.`,
      };
    } catch (err) {
      throw mapFirebaseError(err, 'Failed to send password reset email');
    }
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const ctx = await resolveCurrentAuthContext();
    if (ctx.isImpersonating) {
      throw new Error('Cannot change customer password during admin impersonation');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }
    const user = firebaseAuth.currentUser;
    if (!user || !user.email) throw new Error('Not signed in');
    try {
      const cred = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPassword);
      return { ok: true };
    } catch (err) {
      throw mapFirebaseError(err, 'Failed to update password');
    }
  },

  // ==================== BUSINESS PROFILE ====================
  getBusinessProfile: async (): Promise<{ profile: BusinessProfile }> => {
    const ctx = await requireTenantContext();
    const snap = await get(ref(rtdb, `businessProfiles/${ctx.effectiveUser.uid}`));
    if (!snap.exists()) {
      throw new Error('Business profile not found');
    }
    return {
      profile: normalizeBusinessProfile(
        ctx.effectiveUser.uid,
        snap.val() as Record<string, unknown>
      ),
    };
  },

  updateBusinessProfile: async (
    input: Partial<BusinessProfile>
  ): Promise<{ profile: BusinessProfile }> => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const snap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
    const existing = snap.exists()
      ? normalizeBusinessProfile(tenantUid, snap.val() as Record<string, unknown>)
      : normalizeBusinessProfile(tenantUid, {});

    const gstin = sanitizeStr(input.gstin ?? existing.gstin, 20).toUpperCase();
    const pan = sanitizeStr(input.pan ?? existing.pan, 12).toUpperCase();
    const ifsc = sanitizeStr(input.ifsc ?? existing.ifsc, 16).toUpperCase();

    if (gstin && !isValidGstin(gstin)) throw new Error('Invalid GSTIN format');
    if (pan && !isValidPan(pan)) throw new Error('Invalid PAN format');
    if (ifsc && !isValidIfsc(ifsc)) throw new Error('Invalid IFSC code format');

    const now = new Date().toISOString();
    const updated: BusinessProfile = {
      ...existing,
      businessName: sanitizeStr(input.businessName ?? existing.businessName, 160) || existing.businessName,
      ownerName: sanitizeStr(input.ownerName ?? existing.ownerName, 120) || existing.ownerName,
      logoDataUrl:
        typeof input.logoDataUrl === 'string' && input.logoDataUrl.length < 1_500_000
          ? input.logoDataUrl
          : existing.logoDataUrl,
      address: sanitizeStr(input.address ?? existing.address, 400),
      email: sanitizeStr(input.email ?? existing.email, 160),
      phone: sanitizeStr(input.phone ?? existing.phone, 32),
      gstin,
      pan,
      state: sanitizeStr(input.state ?? existing.state, 64) || 'Maharashtra',
      bankName: sanitizeStr(input.bankName ?? existing.bankName, 120),
      accountNumber: sanitizeStr(input.accountNumber ?? existing.accountNumber, 40),
      ifsc,
      upiId: sanitizeStr(input.upiId ?? existing.upiId, 120),
      upiQrDataUrl:
        typeof input.upiQrDataUrl === 'string' && input.upiQrDataUrl.length < 1_000_000
          ? input.upiQrDataUrl
          : existing.upiQrDataUrl,
      invoicePrefix:
        sanitizeStr(input.invoicePrefix ?? existing.invoicePrefix, 12).toUpperCase() || 'INV',
      quotationPrefix:
        sanitizeStr(input.quotationPrefix ?? existing.quotationPrefix, 12).toUpperCase() || 'QTN',
      defaultIsGst: input.defaultIsGst ?? existing.defaultIsGst,
      defaultTaxRate: Number(input.defaultTaxRate ?? existing.defaultTaxRate) || 18,
      defaultTaxMode: input.defaultTaxMode === 'inclusive' ? 'inclusive' : 'exclusive',
      defaultPaymentTermsDays: Math.max(
        0,
        Math.min(365, Number(input.defaultPaymentTermsDays ?? existing.defaultPaymentTermsDays) || 15)
      ),
      defaultInvoiceTemplate: input.defaultInvoiceTemplate || existing.defaultInvoiceTemplate,
      defaultQuotationTemplate: input.defaultQuotationTemplate || existing.defaultQuotationTemplate,
      termsAndConditions: sanitizeStr(
        input.termsAndConditions ?? existing.termsAndConditions,
        1500
      ),
      signatureLabel:
        sanitizeStr(input.signatureLabel ?? existing.signatureLabel, 120) ||
        `For ${existing.businessName}`,
      updatedAt: now,
    };

    await set(ref(rtdb, `businessProfiles/${tenantUid}`), stripUndefined(updated));
    await update(ref(rtdb, `users/${tenantUid}`), {
      businessName: updated.businessName,
      ownerName: updated.ownerName,
      phone: updated.phone,
      gstin: updated.gstin,
      updatedAt: now,
    });

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'BUSINESS_PROFILE_UPDATED',
      entityType: 'business_profile',
      entityId: tenantUid,
      summary: `Updated business profile & preferences for ${updated.businessName}`,
    });

    return { profile: updated };
  },

  // ==================== CUSTOMERS CRM ====================
  listCustomers: async (params?: { search?: string; includeArchived?: boolean }) => {
    const ctx = await requireTenantContext();
    const customers = await listTenantCustomersRaw(ctx.effectiveUser.uid, params);
    return { customers };
  },

  getCustomer: async (customerId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const allCustomers = await listTenantCustomersRaw(tenantUid, { includeArchived: true });
    const customer = allCustomers.find((c) => c.id === customerId);
    if (!customer) throw new Error('Customer not found');

    const [allInvoices, allQuotations, allPayments] = await Promise.all([
      listTenantInvoicesRaw(tenantUid),
      listTenantQuotationsRaw(tenantUid),
      listTenantPaymentsRaw(tenantUid),
    ]);

    return {
      customer,
      invoices: allInvoices.filter((i) => i.customerId === customerId),
      quotations: allQuotations.filter((q) => q.customerId === customerId),
      payments: allPayments.filter((p) => p.customerId === customerId),
    };
  },

  createCustomer: async (input: Partial<Customer>) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const name = sanitizeStr(input.name, 140);
    if (!name) throw new Error('Customer name is required');
    const gstin = sanitizeStr(input.gstin, 20).toUpperCase();
    if (gstin && !isValidGstin(gstin)) throw new Error('Invalid customer GSTIN format');

    const id = generateId('cus');
    const now = new Date().toISOString();
    const customer: Customer = {
      id,
      userUid: tenantUid,
      name,
      companyName: sanitizeStr(input.companyName, 160),
      email: sanitizeStr(input.email, 160),
      phone: sanitizeStr(input.phone, 32),
      gstin,
      billingAddress: sanitizeStr(input.billingAddress, 400),
      shippingAddress: sanitizeStr(input.shippingAddress || input.billingAddress, 400),
      state: sanitizeStr(input.state, 64) || 'Maharashtra',
      notes: sanitizeStr(input.notes, 1000),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    await set(ref(rtdb, `tenants/${tenantUid}/customers/${id}`), stripUndefined(customer));
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: id,
      summary: `Added customer ${customer.companyName || name}`,
    });

    return {
      customer: {
        ...customer,
        totalSales: 0,
        totalPaid: 0,
        outstandingBalance: 0,
        invoiceCount: 0,
        quotationCount: 0,
      },
    };
  },

  updateCustomer: async (customerId: string, input: Partial<Customer>) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const custRef = ref(rtdb, `tenants/${tenantUid}/customers/${customerId}`);
    const snap = await get(custRef);
    if (!snap.exists()) throw new Error('Customer not found');
    const existing = normalizeCustomer(snap.val() as Record<string, unknown>);

    const name = sanitizeStr(input.name ?? existing.name, 140);
    if (!name) throw new Error('Customer name is required');
    const gstin = sanitizeStr(input.gstin ?? existing.gstin, 20).toUpperCase();
    if (gstin && !isValidGstin(gstin)) throw new Error('Invalid customer GSTIN format');

    const updated: Customer = {
      ...existing,
      name,
      companyName: sanitizeStr(input.companyName ?? existing.companyName, 160),
      email: sanitizeStr(input.email ?? existing.email, 160),
      phone: sanitizeStr(input.phone ?? existing.phone, 32),
      gstin,
      billingAddress: sanitizeStr(input.billingAddress ?? existing.billingAddress, 400),
      shippingAddress: sanitizeStr(input.shippingAddress ?? existing.shippingAddress, 400),
      state: sanitizeStr(input.state ?? existing.state, 64) || 'Maharashtra',
      notes: sanitizeStr(input.notes ?? existing.notes, 1000),
      archived: input.archived !== undefined ? Boolean(input.archived) : existing.archived,
      updatedAt: new Date().toISOString(),
    };

    await set(custRef, stripUndefined(updated));
    const isUnarchiving = existing.archived && !updated.archived;
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: isUnarchiving ? 'CUSTOMER_UNARCHIVED' : 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: customerId,
      summary: isUnarchiving ? `Unarchived customer ${name}` : `Updated customer ${name}`,
    });

    const refreshed = (await listTenantCustomersRaw(tenantUid, { includeArchived: true })).find(
      (c) => c.id === customerId
    );
    return { customer: refreshed || updated };
  },

  deleteCustomer: async (customerId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const custRef = ref(rtdb, `tenants/${tenantUid}/customers/${customerId}`);
    const snap = await get(custRef);
    if (!snap.exists()) throw new Error('Customer not found');
    const existing = normalizeCustomer(snap.val() as Record<string, unknown>);

    const [invoices, quotations] = await Promise.all([
      listTenantInvoicesRaw(tenantUid),
      listTenantQuotationsRaw(tenantUid),
    ]);
    const hasDocs =
      invoices.some((i) => i.customerId === customerId) ||
      quotations.some((q) => q.customerId === customerId);

    if (hasDocs) {
      await update(custRef, { archived: true, updatedAt: new Date().toISOString() });
      await logActivity({
        actor: ctx.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: ctx.impersonationSession?.id,
        action: 'CUSTOMER_ARCHIVED',
        entityType: 'customer',
        entityId: customerId,
        summary: `Archived customer ${existing.name} (historical documents preserved)`,
      });
    } else {
      await remove(custRef);
      await logActivity({
        actor: ctx.actorUser,
        targetTenantUid: tenantUid,
        impersonationSessionId: ctx.impersonationSession?.id,
        action: 'CUSTOMER_DELETED',
        entityType: 'customer',
        entityId: customerId,
        summary: `Deleted customer ${existing.name}`,
      });
    }

    return { archived: hasDocs };
  },

  // ==================== INVOICES ====================
  listInvoices: async (params?: {
    search?: string;
    status?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const ctx = await requireTenantContext();
    let list = await listTenantInvoicesRaw(ctx.effectiveUser.uid);

    if (params?.status && params.status !== 'all') {
      list = list.filter((i) => i.status === params.status);
    }
    if (params?.customerId && params.customerId !== 'all') {
      list = list.filter((i) => i.customerId === params.customerId);
    }
    if (params?.startDate) {
      list = list.filter((i) => i.invoiceDate >= params.startDate!);
    }
    if (params?.endDate) {
      list = list.filter((i) => i.invoiceDate <= params.endDate!);
    }
    const search = (params?.search || '').trim().toLowerCase();
    if (search) {
      list = list.filter(
        (inv) =>
          inv.invoiceNumber.toLowerCase().includes(search) ||
          inv.customerSnapshot.name.toLowerCase().includes(search) ||
          inv.customerSnapshot.companyName.toLowerCase().includes(search) ||
          inv.referenceNumber.toLowerCase().includes(search)
      );
    }
    return { invoices: list };
  },

  getInvoice: async (invoiceId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    await syncOverdueInvoices(tenantUid);
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`));
    if (!snap.exists()) throw new Error('Invoice not found');
    const invoice = normalizeInvoice(snap.val() as Record<string, unknown>);

    const [payments, logsSnap] = await Promise.all([
      listTenantPaymentsRaw(tenantUid),
      get(ref(rtdb, `tenants/${tenantUid}/activityLogs`)),
    ]);

    invoice.payments = payments.filter((p) => p.invoiceId === invoiceId);
    const allLogs = logsSnap.exists()
      ? Object.values(logsSnap.val() as Record<string, Record<string, unknown>>).map(
          normalizeActivityLog
        )
      : [];
    const auditLogs = allLogs
      .filter((l) => l.entityType === 'invoice' && l.entityId === invoiceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((l) => ({
        id: l.id,
        actorEmail: l.actorEmail,
        action: l.action,
        summary: l.summary,
        createdAt: l.createdAt,
        impersonationSessionId: l.impersonationSessionId,
      }));

    return { invoice, auditLogs };
  },

  saveInvoice: async (input: SaveDocumentPayload, existingInvoiceId?: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const cleanItems = validateLineItems(input.items);

    const [profSnap, custSnap] = await Promise.all([
      get(ref(rtdb, `businessProfiles/${tenantUid}`)),
      get(ref(rtdb, `tenants/${tenantUid}/customers/${input.customerId}`)),
    ]);
    if (!profSnap.exists()) throw new Error('Business profile not configured');
    if (!custSnap.exists()) throw new Error('Selected customer does not belong to this workspace');

    const profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
    const customer = normalizeCustomer(custSnap.val() as Record<string, unknown>);

    const resolvedLogo = resolveDocumentLogo(profile.logoDataUrl, input.logoDataUrl);
    const resolvedUpiId =
      input.upiId !== undefined ? sanitizeStr(input.upiId, 120) : profile.upiId;

    const customerSnapshot: CustomerSnapshot = {
      id: customer.id,
      name: customer.name,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      gstin: customer.gstin,
      billingAddress: customer.billingAddress,
      shippingAddress: customer.shippingAddress,
      state: customer.state,
    };

    const businessSnapshot: BusinessSnapshot = {
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

    const invoiceDate = sanitizeStr(input.invoiceDate, 10) || todayISO();
    const dueDate =
      sanitizeStr(input.dueDate, 10) ||
      addDaysISO(invoiceDate, profile.defaultPaymentTermsDays);
    const placeOfSupply =
      sanitizeStr(input.placeOfSupply, 64) || customerSnapshot.state || profile.state;

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
      input.templateId &&
      ['classic_gst', 'executive_minimal', 'compact_commercial'].includes(input.templateId)
        ? input.templateId
        : profile.defaultInvoiceTemplate;

    const now = new Date().toISOString();

    if (input.saveLogoToProfile && input.logoDataUrl !== undefined) {
      await update(ref(rtdb, `businessProfiles/${tenantUid}`), {
        logoDataUrl: businessSnapshot.logoDataUrl,
        updatedAt: now,
      });
    }
    if (input.saveUpiToProfile && input.upiId !== undefined) {
      await update(ref(rtdb, `businessProfiles/${tenantUid}`), {
        upiId: businessSnapshot.upiId,
        updatedAt: now,
      });
    }

    let targetId = existingInvoiceId || generateId('inv');
    let invoiceNumber = '';
    let status: InvoiceStatus = 'draft';
    let finalizedAt: string | null = null;
    let createdAt = now;

    if (existingInvoiceId) {
      const exSnap = await get(ref(rtdb, `tenants/${tenantUid}/invoices/${existingInvoiceId}`));
      if (!exSnap.exists()) throw new Error('Invoice not found');
      const existing = normalizeInvoice(exSnap.val() as Record<string, unknown>);
      if (existing.status !== 'draft') {
        throw new Error(
          'Finalized invoices are immutable and cannot be edited. Cancel the invoice and issue a replacement instead.'
        );
      }
      createdAt = existing.createdAt;
      if (isDraft) {
        invoiceNumber = existing.invoiceNumber;
        status = 'draft';
      } else {
        invoiceNumber = await allocateDocumentNumber(
          tenantUid,
          'INV',
          profile.invoicePrefix,
          invoiceDate
        );
        status = dueDate < todayISO() ? 'overdue' : 'unpaid';
        finalizedAt = now;
      }
    } else {
      if (isDraft) {
        invoiceNumber = `DRAFT-${generateId().slice(0, 6).toUpperCase()}`;
        status = 'draft';
      } else {
        invoiceNumber = await allocateDocumentNumber(
          tenantUid,
          'INV',
          profile.invoicePrefix,
          invoiceDate
        );
        status = dueDate < todayISO() ? 'overdue' : 'unpaid';
        finalizedAt = now;
      }
    }

    const savedInvoice: Invoice = {
      id: targetId,
      userUid: tenantUid,
      invoiceNumber,
      status,
      customerId: customerSnapshot.id,
      customerSnapshot,
      businessSnapshot,
      invoiceDate,
      dueDate,
      paymentTerms: sanitizeStr(input.paymentTerms, 64) || `Net ${profile.defaultPaymentTermsDays}`,
      referenceNumber: sanitizeStr(input.referenceNumber, 64),
      placeOfSupply,
      isGst: Boolean(input.isGst),
      taxMode: input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
      taxSupplyMode: input.taxSupplyMode || 'auto',
      isInterState: calc.isInterState,
      roundOffEnabled: input.roundOffEnabled !== false,
      subtotal: calc.subtotal,
      totalDiscount: calc.totalDiscount,
      taxableAmount: calc.taxableAmount,
      cgstTotal: calc.cgstTotal,
      sgstTotal: calc.sgstTotal,
      igstTotal: calc.igstTotal,
      totalTax: calc.totalTax,
      roundOff: calc.roundOff,
      grandTotal: calc.grandTotal,
      amountPaid: 0,
      balanceDue: calc.grandTotal,
      amountInWords: calc.amountInWords,
      templateId,
      notes: sanitizeStr(input.notes, 1000),
      terms: sanitizeStr(input.terms ?? profile.termsAndConditions, 1500),
      sourceQuotationId: null,
      cancellationReason: null,
      cancelledAt: null,
      finalizedAt,
      createdAt,
      updatedAt: now,
      items: calc.items.map((it, idx) => ({ ...it, id: it.id || `itm_${idx + 1}` })),
    };

    await set(ref(rtdb, `tenants/${tenantUid}/invoices/${targetId}`), stripUndefined(savedInvoice));

    if (!isDraft) {
      await createNotification({
        userUid: tenantUid,
        type: 'invoice_created',
        title: 'New invoice generated',
        message: `Invoice ${invoiceNumber} issued to ${
          customerSnapshot.companyName || customerSnapshot.name
        }.`,
        entityType: 'invoice',
        entityId: targetId,
      });
    }

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: existingInvoiceId
        ? isDraft
          ? 'INVOICE_DRAFT_UPDATED'
          : 'INVOICE_FINALIZED'
        : isDraft
          ? 'INVOICE_DRAFT_CREATED'
          : 'INVOICE_CREATED',
      entityType: 'invoice',
      entityId: targetId,
      summary: isDraft
        ? `Saved draft invoice ${invoiceNumber}`
        : `Issued invoice ${invoiceNumber} for INR ${calc.grandTotal.toFixed(2)}`,
    });

    return { invoice: savedInvoice };
  },

  finalizeInvoice: async (invoiceId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const [profSnap, invSnap] = await Promise.all([
      get(ref(rtdb, `businessProfiles/${tenantUid}`)),
      get(ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`)),
    ]);
    if (!profSnap.exists()) throw new Error('Business profile not configured');
    if (!invSnap.exists()) throw new Error('Invoice not found');

    const profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
    const existing = normalizeInvoice(invSnap.val() as Record<string, unknown>);
    if (existing.status !== 'draft') throw new Error('Only draft invoices can be finalized');

    const officialNumber = await allocateDocumentNumber(
      tenantUid,
      'INV',
      profile.invoicePrefix,
      existing.invoiceDate
    );
    const nextStatus: InvoiceStatus = existing.dueDate < todayISO() ? 'overdue' : 'unpaid';
    const now = new Date().toISOString();

    const updated: Invoice = {
      ...existing,
      invoiceNumber: officialNumber,
      status: nextStatus,
      finalizedAt: now,
      updatedAt: now,
    };
    await set(ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`), stripUndefined(updated));

    await createNotification({
      userUid: tenantUid,
      type: 'invoice_created',
      title: 'New invoice generated',
      message: `Invoice ${officialNumber} finalized for ${
        existing.customerSnapshot.companyName || existing.customerSnapshot.name
      }.`,
      entityType: 'invoice',
      entityId: invoiceId,
    });

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'INVOICE_FINALIZED',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `Finalized draft into official invoice ${officialNumber}`,
    });

    return { invoice: updated };
  },

  cancelInvoice: async (invoiceId: string, reason: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const invSnap = await get(ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`));
    if (!invSnap.exists()) throw new Error('Invoice not found');
    const existing = normalizeInvoice(invSnap.val() as Record<string, unknown>);
    if (existing.status === 'cancelled') throw new Error('Invoice is already cancelled');
    if (existing.amountPaid > 0) {
      throw new Error('Cannot cancel an invoice that has recorded payments');
    }

    const cleanReason = sanitizeStr(reason, 300) || 'Cancelled by business user';
    const now = new Date().toISOString();
    const updated: Invoice = {
      ...existing,
      status: 'cancelled',
      cancellationReason: cleanReason,
      cancelledAt: now,
      balanceDue: 0,
      updatedAt: now,
    };
    await set(ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`), stripUndefined(updated));

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'INVOICE_CANCELLED',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: `Cancelled invoice ${existing.invoiceNumber}: ${cleanReason}`,
    });

    return { invoice: updated };
  },

  // ==================== QUOTATIONS ====================
  listQuotations: async (params?: {
    search?: string;
    status?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const ctx = await requireTenantContext();
    let list = await listTenantQuotationsRaw(ctx.effectiveUser.uid);

    if (params?.status && params.status !== 'all') {
      list = list.filter((q) => q.status === params.status);
    }
    if (params?.customerId && params.customerId !== 'all') {
      list = list.filter((q) => q.customerId === params.customerId);
    }
    if (params?.startDate) {
      list = list.filter((q) => q.quotationDate >= params.startDate!);
    }
    if (params?.endDate) {
      list = list.filter((q) => q.quotationDate <= params.endDate!);
    }
    const search = (params?.search || '').trim().toLowerCase();
    if (search) {
      list = list.filter(
        (q) =>
          q.quotationNumber.toLowerCase().includes(search) ||
          q.customerSnapshot.name.toLowerCase().includes(search) ||
          q.customerSnapshot.companyName.toLowerCase().includes(search) ||
          q.referenceNumber.toLowerCase().includes(search)
      );
    }
    return { quotations: list };
  },

  getQuotation: async (quotationId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    await syncExpiredQuotations(tenantUid);
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/quotations/${quotationId}`));
    if (!snap.exists()) throw new Error('Quotation not found');
    return { quotation: normalizeQuotation(snap.val() as Record<string, unknown>) };
  },

  saveQuotation: async (input: SaveDocumentPayload, existingQuotationId?: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const cleanItems = validateLineItems(input.items);

    const [profSnap, custSnap] = await Promise.all([
      get(ref(rtdb, `businessProfiles/${tenantUid}`)),
      get(ref(rtdb, `tenants/${tenantUid}/customers/${input.customerId}`)),
    ]);
    if (!profSnap.exists()) throw new Error('Business profile not configured');
    if (!custSnap.exists()) throw new Error('Selected customer does not belong to this workspace');

    const profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
    const customer = normalizeCustomer(custSnap.val() as Record<string, unknown>);

    const resolvedLogo = resolveDocumentLogo(profile.logoDataUrl, input.logoDataUrl);
    const resolvedUpiId =
      input.upiId !== undefined ? sanitizeStr(input.upiId, 120) : profile.upiId;

    const customerSnapshot: CustomerSnapshot = {
      id: customer.id,
      name: customer.name,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      gstin: customer.gstin,
      billingAddress: customer.billingAddress,
      shippingAddress: customer.shippingAddress,
      state: customer.state,
    };

    const businessSnapshot: BusinessSnapshot = {
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

    const quotationDate = sanitizeStr(input.quotationDate, 10) || todayISO();
    const validUntil = sanitizeStr(input.validUntil, 10) || addDaysISO(quotationDate, 30);
    const placeOfSupply =
      sanitizeStr(input.placeOfSupply, 64) || customerSnapshot.state || profile.state;

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
      input.templateId &&
      ['classic_gst', 'executive_minimal', 'compact_commercial'].includes(input.templateId)
        ? input.templateId
        : profile.defaultQuotationTemplate;

    const now = new Date().toISOString();

    if (input.saveLogoToProfile && input.logoDataUrl !== undefined) {
      await update(ref(rtdb, `businessProfiles/${tenantUid}`), {
        logoDataUrl: businessSnapshot.logoDataUrl,
        updatedAt: now,
      });
    }
    if (input.saveUpiToProfile && input.upiId !== undefined) {
      await update(ref(rtdb, `businessProfiles/${tenantUid}`), {
        upiId: businessSnapshot.upiId,
        updatedAt: now,
      });
    }

    const targetId = existingQuotationId || generateId('quo');
    let quotationNumber = '';
    let status: QuotationStatus = 'draft';
    let createdAt = now;

    if (existingQuotationId) {
      const exSnap = await get(ref(rtdb, `tenants/${tenantUid}/quotations/${existingQuotationId}`));
      if (!exSnap.exists()) throw new Error('Quotation not found');
      const existing = normalizeQuotation(exSnap.val() as Record<string, unknown>);
      if (existing.status !== 'draft') throw new Error('Only draft quotations can be edited');
      createdAt = existing.createdAt;
      quotationNumber = isDraft
        ? existing.quotationNumber
        : await allocateDocumentNumber(
            tenantUid,
            'QUO',
            profile.quotationPrefix,
            quotationDate
          );
      status = isDraft ? 'draft' : validUntil < todayISO() ? 'expired' : 'sent';
    } else {
      quotationNumber = isDraft
        ? `QDRAFT-${generateId().slice(0, 5).toUpperCase()}`
        : await allocateDocumentNumber(
            tenantUid,
            'QUO',
            profile.quotationPrefix,
            quotationDate
          );
      status = isDraft ? 'draft' : validUntil < todayISO() ? 'expired' : 'sent';
    }

    const saved: Quotation = {
      id: targetId,
      userUid: tenantUid,
      quotationNumber,
      status,
      customerId: customerSnapshot.id,
      customerSnapshot,
      businessSnapshot,
      quotationDate,
      validUntil,
      referenceNumber: sanitizeStr(input.referenceNumber, 64),
      placeOfSupply,
      isGst: Boolean(input.isGst),
      taxMode: input.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
      taxSupplyMode: input.taxSupplyMode || 'auto',
      isInterState: calc.isInterState,
      roundOffEnabled: input.roundOffEnabled !== false,
      subtotal: calc.subtotal,
      totalDiscount: calc.totalDiscount,
      taxableAmount: calc.taxableAmount,
      cgstTotal: calc.cgstTotal,
      sgstTotal: calc.sgstTotal,
      igstTotal: calc.igstTotal,
      totalTax: calc.totalTax,
      roundOff: calc.roundOff,
      grandTotal: calc.grandTotal,
      amountInWords: calc.amountInWords,
      templateId,
      notes: sanitizeStr(input.notes, 1000),
      terms: sanitizeStr(input.terms ?? profile.termsAndConditions, 1500),
      convertedInvoiceId: null,
      createdAt,
      updatedAt: now,
      items: calc.items.map((it, idx) => ({ ...it, id: it.id || `qit_${idx + 1}` })),
    };

    await set(ref(rtdb, `tenants/${tenantUid}/quotations/${targetId}`), stripUndefined(saved));

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: existingQuotationId
        ? isDraft
          ? 'QUOTATION_DRAFT_UPDATED'
          : 'QUOTATION_SENT'
        : isDraft
          ? 'QUOTATION_DRAFT_CREATED'
          : 'QUOTATION_CREATED',
      entityType: 'quotation',
      entityId: targetId,
      summary: `${existingQuotationId ? 'Updated' : 'Created'} quotation ${quotationNumber} (INR ${calc.grandTotal.toFixed(2)})`,
    });

    return { quotation: saved };
  },

  setQuotationStatus: async (quotationId: string, status: 'sent' | 'accepted' | 'rejected') => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const quoRef = ref(rtdb, `tenants/${tenantUid}/quotations/${quotationId}`);
    const snap = await get(quoRef);
    if (!snap.exists()) throw new Error('Quotation not found');
    const q = normalizeQuotation(snap.val() as Record<string, unknown>);
    if (q.status === 'converted') throw new Error('Converted quotations cannot change status');

    const now = new Date().toISOString();
    const updated: Quotation = { ...q, status, updatedAt: now };
    await set(quoRef, stripUndefined(updated));

    if (status === 'accepted') {
      await createNotification({
        userUid: tenantUid,
        type: 'quotation_accepted',
        title: 'Quotation accepted',
        message: `Quotation ${q.quotationNumber} marked accepted.`,
        entityType: 'quotation',
        entityId: quotationId,
      });
    }

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'QUOTATION_STATUS_UPDATED',
      entityType: 'quotation',
      entityId: quotationId,
      summary: `Marked quotation ${q.quotationNumber} as ${status}`,
    });

    return { quotation: updated };
  },

  convertQuotationToInvoice: async (quotationId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const [profSnap, quoSnap] = await Promise.all([
      get(ref(rtdb, `businessProfiles/${tenantUid}`)),
      get(ref(rtdb, `tenants/${tenantUid}/quotations/${quotationId}`)),
    ]);
    if (!profSnap.exists()) throw new Error('Business profile not configured');
    if (!quoSnap.exists()) throw new Error('Quotation not found');

    const profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
    const quo = normalizeQuotation(quoSnap.val() as Record<string, unknown>);

    if (quo.status === 'converted' || quo.convertedInvoiceId) {
      throw new Error('This quotation has already been converted into an invoice');
    }
    if (quo.status === 'rejected') {
      throw new Error('Rejected quotations cannot be converted');
    }

    const today = todayISO();
    const dueDate = addDaysISO(today, profile.defaultPaymentTermsDays);
    const invoiceNumber = await allocateDocumentNumber(
      tenantUid,
      'INV',
      profile.invoicePrefix,
      today
    );
    const newInvId = generateId('inv');
    const now = new Date().toISOString();

    const invoice: Invoice = {
      id: newInvId,
      userUid: tenantUid,
      invoiceNumber,
      status: 'unpaid',
      customerId: quo.customerId,
      customerSnapshot: quo.customerSnapshot,
      businessSnapshot: quo.businessSnapshot,
      invoiceDate: today,
      dueDate,
      paymentTerms: `Net ${profile.defaultPaymentTermsDays}`,
      referenceNumber: quo.referenceNumber || quo.quotationNumber,
      placeOfSupply: quo.placeOfSupply,
      isGst: quo.isGst,
      taxMode: quo.taxMode,
      taxSupplyMode: quo.taxSupplyMode,
      isInterState: quo.isInterState,
      roundOffEnabled: quo.roundOffEnabled,
      subtotal: quo.subtotal,
      totalDiscount: quo.totalDiscount,
      taxableAmount: quo.taxableAmount,
      cgstTotal: quo.cgstTotal,
      sgstTotal: quo.sgstTotal,
      igstTotal: quo.igstTotal,
      totalTax: quo.totalTax,
      roundOff: quo.roundOff,
      grandTotal: quo.grandTotal,
      amountPaid: 0,
      balanceDue: quo.grandTotal,
      amountInWords: quo.amountInWords,
      templateId: profile.defaultInvoiceTemplate,
      notes: quo.notes,
      terms: quo.terms,
      sourceQuotationId: quo.id,
      cancellationReason: null,
      cancelledAt: null,
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
      items: quo.items.map((it, idx) => ({ ...it, id: `itm_${idx + 1}` })),
    };

    await set(ref(rtdb, `tenants/${tenantUid}/invoices/${newInvId}`), stripUndefined(invoice));
    await update(ref(rtdb, `tenants/${tenantUid}/quotations/${quo.id}`), {
      status: 'converted',
      convertedInvoiceId: newInvId,
      updatedAt: now,
    });

    await createNotification({
      userUid: tenantUid,
      type: 'quotation_converted',
      title: 'Quotation converted to invoice',
      message: `Quotation ${quo.quotationNumber} converted to invoice ${invoiceNumber}.`,
      entityType: 'invoice',
      entityId: newInvId,
    });

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'QUOTATION_CONVERTED',
      entityType: 'invoice',
      entityId: newInvId,
      summary: `Converted quotation ${quo.quotationNumber} into invoice ${invoiceNumber}`,
    });

    return { invoice };
  },

  // ==================== PAYMENTS ====================
  listPayments: async (params?: {
    search?: string;
    customerId?: string;
    method?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const ctx = await requireTenantContext();
    let list = await listTenantPaymentsRaw(ctx.effectiveUser.uid);
    if (params?.customerId && params.customerId !== 'all') {
      list = list.filter((p) => p.customerId === params.customerId);
    }
    if (params?.method && params.method !== 'all') {
      list = list.filter((p) => p.paymentMethod === params.method);
    }
    if (params?.startDate) {
      list = list.filter((p) => p.paymentDate >= params.startDate!);
    }
    if (params?.endDate) {
      list = list.filter((p) => p.paymentDate <= params.endDate!);
    }
    const search = (params?.search || '').trim().toLowerCase();
    if (search) {
      list = list.filter(
        (p) =>
          p.receiptNumber.toLowerCase().includes(search) ||
          (p.invoiceNumber || '').toLowerCase().includes(search) ||
          (p.customerName || '').toLowerCase().includes(search) ||
          p.referenceId.toLowerCase().includes(search)
      );
    }
    return { payments: list };
  },

  recordPayment: async (input: {
    invoiceId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceId?: string;
    notes?: string;
  }) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const amountPaise = toPaise(Number(input.amount));
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    const invRef = ref(rtdb, `tenants/${tenantUid}/invoices/${input.invoiceId}`);
    const invSnap = await get(invRef);
    if (!invSnap.exists()) throw new Error('Invoice not found');
    const inv = normalizeInvoice(invSnap.val() as Record<string, unknown>);

    if (inv.status === 'draft') throw new Error('Cannot record payment on a draft invoice');
    if (inv.status === 'cancelled') throw new Error('Cannot record payment on a cancelled invoice');

    const balancePaise = toPaise(inv.balanceDue);
    if (amountPaise > balancePaise) {
      throw new Error(
        `Payment exceeds remaining balance due (${inv.balanceDue.toFixed(2)})`
      );
    }

    const refId = sanitizeStr(input.referenceId, 80);
    if (refId) {
      const existingPayments = await listTenantPaymentsRaw(tenantUid);
      if (existingPayments.some((p) => p.referenceId && p.referenceId === refId)) {
        throw new Error(`Duplicate payment reference ID "${refId}" detected`);
      }
    }

    const paymentDate = sanitizeStr(input.paymentDate, 10) || todayISO();
    const receiptNumber = await allocateDocumentNumber(tenantUid, 'RCP', 'RCP', paymentDate);
    const payId = generateId('pay');
    const now = new Date().toISOString();

    const newPaidPaise = toPaise(inv.amountPaid) + amountPaise;
    const newBalancePaise = Math.max(0, toPaise(inv.grandTotal) - newPaidPaise);
    const nextStatus: InvoiceStatus =
      newBalancePaise === 0
        ? 'paid'
        : inv.dueDate < todayISO()
          ? 'overdue'
          : 'partially_paid';

    const payment: Payment = {
      id: payId,
      userUid: tenantUid,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      customerName: inv.customerSnapshot.companyName || inv.customerSnapshot.name,
      paymentDate,
      amount: fromPaise(amountPaise),
      paymentMethod: input.paymentMethod || 'UPI',
      referenceId: refId,
      notes: sanitizeStr(input.notes, 300),
      receiptNumber,
      createdAt: now,
    };

    await set(ref(rtdb, `tenants/${tenantUid}/payments/${payId}`), stripUndefined(payment));
    await update(invRef, {
      amountPaid: fromPaise(newPaidPaise),
      balanceDue: fromPaise(newBalancePaise),
      status: nextStatus,
      updatedAt: now,
    });

    await createNotification({
      userUid: tenantUid,
      type: 'payment_received',
      title: 'Payment recorded',
      message: `Received INR ${fromPaise(amountPaise).toFixed(2)} against ${inv.invoiceNumber}.`,
      entityType: 'payment',
      entityId: payId,
    });

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: payId,
      summary: `Recorded ${input.paymentMethod} payment of INR ${fromPaise(amountPaise).toFixed(2)} on ${inv.invoiceNumber} (${receiptNumber})`,
    });

    return { payment };
  },

  // ==================== ANALYTICS & REPORTS ====================
  getDashboardAnalytics: async (params?: {
    range?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const ctx = await requireTenantContext();
    return computeCustomerAnalyticsForTenant(ctx.effectiveUser.uid, params);
  },

  getOutstandingReport: async (params?: {
    filter?: 'all' | 'not_due' | 'overdue';
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ rows: OutstandingReportRow[] }> => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const invoices = await listTenantInvoicesRaw(tenantUid);
    const today = todayISO();

    const filteredInvoices = invoices.filter((inv) => {
      if (inv.status === 'draft' || inv.status === 'cancelled') return false;
      if (params?.customerId && params.customerId !== 'all' && inv.customerId !== params.customerId) {
        return false;
      }
      if (params?.startDate && inv.invoiceDate < params.startDate) return false;
      if (params?.endDate && inv.invoiceDate > params.endDate) return false;
      if (params?.filter === 'overdue' && !(inv.dueDate < today && inv.balanceDue > 0)) return false;
      if (params?.filter === 'not_due' && !(inv.dueDate >= today && inv.balanceDue > 0)) return false;
      return true;
    });

    const byCustomer = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        companyName: string;
        email: string;
        phone: string;
        invoicedPaise: number;
        paidPaise: number;
        outstandingPaise: number;
        unpaidInvoiceCount: number;
        overduePaise: number;
        oldestDueDate: string | null;
      }
    >();

    for (const inv of filteredInvoices) {
      const cur = byCustomer.get(inv.customerId) || {
        customerId: inv.customerId,
        customerName: inv.customerSnapshot.name,
        companyName: inv.customerSnapshot.companyName,
        email: inv.customerSnapshot.email,
        phone: inv.customerSnapshot.phone,
        invoicedPaise: 0,
        paidPaise: 0,
        outstandingPaise: 0,
        unpaidInvoiceCount: 0,
        overduePaise: 0,
        oldestDueDate: null,
      };
      cur.invoicedPaise += toPaise(inv.grandTotal);
      cur.paidPaise += toPaise(inv.amountPaid);
      const balPaise = toPaise(inv.balanceDue);
      cur.outstandingPaise += balPaise;
      if (balPaise > 0) {
        cur.unpaidInvoiceCount += 1;
        if (inv.dueDate < today) cur.overduePaise += balPaise;
        if (!cur.oldestDueDate || inv.dueDate < cur.oldestDueDate) {
          cur.oldestDueDate = inv.dueDate;
        }
      }
      byCustomer.set(inv.customerId, cur);
    }

    const rows: OutstandingReportRow[] = Array.from(byCustomer.values())
      .filter((r) => r.outstandingPaise > 0)
      .sort((a, b) => b.outstandingPaise - a.outstandingPaise)
      .map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        companyName: r.companyName,
        email: r.email,
        phone: r.phone,
        totalInvoiced: fromPaise(r.invoicedPaise),
        amountPaid: fromPaise(r.paidPaise),
        outstandingBalance: fromPaise(r.outstandingPaise),
        unpaidInvoiceCount: r.unpaidInvoiceCount,
        overdueAmount: fromPaise(r.overduePaise),
        oldestDueDate: r.oldestDueDate,
      }));

    return { rows };
  },

  // ==================== NOTIFICATIONS ====================
  listNotifications: async () => {
    const ctx = await requireTenantContext();
    const snap = await get(ref(rtdb, `tenants/${ctx.effectiveUser.uid}/notifications`));
    if (!snap.exists()) return { notifications: [] };
    const notifications = Object.values(
      snap.val() as Record<string, Record<string, unknown>>
    )
      .map(normalizeNotification)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40);
    return { notifications };
  },

  markNotificationRead: async (id: string) => {
    const ctx = await requireTenantContext();
    await update(ref(rtdb, `tenants/${ctx.effectiveUser.uid}/notifications/${id}`), {
      isRead: true,
    });
    return { ok: true };
  },

  markAllNotificationsRead: async () => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/notifications`));
    if (!snap.exists()) return { ok: true };
    const updates: Record<string, unknown> = {};
    for (const id of Object.keys(snap.val() as Record<string, unknown>)) {
      updates[`tenants/${tenantUid}/notifications/${id}/isRead`] = true;
    }
    await update(ref(rtdb), updates);
    return { ok: true };
  },

  // ==================== SUPER ADMIN ====================
  getAdminDashboard: async (params?: {
    range?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<AdminDashboardData> => {
    await requireSuperAdminContext();
    const { start, end } = buildDateRangeBounds(params?.range, params?.startDate, params?.endDate);

    const [usersSnap, tenantsSnap, logsSnap] = await Promise.all([
      get(ref(rtdb, 'users')),
      get(ref(rtdb, 'tenants')),
      get(ref(rtdb, 'activityLogs')),
    ]);

    const allUsers = usersSnap.exists()
      ? Object.entries(usersSnap.val() as Record<string, Record<string, unknown>>)
          .map(([uid, raw]) => normalizeUserRecord(uid, raw))
          .filter((u) => u.role === 'business')
      : [];

    const tenantsMap = tenantsSnap.exists()
      ? (tenantsSnap.val() as Record<string, Record<string, unknown>>)
      : {};

    const allInvoices: Invoice[] = [];
    const allQuotations: Quotation[] = [];
    const allPayments: Payment[] = [];

    for (const u of allUsers) {
      const t = tenantsMap[u.uid] || {};
      const invObj = (t.invoices as Record<string, Record<string, unknown>>) || {};
      const quoObj = (t.quotations as Record<string, Record<string, unknown>>) || {};
      const payObj = (t.payments as Record<string, Record<string, unknown>>) || {};
      for (const r of Object.values(invObj)) allInvoices.push(normalizeInvoice(r));
      for (const r of Object.values(quoObj)) allQuotations.push(normalizeQuotation(r));
      for (const r of Object.values(payObj)) allPayments.push(normalizePayment(r));
    }

    const rangedInvoices = allInvoices.filter(
      (i) =>
        i.status !== 'draft' &&
        i.status !== 'cancelled' &&
        i.invoiceDate >= start &&
        i.invoiceDate <= end
    );
    const rangedQuotations = allQuotations.filter(
      (q) => q.quotationDate >= start && q.quotationDate <= end
    );
    const rangedPayments = allPayments.filter(
      (p) => p.paymentDate >= start && p.paymentDate <= end
    );

    const activeAccounts = allUsers.filter((u) => u.status === 'active').length;
    const inactiveAccounts = allUsers.filter((u) => u.status !== 'active').length;
    const dronaSubscriptionRevenue = allUsers
      .filter((u) => u.status === 'active')
      .reduce((s, u) => s + Number(u.subscriptionAmount || 0), 0);

    const useDaily = params?.range === 'today' || params?.range === 'week';
    const seriesMap = new Map<
      string,
      { invoicedPaise: number; paymentsPaise: number; invoiceCount: number }
    >();

    for (const inv of rangedInvoices) {
      const key = useDaily ? inv.invoiceDate : inv.invoiceDate.slice(0, 7);
      const cur = seriesMap.get(key) || { invoicedPaise: 0, paymentsPaise: 0, invoiceCount: 0 };
      cur.invoicedPaise += toPaise(inv.grandTotal);
      cur.invoiceCount += 1;
      seriesMap.set(key, cur);
    }
    for (const pay of rangedPayments) {
      const key = useDaily ? pay.paymentDate : pay.paymentDate.slice(0, 7);
      const cur = seriesMap.get(key) || { invoicedPaise: 0, paymentsPaise: 0, invoiceCount: 0 };
      cur.paymentsPaise += toPaise(pay.amount);
      seriesMap.set(key, cur);
    }

    const usageSeries = Array.from(seriesMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({
        period,
        label: useDaily ? period.slice(5) : period,
        invoicedValue: fromPaise(v.invoicedPaise),
        paymentsRecorded: fromPaise(v.paymentsPaise),
        dronaRevenue: dronaSubscriptionRevenue,
        invoiceCount: v.invoiceCount,
      }));

    const recentBusinesses = [...allUsers]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((u) => {
        const t = tenantsMap[u.uid] || {};
        const invList = Object.values(
          (t.invoices as Record<string, Record<string, unknown>>) || {}
        ).map(normalizeInvoice);
        const quoCount = Object.keys((t.quotations as Record<string, unknown>) || {}).length;
        const salesPaise = invList
          .filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
          .reduce((s, i) => s + toPaise(i.grandTotal), 0);
        return {
          ...u,
          invoiceCount: invList.length,
          quotationCount: quoCount,
          totalSales: fromPaise(salesPaise),
        };
      });

    const recentActivity = logsSnap.exists()
      ? Object.values(logsSnap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeActivityLog)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 15)
      : [];

    return {
      summary: {
        totalBusinesses: allUsers.length,
        activeAccounts,
        inactiveAccounts,
        totalInvoicesGenerated: rangedInvoices.length,
        totalQuotationsGenerated: rangedQuotations.length,
        platformInvoicedValue: fromPaise(
          rangedInvoices.reduce((s, i) => s + toPaise(i.grandTotal), 0)
        ),
        platformPaymentsRecorded: fromPaise(
          rangedPayments.reduce((s, p) => s + toPaise(p.amount), 0)
        ),
        dronaSubscriptionRevenue,
      },
      usageSeries,
      recentBusinesses,
      recentActivity,
    };
  },

  adminListUsers: async (params?: { search?: string; status?: string }): Promise<{
    users: AdminUserRow[];
  }> => {
    await requireSuperAdminContext();
    const [usersSnap, tenantsSnap] = await Promise.all([
      get(ref(rtdb, 'users')),
      get(ref(rtdb, 'tenants')),
    ]);

    const tenantsMap = tenantsSnap.exists()
      ? (tenantsSnap.val() as Record<string, Record<string, unknown>>)
      : {};
    const search = (params?.search || '').trim().toLowerCase();

    const list: AdminUserRow[] = usersSnap.exists()
      ? Object.entries(usersSnap.val() as Record<string, Record<string, unknown>>)
          .map(([uid, raw]) => normalizeUserRecord(uid, raw))
          .filter((u) => u.role === 'business')
          .filter((u) => !params?.status || params.status === 'all' || u.status === params.status)
          .map((u) => {
            const t = tenantsMap[u.uid] || {};
            const invList = Object.values(
              (t.invoices as Record<string, Record<string, unknown>>) || {}
            ).map(normalizeInvoice);
            const quoCount = Object.keys((t.quotations as Record<string, unknown>) || {}).length;
            const payList = Object.values(
              (t.payments as Record<string, Record<string, unknown>>) || {}
            ).map(normalizePayment);
            const salesPaise = invList
              .filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
              .reduce((s, i) => s + toPaise(i.grandTotal), 0);
            const collectedPaise = payList.reduce((s, p) => s + toPaise(p.amount), 0);

            return {
              ...u,
              invoiceCount: invList.length,
              quotationCount: quoCount,
              totalSales: fromPaise(salesPaise),
              totalCollected: fromPaise(collectedPaise),
            };
          })
          .filter((u) => {
            if (!search) return true;
            return (
              u.businessName.toLowerCase().includes(search) ||
              u.ownerName.toLowerCase().includes(search) ||
              u.email.toLowerCase().includes(search) ||
              u.gstin.toLowerCase().includes(search)
            );
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];

    return { users: list };
  },

  adminCreateUser: async (payload: {
    email: string;
    password: string;
    ownerName: string;
    businessName: string;
    phone: string;
    gstin: string;
    state: string;
    address?: string;
    subscriptionPlan: string;
    subscriptionAmount: number;
  }): Promise<{ user: UserRecord }> => {
    const ctx = await requireSuperAdminContext();
    const settings = await ensurePlatformSettings();

    const email = sanitizeStr(payload.email, 160).toLowerCase();
    const ownerName = sanitizeStr(payload.ownerName, 120);
    const businessName = sanitizeStr(payload.businessName, 160);
    const phone = sanitizeStr(payload.phone, 32);
    const gstin = sanitizeStr(payload.gstin, 20).toUpperCase();
    const state = sanitizeStr(payload.state, 64) || 'Maharashtra';
    const address = sanitizeStr(payload.address, 400);
    const subscriptionPlan = sanitizeStr(payload.subscriptionPlan, 40) || 'Growth';
    const subscriptionAmount = Math.max(0, Number(payload.subscriptionAmount) || 0);

    if (!email || !email.includes('@')) throw new Error('Valid email is required');
    if (!payload.password || payload.password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    if (!ownerName || !businessName) {
      throw new Error('Owner name and business name are required');
    }
    if (gstin && !isValidGstin(gstin)) throw new Error('Invalid GSTIN format');

    try {
      const secAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secAuth, email, payload.password);
      const uid = cred.user.uid;
      await signOut(secAuth);

      const now = new Date().toISOString();
      const userRec: UserRecord = {
        uid,
        email,
        role: 'business',
        status: 'active',
        ownerName,
        businessName,
        phone,
        gstin,
        subscriptionPlan,
        subscriptionAmount,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      };
      const profileRec = normalizeBusinessProfile(uid, {
        userUid: uid,
        businessName,
        ownerName,
        address,
        email,
        phone,
        gstin,
        state,
        invoicePrefix: settings.defaultInvoicePrefix,
        quotationPrefix: settings.defaultQuotationPrefix,
        signatureLabel: `For ${businessName}`,
        updatedAt: now,
      });

      await set(ref(rtdb, `users/${uid}`), stripUndefined(userRec));
      await set(ref(rtdb, `businessProfiles/${uid}`), stripUndefined(profileRec));

      await logActivity({
        actor: ctx.actorUser,
        targetTenantUid: uid,
        action: 'ADMIN_CREATED_USER',
        entityType: 'user',
        entityId: uid,
        summary: `Drona Admin provisioned business account for ${businessName} (${email})`,
      });

      return { user: userRec };
    } catch (err) {
      throw mapFirebaseError(err, 'Failed to create customer account');
    }
  },

  adminGetUserDetails: async (uid: string) => {
    await requireSuperAdminContext();
    const [userSnap, profSnap, invoices, quotations, analytics, logsSnap] = await Promise.all([
      get(ref(rtdb, `users/${uid}`)),
      get(ref(rtdb, `businessProfiles/${uid}`)),
      listTenantInvoicesRaw(uid),
      listTenantQuotationsRaw(uid),
      computeCustomerAnalyticsForTenant(uid),
      get(ref(rtdb, `tenants/${uid}/activityLogs`)),
    ]);

    if (!userSnap.exists()) throw new Error('User not found');
    const user = normalizeUserRecord(uid, userSnap.val() as Record<string, unknown>);
    const profile = profSnap.exists()
      ? normalizeBusinessProfile(uid, profSnap.val() as Record<string, unknown>)
      : null;
    const logs = logsSnap.exists()
      ? Object.values(logsSnap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeActivityLog)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 30)
      : [];

    return { user, profile, invoices, quotations, analytics, logs };
  },

  adminUpdateUser: async (
    uid: string,
    payload: {
      businessName?: string;
      ownerName?: string;
      phone?: string;
      gstin?: string;
      subscriptionPlan?: string;
      subscriptionAmount?: number;
    }
  ) => {
    const ctx = await requireSuperAdminContext();
    const userSnap = await get(ref(rtdb, `users/${uid}`));
    if (!userSnap.exists()) throw new Error('User not found');
    const existing = normalizeUserRecord(uid, userSnap.val() as Record<string, unknown>);

    const gstin = sanitizeStr(payload.gstin ?? existing.gstin, 20).toUpperCase();
    if (gstin && !isValidGstin(gstin)) throw new Error('Invalid GSTIN format');

    const now = new Date().toISOString();
    const updated: UserRecord = {
      ...existing,
      businessName: sanitizeStr(payload.businessName ?? existing.businessName, 160) || existing.businessName,
      ownerName: sanitizeStr(payload.ownerName ?? existing.ownerName, 120) || existing.ownerName,
      phone: sanitizeStr(payload.phone ?? existing.phone, 32),
      gstin,
      subscriptionPlan: sanitizeStr(payload.subscriptionPlan ?? existing.subscriptionPlan, 40) || 'Growth',
      subscriptionAmount: Math.max(
        0,
        Number(payload.subscriptionAmount ?? existing.subscriptionAmount) || 0
      ),
      updatedAt: now,
    };

    await set(ref(rtdb, `users/${uid}`), stripUndefined(updated));
    await update(ref(rtdb, `businessProfiles/${uid}`), {
      businessName: updated.businessName,
      ownerName: updated.ownerName,
      phone: updated.phone,
      gstin: updated.gstin,
      updatedAt: now,
    });

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: uid,
      action: 'ADMIN_UPDATED_USER',
      entityType: 'user',
      entityId: uid,
      summary: `Drona Admin updated account profile for ${updated.businessName}`,
    });

    return { user: updated };
  },

  adminSetUserStatus: async (uid: string, status: 'active' | 'inactive') => {
    const ctx = await requireSuperAdminContext();
    const userSnap = await get(ref(rtdb, `users/${uid}`));
    if (!userSnap.exists()) throw new Error('User not found');
    const existing = normalizeUserRecord(uid, userSnap.val() as Record<string, unknown>);
    if (existing.role === 'super_admin') {
      throw new Error('Cannot deactivate a super admin account');
    }

    await update(ref(rtdb, `users/${uid}`), {
      status,
      updatedAt: new Date().toISOString(),
    });

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: uid,
      action: status === 'active' ? 'ADMIN_ACTIVATED_USER' : 'ADMIN_DEACTIVATED_USER',
      entityType: 'user',
      entityId: uid,
      summary: `Drona Admin ${status === 'active' ? 'activated' : 'deactivated'} ${existing.businessName}`,
    });

    return { ok: true, status };
  },

  adminResetUserPassword: async (uid: string) => {
    const ctx = await requireSuperAdminContext();
    const userSnap = await get(ref(rtdb, `users/${uid}`));
    if (!userSnap.exists()) throw new Error('User not found');
    const target = normalizeUserRecord(uid, userSnap.val() as Record<string, unknown>);

    try {
      await sendPasswordResetEmail(firebaseAuth, target.email);
      await logActivity({
        actor: ctx.actorUser,
        targetTenantUid: uid,
        action: 'ADMIN_PASSWORD_RESET_SENT',
        entityType: 'user',
        entityId: uid,
        summary: `Drona Admin sent Firebase password reset email to ${target.email}`,
      });
      return { ok: true };
    } catch (err) {
      throw mapFirebaseError(err, 'Failed to send password reset email');
    }
  },

  adminImpersonate: async (targetUid: string): Promise<{ session: AuthSessionState }> => {
    const ctx = await requireSuperAdminContext();
    const targetSnap = await get(ref(rtdb, `users/${targetUid}`));
    if (!targetSnap.exists()) throw new Error('Target customer not found');
    const target = normalizeUserRecord(targetUid, targetSnap.val() as Record<string, unknown>);
    if (target.role !== 'business') {
      throw new Error('Only business customer accounts can be impersonated');
    }

    const impId = generateId('imp');
    const now = new Date();
    const expires = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const impSession: ImpersonationSession = {
      id: impId,
      adminUid: ctx.actorUser.uid,
      adminEmail: ctx.actorUser.email,
      targetUid,
      targetBusinessName: target.businessName,
      startedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      endedAt: null,
      active: true,
    };

    await set(ref(rtdb, `impersonationSessions/${impId}`), stripUndefined(impSession));
    setStoredImpersonationId(impId);

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: targetUid,
      impersonationSessionId: impId,
      action: 'ADMIN_IMPERSONATION_STARTED',
      entityType: 'impersonation',
      entityId: impId,
      summary: `Admin ${ctx.actorUser.email} entered customer workspace for ${target.businessName}`,
    });

    const session = await resolveCurrentAuthContext();
    return { session };
  },

  adminExitImpersonation: async (): Promise<{ session: AuthSessionState }> => {
    const ctx = await requireSuperAdminContext();
    const impId = ctx.impersonationSession?.id || getStoredImpersonationId();

    if (impId) {
      const impSnap = await get(ref(rtdb, `impersonationSessions/${impId}`));
      if (impSnap.exists()) {
        const imp = impSnap.val() as ImpersonationSession;
        await update(ref(rtdb, `impersonationSessions/${impId}`), {
          active: false,
          endedAt: new Date().toISOString(),
        });
        await logActivity({
          actor: ctx.actorUser,
          targetTenantUid: imp.targetUid,
          impersonationSessionId: impId,
          action: 'ADMIN_IMPERSONATION_ENDED',
          entityType: 'impersonation',
          entityId: impId,
          summary: `Admin ${ctx.actorUser.email} exited customer workspace for ${imp.targetBusinessName}`,
        });
      }
    }

    setStoredImpersonationId(null);
    const session = await resolveCurrentAuthContext();
    return { session };
  },

  adminListInvoices: async (params?: { search?: string; status?: string }) => {
    await requireSuperAdminContext();
    const [usersSnap, tenantsSnap] = await Promise.all([
      get(ref(rtdb, 'users')),
      get(ref(rtdb, 'tenants')),
    ]);
    const usersMap = usersSnap.exists()
      ? (usersSnap.val() as Record<string, Record<string, unknown>>)
      : {};
    const tenantsMap = tenantsSnap.exists()
      ? (tenantsSnap.val() as Record<string, Record<string, unknown>>)
      : {};

    const search = (params?.search || '').trim().toLowerCase();
    const status = params?.status && params.status !== 'all' ? params.status : '';

    const rows: Array<{
      id: string;
      userUid: string;
      tenantBusinessName: string;
      invoiceNumber: string;
      customerName: string;
      invoiceDate: string;
      dueDate: string;
      status: string;
      grandTotal: number;
      amountPaid: number;
      balanceDue: number;
    }> = [];

    for (const [uid, t] of Object.entries(tenantsMap)) {
      const tenantBusinessName = String(usersMap[uid]?.businessName || 'Business');
      const invObj = (t.invoices as Record<string, Record<string, unknown>>) || {};
      for (const raw of Object.values(invObj)) {
        const inv = normalizeInvoice(raw);
        if (status && inv.status !== status) continue;
        const customerName = inv.customerSnapshot.companyName || inv.customerSnapshot.name;
        if (
          search &&
          !inv.invoiceNumber.toLowerCase().includes(search) &&
          !tenantBusinessName.toLowerCase().includes(search) &&
          !customerName.toLowerCase().includes(search)
        ) {
          continue;
        }
        rows.push({
          id: inv.id,
          userUid: uid,
          tenantBusinessName,
          invoiceNumber: inv.invoiceNumber,
          customerName,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          status: inv.status,
          grandTotal: inv.grandTotal,
          amountPaid: inv.amountPaid,
          balanceDue: inv.balanceDue,
        });
      }
    }

    rows.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
    return { invoices: rows };
  },

  adminListQuotations: async (params?: { search?: string; status?: string }) => {
    await requireSuperAdminContext();
    const [usersSnap, tenantsSnap] = await Promise.all([
      get(ref(rtdb, 'users')),
      get(ref(rtdb, 'tenants')),
    ]);
    const usersMap = usersSnap.exists()
      ? (usersSnap.val() as Record<string, Record<string, unknown>>)
      : {};
    const tenantsMap = tenantsSnap.exists()
      ? (tenantsSnap.val() as Record<string, Record<string, unknown>>)
      : {};

    const search = (params?.search || '').trim().toLowerCase();
    const status = params?.status && params.status !== 'all' ? params.status : '';

    const rows: Array<{
      id: string;
      userUid: string;
      tenantBusinessName: string;
      quotationNumber: string;
      customerName: string;
      quotationDate: string;
      validUntil: string;
      status: string;
      grandTotal: number;
    }> = [];

    for (const [uid, t] of Object.entries(tenantsMap)) {
      const tenantBusinessName = String(usersMap[uid]?.businessName || 'Business');
      const quoObj = (t.quotations as Record<string, Record<string, unknown>>) || {};
      for (const raw of Object.values(quoObj)) {
        const q = normalizeQuotation(raw);
        if (status && q.status !== status) continue;
        const customerName = q.customerSnapshot.companyName || q.customerSnapshot.name;
        if (
          search &&
          !q.quotationNumber.toLowerCase().includes(search) &&
          !tenantBusinessName.toLowerCase().includes(search) &&
          !customerName.toLowerCase().includes(search)
        ) {
          continue;
        }
        rows.push({
          id: q.id,
          userUid: uid,
          tenantBusinessName,
          quotationNumber: q.quotationNumber,
          customerName,
          quotationDate: q.quotationDate,
          validUntil: q.validUntil,
          status: q.status,
          grandTotal: q.grandTotal,
        });
      }
    }

    rows.sort((a, b) => b.quotationDate.localeCompare(a.quotationDate));
    return { quotations: rows };
  },

  adminListActivityLogs: async (limit = 150) => {
    await requireSuperAdminContext();
    const snap = await get(ref(rtdb, 'activityLogs'));
    if (!snap.exists()) return { logs: [] };
    const logs = Object.values(snap.val() as Record<string, Record<string, unknown>>)
      .map(normalizeActivityLog)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return { logs };
  },

  adminListImpersonationHistory: async () => {
    await requireSuperAdminContext();
    const snap = await get(ref(rtdb, 'impersonationSessions'));
    if (!snap.exists()) return { sessions: [] };
    const sessions = Object.values(snap.val() as Record<string, ImpersonationSession>).sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt)
    );
    return { sessions };
  },

  adminGetSettings: async () => {
    await requireSuperAdminContext();
    const settings = await ensurePlatformSettings();
    return { settings };
  },

  adminUpdateSettings: async (input: Partial<PlatformSettings>) => {
    const ctx = await requireSuperAdminContext();
    const cur = await ensurePlatformSettings();
    const updated: PlatformSettings = {
      allowSelfRegistration:
        input.allowSelfRegistration !== undefined
          ? Boolean(input.allowSelfRegistration)
          : cur.allowSelfRegistration,
      platformName: sanitizeStr(input.platformName ?? cur.platformName, 80) || 'DRONA Invoice Manager',
      supportEmail: sanitizeStr(input.supportEmail ?? cur.supportEmail, 160) || 'support@drona.in',
      defaultCurrency: 'INR',
      defaultInvoicePrefix:
        sanitizeStr(input.defaultInvoicePrefix ?? cur.defaultInvoicePrefix, 12).toUpperCase() || 'INV',
      defaultQuotationPrefix:
        sanitizeStr(input.defaultQuotationPrefix ?? cur.defaultQuotationPrefix, 12).toUpperCase() || 'QTN',
      defaultSubscriptionMonthly: Math.max(
        0,
        Number(input.defaultSubscriptionMonthly ?? cur.defaultSubscriptionMonthly) || 0
      ),
      maintenanceMode:
        input.maintenanceMode !== undefined ? Boolean(input.maintenanceMode) : cur.maintenanceMode,
      updatedAt: new Date().toISOString(),
    };
    await set(ref(rtdb, 'platformSettings'), stripUndefined(updated));
    await logActivity({
      actor: ctx.actorUser,
      action: 'PLATFORM_SETTINGS_UPDATED',
      entityType: 'platform_settings',
      entityId: 'global',
      summary: 'Updated DRONA platform settings',
    });
    return { settings: updated };
  },
};
