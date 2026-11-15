import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Plus, ShieldCheck } from 'lucide-react';
import { adminApi, cachedRead } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { AdminDashboardData } from '../../shared/types';
import { AccountStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function AdminDashboardPage({
  navigate,
  analyticsOnly = false,
}: {
  navigate: (path: string) => void;
  analyticsOnly?: boolean;
}) {
  const { notify } = useToast();
  const [range, setRange] = React.useState('all');
  const [customStart, setCustomStart] = React.useState('');
  const [customEnd, setCustomEnd] = React.useState('');
  const readAdminSnap = React.useCallback(() => {
    const cache = cachedRead.getAdminCache();
    if (!cache.syncedAt.users && !cache.syncedAt.tenants) return null;
    return {
      users: cache.users,
      tenants: cache.tenants,
      activityLogs: cache.activityLogs,
    };
  }, []);

  const initialSnap = React.useMemo(() => readAdminSnap(), [readAdminSnap]);
  const [snapshot, setSnapshot] = React.useState(initialSnap);
  const [loading, setLoading] = React.useState(() => !initialSnap);
  const lastDashboardRef = React.useRef<AdminDashboardData | null>(null);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      await adminApi.getDashboard({ range: 'all' });
      const next = readAdminSnap();
      if (next) setSnapshot(next);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load platform analytics');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [readAdminSnap, notify]);

  React.useEffect(() => {
    void load(Boolean(initialSnap));
  }, [initialSnap, load]);

  React.useEffect(() => {
    return cachedRead.subscribeAdminCache(() => {
      const next = readAdminSnap();
      if (next) setSnapshot(next);
    });
  }, [readAdminSnap]);

  const data = React.useMemo(() => {
    if (!snapshot) return null;
    if (range === 'custom' && (!customStart || !customEnd)) {
      return lastDashboardRef.current;
    }
    const computed = cachedRead.computeAdminDashboardFromData(
      snapshot.users,
      snapshot.tenants,
      snapshot.activityLogs,
      {
        range,
        startDate: range === 'custom' ? customStart : undefined,
        endDate: range === 'custom' ? customEnd : undefined,
      }
    );
    lastDashboardRef.current = computed;
    return computed;
  }, [snapshot, range, customStart, customEnd]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          {[
            { id: 'today', label: 'Today' },
            { id: 'week', label: 'This Week' },
            { id: 'month', label: 'This Month' },
            { id: 'year', label: 'This Year' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                range === opt.id
                  ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {range === 'custom' ? (
            <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full sm:w-36 h-10 sm:h-9 text-sm sm:text-xs"
              />
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full sm:w-36 h-10 sm:h-9 text-sm sm:text-xs"
              />
            </div>
          ) : null}
          <Button size="sm" onClick={() => navigate('/admin/users/new')} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Create Customer Account
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {loading || !s ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-3.5 sm:p-5 space-y-2">
              <Skeleton className="h-4 w-24 sm:w-28" />
              <Skeleton className="h-7 w-28 sm:w-32" />
            </Card>
          ))
        ) : (
          <>
            <Card className="p-3.5 sm:p-5">
              <div className="text-[11px] sm:text-xs font-medium text-zinc-500">
                Registered Businesses
              </div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums truncate">
                {s.totalBusinesses}
              </div>
              <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                {s.activeAccounts} active · {s.inactiveAccounts} inactive
              </div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-[11px] sm:text-xs font-medium text-zinc-500">
                DRONA Subscription Revenue (MRR)
              </div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-[#F57C00] truncate">
                {formatINR(s.dronaSubscriptionRevenue)}
              </div>
              <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                Actual platform SaaS revenue (active plans)
              </div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-[11px] sm:text-xs font-medium text-zinc-500">
                Customer Invoiced GMV (Platform-Wide)
              </div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums truncate">
                {formatINR(s.platformInvoicedValue)}
              </div>
              <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                Customer-billed volume (not DRONA revenue)
              </div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-[11px] sm:text-xs font-medium text-zinc-500">
                Customer Payments Recorded
              </div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                {formatINR(s.platformPaymentsRecorded)}
              </div>
              <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                {s.totalInvoicesGenerated} invoices · {s.totalQuotationsGenerated} quotations
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Platform Usage Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Billing & Settlement Volume</CardTitle>
          <CardDescription>
            Customer-generated invoice volume vs settled payments across all tenant workspaces
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-56 sm:h-72 w-full" />
          ) : data && data.usageSeries.length > 0 ? (
            <div className="h-56 sm:h-72 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.usageSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                  <Bar
                    dataKey="invoicedValue"
                    name="Customer Invoiced GMV"
                    fill="#F57C00"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="paymentsRecorded"
                    name="Customer Payments"
                    fill="#18181B"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 sm:h-64 flex items-center justify-center text-xs text-zinc-500">
              No platform document volume in selected range.
            </div>
          )}
        </CardContent>
      </Card>

      {!analyticsOnly && data ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card className="lg:col-span-7">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Recently Registered Businesses</CardTitle>
                <CardDescription>Tenant workspaces and billing volume</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/admin/users')}>
                Manage All
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.recentBusinesses.map((b) => (
                  <button
                    key={b.uid}
                    type="button"
                    onClick={() => navigate(`/admin/users/${b.uid}`)}
                    className="w-full text-left p-4 flex items-center justify-between gap-3 active:bg-zinc-50 dark:active:bg-zinc-900 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                          {b.businessName}
                        </span>
                        <AccountStatusLabel status={b.status} />
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 truncate">
                        {b.ownerName} · {formatDate(b.createdAt)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {formatINR(b.totalSales)}
                      </div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {b.invoiceCount} inv / {b.quotationCount} quo
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Business</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Docs</TableHead>
                      <TableHead className="text-right">Billed GMV</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentBusinesses.map((b) => (
                      <TableRow
                        key={b.uid}
                        className="cursor-pointer"
                        onClick={() => navigate(`/admin/users/${b.uid}`)}
                      >
                        <TableCell>
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {b.businessName}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {b.ownerName} · {formatDate(b.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <AccountStatusLabel status={b.status} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {b.invoiceCount} inv / {b.quotationCount} quo
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-semibold">
                          {formatINR(b.totalSales)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Recent Platform Activity</CardTitle>
                <CardDescription>Audited actions & impersonation events</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/admin/activity')}>
                Full Log
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.recentActivity.map((log) => (
                <div
                  key={log.id}
                  className="border-b border-zinc-100 pb-2.5 last:border-0 text-xs dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {log.summary}
                    </span>
                    {log.impersonationSessionId ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-zinc-500">
                    {log.actorEmail} · {formatDateTime(log.createdAt)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
