import * as React from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { QUOTATION_THEMES, normalizeQuotationTemplateId } from './quotationThemeRegistry';
import type { QuotationTemplateId } from './quotationThemeTypes';

interface QuotationThemeSelectorProps {
  currentThemeId?: string | null;
  defaultThemeId?: string | null;
  onSelectTheme: (themeId: QuotationTemplateId) => void;
  onSetAsDefault?: (themeId: QuotationTemplateId) => void;
  isSettingDefault?: boolean;
  className?: string;
}

export function QuotationThemeSelector({
  currentThemeId,
  defaultThemeId,
  onSelectTheme,
  onSetAsDefault,
  isSettingDefault = false,
  className = '',
}: QuotationThemeSelectorProps) {
  const activeNormalized = normalizeQuotationTemplateId(currentThemeId);
  const defaultNormalized = normalizeQuotationTemplateId(defaultThemeId);
  const isCurrentDefault = activeNormalized === defaultNormalized;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
            Quotation Theme ({QUOTATION_THEMES.length})
          </span>
          {isCurrentDefault ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Default
            </span>
          ) : null}
        </div>

        {onSetAsDefault && !isCurrentDefault ? (
          <button
            type="button"
            disabled={isSettingDefault}
            onClick={() => onSetAsDefault(activeNormalized)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/30 px-2.5 py-1 text-[11px] font-medium text-[#D96B00] dark:text-[#FF9E40] hover:bg-orange-100 dark:hover:bg-orange-950/50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Star className="h-3 w-3 fill-current" />
            {isSettingDefault ? 'Saving...' : 'Set as Default Quotation Theme'}
          </button>
        ) : null}
      </div>

      {/* Horizontal scrollable thumbnail strip for mobile & compact editor panels */}
      <div className="flex items-stretch gap-2.5 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
        {QUOTATION_THEMES.map((theme) => {
          const isSelected = activeNormalized === theme.id;
          const isDefault = defaultNormalized === theme.id;
          const ThumbComponent = theme.thumbnail;

          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => onSelectTheme(theme.id)}
              className={`group relative shrink-0 w-[108px] rounded-xl border p-2 text-left transition-all cursor-pointer flex flex-col items-center ${
                isSelected
                  ? 'border-[#F57C00] bg-orange-50/60 dark:bg-orange-950/20 ring-2 ring-[#F57C00]/25 shadow-sm'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              {isDefault ? (
                <div
                  title="Workspace Default Quotation Theme"
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm"
                >
                  <CheckCircle2 className="h-2.5 w-2.5" />
                </div>
              ) : null}

              <div
                className={`w-full aspect-[3/4] mb-1.5 rounded overflow-hidden flex items-center justify-center bg-zinc-50 dark:bg-zinc-800/50 p-1 border ${
                  isSelected
                    ? 'border-[#F57C00]/40'
                    : 'border-zinc-100 dark:border-zinc-800'
                }`}
              >
                <ThumbComponent isSelected={isSelected} />
              </div>

              <div className="w-full text-center">
                <p
                  className={`text-[11px] font-semibold truncate ${
                    isSelected
                      ? 'text-[#D96B00] dark:text-[#FF9E40]'
                      : 'text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  {theme.name}
                </p>
                <p className="text-[9px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  {theme.orientation === 'landscape' ? 'A4 Landscape' : theme.tagline}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
