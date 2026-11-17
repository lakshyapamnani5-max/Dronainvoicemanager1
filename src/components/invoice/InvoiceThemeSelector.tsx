import * as React from 'react';
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Sparkles, Star } from 'lucide-react';
import { INVOICE_THEMES, normalizeTemplateId } from './invoiceThemeRegistry';
import type { StandardTemplateId } from './invoiceThemeTypes';
import type { TemplateId } from '../../shared/types';
import { Button } from '../ui/button';

interface InvoiceThemeSelectorProps {
  currentThemeId: TemplateId;
  defaultThemeId?: TemplateId;
  onSelectTheme: (themeId: StandardTemplateId) => void;
  onSetAsDefault?: (themeId: StandardTemplateId) => Promise<void> | void;
  isSettingDefault?: boolean;
  className?: string;
  showThumbnails?: boolean;
}

export function InvoiceThemeSelector({
  currentThemeId,
  defaultThemeId,
  onSelectTheme,
  onSetAsDefault,
  isSettingDefault = false,
  className = '',
  showThumbnails = true,
}: InvoiceThemeSelectorProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const activeNormalized = normalizeTemplateId(currentThemeId);
  const defaultNormalized = normalizeTemplateId(defaultThemeId);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -240 : 240;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  const isCurrentDefault = activeNormalized === defaultNormalized;

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header bar: Label & Set As Default button */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#F57C00]" />
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Invoice Theme &amp; Layout (9 Themes)
          </span>
          {isCurrentDefault && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-medium border border-emerald-200 dark:border-emerald-800">
              <Check className="h-3 w-3" />
              Default for All Invoices
            </span>
          )}
        </div>

        {onSetAsDefault && !isCurrentDefault && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSettingDefault}
            onClick={() => void onSetAsDefault(activeNormalized)}
            className="h-7 text-xs px-2.5 cursor-pointer text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white border-zinc-300 dark:border-zinc-700"
            title="Set this theme as default for all existing and new invoices"
          >
            <Star className="h-3.5 w-3.5 mr-1 text-[#F57C00] fill-[#F57C00]/20" />
            <span>{isSettingDefault ? 'Setting...' : 'Set as Default'}</span>
          </Button>
        )}
      </div>

      {/* Horizontally scrollable carousel */}
      <div className="relative group">
        {/* Scroll Left Button */}
        <button
          type="button"
          onClick={() => scroll('left')}
          className="absolute -left-2 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-7 w-7 items-center justify-center rounded-full bg-white dark:bg-zinc-800 shadow-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 hover:text-zinc-900 dark:text-zinc-200 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
          aria-label="Scroll themes left"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex items-center gap-2.5 overflow-x-auto pb-2 pt-1 px-1 scrollbar-thin no-scrollbar scroll-smooth"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {INVOICE_THEMES.map((theme) => {
            const isSelected = activeNormalized === theme.id;
            const isDefault = defaultNormalized === theme.id;
            const Thumb = theme.thumbnail;

            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onSelectTheme(theme.id)}
                className={`shrink-0 flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer text-left ${
                  isSelected
                    ? 'border-[#F57C00] bg-orange-50/70 dark:bg-orange-950/20 ring-2 ring-[#F57C00]/20 shadow-sm'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                }`}
                style={{ scrollSnapAlign: 'start', width: showThumbnails ? '118px' : 'auto' }}
                title={`${theme.name} – ${theme.tagline}`}
              >
                {showThumbnails && (
                  <div className="relative w-full h-20 mb-2 rounded overflow-hidden bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center p-1">
                    <Thumb isSelected={isSelected} />
                    {isDefault && (
                      <span className="absolute top-1 right-1 bg-emerald-600 text-white rounded-full p-0.5 shadow-sm" title="Default template">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                    {theme.orientation === 'landscape' && (
                      <span className="absolute bottom-1 left-1 bg-zinc-900/80 text-white text-[8px] font-medium px-1 rounded">
                        Landscape
                      </span>
                    )}
                  </div>
                )}

                <div className="w-full text-center">
                  <span
                    className={`block text-xs font-semibold truncate ${
                      isSelected
                        ? 'text-[#F57C00] dark:text-[#F57C00]'
                        : 'text-zinc-800 dark:text-zinc-200'
                    }`}
                  >
                    {theme.name}
                  </span>
                  <span className="block text-[10px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                    {theme.orientation === 'landscape' ? 'A4 Landscape' : theme.tagline}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Scroll Right Button */}
        <button
          type="button"
          onClick={() => scroll('right')}
          className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-7 w-7 items-center justify-center rounded-full bg-white dark:bg-zinc-800 shadow-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 hover:text-zinc-900 dark:text-zinc-200 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
          aria-label="Scroll themes right"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
