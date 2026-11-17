import * as React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Layers,
  Lock,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cachedRead, gstExportsApi, invoicesApi } from '../../lib/api';
import { formatINR } from '../../shared/gstCalculator';
import { INDIAN_STATES, getStateByCode } from '../../shared/indianStates';
import type { Invoice } from '../../shared/types';
import {
  type GstExportRecord,
  type GstPeriodOption,
  type GstReturnConfig,
  type GstReturnPeriodType,
  type GstTransactionCategory,
  type Gstr1ComprehensiveSummary,
  type Gstr1SummarySection,
} from '../../shared/gstnTypes';
import {
  compileGstr1Summary,
  generatePeriodOptions,
} from '../../lib/gstnClassifier';
import { validateGstr1Data } from '../../lib/gstnValidator';
import {
  downloadGstr1JsonFile,
  generateGstr1JsonPayload,
  getGstr1ExportFilename,
} from '../../lib/gstr1Generator';
import { exportToExcel } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';
import { loadHsnSacMaster } from '../../lib/hsnSacService';

interface GstReportsPageProps {
  navigate: (path: string) => void;
}

type TabType = 'summary' | 'sections' | 'hsn' | 'docs' | 'validation' | 'history';

export function GstReportsPage({ navigate }: GstReportsPageProps) {
  const { session } = useAuth();
  const { notify } = useToast();
  const profile = session?.businessProfile;
  const tenantUid = session?.effectiveUser.uid;

  // Initialize HSN/SAC master in background
  React.useEffect(() => {
    void loadHsnSacMaster();
  }, []);

  // Return Configuration State
  const [financialYear, setFinancialYear] = React.useState('2026-27');
  const [frequency, setFrequency] = React.useState<GstReturnPeriodType>('monthly');
  const [gstin, setGstin] = React.useState(profile?.gstin || '');
  const [previousFyTurnover, setPreviousFyTurnover] = React.useState<number>(0);
  const [currentFyTurnover, setCurrentFyTurnover] = React.useState<number>(0);

  // Period options based on FY and frequency
  const periodOptions = React.useMemo(
    () => generatePeriodOptions(financialYear, frequency),
    [financialYear, frequency]
  );

  const [selectedPeriodCode, setSelectedPeriodCode] = React.useState<string>(() => {
    // Default to current month or first option
    return periodOptions[0]?.code || '042026';
  });

  // Keep selectedPeriodCode valid when periodOptions change
  React.useEffect(() => {
    const valid = periodOptions.some((p) => p.code === selectedPeriodCode);
    if (!valid && periodOptions[0]) {
      setSelectedPeriodCode(periodOptions[0].code);
    }
  }, [periodOptions, selectedPeriodCode]);

  // Sync profile GSTIN if user didn't enter one
  React.useEffect(() => {
    if (!gstin && profile?.gstin) {
      setGstin(profile.gstin);
    }
  }, [profile?.gstin, gstin]);

  // UI state
  const [activeTab, setActiveTab] = React.useState<TabType>('summary');
  const [selectedSection, setSelectedSection] = React.useState<GstTransactionCategory>('B2B');
  const [sectionSearch, setSectionSearch] = React.useState('');
  const [hsnSearch, setHsnSearch] = React.useState('');
  const [loadingInvoices, setLoadingInvoices] = React.useState(false);
  const [allInvoices, setAllInvoices] = React.useState<Invoice[]>(() =>
    tenantUid ? cachedRead.getTenantEntry(tenantUid).invoices : []
  );

  // Export history state
  const [historyList, setHistoryList] = React.useState<GstExportRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [viewJsonModalOpen, setViewJsonModalOpen] = React.useState(false);
  const [selectedJsonView, setSelectedJsonView] = React.useState<string>('');

  // Load Invoices
  const loadInvoices = React.useCallback(async () => {
    if (!tenantUid) return;
    setLoadingInvoices(true);
    try {
      await invoicesApi.list();
      const updated = cachedRead.getTenantEntry(tenantUid).invoices;
      setAllInvoices(updated);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to fetch invoices');
    } finally {
      setLoadingInvoices(false);
    }
  }, [tenantUid, notify]);

  // Load Export History
  const loadHistory = React.useCallback(async () => {
    if (!tenantUid) return;
    setLoadingHistory(true);
    try {
      const res = await gstExportsApi.list();
      setHistoryList(res.exports || []);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, [tenantUid]);

  React.useEffect(() => {
    void loadInvoices();
    void loadHistory();
  }, [loadInvoices, loadHistory]);

  // Subscribe to live cache updates
  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('invoices')) {
        setAllInvoices(cachedRead.getTenantEntry(tenantUid).invoices);
      }
    });
  }, [tenantUid]);

  // Config object
  const currentConfig: GstReturnConfig = React.useMemo(
    () => ({
      gstin: gstin.trim().toUpperCase(),
      financialYear,
      frequency,
      periodCode: selectedPeriodCode,
      previousFyTurnover,
      currentFyTurnover,
    }),
    [gstin, financialYear, frequency, selectedPeriodCode, previousFyTurnover, currentFyTurnover]
  );

  const sellerState = profile?.state || 'Maharashtra';
  const businessName = profile?.businessName || 'My Business';

  // Compile Comprehensive Summary
  const summary = React.useMemo(
    () => compileGstr1Summary(allInvoices, currentConfig, sellerState, businessName),
    [allInvoices, currentConfig, sellerState, businessName]
  );

  // Run Validations
  const validationReport = React.useMemo(
    () => validateGstr1Data(allInvoices, currentConfig, sellerState),
    [allInvoices, currentConfig, sellerState]
  );

  // Handle Download JSON
  const [downloading, setDownloading] = React.useState(false);
  const handleDownloadGstr1 = async () => {
    if (!validationReport.canExport) {
      notify('error', 'Cannot export GSTR-1: Please resolve blocking errors first.');
      setActiveTab('validation');
      return;
    }

    setDownloading(true);
    try {
      const payload = generateGstr1JsonPayload(summary, allInvoices, currentConfig);
      downloadGstr1JsonFile(payload);

      // Save to export history in RTDB
      const filename = getGstr1ExportFilename(payload.gstin, payload.fp);
      const activeIds = summary.transactions.map((t) => t.invoiceId);
      const jsonStr = JSON.stringify(payload, null, 2);

      await gstExportsApi.save({
        gstin: payload.gstin,
        period: payload.fp,
        periodLabel: summary.periodLabel,
        financialYear: currentConfig.financialYear,
        frequency: currentConfig.frequency,
        filename,
        invoiceCount: summary.activeInvoicesCount,
        totalTaxableValue: summary.totalTaxableValue,
        totalTax: summary.totalTax,
        totalCgst: summary.totalCgst,
        totalSgst: summary.totalSgst,
        totalIgst: summary.totalIgst,
        totalCess: summary.totalCess,
        grandTotal: summary.totalInvoiceValue,
        validationStatus: validationReport.warningCount > 0 ? 'has_warnings' : 'valid',
        exportedInvoiceIds: activeIds,
        jsonPayload: jsonStr,
      });

      notify('success', `GSTR-1 JSON downloaded successfully (${filename})`);
      void loadHistory();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to generate GSTR-1 JSON');
    } finally {
      setDownloading(false);
    }
  };

  // Handle Export Summary to Excel
  const handleExportExcel = () => {
    const rows = Object.values(summary.sections).map((s) => ({
      'GSTN Table': s.tableNumber,
      'Section Name': s.title,
      'Section Code': s.code,
      'Invoice Count': s.invoiceCount,
      'Taxable Value (₹)': s.taxableValue,
      'CGST (₹)': s.cgstAmount,
      'SGST (₹)': s.sgstAmount,
      'IGST (₹)': s.igstAmount,
      'Cess (₹)': s.cessAmount,
      'Total Tax (₹)': s.totalTax,
      'Total Invoice Value (₹)': s.totalInvoiceValue,
    }));

    exportToExcel(
      `GSTR1_Summary_${currentConfig.gstin}_${currentConfig.periodCode}`,
      'GSTR-1 Summary',
      rows
    );
    notify('success', 'Summary exported to Excel');
  };

  // Filtered transactions for Section Viewer
  const filteredSectionTransactions = React.useMemo(() => {
    return summary.transactions
      .filter((t) => t.category === selectedSection)
      .filter((t) => {
        if (!sectionSearch.trim()) return true;
        const q = sectionSearch.toLowerCase();
        return (
          t.invoiceNumber.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          t.customerGstin.toLowerCase().includes(q) ||
          t.posStateName.toLowerCase().includes(q)
        );
      });
  }, [summary.transactions, selectedSection, sectionSearch]);

  // Filtered HSN entries
  const filteredHsnSummary = React.useMemo(() => {
    if (!hsnSearch.trim()) return summary.hsnSummary;
    const q = hsnSearch.toLowerCase();
    return summary.hsnSummary.filter(
      (h) => h.hsn_sc.toLowerCase().includes(q) || h.desc.toLowerCase().includes(q)
    );
  }, [summary.hsnSummary, hsnSearch]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner / Disclaimer with GST Portal Instructions */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#F57C00]/10 p-2 text-[#F57C00] shrink-0 mt-0.5 sm:mt-0">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                GST Portal Offline Upload Workflow
              </h4>
              <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                Download the JSON file and upload directly to your portal account:{' '}
                <span className="font-mono font-semibold bg-white/70 dark:bg-zinc-900/60 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800">
                  GST Portal → Services → Returns → Returns Dashboard → Select Period → GSTR-1 → Prepare Offline → Upload JSON
                </span>
              </p>
            </div>
          </div>
          <a
            href="https://services.gst.gov.in"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F57C00] hover:underline shrink-0"
          >
            <span>Open GST Portal</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Return Configuration Bar */}
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-800/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#F57C00]" />
                <span>GSTR-1 Return Configuration</span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  GSTN V1.1 Compatible
                </span>
              </CardTitle>
              <CardDescription className="text-xs">
                Select your business GSTIN and tax period to automatically classify outward invoices.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadInvoices}
                disabled={loadingInvoices}
                className="h-8 text-xs cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingInvoices ? 'animate-spin' : ''}`} />
                <span>Refresh Invoices</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 items-end">
            {/* GSTIN input / selector */}
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                <span>Business GSTIN</span>
                {profile?.gstin ? (
                  <span className="text-[10px] text-zinc-500 font-normal">
                    {profile.businessName}
                  </span>
                ) : null}
              </Label>
              <Input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="27AABCV4321M1Z2"
                className="font-mono uppercase text-xs h-9 tracking-wider"
              />
            </div>

            {/* Financial Year */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Financial Year
              </Label>
              <Select
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                className="text-xs h-9"
              >
                <option value="2026-27">FY 2026-27</option>
                <option value="2025-26">FY 2025-26</option>
                <option value="2024-25">FY 2024-25</option>
                <option value="2023-24">FY 2023-24</option>
              </Select>
            </div>

            {/* Filing Frequency */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Filing Frequency
              </Label>
              <Select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as GstReturnPeriodType)}
                className="text-xs h-9"
              >
                <option value="monthly">Monthly Return</option>
                <option value="quarterly">Quarterly (QRMP)</option>
              </Select>
            </div>

            {/* Return Period Code */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Return Period
              </Label>
              <Select
                value={selectedPeriodCode}
                onChange={(e) => setSelectedPeriodCode(e.target.value)}
                className="text-xs h-9 font-medium"
              >
                {periodOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3.5 border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] font-medium text-zinc-500">Active Invoices</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {summary.activeInvoicesCount}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">
            {summary.cancelledInvoicesCount > 0
              ? `${summary.cancelledInvoicesCount} cancelled excluded`
              : 'Period total'}
          </div>
        </Card>

        <Card className="p-3.5 border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] font-medium text-zinc-500">Total Taxable Value</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-1 font-mono">
            {formatINR(summary.totalTaxableValue)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">Base amount</div>
        </Card>

        <Card className="p-3.5 border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] font-medium text-zinc-500">IGST (Inter-State)</div>
          <div className="text-lg font-bold text-[#F57C00] mt-1 font-mono">
            {formatINR(summary.totalIgst)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">Integrated tax</div>
        </Card>

        <Card className="p-3.5 border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] font-medium text-zinc-500">CGST + SGST (Intra)</div>
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400 mt-1 font-mono">
            {formatINR(summary.totalCgst + summary.totalSgst)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">
            CGST: {formatINR(summary.totalCgst)}
          </div>
        </Card>

        <Card className="p-3.5 border-zinc-200 dark:border-zinc-800">
          <div className="text-[11px] font-medium text-zinc-500">Total Invoice Value</div>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
            {formatINR(summary.totalInvoiceValue)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">Total Outward Supplies</div>
        </Card>

        <Card className="p-3.5 border-zinc-200 dark:border-zinc-800 flex flex-col justify-between">
          <div className="text-[11px] font-medium text-zinc-500">GSTN Audit Status</div>
          <div className="mt-1">
            {validationReport.canExport ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Ready to Export</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{validationReport.errorCount} Errors</span>
              </span>
            )}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">
            {validationReport.warningCount > 0 ? `${validationReport.warningCount} warnings` : '0 warnings'}
          </div>
        </Card>
      </div>

      {/* Main Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Selected Period: <strong className="text-zinc-900 dark:text-zinc-100">{summary.periodLabel}</strong> ({summary.periodCode})
          </span>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="text-xs font-mono text-zinc-500">
            GSTIN: <strong>{currentConfig.gstin || 'NOT SPECIFIED'}</strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            className="h-9 text-xs cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400" />
            <span>Export to Excel</span>
          </Button>

          <Button
            size="sm"
            onClick={handleDownloadGstr1}
            disabled={downloading || !validationReport.canExport}
            className="h-9 text-xs font-semibold bg-[#F57C00] hover:bg-[#E65100] text-white shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            <span>Download GSTR-1 JSON</span>
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <nav className="flex space-x-2 sm:space-x-4 overflow-x-auto no-scrollbar">
          {[
            { id: 'summary', label: 'GSTR-1 Overview', icon: Layers },
            { id: 'sections', label: 'Section Records', icon: FileText },
            { id: 'hsn', label: 'HSN/SAC Summary (Table 12)', icon: Package },
            { id: 'docs', label: 'Documents Issued (Table 13)', icon: FileCheck },
            {
              id: 'validation',
              label: `Validation Report ${
                validationReport.errorCount > 0 ? `(${validationReport.errorCount})` : ''
              }`,
              icon: validationReport.errorCount > 0 ? AlertCircle : ShieldCheck,
              alert: validationReport.errorCount > 0,
            },
            { id: 'history', label: 'Export History & Audit', icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'border-[#F57C00] text-[#F57C00]'
                    : tab.alert
                    ? 'border-transparent text-rose-600 dark:text-rose-400 hover:text-rose-700'
                    : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ================================= TAB 1: GSTR-1 SUMMARY ================================= */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          <Card className="border-zinc-200 dark:border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                GSTR-1 Outward Supply Tables (GSTN Schema Breakdown)
              </CardTitle>
              <CardDescription className="text-xs">
                Classified transactions grouped by statutory GSTN sections according to current tax rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs bg-zinc-50 dark:bg-zinc-900/60">
                      <TableHead className="w-16">Table</TableHead>
                      <TableHead>Section Description</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Taxable Value</TableHead>
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                      <TableHead className="text-right">IGST</TableHead>
                      <TableHead className="text-right">Total Tax</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                      <TableHead className="text-center w-20">Inspect</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="text-xs">
                    {Object.values(summary.sections).map((s) => (
                      <TableRow key={s.code} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40">
                        <TableCell className="font-mono font-medium text-zinc-600 dark:text-zinc-400">
                          {s.tableNumber}
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</div>
                          <div className="text-[11px] text-zinc-500 font-mono">{s.code}</div>
                        </TableCell>
                        <TableCell className="text-right font-medium">{s.invoiceCount}</TableCell>
                        <TableCell className="text-right font-mono">{formatINR(s.taxableValue)}</TableCell>
                        <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                          {formatINR(s.cgstAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                          {formatINR(s.sgstAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[#F57C00]">
                          {formatINR(s.igstAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatINR(s.totalTax)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatINR(s.totalInvoiceValue)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedSection(s.code as GstTransactionCategory);
                              setActiveTab('sections');
                            }}
                            className="h-7 px-2 text-xs text-[#F57C00] cursor-pointer"
                          >
                            <span>View</span>
                            <ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals Row */}
                    <TableRow className="bg-zinc-100/70 font-semibold dark:bg-zinc-800/60 border-t-2 border-zinc-200 dark:border-zinc-700">
                      <TableCell colSpan={2} className="text-xs uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                        Grand Total (All Sections)
                      </TableCell>
                      <TableCell className="text-right">{summary.activeInvoicesCount}</TableCell>
                      <TableCell className="text-right font-mono">{formatINR(summary.totalTaxableValue)}</TableCell>
                      <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                        {formatINR(summary.totalCgst)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                        {formatINR(summary.totalSgst)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[#F57C00]">
                        {formatINR(summary.totalIgst)}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatINR(summary.totalTax)}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {formatINR(summary.totalInvoiceValue)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================================= TAB 2: SECTION RECORDS ================================= */}
      {activeTab === 'sections' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Section Switcher */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              {(
                [
                  { id: 'B2B', label: 'B2B (Table 4)' },
                  { id: 'B2CL', label: 'B2C Large (Table 5)' },
                  { id: 'B2CS', label: 'B2C Small (Table 7)' },
                  { id: 'CDNR', label: 'CDNR (Table 9B)' },
                  { id: 'CDNUR', label: 'CDNUR (Table 9B)' },
                  { id: 'EXP', label: 'Export (Table 6A)' },
                  { id: 'NIL', label: 'Nil/Exempt (Table 8)' },
                ] as const
              ).map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    setSelectedSection(sec.id);
                    setSectionSearch('');
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    selectedSection === sec.id
                      ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  {sec.label}
                </button>
              ))}
            </div>

            {/* Search within section */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <Input
                value={sectionSearch}
                onChange={(e) => setSectionSearch(e.target.value)}
                placeholder="Search invoice or customer..."
                className="pl-8 text-xs h-9"
              />
            </div>
          </div>

          <Card className="border-zinc-200 dark:border-zinc-800">
            <CardHeader className="py-3 px-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  {summary.sections[selectedSection]?.title} ({filteredSectionTransactions.length} records)
                </CardTitle>
                <div className="text-xs font-mono text-zinc-500">
                  Taxable:{' '}
                  <strong className="text-zinc-900 dark:text-zinc-100">
                    {formatINR(summary.sections[selectedSection]?.taxableValue || 0)}
                  </strong>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredSectionTransactions.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  No transactions classified under {selectedSection} for this return period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs bg-zinc-50 dark:bg-zinc-900/60">
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Recipient GSTIN</TableHead>
                        <TableHead>Place of Supply</TableHead>
                        <TableHead>Supply Type</TableHead>
                        <TableHead className="text-right">Taxable (₹)</TableHead>
                        <TableHead className="text-right">Tax (₹)</TableHead>
                        <TableHead className="text-right">Total (₹)</TableHead>
                        <TableHead className="text-center w-16">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {filteredSectionTransactions.map((tx) => (
                        <TableRow key={tx.invoiceId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                          <TableCell className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                            {tx.invoiceNumber}
                          </TableCell>
                          <TableCell className="text-zinc-600 dark:text-zinc-400">
                            {tx.invoiceDate}
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate" title={tx.customerName}>
                            {tx.customerName}
                          </TableCell>
                          <TableCell className="font-mono">
                            {tx.customerGstin ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                {tx.customerGstin}
                              </span>
                            ) : (
                              <span className="text-zinc-400">Unregistered (URP)</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono font-semibold mr-1">{tx.posCode}</span>
                            <span className="text-zinc-500">
                              {getStateByCode(tx.posCode) || tx.posStateName}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                tx.isInterState
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              }`}
                            >
                              {tx.isInterState ? 'Inter-State' : 'Intra-State'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatINR(tx.taxableAmount)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[#F57C00]">
                            {formatINR(tx.totalTax)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatINR(tx.invoiceValue)}
                          </TableCell>
                          <TableCell className="text-center">
                            <button
                              type="button"
                              onClick={() => navigate(`/invoices/${tx.invoiceId}`)}
                              className="text-zinc-500 hover:text-[#F57C00] p-1 cursor-pointer"
                              title="View Invoice"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================================= TAB 3: HSN/SAC SUMMARY ================================= */}
      {activeTab === 'hsn' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                HSN / SAC Summary of Outward Supplies (GSTN Table 12)
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Aggregated by HSN/SAC code and applicable GST rate as required by GST statutory reporting.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <Input
                value={hsnSearch}
                onChange={(e) => setHsnSearch(e.target.value)}
                placeholder="Search HSN code or description..."
                className="pl-8 text-xs h-9"
              />
            </div>
          </div>

          <Card className="border-zinc-200 dark:border-zinc-800">
            <CardContent className="p-0">
              {filteredHsnSummary.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  No HSN/SAC line items found for the selected period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs bg-zinc-50 dark:bg-zinc-900/60">
                        <TableHead className="w-12">#</TableHead>
                        <TableHead className="w-28">HSN / SAC</TableHead>
                        <TableHead className="min-w-[200px]">Description</TableHead>
                        <TableHead className="text-center w-20">UQC</TableHead>
                        <TableHead className="text-right">Total Qty</TableHead>
                        <TableHead className="text-right">Taxable Value (₹)</TableHead>
                        <TableHead className="text-right w-16">Rate</TableHead>
                        <TableHead className="text-right">IGST (₹)</TableHead>
                        <TableHead className="text-right">CGST (₹)</TableHead>
                        <TableHead className="text-right">SGST (₹)</TableHead>
                        <TableHead className="text-right">Total Tax (₹)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {filteredHsnSummary.map((h) => (
                        <TableRow key={`${h.hsn_sc}-${h.rt}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                          <TableCell className="text-zinc-500 font-mono">{h.num}</TableCell>
                          <TableCell className="font-mono font-semibold text-[#F57C00]">
                            {h.hsn_sc}
                          </TableCell>
                          <TableCell className="text-zinc-800 dark:text-zinc-200 max-w-xs truncate" title={h.desc}>
                            {h.desc}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                              {h.uqc}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">{h.qty}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatINR(h.txval)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">{h.rt}%</TableCell>
                          <TableCell className="text-right font-mono text-[#F57C00]">
                            {formatINR(h.iamt)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                            {formatINR(h.camt)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                            {formatINR(h.samt)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatINR(h.iamt + h.camt + h.samt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================================= TAB 4: DOCUMENTS ISSUED ================================= */}
      {activeTab === 'docs' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Documents Issued Summary (GSTN Table 13)
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Sequence of serial numbers for invoices, credit notes, and debit notes issued during the period.
            </p>
          </div>

          <Card className="border-zinc-200 dark:border-zinc-800">
            <CardContent className="p-0">
              {summary.docSummary.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  No documents found for the selected period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs bg-zinc-50 dark:bg-zinc-900/60">
                        <TableHead>Nature of Document</TableHead>
                        <TableHead>From Serial No.</TableHead>
                        <TableHead>To Serial No.</TableHead>
                        <TableHead className="text-right">Total Number</TableHead>
                        <TableHead className="text-right">Cancelled</TableHead>
                        <TableHead className="text-right font-semibold">Net Issued</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {summary.docSummary.map((cat) =>
                        cat.docs.map((doc, dIdx) => (
                          <TableRow key={`${cat.doc_num}-${dIdx}`}>
                            <TableCell className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {cat.doc_typ}
                            </TableCell>
                            <TableCell className="font-mono text-zinc-700 dark:text-zinc-300">
                              {doc.from}
                            </TableCell>
                            <TableCell className="font-mono text-zinc-700 dark:text-zinc-300">
                              {doc.to}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {doc.totnum}
                            </TableCell>
                            <TableCell className="text-right font-mono text-rose-600 dark:text-rose-400">
                              {doc.canc}
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {doc.net_issue}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================================= TAB 5: VALIDATION REPORT ================================= */}
      {activeTab === 'validation' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                GST Pre-Export Validation Engine
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Comprehensive audit checking GSTIN checksums, date bounds, POS codes, HSN digit thresholds, and tax math.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                {validationReport.errorCount} Blocking Errors
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {validationReport.warningCount} Warnings
              </span>
            </div>
          </div>

          {validationReport.issues.length === 0 ? (
            <Card className="p-8 border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
              <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200 mt-2">
                All Validations Passed Successfully
              </h4>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1 max-w-md mx-auto">
                No blocking errors or warnings detected for {summary.periodLabel}. You can safely download the GSTR-1 JSON file.
              </p>
              <Button
                size="sm"
                onClick={handleDownloadGstr1}
                className="mt-4 bg-[#F57C00] hover:bg-[#E65100] text-white text-xs cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                <span>Download GSTR-1 JSON</span>
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {validationReport.issues.map((iss) => (
                <div
                  key={iss.id}
                  className={`flex items-start justify-between gap-3 p-3.5 rounded-lg border text-xs ${
                    iss.severity === 'error'
                      ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-200'
                      : 'border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {iss.severity === 'error' ? (
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold uppercase tracking-wider text-[10px]">
                          [{iss.code}]
                        </span>
                        {iss.invoiceNumber ? (
                          <span className="font-mono font-semibold bg-white/70 dark:bg-zinc-900/60 px-1.5 py-0.2 rounded border">
                            {iss.invoiceNumber}
                          </span>
                        ) : null}
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                          Section: {iss.section}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed">{iss.message}</p>
                    </div>
                  </div>

                  {iss.invoiceId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/invoices/${iss.invoiceId}/edit`)}
                      className="shrink-0 h-7 text-[11px] bg-white dark:bg-zinc-900 cursor-pointer"
                    >
                      <span>{iss.actionText || 'Edit Invoice'}</span>
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  ) : iss.field === 'gstin' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/business-profile')}
                      className="shrink-0 h-7 text-[11px] bg-white dark:bg-zinc-900 cursor-pointer"
                    >
                      <span>Edit Profile</span>
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================= TAB 6: EXPORT HISTORY ================================= */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                GSTR-1 JSON Export History & Audit Trail
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Immutable audit trail of exported GSTR-1 files stored under your secure Firebase workspace.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHistory}
              disabled={loadingHistory}
              className="h-8 text-xs cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 mr-1.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              <span>Refresh History</span>
            </Button>
          </div>

          <Card className="border-zinc-200 dark:border-zinc-800">
            <CardContent className="p-0">
              {historyList.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  No previous GSTR-1 JSON exports recorded yet. Download your first return above!
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs bg-zinc-50 dark:bg-zinc-900/60">
                        <TableHead>Generated At</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>GSTIN</TableHead>
                        <TableHead>Filename</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Taxable Value (₹)</TableHead>
                        <TableHead className="text-right">Total Tax (₹)</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {historyList.map((rec) => (
                        <TableRow key={rec.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                          <TableCell className="text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {new Date(rec.createdAt).toLocaleString('en-IN', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </TableCell>
                          <TableCell className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {rec.periodLabel || rec.period}
                          </TableCell>
                          <TableCell className="font-mono text-zinc-600 dark:text-zinc-400">
                            {rec.gstin}
                          </TableCell>
                          <TableCell className="font-mono text-zinc-800 dark:text-zinc-200 truncate max-w-xs">
                            {rec.filename}
                          </TableCell>
                          <TableCell className="text-right font-medium">{rec.invoiceCount}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatINR(rec.totalTaxableValue)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[#F57C00]">
                            {formatINR(rec.totalTax)}
                          </TableCell>
                          <TableCell className="text-center">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                rec.validationStatus === 'valid'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {rec.validationStatus === 'valid' ? 'Validated' : 'With Warnings'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Re-download JSON */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  try {
                                    const parsed = JSON.parse(rec.jsonPayload);
                                    downloadGstr1JsonFile(parsed);
                                    notify('success', `Downloaded ${rec.filename}`);
                                  } catch {
                                    notify('error', 'Failed to parse stored JSON');
                                  }
                                }}
                                className="h-7 px-2 text-[#F57C00] cursor-pointer"
                                title="Re-download JSON"
                              >
                                <Download className="h-3 w-3 mr-1" />
                                <span>Download</span>
                              </Button>

                              {/* View JSON Modal */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedJsonView(rec.jsonPayload);
                                  setViewJsonModalOpen(true);
                                }}
                                className="h-7 px-2 text-zinc-500 hover:text-zinc-900 cursor-pointer"
                                title="Inspect JSON payload"
                              >
                                <Eye className="h-3 w-3" />
                              </Button>

                              {/* Delete Record */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  if (confirm('Delete this export history record?')) {
                                    await gstExportsApi.delete(rec.id);
                                    notify('success', 'History record deleted');
                                    void loadHistory();
                                  }
                                }}
                                className="h-7 px-2 text-rose-500 hover:text-rose-700 cursor-pointer"
                                title="Delete record"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* JSON Viewer Dialog */}
      <Dialog
        open={viewJsonModalOpen}
        onClose={() => setViewJsonModalOpen(false)}
        title="GSTR-1 JSON Payload Viewer"
        description="Official GSTN Offline Tool Format Payload"
        maxWidthClass="max-w-3xl"
      >
        <div className="space-y-4">
          <pre className="p-3 rounded-lg bg-zinc-950 text-zinc-200 font-mono text-[11px] max-h-96 overflow-y-auto leading-relaxed whitespace-pre-wrap select-all">
            {selectedJsonView}
          </pre>
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(selectedJsonView);
                notify('success', 'JSON copied to clipboard');
              }}
              className="text-xs cursor-pointer"
            >
              Copy to Clipboard
            </Button>
            <Button
              size="sm"
              onClick={() => setViewJsonModalOpen(false)}
              className="text-xs cursor-pointer bg-[#F57C00] hover:bg-[#E65100] text-white"
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
