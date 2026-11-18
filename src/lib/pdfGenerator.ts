import jsPDFModule from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';

// Support both ESM browser bundle and Node.js testing environments
const jsPDF = (jsPDFModule as unknown as { jsPDF?: typeof jsPDFModule }).jsPDF || jsPDFModule;
import { buildUpiPaymentUri, formatINRForPdf } from '../shared/gstCalculator';
import type {
  BusinessProfile,
  Invoice,
  OutstandingReportRow,
  Payment,
  Purchase,
  Quotation,
  TemplateId,
} from '../shared/types';
import { formatDate } from './utils';
import { normalizeTemplateId } from '../components/invoice/invoiceThemeRegistry';
import type { StandardTemplateId } from '../components/invoice/invoiceThemeTypes';
import { generateQuotationPdf } from '../components/quotation/quotationPdfGenerator';
import { resolveLatestDocumentForDownload } from './liveSnapshots';
import { getCachedSession } from './localCache';

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

async function generateThemePdfFromDom(
  record: Invoice,
  normId: StandardTemplateId
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const isLandscape = normId === 'landscape_theme_2';
  const targetWidthPx = isLandscape ? 1123 : 794; // Exact A4 width at 96 DPI
  const targetMinHeightPx = isLandscape ? 794 : 1123;

  // 1. Check if the preview is ALREADY mounted and visible on the page
  const existingSheet = document.querySelector('.invoice-preview-root .print-sheet') as HTMLElement;
  const existingRoot = document.querySelector('.invoice-preview-root') as HTMLElement;
  const liveTarget = existingSheet || existingRoot;

  let container: HTMLDivElement | null = null;
  let root: any = null;

  try {
    let targetElement: HTMLElement;

    if (liveTarget && liveTarget.offsetWidth > 100 && liveTarget.offsetHeight > 100) {
      targetElement = liveTarget;
    } else {
      // Offscreen mounting when downloading from table list view
      container = document.createElement('div');
      container.setAttribute('aria-hidden', 'true');
      container.style.position = 'fixed';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width = `${targetWidthPx}px`;
      container.style.minHeight = `${targetMinHeightPx}px`;
      container.style.background = '#ffffff';
      container.style.zIndex = '-9999';
      container.style.opacity = '1';
      container.style.pointerEvents = 'none';
      container.style.overflow = 'visible';
      document.body.appendChild(container);

      const React = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { InvoicePreview } = await import('../components/invoice/InvoicePreview');

      root = createRoot(container);
      root.render(
        React.createElement(InvoicePreview, {
          docType: 'invoice',
          record,
          templateOverride: normId,
          a4Ratio: true,
        })
      );

      // Wait for fonts, images, and React to finish rendering
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 450));

      const imgs = Array.from(container.querySelectorAll('img'));
      if (imgs.length > 0) {
        await Promise.all(
          imgs.map((img) => {
            if (img.complete) return Promise.resolve(null);
            return new Promise((resolve) => {
              img.onload = () => resolve(null);
              img.onerror = () => resolve(null);
              setTimeout(resolve, 500);
            });
          })
        );
      }

      targetElement = (container.firstElementChild as HTMLElement) || container;
    }

    const computedHeight = Math.max(
      targetMinHeightPx,
      targetElement.scrollHeight || targetElement.offsetHeight || targetMinHeightPx
    );

    let canvas: HTMLCanvasElement | null = null;

    // Method 1: html-to-image (exact native browser rendering with foreignObject)
    try {
      const { toCanvas } = await import('html-to-image');
      canvas = await toCanvas(targetElement, {
        pixelRatio: 2, // 192 DPI - crisp, sharp vector-like typography and lines
        backgroundColor: '#ffffff',
        skipFonts: true, // Use browser's active fonts
        cacheBust: false,
        imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        onImageErrorHandler: () => null,
        width: targetWidthPx,
        height: computedHeight,
        canvasWidth: targetWidthPx * 2,
        canvasHeight: computedHeight * 2,
      });
    } catch (errHtmlToImage) {
      console.warn('html-to-image toCanvas failed, attempting html2canvas fallback:', errHtmlToImage);
    }

    // Method 2: html2canvas with OKLCH color sanitization
    if (!canvas) {
      const html2canvasModule = await import('html2canvas');
      const html2canvas = (html2canvasModule as any).default || html2canvasModule;
      canvas = await html2canvas(targetElement, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: targetWidthPx,
        windowWidth: targetWidthPx,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        onclone: (clonedDoc: Document) => {
          const tmpCanvas = document.createElement('canvas');
          const tmpCtx = tmpCanvas.getContext('2d');
          if (tmpCtx) {
            const colorConverter = (match: string) => {
              try {
                tmpCtx.fillStyle = '#000000';
                tmpCtx.fillStyle = match;
                return tmpCtx.fillStyle || '#000000';
              } catch {
                return '#000000';
              }
            };

            clonedDoc.querySelectorAll('style').forEach((st) => {
              if (
                st.textContent &&
                (st.textContent.includes('oklch') ||
                  st.textContent.includes('color-mix') ||
                  st.textContent.includes('color('))
              ) {
                st.textContent = st.textContent.replace(
                  /(?:oklch|color-mix|lab|color)\([^)]+\)/g,
                  colorConverter
                );
              }
            });

            clonedDoc.querySelectorAll('*').forEach((el) => {
              const htmlEl = el as HTMLElement;
              if (htmlEl.style) {
                const bg = htmlEl.style.backgroundColor;
                if (bg && (bg.includes('oklch') || bg.includes('color('))) {
                  htmlEl.style.backgroundColor = colorConverter(bg);
                }
                const col = htmlEl.style.color;
                if (col && (col.includes('oklch') || col.includes('color('))) {
                  htmlEl.style.color = colorConverter(col);
                }
                const bc = htmlEl.style.borderColor;
                if (bc && (bc.includes('oklch') || bc.includes('color('))) {
                  htmlEl.style.borderColor = colorConverter(bc);
                }
              }
            });
          }
        },
      });
    }

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      return false;
    }

    const pdf = new jsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgTotalHeightMm = (canvas.height * pdfW) / canvas.width;

    if (imgTotalHeightMm <= pdfH + 2) {
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, imgTotalHeightMm, undefined, 'FAST');
    } else {
      const pageCanvasHeightPx = Math.floor((canvas.width * pdfH) / pdfW);
      let renderedHeightPx = 0;
      let pageNumber = 0;

      while (renderedHeightPx < canvas.height) {
        if (pageNumber > 0) {
          pdf.addPage('a4', isLandscape ? 'landscape' : 'portrait');
        }
        const currentSliceHeightPx = Math.min(pageCanvasHeightPx, canvas.height - renderedHeightPx);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = currentSliceHeightPx;
        const sliceCtx = sliceCanvas.getContext('2d');
        if (sliceCtx) {
          sliceCtx.fillStyle = '#ffffff';
          sliceCtx.fillRect(0, 0, canvas.width, currentSliceHeightPx);
          sliceCtx.drawImage(
            canvas,
            0,
            renderedHeightPx,
            canvas.width,
            currentSliceHeightPx,
            0,
            0,
            canvas.width,
            currentSliceHeightPx
          );
          const sliceHeightMm = (currentSliceHeightPx * pdfW) / canvas.width;
          const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.98);
          pdf.addImage(sliceData, 'JPEG', 0, 0, pdfW, sliceHeightMm, undefined, 'FAST');
        }
        renderedHeightPx += currentSliceHeightPx;
        pageNumber++;
      }
    }

    const safeNumber = (record.invoiceNumber || 'Invoice').replace(/[^a-zA-Z0-9_-]/g, '_');
    pdf.save(`${safeNumber}.pdf`);
    return true;
  } catch (err) {
    console.warn('DOM theme PDF rendering failed, using vector PDF fallback:', err);
    return false;
  } finally {
    if (root) {
      try {
        root.unmount();
      } catch {}
    }
    if (container) {
      try {
        container.remove();
      } catch {}
    }
  }
}

export async function generateDocumentPdf(
  docType: 'invoice' | 'quotation',
  inputRecord: Invoice | Quotation,
  overrideTemplate?: TemplateId
): Promise<void> {
  if (docType === 'quotation') {
    await generateQuotationPdf(inputRecord as Quotation, overrideTemplate);
    return;
  }
  const record = (await resolveLatestDocumentForDownload(inputRecord)) as Invoice;
  const profile = getCachedSession()?.businessProfile;
  const resolvedTemplate =
    overrideTemplate || record.templateId || profile?.defaultInvoiceTemplate || 'gst_theme_1';
  const normId = normalizeTemplateId(resolvedTemplate);

  // In browser: render the exact high-fidelity React theme and convert to A4 PDF
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const ok = await generateThemePdfFromDom(record, normId);
      if (ok) return;
    } catch (err) {
      console.warn('DOM theme PDF rendering failed, falling back to vector PDF:', err);
    }
  }

  // Fallback / Node.js test environment: Vector jsPDF generator with theme colors
  await generateVectorInvoicePdf(record, normId);
}

async function generateVectorInvoicePdf(
  record: Invoice,
  normId: StandardTemplateId
): Promise<void> {
  const isLandscape = normId === 'landscape_theme_2';
  const pdf = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;

  const biz = record.businessSnapshot;
  const cust = record.customerSnapshot;
  const inv = record;
  const docNumber = inv.invoiceNumber;
  const docTitle = record.isGst ? 'TAX INVOICE' : 'BILL OF SUPPLY';

  let accentRgb: [number, number, number] = [124, 120, 212]; // royal violet default
  if (normId === 'double_divine') {
    accentRgb = [229, 57, 53]; // crimson red
  } else if (normId === 'landscape_theme_2') {
    accentRgb = [30, 36, 48]; // charcoal slate
  } else if (normId === 'gst_theme_1') {
    accentRgb = [63, 63, 70]; // dark slate
  } else if (normId === 'gst_theme_2') {
    accentRgb = [37, 99, 235]; // royal blue
  } else if (normId === 'gst_theme_3') {
    accentRgb = [123, 115, 214]; // royal violet #7B73D6
  } else if (normId === 'gst_theme_4') {
    accentRgb = [217, 119, 6]; // amber
  } else if (normId === 'gst_theme_5') {
    accentRgb = [14, 116, 144]; // cyan slate
  } else if (normId === 'gst_theme_6') {
    accentRgb = [79, 70, 229]; // indigo
  } else if (normId === 'french_elite') {
    accentRgb = [124, 120, 212]; // royal violet
  }

  // Load Business Logo if available
  const logoInfo = biz.logoDataUrl ? await loadLogoForPdf(biz.logoDataUrl, 32, 20) : null;
  let y = 14;

  if (isLandscape) {
    // Landscape 3-Column Header
    const col1W = 88;
    const col2X = margin + col1W + 6;
    const col2W = 75;
    const col3X = col2X + col2W + 6;
    const col3W = pageWidth - margin - col3X;

    // Col 1: Logo & Business Info
    if (logoInfo) {
      try {
        const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(logoInfo.pngDataUrl, fmt, margin, y, logoInfo.drawW, logoInfo.drawH);
      } catch {}
    }
    const bTextX = logoInfo ? margin + logoInfo.drawW + 3.5 : margin;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.businessName || 'DRONA Business', bTextX, y + 4.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let bY = y + 9;
    if (biz.address) {
      const aLines = pdf.splitTextToSize(biz.address, Math.max(50, col1W - (bTextX - margin)));
      pdf.text(aLines, bTextX, bY);
      bY += aLines.length * 3.8;
    }
    const bContact = [biz.phone, biz.email].filter(Boolean).join('  |  ');
    if (bContact) {
      pdf.text(bContact, bTextX, bY);
      bY += 3.8;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN: ${biz.gstin}`, bTextX, bY);
      bY += 3.8;
    }

    // Col 2: Document Title & Metadata
    pdf.setFillColor(30, 36, 48);
    pdf.roundedRect(col2X, y, 36, 6.5, 1, 1, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text(docTitle, col2X + 3.5, y + 4.5);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(docNumber, col2X, y + 12);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let mY = y + 16.5;
    if (inv) {
      pdf.text(`Date: ${formatDate(inv.invoiceDate)}`, col2X, mY);
      mY += 3.8;
      pdf.text(`Due: ${formatDate(inv.dueDate)}`, col2X, mY);
      mY += 3.8;
    } else if (quo) {
      pdf.text(`Date: ${formatDate(quo.quotationDate)}`, col2X, mY);
      mY += 3.8;
      pdf.text(`Valid: ${formatDate(quo.validUntil)}`, col2X, mY);
      mY += 3.8;
    }
    pdf.text(`Place of Supply: ${record.placeOfSupply || cust.state || '-'}`, col2X, mY);

    // Col 3: Customer Details
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(113, 113, 122);
    pdf.text('BILL TO / CONSIGNEE', col3X, y + 4);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(cust.companyName || cust.name, col3X, y + 9);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let cY = y + 13.5;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, col3W);
      pdf.text(cLines, col3X, cY);
      cY += cLines.length * 3.8;
    }
    const cContact = [cust.phone, cust.email].filter(Boolean).join('  |  ');
    if (cContact) {
      pdf.text(cContact, col3X, cY);
      cY += 3.8;
    }
    if (cust.gstin) {
      pdf.text(`GSTIN: ${cust.gstin}`, col3X, cY);
      cY += 3.8;
    }

    y = Math.max(bY, mY, cY, y + 26) + 3;
    pdf.setDrawColor(30, 36, 48);
    pdf.setLineWidth(0.4);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 5;
  } else if (normId === 'double_divine') {
    // Double Divine Dual-Tone Header
    // Crimson strip top right
    pdf.setFillColor(229, 57, 53);
    pdf.rect(pageWidth / 2 - 10, 0, pageWidth / 2 + 10, 7.5, 'F');
    const cLine = [biz.phone, biz.email].filter(Boolean).join('   |   ');
    if (cLine) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(255, 255, 255);
      pdf.text(cLine, pageWidth - margin, 5, { align: 'right' });
    }

    // Charcoal curved block top left
    pdf.setFillColor(30, 36, 48);
    pdf.roundedRect(0, 0, 80, 20, 0, 5, 'F');
    if (logoInfo) {
      try {
        const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(logoInfo.pngDataUrl, fmt, margin, 2.5, logoInfo.drawW * 0.75, logoInfo.drawH * 0.75);
      } catch {}
    }
    const dLeft = logoInfo ? margin + logoInfo.drawW * 0.75 + 3 : margin;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(255, 255, 255);
    pdf.text(biz.businessName || 'DRONA Business', dLeft, 11);
    if (biz.gstin) {
      pdf.setFontSize(7);
      pdf.setTextColor(212, 212, 216);
      pdf.text(`GSTIN: ${biz.gstin}`, dLeft, 16);
    }

    // Right side Tax Invoice title
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.setTextColor(24, 24, 27);
    pdf.text(docTitle, pageWidth - margin, 15, { align: 'right' });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.text(docNumber, pageWidth - margin, 20.5, { align: 'right' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    const dDateStr = inv ? `Date: ${formatDate(inv.invoiceDate)}` : `Date: ${formatDate(quo!.quotationDate)}`;
    pdf.text(dDateStr, pageWidth - margin, 25, { align: 'right' });

    y = 28;

    // Bill To in Red Accent
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(229, 57, 53);
    pdf.text('BILL TO', margin, y);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(cust.companyName || cust.name, margin, y + 4.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let cY = y + 8.5;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, 90);
      pdf.text(cLines, margin, cY);
      cY += cLines.length * 3.8;
    }
    if (cust.phone) {
      pdf.text(`Phone: ${cust.phone}`, margin, cY);
      cY += 3.8;
    }
    if (cust.gstin) {
      pdf.text(`GSTIN: ${cust.gstin}`, margin, cY);
      cY += 3.8;
    }

    let rY = y + 4.5;
    if (biz.address) {
      const bLines = pdf.splitTextToSize(biz.address, 75);
      pdf.text(bLines, pageWidth - margin, rY, { align: 'right' });
      rY += bLines.length * 3.8;
    }
    pdf.text(`Place of Supply: ${record.placeOfSupply || cust.state || '-'}`, pageWidth - margin, rY, { align: 'right' });

    y = Math.max(cY, rY) + 5;
  } else if (normId === 'french_elite') {
    // French Elite - Matches Screenshot 1
    // Purple title badge at top left
    pdf.setFillColor(124, 120, 212);
    pdf.roundedRect(margin, y, 38, 6.5, 1, 1, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text(docTitle, margin + 4, y + 4.8);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.businessName || 'DRONA Business', margin, y + 13.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(82, 82, 91);
    let bY = y + 17.5;
    if (biz.phone) {
      pdf.text(`Phone: ${biz.phone}`, margin, bY);
      bY += 3.5;
    }
    if (biz.email) {
      pdf.text(`Email: ${biz.email}`, margin, bY);
      bY += 3.5;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN: ${biz.gstin}`, margin, bY);
      bY += 3.5;
    }

    // Top Right Logo Box
    const logoW = 28;
    const logoH = 16;
    if (logoInfo) {
      try {
        const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(logoInfo.pngDataUrl, fmt, pageWidth - margin - logoInfo.drawW, y, logoInfo.drawW, logoInfo.drawH);
      } catch {}
    } else {
      pdf.setDrawColor(228, 228, 231);
      pdf.setFillColor(250, 250, 250);
      pdf.roundedRect(pageWidth - margin - logoW, y, logoW, logoH, 1, 1, 'FD');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(161, 161, 170);
      pdf.text('[+ Logo]', pageWidth - margin - logoW / 2, y + logoH / 2 + 1, { align: 'center' });
    }

    y = Math.max(bY, y + logoH) + 3;
    pdf.setDrawColor(228, 228, 231);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 5;

    // Metadata Left, Bill To Right
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(24, 24, 27);
    pdf.text(`Invoice No.: ${docNumber}`, margin, y);
    const dateStr = inv ? `Date: ${formatDate(inv.invoiceDate)}` : `Date: ${formatDate(quo!.quotationDate)}`;
    pdf.text(dateStr, margin, y + 4.5);
    if (inv?.dueDate) {
      pdf.text(`Due Date: ${formatDate(inv.dueDate)}`, margin, y + 9);
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(113, 113, 122);
    pdf.text('Bill To', pageWidth - margin, y, { align: 'right' });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(cust.companyName || cust.name, pageWidth - margin, y + 4.5, { align: 'right' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let cY = y + 9;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, 85);
      pdf.text(cLines, pageWidth - margin, cY, { align: 'right' });
      cY += cLines.length * 3.8;
    }
    if (cust.phone) {
      pdf.text(`Phone: ${cust.phone}`, pageWidth - margin, cY, { align: 'right' });
      cY += 3.8;
    }
    if (cust.gstin) {
      pdf.text(`GSTIN: ${cust.gstin}`, pageWidth - margin, cY, { align: 'right' });
      cY += 3.8;
    }

    y = Math.max(y + 14, cY) + 4;
  } else if (normId === 'gst_theme_5' || normId === 'gst_theme_4') {
    // GST Theme 4 & 5 - Matches Screenshot 4 & 5
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(24, 24, 27);
    pdf.text(docTitle, pageWidth / 2, y, { align: 'center' });
    y += 5;

    // Left: Logo Box
    const logoW = 26;
    const logoH = 15;
    if (logoInfo) {
      try {
        const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(logoInfo.pngDataUrl, fmt, margin, y, logoInfo.drawW, logoInfo.drawH);
      } catch {}
    } else {
      pdf.setDrawColor(228, 228, 231);
      pdf.setFillColor(250, 250, 250);
      pdf.roundedRect(margin, y, logoW, logoH, 1, 1, 'FD');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(161, 161, 170);
      pdf.text('[+ Logo]', margin + logoW / 2, y + logoH / 2 + 1, { align: 'center' });
    }

    // Right: Light Blue Business Box
    const bBoxW = 85;
    const bBoxX = pageWidth - margin - bBoxW;
    pdf.setFillColor(239, 246, 255);
    pdf.setDrawColor(191, 219, 254);
    pdf.roundedRect(bBoxX, y, bBoxW, 19, 1, 1, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.businessName || 'DRONA Business', bBoxX + bBoxW - 3, y + 4.5, { align: 'right' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(82, 82, 91);
    let by = y + 8.5;
    if (biz.phone) {
      pdf.text(`Phone no.: ${biz.phone}`, bBoxX + bBoxW - 3, by, { align: 'right' });
      by += 3.5;
    }
    if (biz.email) {
      pdf.text(`Email: ${biz.email}`, bBoxX + bBoxW - 3, by, { align: 'right' });
      by += 3.5;
    }
    if (biz.gstin) {
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(24, 24, 27);
      pdf.text(`GSTIN: ${biz.gstin}`, bBoxX + bBoxW - 3, by, { align: 'right' });
    }

    y += 22;

    // Full Width Purple Sub-Header Bar
    pdf.setFillColor(124, 120, 212);
    pdf.rect(margin, y, pageWidth - 2 * margin, 5.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    pdf.text('Bill To', margin + 3, y + 4);
    pdf.text('Invoice Details', pageWidth - margin - 3, y + 4, { align: 'right' });
    y += 8;

    // Details below sub-header bar
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(cust.companyName || cust.name, margin, y);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let cY = y + 4;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, 95);
      pdf.text(cLines, margin, cY);
      cY += cLines.length * 3.8;
    }
    if (cust.phone) {
      pdf.text(`Phone: ${cust.phone}`, margin, cY);
      cY += 3.8;
    }
    if (cust.gstin) {
      pdf.text(`GSTIN: ${cust.gstin}`, margin, cY);
      cY += 3.8;
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let rY = y;
    pdf.text(`Invoice No.: ${docNumber}`, pageWidth - margin, rY, { align: 'right' });
    rY += 4;
    const dateStr = inv ? `Date: ${formatDate(inv.invoiceDate)}` : `Date: ${formatDate(quo!.quotationDate)}`;
    pdf.text(dateStr, pageWidth - margin, rY, { align: 'right' });
    rY += 4;
    if (inv?.dueDate) {
      pdf.text(`Due Date: ${formatDate(inv.dueDate)}`, pageWidth - margin, rY, { align: 'right' });
      rY += 4;
    }
    pdf.text(`Place of Supply: ${record.placeOfSupply || cust.state || '-'}`, pageWidth - margin, rY, { align: 'right' });
    rY += 4;

    y = Math.max(cY, rY) + 3;
  } else if (normId === 'gst_theme_3') {
    // GST Theme 3 - Matches Screenshot 6
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(24, 24, 27);
    pdf.text(docTitle, pageWidth / 2, y, { align: 'center' });
    y += 5;

    const boxW = (pageWidth - 2 * margin - 5) / 2;
    // Left Box: Logo & Business
    pdf.setFillColor(239, 246, 255);
    pdf.setDrawColor(191, 219, 254);
    pdf.roundedRect(margin, y, boxW, 20, 1, 1, 'FD');

    if (logoInfo) {
      try {
        const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(logoInfo.pngDataUrl, fmt, margin + 2, y + 2, logoInfo.drawW * 0.7, logoInfo.drawH * 0.7);
      } catch {}
    }
    const bLeft = logoInfo ? margin + logoInfo.drawW * 0.7 + 4 : margin + 3;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.businessName || 'DRONA Business', bLeft, y + 5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(82, 82, 91);
    let by = y + 9;
    if (biz.phone) {
      pdf.text(`Phone: ${biz.phone}`, bLeft, by);
      by += 3.5;
    }
    if (biz.email) {
      pdf.text(`Email: ${biz.email}`, bLeft, by);
      by += 3.5;
    }

    // Right Box: Invoice Details
    const rBoxX = margin + boxW + 5;
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(212, 212, 216);
    pdf.roundedRect(rBoxX, y, boxW, 20, 1, 1, 'FD');

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    pdf.text(`Invoice No.: ${docNumber}`, rBoxX + 4, y + 5);
    const dateStr = inv ? `Date: ${formatDate(inv.invoiceDate)}` : `Date: ${formatDate(quo!.quotationDate)}`;
    pdf.text(dateStr, rBoxX + 4, y + 9.5);
    if (inv?.dueDate) {
      pdf.text(`Due Date: ${formatDate(inv.dueDate)}`, rBoxX + 4, y + 14);
    }
    pdf.text(`Place of Supply: ${record.placeOfSupply || cust.state || '-'}`, rBoxX + 4, y + 18);

    y += 24;

    // Bill To
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(113, 113, 122);
    pdf.text('Bill To', margin, y);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(24, 24, 27);
    pdf.text(cust.companyName || cust.name, margin, y + 4.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let cY = y + 8.5;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, 110);
      pdf.text(cLines, margin, cY);
      cY += cLines.length * 3.8;
    }
    if (cust.phone) {
      pdf.text(`Phone: ${cust.phone}`, margin, cY);
      cY += 3.8;
    }
    if (cust.gstin) {
      pdf.text(`GSTIN: ${cust.gstin}`, margin, cY);
      cY += 3.8;
    }

    y = cY + 3;
  } else if (normId === 'gst_theme_1') {
    // GST Theme 1 - Matches Screenshot 3
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(24, 24, 27);
    pdf.text(docTitle, pageWidth / 2, y, { align: 'center' });
    y += 5;

    // Left Bordered Box for Business Details
    const bBoxW = 85;
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(212, 212, 216);
    pdf.roundedRect(margin, y, bBoxW, 20, 1, 1, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.businessName || 'DRONA Business', margin + 3.5, y + 5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(82, 82, 91);
    let by = y + 9;
    if (biz.phone) {
      pdf.text(`Phone no.: ${biz.phone}`, margin + 3.5, by);
      by += 3.5;
    }
    if (biz.email) {
      pdf.text(`Email: ${biz.email}`, margin + 3.5, by);
      by += 3.5;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN: ${biz.gstin}`, margin + 3.5, by);
    }

    // Right Logo Box
    const logoW = 28;
    const logoH = 16;
    if (logoInfo) {
      try {
        const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(logoInfo.pngDataUrl, fmt, pageWidth - margin - logoInfo.drawW, y, logoInfo.drawW, logoInfo.drawH);
      } catch {}
    } else {
      pdf.setDrawColor(228, 228, 231);
      pdf.setFillColor(250, 250, 250);
      pdf.roundedRect(pageWidth - margin - logoW, y, logoW, logoH, 1, 1, 'FD');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(161, 161, 170);
      pdf.text('[+ Logo]', pageWidth - margin - logoW / 2, y + logoH / 2 + 1, { align: 'center' });
    }

    y += 24;

    // Bill To Left & Invoice Details Right
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(113, 113, 122);
    pdf.text('Bill To', margin, y);
    pdf.text('Invoice Details', pageWidth - margin, y, { align: 'right' });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(cust.companyName || cust.name, margin, y + 4.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let cY = y + 8.5;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, 95);
      pdf.text(cLines, margin, cY);
      cY += cLines.length * 3.8;
    }
    if (cust.phone) {
      pdf.text(`Phone: ${cust.phone}`, margin, cY);
      cY += 3.8;
    }
    if (cust.gstin) {
      pdf.text(`GSTIN: ${cust.gstin}`, margin, cY);
      cY += 3.8;
    }

    let rY = y + 4.5;
    pdf.text(`Invoice No.: ${docNumber}`, pageWidth - margin, rY, { align: 'right' });
    rY += 4;
    const dateStr = inv ? `Date: ${formatDate(inv.invoiceDate)}` : `Date: ${formatDate(quo!.quotationDate)}`;
    pdf.text(dateStr, pageWidth - margin, rY, { align: 'right' });
    rY += 4;
    if (inv?.dueDate) {
      pdf.text(`Due Date: ${formatDate(inv.dueDate)}`, pageWidth - margin, rY, { align: 'right' });
      rY += 4;
    }
    pdf.text(`Place of Supply: ${record.placeOfSupply || cust.state || '-'}`, pageWidth - margin, rY, { align: 'right' });
    rY += 4;

    y = Math.max(cY, rY) + 3;
  } else {
    // GST Theme 2 / 6 / Standard
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(24, 24, 27);
    pdf.text(docTitle, pageWidth / 2, y, { align: 'center' });
    y += 5;

    // Left Logo / Right Business
    if (logoInfo) {
      try {
        const fmt = logoInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(logoInfo.pngDataUrl, fmt, margin, y, logoInfo.drawW, logoInfo.drawH);
      } catch {}
    }

    const tLeft = logoInfo ? margin + logoInfo.drawW + 4 : margin;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.businessName || 'DRONA Business', tLeft, y + 5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.8);
    pdf.setTextColor(82, 82, 91);
    let bY = y + 9;
    if (biz.address) {
      const aLines = pdf.splitTextToSize(biz.address, 90);
      pdf.text(aLines, tLeft, bY);
      bY += aLines.length * 3.8;
    }
    const cLine = [biz.phone, biz.email].filter(Boolean).join('  |  ');
    if (cLine) {
      pdf.text(cLine, tLeft, bY);
      bY += 3.8;
    }
    if (biz.gstin) {
      pdf.text(`GSTIN: ${biz.gstin}`, tLeft, bY);
      bY += 3.8;
    }

    // Right details
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(docNumber, pageWidth - margin, y + 5, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let rY = y + 9;
    if (inv) {
      pdf.text(`Date: ${formatDate(inv.invoiceDate)}`, pageWidth - margin, rY, { align: 'right' });
      rY += 3.8;
      pdf.text(`Due: ${formatDate(inv.dueDate)}`, pageWidth - margin, rY, { align: 'right' });
      rY += 3.8;
    } else if (quo) {
      pdf.text(`Date: ${formatDate(quo.quotationDate)}`, pageWidth - margin, rY, { align: 'right' });
      rY += 3.8;
      pdf.text(`Valid: ${formatDate(quo.validUntil)}`, pageWidth - margin, rY, { align: 'right' });
      rY += 3.8;
    }
    pdf.text(`Place of Supply: ${record.placeOfSupply || cust.state || '-'}`, pageWidth - margin, rY, { align: 'right' });

    y = Math.max(bY, rY, y + (logoInfo ? logoInfo.drawH : 0)) + 3;

    // Accent Band for Bill To
    pdf.setFillColor(...accentRgb);
    pdf.rect(margin, y, pageWidth - 2 * margin, 5.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    pdf.text('BILL TO', margin + 3, y + 4);
    pdf.text('DETAILS', pageWidth - margin - 3, y + 4, { align: 'right' });
    y += 8;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(cust.companyName || cust.name, margin, y);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(82, 82, 91);
    let cY = y + 4;
    if (cust.billingAddress) {
      const cLines = pdf.splitTextToSize(cust.billingAddress, 95);
      pdf.text(cLines, margin, cY);
      cY += cLines.length * 3.8;
    }
    if (cust.phone) {
      pdf.text(`Phone: ${cust.phone}`, margin, cY);
      cY += 3.8;
    }
    if (cust.gstin) {
      pdf.text(`GSTIN: ${cust.gstin}`, margin, cY);
      cY += 3.8;
    }

    y = Math.max(cY, y + 12) + 3;
  }

  // Itemized Table
  let head: string[][];
  let body: string[][];
  let columnStyles: Record<number, Record<string, unknown>>;

  if (isLandscape) {
    head = record.isGst
      ? [['#', 'Item & Description', 'HSN/SAC', 'Qty', 'Unit', 'Rate', 'Disc.', 'Taxable', 'GST', 'Total']]
      : [['#', 'Item & Description', 'Qty', 'Unit', 'Rate', 'Disc.', 'Total']];

    body = record.items.map((item, idx) => {
      const desc = item.description ? `${item.name}\n${item.description}` : item.name;
      const disc = item.discountAmount > 0 ? formatINRForPdf(item.discountAmount).replace('INR ', '') : '-';
      if (record.isGst) {
        return [
          String(idx + 1),
          desc,
          item.hsnSac || '-',
          String(item.quantity),
          item.unit,
          formatINRForPdf(item.rate).replace('INR ', ''),
          disc,
          formatINRForPdf(item.taxableAmount).replace('INR ', ''),
          `${item.taxRate}%\n${formatINRForPdf(item.taxAmount).replace('INR ', '')}`,
          formatINRForPdf(item.totalAmount).replace('INR ', ''),
        ];
      }
      return [
        String(idx + 1),
        desc,
        String(item.quantity),
        item.unit,
        formatINRForPdf(item.rate).replace('INR ', ''),
        disc,
        formatINRForPdf(item.totalAmount).replace('INR ', ''),
      ];
    });

    columnStyles = record.isGst
      ? {
          0: { halign: 'center', cellWidth: 8 },
          1: { cellWidth: 'auto' },
          2: { halign: 'center', cellWidth: 18 },
          3: { halign: 'right', cellWidth: 14 },
          4: { halign: 'center', cellWidth: 14 },
          5: { halign: 'right', cellWidth: 20 },
          6: { halign: 'right', cellWidth: 18 },
          7: { halign: 'right', cellWidth: 22 },
          8: { halign: 'right', cellWidth: 26 },
          9: { halign: 'right', cellWidth: 28, fontStyle: 'bold' },
        }
      : {
          0: { halign: 'center', cellWidth: 8 },
          1: { cellWidth: 'auto' },
          2: { halign: 'right', cellWidth: 20 },
          3: { halign: 'center', cellWidth: 18 },
          4: { halign: 'right', cellWidth: 28 },
          5: { halign: 'right', cellWidth: 22 },
          6: { halign: 'right', cellWidth: 32, fontStyle: 'bold' },
        };
  } else {
    // Portrait Table
    head = record.isGst
      ? [['#', 'Item & Description', 'HSN/SAC', 'Qty', 'Rate', 'Disc.', 'Taxable', 'GST', 'Total']]
      : [['#', 'Item & Description', 'Qty', 'Rate', 'Disc.', 'Total']];

    body = record.items.map((item, idx) => {
      const desc = item.description ? `${item.name}\n${item.description}` : item.name;
      const disc = item.discountAmount > 0 ? formatINRForPdf(item.discountAmount).replace('INR ', '') : '-';
      if (record.isGst) {
        return [
          String(idx + 1),
          desc,
          item.hsnSac || '-',
          `${item.quantity} ${item.unit}`,
          formatINRForPdf(item.rate).replace('INR ', ''),
          disc,
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
        disc,
        formatINRForPdf(item.totalAmount).replace('INR ', ''),
      ];
    });

    columnStyles = record.isGst
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
        };
  }

  autoTable(pdf, {
    startY: y,
    head,
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      fontSize: isLandscape ? 7.8 : normId === 'gst_theme_6' ? 7.5 : 8.2,
      cellPadding: isLandscape ? 2 : normId === 'gst_theme_6' ? 1.8 : 2.5,
      textColor: [24, 24, 27],
      lineColor: normId === 'double_divine' ? [254, 205, 211] : [228, 228, 231],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: accentRgb,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles,
  });

  const tableEndY = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 30;
  let bottomY = tableEndY + 6;

  const thresholdY = isLandscape ? 150 : 232;
  if (bottomY > thresholdY) {
    pdf.addPage();
    bottomY = 16;
  }

  const qrAmount = inv ? (inv.balanceDue > 0 ? inv.balanceDue : inv.grandTotal) : record.grandTotal;
  const cleanUpiId = (biz.upiId || '').trim();
  const qrData = cleanUpiId
    ? await generateUpiQrDataUrl(cleanUpiId, biz.businessName, qrAmount, docNumber)
    : biz.upiQrDataUrl || null;

  if (isLandscape) {
    // 3-Column Landscape Bottom Section
    const col1W = 85;
    const col2X = margin + col1W + 6;
    const col2W = 85;
    const col3X = col2X + col2W + 6;

    // Col 1: Payment Details & QR
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(113, 113, 122);
    pdf.text('PAYMENT DETAILS', margin, bottomY);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(63, 63, 70);
    let pY = bottomY + 4;
    if (biz.bankName) {
      pdf.text(`Bank: ${biz.bankName}`, margin, pY);
      pY += 3.8;
    }
    if (biz.accountNumber) {
      pdf.text(`A/C: ${biz.accountNumber}  |  IFSC: ${biz.ifsc}`, margin, pY);
      pY += 3.8;
    }
    if (biz.upiId) {
      pdf.text(`UPI ID: ${biz.upiId}`, margin, pY);
      pY += 4;
    }

    if (qrData && qrData.startsWith('data:image/')) {
      try {
        pdf.addImage(qrData, 'PNG', margin, pY + 1, 18, 18);
        pdf.setFontSize(6.5);
        pdf.setTextColor(113, 113, 122);
        pdf.text('Scan to Pay (UPI)', margin, pY + 21);
      } catch {}
    }

    // Col 2: Amount in Words & Terms
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(113, 113, 122);
    pdf.text('AMOUNT IN WORDS', col2X, bottomY);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(24, 24, 27);
    const words = pdf.splitTextToSize(record.amountInWords, col2W);
    pdf.text(words, col2X, bottomY + 4);

    if (record.terms) {
      let tY = bottomY + 4 + words.length * 3.8 + 4;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(113, 113, 122);
      pdf.text('TERMS & CONDITIONS', col2X, tY);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(82, 82, 91);
      pdf.text(pdf.splitTextToSize(record.terms, col2W), col2X, tY + 4);
    }

    // Col 3: Totals & Signature
    const valX = pageWidth - margin;
    let sy = bottomY;
    const drawSum = (label: string, val: string, bold = false) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.setFontSize(bold ? 9 : 8);
      pdf.setTextColor(bold ? 24 : 82, bold ? 24 : 82, bold ? 27 : 91);
      pdf.text(label, col3X, sy);
      pdf.text(val, valX, sy, { align: 'right' });
      sy += bold ? 4.8 : 4;
    };

    drawSum('Taxable Value', formatINRForPdf(record.taxableAmount));
    if (record.isGst) {
      if (record.isInterState) {
        drawSum('IGST', formatINRForPdf(record.igstTotal));
      } else {
        drawSum('CGST', formatINRForPdf(record.cgstTotal));
        drawSum('SGST', formatINRForPdf(record.sgstTotal));
      }
    }
    pdf.setDrawColor(212, 212, 216);
    pdf.line(col3X, sy - 1.5, valX, sy - 1.5);
    sy += 1.5;
    drawSum('Grand Total', formatINRForPdf(record.grandTotal), true);

    if (inv && inv.amountPaid > 0) {
      drawSum('Received', formatINRForPdf(inv.amountPaid));
      drawSum('Balance Due', formatINRForPdf(inv.balanceDue), true);
    }

    // Signature
    const sigInfo = biz.signatureDataUrl ? await loadLogoForPdf(biz.signatureDataUrl, 35, 10) : null;
    if (sigInfo) {
      try {
        const fmt = sigInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(sigInfo.pngDataUrl, fmt, valX - sigInfo.drawW, sy + 2, sigInfo.drawW, sigInfo.drawH);
      } catch {}
    }
    pdf.setDrawColor(161, 161, 170);
    pdf.line(valX - 45, sy + 14, valX, sy + 14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.signatureLabel || 'Authorized Signatory', valX, sy + 17.5, { align: 'right' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(140, 140, 150);
    pdf.text('Generated by DronaInvoice', pageWidth / 2, pageHeight - 6, { align: 'center' });
  } else {
    // Portrait Bottom Section
    const isPurpleTheme = normId === 'gst_theme_5' || normId === 'gst_theme_4' || normId === 'french_elite';
    const isRedTheme = normId === 'double_divine';
    const isBlueTheme = normId === 'gst_theme_2';
    const leftWidth = 100;

    // Amount in Words Bar / Header
    if (isPurpleTheme || isRedTheme || isBlueTheme) {
      pdf.setFillColor(...accentRgb);
      pdf.rect(margin, bottomY - 1, leftWidth, 5, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(255, 255, 255);
      pdf.text('INVOICE AMOUNT IN WORDS', margin + 2.5, bottomY + 2.6);
    } else {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(113, 113, 122);
      pdf.text('AMOUNT IN WORDS', margin, bottomY);
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(24, 24, 27);
    const wordsLines = pdf.splitTextToSize(record.amountInWords, leftWidth);
    pdf.text(wordsLines, margin, bottomY + 7.5);

    let bankY = bottomY + 7.5 + wordsLines.length * 4 + 4;
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

    if (qrData && qrData.startsWith('data:image/')) {
      try {
        pdf.addImage(qrData, 'PNG', margin, bankY + 1, 18, 18);
        pdf.setFontSize(6.5);
        pdf.setTextColor(113, 113, 122);
        pdf.text('Scan to Pay (UPI)', margin, bankY + 21);
      } catch {}
    }

    // Right: Totals Summary
    const sumW = 75;
    const sumX = pageWidth - margin - sumW;
    const valX = pageWidth - margin;
    let sy = bottomY;

    if (isPurpleTheme || isRedTheme || isBlueTheme) {
      pdf.setFillColor(...accentRgb);
      pdf.rect(sumX, sy - 1, sumW, 5, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(255, 255, 255);
      pdf.text('Amounts', sumX + 3, sy + 2.6);
      sy += 6.5;
    }

    const drawSumRow = (label: string, val: string, bold = false) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.setFontSize(bold ? 9 : 8);
      pdf.setTextColor(bold ? 24 : 82, bold ? 24 : 82, bold ? 27 : 91);
      pdf.text(label, sumX + 2, sy);
      pdf.text(val, valX - 2, sy, { align: 'right' });
      sy += bold ? 5 : 4.2;
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
    pdf.line(sumX, sy - 1.5, valX, sy - 1.5);
    sy += 2;
    drawSumRow('Total', formatINRForPdf(record.grandTotal), true);

    if (inv) {
      drawSumRow('Received', formatINRForPdf(inv.amountPaid || 0));
      drawSumRow('Balance', formatINRForPdf(inv.balanceDue), true);
    }

    // Border around summary box if themed
    if (isPurpleTheme || isRedTheme || isBlueTheme) {
      pdf.setDrawColor(...accentRgb);
      pdf.rect(sumX, bottomY - 1, sumW, sy - bottomY + 3);
    }

    // Signatory Box on bottom right
    const sigBoxW = 75;
    const sigBoxH = 24;
    const sigBoxX = pageWidth - margin - sigBoxW;
    const footerY = Math.max(bankY + 24, sy + 6, 245);

    if (isPurpleTheme || normId === 'gst_theme_3' || normId === 'gst_theme_1') {
      pdf.setFillColor(239, 246, 255);
      pdf.setDrawColor(191, 219, 254);
      pdf.roundedRect(sigBoxX, footerY, sigBoxW, sigBoxH, 1, 1, 'FD');
    } else if (isRedTheme) {
      pdf.setFillColor(254, 242, 242);
      pdf.setDrawColor(254, 205, 211);
      pdf.roundedRect(sigBoxX, footerY, sigBoxW, sigBoxH, 1, 1, 'FD');
    } else {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(212, 212, 216);
      pdf.roundedRect(sigBoxX, footerY, sigBoxW, sigBoxH, 1, 1, 'FD');
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(82, 82, 91);
    pdf.text(`For: ${biz.businessName || 'DRONA Business'}`, sigBoxX + sigBoxW / 2, footerY + 5, { align: 'center' });

    const sigInfo = biz.signatureDataUrl ? await loadLogoForPdf(biz.signatureDataUrl, 38, 10) : null;
    if (sigInfo) {
      try {
        const fmt = sigInfo.pngDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        const sigX = sigBoxX + (sigBoxW - sigInfo.drawW) / 2;
        pdf.addImage(sigInfo.pngDataUrl, fmt, sigX, footerY + 7, sigInfo.drawW, sigInfo.drawH);
      } catch {}
    } else {
      pdf.setFontSize(7);
      pdf.setTextColor(161, 161, 170);
      pdf.text('[+ Authorized Signatory]', sigBoxX + sigBoxW / 2, footerY + 13, { align: 'center' });
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(24, 24, 27);
    pdf.text(biz.signatureLabel || 'Authorized Signatory', sigBoxX + sigBoxW / 2, footerY + 20, { align: 'center' });

    // Terms
    if (record.terms) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(113, 113, 122);
      pdf.text('TERMS & CONDITIONS', margin, footerY);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(82, 82, 91);
      pdf.text(pdf.splitTextToSize(record.terms, leftWidth), margin, footerY + 3.8);
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(140, 140, 150);
    pdf.text('Generated by DronaInvoice', pageWidth / 2, 289, { align: 'center' });
  }

  if (typeof window !== 'undefined') {
    pdf.save(`${docNumber}.pdf`);
  }
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

export function generatePurchasePdf(
  purchase: Purchase,
  businessProfile?: BusinessProfile | null
): void {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 14;

  pdf.setFillColor(245, 124, 0);
  pdf.rect(0, 0, pageWidth, 4, 'F');

  let y = 14;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(24, 24, 27);
  pdf.text(businessProfile?.businessName || 'Purchase Voucher', margin, y + 4);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(82, 82, 91);
  let by = y + 9;
  if (businessProfile?.address) {
    const addr = pdf.splitTextToSize(businessProfile.address, 100);
    pdf.text(addr, margin, by);
    by += addr.length * 4;
  }
  if (businessProfile?.gstin) {
    pdf.text(`Buyer GSTIN: ${businessProfile.gstin}   State: ${businessProfile.state}`, margin, by);
    by += 4;
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.setTextColor(245, 124, 0);
  pdf.text('PURCHASE BILL', pageWidth - margin, y + 4, { align: 'right' });

  pdf.setFontSize(10);
  pdf.setTextColor(24, 24, 27);
  pdf.text(purchase.billNumber, pageWidth - margin, y + 10, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(82, 82, 91);
  pdf.text(`Bill Date: ${formatDate(purchase.billDate)}`, pageWidth - margin, y + 15, { align: 'right' });
  pdf.text(`Due Date: ${formatDate(purchase.dueDate)}`, pageWidth - margin, y + 19.5, { align: 'right' });
  pdf.text(`Status: ${purchase.status.replace('_', ' ').toUpperCase()}`, pageWidth - margin, y + 24, {
    align: 'right',
  });

  y = Math.max(by + 4, y + 30);
  pdf.setDrawColor(228, 228, 231);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 6;

  const sup = purchase.supplierSnapshot;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(113, 113, 122);
  pdf.text('SUPPLIER DETAILS', margin, y);
  pdf.text('PURCHASE METADATA', pageWidth / 2 + 6, y);
  y += 4.5;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(24, 24, 27);
  pdf.text(sup.companyName || sup.name, margin, y);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(63, 63, 70);
  let sy = y + 4.5;
  if (sup.billingAddress) {
    const sAddr = pdf.splitTextToSize(sup.billingAddress, 85);
    pdf.text(sAddr, margin, sy);
    sy += sAddr.length * 4;
  }
  const sContact = [sup.phone, sup.email].filter(Boolean).join('  |  ');
  if (sContact) {
    pdf.text(sContact, margin, sy);
    sy += 4;
  }
  if (sup.gstin) {
    pdf.text(`Supplier GSTIN: ${sup.gstin}`, margin, sy);
    sy += 4;
  }

  let my = y;
  pdf.text(`Purchase Type: ${purchase.purchaseType.toUpperCase()}`, pageWidth / 2 + 6, my);
  my += 4.5;
  pdf.text(`Place of Supply: ${purchase.placeOfSupply || sup.state}`, pageWidth / 2 + 6, my);
  my += 4.5;
  if (purchase.referenceNumber) {
    pdf.text(`PO / Ref: ${purchase.referenceNumber}`, pageWidth / 2 + 6, my);
    my += 4.5;
  }
  if (purchase.paymentTerms) {
    pdf.text(`Payment Terms: ${purchase.paymentTerms}`, pageWidth / 2 + 6, my);
    my += 4.5;
  }

  y = Math.max(sy, my) + 5;

  const head = purchase.isGst
    ? [['#', 'Item', 'HSN/SAC', 'Qty', 'Rate', 'Disc.', 'Taxable', 'GST', 'Total']]
    : [['#', 'Item', 'Qty', 'Rate', 'Disc.', 'Total']];

  const body = purchase.items.map((item, idx) => {
    const desc = item.description ? `${item.name}\n${item.description}` : item.name;
    const disc = item.discountAmount > 0 ? formatINRForPdf(item.discountAmount).replace('INR ', '') : '-';
    if (purchase.isGst) {
      return [
        String(idx + 1),
        desc,
        item.hsnSac || '-',
        `${item.quantity} ${item.unit}`,
        formatINRForPdf(item.rate).replace('INR ', ''),
        disc,
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
      disc,
      formatINRForPdf(item.totalAmount).replace('INR ', ''),
    ];
  });

  autoTable(pdf, {
    startY: y,
    head,
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.4, textColor: [24, 24, 27], lineColor: [228, 228, 231] },
    headStyles: { fillColor: [245, 124, 0], textColor: [255, 255, 255], fontStyle: 'bold' },
  });

  const tableEndY = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 30;
  let bottomY = tableEndY + 7;
  if (bottomY > 238) {
    pdf.addPage();
    bottomY = 18;
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(113, 113, 122);
  pdf.text('AMOUNT IN WORDS', margin, bottomY);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(24, 24, 27);
  pdf.text(pdf.splitTextToSize(purchase.amountInWords, 102), margin, bottomY + 4.5);

  const sumX = pageWidth - margin - 72;
  const valX = pageWidth - margin;
  let ty = bottomY;
  const row = (lbl: string, val: string, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 9.5 : 8.5);
    pdf.setTextColor(bold ? 24 : 82, bold ? 24 : 82, bold ? 27 : 91);
    pdf.text(lbl, sumX, ty);
    pdf.text(val, valX, ty, { align: 'right' });
    ty += bold ? 5.5 : 4.5;
  };
  row('Subtotal', formatINRForPdf(purchase.subtotal));
  if (purchase.totalDiscount > 0) row('Total Discount', `-${formatINRForPdf(purchase.totalDiscount)}`);
  row('Taxable Value', formatINRForPdf(purchase.taxableAmount));
  if (purchase.isGst) {
    if (purchase.isInterState) row('IGST', formatINRForPdf(purchase.igstTotal));
    else {
      row('CGST', formatINRForPdf(purchase.cgstTotal));
      row('SGST', formatINRForPdf(purchase.sgstTotal));
    }
  }
  if (purchase.additionalCharges > 0) row('Additional Charges', formatINRForPdf(purchase.additionalCharges));
  if (purchase.roundOff !== 0) row('Round Off', formatINRForPdf(purchase.roundOff));
  pdf.setDrawColor(212, 212, 216);
  pdf.line(sumX, ty - 2, valX, ty - 2);
  ty += 2;
  row('Grand Total', formatINRForPdf(purchase.grandTotal), true);
  if (purchase.amountPaid > 0) {
    row('Amount Paid', formatINRForPdf(purchase.amountPaid));
    row('Outstanding', formatINRForPdf(purchase.balanceDue), true);
  }

  const outH = pdf.internal.pageSize.getHeight();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(140, 140, 150);
  pdf.text('Generated by DronaInvoice', pageWidth / 2, outH - 8, { align: 'center' });

  pdf.save(`purchase-${purchase.billNumber || purchase.id}.pdf`);
}
