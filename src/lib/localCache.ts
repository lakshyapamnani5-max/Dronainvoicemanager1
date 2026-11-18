import type {
  ActivityLog,
  AuthSessionState,
  BusinessProfile,
  BusinessSnapshot,
  Customer,
  CustomerSnapshot,
  GstinLookupResponse,
  ImpersonationSession,
  Invoice,
  InvoiceStatus,
  NotificationItem,
  Payment,
  PlatformSettings,
  Purchase,
  PurchaseAttachment,
  PurchasePayment,
  Quotation,
  RateCardItem,
  Supplier,
  UserRecord,
} from '../shared/types';

export type TenantCollection =
  | 'profile'
  | 'customers'
  | 'invoices'
  | 'quotations'
  | 'payments'
  | 'rateCard'
  | 'notifications'
  | 'activityLogs'
  | 'suppliers'
  | 'purchases'
  | 'purchasePayments'
  | 'purchaseAttachments';

export interface TenantMetaMap {
  profile?: number;
  customers?: number;
  invoices?: number;
  quotations?: number;
  payments?: number;
  rateCard?: number;
  notifications?: number;
  activityLogs?: number;
  suppliers?: number;
  purchases?: number;
  purchasePayments?: number;
  purchaseAttachments?: number;
}

export interface TenantCacheEntry {
  profile: BusinessProfile | null;
  customers: Customer[];
  invoices: Invoice[];
  quotations: Quotation[];
  payments: Payment[];
  rateCard: RateCardItem[];
  notifications: NotificationItem[];
  activityLogs: ActivityLog[];
  suppliers: Supplier[];
  purchases: Purchase[];
  purchasePayments: PurchasePayment[];
  purchaseAttachments: PurchaseAttachment[];
  syncedAt: Partial<Record<TenantCollection, number>>;
  counters?: Record<string, number>;
  lastOverdueCheckDate?: string;
  lastPurchaseOverdueCheckDate?: string;
  lastExpiryCheckDate?: string;
  lastAccessedAt: number;
}

export interface AdminRawTenantBundle {
  invoices: Invoice[];
  quotations: Quotation[];
  payments: Payment[];
}

export interface AdminCacheEntry {
  users: UserRecord[];
  tenants: Record<string, AdminRawTenantBundle>;
  activityLogs: ActivityLog[];
  impersonationSessions: ImpersonationSession[];
  platformSettings: PlatformSettings | null;
  syncedAt: {
    users?: number;
    tenants?: number;
    activityLogs?: number;
    impersonationSessions?: number;
    platformSettings?: number;
  };
}

const SESSION_KEY = 'drona_v1_session';
const PUBLIC_SETTINGS_KEY = 'drona_v1_public_settings';
const TENANT_KEY_PREFIX = 'drona_v1_tenant_';
const ADMIN_CACHE_KEY = 'drona_v1_admin_cache';

const LOGO_SENTINEL = '__DRONA_PROF_LOGO__';
const SIG_SENTINEL = '__DRONA_PROF_SIG__';
const QR_SENTINEL = '__DRONA_PROF_QR__';

export const DEFAULT_COLLECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_ADMIN_TTL_MS = 3 * 60 * 1000; // 3 minutes

const tenantMemory = new Map<string, TenantCacheEntry>();
const sessionSynced = new Set<string>();
const inFlight = new Map<string, Promise<unknown>>();
let cachedSessionMemory: { session: AuthSessionState; cachedAt: number } | null = null;
let cachedPublicSettingsMemory: {
  settings: {
    platformName: string;
    allowSelfRegistration: boolean;
    maintenanceMode: boolean;
    supportEmail: string;
  };
  cachedAt: number;
} | null = null;
let adminMemory: AdminCacheEntry | null = null;
const adminSessionSynced = new Set<string>();

type TenantCacheListener = (changed: Set<TenantCollection>) => void;
const tenantListeners = new Map<string, Set<TenantCacheListener>>();
const pendingTenantEmits = new Map<string, Set<TenantCollection>>();
let tenantFlushScheduled = false;

const adminListeners = new Set<() => void>();
let adminFlushScheduled = false;

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function emptyTenantEntry(): TenantCacheEntry {
  return {
    profile: null,
    customers: [],
    invoices: [],
    quotations: [],
    payments: [],
    rateCard: [],
    notifications: [],
    activityLogs: [],
    suppliers: [],
    purchases: [],
    purchasePayments: [],
    purchaseAttachments: [],
    syncedAt: {},
    counters: {},
    lastAccessedAt: Date.now(),
  };
}

function emptyAdminEntry(): AdminCacheEntry {
  return {
    users: [],
    tenants: {},
    activityLogs: [],
    impersonationSessions: [],
    platformSettings: null,
    syncedAt: {},
  };
}

function compactDocSnapshots<T extends { businessSnapshot?: Invoice['businessSnapshot'] }>(
  doc: T,
  profile: BusinessProfile | null,
  stripInlineImages = false
): T {
  if (!doc.businessSnapshot) return doc;
  const snap = { ...doc.businessSnapshot };
  if (stripInlineImages) {
    if (snap.logoDataUrl.startsWith('data:image/')) snap.logoDataUrl = '';
    if (snap.signatureDataUrl && snap.signatureDataUrl.startsWith('data:image/')) {
      snap.signatureDataUrl = '';
    }
    if (snap.upiQrDataUrl.startsWith('data:image/')) snap.upiQrDataUrl = '';
  } else if (profile) {
    if (profile.logoDataUrl && snap.logoDataUrl === profile.logoDataUrl) {
      snap.logoDataUrl = LOGO_SENTINEL;
    }
    if (profile.signatureDataUrl && snap.signatureDataUrl === profile.signatureDataUrl) {
      snap.signatureDataUrl = SIG_SENTINEL;
    }
    if (profile.upiQrDataUrl && snap.upiQrDataUrl === profile.upiQrDataUrl) {
      snap.upiQrDataUrl = QR_SENTINEL;
    }
  }
  return { ...doc, businessSnapshot: snap };
}

function rehydrateDocSnapshots<T extends { businessSnapshot?: Invoice['businessSnapshot'] }>(
  doc: T,
  profile: BusinessProfile | null
): T {
  if (!doc.businessSnapshot) return doc;
  const snap = { ...doc.businessSnapshot };
  if (snap.logoDataUrl === LOGO_SENTINEL) {
    snap.logoDataUrl = profile?.logoDataUrl || '';
  }
  if (snap.signatureDataUrl === SIG_SENTINEL) {
    snap.signatureDataUrl = profile?.signatureDataUrl || '';
  }
  if (snap.upiQrDataUrl === QR_SENTINEL) {
    snap.upiQrDataUrl = profile?.upiQrDataUrl || '';
  }
  return { ...doc, businessSnapshot: snap };
}

function buildCompactTenantPayload(
  entry: TenantCacheEntry,
  level: 0 | 1 | 2
): TenantCacheEntry {
  const prof = entry.profile;
  const maxLogs = level === 0 ? 40 : 0;
  const maxNotifs = level === 0 ? 40 : 20;
  const maxDocs = level === 2 ? 40 : entry.invoices.length;

  const invoices = entry.invoices.slice(0, maxDocs).map((inv, idx) =>
    compactDocSnapshots(inv, prof, level >= 1 && idx >= 15)
  );
  const quotations = entry.quotations.slice(0, maxDocs).map((quo, idx) =>
    compactDocSnapshots(quo, prof, level >= 1 && idx >= 15)
  );

  return {
    profile: prof,
    customers: entry.customers,
    invoices,
    quotations,
    payments: entry.payments,
    rateCard: entry.rateCard,
    notifications: entry.notifications.slice(0, maxNotifs),
    activityLogs: entry.activityLogs.slice(0, maxLogs),
    suppliers: entry.suppliers,
    purchases: entry.purchases.slice(0, maxDocs),
    purchasePayments: entry.purchasePayments,
    purchaseAttachments: entry.purchaseAttachments.slice(0, maxDocs),
    syncedAt: entry.syncedAt,
    counters: entry.counters || {},
    lastOverdueCheckDate: entry.lastOverdueCheckDate,
    lastPurchaseOverdueCheckDate: entry.lastPurchaseOverdueCheckDate,
    lastExpiryCheckDate: entry.lastExpiryCheckDate,
    lastAccessedAt: entry.lastAccessedAt,
  };
}

function evictOtherTenantKeys(activeTenantUid: string): boolean {
  if (!hasStorage()) return false;
  try {
    const candidates: Array<{ key: string; ts: number }> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(TENANT_KEY_PREFIX)) continue;
      if (k === `${TENANT_KEY_PREFIX}${activeTenantUid}`) continue;
      let ts = 0;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(k) || '{}') as Partial<TenantCacheEntry>;
        ts = Number(parsed.lastAccessedAt || 0);
      } catch {
        ts = 0;
      }
      candidates.push({ key: k, ts });
    }
    if (candidates.length === 0) return false;
    candidates.sort((a, b) => a.ts - b.ts);
    window.localStorage.removeItem(candidates[0].key);
    return true;
  } catch {
    return false;
  }
}

function persistTenantEntry(tenantUid: string, entry: TenantCacheEntry): void {
  if (!hasStorage()) return;
  const key = `${TENANT_KEY_PREFIX}${tenantUid}`;
  const attemptWrite = (level: 0 | 1 | 2): boolean => {
    try {
      const payload = buildCompactTenantPayload(entry, level);
      window.localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  if (attemptWrite(0)) return;
  while (evictOtherTenantKeys(tenantUid)) {
    if (attemptWrite(0)) return;
  }
  if (attemptWrite(1)) return;
  attemptWrite(2);
}

function readTenantEntryFromStorage(tenantUid: string): TenantCacheEntry | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(`${TENANT_KEY_PREFIX}${tenantUid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TenantCacheEntry>;
    const profile = parsed.profile || null;
    const entry: TenantCacheEntry = {
      profile,
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      invoices: Array.isArray(parsed.invoices)
        ? parsed.invoices.map((inv) => rehydrateDocSnapshots(inv, profile))
        : [],
      quotations: Array.isArray(parsed.quotations)
        ? parsed.quotations.map((quo) => rehydrateDocSnapshots(quo, profile))
        : [],
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      rateCard: Array.isArray(parsed.rateCard) ? parsed.rateCard : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
      suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
      purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
      purchasePayments: Array.isArray(parsed.purchasePayments) ? parsed.purchasePayments : [],
      purchaseAttachments: Array.isArray(parsed.purchaseAttachments)
        ? parsed.purchaseAttachments
        : [],
      syncedAt: parsed.syncedAt && typeof parsed.syncedAt === 'object' ? parsed.syncedAt : {},
      counters: parsed.counters && typeof parsed.counters === 'object' ? parsed.counters : {},
      lastOverdueCheckDate: parsed.lastOverdueCheckDate,
      lastPurchaseOverdueCheckDate: parsed.lastPurchaseOverdueCheckDate,
      lastExpiryCheckDate: parsed.lastExpiryCheckDate,
      lastAccessedAt: Date.now(),
    };
    return entry;
  } catch {
    return null;
  }
}

export function getTenantEntry(tenantUid: string): TenantCacheEntry {
  const existing = tenantMemory.get(tenantUid);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing;
  }
  const hydrated = readTenantEntryFromStorage(tenantUid) || emptyTenantEntry();
  tenantMemory.set(tenantUid, hydrated);
  return hydrated;
}

export function emitTenantCache(tenantUid: string, cols: TenantCollection[]): void {
  if (!cols.length) return;
  let setForTenant = pendingTenantEmits.get(tenantUid);
  if (!setForTenant) {
    setForTenant = new Set();
    pendingTenantEmits.set(tenantUid, setForTenant);
  }
  for (const c of cols) setForTenant.add(c);

  if (!tenantFlushScheduled) {
    tenantFlushScheduled = true;
    queueMicrotask(() => {
      tenantFlushScheduled = false;
      const entries = Array.from(pendingTenantEmits.entries());
      pendingTenantEmits.clear();
      for (const [uid, changed] of entries) {
        const subs = tenantListeners.get(uid);
        if (!subs || subs.size === 0) continue;
        for (const fn of Array.from(subs)) {
          try {
            fn(changed);
          } catch {
            // ignore listener errors
          }
        }
      }
    });
  }
}

export function subscribeTenantCache(
  tenantUid: string,
  listener: TenantCacheListener
): () => void {
  let subs = tenantListeners.get(tenantUid);
  if (!subs) {
    subs = new Set();
    tenantListeners.set(tenantUid, subs);
  }
  subs.add(listener);
  return () => {
    const current = tenantListeners.get(tenantUid);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      tenantListeners.delete(tenantUid);
    }
  };
}

export function isTenantCollectionFresh(
  tenantUid: string,
  col: TenantCollection,
  ttlMs = DEFAULT_COLLECTION_TTL_MS
): boolean {
  const entry = getTenantEntry(tenantUid);
  const ts = entry.syncedAt[col];
  if (sessionSynced.has(`${tenantUid}:${col}`)) {
    return true;
  }
  if (!ts) {
    if (col === 'profile') return Boolean(entry.profile);
    const val = entry[col];
    return Array.isArray(val) && val.length > 0;
  }
  return Date.now() - ts < ttlMs;
}

export function hasTenantCollectionData(tenantUid: string, col: TenantCollection): boolean {
  const entry = getTenantEntry(tenantUid);
  if (Boolean(entry.syncedAt[col])) return true;
  if (col === 'profile') return Boolean(entry.profile);
  const val = entry[col];
  return Array.isArray(val) && val.length > 0;
}

export function markTenantSyncedNow(tenantUid: string, col: TenantCollection, ts = Date.now()): void {
  const entry = getTenantEntry(tenantUid);
  entry.syncedAt[col] = ts;
  sessionSynced.add(`${tenantUid}:${col}`);
  persistTenantEntry(tenantUid, entry);
}

export function invalidateTenantCollection(tenantUid: string, col: TenantCollection): void {
  const entry = getTenantEntry(tenantUid);
  entry.syncedAt[col] = 0;
  sessionSynced.delete(`${tenantUid}:${col}`);
}

export function setTenantProfileCache(
  tenantUid: string,
  profile: BusinessProfile | null,
  markSynced = true
): void {
  const entry = getTenantEntry(tenantUid);
  entry.profile = profile;
  if (markSynced) {
    entry.syncedAt.profile = Date.now();
    sessionSynced.add(`${tenantUid}:profile`);
  }
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['profile']);
}

export function setTenantCollectionData<K extends Exclude<TenantCollection, 'profile'>>(
  tenantUid: string,
  col: K,
  items: TenantCacheEntry[K],
  markSynced = true
): void {
  const entry = getTenantEntry(tenantUid);
  entry[col] = items;
  if (markSynced) {
    entry.syncedAt[col] = Date.now();
    sessionSynced.add(`${tenantUid}:${col}`);
  }
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, [col]);
}

export function upsertTenantCustomerCache(tenantUid: string, customer: Customer): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.customers.findIndex((c) => c.id === customer.id);
  const next = [...entry.customers];
  if (idx >= 0) next[idx] = customer;
  else next.unshift(customer);
  entry.customers = next;
  entry.syncedAt.customers = Date.now();
  sessionSynced.add(`${tenantUid}:customers`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['customers']);
}

export function cascadeCustomerSnapshotInCache(tenantUid: string, customer: Customer): void {
  const entry = getTenantEntry(tenantUid);
  const snapshot: CustomerSnapshot = {
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
  let changedInvoices = false;
  let changedQuotes = false;

  const nextInvoices = entry.invoices.map((inv) => {
    if (inv.customerId !== customer.id) return inv;
    changedInvoices = true;
    return { ...inv, customerSnapshot: snapshot };
  });
  const nextQuotes = entry.quotations.map((quo) => {
    if (quo.customerId !== customer.id) return quo;
    changedQuotes = true;
    return { ...quo, customerSnapshot: snapshot };
  });

  if (!changedInvoices && !changedQuotes) return;
  if (changedInvoices) entry.invoices = nextInvoices;
  if (changedQuotes) entry.quotations = nextQuotes;
  persistTenantEntry(tenantUid, entry);
  const cols: TenantCollection[] = [];
  if (changedInvoices) cols.push('invoices');
  if (changedQuotes) cols.push('quotations');
  emitTenantCache(tenantUid, cols);
}

export function cascadeBusinessSnapshotInCache(
  tenantUid: string,
  profile: BusinessProfile
): void {
  const entry = getTenantEntry(tenantUid);
  const patchSnapshot = (prev: BusinessSnapshot): BusinessSnapshot => ({
    ...prev,
    businessName: profile.businessName || prev.businessName,
    ownerName: profile.ownerName ?? prev.ownerName,
    logoDataUrl: profile.logoDataUrl || prev.logoDataUrl,
    address: profile.address,
    email: profile.email,
    phone: profile.phone,
    gstin: profile.gstin,
    pan: profile.pan,
    state: profile.state || prev.state,
    bankName: profile.bankName,
    accountNumber: profile.accountNumber,
    ifsc: profile.ifsc,
    upiId: profile.upiId,
    upiQrDataUrl: profile.upiId ? '' : profile.upiQrDataUrl || prev.upiQrDataUrl,
    signatureLabel: profile.signatureLabel || prev.signatureLabel,
    signatureDataUrl: profile.signatureDataUrl || prev.signatureDataUrl,
  });

  let changedInvoices = false;
  let changedQuotes = false;

  if (entry.invoices.length > 0) {
    entry.invoices = entry.invoices.map((inv) => ({
      ...inv,
      businessSnapshot: patchSnapshot(inv.businessSnapshot),
    }));
    changedInvoices = true;
  }
  if (entry.quotations.length > 0) {
    entry.quotations = entry.quotations.map((quo) => ({
      ...quo,
      businessSnapshot: patchSnapshot(quo.businessSnapshot),
    }));
    changedQuotes = true;
  }

  if (!changedInvoices && !changedQuotes) return;
  persistTenantEntry(tenantUid, entry);
  const cols: TenantCollection[] = [];
  if (changedInvoices) cols.push('invoices');
  if (changedQuotes) cols.push('quotations');
  emitTenantCache(tenantUid, cols);
}

export function allocateLocalDocNumber(
  tenantUid: string,
  docType: 'INV' | 'QUO' | 'RCP' | 'PPAY',
  prefix: string,
  dateIso: string,
  existingNumbers: string[] = []
): { docNumber: string; seq: number; year: string; counterKey: string } {
  const entry = getTenantEntry(tenantUid);
  const year = /^\d{4}/.test(dateIso) ? dateIso.slice(0, 4) : String(new Date().getFullYear());
  const counterKey = `${docType}_${year}`;
  const stored = Number(entry.counters?.[counterKey] || 0);

  let maxFromDocs = 0;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedPrefix}-${year}-(\\d+)$`);
  for (const num of existingNumbers) {
    const m = pattern.exec(num);
    if (m) {
      const parsed = Number(m[1]);
      if (Number.isFinite(parsed) && parsed > maxFromDocs) {
        maxFromDocs = parsed;
      }
    }
  }

  const nextSeq = Math.max(stored, maxFromDocs) + 1;
  entry.counters = { ...(entry.counters || {}), [counterKey]: nextSeq };
  persistTenantEntry(tenantUid, entry);

  return {
    docNumber: `${prefix}-${year}-${String(nextSeq).padStart(4, '0')}`,
    seq: nextSeq,
    year,
    counterKey,
  };
}

export function syncRemoteCounterCache(
  tenantUid: string,
  counterKey: string,
  remoteVal: number
): void {
  const entry = getTenantEntry(tenantUid);
  const current = Number(entry.counters?.[counterKey] || 0);
  if (remoteVal > current) {
    entry.counters = { ...(entry.counters || {}), [counterKey]: remoteVal };
    persistTenantEntry(tenantUid, entry);
  }
}

export function removeTenantCustomerCache(tenantUid: string, customerId: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.customers = entry.customers.filter((c) => c.id !== customerId);
  entry.syncedAt.customers = Date.now();
  sessionSynced.add(`${tenantUid}:customers`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['customers']);
}

export function upsertTenantInvoiceCache(tenantUid: string, invoice: Invoice): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.invoices.findIndex((i) => i.id === invoice.id);
  const next = [...entry.invoices];
  if (idx >= 0) next[idx] = invoice;
  else next.unshift(invoice);
  next.sort((a, b) =>
    `${b.invoiceDate}_${b.createdAt}`.localeCompare(`${a.invoiceDate}_${a.createdAt}`)
  );
  entry.invoices = next;
  entry.syncedAt.invoices = Date.now();
  sessionSynced.add(`${tenantUid}:invoices`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['invoices', 'customers']);
}

export function removeTenantInvoiceCache(tenantUid: string, invoiceId: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.invoices = entry.invoices.filter((i) => i.id !== invoiceId);
  entry.syncedAt.invoices = Date.now();
  sessionSynced.add(`${tenantUid}:invoices`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['invoices']);
}

export function upsertTenantQuotationCache(tenantUid: string, quotation: Quotation): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.quotations.findIndex((q) => q.id === quotation.id);
  const next = [...entry.quotations];
  if (idx >= 0) next[idx] = quotation;
  else next.unshift(quotation);
  next.sort((a, b) =>
    `${b.quotationDate}_${b.createdAt}`.localeCompare(`${a.quotationDate}_${a.createdAt}`)
  );
  entry.quotations = next;
  entry.syncedAt.quotations = Date.now();
  sessionSynced.add(`${tenantUid}:quotations`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['quotations', 'customers']);
}

export function upsertTenantPaymentCache(tenantUid: string, payment: Payment): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.payments.findIndex((p) => p.id === payment.id);
  const next = [...entry.payments];
  if (idx >= 0) next[idx] = payment;
  else next.unshift(payment);
  next.sort((a, b) =>
    `${b.paymentDate}_${b.createdAt}`.localeCompare(`${a.paymentDate}_${a.createdAt}`)
  );
  entry.payments = next;
  entry.syncedAt.payments = Date.now();
  sessionSynced.add(`${tenantUid}:payments`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['payments']);
}

export function removeTenantPaymentCache(tenantUid: string, paymentId: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.payments = entry.payments.filter((p) => p.id !== paymentId);
  entry.syncedAt.payments = Date.now();
  sessionSynced.add(`${tenantUid}:payments`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['payments']);
}

export function upsertTenantRateCardCache(tenantUid: string, item: RateCardItem): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.rateCard.findIndex((r) => r.id === item.id);
  const next = [...entry.rateCard];
  if (idx >= 0) next[idx] = item;
  else next.push(item);
  next.sort((a, b) => a.name.localeCompare(b.name));
  entry.rateCard = next;
  entry.syncedAt.rateCard = Date.now();
  sessionSynced.add(`${tenantUid}:rateCard`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['rateCard']);
}

export function removeTenantRateCardCache(tenantUid: string, itemId: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.rateCard = entry.rateCard.filter((r) => r.id !== itemId);
  entry.syncedAt.rateCard = Date.now();
  sessionSynced.add(`${tenantUid}:rateCard`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['rateCard']);
}

export function upsertTenantNotificationCache(tenantUid: string, ntf: NotificationItem): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.notifications.findIndex((n) => n.id === ntf.id);
  const next = [...entry.notifications];
  if (idx >= 0) next[idx] = ntf;
  else next.unshift(ntf);
  next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  entry.notifications = next.slice(0, 40);
  entry.syncedAt.notifications = Date.now();
  sessionSynced.add(`${tenantUid}:notifications`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['notifications']);
}

export function markNotificationReadCache(tenantUid: string, id?: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.notifications = entry.notifications.map((n) =>
    !id || n.id === id ? { ...n, isRead: true } : n
  );
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['notifications']);
}

export function prependTenantActivityLogCache(tenantUid: string, log: ActivityLog): void {
  const entry = getTenantEntry(tenantUid);
  const next = [log, ...entry.activityLogs.filter((l) => l.id !== log.id)].slice(0, 60);
  entry.activityLogs = next;
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['activityLogs']);
}

export function getTenantOverdueCheckDate(tenantUid: string): string | undefined {
  return getTenantEntry(tenantUid).lastOverdueCheckDate;
}

export function setTenantOverdueCheckDate(tenantUid: string, dateIso: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.lastOverdueCheckDate = dateIso;
  persistTenantEntry(tenantUid, entry);
}

export function getTenantPurchaseOverdueCheckDate(tenantUid: string): string | undefined {
  return getTenantEntry(tenantUid).lastPurchaseOverdueCheckDate;
}

export function setTenantPurchaseOverdueCheckDate(tenantUid: string, dateIso: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.lastPurchaseOverdueCheckDate = dateIso;
  persistTenantEntry(tenantUid, entry);
}

export function getTenantExpiryCheckDate(tenantUid: string): string | undefined {
  return getTenantEntry(tenantUid).lastExpiryCheckDate;
}

export function setTenantExpiryCheckDate(tenantUid: string, dateIso: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.lastExpiryCheckDate = dateIso;
  persistTenantEntry(tenantUid, entry);
}

export function upsertTenantSupplierCache(tenantUid: string, supplier: Supplier): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.suppliers.findIndex((s) => s.id === supplier.id);
  const next = [...entry.suppliers];
  if (idx >= 0) next[idx] = supplier;
  else next.unshift(supplier);
  entry.suppliers = next;
  entry.syncedAt.suppliers = Date.now();
  sessionSynced.add(`${tenantUid}:suppliers`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['suppliers']);
}

export function removeTenantSupplierCache(tenantUid: string, supplierId: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.suppliers = entry.suppliers.filter((s) => s.id !== supplierId);
  entry.syncedAt.suppliers = Date.now();
  sessionSynced.add(`${tenantUid}:suppliers`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['suppliers']);
}

export function upsertTenantPurchaseCache(tenantUid: string, purchase: Purchase): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.purchases.findIndex((p) => p.id === purchase.id);
  const next = [...entry.purchases];
  if (idx >= 0) next[idx] = purchase;
  else next.unshift(purchase);
  next.sort((a, b) =>
    `${b.billDate}_${b.createdAt}`.localeCompare(`${a.billDate}_${a.createdAt}`)
  );
  entry.purchases = next;
  entry.syncedAt.purchases = Date.now();
  sessionSynced.add(`${tenantUid}:purchases`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['purchases', 'suppliers']);
}

export function removeTenantPurchaseCache(tenantUid: string, purchaseId: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.purchases = entry.purchases.filter((p) => p.id !== purchaseId);
  entry.purchasePayments = entry.purchasePayments.filter((p) => p.purchaseId !== purchaseId);
  entry.purchaseAttachments = entry.purchaseAttachments.filter((a) => a.purchaseId !== purchaseId);
  entry.syncedAt.purchases = Date.now();
  sessionSynced.add(`${tenantUid}:purchases`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['purchases', 'purchasePayments', 'purchaseAttachments', 'suppliers']);
}

export function upsertTenantPurchasePaymentCache(tenantUid: string, payment: PurchasePayment): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.purchasePayments.findIndex((p) => p.id === payment.id);
  const next = [...entry.purchasePayments];
  if (idx >= 0) next[idx] = payment;
  else next.unshift(payment);
  next.sort((a, b) =>
    `${b.paymentDate}_${b.createdAt}`.localeCompare(`${a.paymentDate}_${a.createdAt}`)
  );
  entry.purchasePayments = next;
  entry.syncedAt.purchasePayments = Date.now();
  sessionSynced.add(`${tenantUid}:purchasePayments`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['purchasePayments', 'purchases', 'suppliers']);
}

export function removeTenantPurchasePaymentCache(tenantUid: string, paymentId: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.purchasePayments = entry.purchasePayments.filter((p) => p.id !== paymentId);
  entry.syncedAt.purchasePayments = Date.now();
  sessionSynced.add(`${tenantUid}:purchasePayments`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['purchasePayments', 'purchases', 'suppliers']);
}

export function upsertTenantPurchaseAttachmentCache(
  tenantUid: string,
  att: PurchaseAttachment
): void {
  const entry = getTenantEntry(tenantUid);
  const idx = entry.purchaseAttachments.findIndex((a) => a.id === att.id);
  const next = [...entry.purchaseAttachments];
  if (idx >= 0) next[idx] = att;
  else next.unshift(att);
  entry.purchaseAttachments = next;
  entry.syncedAt.purchaseAttachments = Date.now();
  sessionSynced.add(`${tenantUid}:purchaseAttachments`);
  persistTenantEntry(tenantUid, entry);
  emitTenantCache(tenantUid, ['purchaseAttachments']);
}

// ==================== SESSION & PUBLIC SETTINGS CACHE ====================

export function getCachedSession(): AuthSessionState | null {
  if (cachedSessionMemory) return cachedSessionMemory.session;
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { session?: AuthSessionState; cachedAt?: number };
    if (!parsed.session?.actorUser?.uid || !parsed.session?.effectiveUser?.uid) return null;
    cachedSessionMemory = {
      session: parsed.session,
      cachedAt: Number(parsed.cachedAt || Date.now()),
    };
    return parsed.session;
  } catch {
    return null;
  }
}

export function getCachedSessionTimestamp(): number {
  if (!cachedSessionMemory) {
    getCachedSession();
  }
  const mem = cachedSessionMemory as { session: AuthSessionState; cachedAt: number } | null;
  return mem?.cachedAt || 0;
}

export function setCachedSession(session: AuthSessionState | null): void {
  if (!session) {
    cachedSessionMemory = null;
    if (hasStorage()) {
      try {
        window.localStorage.removeItem(SESSION_KEY);
      } catch {
        // ignore
      }
    }
    return;
  }
  const now = Date.now();
  cachedSessionMemory = { session, cachedAt: now };
  if (session.effectiveUser.role === 'business' && session.businessProfile) {
    setTenantProfileCache(session.effectiveUser.uid, session.businessProfile, true);
  }
  if (hasStorage()) {
    try {
      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ session, cachedAt: now })
      );
    } catch {
      // ignore storage quota errors on session
    }
  }
}

export function getCachedPublicSettings(): {
  platformName: string;
  allowSelfRegistration: boolean;
  maintenanceMode: boolean;
  supportEmail: string;
} | null {
  if (cachedPublicSettingsMemory) return cachedPublicSettingsMemory.settings;
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(PUBLIC_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      settings?: {
        platformName: string;
        allowSelfRegistration: boolean;
        maintenanceMode: boolean;
        supportEmail: string;
      };
      cachedAt?: number;
    };
    if (!parsed.settings) return null;
    cachedPublicSettingsMemory = {
      settings: parsed.settings,
      cachedAt: Number(parsed.cachedAt || Date.now()),
    };
    return parsed.settings;
  } catch {
    return null;
  }
}

export function setCachedPublicSettings(settings: {
  platformName: string;
  allowSelfRegistration: boolean;
  maintenanceMode: boolean;
  supportEmail: string;
}): void {
  const now = Date.now();
  cachedPublicSettingsMemory = { settings, cachedAt: now };
  if (hasStorage()) {
    try {
      window.localStorage.setItem(
        PUBLIC_SETTINGS_KEY,
        JSON.stringify({ settings, cachedAt: now })
      );
    } catch {
      // ignore
    }
  }
}

// ==================== ADMIN CACHE ====================

export function getAdminCache(): AdminCacheEntry {
  if (adminMemory) return adminMemory;
  if (hasStorage()) {
    try {
      const raw = window.localStorage.getItem(ADMIN_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AdminCacheEntry>;
        adminMemory = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          tenants: parsed.tenants && typeof parsed.tenants === 'object' ? parsed.tenants : {},
          activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
          impersonationSessions: Array.isArray(parsed.impersonationSessions)
            ? parsed.impersonationSessions
            : [],
          platformSettings: parsed.platformSettings || null,
          syncedAt: parsed.syncedAt || {},
        };
        return adminMemory;
      }
    } catch {
      // ignore parse failure
    }
  }
  adminMemory = emptyAdminEntry();
  return adminMemory;
}

function persistAdminCache(entry: AdminCacheEntry): void {
  if (!hasStorage()) return;
  const compactTenants: Record<string, AdminRawTenantBundle> = {};
  for (const [uid, bundle] of Object.entries(entry.tenants)) {
    compactTenants[uid] = {
      invoices: bundle.invoices.map((i) => compactDocSnapshots(i, null, true)),
      quotations: bundle.quotations.map((q) => compactDocSnapshots(q, null, true)),
      payments: bundle.payments,
    };
  }
  const payload: AdminCacheEntry = {
    users: entry.users,
    tenants: compactTenants,
    activityLogs: entry.activityLogs.slice(0, 150),
    impersonationSessions: entry.impersonationSessions.slice(0, 80),
    platformSettings: entry.platformSettings,
    syncedAt: entry.syncedAt,
  };
  try {
    window.localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(payload));
  } catch {
    try {
      // Fallback: omit heavy document snapshots in persistent admin storage (keep in RAM)
      window.localStorage.setItem(
        ADMIN_CACHE_KEY,
        JSON.stringify({
          ...payload,
          tenants: {},
          syncedAt: { ...payload.syncedAt, tenants: 0 },
        })
      );
    } catch {
      // ignore
    }
  }
}

export function emitAdminCache(): void {
  if (adminFlushScheduled) return;
  adminFlushScheduled = true;
  queueMicrotask(() => {
    adminFlushScheduled = false;
    for (const fn of Array.from(adminListeners)) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  });
}

export function subscribeAdminCache(listener: () => void): () => void {
  adminListeners.add(listener);
  return () => {
    adminListeners.delete(listener);
  };
}

export function isAdminSliceFresh(
  slice: keyof AdminCacheEntry['syncedAt'],
  ttlMs = DEFAULT_ADMIN_TTL_MS
): boolean {
  const entry = getAdminCache();
  const ts = entry.syncedAt[slice];
  if (!ts) return false;
  if (adminSessionSynced.has(slice)) return true;
  return Date.now() - ts < ttlMs;
}

export function setAdminSliceData<K extends keyof AdminCacheEntry['syncedAt']>(
  slice: K,
  value: AdminCacheEntry[K]
): void {
  const entry = getAdminCache();
  entry[slice] = value;
  entry.syncedAt[slice] = Date.now();
  adminSessionSynced.add(slice);
  persistAdminCache(entry);
  emitAdminCache();
}

export function invalidateAdminSlices(
  slices: Array<keyof AdminCacheEntry['syncedAt']> = [
    'users',
    'tenants',
    'activityLogs',
    'impersonationSessions',
    'platformSettings',
  ]
): void {
  const entry = getAdminCache();
  for (const s of slices) {
    entry.syncedAt[s] = 0;
    adminSessionSynced.delete(s);
  }
}

export function clearAllRuntimeSessionCaches(): void {
  sessionSynced.clear();
  adminSessionSynced.clear();
  inFlight.clear();
  setCachedSession(null);
}

// ==================== GSTIN LOOKUP CACHE ====================

const GSTIN_CACHE_KEY = 'drona_v1_gstin_cache';
const GSTIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const GSTIN_CACHE_MAX_ENTRIES = 50;

type GstinCacheMap = Record<string, GstinLookupResponse & { cachedAt: number }>;
let gstinCacheMemory: GstinCacheMap | null = null;

function readGstinCacheMap(): GstinCacheMap {
  if (gstinCacheMemory) return gstinCacheMemory;
  if (!hasStorage()) {
    gstinCacheMemory = {};
    return gstinCacheMemory;
  }
  try {
    const raw = window.localStorage.getItem(GSTIN_CACHE_KEY);
    if (!raw) {
      gstinCacheMemory = {};
      return gstinCacheMemory;
    }
    const parsed = JSON.parse(raw) as GstinCacheMap;
    gstinCacheMemory = parsed && typeof parsed === 'object' ? parsed : {};
    return gstinCacheMemory;
  } catch {
    gstinCacheMemory = {};
    return gstinCacheMemory;
  }
}

function persistGstinCacheMap(map: GstinCacheMap): void {
  const entries = Object.entries(map).sort((a, b) => (b[1]?.cachedAt || 0) - (a[1]?.cachedAt || 0));
  const trimmed: GstinCacheMap = {};
  for (const [k, v] of entries.slice(0, GSTIN_CACHE_MAX_ENTRIES)) {
    trimmed[k] = v;
  }
  gstinCacheMemory = trimmed;
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(GSTIN_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      window.localStorage.removeItem(GSTIN_CACHE_KEY);
    } catch {
      // ignore
    }
  }
}

export function getCachedGstinLookup(gstin: string): GstinLookupResponse | null {
  const key = gstin.trim().toUpperCase();
  if (!key) return null;
  const map = readGstinCacheMap();
  const entry = map[key];
  if (!entry) return null;
  if (Date.now() - Number(entry.cachedAt || 0) > GSTIN_CACHE_TTL_MS) {
    return null;
  }
  return entry;
}

export function setCachedGstinLookup(gstin: string, result: GstinLookupResponse): GstinLookupResponse {
  const key = gstin.trim().toUpperCase();
  const map = { ...readGstinCacheMap() };
  const stamped: GstinLookupResponse & { cachedAt: number } = {
    ...result,
    gstin: key,
    cachedAt: Date.now(),
  };
  map[key] = stamped;
  persistGstinCacheMap(map);
  return stamped;
}

export function listCachedGstinLookups(): GstinLookupResponse[] {
  const map = readGstinCacheMap();
  const now = Date.now();
  return Object.values(map)
    .filter((item) => item?.gstin && now - Number(item.cachedAt || 0) <= GSTIN_CACHE_TTL_MS)
    .sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0));
}

// ==================== IN-FLIGHT DEDUPLICATION ====================

export function dedupeFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fetcher().finally(() => {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key);
    }
  });
  inFlight.set(key, promise);
  return promise;
}

// ==================== PENDING FIREBASE SYNC QUEUE ====================

const PENDING_SYNC_PREFIX = 'drona_v1_pending_sync_';

export type PendingSyncOp =
  | {
      id: string;
      kind: 'upsert_profile';
      profile: BusinessProfile;
      userPatch?: Record<string, unknown>;
      cascadeDefaultInvoiceTemplate?: string;
      cascadeDefaultQuotationTemplate?: string;
      cascadeBusinessSnapshot?: boolean;
      createdAt: number;
    }
  | {
      id: string;
      kind: 'upsert_customer';
      customer: Customer;
      cascadeSnapshot?: boolean;
      createdAt: number;
    }
  | {
      id: string;
      kind: 'upsert_invoice';
      invoice: Invoice;
      seqAlloc?: { counterKey: string; seq: number };
      createdAt: number;
    }
  | {
      id: string;
      kind: 'upsert_quotation';
      quotation: Quotation;
      seqAlloc?: { counterKey: string; seq: number };
      createdAt: number;
    }
  | {
      id: string;
      kind: 'upsert_payment';
      payment: Payment;
      invoicePatch: {
        invoiceId: string;
        amountPaid: number;
        balanceDue: number;
        status: InvoiceStatus;
        updatedAt: string;
      };
      seqAlloc?: { counterKey: string; seq: number };
      createdAt: number;
    };

const pendingSyncMemory = new Map<string, PendingSyncOp[]>();

function readPendingSyncFromStorage(tenantUid: string): PendingSyncOp[] {
  const existing = pendingSyncMemory.get(tenantUid);
  if (existing) return existing;
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(`${PENDING_SYNC_PREFIX}${tenantUid}`);
    if (!raw) {
      pendingSyncMemory.set(tenantUid, []);
      return [];
    }
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? (parsed as PendingSyncOp[]) : [];
    pendingSyncMemory.set(tenantUid, list);
    return list;
  } catch {
    return [];
  }
}

function writePendingSyncToStorage(tenantUid: string, ops: PendingSyncOp[]): void {
  pendingSyncMemory.set(tenantUid, ops);
  if (!hasStorage()) return;
  try {
    if (ops.length === 0) {
      window.localStorage.removeItem(`${PENDING_SYNC_PREFIX}${tenantUid}`);
    } else {
      window.localStorage.setItem(`${PENDING_SYNC_PREFIX}${tenantUid}`, JSON.stringify(ops));
    }
  } catch {
    // ignore quota issues; memory queue still persists for current session
  }
}

export function getPendingSyncOps(tenantUid: string): PendingSyncOp[] {
  return [...readPendingSyncFromStorage(tenantUid)];
}

export function enqueuePendingSyncOp(tenantUid: string, op: PendingSyncOp): void {
  const list = readPendingSyncFromStorage(tenantUid);
  // Coalesce consecutive profile or same-entity updates to keep queue compact and fast
  const filtered = list.filter((existing) => {
    if (op.kind === 'upsert_profile' && existing.kind === 'upsert_profile') {
      // Preserve cascade flags if an earlier pending op requested them
      if (existing.cascadeDefaultInvoiceTemplate && !op.cascadeDefaultInvoiceTemplate) {
        op.cascadeDefaultInvoiceTemplate = existing.cascadeDefaultInvoiceTemplate;
      }
      if (existing.cascadeDefaultQuotationTemplate && !op.cascadeDefaultQuotationTemplate) {
        op.cascadeDefaultQuotationTemplate = existing.cascadeDefaultQuotationTemplate;
      }
      if (existing.cascadeBusinessSnapshot) {
        op.cascadeBusinessSnapshot = true;
      }
      return false;
    }
    if (
      op.kind === 'upsert_customer' &&
      existing.kind === 'upsert_customer' &&
      existing.customer.id === op.customer.id
    ) {
      if (existing.cascadeSnapshot) op.cascadeSnapshot = true;
      return false;
    }
    if (
      op.kind === 'upsert_invoice' &&
      existing.kind === 'upsert_invoice' &&
      existing.invoice.id === op.invoice.id
    ) {
      if (existing.seqAlloc && !op.seqAlloc) op.seqAlloc = existing.seqAlloc;
      return false;
    }
    if (
      op.kind === 'upsert_quotation' &&
      existing.kind === 'upsert_quotation' &&
      existing.quotation.id === op.quotation.id
    ) {
      if (existing.seqAlloc && !op.seqAlloc) op.seqAlloc = existing.seqAlloc;
      return false;
    }
    return true;
  });
  filtered.push(op);
  writePendingSyncToStorage(tenantUid, filtered);
}

export function removePendingSyncOp(tenantUid: string, opId: string): void {
  const list = readPendingSyncFromStorage(tenantUid);
  const next = list.filter((op) => op.id !== opId);
  if (next.length !== list.length) {
    writePendingSyncToStorage(tenantUid, next);
  }
}

export function hasPendingSyncForProfile(tenantUid: string): boolean {
  return readPendingSyncFromStorage(tenantUid).some((op) => op.kind === 'upsert_profile');
}

export function hasPendingSyncForCustomer(tenantUid: string, customerId: string): boolean {
  return readPendingSyncFromStorage(tenantUid).some(
    (op) => op.kind === 'upsert_customer' && op.customer.id === customerId
  );
}


