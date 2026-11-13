import * as React from 'react';
import { Search, ShieldAlert } from 'lucide-react';
import { adminApi, subscribeRtdbPath } from '../../lib/api';
import { exportToExcel, formatDate, formatDateTime } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { ActivityLog, ImpersonationSession, PlatformSettings } from '../../shared/types';
import { InvoiceStatusLabel, QuotationStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label, Select } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function PlatformInvoicesPage({ navigate }: { navigate: (path: string) => void }) {
  const { notify } = useToast();
  const [rows, setRows] = React.useState<
    Array<{
      id: string;
      userUid: string;
      tenantBusinessName: string;
      invoiceNumber: string;
      customerName: string;
      invoiceDate: string;
      dueDate: string;
      status: string;
      grandTotal: number;
      amountPaid: number;
      balanceDue: number;
    }>
  >([]);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');

  const load = React.useCallback(() => {
    adminApi
      .listInvoices({ search, status })
      .then((res) => setRows(res.invoices))
      .catch((err) => notify('error', err instanceof Error ? err.message : 'Load failed'));
  }, [search, status, notify]);

  React.useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    const u1 = subscribeRtdbPath('tenants', schedule);
    const u2 = subscribeRtdbPath('users', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
    };
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <div className="relative col-span-2 sm:w-64">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search business, invoice #..."
              className="pl-9"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="col-span-2 sm:w-40">
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="overdue">Overdue</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToExcel('platform-invoices', 'Invoices', rows)}
          className="w-full sm:w-auto"
        >
          Export Excel
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <div key={r.id} className="p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {r.invoiceNumber}
                      </span>
                      <InvoiceStatusLabel status={r.status} />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/users/${r.userUid}`)}
                      className="text-xs font-medium text-[#F57C00] hover:underline mt-0.5 text-left truncate block cursor-pointer"
                    >
                      {r.tenantBusinessName}
                    </button>
                    <div className="text-xs text-zinc-500 truncate">
                      {r.customerName} · {formatDate(r.invoiceDate)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      {formatINR(r.grandTotal)}
                    </div>
                    <div className="font-mono text-[11px] text-zinc-500">
                      Bal {formatINR(r.balanceDue)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business Tenant</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/users/${r.userUid}`)}
                        className="font-medium text-zinc-900 hover:text-[#F57C00] dark:text-zinc-100 cursor-pointer"
                      >
                        {r.tenantBusinessName}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.invoiceNumber}</TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-500">
                      {formatDate(r.invoiceDate)}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusLabel status={r.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(r.grandTotal)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold">
                      {formatINR(r.balanceDue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PlatformQuotationsPage({ navigate }: { navigate: (path: string) => void }) {
  const { notify } = useToast();
  const [rows, setRows] = React.useState<
    Array<{
      id: string;
      userUid: string;
      tenantBusinessName: string;
      quotationNumber: string;
      customerName: string;
      quotationDate: string;
      validUntil: string;
      status: string;
      grandTotal: number;
    }>
  >([]);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');

  const load = React.useCallback(() => {
    adminApi
      .listQuotations({ search, status })
      .then((res) => setRows(res.quotations))
      .catch((err) => notify('error', err instanceof Error ? err.message : 'Load failed'));
  }, [search, status, notify]);

  React.useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    const u1 = subscribeRtdbPath('tenants', schedule);
    const u2 = subscribeRtdbPath('users', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      u1();
      u2();
    };
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <div className="relative col-span-2 sm:w-64">
            <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search business, quote #..."
              className="pl-9"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="col-span-2 sm:w-40">
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
            <option value="converted">Converted</option>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToExcel('platform-quotations', 'Quotations', rows)}
          className="w-full sm:w-auto"
        >
          Export Excel
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <div key={r.id} className="p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {r.quotationNumber}
                      </span>
                      <QuotationStatusLabel status={r.status} />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/users/${r.userUid}`)}
                      className="text-xs font-medium text-[#F57C00] hover:underline mt-0.5 text-left truncate block cursor-pointer"
                    >
                      {r.tenantBusinessName}
                    </button>
                    <div className="text-xs text-zinc-500 truncate">
                      {r.customerName} · {formatDate(r.quotationDate)}
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {formatINR(r.grandTotal)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business Tenant</TableHead>
                  <TableHead>Quotation #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/users/${r.userUid}`)}
                        className="font-medium text-zinc-900 hover:text-[#F57C00] dark:text-zinc-100 cursor-pointer"
                      >
                        {r.tenantBusinessName}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.quotationNumber}</TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-500">
                      {formatDate(r.quotationDate)}
                    </TableCell>
                    <TableCell>
                      <QuotationStatusLabel status={r.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold">
                      {formatINR(r.grandTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminActivityLogsPage() {
  const [logs, setLogs] = React.useState<ActivityLog[]>([]);

  React.useEffect(() => {
    const loadLogs = () => {
      adminApi.listActivityLogs(200).then((res) => setLogs(res.logs)).catch(() => {});
    };
    loadLogs();
    return subscribeRtdbPath('activityLogs', loadLogs);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Audit & Activity Logs</CardTitle>
        <CardDescription>
          Immutable record of administrative actions, tenant mutations, and impersonated changes
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {logs.map((l) => (
            <div key={l.id} className="p-4 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                  {l.summary}
                </div>
                {l.impersonationSessionId ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium shrink-0">
                    <ShieldAlert className="h-3 w-3" />
                    Impersonated
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-400 shrink-0">Direct</span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-zinc-500">
                <span className="truncate">{l.actorEmail}</span>
                <span className="font-mono">{formatDateTime(l.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Mode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs text-zinc-500 whitespace-nowrap">
                    {formatDateTime(l.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs">{l.actorEmail}</TableCell>
                  <TableCell className="font-mono text-xs">{l.action}</TableCell>
                  <TableCell className="text-xs">{l.summary}</TableCell>
                  <TableCell className="text-xs">
                    {l.impersonationSessionId ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Impersonated
                      </span>
                    ) : (
                      <span className="text-zinc-500">Direct</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminImpersonationHistoryPage() {
  const [sessions, setSessions] = React.useState<ImpersonationSession[]>([]);

  React.useEffect(() => {
    const loadSessions = () => {
      adminApi.listImpersonationHistory().then((res) => setSessions(res.sessions)).catch(() => {});
    };
    loadSessions();
    return subscribeRtdbPath('impersonationSessions', loadSessions);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin Impersonation Sessions</CardTitle>
        <CardDescription>
          Every "Login as Customer" session is time-bounded, revocable, and permanently audited
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
          {sessions.map((s) => (
            <div key={s.id} className="p-4 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {s.targetBusinessName}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">{s.adminEmail}</div>
                </div>
                {s.active ? (
                  <span className="text-xs text-amber-600 font-semibold shrink-0">Active</span>
                ) : (
                  <span className="text-xs text-zinc-500 shrink-0">Ended</span>
                )}
              </div>
              <div className="text-[11px] font-mono text-zinc-500">
                Started: {formatDateTime(s.startedAt)}
              </div>
              <div className="text-[11px] font-mono text-zinc-500">
                Ended: {s.endedAt ? formatDateTime(s.endedAt) : 'Active / Pending'}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin Identity</TableHead>
                <TableHead>Target Business</TableHead>
                <TableHead>Started At</TableHead>
                <TableHead>Ended At</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs font-medium">{s.adminEmail}</TableCell>
                  <TableCell className="text-xs">{s.targetBusinessName}</TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500">
                    {formatDateTime(s.startedAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500">
                    {s.endedAt ? formatDateTime(s.endedAt) : 'Active / Pending'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.active ? (
                      <span className="text-amber-600 font-semibold">Active</span>
                    ) : (
                      <span className="text-zinc-500">Ended</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminPlatformSettingsPage() {
  const { notify } = useToast();
  const [settings, setSettings] = React.useState<PlatformSettings | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const loadSettings = () => {
      adminApi.getSettings().then((res) => setSettings(res.settings)).catch(() => {});
    };
    loadSettings();
    return subscribeRtdbPath('platformSettings', loadSettings);
  }, []);

  if (!settings) return <div className="p-8 text-sm text-zinc-500">Loading settings...</div>;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await adminApi.updateSettings(settings);
      setSettings(res.settings);
      notify('success', 'Platform settings updated');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>DRONA Global Platform Settings</CardTitle>
          <CardDescription>Control onboarding, default prefixes, and SaaS pricing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Platform Name</Label>
              <Input
                value={settings.platformName}
                onChange={(e) => setSettings({ ...settings, platformName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Support Email</Label>
              <Input
                type="email"
                value={settings.supportEmail}
                onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Default Invoice Prefix</Label>
              <Input
                value={settings.defaultInvoicePrefix}
                onChange={(e) =>
                  setSettings({ ...settings, defaultInvoicePrefix: e.target.value.toUpperCase() })
                }
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>Default Quotation Prefix</Label>
              <Input
                value={settings.defaultQuotationPrefix}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultQuotationPrefix: e.target.value.toUpperCase(),
                  })
                }
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>Default Monthly Fee (INR)</Label>
              <Input
                type="number"
                value={settings.defaultSubscriptionMonthly}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultSubscriptionMonthly: Number(e.target.value),
                  })
                }
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={settings.allowSelfRegistration}
                onChange={(e) =>
                  setSettings({ ...settings, allowSelfRegistration: e.target.checked })
                }
                className="accent-[#F57C00]"
              />
              Allow customer businesses to self-register on /register
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={settings.maintenanceMode}
                onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
                className="accent-[#F57C00]"
              />
              Maintenance banner mode
            </label>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Platform Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
