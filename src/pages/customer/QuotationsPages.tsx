import * as React from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Edit2,
  Eye,
  FileCheck2,
  Plus,
  Printer,
  Search,
  Share2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { businessApi, cachedRead, customersApi, quotationsApi } from '../../lib/api';
import { generateDocumentPdf } from '../../lib/pdfGenerator';
import { exportToExcel, formatDate } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { Customer, Quotation, TemplateId } from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { DocumentPreviewSheet } from '../../components/DocumentPreviewSheet';
import { QuotationThemeSelector } from '../../components/quotation/QuotationThemeSelector';
import { normalizeQuotationTemplateId } from '../../components/quotation/quotationThemeRegistry';
import type { QuotationTemplateId } from '../../components/quotation/quotationThemeTypes';
import { QuotationStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input, Select } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function QuotationsListPage({ navigate }: { navigate: (path: string) => void }) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const initialHydrated = React.useMemo(() => {
    if (!tenantUid) return null;
    const hasQuo = cachedRead.hasTenantCollectionData(tenantUid, 'quotations');
    const hasCust = cachedRead.hasTenantCollectionData(tenantUid, 'customers');
    if (!hasQuo && !hasCust) return null;
    const e = cachedRead.getTenantEntry(tenantUid);
    return {
      quotations: e.quotations,
      customers: e.customers.filter((c) => !c.archived),
      complete: hasQuo && hasCust,
    };
  }, [tenantUid]);

  const [allQuotations, setAllQuotations] = React.useState<Quotation[]>(
    () => initialHydrated?.quotations || []
  );
  const [customers, setCustomers] = React.useState<Customer[]>(
    () => initialHydrated?.customers || []
  );
  const [loading, setLoading] = React.useState(() => !initialHydrated?.complete);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [customerId, setCustomerId] = React.useState('all');

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [qRes, cRes] = await Promise.all([
        quotationsApi.list(),
        customersApi.list(),
      ]);
      setAllQuotations(qRes.quotations);
      setCustomers(cRes.customers);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load quotations');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    if (initialHydrated) {
      setAllQuotations(initialHydrated.quotations);
      setCustomers(initialHydrated.customers);
      setLoading(!initialHydrated.complete);
    }
    void load(Boolean(initialHydrated?.complete));
  }, [initialHydrated, load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('quotations') || changed.has('customers')) {
        const entry = cachedRead.getTenantEntry(tenantUid);
        if (changed.has('quotations')) setAllQuotations(entry.quotations);
        if (changed.has('customers')) setCustomers(entry.customers.filter((c) => !c.archived));
      }
    });
  }, [tenantUid]);

  const quotations = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allQuotations.filter((item) => {
      if (status && status !== 'all' && item.status !== status) return false;
      if (customerId && customerId !== 'all' && item.customerId !== customerId) return false;
      if (q) {
        const hay = [
          item.quotationNumber,
          item.customerSnapshot.name,
          item.customerSnapshot.companyName,
          item.referenceNumber,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allQuotations, search, status, customerId]);

  const handleConvert = async (q: Quotation) => {
    try {
      const res = await quotationsApi.convertToInvoice(q.id);
      notify('success', `Converted ${q.quotationNumber} into ${res.invoice.invoiceNumber}`);
      navigate(`/invoices/${res.invoice.id}`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Conversion failed');
    }
  };

  const handleStatus = async (q: Quotation, next: 'accepted' | 'rejected') => {
    try {
      await quotationsApi.setStatus(q.id, next);
      notify('success', `Marked ${q.quotationNumber} as ${next}`);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Status update failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 flex-1">
          <div className="relative col-span-2 sm:w-64">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search quotation #, customer..."
              className="pl-9"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-40">
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
            <option value="converted">Converted</option>
          </Select>
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full sm:w-48">
            <option value="all">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName || c.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() =>
              exportToExcel(
                `drona-quotations-${new Date().toISOString().slice(0, 10)}`,
                'Quotations',
                quotations.map((q) => ({
                  'Quotation #': q.quotationNumber,
                  Customer: q.customerSnapshot.companyName || q.customerSnapshot.name,
                  Date: q.quotationDate,
                  'Valid Until': q.validUntil,
                  Status: q.status,
                  Amount: q.grandTotal,
                }))
              )
            }
          >
            Export Excel
          </Button>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => navigate('/quotations/new')}>
            <Plus className="h-4 w-4" />
            Create Quotation
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500">Loading quotations...</div>
          ) : quotations.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileCheck2}
                title="No quotations found"
                description="Create professional price quotations and convert approved quotes directly into GST invoices."
                actionLabel="Create Quotation"
                onAction={() => navigate('/quotations/new')}
              />
            </div>
          ) : (
            <>
              {/* Mobile Quotation Cards */}
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {quotations.map((q) => (
                  <div key={q.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => navigate(`/quotations/${q.id}`)}
                            className="font-mono text-sm font-semibold text-zinc-900 hover:text-[#F57C00] dark:text-zinc-100 cursor-pointer"
                          >
                            {q.quotationNumber}
                          </button>
                          <QuotationStatusLabel status={q.status} />
                        </div>
                        <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200 mt-0.5">
                          {q.customerSnapshot.companyName || q.customerSnapshot.name}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          Date {formatDate(q.quotationDate)} · Valid {formatDate(q.validUntil)}
                        </div>
                      </div>
                      <div className="font-mono text-sm font-bold tabular-nums shrink-0">
                        {formatINR(q.grandTotal)}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => navigate(`/quotations/${q.id}`)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                      {q.status === 'draft' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/quotations/${q.id}/edit`)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      ) : null}
                      {(q.status === 'draft' || q.status === 'sent' || q.status === 'accepted') &&
                      !q.convertedInvoiceId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleConvert(q)}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5 text-[#F57C00]" />
                          Invoice
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => generateDocumentPdf('quotation', q)}
                        aria-label="Download PDF"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quotation #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Valid Until</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotations.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => navigate(`/quotations/${q.id}`)}
                            className="font-mono font-semibold text-zinc-900 hover:text-[#F57C00] dark:text-zinc-100 cursor-pointer"
                          >
                            {q.quotationNumber}
                          </button>
                        </TableCell>
                        <TableCell>
                          {q.customerSnapshot.companyName || q.customerSnapshot.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-zinc-500">
                          {formatDate(q.quotationDate)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-zinc-500">
                          {formatDate(q.validUntil)}
                        </TableCell>
                        <TableCell>
                          <QuotationStatusLabel status={q.status} />
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-semibold">
                          {formatINR(q.grandTotal)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/quotations/${q.id}`)}
                              title="View"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {q.status === 'draft' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => navigate(`/quotations/${q.id}/edit`)}
                                title="Edit Draft"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                            {q.status === 'sent' ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleStatus(q, 'accepted')}
                                  title="Mark Accepted"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleStatus(q, 'rejected')}
                                  title="Mark Rejected"
                                >
                                  <XCircle className="h-3.5 w-3.5 text-red-600" />
                                </Button>
                              </>
                            ) : null}
                            {(q.status === 'draft' || q.status === 'sent' || q.status === 'accepted') &&
                            !q.convertedInvoiceId ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleConvert(q)}
                                title="Convert to Invoice"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5 text-[#F57C00]" />
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => generateDocumentPdf('quotation', q)}
                              title="Download PDF"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function QuotationDetailsPage({
  quotationId,
  navigate,
}: {
  quotationId: string;
  navigate: (path: string) => void;
}) {
  const { session, updateLocalBusinessProfile } = useAuth();
  const profile = session?.businessProfile;
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const initialDetail = React.useMemo(() => {
    if (!tenantUid || !cachedRead.hasTenantCollectionData(tenantUid, 'quotations')) return null;
    return cachedRead.getTenantEntry(tenantUid).quotations.find((q) => q.id === quotationId) || null;
  }, [tenantUid, quotationId]);

  const [quotation, setQuotation] = React.useState<Quotation | null>(initialDetail);
  const [selectedThemeId, setSelectedThemeId] = React.useState<QuotationTemplateId>(() =>
    normalizeQuotationTemplateId(initialDetail?.templateId || profile?.defaultQuotationTemplate)
  );
  const [settingDefaultTheme, setSettingDefaultTheme] = React.useState(false);

  React.useEffect(() => {
    if (quotation?.templateId) {
      setSelectedThemeId(normalizeQuotationTemplateId(quotation.templateId));
    } else if (profile?.defaultQuotationTemplate) {
      setSelectedThemeId(normalizeQuotationTemplateId(profile.defaultQuotationTemplate));
    }
  }, [quotation?.templateId, profile?.defaultQuotationTemplate]);

  const handleSetDefaultTheme = async (themeId: QuotationTemplateId) => {
    try {
      setSettingDefaultTheme(true);
      const res = await businessApi.updateProfile({ defaultQuotationTemplate: themeId });
      updateLocalBusinessProfile(res.profile);
      setSelectedThemeId(themeId);
      notify(
        'success',
        'Quotation theme set as default for all new quotations.'
      );
    } catch (err) {
      notify('error', 'Failed to update default quotation theme');
    } finally {
      setSettingDefaultTheme(false);
    }
  };

  const [loading, setLoading] = React.useState(() => !initialDetail);
  const [converting, setConverting] = React.useState(false);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await quotationsApi.get(quotationId);
      setQuotation(res.quotation);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load quotation');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [quotationId, notify]);

  React.useEffect(() => {
    if (initialDetail) {
      setQuotation(initialDetail);
      setLoading(false);
    }
    void load(Boolean(initialDetail));
  }, [initialDetail, load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('quotations')) {
        void load(true);
      }
    });
  }, [tenantUid, load]);

  if (loading) return <div className="p-8 text-sm text-zinc-500">Loading quotation...</div>;
  if (!quotation) {
    return (
      <EmptyState
        title="Quotation not found"
        description="This quotation could not be found in your workspace."
        actionLabel="Back to Quotations"
        onAction={() => navigate('/quotations')}
      />
    );
  }

  const handleConvert = async () => {
    setConverting(true);
    try {
      const res = await quotationsApi.convertToInvoice(quotation.id);
      notify('success', `Converted to invoice ${res.invoice.invoiceNumber}`);
      navigate(`/invoices/${res.invoice.id}`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const handleStatus = async (status: 'sent' | 'accepted' | 'rejected') => {
    try {
      await quotationsApi.setStatus(quotation.id, status);
      notify('success', `Quotation marked as ${status}`);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/quotations')}>
            <ArrowLeft className="h-4 w-4" />
            Quotations
          </Button>
          <QuotationStatusLabel status={quotation.status} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quotation.status === 'draft' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/quotations/${quotation.id}/edit`)}
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit Draft
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleStatus('sent')}>
                Mark Sent
              </Button>
            </>
          ) : null}

          {quotation.status === 'sent' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => handleStatus('accepted')}>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Mark Accepted
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleStatus('rejected')}>
                <XCircle className="h-3.5 w-3.5 text-red-600" />
                Mark Rejected
              </Button>
            </>
          ) : null}

          {quotation.convertedInvoiceId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/invoices/${quotation.convertedInvoiceId}`)}
            >
              View Linked Invoice
            </Button>
          ) : quotation.status !== 'rejected' && quotation.status !== 'expired' ? (
            <Button size="sm" disabled={converting} onClick={handleConvert}>
              <ArrowRightLeft className="h-3.5 w-3.5" />
              {converting ? 'Converting...' : 'Convert to Invoice'}
            </Button>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            onClick={() => generateDocumentPdf('quotation', quotation, selectedThemeId)}
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const summary = `*Quotation ${quotation.quotationNumber}*\nFrom: ${quotation.businessSnapshot.businessName}\nTotal: ${formatINR(quotation.grandTotal)}\nValid Until: ${formatDate(quotation.validUntil)}`;
              await navigator.clipboard.writeText(summary);
              notify('success', 'Quotation summary copied & opening WhatsApp...');
              const rawPhone = (quotation.customerSnapshot.phone || '').replace(/[^0-9]/g, '');
              const waUrl = rawPhone
                ? `https://wa.me/${rawPhone.length === 10 ? '91' + rawPhone : rawPhone}?text=${encodeURIComponent(summary)}`
                : `https://wa.me/?text=${encodeURIComponent(summary)}`;
              window.open(waUrl, '_blank', 'noopener,noreferrer');
            }}
            className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
          >
            <Share2 className="h-3.5 w-3.5 mr-1" />
            Share WhatsApp
          </Button>
        </div>
      </div>

      {/* Theme Selector for Quotation View */}
      <div
        className={`no-print mx-auto p-3 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 shadow-sm ${
          selectedThemeId === 'landscape_pro' ? 'max-w-[1123px]' : 'max-w-[820px]'
        }`}
      >
        <QuotationThemeSelector
          currentThemeId={selectedThemeId}
          defaultThemeId={profile?.defaultQuotationTemplate}
          onSelectTheme={(t) => setSelectedThemeId(t)}
          onSetAsDefault={handleSetDefaultTheme}
          isSettingDefault={settingDefaultTheme}
        />
      </div>

      <DocumentPreviewSheet docType="quotation" record={quotation} templateOverride={selectedThemeId} />
    </div>
  );
}
