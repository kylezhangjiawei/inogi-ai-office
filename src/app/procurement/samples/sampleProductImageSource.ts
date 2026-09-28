import type { PreviewableAttachment } from "../../components/AttachmentPreviewDialog";
import { isImagePreviewSource } from "../../components/MobileZoomableImage";
import { procurementAttachmentPreview } from "../../lib/attachmentAccess";
import { listMaterials, type Material, type ProcurementTask } from "../../lib/procurementApi";
import { requestResourceRefresh } from "../../lib/resourceAccess";

function materialImagePreview(material: Material): PreviewableAttachment {
  return {
    id: `proc-material:${material.id}`,
    name: material.name,
    mime: "image/*",
    url: material.imageUrl!.trim(),
    refresh: async () => {
      const materials = await requestResourceRefresh("proc-material-images", listMaterials);
      const latest = materials.find((item) => item.id === material.id);
      if (!latest?.imageUrl?.trim()) throw new Error("商品图片已删除或无权查看");
      return materialImagePreview(latest);
    },
  };
}

function taskImagePreview(image: PreviewableAttachment): PreviewableAttachment {
  if (!isImagePreviewSource(image.mime, image.name, image.url)) throw new Error("产品图片已变更，请刷新样品列表");
  return {
    ...image,
    // 旧附件可能只有 URL 或 AVIF 扩展名，仍须让原图弹窗按图片预览。
    mime: image.mime?.startsWith("image/") ? image.mime : "image/*",
    refresh: image.refresh ? async () => taskImagePreview(await image.refresh!()) : undefined,
  };
}

/** Use the linked material's product photo, then an image from this task's own attachments. */
export function sampleProductImage(task: ProcurementTask, material?: Material): PreviewableAttachment | null {
  if (material && material.id === task.materialId && material.imageUrl?.trim()) return materialImagePreview(material);
  const attachment = task.attachmentList.find((file) => file.fileUrl.trim()
    && isImagePreviewSource(file.mimeType, file.fileName, file.fileUrl));
  return attachment ? taskImagePreview(procurementAttachmentPreview(task.id, attachment)) : null;
}
