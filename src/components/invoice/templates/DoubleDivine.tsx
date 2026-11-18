import * as React from 'react';
import { Building2, Mail, Phone } from 'lucide-react';
import type { InvoiceTemplateProps } from '../invoiceThemeTypes';
import { useInvoiceData } from '../templateCommon';
import { CustomItemTableRenderer } from '../CustomItemTableRenderer';

export function DoubleDivine({
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
      } border border-zinc-200 ${className}`}
    >
      <div>
        {/* Top Dual-Tone Header */}
        <div className="relative">
          {/* Top Red Contact Strip on Right */}
          <div className="bg-[#E53935] text-white px-4 sm:px-6 py-2 flex flex-wrap items-center justify-end gap-4 text-xs font-medium">
            {biz.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                <span>{biz.phone}</span>
              </div>
            )}
            {biz.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                <span>{biz.email}</span>
              </div>
            )}
          </div>

          {/* Dark Charcoal Curve Block with Business Name and Logo on Top-Left */}
          <div className="sm:absolute sm:top-0 sm:left-0 bg-[#1E2430] text-white px-5 sm:px-7 py-3 sm:py-3.5 rounded-br-3xl flex items-center gap-3.5 shadow-sm max-w-md">
            {biz.logoDataUrl ? (
              <img
                src={biz.logoDataUrl}
                alt="Logo"
                className="h-10 w-auto max-w-[90px] object-contain rounded bg-white p-1"
              />
            ) : (
              <div className="h-10 w-10 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400">
                <Building2 className="h-5 w-5" />
              </div>
            )}
            <div>
              <h2 className="font-bold text-sm sm:text-base tracking-wide text-white leading-tight">
                {biz.businessName}
              </h2>
              {biz.gstin && (
                <p className="text-[10px] text-zinc-300 font-mono mt-0.5">GSTIN: {biz.gstin}</p>
              )}
            </div>
          </div>

          {/* Right Header Metadata */}
          <div className="pt-4 sm:pt-6 pb-2 px-6 sm:px-8 text-right flex flex-col items-end">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 uppercase">
              {d.docTitle}
            </h1>
            <div className="text-xs text-zinc-700 mt-1 space-y-0.5">
              <p>
                <span className="text-zinc-500">{d.isInvoice ? 'Invoice No.: ' : 'Quotation No.: '}</span>
                <span className="font-bold text-zinc-900">{d.docNumber}</span>
              </p>
              <p>
                <span className="text-zinc-500">Date: </span>
                <span className="font-semibold text-zinc-800">{d.docDate}</span>
              </p>
              {d.dueDate && (
                <p>
                  <span className="text-zinc-500">{d.isInvoice ? 'Due Date: ' : 'Valid Until: '}</span>
                  <span className="font-medium text-zinc-800">{d.dueDate}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bill To Section */}
        <div className="px-6 sm:px-8 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs border-b border-zinc-100">
          <div>
            <span className="text-[#E53935] font-bold text-xs uppercase tracking-wider block">
              Bill To
            </span>
            <p className="font-bold text-sm text-zinc-900 mt-0.5">{cust.companyName || cust.name}</p>
            {cust.companyName && cust.name && (
              <p className="text-zinc-600 text-[11px]">Attn: {cust.name}</p>
            )}
            {cust.billingAddress && (
              <p className="text-zinc-600 text-[11px] mt-0.5 leading-relaxed">{cust.billingAddress}</p>
            )}
            {cust.phone && <p className="text-zinc-600 text-[11px]">Phone: {cust.phone}</p>}
            {cust.gstin && <p className="font-semibold text-zinc-800 text-[11px]">GSTIN: {cust.gstin}</p>}
          </div>

          <div className="sm:text-right space-y-1 sm:self-center text-zinc-600 text-[11px]">
            {biz.address && <p>{biz.address}</p>}
            <p>
              <span className="text-zinc-500">Place of Supply: </span>
              <span className="font-medium text-zinc-800">{record.placeOfSupply || cust.state || '-'}</span>
            </p>
          </div>
        </div>

        {/* Table with Bright Red Header */}
        <div className="px-6 sm:px-8 pt-3">
          {record.layoutSnapshot?.columns && record.layoutSnapshot.columns.length > 0 ? (
            <CustomItemTableRenderer
              layoutSnapshot={record.layoutSnapshot}
              items={d.items}
              accentColor="#E53935"
              borderColor="#C62828"
              isGst={d.isGst}
              totalDiscount={d.totalDiscount}
              grandTotal={d.grandTotal}
              formatCurrency={d.formatINR}
            />
          ) : (
          <div className="border border-[#E53935] rounded-sm overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#E53935] text-white font-bold text-[11px]">
                  <th className="py-2.5 px-3 w-10 text-center border-r border-red-400">#</th>
                  <th className="py-2.5 px-3 border-r border-red-400">Item Name</th>
                  {d.isGst && <th className="py-2.5 px-2 w-20 text-center border-r border-red-400">HSN/ SAC</th>}
                  <th className="py-2.5 px-2 w-20 text-right border-r border-red-400">Quantity</th>
                  <th className="py-2.5 px-2 w-24 text-right border-r border-red-400">Price/ Unit</th>
                  {d.totalDiscount > 0 && (
                    <th className="py-2.5 px-2 w-20 text-right border-r border-red-400">Discount</th>
                  )}
                  {d.isGst && <th className="py-2.5 px-2 w-16 text-center border-r border-red-400">GST %</th>}
                  <th className="py-2.5 px-3 w-28 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {d.items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-red-50/20">
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
                <tr className="bg-red-50 font-bold text-zinc-900 border-t border-[#E53935] text-xs">
                  <td colSpan={d.isGst ? (d.totalDiscount > 0 ? 7 : 6) : d.totalDiscount > 0 ? 5 : 4} className="py-2 px-3 text-right border-r border-red-200">
                    Total
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-[#E53935] font-bold">
                    {d.formatINR(d.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </div>

        {/* Lower Summary */}
        <div className="px-6 sm:px-8 py-4 grid grid-cols-1 md:grid-cols-12 gap-4 text-xs">
          {/* Left Column: Words, Bank Details, Terms, Signatory */}
          <div className="md:col-span-7 space-y-3">
            <div>
              <span className="font-bold text-zinc-800 text-[11px] block">
                Invoice Amount In Words:
              </span>
              <p className="text-zinc-700 italic mt-0.5">{d.amountInWords}</p>
            </div>

            {(biz.bankName || biz.upiId || qrUrl) && (
              <div className="p-3 border border-red-100 rounded-sm bg-red-50/30 flex items-start justify-between gap-3">
                <div className="space-y-1 text-[11px] text-zinc-700">
                  <span className="font-bold text-[#E53935] block uppercase tracking-wide">
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

            {/* Tinted Signatory Box from reference screenshot */}
            <div className="border border-red-200 bg-red-50/60 rounded-sm p-3 max-w-sm text-center space-y-1.5">
              <span className="text-[11px] text-zinc-600 block">
                For: <span className="font-bold text-zinc-800">{biz.businessName}</span>
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

          {/* Right Column: Totals */}
          <div className="md:col-span-5 space-y-3">
            <div className="border border-zinc-200 rounded-sm overflow-hidden text-xs">
              <div className="bg-[#E53935] text-white px-3 py-1.5 font-bold text-xs flex justify-between">
                <span>Total</span>
                <span className="font-mono text-sm">{d.formatINR(d.grandTotal)}</span>
              </div>
              <div className="divide-y divide-zinc-200 bg-white">
                <div className="flex justify-between py-1.5 px-3">
                  <span className="text-zinc-600">Taxable Amount</span>
                  <span className="font-mono">{d.formatINR(d.taxableAmount)}</span>
                </div>
                {d.isGst && (
                  <div className="flex justify-between py-1.5 px-3">
                    <span className="text-zinc-600">Total Tax</span>
                    <span className="font-mono">{d.formatINR(d.totalTax)}</span>
                  </div>
                )}
                {d.isInvoice && (
                  <>
                    <div className="flex justify-between py-1.5 px-3">
                      <span className="text-zinc-600">Received</span>
                      <span className="font-mono text-emerald-700">{d.formatINR(d.amountPaid)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 px-3 font-semibold bg-red-50/40">
                      <span className="text-zinc-800">Balance</span>
                      <span className="font-mono text-zinc-900">{d.formatINR(d.balanceDue)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {d.terms && (
              <div className="text-[11px] text-zinc-600">
                <span className="font-bold text-zinc-700 block">Terms &amp; Conditions:</span>
                <p className="whitespace-pre-line mt-0.5">{d.terms}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
