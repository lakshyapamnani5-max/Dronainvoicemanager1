import * as React from 'react';
import { Building2 } from 'lucide-react';
import type { InvoiceTemplateProps } from '../invoiceThemeTypes';
import { useInvoiceData } from '../templateCommon';

export function GSTTheme3({
  docType,
  record,
  qrUrl,
  a4Ratio = false,
  className = '',
}: InvoiceTemplateProps) {
  const d = useInvoiceData({ docType, record });
  const { biz, cust } = d;

  return (
    <div
      className={`print-sheet bg-white text-zinc-900 overflow-hidden font-sans ${
        a4Ratio
          ? 'w-[794px] min-h-[1123px] max-w-none flex flex-col justify-between'
          : 'w-full max-w-[820px] mx-auto'
      } border border-zinc-200 p-6 sm:p-8 ${className}`}
    >
      <div className="space-y-4">
        {/* Top Header: Business Box on Left, Logo on Right */}
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          {/* Business Box on Top-Left */}
          <div className="border border-blue-200/90 bg-blue-50/40 rounded-sm p-3 max-w-sm sm:w-auto w-full text-xs space-y-1">
            <h2 className="font-bold text-sm text-zinc-900">{biz.businessName}</h2>
            {biz.phone && <p className="text-zinc-600 text-[11px]">Phone no.: {biz.phone}</p>}
            {biz.email && <p className="text-zinc-600 text-[11px]">Email: {biz.email}</p>}
            {biz.gstin && <p className="font-semibold text-zinc-800 text-[11px]">GSTIN: {biz.gstin}</p>}
            {biz.address && <p className="text-zinc-600 text-[11px] leading-relaxed">{biz.address}</p>}
          </div>

          {/* Logo Box on Top-Right */}
          <div className="shrink-0 self-end sm:self-start">
            {biz.logoDataUrl ? (
              <img
                src={biz.logoDataUrl}
                alt="Logo"
                className="h-16 w-auto max-w-[120px] object-contain border border-zinc-200 rounded p-1"
              />
            ) : (
              <div className="h-14 w-14 border border-dashed border-zinc-300 rounded flex items-center justify-center text-zinc-400">
                <Building2 className="h-6 w-6" />
              </div>
            )}
          </div>
        </div>

        {/* Center Title */}
        <div className="text-center py-1">
          <h1 className="text-xl font-bold tracking-wide text-zinc-900 uppercase">
            {d.docTitle}
          </h1>
        </div>

        {/* 2-Column Bill To & Invoice Details */}
        <div className="border-t border-b border-zinc-200 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="font-bold text-zinc-800 text-[11px] uppercase tracking-wider block mb-1">
              Bill To
            </span>
            <p className="font-bold text-sm text-zinc-900">{cust.companyName || cust.name}</p>
            {cust.companyName && cust.name && (
              <p className="text-zinc-600 text-[11px]">Attn: {cust.name}</p>
            )}
            {cust.billingAddress && (
              <p className="text-zinc-600 text-[11px] mt-0.5 leading-relaxed">{cust.billingAddress}</p>
            )}
            {cust.phone && <p className="text-zinc-600 text-[11px]">Phone: {cust.phone}</p>}
            {cust.gstin && <p className="font-semibold text-zinc-800 text-[11px]">GSTIN: {cust.gstin}</p>}
          </div>
          <div className="sm:text-right space-y-1 sm:self-center">
            <span className="font-bold text-zinc-800 text-[11px] uppercase tracking-wider block mb-1 sm:text-right">
              Invoice Details
            </span>
            <p className="text-xs">
              <span className="text-zinc-500">{d.isInvoice ? 'Invoice No.: ' : 'Quotation No.: '}</span>
              <span className="font-bold text-zinc-900">{d.docNumber}</span>
            </p>
            <p className="text-xs">
              <span className="text-zinc-500">Date: </span>
              <span className="font-semibold text-zinc-800">{d.docDate}</span>
            </p>
            {d.dueDate && (
              <p className="text-xs">
                <span className="text-zinc-500">{d.isInvoice ? 'Due Date: ' : 'Valid Until: '}</span>
                <span className="font-medium text-zinc-800">{d.dueDate}</span>
              </p>
            )}
            <p className="text-[11px]">
              <span className="text-zinc-500">Place of Supply: </span>
              <span className="font-medium text-zinc-800">{record.placeOfSupply || cust.state || '-'}</span>
            </p>
          </div>
        </div>

        {/* Items Table with Purple Header */}
        <div className="border border-zinc-200 rounded-sm overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#7B73D6] text-white font-semibold text-[11px]">
                <th className="py-2 px-3 w-10 text-center border-r border-[#6961C2]">#</th>
                <th className="py-2 px-3 border-r border-[#6961C2]">Item Name</th>
                {d.isGst && <th className="py-2 px-2 w-20 text-center border-r border-[#6961C2]">HSN/ SAC</th>}
                <th className="py-2 px-2 w-20 text-right border-r border-[#6961C2]">Quantity</th>
                <th className="py-2 px-2 w-24 text-right border-r border-[#6961C2]">Price/ Unit</th>
                {d.totalDiscount > 0 && (
                  <th className="py-2 px-2 w-20 text-right border-r border-[#6961C2]">Discount</th>
                )}
                {d.isGst && <th className="py-2 px-2 w-16 text-center border-r border-[#6961C2]">GST %</th>}
                <th className="py-2 px-3 w-28 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {d.items.map((item, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/50">
                  <td className="py-2.5 px-3 text-center border-r border-zinc-200 text-zinc-500">{idx + 1}</td>
                  <td className="py-2.5 px-3 border-r border-zinc-200">
                    <p className="font-semibold text-zinc-900">{item.name}</p>
                    {item.description && (
                      <p className="text-[11px] text-zinc-500 whitespace-pre-line mt-0.5">{item.description}</p>
                    )}
                  </td>
                  {d.isGst && (
                    <td className="py-2.5 px-2 text-center border-r border-zinc-200 text-zinc-600 font-mono text-[11px]">
                      {item.hsnSac || '-'}
                    </td>
                  )}
                  <td className="py-2.5 px-2 text-right border-r border-zinc-200 text-zinc-800">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="py-2.5 px-2 text-right border-r border-zinc-200 text-zinc-800 font-mono">
                    {d.formatINR(item.rate)}
                  </td>
                  {d.totalDiscount > 0 && (
                    <td className="py-2.5 px-2 text-right border-r border-zinc-200 text-zinc-600 font-mono">
                      {item.discountAmount > 0 ? d.formatINR(item.discountAmount) : '-'}
                    </td>
                  )}
                  {d.isGst && (
                    <td className="py-2.5 px-2 text-center border-r border-zinc-200 text-zinc-600 text-[11px]">
                      {item.taxRate}%
                    </td>
                  )}
                  <td className="py-2.5 px-3 text-right font-semibold text-zinc-900 font-mono">
                    {d.formatINR(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-50 font-bold text-zinc-900 border-t border-zinc-200 text-xs">
                <td colSpan={d.isGst ? (d.totalDiscount > 0 ? 7 : 6) : d.totalDiscount > 0 ? 5 : 4} className="py-2 px-3 text-right border-r border-zinc-200">
                  Total
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-900 font-bold">
                  {d.formatINR(d.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Lower Summary */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 text-xs pt-2">
          {/* Left Column */}
          <div className="md:col-span-7 space-y-3">
            <div>
              <span className="font-bold text-zinc-800 text-[11px] block">
                Invoice Amount In Words:
              </span>
              <p className="text-zinc-700 italic mt-0.5">{d.amountInWords}</p>
            </div>

            {(biz.bankName || biz.upiId || qrUrl) && (
              <div className="p-3 border border-zinc-200 rounded-sm bg-zinc-50/50 flex items-start justify-between gap-3">
                <div className="space-y-1 text-[11px] text-zinc-700">
                  <span className="font-bold text-zinc-800 block uppercase tracking-wide">
                    Bank &amp; Payment Details
                  </span>
                  {biz.bankName && <p>Bank: {biz.bankName}</p>}
                  {biz.accountNumber && (
                    <p className="font-mono">
                      A/C: {biz.accountNumber} | IFSC: {biz.ifsc}
                    </p>
                  )}
                  {biz.upiId && <p className="font-medium text-zinc-900">UPI ID: {biz.upiId}</p>}
                </div>
                {qrUrl && (
                  <div className="text-center shrink-0">
                    <img src={qrUrl} alt="UPI QR" className="h-16 w-16 border p-0.5 rounded bg-white" />
                    <span className="text-[9px] text-zinc-500 block mt-0.5">Scan to Pay</span>
                  </div>
                )}
              </div>
            )}

            {d.terms && (
              <div className="text-[11px] text-zinc-600">
                <span className="font-bold text-zinc-700 block">Terms &amp; Conditions:</span>
                <p className="whitespace-pre-line mt-0.5">{d.terms}</p>
              </div>
            )}
          </div>

          {/* Right Column: Totals & Signature */}
          <div className="md:col-span-5 space-y-3">
            <div className="border border-zinc-200 rounded-sm overflow-hidden text-xs">
              <div className="divide-y divide-zinc-200">
                <div className="flex justify-between py-1.5 px-3">
                  <span className="text-zinc-600">Total</span>
                  <span className="font-mono font-bold text-sm text-zinc-900">{d.formatINR(d.grandTotal)}</span>
                </div>
                {d.isInvoice && (
                  <>
                    <div className="flex justify-between py-1.5 px-3">
                      <span className="text-zinc-600">Received</span>
                      <span className="font-mono text-emerald-700">{d.formatINR(d.amountPaid)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 px-3 font-semibold bg-zinc-50">
                      <span className="text-zinc-800">Balance</span>
                      <span className="font-mono text-zinc-900">{d.formatINR(d.balanceDue)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Signature Box */}
            <div className="border border-blue-200 bg-blue-50/40 rounded-sm p-3 text-center space-y-2">
              <span className="text-[11px] text-zinc-600 block">
                For: <span className="font-semibold text-zinc-800">{biz.businessName}</span>
              </span>
              <div className="h-12 flex items-center justify-center">
                {biz.signatureDataUrl ? (
                  <img
                    src={biz.signatureDataUrl}
                    alt="Signature"
                    className="max-h-12 max-w-[140px] object-contain"
                  />
                ) : (
                  <div className="border-b border-zinc-300 w-32 h-6" />
                )}
              </div>
              <span className="text-[11px] font-semibold text-zinc-800 block">
                {d.signatureLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
