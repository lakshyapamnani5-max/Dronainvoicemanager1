import * as React from 'react';
import { CreditCard, Download, Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { customersApi, invoicesApi, paymentsApi, subscribeRtdbPath } from '../../lib/api';
import { generatePaymentReceiptPdf } from '../../lib/pdfGenerator';
import { exportToExcel, formatDate } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { Customer, Invoice, Payment, PaymentMethod } from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function PaymentsPage({ navigate }: { navigate: (path: string) => void }) {
  const { session } = useAuth();
  const { notify } = useToast();
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [eligibleInvoices, setEligibleInvoices] = React.useState<Invoice[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [search, setSearch] = React.useState('');
  const [method, setMethod] = React.useState('all');
  const [customerId, setCustomerId] = React.useState('all');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');

  const [modalOpen, setModalOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState({
    invoiceId: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: 0,
    paymentMethod: 'UPI' as PaymentMethod,
    referenceId: '',
    notes: '',
  });

  const [editingPayment, setEditingPayment] = React.useState<Payment | null>(null);
  const [editForm, setEditForm] = React.useState({
    paymentDate: '',
    amount: 0,
    paymentMethod: 'UPI' as PaymentMethod,
    referenceId: '',
    notes: '',
  });
  const [updatingPayment, setUpdatingPayment] = React.useState(false);

  const [deletingPayment, setDeletingPayment] = React.useState<Payment | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const tenantUid = session?.effectiveUser.uid;
  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [payRes, custRes, invRes] = await Promise.all([
        paymentsApi.list({ search, method, customerId, startDate, endDate }),
        customersApi.list(),
        invoicesApi.list(),
      ]);
      setPayments(payRes.payments);
      setCustomers(custRes.customers);
      const issued = invRes.invoices
        .filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
        .sort((a, b) => {
          const aDue = a.balanceDue > 0 ? 1 : 0;
          const bDue = b.balanceDue > 0 ? 1 : 0;
          if (aDue !== bDue) return bDue - aDue;
          return b.invoiceDate.localeCompare(a.invoiceDate);
        });
      setEligibleInvoices(issued);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, method, customerId, startDate, endDate, notify]);

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
    const u1 = subscribeRtdbPath(`tenants/${tenantUid}/payments`, schedule);
    const u2 = subscribeRtdbPath(`tenants/${tenantUid}/invoices`, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
    };
  }, [tenantUid, load]);

  const openModal = () => {
    const first = eligibleInvoices.find((i) => i.balanceDue > 0) || eligibleInvoices[0];
    setForm({
      invoiceId: first?.id || '',
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: first?.balanceDue || first?.grandTotal || 0,
      paymentMethod: 'UPI',
      referenceId: '',
      notes: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (p: Payment) => {
    setEditingPayment(p);
    setEditForm({
      paymentDate: p.paymentDate,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      referenceId: p.referenceId || '',
      notes: p.notes || '',
    });
  };

  const selectedInvoice = eligibleInvoices.find((i) => i.id === form.invoiceId);
  const editingInvoice = editingPayment
    ? eligibleInvoices.find((i) => i.id === editingPayment.invoiceId)
    : undefined;

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await paymentsApi.record(form);
      notify('success', 'Payment recorded and invoice ledger updated');
      setModalOpen(false);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayment) return;
    setUpdatingPayment(true);
    try {
      await paymentsApi.update(editingPayment.id, editForm);
      notify('success', `Payment ${editingPayment.receiptNumber} updated`);
      setEditingPayment(null);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update payment');
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handleDeletePayment = async () => {
    if (!deletingPayment) return;
    setDeleting(true);
    try {
      await paymentsApi.remove(deletingPayment.id);
      notify('success', `Payment ${deletingPayment.receiptNumber} deleted & invoice recalculated`);
      setDeletingPayment(null);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete payment');
    } finally {
      setDeleting(false);
    }
  };

  const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 flex-1">
          <div className="relative col-span-2 sm:w-60">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Receipt, invoice #, ref ID..."
              className="pl-9"
            />
          </div>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full sm:w-44">
            <option value="all">All Payment Modes</option>
            <option value="UPI">UPI</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Cash">Cash</option>
            <option value="Credit/Debit Card">Credit/Debit Card</option>
            <option value="Cheque">Cheque</option>
            <option value="Other">Other</option>
          </Select>
          <Select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
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
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() =>
              exportToExcel(
                `drona-payments-${new Date().toISOString().slice(0, 10)}`,
                'Payments',
                payments.map((p) => ({
                  'Receipt #': p.receiptNumber,
                  'Invoice #': p.invoiceNumber,
                  Customer: p.customerName,
                  Date: p.paymentDate,
                  Method: p.paymentMethod,
                  'Reference ID': p.referenceId,
                  Amount: p.amount,
                }))
              )
            }
          >
            Export Excel
          </Button>
          <Button size="sm" className="w-full sm:w-auto" onClick={openModal} disabled={eligibleInvoices.length === 0}>
            <Plus className="h-4 w-4" />
            Record Payment
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 sm:px-5 py-3.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-zinc-500 text-xs sm:text-sm">
          Showing {payments.length} recorded payment{payments.length === 1 ? '' : 's'}
        </span>
        <span className="font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          Total Collected: {formatINR(totalCollected)}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500">Loading payment ledger...</div>
          ) : payments.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={CreditCard}
                title="No payments recorded"
                description="Record full or partial customer payments against issued invoices."
                actionLabel={eligibleInvoices.length > 0 ? 'Record Payment' : undefined}
                onAction={eligibleInvoices.length > 0 ? openModal : undefined}
              />
            </div>
          ) : (
            <>
              {/* Mobile Payment Cards */}
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {payments.map((p) => (
                  <div key={p.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {p.receiptNumber}
                          </span>
                          <button
                            type="button"
                            onClick={() => navigate(`/invoices/${p.invoiceId}`)}
                            className="font-mono text-xs text-[#F57C00] hover:underline cursor-pointer"
                          >
                            {p.invoiceNumber}
                          </button>
                        </div>
                        <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate mt-0.5">
                          {p.customerName}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
                          {formatDate(p.paymentDate)} · {p.paymentMethod}
                          {p.referenceId ? ` · ${p.referenceId}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatINR(p.amount)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => openEditModal(p)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          generatePaymentReceiptPdf(
                            p,
                            session?.businessProfile?.businessName || 'DRONA Business',
                            session?.businessProfile?.address || ''
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5" />
                        Receipt
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeletingPayment(p)}
                        aria-label={`Delete payment ${p.receiptNumber}`}
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
                      <TableHead>Receipt #</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Payment Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference ID</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs font-semibold">
                          {p.receiptNumber}
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => navigate(`/invoices/${p.invoiceId}`)}
                            className="font-mono text-xs text-[#F57C00] hover:underline cursor-pointer"
                          >
                            {p.invoiceNumber}
                          </button>
                        </TableCell>
                        <TableCell>{p.customerName}</TableCell>
                        <TableCell className="font-mono text-xs text-zinc-500">
                          {formatDate(p.paymentDate)}
                        </TableCell>
                        <TableCell className="text-xs">{p.paymentMethod}</TableCell>
                        <TableCell className="font-mono text-xs text-zinc-500">
                          {p.referenceId || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatINR(p.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditModal(p)}
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
                                  session?.businessProfile?.businessName || 'DRONA Business',
                                  session?.businessProfile?.address || ''
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

      {/* Record Payment Dialog */}
      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Record Customer Payment"
        description="Supports partial, full, or advance/overpayment settlements with automatic invoice ledger sync."
      >
        <form onSubmit={handleRecord} className="space-y-4">
          <div className="space-y-1">
            <Label>Select Invoice *</Label>
            <Select
              required
              value={form.invoiceId}
              onChange={(e) => {
                const inv = eligibleInvoices.find((x) => x.id === e.target.value);
                setForm({
                  ...form,
                  invoiceId: e.target.value,
                  amount: inv?.balanceDue && inv.balanceDue > 0 ? inv.balanceDue : inv?.grandTotal || 0,
                });
              }}
            >
              {eligibleInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — {inv.customerSnapshot.companyName || inv.customerSnapshot.name} (
                  {inv.balanceDue > 0 ? `Due: ${formatINR(inv.balanceDue)}` : `Total: ${formatINR(inv.grandTotal)} · Paid`}
                  )
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Date *</Label>
              <Input
                type="date"
                required
                value={form.paymentDate}
                onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>
                Amount Received ({selectedInvoice ? `Due ${formatINR(selectedInvoice.balanceDue)}` : 'INR'}) *
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>

          {selectedInvoice && form.amount > selectedInvoice.balanceDue ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              Entered amount exceeds remaining balance ({formatINR(selectedInvoice.balanceDue)}) by{' '}
              <span className="font-mono font-semibold">
                {formatINR(form.amount - selectedInvoice.balanceDue)}
              </span>
              . Excess will be recorded as overpayment/advance.
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Mode *</Label>
              <Select
                value={form.paymentMethod}
                onChange={(e) =>
                  setForm({ ...form, paymentMethod: e.target.value as PaymentMethod })
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
                value={form.referenceId}
                onChange={(e) => setForm({ ...form, referenceId: e.target.value })}
                placeholder="UTR / Cheque / UPI ID"
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Payment'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit Payment Dialog */}
      <Dialog
        open={Boolean(editingPayment)}
        onClose={() => setEditingPayment(null)}
        title={`Edit Payment — ${editingPayment?.receiptNumber || ''}`}
        description={
          editingInvoice
            ? `Invoice ${editingInvoice.invoiceNumber} · Total ${formatINR(editingInvoice.grandTotal)}`
            : `Invoice ${editingPayment?.invoiceNumber || ''}`
        }
      >
        <form onSubmit={handleUpdatePayment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Date *</Label>
              <Input
                type="date"
                required
                value={editForm.paymentDate}
                onChange={(e) => setEditForm({ ...editForm, paymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount Received (INR) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                value={editForm.amount}
                onChange={(e) => setEditForm({ ...editForm, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>

          {editingInvoice && editForm.amount > editingInvoice.grandTotal ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              Note: This amount exceeds the invoice grand total ({formatINR(editingInvoice.grandTotal)}). You can adjust it here to match the invoice or keep the excess.
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Mode *</Label>
              <Select
                value={editForm.paymentMethod}
                onChange={(e) =>
                  setEditForm({ ...editForm, paymentMethod: e.target.value as PaymentMethod })
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
                value={editForm.referenceId}
                onChange={(e) => setEditForm({ ...editForm, referenceId: e.target.value })}
                placeholder="UTR / Cheque / UPI ID"
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={editForm.notes}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditingPayment(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updatingPayment}>
              {updatingPayment ? 'Updating...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Payment Confirmation Dialog */}
      <Dialog
        open={Boolean(deletingPayment)}
        onClose={() => setDeletingPayment(null)}
        title={`Delete Payment ${deletingPayment?.receiptNumber || ''}`}
        description="Deleting this payment will automatically recalculate the invoice's paid amount and balance due."
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Delete payment of{' '}
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
              {deletingPayment ? formatINR(deletingPayment.amount) : ''}
            </span>{' '}
            for invoice{' '}
            <span className="font-mono font-semibold">{deletingPayment?.invoiceNumber}</span>?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeletingPayment(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={handleDeletePayment}
            >
              {deleting ? 'Deleting...' : 'Delete Payment'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
