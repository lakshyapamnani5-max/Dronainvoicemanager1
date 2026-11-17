import * as React from 'react';
import type { QuotationTemplateProps } from '../quotationThemeTypes';
import { useQuotationData } from '../quotationCommon';

/**
 * Theme 1 - Executive Gold
 * Cream & crisp white palette, champagne-gold accents, refined serif quotation title,
 * spacious item table, highlighted grand total, and signature + acceptance footer.
 */
export function ExecutiveGold({
  record,
  a4Ratio = false,
  className = '',
}: QuotationTemplateProps) {
  const d = useQuotationData(record);
  const { biz, cust } = d;

  return (
    <div
      className={`print-sheet bg-[#FAF7F0] text-[#221E18] font-sans ${
        a4Ratio
          ? 'w-[794px] min-h-[1123px] max-w-none flex flex-col justify-between p-7'
          : 'w-full max-w-[820px] mx-auto p-5 sm:p-7'
      } ${className}`}
    >
      <div className="bg-white border border-[#DFD2B5] shadow-sm rounded-sm flex-1 flex flex-col justify-between p-6 sm:p-8">
        <div className="space-y-5">
          {/* Ornamental Champagne Header */}
          <div className="border-b border-[#C8A45D] pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0 max-w-[58%]">
                {biz.logoDataUrl ? (
                  <img
                    src={biz.logoDataUrl}
                    alt="Business logo"
                    className="h-14 w-auto max-w-[115px] object-contain border border-[#E7DEC8] p-1 bg-[#FAF7F0]/50 shrink-0"
                  />
                ) : null}
                <div className="min-w-0 space-y-1">
                  <h2 className="text-base font-bold tracking-wide text-[#1D1912]">
                    {biz.businessName}
                  </h2>
                  {biz.address ? (
                    <p className="text-[11px] text-[#5E5648] leading-relaxed whitespace-pre-line">
                      {biz.address}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#5E5648]">
                    {biz.phone ? <span>Tel: {biz.phone}</span> : null}
                    {biz.email ? <span>{biz.email}</span> : null}
                  </div>
                  {(biz.gstin || biz.state) ? (
                    <div className="text-[10.5px] font-mono text-[#76684E]">
                      {biz.gstin ? `GSTIN: ${biz.gstin}` : ''}
                      {biz.gstin && biz.state ? ' · ' : ''}
                      {biz.state ? `State: ${biz.state}` : ''}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="text-right shrink-0 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9A7832]">
                  Commercial Proposal
                </p>
                <h1
                  className="text-3xl font-semibold tracking-wide text-[#221E18]"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                >
                  {d.quotationTitle}
                </h1>
                <p className="font-mono text-xs font-semibold text-[#8A6928]">
                  #{d.quotationNumber}
                </p>
              </div>
            </div>
          </div>

          {/* Client & Proposal Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 text-xs">
            <div className="md:col-span-7 rounded-sm border border-[#E7DEC8] bg-[#FCFBF7] p-4 space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9A7832] border-b border-[#E7DEC8] pb-1">
                Prepared For
              </div>
              <p className="text-sm font-bold text-[#1D1912]">
                {cust.companyName || cust.name}
              </p>
              {cust.companyName && cust.name ? (
                <p className="text-[11px] text-[#5E5648]">Attn: {cust.name}</p>
              ) : null}
              {cust.billingAddress ? (
                <p className="text-[11px] text-[#5E5648] leading-relaxed whitespace-pre-line">
                  {cust.billingAddress}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#5E5648] pt-0.5">
                {cust.phone ? <span>Ph: {cust.phone}</span> : null}
                {cust.email ? <span>{cust.email}</span> : null}
                {cust.gstin ? (
                  <span className="font-mono text-[#221E18]">GSTIN: {cust.gstin}</span>
                ) : null}
              </div>
            </div>

            <div className="md:col-span-5 rounded-sm border border-[#E7DEC8] bg-[#FCFBF7] p-4 space-y-2 text-[11.5px]">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9A7832] border-b border-[#E7DEC8] pb-1">
                Quotation Details
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#6E6555]">Quotation Date</span>
                <span className="font-semibold text-[#221E18] font-mono tabular-nums">
                  {d.quotationDate}
                </span>
              </div>
              {d.validUntil ? (
                <div className="flex justify-between gap-2">
                  <span className="text-[#6E6555]">Valid Until</span>
                  <span className="font-semibold text-[#8A6928] font-mono tabular-nums">
                    {d.validUntil}
                  </span>
                </div>
              ) : null}
              {d.referenceNumber ? (
                <div className="flex justify-between gap-2">
                  <span className="text-[#6E6555]">Reference #</span>
                  <span className="font-mono text-[#221E18]">{d.referenceNumber}</span>
                </div>
              ) : null}
              {d.deliveryTimeline ? (
                <div className="flex justify-between gap-2">
                  <span className="text-[#6E6555]">Delivery Timeline</span>
                  <span className="font-medium text-[#221E18] text-right">{d.deliveryTimeline}</span>
                </div>
              ) : null}
              {d.preparedBy ? (
                <div className="flex justify-between gap-2">
                  <span className="text-[#6E6555]">Prepared By</span>
                  <span className="font-medium text-[#221E18] text-right">{d.preparedBy}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Optional Project / Scope Description */}
          {d.projectDescription ? (
            <div className="border-l-2 border-[#C8A45D] bg-[#FAF7F0] px-4 py-2.5 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9A7832] block mb-0.5">
                Project / Service Scope
              </span>
              <p className="text-[#3C352B] whitespace-pre-line leading-relaxed">
                {d.projectDescription}
              </p>
            </div>
          ) : null}

          {/* Spacious Item Table */}
          <div className="border border-[#E2D6BA] rounded-sm overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F6EFE0] border-b border-[#C8A45D] text-[#5C4618] text-[10.5px] uppercase tracking-wider">
                  <th className="py-3 px-3 w-10 text-center font-semibold">#</th>
                  <th className="py-3 px-3 font-semibold">Item &amp; Specification</th>
                  {d.isGst ? (
                    <th className="py-3 px-2.5 w-20 text-center font-semibold">HSN/SAC</th>
                  ) : null}
                  <th className="py-3 px-2.5 w-20 text-right font-semibold">Qty</th>
                  <th className="py-3 px-2.5 w-24 text-right font-semibold">Rate</th>
                  {d.totalDiscount > 0 ? (
                    <th className="py-3 px-2.5 w-20 text-right font-semibold">Disc.</th>
                  ) : null}
                  {d.isGst ? (
                    <th className="py-3 px-2.5 w-16 text-center font-semibold">Est. GST</th>
                  ) : null}
                  <th className="py-3 px-3 w-28 text-right font-semibold">Est. Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE7D6]">
                {d.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-3 px-3 text-center text-[#8C7B5B] font-mono tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-3">
                      <p className="font-semibold text-[#1D1912]">{item.name}</p>
                      {item.description ? (
                        <p className="text-[11px] text-[#6E6555] whitespace-pre-line mt-0.5 leading-relaxed">
                          {item.description}
                        </p>
                      ) : null}
                    </td>
                    {d.isGst ? (
                      <td className="py-3 px-2.5 text-center font-mono text-[11px] text-[#5E5648]">
                        {item.hsnSac || '-'}
                      </td>
                    ) : null}
                    <td className="py-3 px-2.5 text-right font-mono tabular-nums text-[#221E18]">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-3 px-2.5 text-right font-mono tabular-nums text-[#221E18]">
                      {d.formatINR(item.rate)}
                    </td>
                    {d.totalDiscount > 0 ? (
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-[#6E6555]">
                        {item.discountAmount > 0 ? `-${d.formatINR(item.discountAmount)}` : '-'}
                      </td>
                    ) : null}
                    {d.isGst ? (
                      <td className="py-3 px-2.5 text-center font-mono text-[11px] text-[#5E5648]">
                        {item.taxRate}%
                      </td>
                    ) : null}
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#1D1912]">
                      {d.formatINR(item.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary & Proposal Notes */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-1">
            <div className="md:col-span-7 space-y-3 text-xs">
              <div className="rounded-sm border border-[#EDE5D2] bg-[#FCFBF7] px-3.5 py-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#9A7832] block">
                  Estimated Value in Words
                </span>
                <p className="italic text-[#3C352B] mt-0.5">{d.amountInWords}</p>
              </div>

              {d.paymentTerms ? (
                <div className="text-[11px] text-[#4C4438]">
                  <span className="font-bold text-[#8A6928] uppercase tracking-wide text-[10px]">
                    Proposed Payment Terms:{' '}
                  </span>
                  <span>{d.paymentTerms}</span>
                </div>
              ) : null}

              {d.showPaymentInstructions ? (
                <div className="rounded-sm border border-[#E7DEC8] bg-[#FAF7F0] p-3 text-[11px] text-[#4C4438]">
                  <span className="font-bold uppercase tracking-wide text-[10px] text-[#9A7832] block mb-0.5">
                    Proposed Payment Instructions
                  </span>
                  <p className="whitespace-pre-line">{d.paymentInstructions}</p>
                </div>
              ) : null}

              {d.notes ? (
                <div className="text-[11px] text-[#5E5648]">
                  <span className="font-bold uppercase tracking-wide text-[10px] text-[#8A6928] block">
                    Notes
                  </span>
                  <p className="whitespace-pre-line mt-0.5">{d.notes}</p>
                </div>
              ) : null}

              {d.terms ? (
                <div className="text-[11px] text-[#5E5648]">
                  <span className="font-bold uppercase tracking-wide text-[10px] text-[#8A6928] block">
                    Terms &amp; Conditions
                  </span>
                  <p className="whitespace-pre-line mt-0.5 leading-relaxed">{d.terms}</p>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-5">
              <div className="rounded-sm border border-[#C8A45D] overflow-hidden text-xs">
                <div className="divide-y divide-[#EFE7D6] bg-white">
                  <div className="flex justify-between py-2 px-3.5">
                    <span className="text-[#5E5648]">Estimated Subtotal</span>
                    <span className="font-mono tabular-nums">{d.formatINR(d.subtotal)}</span>
                  </div>
                  {d.totalDiscount > 0 ? (
                    <div className="flex justify-between py-2 px-3.5 text-[#8A6928]">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">-{d.formatINR(d.totalDiscount)}</span>
                    </div>
                  ) : null}
                  {d.isGst ? (
                    <>
                      <div className="flex justify-between py-2 px-3.5">
                        <span className="text-[#5E5648]">Estimated Taxable Value</span>
                        <span className="font-mono tabular-nums">
                          {d.formatINR(d.taxableAmount)}
                        </span>
                      </div>
                      {!d.hasInterState ? (
                        <>
                          <div className="flex justify-between py-2 px-3.5">
                            <span className="text-[#5E5648]">Estimated CGST</span>
                            <span className="font-mono tabular-nums">{d.formatINR(d.cgstTotal)}</span>
                          </div>
                          <div className="flex justify-between py-2 px-3.5">
                            <span className="text-[#5E5648]">Estimated SGST</span>
                            <span className="font-mono tabular-nums">{d.formatINR(d.sgstTotal)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between py-2 px-3.5">
                          <span className="text-[#5E5648]">Estimated IGST</span>
                          <span className="font-mono tabular-nums">{d.formatINR(d.igstTotal)}</span>
                        </div>
                      )}
                    </>
                  ) : null}
                  {d.roundOff !== 0 ? (
                    <div className="flex justify-between py-2 px-3.5">
                      <span className="text-[#5E5648]">Round Off</span>
                      <span className="font-mono tabular-nums">{d.formatINR(d.roundOff)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex justify-between items-center py-3 px-3.5 bg-[#F4EBD6] border-t border-[#C8A45D] text-[#1D1912]">
                  <span className="font-bold uppercase tracking-wider text-[11px]">
                    Quotation Total
                  </span>
                  <span className="font-mono tabular-nums text-base font-bold text-[#7A5715]">
                    {d.formatINR(d.grandTotal)}
                  </span>
                </div>
              </div>
              {d.isGst ? (
                <p className="text-[10px] text-[#76684E] mt-1.5 text-right">
                  Taxes shown are indicative estimates applicable at billing.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Bottom Signature & Client Acceptance */}
        <div className="mt-8 pt-4 border-t border-[#E2D6BA] grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9A7832]">
              Client Acceptance
            </p>
            <p className="text-[10.5px] text-[#6E6555]">
              I/We accept the pricing, specifications, and terms stated in this quotation.
            </p>
            <div className="pt-6 grid grid-cols-2 gap-4">
              <div>
                <div className="border-b border-[#C8A45D]/70 h-6" />
                <span className="text-[10px] text-[#5E5648] block mt-1">
                  Authorized Client Signature
                </span>
              </div>
              <div>
                <div className="border-b border-[#C8A45D]/70 h-6" />
                <span className="text-[10px] text-[#5E5648] block mt-1">Name &amp; Date</span>
              </div>
            </div>
          </div>

          <div className="sm:text-right flex flex-col justify-between items-start sm:items-end">
            <span className="text-[11px] text-[#5E5648]">
              For <span className="font-bold text-[#1D1912]">{biz.businessName}</span>
            </span>
            <div className="h-12 flex items-center justify-end my-1">
              {biz.signatureDataUrl ? (
                <img
                  src={biz.signatureDataUrl}
                  alt="Authorized Signature"
                  className="max-h-12 max-w-[145px] object-contain"
                />
              ) : (
                <div className="border-b border-[#C8A45D] w-36 h-6" />
              )}
            </div>
            <span className="text-[11px] font-semibold text-[#1D1912]">{d.signatureLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
