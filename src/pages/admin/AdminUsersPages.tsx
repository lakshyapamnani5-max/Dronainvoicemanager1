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
import { adminApi, cachedRead, type AdminUserRow } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/utils';
import { formatINR, fromPaise, toPaise } from '../../shared/gstCalculator';
import { INDIAN_STATES } from '../../shared/indianStates';
import type { ActivityLog, BusinessProfile, CustomerAnalyticsData, Invoice, Quotation, UserRecord } from '../../shared/types';
import { AccountStatusLabel, InvoiceStatusLabel, QuotationStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

function readCachedAdminUsers(): AdminUserRow[] | null {
  const cache = cachedRead.getAdminCache();
  if (!cache.syncedAt.users || !cache.syncedAt.tenants) return null;
  return cache.users
    .filter((u) => u.role === 'business')
    .map((u) => {
      const t = cache.tenants[u.uid] || { invoices: [], quotations: [], payments: [] };
      const salesPaise = t.invoices
        .filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
        .reduce((s, i) => s + toPaise(i.grandTotal), 0);
      const collectedPaise = t.payments.reduce((s, p) => s + toPaise(p.amount), 0);
      return {
        ...u,
        invoiceCount: t.invoices.length,
        quotationCount: t.quotations.length,
        totalSales: fromPaise(salesPaise),
        totalCollected: fromPaise(collectedPaise),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function AdminUsersListPage({ navigate }: { navigate: (path: string) => void }) {
  const { impersonate } = useAuth();
  const { notify } = useToast();
  const initialUsers = React.useMemo(() => readCachedAdminUsers(), []);
  const [allUsers, setAllUsers] = React.useState<AdminUserRow[]>(initialUsers || []);
  const [loading, setLoading] = React.useState(!initialUsers);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [sortKey, setSortKey] = React.useState<'createdAt' | 'totalSales' | 'businessName'>('createdAt');

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await adminApi.listUsers();
      setAllUsers(res.users);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load businesses');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    load(Boolean(initialUsers));
    return cachedRead.subscribeAdminCache(() => {
      const next = readCachedAdminUsers();
      if (next) {
        setAllUsers(next);
        setLoading(false);
      }
    });
  }, [load, initialUsers]);

  const sorted = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allUsers.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.businessName.toLowerCase().includes(q) ||
        u.ownerName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.gstin.toLowerCase().includes(q) ||
        (u.phone && u.phone.toLowerCase().includes(q))
      );
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'totalSales') return b.totalSales - a.totalSales;
      if (sortKey === 'businessName') return a.businessName.localeCompare(b.businessName);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [allUsers, search, statusFilter, sortKey]);

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
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 flex-1">
          <div className="relative col-span-2 sm:w-72">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search business, owner, email, GSTIN..."
              className="pl-9"
            />
          </div>

          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-36"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>

          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="w-full sm:w-44"
          >
            <option value="createdAt">Sort: Newest First</option>
            <option value="totalSales">Sort: Highest Sales</option>
            <option value="businessName">Sort: Business Name</option>
          </Select>
        </div>

        <Button
          size="sm"
          onClick={() => navigate('/admin/users/new')}
          className="w-full sm:w-auto"
        >
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
              {/* Mobile Business Cards */}
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {sorted.map((u) => (
                  <div key={u.uid} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/users/${u.uid}`)}
                        className="text-left min-w-0 cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                            {u.businessName}
                          </span>
                          <AccountStatusLabel status={u.status} />
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5 truncate">
                          {u.ownerName} · {u.subscriptionPlan}
                        </div>
                      </button>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-semibold text-sm tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatINR(u.totalSales)}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500">
                          {u.invoiceCount} inv / {u.quotationCount} quo
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
                      <div className="truncate">{u.email}</div>
                      <div className="text-right font-mono truncate">
                        {u.gstin || u.phone || formatDate(u.createdAt)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleLoginAsCustomer(u)}
                        className="flex-1 h-9 text-xs"
                      >
                        <LogIn className="h-3.5 w-3.5 text-[#F57C00]" />
                        Login as Customer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/admin/users/${u.uid}`)}
                        title="View Profile & Analytics"
                        className="h-9 px-3"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleStatus(u)}
                        title={u.status === 'active' ? 'Deactivate Account' : 'Activate Account'}
                        className="h-9 px-3"
                      >
                        <Power
                          className={`h-3.5 w-3.5 ${
                            u.status === 'active' ? 'text-emerald-600' : 'text-red-500'
                          }`}
                        />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
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
                    {sorted.map((u) => (
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
              </div>

              <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
                <span>Showing {sorted.length} businesses</span>
              </div>
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

function readCachedUserDetails(uid: string): {
  user: UserRecord;
  profile: BusinessProfile | null;
  invoices: Invoice[];
  quotations: Quotation[];
  analytics: CustomerAnalyticsData;
  logs: ActivityLog[];
} | null {
  const adminCache = cachedRead.getAdminCache();
  const user = adminCache.users.find((u) => u.uid === uid);
  if (!user) return null;
  const tenantEntry = cachedRead.getTenantEntry(uid);
  const adminTenant = adminCache.tenants[uid];
  const invoices =
    tenantEntry.syncedAt.invoices
      ? tenantEntry.invoices
      : adminTenant?.invoices || [];
  const quotations =
    tenantEntry.syncedAt.quotations
      ? tenantEntry.quotations
      : adminTenant?.quotations || [];
  const payments =
    tenantEntry.syncedAt.payments
      ? tenantEntry.payments
      : adminTenant?.payments || [];
  if (!tenantEntry.syncedAt.invoices && !adminCache.syncedAt.tenants) return null;

  const sortedInvoices = [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sortedQuotations = [...quotations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const analytics = cachedRead.computeCustomerAnalyticsFromData(
    sortedInvoices,
    sortedQuotations,
    payments,
    tenantEntry.customers
  );
  const logs = (
    tenantEntry.syncedAt.activityLogs
      ? tenantEntry.activityLogs
      : adminCache.activityLogs.filter((l) => l.targetTenantUid === uid)
  )
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);

  return {
    user,
    profile: tenantEntry.profile || null,
    invoices: sortedInvoices,
    quotations: sortedQuotations,
    analytics,
    logs,
  };
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
  const initialData = React.useMemo(() => readCachedUserDetails(uid), [uid]);
  const [data, setData] = React.useState<{
    user: UserRecord;
    profile: BusinessProfile | null;
    invoices: Invoice[];
    quotations: Quotation[];
    analytics: CustomerAnalyticsData;
    logs: ActivityLog[];
  } | null>(initialData);
  const [loading, setLoading] = React.useState(!initialData);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editForm, setEditForm] = React.useState(() => ({
    businessName: initialData?.user.businessName || '',
    ownerName: initialData?.user.ownerName || '',
    phone: initialData?.user.phone || '',
    gstin: initialData?.user.gstin || '',
    subscriptionPlan: initialData?.user.subscriptionPlan || 'Growth',
    subscriptionAmount: initialData?.user.subscriptionAmount ?? 1999,
  }));

  const [pwOpen, setPwOpen] = React.useState(false);
  const [sendingReset, setSendingReset] = React.useState(false);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await adminApi.getUserDetails(uid);
      setData(res);
      if (!editOpen) {
        setEditForm({
          businessName: res.user.businessName,
          ownerName: res.user.ownerName,
          phone: res.user.phone,
          gstin: res.user.gstin,
          subscriptionPlan: res.user.subscriptionPlan,
          subscriptionAmount: res.user.subscriptionAmount,
        });
      }
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load user details');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [uid, notify, editOpen]);

  React.useEffect(() => {
    load(Boolean(initialData));
  }, [load, initialData]);

  React.useEffect(() => {
    const u1 = cachedRead.subscribeAdminCache(() => load(true));
    const u2 = cachedRead.subscribeTenantCache(uid, () => load(true));
    return () => {
      u1();
      u2();
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-3.5 sm:p-5">
          <div className="text-[11px] sm:text-xs text-zinc-500">Business Sales</div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-bold font-mono tabular-nums truncate">
            {formatINR(analytics.summary.totalSales)}
          </div>
        </Card>
        <Card className="p-3.5 sm:p-5">
          <div className="text-[11px] sm:text-xs text-zinc-500">Collected</div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-bold font-mono tabular-nums text-emerald-600 truncate">
            {formatINR(analytics.summary.totalAmountReceived)}
          </div>
        </Card>
        <Card className="p-3.5 sm:p-5">
          <div className="text-[11px] sm:text-xs text-zinc-500">Outstanding</div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-bold font-mono tabular-nums text-[#F57C00] truncate">
            {formatINR(analytics.summary.totalOutstanding)}
          </div>
        </Card>
        <Card className="p-3.5 sm:p-5">
          <div className="text-[11px] sm:text-xs text-zinc-500">DRONA Subscription</div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-bold font-mono tabular-nums truncate">
            {formatINR(user.subscriptionAmount)}/mo
          </div>
          <div className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">{user.subscriptionPlan} Plan</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Business Invoices ({invoices.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
              {invoices.slice(0, 8).map((i) => (
                <div key={i.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {i.invoiceNumber}
                      </span>
                      <InvoiceStatusLabel status={i.status} />
                    </div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {i.customerSnapshot.companyName || i.customerSnapshot.name}
                    </div>
                  </div>
                  <div className="font-mono text-xs font-semibold tabular-nums shrink-0">
                    {formatINR(i.grandTotal)}
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business Quotations ({quotations.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
              {quotations.slice(0, 8).map((q) => (
                <div key={q.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {q.quotationNumber}
                      </span>
                      <QuotationStatusLabel status={q.status} />
                    </div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                      {q.customerSnapshot.companyName || q.customerSnapshot.name}
                    </div>
                  </div>
                  <div className="font-mono text-xs font-semibold tabular-nums shrink-0">
                    {formatINR(q.grandTotal)}
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
            </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
