import * as React from 'react';
import type { QuotationTemplateProps } from '../quotationThemeTypes';
import { useQuotationData } from '../quotationCommon';

/**
 * Theme 5 - Drona Signature
 * Drona dark charcoal (#18181B) and signature orange (#F57C00) branding,
 * clean white body, modern contrasted table, and prominent Quotation Total card.
 */
export function DronaSignature({
  record,
  a4Ratio = false,
  className = '',
}: QuotationTemplateProps) {
  const d = useQuotationData(record);
  const { biz, cust } = d;

  return (
    <div
      className={`print-sheet bg-white text-zinc-900 font-sans ${
        a4Ratio
          ? 'w-[794px] min-h-[1123px] max-w-none flex flex-col justify-between'
          : 'w-full max-w-[820px] mx-auto'
      } border border-zinc-300 overflow-hidden ${className}`}
    >
      {/* Charcoal + Drona Orange Brand Banner */}
      <div className="bg-zinc-900 text-white border-b-4 border-[#F57C00] px-7 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0 max-w-[58%]">
            {biz.logoDataUrl ? (
              <div className="h-14 w-14 rounded-lg bg-white p-1.5 flex items-center justify-center shrink-0">
                <img
                  src={biz.logoDataUrl}
                  alt="Logo"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-lg font-bold tracking-tight text-white">{biz.businessName}</h2>
              {biz.address ? (
                <p className="text-[11px] text-zinc-300 leading-snug whitespace-pre-line">
                  {biz.address}
                </p>
              ) : null}
              <p className="text-[11px] text-zinc-400">
                {[biz.phone, biz.email, biz.gstin ? `GSTIN: ${biz.gstin}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0 space-y-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#F57C00] uppercase">
              {d.quotationTitle}
            </h1>
            <div className="inline-block rounded-md bg-zinc-800 border border-zinc-700 px-3 py-1">
              <span className="font-mono text-xs font-bold text-white">{d.quotationNumber}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Document Body */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-7 space-y-5">
        <div className="space-y-5">
          {/* Split Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 text-xs">
            <div className="md:col-span-7 rounded-lg border-l-4 border-l-[#F57C00] border border-zinc-200 bg-zinc-50/70 p-4 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#F57C00] block">
                Proposal Prepared For
              </span>
              <p className="text-sm font-bold text-zinc-950">{cust.companyName || cust.name}</p>
              {cust.companyName && cust.name ? (
                <p className="text-[11px] text-zinc-600">Contact: {cust.name}</p>
              ) : null}
              {cust.billingAddress ? (
                <p className="text-[11px] text-zinc-600 whitespace-pre-line leading-relaxed">
                  {cust.billingAddress}
                </p>
              ) : null}
              <p className="text-[11px] text-zinc-600">
                {[cust.phone, cust.email, cust.gstin ? `GSTIN: ${cust.gstin}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>

            <div className="md:col-span-5 rounded-lg border border-zinc-200 bg-white p-4 space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-500">Quotation Date</span>
                <span className="font-mono font-semibold text-zinc-900">{d.quotationDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Valid Until</span>
                <span className="font-mono font-bold text-[#F57C00]">{d.validUntil || '-'}</span>
              </div>
              {d.referenceNumber ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Reference #</span>
                  <span className="font-mono text-zinc-900">{d.referenceNumber}</span>
                </div>
              ) : null}
              {d.deliveryTimeline ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Delivery Timeline</span>
                  <span className="font-semibold text-zinc-900 text-right">
                    {d.deliveryTimeline}
                  </span>
                </div>
              ) : null}
              {d.preparedBy ? (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Prepared By</span>
                  <span className="font-semibold text-zinc-900 text-right">{d.preparedBy}</span>
                </div>
              ) : null}
            </div>
          </div>

          {d.projectDescription ? (
            <div className="rounded-lg bg-orange-50/70 border border-orange-200/80 px-4 py-2.5 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#D96B00] block mb-0.5">
                Scope &amp; Deliverables
              </span>
              <p className="text-zinc-800 whitespace-pre-line leading-relaxed">
                {d.projectDescription}
              </p>
            </div>
          ) : null}

          {/* Modern Dark-Header Item Table */}
          <div className="rounded-lg border border-zinc-200 overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-900 text-white text-[10.5px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center text-[#F57C00]">#</th>
                  <th className="py-2.5 px-3">Item &amp; Description</th>
                  {d.isGst ? <th className="py-2.5 px-2 w-20 text-center">HSN/SAC</th> : null}
                  <th className="py-2.5 px-2 w-20 text-right">Qty</th>
                  <th className="py-2.5 px-2 w-24 text-right">Rate</th>
                  {d.totalDiscount > 0 ? (
                    <th className="py-2.5 px-2 w-20 text-right">Disc.</th>
                  ) : null}
                  {d.isGst ? <th className="py-2.5 px-2 w-16 text-center">GST</th> : null}
                  <th className="py-2.5 px-3 w-28 text-right">Estimate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {d.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-2.5 px-3 text-center font-mono text-zinc-400">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-zinc-900">{item.name}</p>
                      {item.description ? (
                        <p className="text-[11px] text-zinc-500 whitespace-pre-line mt-0.5">
                          {item.description}
                        </p>
                      ) : null}
                    </td>
                    {d.isGst ? (
                      <td className="py-2.5 px-2 text-center font-mono text-[11px] text-zinc-600">
                        {item.hsnSac || '-'}
                      </td>
                    ) : null}
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-zinc-800">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-zinc-800">
                      {d.formatINR(item.rate)}
                    </td>
                    {d.totalDiscount > 0 ? (
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-zinc-600">
                        {item.discountAmount > 0 ? `-${d.formatINR(item.discountAmount)}` : '-'}
                      </td>
                    ) : null}
                    {d.isGst ? (
                      <td className="py-2.5 px-2 text-center font-mono text-[11px] text-zinc-600">
                        {item.taxRate}%
                      </td>
                    ) : null}
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-zinc-950">
                      {d.formatINR(item.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Terms & Prominent Quotation Total */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-1">
            <div className="md:col-span-7 space-y-3 text-xs">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                  Estimated Value in Words
                </span>
                <p className="text-zinc-900 font-medium mt-0.5">{d.amountInWords}</p>
              </div>

              {d.paymentTerms ? (
                <div className="text-[11px] text-zinc-700">
                  <span className="font-bold text-[#F57C00] uppercase text-[10px] tracking-wider">
                    Proposed Payment Terms:{' '}
                  </span>
                  <span>{d.paymentTerms}</span>
                </div>
              ) : null}

              {d.showPaymentInstructions ? (
                <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3 text-[11px] text-zinc-700">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#F57C00] block mb-0.5">
                    Proposed Payment Instructions
                  </span>
                  <p className="whitespace-pre-line">{d.paymentInstructions}</p>
                </div>
              ) : null}

              {d.notes ? (
                <div className="text-[11px] text-zinc-600">
                  <span className="font-bold text-zinc-800 uppercase text-[10px] tracking-wider block">
                    Notes
                  </span>
                  <p className="whitespace-pre-line mt-0.5">{d.notes}</p>
                </div>
              ) : null}

              {d.terms ? (
                <div className="text-[11px] text-zinc-600">
                  <span className="font-bold text-zinc-800 uppercase text-[10px] tracking-wider block">
                    Validity &amp; Terms
                  </span>
                  <p className="whitespace-pre-line mt-0.5 leading-relaxed">{d.terms}</p>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-5">
              <div className="rounded-lg border border-zinc-300 overflow-hidden text-xs">
                <div className="divide-y divide-zinc-200 bg-white">
                  <div className="flex justify-between py-2 px-3.5">
                    <span className="text-zinc-600">Estimated Subtotal</span>
                    <span className="font-mono tabular-nums">{d.formatINR(d.subtotal)}</span>
                  </div>
                  {d.totalDiscount > 0 ? (
                    <div className="flex justify-between py-2 px-3.5 text-[#F57C00]">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">-{d.formatINR(d.totalDiscount)}</span>
                    </div>
                  ) : null}
                  {d.isGst ? (
                    <>
                      <div className="flex justify-between py-2 px-3.5">
                        <span className="text-zinc-600">Estimated Taxable Value</span>
                        <span className="font-mono tabular-nums">
                          {d.formatINR(d.taxableAmount)}
                        </span>
                      </div>
                      {!d.hasInterState ? (
                        <>
                          <div className="flex justify-between py-2 px-3.5">
                            <span className="text-zinc-600">Estimated CGST</span>
                            <span className="font-mono tabular-nums">{d.formatINR(d.cgstTotal)}</span>
                          </div>
                          <div className="flex justify-between py-2 px-3.5">
                            <span className="text-zinc-600">Estimated SGST</span>
                            <span className="font-mono tabular-nums">{d.formatINR(d.sgstTotal)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between py-2 px-3.5">
                          <span className="text-zinc-600">Estimated IGST</span>
                          <span className="font-mono tabular-nums">{d.formatINR(d.igstTotal)}</span>
                        </div>
                      )}
                    </>
                  ) : null}
                  {d.roundOff !== 0 ? (
                    <div className="flex justify-between py-2 px-3.5">
                      <span className="text-zinc-600">Round Off</span>
                      <span className="font-mono tabular-nums">{d.formatINR(d.roundOff)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex justify-between items-center py-3.5 px-4 bg-zinc-900 text-white border-t-2 border-[#F57C00]">
                  <span className="font-bold uppercase tracking-wider text-[11px]">
                    Quotation Total
                  </span>
                  <span className="font-mono tabular-nums text-lg font-extrabold text-[#F57C00]">
                    {d.formatINR(d.grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Acceptance & Signatory */}
        <div className="pt-4 border-t border-zinc-200 grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
              Client Acceptance
            </span>
            <p className="text-[10.5px] text-zinc-500 mt-0.5">
              Signed acceptance confirms approval of this quotation &amp; timeline.
            </p>
            <div className="grid grid-cols-2 gap-4 pt-6">
              <div>
                <div className="border-b border-zinc-400 h-4" />
                <span className="text-[10px] text-zinc-500 block mt-1">Client Signature</span>
              </div>
              <div>
                <div className="border-b border-zinc-400 h-4" />
                <span className="text-[10px] text-zinc-500 block mt-1">Date</span>
              </div>
            </div>
          </div>

          <div className="sm:text-right flex flex-col justify-between items-start sm:items-end">
            <span className="text-[11px] font-medium text-zinc-600">
              For <strong className="text-zinc-900">{biz.businessName}</strong>
            </span>
            <div className="h-12 flex items-center justify-end my-1">
              {biz.signatureDataUrl ? (
                <img
                  src={biz.signatureDataUrl}
                  alt="Signature"
                  className="max-h-12 max-w-[140px] object-contain"
                />
              ) : (
                <div className="border-b border-zinc-400 w-36 h-6" />
              )}
            </div>
            <span className="text-[11px] font-bold text-zinc-900">{d.signatureLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
