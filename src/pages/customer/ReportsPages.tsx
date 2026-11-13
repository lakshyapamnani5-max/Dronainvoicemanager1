import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { analyticsApi, customersApi, subscribeRtdbPath } from '../../lib/api';
import { generateOutstandingPdf } from '../../lib/pdfGenerator';
import { exportToExcel, formatDate } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type { Customer, CustomerAnalyticsData, OutstandingReportRow } from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Select } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

export function OutstandingReportPage({ navigate }: { navigate: (path: string) => void }) {
  const { session } = useAuth();
  const { notify } = useToast();
  const [rows, setRows] = React.useState<OutstandingReportRow[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [filter, setFilter] = React.useState<'all' | 'not_due' | 'overdue'>('all');
  const [customerId, setCustomerId] = React.useState('all');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  const tenantUid = session?.effectiveUser.uid;
  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [repRes, custRes] = await Promise.all([
        analyticsApi.getOutstanding({ filter, customerId, startDate, endDate }),
        customersApi.list(),
      ]);
      setRows(repRes.rows);
      setCustomers(custRes.customers);
    } catch (err) {
      if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load outstanding report');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter, customerId, startDate, endDate, notify]);

  React.useEffect(() => {
    load(false);
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

  const totals = rows.reduce(
    (acc, r) => ({
      invoiced: acc.invoiced + r.totalInvoiced,
      paid: acc.paid + r.amountPaid,
      outstanding: acc.outstanding + r.outstandingBalance,
      overdue: acc.overdue + r.overdueAmount,
    }),
    { invoiced: 0, paid: 0, outstanding: 0, overdue: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            {[
              { id: 'all', label: 'All Outstanding' },
              { id: 'not_due', label: 'Not Due' },
              { id: 'overdue', label: 'Overdue' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id as 'all' | 'not_due' | 'overdue')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  filter === f.id
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="w-48 h-9 text-xs"
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
            className="w-36 h-9 text-xs"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-36 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportToExcel(
                `outstanding-report-${new Date().toISOString().slice(0, 10)}`,
                'Outstanding',
                rows.map((r) => ({
                  Customer: r.companyName || r.customerName,
                  'Total Invoiced': r.totalInvoiced,
                  'Amount Paid': r.amountPaid,
                  'Outstanding Balance': r.outstandingBalance,
                  'Unpaid Invoices': r.unpaidInvoiceCount,
                  'Overdue Amount': r.overdueAmount,
                  'Oldest Due Date': r.oldestDueDate || '',
                }))
              )
            }
          >
            Export Excel
          </Button>
          <Button
            size="sm"
            onClick={() =>
              generateOutstandingPdf(
                session?.businessProfile?.businessName || 'DRONA Business',
                rows
              )
            }
          >
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs text-zinc-500">Total Outstanding Balance</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#F57C00]">
            {formatINR(totals.outstanding)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500">Total Overdue</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-red-600">
            {formatINR(totals.overdue)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-zinc-500">Accounts with Open Balance</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums">{rows.length}</div>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500">Calculating receivables...</div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileSpreadsheet}
                title="No outstanding balances"
                description="All customer invoices matching these filters are paid in full."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer Name</TableHead>
                  <TableHead className="text-right">Total Invoiced</TableHead>
                  <TableHead className="text-right">Amount Paid</TableHead>
                  <TableHead className="text-right">Outstanding Balance</TableHead>
                  <TableHead className="text-right">Unpaid Invoices</TableHead>
                  <TableHead className="text-right">Overdue Amount</TableHead>
                  <TableHead>Oldest Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.customerId}
                    className="cursor-pointer"
                    onClick={() => navigate(`/customers/${r.customerId}`)}
                  >
                    <TableCell>
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {r.companyName || r.customerName}
                      </div>
                      {r.companyName ? (
                        <div className="text-xs text-zinc-500">{r.customerName}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(r.totalInvoiced)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-emerald-600">
                      {formatINR(r.amountPaid)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold text-[#F57C00]">
                      {formatINR(r.outstandingBalance)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.unpaidInvoiceCount}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-red-600">
                      {formatINR(r.overdueAmount)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-500">
                      {formatDate(r.oldestDueDate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SalesReportsPage() {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const { notify } = useToast();
  const [range, setRange] = React.useState('year');
  const [customStart, setCustomStart] = React.useState('');
  const [customEnd, setCustomEnd] = React.useState('');
  const [data, setData] = React.useState<CustomerAnalyticsData | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadSales = React.useCallback(
    (silent = false) => {
      if (range === 'custom' && (!customStart || !customEnd)) return;
      if (!silent) setLoading(true);
      analyticsApi
        .getDashboard({
          range,
          startDate: range === 'custom' ? customStart : undefined,
          endDate: range === 'custom' ? customEnd : undefined,
        })
        .then((res) => setData(res))
        .catch((err) => {
          if (!silent) notify('error', err instanceof Error ? err.message : 'Failed to load report');
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [range, customStart, customEnd, notify]
  );

  React.useEffect(() => {
    loadSales(false);
  }, [loadSales]);

  React.useEffect(() => {
    if (!tenantUid) return;
    if (range === 'custom' && (!customStart || !customEnd)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeRtdbPath(`tenants/${tenantUid}`, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadSales(true), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [tenantUid, range, customStart, customEnd, loadSales]);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          {[
            { id: 'today', label: 'Daily' },
            { id: 'week', label: 'Weekly' },
            { id: 'month', label: 'Monthly' },
            { id: 'year', label: 'Yearly' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                range === opt.id
                  ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {range === 'custom' ? (
            <>
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-36 h-9 text-xs"
              />
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-36 h-9 text-xs"
              />
            </>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportToExcel(
                `sales-report-${range}`,
                'Sales',
                (data?.salesSeries || []).map((s) => ({
                  Period: s.period,
                  'Invoices Count': s.invoiceCount,
                  'Invoiced Amount': s.invoiced,
                  'Payments Collected': s.collected,
                }))
              )
            }
          >
            Export Excel
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Download className="h-4 w-4" />
            Print / Save PDF
          </Button>
        </div>
      </div>

      {loading || !data ? (
        <div className="p-8 text-sm text-zinc-500">Generating sales report...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card className="p-5">
              <div className="text-xs text-zinc-500">Period Sales</div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums">
                {formatINR(data.summary.totalSales)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-zinc-500">Previous Period</div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums">
                {formatINR(data.summary.previousPeriodSales)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-zinc-500">Collections</div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums text-emerald-600">
                {formatINR(data.summary.totalAmountReceived)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-zinc-500">Receivables</div>
              <div className="mt-2 text-xl font-bold font-mono tabular-nums text-[#F57C00]">
                {formatINR(data.summary.totalOutstanding)}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Sales & Collection Trajectory</CardTitle>
              <CardDescription>Period-by-period invoiced revenue vs cash collected</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.salesSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                    <Area
                      type="monotone"
                      dataKey="invoiced"
                      name="Invoiced"
                      stroke="#F57C00"
                      fill="#F57C00"
                      fillOpacity={0.14}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="collected"
                      name="Collected"
                      stroke="#16A34A"
                      fill="#16A34A"
                      fillOpacity={0.12}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer-Wise Sales Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
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
                    <TableRow key={c.customerId}>
                      <TableCell className="font-medium">{c.companyName || c.name}</TableCell>
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
