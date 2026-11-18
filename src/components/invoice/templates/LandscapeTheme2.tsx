import * as React from 'react';
import { Building2 } from 'lucide-react';
import type { InvoiceTemplateProps } from '../invoiceThemeTypes';
import { useInvoiceData } from '../templateCommon';
import { CustomItemTableRenderer } from '../CustomItemTableRenderer';

export function LandscapeTheme2({
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
          ? 'w-[1123px] min-h-[794px] max-w-none flex flex-col justify-between'
          : 'w-full max-w-[1123px] mx-auto'
      } border border-zinc-200 p-6 sm:p-8 ${className}`}
      style={{ minWidth: a4Ratio ? '1123px' : undefined }}
    >
      <div className="space-y-4">
        {/* Top Expansive 3-Column Landscape Header */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-3 border-b-2 border-[#1E2430]">
          {/* Col 1: Business Logo & Details (5 cols) */}
          <div className="md:col-span-5 flex items-start gap-3.5">
            {biz.logoDataUrl ? (
              <img
                src={biz.logoDataUrl}
                alt="Logo"
                className="h-16 w-auto max-w-[130px] object-contain border border-zinc-200 rounded p-1 shrink-0"
              />
            ) : (
              <div className="h-14 w-14 border border-zinc-200 rounded flex items-center justify-center text-zinc-400 bg-zinc-50 shrink-0">
                <Building2 className="h-6 w-6" />
              </div>
            )}
            <div className="space-y-0.5 text-xs">
              <h2 className="font-bold text-base text-zinc-900 leading-tight">{biz.businessName}</h2>
              {biz.address && <p className="text-zinc-600 text-[11px] leading-relaxed">{biz.address}</p>}
              <div className="text-zinc-600 text-[11px] space-y-0.5 pt-0.5">
                {biz.phone && <span>Phone: {biz.phone} · </span>}
                {biz.email && <span>Email: {biz.email}</span>}
                {biz.gstin && <p className="font-semibold text-zinc-800">GSTIN: {biz.gstin}</p>}
                {biz.state && <p>State: {biz.state}</p>}
              </div>
            </div>
          </div>

          {/* Col 2: Document Title & Metadata (3 cols) */}
          <div className="md:col-span-3 border-l md:border-r border-zinc-200 px-3 text-xs space-y-1">
            <span className="inline-block px-3 py-1 bg-[#1E2430] text-white font-bold text-xs rounded tracking-wider uppercase">
              {d.docTitle}
            </span>
            <div className="space-y-0.5 pt-1">
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
              <p className="text-[11px]">
                <span className="text-zinc-500">Place of Supply: </span>
                <span className="font-medium text-zinc-800">{record.placeOfSupply || cust.state || '-'}</span>
              </p>
            </div>
          </div>

          {/* Col 3: Customer Billing Information (4 cols) */}
          <div className="md:col-span-4 text-xs space-y-0.5 pl-2">
            <span className="font-bold text-zinc-800 text-[11px] uppercase tracking-wider block mb-0.5">
              Bill To / Consignee
            </span>
            <p className="font-bold text-sm text-zinc-900">{cust.companyName || cust.name}</p>
            {cust.companyName && cust.name && (
              <p className="text-zinc-600 text-[11px]">Attn: {cust.name}</p>
            )}
            {cust.billingAddress && (
              <p className="text-zinc-600 text-[11px] leading-relaxed">{cust.billingAddress}</p>
            )}
            <div className="text-zinc-600 text-[11px] space-y-0.5 pt-0.5">
              {cust.phone && <span>Phone: {cust.phone} · </span>}
              {cust.email && <span>Email: {cust.email}</span>}
              {cust.gstin && <p className="font-semibold text-zinc-800">GSTIN: {cust.gstin}</p>}
              {cust.state && <p>State: {cust.state}</p>}
            </div>
          </div>
        </div>

        {/* Wide Full 10-Column Data Table */}
        {record.layoutSnapshot?.columns && record.layoutSnapshot.columns.length > 0 ? (
          <CustomItemTableRenderer
            layoutSnapshot={record.layoutSnapshot}
            items={d.items}
            accentColor="#1E2430"
            borderColor="#2D3748"
            isGst={d.isGst}
            totalDiscount={d.totalDiscount}
            grandTotal={d.grandTotal}
            formatCurrency={d.formatINR}
          />
        ) : (
        <div className="border border-zinc-200 rounded-sm overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-800 text-white font-semibold text-[11px]">
                <th className="py-2 px-3 w-10 text-center border-r border-zinc-700">#</th>
                <th className="py-2 px-3 border-r border-zinc-700">Item Name &amp; Description</th>
                {d.isGst && <th className="py-2 px-2 w-20 text-center border-r border-zinc-700">HSN/SAC</th>}
                <th className="py-2 px-2 w-16 text-right border-r border-zinc-700">Quantity</th>
                <th className="py-2 px-2 w-16 text-center border-r border-zinc-700">Unit</th>
                <th className="py-2 px-2 w-24 text-right border-r border-zinc-700">Rate</th>
                {d.totalDiscount > 0 && (
                  <th className="py-2 px-2 w-20 text-right border-r border-zinc-700">Discount</th>
                )}
                {d.isGst && (
                  <>
                    <th className="py-2 px-2 w-24 text-right border-r border-zinc-700">Taxable</th>
                    <th className="py-2 px-2 w-24 text-right border-r border-zinc-700">GST % (Tax)</th>
                  </>
                )}
                <th className="py-2 px-3 w-28 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {d.items.map((item, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/50">
                  <td className="py-2 px-3 text-center border-r border-zinc-200 text-zinc-500">{idx + 1}</td>
                  <td className="py-2 px-3 border-r border-zinc-200">
                    <p className="font-semibold text-zinc-900">{item.name}</p>
                    {item.description && (
                      <p className="text-[11px] text-zinc-500 whitespace-pre-line mt-0.5">{item.description}</p>
                    )}
                  </td>
                  {d.isGst && (
                    <td className="py-2 px-2 text-center border-r border-zinc-200 text-zinc-600 font-mono text-[11px]">
                      {item.hsnSac || '-'}
                    </td>
                  )}
                  <td className="py-2 px-2 text-right border-r border-zinc-200 text-zinc-800 font-medium">
                    {item.quantity}
                  </td>
                  <td className="py-2 px-2 text-center border-r border-zinc-200 text-zinc-600 text-[11px]">
                    {item.unit}
                  </td>
                  <td className="py-2 px-2 text-right border-r border-zinc-200 text-zinc-800 font-mono">
                    {d.formatINR(item.rate)}
                  </td>
                  {d.totalDiscount > 0 && (
                    <td className="py-2 px-2 text-right border-r border-zinc-200 text-zinc-600 font-mono">
                      {item.discountAmount > 0 ? d.formatINR(item.discountAmount) : '-'}
                    </td>
                  )}
                  {d.isGst && (
                    <>
                      <td className="py-2 px-2 text-right border-r border-zinc-200 text-zinc-800 font-mono">
                        {d.formatINR(item.taxableAmount)}
                      </td>
                      <td className="py-2 px-2 text-right border-r border-zinc-200 text-zinc-600 font-mono text-[11px]">
                        {item.taxRate}% ({d.formatINR(item.taxAmount)})
                      </td>
                    </>
                  )}
                  <td className="py-2 px-3 text-right font-bold text-zinc-900 font-mono">
                    {d.formatINR(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-100 font-bold text-zinc-900 border-t border-zinc-300 text-xs">
                <td colSpan={d.isGst ? (d.totalDiscount > 0 ? 8 : 7) : d.totalDiscount > 0 ? 6 : 5} className="py-2 px-3 text-right border-r border-zinc-200">
                  Total Quantities: {d.items.reduce((s, it) => s + (it.quantity || 0), 0)}
                </td>
                <td className="py-2 px-3 text-right font-mono font-bold text-zinc-900">
                  {d.formatINR(d.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        )}

        {/* Expansive 3-Column Landscape Footer */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 text-xs pt-1">
          {/* Section 1: Bank & UPI QR (4 cols) */}
          <div className="md:col-span-4 p-3 border border-zinc-200 rounded-sm bg-zinc-50/60 flex items-start justify-between gap-3">
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

          {/* Section 2: Words, Notes, Terms (4 cols) */}
          <div className="md:col-span-4 space-y-2">
            <div className="p-2.5 border border-zinc-200 rounded-sm bg-zinc-50/40">
              <span className="font-bold text-zinc-700 text-[10px] block uppercase tracking-wider">
                Invoice Amount In Words
              </span>
              <p className="text-zinc-900 font-medium italic text-[11px] mt-0.5">{d.amountInWords}</p>
            </div>
            {d.terms && (
              <div className="text-[11px] text-zinc-600">
                <span className="font-bold text-zinc-700 block">Terms &amp; Conditions:</span>
                <p className="whitespace-pre-line mt-0.5">{d.terms}</p>
              </div>
            )}
          </div>

          {/* Section 3: Summary Totals & Signatory (4 cols) */}
          <div className="md:col-span-4 space-y-2">
            <div className="border border-zinc-300 rounded-sm overflow-hidden text-xs">
              <div className="divide-y divide-zinc-200 bg-white">
                <div className="flex justify-between py-1 px-3">
                  <span className="text-zinc-600">Taxable Value</span>
                  <span className="font-mono">{d.formatINR(d.taxableAmount)}</span>
                </div>
                {d.isGst && (
                  <div className="flex justify-between py-1 px-3">
                    <span className="text-zinc-600">Total GST</span>
                    <span className="font-mono">{d.formatINR(d.totalTax)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 px-3 font-bold bg-zinc-100 text-zinc-900 border-t border-zinc-300">
                  <span>Grand Total</span>
                  <span className="font-mono text-sm">{d.formatINR(d.grandTotal)}</span>
                </div>
                {d.isInvoice && (
                  <>
                    <div className="flex justify-between py-1 px-3">
                      <span className="text-zinc-600">Received</span>
                      <span className="font-mono text-emerald-700">{d.formatINR(d.amountPaid)}</span>
                    </div>
                    <div className="flex justify-between py-1 px-3 font-semibold bg-zinc-50">
                      <span className="text-zinc-800">Balance Due</span>
                      <span className="font-mono text-zinc-900">{d.formatINR(d.balanceDue)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Signature Box */}
            <div className="border border-blue-200 bg-blue-50/40 rounded-sm p-2 text-center">
              <span className="text-[10px] text-zinc-600 block">
                For: <span className="font-semibold text-zinc-800">{biz.businessName}</span>
              </span>
              <div className="h-10 flex items-center justify-center">
                {biz.signatureDataUrl ? (
                  <img
                    src={biz.signatureDataUrl}
                    alt="Signature"
                    className="max-h-10 max-w-[120px] object-contain"
                  />
                ) : (
                  <div className="border-b border-zinc-300 w-28 h-5" />
                )}
              </div>
              <span className="text-[10px] font-semibold text-zinc-800 block">
                {d.signatureLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
