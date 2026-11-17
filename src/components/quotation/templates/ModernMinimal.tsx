import * as React from 'react';
import type { QuotationTemplateProps } from '../quotationThemeTypes';
import { useQuotationData } from '../quotationCommon';

/**
 * Theme 2 - Modern Minimal
 * Pure white surface, crisp black & charcoal typography, Drona orange accent line,
 * generous whitespace, borderless clean table, simple estimated summary.
 */
export function ModernMinimal({
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
      } border border-zinc-200 ${className}`}
    >
      {/* Top Drona Orange Accent Line */}
      <div className="h-1.5 w-full bg-[#F57C00]" />

      <div className="flex-1 flex flex-col justify-between p-7 sm:p-10 space-y-8">
        <div className="space-y-8">
          {/* Oversized Modern Header */}
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-3">
              <div className="inline-block border-b-2 border-[#F57C00] pb-1">
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-zinc-950 uppercase">
                  {d.quotationTitle}
                </h1>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs pt-1">
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">
                    Quotation No.
                  </span>
                  <span className="font-mono font-semibold text-zinc-900">{d.quotationNumber}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">
                    Issue Date
                  </span>
                  <span className="font-mono text-zinc-800">{d.quotationDate}</span>
                </div>
                {d.validUntil ? (
                  <div>
                    <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">
                      Valid Until
                    </span>
                    <span className="font-mono font-medium text-[#F57C00]">{d.validUntil}</span>
                  </div>
                ) : null}
                {d.referenceNumber ? (
                  <div>
                    <span className="text-zinc-400 block text-[10px] uppercase tracking-wider">
                      Reference
                    </span>
                    <span className="font-mono text-zinc-800">{d.referenceNumber}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="text-right space-y-1.5 max-w-[44%]">
              {biz.logoDataUrl ? (
                <img
                  src={biz.logoDataUrl}
                  alt="Logo"
                  className="h-12 w-auto max-w-[120px] object-contain ml-auto mb-2"
                />
              ) : null}
              <h2 className="text-sm font-bold text-zinc-950">{biz.businessName}</h2>
              {biz.address ? (
                <p className="text-[11px] text-zinc-500 leading-relaxed whitespace-pre-line">
                  {biz.address}
                </p>
              ) : null}
              <p className="text-[11px] text-zinc-500">
                {[biz.phone, biz.email].filter(Boolean).join(' · ')}
              </p>
              {biz.gstin ? (
                <p className="text-[10.5px] font-mono text-zinc-600">GSTIN: {biz.gstin}</p>
              ) : null}
            </div>
          </div>

          {/* Client & Proposal Meta Row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 py-4 border-y border-zinc-200 text-xs">
            <div className="md:col-span-7 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#F57C00] block">
                Prepared For
              </span>
              <p className="text-sm font-bold text-zinc-950">{cust.companyName || cust.name}</p>
              {cust.companyName && cust.name ? (
                <p className="text-[11px] text-zinc-600">Attn: {cust.name}</p>
              ) : null}
              {cust.billingAddress ? (
                <p className="text-[11px] text-zinc-500 leading-relaxed whitespace-pre-line">
                  {cust.billingAddress}
                </p>
              ) : null}
              <p className="text-[11px] text-zinc-500">
                {[cust.phone, cust.email, cust.gstin ? `GSTIN: ${cust.gstin}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>

            <div className="md:col-span-5 space-y-1.5 text-[11px]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block">
                Proposal Summary
              </span>
              {d.deliveryTimeline ? (
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Delivery</span>
                  <span className="font-medium text-zinc-900 text-right">{d.deliveryTimeline}</span>
                </div>
              ) : null}
              {d.paymentTerms ? (
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Payment Terms</span>
                  <span className="font-medium text-zinc-900 text-right">{d.paymentTerms}</span>
                </div>
              ) : null}
              {d.preparedBy ? (
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Prepared By</span>
                  <span className="font-medium text-zinc-900 text-right">{d.preparedBy}</span>
                </div>
              ) : null}
              {d.placeOfSupply ? (
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-500">Location</span>
                  <span className="font-medium text-zinc-900 text-right">{d.placeOfSupply}</span>
                </div>
              ) : null}
            </div>
          </div>

          {d.projectDescription ? (
            <div className="text-xs space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block">
                Project Overview
              </span>
              <p className="text-zinc-700 leading-relaxed whitespace-pre-line">
                {d.projectDescription}
              </p>
            </div>
          ) : null}

          {/* Minimal Borderless Line Items Table */}
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-zinc-900 text-[10.5px] uppercase tracking-wider text-zinc-500">
                <th className="py-2.5 pr-3 font-semibold">Item &amp; Description</th>
                {d.isGst ? <th className="py-2.5 px-2 w-20 text-center font-semibold">HSN/SAC</th> : null}
                <th className="py-2.5 px-2 w-20 text-right font-semibold">Qty</th>
                <th className="py-2.5 px-2 w-24 text-right font-semibold">Rate</th>
                {d.totalDiscount > 0 ? (
                  <th className="py-2.5 px-2 w-20 text-right font-semibold">Discount</th>
                ) : null}
                {d.isGst ? (
                  <th className="py-2.5 px-2 w-16 text-right font-semibold">GST</th>
                ) : null}
                <th className="py-2.5 pl-3 w-28 text-right font-semibold">Estimate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {d.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-3.5 pr-3">
                    <p className="font-semibold text-zinc-900">{item.name}</p>
                    {item.description ? (
                      <p className="text-[11px] text-zinc-500 mt-0.5 whitespace-pre-line">
                        {item.description}
                      </p>
                    ) : null}
                  </td>
                  {d.isGst ? (
                    <td className="py-3.5 px-2 text-center font-mono text-[11px] text-zinc-500">
                      {item.hsnSac || '-'}
                    </td>
                  ) : null}
                  <td className="py-3.5 px-2 text-right font-mono tabular-nums text-zinc-700">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="py-3.5 px-2 text-right font-mono tabular-nums text-zinc-700">
                    {d.formatINR(item.rate)}
                  </td>
                  {d.totalDiscount > 0 ? (
                    <td className="py-3.5 px-2 text-right font-mono tabular-nums text-zinc-500">
                      {item.discountAmount > 0 ? `-${d.formatINR(item.discountAmount)}` : '-'}
                    </td>
                  ) : null}
                  {d.isGst ? (
                    <td className="py-3.5 px-2 text-right font-mono text-[11px] text-zinc-500">
                      {item.taxRate}%
                    </td>
                  ) : null}
                  <td className="py-3.5 pl-3 text-right font-mono tabular-nums font-bold text-zinc-950">
                    {d.formatINR(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Simple Right-Aligned Summary */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-2">
            <div className="md:col-span-6 space-y-3 text-[11px] text-zinc-600">
              {d.notes ? (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block mb-0.5">
                    Notes
                  </span>
                  <p className="whitespace-pre-line">{d.notes}</p>
                </div>
              ) : null}
              {d.showPaymentInstructions ? (
                <div className="border-l-2 border-[#F57C00] pl-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#F57C00] block mb-0.5">
                    Proposed Payment Instructions
                  </span>
                  <p className="whitespace-pre-line">{d.paymentInstructions}</p>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-6 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-500">
                <span>Estimated Subtotal</span>
                <span className="font-mono tabular-nums text-zinc-900">
                  {d.formatINR(d.subtotal)}
                </span>
              </div>
              {d.totalDiscount > 0 ? (
                <div className="flex justify-between text-zinc-500">
                  <span>Discount</span>
                  <span className="font-mono tabular-nums text-zinc-900">
                    -{d.formatINR(d.totalDiscount)}
                  </span>
                </div>
              ) : null}
              {d.isGst ? (
                <>
                  <div className="flex justify-between text-zinc-500">
                    <span>Estimated Taxable Value</span>
                    <span className="font-mono tabular-nums text-zinc-900">
                      {d.formatINR(d.taxableAmount)}
                    </span>
                  </div>
                  {!d.hasInterState ? (
                    <>
                      <div className="flex justify-between text-zinc-500">
                        <span>Estimated CGST</span>
                        <span className="font-mono tabular-nums text-zinc-900">
                          {d.formatINR(d.cgstTotal)}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-500">
                        <span>Estimated SGST</span>
                        <span className="font-mono tabular-nums text-zinc-900">
                          {d.formatINR(d.sgstTotal)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-zinc-500">
                      <span>Estimated IGST</span>
                      <span className="font-mono tabular-nums text-zinc-900">
                        {d.formatINR(d.igstTotal)}
                      </span>
                    </div>
                  )}
                </>
              ) : null}
              {d.roundOff !== 0 ? (
                <div className="flex justify-between text-zinc-500">
                  <span>Round Off</span>
                  <span className="font-mono tabular-nums text-zinc-900">
                    {d.formatINR(d.roundOff)}
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between items-baseline border-t-2 border-[#F57C00] pt-3 mt-2">
                <span className="font-bold uppercase tracking-wider text-zinc-950">
                  Estimated Total
                </span>
                <span className="font-mono tabular-nums text-xl font-black text-zinc-950">
                  {d.formatINR(d.grandTotal)}
                </span>
              </div>
              <p className="text-[10.5px] text-zinc-400 text-right italic">{d.amountInWords}</p>
            </div>
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="pt-6 border-t border-zinc-200 grid grid-cols-1 sm:grid-cols-12 gap-5 items-end text-[11px]">
          <div className="sm:col-span-7 space-y-2 text-zinc-500">
            {d.terms ? (
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block">
                  Terms &amp; Validity
                </span>
                <p className="whitespace-pre-line mt-0.5 leading-relaxed">{d.terms}</p>
              </div>
            ) : null}
            <div className="pt-2 text-[10px] text-zinc-400">
              Client Acceptance: Signature ________________________ Date ___________
            </div>
          </div>

          <div className="sm:col-span-5 text-left sm:text-right">
            {biz.signatureDataUrl ? (
              <img
                src={biz.signatureDataUrl}
                alt="Signature"
                className="h-11 max-w-[140px] object-contain sm:ml-auto mb-1"
              />
            ) : (
              <div className="h-8 border-b border-zinc-300 w-36 sm:ml-auto mb-1" />
            )}
            <p className="font-semibold text-zinc-900">{d.signatureLabel}</p>
            <p className="text-[10px] text-zinc-400">{biz.businessName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
