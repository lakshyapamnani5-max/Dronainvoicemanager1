import * as React from 'react';
import { Search, Check, Sparkles, AlertCircle } from 'lucide-react';
import {
  loadHsnSacMaster,
  lookupHsnSac,
  searchHsnSac,
  type HsnSacEntry,
} from '../lib/hsnSacService';

interface HsnSacSelectorProps {
  value: string;
  onChange: (code: string) => void;
  onSelectDescription?: (description: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  currentDescription?: string;
}

export function HsnSacSelector({
  value,
  onChange,
  onSelectDescription,
  placeholder = 'HSN / SAC Code',
  className = '',
  disabled = false,
  currentDescription = '',
}: HsnSacSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [results, setResults] = React.useState<HsnSacEntry[]>([]);
  const [matchedEntry, setMatchedEntry] = React.useState<HsnSacEntry | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  // Initialize master on mount
  React.useEffect(() => {
    void loadHsnSacMaster();
  }, []);

  // Update matched entry whenever value changes
  React.useEffect(() => {
    if (value && value.trim()) {
      const match = lookupHsnSac(value.trim());
      setMatchedEntry(match);
    } else {
      setMatchedEntry(null);
    }
  }, [value]);

  // Handle outside clicks to close dropdown
  React.useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value.replace(/[^0-9a-zA-Z]/g, '');
    onChange(nextVal);

    if (nextVal.length >= 2) {
      const hits = searchHsnSac(nextVal, 8);
      setResults(hits);
      setOpen(hits.length > 0);
    } else {
      setResults([]);
      setOpen(false);
    }

    // If exact match found as user types, optionally auto-fill description if currently empty
    const exact = lookupHsnSac(nextVal);
    if (exact && onSelectDescription && (!currentDescription || currentDescription.trim() === '')) {
      onSelectDescription(exact.description);
    }
  };

  const handleSelect = (item: HsnSacEntry) => {
    onChange(item.code);
    setMatchedEntry(item);
    setOpen(false);
    if (onSelectDescription) {
      onSelectDescription(item.description);
    }
  };

  const handleFillDescription = () => {
    if (matchedEntry && onSelectDescription) {
      onSelectDescription(matchedEntry.description);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => {
            if (value && value.length >= 2) {
              const hits = searchHsnSac(value, 8);
              setResults(hits);
              setOpen(hits.length > 0);
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className={`h-10 w-full rounded-md border border-zinc-200 bg-white px-3 pr-7 text-xs font-mono text-zinc-900 transition-colors placeholder:text-zinc-400 focus:border-[#F57C00] focus:ring-1 focus:ring-[#F57C00] focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 ${className}`}
        />
        {matchedEntry ? (
          <span
            title="Official HSN/SAC code recognized"
            className="absolute right-2 text-emerald-600 dark:text-emerald-400"
          >
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : (
          <Search className="absolute right-2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-60 w-80 sm:w-96 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
            Suggested HSN / SAC Codes
          </div>
          {results.map((item) => (
            <button
              key={`${item.type}-${item.code}`}
              type="button"
              onClick={() => handleSelect(item)}
              className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#F57C00] dark:bg-zinc-800">
                {item.code}
              </span>
              <div className="flex-1 truncate">
                <span className="text-[11px] text-zinc-800 dark:text-zinc-200 block truncate">
                  {item.description}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {item.type === 'SAC' ? 'Service (SAC)' : 'Goods (HSN)'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Matched HSN/SAC Info Badge & Quick-fill button */}
      {matchedEntry && (
        <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          <span className="truncate max-w-[200px] sm:max-w-[280px]" title={matchedEntry.description}>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {matchedEntry.type}:
            </span>{' '}
            {matchedEntry.description}
          </span>
          {(!currentDescription || currentDescription.trim() !== matchedEntry.description) && (
            <button
              type="button"
              onClick={handleFillDescription}
              title="Populate line item description with official HSN/SAC description"
              className="inline-flex items-center gap-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#F57C00] hover:bg-orange-50 dark:hover:bg-orange-950/30 cursor-pointer"
            >
              <Sparkles className="h-2.5 w-2.5" />
              <span>Fill Desc</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
