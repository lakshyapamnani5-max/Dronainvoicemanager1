import * as React from 'react';
import type { Invoice, Quotation, TemplateId } from '../shared/types';
import { InvoicePreview } from './invoice/InvoicePreview';

export interface DocumentPreviewSheetProps {
  docType: 'invoice' | 'quotation';
  record: Invoice | Quotation;
  templateOverride?: TemplateId;
  a4Ratio?: boolean;
}

export function DocumentPreviewSheet({
  docType,
  record,
  templateOverride,
  a4Ratio = false,
}: DocumentPreviewSheetProps) {
  return (
    <InvoicePreview
      docType={docType}
      record={record}
      templateOverride={templateOverride}
      a4Ratio={a4Ratio}
    />
  );
}
