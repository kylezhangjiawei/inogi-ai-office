import { useState } from "react";
import { ImageOff, Package } from "lucide-react";
import { AttachmentPreviewDialog } from "../../components/AttachmentPreviewDialog";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import type { Material, ProcurementTask } from "../../lib/procurementApi";
import { useRenewableResource } from "../../lib/useRenewableResource";
import { sampleProductImage } from "./sampleProductImageSource";

export function SampleProductImage({ task, material, detail = false }: {
  task: ProcurementTask;
  material?: Material;
  detail?: boolean;
}) {
  const { t } = useI18n();
  const [previewOpen, setPreviewOpen] = useState(false);
  const image = sampleProductImage(task, material);
  const resource = useRenewableResource({
    resourceKey: `sample-product:${task.id}:${image?.id ?? "empty"}`,
    src: image?.thumbUrl || image?.url,
    refresh: image?.refresh ? async () => {
      const latest = await image.refresh!();
      return latest.thumbUrl || latest.url;
    } : undefined,
  });
  const frameClass = cn("proc-sample-product-image overflow-hidden rounded-xl border border-border bg-muted/40", detail ? "proc-sample-product-image-detail" : "proc-sample-product-image-thumb");
  const content = image && !resource.failed ? (
    <img
      src={resource.src || undefined}
      alt={detail ? t("{name}产品图", { name: task.materialName }) : ""}
      loading={detail ? "eager" : "lazy"}
      decoding="async"
      onLoad={resource.onLoad}
      onError={resource.onError}
      className={cn("size-full object-contain p-2", resource.refreshing && "invisible")}
    />
  ) : (
    <span className="flex size-full flex-col items-center justify-center gap-2 p-2 text-muted-foreground">
      {resource.failed ? <ImageOff className={detail ? "size-7" : "size-5"} aria-hidden="true" /> : <Package className={detail ? "size-7" : "size-5"} aria-hidden="true" />}
      <span className={detail ? "text-xs font-normal" : "sr-only"}>{t(image ? "图片暂不可用" : "暂无产品图")}</span>
    </span>
  );

  if (!detail || !image) return <span className={frameClass}>{content}</span>;

  return <>
    <Button type="button" variant="unstyled" className={cn(frameClass, "cursor-zoom-in hover:border-primary/30")}
      aria-label={t("查看产品图：{name}", { name: task.materialName })} onClick={() => setPreviewOpen(true)}>
      {content}
    </Button>
    {previewOpen && <AttachmentPreviewDialog attachment={image} onClose={() => setPreviewOpen(false)} />}
  </>;
}
