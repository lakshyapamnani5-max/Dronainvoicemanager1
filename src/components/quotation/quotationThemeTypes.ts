import type * as React from 'react';
import type { Quotation, QuotationTemplateId } from '../../shared/types';

export type { QuotationTemplateId };

export interface QuotationTemplateProps {
  record: Quotation;
  a4Ratio?: boolean;
  className?: string;
}

export interface QuotationThemeDefinition {
  id: QuotationTemplateId;
  name: string;
  tagline: string;
  description: string;
  orientation: 'portrait' | 'landscape';
  accentColor: string;
  component: React.ComponentType<QuotationTemplateProps>;
  thumbnail: React.ComponentType<{ className?: string; isSelected?: boolean }>;
}
