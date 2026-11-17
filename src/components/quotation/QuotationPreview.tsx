import * as React from 'react';
import type { Quotation, TemplateId } from '../../shared/types';
import { getQuotationThemeById, normalizeQuotationTemplateId } from './quotationThemeRegistry';
import { mergeDocumentWithLiveSnapshotsSync } from '../../lib/liveSnapshots';
import { cachedRead } from '../../lib/api';

export interface QuotationPreviewProps {
  record: Quotation;
  templateOverride?: TemplateId;
  a4Ratio?: boolean;
  className?: string;
}

export function QuotationPreview({
  record: initialRecord,
  templateOverride,
  a4Ratio = false,
  className = '',
}: QuotationPreviewProps) {
  const [cacheRevision, setCacheRevision] = React.useState(0);

  React.useEffect(() => {
    if (!initialRecord.userUid) return;
    return cachedRead.subscribeTenantCache(initialRecord.userUid, (changed) => {
      if (changed.has('profile') || changed.has('customers') || changed.has('quotations')) {
        setCacheRevision((r) => r + 1);
      }
    });
  }, [initialRecord.userUid]);

  const record = React.useMemo(() => {
    void cacheRevision;
    return mergeDocumentWithLiveSnapshotsSync(initialRecord);
  }, [initialRecord, cacheRevision]);

  const activeTemplateId = normalizeQuotationTemplateId(templateOverride || record.templateId);
  const themeDef = getQuotationThemeById(activeTemplateId);
  const TemplateComponent = themeDef.component;
  const isLandscape = themeDef.orientation === 'landscape';

  return (
    <div className="relative">
      {isLandscape ? (
        <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      ) : (
        <style>{`@media print { @page { size: A4 portrait; margin: 8mm; } }`}</style>
      )}
      <TemplateComponent record={record} a4Ratio={a4Ratio} className={className} />
    </div>
  );
}
