import * as React from 'react';
import { Archive, ArchiveRestore, Edit2, Eye, Plus, Search, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { customersApi, subscribeRtdbPath } from '../../lib/api';
import { formatINR } from '../../shared/gstCalculator';
import { INDIAN_STATES, getStateFromGstin } from '../../shared/indianStates';
import type { Customer, Invoice, Payment, Quotation } from '../../shared/types';
import { formatDate } from '../../lib/utils';
import { EmptyState } from '../../components/AppShell';
import { InvoiceStatusLabel, QuotationStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function CustomersPage({ navigate }: { navigate: (path: string) => void }) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const isGstBusiness = session?.businessProfile?.defaultIsGst !== false;
  const { notify } = useToast();
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [search, setSearch] = React.useState('');
  const [showArchived, setShowArchived] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);
  const [saving, setSaving] = React.useState(false);

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

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await customersApi.list({ search, includeArchived: showArchived });
      setCustomers(res.customers);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, showArchived, notify]);

  React.useEffect(() => {
    const timer = setTimeout(() => load(false), 200);
    return () => clearTimeout(timer);
  }, [load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeRtdbPath(`tenants/${tenantUid}`, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(true), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [tenantUid, load]);

  const openCreate = () => {
    setEditing(null);
    setForm({
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
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      name: c.name,
      companyName: c.companyName,
      email: c.email,
      phone: c.phone,
      gstin: c.gstin,
      billingAddress: c.billingAddress,
      shippingAddress: c.shippingAddress,
      state: c.state || 'Maharashtra',
      notes: c.notes,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await customersApi.update(editing.id, form);
        notify('success', 'Customer updated');
      } else {
        await customersApi.create(form);
        notify('success', 'Customer created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (c: Customer) => {
    try {
      const res = await customersApi.remove(c.id);
      notify(
        'success',
        res.archived
          ? 'Customer archived (historical invoices & payments preserved)'
          : 'Customer deleted'
      );
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Operation failed');
    }
  };

  const handleUnarchive = async (c: Customer) => {
    try {
      await customersApi.update(c.id, { archived: false });
      notify('success', `${c.companyName || c.name} unarchived`);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to unarchive customer');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 flex-1 sm:min-w-[240px] sm:max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company, GSTIN, email..."
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 rounded accent-[#F57C00]"
            />
            Show archived
          </label>
        </div>

        <Button onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Add Customer
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500">Loading customers...</div>
          ) : customers.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Users}
                title="No customers found"
                description="Add your clients and B2B accounts to generate GST invoices and track ledgers."
                actionLabel="Add Customer"
                onAction={openCreate}
              />
            </div>
          ) : (
            <>
              {/* Mobile Customer Cards */}
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {customers.map((c) => (
                  <div key={c.id} className={`p-4 space-y-2.5 ${c.archived ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/customers/${c.id}`)}
                        className="text-left min-w-0 cursor-pointer"
                      >
                        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                          {c.companyName || c.name}
                          {c.archived ? ' (Archived)' : ''}
                        </div>
                        {c.companyName ? (
                          <div className="text-xs text-zinc-500 truncate">{c.name}</div>
                        ) : null}
                        <div className="text-[11px] font-mono text-zinc-500 mt-1">
                          {c.gstin || 'Unregistered'} · {c.state}
                        </div>
                      </button>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-bold tabular-nums text-[#F57C00]">
                          {formatINR(c.outstandingBalance || 0)}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          Sales {formatINR(c.totalSales || 0)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => navigate(`/customers/${c.id}`)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ledger
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(c)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      {!c.archived ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleArchive(c)}
                          aria-label="Archive customer"
                          title="Archive / Delete"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnarchive(c)}
                          aria-label="Unarchive customer"
                          title="Unarchive Customer"
                          className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900/60 dark:hover:bg-emerald-950/30"
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          Unarchive
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer / Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>GSTIN & State</TableHead>
                      <TableHead className="text-right">Total Sales</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((c) => (
                      <TableRow key={c.id} className={c.archived ? 'opacity-60' : ''}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => navigate(`/customers/${c.id}`)}
                            className="text-left hover:text-[#F57C00] cursor-pointer"
                          >
                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                              {c.companyName || c.name}
                              {c.archived ? ' (Archived)' : ''}
                            </div>
                            {c.companyName ? (
                              <div className="text-xs text-zinc-500">{c.name}</div>
                            ) : null}
                          </button>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-600 dark:text-zinc-400">
                          <div>{c.email || '—'}</div>
                          <div className="font-mono">{c.phone || '—'}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-mono">{c.gstin || 'Unregistered'}</div>
                          <div className="text-zinc-500">{c.state}</div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINR(c.totalSales || 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-semibold text-[#F57C00]">
                          {formatINR(c.outstandingBalance || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/customers/${c.id}`)}
                              title="View Ledger"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEdit(c)}
                              title="Edit Customer"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            {!c.archived ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleArchive(c)}
                                title="Archive / Delete"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUnarchive(c)}
                                title="Unarchive Customer"
                                className="h-8 text-xs px-2.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900/60 dark:hover:bg-emerald-950/30"
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                Unarchive
                              </Button>
                            )}
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

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Customer' : 'Add Customer'}
        description="Customer GSTIN and state automatically drive CGST/SGST vs IGST rules."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Contact Name *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Primary contact person"
              />
            </div>
            <div className="space-y-1">
              <Label>Company / Business Name</Label>
              <Input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                placeholder="Company Pvt Ltd"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{isGstBusiness ? 'GSTIN' : 'GSTIN (Optional — Non-GST Workspace)'}</Label>
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
                placeholder="15-digit GSTIN"
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>State</Label>
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

          <div className="space-y-1">
            <Label>Billing Address</Label>
            <Textarea
              rows={2}
              value={form.billingAddress}
              onChange={(e) => setForm({ ...form, billingAddress: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Shipping Address</Label>
            <Textarea
              rows={2}
              value={form.shippingAddress}
              onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })}
              placeholder="Leave blank to match billing address"
            />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Customer'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function CustomerDetailsPage({
  customerId,
  navigate,
}: {
  customerId: string;
  navigate: (path: string) => void;
}) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const [data, setData] = React.useState<{
    customer: Customer;
    invoices: Invoice[];
    quotations: Quotation[];
    payments: Payment[];
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadDetails = React.useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      customersApi
        .get(customerId)
        .then((res) => setData(res))
        .catch((err) => {
          if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load customer');
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [customerId, notify]
  );

  React.useEffect(() => {
    loadDetails(false);
  }, [loadDetails]);

  React.useEffect(() => {
    if (!tenantUid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeRtdbPath(`tenants/${tenantUid}`, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadDetails(true), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [tenantUid, loadDetails]);

  if (loading) {
    return <div className="p-8 text-sm text-zinc-500">Loading customer ledger...</div>;
  }

  if (!data) {
    return (
      <EmptyState
        title="Customer not found"
        description="The requested customer does not exist in this workspace."
        actionLabel="Back to Customers"
        onAction={() => navigate('/customers')}
      />
    );
  }

  const { customer, invoices, quotations, payments } = data;

  const handleUnarchiveDetail = async () => {
    try {
      await customersApi.update(customer.id, { archived: false });
      notify('success', `${customer.companyName || customer.name} unarchived`);
      loadDetails(false);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to unarchive customer');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {customer.companyName || customer.name}
            {customer.archived ? ' (Archived)' : ''}
          </h2>
          <div className="text-xs text-zinc-500 mt-0.5">
            {customer.name} · {customer.email || 'No email'} · {customer.phone || 'No phone'} ·{' '}
            <span className="font-mono">{customer.gstin || 'Unregistered'}</span> ({customer.state})
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {customer.archived ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnarchiveDetail}
              className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900/60 dark:hover:bg-emerald-950/30"
            >
              <ArchiveRestore className="h-4 w-4" />
              Unarchive Customer
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => navigate('/customers')}>
            All Customers
          </Button>
          <Button size="sm" onClick={() => navigate('/invoices/new')}>
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card className="p-4 sm:p-5">
          <div className="text-xs text-zinc-500">Customer-Wise Sales</div>
          <div className="mt-1.5 sm:mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums truncate">
            {formatINR(customer.totalSales || 0)}
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="text-xs text-zinc-500">Total Collected</div>
          <div className="mt-1.5 sm:mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 truncate">
            {formatINR(customer.totalPaid || 0)}
          </div>
        </Card>
        <Card className="p-4 sm:p-5">
          <div className="text-xs text-zinc-500">Outstanding Balance</div>
          <div className="mt-1.5 sm:mt-2 text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F57C00] truncate">
            {formatINR(customer.outstandingBalance || 0)}
          </div>
        </Card>
      </div>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice History ({invoices.length})</CardTitle>
          <CardDescription>All issued and draft invoices for this customer</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="p-6 text-xs text-zinc-500">No invoices yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                  >
                    <TableCell className="font-mono font-medium">{inv.invoiceNumber}</TableCell>
                    <TableCell className="font-mono text-xs">{formatDate(inv.invoiceDate)}</TableCell>
                    <TableCell className="font-mono text-xs">{formatDate(inv.dueDate)}</TableCell>
                    <TableCell>
                      <InvoiceStatusLabel status={inv.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(inv.grandTotal)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold">
                      {formatINR(inv.balanceDue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quotations & Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Quotation History ({quotations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {quotations.length === 0 ? (
              <div className="p-6 text-xs text-zinc-500">No quotations yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quotation #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotations.map((q) => (
                    <TableRow
                      key={q.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/quotations/${q.id}`)}
                    >
                      <TableCell className="font-mono font-medium">{q.quotationNumber}</TableCell>
                      <TableCell className="font-mono text-xs">{formatDate(q.quotationDate)}</TableCell>
                      <TableCell>
                        <QuotationStatusLabel status={q.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINR(q.grandTotal)}
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
            <CardTitle>Payment Ledger ({payments.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {payments.length === 0 ? (
              <div className="p-6 text-xs text-zinc-500">No payments recorded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.receiptNumber}</TableCell>
                      <TableCell className="font-mono text-xs">{formatDate(p.paymentDate)}</TableCell>
                      <TableCell className="text-xs">{p.paymentMethod}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-emerald-600 font-semibold">
                        {formatINR(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
