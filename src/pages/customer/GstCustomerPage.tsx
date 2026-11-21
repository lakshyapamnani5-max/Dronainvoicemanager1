import * as React from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cachedRead, customersApi, gstinApi } from '../../lib/api';
import {
  GSTIN_REGEX,
  INDIAN_STATES,
  getStateByCode,
  getStateFromGstin,
  isValidGstinChecksum,
} from '../../shared/indianStates';
import type { Customer, GstinLookupResponse } from '../../shared/types';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';

function formatAddressFromLookup(data: GstinLookupResponse['data']): string {
  const rawAddr = (data.address || '').trim();
  const pin = (data.pincode || data.address_details?.pincode || '').trim();

  if (rawAddr) {
    if (pin && !rawAddr.includes(pin)) {
      return `${rawAddr}, ${pin}`;
    }
    return rawAddr;
  }

  const d = data.address_details;
  if (!d) return '';
  const parts = [
    d.building_number,
    d.building_name,
    d.floor,
    d.street,
    d.locality,
    d.landmark,
    d.city || d.district,
    d.state,
    pin,
  ]
    .map((p) => (p || '').trim())
    .filter(Boolean);
  return parts.join(', ');
}

function resolveIndianState(gstin: string, data: GstinLookupResponse['data']): string {
  if (data.state_code) {
    const byCode = getStateByCode(data.state_code);
    if (byCode) return byCode;
  }
  const byGstin = getStateFromGstin(gstin);
  if (byGstin) return byGstin;

  const addrState = (data.address_details?.state || '').trim().toLowerCase();
  if (addrState) {
    const found = INDIAN_STATES.find((s) => s.name.toLowerCase() === addrState);
    if (found) return found.name;
  }
  return 'Maharashtra';
}

function buildGstNotesSummary(data: GstinLookupResponse['data']): string {
  const parts: string[] = [];
  if (data.status) parts.push(`GST Status: ${data.status}`);
  if (data.taxpayer_type) parts.push(`Type: ${data.taxpayer_type}`);
  if (data.business_constitution) parts.push(`Constitution: ${data.business_constitution}`);
  if (data.registration_date) parts.push(`Reg Date: ${data.registration_date}`);
  if (data.einvoice_status) parts.push(`E-Invoice: ${data.einvoice_status}`);
  return parts.join(' | ');
}

export function GstCustomerLookupView({
  navigate,
  onCustomerSaved,
}: {
  navigate: (path: string) => void;
  onCustomerSaved?: (customer: Customer) => void;
}) {
  const { session, refreshSession } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();

  const isUnlimitedAdmin =
    session?.actorUser.role === 'super_admin' && !session?.isImpersonating;
  const totalGstinCredits = Math.max(0, session?.effectiveUser.gstinCredits ?? 10);
  const usedGstinCredits = Math.max(0, session?.effectiveUser.gstinCreditsUsed ?? 0);
  const remainingGstinCredits = isUnlimitedAdmin
    ? 999999
    : Math.max(0, totalGstinCredits - usedGstinCredits);
  const gstinCreditsExhausted = !isUnlimitedAdmin && remainingGstinCredits <= 0;

  const [gstinInput, setGstinInput] = React.useState('');
  const [lookingUp, setLookingUp] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const [lookupResult, setLookupResult] = React.useState<GstinLookupResponse | null>(null);
  const [fromCache, setFromCache] = React.useState(false);
  const [recentLookups, setRecentLookups] = React.useState<GstinLookupResponse[]>(() =>
    gstinApi.getRecentLookups()
  );

  const [allCustomers, setAllCustomers] = React.useState<Customer[]>(() =>
    tenantUid && cachedRead.hasTenantCollectionData(tenantUid, 'customers')
      ? cachedRead.getTenantEntry(tenantUid).customers
      : []
  );

  const [saving, setSaving] = React.useState(false);
  const [createdCustomer, setCreatedCustomer] = React.useState<Customer | null>(null);
  const [sameShippingAddress, setSameShippingAddress] = React.useState(true);

  const [form, setForm] = React.useState({
    name: '',
    companyName: '',
    email: '',
    phone: '',
    gstin: '',
    billingAddress: '',
    shippingAddress: '',
    state: 'Maharashtra',
    notes: '',
  });

  React.useEffect(() => {
    if (!tenantUid) return;
    if (!cachedRead.hasTenantCollectionData(tenantUid, 'customers')) {
      void customersApi.list({ includeArchived: true }).then((res) => setAllCustomers(res.customers)).catch(() => {});
    }
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('customers')) {
        setAllCustomers(cachedRead.getTenantEntry(tenantUid).customers);
      }
    });
  }, [tenantUid]);

  const cleanedGstin = gstinInput.replace(/\s+/g, '').toUpperCase();
  const isLengthComplete = cleanedGstin.length === 15;
  const isPatternOk = GSTIN_REGEX.test(cleanedGstin);
  const isChecksumOk = isLengthComplete && isValidGstinChecksum(cleanedGstin);
  const derivedStateHint = React.useMemo(
    () => getStateFromGstin(cleanedGstin),
    [cleanedGstin]
  );

  const existingCustomer = React.useMemo(() => {
    const targetGstin = (lookupResult?.gstin || (isLengthComplete ? cleanedGstin : '')).toUpperCase();
    if (!targetGstin) return null;
    return allCustomers.find((c) => c.gstin.trim().toUpperCase() === targetGstin) || null;
  }, [allCustomers, lookupResult, cleanedGstin, isLengthComplete]);

  const populateFormFromResult = React.useCallback((res: GstinLookupResponse) => {
    const d = res.data;
    const gstin = (d.gstin || res.gstin).toUpperCase();
    const tradeName = (d.trade_name || '').trim();
    const legalName = (d.legal_name || '').trim();
    const primaryCompany = tradeName || legalName || gstin;
    const contactName = legalName || tradeName || primaryCompany;
    const address = formatAddressFromLookup(d);
    const state = resolveIndianState(gstin, d);
    const notes = buildGstNotesSummary(d);

    setForm({
      name: contactName,
      companyName: primaryCompany,
      email: '',
      phone: '',
      gstin,
      billingAddress: address,
      shippingAddress: '',
      state,
      notes,
    });
    setSameShippingAddress(true);
    setCreatedCustomer(null);
  }, []);

  const handleLookup = async (e?: React.FormEvent, overrideGstin?: string, forceRefresh = false) => {
    e?.preventDefault();
    const target = (overrideGstin ?? cleanedGstin).replace(/\s+/g, '').toUpperCase();
    if (overrideGstin) {
      setGstinInput(target);
    }

    setLookupError(null);
    setCreatedCustomer(null);

    if (!target) {
      setLookupError('Please enter a 15-character GST number.');
      return;
    }

    setLookingUp(true);
    try {
      const { result, fromCache: hitCache } = await gstinApi.lookup(target, { forceRefresh });
      setLookupResult(result);
      setFromCache(hitCache);
      setRecentLookups(gstinApi.getRecentLookups());
      populateFormFromResult(result);
      if (!hitCache) {
        void refreshSession();
      }
      notify(
        'success',
        hitCache
          ? `Loaded verified GSTIN details for ${result.data.trade_name || result.data.legal_name || target}`
          : `Fetched live GSTIN details for ${result.data.trade_name || result.data.legal_name || target}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to verify GSTIN';
      setLookupError(msg);
      notify('error', msg);
    } finally {
      setLookingUp(false);
    }
  };

  const handleCreateOrUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      notify('error', 'Contact / Legal Name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        shippingAddress: sameShippingAddress ? '' : form.shippingAddress,
      };

      let saved: Customer;
      if (existingCustomer) {
        const res = await customersApi.update(existingCustomer.id, {
          ...payload,
          archived: false,
        });
        saved = res.customer;
        notify('success', `Updated existing customer ${saved.companyName || saved.name}`);
      } else {
        const res = await customersApi.create(payload);
        saved = res.customer;
        notify('success', `Added ${saved.companyName || saved.name} as a customer`);
      }

      setCreatedCustomer(saved);
      onCustomerSaved?.(saved);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const resetForNext = () => {
    setGstinInput('');
    setLookupResult(null);
    setLookupError(null);
    setCreatedCustomer(null);
    setFromCache(false);
  };

  const gstStatus = (lookupResult?.data.status || '').trim();
  const isGstActive = gstStatus.toLowerCase() === 'active';

  return (
    <div className="space-y-6">
      {/* Search / GSTIN Verification Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#F57C00]" />
                Add Customer via GST Number
              </CardTitle>
              <CardDescription className="mt-1">
                Enter a 15-digit Indian GSTIN to fetch legal name, trade name, GST registration status,
                and principal business address directly from the GST network.
              </CardDescription>
            </div>
            <div
              className={`rounded-md border px-2.5 py-1 text-[11px] font-mono ${
                gstinCreditsExhausted
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                  : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'
              }`}
            >
              GSTIN Credits Left:{' '}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {isUnlimitedAdmin
                  ? 'Unlimited (Admin)'
                  : `${remainingGstinCredits} / ${totalGstinCredits}`}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {gstinCreditsExhausted ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Your live GSTIN lookup credits are exhausted (0 of {totalGstinCredits} remaining).
                Contact Drona Admin to assign more credits. Previously cached GSTINs below remain
                available for 0 credits.
              </span>
            </div>
          ) : null}

          <form onSubmit={(e) => void handleLookup(e)} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
              <Input
                value={gstinInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/\s+/g, '').toUpperCase().slice(0, 15);
                  setGstinInput(val);
                  if (lookupError) setLookupError(null);
                }}
                maxLength={15}
                placeholder="Enter 15-character GSTIN (e.g. 27AAACP1234A1Z5)"
                className="pl-9 pr-16 font-mono uppercase tracking-wider h-10"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="absolute right-3 top-3 font-mono text-[11px] text-zinc-400">
                {cleanedGstin.length}/15
              </span>
            </div>

            <Button
              type="submit"
              disabled={
                lookingUp ||
                !cleanedGstin ||
                (gstinCreditsExhausted &&
                  !recentLookups.some((item) => item.gstin === cleanedGstin))
              }
              className="h-10 sm:w-auto w-full"
            >
              <Search className="h-4 w-4" />
              {lookingUp ? 'Fetching GST Details...' : 'Fetch GST Details'}
            </Button>
          </form>

          {/* Live Format & Checksum Hint */}
          {cleanedGstin.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                {derivedStateHint ? (
                  <span className="text-zinc-600 dark:text-zinc-400">
                    State Code <span className="font-mono font-semibold">{cleanedGstin.slice(0, 2)}</span>:{' '}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{derivedStateHint}</span>
                  </span>
                ) : null}

                {isLengthComplete ? (
                  isChecksumOk ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Valid GSTIN format & checksum
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {!isPatternOk
                        ? 'Invalid 15-character GSTIN format'
                        : 'Invalid 15th checksum character — check for typos'}
                    </span>
                  )
                ) : (
                  <span className="text-zinc-500">
                    {15 - cleanedGstin.length} more character{15 - cleanedGstin.length === 1 ? '' : 's'} required
                  </span>
                )}
              </div>

              {lookupResult && fromCache && !gstinCreditsExhausted ? (
                <button
                  type="button"
                  onClick={() => void handleLookup(undefined, lookupResult.gstin, true)}
                  disabled={lookingUp}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#F57C00] hover:underline cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${lookingUp ? 'animate-spin' : ''}`} />
                  Refresh Live from GSTN (1 Credit)
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Lookup Error */}
          {lookupError ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{lookupError}</span>
            </div>
          ) : null}

          {/* Duplicate GSTIN Notice */}
          {existingCustomer ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              <div className="min-w-0">
                <span className="font-semibold">Already in Customers:</span>{' '}
                {existingCustomer.companyName || existingCustomer.name} (
                <span className="font-mono">{existingCustomer.gstin}</span>)
                {existingCustomer.archived ? ' — currently archived' : ''}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => navigate(`/customers/${existingCustomer.id}`)}
                className="h-7 text-xs bg-white dark:bg-zinc-900"
              >
                <ExternalLink className="h-3 w-3" />
                View Ledger
              </Button>
            </div>
          ) : null}

          {/* Recent Verified Lookups */}
          {recentLookups.length > 0 && !lookupResult ? (
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
              <div className="text-[11px] font-medium text-zinc-500">
                Recent Verified GST Lookups (Instant · 0 Credits)
              </div>
              <div className="flex flex-wrap gap-2">
                {recentLookups.slice(0, 6).map((item) => (
                  <button
                    key={item.gstin}
                    type="button"
                    onClick={() => void handleLookup(undefined, item.gstin, false)}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-left text-xs hover:border-[#F57C00] hover:bg-orange-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-[#F57C00] transition-colors cursor-pointer"
                  >
                    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                      {item.gstin}
                    </span>
                    <span className="text-zinc-500 truncate max-w-[180px]">
                      {item.data.trade_name || item.data.legal_name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Fetched GST Profile + Add Customer Form */}
      {lookupResult ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Verified GSTN Registration Card */}
          <Card className="lg:col-span-5">
            <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-mono text-zinc-500 uppercase">
                    Verified GSTIN Profile
                  </div>
                  <CardTitle className="mt-1 text-base leading-snug break-words">
                    {lookupResult.data.trade_name || lookupResult.data.legal_name || lookupResult.gstin}
                  </CardTitle>
                  {lookupResult.data.legal_name &&
                  lookupResult.data.trade_name &&
                  lookupResult.data.legal_name !== lookupResult.data.trade_name ? (
                    <div className="mt-0.5 text-xs text-zinc-500 break-words">
                      Legal: {lookupResult.data.legal_name}
                    </div>
                  ) : null}
                </div>

                {gstStatus ? (
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
                      isGstActive
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-400'
                        : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400'
                    }`}
                  >
                    {gstStatus}
                  </span>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="pt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-zinc-500">GSTIN</div>
                  <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {lookupResult.gstin}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">Taxpayer Type</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {lookupResult.data.taxpayer_type || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">Constitution</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {lookupResult.data.business_constitution || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">Registration Date</div>
                  <div className="font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {lookupResult.data.registration_date || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">E-Invoice Enabled</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {lookupResult.data.einvoice_status || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500">E-Way Bill Block</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {lookupResult.data.block_status || '—'}
                  </div>
                </div>
              </div>

              {lookupResult.data.cancellation_date ? (
                <div className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  Cancelled on <span className="font-mono font-semibold">{lookupResult.data.cancellation_date}</span>
                </div>
              ) : null}

              <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>Principal Place of Business</span>
                </div>
                <div className="text-zinc-800 dark:text-zinc-200 leading-relaxed">
                  {formatAddressFromLookup(lookupResult.data) || 'No address returned'}
                </div>
                {lookupResult.data.state_jurisdiction ? (
                  <div className="mt-1.5 text-[11px] text-zinc-500">
                    Jurisdiction: {lookupResult.data.state_jurisdiction}
                  </div>
                ) : null}
              </div>

              {lookupResult.data.nature_of_business && lookupResult.data.nature_of_business.length > 0 ? (
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <div className="flex items-center gap-1.5 text-zinc-500 mb-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>Nature of Business</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {lookupResult.data.nature_of_business.map((nat, idx) => (
                      <span
                        key={idx}
                        className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                      >
                        {nat}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Right: Pre-filled Customer Save Form */}
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4 text-[#F57C00]" />
                {existingCustomer ? 'Update Customer Details' : 'Review & Add as Customer'}
              </CardTitle>
              <CardDescription>
                All details are pre-filled from GSTN. Add optional email or phone and save to your customer directory.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {createdCustomer ? (
                <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {createdCustomer.companyName || createdCustomer.name} saved to Customers
                      </div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        GSTIN <span className="font-mono font-semibold">{createdCustomer.gstin}</span> ·{' '}
                        {createdCustomer.state}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" onClick={() => navigate('/invoices/new')}>
                      <FilePlus2 className="h-4 w-4" />
                      Create Invoice
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/customers/${createdCustomer.id}`)}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open Customer Ledger
                    </Button>
                    <Button size="sm" variant="ghost" onClick={resetForNext}>
                      Add Another GST Customer
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCreateOrUpdateCustomer} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Company / Trade Name</Label>
                      <Input
                        value={form.companyName}
                        onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                        placeholder="Business trade / legal name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Contact / Legal Name *</Label>
                      <Input
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Primary contact or legal name"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>GSTIN</Label>
                      <Input
                        value={form.gstin}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          const derived = getStateFromGstin(val);
                          setForm({
                            ...form,
                            gstin: val,
                            state: derived || form.state,
                          });
                        }}
                        className="font-mono uppercase"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>State (Place of Supply)</Label>
                      <Select
                        value={form.state}
                        onChange={(e) => setForm({ ...form, state: e.target.value })}
                      >
                        {INDIAN_STATES.map((s) => (
                          <option key={s.code} value={s.name}>
                            {s.code} - {s.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Email (Optional)</Label>
                      <Input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder="billing@company.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Phone (Optional)</Label>
                      <Input
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="+91 98765 43210"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>Billing Address</Label>
                    <Textarea
                      rows={3}
                      value={form.billingAddress}
                      onChange={(e) => setForm({ ...form, billingAddress: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sameShippingAddress}
                        onChange={(e) => setSameShippingAddress(e.target.checked)}
                        className="h-4 w-4 rounded accent-[#F57C00]"
                      />
                      Shipping address same as billing address
                    </label>
                    {!sameShippingAddress ? (
                      <div className="space-y-1">
                        <Label>Shipping Address</Label>
                        <Textarea
                          rows={2}
                          value={form.shippingAddress}
                          onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })}
                          placeholder="Enter separate shipping address"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <Label>Notes</Label>
                    <Input
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={resetForNext}>
                      Clear
                    </Button>
                    <Button type="submit" disabled={saving}>
                      <UserPlus className="h-4 w-4" />
                      {saving
                        ? 'Saving...'
                        : existingCustomer
                          ? 'Update Existing Customer'
                          : 'Add as Customer'}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export function GstCustomerPage({ navigate }: { navigate: (path: string) => void }) {
  return <GstCustomerLookupView navigate={navigate} />;
}
