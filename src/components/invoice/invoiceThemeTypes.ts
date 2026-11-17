import type * as React from 'react';
import type { Invoice, Quotation, TemplateId } from '../../shared/types';

export type StandardTemplateId =
  | 'gst_theme_1'
  | 'gst_theme_2'
  | 'gst_theme_3'
  | 'gst_theme_4'
  | 'gst_theme_5'
  | 'gst_theme_6'
  | 'double_divine'
  | 'french_elite'
  | 'landscape_theme_2';

export interface InvoiceTemplateProps {
  docType: 'invoice' | 'quotation';
  record: Invoice | Quotation;
  qrUrl?: string;
  a4Ratio?: boolean;
  className?: string;
}

export interface InvoiceThemeDefinition {
  id: StandardTemplateId;
  name: string;
  tagline: string;
  description: string;
  orientation: 'portrait' | 'landscape';
  accentColor: string;
  component: React.ComponentType<InvoiceTemplateProps>;
  thumbnail: React.ComponentType<{ className?: string; isSelected?: boolean }>;
}
