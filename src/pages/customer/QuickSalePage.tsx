import * as React from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Moon,
  MoreVertical,
  Plus,
  Settings,
  Share2,
  Sun,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
  cachedRead,
  customersApi,
  invoicesApi,
  paymentsApi,
  rateCardApi,
} from '../../lib/api';
import { generateDocumentPdf } from '../../lib/pdfGenerator';
import { computeDocumentTotals, formatINR } from '../../shared/gstCalculator';
import type {
  BusinessSnapshot,
  Customer,
  CustomerSnapshot,
  Invoice,
  LineItemInput,
  RateCardItem,
  TaxPricingMode,
  TaxSupplyMode,
  TemplateId,
} from '../../shared/types';
import { DocumentPreviewSheet } from '../../components/DocumentPreviewSheet';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';

interface QuickSalePageProps {
  navigate: (path: string) => void;
}

const UNIT_OPTIONS = [
  'Nos',
  'Pcs',
  'Kg',
  'Gm',
  'Ltr',
  'Box',
  'Pack',
  'Set',
  'Hrs',
  'Mtr',
  'Bag',
  'Bottle',
  'Service',
];

function formatDisplayDateDDMMYYYY(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function addDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

interface QuickItemDraft {
  id: string;
  name: string;
  description: string;
  hsnSac: string;
  quantity: string;
  unit: string;
  rate: string;
  taxSelection: 'exclusive' | 'inclusive';
  taxRate: number;
  discountType: 'percent' | 'fixed';
  discountValue: string;
}

function emptyItemDraft(defaultTaxRate = 0): QuickItemDraft {
  return {
    id: `qi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    description: '',
    hsnSac: '',
    quantity: '',
    unit: '',
    rate: '',
    taxSelection: 'exclusive',
    taxRate: defaultTaxRate,
    discountType: 'percent',
    discountValue: '',
  };
}

export function QuickSalePage({ navigate }: QuickSalePageProps) {
  const { session } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useToast();
  const tenantUid = session?.effectiveUser.uid;
  const profile = session?.businessProfile;

  const [customers, setCustomers] = React.useState<Customer[]>(() => {
    if (!tenantUid || !cachedRead.hasTenantCollectionData(tenantUid, 'customers')) return [];
    return cachedRead.getTenantEntry(tenantUid).customers.filter((c) => !c.archived);
  });
  const [rateCard, setRateCard] = React.useState<RateCardItem[]>(() => {
    if (!tenantUid || !cachedRead.hasTenantCollectionData(tenantUid, 'rateCard')) return [];
    return cachedRead.getTenantEntry(tenantUid).rateCard.filter((r) => r.isActive);
  });
  const [existingInvoiceCount, setExistingInvoiceCount] = React.useState<number>(() => {
    if (!tenantUid || !cachedRead.hasTenantCollectionData(tenantUid, 'invoices')) return 0;
    return cachedRead.getTenantEntry(tenantUid).invoices.length;
  });

  React.useEffect(() => {
    let active = true;
    Promise.allSettled([
      customersApi.list(),
      rateCardApi.list({ activeOnly: true }),
      invoicesApi.list(),
    ]).then(([custRes, rcRes, invRes]) => {
      if (!active) return;
      if (custRes.status === 'fulfilled') {
        setCustomers(custRes.value.customers.filter((c) => !c.archived));
      }
      if (rcRes.status === 'fulfilled') {
        setRateCard(rcRes.value.items);
      }
      if (invRes.status === 'fulfilled') {
        setExistingInvoiceCount(invRes.value.invoices.length);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Sale screen state
  const [saleMode, setSaleMode] = React.useState<'credit' | 'cash'>('credit');
  const [invoiceDate, setInvoiceDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [referenceNumber, setReferenceNumber] = React.useState('');
  const [customerName, setCustomerName] = React.useState('');
  const [selectedCustomerId, setSelectedCustomerId] = React.useState<string>('');
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [customerFocused, setCustomerFocused] = React.useState(false);
  const [phoneFocused, setPhoneFocused] = React.useState(false);

  const [items, setItems] = React.useState<LineItemInput[]>([]);
  const [manualTotalStr, setManualTotalStr] = React.useState('');

  // Tax & Bill Settings
  const [gstEnabled, setGstEnabled] = React.useState<boolean>(false);
  const [taxMode, setTaxMode] = React.useState<TaxPricingMode>('exclusive');
  const [taxSupplyMode, setTaxSupplyMode] = React.useState<TaxSupplyMode>('auto');
  const [roundOffEnabled, setRoundOffEnabled] = React.useState<boolean>(true);
  const [templateId, setTemplateId] = React.useState<TemplateId>(
    profile?.defaultInvoiceTemplate || 'classic_gst'
  );
  const [notes, setNotes] = React.useState('');
  const [paymentTermsDays, setPaymentTermsDays] = React.useState<number>(
    profile?.defaultPaymentTermsDays ?? 15
  );

  // Screen / Dialog / Menu states
  const [subScreen, setSubScreen] = React.useState<'sale' | 'add_item'>('sale');
  const [editingItemIndex, setEditingItemIndex] = React.useState<number | null>(null);
  const [itemDraft, setItemDraft] = React.useState<QuickItemDraft>(() => emptyItemDraft(0));
  const [itemNameFocused, setItemNameFocused] = React.useState(true);
  const [itemAdvancedOpen, setItemAdvancedOpen] = React.useState(false);

  const [invoiceNoModalOpen, setInvoiceNoModalOpen] = React.useState(false);
  const [saleSettingsOpen, setSaleSettingsOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedInvoice, setSavedInvoice] = React.useState<Invoice | null>(null);
  const [lastQuickSavedInvoice, setLastQuickSavedInvoice] = React.useState<Invoice | null>(null);
  const [downloadingPdf, setDownloadingPdf] = React.useState(false);

  const dateInputRef = React.useRef<HTMLInputElement>(null);
  const itemNameInputRef = React.useRef<HTMLInputElement>(null);

  const nextSeqNumber = existingInvoiceCount + 1;
  const yearStr = invoiceDate.slice(0, 4) || String(new Date().getFullYear());
  const prefix = profile?.invoicePrefix || 'INV';
  const predictedInvoiceCode = `${prefix}-${yearStr}-${String(nextSeqNumber).padStart(4, '0')}`;

  const effectiveIsGst = gstEnabled || items.some((it) => (Number(it.taxRate) || 0) > 0);

  const selectedCustomerObj = React.useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const matchingCustomers = React.useMemo(() => {
    const q = customerName.trim().toLowerCase();
    const list = q
      ? customers.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.companyName && c.companyName.toLowerCase().includes(q)) ||
            (c.phone && c.phone.includes(q))
        )
      : customers;
    return list.slice(0, 8);
  }, [customers, customerName]);

  const matchingRateCard = React.useMemo(() => {
    const q = itemDraft.name.trim().toLowerCase();
    const list = q
      ? rateCard.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.hsnSac && r.hsnSac.toLowerCase().includes(q))
        )
      : rateCard;
    return list.slice(0, 6);
  }, [rateCard, itemDraft.name]);

  const computedFromItems = React.useMemo(() => {
    if (items.length === 0) return null;
    const placeOfSupply = selectedCustomerObj?.state || profile?.state || 'Maharashtra';
    return computeDocumentTotals({
      items,
      businessState: profile?.state || 'Maharashtra',
      placeOfSupply,
      isGst: effectiveIsGst,
      taxMode,
      taxSupplyMode,
      roundOffEnabled,
    });
  }, [items, selectedCustomerObj, profile?.state, effectiveIsGst, taxMode, taxSupplyMode, roundOffEnabled]);

  const manualAmountNum = Number(manualTotalStr);
  const displayTotalAmount = computedFromItems
    ? computedFromItems.grandTotal
    : Number.isFinite(manualAmountNum) && manualAmountNum > 0
      ? manualAmountNum
      : 0;

  const buildPreviewRecord = React.useCallback((): Invoice => {
    const placeOfSupply = selectedCustomerObj?.state || profile?.state || 'Maharashtra';
    const previewItems: LineItemInput[] =
      items.length > 0
        ? items
        : [
            {
              name: 'Sale Item',
              description: '',
              hsnSac: '',
              quantity: 1,
              unit: 'Nos',
              rate: displayTotalAmount,
              discountType: 'percent',
              discountValue: 0,
              taxRate: 0,
            },
          ];

    const calc = computeDocumentTotals({
      items: previewItems,
      businessState: profile?.state || 'Maharashtra',
      placeOfSupply,
      isGst: items.length > 0 ? effectiveIsGst : false,
      taxMode,
      taxSupplyMode,
      roundOffEnabled,
    });

    const customerSnapshot: CustomerSnapshot = selectedCustomerObj
      ? {
          id: selectedCustomerObj.id,
          name: selectedCustomerObj.name,
          companyName: selectedCustomerObj.companyName,
          email: selectedCustomerObj.email,
          phone: phoneNumber.trim() || selectedCustomerObj.phone,
          gstin: selectedCustomerObj.gstin,
          billingAddress: selectedCustomerObj.billingAddress,
          shippingAddress: selectedCustomerObj.shippingAddress,
          state: selectedCustomerObj.state,
        }
      : {
          id: 'preview',
          name: customerName.trim() || 'Walk-in Customer',
          companyName: '',
          email: '',
          phone: phoneNumber.trim(),
          gstin: '',
          billingAddress: '',
          shippingAddress: '',
          state: profile?.state || 'Maharashtra',
        };

    const businessSnapshot: BusinessSnapshot = {
      businessName: profile?.businessName || session?.effectiveUser.businessName || 'Your Business',
      ownerName: profile?.ownerName || session?.effectiveUser.ownerName || '',
      logoDataUrl: profile?.logoDataUrl || '',
      address: profile?.address || '',
      email: profile?.email || session?.effectiveUser.email || '',
      phone: profile?.phone || '',
      gstin: profile?.gstin || '',
      pan: profile?.pan || '',
      state: profile?.state || 'Maharashtra',
      bankName: profile?.bankName || '',
      accountNumber: profile?.accountNumber || '',
      ifsc: profile?.ifsc || '',
      upiId: profile?.upiId || '',
      upiQrDataUrl: profile?.upiQrDataUrl || '',
      signatureLabel: profile?.signatureLabel || 'Authorized Signatory',
      signatureDataUrl: profile?.signatureDataUrl,
    };

    const dueDate =
      saleMode === 'cash' ? invoiceDate : addDays(invoiceDate, paymentTermsDays);

    return {
      id: 'preview',
      userUid: tenantUid || '',
      invoiceNumber: predictedInvoiceCode,
      status: saleMode === 'cash' ? 'paid' : 'unpaid',
      customerId: customerSnapshot.id,
      customerSnapshot,
      businessSnapshot,
      invoiceDate,
      dueDate,
      paymentTerms: saleMode === 'cash' ? 'Paid in Cash' : `Net ${paymentTermsDays}`,
      referenceNumber,
      placeOfSupply,
      isGst: items.length > 0 ? effectiveIsGst : false,
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
      amountPaid: saleMode === 'cash' ? calc.grandTotal : 0,
      balanceDue: saleMode === 'cash' ? 0 : calc.grandTotal,
      amountInWords: calc.amountInWords,
      templateId,
      notes,
      terms: profile?.termsAndConditions || '',
      sourceQuotationId: null,
      cancellationReason: null,
      cancelledAt: null,
      finalizedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: calc.items,
    };
  }, [
    selectedCustomerObj,
    profile,
    session,
    items,
    displayTotalAmount,
    effectiveIsGst,
    taxMode,
    taxSupplyMode,
    roundOffEnabled,
    phoneNumber,
    customerName,
    saleMode,
    invoiceDate,
    paymentTermsDays,
    tenantUid,
    predictedInvoiceCode,
    referenceNumber,
    templateId,
    notes,
  ]);

  const openAddItemScreen = (editIdx: number | null = null) => {
    if (editIdx !== null && items[editIdx]) {
      const existing = items[editIdx];
      setEditingItemIndex(editIdx);
      setItemDraft({
        id: existing.id || `qi_${editIdx}`,
        name: existing.name,
        description: existing.description || '',
        hsnSac: existing.hsnSac || '',
        quantity: String(existing.quantity),
        unit: existing.unit || 'Nos',
        rate: String(existing.rate),
        taxSelection: taxMode,
        taxRate: existing.taxRate || 0,
        discountType: existing.discountType || 'percent',
        discountValue: existing.discountValue ? String(existing.discountValue) : '',
      });
      setItemAdvancedOpen(
        Boolean(existing.hsnSac || existing.taxRate || existing.discountValue || existing.description)
      );
    } else {
      setEditingItemIndex(null);
      setItemDraft(emptyItemDraft(gstEnabled ? profile?.defaultTaxRate || 18 : 0));
      setItemAdvancedOpen(false);
    }
    setItemNameFocused(true);
    setSubScreen('add_item');
    setTimeout(() => {
      itemNameInputRef.current?.focus();
    }, 60);
  };

  const commitItemDraft = (): boolean => {
    const trimmedName = itemDraft.name.trim();
    if (!trimmedName) {
      notify('error', 'Please enter an Item Name');
      itemNameInputRef.current?.focus();
      return false;
    }
    const qty = itemDraft.quantity.trim() === '' ? 1 : Number(itemDraft.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      notify('error', 'Quantity must be greater than 0');
      return false;
    }
    const rate = itemDraft.rate.trim() === '' ? 0 : Number(itemDraft.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      notify('error', 'Rate must be 0 or greater');
      return false;
    }
    const unit = itemDraft.unit.trim() || 'Nos';
    const discountVal = Math.max(0, Number(itemDraft.discountValue) || 0);
    const taxRate = Math.min(28, Math.max(0, Number(itemDraft.taxRate) || 0));

    if (itemDraft.taxSelection !== taxMode) {
      setTaxMode(itemDraft.taxSelection);
    }
    if (taxRate > 0) {
      setGstEnabled(true);
    }

    const nextItem: LineItemInput = {
      id: itemDraft.id,
      name: trimmedName,
      description: itemDraft.description.trim(),
      hsnSac: itemDraft.hsnSac.trim(),
      quantity: qty,
      unit,
      rate,
      discountType: itemDraft.discountType,
      discountValue: discountVal,
      taxRate,
    };

    if (editingItemIndex !== null) {
      setItems((prev) => prev.map((it, idx) => (idx === editingItemIndex ? nextItem : it)));
    } else {
      setItems((prev) => [...prev, nextItem]);
    }
    return true;
  };

  const handleItemSaveAndReturn = () => {
    if (!commitItemDraft()) return;
    setSubScreen('sale');
  };

  const handleItemSaveAndNew = () => {
    if (!commitItemDraft()) return;
    setEditingItemIndex(null);
    setItemDraft(emptyItemDraft(gstEnabled ? profile?.defaultTaxRate || 18 : 0));
    setItemAdvancedOpen(false);
    setItemNameFocused(true);
    notify('success', 'Item added to bill');
    setTimeout(() => {
      itemNameInputRef.current?.focus();
    }, 50);
  };

  const resetSaleForm = () => {
    setCustomerName('');
    setSelectedCustomerId('');
    setPhoneNumber('');
    setItems([]);
    setManualTotalStr('');
    setReferenceNumber('');
    setNotes('');
    setInvoiceDate(new Date().toISOString().slice(0, 10));
  };

  const handleSaveSale = async (mode: 'save' | 'save_and_new' | 'save_and_download') => {
    const trimmedCustomer = customerName.trim();
    if (!trimmedCustomer) {
      notify('error', 'Customer name is required');
      return;
    }

    let finalItems: LineItemInput[] = items;
    if (finalItems.length === 0) {
      const amt = Number(manualTotalStr);
      if (!Number.isFinite(amt) || amt <= 0) {
        notify('error', 'Add at least one item or enter a Total Amount');
        return;
      }
      finalItems = [
        {
          name: 'Sale Bill',
          description: '',
          hsnSac: '',
          quantity: 1,
          unit: 'Nos',
          rate: amt,
          discountType: 'percent',
          discountValue: 0,
          taxRate: 0,
        },
      ];
    }

    setSaving(true);
    try {
      let resolvedCustomerId = selectedCustomerId;
      let resolvedCustomer = customers.find((c) => c.id === resolvedCustomerId);

      if (
        !resolvedCustomer ||
        (resolvedCustomer.name.toLowerCase() !== trimmedCustomer.toLowerCase() &&
          resolvedCustomer.companyName.toLowerCase() !== trimmedCustomer.toLowerCase())
      ) {
        const existingMatch = customers.find(
          (c) =>
            c.name.toLowerCase() === trimmedCustomer.toLowerCase() ||
            c.companyName.toLowerCase() === trimmedCustomer.toLowerCase()
        );
        if (existingMatch) {
          resolvedCustomer = existingMatch;
          resolvedCustomerId = existingMatch.id;
        } else {
          const created = await customersApi.create({
            name: trimmedCustomer,
            phone: phoneNumber.trim(),
            state: profile?.state || 'Maharashtra',
          });
          resolvedCustomer = created.customer;
          resolvedCustomerId = created.customer.id;
          setCustomers((prev) => [created.customer, ...prev]);
        }
      } else if (phoneNumber.trim() && !resolvedCustomer.phone) {
        await customersApi.update(resolvedCustomer.id, { phone: phoneNumber.trim() });
      }

      const dueDate =
        saleMode === 'cash' ? invoiceDate : addDays(invoiceDate, paymentTermsDays);
      const isBillGst = items.length > 0 ? effectiveIsGst : false;

      const createdRes = await invoicesApi.create({
        customerId: resolvedCustomerId,
        invoiceDate,
        dueDate,
        paymentTerms: saleMode === 'cash' ? 'Paid in Cash' : `Net ${paymentTermsDays}`,
        referenceNumber: referenceNumber.trim(),
        placeOfSupply: resolvedCustomer.state || profile?.state || 'Maharashtra',
        isGst: isBillGst,
        taxMode,
        taxSupplyMode,
        roundOffEnabled,
        templateId,
        notes: notes.trim(),
        terms: profile?.termsAndConditions || '',
        saveAsDraft: false,
        items: finalItems,
      });

      let finalInvoice = createdRes.invoice;

      if (saleMode === 'cash' && finalInvoice.grandTotal > 0) {
        await paymentsApi.record({
          invoiceId: finalInvoice.id,
          paymentDate: invoiceDate,
          amount: finalInvoice.grandTotal,
          paymentMethod: 'Cash',
          notes: 'Cash sale',
        });
        const refreshed = await invoicesApi.get(finalInvoice.id);
        finalInvoice = refreshed.invoice;
      }

      setExistingInvoiceCount((c) => c + 1);
      setLastQuickSavedInvoice(finalInvoice);

      if (mode === 'save_and_download') {
        await generateDocumentPdf('invoice', finalInvoice);
        notify('success', `Saved ${finalInvoice.invoiceNumber} & downloaded PDF`);
        setSavedInvoice(finalInvoice);
      } else if (mode === 'save_and_new') {
        notify('success', `Saved ${finalInvoice.invoiceNumber} (${formatINR(finalInvoice.grandTotal)})`);
        resetSaleForm();
      } else {
        notify('success', `Saved ${finalInvoice.invoiceNumber}`);
        setSavedInvoice(finalInvoice);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save bill');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadInvoicePdf = async (inv: Invoice) => {
    setDownloadingPdf(true);
    try {
      await generateDocumentPdf('invoice', inv);
      notify('success', `Downloaded ${inv.invoiceNumber}.pdf`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to generate PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleShareInvoice = async (inv: Invoice) => {
    const summary = `Bill ${inv.invoiceNumber} from ${inv.businessSnapshot.businessName} | Customer: ${inv.customerSnapshot.companyName || inv.customerSnapshot.name} | Total: ${formatINR(inv.grandTotal)} | Status: ${inv.status.replace('_', ' ').toUpperCase()}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: inv.invoiceNumber, text: summary });
      } else {
        await navigator.clipboard.writeText(summary);
        notify('success', 'Bill summary copied to clipboard');
      }
    } catch {
      // user cancelled share
    }
  };

  // ==================== SUB-SCREEN 2: ADD ITEMS TO SALE ====================
  if (subScreen === 'add_item') {
    const draftQty = itemDraft.quantity.trim() === '' ? 1 : Number(itemDraft.quantity) || 0;
    const draftRate = Number(itemDraft.rate) || 0;
    const draftLineRaw = draftQty * draftRate;
    const draftDisc =
      itemDraft.discountType === 'fixed'
        ? Math.min(draftLineRaw, Number(itemDraft.discountValue) || 0)
        : (draftLineRaw * (Number(itemDraft.discountValue) || 0)) / 100;
    const draftAfterDisc = Math.max(0, draftLineRaw - draftDisc);
    const draftPreviewTotal =
      itemDraft.taxSelection === 'exclusive' && itemDraft.taxRate > 0
        ? draftAfterDisc * (1 + itemDraft.taxRate / 100)
        : draftAfterDisc;

    return (
      <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex justify-center">
        <div className="w-full max-w-lg min-h-[100dvh] bg-zinc-100 dark:bg-zinc-950 lg:border-x lg:border-zinc-200 dark:lg:border-zinc-800 flex flex-col shadow-sm">
          {/* Top Header */}
          <header className="sticky top-0 z-30 h-14 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-2 flex items-center justify-between">
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={() => setSubScreen('sale')}
                className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:bg-zinc-200 dark:active:bg-zinc-700 cursor-pointer"
                aria-label="Back to Sale"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h1 className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {editingItemIndex !== null ? 'Edit Item' : 'Add Items to Sale'}
              </h1>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle light or dark theme"
                className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setItemAdvancedOpen((o) => !o)}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors cursor-pointer ${
                  itemAdvancedOpen
                    ? 'bg-orange-50 text-[#F57C00] dark:bg-orange-950/40 dark:text-[#F57C00]'
                    : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
                aria-label="Toggle tax and item options"
                title="GST, HSN & Discount Options"
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </header>

          {/* Item Form Body */}
          <div className="flex-1 bg-white dark:bg-zinc-900 px-4 pt-5 pb-24 space-y-4">
            {/* Item Name Notched Input */}
            <div className="relative">
              <div
                className={`relative rounded-lg border-[1.5px] bg-white dark:bg-zinc-900 transition-colors ${
                  itemNameFocused
                    ? 'border-[#F57C00]'
                    : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                <label
                  htmlFor="quick-item-name"
                  className={`absolute -top-2.5 left-3 bg-white dark:bg-zinc-900 px-1 text-xs font-medium transition-colors ${
                    itemNameFocused
                      ? 'text-[#F57C00]'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  Item Name
                </label>
                <input
                  ref={itemNameInputRef}
                  id="quick-item-name"
                  type="text"
                  value={itemDraft.name}
                  onFocus={() => setItemNameFocused(true)}
                  onBlur={() => {
                    setTimeout(() => setItemNameFocused(false), 180);
                  }}
                  onChange={(e) => setItemDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Chocolate Cake"
                  className="w-full h-12 px-3.5 bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none rounded-lg"
                />
              </div>

              {/* Rate Card Autocomplete Dropdown */}
              {itemNameFocused && matchingRateCard.length > 0 ? (
                <div className="mt-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden z-20">
                  <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    Saved Rate Card Items
                  </div>
                  {matchingRateCard.map((rc) => (
                    <button
                      key={rc.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setItemDraft((d) => ({
                          ...d,
                          name: rc.name,
                          description: rc.description || '',
                          hsnSac: rc.hsnSac || '',
                          unit: rc.unit || 'Nos',
                          rate: String(rc.rate),
                          taxRate: rc.taxRate || 0,
                          discountType: rc.discountType || 'percent',
                          discountValue: rc.discountValue ? String(rc.discountValue) : '',
                        }));
                        setItemNameFocused(false);
                      }}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-orange-50/60 dark:hover:bg-orange-950/20 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {rc.name}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {rc.unit}
                          {rc.taxRate ? ` · GST ${rc.taxRate}%` : ''}
                        </div>
                      </div>
                      <span className="text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 ml-2">
                        {formatINR(rc.rate)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Quantity & Unit Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="relative rounded-lg border border-zinc-300 dark:border-zinc-700 focus-within:border-[1.5px] focus-within:border-[#F57C00] bg-white dark:bg-zinc-900">
                {itemDraft.quantity ? (
                  <label
                    htmlFor="quick-item-qty"
                    className="absolute -top-2.5 left-3 bg-white dark:bg-zinc-900 px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    Quantity
                  </label>
                ) : null}
                <input
                  id="quick-item-qty"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={itemDraft.quantity}
                  onChange={(e) => setItemDraft((d) => ({ ...d, quantity: e.target.value }))}
                  placeholder="Quantity"
                  className="w-full h-12 px-3.5 bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none rounded-lg tabular-nums"
                />
              </div>

              <div className="relative rounded-lg border border-zinc-300 dark:border-zinc-700 focus-within:border-[1.5px] focus-within:border-[#F57C00] bg-white dark:bg-zinc-900">
                {itemDraft.unit ? (
                  <label
                    htmlFor="quick-item-unit"
                    className="absolute -top-2.5 left-3 bg-white dark:bg-zinc-900 px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    Unit
                  </label>
                ) : null}
                <select
                  id="quick-item-unit"
                  value={itemDraft.unit}
                  onChange={(e) => setItemDraft((d) => ({ ...d, unit: e.target.value }))}
                  className={`w-full h-12 px-3.5 pr-8 bg-transparent text-[15px] focus:outline-none rounded-lg appearance-none cursor-pointer ${
                    itemDraft.unit
                      ? 'text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }`}
                >
                  <option value="" className="bg-white dark:bg-zinc-900 text-zinc-500">
                    Unit
                  </option>
                  {UNIT_OPTIONS.map((u) => (
                    <option
                      key={u}
                      value={u}
                      className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                    >
                      {u}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              </div>
            </div>

            {/* Rate & Tax Mode Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="relative rounded-lg border border-zinc-300 dark:border-zinc-700 focus-within:border-[1.5px] focus-within:border-[#F57C00] bg-white dark:bg-zinc-900">
                {itemDraft.rate ? (
                  <label
                    htmlFor="quick-item-rate"
                    className="absolute -top-2.5 left-3 bg-white dark:bg-zinc-900 px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
                  >
                    Rate (Price/Unit)
                  </label>
                ) : null}
                <input
                  id="quick-item-rate"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={itemDraft.rate}
                  onChange={(e) => setItemDraft((d) => ({ ...d, rate: e.target.value }))}
                  placeholder="Rate (Price/Unit)"
                  className="w-full h-12 px-3.5 bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none rounded-lg tabular-nums"
                />
              </div>

              <div className="relative rounded-lg border border-zinc-300 dark:border-zinc-700 focus-within:border-[1.5px] focus-within:border-[#F57C00] bg-white dark:bg-zinc-900">
                <select
                  id="quick-item-tax-mode"
                  value={itemDraft.taxSelection}
                  onChange={(e) =>
                    setItemDraft((d) => ({
                      ...d,
                      taxSelection: e.target.value as 'exclusive' | 'inclusive',
                    }))
                  }
                  aria-label="Tax mode"
                  className="w-full h-12 px-3.5 pr-8 bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 focus:outline-none rounded-lg appearance-none cursor-pointer"
                >
                  <option
                    value="exclusive"
                    className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                  >
                    Without Tax
                  </option>
                  <option
                    value="inclusive"
                    className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                  >
                    With Tax
                  </option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              </div>
            </div>

            {/* Optional Tax / HSN / Discount Drawer */}
            {itemAdvancedOpen ? (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3.5 space-y-3">
                <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Additional Item Details (Tax, HSN &amp; Discount)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>GST Tax Slab</Label>
                    <Select
                      value={String(itemDraft.taxRate)}
                      onChange={(e) =>
                        setItemDraft((d) => ({ ...d, taxRate: Number(e.target.value) }))
                      }
                    >
                      <option value="0">0% (No GST)</option>
                      <option value="5">GST 5%</option>
                      <option value="12">GST 12%</option>
                      <option value="18">GST 18%</option>
                      <option value="28">GST 28%</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>HSN / SAC</Label>
                    <Input
                      value={itemDraft.hsnSac}
                      onChange={(e) => setItemDraft((d) => ({ ...d, hsnSac: e.target.value }))}
                      placeholder="e.g. 998314"
                      className="font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Discount Type</Label>
                    <Select
                      value={itemDraft.discountType}
                      onChange={(e) =>
                        setItemDraft((d) => ({
                          ...d,
                          discountType: e.target.value as 'percent' | 'fixed',
                        }))
                      }
                    >
                      <option value="percent">Percent (%)</option>
                      <option value="fixed">Fixed (₹)</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Discount Value</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={itemDraft.discountValue}
                      onChange={(e) =>
                        setItemDraft((d) => ({ ...d, discountValue: e.target.value }))
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input
                    value={itemDraft.description}
                    onChange={(e) => setItemDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="Optional notes for this item"
                  />
                </div>
              </div>
            ) : null}

            {/* Live Subtotal Preview */}
            {draftRate > 0 ? (
              <div className="flex items-center justify-between rounded-lg bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">Item Total</span>
                <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                  {formatINR(draftPreviewTotal)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Bottom Split Action Bar */}
          <div className="sticky bottom-0 z-30 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-2 h-14 pb-[env(safe-area-inset-bottom)]">
            <button
              type="button"
              onClick={handleItemSaveAndNew}
              className="flex items-center justify-center bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 font-semibold text-[15px] hover:bg-zinc-50 dark:hover:bg-zinc-800 active:bg-zinc-100 dark:active:bg-zinc-700 border-r border-zinc-200 dark:border-zinc-800 cursor-pointer"
            >
              Save &amp; New
            </button>
            <button
              type="button"
              onClick={handleItemSaveAndReturn}
              className="flex items-center justify-center bg-[#F57C00] text-white font-semibold text-[15px] hover:bg-[#E65100] active:bg-[#D84315] cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== SCREEN 1: SALE / BILL SCREEN ====================
  return (
    <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex justify-center">
      <div className="w-full max-w-lg min-h-[100dvh] bg-zinc-100 dark:bg-zinc-950 lg:border-x lg:border-zinc-200 dark:lg:border-zinc-800 flex flex-col relative shadow-sm">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-14 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  navigate('/dashboard');
                }
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:bg-zinc-200 dark:active:bg-zinc-700 cursor-pointer shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-[18px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              Sale
            </h1>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Credit / Cash Segmented Pill */}
            <div
              role="group"
              aria-label="Sale payment mode"
              className="flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 p-0.5"
            >
              <button
                type="button"
                onClick={() => setSaleMode('credit')}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  saleMode === 'credit'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                Credit
              </button>
              <button
                type="button"
                onClick={() => setSaleMode('cash')}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  saleMode === 'cash'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                Cash
              </button>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle light or dark theme"
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => setSaleSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              aria-label="Sale Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Subheader: Invoice No. | Date */}
        <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 grid grid-cols-2">
          <button
            type="button"
            onClick={() => setInvoiceNoModalOpen(true)}
            className="px-4 py-2.5 text-left border-r border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 active:bg-zinc-100 dark:active:bg-zinc-800 cursor-pointer"
          >
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Invoice No.</div>
            <div className="mt-0.5 flex items-center gap-1 text-[14px] font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
              <span>{nextSeqNumber}</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            </div>
          </button>

          <div
            onClick={() => {
              const el = dateInputRef.current;
              if (el) {
                if (typeof el.showPicker === 'function') {
                  try {
                    el.showPicker();
                  } catch {
                    el.click();
                  }
                } else {
                  el.click();
                }
              }
            }}
            className="relative px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60 active:bg-zinc-100 dark:active:bg-zinc-800 cursor-pointer"
          >
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Date</div>
            <div className="mt-0.5 flex items-center gap-1 text-[14px] font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
              <span>{formatDisplayDateDDMMYYYY(invoiceDate)}</span>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
            </div>
            <input
              ref={dateInputRef}
              type="date"
              value={invoiceDate}
              onChange={(e) => {
                if (e.target.value) setInvoiceDate(e.target.value);
              }}
              aria-label="Sale Date"
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
          </div>
        </div>

        {/* Spacer Band */}
        <div className="h-2.5 bg-zinc-100 dark:bg-zinc-950 shrink-0" />

        {/* Main Form Card */}
        <div className="bg-white dark:bg-zinc-900 px-4 py-4 space-y-4">
          {/* Customer * Notched Input */}
          <div className="relative">
            <div
              className={`relative rounded-lg border-[1.5px] bg-white dark:bg-zinc-900 transition-colors ${
                customerFocused
                  ? 'border-[#F57C00]'
                  : 'border-zinc-300 dark:border-zinc-700'
              }`}
            >
              <label
                htmlFor="sale-customer-name"
                className={`absolute -top-2.5 left-3 bg-white dark:bg-zinc-900 px-1 text-xs font-medium transition-colors ${
                  customerFocused
                    ? 'text-[#F57C00]'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                Customer <span className="text-red-500">*</span>
              </label>
              <input
                id="sale-customer-name"
                type="text"
                value={customerName}
                onFocus={() => setCustomerFocused(true)}
                onBlur={() => {
                  setTimeout(() => setCustomerFocused(false), 180);
                }}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSelectedCustomerId('');
                }}
                placeholder=""
                autoComplete="off"
                className="w-full h-12 px-3.5 bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 focus:outline-none rounded-lg"
              />
            </div>

            {/* Customer Autocomplete Dropdown */}
            {customerFocused && matchingCustomers.length > 0 ? (
              <div className="absolute left-0 right-0 mt-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl divide-y divide-zinc-100 dark:divide-zinc-800 max-h-56 overflow-y-auto z-30">
                {matchingCustomers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelectedCustomerId(c.id);
                      setCustomerName(c.companyName || c.name);
                      if (c.phone) setPhoneNumber(c.phone);
                      setCustomerFocused(false);
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-orange-50/60 dark:hover:bg-orange-950/20 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {c.companyName || c.name}
                      </div>
                      {c.phone ? (
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                          {c.phone}
                        </div>
                      ) : null}
                    </div>
                    {selectedCustomerId === c.id ? (
                      <Check className="h-4 w-4 text-[#F57C00] shrink-0" />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Phone Number Input */}
          <div
            className={`relative rounded-lg border bg-white dark:bg-zinc-900 transition-colors ${
              phoneFocused
                ? 'border-[1.5px] border-[#F57C00]'
                : 'border-zinc-300 dark:border-zinc-700'
            }`}
          >
            {phoneFocused || phoneNumber ? (
              <label
                htmlFor="sale-phone-number"
                className={`absolute -top-2.5 left-3 bg-white dark:bg-zinc-900 px-1 text-xs font-medium ${
                  phoneFocused ? 'text-[#F57C00]' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                Phone Number
              </label>
            ) : null}
            <input
              id="sale-phone-number"
              type="tel"
              inputMode="tel"
              value={phoneNumber}
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setPhoneFocused(false)}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder={phoneFocused ? '' : 'Phone Number'}
              className="w-full h-12 px-3.5 bg-transparent text-[15px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none rounded-lg tabular-nums"
            />
          </div>

          {/* + Add Items (Optional) Button */}
          <button
            type="button"
            onClick={() => openAddItemScreen(null)}
            className="w-full h-11 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:bg-zinc-100 dark:active:bg-zinc-700 transition-colors cursor-pointer"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F57C00] text-white">
              <Plus className="h-3.5 w-3.5 stroke-[2.6]" />
            </span>
            <span className="text-[14px] font-semibold text-[#F57C00]">Add Items</span>
            <span className="text-[14px] font-normal text-zinc-400 dark:text-zinc-500">
              (Optional)
            </span>
          </button>

          {/* Added Items List */}
          {items.length > 0 ? (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
              {items.map((item, idx) => {
                const qty = Number(item.quantity) || 0;
                const rate = Number(item.rate) || 0;
                const computedItem = computedFromItems?.items[idx];
                const lineTotal = computedItem ? computedItem.totalAmount : qty * rate;
                return (
                  <div
                    key={item.id || idx}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 bg-zinc-50/70 dark:bg-zinc-950/60"
                  >
                    <button
                      type="button"
                      onClick={() => openAddItemScreen(idx)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {item.name}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {qty} {item.unit} × {formatINR(rate)}
                        {item.taxRate > 0 ? ` · GST ${item.taxRate}%` : ''}
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                        {formatINR(lineTotal)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded-md cursor-pointer"
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Divider Band */}
        <div className="h-2.5 bg-zinc-100 dark:bg-zinc-950 shrink-0" />

        {/* Total Amount Section */}
        <div className="flex-1 bg-white dark:bg-zinc-900 px-4 py-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-100">
              Total Amount
            </span>
            <div className="flex items-center gap-2 border-b border-dashed border-zinc-400 dark:border-zinc-600 pb-1 min-w-[140px] max-w-[190px] justify-between">
              <span className="text-[16px] font-medium text-zinc-800 dark:text-zinc-200">₹</span>
              {items.length > 0 ? (
                <span className="text-[17px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums text-right">
                  {displayTotalAmount.toLocaleString('en-IN', {
                    minimumFractionDigits: displayTotalAmount % 1 === 0 ? 0 : 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              ) : (
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={manualTotalStr}
                  onChange={(e) => setManualTotalStr(e.target.value)}
                  placeholder="0"
                  aria-label="Total Amount"
                  className="w-full bg-transparent text-right text-[17px] font-mono font-semibold text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none tabular-nums"
                />
              )}
            </div>
          </div>

          {computedFromItems && effectiveIsGst && computedFromItems.totalTax > 0 ? (
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 pt-1">
              <span>
                Taxable: <span className="font-mono">{formatINR(computedFromItems.taxableAmount)}</span>
              </span>
              <span>
                GST: <span className="font-mono">{formatINR(computedFromItems.totalTax)}</span>
              </span>
            </div>
          ) : null}

          {lastQuickSavedInvoice ? (
            <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200 truncate">
                  Saved {lastQuickSavedInvoice.invoiceNumber}
                </div>
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400 truncate">
                  {lastQuickSavedInvoice.customerSnapshot.name} ·{' '}
                  {formatINR(lastQuickSavedInvoice.grandTotal)}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleDownloadInvoicePdf(lastQuickSavedInvoice)}
                className="h-8 bg-white dark:bg-zinc-900 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </Button>
            </div>
          ) : null}
        </div>

        {/* Sticky Bottom Action Bar */}
        <div className="sticky bottom-0 z-30 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-stretch h-14 pb-[env(safe-area-inset-bottom)]">
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSaveSale('save_and_new')}
            className="flex-1 flex items-center justify-center bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 font-semibold text-[15px] hover:bg-zinc-50 dark:hover:bg-zinc-800 active:bg-zinc-100 dark:active:bg-zinc-700 border-r border-zinc-200 dark:border-zinc-800 disabled:opacity-50 cursor-pointer"
          >
            Save &amp; New
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSaveSale('save')}
            className="flex-1 flex items-center justify-center bg-[#F57C00] text-white font-semibold text-[15px] hover:bg-[#E65100] active:bg-[#D84315] disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <div className="relative flex">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="w-12 flex items-center justify-center bg-white dark:bg-zinc-900 text-[#F57C00] hover:bg-zinc-50 dark:hover:bg-zinc-800 border-l border-zinc-200 dark:border-zinc-800 cursor-pointer"
              aria-label="More sale actions"
            >
              <MoreVertical className="h-5 w-5" />
            </button>

            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute bottom-14 right-2 z-50 w-56 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl py-1.5 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void handleSaveSale('save_and_download');
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Download className="h-4 w-4 text-[#F57C00]" />
                    <span>Save &amp; Download PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setPreviewOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Eye className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span>Preview Bill</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setSaleSettingsOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Settings className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span>Bill &amp; GST Settings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/invoices/new');
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <FileText className="h-4 w-4 text-[#F57C00]" />
                    <span>Full GST Invoice Editor</span>
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* Invoice Number / Reference Sheet */}
        <Dialog
          open={invoiceNoModalOpen}
          onClose={() => setInvoiceNoModalOpen(false)}
          title="Invoice Number"
          description="Official sequential number is allocated automatically when saved."
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3.5 py-2.5 flex items-center justify-between text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Next Invoice #</span>
              <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                {predictedInvoiceCode}
              </span>
            </div>
            <div className="space-y-1.5">
              <Label>Reference / Custom Bill No. (Optional)</Label>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g. BILL-02 or PO-104"
              />
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setInvoiceNoModalOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Sale Settings Dialog */}
        <Dialog
          open={saleSettingsOpen}
          onClose={() => setSaleSettingsOpen(false)}
          title="Sale & Bill Settings"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  GST Tax Invoice
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Include GST breakdown on bill &amp; PDF
                </div>
              </div>
              <input
                type="checkbox"
                checked={gstEnabled}
                onChange={(e) => setGstEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#F57C00] cursor-pointer"
              />
            </div>

            {gstEnabled ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tax Mode</Label>
                  <Select
                    value={taxMode}
                    onChange={(e) => setTaxMode(e.target.value as TaxPricingMode)}
                  >
                    <option value="exclusive">Without Tax (Exclusive)</option>
                    <option value="inclusive">With Tax (Inclusive)</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Supply Type</Label>
                  <Select
                    value={taxSupplyMode}
                    onChange={(e) => setTaxSupplyMode(e.target.value as TaxSupplyMode)}
                  >
                    <option value="auto">Auto (CGST/SGST or IGST)</option>
                    <option value="intra">Intra-State (CGST + SGST)</option>
                    <option value="inter">Inter-State (IGST)</option>
                  </Select>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Credit Due (Days)</Label>
                <Input
                  type="number"
                  min="0"
                  max="365"
                  value={paymentTermsDays}
                  onChange={(e) => setPaymentTermsDays(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <div className="space-y-1">
                <Label>PDF Template</Label>
                <Select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value as TemplateId)}
                >
                  <option value="classic_gst">Classic GST</option>
                  <option value="executive_minimal">Executive Minimal</option>
                  <option value="compact_commercial">Compact Commercial</option>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Round Off Grand Total
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Round final bill amount to nearest ₹1
                </div>
              </div>
              <input
                type="checkbox"
                checked={roundOffEnabled}
                onChange={(e) => setRoundOffEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#F57C00] cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <Label>Bill Notes (Optional)</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Thank you for your business!"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSaleSettingsOpen(false);
                  navigate('/invoices/new');
                }}
              >
                Full GST Editor
              </Button>
              <Button type="button" onClick={() => setSaleSettingsOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Live Bill Preview Dialog */}
        <Dialog
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title="Bill Preview"
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-4">
            <DocumentPreviewSheet
              docType="invoice"
              record={buildPreviewRecord()}
              templateOverride={templateId}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
                Close
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => {
                  setPreviewOpen(false);
                  void handleSaveSale('save_and_download');
                }}
              >
                <Download className="h-4 w-4" />
                Save &amp; Download PDF
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Saved Bill & Download Modal */}
        <Dialog
          open={Boolean(savedInvoice)}
          onClose={() => setSavedInvoice(null)}
          title="Bill Saved Successfully"
          description={
            savedInvoice
              ? `${savedInvoice.invoiceNumber} · ${savedInvoice.customerSnapshot.companyName || savedInvoice.customerSnapshot.name}`
              : undefined
          }
        >
          {savedInvoice ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">Invoice Number</span>
                  <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                    {savedInvoice.invoiceNumber}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">Sale Type</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {savedInvoice.status === 'paid' ? 'Cash (Paid)' : 'Credit (Unpaid)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">Date</span>
                  <span className="font-mono text-zinc-900 dark:text-zinc-100">
                    {formatDisplayDateDDMMYYYY(savedInvoice.invoiceDate)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-2 text-base font-bold">
                  <span className="text-zinc-900 dark:text-zinc-100">Total Amount</span>
                  <span className="font-mono text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {formatINR(savedInvoice.grandTotal)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Button
                  type="button"
                  disabled={downloadingPdf}
                  onClick={() => handleDownloadInvoicePdf(savedInvoice)}
                >
                  <Download className="h-4 w-4" />
                  {downloadingPdf ? 'Generating PDF...' : 'Download Bill PDF'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleShareInvoice(savedInvoice)}
                >
                  <Share2 className="h-4 w-4" />
                  Share Summary
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const id = savedInvoice.id;
                    setSavedInvoice(null);
                    navigate(`/invoices/${id}`);
                  }}
                >
                  View Bill Details
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSavedInvoice(null);
                    resetSaleForm();
                  }}
                >
                  New Sale
                </Button>
              </div>
            </div>
          ) : null}
        </Dialog>
      </div>
    </div>
  );
}
