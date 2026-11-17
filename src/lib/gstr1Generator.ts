/**
 * GSTN GSTR-1 Official JSON Generator for DronaInvoice
 * Transforms classified transaction data into the official GST Offline Tool schema.
 */

import type { Invoice } from '../shared/types';
import {
  type GstReturnConfig,
  type Gstr1B2BGroup,
  type Gstr1B2BInvoice,
  type Gstr1B2CLGroup,
  type Gstr1B2CLInvoice,
  type Gstr1B2CSRow,
  type Gstr1CdnrGroup,
  type Gstr1CdnrNote,
  type Gstr1CdnurRow,
  type Gstr1ComprehensiveSummary,
  type Gstr1ExpGroup,
  type Gstr1ExpInvoice,
  type Gstr1ItemDetail,
  type Gstr1JsonPayload,
  type Gstr1NilItem,
} from '../shared/gstnTypes';

/**
 * Format date from ISO (YYYY-MM-DD) to GSTN format (DD-MM-YYYY)
 */
export function formatGstnDate(isoDate: string | undefined): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return isoDate;
}

/**
 * Round number to exactly 2 decimals
 */
export function round2(num: number | undefined): number {
  if (!num || !Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

/**
 * Builds standard GSTN item lines grouped by tax rate
 */
function buildGstnItemDetails(inv: Invoice, isInterState: boolean): Gstr1ItemDetail[] {
  const rateMap = new Map<
    number,
    { txval: number; iamt: number; camt: number; samt: number; csamt: number }
  >();

  for (const item of inv.items || []) {
    const rate = Number(item.taxRate) || 0;
    const bucket = rateMap.get(rate) || {
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0,
    };

    bucket.txval += item.taxableAmount || 0;
    bucket.iamt += item.igstAmount || 0;
    bucket.camt += item.cgstAmount || 0;
    bucket.samt += item.sgstAmount || 0;
    rateMap.set(rate, bucket);
  }

  const items: Gstr1ItemDetail[] = [];
  let num = 1;

  for (const [rate, b] of rateMap.entries()) {
    const itm_det: Gstr1ItemDetail['itm_det'] = {
      txval: round2(b.txval),
      rt: rate,
    };

    if (isInterState) {
      itm_det.iamt = round2(b.iamt);
    } else {
      itm_det.camt = round2(b.camt);
      itm_det.samt = round2(b.samt);
    }
    itm_det.csamt = round2(b.csamt);

    items.push({ num: num++, itm_det });
  }

  return items;
}

/**
 * Builds the complete GSTR-1 JSON Payload adhering to the official GSTN Schema
 */
export function generateGstr1JsonPayload(
  summary: Gstr1ComprehensiveSummary,
  invoices: Invoice[],
  config: GstReturnConfig
): Gstr1JsonPayload {
  const gstin = (config.gstin || '').trim().toUpperCase();
  const fp = config.periodCode; // MMYYYY

  // Map of invoice by ID for fast lookup of original data
  const invMap = new Map<string, Invoice>();
  for (const inv of invoices) {
    invMap.set(inv.id, inv);
  }

  // 1. B2B Invoices (Table 4)
  const b2bGroupsMap = new Map<string, Gstr1B2BInvoice[]>();

  // 2. B2CL Invoices (Table 5)
  const b2clGroupsMap = new Map<string, Gstr1B2CLInvoice[]>();

  // 3. B2CS Aggregate Rows (Table 7)
  const b2csMap = new Map<string, Gstr1B2CSRow>();

  // 4. CDNR Notes (Table 9B)
  const cdnrGroupsMap = new Map<string, Gstr1CdnrNote[]>();

  // 5. CDNUR Notes (Table 9B)
  const cdnurRows: Gstr1CdnurRow[] = [];

  // 6. EXP Invoices (Table 6A)
  const expWpayInvoices: Gstr1ExpInvoice[] = [];
  const expWopayInvoices: Gstr1ExpInvoice[] = [];

  // 7. NIL Rated Supplies (Table 8)
  const nilBuckets: Record<string, { nil_amt: number; expt_amt: number; ngsup_amt: number }> = {
    INTRAB2B: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
    INTRAB2C: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
    INTERB2B: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
    INTERB2C: { nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
  };

  // Process all active classified transactions
  for (const tx of summary.transactions) {
    if (tx.isCancelled || tx.isDraft) continue;
    const rawInv = invMap.get(tx.invoiceId);
    if (!rawInv) continue;

    const idt = formatGstnDate(tx.invoiceDate);
    const inum = tx.invoiceNumber;
    const val = round2(tx.invoiceValue);
    const pos = tx.posCode;
    const itms = buildGstnItemDetails(rawInv, tx.isInterState);

    switch (tx.category) {
      case 'B2B': {
        const ctin = tx.customerGstin;
        const b2bInv: Gstr1B2BInvoice = {
          inum,
          idt,
          val,
          pos,
          rchrg: 'N',
          inv_ty: (tx.subType as 'R' | 'DE' | 'SEWP' | 'SEWOP') || 'R',
          itms,
        };
        const existing = b2bGroupsMap.get(ctin) || [];
        existing.push(b2bInv);
        b2bGroupsMap.set(ctin, existing);
        break;
      }

      case 'B2CL': {
        const b2clInv: Gstr1B2CLInvoice = {
          inum,
          idt,
          val,
          itms,
        };
        const existing = b2clGroupsMap.get(pos) || [];
        existing.push(b2clInv);
        b2clGroupsMap.set(pos, existing);
        break;
      }

      case 'B2CS': {
        // In GSTR-1 Table 7, B2CS is reported as aggregate lines grouped by (sply_ty, pos, typ, rt)
        const sply_ty: 'INTER' | 'INTRA' = tx.isInterState ? 'INTER' : 'INTRA';
        const typ: 'OE' | 'E' = 'OE';

        for (const it of itms) {
          const rate = it.itm_det.rt;
          const key = `${sply_ty}_${pos}_${typ}_${rate}`;
          const existing = b2csMap.get(key) || {
            sply_ty,
            pos,
            typ,
            rt: rate,
            txval: 0,
            iamt: 0,
            camt: 0,
            samt: 0,
            csamt: 0,
          };

          existing.txval += it.itm_det.txval;
          existing.iamt = (existing.iamt || 0) + (it.itm_det.iamt || 0);
          existing.camt = (existing.camt || 0) + (it.itm_det.camt || 0);
          existing.samt = (existing.samt || 0) + (it.itm_det.samt || 0);
          existing.csamt = (existing.csamt || 0) + (it.itm_det.csamt || 0);
          b2csMap.set(key, existing);
        }
        break;
      }

      case 'CDNR': {
        const ctin = tx.customerGstin;
        const note: Gstr1CdnrNote = {
          ntty: (tx.subType as 'C' | 'D') || 'C',
          nt_num: inum,
          nt_dt: idt,
          p_gst: 'N',
          val,
          pos,
          rchrg: 'N',
          inv_ty: 'R',
          itms,
        };
        const existing = cdnrGroupsMap.get(ctin) || [];
        existing.push(note);
        cdnrGroupsMap.set(ctin, existing);
        break;
      }

      case 'CDNUR': {
        const cdnurRow: Gstr1CdnurRow = {
          typ: 'B2CL',
          ntty: (tx.subType as 'C' | 'D') || 'C',
          nt_num: inum,
          nt_dt: idt,
          p_gst: 'N',
          pos,
          val,
          itms,
        };
        cdnurRows.push(cdnurRow);
        break;
      }

      case 'EXP': {
        const expInv: Gstr1ExpInvoice = {
          inum,
          idt,
          val,
          sbnum: rawInv.referenceNumber || undefined,
          sbdt: idt,
          itms,
        };
        if (tx.subType === 'WPAY') {
          expWpayInvoices.push(expInv);
        } else {
          expWopayInvoices.push(expInv);
        }
        break;
      }

      case 'NIL': {
        const prefix = tx.isInterState ? 'INTER' : 'INTRA';
        const suffix = tx.isRegistered ? 'B2B' : 'B2C';
        const bucketKey = `${prefix}${suffix}`;
        if (nilBuckets[bucketKey]) {
          nilBuckets[bucketKey].nil_amt += tx.taxableAmount;
        }
        break;
      }
    }
  }

  // Build final sections
  const b2b: Gstr1B2BGroup[] = [];
  for (const [ctin, invList] of b2bGroupsMap.entries()) {
    b2b.push({ ctin, cfs: 'Y', inv: invList });
  }

  const b2cl: Gstr1B2CLGroup[] = [];
  for (const [pos, invList] of b2clGroupsMap.entries()) {
    b2cl.push({ pos, inv: invList });
  }

  const b2cs: Gstr1B2CSRow[] = Array.from(b2csMap.values()).map((row) => ({
    sply_ty: row.sply_ty,
    pos: row.pos,
    typ: row.typ,
    rt: row.rt,
    txval: round2(row.txval),
    iamt: round2(row.iamt),
    camt: round2(row.camt),
    samt: round2(row.samt),
    csamt: round2(row.csamt),
  }));

  const cdnr: Gstr1CdnrGroup[] = [];
  for (const [ctin, ntList] of cdnrGroupsMap.entries()) {
    cdnr.push({ ctin, cfs: 'Y', nt: ntList });
  }

  const exp: Gstr1ExpGroup[] = [];
  if (expWpayInvoices.length > 0) {
    exp.push({ exp_typ: 'WPAY', inv: expWpayInvoices });
  }
  if (expWopayInvoices.length > 0) {
    exp.push({ exp_typ: 'WOPAY', inv: expWopayInvoices });
  }

  // Nil items
  const nilInv: Gstr1NilItem[] = (
    ['INTRAB2B', 'INTRAB2C', 'INTERB2B', 'INTERB2C'] as const
  ).map((sply_ty) => ({
    sply_ty,
    nil_amt: round2(nilBuckets[sply_ty].nil_amt),
    expt_amt: round2(nilBuckets[sply_ty].expt_amt),
    ngsup_amt: round2(nilBuckets[sply_ty].ngsup_amt),
  }));

  // Construct Root Object matching GSTN Specification
  const payload: Gstr1JsonPayload = {
    gstin,
    fp,
    gt: round2(config.previousFyTurnover || 0),
    cur_gt: round2(config.currentFyTurnover || summary.totalTaxableValue),
    version: 'GSTR1_V1.1',
    hash: 'hash',
  };

  if (b2b.length > 0) payload.b2b = b2b;
  if (b2cl.length > 0) payload.b2cl = b2cl;
  if (b2cs.length > 0) payload.b2cs = b2cs;
  if (cdnr.length > 0) payload.cdnr = cdnr;
  if (cdnurRows.length > 0) payload.cdnur = cdnurRows;
  if (exp.length > 0) payload.exp = exp;

  const hasNil = nilInv.some((n) => n.nil_amt > 0 || n.expt_amt > 0 || n.ngsup_amt > 0);
  if (hasNil) {
    payload.nil = { inv: nilInv };
  }

  if (summary.hsnSummary && summary.hsnSummary.length > 0) {
    payload.hsn = {
      data: summary.hsnSummary.map((h) => ({
        num: h.num,
        hsn_sc: h.hsn_sc,
        desc: h.desc,
        uqc: h.uqc,
        qty: round2(h.qty),
        txval: round2(h.txval),
        rt: h.rt,
        iamt: round2(h.iamt),
        camt: round2(h.camt),
        samt: round2(h.samt),
        csamt: round2(h.csamt),
      })),
    };
  }

  if (summary.docSummary && summary.docSummary.length > 0) {
    payload.doc_issue = {
      doc_det: summary.docSummary,
    };
  }

  return payload;
}

/**
 * Returns standardized filename for the GSTR-1 export: <GSTIN>_GSTR1_<MMYYYY>.json
 */
export function getGstr1ExportFilename(gstin: string, periodCode: string): string {
  const cleanGstin = (gstin || 'NO_GSTIN').trim().toUpperCase();
  return `${cleanGstin}_GSTR1_${periodCode}.json`;
}

/**
 * Initiates browser download of generated GSTR-1 JSON
 */
export function downloadGstr1JsonFile(payload: Gstr1JsonPayload): void {
  const filename = getGstr1ExportFilename(payload.gstin, payload.fp);
  const jsonContent = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
