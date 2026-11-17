import * as React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  Check,
  Columns2,
  CreditCard,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FileText,
  ImagePlus,
  Maximize2,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  businessApi,
  cachedRead,
  customersApi,
  invoicesApi,
  paymentsApi,
  quotationsApi,
  rateCardApi,
} from '../lib/api';
import { generateDocumentPdf } from '../lib/pdfGenerator';
import { formatDate, processLogoFile } from '../lib/utils';
import { computeDocumentTotals, formatINR } from '../shared/gstCalculator';
import { INDIAN_STATES, getStateFromGstin } from '../shared/indianStates';
import type {
  BusinessSnapshot,
  Customer,
  CustomerSnapshot,
  Invoice,
  LineItemInput,
  Payment,
  PaymentMethod,
  Quotation,
  RateCardItem,
  TaxPricingMode,
  TaxSupplyMode,
  TemplateId,
} from '../shared/types';
import { DocumentPreviewSheet } from './DocumentPreviewSheet';
import { InvoiceThemeSelector } from './invoice/InvoiceThemeSelector';
import { INVOICE_THEMES, normalizeTemplateId } from './invoice/invoiceThemeRegistry';
import type { StandardTemplateId } from './invoice/invoiceThemeTypes';
import { QuotationThemeSelector } from './quotation/QuotationThemeSelector';
import {
  QUOTATION_THEMES,
  normalizeQuotationTemplateId,
} from './quotation/quotationThemeRegistry';
import type { QuotationTemplateId } from './quotation/quotationThemeTypes';
import { HsnSacSelector } from './HsnSacSelector';
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
  const isLandscape = templateId === 'landscape_theme_2' || templateId === 'landscape_pro';
  const baseW = isLandscape ? 1123 : 794;
  const baseH = isLandscape ? 794 : 1123;
  const [scale, setScale] = React.useState(0.55);
  const [sheetHeight, setSheetHeight] = React.useState(baseH);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const updateMetrics = () => {
      const availW = container.clientWidth;
      if (availW > 0) {
        setScale(Math.min(1, availW / baseW));
      }
      if (sheet.scrollHeight > 0) {
        setSheetHeight(Math.max(baseH, sheet.scrollHeight));
      }
    };

    updateMetrics();
    const ro = new ResizeObserver(updateMetrics);
    ro.observe(container);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [record, templateId, baseW, baseH]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden">
      <div
        className="relative mx-auto"
        style={{
          width: `${Math.round(baseW * scale)}px`,
          height: `${Math.ceil(sheetHeight * scale)}px`,
        }}
      >
        <div
          ref={sheetRef}
          style={{
            width: `${baseW}px`,
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

  const tenantUid = session?.effectiveUser.uid;
  const cachedEntry = React.useMemo(
    () => (tenantUid ? cachedRead.getTenantEntry(tenantUid) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantUid, docType, editId]
  );

  const initialHydrated = React.useMemo(() => {
    if (!tenantUid || !cachedEntry) return null;
    const hasCusts = cachedRead.hasTenantCollectionData(tenantUid, 'customers');
    if (!hasCusts) return null;
    if (!editId) {
      const activeCusts = cachedEntry.customers.filter((c) => !c.archived);
      return {
        customers: activeCusts,
        inv: null as (Invoice & { payments?: Payment[] }) | null,
        quo: null as Quotation | null,
      };
    }
    if (docType === 'invoice') {
      if (!cachedRead.hasTenantCollectionData(tenantUid, 'invoices')) return null;
      const foundInv = cachedEntry.invoices.find((i) => i.id === editId);
      if (!foundInv || foundInv.status === 'cancelled') return null;
      const pays = cachedEntry.payments
        .filter((p) => p.invoiceId === editId)
        .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
      return {
        customers: cachedEntry.customers.filter(
          (c) => !c.archived || c.id === foundInv.customerId
        ),
        inv: { ...foundInv, payments: pays },
        quo: null as Quotation | null,
      };
    } else {
      if (!cachedRead.hasTenantCollectionData(tenantUid, 'quotations')) return null;
      const foundQuo = cachedEntry.quotations.find((q) => q.id === editId);
      if (!foundQuo || foundQuo.status !== 'draft') return null;
      return {
        customers: cachedEntry.customers.filter(
          (c) => !c.archived || c.id === foundQuo.customerId
        ),
        inv: null as (Invoice & { payments?: Payment[] }) | null,
        quo: foundQuo,
      };
    }
  }, [tenantUid, cachedEntry, editId, docType]);

  const [customers, setCustomers] = React.useState<Customer[]>(
    () => initialHydrated?.customers || []
  );
  const [loading, setLoading] = React.useState(() => !initialHydrated);
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

  const hydratedDoc = initialHydrated?.inv || initialHydrated?.quo;

  const [customerId, setCustomerId] = React.useState(
    () =>
      hydratedDoc?.customerId ||
      (!editId && initialHydrated?.customers.length ? initialHydrated.customers[0].id : '')
  );
  const [docDate, setDocDate] = React.useState(
    () =>
      initialHydrated?.inv?.invoiceDate ||
      initialHydrated?.quo?.quotationDate ||
      today
  );
  const [dueDate, setDueDate] = React.useState(
    () =>
      initialHydrated?.inv?.dueDate ||
      initialHydrated?.quo?.validUntil ||
      defaultDue
  );
  const [paymentTerms, setPaymentTerms] = React.useState(
    () =>
      initialHydrated?.inv?.paymentTerms ||
      initialHydrated?.quo?.paymentTerms ||
      (docType === 'invoice' ? `Net ${defaultTermsDays}` : '')
  );
  const [quotationTitle, setQuotationTitle] = React.useState(
    () => initialHydrated?.quo?.quotationTitle || ''
  );
  const [projectDescription, setProjectDescription] = React.useState(
    () => initialHydrated?.quo?.projectDescription || ''
  );
  const [deliveryTimeline, setDeliveryTimeline] = React.useState(
    () => initialHydrated?.quo?.deliveryTimeline || ''
  );
  const [preparedBy, setPreparedBy] = React.useState(
    () => initialHydrated?.quo?.preparedBy || profile?.ownerName || ''
  );
  const [showPaymentInstructions, setShowPaymentInstructions] = React.useState<boolean>(
    () => Boolean(initialHydrated?.quo?.showPaymentInstructions)
  );
  const [paymentInstructions, setPaymentInstructions] = React.useState(
    () => initialHydrated?.quo?.paymentInstructions || ''
  );
  const [referenceNumber, setReferenceNumber] = React.useState(
    () => hydratedDoc?.referenceNumber || ''
  );
  const [placeOfSupply, setPlaceOfSupply] = React.useState(
    () =>
      hydratedDoc?.placeOfSupply ||
      (!editId && initialHydrated?.customers[0]?.state) ||
      profile?.state ||
      'Maharashtra'
  );
  const [isGst, setIsGst] = React.useState(
    () => hydratedDoc?.isGst ?? (profile?.defaultIsGst ?? true)
  );
  const [taxMode, setTaxMode] = React.useState<TaxPricingMode>(
    () => hydratedDoc?.taxMode || profile?.defaultTaxMode || 'exclusive'
  );
  const [taxSupplyMode, setTaxSupplyMode] = React.useState<TaxSupplyMode>(
    () => hydratedDoc?.taxSupplyMode || 'auto'
  );
  const [roundOffEnabled, setRoundOffEnabled] = React.useState(
    () => hydratedDoc?.roundOffEnabled ?? true
  );
  const [templateId, setTemplateId] = React.useState<TemplateId>(() =>
    docType === 'invoice'
      ? normalizeTemplateId(hydratedDoc?.templateId || profile?.defaultInvoiceTemplate)
      : normalizeQuotationTemplateId(hydratedDoc?.templateId || profile?.defaultQuotationTemplate)
  );
  const [settingDefaultTheme, setSettingDefaultTheme] = React.useState(false);

  const handleSetDefaultTheme = async (newThemeId: StandardTemplateId | QuotationTemplateId) => {
    try {
      setSettingDefaultTheme(true);
      const res =
        docType === 'invoice'
          ? await businessApi.updateProfile({ defaultInvoiceTemplate: newThemeId })
          : await businessApi.updateProfile({ defaultQuotationTemplate: newThemeId });
      updateLocalBusinessProfile(res.profile);
      setTemplateId(newThemeId);
      notify(
        'success',
        docType === 'invoice'
          ? 'Default invoice theme updated for all new invoices.'
          : 'Default quotation theme updated for all new quotations.'
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update default theme');
    } finally {
      setSettingDefaultTheme(false);
    }
  };
  const [notes, setNotes] = React.useState(() => hydratedDoc?.notes || '');
  const [terms, setTerms] = React.useState(
    () => hydratedDoc?.terms ?? profile?.termsAndConditions ?? ''
  );

  // Logo & UPI state (asked right inside invoice creation)
  const [logoDataUrl, setLogoDataUrl] = React.useState<string>(
    () => hydratedDoc?.businessSnapshot.logoDataUrl || profile?.logoDataUrl || ''
  );
  const [saveLogoToProfile, setSaveLogoToProfile] = React.useState<boolean>(true);
  const [upiId, setUpiId] = React.useState<string>(
    () => hydratedDoc?.businessSnapshot.upiId ?? profile?.upiId ?? ''
  );
  const [saveUpiToProfile, setSaveUpiToProfile] = React.useState<boolean>(true);
  const [uploadingLogo, setUploadingLogo] = React.useState(false);
  const [existingDocNumber, setExistingDocNumber] = React.useState<string>(
    () => initialHydrated?.inv?.invoiceNumber || initialHydrated?.quo?.quotationNumber || ''
  );
  const [existingStatus, setExistingStatus] = React.useState<string | null>(
    () => hydratedDoc?.status || null
  );
  const [existingAmountPaid, setExistingAmountPaid] = React.useState<number>(
    () => initialHydrated?.inv?.amountPaid || 0
  );
  const [invoicePayments, setInvoicePayments] = React.useState<Payment[]>(
    () => initialHydrated?.inv?.payments || []
  );

  // Rate card state
  const [rateCardItems, setRateCardItems] = React.useState<RateCardItem[]>(() =>
    tenantUid ? cachedRead.getTenantEntry(tenantUid).rateCard.filter((r) => r.isActive) : []
  );
  const [ratePickerOpen, setRatePickerOpen] = React.useState(false);
  const [rateSearch, setRateSearch] = React.useState('');
  const [rateCategory, setRateCategory] = React.useState('all');
  const [selectedRateIds, setSelectedRateIds] = React.useState<string[]>([]);
  const [savingToRateCardIdx, setSavingToRateCardIdx] = React.useState<number | null>(null);

  // Inline payment management state when editing a finalized invoice
  const [paymentsModalOpen, setPaymentsModalOpen] = React.useState(false);
  const [editingPayId, setEditingPayId] = React.useState<string | null>(null);
  const [editPayForm, setEditPayForm] = React.useState({
    paymentDate: '',
    amount: 0,
    paymentMethod: 'UPI' as PaymentMethod,
    referenceId: '',
    notes: '',
  });
  const [savingPayEdit, setSavingPayEdit] = React.useState(false);
  const [deletingPayId, setDeletingPayId] = React.useState<string | null>(null);

  // Guard user-initiated overrides on new documents so async profile loads still apply cleanly
  const userTouchedGstRef = React.useRef(false);
  const userTouchedTaxModeRef = React.useRef(false);
  const userTouchedTemplateRef = React.useRef(false);
  const userTouchedTermsRef = React.useRef(false);

  const [items, setItems] = React.useState<LineItemInput[]>(() =>
    hydratedDoc?.items?.length
      ? hydratedDoc.items
      : [
          {
            name: '',
            description: '',
            hsnSac: '',
            quantity: 1,
            unit: 'Nos',
            rate: 0,
            discountType: 'percent',
            discountValue: 0,
            taxRate: profile?.defaultIsGst === false ? 0 : (profile?.defaultTaxRate ?? 18),
          },
        ]
  );

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

  // Sync profile defaults onto untouched new documents whenever profile changes
  React.useEffect(() => {
    if (editId || !profile) return;
    if (!userTouchedGstRef.current) {
      setIsGst(profile.defaultIsGst !== false);
    }
    if (!userTouchedTaxModeRef.current) {
      setTaxMode(profile.defaultTaxMode || 'exclusive');
    }
    if (!userTouchedTemplateRef.current) {
      setTemplateId(
        docType === 'invoice'
          ? normalizeTemplateId(profile.defaultInvoiceTemplate)
          : normalizeQuotationTemplateId(profile.defaultQuotationTemplate)
      );
    }
    if (docType === 'quotation' && !preparedBy && profile.ownerName) {
      setPreparedBy(profile.ownerName);
    }
    if (!userTouchedTermsRef.current) {
      setTerms(profile.termsAndConditions || '');
    }
  }, [editId, docType, profile]);

  const loadRateCard = React.useCallback(async () => {
    try {
      const res = await rateCardApi.list({ activeOnly: true });
      setRateCardItems(res.items);
    } catch {
      // ignore transient
    }
  }, []);

  React.useEffect(() => {
    void loadRateCard();
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('rateCard')) {
        setRateCardItems(cachedRead.getTenantEntry(tenantUid).rateCard.filter((r) => r.isActive));
      }
    });
  }, [tenantUid, loadRateCard]);

  React.useEffect(() => {
    let active = true;
    const wasHydrated = Boolean(initialHydrated);
    async function init() {
      if (!wasHydrated) setLoading(true);
      try {
        const custRes = await customersApi.list({ includeArchived: Boolean(editId) });
        if (!active) return;

        if (editId) {
          if (docType === 'invoice') {
            const res = await invoicesApi.get(editId);
            if (!active) return;
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
            setInvoicePayments(inv.payments || []);
            if (!wasHydrated) {
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
              setTemplateId(normalizeTemplateId(inv.templateId));
              setNotes(inv.notes);
              setTerms(inv.terms);
              setLogoDataUrl(inv.businessSnapshot.logoDataUrl || profile?.logoDataUrl || '');
              setUpiId(inv.businessSnapshot.upiId ?? profile?.upiId ?? '');
              setItems(inv.items);
            }
          } else {
            const res = await quotationsApi.get(editId);
            if (!active) return;
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
            if (!wasHydrated) {
              setCustomerId(quo.customerId);
              setDocDate(quo.quotationDate);
              setDueDate(quo.validUntil);
              setReferenceNumber(quo.referenceNumber);
              setPlaceOfSupply(quo.placeOfSupply);
              setIsGst(quo.isGst);
              setTaxMode(quo.taxMode);
              setTaxSupplyMode(quo.taxSupplyMode);
              setRoundOffEnabled(quo.roundOffEnabled);
              setTemplateId(normalizeQuotationTemplateId(quo.templateId));
              setQuotationTitle(quo.quotationTitle || '');
              setProjectDescription(quo.projectDescription || '');
              setDeliveryTimeline(quo.deliveryTimeline || '');
              setPaymentTerms(quo.paymentTerms || '');
              setPreparedBy(quo.preparedBy || profile?.ownerName || '');
              setShowPaymentInstructions(Boolean(quo.showPaymentInstructions));
              setPaymentInstructions(quo.paymentInstructions || '');
              setNotes(quo.notes);
              setTerms(quo.terms);
              setLogoDataUrl(quo.businessSnapshot.logoDataUrl || profile?.logoDataUrl || '');
              setUpiId(quo.businessSnapshot.upiId ?? profile?.upiId ?? '');
              setItems(quo.items);
            }
          }
        } else {
          setCustomers(custRes.customers);
          if (!wasHydrated) {
            setLogoDataUrl(profile?.logoDataUrl || '');
            setUpiId(profile?.upiId || '');
            if (custRes.customers.length > 0) {
              setCustomerId((prev) => prev || custRes.customers[0].id);
              setPlaceOfSupply(custRes.customers[0].state || profile?.state || 'Maharashtra');
            }
          }
        }
      } catch (err) {
        if (!wasHydrated) {
          notify('error', err instanceof Error ? err.message : 'Failed to load editor');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void init();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, editId, tenantUid]);

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
      signatureDataUrl: profile?.signatureDataUrl || '',
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
      quotationTitle: quotationTitle.trim() || undefined,
      projectDescription: projectDescription.trim() || undefined,
      deliveryTimeline: deliveryTimeline.trim() || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      preparedBy: preparedBy.trim() || undefined,
      showPaymentInstructions,
      paymentInstructions: showPaymentInstructions ? paymentInstructions.trim() : undefined,
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
    quotationTitle,
    projectDescription,
    deliveryTimeline,
    preparedBy,
    showPaymentInstructions,
    paymentInstructions,
    today,
    existingDocNumber,
    existingStatus,
    existingAmountPaid,
  ]);

  const updateItem = (idx: number, patch: Partial<LineItemInput>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        // Auto-fill from Rate Card when matching name is selected on a fresh row
        if (patch.name !== undefined && it.rate === 0) {
          const match = rateCardItems.find(
            (rc) => rc.name.toLowerCase() === patch.name!.trim().toLowerCase()
          );
          if (match) {
            return {
              ...next,
              name: match.name,
              description: next.description || match.description,
              hsnSac: next.hsnSac || match.hsnSac,
              unit: match.unit || next.unit,
              rate: match.rate,
              discountType: match.discountType,
              discountValue: match.discountValue,
              taxRate: isGst ? match.taxRate : 0,
            };
          }
        }
        return next;
      })
    );
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
        taxRate: isGst ? (profile?.defaultTaxRate ?? 18) : 0,
      },
    ]);
  };

  const insertRateCardItems = (selected: RateCardItem[]) => {
    if (selected.length === 0) return;
    const mapped: LineItemInput[] = selected.map((rc) => ({
      name: rc.name,
      description: rc.description,
      hsnSac: isGst ? rc.hsnSac : '',
      quantity: 1,
      unit: rc.unit || 'Nos',
      rate: rc.rate,
      discountType: rc.discountType || 'percent',
      discountValue: rc.discountValue || 0,
      taxRate: isGst ? rc.taxRate : 0,
    }));
    setItems((prev) => {
      const onlyEmptyPlaceholder =
        prev.length === 1 && !prev[0].name.trim() && Number(prev[0].rate) === 0;
      return onlyEmptyPlaceholder ? mapped : [...prev, ...mapped];
    });
    notify('success', `Added ${selected.length} item${selected.length === 1 ? '' : 's'} from Rate Card`);
  };

  const handleSaveLineItemToRateCard = async (idx: number) => {
    const item = items[idx];
    if (!item || !item.name.trim()) return;
    setSavingToRateCardIdx(idx);
    try {
      await rateCardApi.create({
        name: item.name.trim(),
        description: item.description.trim(),
        hsnSac: item.hsnSac.trim(),
        unit: item.unit.trim() || 'Nos',
        rate: Number(item.rate) || 0,
        discountType: item.discountType,
        discountValue: Number(item.discountValue) || 0,
        taxRate: isGst ? Number(item.taxRate) : 0,
        category: 'Services',
        isActive: true,
      });
      await loadRateCard();
      notify('success', `"${item.name.trim()}" saved to Rate Card`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save to Rate Card');
    } finally {
      setSavingToRateCardIdx(null);
    }
  };

  const refreshInvoicePayments = async () => {
    if (!editId || docType !== 'invoice') return;
    try {
      const res = await invoicesApi.get(editId);
      setInvoicePayments(res.invoice.payments || []);
      setExistingAmountPaid(res.invoice.amountPaid || 0);
      setExistingStatus(res.invoice.status);
    } catch {
      // ignore
    }
  };

  const handleSaveInlinePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayId) return;
    setSavingPayEdit(true);
    try {
      await paymentsApi.update(editingPayId, editPayForm);
      notify('success', 'Payment updated and invoice totals synced');
      setEditingPayId(null);
      await refreshInvoicePayments();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update payment');
    } finally {
      setSavingPayEdit(false);
    }
  };

  const handleDeleteInlinePayment = async (paymentId: string) => {
    setDeletingPayId(paymentId);
    try {
      await paymentsApi.remove(paymentId);
      notify('success', 'Payment deleted');
      await refreshInvoicePayments();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete payment');
    } finally {
      setDeletingPayId(null);
    }
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
        templateId:
          docType === 'invoice'
            ? normalizeTemplateId(templateId)
            : normalizeQuotationTemplateId(templateId),
        quotationTitle: docType === 'quotation' ? quotationTitle : undefined,
        projectDescription: docType === 'quotation' ? projectDescription : undefined,
        deliveryTimeline: docType === 'quotation' ? deliveryTimeline : undefined,
        preparedBy: docType === 'quotation' ? preparedBy : undefined,
        showPaymentInstructions: docType === 'quotation' ? showPaymentInstructions : undefined,
        paymentInstructions:
          docType === 'quotation' && showPaymentInstructions ? paymentInstructions : undefined,
        notes,
        terms,
        saveAsDraft,
        logoDataUrl,
        saveLogoToProfile,
        upiId: docType === 'invoice' ? upiId.trim() : undefined,
        saveUpiToProfile: docType === 'invoice' ? saveUpiToProfile : false,
        items,
      };

      if (profile) {
        const nextProfile = { ...profile };
        let profileChanged = false;
        if (saveLogoToProfile && logoDataUrl !== profile.logoDataUrl) {
          nextProfile.logoDataUrl = logoDataUrl;
          profileChanged = true;
        }
        if (docType === 'invoice' && saveUpiToProfile && upiId.trim() !== profile.upiId) {
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
              Full Editor
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

          {/* Quick Collapse / Expand Live Preview Button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setViewMode((prev) => (prev === 'editor' ? 'split' : 'editor'))}
            className="h-8 text-xs hidden sm:inline-flex items-center gap-1.5 cursor-pointer"
            title={
              viewMode === 'editor'
                ? 'Show live A4 preview side-by-side'
                : 'Collapse live A4 preview to expand editor to full width'
            }
          >
            {viewMode === 'editor' ? (
              <>
                <PanelRightOpen className="h-3.5 w-3.5 text-[#F57C00]" />
                <span>Show Preview</span>
              </>
            ) : (
              <>
                <PanelRightClose className="h-3.5 w-3.5 text-zinc-500" />
                <span>Collapse Preview</span>
              </>
            )}
          </Button>
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
              {/* Ask for Business Logo & (UPI QR on Invoices / Prepared By on Quotations) */}
              <Card className="lg:col-span-5 order-2 lg:order-1">
                <CardHeader className="pb-3">
                  <CardTitle>
                    {docType === 'invoice'
                      ? 'Business Logo & UPI QR'
                      : 'Business Logo & Proposal Header'}
                  </CardTitle>
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

                  {docType === 'invoice' ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                        <Label htmlFor="doc-prepared-by">Prepared By</Label>
                        <Input
                          id="doc-prepared-by"
                          type="text"
                          value={preparedBy}
                          onChange={(e) => setPreparedBy(e.target.value)}
                          placeholder={profile?.ownerName || 'Sales Executive / Name'}
                          className="text-base sm:text-xs h-11 sm:h-9"
                        />
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={saveLogoToProfile}
                            onChange={(e) => setSaveLogoToProfile(e.target.checked)}
                            className="accent-[#F57C00]"
                          />
                          Save logo as default for future quotations
                        </label>
                      </div>
                    </>
                  )}

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
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3">
                <CardTitle>
                  {docType === 'invoice'
                    ? 'Invoice Metadata & GST Rules'
                    : 'Quotation Metadata & GST Rules'}
                </CardTitle>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-zinc-500">
                    Business Profile:{' '}
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                      {profile?.defaultIsGst === false ? 'Non-GST' : 'GST Registered'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate('/business-profile')}
                    className="text-[#F57C00] hover:underline font-medium cursor-pointer"
                  >
                    Change
                  </button>
                </div>
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
                    <Label>
                      {docType === 'invoice' ? 'Invoice Theme' : 'Quotation Theme'}
                    </Label>
                    <Select
                      value={
                        docType === 'invoice'
                          ? normalizeTemplateId(templateId)
                          : normalizeQuotationTemplateId(templateId)
                      }
                      onChange={(e) => {
                        userTouchedTemplateRef.current = true;
                        setTemplateId(e.target.value as TemplateId);
                      }}
                    >
                      {(docType === 'invoice' ? INVOICE_THEMES : QUOTATION_THEMES).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.orientation === 'landscape' ? 'A4 Landscape' : t.tagline})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>
                      {docType === 'invoice' ? 'Payment Terms' : 'Proposed Payment Terms'}
                    </Label>
                    <Input
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                      placeholder={
                        docType === 'invoice' ? 'Net 15' : '50% advance, 50% on delivery'
                      }
                    />
                  </div>
                </div>

                {docType === 'quotation' ? (
                  <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Quotation Title (Optional)</Label>
                        <Input
                          value={quotationTitle}
                          onChange={(e) => setQuotationTitle(e.target.value)}
                          placeholder="QUOTATION"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Delivery Timeline (Optional)</Label>
                        <Input
                          value={deliveryTimeline}
                          onChange={(e) => setDeliveryTimeline(e.target.value)}
                          placeholder="e.g. 2–3 Weeks from approval"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Project / Service Overview (Optional)</Label>
                      <Textarea
                        rows={2}
                        value={projectDescription}
                        onChange={(e) => setProjectDescription(e.target.value)}
                        placeholder="Brief scope summary, deliverables, or project description..."
                      />
                    </div>
                    <div className="space-y-2 pt-1">
                      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={showPaymentInstructions}
                          onChange={(e) => setShowPaymentInstructions(e.target.checked)}
                          className="h-4 w-4 accent-[#F57C00]"
                        />
                        Show proposed payment instructions on quotation (off by default)
                      </label>
                      {showPaymentInstructions ? (
                        <Textarea
                          rows={2}
                          value={paymentInstructions}
                          onChange={(e) => setPaymentInstructions(e.target.value)}
                          placeholder="Enter optional advance / milestone transfer notes..."
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {/* Visual theme picker for current document type only */}
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  {docType === 'invoice' ? (
                    <InvoiceThemeSelector
                      currentThemeId={templateId}
                      defaultThemeId={profile?.defaultInvoiceTemplate || 'gst_theme_1'}
                      onSelectTheme={(themeId) => {
                        userTouchedTemplateRef.current = true;
                        setTemplateId(themeId);
                      }}
                      onSetAsDefault={handleSetDefaultTheme}
                      isSettingDefault={settingDefaultTheme}
                    />
                  ) : (
                    <QuotationThemeSelector
                      currentThemeId={templateId}
                      defaultThemeId={profile?.defaultQuotationTemplate}
                      onSelectTheme={(themeId) => {
                        userTouchedTemplateRef.current = true;
                        setTemplateId(themeId);
                      }}
                      onSetAsDefault={handleSetDefaultTheme}
                      isSettingDefault={settingDefaultTheme}
                    />
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
                  <label className="flex min-h-[40px] sm:min-h-0 items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isGst}
                      onChange={(e) => {
                        userTouchedGstRef.current = true;
                        setIsGst(e.target.checked);
                      }}
                      className="h-4 w-4 accent-[#F57C00]"
                    />
                    GST Document
                  </label>

                  <Select
                    value={taxMode}
                    disabled={!isGst}
                    onChange={(e) => {
                      userTouchedTaxModeRef.current = true;
                      setTaxMode(e.target.value as TaxPricingMode);
                    }}
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
              <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-2 pb-3">
                <CardTitle>Line Items ({items.length})</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRateSearch('');
                      setRateCategory('all');
                      setSelectedRateIds([]);
                      setRatePickerOpen(true);
                    }}
                  >
                    <Package className="h-3.5 w-3.5 text-[#F57C00]" />
                    <span className="hidden sm:inline">Add from Rate Card</span>
                    <span className="sm:hidden">Rate Card</span>
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={addItem}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Item
                  </Button>
                </div>
              </CardHeader>
              <datalist id="drona-rate-card-names">
                {rateCardItems.map((rc) => (
                  <option key={rc.id} value={rc.name} />
                ))}
              </datalist>
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
                          <div className="flex items-center justify-between gap-2">
                            <Label>Item / Service Name *</Label>
                            {item.name.trim() &&
                            !rateCardItems.some(
                              (rc) => rc.name.toLowerCase() === item.name.trim().toLowerCase()
                            ) ? (
                              <button
                                type="button"
                                disabled={savingToRateCardIdx === idx}
                                onClick={() => handleSaveLineItemToRateCard(idx)}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#F57C00] hover:underline cursor-pointer"
                              >
                                <BookmarkPlus className="h-3 w-3" />
                                {savingToRateCardIdx === idx ? 'Saving...' : 'Save to Rate Card'}
                              </button>
                            ) : null}
                          </div>
                          <Input
                            list="drona-rate-card-names"
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
                              <HsnSacSelector
                                value={item.hsnSac}
                                currentDescription={item.description}
                                onChange={(val) => updateItem(idx, { hsnSac: val })}
                                onSelectDescription={(desc) => {
                                  if (!item.description || item.description.trim() === '') {
                                    updateItem(idx, { description: desc });
                                  }
                                }}
                                placeholder="998314"
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

                  <div className="grid grid-cols-2 gap-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setRateSearch('');
                        setRateCategory('all');
                        setSelectedRateIds([]);
                        setRatePickerOpen(true);
                      }}
                    >
                      <Package className="h-4 w-4 text-[#F57C00]" />
                      From Rate Card
                    </Button>
                    <Button type="button" variant="outline" onClick={addItem}>
                      <Plus className="h-4 w-4" />
                      Add Blank Item
                    </Button>
                  </div>
                </div>

                {/* Desktop Line Items Table */}
                <div className="hidden md:block overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full min-w-[1050px] text-xs">
                    <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                      <tr>
                        <th className="px-3.5 py-3 text-left font-semibold text-zinc-900 dark:text-zinc-100 min-w-[300px]">
                          Item & Description
                        </th>
                        {isGst ? (
                          <th className="px-2.5 py-3 text-left font-semibold text-zinc-900 dark:text-zinc-100 w-44 min-w-[170px]">
                            HSN/SAC
                          </th>
                        ) : null}
                        <th className="px-2.5 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-100 w-24 min-w-[95px]">
                          Qty
                        </th>
                        <th className="px-2.5 py-3 text-left font-semibold text-zinc-900 dark:text-zinc-100 w-24 min-w-[95px]">
                          Unit
                        </th>
                        <th className="px-2.5 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-100 w-32 min-w-[125px]">
                          Rate (INR)
                        </th>
                        <th className="px-2.5 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-100 w-40 min-w-[155px]">
                          Discount
                        </th>
                        {isGst ? (
                          <th className="px-2.5 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-100 w-24 min-w-[95px]">
                            GST %
                          </th>
                        ) : null}
                        <th className="px-3 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-100 w-32 min-w-[120px]">
                          Total
                        </th>
                        <th className="px-2 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                      {items.map((item, idx) => {
                        const computed = calc.items[idx];
                        return (
                          <tr key={idx} className="align-top hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                            <td className="px-3.5 py-3 space-y-1.5 min-w-[300px]">
                              <Input
                                list="drona-rate-card-names"
                                value={item.name}
                                onChange={(e) => updateItem(idx, { name: e.target.value })}
                                placeholder="Service or product name"
                                className="h-10 text-xs font-medium"
                              />
                              <Input
                                value={item.description}
                                onChange={(e) => updateItem(idx, { description: e.target.value })}
                                placeholder="Optional description / details"
                                className="h-9 text-xs text-zinc-600 dark:text-zinc-300"
                              />
                            </td>
                            {isGst ? (
                              <td className="px-2.5 py-3 min-w-[170px]">
                                <HsnSacSelector
                                  value={item.hsnSac}
                                  currentDescription={item.description}
                                  onChange={(val) => updateItem(idx, { hsnSac: val })}
                                  onSelectDescription={(desc) => {
                                    if (!item.description || item.description.trim() === '') {
                                      updateItem(idx, { description: desc });
                                    }
                                  }}
                                  placeholder="998314"
                                  className="h-10 text-xs font-mono"
                                />
                              </td>
                            ) : null}
                            <td className="px-2.5 py-3 min-w-[95px]">
                              <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={item.quantity}
                                onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                                className="h-10 text-xs text-right font-mono"
                              />
                            </td>
                            <td className="px-2.5 py-3 min-w-[95px]">
                              <Input
                                value={item.unit}
                                onChange={(e) => updateItem(idx, { unit: e.target.value })}
                                placeholder="Nos"
                                className="h-10 text-xs text-center"
                              />
                            </td>
                            <td className="px-2.5 py-3 min-w-[125px]">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.rate}
                                onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })}
                                className="h-10 text-xs text-right font-mono font-medium"
                              />
                            </td>
                            <td className="px-2.5 py-3 min-w-[155px]">
                              <div className="flex gap-1.5">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.discountValue}
                                  onChange={(e) =>
                                    updateItem(idx, { discountValue: Number(e.target.value) })
                                  }
                                  className="h-10 text-xs text-right font-mono flex-1 min-w-[65px]"
                                />
                                <Select
                                  value={item.discountType}
                                  onChange={(e) =>
                                    updateItem(idx, {
                                      discountType: e.target.value as 'percent' | 'fixed',
                                    })
                                  }
                                  className="h-10 text-xs px-2 w-14 font-semibold shrink-0"
                                >
                                  <option value="percent">%</option>
                                  <option value="fixed">₹</option>
                                </Select>
                              </div>
                            </td>
                            {isGst ? (
                              <td className="px-2.5 py-3 min-w-[95px]">
                                <Select
                                  value={item.taxRate}
                                  onChange={(e) => updateItem(idx, { taxRate: Number(e.target.value) })}
                                  className="h-10 text-xs font-mono font-semibold"
                                >
                                  {[0, 5, 12, 18, 28].map((r) => (
                                    <option key={r} value={r}>
                                      {r}%
                                    </option>
                                  ))}
                                </Select>
                              </td>
                            ) : null}
                            <td className="px-3 py-3 text-right font-mono tabular-nums text-sm font-bold text-zinc-900 dark:text-zinc-100 min-w-[120px]">
                              {formatINR(computed?.totalAmount || 0)}
                            </td>
                            <td className="px-2 py-3 text-center">
                              <div className="inline-flex items-center gap-0.5">
                                {item.name.trim() &&
                                !rateCardItems.some(
                                  (rc) => rc.name.toLowerCase() === item.name.trim().toLowerCase()
                                ) ? (
                                  <button
                                    type="button"
                                    disabled={savingToRateCardIdx === idx}
                                    onClick={() => handleSaveLineItemToRateCard(idx)}
                                    className="p-1.5 text-zinc-400 hover:text-[#F57C00] cursor-pointer"
                                    title="Save item to Rate Card"
                                    aria-label="Save item to Rate Card"
                                  >
                                    <BookmarkPlus className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => removeItem(idx)}
                                  disabled={items.length <= 1}
                                  className="p-1.5 text-zinc-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                                  aria-label="Remove item"
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
                      onChange={(e) => {
                        userTouchedTermsRef.current = true;
                        setTerms(e.target.value);
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-5">
                <CardContent className="p-5 space-y-2.5 text-sm">
                  <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                    <span>{docType === 'quotation' ? 'Estimated Subtotal' : 'Subtotal'}</span>
                    <span className="font-mono tabular-nums">{formatINR(calc.subtotal)}</span>
                  </div>
                  {calc.totalDiscount > 0 ? (
                    <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">-{formatINR(calc.totalDiscount)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-zinc-700 dark:text-zinc-300">
                    <span>
                      {docType === 'quotation' ? 'Estimated Taxable Value' : 'Taxable Value'}
                    </span>
                    <span className="font-mono tabular-nums">{formatINR(calc.taxableAmount)}</span>
                  </div>
                  {isGst ? (
                    calc.isInterState ? (
                      <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                        <span>{docType === 'quotation' ? 'Estimated IGST' : 'IGST'}</span>
                        <span className="font-mono tabular-nums">{formatINR(calc.igstTotal)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                          <span>{docType === 'quotation' ? 'Estimated CGST' : 'CGST'}</span>
                          <span className="font-mono tabular-nums">{formatINR(calc.cgstTotal)}</span>
                        </div>
                        <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                          <span>{docType === 'quotation' ? 'Estimated SGST' : 'SGST'}</span>
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
                    <span>{docType === 'quotation' ? 'Quotation Total' : 'Grand Total'}</span>
                    <span className="font-mono tabular-nums text-[#F57C00]">
                      {formatINR(calc.grandTotal)}
                    </span>
                  </div>
                  <div className="pt-1 text-xs text-zinc-500">{calc.amountInWords}</div>

                  {editId && docType === 'invoice' && existingStatus && existingStatus !== 'draft' ? (
                    <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                        <span>Recorded Payments ({invoicePayments.length})</span>
                        <span className="font-mono tabular-nums font-semibold">
                          {formatINR(existingAmountPaid)}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold text-zinc-900 dark:text-zinc-100">
                        <span>Updated Balance Due</span>
                        <span className="font-mono tabular-nums">
                          {formatINR(Math.max(0, calc.grandTotal - existingAmountPaid))}
                        </span>
                      </div>
                      {existingAmountPaid > calc.grandTotal ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <span>
                            Payments exceed invoice total by{' '}
                            <span className="font-mono font-semibold">
                              {formatINR(existingAmountPaid - calc.grandTotal)}
                            </span>
                            . Edit payments below if needed.
                          </span>
                        </div>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => setPaymentsModalOpen(true)}
                      >
                        <CreditCard className="h-3.5 w-3.5 text-[#F57C00]" />
                        Edit / Manage Recorded Payments ({invoicePayments.length})
                      </Button>
                    </div>
                  ) : null}
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
                    {templateId === 'landscape_theme_2' || templateId === 'landscape_pro'
                      ? '297 × 210 mm · Updates in real time'
                      : '210 × 297 mm · Updates in real time'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setViewMode('editor')}
                    title="Collapse preview to expand editor to full width"
                    className="h-8 px-2.5 text-xs text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 cursor-pointer"
                  >
                    <PanelRightClose className="h-3.5 w-3.5 mr-1 text-[#F57C00]" />
                    <span>Collapse</span>
                  </Button>
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

              {/* Theme Carousel Selector */}
              <div className="px-3 pt-2.5 pb-1 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40">
                {docType === 'invoice' ? (
                  <InvoiceThemeSelector
                    currentThemeId={templateId}
                    defaultThemeId={profile?.defaultInvoiceTemplate || 'gst_theme_1'}
                    onSelectTheme={(themeId) => {
                      userTouchedTemplateRef.current = true;
                      setTemplateId(themeId);
                    }}
                    onSetAsDefault={handleSetDefaultTheme}
                    isSettingDefault={settingDefaultTheme}
                  />
                ) : (
                  <QuotationThemeSelector
                    currentThemeId={templateId}
                    defaultThemeId={profile?.defaultQuotationTemplate}
                    onSelectTheme={(themeId) => {
                      userTouchedTemplateRef.current = true;
                      setTemplateId(themeId);
                    }}
                    onSetAsDefault={handleSetDefaultTheme}
                    isSettingDefault={settingDefaultTheme}
                  />
                )}
              </div>

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
        description={
          templateId === 'landscape_theme_2' || templateId === 'landscape_pro'
            ? 'Full-scale A4 Landscape sheet (297 × 210 mm). Switch themes below or download PDF.'
            : 'Full-scale A4 sheet (210 × 297 mm). Switch themes below or download PDF.'
        }
        maxWidthClass={
          templateId === 'landscape_theme_2' || templateId === 'landscape_pro'
            ? 'max-w-6xl'
            : 'max-w-4xl'
        }
      >
        <div className="space-y-4">
          <div className="p-2 border rounded-xl bg-zinc-50/50 dark:bg-zinc-900/50">
            {docType === 'invoice' ? (
              <InvoiceThemeSelector
                currentThemeId={templateId}
                defaultThemeId={profile?.defaultInvoiceTemplate || 'gst_theme_1'}
                onSelectTheme={(themeId) => {
                  userTouchedTemplateRef.current = true;
                  setTemplateId(themeId);
                }}
                onSetAsDefault={handleSetDefaultTheme}
                isSettingDefault={settingDefaultTheme}
              />
            ) : (
              <QuotationThemeSelector
                currentThemeId={templateId}
                defaultThemeId={profile?.defaultQuotationTemplate}
                onSelectTheme={(themeId) => {
                  userTouchedTemplateRef.current = true;
                  setTemplateId(themeId);
                }}
                onSetAsDefault={handleSetDefaultTheme}
                isSettingDefault={settingDefaultTheme}
              />
            )}
          </div>
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

      {/* Rate Card Picker Modal */}
      <Dialog
        open={ratePickerOpen}
        onClose={() => setRatePickerOpen(false)}
        title="Add Items from Rate Card"
        description="Select one or more preset items to add directly to this document."
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                value={rateSearch}
                onChange={(e) => setRateSearch(e.target.value)}
                placeholder="Search rate card items..."
                className="pl-9"
              />
            </div>
            <Select
              value={rateCategory}
              onChange={(e) => setRateCategory(e.target.value)}
              className="sm:w-44"
            >
              <option value="all">All Categories</option>
              {Array.from(new Set(rateCardItems.map((i) => i.category || 'General'))).map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
          </div>

          {(() => {
            const q = rateSearch.trim().toLowerCase();
            const filtered = rateCardItems.filter((rc) => {
              if (rateCategory !== 'all' && (rc.category || 'General') !== rateCategory) {
                return false;
              }
              if (q) {
                const hay = `${rc.name} ${rc.description} ${rc.hsnSac} ${rc.category}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });

            if (filtered.length === 0) {
              return (
                <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center space-y-3 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500">
                    {rateCardItems.length === 0
                      ? 'Your Rate Card is empty. Add default items once to reuse them across invoices and quotations.'
                      : 'No Rate Card items match your filter.'}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRatePickerOpen(false);
                      navigate('/rate-card');
                    }}
                  >
                    <Package className="h-3.5 w-3.5" />
                    Open Rate Card
                  </Button>
                </div>
              );
            }

            return (
              <div className="max-h-[52vh] overflow-y-auto divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {filtered.map((rc) => {
                  const checked = selectedRateIds.includes(rc.id);
                  return (
                    <div
                      key={rc.id}
                      className={`flex items-center justify-between gap-3 p-3.5 transition-colors ${
                        checked ? 'bg-orange-50/50 dark:bg-orange-950/15' : ''
                      }`}
                    >
                      <label className="flex items-start gap-3 min-w-0 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRateIds((prev) => [...prev, rc.id]);
                            } else {
                              setSelectedRateIds((prev) => prev.filter((x) => x !== rc.id));
                            }
                          }}
                          className="mt-1 h-4 w-4 accent-[#F57C00] shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                            {rc.name}
                          </div>
                          {rc.description ? (
                            <div className="text-xs text-zinc-500 line-clamp-1">{rc.description}</div>
                          ) : null}
                          <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                            {rc.category || 'General'} · Unit: {rc.unit}
                            {isGst && rc.hsnSac ? ` · HSN: ${rc.hsnSac}` : ''}
                            {isGst ? ` · GST ${rc.taxRate}%` : ''}
                          </div>
                        </div>
                      </label>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <div className="text-right">
                          <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                            {formatINR(rc.rate)}
                          </div>
                          {rc.discountValue > 0 ? (
                            <div className="text-[10px] font-mono text-zinc-500">
                              -{rc.discountValue}
                              {rc.discountType === 'percent' ? '%' : '₹'}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            insertRateCardItems([rc]);
                            setRatePickerOpen(false);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setRatePickerOpen(false);
                navigate('/rate-card');
              }}
              className="text-xs font-medium text-[#F57C00] hover:underline cursor-pointer"
            >
              Manage Rate Card →
            </button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setRatePickerOpen(false)}>
                Close
              </Button>
              {selectedRateIds.length > 0 ? (
                <Button
                  type="button"
                  onClick={() => {
                    const chosen = rateCardItems.filter((rc) => selectedRateIds.includes(rc.id));
                    insertRateCardItems(chosen);
                    setRatePickerOpen(false);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  Add Selected ({selectedRateIds.length})
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Dialog>

      {/* Inline Manage Recorded Payments Dialog (when editing finalized invoice) */}
      <Dialog
        open={paymentsModalOpen}
        onClose={() => {
          setPaymentsModalOpen(false);
          setEditingPayId(null);
        }}
        title={`Recorded Payments — ${existingDocNumber}`}
        description={`Invoice Grand Total: ${formatINR(calc.grandTotal)} · Total Paid: ${formatINR(existingAmountPaid)}`}
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-4">
          {invoicePayments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
              No payments recorded for this invoice.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {invoicePayments.map((p) =>
                editingPayId === p.id ? (
                  <form key={p.id} onSubmit={handleSaveInlinePayment} className="p-3.5 space-y-3 bg-zinc-50 dark:bg-zinc-950">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="font-mono">{p.receiptNumber}</span>
                      <button
                        type="button"
                        onClick={() => setEditingPayId(null)}
                        className="text-zinc-500 hover:text-zinc-800 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <Label>Date</Label>
                        <Input
                          type="date"
                          required
                          value={editPayForm.paymentDate}
                          onChange={(e) =>
                            setEditPayForm({ ...editPayForm, paymentDate: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Amount (INR)</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0.01"
                          required
                          value={editPayForm.amount}
                          onChange={(e) =>
                            setEditPayForm({ ...editPayForm, amount: Number(e.target.value) })
                          }
                          className="font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <Label>Method</Label>
                        <Select
                          value={editPayForm.paymentMethod}
                          onChange={(e) =>
                            setEditPayForm({
                              ...editPayForm,
                              paymentMethod: e.target.value as PaymentMethod,
                            })
                          }
                        >
                          <option value="UPI">UPI</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                          <option value="Cash">Cash</option>
                          <option value="Credit/Debit Card">Credit/Debit Card</option>
                          <option value="Cheque">Cheque</option>
                          <option value="Other">Other</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Reference ID</Label>
                        <Input
                          value={editPayForm.referenceId}
                          onChange={(e) =>
                            setEditPayForm({ ...editPayForm, referenceId: e.target.value })
                          }
                          className="font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="submit" size="sm" disabled={savingPayEdit}>
                        {savingPayEdit ? 'Saving...' : 'Update Payment'}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div key={p.id} className="flex items-center justify-between gap-2 p-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{p.receiptNumber}</span>
                        <span className="text-xs text-zinc-500">{p.paymentMethod}</span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500">
                        {formatDate(p.paymentDate)}
                        {p.referenceId ? ` · ${p.referenceId}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-sm font-semibold tabular-nums text-emerald-600 mr-1">
                        {formatINR(p.amount)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingPayId(p.id);
                          setEditPayForm({
                            paymentDate: p.paymentDate,
                            amount: p.amount,
                            paymentMethod: p.paymentMethod,
                            referenceId: p.referenceId || '',
                            notes: p.notes || '',
                          });
                        }}
                        title="Edit Payment"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        disabled={deletingPayId === p.id}
                        onClick={() => handleDeleteInlinePayment(p.id)}
                        title="Delete Payment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPaymentsModalOpen(false);
                setEditingPayId(null);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Floating button to restore live preview when collapsed */}
      {viewMode === 'editor' && (
        <div className="fixed bottom-6 right-6 z-40 hidden xl:block">
          <Button
            type="button"
            size="sm"
            onClick={() => setViewMode('split')}
            className="rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2.5 text-xs font-semibold shadow-2xl hover:bg-zinc-800 dark:hover:bg-zinc-200 cursor-pointer flex items-center gap-2 border border-zinc-700/50"
            title="Restore side-by-side A4 preview"
          >
            <PanelRightOpen className="h-4 w-4 text-[#F57C00]" />
            <span>Show Live Preview</span>
          </Button>
        </div>
      )}
    </div>
  );
}
