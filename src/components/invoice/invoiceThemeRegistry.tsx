import * as React from 'react';
import type { InvoiceThemeDefinition, StandardTemplateId } from './invoiceThemeTypes';
import { GSTTheme1 } from './templates/GSTTheme1';
import { GSTTheme2 } from './templates/GSTTheme2';
import { GSTTheme3 } from './templates/GSTTheme3';
import { GSTTheme4 } from './templates/GSTTheme4';
import { GSTTheme5 } from './templates/GSTTheme5';
import { GSTTheme6 } from './templates/GSTTheme6';
import { DoubleDivine } from './templates/DoubleDivine';
import { FrenchElite } from './templates/FrenchElite';
import { LandscapeTheme2 } from './templates/LandscapeTheme2';

/* Miniature visual SVG thumbnails for each template */
function ThumbnailGSTTheme1({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      {/* Title */}
      <rect x="22" y="4" width="16" height="3" fill="#18181b" rx="1" />
      {/* Grid Box */}
      <rect x="4" y="10" width="52" height="14" fill="#fafafa" stroke="#d4d4d8" strokeWidth="0.8" />
      <line x1="32" y1="10" x2="32" y2="24" stroke="#d4d4d8" strokeWidth="0.8" />
      <rect x="7" y="13" width="6" height="6" fill="#e4e4e7" />
      <rect x="15" y="13" width="14" height="2" fill="#52525b" />
      <rect x="35" y="13" width="14" height="2" fill="#71717a" />
      {/* Bill To */}
      <rect x="4" y="26" width="52" height="7" fill="#f4f4f5" stroke="#d4d4d8" strokeWidth="0.8" />
      {/* Table */}
      <rect x="4" y="35" width="52" height="6" fill="#e4e4e7" />
      <rect x="4" y="41" width="52" height="18" fill="none" stroke="#d4d4d8" strokeWidth="0.8" />
      <line x1="18" y1="35" x2="18" y2="59" stroke="#d4d4d8" strokeWidth="0.5" />
      <line x1="38" y1="35" x2="38" y2="59" stroke="#d4d4d8" strokeWidth="0.5" />
      {/* Bottom */}
      <rect x="4" y="61" width="28" height="10" fill="#fafafa" />
      <rect x="34" y="61" width="22" height="10" fill="#f4f4f5" stroke="#d4d4d8" strokeWidth="0.8" />
    </svg>
  );
}

function ThumbnailGSTTheme2({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      <rect x="20" y="4" width="20" height="3" fill="#18181b" rx="1" />
      {/* Top row */}
      <rect x="5" y="10" width="8" height="8" fill="#e0e7ff" rx="1" />
      <rect x="32" y="10" width="23" height="10" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="0.7" rx="1" />
      {/* Purple banner */}
      <rect x="5" y="22" width="50" height="5" fill="#7C78D4" rx="1" />
      {/* Table */}
      <rect x="5" y="32" width="50" height="6" fill="#7C78D4" />
      <rect x="5" y="38" width="50" height="20" fill="none" stroke="#e4e4e7" strokeWidth="0.8" />
      {/* Summary */}
      <rect x="33" y="60" width="22" height="11" fill="#f5f3ff" stroke="#ddd6fe" strokeWidth="0.8" rx="1" />
    </svg>
  );
}

function ThumbnailGSTTheme3({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      {/* Boxed business left */}
      <rect x="5" y="5" width="24" height="12" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="0.7" rx="1" strokeDasharray="2 1" />
      <rect x="47" y="5" width="8" height="8" fill="#e0e7ff" rx="1" />
      <rect x="20" y="20" width="20" height="3" fill="#18181b" rx="1" />
      {/* Table */}
      <rect x="5" y="30" width="50" height="6" fill="#7B73D6" />
      <rect x="5" y="36" width="50" height="22" fill="none" stroke="#e4e4e7" strokeWidth="0.8" />
      {/* Signatory */}
      <rect x="32" y="60" width="23" height="11" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="0.8" rx="1" />
    </svg>
  );
}

function ThumbnailGSTTheme4({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      <rect x="20" y="4" width="20" height="3" fill="#18181b" rx="1" />
      <rect x="5" y="10" width="8" height="8" fill="#e2e8f0" rx="1" />
      <rect x="30" y="10" width="25" height="10" fill="#f0f9ff" stroke="#bae6fd" strokeWidth="0.7" rx="2" />
      <rect x="5" y="22" width="50" height="5" fill="#7C78D4" />
      <rect x="5" y="32" width="50" height="6" fill="#7C78D4" />
      <rect x="5" y="38" width="50" height="16" fill="none" stroke="#e4e4e7" strokeWidth="0.8" />
      {/* Colored words bar */}
      <rect x="5" y="56" width="50" height="4" fill="#ede9fe" />
      <rect x="33" y="62" width="22" height="10" fill="#f5f3ff" stroke="#ddd6fe" strokeWidth="0.8" />
    </svg>
  );
}

function ThumbnailGSTTheme5({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      <rect x="22" y="4" width="16" height="3" fill="#18181b" rx="1" />
      <rect x="5" y="9" width="8" height="8" fill="#e2e8f0" rx="1" />
      <rect x="32" y="9" width="23" height="10" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="0.7" />
      <rect x="5" y="21" width="50" height="5" fill="#7C78D4" />
      <rect x="5" y="31" width="50" height="6" fill="#7C78D4" />
      <rect x="5" y="37" width="50" height="17" fill="none" stroke="#e4e4e7" strokeWidth="0.8" />
      <rect x="5" y="56" width="26" height="5" fill="#7C78D4" />
      <rect x="33" y="56" width="22" height="14" fill="#f5f3ff" stroke="#ddd6fe" strokeWidth="0.8" />
    </svg>
  );
}

function ThumbnailGSTTheme6({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      {/* Top split */}
      <rect x="5" y="5" width="26" height="8" fill="#f8fafc" />
      <rect x="38" y="5" width="17" height="5" fill="#7C78D4" rx="1" />
      <line x1="5" y1="15" x2="55" y2="15" stroke="#7C78D4" strokeWidth="1" />
      {/* Middle info */}
      <rect x="5" y="18" width="50" height="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="0.7" />
      {/* Table */}
      <rect x="5" y="30" width="50" height="6" fill="#7C78D4" />
      <rect x="5" y="36" width="50" height="20" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
      <rect x="33" y="58" width="22" height="12" fill="#fafafa" stroke="#e2e8f0" strokeWidth="0.8" />
    </svg>
  );
}

function ThumbnailDoubleDivine({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      {/* Top red strip on right */}
      <rect x="25" y="0" width="35" height="5" fill="#E53935" />
      {/* Dark charcoal curved block on top left */}
      <path d="M 0 0 L 26 0 L 26 12 A 4 4 0 0 1 22 16 L 0 16 Z" fill="#1E2430" />
      <circle cx="6" cy="8" r="3" fill="#ffffff" />
      {/* Title */}
      <rect x="35" y="8" width="20" height="3" fill="#18181b" rx="1" />
      {/* Bill to */}
      <rect x="5" y="20" width="14" height="2.5" fill="#E53935" rx="0.5" />
      {/* Red Table */}
      <rect x="5" y="28" width="50" height="6" fill="#E53935" />
      <rect x="5" y="34" width="50" height="22" fill="none" stroke="#fca5a5" strokeWidth="0.8" />
      {/* Bottom Red Totals */}
      <rect x="32" y="58" width="23" height="5" fill="#E53935" />
      <rect x="32" y="63" width="23" height="8" fill="#fff1f2" stroke="#fecdd3" strokeWidth="0.8" />
      <rect x="5" y="60" width="22" height="11" fill="#fff1f2" stroke="#fecdd3" strokeWidth="0.7" rx="1" />
    </svg>
  );
}

function ThumbnailFrenchElite({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 60 76" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      {/* Purple banner badge at top left */}
      <rect x="5" y="5" width="22" height="5" fill="#7C78D4" rx="1" />
      <rect x="47" y="5" width="8" height="8" fill="#e0e7ff" rx="1" />
      <rect x="5" y="12" width="16" height="3" fill="#18181b" />
      <line x1="5" y1="21" x2="55" y2="21" stroke="#e4e4e7" strokeWidth="0.8" />
      {/* Table */}
      <rect x="5" y="28" width="50" height="6" fill="#7C78D4" />
      <rect x="5" y="34" width="50" height="22" fill="none" stroke="#e4e4e7" strokeWidth="0.8" />
      {/* Bottom summary */}
      <rect x="33" y="58" width="22" height="5" fill="#7C78D4" />
      <rect x="33" y="63" width="22" height="8" fill="#fafafa" stroke="#e4e4e7" strokeWidth="0.8" />
      <rect x="5" y="60" width="22" height="11" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="0.7" rx="1" />
    </svg>
  );
}

function ThumbnailLandscapeTheme2({ isSelected }: { isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 76 60" className="w-full h-full rounded shadow-sm border border-zinc-200 bg-white">
      {/* 3-column top header */}
      <rect x="4" y="4" width="22" height="10" fill="#f8fafc" />
      <rect x="28" y="4" width="18" height="5" fill="#1E2430" rx="1" />
      <rect x="48" y="4" width="24" height="10" fill="#f8fafc" />
      <line x1="4" y1="16" x2="72" y2="16" stroke="#1E2430" strokeWidth="1" />
      {/* Wide table */}
      <rect x="4" y="19" width="68" height="5" fill="#27272a" />
      <rect x="4" y="24" width="68" height="18" fill="none" stroke="#e4e4e7" strokeWidth="0.8" />
      {/* 3-column footer */}
      <rect x="4" y="44" width="20" height="11" fill="#fafafa" stroke="#e4e4e7" strokeWidth="0.7" />
      <rect x="26" y="44" width="22" height="11" fill="#fafafa" stroke="#e4e4e7" strokeWidth="0.7" />
      <rect x="50" y="44" width="22" height="11" fill="#f4f4f5" stroke="#e4e4e7" strokeWidth="0.7" />
    </svg>
  );
}

export const INVOICE_THEMES: InvoiceThemeDefinition[] = [
  {
    id: 'gst_theme_1',
    name: 'GST Theme 1',
    tagline: 'Classic Grid Ledger',
    description: 'Clean structured partitioned grid with dedicated cell blocks for GST compliance and audit.',
    orientation: 'portrait',
    accentColor: '#3F3F46',
    component: GSTTheme1,
    thumbnail: ThumbnailGSTTheme1,
  },
  {
    id: 'gst_theme_2',
    name: 'GST Theme 2',
    tagline: 'Royal Violet Accent',
    description: 'Full-width violet divider band for Bill To & Invoice Details with matching vertical grid lines.',
    orientation: 'portrait',
    accentColor: '#7C78D4',
    component: GSTTheme2,
    thumbnail: ThumbnailGSTTheme2,
  },
  {
    id: 'gst_theme_3',
    name: 'GST Theme 3',
    tagline: 'Contour Business Box',
    description: 'Distinct boxed business header card on left with top-right logo and clean typography.',
    orientation: 'portrait',
    accentColor: '#7B73D6',
    component: GSTTheme3,
    thumbnail: ThumbnailGSTTheme3,
  },
  {
    id: 'gst_theme_4',
    name: 'GST Theme 4',
    tagline: 'Modern Ribbon Band',
    description: 'Dual colored section banners with highlighted full-width Amount in Words ribbon bar.',
    orientation: 'portrait',
    accentColor: '#6B67C2',
    component: GSTTheme4,
    thumbnail: ThumbnailGSTTheme4,
  },
  {
    id: 'gst_theme_5',
    name: 'GST Theme 5',
    tagline: 'Signature Contrast',
    description: 'Deep violet shaded amount blocks with dedicated card partitions and highlighted total rows.',
    orientation: 'portrait',
    accentColor: '#7C78D4',
    component: GSTTheme5,
    thumbnail: ThumbnailGSTTheme5,
  },
  {
    id: 'gst_theme_6',
    name: 'GST Theme 6',
    tagline: 'High-Density Commercial',
    description: 'High-contrast modern GST invoice with full tax rate breakouts and compact ledger styling.',
    orientation: 'portrait',
    accentColor: '#5850EC',
    component: GSTTheme6,
    thumbnail: ThumbnailGSTTheme6,
  },
  {
    id: 'double_divine',
    name: 'Double Divine',
    tagline: 'Dual-Tone Charcoal & Crimson',
    description: 'Striking modern dual-tone layout with curved charcoal header block and vibrant crimson accents.',
    orientation: 'portrait',
    accentColor: '#E53935',
    component: DoubleDivine,
    thumbnail: ThumbnailDoubleDivine,
  },
  {
    id: 'french_elite',
    name: 'French Elite',
    tagline: 'Parisian Elegance',
    description: 'Refined violet title banner box, clean typography, right-aligned logo and airy elegant layout.',
    orientation: 'portrait',
    accentColor: '#7C78D4',
    component: FrenchElite,
    thumbnail: ThumbnailFrenchElite,
  },
  {
    id: 'landscape_theme_2',
    name: 'Landscape Theme 2',
    tagline: 'Expansive A4 Horizontal',
    description: 'Genuine A4 Landscape (297×210 mm) format with wide 10-column data table and 3-column footer.',
    orientation: 'landscape',
    accentColor: '#1E2430',
    component: LandscapeTheme2,
    thumbnail: ThumbnailLandscapeTheme2,
  },
];

export const DEFAULT_TEMPLATE_ID: StandardTemplateId = 'gst_theme_1';

export function normalizeTemplateId(id?: string | null): StandardTemplateId {
  if (!id) return DEFAULT_TEMPLATE_ID;
  if (id === 'classic_gst') return 'gst_theme_1';
  if (id === 'executive_minimal') return 'french_elite';
  if (id === 'compact_commercial') return 'gst_theme_6';
  const found = INVOICE_THEMES.find((t) => t.id === id);
  return found ? (id as StandardTemplateId) : DEFAULT_TEMPLATE_ID;
}

export function getThemeById(id?: string | null): InvoiceThemeDefinition {
  const norm = normalizeTemplateId(id);
  const found = INVOICE_THEMES.find((t) => t.id === norm);
  return found || INVOICE_THEMES[0];
}
