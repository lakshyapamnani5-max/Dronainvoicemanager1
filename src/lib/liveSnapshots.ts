import { get, ref } from 'firebase/database';
import { rtdb } from './firebase';
import {
  getCachedSession,
  getTenantEntry,
  hasPendingSyncForCustomer,
  hasPendingSyncForProfile,
  setTenantProfileCache,
  upsertTenantCustomerCache,
} from './localCache';
import { getStateFromGstin } from '../shared/indianStates';
import { normalizeTemplateId } from '../components/invoice/invoiceThemeRegistry';
import { normalizeQuotationTemplateId } from '../components/quotation/quotationThemeRegistry';
import type {
  BusinessProfile,
  BusinessSnapshot,
  Customer,
  CustomerSnapshot,
  Invoice,
  Quotation,
} from '../shared/types';

function pickStr(liveVal: string | undefined | null, fallbackVal: string): string {
  return liveVal !== undefined && liveVal !== null ? liveVal : fallbackVal;
}

function resolveProfileFromCache(tenantUid: string): BusinessProfile | null {
  if (tenantUid) {
    const entry = getTenantEntry(tenantUid);
    if (entry.profile) return entry.profile;
  }
  const sess = getCachedSession();
  if (sess?.businessProfile) {
    if (!tenantUid || sess.effectiveUser.uid === tenantUid) {
      return sess.businessProfile;
    }
  }
  return null;
}

function resolveCustomerFromCache(tenantUid: string, customerId: string): Customer | null {
  if (!tenantUid || !customerId || customerId === 'preview' || customerId === 'preview-customer') {
    return null;
  }
  const entry = getTenantEntry(tenantUid);
  return entry.customers.find((c) => c.id === customerId) || null;
}

export function mergeDocumentWithLiveSnapshotsSync<T extends Invoice | Quotation>(
  record: T,
  liveProfileOverride?: BusinessProfile | null,
  liveCustomerOverride?: Customer | null
): T {
  const tenantUid = record.userUid || getCachedSession()?.effectiveUser.uid || '';
  const liveProfile = liveProfileOverride ?? resolveProfileFromCache(tenantUid);
  const liveCustomer =
    liveCustomerOverride ?? resolveCustomerFromCache(tenantUid, record.customerId);
  const isDraftPreview = record.id === 'preview';

  let nextBiz: BusinessSnapshot = record.businessSnapshot;
  if (liveProfile) {
    if (isDraftPreview) {
      // Preserve unsaved fields typed in editor preview; backfill empty fields from live profile
      const resolvedUpiId = nextBiz.upiId.trim() || liveProfile.upiId || '';
      nextBiz = {
        ...nextBiz,
        businessName: nextBiz.businessName || liveProfile.businessName,
        ownerName: nextBiz.ownerName || liveProfile.ownerName,
        logoDataUrl: nextBiz.logoDataUrl || liveProfile.logoDataUrl,
        address: nextBiz.address || liveProfile.address,
        email: nextBiz.email || liveProfile.email,
        phone: nextBiz.phone || liveProfile.phone,
        gstin: nextBiz.gstin || liveProfile.gstin,
        pan: nextBiz.pan || liveProfile.pan,
        state: nextBiz.state || liveProfile.state,
        bankName: nextBiz.bankName || liveProfile.bankName,
        accountNumber: nextBiz.accountNumber || liveProfile.accountNumber,
        ifsc: nextBiz.ifsc || liveProfile.ifsc,
        upiId: resolvedUpiId,
        upiQrDataUrl: resolvedUpiId ? '' : nextBiz.upiQrDataUrl || liveProfile.upiQrDataUrl,
        signatureLabel: nextBiz.signatureLabel || liveProfile.signatureLabel,
        signatureDataUrl: nextBiz.signatureDataUrl || liveProfile.signatureDataUrl,
      };
    } else {
      const resolvedUpiId =
        liveProfile.upiId !== undefined ? liveProfile.upiId : nextBiz.upiId;
      nextBiz = {
        ...nextBiz,
        businessName: liveProfile.businessName || nextBiz.businessName,
        ownerName: pickStr(liveProfile.ownerName, nextBiz.ownerName),
        logoDataUrl: liveProfile.logoDataUrl || nextBiz.logoDataUrl,
        address: pickStr(liveProfile.address, nextBiz.address),
        email: pickStr(liveProfile.email, nextBiz.email),
        phone: pickStr(liveProfile.phone, nextBiz.phone),
        gstin: pickStr(liveProfile.gstin, nextBiz.gstin),
        pan: pickStr(liveProfile.pan, nextBiz.pan),
        state: liveProfile.state || nextBiz.state,
        bankName: pickStr(liveProfile.bankName, nextBiz.bankName),
        accountNumber: pickStr(liveProfile.accountNumber, nextBiz.accountNumber),
        ifsc: pickStr(liveProfile.ifsc, nextBiz.ifsc),
        upiId: resolvedUpiId,
        upiQrDataUrl: resolvedUpiId
          ? ''
          : liveProfile.upiQrDataUrl || nextBiz.upiQrDataUrl,
        signatureLabel: liveProfile.signatureLabel || nextBiz.signatureLabel,
        signatureDataUrl: liveProfile.signatureDataUrl || nextBiz.signatureDataUrl,
      };
    }
  }

  let nextCust: CustomerSnapshot = record.customerSnapshot;
  if (liveCustomer && !isDraftPreview) {
    nextCust = {
      ...nextCust,
      id: liveCustomer.id || nextCust.id,
      name: liveCustomer.name || nextCust.name,
      companyName: pickStr(liveCustomer.companyName, nextCust.companyName),
      email: pickStr(liveCustomer.email, nextCust.email),
      phone: pickStr(liveCustomer.phone, nextCust.phone),
      gstin: pickStr(liveCustomer.gstin, nextCust.gstin),
      billingAddress: pickStr(liveCustomer.billingAddress, nextCust.billingAddress),
      shippingAddress: pickStr(liveCustomer.shippingAddress, nextCust.shippingAddress),
      state: liveCustomer.state || nextCust.state,
    };
  }

  if (nextBiz === record.businessSnapshot && nextCust === record.customerSnapshot) {
    return record;
  }

  return {
    ...record,
    businessSnapshot: nextBiz,
    customerSnapshot: nextCust,
  };
}

function normalizeRemoteProfile(
  uid: string,
  raw: Record<string, unknown>
): BusinessProfile {
  return {
    userUid: String(raw.userUid || uid),
    businessName: String(raw.businessName || ''),
    ownerName: String(raw.ownerName || ''),
    logoDataUrl: String(raw.logoDataUrl || ''),
    address: String(raw.address || ''),
    email: String(raw.email || ''),
    phone: String(raw.phone || ''),
    gstin: String(raw.gstin || '').toUpperCase(),
    pan: String(raw.pan || '').toUpperCase(),
    state: String(raw.state || 'Maharashtra'),
    bankName: String(raw.bankName || ''),
    accountNumber: String(raw.accountNumber || ''),
    ifsc: String(raw.ifsc || '').toUpperCase(),
    upiId: String(raw.upiId || ''),
    upiQrDataUrl: String(raw.upiQrDataUrl || ''),
    invoicePrefix: String(raw.invoicePrefix || 'INV'),
    quotationPrefix: String(raw.quotationPrefix || 'QTN'),
    defaultIsGst: raw.defaultIsGst !== false,
    defaultTaxRate: Number(raw.defaultTaxRate ?? 18),
    defaultTaxMode: (raw.defaultTaxMode as BusinessProfile['defaultTaxMode']) || 'exclusive',
    defaultPaymentTermsDays: Number(raw.defaultPaymentTermsDays ?? 15),
    defaultInvoiceTemplate: normalizeTemplateId(raw.defaultInvoiceTemplate as string),
    defaultQuotationTemplate: normalizeQuotationTemplateId(raw.defaultQuotationTemplate as string),
    termsAndConditions: String(raw.termsAndConditions || ''),
    signatureLabel: String(raw.signatureLabel || 'Authorized Signatory'),
    signatureDataUrl: String(raw.signatureDataUrl || ''),
    updatedAt: String(raw.updatedAt || ''),
  };
}

function normalizeRemoteCustomer(raw: Record<string, unknown>): Customer {
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
    shippingAddress: String(raw.shippingAddress || ''),
    state,
    notes: String(raw.notes || ''),
    archived: Boolean(raw.archived),
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
  };
}

const lastCloudCheckMap = new Map<string, number>();
const CLOUD_CHECK_MIN_INTERVAL_MS = 10_000;

/**
 * Resolves the latest Customer & Business Profile snapshots from localStorage first (instant),
 * and fetches fresh cloud copies from Firebase RTDB if needed or stale, updating localStorage too.
 */
export async function resolveLatestDocumentForDownload<T extends Invoice | Quotation>(
  record: T
): Promise<T> {
  const tenantUid = record.userUid || getCachedSession()?.effectiveUser.uid || '';
  if (!tenantUid || record.id === 'preview') {
    return mergeDocumentWithLiveSnapshotsSync(record);
  }

  const localProf = resolveProfileFromCache(tenantUid);
  const localCust = resolveCustomerFromCache(tenantUid, record.customerId);
  const profilePending = hasPendingSyncForProfile(tenantUid);
  const custPending = Boolean(
    record.customerId && hasPendingSyncForCustomer(tenantUid, record.customerId)
  );

  const checkKey = `${tenantUid}:${record.customerId || ''}`;
  const lastCheckAt = lastCloudCheckMap.get(checkKey) || 0;
  const needCloudCheck =
    !localProf ||
    (Boolean(record.customerId) && !localCust) ||
    Date.now() - lastCheckAt > CLOUD_CHECK_MIN_INTERVAL_MS;

  if (!needCloudCheck || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return mergeDocumentWithLiveSnapshotsSync(record, localProf, localCust);
  }

  lastCloudCheckMap.set(checkKey, Date.now());

  let fetchedProf: BusinessProfile | null = localProf;
  let fetchedCust: Customer | null = localCust;

  const remoteTask = (async () => {
    const tasks: Array<Promise<void>> = [];

    if (!profilePending) {
      tasks.push(
        get(ref(rtdb, `businessProfiles/${tenantUid}`))
          .then((snap) => {
            if (snap.exists()) {
              const remoteProf = normalizeRemoteProfile(
                tenantUid,
                snap.val() as Record<string, unknown>
              );
              const localTs = localProf?.updatedAt || '';
              const remoteTs = remoteProf.updatedAt || '';
              if (!localProf || remoteTs >= localTs) {
                fetchedProf = remoteProf;
                setTenantProfileCache(tenantUid, remoteProf, true);
              }
            }
          })
          .catch(() => {})
      );
    }

    if (
      record.customerId &&
      record.customerId !== 'preview' &&
      record.customerId !== 'preview-customer' &&
      !custPending
    ) {
      tasks.push(
        get(ref(rtdb, `tenants/${tenantUid}/customers/${record.customerId}`))
          .then((snap) => {
            if (snap.exists()) {
              const remoteCust = normalizeRemoteCustomer(
                snap.val() as Record<string, unknown>
              );
              const localTs = localCust?.updatedAt || '';
              const remoteTs = remoteCust.updatedAt || '';
              if (!localCust || remoteTs >= localTs) {
                fetchedCust = remoteCust;
                upsertTenantCustomerCache(tenantUid, remoteCust);
              }
            }
          })
          .catch(() => {})
      );
    }

    await Promise.all(tasks);
  })();

  // Race against a 1.1s timeout so offline/slow mobile downloads remain instantaneous from localStorage
  await Promise.race([
    remoteTask,
    new Promise<void>((resolve) => setTimeout(resolve, 1100)),
  ]);

  return mergeDocumentWithLiveSnapshotsSync(record, fetchedProf, fetchedCust);
}
