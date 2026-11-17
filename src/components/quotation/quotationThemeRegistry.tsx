import * as React from 'react';
import { ExecutiveGold } from './templates/ExecutiveGold';
import { ModernMinimal } from './templates/ModernMinimal';
import { CorporateBlue } from './templates/CorporateBlue';
import { FrenchClassic } from './templates/FrenchClassic';
import { DronaSignature } from './templates/DronaSignature';
import { LandscapePro } from './templates/LandscapePro';
import type { QuotationTemplateId, QuotationThemeDefinition } from './quotationThemeTypes';

export const DEFAULT_QUOTATION_TEMPLATE_ID: QuotationTemplateId = 'executive_gold';

function ExecGoldThumb({ className = '' }: { className?: string; isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 120 160" className={`w-full h-full ${className}`} fill="none">
      <rect x="2" y="2" width="116" height="156" rx="4" fill="#FAF7F0" stroke="#DFD2B5" />
      <rect x="7" y="7" width="106" height="146" rx="2" fill="#FFFFFF" stroke="#E7DEC8" />
      <rect x="14" y="14" width="14" height="14" rx="2" fill="#F4EBD6" stroke="#C8A45D" />
      <rect x="32" y="15" width="34" height="4" rx="1" fill="#221E18" />
      <rect x="32" y="22" width="24" height="2.5" rx="1" fill="#9A7832" />
      <rect x="74" y="15" width="32" height="5" rx="1" fill="#C8A45D" />
      <rect x="82" y="23" width="24" height="2.5" rx="1" fill="#8A6928" />
      <line x1="14" y1="33" x2="106" y2="33" stroke="#C8A45D" strokeWidth="1" />
      <rect x="14" y="38" width="48" height="20" rx="1.5" fill="#FCFBF7" stroke="#E7DEC8" />
      <rect x="66" y="38" width="40" height="20" rx="1.5" fill="#FCFBF7" stroke="#E7DEC8" />
      <rect x="14" y="64" width="92" height="9" fill="#F6EFE0" />
      <line x1="14" y1="73" x2="106" y2="73" stroke="#C8A45D" strokeWidth="0.7" />
      <rect x="14" y="78" width="92" height="3" rx="0.8" fill="#EFE7D6" />
      <rect x="14" y="86" width="92" height="3" rx="0.8" fill="#EFE7D6" />
      <rect x="14" y="94" width="92" height="3" rx="0.8" fill="#EFE7D6" />
      <rect x="64" y="106" width="42" height="18" rx="1.5" fill="#F4EBD6" stroke="#C8A45D" />
      <line x1="14" y1="143" x2="48" y2="143" stroke="#C8A45D" strokeWidth="0.7" />
      <line x1="72" y1="143" x2="106" y2="143" stroke="#C8A45D" strokeWidth="0.7" />
    </svg>
  );
}

function ModernMinimalThumb({ className = '' }: { className?: string; isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 120 160" className={`w-full h-full ${className}`} fill="none">
      <rect x="2" y="2" width="116" height="156" rx="4" fill="#FFFFFF" stroke="#E4E4E7" />
      <rect x="2" y="2" width="116" height="4" rx="2" fill="#F57C00" />
      <rect x="12" y="14" width="48" height="7" rx="1" fill="#09090B" />
      <line x1="12" y1="24" x2="36" y2="24" stroke="#F57C00" strokeWidth="1.5" />
      <rect x="82" y="14" width="26" height="14" rx="1.5" fill="#F4F4F5" />
      <line x1="12" y1="36" x2="108" y2="36" stroke="#E4E4E7" strokeWidth="0.8" />
      <rect x="12" y="42" width="42" height="4" rx="1" fill="#27272A" />
      <rect x="12" y="49" width="34" height="3" rx="1" fill="#A1A1AA" />
      <rect x="68" y="42" width="40" height="3" rx="1" fill="#A1A1AA" />
      <line x1="12" y1="60" x2="108" y2="60" stroke="#E4E4E7" strokeWidth="0.8" />
      <line x1="12" y1="70" x2="108" y2="70" stroke="#18181B" strokeWidth="1.2" />
      <line x1="12" y1="82" x2="108" y2="82" stroke="#F4F4F5" strokeWidth="1" />
      <line x1="12" y1="94" x2="108" y2="94" stroke="#F4F4F5" strokeWidth="1" />
      <line x1="12" y1="106" x2="108" y2="106" stroke="#F4F4F5" strokeWidth="1" />
      <line x1="66" y1="124" x2="108" y2="124" stroke="#F57C00" strokeWidth="1.5" />
      <rect x="74" y="128" width="34" height="5" rx="1" fill="#09090B" />
      <line x1="12" y1="145" x2="108" y2="145" stroke="#E4E4E7" strokeWidth="0.8" />
    </svg>
  );
}

function CorporateBlueThumb({ className = '' }: { className?: string; isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 120 160" className={`w-full h-full ${className}`} fill="none">
      <rect x="2" y="2" width="116" height="156" rx="4" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="2" y="2" width="116" height="28" rx="3" fill="#0F2744" />
      <rect x="10" y="9" width="14" height="14" rx="2" fill="#FFFFFF" />
      <rect x="28" y="10" width="38" height="4" rx="1" fill="#FFFFFF" />
      <rect x="28" y="17" width="28" height="2.5" rx="1" fill="#94A3B8" />
      <rect x="76" y="11" width="32" height="6" rx="1" fill="#93C5FD" />
      <rect x="10" y="36" width="48" height="22" rx="1.5" fill="#F8FAFC" stroke="#CBD5E1" />
      <rect x="62" y="36" width="48" height="22" rx="1.5" fill="#EFF4FA" stroke="#CBD5E1" />
      <rect x="10" y="64" width="100" height="8" fill="#1E3A5F" />
      <rect x="10" y="74" width="100" height="7" fill="#FFFFFF" />
      <rect x="10" y="81" width="100" height="7" fill="#F8FAFC" />
      <rect x="10" y="88" width="100" height="7" fill="#FFFFFF" />
      <rect x="64" y="104" width="46" height="20" rx="1.5" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="64" y="116" width="46" height="8" fill="#0F2744" />
      <rect x="10" y="134" width="46" height="16" rx="1.5" stroke="#CBD5E1" />
      <rect x="64" y="134" width="46" height="16" rx="1.5" stroke="#CBD5E1" />
    </svg>
  );
}

function FrenchClassicThumb({ className = '' }: { className?: string; isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 120 160" className={`w-full h-full ${className}`} fill="none">
      <rect x="2" y="2" width="116" height="156" rx="4" fill="#FFFFFF" stroke="#D4D4D4" />
      <rect x="12" y="14" width="42" height="7" rx="1" fill="#171717" />
      <rect x="12" y="24" width="28" height="2.5" rx="1" fill="#737373" />
      <rect x="78" y="14" width="30" height="4" rx="1" fill="#262626" />
      <rect x="84" y="21" width="24" height="2.5" rx="1" fill="#A3A3A3" />
      <line x1="12" y1="34" x2="108" y2="34" stroke="#171717" strokeWidth="1" />
      <rect x="12" y="40" width="44" height="16" fill="#FFFFFF" />
      <line x1="62" y1="40" x2="62" y2="56" stroke="#E5E5E5" strokeWidth="0.8" />
      <rect x="68" y="40" width="40" height="16" fill="#FFFFFF" />
      <line x1="12" y1="62" x2="108" y2="62" stroke="#171717" strokeWidth="0.7" />
      <line x1="12" y1="70" x2="108" y2="70" stroke="#171717" strokeWidth="0.7" />
      <line x1="12" y1="81" x2="108" y2="81" stroke="#E5E5E5" strokeWidth="0.6" />
      <line x1="12" y1="92" x2="108" y2="92" stroke="#E5E5E5" strokeWidth="0.6" />
      <line x1="12" y1="103" x2="108" y2="103" stroke="#E5E5E5" strokeWidth="0.6" />
      <line x1="66" y1="120" x2="108" y2="120" stroke="#171717" strokeWidth="0.8" />
      <line x1="66" y1="129" x2="108" y2="129" stroke="#171717" strokeWidth="0.8" />
      <line x1="12" y1="146" x2="50" y2="146" stroke="#D4D4D4" strokeWidth="0.8" />
      <line x1="70" y1="146" x2="108" y2="146" stroke="#D4D4D4" strokeWidth="0.8" />
    </svg>
  );
}

function DronaSignatureThumb({ className = '' }: { className?: string; isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 120 160" className={`w-full h-full ${className}`} fill="none">
      <rect x="2" y="2" width="116" height="156" rx="4" fill="#FFFFFF" stroke="#D4D4D8" />
      <rect x="2" y="2" width="116" height="27" rx="3" fill="#18181B" />
      <rect x="2" y="27" width="116" height="3" fill="#F57C00" />
      <rect x="10" y="9" width="12" height="12" rx="2" fill="#FFFFFF" />
      <rect x="26" y="10" width="34" height="4" rx="1" fill="#FFFFFF" />
      <rect x="74" y="9" width="34" height="6" rx="1" fill="#F57C00" />
      <rect x="80" y="17" width="28" height="5" rx="1" fill="#27272A" />
      <rect x="10" y="36" width="52" height="20" rx="2" fill="#FAFAFA" stroke="#E4E4E7" />
      <rect x="10" y="36" width="3" height="20" fill="#F57C00" />
      <rect x="66" y="36" width="44" height="20" rx="2" fill="#FFFFFF" stroke="#E4E4E7" />
      <rect x="10" y="62" width="100" height="8" rx="1.5" fill="#18181B" />
      <rect x="10" y="74" width="100" height="3" rx="0.8" fill="#E4E4E7" />
      <rect x="10" y="83" width="100" height="3" rx="0.8" fill="#E4E4E7" />
      <rect x="10" y="92" width="100" height="3" rx="0.8" fill="#E4E4E7" />
      <rect x="64" y="106" width="46" height="22" rx="2" fill="#FFFFFF" stroke="#D4D4D8" />
      <rect x="64" y="119" width="46" height="9" fill="#18181B" />
      <rect x="90" y="122" width="16" height="3" rx="0.8" fill="#F57C00" />
      <line x1="10" y1="145" x2="48" y2="145" stroke="#A1A1AA" strokeWidth="0.8" />
      <line x1="72" y1="145" x2="110" y2="145" stroke="#A1A1AA" strokeWidth="0.8" />
    </svg>
  );
}

function LandscapeProThumb({ className = '' }: { className?: string; isSelected?: boolean }) {
  return (
    <svg viewBox="0 0 160 116" className={`w-full h-full ${className}`} fill="none">
      <rect x="2" y="2" width="156" height="112" rx="4" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="10" y="10" width="46" height="22" rx="1.5" fill="#FFFFFF" />
      <rect x="10" y="10" width="12" height="12" rx="1.5" fill="#E2E8F0" />
      <rect x="25" y="11" width="28" height="4" rx="1" fill="#0F172A" />
      <rect x="60" y="10" width="52" height="22" rx="1.5" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="120" y="10" width="30" height="7" rx="1" fill="#0F172A" />
      <rect x="122" y="20" width="28" height="3" rx="1" fill="#475569" />
      <line x1="10" y1="36" x2="150" y2="36" stroke="#1E293B" strokeWidth="1.2" />
      <rect x="10" y="42" width="140" height="8" rx="1" fill="#1E293B" />
      <rect x="10" y="53" width="140" height="6" fill="#F8FAFC" />
      <rect x="10" y="61" width="140" height="6" fill="#FFFFFF" />
      <rect x="10" y="69" width="140" height="6" fill="#F8FAFC" />
      <line x1="10" y1="80" x2="150" y2="80" stroke="#CBD5E1" strokeWidth="0.8" />
      <rect x="10" y="84" width="58" height="22" rx="1.5" fill="#F8FAFC" stroke="#E2E8F0" />
      <rect x="72" y="84" width="34" height="22" rx="1.5" fill="#FFFFFF" stroke="#E2E8F0" />
      <rect x="110" y="84" width="40" height="22" rx="1.5" fill="#FFFFFF" stroke="#CBD5E1" />
      <rect x="110" y="98" width="40" height="8" fill="#0F172A" />
    </svg>
  );
}

export const QUOTATION_THEMES: QuotationThemeDefinition[] = [
  {
    id: 'executive_gold',
    name: 'Executive Gold',
    tagline: 'Cream & Champagne Editorial',
    description:
      'Cream and white canvas with champagne gold dividers, serif heading, and formal client acceptance footer.',
    orientation: 'portrait',
    accentColor: '#C8A45D',
    component: ExecutiveGold,
    thumbnail: ExecGoldThumb,
  },
  {
    id: 'modern_minimal',
    name: 'Modern Minimal',
    tagline: 'Clean & Drona Orange',
    description:
      'Pure white layout with bold black typography, orange accent lines, borderless item rows, and open whitespace.',
    orientation: 'portrait',
    accentColor: '#F57C00',
    component: ModernMinimal,
    thumbnail: ModernMinimalThumb,
  },
  {
    id: 'corporate_blue',
    name: 'Corporate Blue',
    tagline: 'Navy Enterprise Proposal',
    description:
      'Deep navy header band with structured 3-part schedule metadata, striped table rows, and approval blocks.',
    orientation: 'portrait',
    accentColor: '#0F2744',
    component: CorporateBlue,
    thumbnail: CorporateBlueThumb,
  },
  {
    id: 'french_classic',
    name: 'French Classic',
    tagline: 'Asymmetric Gallery Studio',
    description:
      'Editorial monochrome black-and-grey hierarchy with refined serif title, hairline rules, and minimalist spacing.',
    orientation: 'portrait',
    accentColor: '#171717',
    component: FrenchClassic,
    thumbnail: FrenchClassicThumb,
  },
  {
    id: 'drona_signature',
    name: 'Drona Signature',
    tagline: 'Charcoal & Orange Branded',
    description:
      'Signature Drona dark charcoal and vibrant orange header with contrasted pricing summary and modern table.',
    orientation: 'portrait',
    accentColor: '#F57C00',
    component: DronaSignature,
    thumbnail: DronaSignatureThumb,
  },
  {
    id: 'landscape_pro',
    name: 'Landscape Pro',
    tagline: 'Wide A4 Landscape Estimate',
    description:
      'Genuine A4 landscape layout with compact 3-column header and wide technical specification item columns.',
    orientation: 'landscape',
    accentColor: '#1E293B',
    component: LandscapePro,
    thumbnail: LandscapeProThumb,
  },
];

export const QUOTATION_TEMPLATE_IDS: readonly QuotationTemplateId[] = QUOTATION_THEMES.map(
  (t) => t.id
);

export function isQuotationTemplateId(id?: string | null): id is QuotationTemplateId {
  if (!id) return false;
  return QUOTATION_THEMES.some((t) => t.id === id);
}

export function normalizeQuotationTemplateId(id?: string | null): QuotationTemplateId {
  if (isQuotationTemplateId(id)) return id;
  return DEFAULT_QUOTATION_TEMPLATE_ID;
}

export function getQuotationThemeById(id?: string | null): QuotationThemeDefinition {
  const norm = normalizeQuotationTemplateId(id);
  return QUOTATION_THEMES.find((t) => t.id === norm) || QUOTATION_THEMES[0];
}
