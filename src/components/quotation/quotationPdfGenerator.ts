import jsPDFModule from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import { formatINRForPdf } from '../../shared/gstCalculator';
import type { Quotation, TemplateId } from '../../shared/types';
import { formatDate } from '../../lib/utils';
import { resolveLatestDocumentForDownload } from '../../lib/liveSnapshots';
import { normalizeQuotationTemplateId } from './quotationThemeRegistry';
import type { QuotationTemplateId } from './quotationThemeTypes';

const jsPDF = (jsPDFModule as unknown as { jsPDF?: typeof jsPDFModule }).jsPDF || jsPDFModule;

interface ThemePalette {
  id: QuotationTemplateId;
  fontHeading: 'helvetica' | 'times';
  isEditorialSerif: boolean;
  isLandscape: boolean;
  margin: number;
  pageBg: [number, number, number] | null;
  primaryRgb: [number, number, number];
  accentRgb: [number, number, number];
  headerBg: [number, number, number];
  headerText: [number, number, number];
  softFill: [number, number, number];
  borderRgb: [number, number, number];
  totalBarBg: [number, number, number];
  totalBarText: [number, number, number];
  headingLabel: string;
}

function getThemePalette(id: QuotationTemplateId): ThemePalette {
  switch (id) {
    case 'executive_gold':
      return {
        id,
        fontHeading: 'times',
        isEditorialSerif: true,
        isLandscape: false,
        margin: 15,
        pageBg: [250, 247, 240],
        primaryRgb: [34, 30, 24],
        accentRgb: [200, 164, 93],
        headerBg: [246, 239, 224],
        headerText: [92, 70, 24],
        softFill: [252, 251, 247],
        borderRgb: [223, 210, 181],
        totalBarBg: [244, 235, 214],
        totalBarText: [122, 87, 21],
        headingLabel: 'Quotation Total',
      };
    case 'modern_minimal':
      return {
        id,
        fontHeading: 'helvetica',
        isEditorialSerif: false,
        isLandscape: false,
        margin: 16,
        pageBg: null,
        primaryRgb: [15, 23, 42],
        accentRgb: [245, 124, 0],
        headerBg: [255, 255, 255],
        headerText: [113, 113, 122],
        softFill: [250, 250, 250],
        borderRgb: [228, 228, 231],
        totalBarBg: [255, 255, 255],
        totalBarText: [9, 9, 11],
        headingLabel: 'Estimated Total',
      };
    case 'corporate_blue':
      return {
        id,
        fontHeading: 'helvetica',
        isEditorialSerif: false,
        isLandscape: false,
        margin: 14,
        pageBg: null,
        primaryRgb: [15, 39, 68],
        accentRgb: [30, 58, 95],
        headerBg: [30, 58, 95],
        headerText: [255, 255, 255],
        softFill: [239, 244, 250],
        borderRgb: [203, 213, 225],
        totalBarBg: [15, 39, 68],
        totalBarText: [255, 255, 255],
        headingLabel: 'Estimated Total',
      };
    case 'french_classic':
      return {
        id,
        fontHeading: 'times',
        isEditorialSerif: true,
        isLandscape: false,
        margin: 17,
        pageBg: null,
        primaryRgb: [17, 17, 17],
        accentRgb: [115, 115, 115],
        headerBg: [255, 255, 255],
        headerText: [82, 82, 82],
        softFill: [247, 247, 246],
        borderRgb: [212, 212, 212],
        totalBarBg: [255, 255, 255],
        totalBarText: [17, 17, 17],
        headingLabel: 'Quotation Total',
      };
    case 'drona_signature':
      return {
        id,
        fontHeading: 'helvetica',
        isEditorialSerif: false,
        isLandscape: false,
        margin: 14,
        pageBg: null,
        primaryRgb: [24, 24, 27],
        accentRgb: [245, 124, 0],
        headerBg: [24, 24, 27],
        headerText: [255, 255, 255],
        softFill: [250, 250, 250],
        borderRgb: [228, 228, 231],
        totalBarBg: [24, 24, 27],
        totalBarText: [245, 124, 0],
        headingLabel: 'Quotation Total',
      };
    case 'landscape_pro':
      return {
        id,
        fontHeading: 'helvetica',
        isEditorialSerif: false,
        isLandscape: true,
        margin: 12,
        pageBg: null,
        primaryRgb: [15, 23, 42],
        accentRgb: [51, 65, 85],
        headerBg: [30, 41, 59],
        headerText: [255, 255, 255],
        softFill: [248, 250, 252],
        borderRgb: [203, 213, 225],
        totalBarBg: [15, 23, 42],
        totalBarText: [255, 255, 255],
        headingLabel: 'Quotation Total',
      };
  }
}

async function loadImageForPdf(
  dataUrl: string,
  maxW = 28,
  maxH = 16
): Promise<{ pngDataUrl: string; drawW: number; drawH: number } | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return { pngDataUrl: dataUrl, drawW: Math.min(maxW, 18), drawH: Math.min(maxH, 14) };
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
        // ignore canvas error
      }
      resolve({ pngDataUrl: dataUrl, drawW, drawH });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function paintPageFrameIfNeeded(
  pdf: InstanceType<typeof jsPDF>,
  palette: ThemePalette
) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  if (palette.pageBg) {
    pdf.setFillColor(palette.pageBg[0], palette.pageBg[1], palette.pageBg[2]);
    pdf.rect(0, 0, pw, ph, 'F');
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(palette.borderRgb[0], palette.borderRgb[1], palette.borderRgb[2]);
    pdf.setLineWidth(0.35);
    pdf.rect(8, 8, pw - 16, ph - 16, 'FD');
  } else if (palette.id === 'modern_minimal') {
    pdf.setFillColor(palette.accentRgb[0], palette.accentRgb[1], palette.accentRgb[2]);
    pdf.rect(0, 0, pw, 2.2, 'F');
  }
}

function addImgSafe(
  pdf: InstanceType<typeof jsPDF>,
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  try {
    const fmt = dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg') ? 'JPEG' : 'PNG';
    pdf.addImage(dataUrl, fmt, x, y, w, h);
  } catch {
    // ignore malformed image bytes in non-DOM/test environment
  }
}

export async function buildQuotationPdfDocument(
  inputRecord: Quotation,
  overrideTemplate?: TemplateId
): Promise<{ pdf: InstanceType<typeof jsPDF>; fileName: string; themeId: QuotationTemplateId }> {
  const record = await resolveLatestDocumentForDownload(inputRecord);
  const themeId = normalizeQuotationTemplateId(overrideTemplate || record.templateId);
  const palette = getThemePalette(themeId);

  const pdf = new jsPDF({
    orientation: palette.isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const m = palette.margin;
  const contentW = pw - m * 2;

  const biz = record.businessSnapshot;
  const cust = record.customerSnapshot;
  const quotationTitle = (record.quotationTitle || '').trim() || 'QUOTATION';
  const quotationNumber = record.quotationNumber || 'QTN-0001';
  const quotationDate = record.quotationDate ? formatDate(record.quotationDate) : '';
  const validUntil = record.validUntil ? formatDate(record.validUntil) : '';
  const referenceNumber = (record.referenceNumber || '').trim();
  const deliveryTimeline = (record.deliveryTimeline || '').trim();
  const paymentTerms = (record.paymentTerms || '').trim();
  const preparedBy = (record.preparedBy || '').trim() || biz.ownerName || '';
  const projectDescription = (record.projectDescription || '').trim();
  const showPaymentInstructions = Boolean(
    record.showPaymentInstructions && (record.paymentInstructions || '').trim()
  );
  const paymentInstructions = showPaymentInstructions
    ? (record.paymentInstructions || '').trim()
    : '';
  const notes = (record.notes || '').trim();
  const terms = (record.terms || '').trim();
  const isGst = Boolean(record.isGst);
  const hasInterState = Boolean(record.isInterState);
  const hasDiscount = (record.totalDiscount || 0) > 0;
  const signatureLabel = biz.signatureLabel || 'Authorized Signatory';

  const logoInfo = biz.logoDataUrl ? await loadImageForPdf(biz.logoDataUrl, 26, 15) : null;
  const sigInfo = biz.signatureDataUrl ? await loadImageForPdf(biz.signatureDataUrl, 34, 13) : null;

  paintPageFrameIfNeeded(pdf, palette);

  let y = m;

  // ==========================
  // THEME-DISTINCT HEADER + METADATA
  // ==========================
  if (themeId === 'executive_gold') {
    let leftX = m;
    if (logoInfo) {
      addImgSafe(pdf, logoInfo.pngDataUrl, leftX, y, logoInfo.drawW, logoInfo.drawH);
      leftX += logoInfo.drawW + 4;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(29, 25, 18);
    pdf.text(biz.businessName || 'Business Name', leftX, y + 4.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(94, 86, 72);
    let bY = y + 9;
    if (biz.address) {
      const addrLines = pdf.splitTextToSize(biz.address, 78);
      pdf.text(addrLines, leftX, bY);
      bY += addrLines.length * 3.6;
    }
    const contact = [biz.phone ? `Tel: ${biz.phone}` : '', biz.email].filter(Boolean).join('  ·  ');
    if (contact) {
      pdf.text(contact, leftX, bY);
      bY += 3.6;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN: ${biz.gstin}`, leftX, bY);
      bY += 3.6;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(154, 120, 50);
    pdf.text('COMMERCIAL PROPOSAL', pw - m, y + 3.5, { align: 'right' });

    pdf.setFont('times', 'bold');
    pdf.setFontSize(22);
    pdf.setTextColor(34, 30, 24);
    pdf.text(quotationTitle, pw - m, y + 11.5, { align: 'right' });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(138, 105, 40);
    pdf.text(`#${quotationNumber}`, pw - m, y + 16.5, { align: 'right' });

    y = Math.max(bY + 2, y + 21);
    pdf.setDrawColor(200, 164, 93);
    pdf.setLineWidth(0.5);
    pdf.line(m, y, pw - m, y);
    y += 5;
  } else if (themeId === 'modern_minimal') {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(23);
    pdf.setTextColor(9, 9, 11);
    pdf.text(quotationTitle.toUpperCase(), m, y + 7);
    pdf.setDrawColor(245, 124, 0);
    pdf.setLineWidth(0.9);
    pdf.line(m, y + 9.5, m + 42, y + 9.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(113, 113, 122);
    pdf.text(`Quotation No: ${quotationNumber}   ·   Issued: ${quotationDate}`, m, y + 15);
    if (validUntil) {
      pdf.setTextColor(217, 107, 0);
      pdf.text(`Valid Until: ${validUntil}`, m, y + 19.2);
    }

    let rY = y + 2;
    if (logoInfo) {
      addImgSafe(pdf, logoInfo.pngDataUrl, pw - m - logoInfo.drawW, rY, logoInfo.drawW, logoInfo.drawH);
      rY += logoInfo.drawH + 2.5;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(9, 9, 11);
    pdf.text(biz.businessName || 'Business Name', pw - m, rY + 2, { align: 'right' });
    rY += 5.8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(113, 113, 122);
    if (biz.address) {
      const aLines = pdf.splitTextToSize(biz.address, 68);
      pdf.text(aLines, pw - m, rY, { align: 'right' });
      rY += aLines.length * 3.5;
    }
    const bizLine = [biz.phone, biz.email].filter(Boolean).join(' · ');
    if (bizLine) {
      pdf.text(bizLine, pw - m, rY, { align: 'right' });
      rY += 3.5;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN: ${biz.gstin}`, pw - m, rY, { align: 'right' });
      rY += 3.5;
    }

    y = Math.max(y + 23, rY + 3);
    pdf.setDrawColor(228, 228, 231);
    pdf.setLineWidth(0.3);
    pdf.line(m, y, pw - m, y);
    y += 5;
  } else if (themeId === 'corporate_blue') {
    const headerH = 32;
    pdf.setFillColor(15, 39, 68);
    pdf.rect(0, 0, pw, headerH, 'F');

    let leftX = m;
    if (logoInfo) {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(leftX, 6.5, logoInfo.drawW + 3, logoInfo.drawH + 3, 1.5, 1.5, 'F');
      addImgSafe(pdf, logoInfo.pngDataUrl, leftX + 1.5, 8, logoInfo.drawW, logoInfo.drawH);
      leftX += logoInfo.drawW + 7;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(255, 255, 255);
    pdf.text(biz.businessName || 'Business Name', leftX, 11.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(203, 213, 225);
    if (biz.address) {
      const aLines = pdf.splitTextToSize(biz.address, 82);
      pdf.text(aLines.slice(0, 2), leftX, 16.5);
    }
    const bizLine = [biz.phone, biz.email, biz.gstin ? `GSTIN: ${biz.gstin}` : '']
      .filter(Boolean)
      .join('  |  ');
    if (bizLine) {
      pdf.text(bizLine, leftX, 26.5);
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.setTextColor(255, 255, 255);
    pdf.text(quotationTitle.toUpperCase(), pw - m, 14, { align: 'right' });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(191, 219, 254);
    pdf.text(quotationNumber, pw - m, 20.5, { align: 'right' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(203, 213, 225);
    pdf.text('ENTERPRISE PROPOSAL', pw - m, 26.5, { align: 'right' });

    y = headerH + 6;
  } else if (themeId === 'french_classic') {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(115, 115, 115);
    pdf.text('PROPOSAL  ·  ESTIMATE', m, y + 2);

    pdf.setFont('times', 'italic');
    pdf.setFontSize(26);
    pdf.setTextColor(17, 17, 17);
    pdf.text(quotationTitle === 'QUOTATION' ? 'Quotation' : quotationTitle, m, y + 11);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(64, 64, 64);
    const metaLine = [
      `No. ${quotationNumber}`,
      `Date ${quotationDate}`,
      validUntil ? `Valid Through ${validUntil}` : '',
    ]
      .filter(Boolean)
      .join('   ·   ');
    pdf.text(metaLine, m, y + 17.5);

    let rY = y;
    if (logoInfo) {
      addImgSafe(pdf, logoInfo.pngDataUrl, pw - m - logoInfo.drawW, rY, logoInfo.drawW, logoInfo.drawH);
      rY += logoInfo.drawH + 2.5;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(17, 17, 17);
    pdf.text((biz.businessName || '').toUpperCase(), pw - m, rY + 2.5, { align: 'right' });
    rY += 6;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(115, 115, 115);
    if (biz.address) {
      const aLines = pdf.splitTextToSize(biz.address, 65);
      pdf.text(aLines, pw - m, rY, { align: 'right' });
      rY += aLines.length * 3.5;
    }
    const contact = [biz.email, biz.phone].filter(Boolean).join(' · ');
    if (contact) {
      pdf.text(contact, pw - m, rY, { align: 'right' });
      rY += 3.5;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN ${biz.gstin}`, pw - m, rY, { align: 'right' });
      rY += 3.5;
    }

    y = Math.max(y + 22, rY + 3);
    pdf.setDrawColor(23, 23, 23);
    pdf.setLineWidth(0.4);
    pdf.line(m, y, pw - m, y);
    y += 5.5;
  } else if (themeId === 'drona_signature') {
    const headerH = 31;
    pdf.setFillColor(24, 24, 27);
    pdf.rect(0, 0, pw, headerH, 'F');
    pdf.setFillColor(245, 124, 0);
    pdf.rect(0, headerH, pw, 1.5, 'F');

    let leftX = m;
    if (logoInfo) {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(leftX, 6, logoInfo.drawW + 3, logoInfo.drawH + 3, 1.5, 1.5, 'F');
      addImgSafe(pdf, logoInfo.pngDataUrl, leftX + 1.5, 7.5, logoInfo.drawW, logoInfo.drawH);
      leftX += logoInfo.drawW + 7;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(255, 255, 255);
    pdf.text(biz.businessName || 'Business Name', leftX, 11);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(212, 212, 216);
    if (biz.address) {
      const aLines = pdf.splitTextToSize(biz.address, 82);
      pdf.text(aLines.slice(0, 2), leftX, 16);
    }
    const contact = [biz.phone, biz.email, biz.gstin ? `GSTIN: ${biz.gstin}` : '']
      .filter(Boolean)
      .join(' · ');
    if (contact) {
      pdf.text(contact, leftX, 25.5);
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(19);
    pdf.setTextColor(245, 124, 0);
    pdf.text(quotationTitle.toUpperCase(), pw - m, 14, { align: 'right' });

    pdf.setFillColor(39, 39, 42);
    pdf.roundedRect(pw - m - 44, 17.5, 44, 7.5, 1.5, 1.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    pdf.text(quotationNumber, pw - m - 22, 22.5, { align: 'center' });

    y = headerH + 7;
  } else {
    // Theme 6 - Landscape Pro (297 x 210 mm compact 3-column header)
    const col1W = 94;
    const col2X = m + col1W + 6;
    const col2W = 92;
    const col3X = col2X + col2W + 6;
    const col3W = pw - m - col3X;

    let bX = m;
    if (logoInfo) {
      addImgSafe(pdf, logoInfo.pngDataUrl, m, y, logoInfo.drawW, logoInfo.drawH);
      bX += logoInfo.drawW + 3.5;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(15, 23, 42);
    pdf.text(biz.businessName || 'Business Name', bX, y + 4.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    let bY = y + 9;
    if (biz.address) {
      const aLines = pdf.splitTextToSize(biz.address, Math.max(48, col1W - (bX - m)));
      pdf.text(aLines.slice(0, 2), bX, bY);
      bY += Math.min(2, aLines.length) * 3.6;
    }
    const bContact = [biz.phone, biz.email].filter(Boolean).join(' · ');
    if (bContact) {
      pdf.text(bContact, bX, bY);
      bY += 3.6;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN: ${biz.gstin}`, bX, bY);
      bY += 3.6;
    }

    // Col 2: Client Prepared For box
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(col2X, y, col2W, 24, 1.5, 1.5, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(100, 116, 139);
    pdf.text('PREPARED FOR', col2X + 3, y + 4.2);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text(cust.companyName || cust.name || 'Customer', col2X + 3, y + 9);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(71, 85, 105);
    let cY = y + 13;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, col2W - 6);
      pdf.text(cLines.slice(0, 2), col2X + 3, cY);
      cY += Math.min(2, cLines.length) * 3.3;
    }
    const cMeta = [cust.phone, cust.gstin ? `GSTIN: ${cust.gstin}` : '']
      .filter(Boolean)
      .join(' · ');
    if (cMeta) {
      pdf.text(cMeta, col2X + 3, Math.min(y + 22, cY + 0.5));
    }

    // Col 3: Quotation Badge & Dates
    pdf.setFillColor(15, 23, 42);
    pdf.roundedRect(pw - m - Math.min(48, col3W), y, Math.min(48, col3W), 7, 1.2, 1.2, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    pdf.text(quotationTitle.toUpperCase(), pw - m - Math.min(48, col3W) / 2, y + 4.8, {
      align: 'center',
    });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text(quotationNumber, pw - m, y + 12.2, { align: 'right' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(71, 85, 105);
    let mY = y + 16.5;
    pdf.text(`Issued: ${quotationDate}`, pw - m, mY, { align: 'right' });
    mY += 3.5;
    if (validUntil) {
      pdf.setTextColor(180, 83, 9);
      pdf.text(`Valid Until: ${validUntil}`, pw - m, mY, { align: 'right' });
      mY += 3.5;
    }
    pdf.setTextColor(71, 85, 105);
    if (deliveryTimeline) {
      pdf.text(`Delivery: ${deliveryTimeline}`, pw - m, mY, { align: 'right' });
      mY += 3.5;
    }
    if (preparedBy) {
      pdf.text(`Prepared By: ${preparedBy}`, pw - m, mY, { align: 'right' });
      mY += 3.5;
    }

    y = Math.max(y + 25, bY + 2, mY + 2);
    pdf.setDrawColor(30, 41, 59);
    pdf.setLineWidth(0.5);
    pdf.line(m, y, pw - m, y);
    y += 4;
  }

  // ==========================
  // PORTRAIT CLIENT & PROPOSAL DETAILS BAND
  // ==========================
  if (!palette.isLandscape) {
    const leftW = contentW * 0.56;
    const gap = 4;
    const rightX = m + leftW + gap;
    const rightW = contentW - leftW - gap;

    const custAddrLines = cust.billingAddress ? pdf.splitTextToSize(cust.billingAddress, leftW - 7) : [];
    const custH =
      15 +
      (cust.companyName && cust.name ? 3.8 : 0) +
      custAddrLines.length * 3.6 +
      (cust.phone || cust.email || cust.gstin ? 4.5 : 0);

    const metaRows: Array<[string, string]> = [
      ['Quotation Date', quotationDate],
      ['Valid Until', validUntil || '-'],
    ];
    if (referenceNumber) metaRows.push(['Reference #', referenceNumber]);
    if (deliveryTimeline) metaRows.push(['Delivery Timeline', deliveryTimeline]);
    if (paymentTerms) metaRows.push(['Payment Terms', paymentTerms]);
    if (preparedBy) metaRows.push(['Prepared By', preparedBy]);
    const metaH = 11 + metaRows.length * 4.5;
    const boxH = Math.max(custH, metaH, 26);

    if (themeId === 'french_classic') {
      // Hairline asymmetric editorial band without boxed borders
      pdf.setDrawColor(229, 229, 229);
      pdf.setLineWidth(0.25);
      pdf.line(m + leftW + 1, y, m + leftW + 1, y + boxH);
    } else if (themeId === 'modern_minimal') {
      // Open whitespace without heavy boxes
    } else {
      pdf.setFillColor(palette.softFill[0], palette.softFill[1], palette.softFill[2]);
      pdf.setDrawColor(palette.borderRgb[0], palette.borderRgb[1], palette.borderRgb[2]);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(m, y, leftW, boxH, 1.2, 1.2, 'FD');
      pdf.roundedRect(rightX, y, rightW, boxH, 1.2, 1.2, 'FD');
      if (themeId === 'drona_signature') {
        pdf.setFillColor(245, 124, 0);
        pdf.rect(m, y, 1.2, boxH, 'F');
      }
    }

    const padX = themeId === 'french_classic' || themeId === 'modern_minimal' ? 0 : 3.5;
    let cY = y + 4.5;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    if (themeId === 'executive_gold') pdf.setTextColor(154, 120, 50);
    else if (themeId === 'modern_minimal' || themeId === 'drona_signature') pdf.setTextColor(245, 124, 0);
    else if (themeId === 'corporate_blue') pdf.setTextColor(30, 58, 95);
    else pdf.setTextColor(115, 115, 115);
    pdf.text(themeId === 'french_classic' ? 'ADDRESSED TO' : 'PREPARED FOR', m + padX, cY);
    cY += 4.5;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.8);
    pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
    pdf.text(cust.companyName || cust.name || 'Customer', m + padX, cY);
    cY += 4;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    if (cust.companyName && cust.name) {
      pdf.text(`Attn: ${cust.name}`, m + padX, cY);
      cY += 3.8;
    }
    if (custAddrLines.length > 0) {
      pdf.text(custAddrLines, m + padX, cY);
      cY += custAddrLines.length * 3.6;
    }
    const custContact = [
      cust.phone ? `Tel: ${cust.phone}` : '',
      cust.email,
      cust.gstin ? `GSTIN: ${cust.gstin}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (custContact) {
      const cMetaLines = pdf.splitTextToSize(custContact, leftW - padX * 2);
      pdf.text(cMetaLines, m + padX, cY);
    }

    let rY = y + 4.5;
    const rPadX = themeId === 'french_classic' || themeId === 'modern_minimal' ? 4 : 3.5;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(
      themeId === 'executive_gold' ? 154 : themeId === 'corporate_blue' ? 30 : 115,
      themeId === 'executive_gold' ? 120 : themeId === 'corporate_blue' ? 58 : 115,
      themeId === 'executive_gold' ? 50 : themeId === 'corporate_blue' ? 95 : 115
    );
    pdf.text('QUOTATION PARTICULARS', rightX + rPadX, rY);
    rY += 4.8;

    metaRows.forEach(([label, val]) => {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.8);
      pdf.setTextColor(113, 113, 122);
      pdf.text(label, rightX + rPadX, rY);

      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
      const valLines = pdf.splitTextToSize(val, rightW * 0.56);
      pdf.text(valLines[0] || '', rightX + rightW - (themeId === 'french_classic' ? 0 : 3.5), rY, {
        align: 'right',
      });
      rY += 4.5;
    });

    y += boxH + 4.5;
  }

  // ==========================
  // OPTIONAL PROJECT DESCRIPTION BANNER
  // ==========================
  if (projectDescription) {
    const descLines = pdf.splitTextToSize(projectDescription, contentW - 8);
    const descH = 7.5 + descLines.length * 3.8;
    pdf.setFillColor(palette.softFill[0], palette.softFill[1], palette.softFill[2]);
    pdf.setDrawColor(palette.accentRgb[0], palette.accentRgb[1], palette.accentRgb[2]);
    pdf.setLineWidth(0.25);
    pdf.rect(m, y, contentW, descH, 'F');
    pdf.setFillColor(palette.accentRgb[0], palette.accentRgb[1], palette.accentRgb[2]);
    pdf.rect(m, y, 1, descH, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
    pdf.text('PROJECT / SERVICE OVERVIEW', m + 4, y + 4.2);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(63, 63, 70);
    pdf.text(descLines, m + 4, y + 8.2);
    y += descH + 4.5;
  }

  // ==========================
  // LINE ITEMS TABLE
  // ==========================
  if (palette.isLandscape) {
    const headers: string[] = ['#', 'Item / Service', 'Detailed Specification'];
    if (isGst) headers.push('HSN/SAC');
    headers.push('Qty', 'Unit Rate');
    if (hasDiscount) headers.push('Discount');
    headers.push('Est. Taxable');
    if (isGst) headers.push('Est. GST');
    headers.push('Est. Total');

    const rows: RowInput[] = record.items.map((item, idx) => {
      const row: Array<string | number> = [
        idx + 1,
        item.name,
        item.description || '-',
      ];
      if (isGst) row.push(item.hsnSac || '-');
      row.push(`${item.quantity} ${item.unit}`);
      row.push(formatINRForPdf(item.rate));
      if (hasDiscount) {
        row.push(item.discountAmount > 0 ? `-${formatINRForPdf(item.discountAmount)}` : '-');
      }
      row.push(formatINRForPdf(item.taxableAmount));
      if (isGst) row.push(`${formatINRForPdf(item.taxAmount)} (${item.taxRate}%)`);
      row.push(formatINRForPdf(item.totalAmount));
      return row;
    });

    const colStyles: Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number }> = {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 46 },
    };
    let cIdx = 3;
    if (isGst) colStyles[cIdx++] = { halign: 'center', cellWidth: 20 };
    colStyles[cIdx++] = { halign: 'right', cellWidth: 22 };
    colStyles[cIdx++] = { halign: 'right', cellWidth: 26 };
    if (hasDiscount) colStyles[cIdx++] = { halign: 'right', cellWidth: 22 };
    colStyles[cIdx++] = { halign: 'right', cellWidth: 28 };
    if (isGst) colStyles[cIdx++] = { halign: 'right', cellWidth: 28 };
    colStyles[cIdx] = { halign: 'right', cellWidth: 30 };

    autoTable(pdf, {
      startY: y,
      margin: { left: m, right: m, top: m, bottom: 14 },
      head: [headers],
      body: rows,
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      theme: 'grid',
      styles: {
        fontSize: 8.2,
        cellPadding: 2.5,
        textColor: [24, 24, 27],
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: palette.headerBg,
        textColor: palette.headerText,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: colStyles,
    });
  } else {
    const headers: string[] = ['#', 'Item & Specification'];
    if (isGst) headers.push('HSN/SAC');
    headers.push('Qty', 'Rate');
    if (hasDiscount) headers.push('Disc.');
    if (isGst) headers.push('Est. GST');
    headers.push('Est. Amount');

    const rows: RowInput[] = record.items.map((item, idx) => {
      const desc = item.description ? `${item.name}\n${item.description}` : item.name;
      const row: Array<string | number> = [idx + 1, desc];
      if (isGst) row.push(item.hsnSac || '-');
      row.push(`${item.quantity} ${item.unit}`);
      row.push(formatINRForPdf(item.rate));
      if (hasDiscount) {
        row.push(item.discountAmount > 0 ? `-${formatINRForPdf(item.discountAmount)}` : '-');
      }
      if (isGst) row.push(`${item.taxRate}%`);
      row.push(formatINRForPdf(item.totalAmount));
      return row;
    });

    const colStyles: Record<number, { halign?: 'left' | 'center' | 'right'; cellWidth?: number }> = {
      0: { halign: 'center', cellWidth: 9 },
    };
    let cIdx = 2;
    if (isGst) colStyles[cIdx++] = { halign: 'center', cellWidth: 19 };
    colStyles[cIdx++] = { halign: 'right', cellWidth: 19 };
    colStyles[cIdx++] = { halign: 'right', cellWidth: 25 };
    if (hasDiscount) colStyles[cIdx++] = { halign: 'right', cellWidth: 19 };
    if (isGst) colStyles[cIdx++] = { halign: 'center', cellWidth: 16 };
    colStyles[cIdx] = { halign: 'right', cellWidth: 28 };

    const isBorderlessStyle = themeId === 'modern_minimal' || themeId === 'french_classic';

    autoTable(pdf, {
      startY: y,
      margin: { left: m, right: m, top: m, bottom: 14 },
      head: [headers],
      body: rows,
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      theme: isBorderlessStyle ? 'plain' : 'grid',
      styles: {
        fontSize: 8.3,
        cellPadding: isBorderlessStyle ? { top: 2.8, bottom: 2.8, left: 2, right: 2 } : 2.6,
        textColor: [24, 24, 27],
        lineColor: palette.borderRgb,
        lineWidth: 0.2,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: palette.headerBg,
        textColor: palette.headerText,
        fontStyle: 'bold',
        fontSize: 8,
        lineColor: isBorderlessStyle ? palette.primaryRgb : palette.borderRgb,
        lineWidth: isBorderlessStyle ? 0.35 : 0.2,
      },
      alternateRowStyles:
        themeId === 'corporate_blue' ? { fillColor: [248, 250, 252] } : undefined,
      columnStyles: colStyles,
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          // Ensure cream/accent framing repeats seamlessly on overflow pages
          if (palette.id === 'modern_minimal') {
            pdf.setFillColor(palette.accentRgb[0], palette.accentRgb[1], palette.accentRgb[2]);
            pdf.rect(0, 0, pw, 2.2, 'F');
          } else if (palette.id === 'executive_gold') {
            pdf.setDrawColor(palette.borderRgb[0], palette.borderRgb[1], palette.borderRgb[2]);
            pdf.setLineWidth(0.35);
            pdf.rect(8, 8, pw - 16, ph - 16, 'D');
          }
        }
      },
    });
  }

  // ==========================
  // LOWER SUMMARY, TERMS & ACCEPTANCE BLOCK (OVERFLOW SAFE)
  // ==========================
  const afterTableY =
    (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 30;
  let blockY = afterTableY + 6;

  // Pre-calculate summary rows and notes height so we never split cleanly across bottom edge
  const summaryRows: Array<[string, string]> = [
    ['Estimated Subtotal', formatINRForPdf(record.subtotal || 0)],
  ];
  if (hasDiscount) {
    summaryRows.push(['Discount', `-${formatINRForPdf(record.totalDiscount || 0)}`]);
  }
  if (isGst) {
    summaryRows.push(['Estimated Taxable Value', formatINRForPdf(record.taxableAmount || 0)]);
    if (!hasInterState) {
      summaryRows.push(['Estimated CGST', formatINRForPdf(record.cgstTotal || 0)]);
      summaryRows.push(['Estimated SGST', formatINRForPdf(record.sgstTotal || 0)]);
    } else {
      summaryRows.push(['Estimated IGST', formatINRForPdf(record.igstTotal || 0)]);
    }
  }
  if ((record.roundOff || 0) !== 0) {
    summaryRows.push(['Round Off', formatINRForPdf(record.roundOff || 0)]);
  }

  const leftColW = palette.isLandscape ? contentW * 0.46 : contentW * 0.56;
  const wordsLines = pdf.splitTextToSize(record.amountInWords || '', leftColW - 6);
  const notesLines = notes ? pdf.splitTextToSize(notes, leftColW - 6) : [];
  const termsLines = terms ? pdf.splitTextToSize(terms, leftColW - 6) : [];
  const payInstrLines = paymentInstructions
    ? pdf.splitTextToSize(paymentInstructions, leftColW - 6)
    : [];

  const summaryBoxH = 11 + summaryRows.length * 5.2 + 9;
  const leftTextH =
    10 +
    wordsLines.length * 3.6 +
    (notesLines.length ? 7 + notesLines.length * 3.5 : 0) +
    (payInstrLines.length ? 7 + payInstrLines.length * 3.5 : 0) +
    (termsLines.length ? 7 + termsLines.length * 3.5 : 0);
  const acceptanceH = 26;
  const requiredBlockH = Math.max(summaryBoxH, leftTextH) + acceptanceH + 10;

  if (blockY + requiredBlockH > ph - m) {
    pdf.addPage();
    paintPageFrameIfNeeded(pdf, palette);
    blockY = m + 2;
  }

  // Draw Left Notes / Words / Optional Payment Instructions / Terms
  let lY = blockY;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.3);
  pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
  pdf.text('ESTIMATED VALUE IN WORDS', m, lY + 3);
  lY += 6.5;

  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(8);
  pdf.setTextColor(63, 63, 70);
  pdf.text(wordsLines, m, lY);
  lY += wordsLines.length * 3.6 + 3.5;

  if (paymentTerms) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.8);
    pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
    pdf.text(`Proposed Payment Terms: `, m, lY);
    const labelW = pdf.getTextWidth('Proposed Payment Terms: ');
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(63, 63, 70);
    pdf.text(paymentTerms, m + labelW, lY);
    lY += 4.8;
  }

  if (payInstrLines.length > 0) {
    const pBoxH = 6.5 + payInstrLines.length * 3.5;
    pdf.setFillColor(palette.softFill[0], palette.softFill[1], palette.softFill[2]);
    pdf.setDrawColor(palette.borderRgb[0], palette.borderRgb[1], palette.borderRgb[2]);
    pdf.roundedRect(m, lY, leftColW, pBoxH, 1, 1, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
    pdf.text('PROPOSED PAYMENT INSTRUCTIONS', m + 2.5, lY + 3.8);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(63, 63, 70);
    pdf.text(payInstrLines, m + 2.5, lY + 7.2);
    lY += pBoxH + 3.5;
  }

  if (notesLines.length > 0) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.3);
    pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
    pdf.text('NOTES', m, lY + 2);
    lY += 5.2;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(82, 82, 91);
    pdf.text(notesLines, m, lY);
    lY += notesLines.length * 3.5 + 3.5;
  }

  if (termsLines.length > 0) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.3);
    pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
    pdf.text('TERMS & CONDITIONS', m, lY + 2);
    lY += 5.2;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.6);
    pdf.setTextColor(82, 82, 91);
    pdf.text(termsLines, m, lY);
    lY += termsLines.length * 3.5 + 3.5;
  }

  // Draw Right Pricing Summary Card
  const sumW = palette.isLandscape ? contentW * 0.42 : contentW * 0.4;
  const sumX = pw - m - sumW;
  let sY = blockY;

  if (themeId !== 'modern_minimal' && themeId !== 'french_classic') {
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(palette.borderRgb[0], palette.borderRgb[1], palette.borderRgb[2]);
    pdf.roundedRect(sumX, sY, sumW, summaryBoxH, 1.2, 1.2, 'FD');
  }

  sY += 5.5;
  summaryRows.forEach(([label, value]) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.2);
    pdf.setTextColor(82, 82, 91);
    pdf.text(label, sumX + 3.5, sY);

    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(24, 24, 27);
    pdf.text(value, sumX + sumW - 3.5, sY, { align: 'right' });
    sY += 5.2;
  });

  // Grand Quotation Total Bar
  const totalBarY = sY + 1;
  if (themeId === 'modern_minimal') {
    pdf.setDrawColor(245, 124, 0);
    pdf.setLineWidth(0.7);
    pdf.line(sumX, totalBarY, sumX + sumW, totalBarY);
  } else if (themeId === 'french_classic') {
    pdf.setDrawColor(17, 17, 17);
    pdf.setLineWidth(0.35);
    pdf.line(sumX, totalBarY, sumX + sumW, totalBarY);
    pdf.line(sumX, totalBarY + 9, sumX + sumW, totalBarY + 9);
  } else {
    pdf.setFillColor(palette.totalBarBg[0], palette.totalBarBg[1], palette.totalBarBg[2]);
    pdf.rect(sumX, totalBarY, sumW, 9, 'F');
    if (themeId === 'drona_signature') {
      pdf.setFillColor(245, 124, 0);
      pdf.rect(sumX, totalBarY, sumW, 0.9, 'F');
    }
  }

  pdf.setFont(palette.fontHeading, 'bold');
  pdf.setFontSize(9.2);
  pdf.setTextColor(
    themeId === 'corporate_blue' || themeId === 'landscape_pro'
      ? 255
      : themeId === 'drona_signature'
        ? 255
        : palette.primaryRgb[0],
    themeId === 'corporate_blue' || themeId === 'landscape_pro'
      ? 255
      : themeId === 'drona_signature'
        ? 255
        : palette.primaryRgb[1],
    themeId === 'corporate_blue' || themeId === 'landscape_pro'
      ? 255
      : themeId === 'drona_signature'
        ? 255
        : palette.primaryRgb[2]
  );
  pdf.text(palette.headingLabel.toUpperCase(), sumX + 3.5, totalBarY + 6);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(palette.totalBarText[0], palette.totalBarText[1], palette.totalBarText[2]);
  pdf.text(formatINRForPdf(record.grandTotal || 0), sumX + sumW - 3.5, totalBarY + 6, {
    align: 'right',
  });

  // Acceptance & Authorised Signatory Footer
  let footY = Math.max(lY, totalBarY + 13) + 4;
  if (footY + 24 > ph - m) {
    pdf.addPage();
    paintPageFrameIfNeeded(pdf, palette);
    footY = m + 4;
  }

  pdf.setDrawColor(palette.borderRgb[0], palette.borderRgb[1], palette.borderRgb[2]);
  pdf.setLineWidth(0.3);
  pdf.line(m, footY, pw - m, footY);
  footY += 4.5;

  // Left: Client Acceptance Area
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
  pdf.text('CLIENT ACCEPTANCE', m, footY);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.2);
  pdf.setTextColor(113, 113, 122);
  pdf.text('Accepted & approved by customer (Signature & Date)', m, footY + 4);

  pdf.setDrawColor(161, 161, 170);
  pdf.line(m, footY + 15, m + 44, footY + 15);
  pdf.line(m + 50, footY + 15, m + 82, footY + 15);
  pdf.setFontSize(6.8);
  pdf.text('Client Signature', m, footY + 18.2);
  pdf.text('Name & Date', m + 50, footY + 18.2);

  // Right: Business Signatory
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(82, 82, 91);
  pdf.text(`For ${biz.businessName || 'Business'}`, pw - m, footY, { align: 'right' });

  if (sigInfo) {
    addImgSafe(
      pdf,
      sigInfo.pngDataUrl,
      pw - m - sigInfo.drawW,
      footY + 2,
      sigInfo.drawW,
      sigInfo.drawH
    );
  } else {
    pdf.setDrawColor(161, 161, 170);
    pdf.line(pw - m - 38, footY + 14.5, pw - m, footY + 14.5);
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(palette.primaryRgb[0], palette.primaryRgb[1], palette.primaryRgb[2]);
  pdf.text(signatureLabel, pw - m, footY + 18.2, { align: 'right' });

  const fileName = `${quotationNumber || 'Quotation'}.pdf`;
  return { pdf, fileName, themeId };
}

export async function generateQuotationPdf(
  inputRecord: Quotation,
  overrideTemplate?: TemplateId
): Promise<void> {
  const { pdf, fileName } = await buildQuotationPdfDocument(inputRecord, overrideTemplate);
  pdf.save(fileName);
}
