import * as React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { CustomColumnDef } from '../../../shared/customLayoutTypes';
import { validateFormula } from '../../../lib/formulaEngine';

export interface FormulaBuilderControlProps {
  formula: string;
  columns: CustomColumnDef[];
  currentColumnKey: string;
  onChange: (newFormula: string) => void;
}

export function FormulaBuilderControl({
  formula,
  columns,
  currentColumnKey,
  onChange,
}: FormulaBuilderControlProps) {
  // Only numeric or calculated columns other than the current column can be used
  const availableColumns = columns.filter(
    (c) =>
      c.key !== currentColumnKey &&
      ['number', 'decimal', 'currency', 'quantity', 'measurement', 'percentage', 'formula'].includes(
        c.dataType
      )
  );

  const availableKeys = availableColumns.map((c) => c.key);
  const validation = React.useMemo(() => {
    if (!formula.trim()) return { isValid: true, empty: true };
    return validateFormula(formula, availableKeys);
  }, [formula, availableKeys]);

  const insertToken = (tok: string) => {
    const spaceBefore = formula.length > 0 && !formula.endsWith(' ') && !tok.startsWith(' ') ? ' ' : '';
    onChange(`${formula}${spaceBefore}${tok} `);
  };

  return (
    <div className="space-y-3 bg-zinc-50 dark:bg-zinc-800/50 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div>
        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 block mb-1.5">
          Insert Numeric Columns:
        </label>
        <div className="flex flex-wrap gap-1.5">
          {availableColumns.length === 0 ? (
            <span className="text-xs text-zinc-400 italic">
              No other numeric columns in this layout yet. Add numeric or decimal columns to reference them.
            </span>
          ) : (
            availableColumns.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => insertToken(c.key)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
                title={`Insert ${c.label} (${c.key})`}
              >
                <span className="font-semibold">{c.label}</span>
                <span className="text-[10px] opacity-75 font-mono">[{c.key}]</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 block mb-1.5">
          Arithmetic Operators:
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: '+', val: '+' },
            { label: '-', val: '-' },
            { label: '×', val: '*' },
            { label: '÷', val: '/' },
            { label: '(', val: '(' },
            { label: ')', val: ')' },
          ].map((op) => (
            <button
              key={op.label}
              type="button"
              onClick={() => insertToken(op.val)}
              className="px-3 py-1 text-xs font-bold rounded-md bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-600 transition-colors shadow-2xs font-mono"
            >
              {op.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange('')}
            className="px-2.5 py-1 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors ml-auto"
          >
            Clear Formula
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 block mb-1">
          Formula Expression:
        </label>
        <input
          type="text"
          value={formula}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. total_sq_ft * rate_sq_ft"
          className="w-full px-3 py-2 text-xs font-mono rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Validation Feedback */}
      {formula.trim() && (
        <div className="pt-1">
          {validation.isValid ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>Valid mathematical formula. Evaluates safely at runtime.</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
              <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <span>{'error' in validation && validation.error ? validation.error : 'Invalid formula expression'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
