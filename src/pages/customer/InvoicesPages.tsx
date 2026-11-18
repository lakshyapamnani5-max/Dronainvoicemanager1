import * as React from 'react';
import {
  AlertTriangle,
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
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { businessApi, cachedRead, customersApi, invoicesApi, paymentsApi } from '../../lib/api';
import { generateDocumentPdf, generatePaymentReceiptPdf } from '../../lib/pdfGenerator';
import { exportToExcel, formatDate, formatDateTime } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { Customer, Invoice, Payment, PaymentMethod, TemplateId } from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { DocumentPreviewSheet } from '../../components/DocumentPreviewSheet';
import { InvoiceThemeSelector } from '../../components/invoice/InvoiceThemeSelector';
import type { StandardTemplateId } from '../../components/invoice/invoiceThemeTypes';
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
  const initialHydrated = React.useMemo(() => {
    if (!tenantUid) return null;
    const hasInv = cachedRead.hasTenantCollectionData(tenantUid, 'invoices');
    const hasCust = cachedRead.hasTenantCollectionData(tenantUid, 'customers');
    if (!hasInv && !hasCust) return null;
    const e = cachedRead.getTenantEntry(tenantUid);
    return {
      invoices: e.invoices,
      customers: e.customers.filter((c) => !c.archived),
      complete: hasInv && hasCust,
    };
  }, [tenantUid]);

  const [allInvoices, setAllInvoices] = React.useState<Invoice[]>(
    () => initialHydrated?.invoices || []
  );
  const [customers, setCustomers] = React.useState<Customer[]>(
    () => initialHydrated?.customers || []
  );
  const [loading, setLoading] = React.useState(() => !initialHydrated?.complete);

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
  const [deletingInvoiceId, setDeletingInvoiceId] = React.useState<string | null>(null);
  const [deletingListInv, setDeletingListInv] = React.useState(false);

  const handleDeleteListInvoice = async () => {
    if (!deletingInvoiceId) return;
    setDeletingListInv(true);
    try {
      await invoicesApi.delete(deletingInvoiceId);
      notify('success', 'Invoice deleted');
      setDeletingInvoiceId(null);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete invoice');
    } finally {
      setDeletingListInv(false);
    }
  };

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [invRes, custRes] = await Promise.all([
        invoicesApi.list(),
        customersApi.list(),
      ]);
      setAllInvoices(invRes.invoices);
      setCustomers(custRes.customers);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    if (initialHydrated) {
      setAllInvoices(initialHydrated.invoices);
      setCustomers(initialHydrated.customers);
      setLoading(!initialHydrated.complete);
    }
    // Load locally first; only query Firebase if local cache is incomplete or missing
    if (!initialHydrated?.complete) {
      void load(false);
    }
  }, [initialHydrated, load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('invoices') || changed.has('customers')) {
        const entry = cachedRead.getTenantEntry(tenantUid);
        if (changed.has('invoices')) setAllInvoices(entry.invoices);
        if (changed.has('customers')) setCustomers(entry.customers.filter((c) => !c.archived));
      }
    });
  }, [tenantUid]);

  const invoices = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return allInvoices.filter((inv) => {
      if (status && status !== 'all') {
        if (status === 'advance' || status === 'advances' || status === 'advance_paid') {
          if (!(inv.status === 'partially_paid' || (inv.amountPaid > 0 && inv.balanceDue > 0))) return false;
        } else if (inv.status !== status) {
          return false;
        }
      }
      if (customerId && customerId !== 'all' && inv.customerId !== customerId) return false;
      if (startDate && inv.invoiceDate < startDate) return false;
      if (endDate && inv.invoiceDate > endDate) return false;
      if (q) {
        const hay = [
          inv.invoiceNumber,
          inv.customerSnapshot.name,
          inv.customerSnapshot.companyName,
          inv.customerSnapshot.gstin,
          inv.referenceNumber,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allInvoices, search, status, customerId, startDate, endDate]);

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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 flex-1">
          <div className="relative col-span-2 sm:w-64">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
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
            className="w-full sm:w-44"
          >
            <option value="all">All Statuses</option>
            <option value="advance">Advance Paid (Partially Paid)</option>
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
            className="w-full sm:w-48"
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
            className="w-full sm:w-36"
            aria-label="Start date"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full sm:w-36"
            aria-label="End date"
          />
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={handleExportExcel}>
            Export Excel
          </Button>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => navigate('/invoices/new')}>
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
              {/* Mobile Invoice Cards - continuous scroll, no pagination breaks */}
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {invoices.map((inv) => (
                  <div key={inv.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => navigate(`/invoices/${inv.id}`)}
                            className="font-mono text-sm font-semibold text-zinc-900 hover:text-[#F57C00] dark:text-zinc-100 cursor-pointer"
                          >
                            {inv.invoiceNumber}
                          </button>
                          <InvoiceStatusLabel status={inv.status} />
                        </div>
                        <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200 mt-0.5">
                          {inv.customerSnapshot.companyName || inv.customerSnapshot.name}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          Issued {formatDate(inv.invoiceDate)} · Due {formatDate(inv.dueDate)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-bold tabular-nums">
                          {formatINR(inv.grandTotal)}
                        </div>
                        {inv.balanceDue > 0 ? (
                          <>
                            <div className="font-mono text-xs font-semibold text-[#F57C00] tabular-nums">
                              Due {formatINR(inv.balanceDue)}
                            </div>
                            {inv.amountPaid > 0 ? (
                              <div className="font-mono text-[11px] text-emerald-600 font-medium tabular-nums">
                                Adv. Paid {formatINR(inv.amountPaid)}
                              </div>
                            ) : null}
                          </>
                        ) : inv.amountPaid > inv.grandTotal ? (
                          <div className="font-mono text-[11px] text-amber-600 tabular-nums">
                            Overpaid +{formatINR(inv.amountPaid - inv.grandTotal)}
                          </div>
                        ) : (
                          <div className="font-mono text-[11px] text-emerald-600 tabular-nums">
                            Paid {formatINR(inv.amountPaid)}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                      {inv.status !== 'cancelled' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/invoices/${inv.id}/edit`)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      ) : null}
                      {inv.balanceDue > 0 &&
                      inv.status !== 'draft' &&
                      inv.status !== 'cancelled' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenPayment(inv)}
                        >
                          <CreditCard className="h-3.5 w-3.5 text-[#F57C00]" />
                          Pay
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => generateDocumentPdf('invoice', inv, inv.templateId || profile?.defaultInvoiceTemplate)}
                        aria-label="Download PDF"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeletingInvoiceId(inv.id)}
                        aria-label="Delete Invoice"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
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
                          {inv.status !== 'cancelled' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/invoices/${inv.id}/edit`)}
                              title={inv.status === 'draft' ? 'Edit Draft' : 'Edit Invoice'}
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
                            onClick={() => generateDocumentPdf('invoice', inv, inv.templateId || profile?.defaultInvoiceTemplate)}
                            title="Download PDF"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => setDeletingInvoiceId(inv.id)}
                            title="Delete Invoice"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>

              {totalPages > 1 ? (
                <div className="hidden md:flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>
          {payInvoice && payForm.amount > payInvoice.balanceDue ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              Exceeds remaining balance ({formatINR(payInvoice.balanceDue)}) by{' '}
              <span className="font-mono font-semibold">
                {formatINR(payForm.amount - payInvoice.balanceDue)}
              </span>
              . Excess will be saved as advance / overpayment.
            </div>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      <Dialog
        open={Boolean(deletingInvoiceId)}
        onClose={() => setDeletingInvoiceId(null)}
        title="Delete Invoice?"
        description="This action will permanently delete this invoice and associated payments. This cannot be undone."
      >
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeletingInvoiceId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingListInv}
              onClick={handleDeleteListInvoice}
            >
              {deletingListInv ? 'Deleting...' : 'Delete Invoice'}
            </Button>
          </div>
        </div>
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
  const { session, updateLocalBusinessProfile } = useAuth();
  const profile = session?.businessProfile;
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const initialDetail = React.useMemo(() => {
    if (!tenantUid || !cachedRead.hasTenantCollectionData(tenantUid, 'invoices')) return null;
    const entry = cachedRead.getTenantEntry(tenantUid);
    const found = entry.invoices.find((i) => i.id === invoiceId);
    if (!found) return null;
    const pays = entry.payments
      .filter((p) => p.invoiceId === invoiceId)
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
    return { ...found, payments: pays };
  }, [tenantUid, invoiceId]);

  const [invoice, setInvoice] = React.useState<Invoice | null>(initialDetail);
  const [selectedThemeId, setSelectedThemeId] = React.useState<TemplateId>(
    () => initialDetail?.templateId || profile?.defaultInvoiceTemplate || 'gst_theme_1'
  );
  const [settingDefaultTheme, setSettingDefaultTheme] = React.useState(false);
  const [deleteInvoiceOpen, setDeleteInvoiceOpen] = React.useState(false);
  const [deletingInvoice, setDeletingInvoice] = React.useState(false);

  const handleDeleteInvoice = async () => {
    if (!invoice) return;
    setDeletingInvoice(true);
    try {
      await invoicesApi.delete(invoice.id);
      notify('success', `Deleted invoice ${invoice.invoiceNumber}`);
      navigate('/invoices');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete invoice');
      setDeletingInvoice(false);
    }
  };

  React.useEffect(() => {
    if (invoice?.templateId) {
      setSelectedThemeId(invoice.templateId);
    } else if (profile?.defaultInvoiceTemplate) {
      setSelectedThemeId(profile.defaultInvoiceTemplate);
    }
  }, [invoice?.templateId, profile?.defaultInvoiceTemplate]);

  const handleSetDefaultTheme = async (themeId: StandardTemplateId) => {
    try {
      setSettingDefaultTheme(true);
      const res = await businessApi.updateProfile({ defaultInvoiceTemplate: themeId });
      updateLocalBusinessProfile(res.profile);
      setSelectedThemeId(themeId);
      notify('success', `Theme set as default. All existing and new invoices will show on this theme.`);
    } catch (err) {
      notify('error', 'Failed to update default theme');
    } finally {
      setSettingDefaultTheme(false);
    }
  };

  const [auditLogs, setAuditLogs] = React.useState<
    Array<{ id: string; actorEmail: string; action: string; summary: string; createdAt: string }>
  >([]);
  const [loading, setLoading] = React.useState(() => !initialDetail);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const [payOpen, setPayOpen] = React.useState(false);
  const [payForm, setPayForm] = React.useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: initialDetail?.balanceDue || 0,
    paymentMethod: 'UPI' as PaymentMethod,
    referenceId: '',
    notes: '',
  });

  const [editingPayment, setEditingPayment] = React.useState<Payment | null>(null);
  const [editPayForm, setEditPayForm] = React.useState({
    paymentDate: '',
    amount: 0,
    paymentMethod: 'UPI' as PaymentMethod,
    referenceId: '',
    notes: '',
  });
  const [savingPayEdit, setSavingPayEdit] = React.useState(false);
  const [deletingPayment, setDeletingPayment] = React.useState<Payment | null>(null);
  const [deletingPay, setDeletingPay] = React.useState(false);

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
    if (initialDetail) {
      setInvoice(initialDetail);
      setLoading(false);
    }
    // Load locally first; only query Firebase if invoice is not in local cache
    if (!initialDetail) {
      void load(false);
    }
  }, [initialDetail, load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('invoices') || changed.has('payments') || changed.has('activityLogs')) {
        const entry = cachedRead.getTenantEntry(tenantUid);
        const found = entry.invoices.find((i) => i.id === invoiceId);
        if (found) {
          const pays = entry.payments
            .filter((p) => p.invoiceId === invoiceId)
            .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
          setInvoice({ ...found, payments: pays });
        } else {
          void load(true);
        }
      }
    });
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

  const openEditPayment = (p: Payment) => {
    setEditingPayment(p);
    setEditPayForm({
      paymentDate: p.paymentDate,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      referenceId: p.referenceId || '',
      notes: p.notes || '',
    });
  };

  const handleUpdatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayment) return;
    setSavingPayEdit(true);
    try {
      await paymentsApi.update(editingPayment.id, editPayForm);
      notify('success', `Payment ${editingPayment.receiptNumber} updated`);
      setEditingPayment(null);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update payment');
    } finally {
      setSavingPayEdit(false);
    }
  };

  const handleDeletePayment = async () => {
    if (!deletingPayment) return;
    setDeletingPay(true);
    try {
      await paymentsApi.remove(deletingPayment.id);
      notify('success', `Payment ${deletingPayment.receiptNumber} deleted`);
      setDeletingPayment(null);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete payment');
    } finally {
      setDeletingPay(false);
    }
  };

  const handleShare = async () => {
    const summary = `*Tax Invoice ${invoice.invoiceNumber}*\nFrom: ${invoice.businessSnapshot.businessName}\nAmount: ${formatINR(invoice.grandTotal)}\nBalance Due: ${formatINR(invoice.balanceDue)}\nDue Date: ${formatDate(invoice.dueDate)}`;
    try {
      await navigator.clipboard.writeText(summary);
      notify('success', 'Invoice details copied & opening WhatsApp...');
      const rawPhone = (invoice.customerSnapshot.phone || '').replace(/[^0-9]/g, '');
      const waUrl = rawPhone
        ? `https://wa.me/${rawPhone.length === 10 ? '91' + rawPhone : rawPhone}?text=${encodeURIComponent(summary)}`
        : `https://wa.me/?text=${encodeURIComponent(summary)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
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
          {invoice.status !== 'cancelled' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
            >
              <Edit2 className="h-3.5 w-3.5" />
              {invoice.status === 'draft' ? 'Edit Draft' : 'Edit Invoice'}
            </Button>
          ) : null}
          {invoice.status === 'draft' ? (
            <Button size="sm" onClick={handleFinalize}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Finalize &amp; Issue
            </Button>
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
            onClick={() => generateDocumentPdf('invoice', invoice, selectedThemeId)}
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
            onClick={handleShare}
            className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
          >
            <Share2 className="h-3.5 w-3.5 mr-1" />
            Share WhatsApp
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

          <Button
            variant="outline"
            size="sm"
            className="text-red-600 hover:text-red-700 border-red-200 dark:border-red-900"
            onClick={() => setDeleteInvoiceOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {invoice.status === 'cancelled' && invoice.cancellationReason ? (
        <div className="no-print rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          Cancelled on {formatDateTime(invoice.cancelledAt)} — Reason: {invoice.cancellationReason}
        </div>
      ) : null}

      {invoice.amountPaid > invoice.grandTotal ? (
        <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Excess / Overpayment Recorded:</span> Total payments received (
              <span className="font-mono font-semibold">{formatINR(invoice.amountPaid)}</span>) exceed the invoice grand total (
              <span className="font-mono font-semibold">{formatINR(invoice.grandTotal)}</span>) by{' '}
              <span className="font-mono font-semibold">
                {formatINR(invoice.amountPaid - invoice.grandTotal)}
              </span>
              . You can edit or remove a recorded payment below or update the invoice items.
            </div>
          </div>
        </div>
      ) : null}

      {/* Theme Selector for Invoice View */}
      <div className="no-print max-w-[820px] mx-auto p-3 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 shadow-sm">
        <InvoiceThemeSelector
          currentThemeId={selectedThemeId}
          defaultThemeId={profile?.defaultInvoiceTemplate || 'gst_theme_1'}
          onSelectTheme={(t) => setSelectedThemeId(t)}
          onSetAsDefault={handleSetDefaultTheme}
          isSettingDefault={settingDefaultTheme}
        />
      </div>

      <DocumentPreviewSheet docType="invoice" record={invoice} templateOverride={selectedThemeId} />

      {/* Payments & Audit Trail */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-[820px] mx-auto">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Recorded Payments ({invoice.payments?.length || 0})</CardTitle>
            {invoice.status !== 'draft' && invoice.status !== 'cancelled' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPayForm({
                    paymentDate: new Date().toISOString().slice(0, 10),
                    amount: invoice.balanceDue > 0 ? invoice.balanceDue : 0,
                    paymentMethod: 'UPI',
                    referenceId: '',
                    notes: '',
                  });
                  setPayOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {!invoice.payments || invoice.payments.length === 0 ? (
              <div className="p-5 text-xs text-zinc-500">No payments recorded yet.</div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {p.receiptNumber}
                        </span>
                        <span className="text-xs text-zinc-500">{p.paymentMethod}</span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                        {formatDate(p.paymentDate)}
                        {p.referenceId ? ` · ${p.referenceId}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-emerald-600 mr-1">
                        {formatINR(p.amount)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditPayment(p)}
                        title="Edit Payment"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          generatePaymentReceiptPdf(
                            p,
                            invoice.businessSnapshot.businessName,
                            invoice.businessSnapshot.address
                          )
                        }
                        title="Download Receipt PDF"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeletingPayment(p)}
                        title="Delete Payment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <Label>Amount (Due {formatINR(invoice.balanceDue)})</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>
          {payForm.amount > invoice.balanceDue ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              Exceeds remaining balance ({formatINR(invoice.balanceDue)}) by{' '}
              <span className="font-mono font-semibold">
                {formatINR(payForm.amount - invoice.balanceDue)}
              </span>
              . Excess will be recorded as overpayment/advance.
            </div>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Edit Recorded Payment Dialog */}
      <Dialog
        open={Boolean(editingPayment)}
        onClose={() => setEditingPayment(null)}
        title={`Edit Payment — ${editingPayment?.receiptNumber || ''}`}
        description={`Invoice ${invoice.invoiceNumber} · Grand Total ${formatINR(invoice.grandTotal)}`}
      >
        <form onSubmit={handleUpdatePayment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Date *</Label>
              <Input
                type="date"
                required
                value={editPayForm.paymentDate}
                onChange={(e) => setEditPayForm({ ...editPayForm, paymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount (INR) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                value={editPayForm.amount}
                onChange={(e) => setEditPayForm({ ...editPayForm, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Method *</Label>
              <Select
                value={editPayForm.paymentMethod}
                onChange={(e) =>
                  setEditPayForm({ ...editPayForm, paymentMethod: e.target.value as PaymentMethod })
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
                value={editPayForm.referenceId}
                onChange={(e) => setEditPayForm({ ...editPayForm, referenceId: e.target.value })}
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input
              value={editPayForm.notes}
              onChange={(e) => setEditPayForm({ ...editPayForm, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingPayment(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={savingPayEdit}>
              {savingPayEdit ? 'Saving...' : 'Save Payment Changes'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Recorded Payment Dialog */}
      <Dialog
        open={Boolean(deletingPayment)}
        onClose={() => setDeletingPayment(null)}
        title={`Delete Payment ${deletingPayment?.receiptNumber || ''}`}
        description="Invoice paid amount and balance due will be recalculated automatically."
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Delete recorded payment of{' '}
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
              {deletingPayment ? formatINR(deletingPayment.amount) : ''}
            </span>
            ?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeletingPayment(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingPay}
              onClick={handleDeletePayment}
            >
              {deletingPay ? 'Deleting...' : 'Delete Payment'}
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={deleteInvoiceOpen}
        onClose={() => setDeleteInvoiceOpen(false)}
        title={`Delete Invoice ${invoice.invoiceNumber}?`}
        description="This action will permanently delete this invoice and any associated payment records. This cannot be undone."
      >
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteInvoiceOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingInvoice}
              onClick={handleDeleteInvoice}
            >
              {deletingInvoice ? 'Deleting...' : 'Delete Invoice'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
