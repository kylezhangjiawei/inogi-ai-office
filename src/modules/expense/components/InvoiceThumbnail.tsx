import { FileImage, FileText } from "lucide-react";

import { cn } from "../../../app/components/ui/utils";
import type { InvoiceRecord } from "../types";

export function InvoiceThumbnail({
  invoice,
  className,
}: {
  invoice: Pick<InvoiceRecord, "thumbnailType" | "invoiceNo" | "vendor">;
  className?: string;
}) {
  const Icon = invoice.thumbnailType === "PDF" ? FileText : FileImage;

  return (
    <button
      type="button"
      title={`${invoice.vendor} / ${invoice.invoiceNo}`}
      className={cn(
        "group relative flex h-[50px] w-[50px] cursor-pointer items-center justify-center rounded-[var(--m3-shape-medium)] border border-slate-200 bg-white text-blue-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="absolute bottom-1 rounded bg-slate-950/80 px-1 text-[9px] font-bold text-white">{invoice.thumbnailType}</span>
      <span className="pointer-events-none absolute left-12 top-0 z-20 hidden w-44 rounded-[var(--m3-shape-medium)] border border-slate-200 bg-white p-3 text-left text-xs text-slate-600 shadow-lg group-hover:block">
        {invoice.vendor}
        <br />
        发票号：{invoice.invoiceNo}
      </span>
    </button>
  );
}
