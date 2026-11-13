import * as React from 'react';
import {
  ArrowLeft,
  Columns2,
  Download,
  FileText,
  ImagePlus,
  Maximize2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { customersApi, invoicesApi, quotationsApi } from '../lib/api';
import { generateDocumentPdf } from '../lib/pdfGenerator';
import { processLogoFile } from '../lib/utils';
import { computeDocumentTotals, formatINR } from '../shared/gstCalculator';
import { INDIAN_STATES, getStateFromGstin } from '../shared/indianStates';
import type {
  BusinessSnapshot,
  Customer,
  CustomerSnapshot,
  Invoice,
  LineItemInput,
  Quotation,
  TaxPricingMode,
  TaxSupplyMode,
  TemplateId,
} from '../shared/types';
import { DocumentPreviewSheet } from './DocumentPreviewSheet';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Dialog } from './ui/dialog';
import { Input, Label, Select, Textarea } from './ui/input';
import { useToast } from './ui/toast';

interface DocumentEditorProps {
  docType: 'invoice' | 'quotation';
  editId?: string;
  navigate: (path: string) => void;
}

type ViewMode = 'split' | 'editor' | 'preview';

function ScaledA4Preview({
  docType,
  record,
  templateId,
}: {
  docType: 'invoice' | 'quotation';
  record: Invoice | Quotation;
  templateId: TemplateId;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0.55);
  const [sheetHeight, setSheetHeight] = React.useState(1123);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const updateMetrics = () => {
      const availW = container.clientWidth;
      if (availW > 0) {
        setScale(Math.min(1, availW / 794));
      }
      if (sheet.scrollHeight > 0) {
        setSheetHeight(Math.max(1123, sheet.scrollHeight));
      }
    };

    updateMetrics();
    const ro = new ResizeObserver(updateMetrics);
    ro.observe(container);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [record, templateId]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden">
      <div
        className="relative mx-auto"
        style={{
          width: `${Math.round(794 * scale)}px`,
          height: `${Math.ceil(sheetHeight * scale)}px`,
        }}
      >
        <div
          ref={sheetRef}
          style={{
            width: '794px',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <DocumentPreviewSheet
            docType={docType}
            record={record}
            templateOverride={templateId}
            a4Ratio
          />
        </div>
      </div>
    </div>
  );
}

export function DocumentEditor({ docType, editId, navigate }: DocumentEditorProps) {
  const { session, updateLocalBusinessProfile } = useAuth();
  const { notify } = useToast();
  const profile = session?.businessProfile;

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [savingMode, setSavingMode] = React.useState<'draft' | 'issue' | 'download' | null>(null);
  const [viewMode, setViewMode] = React.useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1280 ? 'editor' : 'split'
  );
  const [fullPreviewOpen, setFullPreviewOpen] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const defaultTermsDays = profile?.defaultPaymentTermsDays ?? 15;
  const defaultDue = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (docType === 'invoice' ? defaultTermsDays : 30));
    return d.toISOString().slice(0, 10);
  })();

  const [customerId, setCustomerId] = React.useState('');
  const [docDate, setDocDate] = React.useState(today);
  const [dueDate, setDueDate] = React.useState(defaultDue);
  const [paymentTerms, setPaymentTerms] = React.useState(`Net ${defaultTermsDays}`);
  const [referenceNumber, setReferenceNumber] = React.useState('');
  const [placeOfSupply, setPlaceOfSupply] = React.useState(profile?.state || 'Maharashtra');
  const [isGst, setIsGst] = React.useState(profile?.defaultIsGst ?? true);
  const [taxMode, setTaxMode] = React.useState<TaxPricingMode>(
    profile?.defaultTaxMode || 'exclusive'
  );
  const [taxSupplyMode, setTaxSupplyMode] = React.useState<TaxSupplyMode>('auto');
  const [roundOffEnabled, setRoundOffEnabled] = React.useState(true);
  const [templateId, setTemplateId] = React.useState<TemplateId>(
    docType === 'invoice'
      ? profile?.defaultInvoiceTemplate || 'classic_gst'
      : profile?.defaultQuotationTemplate || 'classic_gst'
  );
  const [notes, setNotes] = React.useState('');
  const [terms, setTerms] = React.useState(profile?.termsAndConditions || '');

  // Logo & UPI state (asked right inside invoice creation)
  const [logoDataUrl, setLogoDataUrl] = React.useState<string>(profile?.logoDataUrl || '');
  const [saveLogoToProfile, setSaveLogoToProfile] = React.useState<boolean>(true);
  const [upiId, setUpiId] = React.useState<string>(profile?.upiId || '');
  const [saveUpiToProfile, setSaveUpiToProfile] = React.useState<boolean>(true);
  const [uploadingLogo, setUploadingLogo] = React.useState(false);
  const [existingDocNumber, setExistingDocNumber] = React.useState<string>('');
  const [existingStatus, setExistingStatus] = React.useState<string | null>(null);
  const [existingAmountPaid, setExistingAmountPaid] = React.useState<number>(0);

  const [items, setItems] = React.useState<LineItemInput[]>([
    {
      name: '',
      description: '',
      hsnSac: '',
      quantity: 1,
      unit: 'Nos',
      rate: 0,
      discountType: 'percent',
      discountValue: 0,
      taxRate: profile?.defaultTaxRate ?? 18,
    },
  ]);

  // Quick Add Customer Modal
  const [quickCustOpen, setQuickCustOpen] = React.useState(false);
  const [quickCust, setQuickCust] = React.useState({
    name: '',
    companyName: '',
    email: '',
    phone: '',
    gstin: '',
    billingAddress: '',
    state: 'Maharashtra',
  });

  React.useEffect(() => {
    let active = true;
    async function init() {
      setLoading(true);
      try {
        const custRes = await customersApi.list({ includeArchived: Boolean(editId) });
        if (!active) return;

        if (editId) {
          if (docType === 'invoice') {
            const res = await invoicesApi.get(editId);
            const inv: Invoice = res.invoice;
            if (inv.status === 'cancelled') {
              notify('error', 'Cancelled invoices cannot be edited');
              navigate(`/invoices/${inv.id}`);
              return;
            }
            setCustomers(
              custRes.customers.filter((c) => !c.archived || c.id === inv.customerId)
            );
            setExistingDocNumber(inv.invoiceNumber);
            setExistingStatus(inv.status);
            setExistingAmountPaid(inv.amountPaid || 0);
            setCustomerId(inv.customerId);
            setDocDate(inv.invoiceDate);
            setDueDate(inv.dueDate);
            setPaymentTerms(inv.paymentTerms);
            setReferenceNumber(inv.referenceNumber);
            setPlaceOfSupply(inv.placeOfSupply);
            setIsGst(inv.isGst);
            setTaxMode(inv.taxMode);
            setTaxSupplyMode(inv.taxSupplyMode);
            setRoundOffEnabled(inv.roundOffEnabled);
            setTemplateId(inv.templateId);
            setNotes(inv.notes);
            setTerms(inv.terms);
            setLogoDataUrl(inv.businessSnapshot.logoDataUrl || profile?.logoDataUrl || '');
            setUpiId(inv.businessSnapshot.upiId ?? profile?.upiId ?? '');
            setItems(inv.items);
          } else {
            const res = await quotationsApi.get(editId);
            const quo: Quotation = res.quotation;
            if (quo.status !== 'draft') {
              notify('error', 'Only draft quotations can be edited');
              navigate(`/quotations/${quo.id}`);
              return;
            }
            setCustomers(
              custRes.customers.filter((c) => !c.archived || c.id === quo.customerId)
            );
            setExistingDocNumber(quo.quotationNumber);
            setExistingStatus(quo.status);
            setCustomerId(quo.customerId);
            setDocDate(quo.quotationDate);
            setDueDate(quo.validUntil);
            setReferenceNumber(quo.referenceNumber);
            setPlaceOfSupply(quo.placeOfSupply);
            setIsGst(quo.isGst);
            setTaxMode(quo.taxMode);
            setTaxSupplyMode(quo.taxSupplyMode);
            setRoundOffEnabled(quo.roundOffEnabled);
            setTemplateId(quo.templateId);
            setNotes(quo.notes);
            setTerms(quo.terms);
            setLogoDataUrl(quo.businessSnapshot.logoDataUrl || profile?.logoDataUrl || '');
            setUpiId(quo.businessSnapshot.upiId ?? profile?.upiId ?? '');
            setItems(quo.items);
          }
        } else {
          setCustomers(custRes.customers);
          setLogoDataUrl(profile?.logoDataUrl || '');
          setUpiId(profile?.upiId || '');
          if (custRes.customers.length > 0) {
            setCustomerId(custRes.customers[0].id);
            setPlaceOfSupply(custRes.customers[0].state || profile?.state || 'Maharashtra');
          }
        }
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Failed to load editor');
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [docType, editId, navigate, notify, profile?.state, profile?.logoDataUrl, profile?.upiId]);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const calc = React.useMemo(
    () =>
      computeDocumentTotals({
        items,
        businessState: profile?.state || 'Maharashtra',
        placeOfSupply,
        isGst,
        taxMode,
        taxSupplyMode,
        roundOffEnabled,
      }),
    [items, profile?.state, placeOfSupply, isGst, taxMode, taxSupplyMode, roundOffEnabled]
  );

  // Live A4 Preview record constructed from current editor state
  const previewRecord = React.useMemo<Invoice | Quotation>(() => {
    const businessSnapshot: BusinessSnapshot = {
      businessName: profile?.businessName || session?.effectiveUser.businessName || 'Your Business Name',
      ownerName: profile?.ownerName || session?.effectiveUser.ownerName || '',
      logoDataUrl,
      address: profile?.address || '',
      email: profile?.email || session?.effectiveUser.email || '',
      phone: profile?.phone || session?.effectiveUser.phone || '',
      gstin: profile?.gstin || session?.effectiveUser.gstin || '',
      pan: profile?.pan || '',
      state: profile?.state || 'Maharashtra',
      bankName: profile?.bankName || '',
      accountNumber: profile?.accountNumber || '',
      ifsc: profile?.ifsc || '',
      upiId: upiId.trim(),
      upiQrDataUrl: upiId.trim() ? '' : profile?.upiQrDataUrl || '',
      signatureLabel: profile?.signatureLabel || 'Authorized Signatory',
    };

    const customerSnapshot: CustomerSnapshot = selectedCustomer
      ? {
          id: selectedCustomer.id,
          name: selectedCustomer.name,
          companyName: selectedCustomer.companyName,
          email: selectedCustomer.email,
          phone: selectedCustomer.phone,
          gstin: selectedCustomer.gstin,
          billingAddress: selectedCustomer.billingAddress,
          shippingAddress: selectedCustomer.shippingAddress,
          state: selectedCustomer.state,
        }
      : {
          id: 'preview-customer',
          name: 'Select a customer',
          companyName: 'Customer Preview',
          email: '',
          phone: '',
          gstin: '',
          billingAddress: 'Customer billing address will appear here',
          shippingAddress: '',
          state: placeOfSupply,
        };

    const previewItems = calc.items.map((item, idx) => ({
      ...item,
      id: item.id || `preview-${idx}`,
      name: item.name.trim() || `Line Item ${idx + 1}`,
    }));

    const nowIso = new Date().toISOString();
    const base = {
      id: editId || 'preview',
      userUid: session?.effectiveUser.uid || '',
      customerId: customerId || 'preview-customer',
      customerSnapshot,
      businessSnapshot,
      referenceNumber,
      placeOfSupply,
      isGst,
      taxMode,
      taxSupplyMode,
      isInterState: calc.isInterState,
      roundOffEnabled,
      subtotal: calc.subtotal,
      totalDiscount: calc.totalDiscount,
      taxableAmount: calc.taxableAmount,
      cgstTotal: calc.cgstTotal,
      sgstTotal: calc.sgstTotal,
      igstTotal: calc.igstTotal,
      totalTax: calc.totalTax,
      roundOff: calc.roundOff,
      grandTotal: calc.grandTotal,
      amountInWords: calc.amountInWords,
      templateId,
      notes,
      terms,
      createdAt: nowIso,
      updatedAt: nowIso,
      items: previewItems,
    };

    if (docType === 'invoice') {
      const prefix = profile?.invoicePrefix || 'INV';
      const year = (docDate || today).slice(0, 4);
      const invPreview: Invoice = {
        ...base,
        invoiceNumber: existingDocNumber || `${prefix}-${year}-PREVIEW`,
        status: (existingStatus as Invoice['status']) || 'unpaid',
        invoiceDate: docDate,
        dueDate,
        paymentTerms,
        amountPaid: existingAmountPaid,
        balanceDue: Math.max(0, calc.grandTotal - existingAmountPaid),
        sourceQuotationId: null,
        cancellationReason: null,
        cancelledAt: null,
        finalizedAt: null,
      };
      return invPreview;
    }

    const qPrefix = profile?.quotationPrefix || 'QTN';
    const year = (docDate || today).slice(0, 4);
    const quoPreview: Quotation = {
      ...base,
      quotationNumber: existingDocNumber || `${qPrefix}-${year}-PREVIEW`,
      status: 'sent',
      quotationDate: docDate,
      validUntil: dueDate,
      convertedInvoiceId: null,
    };
    return quoPreview;
  }, [
    profile,
    session,
    logoDataUrl,
    upiId,
    selectedCustomer,
    placeOfSupply,
    calc,
    editId,
    customerId,
    referenceNumber,
    isGst,
    taxMode,
    taxSupplyMode,
    roundOffEnabled,
    templateId,
    notes,
    terms,
    docType,
    docDate,
    dueDate,
    paymentTerms,
    today,
    existingDocNumber,
    existingStatus,
    existingAmountPaid,
  ]);

  const updateItem = (idx: number, patch: Partial<LineItemInput>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        name: '',
        description: '',
        hsnSac: '',
        quantity: 1,
        unit: 'Nos',
        rate: 0,
        discountType: 'percent',
        discountValue: 0,
        taxRate: profile?.defaultTaxRate ?? 18,
      },
    ]);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleLogoUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const processed = await processLogoFile(file, 420);
      setLogoDataUrl(processed);
      notify('success', 'Business logo added to preview');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to process logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async (mode: 'draft' | 'issue' | 'download') => {
    if (!customerId) {
      notify('error', 'Please select or create a customer');
      return;
    }
    if (items.some((i) => !i.name.trim())) {
      notify('error', 'Every line item must have a name');
      return;
    }

    const saveAsDraft = mode === 'draft';
    setSavingMode(mode);
    try {
      const payload = {
        customerId,
        invoiceDate: docType === 'invoice' ? docDate : undefined,
        dueDate: docType === 'invoice' ? dueDate : undefined,
        quotationDate: docType === 'quotation' ? docDate : undefined,
        validUntil: docType === 'quotation' ? dueDate : undefined,
        paymentTerms,
        referenceNumber,
        placeOfSupply,
        isGst,
        taxMode,
        taxSupplyMode,
        roundOffEnabled,
        templateId,
        notes,
        terms,
        saveAsDraft,
        logoDataUrl,
        saveLogoToProfile,
        upiId: upiId.trim(),
        saveUpiToProfile,
        items,
      };

      if (profile) {
        const nextProfile = { ...profile };
        let profileChanged = false;
        if (saveLogoToProfile && logoDataUrl !== profile.logoDataUrl) {
          nextProfile.logoDataUrl = logoDataUrl;
          profileChanged = true;
        }
        if (saveUpiToProfile && upiId.trim() !== profile.upiId) {
          nextProfile.upiId = upiId.trim();
          profileChanged = true;
        }
        if (profileChanged) {
          updateLocalBusinessProfile(nextProfile);
        }
      }

      if (docType === 'invoice') {
        const res = editId
          ? await invoicesApi.update(editId, payload)
          : await invoicesApi.create(payload);

        if (mode === 'download') {
          await generateDocumentPdf('invoice', res.invoice);
          notify('success', `Invoice ${res.invoice.invoiceNumber} saved to Invoices & PDF downloaded`);
        } else {
          notify(
            'success',
            saveAsDraft
              ? 'Invoice saved as draft'
              : editId && existingStatus && existingStatus !== 'draft'
                ? `Invoice ${res.invoice.invoiceNumber} updated`
                : `Invoice ${res.invoice.invoiceNumber} issued`
          );
        }
        navigate(`/invoices/${res.invoice.id}`);
      } else {
        const res = editId
          ? await quotationsApi.update(editId, payload)
          : await quotationsApi.create(payload);

        if (mode === 'download') {
          await generateDocumentPdf('quotation', res.quotation);
          notify('success', `Quotation ${res.quotation.quotationNumber} saved & PDF downloaded`);
        } else {
          notify(
            'success',
            saveAsDraft
              ? 'Quotation saved as draft'
              : `Quotation ${res.quotation.quotationNumber} created`
          );
        }
        navigate(`/quotations/${res.quotation.id}`);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setSavingMode(null);
    }
  };

  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await customersApi.create(quickCust);
      setCustomers((prev) => [res.customer, ...prev]);
      setCustomerId(res.customer.id);
      setPlaceOfSupply(res.customer.state || placeOfSupply);
      setQuickCustOpen(false);
      notify('success', 'Customer added and selected');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to add customer');
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-zinc-500">Loading document builder...</div>;
  }

  const isBusy = savingMode !== null;

  return (
    <div className="space-y-5">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex flex-wrap items-center justify-between w-full md:w-auto gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(docType === 'invoice' ? '/invoices' : '/quotations')}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sm:hidden">Back</span>
            <span className="hidden sm:inline">
              Back to {docType === 'invoice' ? 'Invoices' : 'Quotations'}
            </span>
          </Button>

          <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`hidden xl:inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                viewMode === 'split'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Split View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('editor')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs font-medium cursor-pointer transition-colors ${
                viewMode === 'editor'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editor
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs font-medium cursor-pointer transition-colors ${
                viewMode === 'preview'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              A4 Preview
            </button>
          </div>
        </div>

        <div className="hidden md:flex flex-wrap items-center gap-2">
          {!(editId && docType === 'invoice' && existingStatus && existingStatus !== 'draft') ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => handleSave('draft')}
            >
              {savingMode === 'draft' ? 'Saving...' : 'Save as Draft'}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => handleSave('issue')}
          >
            {savingMode === 'issue'
              ? 'Saving...'
              : docType === 'invoice'
                ? editId && existingStatus && existingStatus !== 'draft'
                  ? 'Save Changes'
                  : 'Save Invoice'
                : 'Save & Send Quotation'}
          </Button>
          <Button size="sm" disabled={isBusy} onClick={() => handleSave('download')}>
            <Download className="h-4 w-4" />
            {savingMode === 'download' ? 'Saving & Downloading...' : 'Download PDF'}
          </Button>
        </div>
      </div>

      {/* Main Split Workspace: Editor Form + Live A4 Preview */}
      <div
        className={
          viewMode === 'split'
            ? 'grid grid-cols-1 xl:grid-cols-12 gap-6 items-start'
            : 'space-y-6'
        }
      >
        {/* Left: Form Builder */}
        {viewMode !== 'preview' ? (
          <div className={viewMode === 'split' ? 'xl:col-span-7 space-y-5' : 'space-y-6'}>
            {/* Business Logo & Customer */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
              {/* Ask for Business Logo & UPI ID */}
              <Card className="lg:col-span-5 order-2 lg:order-1">
                <CardHeader className="pb-3">
                  <CardTitle>Business Logo &amp; UPI QR</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3.5">
                    {logoDataUrl ? (
                      <div className="relative h-16 w-24 shrink-0 rounded-lg border border-zinc-200 bg-white p-1.5 flex items-center justify-center dark:border-zinc-800">
                        <img
                          src={logoDataUrl}
                          alt="Business logo"
                          className="max-h-full max-w-full object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => setLogoDataUrl('')}
                          title="Remove logo"
                          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:text-red-600 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-[11px] text-zinc-500 hover:border-[#F57C00] hover:text-[#F57C00] cursor-pointer dark:border-zinc-700 dark:bg-zinc-900">
                        <ImagePlus className="h-4 w-4 mb-1" />
                        <span>Add Logo</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            void handleLogoUpload(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}

                    <div className="space-y-1.5 min-w-0">
                      <label className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900">
                        <ImagePlus className="h-3.5 w-3.5 text-[#F57C00]" />
                        {uploadingLogo ? 'Processing...' : logoDataUrl ? 'Change Logo' : 'Upload Logo'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            void handleLogoUpload(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      <p className="text-[11px] text-zinc-500">
                        PNG, JPG, WebP or SVG. Shown on A4 preview &amp; PDF.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <Label htmlFor="doc-upi-id">UPI ID (Dynamic Payment QR)</Label>
                    <Input
                      id="doc-upi-id"
                      type="text"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      placeholder="yourname@okaxis"
                      className="font-mono text-base sm:text-xs h-11 sm:h-9"
                    />
                    {upiId.trim() ? (
                      !upiId.includes('@') ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          Include your @bank handle (e.g. business@okicici) for UPI apps.
                        </p>
                      ) : (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          QR synced to <span className="font-mono">{upiId.trim()}</span> ·{' '}
                          <span className="font-mono font-semibold">{formatINR(calc.grandTotal)}</span>
                        </p>
                      )
                    ) : (
                      <p className="text-[11px] text-zinc-500">
                        Enter a UPI ID to embed a scannable QR matched to the invoice total.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveLogoToProfile && saveUpiToProfile}
                        onChange={(e) => {
                          setSaveLogoToProfile(e.target.checked);
                          setSaveUpiToProfile(e.target.checked);
                        }}
                        className="accent-[#F57C00]"
                      />
                      Save logo &amp; UPI ID as default for future invoices
                    </label>
                  </div>

                  <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 space-y-0.5">
                    <div className="font-medium text-zinc-700 dark:text-zinc-300 truncate">
                      From: {profile?.businessName}
                    </div>
                    <div className="truncate">
                      GSTIN: <span className="font-mono">{profile?.gstin || 'Unregistered'}</span> ·{' '}
                      {profile?.state}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Customer Details */}
              <Card className="lg:col-span-7 order-1 lg:order-2">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle>Customer Details</CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => setQuickCustOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    New Customer
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label>Select Customer *</Label>
                    <Select
                      value={customerId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setCustomerId(id);
                        const found = customers.find((c) => c.id === id);
                        if (found?.state) setPlaceOfSupply(found.state);
                      }}
                    >
                      <option value="">-- Choose a customer --</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.companyName ? `${c.companyName} (${c.name})` : c.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {selectedCustomer ? (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs space-y-1 dark:border-zinc-800 dark:bg-zinc-950">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {selectedCustomer.companyName || selectedCustomer.name}
                      </div>
                      <div className="text-zinc-600 dark:text-zinc-400">
                        {selectedCustomer.billingAddress || 'No billing address'}
                      </div>
                      <div className="font-mono text-zinc-600 dark:text-zinc-400">
                        {selectedCustomer.gstin ? `GSTIN: ${selectedCustomer.gstin} · ` : ''}
                        State: {selectedCustomer.state}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800">
                      Select an existing customer or click New Customer to add one.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Metadata & GST Rules */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>
                  {docType === 'invoice'
                    ? 'Invoice Metadata & GST Rules'
                    : 'Quotation Metadata & GST Rules'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>{docType === 'invoice' ? 'Invoice Date' : 'Quotation Date'}</Label>
                    <Input
                      type="date"
                      value={docDate}
                      onChange={(e) => setDocDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{docType === 'invoice' ? 'Due Date' : 'Valid Until'}</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Reference / PO #</Label>
                    <Input
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      placeholder="PO-2026-01"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Place of Supply</Label>
                    <Select
                      value={placeOfSupply}
                      onChange={(e) => setPlaceOfSupply(e.target.value)}
                    >
                      {INDIAN_STATES.map((s) => (
                        <option key={s.code} value={s.name}>
                          {s.code} - {s.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>A4 Template</Label>
                    <Select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value as TemplateId)}
                    >
                      <option value="classic_gst">Classic GST Ledger</option>
                      <option value="executive_minimal">Executive Minimal</option>
                      <option value="compact_commercial">Compact Commercial</option>
                    </Select>
                  </div>
                  {docType === 'invoice' ? (
                    <div className="space-y-1">
                      <Label>Payment Terms</Label>
                      <Input
                        value={paymentTerms}
                        onChange={(e) => setPaymentTerms(e.target.value)}
                        placeholder="Net 15"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
                  <label className="flex min-h-[40px] sm:min-h-0 items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isGst}
                      onChange={(e) => setIsGst(e.target.checked)}
                      className="h-4 w-4 accent-[#F57C00]"
                    />
                    GST Document
                  </label>

                  <Select
                    value={taxMode}
                    disabled={!isGst}
                    onChange={(e) => setTaxMode(e.target.value as TaxPricingMode)}
                    className="h-11 sm:h-9 text-base sm:text-xs"
                  >
                    <option value="exclusive">GST Exclusive</option>
                    <option value="inclusive">GST Inclusive</option>
                  </Select>

                  <Select
                    value={taxSupplyMode}
                    disabled={!isGst}
                    onChange={(e) => setTaxSupplyMode(e.target.value as TaxSupplyMode)}
                    className="h-11 sm:h-9 text-base sm:text-xs"
                  >
                    <option value="auto">
                      Auto ({calc.isInterState ? 'IGST' : 'CGST+SGST'})
                    </option>
                    <option value="intra">Force Intra-State (CGST+SGST)</option>
                    <option value="inter">Force Inter-State (IGST)</option>
                  </Select>

                  <label className="flex min-h-[40px] sm:min-h-0 items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={roundOffEnabled}
                      onChange={(e) => setRoundOffEnabled(e.target.checked)}
                      className="h-4 w-4 accent-[#F57C00]"
                    />
                    Auto Round-Off
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Line Items Table (Desktop) + Card Builder (Mobile) */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle>Line Items ({items.length})</CardTitle>
                <Button size="sm" variant="outline" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5" />
                  Add Item
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {/* Mobile Line Items Card Builder */}
                <div className="md:hidden p-3.5 space-y-3.5 border-t border-zinc-100 dark:border-zinc-800">
                  {items.map((item, idx) => {
                    const computed = calc.items[idx];
                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5 space-y-3 dark:border-zinc-800 dark:bg-zinc-950/50"
                      >
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-200/80 dark:border-zinc-800">
                          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                            Item #{idx + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold tabular-nums text-[#F57C00]">
                              {formatINR(computed?.totalAmount || 0)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              disabled={items.length <= 1}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-red-600 disabled:opacity-30 dark:border-zinc-800 dark:bg-zinc-900 cursor-pointer"
                              aria-label={`Remove item ${idx + 1}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label>Item / Service Name *</Label>
                          <Input
                            value={item.name}
                            onChange={(e) => updateItem(idx, { name: e.target.value })}
                            placeholder="Service or product name"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label>Description (Optional)</Label>
                          <Input
                            value={item.description}
                            onChange={(e) => updateItem(idx, { description: e.target.value })}
                            placeholder="Details or scope"
                          />
                        </div>

                        <div className={`grid gap-2.5 ${isGst ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {isGst ? (
                            <div className="space-y-1">
                              <Label>HSN / SAC</Label>
                              <Input
                                value={item.hsnSac}
                                onChange={(e) => updateItem(idx, { hsnSac: e.target.value })}
                                placeholder="998314"
                                className="font-mono"
                              />
                            </div>
                          ) : null}
                          <div className="space-y-1">
                            <Label>Unit</Label>
                            <Input
                              value={item.unit}
                              onChange={(e) => updateItem(idx, { unit: e.target.value })}
                              placeholder="Nos / Hrs"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                          <div className="space-y-1">
                            <Label>Quantity</Label>
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(idx, { quantity: Number(e.target.value) })
                              }
                              className="font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Rate (INR)</Label>
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={item.rate}
                              onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })}
                              className="font-mono"
                            />
                          </div>
                        </div>

                        <div className={`grid gap-2.5 ${isGst ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          <div className="space-y-1">
                            <Label>Discount</Label>
                            <div className="flex gap-1.5">
                              <Input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={item.discountValue}
                                onChange={(e) =>
                                  updateItem(idx, { discountValue: Number(e.target.value) })
                                }
                                className="font-mono flex-1 min-w-0"
                              />
                              <Select
                                value={item.discountType}
                                onChange={(e) =>
                                  updateItem(idx, {
                                    discountType: e.target.value as 'percent' | 'fixed',
                                  })
                                }
                                className="w-16 px-2"
                              >
                                <option value="percent">%</option>
                                <option value="fixed">₹</option>
                              </Select>
                            </div>
                          </div>
                          {isGst ? (
                            <div className="space-y-1">
                              <Label>GST Rate (%)</Label>
                              <Select
                                value={item.taxRate}
                                onChange={(e) =>
                                  updateItem(idx, { taxRate: Number(e.target.value) })
                                }
                                className="font-mono"
                              >
                                {[0, 5, 12, 18, 28].map((r) => (
                                  <option key={r} value={r}>
                                    {r}%
                                  </option>
                                ))}
                              </Select>
                            </div>
                          ) : null}
                        </div>

                        {isGst || (computed?.discountAmount || 0) > 0 ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200/70 dark:border-zinc-800 text-[11px] text-zinc-500 font-mono">
                            <span>Taxable: {formatINR(computed?.taxableAmount || 0)}</span>
                            {isGst ? (
                              <span>
                                GST ({item.taxRate}%): {formatINR(computed?.taxAmount || 0)}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <Button type="button" variant="outline" className="w-full" onClick={addItem}>
                    <Plus className="h-4 w-4" />
                    Add Another Item
                  </Button>
                </div>

                {/* Desktop Line Items Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-medium min-w-[170px]">
                          Item & Description
                        </th>
                        {isGst ? (
                          <th className="px-2 py-2.5 text-left font-medium w-22">HSN/SAC</th>
                        ) : null}
                        <th className="px-2 py-2.5 text-right font-medium w-18">Qty</th>
                        <th className="px-2 py-2.5 text-left font-medium w-18">Unit</th>
                        <th className="px-2 py-2.5 text-right font-medium w-24">Rate (INR)</th>
                        <th className="px-2 py-2.5 text-right font-medium w-28">Discount</th>
                        {isGst ? (
                          <th className="px-2 py-2.5 text-right font-medium w-20">GST %</th>
                        ) : null}
                        <th className="px-3 py-2.5 text-right font-medium w-24">Total</th>
                        <th className="px-2 py-2.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {items.map((item, idx) => {
                        const computed = calc.items[idx];
                        return (
                          <tr key={idx} className="align-top">
                            <td className="px-3 py-2.5 space-y-1.5">
                              <Input
                                value={item.name}
                                onChange={(e) => updateItem(idx, { name: e.target.value })}
                                placeholder="Service or product name"
                                className="h-8 text-xs"
                              />
                              <Input
                                value={item.description}
                                onChange={(e) => updateItem(idx, { description: e.target.value })}
                                placeholder="Optional description"
                                className="h-7 text-[11px] text-zinc-500"
                              />
                            </td>
                            {isGst ? (
                              <td className="px-2 py-2.5">
                                <Input
                                  value={item.hsnSac}
                                  onChange={(e) => updateItem(idx, { hsnSac: e.target.value })}
                                  placeholder="998314"
                                  className="h-8 text-xs font-mono"
                                />
                              </td>
                            ) : null}
                            <td className="px-2 py-2.5">
                              <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={item.quantity}
                                onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                                className="h-8 text-xs text-right font-mono"
                              />
                            </td>
                            <td className="px-2 py-2.5">
                              <Input
                                value={item.unit}
                                onChange={(e) => updateItem(idx, { unit: e.target.value })}
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-2 py-2.5">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.rate}
                                onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })}
                                className="h-8 text-xs text-right font-mono"
                              />
                            </td>
                            <td className="px-2 py-2.5">
                              <div className="flex gap-1">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.discountValue}
                                  onChange={(e) =>
                                    updateItem(idx, { discountValue: Number(e.target.value) })
                                  }
                                  className="h-8 text-xs text-right font-mono w-14"
                                />
                                <Select
                                  value={item.discountType}
                                  onChange={(e) =>
                                    updateItem(idx, {
                                      discountType: e.target.value as 'percent' | 'fixed',
                                    })
                                  }
                                  className="h-8 text-[11px] px-1 w-12"
                                >
                                  <option value="percent">%</option>
                                  <option value="fixed">₹</option>
                                </Select>
                              </div>
                            </td>
                            {isGst ? (
                              <td className="px-2 py-2.5">
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
                            <td className="px-3 py-3 text-right font-mono tabular-nums font-semibold">
                              {formatINR(computed?.totalAmount || 0)}
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeItem(idx)}
                                disabled={items.length <= 1}
                                className="p-1.5 text-zinc-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                                aria-label="Remove item"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Notes + Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <Card className="lg:col-span-7">
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-1">
                    <Label>Customer Notes</Label>
                    <Textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Thank you for your business."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Terms & Conditions</Label>
                    <Textarea
                      rows={3}
                      value={terms}
                      onChange={(e) => setTerms(e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-5">
                <CardContent className="p-5 space-y-2.5 text-sm">
                  <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">{formatINR(calc.subtotal)}</span>
                  </div>
                  {calc.totalDiscount > 0 ? (
                    <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">-{formatINR(calc.totalDiscount)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-zinc-700 dark:text-zinc-300">
                    <span>Taxable Value</span>
                    <span className="font-mono tabular-nums">{formatINR(calc.taxableAmount)}</span>
                  </div>
                  {isGst ? (
                    calc.isInterState ? (
                      <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                        <span>IGST</span>
                        <span className="font-mono tabular-nums">{formatINR(calc.igstTotal)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                          <span>CGST</span>
                          <span className="font-mono tabular-nums">{formatINR(calc.cgstTotal)}</span>
                        </div>
                        <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                          <span>SGST</span>
                          <span className="font-mono tabular-nums">{formatINR(calc.sgstTotal)}</span>
                        </div>
                      </>
                    )
                  ) : null}
                  {calc.roundOff !== 0 ? (
                    <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                      <span>Round Off</span>
                      <span className="font-mono tabular-nums">{formatINR(calc.roundOff)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-800 pt-3 text-base font-bold">
                    <span>Grand Total</span>
                    <span className="font-mono tabular-nums text-[#F57C00]">
                      {formatINR(calc.grandTotal)}
                    </span>
                  </div>
                  <div className="pt-1 text-xs text-zinc-500">{calc.amountInWords}</div>
                </CardContent>
              </Card>
            </div>

            {/* Mobile Document Actions */}
            <Card className="md:hidden">
              <CardContent className="p-4 space-y-2.5">
                <Button
                  type="button"
                  className="w-full"
                  disabled={isBusy}
                  onClick={() => handleSave('download')}
                >
                  <Download className="h-4 w-4" />
                  {savingMode === 'download'
                    ? 'Saving & Downloading...'
                    : `Save & Download ${docType === 'invoice' ? 'Invoice' : 'Quotation'} PDF`}
                </Button>
                <div
                  className={
                    editId && docType === 'invoice' && existingStatus && existingStatus !== 'draft'
                      ? 'grid grid-cols-1'
                      : 'grid grid-cols-2 gap-2.5'
                  }
                >
                  {!(editId && docType === 'invoice' && existingStatus && existingStatus !== 'draft') ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => handleSave('draft')}
                    >
                      {savingMode === 'draft' ? 'Saving...' : 'Save Draft'}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => handleSave('issue')}
                  >
                    {savingMode === 'issue'
                      ? 'Saving...'
                      : docType === 'invoice'
                        ? editId && existingStatus && existingStatus !== 'draft'
                          ? 'Save Changes'
                          : 'Save Invoice'
                        : 'Save & Send'}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-xs text-zinc-600 dark:text-zinc-300"
                  onClick={() => setViewMode('preview')}
                >
                  <FileText className="h-4 w-4" />
                  Preview A4 {docType === 'invoice' ? 'Invoice' : 'Quotation'}
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Right / Full: Live A4 Preview */}
        {viewMode !== 'editor' ? (
          <div
            className={
              viewMode === 'split'
                ? 'xl:col-span-5 xl:sticky xl:top-20 space-y-3'
                : 'max-w-[840px] mx-auto space-y-3'
            }
          >
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-4 border-b border-zinc-100 dark:border-zinc-800">
                <div>
                  <CardTitle className="text-sm">
                    Live A4 {docType === 'invoice' ? 'Invoice' : 'Quotation'} Preview
                  </CardTitle>
                  <p className="text-[11px] text-zinc-500">
                    210 × 297 mm · Updates in real time
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setFullPreviewOpen(true)}
                    title="Expand full-size A4 preview"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Expand</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => handleSave('download')}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {savingMode === 'download' ? 'Saving...' : 'Download PDF'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 bg-zinc-100 dark:bg-zinc-900/70">
                {viewMode === 'preview' ? (
                  <>
                    <div className="md:hidden py-1">
                      <ScaledA4Preview
                        docType={docType}
                        record={previewRecord}
                        templateId={templateId}
                      />
                    </div>
                    <div className="hidden md:block overflow-x-auto py-2">
                      <DocumentPreviewSheet
                        docType={docType}
                        record={previewRecord}
                        templateOverride={templateId}
                        a4Ratio
                      />
                    </div>
                  </>
                ) : (
                  <ScaledA4Preview
                    docType={docType}
                    record={previewRecord}
                    templateId={templateId}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      {/* Full-Size A4 Preview Modal */}
      <Dialog
        open={fullPreviewOpen}
        onClose={() => setFullPreviewOpen(false)}
        title={`A4 ${docType === 'invoice' ? 'Invoice' : 'Quotation'} Preview`}
        description="Full-scale A4 sheet (210 × 297 mm). Click Download PDF to save to Invoices and download."
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setFullPreviewOpen(false)}>
              Close
            </Button>
            <Button size="sm" disabled={isBusy} onClick={() => handleSave('download')}>
              <Download className="h-3.5 w-3.5" />
              {savingMode === 'download' ? 'Saving...' : 'Save & Download PDF'}
            </Button>
          </div>
          <div className="max-h-[75vh] overflow-auto rounded-lg bg-zinc-100 p-4 dark:bg-zinc-900">
            <DocumentPreviewSheet
              docType={docType}
              record={previewRecord}
              templateOverride={templateId}
              a4Ratio
            />
          </div>
        </div>
      </Dialog>

      {/* Quick Customer Modal */}
      <Dialog
        open={quickCustOpen}
        onClose={() => setQuickCustOpen(false)}
        title="Quick Add Customer"
      >
        <form onSubmit={handleQuickCreateCustomer} className="space-y-3">
          <div className="space-y-1">
            <Label>Contact Name *</Label>
            <Input
              required
              value={quickCust.name}
              onChange={(e) => setQuickCust({ ...quickCust, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Company Name</Label>
            <Input
              value={quickCust.companyName}
              onChange={(e) => setQuickCust({ ...quickCust, companyName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>GSTIN</Label>
              <Input
                value={quickCust.gstin}
                onChange={(e) => {
                  const g = e.target.value.toUpperCase();
                  const derived = getStateFromGstin(g);
                  setQuickCust({ ...quickCust, gstin: g, state: derived || quickCust.state });
                }}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>State</Label>
              <Select
                value={quickCust.state}
                onChange={(e) => setQuickCust({ ...quickCust, state: e.target.value })}
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={quickCust.email}
                onChange={(e) => setQuickCust({ ...quickCust, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={quickCust.phone}
                onChange={(e) => setQuickCust({ ...quickCust, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Billing Address</Label>
            <Textarea
              rows={2}
              value={quickCust.billingAddress}
              onChange={(e) => setQuickCust({ ...quickCust, billingAddress: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setQuickCustOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Customer</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
