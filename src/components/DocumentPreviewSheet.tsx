import * as React from 'react';
import QRCode from 'qrcode';
import { Building2 } from 'lucide-react';
import { buildUpiPaymentUri, formatINR } from '../shared/gstCalculator';
import type { Invoice, Quotation, TemplateId } from '../shared/types';
import { formatDate } from '../lib/utils';

interface DocumentPreviewSheetProps {
  docType: 'invoice' | 'quotation';
  record: Invoice | Quotation;
  templateOverride?: TemplateId;
  a4Ratio?: boolean;
}

export function DocumentPreviewSheet({
  docType,
  record,
  templateOverride,
  a4Ratio = false,
}: DocumentPreviewSheetProps) {
  const [qrUrl, setQrUrl] = React.useState<string>('');
  const templateId = templateOverride || record.templateId || 'classic_gst';
  const biz = record.businessSnapshot;
  const cust = record.customerSnapshot;
  const inv = docType === 'invoice' ? (record as Invoice) : null;
  const quo = docType === 'quotation' ? (record as Quotation) : null;
  const docNumber = inv ? inv.invoiceNumber : quo!.quotationNumber;
  const docTitle =
    docType === 'invoice' ? (record.isGst ? 'TAX INVOICE' : 'BILL OF SUPPLY') : 'QUOTATION';
  const qrAmount = inv
    ? inv.balanceDue > 0
      ? inv.balanceDue
      : inv.grandTotal
    : record.grandTotal;
  const cleanUpiId = (biz.upiId || '').trim();

  React.useEffect(() => {
    let active = true;
    if (cleanUpiId) {
      const upiUri = buildUpiPaymentUri({
        upiId: cleanUpiId,
        payeeName: biz.businessName,
        amount: qrAmount,
        docNumber,
      });
      QRCode.toDataURL(upiUri, { margin: 1, width: 140 })
        .then((url) => {
          if (active) setQrUrl(url);
        })
        .catch(() => {
          if (active) setQrUrl('');
        });
      return () => {
        active = false;
      };
    }

    if (biz.upiQrDataUrl) {
      setQrUrl(biz.upiQrDataUrl);
      return;
    }

    setQrUrl('');
    return () => {
      active = false;
    };
  }, [cleanUpiId, biz.upiQrDataUrl, biz.businessName, qrAmount, docNumber]);

  const isClassic = templateId === 'classic_gst';
  const isCompact = templateId === 'compact_commercial';

  return (
    <div
      className={`print-only-sheet mx-auto bg-white text-zinc-900 shadow-sm overflow-hidden ${
        a4Ratio
          ? 'w-[794px] min-h-[1123px] max-w-none rounded-md border border-zinc-200 flex flex-col'
          : 'w-full max-w-[820px] rounded-xl border border-zinc-200'
      }`}
    >
      {isClassic ? <div className="h-1.5 w-full bg-[#F57C00] shrink-0" /> : null}

      <div
        className={`${
          a4Ratio ? (isCompact ? 'p-6' : 'p-8 md:p-10') : isCompact ? 'p-4 sm:p-6' : 'p-4 sm:p-8 md:p-10'
        } ${a4Ratio ? 'flex-1 flex flex-col justify-between' : ''}`}
      >
        <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 pb-6 border-b border-zinc-200">
          <div className="flex items-start gap-4">
            {biz.logoDataUrl ? (
              <img
                src={biz.logoDataUrl}
                alt={`${biz.businessName} logo`}
                referrerPolicy="no-referrer"
                className="h-14 w-auto max-w-[132px] rounded-lg object-contain border border-zinc-200 bg-white p-1 shrink-0"
              />
            ) : (
              <div className="h-14 w-14 rounded-lg border border-zinc-200 bg-zinc-50 flex items-center justify-center shrink-0">
                <Building2 className="h-6 w-6 text-zinc-400" />
              </div>
            )}
            <div className="space-y-1">
              <h2 className="text-lg font-bold tracking-tight text-zinc-900">
                {biz.businessName}
              </h2>
              {biz.address ? (
                <p className="text-xs text-zinc-600 max-w-sm leading-relaxed">{biz.address}</p>
              ) : null}
              <p className="text-xs text-zinc-600">
                {[biz.phone, biz.email].filter(Boolean).join(' · ')}
              </p>
              <p className="text-xs font-mono text-zinc-700">
                {biz.gstin ? `GSTIN: ${biz.gstin} · ` : ''}
                State: {biz.state}
              </p>
            </div>
          </div>

          <div className="sm:text-right space-y-1">
            <div
              className={`text-xl font-bold tracking-tight ${
                isClassic ? 'text-[#F57C00]' : 'text-zinc-900'
              }`}
            >
              {docTitle}
            </div>
            <div className="text-sm font-mono font-semibold text-zinc-900">{docNumber}</div>
            {inv ? (
              <div className="text-xs text-zinc-600 space-y-0.5 tabular-nums">
                <div>Invoice Date: {formatDate(inv.invoiceDate)}</div>
                <div>Due Date: {formatDate(inv.dueDate)}</div>
                <div>Status: {inv.status.replace('_', ' ').toUpperCase()}</div>
              </div>
            ) : quo ? (
              <div className="text-xs text-zinc-600 space-y-0.5 tabular-nums">
                <div>Quotation Date: {formatDate(quo.quotationDate)}</div>
                <div>Valid Until: {formatDate(quo.validUntil)}</div>
                <div>Status: {quo.status.toUpperCase()}</div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Parties & Supply Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-5 border-b border-zinc-200">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold tracking-wide text-zinc-500">Bill To</div>
            <div className="text-sm font-semibold text-zinc-900">
              {cust.companyName || cust.name}
            </div>
            {cust.companyName && cust.name ? (
              <div className="text-xs text-zinc-600">Attn: {cust.name}</div>
            ) : null}
            {cust.billingAddress ? (
              <div className="text-xs text-zinc-600 leading-relaxed">{cust.billingAddress}</div>
            ) : null}
            <div className="text-xs text-zinc-600">
              {[cust.phone, cust.email].filter(Boolean).join(' · ')}
            </div>
            {cust.gstin ? (
              <div className="text-xs font-mono text-zinc-700">GSTIN: {cust.gstin}</div>
            ) : null}
          </div>

          <div className="space-y-1 sm:text-right">
            <div className="text-[11px] font-semibold tracking-wide text-zinc-500">
              Supply & Reference
            </div>
            <div className="text-xs text-zinc-700">
              Place of Supply: <span className="font-medium">{record.placeOfSupply || cust.state}</span>
            </div>
            {record.isGst ? (
              <div className="text-xs text-zinc-700">
                Tax Regime:{' '}
                <span className="font-medium">
                  {record.isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}
                </span>{' '}
                · {record.taxMode === 'inclusive' ? 'GST Inclusive' : 'GST Exclusive'}
              </div>
            ) : (
              <div className="text-xs text-zinc-700">Non-GST Document</div>
            )}
            {record.referenceNumber ? (
              <div className="text-xs text-zinc-700 font-mono">
                Reference: {record.referenceNumber}
              </div>
            ) : null}
            {inv?.paymentTerms ? (
              <div className="text-xs text-zinc-700">Payment Terms: {inv.paymentTerms}</div>
            ) : null}
          </div>
        </div>

        {/* Itemized Table */}
        <div className="py-5 overflow-x-auto">
          <table className="w-full min-w-[540px] border-collapse text-xs">
            <thead>
              <tr
                className={
                  isClassic
                    ? 'bg-[#F57C00] text-white'
                    : 'bg-zinc-900 text-white'
                }
              >
                <th className="px-2.5 py-2 text-center font-medium w-8">#</th>
                <th className="px-2.5 py-2 text-left font-medium">Item & Description</th>
                {record.isGst ? (
                  <th className="px-2.5 py-2 text-center font-medium">HSN/SAC</th>
                ) : null}
                <th className="px-2.5 py-2 text-right font-medium">Qty</th>
                <th className="px-2.5 py-2 text-right font-medium">Rate</th>
                <th className="px-2.5 py-2 text-right font-medium">Disc.</th>
                {record.isGst ? (
                  <>
                    <th className="px-2.5 py-2 text-right font-medium">Taxable</th>
                    <th className="px-2.5 py-2 text-right font-medium">GST</th>
                  </>
                ) : null}
                <th className="px-2.5 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 border-b border-zinc-200">
              {record.items.map((item, idx) => (
                <tr key={item.id || idx} className={isCompact ? 'leading-tight' : ''}>
                  <td className="px-2.5 py-2 text-center text-zinc-500 font-mono">{idx + 1}</td>
                  <td className="px-2.5 py-2">
                    <div className="font-medium text-zinc-900">{item.name}</div>
                    {item.description ? (
                      <div className="text-[11px] text-zinc-500 mt-0.5">{item.description}</div>
                    ) : null}
                  </td>
                  {record.isGst ? (
                    <td className="px-2.5 py-2 text-center font-mono text-zinc-600">
                      {item.hsnSac || '—'}
                    </td>
                  ) : null}
                  <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                    {formatINR(item.rate)}
                  </td>
                  <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap text-zinc-600">
                    {item.discountAmount > 0 ? formatINR(item.discountAmount) : '—'}
                  </td>
                  {record.isGst ? (
                    <>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatINR(item.taxableAmount)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <div>{item.taxRate}%</div>
                        <div className="text-[10px] text-zinc-500">{formatINR(item.taxAmount)}</div>
                      </td>
                    </>
                  ) : null}
                  <td className="px-2.5 py-2 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                    {formatINR(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary & Payment Details */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-2 pb-6 border-b border-zinc-200">
          <div className="md:col-span-7 space-y-4">
            <div>
              <div className="text-[11px] font-semibold text-zinc-500">Amount in Words</div>
              <div className="text-xs font-medium text-zinc-900 mt-0.5">{record.amountInWords}</div>
            </div>

            {(biz.bankName || cleanUpiId || qrUrl) && (
              <div className="flex items-start gap-4 pt-1">
                {qrUrl ? (
                  <div className="shrink-0 text-center">
                    <img
                      src={qrUrl}
                      alt="UPI Payment QR Code"
                      referrerPolicy="no-referrer"
                      className="h-22 w-22 rounded border border-zinc-200 p-1 bg-white mx-auto"
                    />
                    <div className="text-[10px] font-medium text-zinc-600 mt-1">
                      Scan to Pay{qrAmount > 0 ? ` · ${formatINR(qrAmount)}` : ''}
                    </div>
                  </div>
                ) : null}
                <div className="text-xs text-zinc-600 space-y-0.5">
                  <div className="text-[11px] font-semibold text-zinc-500">Bank & UPI Details</div>
                  {biz.bankName ? <div>Bank: {biz.bankName}</div> : null}
                  {biz.accountNumber ? (
                    <div className="font-mono">
                      A/C: {biz.accountNumber} · IFSC: {biz.ifsc}
                    </div>
                  ) : null}
                  {cleanUpiId ? (
                    <div className="font-mono text-zinc-800">UPI ID: {cleanUpiId}</div>
                  ) : null}
                  {cleanUpiId && qrAmount > 0 ? (
                    <div className="text-[11px] text-zinc-500">
                      Payable via UPI: <span className="font-mono font-medium text-zinc-800">{formatINR(qrAmount)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="md:col-span-5 space-y-2 text-xs">
            <div className="flex justify-between text-zinc-600">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{formatINR(record.subtotal)}</span>
            </div>
            {record.totalDiscount > 0 ? (
              <div className="flex justify-between text-zinc-600">
                <span>Discount</span>
                <span className="font-mono tabular-nums">-{formatINR(record.totalDiscount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-zinc-700">
              <span>Taxable Value</span>
              <span className="font-mono tabular-nums">{formatINR(record.taxableAmount)}</span>
            </div>
            {record.isGst ? (
              record.isInterState ? (
                <div className="flex justify-between text-zinc-600">
                  <span>IGST</span>
                  <span className="font-mono tabular-nums">{formatINR(record.igstTotal)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-zinc-600">
                    <span>CGST</span>
                    <span className="font-mono tabular-nums">{formatINR(record.cgstTotal)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-600">
                    <span>SGST</span>
                    <span className="font-mono tabular-nums">{formatINR(record.sgstTotal)}</span>
                  </div>
                </>
              )
            ) : null}
            {record.roundOff !== 0 ? (
              <div className="flex justify-between text-zinc-600">
                <span>Round Off</span>
                <span className="font-mono tabular-nums">{formatINR(record.roundOff)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-zinc-200 pt-2 text-sm font-bold text-zinc-900">
              <span>Grand Total</span>
              <span className="font-mono tabular-nums">{formatINR(record.grandTotal)}</span>
            </div>
            {inv && inv.amountPaid > 0 ? (
              <>
                <div className="flex justify-between text-emerald-700">
                  <span>Amount Paid</span>
                  <span className="font-mono tabular-nums">{formatINR(inv.amountPaid)}</span>
                </div>
                <div className="flex justify-between font-semibold text-zinc-900">
                  <span>Balance Due</span>
                  <span className="font-mono tabular-nums">{formatINR(inv.balanceDue)}</span>
                </div>
              </>
            ) : null}
          </div>
        </div>
        </div>

        {/* Footer Terms & Signatory */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 pt-6 items-end">
          <div className="sm:col-span-8 space-y-2">
            {record.notes ? (
              <div>
                <div className="text-[11px] font-semibold text-zinc-500">Notes</div>
                <p className="text-xs text-zinc-600 whitespace-pre-line">{record.notes}</p>
              </div>
            ) : null}
            {record.terms ? (
              <div>
                <div className="text-[11px] font-semibold text-zinc-500">Terms & Conditions</div>
                <p className="text-[11px] text-zinc-500 whitespace-pre-line leading-relaxed">
                  {record.terms}
                </p>
              </div>
            ) : null}
          </div>

          <div className="sm:col-span-4 text-right pt-8">
            <div className="border-t border-zinc-300 pt-2 text-xs font-semibold text-zinc-800">
              {biz.signatureLabel || 'Authorized Signatory'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
