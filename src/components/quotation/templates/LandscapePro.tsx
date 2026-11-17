import * as React from 'react';
import type { QuotationTemplateProps } from '../quotationThemeTypes';
import { useQuotationData } from '../quotationCommon';

/**
 * Theme 6 - Landscape Pro
 * Genuine A4 Landscape (297 x 210 mm -> 1123 x 794 px) layout with compact 3-column header,
 * expansive multi-column quotation table, aligned totals, and 3-column footer.
 */
export function LandscapePro({
  record,
  a4Ratio = false,
  className = '',
}: QuotationTemplateProps) {
  const d = useQuotationData(record);
  const { biz, cust } = d;

  return (
    <div
      className={`print-sheet bg-white text-slate-900 font-sans ${
        a4Ratio
          ? 'w-[1123px] min-h-[794px] max-w-none flex flex-col justify-between p-7'
          : 'w-full max-w-[1123px] mx-auto p-5 sm:p-7'
      } border border-slate-300 ${className}`}
    >
      <div className="space-y-4">
        {/* Compact 3-Column Landscape Header */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-4 border-b-2 border-slate-800 items-start text-xs">
          {/* Column 1: Business Identity */}
          <div className="md:col-span-5 flex items-start gap-3">
            {biz.logoDataUrl ? (
              <img
                src={biz.logoDataUrl}
                alt="Logo"
                className="h-14 w-auto max-w-[110px] object-contain border border-slate-200 p-1 rounded shrink-0"
              />
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-base font-extrabold text-slate-900 leading-snug">
                {biz.businessName}
              </h2>
              {biz.address ? (
                <p className="text-[11px] text-slate-600 leading-snug whitespace-pre-line">
                  {biz.address}
                </p>
              ) : null}
              <p className="text-[11px] text-slate-600">
                {[biz.phone, biz.email].filter(Boolean).join(' · ')}
              </p>
              {biz.gstin ? (
                <p className="text-[10.5px] font-mono text-slate-700">GSTIN: {biz.gstin}</p>
              ) : null}
            </div>
          </div>

          {/* Column 2: Prepared For (Client) */}
          <div className="md:col-span-4 rounded bg-slate-50 border border-slate-200 p-3 space-y-0.5">
            <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500 block">
              Prepared For
            </span>
            <p className="font-bold text-sm text-slate-900">{cust.companyName || cust.name}</p>
            {cust.companyName && cust.name ? (
              <p className="text-[11px] text-slate-600">Attn: {cust.name}</p>
            ) : null}
            {cust.billingAddress ? (
              <p className="text-[10.5px] text-slate-600 leading-snug line-clamp-2">
                {cust.billingAddress}
              </p>
            ) : null}
            <p className="text-[10.5px] text-slate-600">
              {[cust.phone, cust.gstin ? `GSTIN: ${cust.gstin}` : '']
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          {/* Column 3: Quotation Metadata */}
          <div className="md:col-span-3 text-right space-y-1">
            <div className="inline-block bg-slate-900 text-white px-3 py-1 rounded-sm">
              <h1 className="text-sm font-bold uppercase tracking-wider">{d.quotationTitle}</h1>
            </div>
            <p className="font-mono text-sm font-bold text-slate-900 pt-0.5">
              {d.quotationNumber}
            </p>
            <div className="text-[11px] text-slate-600 space-y-0.5">
              <p>
                Issued: <span className="font-mono text-slate-900">{d.quotationDate}</span>
              </p>
              {d.validUntil ? (
                <p>
                  Valid Until:{' '}
                  <span className="font-mono font-semibold text-amber-700">{d.validUntil}</span>
                </p>
              ) : null}
              {d.deliveryTimeline ? <p>Delivery: {d.deliveryTimeline}</p> : null}
              {d.preparedBy ? <p>Prepared By: {d.preparedBy}</p> : null}
            </div>
          </div>
        </div>

        {/* Optional Project Brief Bar */}
        {d.projectDescription ? (
          <div className="rounded bg-slate-50 border border-slate-200 px-3.5 py-2 text-[11px] text-slate-700">
            <strong className="uppercase tracking-wider text-[10px] text-slate-900 mr-2">
              Project Overview:
            </strong>
            <span>{d.projectDescription}</span>
          </div>
        ) : null}

        {/* Wide Landscape Quotation Table */}
        <div className="border border-slate-300 rounded-sm overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white text-[10.5px] uppercase tracking-wider">
                <th className="py-2 px-2.5 w-10 text-center">#</th>
                <th className="py-2 px-3 w-52">Item / Service</th>
                <th className="py-2 px-3">Detailed Specification</th>
                {d.isGst ? <th className="py-2 px-2 w-20 text-center">HSN/SAC</th> : null}
                <th className="py-2 px-2 w-20 text-right">Qty</th>
                <th className="py-2 px-2.5 w-24 text-right">Unit Rate</th>
                {d.totalDiscount > 0 ? (
                  <th className="py-2 px-2 w-20 text-right">Discount</th>
                ) : null}
                <th className="py-2 px-2.5 w-24 text-right">Est. Taxable</th>
                {d.isGst ? (
                  <th className="py-2 px-2 w-24 text-right">Est. GST</th>
                ) : null}
                <th className="py-2 px-3 w-28 text-right">Est. Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {d.items.map((item, idx) => (
                <tr key={idx} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                  <td className="py-2 px-2.5 text-center font-mono text-slate-500">{idx + 1}</td>
                  <td className="py-2 px-3 font-semibold text-slate-900">{item.name}</td>
                  <td className="py-2 px-3 text-[11px] text-slate-600 whitespace-pre-line">
                    {item.description || '-'}
                  </td>
                  {d.isGst ? (
                    <td className="py-2 px-2 text-center font-mono text-[11px] text-slate-600">
                      {item.hsnSac || '-'}
                    </td>
                  ) : null}
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-800">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-800">
                    {d.formatINR(item.rate)}
                  </td>
                  {d.totalDiscount > 0 ? (
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600">
                      {item.discountAmount > 0 ? `-${d.formatINR(item.discountAmount)}` : '-'}
                    </td>
                  ) : null}
                  <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700">
                    {d.formatINR(item.taxableAmount)}
                  </td>
                  {d.isGst ? (
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-[11px] text-slate-600">
                      {d.formatINR(item.taxAmount)} ({item.taxRate}%)
                    </td>
                  ) : null}
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-950">
                    {d.formatINR(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3-Column Landscape Footer */}
      <div className="mt-5 pt-4 border-t border-slate-300 grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch text-xs">
        {/* Col 1: Terms & Validity */}
        <div className="md:col-span-5 rounded border border-slate-200 bg-slate-50/70 p-3 space-y-2 text-[11px] text-slate-600">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-800 block">
              Value in Words
            </span>
            <p className="italic text-slate-800 mt-0.5">{d.amountInWords}</p>
          </div>
          {d.paymentTerms ? (
            <p>
              <strong className="text-slate-800">Payment Terms:</strong> {d.paymentTerms}
            </p>
          ) : null}
          {d.showPaymentInstructions ? (
            <p className="whitespace-pre-line">
              <strong className="text-slate-800">Payment Instructions:</strong>{' '}
              {d.paymentInstructions}
            </p>
          ) : null}
          {d.notes ? <p className="whitespace-pre-line">{d.notes}</p> : null}
          {d.terms ? (
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-800 block">
                Terms &amp; Validity
              </span>
              <p className="whitespace-pre-line mt-0.5 leading-snug">{d.terms}</p>
            </div>
          ) : null}
        </div>

        {/* Col 2: Signature & Acceptance */}
        <div className="md:col-span-3 rounded border border-slate-200 p-3 flex flex-col justify-between text-[11px]">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-800 block">
              Client Acceptance
            </span>
            <div className="border-b border-slate-400 h-8 mt-2" />
            <span className="text-[9.5px] text-slate-500 block mt-0.5">
              Client Signature &amp; Date
            </span>
          </div>
          <div className="pt-3 border-t border-slate-200 mt-3">
            <div className="h-9 flex items-center">
              {biz.signatureDataUrl ? (
                <img
                  src={biz.signatureDataUrl}
                  alt="Signature"
                  className="max-h-9 max-w-[120px] object-contain"
                />
              ) : (
                <div className="border-b border-slate-400 w-28 h-5" />
              )}
            </div>
            <span className="font-semibold text-slate-900 block">{d.signatureLabel}</span>
          </div>
        </div>

        {/* Col 3: Totals Box */}
        <div className="md:col-span-4 rounded border border-slate-300 overflow-hidden flex flex-col justify-between">
          <div className="divide-y divide-slate-200 text-[11.5px]">
            <div className="flex justify-between py-1.5 px-3">
              <span className="text-slate-600">Estimated Subtotal</span>
              <span className="font-mono tabular-nums">{d.formatINR(d.subtotal)}</span>
            </div>
            {d.totalDiscount > 0 ? (
              <div className="flex justify-between py-1.5 px-3 text-amber-700">
                <span>Discount</span>
                <span className="font-mono tabular-nums">-{d.formatINR(d.totalDiscount)}</span>
              </div>
            ) : null}
            {d.isGst ? (
              <>
                <div className="flex justify-between py-1.5 px-3">
                  <span className="text-slate-600">Estimated Taxable Value</span>
                  <span className="font-mono tabular-nums">{d.formatINR(d.taxableAmount)}</span>
                </div>
                {!d.hasInterState ? (
                  <>
                    <div className="flex justify-between py-1.5 px-3">
                      <span className="text-slate-600">Estimated CGST</span>
                      <span className="font-mono tabular-nums">{d.formatINR(d.cgstTotal)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 px-3">
                      <span className="text-slate-600">Estimated SGST</span>
                      <span className="font-mono tabular-nums">{d.formatINR(d.sgstTotal)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between py-1.5 px-3">
                    <span className="text-slate-600">Estimated IGST</span>
                    <span className="font-mono tabular-nums">{d.formatINR(d.igstTotal)}</span>
                  </div>
                )}
              </>
            ) : null}
            {d.roundOff !== 0 ? (
              <div className="flex justify-between py-1.5 px-3">
                <span className="text-slate-600">Round Off</span>
                <span className="font-mono tabular-nums">{d.formatINR(d.roundOff)}</span>
              </div>
            ) : null}
          </div>
          <div className="flex justify-between items-center py-2.5 px-3 bg-slate-900 text-white">
            <span className="font-bold uppercase tracking-wider text-[11px]">Quotation Total</span>
            <span className="font-mono tabular-nums text-base font-extrabold">
              {d.formatINR(d.grandTotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
