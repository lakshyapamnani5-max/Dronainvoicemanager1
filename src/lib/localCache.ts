import type {
  ActivityLog,
  AuthSessionState,
  BusinessProfile,
  Customer,
  ImpersonationSession,
  Invoice,
  NotificationItem,
  Payment,
  PlatformSettings,
  Quotation,
  RateCardItem,
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
  | 'activityLogs';

export interface TenantMetaMap {
  profile?: number;
  customers?: number;
  invoices?: number;
  quotations?: number;
  payments?: number;
  rateCard?: number;
  notifications?: number;
  activityLogs?: number;
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
  syncedAt: Partial<Record<TenantCollection, number>>;
  lastOverdueCheckDate?: string;
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
    syncedAt: {},
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
    syncedAt: entry.syncedAt,
    lastOverdueCheckDate: entry.lastOverdueCheckDate,
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
      syncedAt: parsed.syncedAt && typeof parsed.syncedAt === 'object' ? parsed.syncedAt : {},
      lastOverdueCheckDate: parsed.lastOverdueCheckDate,
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
  if (!ts) return false;
  if (sessionSynced.has(`${tenantUid}:${col}`)) {
    return true;
  }
  return Date.now() - ts < ttlMs;
}

export function hasTenantCollectionData(tenantUid: string, col: TenantCollection): boolean {
  const entry = getTenantEntry(tenantUid);
  return Boolean(entry.syncedAt[col]);
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

export function getTenantExpiryCheckDate(tenantUid: string): string | undefined {
  return getTenantEntry(tenantUid).lastExpiryCheckDate;
}

export function setTenantExpiryCheckDate(tenantUid: string, dateIso: string): void {
  const entry = getTenantEntry(tenantUid);
  entry.lastExpiryCheckDate = dateIso;
  persistTenantEntry(tenantUid, entry);
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
