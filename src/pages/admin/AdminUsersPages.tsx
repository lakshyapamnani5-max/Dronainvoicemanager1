import * as React from 'react';
import {
  ArrowLeft,
  Eye,
  KeyRound,
  LogIn,
  Plus,
  Power,
  Search,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { adminApi, subscribeRtdbPath, type AdminUserRow } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import { INDIAN_STATES } from '../../shared/indianStates';
import type { ActivityLog, BusinessProfile, CustomerAnalyticsData, Invoice, Quotation, UserRecord } from '../../shared/types';
import { AccountStatusLabel, InvoiceStatusLabel, QuotationStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function AdminUsersListPage({ navigate }: { navigate: (path: string) => void }) {
  const { impersonate } = useAuth();
  const { notify } = useToast();
  const [users, setUsers] = React.useState<AdminUserRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [sortKey, setSortKey] = React.useState<'createdAt' | 'totalSales' | 'businessName'>('createdAt');
  const [page, setPage] = React.useState(1);
  const pageSize = 10;

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await adminApi.listUsers({ search, status: statusFilter });
      setUsers(res.users);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load businesses');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, statusFilter, notify]);

  React.useEffect(() => {
    const t = setTimeout(() => load(false), 180);
    return () => clearTimeout(t);
  }, [load]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(true), 250);
    };
    const u1 = subscribeRtdbPath('users', scheduleRefresh);
    const u2 = subscribeRtdbPath('tenants', scheduleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
    };
  }, [load]);

  const sorted = React.useMemo(() => {
    return [...users].sort((a, b) => {
      if (sortKey === 'totalSales') return b.totalSales - a.totalSales;
      if (sortKey === 'businessName') return a.businessName.localeCompare(b.businessName);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [users, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  const handleToggleStatus = async (u: AdminUserRow) => {
    const next = u.status === 'active' ? 'inactive' : 'active';
    try {
      await adminApi.setUserStatus(u.uid, next);
      notify('success', `${u.businessName} marked ${next}`);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleLoginAsCustomer = async (u: AdminUserRow) => {
    try {
      await impersonate(u.uid);
      notify('success', `Entered workspace for ${u.businessName}`);
      navigate('/dashboard');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impersonation failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search business, owner, email, GSTIN..."
              className="pl-9"
            />
          </div>

          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-36"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>

          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="w-44"
          >
            <option value="createdAt">Sort: Newest First</option>
            <option value="totalSales">Sort: Highest Sales</option>
            <option value="businessName">Sort: Business Name</option>
          </Select>
        </div>

        <Button size="sm" onClick={() => navigate('/admin/users/new')}>
          <Plus className="h-4 w-4" />
          Create Customer Account
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500">Loading registered businesses...</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Business & Owner</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>GSTIN</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Invoices / Quotes</TableHead>
                    <TableHead className="text-right">Business Sales</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((u) => (
                    <TableRow key={u.uid}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/users/${u.uid}`)}
                          className="text-left hover:text-[#F57C00] cursor-pointer"
                        >
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {u.businessName}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {u.ownerName} · {u.subscriptionPlan}
                          </div>
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-600 dark:text-zinc-400">
                        <div>{u.email}</div>
                        <div className="font-mono">{u.phone || '—'}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{u.gstin || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">
                        {formatDate(u.createdAt)}
                      </TableCell>
                      <TableCell>
                        <AccountStatusLabel status={u.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {u.invoiceCount} / {u.quotationCount}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">
                        {formatINR(u.totalSales)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleLoginAsCustomer(u)}
                            title="Login as Customer"
                            className="h-8 text-xs px-2.5"
                          >
                            <LogIn className="h-3.5 w-3.5 text-[#F57C00]" />
                            Login as Customer
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/admin/users/${u.uid}`)}
                            title="View Profile & Analytics"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleStatus(u)}
                            title={u.status === 'active' ? 'Deactivate Account' : 'Activate Account'}
                          >
                            <Power
                              className={`h-3.5 w-3.5 ${
                                u.status === 'active' ? 'text-emerald-600' : 'text-red-500'
                              }`}
                            />
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
                    Page {page} of {totalPages} ({sorted.length} businesses)
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
    </div>
  );
}

export function AdminCreateUserPage({ navigate }: { navigate: (path: string) => void }) {
  const { notify } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    businessName: '',
    ownerName: '',
    email: '',
    password: '',
    phone: '',
    gstin: '',
    state: 'Maharashtra',
    address: '',
    subscriptionPlan: 'Growth',
    subscriptionAmount: 1999,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await adminApi.createUser(form);
      notify('success', `Provisioned account for ${res.user.businessName}`);
      navigate(`/admin/users/${res.user.uid}`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Button variant="outline" size="sm" onClick={() => navigate('/admin/users')}>
        <ArrowLeft className="h-4 w-4" />
        Back to User Management
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Provision New Business Workspace</CardTitle>
          <CardDescription>
            Create an isolated tenant account with initial login credentials
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Business Legal Name *</Label>
                <Input
                  required
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Owner Full Name *</Label>
                <Input
                  required
                  value={form.ownerName}
                  onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Login Email *</Label>
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Initial Password (min 8 chars) *</Label>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>GSTIN</Label>
                <Input
                  value={form.gstin}
                  onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Subscription Plan</Label>
                <Select
                  value={form.subscriptionPlan}
                  onChange={(e) => {
                    const plan = e.target.value;
                    const amt = plan === 'Enterprise' ? 4999 : plan === 'Growth' ? 1999 : 999;
                    setForm({ ...form, subscriptionPlan: plan, subscriptionAmount: amt });
                  }}
                >
                  <option value="Starter">Starter</option>
                  <option value="Growth">Growth</option>
                  <option value="Enterprise">Enterprise</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Monthly Fee (INR)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.subscriptionAmount}
                  onChange={(e) =>
                    setForm({ ...form, subscriptionAmount: Number(e.target.value) })
                  }
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Business Address</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate('/admin/users')}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Provisioning...' : 'Create Customer Account'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminUserDetailsPage({
  uid,
  navigate,
}: {
  uid: string;
  navigate: (path: string) => void;
}) {
  const { impersonate } = useAuth();
  const { notify } = useToast();
  const [data, setData] = React.useState<{
    user: UserRecord;
    profile: BusinessProfile | null;
    invoices: Invoice[];
    quotations: Quotation[];
    analytics: CustomerAnalyticsData;
    logs: ActivityLog[];
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editForm, setEditForm] = React.useState({
    businessName: '',
    ownerName: '',
    phone: '',
    gstin: '',
    subscriptionPlan: 'Growth',
    subscriptionAmount: 1999,
  });

  const [pwOpen, setPwOpen] = React.useState(false);
  const [sendingReset, setSendingReset] = React.useState(false);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await adminApi.getUserDetails(uid);
      setData(res);
      setEditForm({
        businessName: res.user.businessName,
        ownerName: res.user.ownerName,
        phone: res.user.phone,
        gstin: res.user.gstin,
        subscriptionPlan: res.user.subscriptionPlan,
        subscriptionAmount: res.user.subscriptionAmount,
      });
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load user details');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [uid, notify]);

  React.useEffect(() => {
    load(false);
  }, [load]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(true), 250);
    };
    const u1 = subscribeRtdbPath(`users/${uid}`, scheduleRefresh);
    const u2 = subscribeRtdbPath(`businessProfiles/${uid}`, scheduleRefresh);
    const u3 = subscribeRtdbPath(`tenants/${uid}`, scheduleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
      u3();
    };
  }, [uid, load]);

  if (loading || !data) {
    return <div className="p-8 text-sm text-zinc-500">Loading business account...</div>;
  }

  const { user, invoices, quotations, analytics, logs } = data;

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.updateUser(uid, editForm);
      notify('success', 'Customer profile updated');
      setEditOpen(false);
      load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleResetPw = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingReset(true);
    try {
      await adminApi.resetUserPassword(uid);
      notify('success', `Firebase password reset email sent to ${user.email}`);
      setPwOpen(false);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSendingReset(false);
    }
  };

  const handleImpersonate = async () => {
    try {
      await impersonate(uid);
      notify('success', `Entered workspace for ${user.businessName}`);
      navigate('/dashboard');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impersonation failed');
    }
  };

  const handleToggleStatus = async () => {
    const next = user.status === 'active' ? 'inactive' : 'active';
    await adminApi.setUserStatus(uid, next);
    notify('success', `Account marked ${next}`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/users')}>
            <ArrowLeft className="h-4 w-4" />
            All Businesses
          </Button>
          <AccountStatusLabel status={user.status} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            Edit Profile
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
            <KeyRound className="h-3.5 w-3.5" />
            Reset Password
          </Button>
          <Button variant="outline" size="sm" onClick={handleToggleStatus}>
            {user.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
          <Button size="sm" onClick={handleImpersonate}>
            <UserCheck className="h-4 w-4" />
            Login as Customer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs text-zinc-500">Business Sales</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums">
            {formatINR(analytics.summary.totalSales)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500">Collected</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums text-emerald-600">
            {formatINR(analytics.summary.totalAmountReceived)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500">Outstanding</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums text-[#F57C00]">
            {formatINR(analytics.summary.totalOutstanding)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500">DRONA Subscription</div>
          <div className="mt-2 text-xl font-bold font-mono tabular-nums">
            {formatINR(user.subscriptionAmount)}/mo
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">{user.subscriptionPlan} Plan</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Business Invoices ({invoices.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.slice(0, 8).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.invoiceNumber}</TableCell>
                    <TableCell className="text-xs">
                      {i.customerSnapshot.companyName || i.customerSnapshot.name}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusLabel status={i.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatINR(i.grandTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business Quotations ({quotations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quotation #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotations.slice(0, 8).map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs">{q.quotationNumber}</TableCell>
                    <TableCell className="text-xs">
                      {q.customerSnapshot.companyName || q.customerSnapshot.name}
                    </TableCell>
                    <TableCell>
                      <QuotationStatusLabel status={q.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatINR(q.grandTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Audit Trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {logs.map((l) => (
            <div
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-2 last:border-0 text-xs dark:border-zinc-800"
            >
              <span>{l.summary}</span>
              <span className="text-zinc-500">
                {l.actorEmail} · {formatDateTime(l.createdAt)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Business Profile">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="space-y-1">
            <Label>Business Name</Label>
            <Input
              required
              value={editForm.businessName}
              onChange={(e) => setEditForm({ ...editForm, businessName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Owner Name</Label>
              <Input
                required
                value={editForm.ownerName}
                onChange={(e) => setEditForm({ ...editForm, ownerName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>GSTIN</Label>
              <Input
                value={editForm.gstin}
                onChange={(e) => setEditForm({ ...editForm, gstin: e.target.value.toUpperCase() })}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>Plan</Label>
              <Select
                value={editForm.subscriptionPlan}
                onChange={(e) =>
                  setEditForm({ ...editForm, subscriptionPlan: e.target.value })
                }
              >
                <option value="Starter">Starter</option>
                <option value="Growth">Growth</option>
                <option value="Enterprise">Enterprise</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Monthly Fee</Label>
              <Input
                type="number"
                value={editForm.subscriptionAmount}
                onChange={(e) =>
                  setEditForm({ ...editForm, subscriptionAmount: Number(e.target.value) })
                }
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={`Reset Password — ${user.businessName}`}
        description="Sends a secure Firebase Authentication password reset link directly to the customer's email."
      >
        <form onSubmit={handleResetPw} className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 leading-relaxed">
            A password reset email will be dispatched via Firebase Authentication to{' '}
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
              {user.email}
            </span>
            . The customer can use that link to set a new password securely.
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPwOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={sendingReset}>
              {sendingReset ? 'Sending...' : 'Send Password Reset Email'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
