import * as React from 'react';
import { CheckCircle2, Upload } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authApi, businessApi, cachedRead } from '../../lib/api';
import { INDIAN_STATES } from '../../shared/indianStates';
import type {
  BusinessProfile,
  Invoice,
  Quotation,
  QuotationTemplateId,
} from '../../shared/types';
import { DocumentPreviewSheet } from '../../components/DocumentPreviewSheet';
import { InvoiceThemeSelector } from '../../components/invoice/InvoiceThemeSelector';
import { INVOICE_THEMES, normalizeTemplateId } from '../../components/invoice/invoiceThemeRegistry';
import type { StandardTemplateId } from '../../components/invoice/invoiceThemeTypes';
import { QuotationThemeSelector } from '../../components/quotation/QuotationThemeSelector';
import {
  QUOTATION_THEMES,
  normalizeQuotationTemplateId,
} from '../../components/quotation/quotationThemeRegistry';
import { PWAInstallButton } from '../../components/PWAComponents';
import { SignatureControl } from '../../components/SignatureControl';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function BusinessProfilePage() {
  const { session, updateLocalBusinessProfile } = useAuth();
  const { notify } = useToast();
  const [form, setForm] = React.useState<BusinessProfile | null>(session?.businessProfile || null);
  const [saving, setSaving] = React.useState(false);

  const tenantUid = session?.effectiveUser.uid;
  React.useEffect(() => {
    if (session?.businessProfile) {
      setForm(session.businessProfile);
    } else if (tenantUid) {
      const cachedProf = cachedRead.getTenantEntry(tenantUid).profile;
      if (cachedProf) setForm(cachedProf);
    }
    businessApi.getProfile().then((res) => {
      if (res.profile) setForm(res.profile);
    }).catch(() => {});
  }, [tenantUid, session?.businessProfile]);

  if (!form) return <div className="p-8 text-sm text-zinc-500">Loading business profile...</div>;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await businessApi.updateProfile(form);
      setForm(res.profile);
      updateLocalBusinessProfile(res.profile);
      notify('success', 'Business profile & branding saved');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Company Identity & GST Registration</CardTitle>
          <CardDescription>
            Independent branding used on all PDFs, print sheets, and customer invoices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-6 pb-2">
            <div className="flex items-center gap-4">
              {form.logoDataUrl ? (
                <img
                  src={form.logoDataUrl}
                  alt="Business Logo"
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded-lg border border-zinc-200 object-contain bg-white p-1"
                />
              ) : (
                <div className="h-16 w-16 rounded-lg border border-dashed border-zinc-300 flex items-center justify-center text-xs text-zinc-400">
                  No Logo
                </div>
              )}
              <div>
                <Label className="block mb-1.5">Business Logo (PNG/JPG)</Label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 cursor-pointer dark:border-zinc-800 dark:bg-zinc-950">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 300_000) {
                        notify('error', 'Logo must be under 300 KB');
                        return;
                      }
                      const url = await readFileAsDataUrl(f);
                      setForm({ ...form, logoDataUrl: url });
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Business Name *</Label>
              <Input
                required
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Owner / Authorized Person *</Label>
              <Input
                required
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Business Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <Label>Business Tax Registration (Saved App-Wide) *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    defaultIsGst: true,
                    defaultTaxRate: form.defaultTaxRate === 0 ? 18 : form.defaultTaxRate,
                  })
                }
                className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                  form.defaultIsGst !== false
                    ? 'border-[#F57C00] bg-orange-50/50 dark:bg-orange-950/15'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    GST Registered Business
                  </span>
                  {form.defaultIsGst !== false ? (
                    <CheckCircle2 className="h-4 w-4 text-[#F57C00] shrink-0" />
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Issues Tax Invoices with HSN/SAC, CGST/SGST &amp; IGST breakdowns by default.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, defaultIsGst: false })}
                className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                  form.defaultIsGst === false
                    ? 'border-[#F57C00] bg-orange-50/50 dark:bg-orange-950/15'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Non-GST Business
                  </span>
                  {form.defaultIsGst === false ? (
                    <CheckCircle2 className="h-4 w-4 text-[#F57C00] shrink-0" />
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Issues Bills of Supply without GST columns or tax calculations across the app.
                </p>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>{form.defaultIsGst === false ? 'GSTIN (Optional — Non-GST)' : 'GSTIN'}</Label>
              <Input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                placeholder={form.defaultIsGst === false ? 'Not applicable / Optional' : '27AABCU9603R1ZM'}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>PAN (Optional)</Label>
              <Input
                value={form.pan}
                onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>Registered State *</Label>
              <Select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Registered Office Address</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank & UPI Settlement Details</CardTitle>
          <CardDescription>Displayed on invoices for NEFT/RTGS and instant UPI QR scans</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Bank Name</Label>
              <Input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Account Number</Label>
              <Input
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label>IFSC Code</Label>
              <Input
                value={form.ifsc}
                onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                className="font-mono uppercase"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>UPI ID (Dynamic QR generated automatically on PDFs)</Label>
            <Input
              value={form.upiId}
              onChange={(e) => setForm({ ...form, upiId: e.target.value })}
              placeholder="business@okaxis"
              className="font-mono"
            />
          </div>

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <SignatureControl
              signatureDataUrl={form.signatureDataUrl || ''}
              signatureLabel={form.signatureLabel || ''}
              onChangeDataUrl={(url) => setForm({ ...form, signatureDataUrl: url })}
              onChangeLabel={(label) => setForm({ ...form, signatureLabel: label })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving} className="w-full sm:w-auto">
          {saving ? 'Saving...' : 'Save Business Profile'}
        </Button>
      </div>
    </form>
  );
}

export function TemplatesGalleryPage({ docType }: { docType: 'invoice' | 'quotation' }) {
  const { session, updateLocalBusinessProfile } = useAuth();
  const { notify } = useToast();
  const profile = session?.businessProfile;

  const activeInvoiceDefault = normalizeTemplateId(profile?.defaultInvoiceTemplate);
  const activeQuotationDefault = normalizeQuotationTemplateId(profile?.defaultQuotationTemplate);

  const [invoicePreviewId, setInvoicePreviewId] = React.useState<StandardTemplateId>(activeInvoiceDefault);
  const [quotationPreviewId, setQuotationPreviewId] = React.useState<QuotationTemplateId>(activeQuotationDefault);
  const [savingInvoice, setSavingInvoice] = React.useState(false);
  const [savingQuotation, setSavingQuotation] = React.useState(false);
  const quotationSectionRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    setInvoicePreviewId(activeInvoiceDefault);
  }, [activeInvoiceDefault]);

  React.useEffect(() => {
    setQuotationPreviewId(activeQuotationDefault);
  }, [activeQuotationDefault]);

  React.useEffect(() => {
    if (docType === 'quotation' && quotationSectionRef.current) {
      quotationSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [docType]);

  const isGstDefault = profile?.defaultIsGst !== false;
  const sampleBizSnapshot = {
    businessName: profile?.businessName || 'Your Business Name',
    ownerName: profile?.ownerName || 'Owner',
    logoDataUrl: profile?.logoDataUrl || '',
    address: profile?.address || 'Mumbai, Maharashtra',
    email: profile?.email || 'billing@business.in',
    phone: profile?.phone || '+91 98000 00000',
    gstin: isGstDefault ? (profile?.gstin || '27AABCV4812N1Z5') : (profile?.gstin || ''),
    pan: profile?.pan || '',
    state: profile?.state || 'Maharashtra',
    bankName: profile?.bankName || 'HDFC Bank Ltd',
    accountNumber: profile?.accountNumber || '50200048192044',
    ifsc: profile?.ifsc || 'HDFC0000240',
    upiId: profile?.upiId || 'business@hdfcbank',
    upiQrDataUrl: profile?.upiQrDataUrl || '',
    signatureLabel: profile?.signatureLabel || 'Authorized Signatory',
    signatureDataUrl: profile?.signatureDataUrl || '',
  };

  const sampleCustSnapshot = {
    id: 'c1',
    name: 'Vikramaditya Joshi',
    companyName: 'Sahyadri Logistics LLP',
    email: 'accounts@sahyadrilogistics.in',
    phone: '+91 98192 33410',
    gstin: isGstDefault ? '27AADFS9021C1Z2' : '',
    billingAddress: 'Plot 14, MIDC Taloja, Navi Mumbai - 410208',
    shippingAddress: 'Plot 14, MIDC Taloja, Navi Mumbai - 410208',
    state: 'Maharashtra',
  };

  const sampleInvoiceRecord: Invoice = {
    id: 'preview-inv',
    userUid: profile?.userUid || 'preview',
    invoiceNumber: `${profile?.invoicePrefix || 'INV'}-2026-0001`,
    status: 'unpaid',
    customerId: 'c1',
    customerSnapshot: sampleCustSnapshot,
    businessSnapshot: sampleBizSnapshot,
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    paymentTerms: 'Net 15',
    referenceNumber: 'PO-2026-101',
    placeOfSupply: 'Maharashtra',
    isGst: isGstDefault,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    isInterState: false,
    roundOffEnabled: true,
    subtotal: 50000,
    totalDiscount: 0,
    taxableAmount: 50000,
    cgstTotal: isGstDefault ? 4500 : 0,
    sgstTotal: isGstDefault ? 4500 : 0,
    igstTotal: 0,
    totalTax: isGstDefault ? 9000 : 0,
    roundOff: 0,
    grandTotal: isGstDefault ? 59000 : 50000,
    amountPaid: 0,
    balanceDue: isGstDefault ? 59000 : 50000,
    amountInWords: isGstDefault ? 'Rupees Fifty Nine Thousand Only' : 'Rupees Fifty Thousand Only',
    templateId: invoicePreviewId,
    notes: 'Sample invoice preview using your live business profile.',
    terms: profile?.termsAndConditions || 'Payment due within 15 days.',
    sourceQuotationId: null,
    cancellationReason: null,
    cancelledAt: null,
    finalizedAt: null,
    createdAt: '',
    updatedAt: '',
    items: [
      {
        sortOrder: 0,
        name: 'Enterprise Annual Subscription',
        description: 'Multi-branch billing and analytics',
        hsnSac: isGstDefault ? '998314' : '',
        quantity: 1,
        unit: 'Year',
        rate: 50000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: isGstDefault ? 18 : 0,
        grossAmount: 50000,
        discountAmount: 0,
        taxableAmount: 50000,
        cgstAmount: isGstDefault ? 4500 : 0,
        sgstAmount: isGstDefault ? 4500 : 0,
        igstAmount: 0,
        taxAmount: isGstDefault ? 9000 : 0,
        totalAmount: isGstDefault ? 59000 : 50000,
      },
    ],
  };

  const sampleQuotationRecord: Quotation = {
    id: 'preview-quo',
    userUid: profile?.userUid || 'preview',
    quotationNumber: `${profile?.quotationPrefix || 'QTN'}-2026-0001`,
    status: 'sent',
    customerId: 'c1',
    customerSnapshot: sampleCustSnapshot,
    businessSnapshot: sampleBizSnapshot,
    quotationDate: new Date().toISOString().slice(0, 10),
    validUntil: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    referenceNumber: 'RFP-2026-08',
    placeOfSupply: 'Maharashtra',
    isGst: isGstDefault,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    isInterState: false,
    roundOffEnabled: true,
    subtotal: 75000,
    totalDiscount: 0,
    taxableAmount: 75000,
    cgstTotal: isGstDefault ? 6750 : 0,
    sgstTotal: isGstDefault ? 6750 : 0,
    igstTotal: 0,
    totalTax: isGstDefault ? 13500 : 0,
    roundOff: 0,
    grandTotal: isGstDefault ? 88500 : 75000,
    amountInWords: isGstDefault
      ? 'Rupees Eighty Eight Thousand Five Hundred Only'
      : 'Rupees Seventy Five Thousand Only',
    templateId: quotationPreviewId,
    quotationTitle: 'QUOTATION',
    projectDescription:
      'Custom cloud platform rollout, workflow automation, and team onboarding across 3 departments.',
    deliveryTimeline: '3–4 Weeks from Approval',
    paymentTerms: '40% on Kickoff · 60% upon Go-Live',
    preparedBy: profile?.ownerName || 'Sales Proposal Team',
    showPaymentInstructions: false,
    notes: 'Estimated commercial proposal. Valid for 30 days from issue date.',
    terms: '1. Pricing valid through Valid Until date.\n2. Timeline begins on written confirmation.',
    convertedInvoiceId: null,
    createdAt: '',
    updatedAt: '',
    items: [
      {
        sortOrder: 0,
        name: 'Custom Web & Portal Architecture',
        description: 'Responsive web portal, RBAC permissions, and GST billing workflows',
        hsnSac: isGstDefault ? '998314' : '',
        quantity: 1,
        unit: 'Project',
        rate: 55000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: isGstDefault ? 18 : 0,
        grossAmount: 55000,
        discountAmount: 0,
        taxableAmount: 55000,
        cgstAmount: isGstDefault ? 4950 : 0,
        sgstAmount: isGstDefault ? 4950 : 0,
        igstAmount: 0,
        taxAmount: isGstDefault ? 9900 : 0,
        totalAmount: isGstDefault ? 64900 : 55000,
      },
      {
        sortOrder: 1,
        name: 'Team Onboarding & Cloud Setup',
        description: 'Admin training, data migration, and initial 90-day support',
        hsnSac: isGstDefault ? '998313' : '',
        quantity: 1,
        unit: 'Package',
        rate: 20000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: isGstDefault ? 18 : 0,
        grossAmount: 20000,
        discountAmount: 0,
        taxableAmount: 20000,
        cgstAmount: isGstDefault ? 1800 : 0,
        sgstAmount: isGstDefault ? 1800 : 0,
        igstAmount: 0,
        taxAmount: isGstDefault ? 3600 : 0,
        totalAmount: isGstDefault ? 23600 : 20000,
      },
    ],
  };

  const handleSetDefaultInvoice = async () => {
    setSavingInvoice(true);
    try {
      const res = await businessApi.updateProfile({ defaultInvoiceTemplate: invoicePreviewId });
      updateLocalBusinessProfile(res.profile);
      notify('success', 'Default invoice theme updated');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update invoice theme');
    } finally {
      setSavingInvoice(false);
    }
  };

  const handleSetDefaultQuotation = async () => {
    setSavingQuotation(true);
    try {
      const res = await businessApi.updateProfile({
        defaultQuotationTemplate: quotationPreviewId,
      });
      updateLocalBusinessProfile(res.profile);
      notify('success', 'Default quotation theme updated');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update quotation theme');
    } finally {
      setSavingQuotation(false);
    }
  };

  return (
    <div className="space-y-12">
      {/* SECTION A: INVOICE THEMES */}
      <section id="invoice-themes-section" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#F57C00]">
              Section A
            </span>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Invoice Themes ({INVOICE_THEMES.length})
            </h2>
            <p className="text-xs text-zinc-500">
              Select a tax invoice / bill of supply layout for sales invoices and Quick Sale PDFs.
            </p>
          </div>
          <Button
            className="w-full sm:w-auto"
            disabled={savingInvoice || activeInvoiceDefault === invoicePreviewId}
            onClick={handleSetDefaultInvoice}
          >
            {activeInvoiceDefault === invoicePreviewId
              ? 'Default Invoice Theme'
              : savingInvoice
                ? 'Updating...'
                : 'Set as Default Invoice Theme'}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INVOICE_THEMES.map((tpl) => {
            const isSelected = invoicePreviewId === tpl.id;
            const isDefault = activeInvoiceDefault === tpl.id;
            const Thumb = tpl.thumbnail;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setInvoicePreviewId(tpl.id)}
                className={`rounded-xl border p-4 text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#F57C00] bg-orange-50/40 dark:bg-orange-950/15 ring-2 ring-[#F57C00]/20 shadow-sm'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50'
                }`}
              >
                <div className="w-full h-32 mb-3 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800 p-2 flex items-center justify-center border border-zinc-100 dark:border-zinc-800">
                  <Thumb isSelected={isSelected} />
                </div>
                <div className="w-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {tpl.name}
                    </span>
                    {isDefault ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 className="h-3 w-3" />
                        Default
                      </span>
                    ) : tpl.orientation === 'landscape' ? (
                      <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        A4 Landscape
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{tpl.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Live Invoice Preview — {INVOICE_THEMES.find((t) => t.id === invoicePreviewId)?.name}
          </div>
          <div className="overflow-x-auto">
            <DocumentPreviewSheet
              docType="invoice"
              record={sampleInvoiceRecord}
              templateOverride={invoicePreviewId}
            />
          </div>
        </div>
      </section>

      {/* SECTION B: QUOTATION THEMES */}
      <section
        id="quotation-themes-section"
        ref={quotationSectionRef}
        className="space-y-6 pt-6 border-t-2 border-zinc-200 dark:border-zinc-800"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#F57C00]">
              Section B
            </span>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Quotation Themes ({QUOTATION_THEMES.length})
            </h2>
            <p className="text-xs text-zinc-500">
              Dedicated commercial proposal &amp; estimate templates designed exclusively for quotations.
            </p>
          </div>
          <Button
            className="w-full sm:w-auto"
            disabled={savingQuotation || activeQuotationDefault === quotationPreviewId}
            onClick={handleSetDefaultQuotation}
          >
            {activeQuotationDefault === quotationPreviewId
              ? 'Default Quotation Theme'
              : savingQuotation
                ? 'Updating...'
                : 'Set as Default Quotation Theme'}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {QUOTATION_THEMES.map((tpl) => {
            const isSelected = quotationPreviewId === tpl.id;
            const isDefault = activeQuotationDefault === tpl.id;
            const Thumb = tpl.thumbnail;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setQuotationPreviewId(tpl.id)}
                className={`rounded-xl border p-4 text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#F57C00] bg-orange-50/40 dark:bg-orange-950/15 ring-2 ring-[#F57C00]/20 shadow-sm'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50'
                }`}
              >
                <div className="w-full h-32 mb-3 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800 p-2 flex items-center justify-center border border-zinc-100 dark:border-zinc-800">
                  <Thumb isSelected={isSelected} />
                </div>
                <div className="w-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {tpl.name}
                    </span>
                    {isDefault ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 className="h-3 w-3" />
                        Default
                      </span>
                    ) : tpl.orientation === 'landscape' ? (
                      <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        A4 Landscape
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{tpl.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Live Quotation Preview — {QUOTATION_THEMES.find((t) => t.id === quotationPreviewId)?.name}
          </div>
          <div className="overflow-x-auto">
            <DocumentPreviewSheet
              docType="quotation"
              record={sampleQuotationRecord}
              templateOverride={quotationPreviewId}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export function CustomerSettingsPage() {
  const { session, updateLocalBusinessProfile } = useAuth();
  const { notify } = useToast();
  const [form, setForm] = React.useState<BusinessProfile | null>(session?.businessProfile || null);
  const [saving, setSaving] = React.useState(false);

  const [pwForm, setPwForm] = React.useState({ currentPassword: '', newPassword: '' });
  const [changingPw, setChangingPw] = React.useState(false);
  const [savingSig, setSavingSig] = React.useState(false);
  const [savingInvoiceTheme, setSavingInvoiceTheme] = React.useState(false);
  const [savingQuotationTheme, setSavingQuotationTheme] = React.useState(false);
  const [selectedInvoiceTheme, setSelectedInvoiceTheme] = React.useState<StandardTemplateId>(() =>
    normalizeTemplateId(session?.businessProfile?.defaultInvoiceTemplate)
  );
  const [selectedQuotationTheme, setSelectedQuotationTheme] =
    React.useState<QuotationTemplateId>(() =>
      normalizeQuotationTemplateId(session?.businessProfile?.defaultQuotationTemplate)
    );

  const tenantUid = session?.effectiveUser.uid;
  React.useEffect(() => {
    if (session?.businessProfile) {
      setForm(session.businessProfile);
      setSelectedInvoiceTheme(normalizeTemplateId(session.businessProfile.defaultInvoiceTemplate));
      setSelectedQuotationTheme(
        normalizeQuotationTemplateId(session.businessProfile.defaultQuotationTemplate)
      );
    } else if (tenantUid) {
      const cachedProf = cachedRead.getTenantEntry(tenantUid).profile;
      if (cachedProf) {
        setForm(cachedProf);
        setSelectedInvoiceTheme(normalizeTemplateId(cachedProf.defaultInvoiceTemplate));
        setSelectedQuotationTheme(
          normalizeQuotationTemplateId(cachedProf.defaultQuotationTemplate)
        );
      }
    }
    businessApi.getProfile().then((res) => {
      if (res.profile) {
        setForm(res.profile);
        setSelectedInvoiceTheme(normalizeTemplateId(res.profile.defaultInvoiceTemplate));
        setSelectedQuotationTheme(
          normalizeQuotationTemplateId(res.profile.defaultQuotationTemplate)
        );
      }
    }).catch(() => {});
  }, [tenantUid, session?.businessProfile]);

  if (!form) return <div className="p-8 text-sm text-zinc-500">Loading settings...</div>;

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await businessApi.updateProfile({
        invoicePrefix: form.invoicePrefix,
        quotationPrefix: form.quotationPrefix,
        defaultIsGst: form.defaultIsGst,
        defaultTaxRate: form.defaultTaxRate,
        defaultTaxMode: form.defaultTaxMode,
        defaultPaymentTermsDays: form.defaultPaymentTermsDays,
        termsAndConditions: form.termsAndConditions,
        signatureLabel: form.signatureLabel,
        signatureDataUrl: form.signatureDataUrl,
      });
      setForm(res.profile);
      updateLocalBusinessProfile(res.profile);
      notify('success', 'Invoicing defaults saved');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefaultInvoiceTheme = async (themeId: StandardTemplateId) => {
    setSavingInvoiceTheme(true);
    try {
      const res = await businessApi.updateProfile({
        defaultInvoiceTemplate: themeId,
      });
      setForm(res.profile);
      updateLocalBusinessProfile(res.profile);
      setSelectedInvoiceTheme(themeId);
      notify('success', 'Default invoice theme updated for all invoices');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update default invoice theme');
    } finally {
      setSavingInvoiceTheme(false);
    }
  };

  const handleSetDefaultQuotationTheme = async (themeId: QuotationTemplateId) => {
    setSavingQuotationTheme(true);
    try {
      const res = await businessApi.updateProfile({
        defaultQuotationTemplate: themeId,
      });
      setForm(res.profile);
      updateLocalBusinessProfile(res.profile);
      setSelectedQuotationTheme(themeId);
      notify('success', 'Default quotation theme updated for all quotations');
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'Failed to update default quotation theme'
      );
    } finally {
      setSavingQuotationTheme(false);
    }
  };

  const handleSaveSignature = async () => {
    setSavingSig(true);
    try {
      const res = await businessApi.updateProfile({
        signatureLabel: form.signatureLabel,
        signatureDataUrl: form.signatureDataUrl,
      });
      setForm(res.profile);
      updateLocalBusinessProfile(res.profile);
      notify('success', 'Authorized signature saved');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save signature');
    } finally {
      setSavingSig(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPw(true);
    try {
      await authApi.changePassword(pwForm.currentPassword, pwForm.newPassword);
      setPwForm({ currentPassword: '', newPassword: '' });
      notify('success', 'Password changed successfully');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <form onSubmit={handleSavePrefs}>
        <Card>
          <CardHeader>
            <CardTitle>Document Numbering & Tax Defaults</CardTitle>
            <CardDescription>
              Prefixes apply to backend year-based sequences (e.g., {form.invoicePrefix}-2026-0001)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Invoice Prefix</Label>
                <Input
                  value={form.invoicePrefix}
                  onChange={(e) =>
                    setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })
                  }
                  className="font-mono uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label>Quotation Prefix</Label>
                <Input
                  value={form.quotationPrefix}
                  onChange={(e) =>
                    setForm({ ...form, quotationPrefix: e.target.value.toUpperCase() })
                  }
                  className="font-mono uppercase"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Default GST Rate (%)</Label>
                <Select
                  value={form.defaultTaxRate}
                  onChange={(e) => setForm({ ...form, defaultTaxRate: Number(e.target.value) })}
                >
                  {[0, 5, 12, 18, 28].map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Default Tax Pricing</Label>
                <Select
                  value={form.defaultTaxMode}
                  onChange={(e) =>
                    setForm({ ...form, defaultTaxMode: e.target.value as 'exclusive' | 'inclusive' })
                  }
                >
                  <option value="exclusive">GST Exclusive</option>
                  <option value="inclusive">GST Inclusive</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Default Payment Terms (Days)</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={form.defaultPaymentTermsDays}
                  onChange={(e) =>
                    setForm({ ...form, defaultPaymentTermsDays: Number(e.target.value) })
                  }
                  className="font-mono"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={form.defaultIsGst}
                onChange={(e) => setForm({ ...form, defaultIsGst: e.target.checked })}
                className="accent-[#F57C00]"
              />
              Enable GST calculations by default on new documents
            </label>

            <div className="space-y-1">
              <Label>Default Terms & Conditions</Label>
              <Textarea
                rows={4}
                value={form.termsAndConditions}
                onChange={(e) => setForm({ ...form, termsAndConditions: e.target.value })}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving} className="w-full sm:w-auto">
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Invoice / Quotation Themes</CardTitle>
          <CardDescription>
            Choose independent default PDF &amp; A4 themes for Invoices (Section A) and Quotations (Section B).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2 pb-5 border-b border-zinc-200 dark:border-zinc-800">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Section A · Default Invoice Theme
            </div>
            <InvoiceThemeSelector
              currentThemeId={selectedInvoiceTheme}
              defaultThemeId={form.defaultInvoiceTemplate}
              onSelectTheme={(t) => setSelectedInvoiceTheme(t)}
              onSetAsDefault={handleSetDefaultInvoiceTheme}
              isSettingDefault={savingInvoiceTheme}
            />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-[#F57C00]">
              Section B · Default Quotation Theme
            </div>
            <QuotationThemeSelector
              currentThemeId={selectedQuotationTheme}
              defaultThemeId={form.defaultQuotationTemplate}
              onSelectTheme={(t) => setSelectedQuotationTheme(t)}
              onSetAsDefault={handleSetDefaultQuotationTheme}
              isSettingDefault={savingQuotationTheme}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authorized Signature</CardTitle>
          <CardDescription>
            Draw your signature or upload a signature image to print on every invoice and quotation PDF
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SignatureControl
            signatureDataUrl={form.signatureDataUrl || ''}
            signatureLabel={form.signatureLabel || ''}
            onChangeDataUrl={(url) => setForm({ ...form, signatureDataUrl: url })}
            onChangeLabel={(label) => setForm({ ...form, signatureLabel: label })}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={savingSig}
              onClick={handleSaveSignature}
              className="w-full sm:w-auto"
            >
              {savingSig ? 'Saving Signature...' : 'Save Signature'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Install App (Mobile &amp; PC)</CardTitle>
          <CardDescription>
            Install DRONA Invoice as a standalone desktop or mobile app for faster access and offline resilience
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PWAInstallButton variant="card" className="w-full sm:w-auto" />
        </CardContent>
      </Card>

      {!session?.isImpersonating ? (
        <form onSubmit={handlePasswordChange}>
          <Card>
            <CardHeader>
              <CardTitle>Security & Password</CardTitle>
              <CardDescription>Update your workspace sign-in password</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Current Password</Label>
                  <Input
                    type="password"
                    required
                    value={pwForm.currentPassword}
                    onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>New Password (min 8 chars)</Label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={pwForm.newPassword}
                    onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="outline" disabled={changingPw} className="w-full sm:w-auto">
                  {changingPw ? 'Updating...' : 'Update Password'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </div>
  );
}
