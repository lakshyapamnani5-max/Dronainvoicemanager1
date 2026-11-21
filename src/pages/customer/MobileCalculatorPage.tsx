import * as React from 'react';
import {
  Check,
  Copy,
  Delete,
  History,
  Percent,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { formatINR } from '../../shared/gstCalculator';
import { useToast } from '../../components/ui/toast';

type CalcTab = 'standard' | 'gst' | 'history';

interface HistoryEntry {
  id: string;
  expression: string;
  result: string;
  note?: string;
  createdAt: number;
}

const HISTORY_STORAGE_KEY = 'drona_v1_calc_history';
const MAX_HISTORY_ITEMS = 40;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS))
    );
  } catch {
    // ignore storage quota errors
  }
}

function cleanNumber(num: number): number {
  if (!Number.isFinite(num)) return NaN;
  const rounded = Number(num.toPrecision(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatCalcNumber(num: number): string {
  const clean = cleanNumber(num);
  if (!Number.isFinite(clean)) return 'Error';
  if (Math.abs(clean) >= 1e13 || (clean !== 0 && Math.abs(clean) < 1e-9)) {
    return clean.toExponential(6).replace(/\.?0+e/, 'e');
  }
  return String(clean);
}

function formatDisplayWithCommas(raw: string): string {
  if (!raw || raw === 'Error') return raw;
  return raw.replace(/-?\d+(?:\.\d+)?/g, (numToken) => {
    if (numToken.includes('e') || numToken.includes('E')) return numToken;
    const isNeg = numToken.startsWith('-');
    const unsigned = isNeg ? numToken.slice(1) : numToken;
    const dotIdx = unsigned.indexOf('.');
    const intPart = dotIdx >= 0 ? unsigned.slice(0, dotIdx) : unsigned;
    const decPart = dotIdx >= 0 ? unsigned.slice(dotIdx) : '';
    const formattedInt = Number(intPart).toLocaleString('en-IN');
    return `${isNeg ? '-' : ''}${formattedInt}${decPart}`;
  });
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'pct' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenizeExpression(expr: string): Token[] | null {
  const s = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\s+/g, '');
  if (!s) return null;

  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Unary minus at start, after operator, or after '('
    const prev = tokens[tokens.length - 1];
    const expectsUnary = !prev || prev.type === 'op' || prev.type === 'lparen';

    if ((ch >= '0' && ch <= '9') || ch === '.' || (ch === '-' && expectsUnary)) {
      let numStr = '';
      if (ch === '-') {
        numStr += '-';
        i += 1;
        if (i < s.length && s[i] === '(') {
          tokens.push({ type: 'num', value: -1 });
          tokens.push({ type: 'op', value: '*' });
          continue;
        }
      }
      let dotSeen = false;
      let digitSeen = false;
      while (i < s.length) {
        const c = s[i];
        if (c >= '0' && c <= '9') {
          numStr += c;
          digitSeen = true;
          i += 1;
        } else if (c === '.' && !dotSeen) {
          numStr += '.';
          dotSeen = true;
          i += 1;
        } else {
          break;
        }
      }
      if (!digitSeen) return null;
      const val = Number(numStr);
      if (!Number.isFinite(val)) return null;
      // Implicit multiplication if preceded by ')' or '%'
      if (prev && (prev.type === 'rparen' || prev.type === 'pct')) {
        tokens.push({ type: 'op', value: '*' });
      }
      tokens.push({ type: 'num', value: val });
      continue;
    }

    if (ch === '%') {
      if (!prev || (prev.type !== 'num' && prev.type !== 'rparen' && prev.type !== 'pct')) {
        return null;
      }
      tokens.push({ type: 'pct' });
      i += 1;
      continue;
    }

    if (ch === '(') {
      if (prev && (prev.type === 'num' || prev.type === 'rparen' || prev.type === 'pct')) {
        tokens.push({ type: 'op', value: '*' });
      }
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }

    return null;
  }

  return tokens;
}

/**
 * Recursive-descent evaluator supporting smart financial percentage semantics:
 * - A + B%  => A + (A * B / 100)
 * - A - B%  => A - (A * B / 100)
 * - A * B%  => A * (B / 100)
 * - A / B%  => A / (B / 100)
 * - standalone B% => B / 100
 */
function evaluateExpression(expr: string): { ok: true; value: number } | { ok: false; error: string } {
  // Trim trailing operators for live preview safety when requested externally
  const tokens = tokenizeExpression(expr);
  if (!tokens || tokens.length === 0) {
    return { ok: false, error: 'Invalid expression' };
  }

  let pos = 0;

  function parsePrimary(): { value: number; isPercent: boolean } | null {
    const tok = tokens![pos];
    if (!tok) return null;
    let base: number | null = null;
    if (tok.type === 'num') {
      pos += 1;
      base = tok.value;
    } else if (tok.type === 'lparen') {
      pos += 1;
      const inner = parseAddSub();
      if (inner === null) return null;
      if (tokens![pos]?.type === 'rparen') {
        pos += 1;
      }
      base = inner;
    } else {
      return null;
    }

    let pctCount = 0;
    while (tokens![pos]?.type === 'pct') {
      pos += 1;
      pctCount += 1;
    }
    if (pctCount > 1) {
      // Apply extra percent conversions cleanly
      for (let k = 1; k < pctCount; k += 1) {
        base /= 100;
      }
    }
    return { value: base, isPercent: pctCount > 0 };
  }

  function parseMulDiv(): { value: number; isPercent: boolean } | null {
    const first = parsePrimary();
    if (!first) return null;

    let acc = first.isPercent ? first.value / 100 : first.value;
    let isCombinedPercent = first.isPercent;

    while (pos < tokens!.length) {
      const opTok = tokens![pos];
      if (opTok.type !== 'op' || (opTok.value !== '*' && opTok.value !== '/')) break;
      pos += 1;
      const right = parsePrimary();
      if (!right) return null;
      const rhs = right.isPercent ? right.value / 100 : right.value;
      isCombinedPercent = false;
      if (opTok.value === '*') {
        acc = acc * rhs;
      } else {
        if (rhs === 0) throw new Error('Cannot divide by 0');
        acc = acc / rhs;
      }
    }
    return {
      value: isCombinedPercent ? first.value : acc,
      isPercent: isCombinedPercent,
    };
  }

  function parseAddSub(): number | null {
    const first = parseMulDiv();
    if (!first) return null;
    let acc = first.isPercent ? first.value / 100 : first.value;

    while (pos < tokens!.length) {
      const opTok = tokens![pos];
      if (opTok.type !== 'op' || (opTok.value !== '+' && opTok.value !== '-')) break;
      pos += 1;
      const right = parseMulDiv();
      if (!right) return null;
      const delta = right.isPercent ? (acc * right.value) / 100 : right.value;
      acc = opTok.value === '+' ? acc + delta : acc - delta;
    }
    return acc;
  }

  try {
    const result = parseAddSub();
    if (result === null || pos !== tokens.length || !Number.isFinite(result)) {
      return { ok: false, error: 'Invalid expression' };
    }
    return { ok: true, value: cleanNumber(result) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error' };
  }
}

const OPERATORS = ['+', '−', '×', '÷'];

export function MobileCalculatorPage({
  onUseAmountInSale,
}: {
  onUseAmountInSale?: (amount: number) => void;
}) {
  const { notify } = useToast();
  const [activeTab, setActiveTab] = React.useState<CalcTab>('standard');

  // Standard calculator state
  const [expression, setExpression] = React.useState('');
  const [justEvaluated, setJustEvaluated] = React.useState(false);
  const [evalError, setEvalError] = React.useState<string | null>(null);
  const [gstStripMode, setGstStripMode] = React.useState<'add' | 'remove'>('add');
  const [memory, setMemory] = React.useState<number>(0);
  const [copiedKey, setCopiedKey] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryEntry[]>(() => loadHistory());

  // GST & Discount calculator state
  const [gstAmountStr, setGstAmountStr] = React.useState('1000');
  const [gstDiscountType, setGstDiscountType] = React.useState<'percent' | 'fixed'>('percent');
  const [gstDiscountStr, setGstDiscountStr] = React.useState('');
  const [gstSlab, setGstSlab] = React.useState<number>(18);
  const [gstPricingMode, setGstPricingMode] = React.useState<'exclusive' | 'inclusive'>('exclusive');
  const [gstSupplyType, setGstSupplyType] = React.useState<'intra' | 'inter'>('intra');

  const recordHistory = React.useCallback((exprText: string, resText: string, note?: string) => {
    const entry: HistoryEntry = {
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      expression: exprText,
      result: resText,
      note,
      createdAt: Date.now(),
    };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, MAX_HISTORY_ITEMS);
      saveHistory(next);
      return next;
    });
  }, []);

  // Compute live preview of current expression
  const liveEvaluation = React.useMemo(() => {
    if (!expression.trim()) return null;
    // Strip trailing operator or '(' so user still sees live preview while typing
    let candidate = expression.trim();
    while (candidate.length > 0 && /[+\-×÷−(]$/.test(candidate)) {
      candidate = candidate.slice(0, -1).trim();
    }
    if (!candidate) return null;
    return evaluateExpression(candidate);
  }, [expression]);

  const activeNumericValue = React.useMemo(() => {
    if (liveEvaluation?.ok) return liveEvaluation.value;
    const direct = Number(expression);
    return Number.isFinite(direct) ? direct : 0;
  }, [liveEvaluation, expression]);

  const appendDigitOrDot = React.useCallback(
    (ch: string) => {
      setEvalError(null);
      setExpression((prev) => {
        const base = justEvaluated ? '' : prev;
        setJustEvaluated(false);

        if (ch === '.') {
          // Find current number segment
          const match = base.match(/([0-9.]+)$/);
          if (match && match[1].includes('.')) return base;
          if (!match) return `${base}0.`;
          return `${base}.`;
        }

        if (ch === '00') {
          if (!base || /[+\-×÷−(]$/.test(base)) return `${base}0`;
          const match = base.match(/(?:^|[+\-×÷−(])(0+)$/);
          if (match && !base.endsWith('.')) return base;
          return `${base}00`;
        }

        // Prevent redundant leading zeroes like "00" on integer start
        const leadingZeroMatch = base.match(/(^|[+\-×÷−(])0$/);
        if (leadingZeroMatch && ch !== '.') {
          return `${base.slice(0, -1)}${ch}`;
        }

        return `${base}${ch}`;
      });
    },
    [justEvaluated]
  );

  const appendOperator = React.useCallback(
    (op: '+' | '−' | '×' | '÷') => {
      setEvalError(null);
      setJustEvaluated(false);
      setExpression((prev) => {
        if (!prev) {
          return op === '−' ? '−' : '0' + op;
        }
        if (prev === '−') {
          return op === '−' ? prev : '';
        }
        const last = prev[prev.length - 1];
        if (OPERATORS.includes(last)) {
          return `${prev.slice(0, -1)}${op}`;
        }
        if (last === '(') {
          return op === '−' ? `${prev}−` : prev;
        }
        return `${prev}${op}`;
      });
    },
    []
  );

  const appendPercent = React.useCallback(() => {
    setEvalError(null);
    setJustEvaluated(false);
    setExpression((prev) => {
      if (!prev) return '';
      const last = prev[prev.length - 1];
      if (/[0-9)]$/.test(last)) {
        return `${prev}%`;
      }
      return prev;
    });
  }, []);

  const toggleParenthesis = React.useCallback(() => {
    setEvalError(null);
    setExpression((prev) => {
      const base = justEvaluated ? '' : prev;
      setJustEvaluated(false);
      if (!base) return '(';
      const openCount = (base.match(/\(/g) || []).length;
      const closeCount = (base.match(/\)/g) || []).length;
      const last = base[base.length - 1];
      if (openCount > closeCount && /[0-9)%]$/.test(last)) {
        return `${base})`;
      }
      return `${base}(`;
    });
  }, [justEvaluated]);

  const handleBackspace = React.useCallback(() => {
    setEvalError(null);
    if (justEvaluated) {
      setExpression('');
      setJustEvaluated(false);
      return;
    }
    setExpression((prev) => prev.slice(0, -1));
  }, [justEvaluated]);

  const handleClear = React.useCallback(() => {
    setExpression('');
    setEvalError(null);
    setJustEvaluated(false);
  }, []);

  const handleEquals = React.useCallback(() => {
    if (!expression.trim()) return;
    let targetExpr = expression.trim();
    // Auto-close unbalanced parentheses
    const openCount = (targetExpr.match(/\(/g) || []).length;
    const closeCount = (targetExpr.match(/\)/g) || []).length;
    if (openCount > closeCount && /[0-9)%]$/.test(targetExpr)) {
      targetExpr += ')'.repeat(openCount - closeCount);
    }

    const res = evaluateExpression(targetExpr);
    if (!res.ok) {
      setEvalError(res.error);
      return;
    }
    const formatted = formatCalcNumber(res.value);
    recordHistory(targetExpr, formatted);
    setExpression(formatted);
    setEvalError(null);
    setJustEvaluated(true);
  }, [expression, recordHistory]);

  const handleQuickGst = (rate: number) => {
    setEvalError(null);
    const val = activeNumericValue;
    if (!expression.trim() || !Number.isFinite(val)) return;

    if (gstStripMode === 'add') {
      const gstAmt = cleanNumber((val * rate) / 100);
      const total = cleanNumber(val + gstAmt);
      const formatted = formatCalcNumber(total);
      recordHistory(
        `${formatCalcNumber(val)} + ${rate}% GST`,
        formatted,
        `Tax: ${formatINR(gstAmt)} (${rate / 2}% CGST + ${rate / 2}% SGST)`
      );
      setExpression(formatted);
      setJustEvaluated(true);
    } else {
      const base = cleanNumber(val / (1 + rate / 100));
      const gstAmt = cleanNumber(val - base);
      const formatted = formatCalcNumber(base);
      recordHistory(
        `${formatCalcNumber(val)} Excl. ${rate}% GST`,
        formatted,
        `Removed GST: ${formatINR(gstAmt)}`
      );
      setExpression(formatted);
      setJustEvaluated(true);
    }
  };

  const handleCopyResult = async () => {
    const valToCopy =
      liveEvaluation?.ok ? formatCalcNumber(liveEvaluation.value) : expression || '0';
    try {
      await navigator.clipboard.writeText(valToCopy);
      setCopiedKey(true);
      notify('success', `Copied ${valToCopy}`);
      setTimeout(() => setCopiedKey(false), 1500);
    } catch {
      notify('error', 'Unable to copy to clipboard');
    }
  };

  // Physical keyboard support
  React.useEffect(() => {
    if (activeTab !== 'standard') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        appendDigitOrDot(e.key);
      } else if (e.key === '.') {
        e.preventDefault();
        appendDigitOrDot('.');
      } else if (e.key === '+') {
        e.preventDefault();
        appendOperator('+');
      } else if (e.key === '-') {
        e.preventDefault();
        appendOperator('−');
      } else if (e.key === '*') {
        e.preventDefault();
        appendOperator('×');
      } else if (e.key === '/') {
        e.preventDefault();
        appendOperator('÷');
      } else if (e.key === '%') {
        e.preventDefault();
        appendPercent();
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEquals();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeTab,
    appendDigitOrDot,
    appendOperator,
    appendPercent,
    handleBackspace,
    handleClear,
    handleEquals,
  ]);

  // GST & Discount Breakdown computation
  const gstCalc = React.useMemo(() => {
    const rawAmt = Math.max(0, Number(gstAmountStr) || 0);
    const rawDisc = Math.max(0, Number(gstDiscountStr) || 0);

    if (gstPricingMode === 'exclusive') {
      const discAmt =
        gstDiscountType === 'percent'
          ? Math.min(rawAmt, (rawAmt * rawDisc) / 100)
          : Math.min(rawAmt, rawDisc);
      const taxable = Math.max(0, rawAmt - discAmt);
      const totalTax = (taxable * gstSlab) / 100;
      const cgst = gstSupplyType === 'intra' ? totalTax / 2 : 0;
      const sgst = gstSupplyType === 'intra' ? totalTax / 2 : 0;
      const igst = gstSupplyType === 'inter' ? totalTax : 0;
      const netTotal = taxable + totalTax;
      return {
        gross: rawAmt,
        discAmt,
        taxable,
        cgst,
        sgst,
        igst,
        totalTax,
        netTotal,
      };
    }

    // Tax-inclusive reverse calculation: discount applies on inclusive value first
    const discAmt =
      gstDiscountType === 'percent'
        ? Math.min(rawAmt, (rawAmt * rawDisc) / 100)
        : Math.min(rawAmt, rawDisc);
    const netTotal = Math.max(0, rawAmt - discAmt);
    const taxable = gstSlab > 0 ? netTotal / (1 + gstSlab / 100) : netTotal;
    const totalTax = netTotal - taxable;
    const cgst = gstSupplyType === 'intra' ? totalTax / 2 : 0;
    const sgst = gstSupplyType === 'intra' ? totalTax / 2 : 0;
    const igst = gstSupplyType === 'inter' ? totalTax : 0;
    return {
      gross: rawAmt,
      discAmt,
      taxable,
      cgst,
      sgst,
      igst,
      totalTax,
      netTotal,
    };
  }, [gstAmountStr, gstDiscountType, gstDiscountStr, gstSlab, gstPricingMode, gstSupplyType]);

  return (
    <div className="mx-auto w-full max-w-md flex flex-col gap-3">
      {/* Top Segmented Switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-3 flex-1 rounded-xl bg-zinc-200/80 dark:bg-zinc-900 p-1 border border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('standard')}
            className={`min-h-[38px] rounded-lg px-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'standard'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Calculator
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gst')}
            className={`min-h-[38px] rounded-lg px-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'gst'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            GST Calc
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`min-h-[38px] rounded-lg px-2 text-xs font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            History{history.length > 0 ? ` (${history.length})` : ''}
          </button>
        </div>
      </div>

      {/* ==================== TAB 1: STANDARD + QUICK GST CALCULATOR ==================== */}
      {activeTab === 'standard' ? (
        <div className="flex flex-col gap-2.5">
          {/* Display Card */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3.5 shadow-xs">
            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 min-h-[20px]">
              <div className="flex items-center gap-2 font-mono tabular-nums truncate">
                {memory !== 0 ? (
                  <span className="font-semibold text-[#F57C00]">
                    M {formatCalcNumber(memory)}
                  </span>
                ) : (
                  <span>Standard &amp; GST</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyResult}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  aria-label="Copy current result"
                >
                  {copiedKey ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Active Expression */}
            <div className="mt-2 min-h-[38px] max-h-[76px] overflow-y-auto text-right font-mono text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 break-all tabular-nums leading-tight">
              {expression ? formatDisplayWithCommas(expression) : '0'}
            </div>

            {/* Live Preview or Error */}
            <div className="mt-1.5 min-h-[24px] flex items-center justify-end text-right font-mono text-sm tabular-nums">
              {evalError ? (
                <span className="text-red-500 font-medium">{evalError}</span>
              ) : !justEvaluated && liveEvaluation?.ok ? (
                <span className="text-zinc-500 dark:text-zinc-400">
                  = {formatDisplayWithCommas(formatCalcNumber(liveEvaluation.value))}
                </span>
              ) : justEvaluated && history[0]?.note ? (
                <span className="text-[#F57C00] text-xs font-medium truncate">
                  {history[0].note}
                </span>
              ) : (
                <span className="text-zinc-400 dark:text-zinc-600 text-xs">
                  Ready
                </span>
              )}
            </div>
          </div>

          {/* Quick GST Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <button
              type="button"
              onClick={() => setGstStripMode((m) => (m === 'add' ? 'remove' : 'add'))}
              className={`h-9 px-2.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                gstStripMode === 'add'
                  ? 'border-[#F57C00]/40 bg-orange-50 text-[#F57C00] dark:bg-orange-950/30 dark:border-orange-800/60'
                  : 'border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
              }`}
              title="Toggle Add GST vs Remove GST"
            >
              {gstStripMode === 'add' ? '+GST' : 'Excl. GST'}
            </button>
            {[5, 12, 18, 28].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => handleQuickGst(rate)}
                className="flex-1 min-w-[54px] h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono font-semibold text-zinc-800 dark:text-zinc-200 hover:border-[#F57C00] active:scale-95 transition-transform cursor-pointer"
              >
                {gstStripMode === 'add' ? `+${rate}%` : `−${rate}%`}
              </button>
            ))}
          </div>

          {/* Memory & Paren Row */}
          <div className="grid grid-cols-5 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setMemory(0);
                notify('success', 'Memory cleared');
              }}
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 text-xs font-semibold text-zinc-600 dark:text-zinc-300 active:scale-95 transition-transform cursor-pointer"
            >
              MC
            </button>
            <button
              type="button"
              onClick={() => {
                setEvalError(null);
                const memStr = formatCalcNumber(memory);
                setExpression((prev) => (justEvaluated || !prev ? memStr : `${prev}${memStr}`));
                setJustEvaluated(false);
              }}
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 text-xs font-semibold text-zinc-600 dark:text-zinc-300 active:scale-95 transition-transform cursor-pointer"
            >
              MR
            </button>
            <button
              type="button"
              onClick={() => {
                setMemory((m) => cleanNumber(m + activeNumericValue));
              }}
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 text-xs font-semibold text-zinc-600 dark:text-zinc-300 active:scale-95 transition-transform cursor-pointer"
            >
              M+
            </button>
            <button
              type="button"
              onClick={() => {
                setMemory((m) => cleanNumber(m - activeNumericValue));
              }}
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 text-xs font-semibold text-zinc-600 dark:text-zinc-300 active:scale-95 transition-transform cursor-pointer"
            >
              M−
            </button>
            <button
              type="button"
              onClick={toggleParenthesis}
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900 text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-200 active:scale-95 transition-transform cursor-pointer"
            >
              ( )
            </button>
          </div>

          {/* Main 4x5 Keypad */}
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200/75 dark:bg-zinc-800 text-base font-bold text-red-600 dark:text-red-400 active:scale-95 transition-transform cursor-pointer"
            >
              AC
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              aria-label="Backspace"
              className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200/75 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-200 active:scale-95 transition-transform cursor-pointer"
            >
              <Delete className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={appendPercent}
              aria-label="Percent"
              className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-200/75 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-200 active:scale-95 transition-transform cursor-pointer"
            >
              <Percent className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => appendOperator('÷')}
              className="h-14 rounded-2xl border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/30 text-xl font-semibold text-[#F57C00] active:scale-95 transition-transform cursor-pointer"
            >
              ÷
            </button>

            {['7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => appendDigitOrDot(d)}
                className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform cursor-pointer"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => appendOperator('×')}
              className="h-14 rounded-2xl border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/30 text-xl font-semibold text-[#F57C00] active:scale-95 transition-transform cursor-pointer"
            >
              ×
            </button>

            {['4', '5', '6'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => appendDigitOrDot(d)}
                className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform cursor-pointer"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => appendOperator('−')}
              className="h-14 rounded-2xl border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/30 text-xl font-semibold text-[#F57C00] active:scale-95 transition-transform cursor-pointer"
            >
              −
            </button>

            {['1', '2', '3'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => appendDigitOrDot(d)}
                className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform cursor-pointer"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => appendOperator('+')}
              className="h-14 rounded-2xl border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/30 text-xl font-semibold text-[#F57C00] active:scale-95 transition-transform cursor-pointer"
            >
              +
            </button>

            <button
              type="button"
              onClick={() => appendDigitOrDot('00')}
              className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-lg font-mono font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform cursor-pointer"
            >
              00
            </button>
            <button
              type="button"
              onClick={() => appendDigitOrDot('0')}
              className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform cursor-pointer"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => appendDigitOrDot('.')}
              className="h-14 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform cursor-pointer"
            >
              .
            </button>
            <button
              type="button"
              onClick={handleEquals}
              className="h-14 rounded-2xl bg-[#F57C00] hover:bg-[#E65100] text-2xl font-bold text-white shadow-sm active:scale-95 transition-transform cursor-pointer"
              aria-label="Equals"
            >
              =
            </button>
          </div>
        </div>
      ) : null}

      {/* ==================== TAB 2: GST & DISCOUNT CALCULATOR ==================== */}
      {activeTab === 'gst' ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3.5 shadow-xs">
            <div className="space-y-1">
              <label
                htmlFor="gst-calc-amount"
                className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Amount (₹)
              </label>
              <input
                id="gst-calc-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={gstAmountStr}
                onChange={(e) => setGstAmountStr(e.target.value)}
                placeholder="0.00"
                className="w-full h-11 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100 focus:border-[#F57C00] focus:outline-none tabular-nums"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Discount
                </label>
                <div className="flex items-center gap-1">
                  <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden shrink-0">
                    <button
                      type="button"
                      onClick={() => setGstDiscountType('percent')}
                      className={`px-2 h-10 text-xs font-bold cursor-pointer ${
                        gstDiscountType === 'percent'
                          ? 'bg-[#F57C00] text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() => setGstDiscountType('fixed')}
                      className={`px-2 h-10 text-xs font-bold cursor-pointer ${
                        gstDiscountType === 'fixed'
                          ? 'bg-[#F57C00] text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      ₹
                    </button>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={gstDiscountStr}
                    onChange={(e) => setGstDiscountStr(e.target.value)}
                    placeholder="0"
                    className="w-full min-w-0 h-10 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2.5 font-mono text-sm text-zinc-900 dark:text-zinc-100 focus:border-[#F57C00] focus:outline-none tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Tax Mode
                </label>
                <div className="grid grid-cols-2 rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden h-10">
                  <button
                    type="button"
                    onClick={() => setGstPricingMode('exclusive')}
                    className={`text-xs font-semibold cursor-pointer ${
                      gstPricingMode === 'exclusive'
                        ? 'bg-[#F57C00] text-white'
                        : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    +GST
                  </button>
                  <button
                    type="button"
                    onClick={() => setGstPricingMode('inclusive')}
                    className={`text-xs font-semibold cursor-pointer ${
                      gstPricingMode === 'inclusive'
                        ? 'bg-[#F57C00] text-white'
                        : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    Incl.
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-600 dark:text-zinc-400">GST Slab</span>
                <button
                  type="button"
                  onClick={() =>
                    setGstSupplyType((s) => (s === 'intra' ? 'inter' : 'intra'))
                  }
                  className="font-semibold text-[#F57C00] cursor-pointer"
                >
                  {gstSupplyType === 'intra' ? 'Intra-State (CGST+SGST)' : 'Inter-State (IGST)'}
                </button>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {[0, 3, 5, 12, 18, 28].map((slab) => (
                  <button
                    key={slab}
                    type="button"
                    onClick={() => setGstSlab(slab)}
                    className={`h-10 rounded-lg border text-xs font-mono font-semibold cursor-pointer transition-colors ${
                      gstSlab === slab
                        ? 'border-[#F57C00] bg-[#F57C00] text-white'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {slab}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Result Breakdown */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Taxable Value</span>
              <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                {formatINR(gstCalc.taxable)}
              </span>
            </div>
            {gstCalc.discAmt > 0 ? (
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>Discount Applied</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                  −{formatINR(gstCalc.discAmt)}
                </span>
              </div>
            ) : null}
            {gstSupplyType === 'intra' ? (
              <>
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>CGST ({gstSlab / 2}%)</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums">
                    {formatINR(gstCalc.cgst)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>SGST ({gstSlab / 2}%)</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums">
                    {formatINR(gstCalc.sgst)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>IGST ({gstSlab}%)</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200 tabular-nums">
                  {formatINR(gstCalc.igst)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>Total GST</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                {formatINR(gstCalc.totalTax)}
              </span>
            </div>

            <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Net Total
              </span>
              <span className="font-mono text-xl font-bold text-[#F57C00] tabular-nums">
                {formatINR(gstCalc.netTotal)}
              </span>
            </div>

            <div className="pt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={async () => {
                  const val = formatCalcNumber(gstCalc.netTotal);
                  try {
                    await navigator.clipboard.writeText(val);
                    notify('success', `Copied ₹${val}`);
                  } catch {
                    notify('error', 'Failed to copy');
                  }
                }}
                className="h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy Total
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = formatCalcNumber(gstCalc.netTotal);
                  setExpression(val);
                  setJustEvaluated(true);
                  setActiveTab('standard');
                }}
                className="h-11 rounded-xl bg-[#F57C00] text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Send to Calc
              </button>
            </div>
            {onUseAmountInSale && gstCalc.netTotal > 0 ? (
              <button
                type="button"
                onClick={() => onUseAmountInSale(cleanNumber(gstCalc.netTotal))}
                className="w-full h-11 rounded-xl border border-[#F57C00]/40 bg-orange-50 dark:bg-orange-950/30 text-xs font-semibold text-[#F57C00] cursor-pointer"
              >
                Use {formatINR(gstCalc.netTotal)} in New Sale
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ==================== TAB 3: CALCULATION HISTORY ==================== */}
      {activeTab === 'history' ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Recent Calculations
            </span>
            {history.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setHistory([]);
                  saveHistory([]);
                  notify('success', 'Calculator history cleared');
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </button>
            ) : null}
          </div>
          {history.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No calculations yet. Tap numbers in the Calculator tab to see your tape here.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[60dvh] overflow-y-auto">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setExpression(item.result);
                    setJustEvaluated(true);
                    setEvalError(null);
                    setActiveTab('standard');
                  }}
                  className="w-full text-right px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
                >
                  <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400 break-all">
                    {formatDisplayWithCommas(item.expression)}
                  </div>
                  <div className="font-mono text-lg font-bold text-zinc-900 dark:text-zinc-100 tabular-nums mt-0.5">
                    = {formatDisplayWithCommas(item.result)}
                  </div>
                  {item.note ? (
                    <div className="text-[11px] text-[#F57C00] mt-0.5">{item.note}</div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
