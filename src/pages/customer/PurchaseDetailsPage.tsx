import * as React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CreditCard,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cachedRead, purchasePaymentsApi, purchasesApi } from '../../lib/api';
import { generatePurchasePdf } from '../../lib/pdfGenerator';
import { formatDate } from '../../lib/utils';
import { formatINR } from '../../shared/gstCalculator';
import type {
  PaymentMethod,
  Purchase,
  PurchaseAttachment,
  PurchasePayment,
} from '../../shared/types';
import { PurchaseStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/ui/toast';

const PAYMENT_METHODS: PaymentMethod[] = [
  'Bank Transfer',
  'UPI',
  'Cash',
  'Cheque',
  'Credit/Debit Card',
  'Other',
];

export function PurchaseDetailsPage({
  purchaseId,
  navigate,
}: {
  purchaseId: string;
  navigate: (path: string) => void;
}) {
  const { session } = useAuth();
  const tenantUid = session?.effectiveUser.uid;
  const profile = session?.businessProfile || null;
  const { notify } = useToast();

  const initialData = React.useMemo(() => {
    if (!tenantUid) return null;
    const e = cachedRead.getTenantEntry(tenantUid);
    const p = (e.purchases as Purchase[]).find((x) => x.id === purchaseId) || null;
    if (!p) return null;
    const pays = (e.purchasePayments as PurchasePayment[]).filter(
      (x) => x.purchaseId === purchaseId
    );
    const att =
      (e.purchaseAttachments as PurchaseAttachment[]).find((x) => x.purchaseId === purchaseId) ||
      null;
    return { purchase: p, payments: pays, attachment: att };
  }, [tenantUid, purchaseId]);

  const [purchase, setPurchase] = React.useState<Purchase | null>(
    () => initialData?.purchase || null
  );
  const [payments, setPayments] = React.useState<PurchasePayment[]>(
    () => initialData?.payments || []
  );
  const [attachment, setAttachment] = React.useState<PurchaseAttachment | null>(
    () => initialData?.attachment || null
  );
  const [loading, setLoading] = React.useState(() => !initialData);

  // Payment Modal State (Create & Edit)
  const [payModalOpen, setPayModalOpen] = React.useState(false);
  const [editingPayment, setEditingPayment] = React.useState<PurchasePayment | null>(null);
  const [savingPay, setSavingPay] = React.useState(false);
  const [payForm, setPayForm] = React.useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: 0,
    paymentMethod: 'Bank Transfer' as PaymentMethod,
    referenceId: '',
    notes: '',
    allowAdvance: false,
  });

  // Delete Payment Confirmation
  const [deleteTargetPayment, setDeleteTargetPayment] = React.useState<PurchasePayment | null>(
    null
  );
  const [deletingPayment, setDeletingPayment] = React.useState(false);

  // Delete Purchase Bill Confirmation
  const [deleteBillOpen, setDeleteBillOpen] = React.useState(false);
  const [deletingBill, setDeletingBill] = React.useState(false);

  const load = React.useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await purchasesApi.get(purchaseId);
        setPurchase(res.purchase);
        setPayments(res.payments);
        setAttachment(res.attachment);
      } catch (err) {
        if (!silent) {
          notify('error', err instanceof Error ? err.message : 'Failed to load purchase bill');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [purchaseId, notify]
  );

  React.useEffect(() => {
    void load(Boolean(initialData));
  }, [load, initialData]);

  React.useEffect(() => {
    if (!tenantUid) return;
    return cachedRead.subscribeTenantCache(tenantUid, (changed) => {
      if (
        changed.has('purchases') ||
        changed.has('purchasePayments') ||
        changed.has('purchaseAttachments')
      ) {
        const e = cachedRead.getTenantEntry(tenantUid);
        const found = (e.purchases as Purchase[]).find((x) => x.id === purchaseId);
        if (found) setPurchase(found);
        setPayments(
          (e.purchasePayments as PurchasePayment[]).filter((x) => x.purchaseId === purchaseId)
        );
        setAttachment(
          (e.purchaseAttachments as PurchaseAttachment[]).find(
            (x) => x.purchaseId === purchaseId
          ) || null
        );
      }
    });
  }, [tenantUid, purchaseId]);

  const openRecordPayment = () => {
    if (!purchase) return;
    setEditingPayment(null);
    setPayForm({
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: purchase.balanceDue > 0 ? purchase.balanceDue : 0,
      paymentMethod: 'Bank Transfer',
      referenceId: '',
      notes: '',
      allowAdvance: false,
    });
    setPayModalOpen(true);
  };

  const openEditPayment = (pay: PurchasePayment) => {
    setEditingPayment(pay);
    setPayForm({
      paymentDate: pay.paymentDate,
      amount: pay.amount,
      paymentMethod: pay.paymentMethod,
      referenceId: pay.referenceId || '',
      notes: pay.notes || '',
      allowAdvance: Boolean(pay.isAdvance),
    });
    setPayModalOpen(true);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchase) return;
    setSavingPay(true);
    try {
      if (editingPayment) {
        await purchasePaymentsApi.update(editingPayment.id, {
          paymentDate: payForm.paymentDate,
          amount: Number(payForm.amount),
          paymentMethod: payForm.paymentMethod,
          referenceId: payForm.referenceId,
          notes: payForm.notes,
        });
        notify('success', 'Purchase payment updated');
      } else {
        await purchasePaymentsApi.record({
          purchaseId: purchase.id,
          paymentDate: payForm.paymentDate,
          amount: Number(payForm.amount),
          paymentMethod: payForm.paymentMethod,
          referenceId: payForm.referenceId,
          notes: payForm.notes,
          allowAdvance: payForm.allowAdvance,
        });
        notify('success', `Payment recorded for ${purchase.billNumber}`);
      }
      setPayModalOpen(false);
      await load(true);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save payment');
    } finally {
      setSavingPay(false);
    }
  };

  const handleConfirmDeletePayment = async () => {
    if (!deleteTargetPayment) return;
    setDeletingPayment(true);
    try {
      await purchasePaymentsApi.remove(deleteTargetPayment.id);
      notify('success', `Payment ${deleteTargetPayment.paymentNumber} deleted`);
      setDeleteTargetPayment(null);
      await load(true);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete payment');
    } finally {
      setDeletingPayment(false);
    }
  };

  const handleConfirmDeleteBill = async () => {
    if (!purchase) return;
    setDeletingBill(true);
    try {
      await purchasesApi.remove(purchase.id);
      notify('success', `Purchase bill ${purchase.billNumber} deleted`);
      navigate('/purchases');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete purchase bill');
      setDeletingBill(false);
    }
  };

  if (loading && !purchase) {
    return (
      <div className="py-12 text-center text-sm text-zinc-500">
        Loading purchase bill details...
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate('/purchases')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Purchases
        </Button>
        <Card className="p-8 text-center text-sm text-zinc-500">
          Purchase bill not found or has been deleted.
        </Card>
      </div>
    );
  }

  const sup = purchase.supplierSnapshot;
  const attachmentUrl = attachment?.downloadUrl || purchase.attachmentMeta?.downloadUrl || '';
  const attachmentMime = attachment?.mimeType || purchase.attachmentMeta?.mimeType || '';
  const attachmentName = attachment?.fileName || purchase.attachmentMeta?.fileName || 'Bill Scan';
  const exceedsBalance =
    !editingPayment && Number(payForm.amount) > Number(purchase.balanceDue || 0);

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/purchases')}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {purchase.billNumber}
              </h2>
              <PurchaseStatusLabel status={purchase.status} />
              {purchase.ocrUsed ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#E65100] dark:text-orange-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  PaddleOCR Verified
                </span>
              ) : null}
            </div>
            <p className="text-xs text-zinc-500">
              {sup.companyName || sup.name} · Bill Date {formatDate(purchase.billDate)} · Due{' '}
              {formatDate(purchase.dueDate)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {purchase.status !== 'draft' ? (
            <Button size="sm" onClick={openRecordPayment}>
              <CreditCard className="h-4 w-4" />
              Record Payment
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => generatePurchasePdf(purchase, profile)}
          >
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/purchases/${purchase.id}/edit`)}
          >
            <Edit2 className="h-4 w-4" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600"
            onClick={() => setDeleteBillOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* OCR Warnings Banner */}
      {purchase.ocrUsed && purchase.ocrWarnings && purchase.ocrWarnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 space-y-1">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            OCR Extraction Notes Recorded at Entry
          </div>
          <ul className="list-disc pl-5 space-y-0.5">
            {purchase.ocrWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Summary Cards: Supplier + Bill Metadata + Settlement Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Supplier Details</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1.5 text-zinc-600 dark:text-zinc-300">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {sup.companyName || sup.name}
            </div>
            {sup.companyName && sup.name !== sup.companyName ? <div>Attn: {sup.name}</div> : null}
            {sup.gstin ? (
              <div className="font-mono text-zinc-800 dark:text-zinc-200">GSTIN: {sup.gstin}</div>
            ) : (
              <div className="text-zinc-400">Unregistered / Non-GST Supplier</div>
            )}
            {sup.billingAddress ? <div>{sup.billingAddress}</div> : null}
            <div>
              State: {sup.state} ({sup.stateCode})
            </div>
            {sup.phone || sup.email ? (
              <div>{[sup.phone, sup.email].filter(Boolean).join(' · ')}</div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Bill &amp; Tax Regime</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1.5 text-zinc-600 dark:text-zinc-300">
            <div className="flex justify-between">
              <span className="text-zinc-500">Purchase Type</span>
              <span className="font-medium capitalize">{purchase.purchaseType.replace('_', ' ')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Place of Supply</span>
              <span className="font-medium">{purchase.placeOfSupply}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">GST Split</span>
              <span className="font-medium">
                {purchase.isGst
                  ? purchase.isInterState
                    ? 'Inter-State (IGST)'
                    : 'Intra-State (CGST + SGST)'
                  : 'No GST Applied'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Payment Terms</span>
              <span>{purchase.paymentTerms || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Reference / PO #</span>
              <span className="font-mono">{purchase.referenceNumber || '—'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Payable Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Grand Total</span>
              <span className="font-mono font-bold text-sm text-zinc-900 dark:text-zinc-100">
                {formatINR(purchase.grandTotal)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Amount Paid</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {formatINR(purchase.amountPaid)}
              </span>
            </div>
            <div className="flex justify-between border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                Remaining Balance
              </span>
              <span className="font-mono font-bold text-base text-[#F57C00]">
                {formatINR(purchase.balanceDue)}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500 pt-1">{purchase.amountInWords}</div>
          </CardContent>
        </Card>
      </div>

      {/* Itemized Purchase Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Itemized Purchase Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mobile Item Cards */}
          <div className="md:hidden space-y-2.5">
            {purchase.items.map((item, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-zinc-200 p-3 text-xs space-y-1 dark:border-zinc-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {idx + 1}. {item.name}
                    </div>
                    {item.description ? (
                      <div className="text-zinc-500">{item.description}</div>
                    ) : null}
                    {item.hsnSac ? (
                      <div className="font-mono text-[11px] text-zinc-500">HSN: {item.hsnSac}</div>
                    ) : null}
                  </div>
                  <div className="font-mono font-bold text-right">
                    {formatINR(item.totalAmount)}
                  </div>
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-[11px] text-zinc-500 font-mono pt-1">
                  <span>
                    {item.quantity} {item.unit} × {formatINR(item.rate)}
                  </span>
                  {purchase.isGst ? <span>GST {item.taxRate}% ({formatINR(item.taxAmount)})</span> : null}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Item Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item &amp; Description</TableHead>
                  <TableHead>HSN/SAC</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  {purchase.isGst ? (
                    purchase.isInterState ? (
                      <TableHead className="text-right">IGST</TableHead>
                    ) : (
                      <>
                        <TableHead className="text-right">CGST</TableHead>
                        <TableHead className="text-right">SGST</TableHead>
                      </>
                    )
                  ) : null}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.items.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs text-zinc-500">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {item.name}
                      </div>
                      {item.description ? (
                        <div className="text-xs text-zinc-500">{item.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.hsnSac || '—'}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {item.quantity} {item.unit}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(item.rate)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(item.discountAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(item.taxableAmount)}
                    </TableCell>
                    {purchase.isGst ? (
                      purchase.isInterState ? (
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINR(item.igstAmount)} ({item.taxRate}%)
                        </TableCell>
                      ) : (
                        <>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatINR(item.cgstAmount)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatINR(item.sgstAmount)}
                          </TableCell>
                        </>
                      )
                    ) : null}
                    <TableCell className="text-right font-mono tabular-nums font-semibold">
                      {formatINR(item.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Totals Summary Footer */}
          <div className="flex flex-col md:flex-row justify-between gap-6 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex-1 text-xs text-zinc-500 space-y-1">
              {purchase.notes ? (
                <>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-300">Notes</div>
                  <p className="whitespace-pre-wrap">{purchase.notes}</p>
                </>
              ) : null}
            </div>

            <div className="w-full md:w-80 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Subtotal</span>
                <span className="font-mono tabular-nums">{formatINR(purchase.subtotal)}</span>
              </div>
              {purchase.totalDiscount > 0 ? (
                <div className="flex justify-between text-emerald-600">
                  <span>Total Discount</span>
                  <span className="font-mono tabular-nums">-{formatINR(purchase.totalDiscount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-zinc-500">Taxable Value</span>
                <span className="font-mono tabular-nums">{formatINR(purchase.taxableAmount)}</span>
              </div>
              {purchase.isGst ? (
                purchase.isInterState ? (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">IGST</span>
                    <span className="font-mono tabular-nums">{formatINR(purchase.igstTotal)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">CGST</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(purchase.cgstTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">SGST</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(purchase.sgstTotal)}
                      </span>
                    </div>
                  </>
                )
              ) : null}
              {purchase.additionalCharges > 0 ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Additional Charges</span>
                  <span className="font-mono tabular-nums">
                    {formatINR(purchase.additionalCharges)}
                  </span>
                </div>
              ) : null}
              {purchase.roundOff !== 0 ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Round Off</span>
                  <span className="font-mono tabular-nums">{formatINR(purchase.roundOff)}</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-zinc-200 pt-2 text-sm font-bold dark:border-zinc-800">
                <span>Grand Total</span>
                <span className="font-mono tabular-nums text-[#F57C00]">
                  {formatINR(purchase.grandTotal)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Ledger */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Purchase Payment Ledger</CardTitle>
            <CardDescription>
              Multiple partial or full payments settled against bill {purchase.billNumber}
            </CardDescription>
          </div>
          {purchase.status !== 'draft' ? (
            <Button size="sm" variant="outline" onClick={openRecordPayment}>
              <Plus className="h-3.5 w-3.5" />
              Add Payment
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
              No supplier payments recorded against this bill yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((pay) => (
                  <TableRow key={pay.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {pay.paymentNumber}
                      {pay.isAdvance ? (
                        <span className="ml-1.5 text-[10px] font-normal text-amber-600">
                          (Advance)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{formatDate(pay.paymentDate)}</TableCell>
                    <TableCell className="text-xs">{pay.paymentMethod}</TableCell>
                    <TableCell className="font-mono text-xs">{pay.referenceId || '—'}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{pay.notes || '—'}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatINR(pay.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditPayment(pay)}
                          className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 cursor-pointer"
                          title="Edit payment"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTargetPayment(pay)}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 cursor-pointer"
                          title="Delete payment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Scanned Original Attachment Viewer */}
      {attachmentUrl ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              {attachmentMime.includes('pdf') ? (
                <FileText className="h-4 w-4 text-[#F57C00]" />
              ) : (
                <ImageIcon className="h-4 w-4 text-[#F57C00]" />
              )}
              <div>
                <CardTitle>Original Supplier Bill Attachment</CardTitle>
                <CardDescription>{attachmentName}</CardDescription>
              </div>
            </div>
            <a
              href={attachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open / Download
            </a>
          </CardHeader>
          <CardContent>
            {attachmentMime.startsWith('image/') ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950 flex justify-center">
                <img
                  src={attachmentUrl}
                  alt={attachmentName}
                  className="max-h-[520px] w-auto object-contain rounded"
                />
              </div>
            ) : (
              <iframe
                src={attachmentUrl}
                title={attachmentName}
                className="w-full h-[520px] rounded-lg border border-zinc-200 dark:border-zinc-800"
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Record / Edit Payment Modal */}
      <Dialog
        open={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        title={editingPayment ? 'Edit Purchase Payment' : 'Record Purchase Payment'}
        description={`Bill ${purchase.billNumber} · Remaining Balance: ${formatINR(
          purchase.balanceDue
        )}`}
      >
        <form onSubmit={handleSubmitPayment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Payment Date *</Label>
              <Input
                type="date"
                required
                value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="font-mono"
              />
            </div>
          </div>

          {exceedsBalance ? (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={payForm.allowAdvance}
                onChange={(e) => setPayForm({ ...payForm, allowAdvance: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-[#F57C00]"
              />
              <span>
                Entered amount exceeds remaining bill balance ({formatINR(purchase.balanceDue)}).
                Confirm recording this as a supplier advance / overpayment.
              </span>
            </label>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Payment Method *</Label>
              <Select
                value={payForm.paymentMethod}
                onChange={(e) =>
                  setPayForm({ ...payForm, paymentMethod: e.target.value as PaymentMethod })
                }
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Transaction Reference / UTR</Label>
              <Input
                value={payForm.referenceId}
                onChange={(e) => setPayForm({ ...payForm, referenceId: e.target.value })}
                placeholder="UTR / Cheque # / Ref ID"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={payForm.notes}
              onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              placeholder="Optional payment note"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setPayModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={savingPay || (exceedsBalance && !payForm.allowAdvance)}
            >
              {savingPay
                ? 'Saving...'
                : editingPayment
                  ? 'Save Payment Changes'
                  : 'Record Payment'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete Payment Confirmation Modal */}
      <Dialog
        open={Boolean(deleteTargetPayment)}
        onClose={() => setDeleteTargetPayment(null)}
        title="Delete Payment Entry"
        description="Removing this payment will recalculate the remaining payable balance on this purchase bill."
      >
        {deleteTargetPayment ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              Delete payment voucher{' '}
              <strong className="font-mono">{deleteTargetPayment.paymentNumber}</strong> of{' '}
              <strong>{formatINR(deleteTargetPayment.amount)}</strong>?
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTargetPayment(null)}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={deletingPayment}
                onClick={handleConfirmDeletePayment}
              >
                {deletingPayment ? 'Deleting...' : 'Delete Payment'}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Delete Bill Confirmation Modal */}
      <Dialog
        open={deleteBillOpen}
        onClose={() => setDeleteBillOpen(false)}
        title="Delete Purchase Bill"
        description="Permanently delete this purchase bill, linked payments, and attachment."
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            Delete purchase bill <strong className="font-mono">{purchase.billNumber}</strong> (
            {formatINR(purchase.grandTotal)})?
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteBillOpen(false)}>
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
      </Dialog>
    </div>
  );
}
