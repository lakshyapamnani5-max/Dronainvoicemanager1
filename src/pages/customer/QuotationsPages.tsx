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
import { customersApi, quotationsApi, subscribeRtdbPath } from '../../lib/api';
import { generateDocumentPdf } from '../../lib/pdfGenerator';
import { exportToExcel, formatDate } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { Customer, Quotation } from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { DocumentPreviewSheet } from '../../components/DocumentPreviewSheet';
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
  const [quotations, setQuotations] = React.useState<Quotation[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [customerId, setCustomerId] = React.useState('all');

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [qRes, cRes] = await Promise.all([
        quotationsApi.list({ search, status, customerId }),
        customersApi.list(),
      ]);
      setQuotations(qRes.quotations);
      setCustomers(cRes.customers);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load quotations');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, status, customerId, notify]);

  React.useEffect(() => {
    const t = setTimeout(() => load(false), 180);
    return () => clearTimeout(t);
  }, [load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(true), 250);
    };
    const u1 = subscribeRtdbPath(`tenants/${tenantUid}/quotations`, schedule);
    const u2 = subscribeRtdbPath(`tenants/${tenantUid}/customers`, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
    };
  }, [tenantUid, load]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search quotation #, customer..."
              className="pl-9"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
            <option value="converted">Converted</option>
          </Select>
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-48">
            <option value="all">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName || c.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
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
          <Button size="sm" onClick={() => navigate('/quotations/new')}>
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
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const [quotation, setQuotation] = React.useState<Quotation | null>(null);
  const [loading, setLoading] = React.useState(true);
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
    load(false);
  }, [load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeRtdbPath(`tenants/${tenantUid}/quotations/${quotationId}`, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(true), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [tenantUid, quotationId, load]);

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
            onClick={() => generateDocumentPdf('quotation', quotation)}
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
              await navigator.clipboard.writeText(
                `Quotation ${quotation.quotationNumber} | Total: ${formatINR(quotation.grandTotal)} | Valid Until: ${formatDate(quotation.validUntil)}`
              );
              notify('success', 'Quotation summary copied');
            }}
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>
        </div>
      </div>

      <DocumentPreviewSheet docType="quotation" record={quotation} />
    </div>
  );
}
