import * as React from 'react';
import QRCode from 'qrcode';
import type { Invoice, Quotation, TemplateId } from '../../shared/types';
import { buildUpiPaymentUri } from '../../shared/gstCalculator';
import { getCachedSession, subscribeTenantCache } from '../../lib/localCache';
import { mergeDocumentWithLiveSnapshotsSync } from '../../lib/liveSnapshots';
import { getThemeById, normalizeTemplateId } from './invoiceThemeRegistry';

export interface InvoicePreviewProps {
  docType: 'invoice' | 'quotation';
  record: Invoice | Quotation;
  templateOverride?: TemplateId;
  a4Ratio?: boolean;
  className?: string;
}

export function InvoicePreview({
  docType,
  record: rawRecord,
  templateOverride,
  a4Ratio = false,
  className = '',
}: InvoicePreviewProps) {
  const [cacheTick, setCacheTick] = React.useState(0);
  const tenantUid = rawRecord.userUid || getCachedSession()?.effectiveUser.uid || '';

  React.useEffect(() => {
    if (!tenantUid) return;
    return subscribeTenantCache(tenantUid, (changed) => {
      if (changed.has('profile') || changed.has('customers')) {
        setCacheTick((t) => t + 1);
      }
    });
  }, [tenantUid]);

  const record = React.useMemo(
    () => mergeDocumentWithLiveSnapshotsSync(rawRecord),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawRecord, cacheTick]
  );

  const [qrUrl, setQrUrl] = React.useState<string>('');
  const activeTemplateId = normalizeTemplateId(templateOverride || record.templateId);
  const theme = getThemeById(activeTemplateId);

  const biz = record.businessSnapshot;
  const isInvoice = docType === 'invoice';
  const inv = isInvoice ? (record as Invoice) : null;
  const quo = !isInvoice ? (record as Quotation) : null;
  const docNumber = inv ? inv.invoiceNumber : quo ? quo.quotationNumber : 'INV-0001';
  const qrAmount = inv
    ? inv.balanceDue > 0
      ? inv.balanceDue
      : inv.grandTotal
    : record.grandTotal;
  const cleanUpiId = (biz.upiId || '').trim();

  React.useEffect(() => {
    let active = true;
    if (cleanUpiId) {
      const upiUri = buildUpiPaymentUri({
        upiId: cleanUpiId,
        payeeName: biz.businessName,
        amount: qrAmount,
        docNumber,
      });
      QRCode.toDataURL(upiUri, { margin: 1, width: 140 })
        .then((url) => {
          if (active) setQrUrl(url);
        })
        .catch(() => {
          if (active) setQrUrl('');
        });
      return () => {
        active = false;
      };
    }

    if (biz.upiQrDataUrl) {
      setQrUrl(biz.upiQrDataUrl);
      return;
    }

    setQrUrl('');
    return () => {
      active = false;
    };
  }, [cleanUpiId, biz.upiQrDataUrl, biz.businessName, qrAmount, docNumber]);

  const Component = theme.component;

  return (
    <div
      className={`invoice-preview-root relative ${
        theme.orientation === 'landscape' ? 'landscape-print-target' : 'portrait-print-target'
      } ${className}`}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print {
            @page {
              size: A4 ${theme.orientation === 'landscape' ? 'landscape' : 'portrait'} !important;
              margin: 6mm !important;
            }
          }`,
        }}
      />
      <Component
        docType={docType}
        record={record}
        qrUrl={qrUrl}
        a4Ratio={a4Ratio}
      />
    </div>
  );
}
