import type {
  ActivityLog,
  AdminDashboardData,
  AuthSessionState,
  BusinessProfile,
  Customer,
  CustomerAnalyticsData,
  GstinLookupResponse,
  ImpersonationSession,
  Invoice,
  LineItemInput,
  NotificationItem,
  OutstandingReportRow,
  Payment,
  PaymentMethod,
  PlatformSettings,
  PurchaseOcrRawResponse,
  Quotation,
  RateCardItem,
  SavePurchasePayload,
  Supplier,
  TaxPricingMode,
  TaxSupplyMode,
  TemplateId,
  UserRecord,
} from '../shared/types';
import { GSTIN_REGEX, isValidGstinChecksum } from '../shared/indianStates';
import {
  dedupeFetch,
  getCachedGstinLookup,
  listCachedGstinLookups,
  setCachedGstinLookup,
} from './localCache';
import {
  cachedRead,
  ensureTenantMetaListener,
  rtdbService,
  subscribeRtdbPath,
  updateRuntimeSessionCache,
} from './rtdbService';

export { cachedRead, ensureTenantMetaListener, subscribeRtdbPath, updateRuntimeSessionCache };

const TOKEN_KEY = 'drona_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface SaveDocumentPayload {
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

export interface AdminUserRow extends UserRecord {
  invoiceCount: number;
  quotationCount: number;
  totalSales: number;
  totalCollected: number;
}

export const authApi = {
  getPublicSettings: () => rtdbService.getPublicSettings(),

  login: async (email: string, password: string, portal?: 'admin' | 'customer') => {
    const session = await rtdbService.login(email, password, portal);
    setStoredToken(session.actorUser.uid);
    return session;
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
  }) => {
    const session = await rtdbService.register(payload);
    setStoredToken(session.actorUser.uid);
    return session;
  },

  logout: async () => {
    try {
      await rtdbService.logout();
    } finally {
      setStoredToken(null);
    }
  },

  me: (forceRefresh = false) => rtdbService.me(forceRefresh),

  forgotPassword: (email: string) => rtdbService.forgotPassword(email),

  resetPassword: async (_token: string, _newPassword: string) => ({
    ok: true,
    message: 'Use the Firebase password reset link sent to your email.',
  }),

  changePassword: (currentPassword: string, newPassword: string) =>
    rtdbService.changePassword(currentPassword, newPassword),
};

export const businessApi = {
  getProfile: () => rtdbService.getBusinessProfile(),
  updateProfile: (payload: Partial<BusinessProfile>) => rtdbService.updateBusinessProfile(payload),
};

export const customersApi = {
  list: (params?: { search?: string; includeArchived?: boolean }) =>
    rtdbService.listCustomers(params),
  get: (id: string) => rtdbService.getCustomer(id),
  create: (payload: Partial<Customer>) => rtdbService.createCustomer(payload),
  update: (id: string, payload: Partial<Customer>) => rtdbService.updateCustomer(id, payload),
  remove: (id: string) => rtdbService.deleteCustomer(id),
};

export const gstinApi = {
  getRecentLookups: () => listCachedGstinLookups(),

  lookup: async (
    rawGstin: string,
    options?: { forceRefresh?: boolean }
  ): Promise<{ result: GstinLookupResponse; fromCache: boolean }> => {
    const gstin = rawGstin.trim().toUpperCase();
    if (!GSTIN_REGEX.test(gstin)) {
      throw new ApiError('Enter a valid 15-character GSTIN (e.g. 27ABCDE1234F1Z5).', 400);
    }
    if (!isValidGstinChecksum(gstin)) {
      throw new ApiError(
        'GSTIN checksum digit (15th character) is invalid. Please double-check the GST number.',
        400
      );
    }

    if (!options?.forceRefresh) {
      const cached = getCachedGstinLookup(gstin);
      if (cached) {
        return { result: cached, fromCache: true };
      }
    }

    const result = await dedupeFetch(`gstin:${gstin}`, async () => {
      const res = await fetch(
        `/api/gstin?gstin=${encodeURIComponent(gstin)}&include=profile`,
        { headers: { Accept: 'application/json' } }
      );
      const body = (await res.json().catch(() => ({}))) as Partial<GstinLookupResponse> & {
        error?: string;
      };
      if (!res.ok || !body.success || !body.data) {
        throw new ApiError(
          body.error || `GSTIN lookup failed (HTTP ${res.status})`,
          res.status || 500
        );
      }
      return setCachedGstinLookup(gstin, body as GstinLookupResponse);
    });

    return { result, fromCache: false };
  },
};

export const invoicesApi = {
  list: (params?: {
    search?: string;
    status?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }) => rtdbService.listInvoices(params),
  get: (id: string) => rtdbService.getInvoice(id),
  create: (payload: SaveDocumentPayload) => rtdbService.saveInvoice(payload),
  update: (id: string, payload: SaveDocumentPayload) => rtdbService.saveInvoice(payload, id),
  finalize: (id: string) => rtdbService.finalizeInvoice(id),
  cancel: (id: string, reason: string) => rtdbService.cancelInvoice(id, reason),
};

export const quotationsApi = {
  list: (params?: {
    search?: string;
    status?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }) => rtdbService.listQuotations(params),
  get: (id: string) => rtdbService.getQuotation(id),
  create: (payload: SaveDocumentPayload) => rtdbService.saveQuotation(payload),
  update: (id: string, payload: SaveDocumentPayload) => rtdbService.saveQuotation(payload, id),
  setStatus: (id: string, status: 'sent' | 'accepted' | 'rejected') =>
    rtdbService.setQuotationStatus(id, status),
  convertToInvoice: (id: string) => rtdbService.convertQuotationToInvoice(id),
};

export const paymentsApi = {
  list: (params?: {
    search?: string;
    customerId?: string;
    method?: string;
    startDate?: string;
    endDate?: string;
  }) => rtdbService.listPayments(params),
  record: (payload: {
    invoiceId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceId?: string;
    notes?: string;
  }) => rtdbService.recordPayment(payload),
  update: (
    id: string,
    payload: {
      paymentDate?: string;
      amount?: number;
      paymentMethod?: PaymentMethod;
      referenceId?: string;
      notes?: string;
    }
  ) => rtdbService.updatePayment(id, payload),
  remove: (id: string) => rtdbService.deletePayment(id),
};

export const rateCardApi = {
  list: (params?: { search?: string; activeOnly?: boolean; category?: string }) =>
    rtdbService.listRateCard(params),
  create: (payload: Partial<RateCardItem>) => rtdbService.createRateCardItem(payload),
  update: (id: string, payload: Partial<RateCardItem>) => rtdbService.updateRateCardItem(id, payload),
  remove: (id: string) => rtdbService.deleteRateCardItem(id),
};

export const analyticsApi = {
  getDashboard: (params?: { range?: string; startDate?: string; endDate?: string }) =>
    rtdbService.getDashboardAnalytics(params),
  getOutstanding: (params?: {
    filter?: 'all' | 'not_due' | 'overdue';
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }) => rtdbService.getOutstandingReport(params),
};

export const notificationsApi = {
  list: () => rtdbService.listNotifications(),
  markRead: (id: string) => rtdbService.markNotificationRead(id),
  markAllRead: () => rtdbService.markAllNotificationsRead(),
};

export const suppliersApi = {
  list: (params?: { search?: string; includeArchived?: boolean }) =>
    rtdbService.listSuppliers(params),
  get: (id: string) => rtdbService.getSupplier(id),
  create: (payload: Partial<Supplier>) => rtdbService.createSupplier(payload),
  update: (id: string, payload: Partial<Supplier>) => rtdbService.updateSupplier(id, payload),
  remove: (id: string) => rtdbService.deleteSupplier(id),
};

export const purchasesApi = {
  list: (params?: {
    search?: string;
    status?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
  }) => rtdbService.listPurchases(params),
  get: (id: string) => rtdbService.getPurchase(id),
  create: (payload: SavePurchasePayload) => rtdbService.savePurchase(payload),
  update: (id: string, payload: SavePurchasePayload) => rtdbService.savePurchase(payload, id),
  remove: (id: string) => rtdbService.deletePurchase(id),
  getAnalytics: (params?: { range?: string; startDate?: string; endDate?: string }) =>
    rtdbService.getPurchasesAnalytics(params),
};

export const purchasePaymentsApi = {
  list: (params?: {
    search?: string;
    supplierId?: string;
    purchaseId?: string;
    startDate?: string;
    endDate?: string;
  }) => rtdbService.listPurchasePayments(params),
  record: (payload: {
    purchaseId: string;
    paymentDate: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceId?: string;
    notes?: string;
    allowAdvance?: boolean;
  }) => rtdbService.recordPurchasePayment(payload),
  update: (
    id: string,
    payload: {
      paymentDate?: string;
      amount?: number;
      paymentMethod?: PaymentMethod;
      referenceId?: string;
      notes?: string;
    }
  ) => rtdbService.updatePurchasePayment(id, payload),
  remove: (id: string) => rtdbService.deletePurchasePayment(id),
};

export const purchaseOcrApi = {
  extract: async (params: {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }): Promise<PurchaseOcrRawResponse> => {
    const res = await fetch('/api/ocr/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<PurchaseOcrRawResponse> & {
      error?: string;
      code?: string;
    };
    if (!res.ok || !body.success) {
      throw new ApiError(
        body.error || `PaddleOCR extraction failed (HTTP ${res.status})`,
        res.status || 500
      );
    }
    return body as PurchaseOcrRawResponse;
  },
};

import type { GstExportRecord } from '../shared/gstnTypes';

export const gstExportsApi = {
  save: (payload: Omit<GstExportRecord, 'id' | 'userUid' | 'createdAt'>) =>
    rtdbService.saveGstExportRecord(payload),
  list: () => rtdbService.listGstExportRecords(),
  delete: (id: string) => rtdbService.deleteGstExportRecord(id),
};

export const adminApi = {
  getDashboard: (params?: { range?: string; startDate?: string; endDate?: string }): Promise<AdminDashboardData> =>
    rtdbService.getAdminDashboard(params),
  listUsers: (params?: { search?: string; status?: string }) => rtdbService.adminListUsers(params),
  createUser: (payload: {
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
  }) => rtdbService.adminCreateUser(payload),
  getUserDetails: (uid: string): Promise<{
    user: UserRecord;
    profile: BusinessProfile | null;
    invoices: Invoice[];
    quotations: Quotation[];
    analytics: CustomerAnalyticsData;
    logs: ActivityLog[];
  }> => rtdbService.adminGetUserDetails(uid),
  updateUser: (
    uid: string,
    payload: {
      businessName?: string;
      ownerName?: string;
      phone?: string;
      gstin?: string;
      subscriptionPlan?: string;
      subscriptionAmount?: number;
    }
  ) => rtdbService.adminUpdateUser(uid, payload),
  setUserStatus: (uid: string, status: 'active' | 'inactive') =>
    rtdbService.adminSetUserStatus(uid, status),
  resetUserPassword: (uid: string, _newPassword?: string) =>
    rtdbService.adminResetUserPassword(uid),
  impersonate: (uid: string): Promise<{ session: AuthSessionState }> =>
    rtdbService.adminImpersonate(uid),
  exitImpersonation: (): Promise<{ session: AuthSessionState }> =>
    rtdbService.adminExitImpersonation(),
  listInvoices: (params?: { search?: string; status?: string }) =>
    rtdbService.adminListInvoices(params),
  listQuotations: (params?: { search?: string; status?: string }) =>
    rtdbService.adminListQuotations(params),
  listActivityLogs: (limit = 150) => rtdbService.adminListActivityLogs(limit),
  listImpersonationHistory: () => rtdbService.adminListImpersonationHistory(),
  getSettings: () => rtdbService.adminGetSettings(),
  updateSettings: (payload: Partial<PlatformSettings>) => rtdbService.adminUpdateSettings(payload),
};
