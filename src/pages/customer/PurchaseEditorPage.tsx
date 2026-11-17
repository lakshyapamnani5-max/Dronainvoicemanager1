import * as React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  Loader2,
  Plus,
  Save,
  ScanLine,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  cachedRead,
  gstinApi,
  purchasesApi,
  rateCardApi,
  suppliersApi,
} from '../../lib/api';
import { computePurchaseTotals, formatINR } from '../../shared/gstCalculator';
import {
  INDIAN_STATES,
  getStateCode,
  getStateFromGstin,
  isValidGstinChecksum,
} from '../../shared/indianStates';
import {
  clearStagedPurchaseScan,
  getStagedPurchaseScan,
  type StagedPurchaseScanPayload,
} from '../../lib/purchaseScanBridge';
import type {
  DiscountType,
  OcrConfidenceLevel,
  OcrFieldValidation,
  PaymentMethod,
  Purchase,
  PurchaseLineItemInput,
  PurchaseType,
  RateCardItem,
  Supplier,
  TaxPricingMode,
  TaxSupplyMode,
} from '../../shared/types';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { PurchasePreviewDialog } from './PurchasePreviewDialog';
import { HsnSacSelector } from '../../components/HsnSacSelector';

function emptyItem(defaultTaxRate = 18): PurchaseLineItemInput {
  return {
    name: '',
    description: '',
    hsnSac: '',
    quantity: 1,
    unit: 'Nos',
    rate: 0,
    discountType: 'percent',
    discountValue: 0,
    taxRate: defaultTaxRate,
  };
}

function OcrBadge({ validation }: { validation?: OcrFieldValidation }) {
  if (!validation) return null;
  const pct =
    validation.confidence !== null && validation.confidence !== undefined
      ? ` ${Math.round(validation.confidence * 100)}%`
      : '';
  if (validation.level === 'high') {
    return (
      <span
        title={validation.message || 'High OCR confidence'}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-3 w-3" />
        Verified{pct}
      </span>
    );
  }
  if (validation.level === 'review') {
    return (
      <span
        title={validation.message || 'Verify value against bill'}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
      >
        <AlertTriangle className="h-3 w-3" />
        Review{pct}
      </span>
    );
  }
  return (
    <span
      title={validation.message || 'Missing or failed validation'}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
    >
      <AlertTriangle className="h-3 w-3" />
      {validation.message ? 'Check' : 'Missing'}
    </span>
  );
}

export function PurchaseEditorPage({
  editId,
  fromScan = false,
  navigate,
}: {
  editId?: string;
  fromScan?: boolean;
  navigate: (path: string) => void;
}) {
  const { session } = useAuth();
  const { notify } = useToast();
  const profile = session?.businessProfile;
  const recipientState = profile?.state || 'Maharashtra';
  const tenantUid = session?.effectiveUser.uid || '';

  const [suppliers, setSuppliers] = React.useState<Supplier[]>(() =>
    tenantUid ? cachedRead.getTenantEntry(tenantUid).suppliers.filter((s) => !s.archived) : []
  );
  const [rateCardItems, setRateCardItems] = React.useState<RateCardItem[]>(() =>
    tenantUid ? cachedRead.getTenantEntry(tenantUid).rateCard.filter((r) => r.isActive) : []
  );
  const [loadingInit, setLoadingInit] = React.useState(Boolean(editId));
  const [saving, setSaving] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  // Staged PaddleOCR scan state
  const [stagedScan, setStagedScan] = React.useState<StagedPurchaseScanPayload | null>(() =>
    fromScan ? getStagedPurchaseScan() : null
  );
  const [ocrWarnings, setOcrWarnings] = React.useState<string[]>([]);
  const [fieldValidation, setFieldValidation] = React.useState<Record<string, OcrFieldValidation>>({});

  // Inline Supplier Creation Modal
  const [supplierModalOpen, setSupplierModalOpen] = React.useState(false);
  const [creatingSupplier, setCreatingSupplier] = React.useState(false);
  const [gstLookingUp, setGstLookingUp] = React.useState(false);
  const [newSup, setNewSup] = React.useState({
    name: '',
    companyName: '',
    gstin: '',
    phone: '',
    email: '',
    billingAddress: '',
    state: recipientState,
    stateCode: getStateCode(recipientState),
  });

  // Main Purchase Form State
  const todayStr = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = React.useState('');
  const [billNumber, setBillNumber] = React.useState('');
  const [billDate, setBillDate] = React.useState(todayStr);
  const [dueDate, setDueDate] = React.useState(todayStr);
  const [referenceNumber, setReferenceNumber] = React.useState('');
  const [paymentTerms, setPaymentTerms] = React.useState('Net 15');
  const [purchaseType, setPurchaseType] = React.useState<PurchaseType>(
    profile?.defaultIsGst === false ? 'non_gst' : 'gst'
  );
  const [taxMode, setTaxMode] = React.useState<TaxPricingMode>(
    profile?.defaultTaxMode || 'exclusive'
  );
  const [taxSupplyMode, setTaxSupplyMode] = React.useState<TaxSupplyMode>('auto');
  const [placeOfSupply, setPlaceOfSupply] = React.useState(recipientState);
  const [roundOffEnabled, setRoundOffEnabled] = React.useState(true);
  const [invoiceDiscountType, setInvoiceDiscountType] = React.useState<DiscountType>('percent');
  const [invoiceDiscountValue, setInvoiceDiscountValue] = React.useState(0);
  const [additionalCharges, setAdditionalCharges] = React.useState(0);
  const [notes, setNotes] = React.useState('');
  const [items, setItems] = React.useState<PurchaseLineItemInput[]>([
    emptyItem(profile?.defaultIsGst === false ? 0 : profile?.defaultTaxRate ?? 18),
  ]);

  // Initial / Entry Payment fields (for new bills)
  const [initialPayChoice, setInitialPayChoice] = React.useState<'unpaid' | 'partially_paid' | 'paid'>('unpaid');
  const [initialPayAmount, setInitialPayAmount] = React.useState(0);
  const [initialPayDate, setInitialPayDate] = React.useState(todayStr);
  const [initialPayMethod, setInitialPayMethod] = React.useState<PaymentMethod>('Bank Transfer');
  const [initialPayRef, setInitialPayRef] = React.useState('');
  const [allowAdvance, setAllowAdvance] = React.useState(false);

  const [ratePickerOpen, setRatePickerOpen] = React.useState(false);
  const [rateSearch, setRateSearch] = React.useState('');

  // Load suppliers & rate card
  React.useEffect(() => {
    void (async () => {
      try {
        const [supRes, rcRes] = await Promise.all([
          suppliersApi.list({ includeArchived: false }),
          rateCardApi.list({ activeOnly: true }),
        ]);
        setSuppliers(supRes.suppliers);
        setRateCardItems(rcRes.items);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  // Load existing purchase if editing
  React.useEffect(() => {
    if (!editId) return;
    setLoadingInit(true);
    void (async () => {
      try {
        const res = await purchasesApi.get(editId);
        const p = res.purchase;
        setSupplierId(p.supplierId);
        setBillNumber(p.billNumber);
        setBillDate(p.billDate);
        setDueDate(p.dueDate);
        setReferenceNumber(p.referenceNumber);
        setPaymentTerms(p.paymentTerms || 'Net 15');
        setPurchaseType(p.purchaseType);
        setTaxMode(p.taxMode);
        setTaxSupplyMode(p.taxSupplyMode);
        setPlaceOfSupply(p.placeOfSupply || recipientState);
        setRoundOffEnabled(p.roundOffEnabled);
        setInvoiceDiscountType(p.invoiceDiscountType);
        setInvoiceDiscountValue(p.invoiceDiscountValue);
        setAdditionalCharges(p.additionalCharges);
        setNotes(p.notes);
        setItems(
          p.items.map((it) => ({
            name: it.name,
            description: it.description,
            hsnSac: it.hsnSac,
            quantity: it.quantity,
            unit: it.unit,
            rate: it.rate,
            discountType: it.discountType,
            discountValue: it.discountValue,
            taxRate: it.taxRate,
            ocrConfidence: it.ocrConfidence,
            ocrStatus: it.ocrStatus,
            ocrMessage: it.ocrMessage,
          }))
        );
        if (p.ocrWarnings) setOcrWarnings(p.ocrWarnings);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Failed to load purchase bill');
        navigate('/purchases');
      } finally {
        setLoadingInit(false);
      }
    })();
  }, [editId, navigate, notify, recipientState]);

  // Apply OCR scan data when coming from PurchaseScannerPage
  const appliedScanRef = React.useRef(false);
  React.useEffect(() => {
    if (!fromScan || !stagedScan || appliedScanRef.current) return;
    appliedScanRef.current = true;
    const v = stagedScan.validatedOcr;
    if (!v) return;

    setBillNumber(v.invoice.billNumber || '');
    setBillDate(v.invoice.billDate || todayStr);
    setDueDate(v.invoice.dueDate || v.invoice.billDate || todayStr);
    setReferenceNumber(v.invoice.referenceNumber || '');
    setPurchaseType(v.purchaseType);
    setItems(v.items);
    setAdditionalCharges(v.summary.additionalCharges || 0);
    setInvoiceDiscountType('fixed');
    setInvoiceDiscountValue(v.summary.invoiceDiscountValue || 0);
    setFieldValidation(v.fieldValidation);
    setOcrWarnings(v.warnings);

    // Match supplier automatically by GSTIN or fuzzy name, or prefill inline modal
    const matchByGstin = v.supplier.gstin
      ? suppliers.find((s) => s.gstin.toUpperCase() === v.supplier.gstin.toUpperCase())
      : undefined;
    const matchByName =
      !matchByGstin && v.supplier.businessName
        ? suppliers.find(
            (s) =>
              (s.companyName || s.name).toLowerCase() === v.supplier.businessName.toLowerCase()
          )
        : undefined;
    const matched = matchByGstin || matchByName;
    if (matched) {
      setSupplierId(matched.id);
    } else if (v.supplier.businessName || v.supplier.gstin) {
      setNewSup({
        name: v.supplier.businessName,
        companyName: v.supplier.businessName,
        gstin: v.supplier.gstin,
        phone: v.supplier.phone,
        email: v.supplier.email,
        billingAddress: v.supplier.address,
        state: v.supplier.state || recipientState,
        stateCode: getStateCode(v.supplier.state || recipientState),
      });
    }
  }, [fromScan, stagedScan, suppliers, recipientState, todayStr]);

  const selectedSupplier = React.useMemo(
    () => suppliers.find((s) => s.id === supplierId) || null,
    [suppliers, supplierId]
  );

  const calc = React.useMemo(
    () =>
      computePurchaseTotals({
        items,
        supplierState: selectedSupplier?.state || newSup.state || '',
        recipientState,
        placeOfSupply,
        purchaseType,
        taxMode,
        taxSupplyMode,
        invoiceDiscountType,
        invoiceDiscountValue,
        additionalCharges,
        roundOffEnabled,
      }),
    [
      items,
      selectedSupplier,
      newSup.state,
      recipientState,
      placeOfSupply,
      purchaseType,
      taxMode,
      taxSupplyMode,
      invoiceDiscountType,
      invoiceDiscountValue,
      additionalCharges,
      roundOffEnabled,
    ]
  );

  // Sync Paid amount if initialPayChoice === 'paid'
  React.useEffect(() => {
    if (initialPayChoice === 'paid') {
      setInitialPayAmount(calc.grandTotal);
    } else if (initialPayChoice === 'unpaid') {
      setInitialPayAmount(0);
    }
  }, [initialPayChoice, calc.grandTotal]);

  const handleLookupSupplierGstin = async () => {
    const clean = newSup.gstin.trim().toUpperCase();
    if (!clean) {
      notify('error', 'Enter a 15-character supplier GSTIN first');
      return;
    }
    setGstLookingUp(true);
    try {
      const { result } = await gstinApi.lookup(clean);
      const d = result.data;
      const st =
        d.address_details?.state ||
        getStateFromGstin(clean) ||
        newSup.state;
      setNewSup((prev) => ({
        ...prev,
        gstin: clean,
        companyName: d.trade_name || d.legal_name || prev.companyName,
        name: d.legal_name || d.trade_name || prev.name,
        billingAddress: d.address || prev.billingAddress,
        state: st,
        stateCode: d.state_code || getStateCode(st),
      }));
      notify('success', 'Fetched supplier GSTIN details');
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'GSTIN lookup failed — you can still enter details manually'
      );
    } finally {
      setGstLookingUp(false);
    }
  };

  const handleCreateInlineSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSup.name.trim() && !newSup.companyName.trim()) {
      notify('error', 'Supplier name or company name is required');
      return;
    }
    setCreatingSupplier(true);
    try {
      const res = await suppliersApi.create({
        ...newSup,
        stateCode: newSup.stateCode || getStateCode(newSup.state),
      });
      setSuppliers((prev) => [res.supplier, ...prev]);
      setSupplierId(res.supplier.id);
      setSupplierModalOpen(false);
      notify('success', `Supplier "${res.supplier.companyName || res.supplier.name}" added`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create supplier');
    } finally {
      setCreatingSupplier(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<PurchaseLineItemInput>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const duplicateItem = (idx: number) => {
    setItems((prev) => {
      const copy = { ...prev[idx], ocrStatus: undefined, ocrMessage: undefined };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async (saveAsDraft: boolean) => {
    if (!supplierId) {
      notify('error', 'Please select or add a supplier first');
      return;
    }
    if (!billNumber.trim()) {
      notify('error', 'Purchase bill number is required');
      return;
    }
    if (!saveAsDraft && purchaseType === 'gst' && !calc.taxRuleChecked) {
      notify(
        'error',
        calc.taxRuleWarning ||
          'Verify supplier state and recipient place of supply before saving.'
      );
      return;
    }

    setSaving(true);
    try {
      const res = await (editId
        ? purchasesApi.update(editId, {
            supplierId,
            billNumber: billNumber.trim(),
            referenceNumber,
            billDate,
            dueDate,
            paymentTerms,
            purchaseType,
            taxMode,
            taxSupplyMode,
            placeOfSupply,
            roundOffEnabled,
            invoiceDiscountType,
            invoiceDiscountValue,
            additionalCharges,
            notes,
            saveAsDraft,
            ocrUsed: Boolean(stagedScan),
            ocrWarnings: ocrWarnings.length > 0 ? ocrWarnings : undefined,
            items,
          })
        : purchasesApi.create({
            supplierId,
            billNumber: billNumber.trim(),
            referenceNumber,
            billDate,
            dueDate,
            paymentTerms,
            purchaseType,
            taxMode,
            taxSupplyMode,
            placeOfSupply,
            roundOffEnabled,
            invoiceDiscountType,
            invoiceDiscountValue,
            additionalCharges,
            notes,
            saveAsDraft,
            ocrUsed: Boolean(stagedScan),
            ocrWarnings: ocrWarnings.length > 0 ? ocrWarnings : undefined,
            items,
            initialPayment:
              !saveAsDraft && initialPayChoice !== 'unpaid' && initialPayAmount > 0
                ? {
                    amount: initialPayAmount,
                    paymentDate: initialPayDate,
                    paymentMethod: initialPayMethod,
                    referenceId: initialPayRef,
                    allowAdvance,
                  }
                : undefined,
            attachmentFile: stagedScan?.attachmentFile,
          }));

      clearStagedPurchaseScan();
      notify(
        'success',
        saveAsDraft
          ? `Saved draft purchase ${res.purchase.billNumber}`
          : `Saved purchase bill ${res.purchase.billNumber}`
      );
      navigate(`/purchases/${res.purchase.id}`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save purchase');
    } finally {
      setSaving(false);
    }
  };

  const buildPreviewPurchase = (): Purchase => ({
    id: editId || 'preview',
    userUid: tenantUid,
    billNumber: billNumber || 'DRAFT',
    referenceNumber,
    supplierId: selectedSupplier?.id || '',
    supplierSnapshot: selectedSupplier
      ? {
          id: selectedSupplier.id,
          name: selectedSupplier.name,
          companyName: selectedSupplier.companyName,
          email: selectedSupplier.email,
          phone: selectedSupplier.phone,
          gstin: selectedSupplier.gstin,
          billingAddress: selectedSupplier.billingAddress,
          state: selectedSupplier.state,
          stateCode: selectedSupplier.stateCode,
        }
      : {
          id: '',
          name: newSup.name || 'Supplier not selected',
          companyName: newSup.companyName,
          email: newSup.email,
          phone: newSup.phone,
          gstin: newSup.gstin,
          billingAddress: newSup.billingAddress,
          state: newSup.state,
          stateCode: newSup.stateCode,
        },
    billDate,
    dueDate,
    paymentTerms,
    purchaseType,
    isGst: calc.isGst,
    taxMode,
    taxSupplyMode,
    isInterState: calc.isInterState,
    placeOfSupply,
    roundOffEnabled,
    status: 'unpaid',
    items: calc.items,
    subtotal: calc.subtotal,
    itemDiscountTotal: calc.itemDiscountTotal,
    invoiceDiscountType,
    invoiceDiscountValue,
    invoiceDiscountAmount: calc.invoiceDiscountAmount,
    totalDiscount: calc.totalDiscount,
    taxableAmount: calc.taxableAmount,
    cgstTotal: calc.cgstTotal,
    sgstTotal: calc.sgstTotal,
    igstTotal: calc.igstTotal,
    totalTax: calc.totalTax,
    additionalCharges: calc.additionalCharges,
    roundOff: calc.roundOff,
    grandTotal: calc.grandTotal,
    amountPaid: initialPayChoice === 'unpaid' ? 0 : initialPayAmount,
    balanceDue: Math.max(0, calc.grandTotal - (initialPayChoice === 'unpaid' ? 0 : initialPayAmount)),
    amountInWords: calc.amountInWords,
    notes,
    ocrUsed: Boolean(stagedScan),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (loadingInit) {
    return (
      <div className="py-16 flex items-center justify-center text-sm text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2 text-[#F57C00]" />
        Loading purchase bill...
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-8">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/purchases')}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {stagedScan ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-medium text-[#E65100] dark:bg-orange-950/30 dark:text-orange-300">
              <ScanLine className="h-3.5 w-3.5" />
              Scanned Attachment Ready ({stagedScan.attachmentFile.fileName})
            </span>
          ) : null}
        </div>
        <div className="hidden lg:flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/purchases/scan')}>
            <ScanLine className="h-4 w-4" />
            Scan Another Bill
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-4 w-4" />
            Preview Purchase
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void handleSave(true)}
          >
            Save as Draft
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void handleSave(false)}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : editId ? 'Update Purchase' : 'Save Purchase'}
          </Button>
        </div>
      </div>

      {/* OCR Review Warnings */}
      {ocrWarnings.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-amber-900 dark:text-amber-200">
              <div className="font-semibold">
                OCR Review Required — Confirm extracted values before saving
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {ocrWarnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {/* Section 1: Supplier & Purchase Bill Header */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-6">
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Supplier Details</CardTitle>
              <CardDescription>Select an existing vendor or add a new supplier</CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSupplierModalOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Supplier
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Supplier *</Label>
                <OcrBadge validation={fieldValidation['supplier.businessName']} />
              </div>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">-- Select Supplier --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName || s.name} {s.gstin ? `(${s.gstin})` : ''} — {s.state}
                  </option>
                ))}
              </Select>
            </div>

            {selectedSupplier ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 text-xs space-y-1 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                    {selectedSupplier.companyName || selectedSupplier.name}
                  </span>
                  {selectedSupplier.gstin ? (
                    <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-zinc-200 dark:bg-zinc-950 dark:border-zinc-700">
                      {selectedSupplier.gstin}
                    </span>
                  ) : null}
                </div>
                {selectedSupplier.billingAddress ? (
                  <div className="text-zinc-600 dark:text-zinc-400">
                    {selectedSupplier.billingAddress}
                  </div>
                ) : null}
                <div className="text-zinc-500">
                  State: <span className="font-medium text-zinc-800 dark:text-zinc-200">{selectedSupplier.state}</span>
                  {selectedSupplier.stateCode ? ` (${selectedSupplier.stateCode})` : ''}
                  {selectedSupplier.phone ? ` · ${selectedSupplier.phone}` : ''}
                </div>
              </div>
            ) : fromScan && (newSup.companyName || newSup.gstin) ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs space-y-2 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="font-semibold text-amber-900 dark:text-amber-200">
                  Detected Unsaved Supplier from OCR
                </div>
                <div className="text-amber-800 dark:text-amber-300">
                  {newSup.companyName || newSup.name} {newSup.gstin ? `· ${newSup.gstin}` : ''}
                </div>
                <Button size="sm" variant="outline" onClick={() => setSupplierModalOpen(true)}>
                  Review &amp; Save New Supplier
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle>Purchase Bill Details &amp; Tax Rules</CardTitle>
            <CardDescription>Bill numbering, dates, purchase regime, and place of supply</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Purchase Bill Number *</Label>
                  <OcrBadge validation={fieldValidation['invoice.billNumber']} />
                </div>
                <Input
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  placeholder="SUP-INV-2026-001"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Reference / PO Number</Label>
                  <OcrBadge validation={fieldValidation['invoice.referenceNumber']} />
                </div>
                <Input
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="PO-042"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Bill Date *</Label>
                  <OcrBadge validation={fieldValidation['invoice.billDate']} />
                </div>
                <Input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Due Date</Label>
                  <OcrBadge validation={fieldValidation['invoice.dueDate']} />
                </div>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Terms</Label>
                <Select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
                  <option value="Due on Receipt">Due on Receipt</option>
                  <option value="Net 7">Net 7 Days</option>
                  <option value="Net 15">Net 15 Days</option>
                  <option value="Net 30">Net 30 Days</option>
                  <option value="Net 45">Net 45 Days</option>
                  <option value="Net 60">Net 60 Days</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Purchase Type</Label>
                <Select
                  value={purchaseType}
                  onChange={(e) => setPurchaseType(e.target.value as PurchaseType)}
                >
                  <option value="gst">GST Purchase</option>
                  <option value="non_gst">Non-GST Purchase</option>
                  <option value="import">Import Purchase (IGST)</option>
                  <option value="composition">Composition Supplier Purchase</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Place of Supply</Label>
                <Select value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
                  {INDIAN_STATES.map((st) => (
                    <option key={st.code} value={st.name}>
                      {st.name} ({st.code})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tax Rule Mode</Label>
                <Select
                  value={taxSupplyMode}
                  onChange={(e) => setTaxSupplyMode(e.target.value as TaxSupplyMode)}
                  disabled={purchaseType !== 'gst'}
                >
                  <option value="auto">Auto (By Supplier &amp; POS)</option>
                  <option value="intra">Intra-State (CGST + SGST)</option>
                  <option value="inter">Inter-State (IGST)</option>
                </Select>
              </div>
            </div>

            {/* Explicit Place-of-Supply Tax Rule Verification Banner */}
            <div
              className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                calc.taxRuleWarning
                  ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
                  : 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300'
              }`}
            >
              <span>
                <strong>Tax Rule Check:</strong> {calc.taxRuleWarning || calc.taxRuleLabel}
              </span>
              {purchaseType === 'gst' || purchaseType === 'import' ? (
                <Select
                  value={taxMode}
                  onChange={(e) => setTaxMode(e.target.value as TaxPricingMode)}
                  className="h-7 w-auto text-xs"
                >
                  <option value="exclusive">Tax Exclusive</option>
                  <option value="inclusive">Tax Inclusive</option>
                </Select>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section 2: Line Items */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Purchase Line Items</CardTitle>
            <CardDescription>
              Add items manually or insert from Rate Card. Precision GST splits automatically by verified tax rules.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {rateCardItems.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRatePickerOpen(true)}
              >
                <Search className="h-3.5 w-3.5" />
                From Rate Card
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  emptyItem(calc.isGst ? profile?.defaultTaxRate ?? 18 : 0),
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add Item
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Desktop Table */}
          <div className="hidden xl:block overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-2.5 py-2.5 text-left w-8">#</th>
                  <th className="px-2.5 py-2.5 text-left min-w-[200px]">Item &amp; Description</th>
                  <th className="px-2.5 py-2.5 text-left w-24">HSN/SAC</th>
                  <th className="px-2.5 py-2.5 text-right w-20">Qty</th>
                  <th className="px-2.5 py-2.5 text-left w-20">Unit</th>
                  <th className="px-2.5 py-2.5 text-right w-28">Rate (₹)</th>
                  <th className="px-2.5 py-2.5 text-right w-32">Discount</th>
                  {calc.isGst ? <th className="px-2.5 py-2.5 text-right w-20">GST %</th> : null}
                  <th className="px-2.5 py-2.5 text-right w-24">Taxable</th>
                  {calc.isGst ? (
                    calc.isInterState ? (
                      <th className="px-2.5 py-2.5 text-right w-24">IGST</th>
                    ) : (
                      <>
                        <th className="px-2.5 py-2.5 text-right w-20">CGST</th>
                        <th className="px-2.5 py-2.5 text-right w-20">SGST</th>
                      </>
                    )
                  ) : null}
                  <th className="px-2.5 py-2.5 text-right w-28">Total</th>
                  <th className="px-2.5 py-2.5 text-right w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {items.map((item, idx) => {
                  const rowCalc = calc.items[idx];
                  const rowBadge: OcrFieldValidation | undefined = item.ocrStatus
                    ? {
                        confidence: item.ocrConfidence ?? null,
                        level: item.ocrStatus as OcrConfidenceLevel,
                        message: item.ocrMessage,
                      }
                    : undefined;
                  return (
                    <tr key={idx} className="align-top">
                      <td className="px-2.5 py-2.5 text-zinc-500 font-mono">{idx + 1}</td>
                      <td className="px-2.5 py-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={item.name}
                            onChange={(e) => updateItem(idx, { name: e.target.value })}
                            placeholder="Item or expense name"
                            className="h-8 text-xs"
                          />
                          <OcrBadge validation={rowBadge} />
                        </div>
                        <Input
                          value={item.description || ''}
                          onChange={(e) => updateItem(idx, { description: e.target.value })}
                          placeholder="Optional description"
                          className="h-7 text-[11px]"
                        />
                        {item.ocrMessage ? (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400">
                            {item.ocrMessage}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2.5 py-2 min-w-[130px]">
                        <HsnSacSelector
                          value={item.hsnSac}
                          currentDescription={item.description}
                          onChange={(val) => updateItem(idx, { hsnSac: val })}
                          onSelectDescription={(desc) => {
                            if (!item.description || item.description.trim() === '') {
                              updateItem(idx, { description: desc });
                            }
                          }}
                          placeholder="HSN"
                          className="h-8 text-xs font-mono"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={item.quantity}
                          onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                          className="h-8 text-xs text-right font-mono"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <Input
                          value={item.unit}
                          onChange={(e) => updateItem(idx, { unit: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.rate}
                          onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })}
                          className="h-8 text-xs text-right font-mono"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.discountValue}
                            onChange={(e) =>
                              updateItem(idx, { discountValue: Number(e.target.value) })
                            }
                            className="h-8 text-xs text-right font-mono"
                          />
                          <Select
                            value={item.discountType}
                            onChange={(e) =>
                              updateItem(idx, {
                                discountType: e.target.value as DiscountType,
                              })
                            }
                            className="h-8 w-14 px-1 text-xs"
                          >
                            <option value="percent">%</option>
                            <option value="fixed">₹</option>
                          </Select>
                        </div>
                      </td>
                      {calc.isGst ? (
                        <td className="px-2.5 py-2">
                          <Select
                            value={item.taxRate}
                            onChange={(e) => updateItem(idx, { taxRate: Number(e.target.value) })}
                            className="h-8 text-xs font-mono"
                          >
                            {[0, 5, 12, 18, 28].map((r) => (
                              <option key={r} value={r}>
                                {r}%
                              </option>
                            ))}
                          </Select>
                        </td>
                      ) : null}
                      <td className="px-2.5 py-3 text-right font-mono tabular-nums">
                        {formatINR(rowCalc?.taxableAmount || 0)}
                      </td>
                      {calc.isGst ? (
                        calc.isInterState ? (
                          <td className="px-2.5 py-3 text-right font-mono tabular-nums">
                            {formatINR(rowCalc?.igstAmount || 0)}
                          </td>
                        ) : (
                          <>
                            <td className="px-2.5 py-3 text-right font-mono tabular-nums">
                              {formatINR(rowCalc?.cgstAmount || 0)}
                            </td>
                            <td className="px-2.5 py-3 text-right font-mono tabular-nums">
                              {formatINR(rowCalc?.sgstAmount || 0)}
                            </td>
                          </>
                        )
                      ) : null}
                      <td className="px-2.5 py-3 text-right font-mono font-semibold tabular-nums">
                        {formatINR(rowCalc?.totalAmount || 0)}
                      </td>
                      <td className="px-2.5 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => duplicateItem(idx)}
                            title="Duplicate item"
                            className="p-1.5 rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={items.length <= 1}
                            onClick={() => removeItem(idx)}
                            title="Remove item"
                            className="p-1.5 rounded text-red-500 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/30 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile & Tablet Card Line Items (no horizontal scrolling) */}
          <div className="xl:hidden space-y-3">
            {items.map((item, idx) => {
              const rowCalc = calc.items[idx];
              return (
                <div
                  key={idx}
                  className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 space-y-3 dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      Item #{idx + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {item.ocrStatus ? (
                        <OcrBadge
                          validation={{
                            confidence: item.ocrConfidence ?? null,
                            level: item.ocrStatus,
                            message: item.ocrMessage,
                          }}
                        />
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={() => duplicateItem(idx)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-red-600"
                        disabled={items.length <= 1}
                        onClick={() => removeItem(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    placeholder="Item name *"
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label>HSN/SAC</Label>
                      <HsnSacSelector
                        value={item.hsnSac}
                        currentDescription={item.description}
                        onChange={(val) => updateItem(idx, { hsnSac: val })}
                        onSelectDescription={(desc) => {
                          if (!item.description || item.description.trim() === '') {
                            updateItem(idx, { description: desc });
                          }
                        }}
                        placeholder="HSN"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Unit</Label>
                      <Input
                        value={item.unit}
                        onChange={(e) => updateItem(idx, { unit: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Rate (₹)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.rate}
                        onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label>Discount</Label>
                      <div className="flex gap-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.discountValue}
                          onChange={(e) =>
                            updateItem(idx, { discountValue: Number(e.target.value) })
                          }
                        />
                        <Select
                          value={item.discountType}
                          onChange={(e) =>
                            updateItem(idx, { discountType: e.target.value as DiscountType })
                          }
                          className="w-16"
                        >
                          <option value="percent">%</option>
                          <option value="fixed">₹</option>
                        </Select>
                      </div>
                    </div>
                    {calc.isGst ? (
                      <div className="space-y-1">
                        <Label>GST Rate</Label>
                        <Select
                          value={item.taxRate}
                          onChange={(e) => updateItem(idx, { taxRate: Number(e.target.value) })}
                        >
                          {[0, 5, 12, 18, 28].map((r) => (
                            <option key={r} value={r}>
                              {r}% GST
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800">
                    <span className="text-zinc-500">
                      Taxable: {formatINR(rowCalc?.taxableAmount || 0)}
                      {calc.isGst ? ` · Tax: ${formatINR(rowCalc?.taxAmount || 0)}` : ''}
                    </span>
                    <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      {formatINR(rowCalc?.totalAmount || 0)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Discounts, Charges, Initial Payment & Totals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Adjustments, Notes &amp; Payment Status</CardTitle>
            <CardDescription>
              Invoice-level discount, freight/additional charges, and payment at purchase entry
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Invoice-Level Discount</Label>
                <div className="flex gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceDiscountValue}
                    onChange={(e) => setInvoiceDiscountValue(Number(e.target.value))}
                  />
                  <Select
                    value={invoiceDiscountType}
                    onChange={(e) => setInvoiceDiscountType(e.target.value as DiscountType)}
                    className="w-20"
                  >
                    <option value="percent">%</option>
                    <option value="fixed">₹</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Additional Charges (Freight / Packing ₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={additionalCharges}
                  onChange={(e) => setAdditionalCharges(Number(e.target.value))}
                />
              </div>
            </div>

            {!editId ? (
              <div className="rounded-xl border border-zinc-200 p-4 space-y-3 dark:border-zinc-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Payment Status</Label>
                    <Select
                      value={initialPayChoice}
                      onChange={(e) =>
                        setInitialPayChoice(e.target.value as 'unpaid' | 'partially_paid' | 'paid')
                      }
                    >
                      <option value="unpaid">Unpaid (Full Credit)</option>
                      <option value="partially_paid">Partially Paid</option>
                      <option value="paid">Paid in Full</option>
                    </Select>
                  </div>
                  {initialPayChoice !== 'unpaid' ? (
                    <div className="space-y-1.5">
                      <Label>Amount Paid (₹)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={initialPayAmount}
                        onChange={(e) => setInitialPayAmount(Number(e.target.value))}
                      />
                    </div>
                  ) : null}
                </div>

                {initialPayChoice !== 'unpaid' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label>Payment Date</Label>
                        <Input
                          type="date"
                          value={initialPayDate}
                          onChange={(e) => setInitialPayDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Payment Method</Label>
                        <Select
                          value={initialPayMethod}
                          onChange={(e) => setInitialPayMethod(e.target.value as PaymentMethod)}
                        >
                          <option value="Bank Transfer">Bank Transfer / NEFT</option>
                          <option value="UPI">UPI</option>
                          <option value="Cash">Cash</option>
                          <option value="Card">Card</option>
                          <option value="Cheque">Cheque</option>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Transaction Ref / UTR</Label>
                        <Input
                          value={initialPayRef}
                          onChange={(e) => setInitialPayRef(e.target.value)}
                          placeholder="UTR / Cheque #"
                        />
                      </div>
                    </div>
                    {initialPayAmount > calc.grandTotal ? (
                      <label className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                        <input
                          type="checkbox"
                          checked={allowAdvance}
                          onChange={(e) => setAllowAdvance(e.target.checked)}
                        />
                        Paid amount exceeds bill total — record extra as advance vendor payment
                      </label>
                    ) : null}
                    <div className="text-xs text-zinc-500">
                      Remaining Balance after this payment:{' '}
                      <strong className="font-mono text-zinc-900 dark:text-zinc-100">
                        {formatINR(Math.max(0, calc.grandTotal - initialPayAmount))}
                      </strong>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Notes / Remarks</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal purchase voucher notes, delivery docket #, or ITC eligibility notes"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Purchase Summary</CardTitle>
              <CardDescription>Auto-calculated precision totals</CardDescription>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={roundOffEnabled}
                onChange={(e) => setRoundOffEnabled(e.target.checked)}
              />
              Round Off
            </label>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Subtotal</span>
              <span className="font-mono tabular-nums">{formatINR(calc.subtotal)}</span>
            </div>
            {calc.itemDiscountTotal > 0 ? (
              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400">
                <span>Item Discounts</span>
                <span className="font-mono tabular-nums">-{formatINR(calc.itemDiscountTotal)}</span>
              </div>
            ) : null}
            {calc.invoiceDiscountAmount > 0 ? (
              <div className="flex justify-between text-xs text-emerald-600 dark:text-emerald-400">
                <span>Invoice Discount</span>
                <span className="font-mono tabular-nums">-{formatINR(calc.invoiceDiscountAmount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span className="text-zinc-500">Taxable Value</span>
              <span className="font-mono tabular-nums">{formatINR(calc.taxableAmount)}</span>
            </div>
            {calc.isGst ? (
              calc.isInterState ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">IGST</span>
                  <span className="font-mono tabular-nums">{formatINR(calc.igstTotal)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">CGST</span>
                    <span className="font-mono tabular-nums">{formatINR(calc.cgstTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">SGST</span>
                    <span className="font-mono tabular-nums">{formatINR(calc.sgstTotal)}</span>
                  </div>
                </>
              )
            ) : null}
            {calc.additionalCharges > 0 ? (
              <div className="flex justify-between">
                <span className="text-zinc-500">Additional Charges</span>
                <span className="font-mono tabular-nums">{formatINR(calc.additionalCharges)}</span>
              </div>
            ) : null}
            {calc.roundOff !== 0 ? (
              <div className="flex justify-between">
                <span className="text-zinc-500">Round Off</span>
                <span className="font-mono tabular-nums">{formatINR(calc.roundOff)}</span>
              </div>
            ) : null}

            <div className="flex justify-between border-t border-zinc-200 pt-3 text-base font-bold dark:border-zinc-800">
              <span>Grand Total</span>
              <span className="font-mono tabular-nums text-[#F57C00]">{formatINR(calc.grandTotal)}</span>
            </div>

            {stagedScan?.validatedOcr?.summary?.extractedGrandTotal ? (
              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                OCR Extracted Bill Total:{' '}
                <span className="font-mono font-semibold">
                  {formatINR(stagedScan.validatedOcr.summary.extractedGrandTotal)}
                </span>
              </div>
            ) : null}

            <div className="pt-2 text-xs text-zinc-500">{calc.amountInWords}</div>

            {stagedScan?.attachmentFile ? (
              <div className="rounded-lg border border-zinc-200 p-2.5 text-xs flex items-center gap-2 dark:border-zinc-800">
                <FileText className="h-4 w-4 text-[#F57C00] shrink-0" />
                <span className="truncate flex-1">{stagedScan.attachmentFile.fileName}</span>
                <span className="text-zinc-400 shrink-0">
                  {Math.max(1, Math.round(stagedScan.attachmentFile.sizeBytes / 1024))} KB
                </span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Sticky Mobile Save Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] text-zinc-500">Grand Total</div>
            <div className="font-mono font-bold text-sm text-[#F57C00]">
              {formatINR(calc.grandTotal)}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => void handleSave(true)}
            >
              Draft
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void handleSave(false)}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* Inline Supplier Create Modal */}
      <Dialog
        open={supplierModalOpen}
        onClose={() => setSupplierModalOpen(false)}
        title="Add New Supplier"
        description="Fetch GSTIN details automatically or enter vendor details manually."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleCreateInlineSupplier} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Supplier GSTIN (Optional)</Label>
            <div className="flex gap-2">
              <Input
                value={newSup.gstin}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  const st = val.length >= 2 ? getStateFromGstin(val) : null;
                  setNewSup((prev) => ({
                    ...prev,
                    gstin: val,
                    state: st || prev.state,
                    stateCode: st ? getStateCode(st) : prev.stateCode,
                  }));
                }}
                placeholder="27ABCDE1234F1Z5"
                maxLength={15}
                className="font-mono uppercase"
              />
              <Button
                type="button"
                variant="outline"
                disabled={gstLookingUp || !isValidGstinChecksum(newSup.gstin)}
                onClick={handleLookupSupplierGstin}
              >
                {gstLookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch GSTIN'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Business / Company Name</Label>
              <Input
                value={newSup.companyName}
                onChange={(e) => setNewSup((p) => ({ ...p, companyName: e.target.value }))}
                placeholder="Acme Trading Co."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Name *</Label>
              <Input
                value={newSup.name}
                onChange={(e) => setNewSup((p) => ({ ...p, name: e.target.value }))}
                placeholder="Rajesh Sharma"
                required={!newSup.companyName.trim()}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={newSup.phone}
                onChange={(e) => setNewSup((p) => ({ ...p, phone: e.target.value }))}
                placeholder="+91 98XXXXXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={newSup.email}
                onChange={(e) => setNewSup((p) => ({ ...p, email: e.target.value }))}
                placeholder="accounts@supplier.in"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>State *</Label>
              <Select
                value={newSup.state}
                onChange={(e) =>
                  setNewSup((p) => ({
                    ...p,
                    state: e.target.value,
                    stateCode: getStateCode(e.target.value),
                  }))
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
              <Input value={newSup.stateCode} readOnly className="font-mono bg-zinc-50" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Billing Address</Label>
            <Textarea
              value={newSup.billingAddress}
              onChange={(e) => setNewSup((p) => ({ ...p, billingAddress: e.target.value }))}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setSupplierModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creatingSupplier}>
              {creatingSupplier ? 'Saving...' : 'Save Supplier'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Rate Card Quick Insert Dialog */}
      <Dialog
        open={ratePickerOpen}
        onClose={() => setRatePickerOpen(false)}
        title="Insert from Rate Card"
        description="Click an item to add it as a purchase line item."
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-3">
          <Input
            value={rateSearch}
            onChange={(e) => setRateSearch(e.target.value)}
            placeholder="Search saved products/services..."
          />
          <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {rateCardItems
              .filter(
                (r) =>
                  !rateSearch.trim() ||
                  r.name.toLowerCase().includes(rateSearch.toLowerCase()) ||
                  r.hsnSac.toLowerCase().includes(rateSearch.toLowerCase())
              )
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setItems((prev) => [
                      ...prev,
                      {
                        name: r.name,
                        description: r.description,
                        hsnSac: r.hsnSac,
                        quantity: 1,
                        unit: r.unit,
                        rate: r.rate,
                        discountType: r.discountType,
                        discountValue: r.discountValue,
                        taxRate: calc.isGst ? r.taxRate : 0,
                      },
                    ]);
                    setRatePickerOpen(false);
                  }}
                  className="w-full text-left py-2.5 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.name}</div>
                    <div className="text-xs text-zinc-500">
                      HSN: {r.hsnSac || '—'} · GST {r.taxRate}%
                    </div>
                  </div>
                  <div className="font-mono text-sm font-semibold shrink-0">
                    {formatINR(r.rate)}
                  </div>
                </button>
              ))}
          </div>
        </div>
      </Dialog>

      <PurchasePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        purchase={buildPreviewPurchase()}
        businessProfile={profile}
      />
    </div>
  );
}
