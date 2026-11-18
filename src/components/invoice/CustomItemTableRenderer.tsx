import * as React from 'react';
import type { ComputedLineItem, CustomColumnDef, CustomInvoiceLayout } from '../../shared/types';
import { formatINR } from '../../shared/gstCalculator';

export interface CustomItemTableRendererProps {
  layoutSnapshot?: CustomInvoiceLayout | null;
  items: ComputedLineItem[];
  accentColor?: string;
  borderColor?: string;
  isGst?: boolean;
  totalDiscount?: number;
  grandTotal: number;
  formatCurrency?: (val: number) => string;
}

export function formatCustomCellValue(
  column: CustomColumnDef,
  item: ComputedLineItem,
  formatCurrency = formatINR
): React.ReactNode {
  // 1. Check customFields first, then fallback to core mapped fields
  const customVal = item.customFields?.[column.key] ?? item.customFields?.[column.id];

  // Also check if mapping exists or if key matches standard line item keys
  let val = customVal;
  if (val === undefined || val === null || val === '') {
    if (column.mappingToCore === 'name' || column.key === 'particulars' || column.key === 'item_name') {
      val = item.name;
    } else if (column.mappingToCore === 'description' || column.key === 'description') {
      val = item.description;
    } else if (column.mappingToCore === 'hsnSac' || column.key === 'hsn_acs' || column.key === 'hsn_sac' || column.key === 'hsn') {
      val = item.hsnSac;
    } else if (column.mappingToCore === 'quantity' || column.key === 'quantity' || column.key === 'qty') {
      val = item.quantity;
    } else if (column.mappingToCore === 'rate' || column.key === 'rate' || column.key === 'rate_sq_ft' || column.key === 'rate_per_unit') {
      val = item.rate;
    } else if (column.mappingToCore === 'unit' || column.key === 'unit') {
      val = item.unit;
    } else if (column.mappingToCore === 'totalAmount' || column.key === 'amount') {
      val = item.totalAmount;
    }
  }

  // Format based on dataType
  if (val === undefined || val === null || val === '') {
    return <span className="text-zinc-400">-</span>;
  }

  switch (column.dataType) {
    case 'currency': {
      const num = Number(val);
      return <span className="font-mono">{Number.isFinite(num) ? formatCurrency(num) : String(val)}</span>;
    }

    case 'formula': {
      const num = Number(val);
      return (
        <span className="font-semibold font-mono text-zinc-900">
          {Number.isFinite(num) ? formatCurrency(num) : String(val)}
        </span>
      );
    }

    case 'decimal': {
      const num = Number(val);
      const prec = column.decimalPrecision ?? 2;
      return (
        <span className="font-mono">
          {Number.isFinite(num) ? num.toFixed(prec) : String(val)}{' '}
          {column.measurementUnit && <span className="text-zinc-500 text-[10px]">{column.measurementUnit}</span>}
        </span>
      );
    }

    case 'quantity': {
      const num = Number(val);
      const unit = column.measurementUnit || item.unit || '';
      return (
        <span className="font-mono">
          {Number.isFinite(num) ? String(num) : String(val)} {unit && <span className="text-zinc-500 text-[10px]">{unit}</span>}
        </span>
      );
    }

    case 'percentage': {
      const num = Number(val);
      return <span className="font-mono">{Number.isFinite(num) ? `${num}%` : String(val)}</span>;
    }

    case 'measurement': {
      const num = Number(val);
      const unit = column.measurementUnit || '';
      return (
        <span className="font-mono">
          {Number.isFinite(num) ? String(num) : String(val)} {unit && <span className="text-zinc-500 text-[10px]">{unit}</span>}
        </span>
      );
    }

    case 'text':
    default: {
      // If it's a name column, also render description underneath if present
      if ((column.mappingToCore === 'name' || column.key === 'particulars' || column.key === 'item_name') && item.description) {
        return (
          <div>
            <p className="font-semibold text-zinc-900 leading-snug">{String(val)}</p>
            <p className="text-[11px] text-zinc-500 whitespace-pre-line mt-0.5 leading-normal">{item.description}</p>
          </div>
        );
      }
      return <span className="text-zinc-800 break-words">{String(val)}</span>;
    }
  }
}

export function CustomItemTableRenderer({
  layoutSnapshot,
  items,
  accentColor = '#7B73D6',
  borderColor = '#6961C2',
  isGst = true,
  totalDiscount = 0,
  grandTotal,
  formatCurrency = formatINR,
}: CustomItemTableRendererProps) {
  const visibleColumns = (layoutSnapshot?.columns || []).filter((c) => c.visible !== false);

  if (visibleColumns.length === 0) return null;

  return (
    <div className="border border-zinc-200 rounded-sm overflow-hidden">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr style={{ backgroundColor: accentColor, color: '#ffffff' }} className="font-semibold text-[11px]">
            <th
              style={{ borderColor }}
              className="py-2.5 px-3 w-10 text-center border-r"
            >
              #
            </th>
            {visibleColumns.map((col, idx) => {
              const isLast = idx === visibleColumns.length - 1;
              const alignClass =
                col.align === 'center'
                  ? 'text-center'
                  : col.align === 'right'
                    ? 'text-right'
                    : 'text-left';
              return (
                <th
                  key={col.id || col.key}
                  style={{
                    borderColor,
                    width: col.width || undefined,
                  }}
                  className={`py-2.5 px-3 ${alignClass} ${!isLast ? 'border-r' : ''}`}
                >
                  {col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {items.map((item, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-zinc-50/50">
              <td className="py-2.5 px-3 text-center border-r border-zinc-200 text-zinc-500 font-mono text-[11px]">
                {rowIdx + 1}
              </td>
              {visibleColumns.map((col, colIdx) => {
                const isLast = colIdx === visibleColumns.length - 1;
                const alignClass =
                  col.align === 'center'
                    ? 'text-center'
                    : col.align === 'right'
                      ? 'text-right'
                      : 'text-left';
                return (
                  <td
                    key={col.id || col.key}
                    className={`py-2.5 px-3 ${alignClass} ${!isLast ? 'border-r border-zinc-200' : ''}`}
                  >
                    {formatCustomCellValue(col, item, formatCurrency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-50 font-bold text-zinc-900 border-t border-zinc-200 text-xs">
            <td
              colSpan={Math.max(1, visibleColumns.length)}
              className="py-2.5 px-3 text-right border-r border-zinc-200 uppercase tracking-wide text-[11px]"
            >
              Total
            </td>
            <td className="py-2.5 px-3 text-right font-mono text-zinc-900 font-bold">
              {formatCurrency(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
