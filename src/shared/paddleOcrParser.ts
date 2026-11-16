import type { PurchaseOcrField, PurchaseOcrRawResponse } from './types';
import { getStateFromGstin, INDIAN_STATES } from './indianStates';

const DEFAULT_JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
const MODEL_NAME = 'PP-StructureV3';

const GSTIN_RE = /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/i;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE = /(?:\+91[\s-]?)?[6-9]\d{9}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/;
const DATE_RE =
  /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/;

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

interface OcrLine {
  text: string;
  confidence: number;
}

interface HtmlTableEntry {
  html: string;
  avgConfidence: number | null;
}

function makeField<T>(value: T, confidence: number | null): PurchaseOcrField<T> {
  return {
    value,
    confidence:
      confidence !== null && Number.isFinite(confidence)
        ? Math.round(confidence * 10000) / 10000
        : null,
  };
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x20B9;|&rupee;/gi, '₹')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '));
}

function parseNumber(raw: string): number | null {
  const cleaned = (raw || '')
    .replace(/,/g, '')
    .replace(/[₹]/g, '')
    .replace(/\b(?:INR|RS\.?)\b/gi, '')
    .replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
    return null;
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function normalizeDate(raw: string): string {
  const txt = (raw || '').trim();
  if (!txt) return '';

  let m = txt.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const yr = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${String(yr).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  m = txt.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${String(yr).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  m = txt.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTH_MAP[m[2].toLowerCase()];
    let yr = Number(m[3]);
    if (yr < 100) yr += 2000;
    if (mo && d >= 1 && d <= 31) {
      return `${String(yr).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return '';
}

function markdownTableToHtml(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const htmlTables: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|') && i + 1 < lines.length) {
      const sep = lines[i + 1].trim();
      if (/^\|[\s:|\-]+\|$/.test(sep)) {
        const rowsHtml: string[] = [];
        const headerCells = line
          .slice(1, -1)
          .split('|')
          .map((c) => `<th>${c.trim()}</th>`)
          .join('');
        rowsHtml.push(`<tr>${headerCells}</tr>`);
        i += 2;
        while (i < lines.length) {
          const rowLine = lines[i].trim();
          if (!rowLine.startsWith('|') || !rowLine.includes('|')) break;
          const cells = rowLine
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => `<td>${c.trim()}</td>`)
            .join('');
          rowsHtml.push(`<tr>${cells}</tr>`);
          i += 1;
        }
        htmlTables.push(`<table>${rowsHtml.join('')}</table>`);
        continue;
      }
    }
    i += 1;
  }

  return htmlTables;
}

function collectLinesAndTables(layoutParsingResults: Array<Record<string, unknown>>): {
  lines: OcrLine[];
  tables: HtmlTableEntry[];
} {
  const lines: OcrLine[] = [];
  const tables: HtmlTableEntry[] = [];

  for (const page of layoutParsingResults) {
    const pruned = (page.prunedResult as Record<string, unknown> | undefined) || page;
    const overallOcr = (pruned.overall_ocr_res as Record<string, unknown> | undefined) || {};
    const recTexts = Array.isArray(overallOcr.rec_texts) ? overallOcr.rec_texts : [];
    const recScores = Array.isArray(overallOcr.rec_scores) ? overallOcr.rec_scores : [];

    for (let idx = 0; idx < recTexts.length; idx++) {
      const text = String(recTexts[idx] ?? '').trim();
      if (!text) continue;
      const rawScore = idx < recScores.length ? Number(recScores[idx]) : 0.78;
      lines.push({
        text,
        confidence: Number.isFinite(rawScore) ? rawScore : 0.78,
      });
    }

    const parsingList = Array.isArray(pruned.parsing_res_list)
      ? (pruned.parsing_res_list as Array<Record<string, unknown>>)
      : [];

    if (recTexts.length === 0) {
      for (const blk of parsingList) {
        const content = String(blk.block_content ?? '').trim();
        if (!content || /<table/i.test(content)) continue;
        for (const ln of content.split(/\r?\n/)) {
          const cleaned = ln.trim();
          if (cleaned) lines.push({ text: cleaned, confidence: 0.78 });
        }
      }
    }

    const mdObj = (page.markdown as Record<string, unknown> | undefined) || {};
    const mdText = String(mdObj.text ?? '').trim();
    if (recTexts.length === 0 && parsingList.length === 0 && mdText) {
      for (const ln of mdText.split(/\r?\n/)) {
        const cleaned = ln.replace(/^#+\s*/, '').trim();
        if (cleaned && !cleaned.startsWith('<table') && !cleaned.startsWith('|')) {
          lines.push({ text: cleaned, confidence: 0.78 });
        }
      }
    }

    const seenTables = new Set<string>();
    const addTable = (html: string, avgConfidence: number | null) => {
      const trimmed = html.trim();
      if (!trimmed || seenTables.has(trimmed)) return;
      seenTables.add(trimmed);
      tables.push({ html: trimmed, avgConfidence });
    };

    const tableResList = Array.isArray(pruned.table_res_list)
      ? (pruned.table_res_list as Array<Record<string, unknown>>)
      : [];
    for (const tbl of tableResList) {
      const html = String(tbl.pred_html ?? tbl.html ?? '');
      const tblOcr = (tbl.table_ocr_pred as Record<string, unknown> | undefined) || {};
      const scores = Array.isArray(tblOcr.rec_scores)
        ? (tblOcr.rec_scores as unknown[]).map((x) => Number(x)).filter(Number.isFinite)
        : [];
      const avgConf =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      if (html) addTable(html, avgConf);
    }

    for (const blk of parsingList) {
      const content = String(blk.block_content ?? '');
      if (/<table[\s>]/i.test(content)) {
        const matches = content.match(/<table[\s\S]*?<\/table>/gi) || [content];
        for (const m of matches) addTable(m, null);
      }
    }

    if (mdText) {
      const htmlMatches = mdText.match(/<table[\s\S]*?<\/table>/gi) || [];
      for (const m of htmlMatches) addTable(m, null);
      for (const mHtml of markdownTableToHtml(mdText)) addTable(mHtml, null);
    }
  }

  return { lines, tables };
}

function parseHtmlRows(html: string): string[][] {
  const rows: string[][] = [];
  const trMatches = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi;
    let match: RegExpExecArray | null;
    while ((match = cellRegex.exec(tr)) !== null) {
      const attrs = match[1] || '';
      const text = stripTags(match[2] || '');
      const colspanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
      const span = colspanMatch ? Math.min(10, Math.max(1, Number(colspanMatch[1]))) : 1;
      cells.push(text);
      for (let s = 1; s < span; s++) cells.push('');
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function findLabeledValue(
  lines: OcrLine[],
  patterns: RegExp[]
): { value: string; confidence: number | null } {
  for (let idx = 0; idx < lines.length; idx++) {
    const { text, confidence } = lines[idx];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const val = (m[1] ?? '').replace(/^[\s:\-\t]+|[\s:\-\t]+$/g, '');
        if (val) {
          return { value: val, confidence };
        }
        if (idx + 1 < lines.length) {
          const next = lines[idx + 1];
          return {
            value: next.text.trim(),
            confidence: Math.min(confidence, next.confidence),
          };
        }
      }
    }
  }
  return { value: '', confidence: null };
}

function parseHtmlTableItems(
  tables: HtmlTableEntry[],
  lines: OcrLine[]
): {
  items: PurchaseOcrRawResponse['items'];
  summaryHints: Record<string, { value: number; confidence: number | null }>;
} {
  const items: PurchaseOcrRawResponse['items'] = [];
  const summaryHints: Record<string, { value: number; confidence: number | null }> = {};

  const lineConfLookup = new Map<string, number>();
  for (const ln of lines) {
    lineConfLookup.set(ln.text.toLowerCase(), ln.confidence);
  }

  for (const { html, avgConfidence } of tables) {
    const rows = parseHtmlRows(html);
    if (rows.length < 2) continue;

    let headerCells: string[] = [];
    let bodyStartIdx = 0;

    for (let rIdx = 0; rIdx < Math.min(3, rows.length); rIdx++) {
      const cells = rows[rIdx];
      const joined = cells.join(' ').toLowerCase();
      if (
        ['item', 'description', 'particular', 'product', 'hsn', 'qty', 'rate', 'amount'].some(
          (k) => joined.includes(k)
        )
      ) {
        headerCells = cells.map((c) => c.toLowerCase());
        bodyStartIdx = rIdx + 1;
        break;
      }
    }

    if (headerCells.length === 0) continue;

    const colIndex = (keywords: string[]) =>
      headerCells.findIndex((h) => keywords.some((k) => h.includes(k)));

    let idxName = colIndex(['item', 'description', 'particular', 'product', 'goods', 'service']);
    const idxHsn = colIndex(['hsn', 'sac']);
    const idxQty = colIndex(['qty', 'quantity', 'qnty']);
    const idxUnit = colIndex(['unit', 'uom', 'per']);
    const idxRate = colIndex(['rate', 'price', 'unit price']);
    const idxDisc = colIndex(['disc', 'discount']);
    const idxTaxable = colIndex(['taxable']);
    const idxGstRate = colIndex(['gst %', 'tax %', 'gst rate', 'igst %', 'cgst %', 'gst']);
    const idxCgst = colIndex(['cgst']);
    const idxSgst = colIndex(['sgst', 'utgst']);
    const idxIgst = colIndex(['igst']);
    const idxTotal = colIndex(['total', 'amount', 'net amt', 'line total']);

    if (idxName < 0 && headerCells.length >= 2) {
      idxName = ['#', 'sr', 'sr.', 's.no', 'sno', 'no'].includes(headerCells[0]) ? 1 : 0;
    }

    for (const cells of rows.slice(bodyStartIdx)) {
      if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
      const joinedRow = cells.join(' ').toLowerCase();

      if (
        [
          'grand total',
          'total amount',
          'net payable',
          'round off',
          'sub total',
          'subtotal',
        ].some((k) => joinedRow.includes(k))
      ) {
        let lastNum: number | null = null;
        for (let c = cells.length - 1; c >= 0; c--) {
          const n = parseNumber(cells[c]);
          if (n !== null) {
            lastNum = n;
            break;
          }
        }
        if (lastNum !== null) {
          if (joinedRow.includes('grand') || joinedRow.includes('net payable')) {
            summaryHints.grandTotal = { value: lastNum, confidence: avgConfidence };
          } else if (joinedRow.includes('round')) {
            summaryHints.roundOff = { value: lastNum, confidence: avgConfidence };
          } else if (joinedRow.includes('sub')) {
            summaryHints.subtotal = { value: lastNum, confidence: avgConfidence };
          }
        }
        continue;
      }

      const cellText = (col: number) => (col >= 0 && col < cells.length ? cells[col].trim() : '');
      const cellConf = (txt: string): number | null => {
        if (!txt) return avgConfidence;
        return lineConfLookup.get(txt.toLowerCase()) ?? avgConfidence;
      };

      const nameVal = cellText(idxName);
      if (!nameVal || /^(total|sub\s*total|cgst|sgst|igst)$/i.test(nameVal)) continue;

      const hsnVal = cellText(idxHsn).replace(/\D/g, '').slice(0, 8);
      const qtyRaw = cellText(idxQty);
      const qtyNum = parseNumber(qtyRaw);
      let unitVal = cellText(idxUnit);
      if (!unitVal && qtyRaw) {
        const um = qtyRaw.match(/([A-Za-z]{2,8})$/);
        if (um) unitVal = um[1];
      }

      const rateNum = parseNumber(cellText(idxRate));
      const discNum = parseNumber(cellText(idxDisc)) ?? 0;
      const taxableNum = parseNumber(cellText(idxTaxable));
      const gstText = cellText(idxGstRate);
      let gstRateNum = parseNumber(gstText);
      if (gstRateNum !== null && gstRateNum > 28) {
        gstRateNum = null;
      }

      const cgstNum = parseNumber(cellText(idxCgst)) ?? 0;
      const sgstNum = parseNumber(cellText(idxSgst)) ?? 0;
      const igstNum = parseNumber(cellText(idxIgst)) ?? 0;
      const totalNum = parseNumber(cellText(idxTotal));

      items.push({
        name: makeField(nameVal, cellConf(nameVal)),
        hsnSac: makeField(hsnVal, cellConf(cellText(idxHsn))),
        quantity: makeField(qtyNum !== null ? qtyNum : 1, cellConf(qtyRaw)),
        unit: makeField(unitVal || 'Nos', unitVal ? cellConf(unitVal) : avgConfidence),
        rate: makeField(rateNum !== null ? rateNum : 0, cellConf(cellText(idxRate))),
        discount: makeField(discNum, cellConf(cellText(idxDisc))),
        taxableValue: makeField(
          taxableNum !== null ? taxableNum : 0,
          cellConf(cellText(idxTaxable))
        ),
        gstRate: makeField(gstRateNum !== null ? gstRateNum : 0, cellConf(gstText)),
        cgst: makeField(cgstNum, cellConf(cellText(idxCgst))),
        sgst: makeField(sgstNum, cellConf(cellText(idxSgst))),
        igst: makeField(igstNum, cellConf(cellText(idxIgst))),
        lineTotal: makeField(totalNum !== null ? totalNum : 0, cellConf(cellText(idxTotal))),
      });
    }
  }

  return { items, summaryHints };
}

export function parsePaddleStructureResults(
  layoutParsingResults: Array<Record<string, unknown>>,
  processingMs: number
): PurchaseOcrRawResponse {
  const { lines, tables } = collectLinesAndTables(layoutParsingResults);
  const rawText = lines.map((l) => l.text).join('\n');

  // Supplier GSTIN (skip lines explicitly labeled as buyer/recipient when a supplier GSTIN also exists)
  let supplierGstin = '';
  let supplierGstinConf: number | null = null;
  let fallbackGstin = '';
  let fallbackGstinConf: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const { text, confidence } = lines[i];
    const m = text.replace(/\s+/g, '').match(GSTIN_RE);
    if (m) {
      const candidate = m[1].toUpperCase();
      const prevContext = `${lines[i - 1]?.text || ''} ${text}`.toLowerCase();
      const looksLikeBuyer = /\b(buyer|bill\s*to|recipient|consignee|customer)\b/i.test(
        prevContext
      );
      if (!fallbackGstin) {
        fallbackGstin = candidate;
        fallbackGstinConf = confidence;
      }
      if (!looksLikeBuyer) {
        supplierGstin = candidate;
        supplierGstinConf = confidence;
        break;
      }
    }
  }
  if (!supplierGstin && fallbackGstin) {
    supplierGstin = fallbackGstin;
    supplierGstinConf = fallbackGstinConf;
  }

  // Supplier business name
  let supplierName = '';
  let supplierNameConf: number | null = null;
  const skipWords = [
    'tax invoice',
    'invoice',
    'bill of supply',
    'original for recipient',
    'cash memo',
    'estimate',
    'gstin',
  ];
  for (const { text, confidence } of lines.slice(0, 12)) {
    const low = text.toLowerCase().trim();
    if (text.length < 3 || skipWords.some((w) => low.includes(w))) continue;
    if (GSTIN_RE.test(text.replace(/\s+/g, '')) || DATE_RE.test(text)) continue;
    supplierName = text.trim();
    supplierNameConf = confidence;
    break;
  }

  // State from GSTIN or text match
  let supplierState = '';
  let supplierStateConf: number | null = null;
  const derivedFromGstin = supplierGstin ? getStateFromGstin(supplierGstin) : '';
  if (derivedFromGstin) {
    supplierState = derivedFromGstin;
    supplierStateConf = supplierGstinConf;
  } else {
    for (const { text, confidence } of lines) {
      const low = text.toLowerCase();
      const matched = INDIAN_STATES.find((st) => low.includes(st.name.toLowerCase()));
      if (matched) {
        supplierState = matched.name;
        supplierStateConf = confidence;
        break;
      }
    }
  }

  // Phone & Email
  let supplierPhone = '';
  let supplierPhoneConf: number | null = null;
  let supplierEmail = '';
  let supplierEmailConf: number | null = null;

  for (const { text, confidence } of lines) {
    if (!supplierEmail) {
      const em = text.match(EMAIL_RE);
      if (em) {
        supplierEmail = em[0];
        supplierEmailConf = confidence;
      }
    }
    if (!supplierPhone) {
      const ph = text.match(PHONE_RE);
      if (ph) {
        supplierPhone = ph[0].trim();
        supplierPhoneConf = confidence;
      }
    }
  }

  // Address near top lines
  const addressLines: string[] = [];
  const addressConfs: number[] = [];
  for (const { text, confidence } of lines.slice(1, 14)) {
    const low = text.toLowerCase();
    if (
      ['invoice no', 'bill no', 'date', 'buyer', 'bill to', 'ship to', 'gstin'].some((k) =>
        low.includes(k)
      )
    ) {
      continue;
    }
    if (text === supplierName || EMAIL_RE.test(text)) continue;
    if (
      [
        'road',
        'street',
        'floor',
        'park',
        'nagar',
        'ind',
        'plot',
        'city',
        'dist',
        'pin',
        'mumbai',
        'delhi',
        'bengaluru',
        'pune',
        'chennai',
      ].some((k) => low.includes(k)) ||
      /\b\d{6}\b/.test(text)
    ) {
      addressLines.push(text);
      addressConfs.push(confidence);
    }
  }
  const supplierAddress = addressLines.slice(0, 3).join(', ');
  const supplierAddressConf =
    addressConfs.length > 0
      ? addressConfs.reduce((a, b) => a + b, 0) / addressConfs.length
      : null;

  // Invoice numbers, PO, Dates
  const invNumRes = findLabeledValue(lines, [
    /(?:invoice|bill)\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
    /\binv\s*(?:no\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
  ]);
  const poNumRes = findLabeledValue(lines, [
    /(?:p\.?o\.?|purchase\s*order|ref(?:erence)?)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
  ]);
  const invDateRes = findLabeledValue(lines, [
    /(?:invoice|bill)\s*date\s*[:\-]?\s*(.+)/i,
    /\bdated?\s*[:\-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}.*)/i,
  ]);
  const dueDateRes = findLabeledValue(lines, [/(?:due|payment\s*due)\s*date\s*[:\-]?\s*(.+)/i]);

  let invDate = '';
  let invDateConf = invDateRes.confidence;
  const invDateMatch = invDateRes.value.match(DATE_RE);
  if (invDateMatch) {
    invDate = normalizeDate(invDateMatch[1]);
  }
  if (!invDate) {
    for (const { text, confidence } of lines.slice(0, 25)) {
      const dm = text.match(DATE_RE);
      if (dm) {
        const parsed = normalizeDate(dm[1]);
        if (parsed) {
          invDate = parsed;
          invDateConf = confidence;
          break;
        }
      }
    }
  }

  let dueDate = '';
  const dueDateMatch = dueDateRes.value.match(DATE_RE);
  if (dueDateMatch) {
    dueDate = normalizeDate(dueDateMatch[1]);
  }

  const { items, summaryHints } = parseHtmlTableItems(tables, lines);

  const extractSummaryAmount = (
    patterns: RegExp[],
    hintKey?: string
  ): { value: number; confidence: number | null } => {
    const found = findLabeledValue(lines, patterns);
    if (found.value) {
      const n = parseNumber(found.value);
      if (n !== null) return { value: n, confidence: found.confidence };
    }
    if (hintKey && summaryHints[hintKey]) {
      return summaryHints[hintKey];
    }
    return { value: 0, confidence: null };
  };

  const subtotal = extractSummaryAmount(
    [/(?:sub\s*-?\s*total)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)/i],
    'subtotal'
  );
  const totalDiscount = extractSummaryAmount([
    /(?:total\s*)?discount\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)/i,
  ]);
  const totalTaxable = extractSummaryAmount([
    /(?:total\s*)?taxable\s*(?:value|amount)?\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)/i,
  ]);
  const cgstTotal = extractSummaryAmount([/(?:total\s*)?cgst\b[^0-9]*([\d,]+\.\d{1,2})/i]);
  const sgstTotal = extractSummaryAmount([
    /(?:total\s*)?(?:sgst|utgst)\b[^0-9]*([\d,]+\.\d{1,2})/i,
  ]);
  const igstTotal = extractSummaryAmount([/(?:total\s*)?igst\b[^0-9]*([\d,]+\.\d{1,2})/i]);
  let totalGst = extractSummaryAmount([
    /(?:total\s*(?:gst|tax))\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2})/i,
  ]);
  if (totalGst.value === 0 && (cgstTotal.value || sgstTotal.value || igstTotal.value)) {
    const confs = [cgstTotal.confidence, sgstTotal.confidence, igstTotal.confidence].filter(
      (c): c is number => c !== null
    );
    totalGst = {
      value: Math.round((cgstTotal.value + sgstTotal.value + igstTotal.value) * 100) / 100,
      confidence: confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
    };
  }
  const additionalCharges = extractSummaryAmount([
    /(?:freight|shipping|packing|other\s*charges|additional\s*charges)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2})/i,
  ]);
  const roundOff = extractSummaryAmount(
    [/round\s*off\s*[:\-]?\s*([\-+]?[\d,]+\.\d{1,2})/i],
    'roundOff'
  );
  const grandTotal = extractSummaryAmount(
    [
      /(?:grand\s*total|invoice\s*total|net\s*payable|total\s*payable)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{1,2}|\d[\d,]*)/i,
    ],
    'grandTotal'
  );

  return {
    success: true,
    engine: 'PaddleOCR PP-StructureV3',
    pageCount: Math.max(1, layoutParsingResults.length),
    processingMs,
    supplier: {
      businessName: makeField(supplierName, supplierNameConf),
      gstin: makeField(supplierGstin, supplierGstinConf),
      address: makeField(supplierAddress, supplierAddressConf),
      state: makeField(supplierState, supplierStateConf),
      phone: makeField(supplierPhone, supplierPhoneConf),
      email: makeField(supplierEmail, supplierEmailConf),
    },
    invoice: {
      invoiceNumber: makeField(invNumRes.value, invNumRes.confidence),
      invoiceDate: makeField(invDate, invDateConf),
      dueDate: makeField(dueDate, dueDateRes.confidence),
      poNumber: makeField(poNumRes.value, poNumRes.confidence),
    },
    items,
    summary: {
      subtotal: makeField(subtotal.value, subtotal.confidence),
      totalDiscount: makeField(totalDiscount.value, totalDiscount.confidence),
      totalTaxableValue: makeField(totalTaxable.value, totalTaxable.confidence),
      totalGst: makeField(totalGst.value, totalGst.confidence),
      cgstTotal: makeField(cgstTotal.value, cgstTotal.confidence),
      sgstTotal: makeField(sgstTotal.value, sgstTotal.confidence),
      igstTotal: makeField(igstTotal.value, igstTotal.confidence),
      additionalCharges: makeField(additionalCharges.value, additionalCharges.confidence),
      roundOff: makeField(roundOff.value, roundOff.confidence),
      grandTotal: makeField(grandTotal.value, grandTotal.confidence),
    },
    rawText: rawText.slice(0, 12000),
  };
}

export async function extractPurchaseBillWithPaddleJobsApi(params: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  token: string;
  jobUrl?: string;
  timeoutMs?: number;
}): Promise<PurchaseOcrRawResponse> {
  const startedAt = Date.now();
  const jobUrl = (params.jobUrl || DEFAULT_JOB_URL).trim().replace(/\/+$/, '');
  const timeoutMs = params.timeoutMs ?? 52_000;
  const deadline = startedAt + timeoutMs;

  const optionalPayload = {
    useDocOrientationClassify: false,
    useDocUnwarping: false,
    useChartRecognition: false,
  };

  const form = new FormData();
  form.append('model', MODEL_NAME);
  form.append('optionalPayload', JSON.stringify(optionalPayload));
  form.append('file', new Blob([new Uint8Array(params.buffer)], { type: params.mimeType }), params.fileName);

  const authHeader = `bearer ${params.token.trim()}`;

  const submitRes = await fetch(jobUrl, {
    method: 'POST',
    headers: { Authorization: authHeader },
    body: form,
    signal: AbortSignal.timeout(Math.max(10_000, deadline - Date.now())),
  });

  const submitJson = (await submitRes.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    data?: { jobId?: string };
  };

  if (!submitRes.ok || !submitJson?.data?.jobId) {
    throw new Error(
      submitJson?.msg || `PaddleOCR job submission failed (HTTP ${submitRes.status})`
    );
  }

  const jobId = submitJson.data.jobId;
  let jsonlUrl = '';

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    const pollRes = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(Math.min(15_000, remaining)),
    });

    if (!pollRes.ok) {
      throw new Error(`PaddleOCR job status poll failed (HTTP ${pollRes.status})`);
    }

    const pollJson = (await pollRes.json().catch(() => ({}))) as {
      data?: {
        state?: string;
        errorMsg?: string;
        resultUrl?: { jsonUrl?: string };
      };
    };

    const state = pollJson?.data?.state;
    if (state === 'done') {
      jsonlUrl = pollJson?.data?.resultUrl?.jsonUrl || '';
      if (!jsonlUrl) {
        throw new Error('PaddleOCR job finished without a result JSON URL');
      }
      break;
    }
    if (state === 'failed') {
      throw new Error(pollJson?.data?.errorMsg || 'PaddleOCR extraction failed on server');
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(2200, Math.max(200, deadline - Date.now()))));
  }

  if (!jsonlUrl) {
    const err = new Error(
      'PaddleOCR extraction timed out while waiting for PP-StructureV3 job completion.'
    );
    err.name = 'AbortError';
    throw err;
  }

  const jsonlRes = await fetch(jsonlUrl, {
    signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
  });
  if (!jsonlRes.ok) {
    throw new Error(`Failed to fetch PaddleOCR JSONL result (HTTP ${jsonlRes.status})`);
  }

  const jsonlText = await jsonlRes.text();
  const layoutParsingResults: Array<Record<string, unknown>> = [];

  for (const rawLine of jsonlText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsedLine = JSON.parse(line) as {
      result?: { layoutParsingResults?: Array<Record<string, unknown>> };
    };
    const pageResults = parsedLine?.result?.layoutParsingResults;
    if (Array.isArray(pageResults)) {
      layoutParsingResults.push(...pageResults);
    }
  }

  if (layoutParsingResults.length === 0) {
    throw new Error('PaddleOCR returned no layout parsing results for this document.');
  }

  return parsePaddleStructureResults(layoutParsingResults, Date.now() - startedAt);
}
