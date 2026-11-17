/**
 * HSN and SAC Master Service for DronaInvoice
 * Provides lookup, search, description auto-population, and UQC code mapping.
 */

export interface HsnSacEntry {
  code: string;
  description: string;
  type: 'HSN' | 'SAC';
}

export interface UqcMapping {
  uqc: string;
  name: string;
}

// Standard GSTN Unit Quantity Codes (UQC)
export const GSTN_UQC_MAP: Record<string, string> = {
  nos: 'NOS',
  numbers: 'NOS',
  number: 'NOS',
  pcs: 'PCS',
  pieces: 'PCS',
  piece: 'PCS',
  unit: 'UNT',
  units: 'UNT',
  unt: 'UNT',
  kg: 'KGS',
  kgs: 'KGS',
  kilogram: 'KGS',
  kilograms: 'KGS',
  gm: 'GMS',
  gms: 'GMS',
  gram: 'GMS',
  grams: 'GMS',
  mg: 'MGS',
  milligram: 'MGS',
  mtr: 'MTR',
  meter: 'MTR',
  meters: 'MTR',
  metre: 'MTR',
  metres: 'MTR',
  cm: 'CMS',
  centimeter: 'CMS',
  centimeters: 'CMS',
  mm: 'MLT',
  sqm: 'SQM',
  sqmtr: 'SQM',
  'sq.m': 'SQM',
  'sq.meter': 'SQM',
  sqf: 'SQF',
  sqft: 'SQF',
  'sq.ft': 'SQF',
  'sq.feet': 'SQF',
  sqy: 'SQY',
  'sq.yard': 'SQY',
  cum: 'CUM',
  'cu.m': 'CUM',
  cuf: 'CUF',
  'cu.ft': 'CUF',
  ltr: 'LTR',
  litre: 'LTR',
  litres: 'LTR',
  liter: 'LTR',
  liters: 'LTR',
  ml: 'MLT',
  millilitre: 'MLT',
  ton: 'TON',
  tonne: 'TON',
  tonnes: 'TON',
  mt: 'TON',
  qtl: 'QTL',
  quintal: 'QTL',
  box: 'BOX',
  boxes: 'BOX',
  btl: 'BTL',
  bottle: 'BTL',
  bottles: 'BTL',
  can: 'CAN',
  cans: 'CAN',
  ctn: 'CTN',
  carton: 'CTN',
  cartons: 'CTN',
  bag: 'BAG',
  bags: 'BAG',
  pac: 'PAC',
  pack: 'PAC',
  packs: 'PAC',
  packet: 'PAC',
  packets: 'PAC',
  set: 'SET',
  sets: 'SET',
  rol: 'ROL',
  roll: 'ROL',
  rolls: 'ROL',
  tub: 'TUB',
  tube: 'TUB',
  tubes: 'TUB',
  prs: 'PRS',
  pair: 'PRS',
  pairs: 'PRS',
  thd: 'THD',
  thousand: 'THD',
  dzn: 'DOZ',
  dozen: 'DOZ',
  dozens: 'DOZ',
  ggs: 'GGR',
  greatgross: 'GGR',
  oth: 'OTH',
  other: 'OTH',
  others: 'OTH',
};

// In-memory cache for HSN/SAC data
let hsnList: HsnSacEntry[] = [];
let sacList: HsnSacEntry[] = [];
let codeMap = new Map<string, HsnSacEntry>();
let isLoaded = false;
let loadPromise: Promise<boolean> | null = null;

/**
 * Loads HSN/SAC master from public json dataset
 */
export async function loadHsnSacMaster(): Promise<boolean> {
  if (isLoaded) return true;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      // Try /HSN_SAC.json first, fallback to asset path
      let res = await fetch('/HSN_SAC.json');
      if (!res.ok) {
        res = await fetch('/assets/aistudio/HSN_SAC_cf58a712.json');
      }
      if (!res.ok) {
        throw new Error(`Failed to load HSN_SAC: ${res.statusText}`);
      }
      const data = await res.json();
      
      const newCodeMap = new Map<string, HsnSacEntry>();
      const newHsnList: HsnSacEntry[] = [];
      const newSacList: HsnSacEntry[] = [];

      if (Array.isArray(data.hsn)) {
        for (const item of data.hsn) {
          if (item.code && item.description) {
            const entry: HsnSacEntry = {
              code: String(item.code).trim(),
              description: String(item.description).trim(),
              type: 'HSN',
            };
            newHsnList.push(entry);
            newCodeMap.set(entry.code, entry);
          }
        }
      }

      if (Array.isArray(data.sac)) {
        for (const item of data.sac) {
          if (item.code && item.description) {
            const entry: HsnSacEntry = {
              code: String(item.code).trim(),
              description: String(item.description).trim(),
              type: 'SAC',
            };
            newSacList.push(entry);
            newCodeMap.set(entry.code, entry);
          }
        }
      }

      hsnList = newHsnList;
      sacList = newSacList;
      codeMap = newCodeMap;
      isLoaded = true;
      return true;
    } catch (err) {
      console.warn('Could not load HSN_SAC dataset dynamically:', err);
      return false;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Direct lookup by code (exact match)
 */
export function lookupHsnSac(code: string): HsnSacEntry | null {
  if (!code) return null;
  const clean = String(code).trim();
  const direct = codeMap.get(clean);
  if (direct) return direct;
  
  // Try with/without leading zeroes
  const stripped = clean.replace(/^0+/, '');
  if (stripped && codeMap.has(stripped)) return codeMap.get(stripped)!;
  const padded2 = clean.padStart(2, '0');
  if (codeMap.has(padded2)) return codeMap.get(padded2)!;
  const padded4 = clean.padStart(4, '0');
  if (codeMap.has(padded4)) return codeMap.get(padded4)!;
  
  return null;
}

/**
 * Get description for a code
 */
export function getHsnSacDescription(code: string): string {
  const match = lookupHsnSac(code);
  return match ? match.description : '';
}

/**
 * Search HSN/SAC entries by code prefix or description keywords
 */
export function searchHsnSac(query: string, limit = 15): HsnSacEntry[] {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const results: HsnSacEntry[] = [];
  const exactPrefixMatches: HsnSacEntry[] = [];
  const descMatches: HsnSacEntry[] = [];

  const combined = [...sacList, ...hsnList];
  
  for (const item of combined) {
    const codeLower = item.code.toLowerCase();
    const descLower = item.description.toLowerCase();

    if (codeLower === q) {
      exactPrefixMatches.unshift(item);
    } else if (codeLower.startsWith(q)) {
      exactPrefixMatches.push(item);
    } else if (descLower.includes(q)) {
      descMatches.push(item);
    }

    if (exactPrefixMatches.length >= limit) break;
  }

  results.push(...exactPrefixMatches);
  const remaining = limit - results.length;
  if (remaining > 0) {
    results.push(...descMatches.slice(0, remaining));
  }

  return results.slice(0, limit);
}

/**
 * Maps any user unit string (e.g., "Nos", "Kg", "Pieces") to GSTN UQC code
 */
export function mapUnitToUqc(unit: string | undefined): string {
  if (!unit) return 'OTH';
  const clean = unit.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (GSTN_UQC_MAP[clean]) {
    return GSTN_UQC_MAP[clean];
  }
  // If unit itself is 3 uppercase chars in standard list
  const upper = unit.trim().toUpperCase();
  const validUqcs = new Set([
    'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM',
    'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS',
    'KLR', 'KME', 'MLT', 'MTR', 'MTS', 'NOS', 'PAC', 'PCS', 'PRS', 'QTL',
    'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB',
    'UGS', 'UNT', 'YDS', 'OTH',
  ]);
  if (validUqcs.has(upper)) return upper;

  return 'OTH';
}

/**
 * Validates digit requirement based on GST turnover rule:
 * - Up to 5 Crore: Minimum 4 digits required for B2B supplies
 * - Above 5 Crore: Minimum 6 digits required for B2B supplies
 */
export function validateHsnDigitRequirement(
  code: string,
  annualTurnoverExceeds5Cr = false
): {
  valid: boolean;
  length: number;
  requiredLength: number;
  message?: string;
} {
  const digits = String(code).replace(/\D/g, '');
  const len = digits.length;
  const required = annualTurnoverExceeds5Cr ? 6 : 4;

  if (len === 0) {
    return {
      valid: false,
      length: 0,
      requiredLength: required,
      message: 'HSN/SAC code is missing',
    };
  }

  // 2-digit chapter headings are allowed for summary, but 4 or 6 are required for GSTR-1 item reporting
  if (len < required) {
    return {
      valid: false,
      length: len,
      requiredLength: required,
      message: `HSN/SAC code ${digits} has only ${len} digits. GST requires at least ${required} digits${
        annualTurnoverExceeds5Cr ? ' (Turnover > ₹5 Cr)' : ' (Turnover ≤ ₹5 Cr)'
      }.`,
    };
  }

  return {
    valid: true,
    length: len,
    requiredLength: required,
  };
}
