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
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import { firebaseAuth, firebaseStorage, getSecondaryAuth, rtdb } from './firebase';
import { mergeDocumentWithLiveSnapshotsSync } from './liveSnapshots';
import {
  allocateLocalDocNumber,
  cascadeBusinessSnapshotInCache,
  cascadeCustomerSnapshotInCache,
  clearAllRuntimeSessionCaches,
  dedupeFetch,
  enqueuePendingSyncOp,
  getAdminCache,
  getCachedPublicSettings,
  getCachedSession,
  getCachedSessionTimestamp,
  getPendingSyncOps,
  getTenantEntry,
  getTenantExpiryCheckDate,
  getTenantOverdueCheckDate,
  getTenantPurchaseOverdueCheckDate,
  hasPendingSyncForProfile,
  hasTenantCollectionData,
  invalidateAdminSlices,
  invalidateTenantCollection,
  isAdminSliceFresh,
  isTenantCollectionFresh,
  markNotificationReadCache,
  markTenantSyncedNow,
  prependTenantActivityLogCache,
  removePendingSyncOp,
  removeTenantCustomerCache,
  removeTenantPaymentCache,
  removeTenantPurchaseCache,
  removeTenantPurchasePaymentCache,
  removeTenantRateCardCache,
  removeTenantSupplierCache,
  setAdminSliceData,
  setCachedPublicSettings,
  setCachedSession,
  setTenantCollectionData,
  setTenantExpiryCheckDate,
  setTenantOverdueCheckDate,
  setTenantProfileCache,
  setTenantPurchaseOverdueCheckDate,
  subscribeAdminCache,
  subscribeTenantCache,
  syncRemoteCounterCache,
  upsertTenantCustomerCache,
  upsertTenantInvoiceCache,
  upsertTenantNotificationCache,
  upsertTenantPaymentCache,
  upsertTenantPurchaseAttachmentCache,
  upsertTenantPurchaseCache,
  upsertTenantPurchasePaymentCache,
  upsertTenantQuotationCache,
  upsertTenantRateCardCache,
  upsertTenantSupplierCache,
  type TenantCollection,
  type TenantMetaMap,
} from './localCache';
import {
  computeDocumentTotals,
  computePurchaseTotals,
  fromPaise,
  toPaise,
} from '../shared/gstCalculator';
import {
  getStateCode,
  getStateFromGstin,
  isValidGstin,
  isValidIfsc,
  isValidPan,
} from '../shared/indianStates';
import type {
  ActivityLog,
  AdminDashboardData,
  AuthSessionState,
  BusinessProfile,
  BusinessSnapshot,
  ComputedLineItem,
  ComputedPurchaseLineItem,
  Customer,
  CustomerAnalyticsData,
  CustomerSnapshot,
  DiscountType,
  ImpersonationSession,
  Invoice,
  InvoiceStatus,
  LineItemInput,
  NotificationItem,
  OutstandingReportRow,
  Payment,
  PaymentMethod,
  PlatformSettings,
  Purchase,
  PurchaseAnalyticsData,
  PurchaseAttachment,
  PurchaseLineItemInput,
  PurchasePayment,
  PurchaseStatus,
  PurchaseType,
  Quotation,
  QuotationStatus,
  RateCardItem,
  SavePurchasePayload,
  Supplier,
  SupplierSnapshot,
  TaxPricingMode,
  TaxSupplyMode,
  TemplateId,
  UserRecord,
  UserRole,
} from '../shared/types';

export const VALID_TEMPLATE_IDS: readonly TemplateId[] = [
  'gst_theme_1',
  'gst_theme_2',
  'gst_theme_3',
  'gst_theme_4',
  'gst_theme_5',
  'gst_theme_6',
  'double_divine',
  'french_elite',
  'landscape_theme_2',
  'classic_gst',
  'executive_minimal',
  'compact_commercial',
];
import type { AdminUserRow, SaveDocumentPayload } from './api';
import type { GstExportRecord } from '../shared/gstnTypes';

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
    signatureDataUrl: String(raw.signatureDataUrl || ''),
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
      signatureDataUrl: '',
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

function normalizeRateCardItem(raw: Record<string, unknown>): RateCardItem {
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    name: String(raw.name || ''),
    description: String(raw.description || ''),
    hsnSac: String(raw.hsnSac || ''),
    unit: String(raw.unit || 'Nos'),
    rate: Number(raw.rate ?? 0),
    discountType: raw.discountType === 'fixed' ? 'fixed' : 'percent',
    discountValue: Number(raw.discountValue ?? 0),
    taxRate: Number(raw.taxRate ?? 18),
    category: String(raw.category || 'General'),
    isActive: raw.isActive !== false,
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

function normalizeSupplier(raw: Record<string, unknown>): Supplier {
  const gstin = String(raw.gstin || '').toUpperCase();
  const state = String(raw.state || getStateFromGstin(gstin) || 'Maharashtra');
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    name: String(raw.name || ''),
    companyName: String(raw.companyName || ''),
    email: String(raw.email || ''),
    phone: String(raw.phone || ''),
    gstin,
    billingAddress: String(raw.billingAddress || ''),
    state,
    stateCode: String(raw.stateCode || getStateCode(state) || (gstin.length >= 2 ? gstin.slice(0, 2) : '')),
    notes: String(raw.notes || ''),
    archived: Boolean(raw.archived),
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
  };
}

function normalizePurchase(raw: Record<string, unknown>): Purchase {
  const itemsRaw = Array.isArray(raw.items)
    ? raw.items
    : raw.items && typeof raw.items === 'object'
      ? Object.values(raw.items as Record<string, unknown>)
      : [];
  const supRaw = (raw.supplierSnapshot as Record<string, unknown> | undefined) || {};
  const supGstin = String(supRaw.gstin || '').toUpperCase();
  const supState = String(supRaw.state || getStateFromGstin(supGstin) || 'Maharashtra');

  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    billNumber: String(raw.billNumber || ''),
    referenceNumber: String(raw.referenceNumber || ''),
    supplierId: String(raw.supplierId || ''),
    supplierSnapshot: {
      id: String(supRaw.id || raw.supplierId || ''),
      name: String(supRaw.name || ''),
      companyName: String(supRaw.companyName || ''),
      email: String(supRaw.email || ''),
      phone: String(supRaw.phone || ''),
      gstin: supGstin,
      billingAddress: String(supRaw.billingAddress || ''),
      state: supState,
      stateCode: String(supRaw.stateCode || getStateCode(supState)),
    },
    billDate: String(raw.billDate || ''),
    dueDate: String(raw.dueDate || ''),
    paymentTerms: String(raw.paymentTerms || ''),
    purchaseType: (raw.purchaseType as PurchaseType) || 'gst',
    isGst: raw.isGst !== false,
    taxMode: (raw.taxMode as TaxPricingMode) || 'exclusive',
    taxSupplyMode: (raw.taxSupplyMode as TaxSupplyMode) || 'auto',
    isInterState: Boolean(raw.isInterState),
    placeOfSupply: String(raw.placeOfSupply || ''),
    roundOffEnabled: raw.roundOffEnabled !== false,
    status: (raw.status as PurchaseStatus) || 'unpaid',
    items: itemsRaw as ComputedPurchaseLineItem[],
    subtotal: Number(raw.subtotal ?? 0),
    itemDiscountTotal: Number(raw.itemDiscountTotal ?? 0),
    invoiceDiscountType: raw.invoiceDiscountType === 'fixed' ? 'fixed' : 'percent',
    invoiceDiscountValue: Number(raw.invoiceDiscountValue ?? 0),
    invoiceDiscountAmount: Number(raw.invoiceDiscountAmount ?? 0),
    totalDiscount: Number(raw.totalDiscount ?? 0),
    taxableAmount: Number(raw.taxableAmount ?? 0),
    cgstTotal: Number(raw.cgstTotal ?? 0),
    sgstTotal: Number(raw.sgstTotal ?? 0),
    igstTotal: Number(raw.igstTotal ?? 0),
    totalTax: Number(raw.totalTax ?? 0),
    additionalCharges: Number(raw.additionalCharges ?? 0),
    roundOff: Number(raw.roundOff ?? 0),
    grandTotal: Number(raw.grandTotal ?? 0),
    amountPaid: Number(raw.amountPaid ?? 0),
    balanceDue: Number(raw.balanceDue ?? 0),
    amountInWords: String(raw.amountInWords || ''),
    notes: String(raw.notes || ''),
    ocrUsed: Boolean(raw.ocrUsed),
    ocrWarnings: Array.isArray(raw.ocrWarnings) ? raw.ocrWarnings.map(String) : undefined,
    attachmentId: raw.attachmentId ? String(raw.attachmentId) : undefined,
    attachmentMeta: raw.attachmentMeta
      ? (raw.attachmentMeta as Purchase['attachmentMeta'])
      : null,
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
  };
}

function normalizePurchasePayment(raw: Record<string, unknown>): PurchasePayment {
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    purchaseId: String(raw.purchaseId || ''),
    billNumber: raw.billNumber ? String(raw.billNumber) : undefined,
    supplierId: String(raw.supplierId || ''),
    supplierName: raw.supplierName ? String(raw.supplierName) : undefined,
    paymentDate: String(raw.paymentDate || ''),
    amount: Number(raw.amount ?? 0),
    paymentMethod: (raw.paymentMethod as PaymentMethod) || 'Bank Transfer',
    referenceId: String(raw.referenceId || ''),
    notes: String(raw.notes || ''),
    paymentNumber: String(raw.paymentNumber || ''),
    isAdvance: Boolean(raw.isAdvance),
    createdAt: String(raw.createdAt || ''),
  };
}

function normalizePurchaseAttachment(raw: Record<string, unknown>): PurchaseAttachment {
  return {
    id: String(raw.id || ''),
    userUid: String(raw.userUid || ''),
    purchaseId: String(raw.purchaseId || ''),
    fileName: String(raw.fileName || 'bill'),
    mimeType: String(raw.mimeType || 'image/jpeg'),
    sizeBytes: Number(raw.sizeBytes ?? 0),
    storagePath: String(raw.storagePath || ''),
    downloadUrl: String(raw.downloadUrl || ''),
    pageCount: raw.pageCount !== undefined ? Number(raw.pageCount) : undefined,
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

async function touchTenantMeta(tenantUid: string, cols: TenantCollection[]): Promise<void> {
  if (!cols.length) return;
  const now = Date.now();
  const patch: Record<string, number> = {};
  for (const col of cols) {
    markTenantSyncedNow(tenantUid, col, now);
    patch[col] = now;
  }
  try {
    await update(ref(rtdb, `tenants/${tenantUid}/_meta`), patch);
  } catch {
    // non-fatal if _meta write fails
  }
}

const syncFlushInFlight = new Map<string, Promise<void>>();
let onlineSyncListenerRegistered = false;

function buildRtdbBusinessSnapshotPatch(profile: BusinessProfile): Record<string, unknown> {
  return {
    businessName: profile.businessName,
    ownerName: profile.ownerName,
    logoDataUrl: profile.logoDataUrl,
    address: profile.address,
    email: profile.email,
    phone: profile.phone,
    gstin: profile.gstin,
    pan: profile.pan,
    state: profile.state,
    bankName: profile.bankName,
    accountNumber: profile.accountNumber,
    ifsc: profile.ifsc,
    upiId: profile.upiId,
    upiQrDataUrl: profile.upiId ? '' : profile.upiQrDataUrl,
    signatureLabel: profile.signatureLabel,
    signatureDataUrl: profile.signatureDataUrl,
  };
}

export async function flushTenantSyncQueue(tenantUid: string): Promise<void> {
  if (!tenantUid) return;
  const existingLock = syncFlushInFlight.get(tenantUid);
  if (existingLock) return existingLock;

  const task = (async () => {
    while (true) {
      const ops = getPendingSyncOps(tenantUid);
      if (ops.length === 0) break;
      const op = ops[0];
      try {
        if (op.kind === 'upsert_profile') {
          await set(ref(rtdb, `businessProfiles/${tenantUid}`), stripUndefined(op.profile));
          if (op.userPatch) {
            await update(ref(rtdb, `users/${tenantUid}`), op.userPatch);
          }

          const metaCols: TenantCollection[] = ['profile'];
          const docPatch: Record<string, unknown> = {};
          const bizSnapPatch = op.cascadeBusinessSnapshot
            ? buildRtdbBusinessSnapshotPatch(op.profile)
            : null;

          if (op.cascadeDefaultInvoiceTemplate || bizSnapPatch) {
            const invoicesSnap = await get(ref(rtdb, `tenants/${tenantUid}/invoices`));
            if (invoicesSnap.exists()) {
              const raw = invoicesSnap.val() as Record<string, Record<string, unknown>>;
              for (const invId of Object.keys(raw)) {
                if (op.cascadeDefaultInvoiceTemplate) {
                  docPatch[`tenants/${tenantUid}/invoices/${invId}/templateId`] =
                    op.cascadeDefaultInvoiceTemplate;
                }
                if (bizSnapPatch) {
                  for (const [k, v] of Object.entries(bizSnapPatch)) {
                    docPatch[`tenants/${tenantUid}/invoices/${invId}/businessSnapshot/${k}`] =
                      v ?? '';
                  }
                }
              }
              metaCols.push('invoices');
            }
          }

          if (op.cascadeDefaultQuotationTemplate || bizSnapPatch) {
            const quotationsSnap = await get(ref(rtdb, `tenants/${tenantUid}/quotations`));
            if (quotationsSnap.exists()) {
              const raw = quotationsSnap.val() as Record<string, Record<string, unknown>>;
              for (const quoId of Object.keys(raw)) {
                if (op.cascadeDefaultQuotationTemplate) {
                  docPatch[`tenants/${tenantUid}/quotations/${quoId}/templateId`] =
                    op.cascadeDefaultQuotationTemplate;
                }
                if (bizSnapPatch) {
                  for (const [k, v] of Object.entries(bizSnapPatch)) {
                    docPatch[`tenants/${tenantUid}/quotations/${quoId}/businessSnapshot/${k}`] =
                      v ?? '';
                  }
                }
              }
              metaCols.push('quotations');
            }
          }

          if (Object.keys(docPatch).length > 0) {
            await update(ref(rtdb), docPatch);
          }
          void touchTenantMeta(tenantUid, metaCols);
        } else if (op.kind === 'upsert_customer') {
          await set(
            ref(rtdb, `tenants/${tenantUid}/customers/${op.customer.id}`),
            stripUndefined(op.customer)
          );
          const metaCols: TenantCollection[] = ['customers'];

          if (op.cascadeSnapshot) {
            const custSnap: CustomerSnapshot = {
              id: op.customer.id,
              name: op.customer.name,
              companyName: op.customer.companyName,
              email: op.customer.email,
              phone: op.customer.phone,
              gstin: op.customer.gstin,
              billingAddress: op.customer.billingAddress,
              shippingAddress: op.customer.shippingAddress,
              state: op.customer.state,
            };
            const docPatch: Record<string, unknown> = {};
            const [invSnap, quoSnap] = await Promise.all([
              get(ref(rtdb, `tenants/${tenantUid}/invoices`)),
              get(ref(rtdb, `tenants/${tenantUid}/quotations`)),
            ]);
            if (invSnap.exists()) {
              const raw = invSnap.val() as Record<string, Record<string, unknown>>;
              for (const [invId, invVal] of Object.entries(raw)) {
                if (String(invVal.customerId || '') === op.customer.id) {
                  docPatch[`tenants/${tenantUid}/invoices/${invId}/customerSnapshot`] =
                    stripUndefined(custSnap);
                }
              }
            }
            if (quoSnap.exists()) {
              const raw = quoSnap.val() as Record<string, Record<string, unknown>>;
              for (const [quoId, quoVal] of Object.entries(raw)) {
                if (String(quoVal.customerId || '') === op.customer.id) {
                  docPatch[`tenants/${tenantUid}/quotations/${quoId}/customerSnapshot`] =
                    stripUndefined(custSnap);
                }
              }
            }
            if (Object.keys(docPatch).length > 0) {
              await update(ref(rtdb), docPatch);
              metaCols.push('invoices', 'quotations');
            }
          }
          void touchTenantMeta(tenantUid, metaCols);
        } else if (op.kind === 'upsert_invoice') {
          await set(
            ref(rtdb, `tenants/${tenantUid}/invoices/${op.invoice.id}`),
            stripUndefined(op.invoice)
          );
          if (op.seqAlloc) {
            const counterRef = ref(
              rtdb,
              `tenants/${tenantUid}/counters/${op.seqAlloc.counterKey}`
            );
            await runTransaction(counterRef, (cur) =>
              Math.max(typeof cur === 'number' ? cur : 0, op.seqAlloc!.seq)
            );
          }
          void touchTenantMeta(tenantUid, ['invoices']);
        } else if (op.kind === 'upsert_quotation') {
          await set(
            ref(rtdb, `tenants/${tenantUid}/quotations/${op.quotation.id}`),
            stripUndefined(op.quotation)
          );
          if (op.seqAlloc) {
            const counterRef = ref(
              rtdb,
              `tenants/${tenantUid}/counters/${op.seqAlloc.counterKey}`
            );
            await runTransaction(counterRef, (cur) =>
              Math.max(typeof cur === 'number' ? cur : 0, op.seqAlloc!.seq)
            );
          }
          void touchTenantMeta(tenantUid, ['quotations']);
        } else if (op.kind === 'upsert_payment') {
          await set(
            ref(rtdb, `tenants/${tenantUid}/payments/${op.payment.id}`),
            stripUndefined(op.payment)
          );
          await update(
            ref(rtdb, `tenants/${tenantUid}/invoices/${op.invoicePatch.invoiceId}`),
            {
              amountPaid: op.invoicePatch.amountPaid,
              balanceDue: op.invoicePatch.balanceDue,
              status: op.invoicePatch.status,
              updatedAt: op.invoicePatch.updatedAt,
            }
          );
          if (op.seqAlloc) {
            const counterRef = ref(
              rtdb,
              `tenants/${tenantUid}/counters/${op.seqAlloc.counterKey}`
            );
            await runTransaction(counterRef, (cur) =>
              Math.max(typeof cur === 'number' ? cur : 0, op.seqAlloc!.seq)
            );
          }
          void touchTenantMeta(tenantUid, ['payments', 'invoices']);
        }
        removePendingSyncOp(tenantUid, op.id);
      } catch {
        // Keep op in localStorage queue to retry automatically on next trigger / online
        break;
      }
    }
  })().finally(() => {
    if (syncFlushInFlight.get(tenantUid) === task) {
      syncFlushInFlight.delete(tenantUid);
    }
  });

  syncFlushInFlight.set(tenantUid, task);
  return task;
}

function registerOnlineSyncListener(): void {
  if (onlineSyncListenerRegistered || typeof window === 'undefined') return;
  onlineSyncListenerRegistered = true;
  window.addEventListener('online', () => {
    const sess = getCachedSession();
    if (sess?.effectiveUser?.role === 'business') {
      void flushTenantSyncQueue(sess.effectiveUser.uid);
    }
  });
}

async function ensurePlatformSettings(): Promise<PlatformSettings> {
  return dedupeFetch('platformSettings', async () => {
    const snap = await get(ref(rtdb, 'platformSettings'));
    if (snap.exists()) {
      return { ...defaultPlatformSettings(), ...(snap.val() as Partial<PlatformSettings>) };
    }
    const defaults = defaultPlatformSettings();
    await set(ref(rtdb, 'platformSettings'), stripUndefined(defaults));
    return defaults;
  });
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
  if (entry.targetTenantUid) {
    prependTenantActivityLogCache(entry.targetTenantUid, entry);
  }
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
  upsertTenantNotificationCache(params.userUid, item);
  await touchTenantMeta(params.userUid, ['notifications']);
}

async function allocateDocumentNumber(
  tenantUid: string,
  docType: 'INV' | 'QUO' | 'RCP' | 'PPAY',
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
  syncRemoteCounterCache(tenantUid, `${docType}_${year}`, seq);
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
    signatureDataUrl: '',
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
    signatureDataUrl: profileRec.signatureDataUrl,
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

  const seedRateItems: RateCardItem[] = isBiz1
    ? [
        {
          id: generateId('rc'),
          userUid: uid,
          name: 'Cloud ERP Implementation',
          description: 'Multi-warehouse inventory & GST billing setup',
          hsnSac: '998314',
          unit: 'Project',
          rate: 75000,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
          category: 'Software & ERP',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: generateId('rc'),
          userUid: uid,
          name: 'Annual SaaS Telemetry License',
          description: 'Per-branch cloud telemetry & support seat',
          hsnSac: '998313',
          unit: 'Units',
          rate: 22000,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
          category: 'Subscriptions',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: generateId('rc'),
          userUid: uid,
          name: 'Dedicated Technical Consulting',
          description: 'On-site or remote systems engineering',
          hsnSac: '998314',
          unit: 'Hrs',
          rate: 3500,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
          category: 'Consulting',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ]
    : [
        {
          id: generateId('rc'),
          userUid: uid,
          name: 'CNC Machined Housing Batch',
          description: 'SS316 precision tolerance batch',
          hsnSac: '848340',
          unit: 'Nos',
          rate: 48000,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
          category: 'Manufacturing',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: generateId('rc'),
          userUid: uid,
          name: 'Hydraulic Valve Assembly',
          description: 'High-pressure tested industrial valve set',
          hsnSac: '848120',
          unit: 'Units',
          rate: 18500,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
          category: 'Components',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: generateId('rc'),
          userUid: uid,
          name: 'Preventive Plant Maintenance',
          description: 'Quarterly calibration & inspection visit',
          hsnSac: '998719',
          unit: 'Visit',
          rate: 12000,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 18,
          category: 'Services',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ];

  for (const rcItem of seedRateItems) {
    await set(ref(rtdb, `tenants/${uid}/rateCard/${rcItem.id}`), stripUndefined(rcItem));
  }

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

let runtimeAuthSession: AuthSessionState | null = null;
let runtimeAuthSessionAt = 0;
const AUTH_CACHE_FRESH_MS = 2 * 60 * 1000;

export function updateRuntimeSessionCache(session: AuthSessionState | null): void {
  runtimeAuthSession = session;
  runtimeAuthSessionAt = session ? Date.now() : 0;
  setCachedSession(session);
}

async function resolveCurrentAuthContext(forceRefresh = false): Promise<{
  actorUser: UserRecord;
  effectiveUser: UserRecord;
  businessProfile: BusinessProfile | null;
  isImpersonating: boolean;
  impersonationSession: ImpersonationSession | null;
}> {
  if (!firebaseAuth.currentUser && typeof firebaseAuth.authStateReady === 'function') {
    await firebaseAuth.authStateReady();
  }
  const fbUser = firebaseAuth.currentUser;
  if (!fbUser) throw new Error('Authentication required');

  const storedImpId = getStoredImpersonationId();

  if (!forceRefresh) {
    const memFresh =
      runtimeAuthSession &&
      runtimeAuthSession.actorUser.uid === fbUser.uid &&
      Date.now() - runtimeAuthSessionAt < AUTH_CACHE_FRESH_MS &&
      (runtimeAuthSession.impersonationSession?.id || null) === storedImpId;
    if (memFresh && runtimeAuthSession) {
      return runtimeAuthSession;
    }
    const persisted = getCachedSession();
    const persistedTs = getCachedSessionTimestamp();
    if (
      persisted &&
      persisted.actorUser.uid === fbUser.uid &&
      Date.now() - persistedTs < AUTH_CACHE_FRESH_MS &&
      (persisted.impersonationSession?.id || null) === storedImpId
    ) {
      runtimeAuthSession = persisted;
      runtimeAuthSessionAt = persistedTs;
      return persisted;
    }
  }

  return dedupeFetch(`authCtx:${fbUser.uid}:${storedImpId || 'none'}:${forceRefresh ? '1' : '0'}`, async () => {
    const userSnap = await get(ref(rtdb, `users/${fbUser.uid}`));
    if (!userSnap.exists()) {
      throw new Error('User workspace profile not found');
    }
    const actorUser = normalizeUserRecord(fbUser.uid, userSnap.val() as Record<string, unknown>);
    if (actorUser.status !== 'active') {
      updateRuntimeSessionCache(null);
      await signOut(firebaseAuth);
      throw new Error('Your account has been deactivated by Drona Admin.');
    }

    let effectiveUser = actorUser;
    let isImpersonating = false;
    let impersonationSession: ImpersonationSession | null = null;

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
      if (hasPendingSyncForProfile(effectiveUser.uid)) {
        businessProfile = getTenantEntry(effectiveUser.uid).profile || null;
      }
      if (!businessProfile) {
        const profSnap = await get(ref(rtdb, `businessProfiles/${effectiveUser.uid}`));
        if (profSnap.exists()) {
          businessProfile = normalizeBusinessProfile(
            effectiveUser.uid,
            profSnap.val() as Record<string, unknown>
          );
        }
      }
    }

    const sessionState: AuthSessionState = {
      actorUser,
      effectiveUser,
      businessProfile,
      isImpersonating,
      impersonationSession,
    };
    updateRuntimeSessionCache(sessionState);
    if (effectiveUser.role === 'business') {
      registerOnlineSyncListener();
      void flushTenantSyncQueue(effectiveUser.uid);
    }
    return sessionState;
  });
}

async function requireTenantContext() {
  const ctx = await resolveCurrentAuthContext();
  if (ctx.effectiveUser.role !== 'business') {
    throw new Error('Business workspace access required');
  }
  if (ctx.effectiveUser.status !== 'active' && !ctx.isImpersonating) {
    throw new Error('Business account is inactive');
  }
  registerOnlineSyncListener();
  return ctx;
}

async function requireSuperAdminContext() {
  const ctx = await resolveCurrentAuthContext();
  if (ctx.actorUser.role !== 'super_admin') {
    throw new Error('Forbidden: Drona Super Admin privileges required');
  }
  return ctx;
}

async function syncOverdueInvoicesFromList(
  tenantUid: string,
  invoices: Invoice[],
  forceCheck = false
): Promise<Invoice[]> {
  const today = todayISO();
  if (!forceCheck && getTenantOverdueCheckDate(tenantUid) === today) {
    return invoices;
  }
  const now = new Date().toISOString();
  const candidates = invoices.filter(
    (inv) =>
      (inv.status === 'unpaid' || inv.status === 'partially_paid') &&
      inv.dueDate < today &&
      inv.balanceDue > 0
  );
  setTenantOverdueCheckDate(tenantUid, today);
  if (candidates.length === 0) return invoices;

  const existingNotifs = getTenantEntry(tenantUid).notifications;
  const patch: Record<string, unknown> = {};
  const updatedIds = new Set<string>();

  for (const inv of candidates) {
    patch[`tenants/${tenantUid}/invoices/${inv.id}/status`] = 'overdue';
    patch[`tenants/${tenantUid}/invoices/${inv.id}/updatedAt`] = now;
    updatedIds.add(inv.id);
    const already = existingNotifs.some(
      (n) => n.type === 'invoice_overdue' && n.entityId === inv.id
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
        entityId: inv.id,
      });
    }
  }

  await update(ref(rtdb), patch);
  const nextList = invoices.map((inv) =>
    updatedIds.has(inv.id) ? { ...inv, status: 'overdue' as InvoiceStatus, updatedAt: now } : inv
  );
  setTenantCollectionData(tenantUid, 'invoices', nextList, true);
  await touchTenantMeta(tenantUid, ['invoices']);
  return nextList;
}

async function syncExpiredQuotationsFromList(
  tenantUid: string,
  quotations: Quotation[],
  forceCheck = false
): Promise<Quotation[]> {
  const today = todayISO();
  if (!forceCheck && getTenantExpiryCheckDate(tenantUid) === today) {
    return quotations;
  }
  const soonDate = addDaysISO(today, 3);
  const now = new Date().toISOString();
  const existingNotifs = getTenantEntry(tenantUid).notifications;
  const patch: Record<string, unknown> = {};
  const expiredIds = new Set<string>();

  for (const q of quotations) {
    if (q.status === 'sent' && q.validUntil < today) {
      patch[`tenants/${tenantUid}/quotations/${q.id}/status`] = 'expired';
      patch[`tenants/${tenantUid}/quotations/${q.id}/updatedAt`] = now;
      expiredIds.add(q.id);
    } else if (q.status === 'sent' && q.validUntil >= today && q.validUntil <= soonDate) {
      const already = existingNotifs.some(
        (n) => n.type === 'quotation_expiring' && n.entityId === q.id
      );
      if (!already) {
        await createNotification({
          userUid: tenantUid,
          type: 'quotation_expiring',
          title: 'Quotation expiring soon',
          message: `Quotation ${q.quotationNumber} expires on ${q.validUntil}.`,
          entityType: 'quotation',
          entityId: q.id,
        });
      }
    }
  }

  setTenantExpiryCheckDate(tenantUid, today);
  if (expiredIds.size === 0) return quotations;

  await update(ref(rtdb), patch);
  const nextList = quotations.map((q) =>
    expiredIds.has(q.id) ? { ...q, status: 'expired' as QuotationStatus, updatedAt: now } : q
  );
  setTenantCollectionData(tenantUid, 'quotations', nextList, true);
  await touchTenantMeta(tenantUid, ['quotations']);
  return nextList;
}

async function listTenantInvoicesRaw(tenantUid: string, forceRefresh = false): Promise<Invoice[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'invoices')) {
    return getTenantEntry(tenantUid).invoices;
  }
  return dedupeFetch(`tenant:${tenantUid}:invoices`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/invoices`));
    const remoteList = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeInvoice)
      : [];

    const byId = new Map<string, Invoice>(remoteList.map((i) => [i.id, i]));
    for (const op of getPendingSyncOps(tenantUid)) {
      if (op.kind === 'upsert_invoice') {
        byId.set(op.invoice.id, op.invoice);
      } else if (op.kind === 'upsert_payment') {
        const cur = byId.get(op.invoicePatch.invoiceId);
        if (cur) {
          byId.set(cur.id, {
            ...cur,
            amountPaid: op.invoicePatch.amountPaid,
            balanceDue: op.invoicePatch.balanceDue,
            status: op.invoicePatch.status,
            updatedAt: op.invoicePatch.updatedAt,
          });
        }
      }
    }

    const rawList = Array.from(byId.values()).sort((a, b) =>
      `${b.invoiceDate}_${b.createdAt}`.localeCompare(`${a.invoiceDate}_${a.createdAt}`)
    );
    setTenantCollectionData(tenantUid, 'invoices', rawList, true);
    return syncOverdueInvoicesFromList(tenantUid, rawList);
  });
}

async function listTenantQuotationsRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<Quotation[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'quotations')) {
    return getTenantEntry(tenantUid).quotations;
  }
  return dedupeFetch(`tenant:${tenantUid}:quotations`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/quotations`));
    const remoteList = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeQuotation)
      : [];

    const byId = new Map<string, Quotation>(remoteList.map((q) => [q.id, q]));
    for (const op of getPendingSyncOps(tenantUid)) {
      if (op.kind === 'upsert_quotation') {
        byId.set(op.quotation.id, op.quotation);
      }
    }

    const rawList = Array.from(byId.values()).sort((a, b) =>
      `${b.quotationDate}_${b.createdAt}`.localeCompare(`${a.quotationDate}_${a.createdAt}`)
    );
    setTenantCollectionData(tenantUid, 'quotations', rawList, true);
    return syncExpiredQuotationsFromList(tenantUid, rawList);
  });
}

async function listTenantPaymentsRaw(tenantUid: string, forceRefresh = false): Promise<Payment[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'payments')) {
    return getTenantEntry(tenantUid).payments;
  }
  return dedupeFetch(`tenant:${tenantUid}:payments`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/payments`));
    const remoteList = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizePayment)
      : [];

    const byId = new Map<string, Payment>(remoteList.map((p) => [p.id, p]));
    for (const op of getPendingSyncOps(tenantUid)) {
      if (op.kind === 'upsert_payment') {
        byId.set(op.payment.id, op.payment);
      }
    }

    const list = Array.from(byId.values()).sort((a, b) =>
      `${b.paymentDate}_${b.createdAt}`.localeCompare(`${a.paymentDate}_${a.createdAt}`)
    );
    setTenantCollectionData(tenantUid, 'payments', list, true);
    return list;
  });
}

async function listTenantCustomersBaseRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<Customer[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'customers')) {
    return getTenantEntry(tenantUid).customers;
  }
  return dedupeFetch(`tenant:${tenantUid}:customers`, async () => {
    const custSnap = await get(ref(rtdb, `tenants/${tenantUid}/customers`));
    const remoteList = custSnap.exists()
      ? Object.values(custSnap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeCustomer)
      : [];

    const byId = new Map<string, Customer>(remoteList.map((c) => [c.id, c]));
    for (const op of getPendingSyncOps(tenantUid)) {
      if (op.kind === 'upsert_customer') {
        byId.set(op.customer.id, op.customer);
      }
    }

    const rawList = Array.from(byId.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    setTenantCollectionData(tenantUid, 'customers', rawList, true);
    return rawList;
  });
}

export function enrichCustomersWithStats(
  rawCustomers: Customer[],
  invoices: Invoice[],
  quotations: Quotation[],
  opts?: { search?: string; includeArchived?: boolean }
): Customer[] {
  const search = (opts?.search || '').trim().toLowerCase();
  const includeArchived = Boolean(opts?.includeArchived);

  return rawCustomers
    .filter((c) => includeArchived || !c.archived)
    .map((c) => {
      const custInvoices = invoices.filter((i) => i.customerId === c.id);
      const activeInvoices = custInvoices.filter(
        (i) => i.status !== 'draft' && i.status !== 'cancelled'
      );
      const custQuotes = quotations.filter((q) => q.customerId === c.id);
      return {
        ...c,
        totalSales: fromPaise(activeInvoices.reduce((s, i) => s + toPaise(i.grandTotal), 0)),
        totalPaid: fromPaise(activeInvoices.reduce((s, i) => s + toPaise(i.amountPaid), 0)),
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

async function listTenantCustomersRaw(
  tenantUid: string,
  opts?: { search?: string; includeArchived?: boolean }
): Promise<Customer[]> {
  const [rawCustomers, invoices, quotations] = await Promise.all([
    listTenantCustomersBaseRaw(tenantUid),
    listTenantInvoicesRaw(tenantUid),
    listTenantQuotationsRaw(tenantUid),
  ]);
  return enrichCustomersWithStats(rawCustomers, invoices, quotations, opts);
}

async function listTenantRateCardAllRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<RateCardItem[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'rateCard')) {
    return getTenantEntry(tenantUid).rateCard;
  }
  return dedupeFetch(`tenant:${tenantUid}:rateCard`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/rateCard`));
    const rawList = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeRateCardItem)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    setTenantCollectionData(tenantUid, 'rateCard', rawList, true);
    return rawList;
  });
}

async function listTenantRateCardRaw(
  tenantUid: string,
  opts?: { search?: string; activeOnly?: boolean; category?: string }
): Promise<RateCardItem[]> {
  const rawList = await listTenantRateCardAllRaw(tenantUid);
  const search = (opts?.search || '').trim().toLowerCase();
  const activeOnly = Boolean(opts?.activeOnly);
  const category = (opts?.category || '').trim();

  return rawList
    .filter((item) => !activeOnly || item.isActive)
    .filter((item) => !category || category === 'all' || item.category === category)
    .filter((item) => {
      if (!search) return true;
      return (
        item.name.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search) ||
        item.hsnSac.toLowerCase().includes(search) ||
        item.category.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listTenantNotificationsRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<NotificationItem[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'notifications')) {
    return getTenantEntry(tenantUid).notifications;
  }
  return dedupeFetch(`tenant:${tenantUid}:notifications`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/notifications`));
    const notifications = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeNotification)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 40)
      : [];
    setTenantCollectionData(tenantUid, 'notifications', notifications, true);
    return notifications;
  });
}

async function listTenantActivityLogsRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<ActivityLog[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'activityLogs')) {
    return getTenantEntry(tenantUid).activityLogs;
  }
  return dedupeFetch(`tenant:${tenantUid}:activityLogs`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/activityLogs`));
    const logs = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeActivityLog)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 60)
      : [];
    setTenantCollectionData(tenantUid, 'activityLogs', logs, true);
    return logs;
  });
}

async function reconcileInvoicePayments(
  tenantUid: string,
  invoiceId: string,
  nowIso: string
): Promise<Invoice | null> {
  const cachedInv = getTenantEntry(tenantUid).invoices.find((i) => i.id === invoiceId);
  let inv = cachedInv;
  const invRef = ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`);
  if (!inv) {
    const invSnap = await get(invRef);
    if (!invSnap.exists()) return null;
    inv = normalizeInvoice(invSnap.val() as Record<string, unknown>);
  }

  if (inv.status === 'draft' || inv.status === 'cancelled') return inv;

  const allPayments = await listTenantPaymentsRaw(tenantUid);
  const paidPaise = allPayments
    .filter((p) => p.invoiceId === invoiceId)
    .reduce((sum, p) => sum + toPaise(p.amount), 0);

  const grandPaise = toPaise(inv.grandTotal);
  const balancePaise = Math.max(0, grandPaise - paidPaise);
  const nextStatus: InvoiceStatus =
    balancePaise === 0
      ? 'paid'
      : inv.dueDate < todayISO()
        ? 'overdue'
        : paidPaise > 0
          ? 'partially_paid'
          : 'unpaid';

  const amountPaid = fromPaise(paidPaise);
  const balanceDue = fromPaise(balancePaise);

  await update(invRef, {
    amountPaid,
    balanceDue,
    status: nextStatus,
    updatedAt: nowIso,
  });

  const updatedInv: Invoice = {
    ...inv,
    amountPaid,
    balanceDue,
    status: nextStatus,
    updatedAt: nowIso,
  };
  upsertTenantInvoiceCache(tenantUid, updatedInv);
  await touchTenantMeta(tenantUid, ['invoices']);
  return updatedInv;
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

export function computeCustomerAnalyticsFromData(
  allInvoices: Invoice[],
  allQuotations: Quotation[],
  allPayments: Payment[],
  rawCustomers: Customer[],
  params?: { range?: string; startDate?: string; endDate?: string }
): CustomerAnalyticsData {
  const { start, end } = buildDateRangeBounds(params?.range, params?.startDate, params?.endDate);
  const { prevStart, prevEnd } = getPreviousPeriodBounds(start, end);
  const customers = enrichCustomersWithStats(rawCustomers, allInvoices, allQuotations, {
    includeArchived: true,
  });

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

export function computeOutstandingRowsFromInvoices(
  invoices: Invoice[],
  params?: {
    filter?: 'all' | 'not_due' | 'overdue';
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }
): OutstandingReportRow[] {
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

  return Array.from(byCustomer.values())
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
}

async function computeCustomerAnalyticsForTenant(
  tenantUid: string,
  params?: { range?: string; startDate?: string; endDate?: string }
): Promise<CustomerAnalyticsData> {
  const [allInvoices, allQuotations, allPayments, rawCustomers] = await Promise.all([
    listTenantInvoicesRaw(tenantUid),
    listTenantQuotationsRaw(tenantUid),
    listTenantPaymentsRaw(tenantUid),
    listTenantCustomersBaseRaw(tenantUid),
  ]);

  return computeCustomerAnalyticsFromData(
    allInvoices,
    allQuotations,
    allPayments,
    rawCustomers,
    params
  );
}

async function listTenantSuppliersBaseRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<Supplier[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'suppliers')) {
    return getTenantEntry(tenantUid).suppliers;
  }
  return dedupeFetch(`tenant:${tenantUid}:suppliers`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/suppliers`));
    const list = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeSupplier)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
    setTenantCollectionData(tenantUid, 'suppliers', list, true);
    return list;
  });
}

async function syncOverduePurchasesFromList(
  tenantUid: string,
  purchases: Purchase[],
  forceCheck = false
): Promise<Purchase[]> {
  const today = todayISO();
  if (!forceCheck && getTenantPurchaseOverdueCheckDate(tenantUid) === today) {
    return purchases;
  }
  const now = new Date().toISOString();
  const candidates = purchases.filter(
    (p) =>
      (p.status === 'unpaid' || p.status === 'partially_paid') &&
      p.dueDate &&
      p.dueDate < today &&
      p.balanceDue > 0
  );
  setTenantPurchaseOverdueCheckDate(tenantUid, today);
  if (candidates.length === 0) return purchases;

  const patch: Record<string, unknown> = {};
  const updatedIds = new Set<string>();
  for (const p of candidates) {
    patch[`tenants/${tenantUid}/purchases/${p.id}/status`] = 'overdue';
    patch[`tenants/${tenantUid}/purchases/${p.id}/updatedAt`] = now;
    updatedIds.add(p.id);
  }
  await update(ref(rtdb), patch);
  const nextList = purchases.map((p) =>
    updatedIds.has(p.id) ? { ...p, status: 'overdue' as PurchaseStatus, updatedAt: now } : p
  );
  setTenantCollectionData(tenantUid, 'purchases', nextList, true);
  await touchTenantMeta(tenantUid, ['purchases']);
  return nextList;
}

async function listTenantPurchasesRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<Purchase[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'purchases')) {
    return getTenantEntry(tenantUid).purchases;
  }
  return dedupeFetch(`tenant:${tenantUid}:purchases`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/purchases`));
    const list = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizePurchase)
          .sort((a, b) => `${b.billDate}_${b.createdAt}`.localeCompare(`${a.billDate}_${a.createdAt}`))
      : [];
    setTenantCollectionData(tenantUid, 'purchases', list, true);
    return syncOverduePurchasesFromList(tenantUid, list);
  });
}

async function listTenantPurchasePaymentsRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<PurchasePayment[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'purchasePayments')) {
    return getTenantEntry(tenantUid).purchasePayments;
  }
  return dedupeFetch(`tenant:${tenantUid}:purchasePayments`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/purchasePayments`));
    const list = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizePurchasePayment)
          .sort((a, b) =>
            `${b.paymentDate}_${b.createdAt}`.localeCompare(`${a.paymentDate}_${a.createdAt}`)
          )
      : [];
    setTenantCollectionData(tenantUid, 'purchasePayments', list, true);
    return list;
  });
}

async function listTenantPurchaseAttachmentsRaw(
  tenantUid: string,
  forceRefresh = false
): Promise<PurchaseAttachment[]> {
  if (!forceRefresh && isTenantCollectionFresh(tenantUid, 'purchaseAttachments')) {
    return getTenantEntry(tenantUid).purchaseAttachments;
  }
  return dedupeFetch(`tenant:${tenantUid}:purchaseAttachments`, async () => {
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/purchaseAttachments`));
    const list = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizePurchaseAttachment)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
    setTenantCollectionData(tenantUid, 'purchaseAttachments', list, true);
    return list;
  });
}

export function enrichSuppliersWithStats(
  rawSuppliers: Supplier[],
  purchases: Purchase[],
  opts?: { search?: string; includeArchived?: boolean }
): Supplier[] {
  const search = (opts?.search || '').trim().toLowerCase();
  const includeArchived = Boolean(opts?.includeArchived);

  return rawSuppliers
    .filter((s) => includeArchived || !s.archived)
    .map((s) => {
      const bills = purchases.filter((p) => p.supplierId === s.id);
      const activeBills = bills.filter((p) => p.status !== 'draft');
      return {
        ...s,
        totalPurchases: fromPaise(activeBills.reduce((sum, b) => sum + toPaise(b.grandTotal), 0)),
        totalPaid: fromPaise(activeBills.reduce((sum, b) => sum + toPaise(b.amountPaid), 0)),
        outstandingBalance: fromPaise(
          activeBills.reduce((sum, b) => sum + toPaise(b.balanceDue), 0)
        ),
        billCount: bills.length,
      };
    })
    .filter((s) => {
      if (!search) return true;
      return (
        s.name.toLowerCase().includes(search) ||
        s.companyName.toLowerCase().includes(search) ||
        s.email.toLowerCase().includes(search) ||
        s.phone.toLowerCase().includes(search) ||
        s.gstin.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function reconcilePurchasePayments(
  tenantUid: string,
  purchaseId: string,
  nowIso: string
): Promise<Purchase | null> {
  let purchase = getTenantEntry(tenantUid).purchases.find((p) => p.id === purchaseId);
  const purRef = ref(rtdb, `tenants/${tenantUid}/purchases/${purchaseId}`);
  if (!purchase) {
    const snap = await get(purRef);
    if (!snap.exists()) return null;
    purchase = normalizePurchase(snap.val() as Record<string, unknown>);
  }
  if (purchase.status === 'draft') return purchase;

  const allPayments = await listTenantPurchasePaymentsRaw(tenantUid);
  const paidPaise = allPayments
    .filter((p) => p.purchaseId === purchaseId)
    .reduce((sum, p) => sum + toPaise(p.amount), 0);

  const grandPaise = toPaise(purchase.grandTotal);
  const balancePaise = Math.max(0, grandPaise - paidPaise);
  const nextStatus: PurchaseStatus =
    balancePaise === 0
      ? 'paid'
      : purchase.dueDate && purchase.dueDate < todayISO()
        ? 'overdue'
        : paidPaise > 0
          ? 'partially_paid'
          : 'unpaid';

  const amountPaid = fromPaise(paidPaise);
  const balanceDue = fromPaise(balancePaise);

  await update(purRef, {
    amountPaid,
    balanceDue,
    status: nextStatus,
    updatedAt: nowIso,
  });

  const updated: Purchase = {
    ...purchase,
    amountPaid,
    balanceDue,
    status: nextStatus,
    updatedAt: nowIso,
  };
  upsertTenantPurchaseCache(tenantUid, updated);
  await touchTenantMeta(tenantUid, ['purchases']);
  return updated;
}

export function computePurchaseAnalyticsFromData(
  allPurchases: Purchase[],
  allPurchasePayments: PurchasePayment[],
  rawSuppliers: Supplier[],
  params?: { range?: string; startDate?: string; endDate?: string }
): PurchaseAnalyticsData {
  const { start, end } = buildDateRangeBounds(params?.range, params?.startDate, params?.endDate);
  const suppliers = enrichSuppliersWithStats(rawSuppliers, allPurchases, { includeArchived: false });
  const activeBills = allPurchases.filter((p) => p.status !== 'draft');
  const draftBills = allPurchases.filter((p) => p.status === 'draft').length;

  const rangedBills = activeBills.filter((p) => p.billDate >= start && p.billDate <= end);
  const rangedPayments = allPurchasePayments.filter(
    (p) => p.paymentDate >= start && p.paymentDate <= end
  );

  const totalPurchases = fromPaise(rangedBills.reduce((s, p) => s + toPaise(p.grandTotal), 0));
  const amountPaid = fromPaise(rangedPayments.reduce((s, p) => s + toPaise(p.amount), 0));
  const outstandingPayables = fromPaise(
    activeBills.reduce((s, p) => s + toPaise(p.balanceDue), 0)
  );
  const overduePayables = fromPaise(
    activeBills
      .filter((p) => p.status === 'overdue')
      .reduce((s, p) => s + toPaise(p.balanceDue), 0)
  );

  const useDaily = params?.range === 'today' || params?.range === 'week';
  const bucketMap = new Map<
    string,
    { purchasedPaise: number; paidPaise: number; billCount: number }
  >();
  for (const b of rangedBills) {
    const key = useDaily ? b.billDate : b.billDate.slice(0, 7);
    const cur = bucketMap.get(key) || { purchasedPaise: 0, paidPaise: 0, billCount: 0 };
    cur.purchasedPaise += toPaise(b.grandTotal);
    cur.billCount += 1;
    bucketMap.set(key, cur);
  }
  for (const pay of rangedPayments) {
    const key = useDaily ? pay.paymentDate : pay.paymentDate.slice(0, 7);
    const cur = bucketMap.get(key) || { purchasedPaise: 0, paidPaise: 0, billCount: 0 };
    cur.paidPaise += toPaise(pay.amount);
    bucketMap.set(key, cur);
  }

  const purchaseSeries = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({
      period,
      label: useDaily ? period.slice(5) : period,
      purchased: fromPaise(v.purchasedPaise),
      paid: fromPaise(v.paidPaise),
      billCount: v.billCount,
    }));

  const statusMap = new Map<PurchaseStatus, { count: number; amountPaise: number }>();
  for (const p of allPurchases) {
    const cur = statusMap.get(p.status) || { count: 0, amountPaise: 0 };
    cur.count += 1;
    cur.amountPaise += toPaise(p.grandTotal);
    statusMap.set(p.status, cur);
  }
  const statusBreakdown = Array.from(statusMap.entries()).map(([status, v]) => ({
    status,
    count: v.count,
    amount: fromPaise(v.amountPaise),
  }));

  const supAgg = new Map<
    string,
    {
      supplierId: string;
      name: string;
      companyName: string;
      gstin: string;
      totalPaise: number;
      outstandingPaise: number;
      billCount: number;
    }
  >();
  for (const b of rangedBills) {
    const cur = supAgg.get(b.supplierId) || {
      supplierId: b.supplierId,
      name: b.supplierSnapshot.name,
      companyName: b.supplierSnapshot.companyName,
      gstin: b.supplierSnapshot.gstin,
      totalPaise: 0,
      outstandingPaise: 0,
      billCount: 0,
    };
    cur.totalPaise += toPaise(b.grandTotal);
    cur.outstandingPaise += toPaise(b.balanceDue);
    cur.billCount += 1;
    supAgg.set(b.supplierId, cur);
  }
  const topSuppliers = Array.from(supAgg.values())
    .sort((a, b) => b.totalPaise - a.totalPaise)
    .slice(0, 6)
    .map((s) => ({
      supplierId: s.supplierId,
      name: s.name,
      companyName: s.companyName,
      gstin: s.gstin,
      totalPurchases: fromPaise(s.totalPaise),
      outstanding: fromPaise(s.outstandingPaise),
      billCount: s.billCount,
    }));

  return {
    summary: {
      totalPurchases,
      totalPurchaseBills: rangedBills.length,
      amountPaid,
      outstandingPayables,
      overduePayables,
      totalVendors: suppliers.length,
      draftBills,
    },
    purchaseSeries,
    statusBreakdown,
    topSuppliers,
    recentPurchases: allPurchases.slice(0, 8),
  };
}

export function computeCombinedSalesVsPurchases(
  allInvoices: Invoice[],
  allPurchases: Purchase[],
  params?: { range?: string; startDate?: string; endDate?: string }
): Array<{
  period: string;
  label: string;
  salesRevenue: number;
  purchaseValue: number;
  grossDifference: number;
}> {
  const { start, end } = buildDateRangeBounds(params?.range, params?.startDate, params?.endDate);
  const useDaily = params?.range === 'today' || params?.range === 'week';
  const buckets = new Map<string, { salesPaise: number; purchasePaise: number }>();

  for (const inv of allInvoices) {
    if (inv.status === 'draft' || inv.status === 'cancelled') continue;
    if (inv.invoiceDate < start || inv.invoiceDate > end) continue;
    const key = useDaily ? inv.invoiceDate : inv.invoiceDate.slice(0, 7);
    const cur = buckets.get(key) || { salesPaise: 0, purchasePaise: 0 };
    cur.salesPaise += toPaise(inv.grandTotal);
    buckets.set(key, cur);
  }

  for (const pur of allPurchases) {
    if (pur.status === 'draft') continue;
    if (pur.billDate < start || pur.billDate > end) continue;
    const key = useDaily ? pur.billDate : pur.billDate.slice(0, 7);
    const cur = buckets.get(key) || { salesPaise: 0, purchasePaise: 0 };
    cur.purchasePaise += toPaise(pur.grandTotal);
    buckets.set(key, cur);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({
      period,
      label: useDaily ? period.slice(5) : period,
      salesRevenue: fromPaise(v.salesPaise),
      purchaseValue: fromPaise(v.purchasePaise),
      grossDifference: fromPaise(v.salesPaise - v.purchasePaise),
    }));
}

const metaListenerRegistry = new Map<string, { refs: number; unsub: () => void }>();

export function ensureTenantMetaListener(tenantUid: string): () => void {
  const existing = metaListenerRegistry.get(tenantUid);
  if (existing) {
    existing.refs += 1;
    return () => {
      const cur = metaListenerRegistry.get(tenantUid);
      if (!cur) return;
      cur.refs -= 1;
      if (cur.refs <= 0) {
        cur.unsub();
        metaListenerRegistry.delete(tenantUid);
      }
    };
  }

  let initialized = false;
  const unsub = onValue(
    ref(rtdb, `tenants/${tenantUid}/_meta`),
    (snap) => {
      if (!initialized) {
        initialized = true;
        if (!snap.exists()) return;
      }
      const meta = (snap.val() as TenantMetaMap | null) || {};
      const entry = getTenantEntry(tenantUid);

      const checkAndRefresh = async (
        col: TenantCollection,
        refresher: (uid: string, force: boolean) => Promise<unknown>
      ) => {
        const remoteTs = Number(meta[col] || 0);
        const localTs = Number(entry.syncedAt[col] || 0);
        if (remoteTs > localTs && localTs > 0) {
          invalidateTenantCollection(tenantUid, col);
          await refresher(tenantUid, true);
        }
      };

      void checkAndRefresh('profile', async (uid) => {
        if (hasPendingSyncForProfile(uid)) return;
        const profSnap = await get(ref(rtdb, `businessProfiles/${uid}`));
        if (profSnap.exists()) {
          const prof = normalizeBusinessProfile(
            uid,
            profSnap.val() as Record<string, unknown>
          );
          setTenantProfileCache(uid, prof, true);
          cascadeBusinessSnapshotInCache(uid, prof);
        }
      });
      void checkAndRefresh('invoices', listTenantInvoicesRaw);
      void checkAndRefresh('quotations', listTenantQuotationsRaw);
      void checkAndRefresh('payments', listTenantPaymentsRaw);
      void checkAndRefresh('customers', listTenantCustomersBaseRaw);
      void checkAndRefresh('rateCard', listTenantRateCardAllRaw);
      void checkAndRefresh('notifications', listTenantNotificationsRaw);
      void checkAndRefresh('activityLogs', listTenantActivityLogsRaw);
      void checkAndRefresh('suppliers', listTenantSuppliersBaseRaw);
      void checkAndRefresh('purchases', listTenantPurchasesRaw);
      void checkAndRefresh('purchasePayments', listTenantPurchasePaymentsRaw);
      void checkAndRefresh('purchaseAttachments', listTenantPurchaseAttachmentsRaw);
    },
    () => {}
  );

  metaListenerRegistry.set(tenantUid, { refs: 1, unsub });
  return () => {
    const cur = metaListenerRegistry.get(tenantUid);
    if (!cur) return;
    cur.refs -= 1;
    if (cur.refs <= 0) {
      cur.unsub();
      metaListenerRegistry.delete(tenantUid);
    }
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

async function fetchAdminUsersCached(forceRefresh = false): Promise<UserRecord[]> {
  if (!forceRefresh && isAdminSliceFresh('users')) {
    return getAdminCache().users;
  }
  return dedupeFetch('admin:users', async () => {
    const snap = await get(ref(rtdb, 'users'));
    const users = snap.exists()
      ? Object.entries(snap.val() as Record<string, Record<string, unknown>>).map(([uid, raw]) =>
          normalizeUserRecord(uid, raw)
        )
      : [];
    setAdminSliceData('users', users);
    return users;
  });
}

async function fetchAdminTenantsCached(
  forceRefresh = false
): Promise<Record<string, { invoices: Invoice[]; quotations: Quotation[]; payments: Payment[] }>> {
  if (!forceRefresh && isAdminSliceFresh('tenants')) {
    return getAdminCache().tenants;
  }
  return dedupeFetch('admin:tenants', async () => {
    const snap = await get(ref(rtdb, 'tenants'));
    const tenantsMap = snap.exists()
      ? (snap.val() as Record<string, Record<string, unknown>>)
      : {};
    const parsed: Record<
      string,
      { invoices: Invoice[]; quotations: Quotation[]; payments: Payment[] }
    > = {};
    for (const [uid, t] of Object.entries(tenantsMap)) {
      const invObj = (t.invoices as Record<string, Record<string, unknown>>) || {};
      const quoObj = (t.quotations as Record<string, Record<string, unknown>>) || {};
      const payObj = (t.payments as Record<string, Record<string, unknown>>) || {};
      parsed[uid] = {
        invoices: Object.values(invObj).map(normalizeInvoice),
        quotations: Object.values(quoObj).map(normalizeQuotation),
        payments: Object.values(payObj).map(normalizePayment),
      };
    }
    setAdminSliceData('tenants', parsed);
    return parsed;
  });
}

async function fetchAdminLogsCached(forceRefresh = false): Promise<ActivityLog[]> {
  if (!forceRefresh && isAdminSliceFresh('activityLogs')) {
    return getAdminCache().activityLogs;
  }
  return dedupeFetch('admin:activityLogs', async () => {
    const snap = await get(ref(rtdb, 'activityLogs'));
    const logs = snap.exists()
      ? Object.values(snap.val() as Record<string, Record<string, unknown>>)
          .map(normalizeActivityLog)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 150)
      : [];
    setAdminSliceData('activityLogs', logs);
    return logs;
  });
}

export function computeAdminDashboardFromData(
  users: UserRecord[],
  tenants: Record<string, { invoices: Invoice[]; quotations: Quotation[]; payments: Payment[] }>,
  logs: ActivityLog[],
  params?: { range?: string; startDate?: string; endDate?: string }
): AdminDashboardData {
  const { start, end } = buildDateRangeBounds(params?.range, params?.startDate, params?.endDate);
  const allUsers = users.filter((u) => u.role === 'business');
  const allInvoices: Invoice[] = [];
  const allQuotations: Quotation[] = [];
  const allPayments: Payment[] = [];

  for (const u of allUsers) {
    const t = tenants[u.uid];
    if (!t) continue;
    allInvoices.push(...t.invoices);
    allQuotations.push(...t.quotations);
    allPayments.push(...t.payments);
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
      const t = tenants[u.uid] || { invoices: [], quotations: [], payments: [] };
      const salesPaise = t.invoices
        .filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
        .reduce((s, i) => s + toPaise(i.grandTotal), 0);
      return {
        ...u,
        invoiceCount: t.invoices.length,
        quotationCount: t.quotations.length,
        totalSales: fromPaise(salesPaise),
      };
    });

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
    recentActivity: logs.slice(0, 15),
  };
}

export const cachedRead = {
  getTenantEntry,
  hasTenantCollectionData,
  setTenantProfileCache,
  subscribeTenantCache,
  subscribeAdminCache,
  getAdminCache,
  getCachedSession,
  getCachedPublicSettings,
  enrichCustomersWithStats,
  enrichSuppliersWithStats,
  computeCustomerAnalyticsFromData,
  computePurchaseAnalyticsFromData,
  computeCombinedSalesVsPurchases,
  computeOutstandingRowsFromInvoices,
  computeAdminDashboardFromData,
  ensureTenantMetaListener,
};

export const rtdbService = {
  getPublicSettings: async () => {
    const cached = getCachedPublicSettings();
    if (cached) return cached;
    try {
      const s = await ensurePlatformSettings();
      const pub = {
        platformName: s.platformName,
        allowSelfRegistration: s.allowSelfRegistration,
        maintenanceMode: s.maintenanceMode,
        supportEmail: s.supportEmail,
      };
      setCachedPublicSettings(pub);
      return pub;
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
      const ctx = await resolveCurrentAuthContext(true);
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
    defaultIsGst?: boolean;
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
      const defaultIsGst = payload.defaultIsGst !== false;

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
        defaultIsGst,
        invoicePrefix: settings.defaultInvoicePrefix,
        quotationPrefix: settings.defaultQuotationPrefix,
        signatureLabel: `For ${businessName}`,
        updatedAt: now,
      });

      await set(ref(rtdb, `users/${uid}`), stripUndefined(userRec));
      await set(ref(rtdb, `businessProfiles/${uid}`), stripUndefined(profileRec));

      setStoredImpersonationId(null);
      const ctx = await resolveCurrentAuthContext(true);
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
    updateRuntimeSessionCache(null);
    clearAllRuntimeSessionCaches();
    await signOut(firebaseAuth);
  },

  me: async (forceRefresh = false): Promise<{ session: AuthSessionState }> => {
    const session = await resolveCurrentAuthContext(forceRefresh);
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
    const tenantUid = ctx.effectiveUser.uid;
    const cachedProf = getTenantEntry(tenantUid).profile || ctx.businessProfile;
    if (
      cachedProf &&
      (isTenantCollectionFresh(tenantUid, 'profile') || hasPendingSyncForProfile(tenantUid))
    ) {
      return { profile: cachedProf };
    }
    const snap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
    if (!snap.exists()) {
      throw new Error('Business profile not found');
    }
    const prof = normalizeBusinessProfile(tenantUid, snap.val() as Record<string, unknown>);
    setTenantProfileCache(tenantUid, prof, true);
    return { profile: prof };
  },

  updateBusinessProfile: async (
    input: Partial<BusinessProfile>
  ): Promise<{ profile: BusinessProfile }> => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    let existing = getTenantEntry(tenantUid).profile || ctx.businessProfile;
    if (!existing) {
      const snap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
      existing = snap.exists()
        ? normalizeBusinessProfile(tenantUid, snap.val() as Record<string, unknown>)
        : normalizeBusinessProfile(tenantUid, {});
    }

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
      signatureDataUrl:
        typeof input.signatureDataUrl === 'string' && input.signatureDataUrl.length < 1_000_000
          ? input.signatureDataUrl
          : existing.signatureDataUrl,
      updatedAt: now,
    };

    const userPatch = {
      businessName: updated.businessName,
      ownerName: updated.ownerName,
      phone: updated.phone,
      gstin: updated.gstin,
      updatedAt: now,
    };

    // Instant localStorage update + snapshot cascade for fast UX & immediate downloads
    setTenantProfileCache(tenantUid, updated, true);
    cascadeBusinessSnapshotInCache(tenantUid, updated);

    const cacheEntry = getTenantEntry(tenantUid);
    if (input.defaultInvoiceTemplate && cacheEntry.invoices.length > 0) {
      setTenantCollectionData(
        tenantUid,
        'invoices',
        cacheEntry.invoices.map((inv) => ({
          ...inv,
          templateId: input.defaultInvoiceTemplate as TemplateId,
        })),
        true
      );
    }
    if (input.defaultQuotationTemplate && cacheEntry.quotations.length > 0) {
      setTenantCollectionData(
        tenantUid,
        'quotations',
        cacheEntry.quotations.map((quo) => ({
          ...quo,
          templateId: input.defaultQuotationTemplate as TemplateId,
        })),
        true
      );
    }

    updateRuntimeSessionCache({
      ...ctx,
      businessProfile: updated,
      effectiveUser: {
        ...ctx.effectiveUser,
        ...userPatch,
      },
    });

    // Queue Firebase RTDB sync & flush in background
    enqueuePendingSyncOp(tenantUid, {
      id: generateId('sync'),
      kind: 'upsert_profile',
      profile: updated,
      userPatch,
      cascadeDefaultInvoiceTemplate: input.defaultInvoiceTemplate,
      cascadeDefaultQuotationTemplate: input.defaultQuotationTemplate,
      cascadeBusinessSnapshot: true,
      createdAt: Date.now(),
    });
    void flushTenantSyncQueue(tenantUid);

    void logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'BUSINESS_PROFILE_UPDATED',
      entityType: 'business_profile',
      entityId: tenantUid,
      summary: `Updated business profile & preferences for ${updated.businessName}`,
    }).catch(() => {});

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
    const [allCustomers, allInvoices, allQuotations, allPayments] = await Promise.all([
      listTenantCustomersRaw(tenantUid, { includeArchived: true }),
      listTenantInvoicesRaw(tenantUid),
      listTenantQuotationsRaw(tenantUid),
      listTenantPaymentsRaw(tenantUid),
    ]);
    const customer = allCustomers.find((c) => c.id === customerId);
    if (!customer) throw new Error('Customer not found');

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

    upsertTenantCustomerCache(tenantUid, customer);
    enqueuePendingSyncOp(tenantUid, {
      id: generateId('sync'),
      kind: 'upsert_customer',
      customer,
      createdAt: Date.now(),
    });
    void flushTenantSyncQueue(tenantUid);

    void logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: id,
      summary: `Added customer ${customer.companyName || name}`,
    }).catch(() => {});

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
    let existing = getTenantEntry(tenantUid).customers.find((c) => c.id === customerId);
    if (!existing) {
      const snap = await get(custRef);
      if (!snap.exists()) throw new Error('Customer not found');
      existing = normalizeCustomer(snap.val() as Record<string, unknown>);
    }

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

    upsertTenantCustomerCache(tenantUid, updated);
    cascadeCustomerSnapshotInCache(tenantUid, updated);
    enqueuePendingSyncOp(tenantUid, {
      id: generateId('sync'),
      kind: 'upsert_customer',
      customer: updated,
      cascadeSnapshot: true,
      createdAt: Date.now(),
    });
    void flushTenantSyncQueue(tenantUid);

    const isUnarchiving = existing.archived && !updated.archived;
    void logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: isUnarchiving ? 'CUSTOMER_UNARCHIVED' : 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: customerId,
      summary: isUnarchiving ? `Unarchived customer ${name}` : `Updated customer ${name}`,
    }).catch(() => {});

    const cacheEntry = getTenantEntry(tenantUid);
    const enriched = enrichCustomersWithStats(
      [updated],
      cacheEntry.invoices,
      cacheEntry.quotations,
      { includeArchived: true }
    )[0];
    return { customer: enriched || updated };
  },

  deleteCustomer: async (customerId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const custRef = ref(rtdb, `tenants/${tenantUid}/customers/${customerId}`);
    let existing = getTenantEntry(tenantUid).customers.find((c) => c.id === customerId);
    if (!existing) {
      const snap = await get(custRef);
      if (!snap.exists()) throw new Error('Customer not found');
      existing = normalizeCustomer(snap.val() as Record<string, unknown>);
    }

    const [invoices, quotations] = await Promise.all([
      listTenantInvoicesRaw(tenantUid),
      listTenantQuotationsRaw(tenantUid),
    ]);
    const hasDocs =
      invoices.some((i) => i.customerId === customerId) ||
      quotations.some((q) => q.customerId === customerId);

    if (hasDocs) {
      const now = new Date().toISOString();
      await update(custRef, { archived: true, updatedAt: now });
      upsertTenantCustomerCache(tenantUid, { ...existing, archived: true, updatedAt: now });
      await touchTenantMeta(tenantUid, ['customers']);
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
      removeTenantCustomerCache(tenantUid, customerId);
      await touchTenantMeta(tenantUid, ['customers']);
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
    const tenantUid = ctx.effectiveUser.uid;
    const [rawList] = await Promise.all([
      listTenantInvoicesRaw(tenantUid),
      listTenantCustomersBaseRaw(tenantUid),
    ]);
    let list = rawList.map((inv) => mergeDocumentWithLiveSnapshotsSync(inv));

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
    const [invoices, payments, allLogs] = await Promise.all([
      listTenantInvoicesRaw(tenantUid),
      listTenantPaymentsRaw(tenantUid),
      listTenantActivityLogsRaw(tenantUid),
      listTenantCustomersBaseRaw(tenantUid),
    ]);
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    const invoiceCopy: Invoice = mergeDocumentWithLiveSnapshotsSync({
      ...invoice,
      payments: payments.filter((p) => p.invoiceId === invoiceId),
    });
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

    return { invoice: invoiceCopy, auditLogs };
  },

  saveInvoice: async (input: SaveDocumentPayload, existingInvoiceId?: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const cleanItems = validateLineItems(input.items);

    let profile = getTenantEntry(tenantUid).profile || ctx.businessProfile;
    if (!profile) {
      const profSnap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
      if (!profSnap.exists()) throw new Error('Business profile not configured');
      profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
      setTenantProfileCache(tenantUid, profile, true);
    }

    let customer = getTenantEntry(tenantUid).customers.find((c) => c.id === input.customerId);
    if (!customer) {
      const custSnap = await get(ref(rtdb, `tenants/${tenantUid}/customers/${input.customerId}`));
      if (!custSnap.exists()) throw new Error('Selected customer does not belong to this workspace');
      customer = normalizeCustomer(custSnap.val() as Record<string, unknown>);
      upsertTenantCustomerCache(tenantUid, customer);
    }

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
      signatureDataUrl: profile.signatureDataUrl,
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
      VALID_TEMPLATE_IDS.includes(input.templateId as TemplateId)
        ? input.templateId
        : profile.defaultInvoiceTemplate;

    const now = new Date().toISOString();

    let profileUpdated = false;
    let nextProfile = profile;
    if (
      input.saveLogoToProfile &&
      input.logoDataUrl !== undefined &&
      businessSnapshot.logoDataUrl !== nextProfile.logoDataUrl
    ) {
      nextProfile = { ...nextProfile, logoDataUrl: businessSnapshot.logoDataUrl, updatedAt: now };
      profileUpdated = true;
    }
    if (
      input.saveUpiToProfile &&
      input.upiId !== undefined &&
      businessSnapshot.upiId !== nextProfile.upiId
    ) {
      nextProfile = { ...nextProfile, upiId: businessSnapshot.upiId, updatedAt: now };
      profileUpdated = true;
    }
    if (profileUpdated) {
      profile = nextProfile;
      setTenantProfileCache(tenantUid, profile, true);
      cascadeBusinessSnapshotInCache(tenantUid, profile);
      updateRuntimeSessionCache({ ...ctx, businessProfile: profile });
      enqueuePendingSyncOp(tenantUid, {
        id: generateId('sync'),
        kind: 'upsert_profile',
        profile,
        cascadeBusinessSnapshot: true,
        createdAt: Date.now(),
      });
    }

    const targetId = existingInvoiceId || generateId('inv');
    let invoiceNumber = '';
    let status: InvoiceStatus = 'draft';
    let finalizedAt: string | null = null;
    let createdAt = now;
    let amountPaid = 0;
    let balanceDue = calc.grandTotal;
    let sourceQuotationId: string | null = null;
    let wasAlreadyFinalized = false;
    let seqAlloc: { counterKey: string; seq: number } | undefined;

    if (existingInvoiceId) {
      let existing = getTenantEntry(tenantUid).invoices.find((i) => i.id === existingInvoiceId);
      if (!existing) {
        const exSnap = await get(ref(rtdb, `tenants/${tenantUid}/invoices/${existingInvoiceId}`));
        if (!exSnap.exists()) throw new Error('Invoice not found');
        existing = normalizeInvoice(exSnap.val() as Record<string, unknown>);
      }
      if (existing.status === 'cancelled') {
        throw new Error('Cancelled invoices cannot be edited.');
      }
      createdAt = existing.createdAt;
      sourceQuotationId = existing.sourceQuotationId ?? null;

      if (existing.status === 'draft') {
        if (isDraft) {
          invoiceNumber = existing.invoiceNumber;
          status = 'draft';
        } else {
          const allocated = allocateLocalDocNumber(
            tenantUid,
            'INV',
            profile.invoicePrefix,
            invoiceDate,
            getTenantEntry(tenantUid).invoices.map((i) => i.invoiceNumber)
          );
          invoiceNumber = allocated.docNumber;
          seqAlloc = { counterKey: allocated.counterKey, seq: allocated.seq };
          status = dueDate < todayISO() ? 'overdue' : 'unpaid';
          finalizedAt = now;
        }
      } else {
        wasAlreadyFinalized = true;
        invoiceNumber = existing.invoiceNumber;
        finalizedAt = existing.finalizedAt || existing.createdAt;
        amountPaid = existing.amountPaid || 0;
        const paidPaise = toPaise(amountPaid);
        const grandPaise = toPaise(calc.grandTotal);
        balanceDue = fromPaise(Math.max(0, grandPaise - paidPaise));
        status =
          balanceDue === 0
            ? 'paid'
            : dueDate < todayISO()
              ? 'overdue'
              : paidPaise > 0
                ? 'partially_paid'
                : 'unpaid';
      }
    } else {
      if (isDraft) {
        invoiceNumber = `DRAFT-${generateId().slice(0, 6).toUpperCase()}`;
        status = 'draft';
      } else {
        const allocated = allocateLocalDocNumber(
          tenantUid,
          'INV',
          profile.invoicePrefix,
          invoiceDate,
          getTenantEntry(tenantUid).invoices.map((i) => i.invoiceNumber)
        );
        invoiceNumber = allocated.docNumber;
        seqAlloc = { counterKey: allocated.counterKey, seq: allocated.seq };
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
      amountPaid,
      balanceDue,
      amountInWords: calc.amountInWords,
      templateId,
      notes: sanitizeStr(input.notes, 1000),
      terms: sanitizeStr(input.terms ?? profile.termsAndConditions, 1500),
      sourceQuotationId,
      cancellationReason: null,
      cancelledAt: null,
      finalizedAt,
      createdAt,
      updatedAt: now,
      items: calc.items.map((it, idx) => ({ ...it, id: it.id || `itm_${idx + 1}` })),
    };

    upsertTenantInvoiceCache(tenantUid, savedInvoice);
    enqueuePendingSyncOp(tenantUid, {
      id: generateId('sync'),
      kind: 'upsert_invoice',
      invoice: savedInvoice,
      seqAlloc,
      createdAt: Date.now(),
    });
    void flushTenantSyncQueue(tenantUid);

    if (!isDraft && !wasAlreadyFinalized) {
      void createNotification({
        userUid: tenantUid,
        type: 'invoice_created',
        title: 'New invoice generated',
        message: `Invoice ${invoiceNumber} issued to ${
          customerSnapshot.companyName || customerSnapshot.name
        }.`,
        entityType: 'invoice',
        entityId: targetId,
      }).catch(() => {});
    }

    void logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: existingInvoiceId
        ? wasAlreadyFinalized
          ? 'INVOICE_UPDATED'
          : isDraft
            ? 'INVOICE_DRAFT_UPDATED'
            : 'INVOICE_FINALIZED'
        : isDraft
          ? 'INVOICE_DRAFT_CREATED'
          : 'INVOICE_CREATED',
      entityType: 'invoice',
      entityId: targetId,
      summary: wasAlreadyFinalized
        ? `Updated invoice ${invoiceNumber} for INR ${calc.grandTotal.toFixed(2)}`
        : isDraft
          ? `Saved draft invoice ${invoiceNumber}`
          : `Issued invoice ${invoiceNumber} for INR ${calc.grandTotal.toFixed(2)}`,
    }).catch(() => {});

    return { invoice: savedInvoice };
  },

  finalizeInvoice: async (invoiceId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    let profile = getTenantEntry(tenantUid).profile || ctx.businessProfile;
    if (!profile) {
      const profSnap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
      if (!profSnap.exists()) throw new Error('Business profile not configured');
      profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
    }
    let existing = getTenantEntry(tenantUid).invoices.find((i) => i.id === invoiceId);
    if (!existing) {
      const invSnap = await get(ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`));
      if (!invSnap.exists()) throw new Error('Invoice not found');
      existing = normalizeInvoice(invSnap.val() as Record<string, unknown>);
    }
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
    upsertTenantInvoiceCache(tenantUid, updated);
    await touchTenantMeta(tenantUid, ['invoices']);

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
    let existing = getTenantEntry(tenantUid).invoices.find((i) => i.id === invoiceId);
    if (!existing) {
      const invSnap = await get(ref(rtdb, `tenants/${tenantUid}/invoices/${invoiceId}`));
      if (!invSnap.exists()) throw new Error('Invoice not found');
      existing = normalizeInvoice(invSnap.val() as Record<string, unknown>);
    }
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
    upsertTenantInvoiceCache(tenantUid, updated);
    await touchTenantMeta(tenantUid, ['invoices']);

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
    const tenantUid = ctx.effectiveUser.uid;
    const [rawList] = await Promise.all([
      listTenantQuotationsRaw(tenantUid),
      listTenantCustomersBaseRaw(tenantUid),
    ]);
    let list = rawList.map((q) => mergeDocumentWithLiveSnapshotsSync(q));

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
    const [quotations] = await Promise.all([
      listTenantQuotationsRaw(tenantUid),
      listTenantCustomersBaseRaw(tenantUid),
    ]);
    const quotation = quotations.find((q) => q.id === quotationId);
    if (!quotation) throw new Error('Quotation not found');
    return { quotation: mergeDocumentWithLiveSnapshotsSync(quotation) };
  },

  saveQuotation: async (input: SaveDocumentPayload, existingQuotationId?: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const cleanItems = validateLineItems(input.items);

    let profile = getTenantEntry(tenantUid).profile || ctx.businessProfile;
    if (!profile) {
      const profSnap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
      if (!profSnap.exists()) throw new Error('Business profile not configured');
      profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
      setTenantProfileCache(tenantUid, profile, true);
    }

    let customer = getTenantEntry(tenantUid).customers.find((c) => c.id === input.customerId);
    if (!customer) {
      const custSnap = await get(ref(rtdb, `tenants/${tenantUid}/customers/${input.customerId}`));
      if (!custSnap.exists()) throw new Error('Selected customer does not belong to this workspace');
      customer = normalizeCustomer(custSnap.val() as Record<string, unknown>);
      upsertTenantCustomerCache(tenantUid, customer);
    }

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
      signatureDataUrl: profile.signatureDataUrl,
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
      VALID_TEMPLATE_IDS.includes(input.templateId as TemplateId)
        ? input.templateId
        : profile.defaultQuotationTemplate;

    const now = new Date().toISOString();

    let profileUpdated = false;
    let nextProfile = profile;
    if (
      input.saveLogoToProfile &&
      input.logoDataUrl !== undefined &&
      businessSnapshot.logoDataUrl !== nextProfile.logoDataUrl
    ) {
      nextProfile = { ...nextProfile, logoDataUrl: businessSnapshot.logoDataUrl, updatedAt: now };
      profileUpdated = true;
    }
    if (
      input.saveUpiToProfile &&
      input.upiId !== undefined &&
      businessSnapshot.upiId !== nextProfile.upiId
    ) {
      nextProfile = { ...nextProfile, upiId: businessSnapshot.upiId, updatedAt: now };
      profileUpdated = true;
    }
    if (profileUpdated) {
      profile = nextProfile;
      setTenantProfileCache(tenantUid, profile, true);
      cascadeBusinessSnapshotInCache(tenantUid, profile);
      updateRuntimeSessionCache({ ...ctx, businessProfile: profile });
      enqueuePendingSyncOp(tenantUid, {
        id: generateId('sync'),
        kind: 'upsert_profile',
        profile,
        cascadeBusinessSnapshot: true,
        createdAt: Date.now(),
      });
    }

    const targetId = existingQuotationId || generateId('quo');
    let quotationNumber = '';
    let status: QuotationStatus = 'draft';
    let createdAt = now;
    let seqAlloc: { counterKey: string; seq: number } | undefined;

    if (existingQuotationId) {
      let existing = getTenantEntry(tenantUid).quotations.find((q) => q.id === existingQuotationId);
      if (!existing) {
        const exSnap = await get(ref(rtdb, `tenants/${tenantUid}/quotations/${existingQuotationId}`));
        if (!exSnap.exists()) throw new Error('Quotation not found');
        existing = normalizeQuotation(exSnap.val() as Record<string, unknown>);
      }
      if (existing.status !== 'draft') throw new Error('Only draft quotations can be edited');
      createdAt = existing.createdAt;
      if (isDraft) {
        quotationNumber = existing.quotationNumber;
      } else {
        const allocated = allocateLocalDocNumber(
          tenantUid,
          'QUO',
          profile.quotationPrefix,
          quotationDate,
          getTenantEntry(tenantUid).quotations.map((q) => q.quotationNumber)
        );
        quotationNumber = allocated.docNumber;
        seqAlloc = { counterKey: allocated.counterKey, seq: allocated.seq };
      }
      status = isDraft ? 'draft' : validUntil < todayISO() ? 'expired' : 'sent';
    } else {
      if (isDraft) {
        quotationNumber = `QDRAFT-${generateId().slice(0, 5).toUpperCase()}`;
      } else {
        const allocated = allocateLocalDocNumber(
          tenantUid,
          'QUO',
          profile.quotationPrefix,
          quotationDate,
          getTenantEntry(tenantUid).quotations.map((q) => q.quotationNumber)
        );
        quotationNumber = allocated.docNumber;
        seqAlloc = { counterKey: allocated.counterKey, seq: allocated.seq };
      }
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

    upsertTenantQuotationCache(tenantUid, saved);
    enqueuePendingSyncOp(tenantUid, {
      id: generateId('sync'),
      kind: 'upsert_quotation',
      quotation: saved,
      seqAlloc,
      createdAt: Date.now(),
    });
    void flushTenantSyncQueue(tenantUid);

    void logActivity({
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
    }).catch(() => {});

    return { quotation: saved };
  },

  setQuotationStatus: async (quotationId: string, status: 'sent' | 'accepted' | 'rejected') => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const quoRef = ref(rtdb, `tenants/${tenantUid}/quotations/${quotationId}`);
    let q = getTenantEntry(tenantUid).quotations.find((item) => item.id === quotationId);
    if (!q) {
      const snap = await get(quoRef);
      if (!snap.exists()) throw new Error('Quotation not found');
      q = normalizeQuotation(snap.val() as Record<string, unknown>);
    }
    if (q.status === 'converted') throw new Error('Converted quotations cannot change status');

    const now = new Date().toISOString();
    const updated: Quotation = { ...q, status, updatedAt: now };
    await set(quoRef, stripUndefined(updated));
    upsertTenantQuotationCache(tenantUid, updated);
    await touchTenantMeta(tenantUid, ['quotations']);

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
    let profile = getTenantEntry(tenantUid).profile || ctx.businessProfile;
    if (!profile) {
      const profSnap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
      if (!profSnap.exists()) throw new Error('Business profile not configured');
      profile = normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>);
    }
    let quo = getTenantEntry(tenantUid).quotations.find((q) => q.id === quotationId);
    if (!quo) {
      const quoSnap = await get(ref(rtdb, `tenants/${tenantUid}/quotations/${quotationId}`));
      if (!quoSnap.exists()) throw new Error('Quotation not found');
      quo = normalizeQuotation(quoSnap.val() as Record<string, unknown>);
    }

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
    upsertTenantInvoiceCache(tenantUid, invoice);
    upsertTenantQuotationCache(tenantUid, {
      ...quo,
      status: 'converted',
      convertedInvoiceId: newInvId,
      updatedAt: now,
    });
    await touchTenantMeta(tenantUid, ['invoices', 'quotations']);

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

    let inv = getTenantEntry(tenantUid).invoices.find((i) => i.id === input.invoiceId);
    const invRef = ref(rtdb, `tenants/${tenantUid}/invoices/${input.invoiceId}`);
    if (!inv) {
      const invSnap = await get(invRef);
      if (!invSnap.exists()) throw new Error('Invoice not found');
      inv = normalizeInvoice(invSnap.val() as Record<string, unknown>);
    }

    if (inv.status === 'draft') throw new Error('Cannot record payment on a draft invoice');
    if (inv.status === 'cancelled') throw new Error('Cannot record payment on a cancelled invoice');

    const hasPaymentsLoaded = hasTenantCollectionData(tenantUid, 'payments');
    const refId = sanitizeStr(input.referenceId, 80);
    if (refId) {
      const existingPayments = hasPaymentsLoaded
        ? getTenantEntry(tenantUid).payments
        : await listTenantPaymentsRaw(tenantUid);
      if (existingPayments.some((p) => p.referenceId && p.referenceId === refId)) {
        throw new Error(`Duplicate payment reference ID "${refId}" detected`);
      }
    }

    const paymentDate = sanitizeStr(input.paymentDate, 10) || todayISO();
    const existingReceiptNums = getTenantEntry(tenantUid).payments.map((p) => p.receiptNumber);
    const allocated = allocateLocalDocNumber(
      tenantUid,
      'RCP',
      'RCP',
      paymentDate,
      existingReceiptNums
    );
    const receiptNumber = allocated.docNumber;
    const seqAlloc = { counterKey: allocated.counterKey, seq: allocated.seq };
    const payId = generateId('pay');
    const now = new Date().toISOString();

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

    const paidBeforePaise = hasPaymentsLoaded
      ? getTenantEntry(tenantUid)
          .payments.filter((p) => p.invoiceId === inv.id)
          .reduce((sum, p) => sum + toPaise(p.amount), 0)
      : toPaise(inv.amountPaid || 0);
    const paidPaise = paidBeforePaise + amountPaise;
    const grandPaise = toPaise(inv.grandTotal);
    const balancePaise = Math.max(0, grandPaise - paidPaise);
    const nextStatus: InvoiceStatus =
      balancePaise === 0
        ? 'paid'
        : inv.dueDate < todayISO()
          ? 'overdue'
          : paidPaise > 0
            ? 'partially_paid'
            : 'unpaid';

    const amountPaid = fromPaise(paidPaise);
    const balanceDue = fromPaise(balancePaise);
    const updatedInv: Invoice = {
      ...inv,
      amountPaid,
      balanceDue,
      status: nextStatus,
      updatedAt: now,
    };

    upsertTenantPaymentCache(tenantUid, payment);
    upsertTenantInvoiceCache(tenantUid, updatedInv);
    enqueuePendingSyncOp(tenantUid, {
      id: generateId('sync'),
      kind: 'upsert_payment',
      payment,
      invoicePatch: {
        invoiceId: inv.id,
        amountPaid,
        balanceDue,
        status: nextStatus,
        updatedAt: now,
      },
      seqAlloc,
      createdAt: Date.now(),
    });
    void flushTenantSyncQueue(tenantUid);

    void createNotification({
      userUid: tenantUid,
      type: 'payment_received',
      title: 'Payment recorded',
      message: `Received INR ${fromPaise(amountPaise).toFixed(2)} against ${inv.invoiceNumber}.`,
      entityType: 'payment',
      entityId: payId,
    }).catch(() => {});

    void logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: payId,
      summary: `Recorded ${input.paymentMethod} payment of INR ${fromPaise(amountPaise).toFixed(2)} on ${inv.invoiceNumber} (${receiptNumber})`,
    }).catch(() => {});

    return { payment, invoice: updatedInv };
  },

  updatePayment: async (
    paymentId: string,
    input: {
      paymentDate?: string;
      amount?: number;
      paymentMethod?: PaymentMethod;
      referenceId?: string;
      notes?: string;
    }
  ) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const payRef = ref(rtdb, `tenants/${tenantUid}/payments/${paymentId}`);
    let existing = getTenantEntry(tenantUid).payments.find((p) => p.id === paymentId);
    if (!existing) {
      const snap = await get(payRef);
      if (!snap.exists()) throw new Error('Payment record not found');
      existing = normalizePayment(snap.val() as Record<string, unknown>);
    }

    const nextAmount = input.amount !== undefined ? Number(input.amount) : existing.amount;
    const amountPaise = toPaise(nextAmount);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    const refId =
      input.referenceId !== undefined ? sanitizeStr(input.referenceId, 80) : existing.referenceId;
    if (refId) {
      const existingPayments = await listTenantPaymentsRaw(tenantUid);
      if (existingPayments.some((p) => p.id !== paymentId && p.referenceId && p.referenceId === refId)) {
        throw new Error(`Duplicate payment reference ID "${refId}" detected`);
      }
    }

    const now = new Date().toISOString();
    const updated: Payment = {
      ...existing,
      paymentDate:
        input.paymentDate !== undefined
          ? sanitizeStr(input.paymentDate, 10) || existing.paymentDate
          : existing.paymentDate,
      amount: fromPaise(amountPaise),
      paymentMethod: input.paymentMethod || existing.paymentMethod,
      referenceId: refId,
      notes: input.notes !== undefined ? sanitizeStr(input.notes, 300) : existing.notes,
    };

    await set(payRef, stripUndefined(updated));
    upsertTenantPaymentCache(tenantUid, updated);
    await touchTenantMeta(tenantUid, ['payments']);
    await reconcileInvoicePayments(tenantUid, existing.invoiceId, now);

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'PAYMENT_UPDATED',
      entityType: 'payment',
      entityId: paymentId,
      summary: `Updated payment ${existing.receiptNumber} (${existing.invoiceNumber || existing.invoiceId}) to INR ${updated.amount.toFixed(2)}`,
    });

    return { payment: updated };
  },

  deletePayment: async (paymentId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const payRef = ref(rtdb, `tenants/${tenantUid}/payments/${paymentId}`);
    let existing = getTenantEntry(tenantUid).payments.find((p) => p.id === paymentId);
    if (!existing) {
      const snap = await get(payRef);
      if (!snap.exists()) throw new Error('Payment record not found');
      existing = normalizePayment(snap.val() as Record<string, unknown>);
    }

    const now = new Date().toISOString();
    await remove(payRef);
    removeTenantPaymentCache(tenantUid, paymentId);
    await touchTenantMeta(tenantUid, ['payments']);
    await reconcileInvoicePayments(tenantUid, existing.invoiceId, now);

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'PAYMENT_DELETED',
      entityType: 'payment',
      entityId: paymentId,
      summary: `Deleted payment ${existing.receiptNumber} (INR ${existing.amount.toFixed(2)}) from ${existing.invoiceNumber || existing.invoiceId}`,
    });

    return { ok: true };
  },

  // ==================== RATE CARD ====================
  listRateCard: async (params?: { search?: string; activeOnly?: boolean; category?: string }) => {
    const ctx = await requireTenantContext();
    const items = await listTenantRateCardRaw(ctx.effectiveUser.uid, params);
    return { items };
  },

  createRateCardItem: async (input: Partial<RateCardItem>) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const name = sanitizeStr(input.name, 160);
    if (!name) throw new Error('Item name is required');
    const rate = Number(input.rate ?? 0);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new Error('Default rate must be 0 or greater');
    }

    const id = generateId('rc');
    const now = new Date().toISOString();
    const item: RateCardItem = {
      id,
      userUid: tenantUid,
      name,
      description: sanitizeStr(input.description, 400),
      hsnSac: sanitizeStr(input.hsnSac, 16),
      unit: sanitizeStr(input.unit, 24) || 'Nos',
      rate: fromPaise(toPaise(rate)),
      discountType: (input.discountType === 'fixed' ? 'fixed' : 'percent') as DiscountType,
      discountValue: Math.max(0, Number(input.discountValue) || 0),
      taxRate: Math.min(28, Math.max(0, Number(input.taxRate ?? 18) || 0)),
      category: sanitizeStr(input.category, 80) || 'General',
      isActive: input.isActive !== false,
      createdAt: now,
      updatedAt: now,
    };

    await set(ref(rtdb, `tenants/${tenantUid}/rateCard/${id}`), stripUndefined(item));
    upsertTenantRateCardCache(tenantUid, item);
    await touchTenantMeta(tenantUid, ['rateCard']);
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'RATE_CARD_CREATED',
      entityType: 'rate_card',
      entityId: id,
      summary: `Added rate card item ${item.name} (INR ${item.rate.toFixed(2)}/${item.unit})`,
    });

    return { item };
  },

  updateRateCardItem: async (itemId: string, input: Partial<RateCardItem>) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const itemRef = ref(rtdb, `tenants/${tenantUid}/rateCard/${itemId}`);
    let existing = getTenantEntry(tenantUid).rateCard.find((r) => r.id === itemId);
    if (!existing) {
      const snap = await get(itemRef);
      if (!snap.exists()) throw new Error('Rate card item not found');
      existing = normalizeRateCardItem(snap.val() as Record<string, unknown>);
    }

    const name = sanitizeStr(input.name ?? existing.name, 160);
    if (!name) throw new Error('Item name is required');
    const rate = input.rate !== undefined ? Number(input.rate) : existing.rate;
    if (!Number.isFinite(rate) || rate < 0) {
      throw new Error('Default rate must be 0 or greater');
    }

    const updated: RateCardItem = {
      ...existing,
      name,
      description: sanitizeStr(input.description ?? existing.description, 400),
      hsnSac: sanitizeStr(input.hsnSac ?? existing.hsnSac, 16),
      unit: sanitizeStr(input.unit ?? existing.unit, 24) || 'Nos',
      rate: fromPaise(toPaise(rate)),
      discountType:
        input.discountType !== undefined
          ? input.discountType === 'fixed'
            ? 'fixed'
            : 'percent'
          : existing.discountType,
      discountValue: Math.max(0, Number(input.discountValue ?? existing.discountValue) || 0),
      taxRate: Math.min(28, Math.max(0, Number(input.taxRate ?? existing.taxRate) || 0)),
      category: sanitizeStr(input.category ?? existing.category, 80) || 'General',
      isActive: input.isActive !== undefined ? Boolean(input.isActive) : existing.isActive,
      updatedAt: new Date().toISOString(),
    };

    await set(itemRef, stripUndefined(updated));
    upsertTenantRateCardCache(tenantUid, updated);
    await touchTenantMeta(tenantUid, ['rateCard']);
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'RATE_CARD_UPDATED',
      entityType: 'rate_card',
      entityId: itemId,
      summary: `Updated rate card item ${updated.name} (INR ${updated.rate.toFixed(2)}/${updated.unit})`,
    });

    return { item: updated };
  },

  deleteRateCardItem: async (itemId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const itemRef = ref(rtdb, `tenants/${tenantUid}/rateCard/${itemId}`);
    let existing = getTenantEntry(tenantUid).rateCard.find((r) => r.id === itemId);
    if (!existing) {
      const snap = await get(itemRef);
      if (!snap.exists()) throw new Error('Rate card item not found');
      existing = normalizeRateCardItem(snap.val() as Record<string, unknown>);
    }

    await remove(itemRef);
    removeTenantRateCardCache(tenantUid, itemId);
    await touchTenantMeta(tenantUid, ['rateCard']);
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'RATE_CARD_DELETED',
      entityType: 'rate_card',
      entityId: itemId,
      summary: `Deleted rate card item ${existing.name}`,
    });

    return { ok: true };
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
    const invoices = await listTenantInvoicesRaw(ctx.effectiveUser.uid);
    return { rows: computeOutstandingRowsFromInvoices(invoices, params) };
  },

  // ==================== NOTIFICATIONS ====================
  listNotifications: async () => {
    const ctx = await requireTenantContext();
    const notifications = await listTenantNotificationsRaw(ctx.effectiveUser.uid);
    return { notifications };
  },

  markNotificationRead: async (id: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    await update(ref(rtdb, `tenants/${tenantUid}/notifications/${id}`), {
      isRead: true,
    });
    markNotificationReadCache(tenantUid, id);
    await touchTenantMeta(tenantUid, ['notifications']);
    return { ok: true };
  },

  markAllNotificationsRead: async () => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const current = await listTenantNotificationsRaw(tenantUid);
    if (current.length === 0) return { ok: true };
    const updates: Record<string, unknown> = {};
    for (const n of current) {
      if (!n.isRead) {
        updates[`tenants/${tenantUid}/notifications/${n.id}/isRead`] = true;
      }
    }
    if (Object.keys(updates).length > 0) {
      await update(ref(rtdb), updates);
    }
    markNotificationReadCache(tenantUid);
    await touchTenantMeta(tenantUid, ['notifications']);
    return { ok: true };
  },

  // ==================== SUPPLIERS & PURCHASES MANAGEMENT ====================
  listSuppliers: async (params?: { search?: string; includeArchived?: boolean }) => {
    const ctx = await requireTenantContext();
    const [rawSuppliers, purchases] = await Promise.all([
      listTenantSuppliersBaseRaw(ctx.effectiveUser.uid),
      listTenantPurchasesRaw(ctx.effectiveUser.uid),
    ]);
    return { suppliers: enrichSuppliersWithStats(rawSuppliers, purchases, params) };
  },

  getSupplier: async (id: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const [rawSuppliers, purchases, payments] = await Promise.all([
      listTenantSuppliersBaseRaw(tenantUid),
      listTenantPurchasesRaw(tenantUid),
      listTenantPurchasePaymentsRaw(tenantUid),
    ]);
    const list = enrichSuppliersWithStats(rawSuppliers, purchases, { includeArchived: true });
    const supplier = list.find((s) => s.id === id);
    if (!supplier) throw new Error('Supplier not found');
    return {
      supplier,
      purchases: purchases.filter((p) => p.supplierId === id),
      payments: payments.filter((p) => p.supplierId === id),
    };
  },

  createSupplier: async (input: Partial<Supplier>) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const name = sanitizeStr(input.name, 120);
    const companyName = sanitizeStr(input.companyName, 160);
    if (!name && !companyName) {
      throw new Error('Supplier name or company name is required');
    }
    const gstin = sanitizeStr(input.gstin, 20).toUpperCase();
    if (gstin && !isValidGstin(gstin)) {
      throw new Error('Invalid supplier GSTIN format');
    }

    const existingList = await listTenantSuppliersBaseRaw(tenantUid);
    if (gstin) {
      const dup = existingList.find((s) => !s.archived && s.gstin === gstin);
      if (dup) {
        throw new Error(
          `Supplier "${dup.companyName || dup.name}" with GSTIN ${gstin} already exists`
        );
      }
    }

    const state =
      sanitizeStr(input.state, 64) || getStateFromGstin(gstin) || 'Maharashtra';
    const stateCode = sanitizeStr(input.stateCode, 4) || getStateCode(state);
    const id = generateId('sup');
    const now = new Date().toISOString();
    const supplier: Supplier = {
      id,
      userUid: tenantUid,
      name: name || companyName,
      companyName,
      email: sanitizeStr(input.email, 160).toLowerCase(),
      phone: sanitizeStr(input.phone, 32),
      gstin,
      billingAddress: sanitizeStr(input.billingAddress, 400),
      state,
      stateCode,
      notes: sanitizeStr(input.notes, 400),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    await set(ref(rtdb, `tenants/${tenantUid}/suppliers/${id}`), stripUndefined(supplier));
    upsertTenantSupplierCache(tenantUid, supplier);
    await touchTenantMeta(tenantUid, ['suppliers']);
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'SUPPLIER_CREATED',
      entityType: 'supplier',
      entityId: id,
      summary: `Added supplier ${supplier.companyName || supplier.name}`,
    });
    return { supplier };
  },

  updateSupplier: async (id: string, input: Partial<Supplier>) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const list = await listTenantSuppliersBaseRaw(tenantUid);
    const existing = list.find((s) => s.id === id);
    if (!existing) throw new Error('Supplier not found');

    const gstin =
      input.gstin !== undefined ? sanitizeStr(input.gstin, 20).toUpperCase() : existing.gstin;
    if (gstin && !isValidGstin(gstin)) {
      throw new Error('Invalid supplier GSTIN format');
    }
    if (gstin && list.some((s) => s.id !== id && !s.archived && s.gstin === gstin)) {
      throw new Error(`Another active supplier already uses GSTIN ${gstin}`);
    }

    const nextState =
      input.state !== undefined
        ? sanitizeStr(input.state, 64) || existing.state
        : existing.state;
    const updated: Supplier = {
      ...existing,
      name: input.name !== undefined ? sanitizeStr(input.name, 120) || existing.name : existing.name,
      companyName:
        input.companyName !== undefined
          ? sanitizeStr(input.companyName, 160)
          : existing.companyName,
      email:
        input.email !== undefined
          ? sanitizeStr(input.email, 160).toLowerCase()
          : existing.email,
      phone: input.phone !== undefined ? sanitizeStr(input.phone, 32) : existing.phone,
      gstin,
      billingAddress:
        input.billingAddress !== undefined
          ? sanitizeStr(input.billingAddress, 400)
          : existing.billingAddress,
      state: nextState,
      stateCode:
        input.stateCode !== undefined
          ? sanitizeStr(input.stateCode, 4) || getStateCode(nextState)
          : getStateCode(nextState) || existing.stateCode,
      notes: input.notes !== undefined ? sanitizeStr(input.notes, 400) : existing.notes,
      updatedAt: new Date().toISOString(),
    };

    await set(ref(rtdb, `tenants/${tenantUid}/suppliers/${id}`), stripUndefined(updated));
    upsertTenantSupplierCache(tenantUid, updated);
    await touchTenantMeta(tenantUid, ['suppliers']);
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'SUPPLIER_UPDATED',
      entityType: 'supplier',
      entityId: id,
      summary: `Updated supplier ${updated.companyName || updated.name}`,
    });
    return { supplier: updated };
  },

  deleteSupplier: async (id: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const [list, purchases] = await Promise.all([
      listTenantSuppliersBaseRaw(tenantUid),
      listTenantPurchasesRaw(tenantUid),
    ]);
    const existing = list.find((s) => s.id === id);
    if (!existing) throw new Error('Supplier not found');

    const linkedBills = purchases.filter((p) => p.supplierId === id);
    if (linkedBills.length > 0) {
      const archived: Supplier = {
        ...existing,
        archived: true,
        updatedAt: new Date().toISOString(),
      };
      await update(ref(rtdb, `tenants/${tenantUid}/suppliers/${id}`), {
        archived: true,
        updatedAt: archived.updatedAt,
      });
      upsertTenantSupplierCache(tenantUid, archived);
      await touchTenantMeta(tenantUid, ['suppliers']);
      return { ok: true, mode: 'archived' as const };
    }

    await remove(ref(rtdb, `tenants/${tenantUid}/suppliers/${id}`));
    removeTenantSupplierCache(tenantUid, id);
    await touchTenantMeta(tenantUid, ['suppliers']);
    return { ok: true, mode: 'deleted' as const };
  },

  listPurchases: async (params?: {
    search?: string;
    status?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const ctx = await requireTenantContext();
    let list = await listTenantPurchasesRaw(ctx.effectiveUser.uid);
    if (params?.status && params.status !== 'all') {
      list = list.filter((p) => p.status === params.status);
    }
    if (params?.supplierId && params.supplierId !== 'all') {
      list = list.filter((p) => p.supplierId === params.supplierId);
    }
    if (params?.startDate) {
      list = list.filter((p) => p.billDate >= params.startDate!);
    }
    if (params?.endDate) {
      list = list.filter((p) => p.billDate <= params.endDate!);
    }
    if (params?.search) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.billNumber.toLowerCase().includes(q) ||
          p.referenceNumber.toLowerCase().includes(q) ||
          p.supplierSnapshot.companyName.toLowerCase().includes(q) ||
          p.supplierSnapshot.name.toLowerCase().includes(q) ||
          p.supplierSnapshot.gstin.toLowerCase().includes(q)
      );
    }
    return { purchases: list };
  },

  getPurchase: async (id: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const [purchases, payments, attachments] = await Promise.all([
      listTenantPurchasesRaw(tenantUid),
      listTenantPurchasePaymentsRaw(tenantUid),
      listTenantPurchaseAttachmentsRaw(tenantUid),
    ]);
    const purchase = purchases.find((p) => p.id === id);
    if (!purchase) throw new Error('Purchase bill not found');
    const billPayments = payments.filter((p) => p.purchaseId === id);
    const attachment = attachments.find((a) => a.purchaseId === id) || null;
    return { purchase, payments: billPayments, attachment };
  },

  savePurchase: async (payload: SavePurchasePayload, editId?: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    let profile = getTenantEntry(tenantUid).profile || ctx.businessProfile;
    if (!profile) {
      const profSnap = await get(ref(rtdb, `businessProfiles/${tenantUid}`));
      profile = profSnap.exists()
        ? normalizeBusinessProfile(tenantUid, profSnap.val() as Record<string, unknown>)
        : normalizeBusinessProfile(tenantUid, { state: 'Maharashtra' });
      setTenantProfileCache(tenantUid, profile, true);
    }
    const suppliers = await listTenantSuppliersBaseRaw(tenantUid);
    const supplier = suppliers.find((s) => s.id === payload.supplierId);
    if (!supplier) throw new Error('Selected supplier not found');

    const billNumber = sanitizeStr(payload.billNumber, 64);
    if (!billNumber) throw new Error('Purchase bill number is required');

    const billDate = sanitizeStr(payload.billDate, 10) || todayISO();
    const dueDate = sanitizeStr(payload.dueDate, 10) || billDate;
    const validatedItems = validateLineItems(payload.items).map((it, idx) => ({
      ...it,
      ocrConfidence: payload.items[idx]?.ocrConfidence,
      ocrStatus: payload.items[idx]?.ocrStatus,
      ocrMessage: payload.items[idx]?.ocrMessage,
    })) as PurchaseLineItemInput[];

    const existingList = await listTenantPurchasesRaw(tenantUid);
    const existing = editId ? existingList.find((p) => p.id === editId) : undefined;
    if (editId && !existing) throw new Error('Purchase bill not found');

    const duplicateBill = existingList.find(
      (p) =>
        p.id !== editId &&
        p.supplierId === supplier.id &&
        p.billNumber.trim().toLowerCase() === billNumber.toLowerCase()
    );
    if (duplicateBill) {
      throw new Error(
        `Purchase bill "${billNumber}" is already recorded for supplier ${
          supplier.companyName || supplier.name
        }`
      );
    }

    const calc = computePurchaseTotals({
      items: validatedItems,
      supplierState: supplier.state,
      recipientState: profile.state,
      placeOfSupply: payload.placeOfSupply || profile.state,
      purchaseType: payload.purchaseType,
      taxMode: payload.taxMode,
      taxSupplyMode: payload.taxSupplyMode,
      invoiceDiscountType: payload.invoiceDiscountType,
      invoiceDiscountValue: payload.invoiceDiscountValue,
      additionalCharges: payload.additionalCharges,
      roundOffEnabled: payload.roundOffEnabled,
    });

    if (!calc.taxRuleChecked && payload.purchaseType === 'gst') {
      throw new Error(
        calc.taxRuleWarning ||
          'Verify supplier state and recipient place of supply before saving GST purchase.'
      );
    }

    const now = new Date().toISOString();
    const purchaseId = existing ? existing.id : generateId('pur');

    // Optional Firebase Storage upload for scanned bill attachment
    let attachmentId = existing?.attachmentId;
    let attachmentMeta = existing?.attachmentMeta ?? null;

    if (payload.attachmentFile?.base64Data) {
      const attId = generateId('att');
      const safeName =
        payload.attachmentFile.fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'purchase-bill';
      const storagePath = `tenants/${tenantUid}/purchaseAttachments/${attId}/${safeName}`;
      try {
        const cleanB64 = payload.attachmentFile.base64Data.includes(',')
          ? payload.attachmentFile.base64Data.split(',')[1] || ''
          : payload.attachmentFile.base64Data;
        const binStr = atob(cleanB64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: payload.attachmentFile.mimeType });

        const sRef = storageRef(firebaseStorage, storagePath);
        await uploadBytes(sRef, blob, { contentType: payload.attachmentFile.mimeType });
        const downloadUrl = await getDownloadURL(sRef);

        const attRecord: PurchaseAttachment = {
          id: attId,
          userUid: tenantUid,
          purchaseId,
          fileName: payload.attachmentFile.fileName,
          mimeType: payload.attachmentFile.mimeType,
          sizeBytes: payload.attachmentFile.sizeBytes,
          storagePath,
          downloadUrl,
          pageCount: payload.attachmentFile.pageCount,
          createdAt: now,
        };
        await set(
          ref(rtdb, `tenants/${tenantUid}/purchaseAttachments/${attId}`),
          stripUndefined(attRecord)
        );
        upsertTenantPurchaseAttachmentCache(tenantUid, attRecord);
        await touchTenantMeta(tenantUid, ['purchaseAttachments']);
        attachmentId = attId;
        attachmentMeta = {
          id: attId,
          fileName: attRecord.fileName,
          mimeType: attRecord.mimeType,
          sizeBytes: attRecord.sizeBytes,
          downloadUrl,
          storagePath,
          pageCount: attRecord.pageCount,
        };
      } catch {
        // Non-blocking fallback if Firebase Storage rules reject binary upload
      }
    }

    const existingPayments = existing
      ? (await listTenantPurchasePaymentsRaw(tenantUid)).filter((p) => p.purchaseId === existing.id)
      : [];
    const existingPaidPaise = existingPayments.reduce((s, p) => s + toPaise(p.amount), 0);
    const grandPaise = toPaise(calc.grandTotal);
    const balancePaise = Math.max(0, grandPaise - existingPaidPaise);

    const status: PurchaseStatus = payload.saveAsDraft
      ? 'draft'
      : balancePaise === 0 && grandPaise > 0
        ? 'paid'
        : dueDate < todayISO() && balancePaise > 0
          ? 'overdue'
          : existingPaidPaise > 0
            ? 'partially_paid'
            : 'unpaid';

    const supplierSnapshot: SupplierSnapshot = {
      id: supplier.id,
      name: supplier.name,
      companyName: supplier.companyName,
      email: supplier.email,
      phone: supplier.phone,
      gstin: supplier.gstin,
      billingAddress: supplier.billingAddress,
      state: supplier.state,
      stateCode: supplier.stateCode,
    };

    const purchase: Purchase = {
      id: purchaseId,
      userUid: tenantUid,
      billNumber,
      referenceNumber: sanitizeStr(payload.referenceNumber, 80),
      supplierId: supplier.id,
      supplierSnapshot,
      billDate,
      dueDate,
      paymentTerms: sanitizeStr(payload.paymentTerms, 120),
      purchaseType: payload.purchaseType,
      isGst: calc.isGst,
      taxMode: payload.taxMode,
      taxSupplyMode: payload.taxSupplyMode,
      isInterState: calc.isInterState,
      placeOfSupply: sanitizeStr(payload.placeOfSupply, 64) || profile.state,
      roundOffEnabled: payload.roundOffEnabled,
      status,
      items: calc.items,
      subtotal: calc.subtotal,
      itemDiscountTotal: calc.itemDiscountTotal,
      invoiceDiscountType: payload.invoiceDiscountType === 'fixed' ? 'fixed' : 'percent',
      invoiceDiscountValue: Math.max(0, Number(payload.invoiceDiscountValue) || 0),
      invoiceDiscountAmount: calc.invoiceDiscountAmount,
      totalDiscount: calc.totalDiscount,
      taxableAmount: calc.taxableAmount,
      cgstTotal: calc.cgstTotal,
      sgstTotal: calc.sgstTotal,
      igstTotal: calc.igstTotal,
      totalTax: calc.totalTax,
      additionalCharges: calc.additionalCharges,
      roundOff: calc.roundOff,
      grandTotal: calc.grandTotal,
      amountPaid: fromPaise(existingPaidPaise),
      balanceDue: payload.saveAsDraft ? calc.grandTotal : fromPaise(balancePaise),
      amountInWords: calc.amountInWords,
      notes: sanitizeStr(payload.notes, 600),
      ocrUsed: Boolean(payload.ocrUsed),
      ocrWarnings: payload.ocrWarnings,
      attachmentId,
      attachmentMeta,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await set(ref(rtdb, `tenants/${tenantUid}/purchases/${purchaseId}`), stripUndefined(purchase));
    upsertTenantPurchaseCache(tenantUid, purchase);
    await touchTenantMeta(tenantUid, ['purchases']);

    let savedPurchase = purchase;
    if (
      !payload.saveAsDraft &&
      payload.initialPayment &&
      Number(payload.initialPayment.amount) > 0
    ) {
      const payResult = await rtdbService.recordPurchasePayment({
        purchaseId,
        amount: payload.initialPayment.amount,
        paymentDate: payload.initialPayment.paymentDate || billDate,
        paymentMethod: payload.initialPayment.paymentMethod || 'Bank Transfer',
        referenceId: payload.initialPayment.referenceId,
        notes: payload.initialPayment.notes,
        allowAdvance: payload.initialPayment.allowAdvance,
      });
      if (payResult.purchase) savedPurchase = payResult.purchase;
    }

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: existing ? 'PURCHASE_UPDATED' : 'PURCHASE_CREATED',
      entityType: 'purchase',
      entityId: purchaseId,
      summary: `${existing ? 'Updated' : 'Recorded'} purchase bill ${billNumber} (${
        supplier.companyName || supplier.name
      })`,
    });

    return { purchase: savedPurchase };
  },

  deletePurchase: async (purchaseId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const [purchases, payments, attachments] = await Promise.all([
      listTenantPurchasesRaw(tenantUid),
      listTenantPurchasePaymentsRaw(tenantUid),
      listTenantPurchaseAttachmentsRaw(tenantUid),
    ]);
    const existing = purchases.find((p) => p.id === purchaseId);
    if (!existing) throw new Error('Purchase bill not found');

    const patch: Record<string, null> = {
      [`tenants/${tenantUid}/purchases/${purchaseId}`]: null,
    };
    for (const pay of payments.filter((p) => p.purchaseId === purchaseId)) {
      patch[`tenants/${tenantUid}/purchasePayments/${pay.id}`] = null;
    }
    for (const att of attachments.filter((a) => a.purchaseId === purchaseId)) {
      patch[`tenants/${tenantUid}/purchaseAttachments/${att.id}`] = null;
      if (att.storagePath) {
        try {
          await deleteObject(storageRef(firebaseStorage, att.storagePath));
        } catch {
          // ignore if storage file absent
        }
      }
    }

    await update(ref(rtdb), patch);
    removeTenantPurchaseCache(tenantUid, purchaseId);
    await touchTenantMeta(tenantUid, ['purchases', 'purchasePayments', 'purchaseAttachments']);
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'PURCHASE_DELETED',
      entityType: 'purchase',
      entityId: purchaseId,
      summary: `Deleted purchase bill ${existing.billNumber}`,
    });
    return { ok: true };
  },

  listPurchasePayments: async (params?: {
    search?: string;
    supplierId?: string;
    purchaseId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const ctx = await requireTenantContext();
    let list = await listTenantPurchasePaymentsRaw(ctx.effectiveUser.uid);
    if (params?.purchaseId) list = list.filter((p) => p.purchaseId === params.purchaseId);
    if (params?.supplierId && params.supplierId !== 'all') {
      list = list.filter((p) => p.supplierId === params.supplierId);
    }
    if (params?.startDate) list = list.filter((p) => p.paymentDate >= params.startDate!);
    if (params?.endDate) list = list.filter((p) => p.paymentDate <= params.endDate!);
    if (params?.search) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.paymentNumber.toLowerCase().includes(q) ||
          (p.billNumber || '').toLowerCase().includes(q) ||
          (p.supplierName || '').toLowerCase().includes(q) ||
          p.referenceId.toLowerCase().includes(q)
      );
    }
    return { payments: list };
  },

  recordPurchasePayment: async (input: {
    purchaseId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceId?: string;
    notes?: string;
    allowAdvance?: boolean;
  }) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const amountPaise = toPaise(Number(input.amount));
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    const purchases = await listTenantPurchasesRaw(tenantUid);
    const purchase = purchases.find((p) => p.id === input.purchaseId);
    if (!purchase) throw new Error('Purchase bill not found');
    if (purchase.status === 'draft') {
      throw new Error('Finalize draft purchase bill before recording payments');
    }

    const existingPayments = await listTenantPurchasePaymentsRaw(tenantUid);
    const currentPaidPaise = existingPayments
      .filter((p) => p.purchaseId === purchase.id)
      .reduce((s, p) => s + toPaise(p.amount), 0);
    const grandPaise = toPaise(purchase.grandTotal);
    const remainingPaise = Math.max(0, grandPaise - currentPaidPaise);
    const isAdvance = amountPaise > remainingPaise;

    if (isAdvance && !input.allowAdvance) {
      throw new Error(
        `Amount exceeds remaining balance (${fromPaise(remainingPaise).toFixed(
          2
        )}). Enable advance payment confirmation to proceed.`
      );
    }

    const paymentDate = sanitizeStr(input.paymentDate, 10) || todayISO();
    const paymentNumber = await allocateDocumentNumber(tenantUid, 'PPAY', 'PPAY', paymentDate);
    const payId = generateId('ppay');
    const now = new Date().toISOString();

    const payment: PurchasePayment = {
      id: payId,
      userUid: tenantUid,
      purchaseId: purchase.id,
      billNumber: purchase.billNumber,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierSnapshot.companyName || purchase.supplierSnapshot.name,
      paymentDate,
      amount: fromPaise(amountPaise),
      paymentMethod: input.paymentMethod || 'Bank Transfer',
      referenceId: sanitizeStr(input.referenceId, 80),
      notes: sanitizeStr(input.notes, 300),
      paymentNumber,
      isAdvance,
      createdAt: now,
    };

    await set(
      ref(rtdb, `tenants/${tenantUid}/purchasePayments/${payId}`),
      stripUndefined(payment)
    );
    upsertTenantPurchasePaymentCache(tenantUid, payment);
    await touchTenantMeta(tenantUid, ['purchasePayments']);
    const updatedPurchase = await reconcilePurchasePayments(tenantUid, purchase.id, now);

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      impersonationSessionId: ctx.impersonationSession?.id,
      action: 'PURCHASE_PAYMENT_RECORDED',
      entityType: 'purchase_payment',
      entityId: payId,
      summary: `Paid INR ${payment.amount.toFixed(2)} for purchase ${purchase.billNumber}`,
    });
    return { payment, purchase: updatedPurchase };
  },

  updatePurchasePayment: async (
    paymentId: string,
    input: {
      paymentDate?: string;
      amount?: number;
      paymentMethod?: PaymentMethod;
      referenceId?: string;
      notes?: string;
    }
  ) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const list = await listTenantPurchasePaymentsRaw(tenantUid);
    const existing = list.find((p) => p.id === paymentId);
    if (!existing) throw new Error('Purchase payment record not found');

    const nextAmount = input.amount !== undefined ? Number(input.amount) : existing.amount;
    const amountPaise = toPaise(nextAmount);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    const now = new Date().toISOString();
    const updated: PurchasePayment = {
      ...existing,
      paymentDate:
        input.paymentDate !== undefined
          ? sanitizeStr(input.paymentDate, 10) || existing.paymentDate
          : existing.paymentDate,
      amount: fromPaise(amountPaise),
      paymentMethod: input.paymentMethod || existing.paymentMethod,
      referenceId:
        input.referenceId !== undefined ? sanitizeStr(input.referenceId, 80) : existing.referenceId,
      notes: input.notes !== undefined ? sanitizeStr(input.notes, 300) : existing.notes,
    };

    await set(
      ref(rtdb, `tenants/${tenantUid}/purchasePayments/${paymentId}`),
      stripUndefined(updated)
    );
    upsertTenantPurchasePaymentCache(tenantUid, updated);
    await touchTenantMeta(tenantUid, ['purchasePayments']);
    const updatedPurchase = await reconcilePurchasePayments(tenantUid, existing.purchaseId, now);
    return { payment: updated, purchase: updatedPurchase };
  },

  deletePurchasePayment: async (paymentId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const list = await listTenantPurchasePaymentsRaw(tenantUid);
    const existing = list.find((p) => p.id === paymentId);
    if (!existing) throw new Error('Purchase payment record not found');

    const now = new Date().toISOString();
    await remove(ref(rtdb, `tenants/${tenantUid}/purchasePayments/${paymentId}`));
    removeTenantPurchasePaymentCache(tenantUid, paymentId);
    await touchTenantMeta(tenantUid, ['purchasePayments']);
    const updatedPurchase = await reconcilePurchasePayments(tenantUid, existing.purchaseId, now);
    return { ok: true, purchase: updatedPurchase };
  },

  getPurchasesAnalytics: async (params?: {
    range?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const [purchases, payments, suppliers] = await Promise.all([
      listTenantPurchasesRaw(tenantUid),
      listTenantPurchasePaymentsRaw(tenantUid),
      listTenantSuppliersBaseRaw(tenantUid),
    ]);
    return computePurchaseAnalyticsFromData(purchases, payments, suppliers, params);
  },

  // ==================== SUPER ADMIN ====================
  getAdminDashboard: async (params?: {
    range?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<AdminDashboardData> => {
    await requireSuperAdminContext();
    const [users, tenants, logs] = await Promise.all([
      fetchAdminUsersCached(),
      fetchAdminTenantsCached(),
      fetchAdminLogsCached(),
    ]);
    return computeAdminDashboardFromData(users, tenants, logs, params);
  },

  adminListUsers: async (params?: { search?: string; status?: string }): Promise<{
    users: AdminUserRow[];
  }> => {
    await requireSuperAdminContext();
    const [users, tenants] = await Promise.all([
      fetchAdminUsersCached(),
      fetchAdminTenantsCached(),
    ]);
    const search = (params?.search || '').trim().toLowerCase();

    const list: AdminUserRow[] = users
      .filter((u) => u.role === 'business')
      .filter((u) => !params?.status || params.status === 'all' || u.status === params.status)
      .map((u) => {
        const t = tenants[u.uid] || { invoices: [], quotations: [], payments: [] };
        const salesPaise = t.invoices
          .filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
          .reduce((s, i) => s + toPaise(i.grandTotal), 0);
        const collectedPaise = t.payments.reduce((s, p) => s + toPaise(p.amount), 0);

        return {
          ...u,
          invoiceCount: t.invoices.length,
          quotationCount: t.quotations.length,
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
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
      invalidateAdminSlices(['users', 'tenants', 'activityLogs']);

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
    invalidateAdminSlices(['users', 'activityLogs']);

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
    invalidateAdminSlices(['users', 'activityLogs']);

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
    invalidateAdminSlices(['impersonationSessions', 'activityLogs']);

    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: targetUid,
      impersonationSessionId: impId,
      action: 'ADMIN_IMPERSONATION_STARTED',
      entityType: 'impersonation',
      entityId: impId,
      summary: `Admin ${ctx.actorUser.email} entered customer workspace for ${target.businessName}`,
    });

    const session = await resolveCurrentAuthContext(true);
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
    invalidateAdminSlices(['impersonationSessions', 'activityLogs']);
    const session = await resolveCurrentAuthContext(true);
    return { session };
  },

  adminListInvoices: async (params?: { search?: string; status?: string }) => {
    await requireSuperAdminContext();
    const [users, tenants] = await Promise.all([
      fetchAdminUsersCached(),
      fetchAdminTenantsCached(),
    ]);
    const userNames = new Map(users.map((u) => [u.uid, u.businessName]));

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

    for (const [uid, t] of Object.entries(tenants)) {
      const tenantBusinessName = userNames.get(uid) || 'Business';
      for (const inv of t.invoices) {
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
    const [users, tenants] = await Promise.all([
      fetchAdminUsersCached(),
      fetchAdminTenantsCached(),
    ]);
    const userNames = new Map(users.map((u) => [u.uid, u.businessName]));

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

    for (const [uid, t] of Object.entries(tenants)) {
      const tenantBusinessName = userNames.get(uid) || 'Business';
      for (const q of t.quotations) {
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
    const logs = await fetchAdminLogsCached();
    return { logs: logs.slice(0, limit) };
  },

  adminListImpersonationHistory: async () => {
    await requireSuperAdminContext();
    if (isAdminSliceFresh('impersonationSessions')) {
      return { sessions: getAdminCache().impersonationSessions };
    }
    const snap = await get(ref(rtdb, 'impersonationSessions'));
    const sessions = snap.exists()
      ? Object.values(snap.val() as Record<string, ImpersonationSession>).sort((a, b) =>
          b.startedAt.localeCompare(a.startedAt)
        )
      : [];
    setAdminSliceData('impersonationSessions', sessions);
    return { sessions };
  },

  adminGetSettings: async () => {
    await requireSuperAdminContext();
    if (isAdminSliceFresh('platformSettings') && getAdminCache().platformSettings) {
      return { settings: getAdminCache().platformSettings! };
    }
    const settings = await ensurePlatformSettings();
    setAdminSliceData('platformSettings', settings);
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
    setAdminSliceData('platformSettings', updated);
    setCachedPublicSettings({
      platformName: updated.platformName,
      allowSelfRegistration: updated.allowSelfRegistration,
      maintenanceMode: updated.maintenanceMode,
      supportEmail: updated.supportEmail,
    });
    await logActivity({
      actor: ctx.actorUser,
      action: 'PLATFORM_SETTINGS_UPDATED',
      entityType: 'platform_settings',
      entityId: 'global',
      summary: 'Updated DRONA platform settings',
    });
    return { settings: updated };
  },

  // ==================== GST EXPORTS & AUDIT TRAIL ====================
  saveGstExportRecord: async (payload: Omit<GstExportRecord, 'id' | 'userUid' | 'createdAt'>) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const exportId = `gste_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const record: GstExportRecord = {
      ...payload,
      id: exportId,
      userUid: tenantUid,
      createdAt: now,
    };
    await set(ref(rtdb, `tenants/${tenantUid}/gstExports/${exportId}`), stripUndefined(record));
    await logActivity({
      actor: ctx.actorUser,
      targetTenantUid: tenantUid,
      action: 'GSTR1_JSON_EXPORTED',
      entityType: 'gst_export',
      entityId: exportId,
      summary: `Generated GSTR-1 JSON for period ${payload.period} (${payload.invoiceCount} invoices, ₹${payload.totalTaxableValue} taxable)`,
      metadata: {
        period: payload.period,
        gstin: payload.gstin,
        filename: payload.filename,
        invoiceCount: payload.invoiceCount,
      },
    });
    return { record };
  },

  listGstExportRecords: async () => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    const snap = await get(ref(rtdb, `tenants/${tenantUid}/gstExports`));
    if (!snap.exists()) return { exports: [] };
    const raw = snap.val() as Record<string, GstExportRecord>;
    const list: GstExportRecord[] = Object.values(raw).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    return { exports: list };
  },

  deleteGstExportRecord: async (exportId: string) => {
    const ctx = await requireTenantContext();
    const tenantUid = ctx.effectiveUser.uid;
    await remove(ref(rtdb, `tenants/${tenantUid}/gstExports/${exportId}`));
    return { success: true };
  },
};
