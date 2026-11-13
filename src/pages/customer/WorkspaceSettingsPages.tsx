import * as React from 'react';
import { CheckCircle2, Upload } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { authApi, businessApi, subscribeRtdbPath } from '../../lib/api';
import { INDIAN_STATES } from '../../shared/indianStates';
import type { BusinessProfile, Invoice, TemplateId } from '../../shared/types';
import { DocumentPreviewSheet } from '../../components/DocumentPreviewSheet';
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
    const fetchProfile = () => {
      businessApi.getProfile().then((res) => {
        if (res.profile) setForm(res.profile);
      }).catch(() => {});
    };
    fetchProfile();
    if (!tenantUid) return;
    return subscribeRtdbPath(`businessProfiles/${tenantUid}`, fetchProfile);
  }, [tenantUid]);

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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>GSTIN</Label>
              <Input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>UPI ID (Dynamic QR generated automatically on PDFs)</Label>
              <Input
                value={form.upiId}
                onChange={(e) => setForm({ ...form, upiId: e.target.value })}
                placeholder="business@okaxis"
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label>Authorized Signature Label</Label>
              <Input
                value={form.signatureLabel}
                onChange={(e) => setForm({ ...form, signatureLabel: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Business Profile'}
        </Button>
      </div>
    </form>
  );
}

const TEMPLATES: Array<{ id: TemplateId; name: string; description: string }> = [
  {
    id: 'classic_gst',
    name: 'Classic GST Ledger',
    description: 'Signature Drona Orange accent bar, structured HSN/GST matrix, and UPI QR block.',
  },
  {
    id: 'executive_minimal',
    name: 'Executive Minimal',
    description: 'Monochrome charcoal headers with generous whitespace for consulting & B2B retainers.',
  },
  {
    id: 'compact_commercial',
    name: 'Compact Commercial',
    description: 'High-density A4 grid engineered for multi-item wholesale & manufacturing invoices.',
  },
];

export function TemplatesGalleryPage({ docType }: { docType: 'invoice' | 'quotation' }) {
  const { session, updateLocalBusinessProfile } = useAuth();
  const { notify } = useToast();
  const profile = session?.businessProfile;
  const activeTemplate =
    docType === 'invoice'
      ? profile?.defaultInvoiceTemplate || 'classic_gst'
      : profile?.defaultQuotationTemplate || 'classic_gst';

  const [previewId, setPreviewId] = React.useState<TemplateId>(activeTemplate);
  const [saving, setSaving] = React.useState(false);

  const sampleRecord: Invoice = {
    id: 'preview',
    userUid: profile?.userUid || 'preview',
    invoiceNumber: docType === 'invoice' ? `${profile?.invoicePrefix || 'INV'}-2026-0001` : `${profile?.quotationPrefix || 'QUO'}-2026-0001`,
    status: 'unpaid',
    customerId: 'c1',
    customerSnapshot: {
      id: 'c1',
      name: 'Vikramaditya Joshi',
      companyName: 'Sahyadri Logistics LLP',
      email: 'accounts@sahyadrilogistics.in',
      phone: '+91 98192 33410',
      gstin: '27AADFS9021C1Z2',
      billingAddress: 'Plot 14, MIDC Taloja, Navi Mumbai - 410208',
      shippingAddress: 'Plot 14, MIDC Taloja, Navi Mumbai - 410208',
      state: 'Maharashtra',
    },
    businessSnapshot: {
      businessName: profile?.businessName || 'Your Business Name',
      ownerName: profile?.ownerName || 'Owner',
      logoDataUrl: profile?.logoDataUrl || '',
      address: profile?.address || 'Mumbai, Maharashtra',
      email: profile?.email || 'billing@business.in',
      phone: profile?.phone || '+91 98000 00000',
      gstin: profile?.gstin || '27AABCV4812N1Z5',
      pan: profile?.pan || '',
      state: profile?.state || 'Maharashtra',
      bankName: profile?.bankName || 'HDFC Bank Ltd',
      accountNumber: profile?.accountNumber || '50200048192044',
      ifsc: profile?.ifsc || 'HDFC0000240',
      upiId: profile?.upiId || 'business@hdfcbank',
      upiQrDataUrl: profile?.upiQrDataUrl || '',
      signatureLabel: profile?.signatureLabel || 'Authorized Signatory',
    },
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    paymentTerms: 'Net 15',
    referenceNumber: 'PO-2026-101',
    placeOfSupply: 'Maharashtra',
    isGst: true,
    taxMode: 'exclusive',
    taxSupplyMode: 'auto',
    isInterState: false,
    roundOffEnabled: true,
    subtotal: 50000,
    totalDiscount: 0,
    taxableAmount: 50000,
    cgstTotal: 4500,
    sgstTotal: 4500,
    igstTotal: 0,
    totalTax: 9000,
    roundOff: 0,
    grandTotal: 59000,
    amountPaid: 0,
    balanceDue: 59000,
    amountInWords: 'Rupees Fifty Nine Thousand Only',
    templateId: previewId,
    notes: 'Sample preview using your live business profile.',
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
        hsnSac: '998314',
        quantity: 1,
        unit: 'Year',
        rate: 50000,
        discountType: 'percent',
        discountValue: 0,
        taxRate: 18,
        grossAmount: 50000,
        discountAmount: 0,
        taxableAmount: 50000,
        cgstAmount: 4500,
        sgstAmount: 4500,
        igstAmount: 0,
        taxAmount: 9000,
        totalAmount: 59000,
      },
    ],
  };

  const handleSetDefault = async () => {
    setSaving(true);
    try {
      const payload =
        docType === 'invoice'
          ? { defaultInvoiceTemplate: previewId }
          : { defaultQuotationTemplate: previewId };
      const res = await businessApi.updateProfile(payload);
      updateLocalBusinessProfile(res.profile);
      notify('success', `Default ${docType} template updated`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TEMPLATES.map((tpl) => {
          const isSelected = previewId === tpl.id;
          const isDefault = activeTemplate === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setPreviewId(tpl.id)}
              className={`rounded-xl border p-5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'border-[#F57C00] bg-orange-50/40 dark:bg-orange-950/10'
                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {tpl.name}
                </span>
                {isDefault ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Default
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">{tpl.description}</p>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Live A4 Preview — {TEMPLATES.find((t) => t.id === previewId)?.name}
        </div>
        <Button disabled={saving || activeTemplate === previewId} onClick={handleSetDefault}>
          {activeTemplate === previewId
            ? 'Currently Default'
            : saving
              ? 'Updating...'
              : `Set as Default ${docType === 'invoice' ? 'Invoice' : 'Quotation'} Template`}
        </Button>
      </div>

      <DocumentPreviewSheet docType="invoice" record={sampleRecord} templateOverride={previewId} />
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

  const tenantUid = session?.effectiveUser.uid;
  React.useEffect(() => {
    const fetchProfile = () => {
      businessApi.getProfile().then((res) => {
        if (res.profile) setForm(res.profile);
      }).catch(() => {});
    };
    fetchProfile();
    if (!tenantUid) return;
    return subscribeRtdbPath(`businessProfiles/${tenantUid}`, fetchProfile);
  }, [tenantUid]);

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
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

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
                <Button type="submit" variant="outline" disabled={changingPw}>
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
