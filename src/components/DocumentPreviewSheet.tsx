import * as React from 'react';
import type { Invoice, Quotation, TemplateId } from '../shared/types';
import { InvoicePreview } from './invoice/InvoicePreview';
import { QuotationPreview } from './quotation/QuotationPreview';

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
  if (docType === 'quotation') {
    return (
      <QuotationPreview
        record={record as Quotation}
        templateOverride={templateOverride}
        a4Ratio={a4Ratio}
      />
    );
  }

  return (
    <InvoicePreview
      docType="invoice"
      record={record}
      templateOverride={templateOverride}
      a4Ratio={a4Ratio}
    />
  );
}
