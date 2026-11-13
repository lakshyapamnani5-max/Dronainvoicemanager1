import * as React from 'react';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  CreditCard,
  Download,
  Edit2,
  Eye,
  Plus,
  Printer,
  Receipt,
  Search,
  Share2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { customersApi, invoicesApi, paymentsApi, subscribeRtdbPath } from '../../lib/api';
import { generateDocumentPdf } from '../../lib/pdfGenerator';
import { exportToExcel, formatDate, formatDateTime } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { Customer, Invoice, PaymentMethod } from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { DocumentPreviewSheet } from '../../components/DocumentPreviewSheet';
import { InvoiceStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function InvoicesListPage({ navigate }: { navigate: (path: string) => void }) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [customerId, setCustomerId] = React.useState('all');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [page, setPage] = React.useState(1);
  const pageSize = 12;

  // Record payment modal
  const [payInvoice, setPayInvoice] = React.useState<Invoice | null>(null);
  const [payForm, setPayForm] = React.useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: 0,
    paymentMethod: 'UPI' as PaymentMethod,
    referenceId: '',
    notes: '',
  });
  const [paying, setPaying] = React.useState(false);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [invRes, custRes] = await Promise.all([
        invoicesApi.list({ search, status, customerId, startDate, endDate }),
        customersApi.list(),
      ]);
      setInvoices(invRes.invoices);
      setCustomers(custRes.customers);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, status, customerId, startDate, endDate, notify]);

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
    const u1 = subscribeRtdbPath(`tenants/${tenantUid}/invoices`, schedule);
    const u2 = subscribeRtdbPath(`tenants/${tenantUid}/customers`, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
    };
  }, [tenantUid, load]);

  const totalPages = Math.max(1, Math.ceil(invoices.length / pageSize));
  const paginated = invoices.slice((page - 1) * pageSize, page * pageSize);

  const handleOpenPayment = (inv: Invoice) => {
    setPayInvoice(inv);
    setPayForm({
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: inv.balanceDue,
      paymentMethod: 'UPI',
      referenceId: '',
      notes: '',
    });
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payInvoice) return;
    setPaying(true);
    try {
      await paymentsApi.record({
        invoiceId: payInvoice.id,
        ...payForm,
      });
      notify('success', `Payment recorded against ${payInvoice.invoiceNumber}`);
      setPayInvoice(null);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  };

  const handleExportExcel = () => {
    exportToExcel(
      `drona-invoices-${new Date().toISOString().slice(0, 10)}`,
      'Invoices',
      invoices.map((i) => ({
        'Invoice Number': i.invoiceNumber,
        Customer: i.customerSnapshot.companyName || i.customerSnapshot.name,
        'Invoice Date': i.invoiceDate,
        'Due Date': i.dueDate,
        Status: i.status,
        Taxable: i.taxableAmount,
        GST: i.totalTax,
        'Grand Total': i.grandTotal,
        'Amount Paid': i.amountPaid,
        Balance: i.balanceDue,
      }))
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search invoice #, customer..."
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-40"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="unpaid">Unpaid</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setPage(1);
            }}
            className="w-48"
          >
            <option value="all">All Customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName || c.name}
              </option>
            ))}
          </Select>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-36"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-36"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportExcel}>
            Export Excel
          </Button>
          <Button size="sm" onClick={() => navigate('/invoices/new')}>
            <Plus className="h-4 w-4" />
            Create Invoice
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500">Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Receipt}
                title="No invoices found"
                description="Create a new GST or non-GST invoice or adjust your filters."
                actionLabel="Create Invoice"
                onAction={() => navigate('/invoices/new')}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => navigate(`/invoices/${inv.id}`)}
                          className="font-mono font-semibold text-zinc-900 hover:text-[#F57C00] dark:text-zinc-100 cursor-pointer"
                        >
                          {inv.invoiceNumber}
                        </button>
                      </TableCell>
                      <TableCell>
                        {inv.customerSnapshot.companyName || inv.customerSnapshot.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">
                        {formatDate(inv.invoiceDate)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">
                        {formatDate(inv.dueDate)}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusLabel status={inv.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINR(inv.grandTotal)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-emerald-600">
                        {formatINR(inv.amountPaid)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">
                        {formatINR(inv.balanceDue)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/invoices/${inv.id}`)}
                            title="View Invoice"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {inv.status === 'draft' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/invoices/${inv.id}/edit`)}
                              title="Edit Draft"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          {inv.balanceDue > 0 &&
                          inv.status !== 'draft' &&
                          inv.status !== 'cancelled' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenPayment(inv)}
                              title="Record Payment"
                            >
                              <CreditCard className="h-3.5 w-3.5 text-[#F57C00]" />
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => generateDocumentPdf('invoice', inv)}
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

              {totalPages > 1 ? (
                <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800">
                  <span>
                    Page {page} of {totalPages} ({invoices.length} invoices)
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(payInvoice)}
        onClose={() => setPayInvoice(null)}
        title={`Record Payment — ${payInvoice?.invoiceNumber || ''}`}
        description={`Remaining balance: ${formatINR(payInvoice?.balanceDue || 0)}`}
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Date</Label>
              <Input
                type="date"
                required
                value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount (INR)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={payInvoice?.balanceDue || undefined}
                required
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Method</Label>
              <Select
                value={payForm.paymentMethod}
                onChange={(e) =>
                  setPayForm({ ...payForm, paymentMethod: e.target.value as PaymentMethod })
                }
              >
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cash">Cash</option>
                <option value="Credit/Debit Card">Credit/Debit Card</option>
                <option value="Cheque">Cheque</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Transaction / Reference ID</Label>
              <Input
                value={payForm.referenceId}
                onChange={(e) => setPayForm({ ...payForm, referenceId: e.target.value })}
                placeholder="UTR / UPI Ref"
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={payForm.notes}
              onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPayInvoice(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={paying}>
              {paying ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function InvoiceDetailsPage({
  invoiceId,
  navigate,
}: {
  invoiceId: string;
  navigate: (path: string) => void;
}) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const [invoice, setInvoice] = React.useState<Invoice | null>(null);
  const [auditLogs, setAuditLogs] = React.useState<
    Array<{ id: string; actorEmail: string; action: string; summary: string; createdAt: string }>
  >([]);
  const [loading, setLoading] = React.useState(true);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const [payOpen, setPayOpen] = React.useState(false);
  const [payForm, setPayForm] = React.useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: 0,
    paymentMethod: 'UPI' as PaymentMethod,
    referenceId: '',
    notes: '',
  });

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await invoicesApi.get(invoiceId);
      setInvoice(res.invoice);
      setAuditLogs(res.auditLogs);
      setPayForm((p) => ({ ...p, amount: res.invoice.balanceDue }));
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load invoice');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [invoiceId, notify]);

  React.useEffect(() => {
    load(false);
  }, [load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(true), 250);
    };
    const u1 = subscribeRtdbPath(`tenants/${tenantUid}/invoices/${invoiceId}`, schedule);
    const u2 = subscribeRtdbPath(`tenants/${tenantUid}/payments`, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
    };
  }, [tenantUid, invoiceId, load]);

  if (loading) return <div className="p-8 text-sm text-zinc-500">Loading invoice...</div>;
  if (!invoice) {
    return (
      <EmptyState
        title="Invoice not found"
        description="This invoice does not exist or belongs to another workspace."
        actionLabel="Back to Invoices"
        onAction={() => navigate('/invoices')}
      />
    );
  }

  const handleFinalize = async () => {
    try {
      const res = await invoicesApi.finalize(invoice.id);
      notify('success', `Finalized as ${res.invoice.invoiceNumber}`);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to finalize');
    }
  };

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoicesApi.cancel(invoice.id, cancelReason);
      notify('success', 'Invoice cancelled');
      setCancelOpen(false);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cancellation failed');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await paymentsApi.record({ invoiceId: invoice.id, ...payForm });
      notify('success', 'Payment recorded');
      setPayOpen(false);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to record payment');
    }
  };

  const handleShare = async () => {
    const summary = `Invoice ${invoice.invoiceNumber} from ${invoice.businessSnapshot.businessName} | Amount: ${formatINR(invoice.grandTotal)} | Balance Due: ${formatINR(invoice.balanceDue)} | Due: ${formatDate(invoice.dueDate)}`;
    try {
      await navigator.clipboard.writeText(summary);
      notify('success', 'Invoice summary copied to clipboard');
    } catch {
      notify('error', 'Unable to access clipboard');
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="h-4 w-4" />
            Invoices
          </Button>
          <InvoiceStatusLabel status={invoice.status} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {invoice.status === 'draft' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit Draft
              </Button>
              <Button size="sm" onClick={handleFinalize}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Finalize & Issue
              </Button>
            </>
          ) : null}

          {invoice.balanceDue > 0 &&
          invoice.status !== 'draft' &&
          invoice.status !== 'cancelled' ? (
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <CreditCard className="h-3.5 w-3.5" />
              Record Payment
            </Button>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            onClick={() => generateDocumentPdf('invoice', invoice)}
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleShare}>
            <Share2 className="h-3.5 w-3.5" />
            Share
          </Button>

          {invoice.status !== 'cancelled' && invoice.amountPaid === 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={() => setCancelOpen(true)}
            >
              <Ban className="h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {invoice.status === 'cancelled' && invoice.cancellationReason ? (
        <div className="no-print rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          Cancelled on {formatDateTime(invoice.cancelledAt)} — Reason: {invoice.cancellationReason}
        </div>
      ) : null}

      <DocumentPreviewSheet docType="invoice" record={invoice} />

      {/* Payments & Audit Trail */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-[820px] mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Recorded Payments ({invoice.payments?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!invoice.payments || invoice.payments.length === 0 ? (
              <div className="p-5 text-xs text-zinc-500">No payments recorded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.receiptNumber}</TableCell>
                      <TableCell className="font-mono text-xs">{formatDate(p.paymentDate)}</TableCell>
                      <TableCell className="text-xs">{p.paymentMethod}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold text-emerald-600">
                        {formatINR(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Immutable Audit History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {auditLogs.length === 0 ? (
              <div className="text-xs text-zinc-500">No audit entries.</div>
            ) : (
              auditLogs.map((a) => (
                <div
                  key={a.id}
                  className="border-b border-zinc-100 pb-2 last:border-0 text-xs dark:border-zinc-800"
                >
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{a.summary}</div>
                  <div className="text-zinc-500 mt-0.5">
                    {a.actorEmail} · {formatDateTime(a.createdAt)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={`Record Payment — ${invoice.invoiceNumber}`}
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                required
                value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount (Max {formatINR(invoice.balanceDue)})</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={invoice.balanceDue}
                required
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Method</Label>
              <Select
                value={payForm.paymentMethod}
                onChange={(e) =>
                  setPayForm({ ...payForm, paymentMethod: e.target.value as PaymentMethod })
                }
              >
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cash">Cash</option>
                <option value="Credit/Debit Card">Credit/Debit Card</option>
                <option value="Cheque">Cheque</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reference ID</Label>
              <Input
                value={payForm.referenceId}
                onChange={(e) => setPayForm({ ...payForm, referenceId: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input
              value={payForm.notes}
              onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Payment</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${invoice.invoiceNumber}`}
        description="Finalized invoices are never deleted; cancelling marks the document void in the audit trail."
      >
        <form onSubmit={handleCancel} className="space-y-4">
          <div className="space-y-1">
            <Label>Cancellation Reason *</Label>
            <Textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g., Scope revised, replacement invoice issued"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              Close
            </Button>
            <Button type="submit" variant="destructive">
              Confirm Cancellation
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
