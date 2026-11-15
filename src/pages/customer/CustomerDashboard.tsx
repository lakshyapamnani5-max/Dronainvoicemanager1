import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, Plus, Receipt } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { analyticsApi, cachedRead } from '../../lib/api';
import { formatINR } from '../../shared/gstCalculator';
import type { Customer, CustomerAnalyticsData, Invoice, Payment, Quotation } from '../../shared/types';
import { formatDate } from '../../lib/utils';
import { EmptyState } from '../../components/AppShell';
import { InvoiceStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const STATUS_COLORS: Record<string, string> = {
  paid: '#16A34A',
  partially_paid: '#D97706',
  unpaid: '#F57C00',
  overdue: '#DC2626',
  draft: '#71717A',
  cancelled: '#A1A1AA',
};

export function CustomerDashboard({ navigate }: { navigate: (path: string) => void }) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const [range, setRange] = React.useState('all');
  const [customStart, setCustomStart] = React.useState('');
  const [customEnd, setCustomEnd] = React.useState('');

  const readCacheSnapshot = React.useCallback((uid?: string) => {
    if (
      !uid ||
      !cachedRead.hasTenantCollectionData(uid, 'invoices') ||
      !cachedRead.hasTenantCollectionData(uid, 'quotations') ||
      !cachedRead.hasTenantCollectionData(uid, 'payments') ||
      !cachedRead.hasTenantCollectionData(uid, 'customers')
    ) {
      return null;
    }
    const e = cachedRead.getTenantEntry(uid);
    return {
      invoices: e.invoices as Invoice[],
      quotations: e.quotations as Quotation[],
      payments: e.payments as Payment[],
      customers: e.customers as Customer[],
    };
  }, []);

  const initialSnap = React.useMemo(() => readCacheSnapshot(tenantUid), [tenantUid, readCacheSnapshot]);
  const [snapshot, setSnapshot] = React.useState<{
    invoices: Invoice[];
    quotations: Quotation[];
    payments: Payment[];
    customers: Customer[];
  } | null>(initialSnap);
  const [loading, setLoading] = React.useState(() => !initialSnap);
  const [error, setError] = React.useState<string | null>(null);
  const lastAnalyticsRef = React.useRef<CustomerAnalyticsData | null>(null);

  const load = React.useCallback(async (silent = false) => {
    if (!tenantUid) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      await analyticsApi.getDashboard({ range: 'all' });
      const next = readCacheSnapshot(tenantUid);
      if (next) setSnapshot(next);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tenantUid, readCacheSnapshot]);

  React.useEffect(() => {
    if (initialSnap) {
      setSnapshot(initialSnap);
      setLoading(false);
    }
    void load(Boolean(initialSnap));
  }, [initialSnap, load]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (
        changed.has('invoices') ||
        changed.has('quotations') ||
        changed.has('payments') ||
        changed.has('customers')
      ) {
        const next = readCacheSnapshot(tenantUid);
        if (next) setSnapshot(next);
      }
    });
  }, [tenantUid, readCacheSnapshot]);

  const data = React.useMemo(() => {
    if (!snapshot) return null;
    if (range === 'custom' && (!customStart || !customEnd)) {
      return lastAnalyticsRef.current;
    }
    const computed = cachedRead.computeCustomerAnalyticsFromData(
      snapshot.invoices,
      snapshot.quotations,
      snapshot.payments,
      snapshot.customers,
      {
        range,
        startDate: range === 'custom' ? customStart : undefined,
        endDate: range === 'custom' ? customEnd : undefined,
      }
    );
    lastAnalyticsRef.current = computed;
    return computed;
  }, [snapshot, range, customStart, customEnd]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-x-auto no-scrollbar max-w-full">
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
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                range === opt.id
                  ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {range === 'custom' ? (
            <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full sm:w-36 h-10 sm:h-9 text-xs"
              />
              <span className="hidden sm:inline text-xs text-zinc-400">to</span>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full sm:w-36 h-10 sm:h-9 text-xs"
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => navigate('/quotations/new')}>
              <Plus className="h-3.5 w-3.5" />
              New Quotation
            </Button>
            <Button size="sm" className="w-full sm:w-auto" onClick={() => navigate('/invoices/new')}>
              <Plus className="h-3.5 w-3.5" />
              New Invoice
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => load(false)}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* 8 Summary Metric Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {loading || !s ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </Card>
          ))
        ) : (
          <>
            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Sales</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 truncate">
                {formatINR(s.totalSales)}
              </div>
              <div className="mt-1 sm:mt-1.5 flex flex-wrap items-center gap-1 text-[11px] sm:text-xs">
                {s.salesGrowthPct >= 0 ? (
                  <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-medium">
                    <ArrowUpRight className="h-3.5 w-3.5" />+{s.salesGrowthPct}%
                  </span>
                ) : (
                  <span className="inline-flex items-center text-red-600 dark:text-red-400 font-medium">
                    <ArrowDownRight className="h-3.5 w-3.5" />
                    {s.salesGrowthPct}%
                  </span>
                )}
                <span className="text-zinc-400">vs prev</span>
              </div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Invoices</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {s.totalInvoices}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-500">Issued documents</div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Amount Received</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                {formatINR(s.totalAmountReceived)}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-500">Settled payments</div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Outstanding</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-[#F57C00] truncate">
                {formatINR(s.totalOutstanding)}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-500">Pending balance</div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Overdue Amount</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 truncate">
                {formatINR(s.overdueAmount)}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-500">Past due balance</div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Total Quotations</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {s.totalQuotations}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-500">Quotes in period</div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Accepted Quotes</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {s.acceptedQuotations}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-500">Approved &amp; converted</div>
            </Card>

            <Card className="p-3.5 sm:p-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Pending Quotes</div>
              <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {s.pendingQuotations}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-zinc-500">Awaiting client</div>
            </Card>
          </>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-8">
          <CardHeader>
            <CardTitle>Revenue & Payment Collection Trend</CardTitle>
            <CardDescription>
              Invoiced value compared against actual collected payments from database records
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-56 sm:h-72 w-full" />
            ) : data && data.salesSeries.length > 0 ? (
              <div className="h-56 sm:h-72 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.salesSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val) => formatINR(Number(val ?? 0))}
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e4e4e7',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="invoiced" name="Invoiced" fill="#F57C00" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="collected" name="Collected" fill="#18181B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-72 flex items-center justify-center text-xs text-zinc-500">
                No invoice activity recorded in this date window.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Invoice Status Distribution</CardTitle>
            <CardDescription>Breakdown by current settlement state</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-72 w-full" />
            ) : data && data.invoiceStatusBreakdown.length > 0 ? (
              <div className="space-y-4">
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.invoiceStatusBreakdown}
                        dataKey="amount"
                        nameKey="status"
                        innerRadius={42}
                        outerRadius={68}
                        paddingAngle={2}
                      >
                        {data.invoiceStatusBreakdown.map((entry) => (
                          <Cell
                            key={entry.status}
                            fill={STATUS_COLORS[entry.status] || '#71717A'}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {data.invoiceStatusBreakdown.map((item) => (
                    <div
                      key={item.status}
                      className="flex items-center justify-between text-xs border-b border-zinc-100 pb-1.5 last:border-0 dark:border-zinc-800"
                    >
                      <InvoiceStatusLabel status={item.status} />
                      <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {item.count} · {formatINR(item.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-72 flex items-center justify-center text-xs text-zinc-500">
                No invoices in selected period.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Customer Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top Customers by Sales</CardTitle>
            <CardDescription>Highest billed clients in selected range</CardDescription>
          </CardHeader>
          <CardContent>
            {data && data.topCustomersBySales.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topCustomersBySales.map((c) => (
                    <TableRow
                      key={c.customerId}
                      className="cursor-pointer"
                      onClick={() => navigate(`/customers/${c.customerId}`)}
                    >
                      <TableCell>
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {c.companyName || c.name}
                        </div>
                        {c.companyName ? (
                          <div className="text-xs text-zinc-500">{c.name}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {c.invoiceCount}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold">
                        {formatINR(c.totalSales)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-8 text-center text-xs text-zinc-500">No sales records yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Customers by Outstanding</CardTitle>
            <CardDescription>Receivables requiring collection follow-up</CardDescription>
          </CardHeader>
          <CardContent>
            {data && data.topCustomersByOutstanding.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topCustomersByOutstanding.map((c) => (
                    <TableRow
                      key={c.customerId}
                      className="cursor-pointer"
                      onClick={() => navigate(`/customers/${c.customerId}`)}
                    >
                      <TableCell>
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {c.companyName || c.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-red-600 dark:text-red-400">
                        {formatINR(c.overdue)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums font-semibold text-[#F57C00]">
                        {formatINR(c.outstanding)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-8 text-center text-xs text-zinc-500">
                All customer balances are settled.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Invoices</CardTitle>
            <CardDescription>Latest issued and draft billing documents</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/invoices')}>
            View All
          </Button>
        </CardHeader>
        <CardContent>
          {data && data.recentInvoices.length > 0 ? (
            <>
              <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800 -mx-1">
                {data.recentInvoices.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                    className="w-full text-left py-3 px-1 flex items-center justify-between gap-3 active:bg-zinc-50 dark:active:bg-zinc-800/40 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {inv.invoiceNumber}
                        </span>
                        <InvoiceStatusLabel status={inv.status} />
                      </div>
                      <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200 mt-0.5">
                        {inv.customerSnapshot.companyName || inv.customerSnapshot.name}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                        {formatDate(inv.invoiceDate)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-semibold tabular-nums">
                        {formatINR(inv.grandTotal)}
                      </div>
                      {inv.balanceDue > 0 ? (
                        <div className="font-mono text-[11px] text-[#F57C00] tabular-nums">
                          Due {formatINR(inv.balanceDue)}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentInvoices.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                      >
                        <TableCell className="font-mono font-medium">{inv.invoiceNumber}</TableCell>
                        <TableCell>{inv.customerSnapshot.companyName || inv.customerSnapshot.name}</TableCell>
                        <TableCell className="font-mono text-xs text-zinc-500">
                          {formatDate(inv.invoiceDate)}
                        </TableCell>
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
              </div>
            </>
          ) : (
            <EmptyState
              icon={Receipt}
              title="No invoices created yet"
              description="Generate your first GST or non-GST invoice to begin tracking sales and payments."
              actionLabel="Create First Invoice"
              onAction={() => navigate('/invoices/new')}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
