import * as React from 'react';
import type { QuotationTemplateProps } from '../quotationThemeTypes';
import { useQuotationData } from '../quotationCommon';

/**
 * Theme 4 - French Classic
 * Editorial asymmetric header, monochrome black/white/stone-grey palette,
 * refined serif display typography, ultra-thin horizontal rules, gallery-grade spacing.
 */
export function FrenchClassic({
  record,
  a4Ratio = false,
  className = '',
}: QuotationTemplateProps) {
  const d = useQuotationData(record);
  const { biz, cust } = d;

  return (
    <div
      className={`print-sheet bg-white text-[#111111] font-sans ${
        a4Ratio
          ? 'w-[794px] min-h-[1123px] max-w-none flex flex-col justify-between p-9 sm:p-11'
          : 'w-full max-w-[820px] mx-auto p-6 sm:p-9'
      } border border-neutral-300 ${className}`}
    >
      <div className="space-y-7">
        {/* Asymmetric Editorial Header */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start pb-6 border-b border-neutral-800">
          <div className="md:col-span-7 space-y-2">
            <p className="text-[10px] uppercase tracking-[0.32em] text-neutral-500">
              Proposal · Estimate
            </p>
            <h1
              className="text-4xl font-normal italic tracking-tight text-neutral-950 leading-none"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              {d.quotationTitle === 'QUOTATION' ? 'Quotation' : d.quotationTitle}
            </h1>
            <div className="pt-2 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-neutral-600">
              <span>
                No. <strong className="font-mono text-neutral-950">{d.quotationNumber}</strong>
              </span>
              <span>
                Date <strong className="font-mono text-neutral-900">{d.quotationDate}</strong>
              </span>
              {d.validUntil ? (
                <span>
                  Valid Through{' '}
                  <strong className="font-mono text-neutral-900">{d.validUntil}</strong>
                </span>
              ) : null}
            </div>
          </div>

          <div className="md:col-span-5 md:text-right space-y-1.5">
            {biz.logoDataUrl ? (
              <img
                src={biz.logoDataUrl}
                alt="Studio Logo"
                className="h-11 w-auto max-w-[120px] object-contain md:ml-auto mb-2"
              />
            ) : null}
            <h2 className="text-sm font-semibold tracking-wide uppercase text-neutral-950">
              {biz.businessName}
            </h2>
            {biz.address ? (
              <p className="text-[11px] text-neutral-500 whitespace-pre-line leading-relaxed">
                {biz.address}
              </p>
            ) : null}
            <p className="text-[11px] text-neutral-500">
              {[biz.email, biz.phone].filter(Boolean).join(' · ')}
            </p>
            {biz.gstin ? (
              <p className="text-[10.5px] font-mono text-neutral-600">GSTIN {biz.gstin}</p>
            ) : null}
          </div>
        </div>

        {/* Client & Engagement Details */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 text-xs pb-5 border-b border-neutral-200">
          <div className="md:col-span-7 space-y-1">
            <span className="text-[9.5px] uppercase tracking-[0.25em] text-neutral-400 block mb-1">
              Addressed To
            </span>
            <p className="text-sm font-semibold text-neutral-950">
              {cust.companyName || cust.name}
            </p>
            {cust.companyName && cust.name ? (
              <p className="text-[11px] text-neutral-600">Attn: {cust.name}</p>
            ) : null}
            {cust.billingAddress ? (
              <p className="text-[11px] text-neutral-500 whitespace-pre-line leading-relaxed">
                {cust.billingAddress}
              </p>
            ) : null}
            <p className="text-[11px] text-neutral-500">
              {[cust.email, cust.phone, cust.gstin ? `GSTIN ${cust.gstin}` : '']
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          <div className="md:col-span-5 space-y-1.5 text-[11px] md:border-l md:border-neutral-200 md:pl-5">
            <span className="text-[9.5px] uppercase tracking-[0.25em] text-neutral-400 block mb-1">
              Engagement Particulars
            </span>
            {d.referenceNumber ? (
              <div className="flex justify-between">
                <span className="text-neutral-500">Reference</span>
                <span className="font-mono text-neutral-900">{d.referenceNumber}</span>
              </div>
            ) : null}
            {d.deliveryTimeline ? (
              <div className="flex justify-between">
                <span className="text-neutral-500">Timeline</span>
                <span className="text-neutral-900">{d.deliveryTimeline}</span>
              </div>
            ) : null}
            {d.paymentTerms ? (
              <div className="flex justify-between">
                <span className="text-neutral-500">Terms</span>
                <span className="text-neutral-900">{d.paymentTerms}</span>
              </div>
            ) : null}
            {d.preparedBy ? (
              <div className="flex justify-between">
                <span className="text-neutral-500">Prepared By</span>
                <span className="text-neutral-900">{d.preparedBy}</span>
              </div>
            ) : null}
          </div>
        </div>

        {d.projectDescription ? (
          <div className="bg-[#F7F7F6] px-4 py-3 text-xs border-l border-neutral-800">
            <span className="text-[9.5px] uppercase tracking-[0.25em] text-neutral-500 block mb-1">
              Brief &amp; Scope
            </span>
            <p className="text-neutral-700 leading-relaxed whitespace-pre-line">
              {d.projectDescription}
            </p>
          </div>
        ) : null}

        {/* Minimalist Gallery Table */}
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-y border-neutral-800 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
              <th className="py-2.5 pr-3 font-medium">Description</th>
              {d.isGst ? <th className="py-2.5 px-2 w-20 text-center font-medium">SAC/HSN</th> : null}
              <th className="py-2.5 px-2 w-20 text-right font-medium">Qty</th>
              <th className="py-2.5 px-2 w-24 text-right font-medium">Rate</th>
              {d.totalDiscount > 0 ? (
                <th className="py-2.5 px-2 w-20 text-right font-medium">Disc.</th>
              ) : null}
              {d.isGst ? <th className="py-2.5 px-2 w-14 text-right font-medium">Tax</th> : null}
              <th className="py-2.5 pl-3 w-28 text-right font-medium">Estimate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {d.items.map((item, idx) => (
              <tr key={idx}>
                <td className="py-3.5 pr-3">
                  <p className="font-medium text-neutral-950">{item.name}</p>
                  {item.description ? (
                    <p className="text-[11px] text-neutral-500 mt-0.5 whitespace-pre-line leading-relaxed">
                      {item.description}
                    </p>
                  ) : null}
                </td>
                {d.isGst ? (
                  <td className="py-3.5 px-2 text-center font-mono text-[11px] text-neutral-500">
                    {item.hsnSac || '-'}
                  </td>
                ) : null}
                <td className="py-3.5 px-2 text-right font-mono tabular-nums text-neutral-700">
                  {item.quantity} {item.unit}
                </td>
                <td className="py-3.5 px-2 text-right font-mono tabular-nums text-neutral-700">
                  {d.formatINR(item.rate)}
                </td>
                {d.totalDiscount > 0 ? (
                  <td className="py-3.5 px-2 text-right font-mono tabular-nums text-neutral-500">
                    {item.discountAmount > 0 ? `-${d.formatINR(item.discountAmount)}` : '-'}
                  </td>
                ) : null}
                {d.isGst ? (
                  <td className="py-3.5 px-2 text-right font-mono text-[11px] text-neutral-500">
                    {item.taxRate}%
                  </td>
                ) : null}
                <td className="py-3.5 pl-3 text-right font-mono tabular-nums font-semibold text-neutral-950">
                  {d.formatINR(item.totalAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Aligned Pricing Summary */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-2">
          <div className="md:col-span-6 space-y-3 text-[11px] text-neutral-600">
            {d.notes ? (
              <div>
                <span className="text-[9.5px] uppercase tracking-[0.22em] text-neutral-400 block mb-0.5">
                  Notes
                </span>
                <p className="whitespace-pre-line">{d.notes}</p>
              </div>
            ) : null}
            {d.showPaymentInstructions ? (
              <div className="bg-[#F7F7F6] p-3 border border-neutral-200">
                <span className="text-[9.5px] uppercase tracking-[0.22em] text-neutral-500 block mb-0.5">
                  Proposed Payment Instructions
                </span>
                <p className="whitespace-pre-line">{d.paymentInstructions}</p>
              </div>
            ) : null}
            <p className="text-[11px] italic text-neutral-500 pt-1">{d.amountInWords}</p>
          </div>

          <div className="md:col-span-6 text-xs space-y-1.5">
            <div className="flex justify-between py-1 text-neutral-600">
              <span>Estimated Subtotal</span>
              <span className="font-mono tabular-nums text-neutral-900">
                {d.formatINR(d.subtotal)}
              </span>
            </div>
            {d.totalDiscount > 0 ? (
              <div className="flex justify-between py-1 text-neutral-600">
                <span>Discount</span>
                <span className="font-mono tabular-nums">-{d.formatINR(d.totalDiscount)}</span>
              </div>
            ) : null}
            {d.isGst ? (
              <>
                <div className="flex justify-between py-1 text-neutral-600">
                  <span>Estimated Taxable Value</span>
                  <span className="font-mono tabular-nums text-neutral-900">
                    {d.formatINR(d.taxableAmount)}
                  </span>
                </div>
                {!d.hasInterState ? (
                  <>
                    <div className="flex justify-between py-1 text-neutral-600">
                      <span>Estimated CGST</span>
                      <span className="font-mono tabular-nums">{d.formatINR(d.cgstTotal)}</span>
                    </div>
                    <div className="flex justify-between py-1 text-neutral-600">
                      <span>Estimated SGST</span>
                      <span className="font-mono tabular-nums">{d.formatINR(d.sgstTotal)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between py-1 text-neutral-600">
                    <span>Estimated IGST</span>
                    <span className="font-mono tabular-nums">{d.formatINR(d.igstTotal)}</span>
                  </div>
                )}
              </>
            ) : null}
            {d.roundOff !== 0 ? (
              <div className="flex justify-between py-1 text-neutral-600">
                <span>Round Off</span>
                <span className="font-mono tabular-nums">{d.formatINR(d.roundOff)}</span>
              </div>
            ) : null}
            <div className="flex justify-between items-baseline border-t border-b border-neutral-900 py-3 mt-2">
              <span className="uppercase tracking-[0.2em] text-[10.5px] font-semibold">
                Quotation Total
              </span>
              <span
                className="text-xl font-semibold font-mono tabular-nums text-neutral-950"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                {d.formatINR(d.grandTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sophisticated Acceptance Footer */}
      <div className="mt-8 pt-5 border-t border-neutral-300 space-y-5 text-[11px]">
        {d.terms ? (
          <div className="text-neutral-500">
            <span className="text-[9.5px] uppercase tracking-[0.24em] text-neutral-400 block mb-1">
              Terms &amp; Conditions
            </span>
            <p className="whitespace-pre-line leading-relaxed">{d.terms}</p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-2">
          <div>
            <span className="text-[9.5px] uppercase tracking-[0.22em] text-neutral-400 block mb-6">
              Client Acceptance
            </span>
            <div className="border-t border-neutral-300 pt-1.5 flex justify-between text-[10px] text-neutral-500">
              <span>Signature</span>
              <span>Date</span>
            </div>
          </div>
          <div className="sm:text-right">
            <span className="text-[9.5px] uppercase tracking-[0.22em] text-neutral-400 block mb-1">
              For {biz.businessName}
            </span>
            <div className="h-10 flex items-center sm:justify-end">
              {biz.signatureDataUrl ? (
                <img
                  src={biz.signatureDataUrl}
                  alt="Signature"
                  className="max-h-10 max-w-[130px] object-contain"
                />
              ) : null}
            </div>
            <div className="border-t border-neutral-300 pt-1.5 text-[10.5px] font-medium text-neutral-800">
              {d.signatureLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
