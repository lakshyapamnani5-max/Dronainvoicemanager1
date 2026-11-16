import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  FileCheck2,
  Send,
  XCircle,
} from 'lucide-react';
import type {
  AccountStatus,
  InvoiceStatus,
  PurchaseStatus,
  QuotationStatus,
} from '../shared/types';

export function InvoiceStatusLabel({ status }: { status: InvoiceStatus | string }) {
  switch (status) {
    case 'paid':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Paid
        </span>
      );
    case 'partially_paid':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          Partially Paid
        </span>
      );
    case 'overdue':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Overdue
        </span>
      );
    case 'unpaid':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
          <Clock className="h-3.5 w-3.5 shrink-0 text-[#F57C00]" />
          Unpaid
        </span>
      );
    case 'draft':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
          <FileEdit className="h-3.5 w-3.5 shrink-0" />
          Draft
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          Cancelled
        </span>
      );
    default:
      return <span className="text-xs text-zinc-500">{status}</span>;
  }
}

export function PurchaseStatusLabel({ status }: { status: PurchaseStatus | string }) {
  return <InvoiceStatusLabel status={status} />;
}

export function QuotationStatusLabel({ status }: { status: QuotationStatus | string }) {
  switch (status) {
    case 'accepted':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Accepted
        </span>
      );
    case 'converted':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E65100] dark:text-[#FFA726] whitespace-nowrap">
          <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
          Converted
        </span>
      );
    case 'sent':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-400 whitespace-nowrap">
          <Send className="h-3.5 w-3.5 shrink-0" />
          Sent
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          Rejected
        </span>
      );
    case 'expired':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Expired
        </span>
      );
    case 'draft':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
          <FileEdit className="h-3.5 w-3.5 shrink-0" />
          Draft
        </span>
      );
  }
}

export function AccountStatusLabel({ status }: { status: AccountStatus }) {
  return status === 'active' ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
      <Ban className="h-3.5 w-3.5 shrink-0" />
      Inactive
    </span>
  );
}
