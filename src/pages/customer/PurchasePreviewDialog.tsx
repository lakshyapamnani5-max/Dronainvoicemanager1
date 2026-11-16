import { Download } from 'lucide-react';
import { formatINR } from '../../shared/gstCalculator';
import type { BusinessProfile, Purchase } from '../../shared/types';
import { formatDate } from '../../lib/utils';
import { generatePurchasePdf } from '../../lib/pdfGenerator';
import { PurchaseStatusLabel } from '../../components/StatusText';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';

export function PurchasePreviewDialog({
  open,
  onClose,
  purchase,
  businessProfile,
}: {
  open: boolean;
  onClose: () => void;
  purchase: Purchase | null;
  businessProfile?: BusinessProfile | null;
}) {
  if (!purchase) return null;
  const sup = purchase.supplierSnapshot;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Purchase Preview · ${purchase.billNumber || 'Draft'}`}
      description="Review supplier details, GST allocation, line items, and totals."
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[#F57C00]">
                Purchase Voucher · {purchase.purchaseType.replace('_', ' ').toUpperCase()}
              </div>
              <div className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {purchase.billNumber || 'UNNUMBERED'}
              </div>
              {purchase.referenceNumber ? (
                <div className="text-xs text-zinc-500">PO / Ref: {purchase.referenceNumber}</div>
              ) : null}
            </div>
            <div className="text-right space-y-1">
              <PurchaseStatusLabel status={purchase.status} />
              <div className="text-xs text-zinc-500">
                Bill Date: <span className="font-mono text-zinc-800 dark:text-zinc-200">{formatDate(purchase.billDate)}</span>
              </div>
              <div className="text-xs text-zinc-500">
                Due Date: <span className="font-mono text-zinc-800 dark:text-zinc-200">{formatDate(purchase.dueDate)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="rounded-lg bg-zinc-50 p-3.5 dark:bg-zinc-900">
              <div className="font-semibold text-zinc-500 uppercase tracking-wide text-[11px]">
                Supplier (From)
              </div>
              <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {sup.companyName || sup.name}
              </div>
              {sup.companyName && sup.name ? <div className="text-zinc-600 dark:text-zinc-400">{sup.name}</div> : null}
              {sup.gstin ? <div className="font-mono mt-0.5 text-zinc-700 dark:text-zinc-300">GSTIN: {sup.gstin}</div> : null}
              {sup.billingAddress ? <div className="mt-1 text-zinc-500">{sup.billingAddress}</div> : null}
              <div className="mt-1 text-zinc-500">
                State: {sup.state} {sup.stateCode ? `(${sup.stateCode})` : ''}
              </div>
            </div>

            <div className="rounded-lg bg-zinc-50 p-3.5 dark:bg-zinc-900">
              <div className="font-semibold text-zinc-500 uppercase tracking-wide text-[11px]">
                Recipient (Your Business)
              </div>
              <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {businessProfile?.businessName || 'Your Business'}
              </div>
              {businessProfile?.gstin ? (
                <div className="font-mono mt-0.5 text-zinc-700 dark:text-zinc-300">
                  GSTIN: {businessProfile.gstin}
                </div>
              ) : null}
              <div className="mt-1 text-zinc-500">
                Place of Supply: {purchase.placeOfSupply || businessProfile?.state || '—'}
              </div>
              <div className="mt-0.5 text-zinc-500">
                Tax Regime:{' '}
                {!purchase.isGst
                  ? 'Non-GST / 0% GST'
                  : purchase.isInterState
                    ? 'Inter-State (IGST)'
                    : 'Intra-State (CGST + SGST)'}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">HSN/SAC</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Disc.</th>
                  <th className="px-3 py-2 text-right">Taxable</th>
                  {purchase.isGst ? <th className="px-3 py-2 text-right">GST</th> : null}
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {purchase.items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2 text-zinc-500">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{it.name}</div>
                      {it.description ? <div className="text-[11px] text-zinc-500">{it.description}</div> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-500">{it.hsnSac || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {it.quantity} {it.unit}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatINR(it.rate)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {it.discountAmount > 0 ? formatINR(it.discountAmount) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatINR(it.taxableAmount)}
                    </td>
                    {purchase.isGst ? (
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {it.taxRate}% ({formatINR(it.taxAmount)})
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {formatINR(it.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div className="text-xs text-zinc-500 space-y-2">
              <div>
                <div className="font-semibold text-zinc-700 dark:text-zinc-300">Amount in Words</div>
                <div>{purchase.amountInWords}</div>
              </div>
              {purchase.notes ? (
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-300">Notes</div>
                  <div>{purchase.notes}</div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg bg-zinc-50 p-3.5 text-xs space-y-1.5 dark:bg-zinc-900">
              <div className="flex justify-between">
                <span className="text-zinc-500">Subtotal</span>
                <span className="font-mono tabular-nums">{formatINR(purchase.subtotal)}</span>
              </div>
              {purchase.totalDiscount > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
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
                      <span className="font-mono tabular-nums">{formatINR(purchase.cgstTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">SGST</span>
                      <span className="font-mono tabular-nums">{formatINR(purchase.sgstTotal)}</span>
                    </div>
                  </>
                )
              ) : null}
              {purchase.additionalCharges > 0 ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Additional Charges</span>
                  <span className="font-mono tabular-nums">{formatINR(purchase.additionalCharges)}</span>
                </div>
              ) : null}
              {purchase.roundOff !== 0 ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Round Off</span>
                  <span className="font-mono tabular-nums">{formatINR(purchase.roundOff)}</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-zinc-200 pt-1.5 text-sm font-bold dark:border-zinc-700">
                <span>Grand Total</span>
                <span className="font-mono tabular-nums text-[#F57C00]">{formatINR(purchase.grandTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Amount Paid</span>
                <span className="font-mono tabular-nums">{formatINR(purchase.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-zinc-700 dark:text-zinc-300">Outstanding Payable</span>
                <span className="font-mono tabular-nums">{formatINR(purchase.balanceDue)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => generatePurchasePdf(purchase, businessProfile)}>
            <Download className="h-4 w-4" />
            Download Purchase PDF
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
