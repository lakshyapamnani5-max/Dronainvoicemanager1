import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { buildUpiPaymentUri, formatINRForPdf } from '../shared/gstCalculator';
import type {
  Invoice,
  OutstandingReportRow,
  Payment,
  Quotation,
  TemplateId,
} from '../shared/types';
import { formatDate } from './utils';

async function generateUpiQrDataUrl(
  upiId: string,
  name: string,
  amount: number,
  docNumber?: string
): Promise<string | null> {
  const upiUri = buildUpiPaymentUri({ upiId, payeeName: name, amount, docNumber });
  if (!upiUri) return null;
  try {
    return await QRCode.toDataURL(upiUri, { margin: 1, width: 180 });
  } catch {
    return null;
  }
}

async function loadLogoForPdf(
  dataUrl: string,
  maxW = 28,
  maxH = 18
): Promise<{ pngDataUrl: string; drawW: number; drawH: number } | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return { pngDataUrl: dataUrl, drawW: 18, drawH: 18 };
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 100;
      const h = img.naturalHeight || 100;
      const scale = Math.min(maxW / w, maxH / h);
      const drawW = Math.max(6, w * scale);
      const drawH = Math.max(4, h * scale);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(480, Math.max(64, w));
        canvas.height = Math.max(1, Math.round((canvas.width * h) / w));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ pngDataUrl: canvas.toDataURL('image/png'), drawW, drawH });
          return;
        }
      } catch {
        // fallback below
      }
      resolve({ pngDataUrl: dataUrl, drawW, drawH });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function generateDocumentPdf(
  docType: 'invoice' | 'quotation',
  record: Invoice | Quotation,
  overrideTemplate?: TemplateId
): Promise<void> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 14;
  const templateId = overrideTemplate || record.templateId || 'classic_gst';

  const biz = record.businessSnapshot;
  const cust = record.customerSnapshot;
  const isInvoice = docType === 'invoice';
  const inv = isInvoice ? (record as Invoice) : null;
  const quo = !isInvoice ? (record as Quotation) : null;
  const docNumber = inv ? inv.invoiceNumber : quo!.quotationNumber;
  const docTitle = isInvoice ? (record.isGst ? 'TAX INVOICE' : 'BILL OF SUPPLY') : 'QUOTATION';

  const accentRgb: [number, number, number] =
    templateId === 'executive_minimal'
      ? [24, 24, 27]
      : templateId === 'compact_commercial'
        ? [39, 39, 42]
        : [245, 124, 0];

  // Top Header Strip
  if (templateId === 'classic_gst') {
    pdf.setFillColor(...accentRgb);
    pdf.rect(0, 0, pageWidth, 4, 'F');
  }

  let y = 14;

  // Business Logo if data URL provided (aspect-preserved)
  const logoInfo = biz.logoDataUrl ? await loadLogoForPdf(biz.logoDataUrl) : null;
  if (logoInfo) {
    try {
      const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(logoInfo.pngDataUrl, fmt, margin, y, logoInfo.drawW, logoInfo.drawH);
    } catch {
      // ignore invalid image
    }
  }

  const textLeft = logoInfo ? margin + logoInfo.drawW + 4 : margin;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(24, 24, 27);
  pdf.text(biz.businessName || 'DRONA Business', textLeft, y + 5);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(82, 82, 91);
  let bizMetaY = y + 10;
  if (biz.address) {
    const addrLines = pdf.splitTextToSize(biz.address, Math.max(60, 108 - (textLeft - margin)));
    pdf.text(addrLines, textLeft, bizMetaY);
    bizMetaY += addrLines.length * 4;
  }
  const contactLine = [biz.phone, biz.email].filter(Boolean).join('  |  ');
  if (contactLine) {
    pdf.text(contactLine, textLeft, bizMetaY);
    bizMetaY += 4;
  }
  if (biz.gstin) {
    pdf.text(`GSTIN: ${biz.gstin}   State: ${biz.state}`, textLeft, bizMetaY);
    bizMetaY += 4;
  } else if (biz.state) {
    pdf.text(`State: ${biz.state}`, textLeft, bizMetaY);
    bizMetaY += 4;
  }

  // Right Side Document Title & Metadata
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(...accentRgb);
  pdf.text(docTitle, pageWidth - margin, y + 5, { align: 'right' });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(24, 24, 27);
  pdf.text(docNumber, pageWidth - margin, y + 11, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(82, 82, 91);
  if (inv) {
    pdf.text(`Invoice Date: ${formatDate(inv.invoiceDate)}`, pageWidth - margin, y + 16, { align: 'right' });
    pdf.text(`Due Date: ${formatDate(inv.dueDate)}`, pageWidth - margin, y + 20.5, { align: 'right' });
    pdf.text(`Status: ${inv.status.replace('_', ' ').toUpperCase()}`, pageWidth - margin, y + 25, { align: 'right' });
  } else if (quo) {
    pdf.text(`Quotation Date: ${formatDate(quo.quotationDate)}`, pageWidth - margin, y + 16, { align: 'right' });
    pdf.text(`Valid Until: ${formatDate(quo.validUntil)}`, pageWidth - margin, y + 20.5, { align: 'right' });
    pdf.text(`Status: ${quo.status.toUpperCase()}`, pageWidth - margin, y + 25, { align: 'right' });
  }

  y = Math.max(bizMetaY + 4, y + (logoInfo ? logoInfo.drawH + 4 : 0), y + 32);
  pdf.setDrawColor(228, 228, 231);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Bill To & Supply Metadata
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(113, 113, 122);
  pdf.text('BILL TO', margin, y);
  pdf.text('SUPPLY DETAILS', pageWidth / 2 + 6, y);
  y += 4.5;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(24, 24, 27);
  pdf.text(cust.companyName || cust.name, margin, y);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(63, 63, 70);
  let custY = y + 4.5;
  if (cust.companyName && cust.name) {
    pdf.text(`Attn: ${cust.name}`, margin, custY);
    custY += 4;
  }
  if (cust.billingAddress) {
    const cAddr = pdf.splitTextToSize(cust.billingAddress, 85);
    pdf.text(cAddr, margin, custY);
    custY += cAddr.length * 4;
  }
  const cContact = [cust.phone, cust.email].filter(Boolean).join('  |  ');
  if (cContact) {
    pdf.text(cContact, margin, custY);
    custY += 4;
  }
  if (cust.gstin) {
    pdf.text(`GSTIN: ${cust.gstin}`, margin, custY);
    custY += 4;
  }

  let supY = y;
  pdf.text(`Place of Supply: ${record.placeOfSupply || cust.state}`, pageWidth / 2 + 6, supY);
  supY += 4.5;
  if (record.isGst) {
    pdf.text(
      `Tax Regime: ${record.isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'} (${record.taxMode})`,
      pageWidth / 2 + 6,
      supY
    );
    supY += 4.5;
  }
  if (record.referenceNumber) {
    pdf.text(`Reference / PO: ${record.referenceNumber}`, pageWidth / 2 + 6, supY);
    supY += 4.5;
  }
  if (inv?.paymentTerms) {
    pdf.text(`Terms: ${inv.paymentTerms}`, pageWidth / 2 + 6, supY);
    supY += 4.5;
  }

  y = Math.max(custY, supY) + 5;

  // Itemized Table
  const isCompact = templateId === 'compact_commercial';
  const head = record.isGst
    ? [['#', 'Item & Description', 'HSN/SAC', 'Qty', 'Rate', 'Disc.', 'Taxable', 'GST', 'Total']]
    : [['#', 'Item & Description', 'Qty', 'Rate', 'Disc.', 'Total']];

  const body = record.items.map((item, idx) => {
    const desc = item.description ? `${item.name}\n${item.description}` : item.name;
    const discLabel =
      item.discountAmount > 0 ? formatINRForPdf(item.discountAmount).replace('INR ', '') : '-';
    if (record.isGst) {
      return [
        String(idx + 1),
        desc,
        item.hsnSac || '-',
        `${item.quantity} ${item.unit}`,
        formatINRForPdf(item.rate).replace('INR ', ''),
        discLabel,
        formatINRForPdf(item.taxableAmount).replace('INR ', ''),
        `${item.taxRate}%\n${formatINRForPdf(item.taxAmount).replace('INR ', '')}`,
        formatINRForPdf(item.totalAmount).replace('INR ', ''),
      ];
    }
    return [
      String(idx + 1),
      desc,
      `${item.quantity} ${item.unit}`,
      formatINRForPdf(item.rate).replace('INR ', ''),
      discLabel,
      formatINRForPdf(item.totalAmount).replace('INR ', ''),
    ];
  });

  autoTable(pdf, {
    startY: y,
    head,
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: {
      fontSize: isCompact ? 7.5 : 8.2,
      cellPadding: isCompact ? 1.8 : 2.6,
      textColor: [24, 24, 27],
      lineColor: [228, 228, 231],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: accentRgb,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: record.isGst
      ? {
          0: { halign: 'center', cellWidth: 8 },
          2: { halign: 'center', cellWidth: 18 },
          3: { halign: 'right', cellWidth: 16 },
          4: { halign: 'right', cellWidth: 21 },
          5: { halign: 'right', cellWidth: 17 },
          6: { halign: 'right', cellWidth: 22 },
          7: { halign: 'right', cellWidth: 20 },
          8: { halign: 'right', cellWidth: 23, fontStyle: 'bold' },
        }
      : {
          0: { halign: 'center', cellWidth: 9 },
          2: { halign: 'right', cellWidth: 20 },
          3: { halign: 'right', cellWidth: 26 },
          4: { halign: 'right', cellWidth: 22 },
          5: { halign: 'right', cellWidth: 28, fontStyle: 'bold' },
        },
  });

  const tableEndY = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 30;
  let bottomY = tableEndY + 7;

  if (bottomY > 235) {
    pdf.addPage();
    bottomY = 18;
  }

  // Left: Amount in words + Bank / UPI QR
  const leftWidth = 102;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(113, 113, 122);
  pdf.text('AMOUNT IN WORDS', margin, bottomY);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(24, 24, 27);
  const wordsLines = pdf.splitTextToSize(record.amountInWords, leftWidth);
  pdf.text(wordsLines, margin, bottomY + 4.5);

  let bankY = bottomY + 4.5 + wordsLines.length * 4 + 4;
  if (biz.bankName || biz.upiId) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(113, 113, 122);
    pdf.text('PAYMENT DETAILS', margin, bankY);
    bankY += 4;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(63, 63, 70);
    if (biz.bankName) {
      pdf.text(`Bank: ${biz.bankName}`, margin, bankY);
      bankY += 3.8;
    }
    if (biz.accountNumber) {
      pdf.text(`A/C: ${biz.accountNumber}  |  IFSC: ${biz.ifsc}`, margin, bankY);
      bankY += 3.8;
    }
    if (biz.upiId) {
      pdf.text(`UPI ID: ${biz.upiId}`, margin, bankY);
      bankY += 4;
    }
  }

  const qrAmount = inv
    ? inv.balanceDue > 0
      ? inv.balanceDue
      : inv.grandTotal
    : record.grandTotal;
  const cleanUpiId = (biz.upiId || '').trim();
  const qrData = cleanUpiId
    ? await generateUpiQrDataUrl(cleanUpiId, biz.businessName, qrAmount, docNumber)
    : biz.upiQrDataUrl || null;

  if (qrData && qrData.startsWith('data:image/')) {
    try {
      pdf.addImage(qrData, 'PNG', margin, bankY + 1, 22, 22);
      pdf.setFontSize(7);
      pdf.setTextColor(113, 113, 122);
      const qrCaption =
        qrAmount > 0 ? `Scan to Pay (${formatINRForPdf(qrAmount)})` : 'Scan to Pay (UPI)';
      pdf.text(qrCaption, margin, bankY + 26);
    } catch {
      // ignore QR draw failure
    }
  }

  // Right: Totals Summary
  const sumX = pageWidth - margin - 72;
  const valX = pageWidth - margin;
  let sy = bottomY;
  const drawSumRow = (label: string, val: string, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 9.5 : 8.5);
    pdf.setTextColor(bold ? 24 : 82, bold ? 24 : 82, bold ? 27 : 91);
    pdf.text(label, sumX, sy);
    pdf.text(val, valX, sy, { align: 'right' });
    sy += bold ? 5.5 : 4.5;
  };

  drawSumRow('Subtotal', formatINRForPdf(record.subtotal));
  if (record.totalDiscount > 0) {
    drawSumRow('Discount', `-${formatINRForPdf(record.totalDiscount)}`);
  }
  drawSumRow('Taxable Value', formatINRForPdf(record.taxableAmount));
  if (record.isGst) {
    if (record.isInterState) {
      drawSumRow('IGST', formatINRForPdf(record.igstTotal));
    } else {
      drawSumRow('CGST', formatINRForPdf(record.cgstTotal));
      drawSumRow('SGST', formatINRForPdf(record.sgstTotal));
    }
  }
  if (record.roundOff !== 0) {
    drawSumRow('Round Off', formatINRForPdf(record.roundOff));
  }
  pdf.setDrawColor(212, 212, 216);
  pdf.line(sumX, sy - 2, valX, sy - 2);
  sy += 2;
  drawSumRow('Grand Total', formatINRForPdf(record.grandTotal), true);

  if (inv && inv.amountPaid > 0) {
    drawSumRow('Amount Paid', formatINRForPdf(inv.amountPaid));
    if (inv.amountPaid > inv.grandTotal) {
      drawSumRow('Excess / Advance', formatINRForPdf(inv.amountPaid - inv.grandTotal));
    }
    drawSumRow('Balance Due', formatINRForPdf(inv.balanceDue), true);
  }

  // Terms & Signatory at bottom
  const footerY = Math.max(bankY + 30, sy + 10, 248);
  if (record.terms) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(113, 113, 122);
    pdf.text('TERMS & CONDITIONS', margin, footerY);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(82, 82, 91);
    pdf.text(pdf.splitTextToSize(record.terms, 110), margin, footerY + 4);
  }

  const sigInfo = biz.signatureDataUrl
    ? await loadLogoForPdf(biz.signatureDataUrl, 40, 12)
    : null;
  if (sigInfo) {
    try {
      const fmt = sigInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      const sigX = pageWidth - margin - sigInfo.drawW;
      const sigY = footerY + 13 - sigInfo.drawH;
      pdf.addImage(sigInfo.pngDataUrl, fmt, sigX, sigY, sigInfo.drawW, sigInfo.drawH);
    } catch {
      // ignore invalid signature image
    }
  }

  pdf.setDrawColor(161, 161, 170);
  pdf.line(pageWidth - margin - 52, footerY + 14, pageWidth - margin, footerY + 14);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(24, 24, 27);
  pdf.text(biz.signatureLabel || 'Authorized Signatory', pageWidth - margin, footerY + 18.5, {
    align: 'right',
  });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(140, 140, 150);
  pdf.text('Generated by DronaInvoice', pageWidth / 2, 289, { align: 'center' });

  pdf.save(`${docNumber}.pdf`);
}

export function generatePaymentReceiptPdf(
  payment: Payment,
  businessName: string,
  businessAddress: string
): void {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const w = pdf.internal.pageSize.getWidth();

  pdf.setFillColor(245, 124, 0);
  pdf.rect(0, 0, w, 4, 'F');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('PAYMENT RECEIPT', 14, 18);

  pdf.setFontSize(10);
  pdf.setTextColor(245, 124, 0);
  pdf.text(payment.receiptNumber, w - 14, 18, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(63, 63, 70);
  pdf.text(businessName, 14, 26);
  if (businessAddress) {
    pdf.text(pdf.splitTextToSize(businessAddress, w - 28), 14, 31);
  }

  autoTable(pdf, {
    startY: 46,
    margin: { left: 14, right: 14 },
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: 3 },
    body: [
      ['Customer', payment.customerName || '—'],
      ['Invoice Reference', payment.invoiceNumber || payment.invoiceId],
      ['Payment Date', formatDate(payment.paymentDate)],
      ['Payment Method', payment.paymentMethod],
      ['Transaction / Ref ID', payment.referenceId || '—'],
      ['Amount Received', formatINRForPdf(payment.amount)],
      ['Notes', payment.notes || '—'],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [113, 113, 122], cellWidth: 48 },
      1: { textColor: [24, 24, 27] },
    },
  });

  const receiptH = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(140, 140, 150);
  pdf.text('Generated by DronaInvoice', w / 2, receiptH - 8, { align: 'center' });

  pdf.save(`${payment.receiptNumber}.pdf`);
}

export function generateOutstandingPdf(
  businessName: string,
  rows: OutstandingReportRow[]
): void {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(`${businessName} — Customer Outstanding Report`, 14, 16);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Generated on ${formatDate(new Date().toISOString())}`, 14, 22);

  autoTable(pdf, {
    startY: 28,
    margin: { left: 14, right: 14 },
    headStyles: { fillColor: [245, 124, 0], textColor: [255, 255, 255] },
    head: [
      [
        'Customer',
        'Total Invoiced',
        'Amount Paid',
        'Outstanding Balance',
        'Unpaid Invoices',
        'Overdue Amount',
        'Oldest Due Date',
      ],
    ],
    body: rows.map((r) => [
      r.companyName ? `${r.companyName} (${r.customerName})` : r.customerName,
      formatINRForPdf(r.totalInvoiced),
      formatINRForPdf(r.amountPaid),
      formatINRForPdf(r.outstandingBalance),
      String(r.unpaidInvoiceCount),
      formatINRForPdf(r.overdueAmount),
      formatDate(r.oldestDueDate),
    ]),
  });

  const outW = pdf.internal.pageSize.getWidth();
  const outH = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(140, 140, 150);
  pdf.text('Generated by DronaInvoice', outW / 2, outH - 8, { align: 'center' });

  pdf.save('customer-outstanding-report.pdf');
}
