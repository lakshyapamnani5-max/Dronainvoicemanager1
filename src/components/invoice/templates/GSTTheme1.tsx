import * as React from 'react';
import { Building2 } from 'lucide-react';
import type { InvoiceTemplateProps } from '../invoiceThemeTypes';
import { useInvoiceData } from '../templateCommon';
import { CustomItemTableRenderer } from '../CustomItemTableRenderer';

export function GSTTheme1({
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
      } border border-zinc-300 p-6 sm:p-8 ${className}`}
    >
      <div className="space-y-4">
        {/* Header Title */}
        <div className="text-center pb-2 border-b border-zinc-200">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 uppercase">
            {d.docTitle}
          </h1>
        </div>

        {/* Business & Invoice Info Box Grid */}
        <div className="border border-zinc-300 rounded-sm grid grid-cols-1 md:grid-cols-12 overflow-hidden text-xs">
          {/* Left: Business Info */}
          <div className="md:col-span-7 p-3 sm:p-4 border-b md:border-b-0 md:border-r border-zinc-300 flex items-start gap-3 bg-white">
            {biz.logoDataUrl ? (
              <img
                src={biz.logoDataUrl}
                alt="Logo"
                className="h-14 w-auto max-w-[100px] object-contain border border-zinc-200 p-1 rounded shrink-0"
              />
            ) : (
              <div className="h-12 w-12 border border-dashed border-zinc-300 rounded flex items-center justify-center shrink-0 text-zinc-400">
                <Building2 className="h-5 w-5" />
              </div>
            )}
            <div className="space-y-1 min-w-0">
              <h2 className="font-bold text-sm text-zinc-900 leading-snug">{biz.businessName}</h2>
              {biz.address && <p className="text-zinc-600 text-[11px] leading-relaxed">{biz.address}</p>}
              <div className="text-zinc-600 text-[11px] space-y-0.5">
                {biz.phone && <p>Phone: {biz.phone}</p>}
                {biz.email && <p>Email: {biz.email}</p>}
                {biz.gstin && <p className="font-medium text-zinc-800">GSTIN: {biz.gstin}</p>}
                {biz.pan && <p>PAN: {biz.pan}</p>}
                {biz.state && <p>State: {biz.state}</p>}
              </div>
            </div>
          </div>

          {/* Right: Invoice Metadata Grid */}
          <div className="md:col-span-5 flex flex-col justify-between bg-zinc-50/50">
            <div className="p-3 border-b border-zinc-300 flex items-center justify-between">
              <span className="text-zinc-500 font-medium">
                {d.isInvoice ? 'Invoice No:' : 'Quotation No:'}
              </span>
              <span className="font-bold text-zinc-900 text-sm">{d.docNumber}</span>
            </div>
            <div className="p-3 border-b border-zinc-300 flex items-center justify-between">
              <span className="text-zinc-500 font-medium">Date:</span>
              <span className="font-semibold text-zinc-800">{d.docDate}</span>
            </div>
            {d.dueDate && (
              <div className="p-3 border-b border-zinc-300 flex items-center justify-between">
                <span className="text-zinc-500 font-medium">
                  {d.isInvoice ? 'Due Date:' : 'Valid Until:'}
                </span>
                <span className="font-medium text-zinc-800">{d.dueDate}</span>
              </div>
            )}
            <div className="p-3 flex items-center justify-between text-[11px]">
              <span className="text-zinc-500">Place of Supply:</span>
              <span className="font-medium text-zinc-800">{record.placeOfSupply || cust.state || '-'}</span>
            </div>
          </div>
        </div>

        {/* Bill To Bar & Details */}
        <div className="border border-zinc-300 rounded-sm overflow-hidden text-xs">
          <div className="bg-zinc-100 px-3 py-1.5 font-bold text-zinc-800 border-b border-zinc-300 uppercase tracking-wide text-[11px]">
            Bill To (Customer Details)
          </div>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 bg-white">
            <div>
              <p className="font-bold text-sm text-zinc-900">{cust.companyName || cust.name}</p>
              {cust.companyName && cust.name && (
                <p className="text-zinc-600 text-[11px]">Attn: {cust.name}</p>
              )}
              {cust.billingAddress && (
                <p className="text-zinc-600 text-[11px] mt-1 leading-relaxed">{cust.billingAddress}</p>
              )}
            </div>
            <div className="space-y-1 text-zinc-600 text-[11px] md:text-right">
              {cust.phone && <p>Phone: {cust.phone}</p>}
              {cust.email && <p>Email: {cust.email}</p>}
              {cust.gstin && <p className="font-semibold text-zinc-800">GSTIN: {cust.gstin}</p>}
              {cust.state && <p>State: {cust.state}</p>}
            </div>
          </div>
        </div>

        {/* Items Table */}
        {record.layoutSnapshot?.columns && record.layoutSnapshot.columns.length > 0 ? (
          <CustomItemTableRenderer
            layoutSnapshot={record.layoutSnapshot}
            items={d.items}
            accentColor="#3F3F46"
            borderColor="#52525B"
            isGst={d.isGst}
            totalDiscount={d.totalDiscount}
            grandTotal={d.grandTotal}
            formatCurrency={d.formatINR}
          />
        ) : (
        <div className="border border-zinc-300 rounded-sm overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-100 text-zinc-800 border-b border-zinc-300 font-bold text-[11px]">
                <th className="py-2.5 px-3 border-r border-zinc-300 w-10 text-center">#</th>
                <th className="py-2.5 px-3 border-r border-zinc-300">Item Name & Description</th>
                {d.isGst && <th className="py-2.5 px-2 border-r border-zinc-300 w-20 text-center">HSN/SAC</th>}
                <th className="py-2.5 px-2 border-r border-zinc-300 w-20 text-right">Quantity</th>
                <th className="py-2.5 px-2 border-r border-zinc-300 w-24 text-right">Price/Unit</th>
                {d.totalDiscount > 0 && (
                  <th className="py-2.5 px-2 border-r border-zinc-300 w-20 text-right">Discount</th>
                )}
                {d.isGst && <th className="py-2.5 px-2 border-r border-zinc-300 w-16 text-center">GST %</th>}
                <th className="py-2.5 px-3 w-28 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {d.items.map((item, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/50">
                  <td className="py-2 px-3 border-r border-zinc-300 text-center text-zinc-500">{idx + 1}</td>
                  <td className="py-2 px-3 border-r border-zinc-300">
                    <p className="font-semibold text-zinc-900">{item.name}</p>
                    {item.description && (
                      <p className="text-[11px] text-zinc-500 whitespace-pre-line mt-0.5">{item.description}</p>
                    )}
                  </td>
                  {d.isGst && (
                    <td className="py-2 px-2 border-r border-zinc-300 text-center text-zinc-600 font-mono text-[11px]">
                      {item.hsnSac || '-'}
                    </td>
                  )}
                  <td className="py-2 px-2 border-r border-zinc-300 text-right text-zinc-800">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="py-2 px-2 border-r border-zinc-300 text-right text-zinc-800 font-mono">
                    {d.formatINR(item.rate)}
                  </td>
                  {d.totalDiscount > 0 && (
                    <td className="py-2 px-2 border-r border-zinc-300 text-right text-zinc-600 font-mono">
                      {item.discountAmount > 0 ? d.formatINR(item.discountAmount) : '-'}
                    </td>
                  )}
                  {d.isGst && (
                    <td className="py-2 px-2 border-r border-zinc-300 text-center text-zinc-600 text-[11px]">
                      {item.taxRate}%
                    </td>
                  )}
                  <td className="py-2 px-3 text-right font-semibold text-zinc-900 font-mono">
                    {d.formatINR(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-100 font-bold text-zinc-800 border-t border-zinc-300 text-xs">
                <td colSpan={d.isGst ? (d.totalDiscount > 0 ? 7 : 6) : d.totalDiscount > 0 ? 5 : 4} className="py-2 px-3 text-right border-r border-zinc-300">
                  Total Quantity: {d.items.reduce((s, it) => s + (it.quantity || 0), 0)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-900">
                  {d.formatINR(d.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        )}

        {/* Lower Summary Section */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 text-xs pt-2">
          {/* Left Column: Words, Bank Details, Terms */}
          <div className="md:col-span-7 space-y-3">
            <div className="p-3 border border-zinc-200 rounded-sm bg-zinc-50/50">
              <span className="font-bold text-zinc-700 block text-[11px] uppercase tracking-wider">
                Invoice Amount in Words:
              </span>
              <p className="text-zinc-900 font-medium italic mt-0.5">{d.amountInWords}</p>
            </div>

            {(biz.bankName || biz.upiId || qrUrl) && (
              <div className="p-3 border border-zinc-200 rounded-sm flex items-start justify-between gap-3 bg-white">
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
                    <img src={qrUrl} alt="UPI QR" className="h-16 w-16 border p-0.5 rounded" />
                    <span className="text-[9px] text-zinc-500 block mt-0.5">Scan to Pay</span>
                  </div>
                )}
              </div>
            )}

            {d.terms && (
              <div className="p-3 border border-zinc-200 rounded-sm bg-zinc-50/30 text-[11px] text-zinc-600">
                <span className="font-bold text-zinc-700 block uppercase">Terms &amp; Conditions</span>
                <p className="whitespace-pre-line mt-0.5">{d.terms}</p>
              </div>
            )}
          </div>

          {/* Right Column: Totals & Signature */}
          <div className="md:col-span-5 space-y-3">
            <div className="border border-zinc-300 rounded-sm overflow-hidden">
              <div className="bg-zinc-100 px-3 py-1.5 font-bold text-zinc-800 border-b border-zinc-300 uppercase tracking-wide text-[11px]">
                Amounts Summary
              </div>
              <div className="divide-y divide-zinc-200 p-0 text-xs">
                <div className="flex justify-between py-1.5 px-3">
                  <span className="text-zinc-600">Taxable Value</span>
                  <span className="font-mono font-medium">{d.formatINR(d.taxableAmount)}</span>
                </div>
                {d.isGst && !d.hasInterState && (
                  <>
                    <div className="flex justify-between py-1.5 px-3">
                      <span className="text-zinc-600">CGST</span>
                      <span className="font-mono">{d.formatINR(d.cgstTotal)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 px-3">
                      <span className="text-zinc-600">SGST</span>
                      <span className="font-mono">{d.formatINR(d.sgstTotal)}</span>
                    </div>
                  </>
                )}
                {d.isGst && d.hasInterState && (
                  <div className="flex justify-between py-1.5 px-3">
                    <span className="text-zinc-600">IGST</span>
                    <span className="font-mono">{d.formatINR(d.igstTotal)}</span>
                  </div>
                )}
                {d.roundOff !== 0 && (
                  <div className="flex justify-between py-1.5 px-3">
                    <span className="text-zinc-600">Round Off</span>
                    <span className="font-mono">{d.formatINR(d.roundOff)}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 px-3 bg-zinc-100 font-bold text-zinc-900 border-t border-zinc-300">
                  <span>Grand Total</span>
                  <span className="font-mono text-sm">{d.formatINR(d.grandTotal)}</span>
                </div>
                {d.isInvoice && (
                  <>
                    <div className="flex justify-between py-1.5 px-3">
                      <span className="text-zinc-600">Amount Received</span>
                      <span className="font-mono text-emerald-700">{d.formatINR(d.amountPaid)}</span>
                    </div>
                    <div className="flex justify-between py-1.5 px-3 font-semibold bg-zinc-50">
                      <span className="text-zinc-800">Balance Due</span>
                      <span className="font-mono text-zinc-900">{d.formatINR(d.balanceDue)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Authorized Signatory Box */}
            <div className="border border-blue-200 bg-blue-50/30 rounded-sm p-3 text-center space-y-2">
              <span className="text-[11px] text-zinc-600 font-medium block">
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
                  <div className="border-b border-dashed border-zinc-400 w-32 h-6" />
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
