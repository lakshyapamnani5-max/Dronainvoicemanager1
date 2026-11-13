import * as React from 'react';
import { CreditCard, Download, Plus, Search } from 'lucide-react';
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
  const [unpaidInvoices, setUnpaidInvoices] = React.useState<Invoice[]>([]);
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
      const open = invRes.invoices.filter(
        (i) => i.balanceDue > 0 && i.status !== 'draft' && i.status !== 'cancelled'
      );
      setUnpaidInvoices(open);
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
    const first = unpaidInvoices[0];
    setForm({
      invoiceId: first?.id || '',
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: first?.balanceDue || 0,
      paymentMethod: 'UPI',
      referenceId: '',
      notes: '',
    });
    setModalOpen(true);
  };

  const selectedInvoice = unpaidInvoices.find((i) => i.id === form.invoiceId);

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

  const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative w-60">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Receipt, invoice #, ref ID..."
              className="pl-9"
            />
          </div>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-44">
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
          <Button
            variant="outline"
            size="sm"
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
          <Button size="sm" onClick={openModal} disabled={unpaidInvoices.length === 0}>
            <Plus className="h-4 w-4" />
            Record Payment
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 py-3.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-zinc-500">
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
                actionLabel={unpaidInvoices.length > 0 ? 'Record Payment' : undefined}
                onAction={unpaidInvoices.length > 0 ? openModal : undefined}
              />
            </div>
          ) : (
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
                  <TableHead className="text-right">Receipt</TableHead>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Record Customer Payment"
        description="Supports partial or full settlement with automatic outstanding calculation."
      >
        <form onSubmit={handleRecord} className="space-y-4">
          <div className="space-y-1">
            <Label>Select Unpaid / Partial Invoice *</Label>
            <Select
              required
              value={form.invoiceId}
              onChange={(e) => {
                const inv = unpaidInvoices.find((x) => x.id === e.target.value);
                setForm({
                  ...form,
                  invoiceId: e.target.value,
                  amount: inv?.balanceDue || 0,
                });
              }}
            >
              {unpaidInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — {inv.customerSnapshot.companyName || inv.customerSnapshot.name} (Due:{' '}
                  {formatINR(inv.balanceDue)})
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
                Amount Received (Max {formatINR(selectedInvoice?.balanceDue || 0)}) *
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={selectedInvoice?.balanceDue || undefined}
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
    </div>
  );
}
