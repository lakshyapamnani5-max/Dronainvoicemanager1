import * as React from 'react';
import {
  Building2,
  Camera,
  CheckCircle2,
  Download,
  Edit2,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
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
import { useAuth } from '../../contexts/AuthContext';
import {
  cachedRead,
  gstinApi,
  purchasesApi,
  suppliersApi,
} from '../../lib/api';
import { generatePurchasePdf } from '../../lib/pdfGenerator';
import { exportToCsv, exportToExcel, formatDate } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import { INDIAN_STATES, getStateCode, getStateFromGstin } from '../../shared/indianStates';
import type {
  Purchase,
  PurchaseAnalyticsData,
  PurchasePayment,
  Supplier,
} from '../../shared/types';
import { EmptyState } from '../../components/AppShell';
import { PurchaseStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

const PURCHASE_STATUS_COLORS: Record<string, string> = {
  paid: '#16A34A',
  partially_paid: '#D97706',
  unpaid: '#F57C00',
  overdue: '#DC2626',
  draft: '#71717A',
};

const PURCHASE_TYPE_LABEL: Record<string, string> = {
  gst: 'GST Purchase',
  non_gst: 'Non-GST',
  import: 'Import (IGST)',
  composition: 'Composition',
};

export function PurchasesDashboardPage({
  initialTab = 'overview',
  navigate,
}: {
  initialTab?: 'overview' | 'bills' | 'suppliers';
  navigate: (path: string) => void;
}) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const profile = session?.businessProfile || null;
  const { notify } = useToast();

  const readCacheSnapshot = React.useCallback((uid?: string) => {
    if (!uid) return null;
    const hasPur = cachedRead.hasTenantCollectionData(uid, 'purchases');
    const hasPay = cachedRead.hasTenantCollectionData(uid, 'purchasePayments');
    const hasSup = cachedRead.hasTenantCollectionData(uid, 'suppliers');
    if (!hasPur && !hasPay && !hasSup) return null;
    const e = cachedRead.getTenantEntry(uid);
    return {
      purchases: e.purchases as Purchase[],
      purchasePayments: e.purchasePayments as PurchasePayment[],
      suppliers: e.suppliers as Supplier[],
      complete: hasPur && hasPay && hasSup,
    };
  }, []);

  const initialSnap = React.useMemo(
    () => readCacheSnapshot(tenantUid),
    [tenantUid, readCacheSnapshot]
  );

  const [snapshot, setSnapshot] = React.useState<{
    purchases: Purchase[];
    purchasePayments: PurchasePayment[];
    suppliers: Supplier[];
  }>(() => ({
    purchases: initialSnap?.purchases || [],
    purchasePayments: initialSnap?.purchasePayments || [],
    suppliers: initialSnap?.suppliers || [],
  }));
  const [loading, setLoading] = React.useState(() => !initialSnap?.complete);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'bills' | 'suppliers'>(initialTab);

  // Overview analytics filters
  const [range, setRange] = React.useState('all');
  const [customStart, setCustomStart] = React.useState('');
  const [customEnd, setCustomEnd] = React.useState('');
  const lastAnalyticsRef = React.useRef<PurchaseAnalyticsData | null>(null);

  // Bills tab filters
  const [billSearch, setBillSearch] = React.useState('');
  const [billStatus, setBillStatus] = React.useState('all');
  const [billSupplierId, setBillSupplierId] = React.useState('all');
  const [billStartDate, setBillStartDate] = React.useState('');
  const [billEndDate, setBillEndDate] = React.useState('');
  const [billPage, setBillPage] = React.useState(1);
  const billPageSize = 12;

  // Delete Bill Confirmation Modal
  const [deleteTargetBill, setDeleteTargetBill] = React.useState<Purchase | null>(null);
  const [deletingBill, setDeletingBill] = React.useState(false);

  // Suppliers tab state
  const [supSearch, setSupSearch] = React.useState('');
  const [showArchivedSuppliers, setShowArchivedSuppliers] = React.useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = React.useState(false);
  const [editingSupplier, setEditingSupplier] = React.useState<Supplier | null>(null);
  const [savingSupplier, setSavingSupplier] = React.useState(false);
  const [fetchingGstin, setFetchingGstin] = React.useState(false);
  const [supForm, setSupForm] = React.useState({
    name: '',
    companyName: '',
    gstin: '',
    phone: '',
    email: '',
    billingAddress: '',
    state: 'Maharashtra',
    stateCode: '27',
    notes: '',
  });

  // Delete Supplier Confirmation Modal
  const [deleteTargetSup, setDeleteTargetSup] = React.useState<Supplier | null>(null);
  const [deletingSup, setDeletingSup] = React.useState(false);

  // Supplier History Modal
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyData, setHistoryData] = React.useState<{
    supplier: Supplier;
    purchases: Purchase[];
    payments: PurchasePayment[];
  } | null>(null);

  const loadAll = React.useCallback(
    async (silent = false) => {
      if (!tenantUid) return;
      if (!silent) setLoading(true);
      try {
        await purchasesApi.getAnalytics({ range: 'all' });
        const next = readCacheSnapshot(tenantUid);
        if (next) {
          setSnapshot({
            purchases: next.purchases,
            purchasePayments: next.purchasePayments,
            suppliers: next.suppliers,
          });
        }
      } catch (err) {
        if (!silent) {
          notify('error', err instanceof Error ? err.message : 'Failed to load purchases data');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tenantUid, readCacheSnapshot, notify]
  );

  React.useEffect(() => {
    if (initialSnap) {
      setSnapshot({
        purchases: initialSnap.purchases,
        purchasePayments: initialSnap.purchasePayments,
        suppliers: initialSnap.suppliers,
      });
      setLoading(!initialSnap.complete);
    }
    // Load locally first; only query Firebase if local cache is incomplete or missing
    if (!initialSnap?.complete) {
      void loadAll(false);
    }
  }, [initialSnap, loadAll]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (
        changed.has('purchases') ||
        changed.has('purchasePayments') ||
        changed.has('suppliers')
      ) {
        const next = readCacheSnapshot(tenantUid);
        if (next) {
          setSnapshot({
            purchases: next.purchases,
            purchasePayments: next.purchasePayments,
            suppliers: next.suppliers,
          });
        }
      }
    });
  }, [tenantUid, readCacheSnapshot]);

  const analytics = React.useMemo<PurchaseAnalyticsData>(() => {
    if (range === 'custom' && (!customStart || !customEnd) && lastAnalyticsRef.current) {
      return lastAnalyticsRef.current;
    }
    const computed = cachedRead.computePurchaseAnalyticsFromData(
      snapshot.purchases,
      snapshot.purchasePayments,
      snapshot.suppliers,
      {
        range,
        startDate: range === 'custom' ? customStart : undefined,
        endDate: range === 'custom' ? customEnd : undefined,
      }
    );
    lastAnalyticsRef.current = computed;
    return computed;
  }, [snapshot, range, customStart, customEnd]);

  const enrichedSuppliers = React.useMemo(
    () =>
      cachedRead.enrichSuppliersWithStats(snapshot.suppliers, snapshot.purchases, {
        includeArchived: true,
      }),
    [snapshot.suppliers, snapshot.purchases]
  );

  const activeSuppliers = React.useMemo(
    () => enrichedSuppliers.filter((s) => !s.archived),
    [enrichedSuppliers]
  );

  const filteredSuppliers = React.useMemo(() => {
    const q = supSearch.trim().toLowerCase();
    return enrichedSuppliers.filter((s) => {
      if (!showArchivedSuppliers && s.archived) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.companyName.toLowerCase().includes(q) ||
        s.gstin.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      );
    });
  }, [enrichedSuppliers, supSearch, showArchivedSuppliers]);

  const filteredBills = React.useMemo(() => {
    const q = billSearch.trim().toLowerCase();
    return snapshot.purchases.filter((p) => {
      if (billStatus !== 'all') {
        if (billStatus === 'advance' || billStatus === 'advances' || billStatus === 'advance_paid') {
          if (!(p.status === 'partially_paid' || (p.amountPaid > 0 && p.balanceDue > 0))) return false;
        } else if (p.status !== billStatus) {
          return false;
        }
      }
      if (billSupplierId !== 'all' && p.supplierId !== billSupplierId) return false;
      if (billStartDate && p.billDate < billStartDate) return false;
      if (billEndDate && p.billDate > billEndDate) return false;
      if (q) {
        const hay = [
          p.billNumber,
          p.referenceNumber,
          p.supplierSnapshot.companyName,
          p.supplierSnapshot.name,
          p.supplierSnapshot.gstin,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [snapshot.purchases, billSearch, billStatus, billSupplierId, billStartDate, billEndDate]);

  const totalBillPages = Math.max(1, Math.ceil(filteredBills.length / billPageSize));
  const paginatedBills = filteredBills.slice(
    (billPage - 1) * billPageSize,
    billPage * billPageSize
  );

  const buildExportRows = () =>
    filteredBills.map((p) => ({
      'Bill Number': p.billNumber,
      'PO / Reference': p.referenceNumber || '',
      Supplier: p.supplierSnapshot.companyName || p.supplierSnapshot.name,
      'Supplier GSTIN': p.supplierSnapshot.gstin || '',
      'Bill Date': p.billDate,
      'Due Date': p.dueDate,
      'Purchase Type': PURCHASE_TYPE_LABEL[p.purchaseType] || p.purchaseType,
      Status: p.status,
      'Taxable Value': p.taxableAmount,
      CGST: p.cgstTotal,
      SGST: p.sgstTotal,
      IGST: p.igstTotal,
      'Additional Charges': p.additionalCharges,
      'Grand Total': p.grandTotal,
      'Amount Paid': p.amountPaid,
      'Balance Due': p.balanceDue,
      'OCR Used': p.ocrUsed ? 'Yes' : 'No',
    }));

  const handleExportExcel = () => {
    exportToExcel(
      `drona-purchases-${new Date().toISOString().slice(0, 10)}`,
      'Purchases',
      buildExportRows()
    );
  };

  const handleExportCsv = () => {
    exportToCsv(`drona-purchases-${new Date().toISOString().slice(0, 10)}`, buildExportRows());
  };

  const handleConfirmDeleteBill = async () => {
    if (!deleteTargetBill) return;
    setDeletingBill(true);
    try {
      await purchasesApi.remove(deleteTargetBill.id);
      notify('success', `Purchase bill ${deleteTargetBill.billNumber} deleted`);
      setDeleteTargetBill(null);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete purchase bill');
    } finally {
      setDeletingBill(false);
    }
  };

  const openCreateSupplier = () => {
    setEditingSupplier(null);
    setSupForm({
      name: '',
      companyName: '',
      gstin: '',
      phone: '',
      email: '',
      billingAddress: '',
      state: profile?.state || 'Maharashtra',
      stateCode: getStateCode(profile?.state || 'Maharashtra'),
      notes: '',
    });
    setSupplierModalOpen(true);
  };

  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setSupForm({
      name: s.name,
      companyName: s.companyName,
      gstin: s.gstin,
      phone: s.phone,
      email: s.email,
      billingAddress: s.billingAddress,
      state: s.state || 'Maharashtra',
      stateCode: s.stateCode || getStateCode(s.state || 'Maharashtra'),
      notes: s.notes,
    });
    setSupplierModalOpen(true);
  };

  const handleFetchSupplierGstin = async () => {
    const clean = supForm.gstin.trim().toUpperCase();
    if (!clean) {
      notify('error', 'Enter a 15-character supplier GSTIN first');
      return;
    }
    setFetchingGstin(true);
    try {
      const { result, fromCache } = await gstinApi.lookup(clean);
      const d = result.data;
      const derivedState = d.address_details?.state || getStateFromGstin(clean) || supForm.state;
      setSupForm((prev) => ({
        ...prev,
        gstin: clean,
        companyName: d.trade_name || d.legal_name || prev.companyName,
        name: d.legal_name || d.trade_name || prev.name,
        billingAddress: d.address || prev.billingAddress,
        state: derivedState,
        stateCode: d.state_code || getStateCode(derivedState) || prev.stateCode,
      }));
      notify(
        'success',
        fromCache
          ? 'Supplier details filled from cached GSTIN record'
          : 'Supplier details fetched from GSTIN portal'
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'GSTIN lookup failed');
    } finally {
      setFetchingGstin(false);
    }
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSupplier(true);
    try {
      if (editingSupplier) {
        await suppliersApi.update(editingSupplier.id, supForm);
        notify('success', 'Supplier updated');
      } else {
        await suppliersApi.create(supForm);
        notify('success', 'Supplier added');
      }
      setSupplierModalOpen(false);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save supplier');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleConfirmDeleteSupplier = async () => {
    if (!deleteTargetSup) return;
    setDeletingSup(true);
    try {
      const res = await suppliersApi.remove(deleteTargetSup.id);
      notify(
        'success',
        res.mode === 'archived'
          ? 'Supplier archived (existing purchase bills preserved)'
          : 'Supplier deleted'
      );
      setDeleteTargetSup(null);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to remove supplier');
    } finally {
      setDeletingSup(false);
    }
  };

  const handleOpenSupplierHistory = async (sup: Supplier) => {
    setHistoryLoading(true);
    setHistoryData({
      supplier: sup,
      purchases: snapshot.purchases.filter((p) => p.supplierId === sup.id),
      payments: snapshot.purchasePayments.filter((p) => p.supplierId === sup.id),
    });
    try {
      const res = await suppliersApi.get(sup.id);
      setHistoryData(res);
    } catch {
      // Keep local snapshot view if offline
    } finally {
      setHistoryLoading(false);
    }
  };

  const s = analytics.summary;

  return (
    <div className="space-y-6">
      {/* Header Toolbar & Two Prominent Create Options */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900 overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-[#F57C00] text-white'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bills')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'bills'
                ? 'bg-[#F57C00] text-white'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            Purchase Bills ({snapshot.purchases.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('suppliers')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'suppliers'
                ? 'bg-[#F57C00] text-white'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Suppliers ({activeSuppliers.length})
          </button>
        </div>

        {/* Two Prominent Purchase Creation Actions */}
        <div className="grid grid-cols-2 sm:flex items-center gap-2.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto border-[#F57C00]/40 text-[#E65100] hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950/30"
            onClick={() => navigate('/purchases/scan')}
          >
            <Camera className="h-4 w-4" />
            Scan Purchase Bill
          </Button>
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => navigate('/purchases/new')}
          >
            <Plus className="h-4 w-4" />
            Create Manually
          </Button>
        </div>
      </div>

      {/* ==================== OVERVIEW TAB ==================== */}
      {activeTab === 'overview' ? (
        <div className="space-y-6">
          {/* Date Filter Bar */}
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

            {range === 'custom' ? (
              <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full sm:w-36 h-10 sm:h-9 text-xs"
                  aria-label="Custom start date"
                />
                <span className="hidden sm:inline text-xs text-zinc-400">to</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full sm:w-36 h-10 sm:h-9 text-xs"
                  aria-label="Custom end date"
                />
              </div>
            ) : null}
          </div>

          {/* 5 Required KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} className="p-4 sm:p-5 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="h-3 w-20" />
                </Card>
              ))
            ) : (
              <>
                <Card className="p-3.5 sm:p-5">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Total Purchases
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 truncate">
                    {formatINR(s.totalPurchases)}
                  </div>
                  <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                    Recorded supplier bills
                  </div>
                </Card>

                <Card className="p-3.5 sm:p-5">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Total Purchase Bills
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                    {s.totalPurchaseBills}
                  </div>
                  <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                    {s.draftBills > 0 ? `${s.draftBills} draft saved` : 'Finalized bills'}
                  </div>
                </Card>

                <Card className="p-3.5 sm:p-5">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Amount Paid
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                    {formatINR(s.amountPaid)}
                  </div>
                  <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                    Paid to suppliers
                  </div>
                </Card>

                <Card className="p-3.5 sm:p-5">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Outstanding Payables
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-[#F57C00] truncate">
                    {formatINR(s.outstandingPayables)}
                  </div>
                  <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                    {s.overduePayables > 0
                      ? `Overdue: ${formatINR(s.overduePayables)}`
                      : 'Pending supplier dues'}
                  </div>
                </Card>

                <Card className="p-3.5 sm:p-5 col-span-2 md:col-span-1">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Total Vendors
                  </div>
                  <div className="mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                    {s.totalVendors}
                  </div>
                  <div className="mt-1 text-[11px] sm:text-xs text-zinc-500">
                    Active suppliers
                  </div>
                </Card>
              </>
            )}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle>Purchase &amp; Payables Trend</CardTitle>
                <CardDescription>
                  Purchase bill value compared against payments settled to suppliers
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-56 sm:h-72 w-full" />
                ) : analytics.purchaseSeries.length > 0 ? (
                  <div className="h-56 sm:h-72 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.purchaseSeries}>
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
                        <Bar
                          dataKey="purchased"
                          name="Purchases"
                          fill="#F57C00"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="paid"
                          name="Paid to Vendors"
                          fill="#18181B"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-72 flex items-center justify-center text-xs text-zinc-500">
                    No purchase bills recorded in this date window.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Payment Status Distribution</CardTitle>
                <CardDescription>Breakdown across unpaid, partial, paid &amp; overdue bills</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-72 w-full" />
                ) : analytics.statusBreakdown.length > 0 ? (
                  <div className="space-y-4">
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analytics.statusBreakdown}
                            dataKey="amount"
                            nameKey="status"
                            innerRadius={42}
                            outerRadius={68}
                            paddingAngle={2}
                          >
                            {analytics.statusBreakdown.map((entry) => (
                              <Cell
                                key={entry.status}
                                fill={PURCHASE_STATUS_COLORS[entry.status] || '#71717A'}
                              />
                            ))}
                          </Pie>
                          <Tooltip formatter={(val) => formatINR(Number(val ?? 0))} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {analytics.statusBreakdown.map((item) => (
                        <div
                          key={item.status}
                          className="flex items-center justify-between text-xs border-b border-zinc-100 pb-1.5 last:border-0 dark:border-zinc-800"
                        >
                          <PurchaseStatusLabel status={item.status} />
                          <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                            {item.count} · {formatINR(item.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-72 flex items-center justify-center text-xs text-zinc-500">
                    No purchase status records yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Suppliers & Recent Bills */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Top Suppliers by Purchase Value</CardTitle>
                  <CardDescription>Highest volume vendors in selected period</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('suppliers')}
                >
                  Vendors
                </Button>
              </CardHeader>
              <CardContent>
                {analytics.topSuppliers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Bills</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.topSuppliers.map((sup) => (
                        <TableRow
                          key={sup.supplierId}
                          className="cursor-pointer"
                          onClick={() => {
                            const found = enrichedSuppliers.find((x) => x.id === sup.supplierId);
                            if (found) void handleOpenSupplierHistory(found);
                          }}
                        >
                          <TableCell>
                            <div className="font-medium text-zinc-900 dark:text-zinc-100">
                              {sup.companyName || sup.name}
                            </div>
                            {sup.gstin ? (
                              <div className="text-[11px] font-mono text-zinc-500">{sup.gstin}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {sup.billCount}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums font-semibold">
                            {formatINR(sup.totalPurchases)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="py-8 text-center text-xs text-zinc-500">
                    No vendor purchase records in this period.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Recent Purchase Bills</CardTitle>
                  <CardDescription>Latest supplier invoices and scanned drafts</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setActiveTab('bills')}>
                  View All
                </Button>
              </CardHeader>
              <CardContent>
                {analytics.recentPurchases.length > 0 ? (
                  <>
                    <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800 -mx-1">
                      {analytics.recentPurchases.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => navigate(`/purchases/${p.id}`)}
                          className="w-full text-left py-3 px-1 flex items-center justify-between gap-3 active:bg-zinc-50 dark:active:bg-zinc-800/40 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                {p.billNumber}
                              </span>
                              <PurchaseStatusLabel status={p.status} />
                            </div>
                            <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200 mt-0.5">
                              {p.supplierSnapshot.companyName || p.supplierSnapshot.name}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                              {formatDate(p.billDate)}
                              {p.ocrUsed ? ' · OCR' : ''}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-sm font-semibold tabular-nums">
                              {formatINR(p.grandTotal)}
                            </div>
                            {p.balanceDue > 0 ? (
                              <div className="font-mono text-[11px] text-[#F57C00] tabular-nums">
                                Due {formatINR(p.balanceDue)}
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
                            <TableHead>Bill #</TableHead>
                            <TableHead>Supplier</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {analytics.recentPurchases.map((p) => (
                            <TableRow
                              key={p.id}
                              className="cursor-pointer"
                              onClick={() => navigate(`/purchases/${p.id}`)}
                            >
                              <TableCell className="font-mono font-medium">
                                <div className="flex items-center gap-1.5">
                                  <span>{p.billNumber}</span>
                                  {p.ocrUsed ? (
                                    <span title="Extracted with PaddleOCR" className="inline-flex">
                                      <Sparkles className="h-3 w-3 text-[#F57C00]" />
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>
                                {p.supplierSnapshot.companyName || p.supplierSnapshot.name}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-zinc-500">
                                {formatDate(p.billDate)}
                              </TableCell>
                              <TableCell>
                                <PurchaseStatusLabel status={p.status} />
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatINR(p.grandTotal)}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums font-semibold">
                                {formatINR(p.balanceDue)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={ShoppingCart}
                    title="No purchase bills recorded yet"
                    description="Create a purchase bill manually or scan a supplier invoice with PaddleOCR."
                    actionLabel="Create First Purchase"
                    onAction={() => navigate('/purchases/new')}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ==================== PURCHASE BILLS TAB ==================== */}
      {activeTab === 'bills' ? (
        <div className="space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 flex-1">
              <div className="relative col-span-2 sm:w-64">
                <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
                <Input
                  value={billSearch}
                  onChange={(e) => {
                    setBillSearch(e.target.value);
                    setBillPage(1);
                  }}
                  placeholder="Search bill #, PO #, supplier, GSTIN..."
                  className="pl-9"
                />
              </div>
              <Select
                value={billStatus}
                onChange={(e) => {
                  setBillStatus(e.target.value);
                  setBillPage(1);
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
              </Select>
              <Select
                value={billSupplierId}
                onChange={(e) => {
                  setBillSupplierId(e.target.value);
                  setBillPage(1);
                }}
                className="w-full sm:w-48"
              >
                <option value="all">All Suppliers</option>
                {enrichedSuppliers.map((sup) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.companyName || sup.name}
                  </option>
                ))}
              </Select>
              <Input
                type="date"
                value={billStartDate}
                onChange={(e) => {
                  setBillStartDate(e.target.value);
                  setBillPage(1);
                }}
                className="w-full sm:w-36"
                aria-label="Start date"
              />
              <Input
                type="date"
                value={billEndDate}
                onChange={(e) => {
                  setBillEndDate(e.target.value);
                  setBillPage(1);
                }}
                className="w-full sm:w-36"
                aria-label="End date"
              />
            </div>

            <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCsv}>
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-sm text-zinc-500">Loading purchase bills...</div>
              ) : filteredBills.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Receipt}
                    title="No purchase bills match filters"
                    description="Try clearing filters, or record a new supplier bill manually or via PaddleOCR."
                    actionLabel="Create Manual Purchase"
                    onAction={() => navigate('/purchases/new')}
                  />
                </div>
              ) : (
                <>
                  {/* Mobile Card List - continuous scroll, no pagination breaks */}
                  <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredBills.map((p) => (
                      <div key={p.id} className="p-4 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => navigate(`/purchases/${p.id}`)}
                                className="font-mono text-sm font-semibold text-[#F57C00] hover:underline cursor-pointer"
                              >
                                {p.billNumber}
                              </button>
                              <PurchaseStatusLabel status={p.status} />
                            </div>
                            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                              {p.supplierSnapshot.companyName || p.supplierSnapshot.name}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                              Bill: {formatDate(p.billDate)} · Due: {formatDate(p.dueDate)}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-sm font-bold tabular-nums">
                              {formatINR(p.grandTotal)}
                            </div>
                            <div className="font-mono text-[11px] text-zinc-500 tabular-nums">
                              Due {formatINR(p.balanceDue)}
                            </div>
                            {p.amountPaid > 0 ? (
                              <div className="font-mono text-[10px] text-emerald-600 font-medium tabular-nums">
                                Paid {formatINR(p.amountPaid)}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-1.5 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/purchases/${p.id}`)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/purchases/${p.id}/edit`)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => generatePurchasePdf(p, profile)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600"
                            onClick={() => setDeleteTargetBill(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bill #</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Bill Date</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Grand Total</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedBills.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono font-medium">
                              <button
                                type="button"
                                onClick={() => navigate(`/purchases/${p.id}`)}
                                className="inline-flex items-center gap-1.5 text-[#F57C00] hover:underline cursor-pointer"
                              >
                                {p.billNumber}
                                {p.ocrUsed ? (
                                  <span title="Scanned via PaddleOCR" className="inline-flex">
                                    <Sparkles className="h-3 w-3" />
                                  </span>
                                ) : null}
                              </button>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                {p.supplierSnapshot.companyName || p.supplierSnapshot.name}
                              </div>
                              {p.supplierSnapshot.gstin ? (
                                <div className="text-[11px] font-mono text-zinc-500">
                                  {p.supplierSnapshot.gstin}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs text-zinc-600 dark:text-zinc-400">
                              {PURCHASE_TYPE_LABEL[p.purchaseType] || p.purchaseType}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-zinc-500">
                              {formatDate(p.billDate)}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-zinc-500">
                              {formatDate(p.dueDate)}
                            </TableCell>
                            <TableCell>
                              <PurchaseStatusLabel status={p.status} />
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums font-medium">
                              {formatINR(p.grandTotal)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                              {formatINR(p.amountPaid)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums font-semibold">
                              {formatINR(p.balanceDue)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  title="View purchase bill"
                                  onClick={() => navigate(`/purchases/${p.id}`)}
                                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  title="Edit purchase bill"
                                  onClick={() => navigate(`/purchases/${p.id}/edit`)}
                                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  title="Download PDF"
                                  onClick={() => generatePurchasePdf(p, profile)}
                                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                                >
                                  <Download className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete purchase bill"
                                  onClick={() => setDeleteTargetBill(p)}
                                  className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination - visible on desktop, mobile has continuous scroll */}
                  {totalBillPages > 1 ? (
                    <div className="hidden md:flex items-center justify-between px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500">
                      <span>
                        Page {billPage} of {totalBillPages} ({filteredBills.length} bills)
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={billPage <= 1}
                          onClick={() => setBillPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={billPage >= totalBillPages}
                          onClick={() => setBillPage((p) => Math.min(totalBillPages, p + 1))}
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
      ) : null}

      {/* ==================== SUPPLIERS CRM TAB ==================== */}
      {activeTab === 'suppliers' ? (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1 sm:max-w-lg">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
                <Input
                  value={supSearch}
                  onChange={(e) => setSupSearch(e.target.value)}
                  placeholder="Search supplier name, GSTIN, phone, email..."
                  className="pl-9"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchivedSuppliers}
                  onChange={(e) => setShowArchivedSuppliers(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#F57C00]"
                />
                Show archived
              </label>
            </div>

            <Button size="sm" onClick={openCreateSupplier}>
              <Plus className="h-4 w-4" />
              Add Supplier
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {filteredSuppliers.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Building2}
                    title="No suppliers found"
                    description="Add vendors manually or auto-fetch supplier profile details using their 15-digit GSTIN."
                    actionLabel="Add First Supplier"
                    onAction={openCreateSupplier}
                  />
                </div>
              ) : (
                <>
                  {/* Mobile Supplier Cards */}
                  <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredSuppliers.map((sup) => (
                      <div key={sup.id} className="p-4 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                              {sup.companyName || sup.name}
                              {sup.archived ? (
                                <span className="ml-2 text-[11px] font-normal text-zinc-400">
                                  (Archived)
                                </span>
                              ) : null}
                            </div>
                            {sup.gstin ? (
                              <div className="text-xs font-mono text-zinc-500 mt-0.5">
                                {sup.gstin}
                              </div>
                            ) : null}
                            <div className="text-xs text-zinc-500 mt-0.5">
                              {sup.state} ({sup.stateCode}) · {sup.billCount || 0} bills
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-sm font-bold tabular-nums">
                              {formatINR(sup.totalPurchases || 0)}
                            </div>
                            <div className="font-mono text-[11px] text-[#F57C00] tabular-nums">
                              Payable {formatINR(sup.outstandingBalance || 0)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleOpenSupplierHistory(sup)}
                          >
                            <History className="h-3.5 w-3.5" />
                            History
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditSupplier(sup)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          {!sup.archived ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600"
                              onClick={() => setDeleteTargetSup(sup)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Supplier Table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Supplier</TableHead>
                          <TableHead>GSTIN</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead className="text-right">Bills</TableHead>
                          <TableHead className="text-right">Total Purchases</TableHead>
                          <TableHead className="text-right">Total Paid</TableHead>
                          <TableHead className="text-right">Outstanding</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSuppliers.map((sup) => (
                          <TableRow key={sup.id}>
                            <TableCell>
                              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                {sup.companyName || sup.name}
                                {sup.archived ? (
                                  <span className="ml-2 text-[11px] text-zinc-400">(Archived)</span>
                                ) : null}
                              </div>
                              {sup.companyName && sup.name !== sup.companyName ? (
                                <div className="text-xs text-zinc-500">{sup.name}</div>
                              ) : null}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {sup.gstin || '—'}
                            </TableCell>
                            <TableCell className="text-xs text-zinc-600 dark:text-zinc-400">
                              {sup.state} ({sup.stateCode})
                            </TableCell>
                            <TableCell className="text-xs text-zinc-500">
                              <div>{sup.phone || '—'}</div>
                              <div className="truncate max-w-[160px]">{sup.email}</div>
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {sup.billCount || 0}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums font-medium">
                              {formatINR(sup.totalPurchases || 0)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                              {formatINR(sup.totalPaid || 0)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums font-semibold text-[#F57C00]">
                              {formatINR(sup.outstandingBalance || 0)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  title="View purchase history"
                                  onClick={() => void handleOpenSupplierHistory(sup)}
                                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                                >
                                  <History className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  title="Edit supplier"
                                  onClick={() => openEditSupplier(sup)}
                                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                {!sup.archived ? (
                                  <button
                                    type="button"
                                    title="Delete or archive supplier"
                                    onClick={() => setDeleteTargetSup(sup)}
                                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 cursor-pointer"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                ) : null}
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
        </div>
      ) : null}

      {/* ==================== MODALS ==================== */}

      {/* Add / Edit Supplier Modal */}
      <Dialog
        open={supplierModalOpen}
        onClose={() => setSupplierModalOpen(false)}
        title={editingSupplier ? 'Edit Supplier' : 'Add Supplier'}
        description="Save vendor contact, GSTIN, and state details for accurate purchase tax calculation"
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSaveSupplier} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Supplier GSTIN (Optional for Non-GST / Composition)</Label>
            <div className="flex gap-2">
              <Input
                value={supForm.gstin}
                onChange={(e) =>
                  setSupForm((prev) => {
                    const gstin = e.target.value.toUpperCase();
                    const derived = getStateFromGstin(gstin);
                    return {
                      ...prev,
                      gstin,
                      state: derived || prev.state,
                      stateCode: derived ? getStateCode(derived) : prev.stateCode,
                    };
                  })
                }
                placeholder="27AABCU9603R1ZM"
                className="font-mono uppercase"
              />
              <Button
                type="button"
                variant="outline"
                disabled={fetchingGstin || !supForm.gstin.trim()}
                onClick={handleFetchSupplierGstin}
                className="shrink-0"
              >
                {fetchingGstin ? 'Fetching...' : 'Fetch GSTIN'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Business / Legal Name *</Label>
              <Input
                value={supForm.companyName}
                onChange={(e) => setSupForm({ ...supForm, companyName: e.target.value })}
                placeholder="ABC Distributors Pvt Ltd"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Person Name *</Label>
              <Input
                required={!supForm.companyName.trim()}
                value={supForm.name}
                onChange={(e) => setSupForm({ ...supForm, name: e.target.value })}
                placeholder="Rajesh Sharma"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={supForm.phone}
                onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })}
                placeholder="+91 98XXXXXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={supForm.email}
                onChange={(e) => setSupForm({ ...supForm, email: e.target.value })}
                placeholder="accounts@supplier.com"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Billing Address</Label>
            <Textarea
              rows={2}
              value={supForm.billingAddress}
              onChange={(e) => setSupForm({ ...supForm, billingAddress: e.target.value })}
              placeholder="Street, Industrial Area, City, PIN"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>State</Label>
              <Select
                value={supForm.state}
                onChange={(e) =>
                  setSupForm({
                    ...supForm,
                    state: e.target.value,
                    stateCode: getStateCode(e.target.value),
                  })
                }
              >
                {INDIAN_STATES.map((st) => (
                  <option key={st.code} value={st.name}>
                    {st.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>State Code</Label>
              <Input
                value={supForm.stateCode}
                onChange={(e) => setSupForm({ ...supForm, stateCode: e.target.value })}
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              value={supForm.notes}
              onChange={(e) => setSupForm({ ...supForm, notes: e.target.value })}
              placeholder="Payment terms, vendor category, bank note"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSupplierModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={savingSupplier}>
              {savingSupplier
                ? 'Saving...'
                : editingSupplier
                  ? 'Save Changes'
                  : 'Create Supplier'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Bill Confirmation Modal */}
      <Dialog
        open={Boolean(deleteTargetBill)}
        onClose={() => setDeleteTargetBill(null)}
        title="Delete Purchase Bill"
        description="This action permanently deletes the purchase bill, linked payments, and scanned attachment."
      >
        {deleteTargetBill ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              Delete bill <strong className="font-mono">{deleteTargetBill.billNumber}</strong> from{' '}
              <strong>
                {deleteTargetBill.supplierSnapshot.companyName ||
                  deleteTargetBill.supplierSnapshot.name}
              </strong>{' '}
              ({formatINR(deleteTargetBill.grandTotal)})?
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTargetBill(null)}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={deletingBill}
                onClick={handleConfirmDeleteBill}
              >
                {deletingBill ? 'Deleting...' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Delete / Archive Supplier Confirmation Modal */}
      <Dialog
        open={Boolean(deleteTargetSup)}
        onClose={() => setDeleteTargetSup(null)}
        title="Remove Supplier"
        description="Suppliers with existing purchase bills are archived to preserve accounting history; unused suppliers are deleted."
      >
        {deleteTargetSup ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              Proceed with removing{' '}
              <strong>{deleteTargetSup.companyName || deleteTargetSup.name}</strong>?
              {(deleteTargetSup.billCount || 0) > 0
                ? ` (${deleteTargetSup.billCount} linked bills will be preserved via archiving)`
                : ''}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTargetSup(null)}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={deletingSup}
                onClick={handleConfirmDeleteSupplier}
              >
                {deletingSup ? 'Processing...' : 'Confirm Remove'}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Supplier Purchase History Modal */}
      <Dialog
        open={Boolean(historyData)}
        onClose={() => setHistoryData(null)}
        title={
          historyData
            ? `${historyData.supplier.companyName || historyData.supplier.name} — Ledger`
            : 'Supplier Ledger'
        }
        description={
          historyData?.supplier.gstin
            ? `GSTIN: ${historyData.supplier.gstin} · ${historyData.supplier.state}`
            : historyData?.supplier.state
        }
        maxWidthClass="max-w-3xl"
      >
        {historyData ? (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500">Total Purchased</div>
                <div className="mt-1 font-mono text-sm font-bold">
                  {formatINR(historyData.supplier.totalPurchases || 0)}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500">Total Paid</div>
                <div className="mt-1 font-mono text-sm font-bold text-emerald-600">
                  {formatINR(historyData.supplier.totalPaid || 0)}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="text-[11px] text-zinc-500">Outstanding</div>
                <div className="mt-1 font-mono text-sm font-bold text-[#F57C00]">
                  {formatINR(historyData.supplier.outstandingBalance || 0)}
                </div>
              </div>
            </div>

            {historyLoading ? (
              <div className="text-xs text-zinc-500">Refreshing ledger...</div>
            ) : null}

            <div className="space-y-2">
              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Purchase Bills ({historyData.purchases.length})
              </div>
              {historyData.purchases.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-500 dark:border-zinc-800">
                  No purchase bills recorded for this supplier yet.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
                  {historyData.purchases.map((bill) => (
                    <button
                      key={bill.id}
                      type="button"
                      onClick={() => {
                        setHistoryData(null);
                        navigate(`/purchases/${bill.id}`);
                      }}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#F57C00]">
                            {bill.billNumber}
                          </span>
                          <PurchaseStatusLabel status={bill.status} />
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          {formatDate(bill.billDate)} · Due {formatDate(bill.dueDate)}
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <div className="text-xs font-semibold">{formatINR(bill.grandTotal)}</div>
                        {bill.balanceDue > 0 ? (
                          <div className="text-[11px] text-[#F57C00]">
                            Due {formatINR(bill.balanceDue)}
                          </div>
                        ) : (
                          <div className="text-[11px] text-emerald-600 inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Settled
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setHistoryData(null);
                  navigate('/purchases/new');
                }}
              >
                <FileText className="h-3.5 w-3.5" />
                Record New Bill
              </Button>
              <Button size="sm" variant="outline" onClick={() => setHistoryData(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
