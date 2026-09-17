import { UploadCloud } from "lucide-react";

import { Progress } from "../../../app/components/ui/progress";
import { cn } from "../../../app/components/ui/utils";
import { useI18n } from "../../../app/lib/i18n";
import { Input } from "../../../app/components/ui/input";

export function UploadDropzone({
  processing = false,
  className,
  title,
  description,
  accept = ".jpg,.jpeg,.png,.pdf",
  processingLabel,
  onFilesSelected,
}: {
  processing?: boolean;
  className?: string;
  title?: string;
  description?: string;
  accept?: string;
  processingLabel?: string;
  onFilesSelected?: (files: File[]) => void;
}) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("拖拽或点击上传票据");
  const resolvedDescription = description ?? t("支持 JPG / PNG / PDF，多文件上传后自动 OCR");
  const resolvedProcessingLabel = processingLabel ?? t("AI 正在识别字段与分类...");

  return (
    <label
      className={cn(
        "flex min-h-[176px] cursor-pointer flex-col items-center justify-center rounded-[var(--m3-shape-large)] border border-dashed border-blue-200 bg-blue-50/60 p-6 text-center transition-colors hover:bg-accent",
        className,
      )}
    >
      <Input
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (files.length > 0) onFilesSelected?.(files);
          event.currentTarget.value = "";
        }}
      />
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm">
        <UploadCloud className="h-5 w-5" />
      </div>
      <div className="text-sm font-bold text-slate-900">{resolvedTitle}</div>
      <div className="mt-1 text-xs text-slate-500">{resolvedDescription}</div>
      {processing ? (
        <div className="mt-4 w-full max-w-[320px]">
          <Progress value={68} />
          <div className="mt-2 text-xs font-medium text-blue-700">{resolvedProcessingLabel}</div>
        </div>
      ) : null}
    </label>
  );
}
