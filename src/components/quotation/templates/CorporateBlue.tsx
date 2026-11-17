import * as React from 'react';
import type { QuotationTemplateProps } from '../quotationThemeTypes';
import { useQuotationData } from '../quotationCommon';

/**
 * Theme 3 - Corporate Blue
 * Deep enterprise navy header & crisp white body, structured 3-column metadata cards,
 * striped corporate item rows, pricing breakdown box, and authorized signatory footer.
 */
export function CorporateBlue({
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
          ? 'w-[794px] min-h-[1123px] max-w-none flex flex-col justify-between'
          : 'w-full max-w-[820px] mx-auto'
      } border border-slate-300 overflow-hidden ${className}`}
    >
      {/* Strong Navy Corporate Header */}
      <div className="bg-[#0F2744] text-white px-7 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0 max-w-[60%]">
            {biz.logoDataUrl ? (
              <div className="h-14 w-14 rounded-md bg-white p-1.5 flex items-center justify-center shrink-0">
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
                <p className="text-[11px] text-slate-300 leading-snug whitespace-pre-line">
                  {biz.address}
                </p>
              ) : null}
              <p className="text-[11px] text-slate-300">
                {[biz.phone, biz.email, biz.gstin ? `GSTIN: ${biz.gstin}` : '']
                  .filter(Boolean)
                  .join('  |  ')}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="inline-block rounded bg-[#1E3A5F] border border-blue-400/30 px-3 py-1 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200">
                Enterprise Proposal
              </span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-wide text-white uppercase">
              {d.quotationTitle}
            </h1>
            <p className="font-mono text-xs font-semibold text-blue-200 mt-0.5">
              {d.quotationNumber}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-7 space-y-5">
        <div className="space-y-5">
          {/* Structured 3-Part Information Band */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 text-xs">
            <div className="md:col-span-6 rounded border border-slate-200 bg-slate-50/70 p-3.5 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F]">
                Client Organization
              </div>
              <p className="text-sm font-bold text-slate-900">{cust.companyName || cust.name}</p>
              {cust.companyName && cust.name ? (
                <p className="text-[11px] text-slate-600">Contact: {cust.name}</p>
              ) : null}
              {cust.billingAddress ? (
                <p className="text-[11px] text-slate-600 whitespace-pre-line leading-relaxed">
                  {cust.billingAddress}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 pt-0.5">
                {cust.phone ? <span>Tel: {cust.phone}</span> : null}
                {cust.email ? <span>{cust.email}</span> : null}
                {cust.gstin ? (
                  <span className="font-mono font-semibold text-slate-800">
                    GSTIN: {cust.gstin}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="md:col-span-6 rounded border border-slate-200 bg-white overflow-hidden">
              <div className="bg-[#EFF4FA] px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0F2744] border-b border-slate-200">
                Quotation Schedule &amp; Governance
              </div>
              <div className="p-3.5 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Issue Date</span>
                  <span className="font-mono font-semibold text-slate-900">{d.quotationDate}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Valid Until</span>
                  <span className="font-mono font-semibold text-[#1E3A5F]">
                    {d.validUntil || '-'}
                  </span>
                </div>
                {d.referenceNumber ? (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Reference #</span>
                    <span className="font-mono text-slate-800">{d.referenceNumber}</span>
                  </div>
                ) : null}
                {d.deliveryTimeline ? (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Delivery Timeline</span>
                    <span className="font-medium text-slate-900">{d.deliveryTimeline}</span>
                  </div>
                ) : null}
                {d.paymentTerms ? (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Payment Terms</span>
                    <span className="font-medium text-slate-900">{d.paymentTerms}</span>
                  </div>
                ) : null}
                {d.preparedBy ? (
                  <div>
                    <span className="text-slate-400 block text-[10px]">Prepared By</span>
                    <span className="font-medium text-slate-900">{d.preparedBy}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {d.projectDescription ? (
            <div className="rounded border border-blue-100 bg-[#EFF4FA]/70 px-4 py-2.5 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F2744] block mb-0.5">
                Executive Scope Summary
              </span>
              <p className="text-slate-700 whitespace-pre-line leading-relaxed">
                {d.projectDescription}
              </p>
            </div>
          ) : null}

          {/* Corporate Striped Item Table */}
          <div className="rounded border border-slate-300 overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#1E3A5F] text-white text-[10.5px] uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3">Deliverable / Item Description</th>
                  {d.isGst ? <th className="py-2.5 px-2 w-20 text-center">HSN/SAC</th> : null}
                  <th className="py-2.5 px-2 w-20 text-right">Qty</th>
                  <th className="py-2.5 px-2 w-24 text-right">Unit Rate</th>
                  {d.totalDiscount > 0 ? (
                    <th className="py-2.5 px-2 w-20 text-right">Disc.</th>
                  ) : null}
                  {d.isGst ? <th className="py-2.5 px-2 w-16 text-center">GST %</th> : null}
                  <th className="py-2.5 px-3 w-28 text-right">Line Estimate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {d.items.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      {item.description ? (
                        <p className="text-[11px] text-slate-600 whitespace-pre-line mt-0.5">
                          {item.description}
                        </p>
                      ) : null}
                    </td>
                    {d.isGst ? (
                      <td className="py-2.5 px-2 text-center font-mono text-[11px] text-slate-600">
                        {item.hsnSac || '-'}
                      </td>
                    ) : null}
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-800">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-800">
                      {d.formatINR(item.rate)}
                    </td>
                    {d.totalDiscount > 0 ? (
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600">
                        {item.discountAmount > 0 ? `-${d.formatINR(item.discountAmount)}` : '-'}
                      </td>
                    ) : null}
                    {d.isGst ? (
                      <td className="py-2.5 px-2 text-center font-mono text-[11px] text-slate-600">
                        {item.taxRate}%
                      </td>
                    ) : null}
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {d.formatINR(item.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Commercial Terms + Pricing Summary */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-1">
            <div className="md:col-span-7 space-y-3 text-xs">
              <div className="rounded border border-slate-200 bg-slate-50/70 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F] block">
                  Estimated Proposal Value (In Words)
                </span>
                <p className="text-slate-800 font-medium mt-0.5">{d.amountInWords}</p>
              </div>

              {d.showPaymentInstructions ? (
                <div className="rounded border border-blue-200 bg-[#EFF4FA] p-3 text-[11px] text-slate-700">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F2744] block mb-0.5">
                    Proposed Payment Instructions
                  </span>
                  <p className="whitespace-pre-line">{d.paymentInstructions}</p>
                </div>
              ) : null}

              {d.notes ? (
                <div className="rounded border border-slate-200 p-3 text-[11px] text-slate-600">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F] block mb-0.5">
                    Proposal Notes
                  </span>
                  <p className="whitespace-pre-line">{d.notes}</p>
                </div>
              ) : null}

              {d.terms ? (
                <div className="rounded border border-slate-200 p-3 text-[11px] text-slate-600">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F] block mb-0.5">
                    Payment &amp; Delivery Terms
                  </span>
                  <p className="whitespace-pre-line leading-relaxed">{d.terms}</p>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-5">
              <div className="rounded border border-slate-300 overflow-hidden text-xs">
                <div className="bg-[#EFF4FA] px-3.5 py-2 font-bold text-[#0F2744] text-[10.5px] uppercase tracking-wider border-b border-slate-200">
                  Pricing Summary
                </div>
                <div className="divide-y divide-slate-200 bg-white">
                  <div className="flex justify-between py-2 px-3.5">
                    <span className="text-slate-600">Estimated Subtotal</span>
                    <span className="font-mono tabular-nums">{d.formatINR(d.subtotal)}</span>
                  </div>
                  {d.totalDiscount > 0 ? (
                    <div className="flex justify-between py-2 px-3.5 text-emerald-700">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">-{d.formatINR(d.totalDiscount)}</span>
                    </div>
                  ) : null}
                  {d.isGst ? (
                    <>
                      <div className="flex justify-between py-2 px-3.5">
                        <span className="text-slate-600">Estimated Taxable Value</span>
                        <span className="font-mono tabular-nums">
                          {d.formatINR(d.taxableAmount)}
                        </span>
                      </div>
                      {!d.hasInterState ? (
                        <>
                          <div className="flex justify-between py-2 px-3.5">
                            <span className="text-slate-600">Estimated CGST</span>
                            <span className="font-mono tabular-nums">{d.formatINR(d.cgstTotal)}</span>
                          </div>
                          <div className="flex justify-between py-2 px-3.5">
                            <span className="text-slate-600">Estimated SGST</span>
                            <span className="font-mono tabular-nums">{d.formatINR(d.sgstTotal)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between py-2 px-3.5">
                          <span className="text-slate-600">Estimated IGST</span>
                          <span className="font-mono tabular-nums">{d.formatINR(d.igstTotal)}</span>
                        </div>
                      )}
                    </>
                  ) : null}
                  {d.roundOff !== 0 ? (
                    <div className="flex justify-between py-2 px-3.5">
                      <span className="text-slate-600">Round Off</span>
                      <span className="font-mono tabular-nums">{d.formatINR(d.roundOff)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex justify-between items-center py-3 px-3.5 bg-[#0F2744] text-white">
                  <span className="font-bold uppercase tracking-wider text-[11px]">
                    Estimated Total
                  </span>
                  <span className="font-mono tabular-nums text-base font-extrabold">
                    {d.formatINR(d.grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Authorised Signature & Customer Approval */}
        <div className="pt-5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
          <div className="rounded border border-slate-200 p-3 space-y-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F] block">
              Customer Acceptance &amp; Sign-Off
            </span>
            <div className="grid grid-cols-2 gap-4 pt-5">
              <div>
                <div className="border-b border-slate-400 h-4" />
                <span className="text-[10px] text-slate-500 block mt-1">Client Signature</span>
              </div>
              <div>
                <div className="border-b border-slate-400 h-4" />
                <span className="text-[10px] text-slate-500 block mt-1">Date &amp; Stamp</span>
              </div>
            </div>
          </div>

          <div className="rounded border border-slate-200 p-3 text-right flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A5F] block">
              Authorised Signatory — {biz.businessName}
            </span>
            <div className="h-12 flex items-center justify-end my-1">
              {biz.signatureDataUrl ? (
                <img
                  src={biz.signatureDataUrl}
                  alt="Authorised Signature"
                  className="max-h-12 max-w-[140px] object-contain"
                />
              ) : (
                <div className="border-b border-slate-400 w-36 h-6" />
              )}
            </div>
            <span className="text-[11px] font-semibold text-slate-800">{d.signatureLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
