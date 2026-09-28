import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const zoomableImageSource = await source("src/app/components/MobileZoomableImage.tsx").catch(() => "");
const progressEvidenceSource = await source("src/app/RDProgressEvidence.tsx");
const attachmentPreviewSource = await source("src/app/components/AttachmentPreviewDialog.tsx");
const issueDetailSource = await source("src/app/issue-ai/DetailView.tsx");
const procurementCardSource = await source("src/app/procurement/components/ProcurementTaskCard.tsx");
const procurementDetailSource = await source("src/app/procurement/components/TaskDetailDrawer.tsx");
const procurementServiceSource = await source("apps/api/src/modules/procurement/procurement.service.ts");

const embeddedPreviewFiles = [
  "src/app/MobileRDCockpit.tsx",
  "src/app/rd/TaskAttachmentGallery.tsx",
  "src/app/components/RagCitations.tsx",
  "src/app/procurement/components/common.tsx",
  "src/app/imageStudioShared.tsx",
  "src/app/RDKnowledgeBasePage.tsx",
  "src/app/components/ExternalDocumentEvidenceViewer.tsx",
];

const linkedPreviewFiles = [
  "src/app/components/MateChatBubble.tsx",
  "src/app/ManualPage.tsx",
  "src/app/DownloadTutorialPage.tsx",
  // 采购卡片与详情抽屉改用共享的 AttachmentPreviewDialog（见下方 "shared full attachment
  // preview"），不再走 MobileImagePreviewLink，所以不在这份清单里
];

test("shared mobile image zoom supports pinch, pan, double-tap and visible controls", () => {
  assert.match(zoomableImageSource, /export function MobileZoomableImage/);
  assert.match(zoomableImageSource, /isMobileViewport\(\)/);
  assert.match(zoomableImageSource, /document\.documentElement\.classList\.contains\("mobile-route"\)/);
  assert.match(zoomableImageSource, /pinchTaskImageTransform/);
  assert.match(zoomableImageSource, /touch-none/);
  assert.match(zoomableImageSource, /onDoubleClick=/);
  assert.match(zoomableImageSource, /aria-label="缩小图片"/);
  assert.match(zoomableImageSource, /aria-label="放大图片"/);
  assert.match(zoomableImageSource, /aria-live="polite"/);
  assert.match(zoomableImageSource, /useSyncExternalStore/);
  assert.match(zoomableImageSource, /mobileZoomSubscribers/);
  assert.match(zoomableImageSource, /export function isImagePreviewSource/);
  assert.match(zoomableImageSource, /tabIndex=/);
  assert.match(zoomableImageSource, /event\.key === "Enter"/);
  assert.match(zoomableImageSource, /<Dialog open onOpenChange=/);
  assert.match(zoomableImageSource, /<DialogClose asChild>/);
  assert.match(zoomableImageSource, /autoFocus/);
  assert.doesNotMatch(zoomableImageSource, /useModalFocus/);
  assert.match(zoomableImageSource, /const MOBILE_IMAGE_PREVIEW_HISTORY_KEY = "__inogiImagePreview"/);
  assert.match(zoomableImageSource, /\[MOBILE_IMAGE_PREVIEW_HISTORY_KEY\]: owner/);
  assert.match(zoomableImageSource, /historyOwnerRef\.current === window\.history\.state\?\.\[MOBILE_IMAGE_PREVIEW_HISTORY_KEY\]/);
  assert.match(zoomableImageSource, /window\.history\.state\?\.\[MOBILE_IMAGE_PREVIEW_HISTORY_KEY\] !== owner\) onCloseRef\.current\(\)/);
  assert.match(zoomableImageSource, /window\.addEventListener\("popstate", closeOnBack\)/);
});

test("task detail keeps its scale-aware gallery gestures enabled by real phone width", () => {
  assert.match(progressEvidenceSource, /const zoomEnabled = isMobileRoute\(\) \|\| isMobileViewport\(\)/);
  assert.match(progressEvidenceSource, /pinchTaskImageTransform/);
  assert.match(progressEvidenceSource, /imageTransformRef\.current\.scale === TASK_IMAGE_MIN_SCALE/);
});

for (const file of embeddedPreviewFiles) {
  test(`${file} embeds the shared mobile zoom surface`, async () => {
    const fileSource = await source(file);
    assert.match(fileSource, /MobileZoomableImage/);
  });
}

for (const file of linkedPreviewFiles) {
  test(`${file} opens linked images in the shared mobile zoom preview`, async () => {
    const fileSource = await source(file);
    assert.match(fileSource, /MobileImagePreviewLink/);
  });
}

test("issue attachments use the shared dialog with mobile image zoom and renewable access", () => {
  assert.match(issueDetailSource, /<AttachmentPreviewDialog\b/);
  assert.match(issueDetailSource, /attachment=\{attachmentPreview\(att, refresh\)\}/);
  assert.match(issueDetailSource, /useRenewableResource/);
  assert.match(attachmentPreviewSource, /<MobileZoomableImage\b/);
  assert.match(attachmentPreviewSource, /onError=\{resource\.onError\}/);
});

test("procurement cards and details use the shared full attachment preview", () => {
  // 存量附件只存了会过期的短效地址，读取时必须按 object key 重建
  assert.match(procurementServiceSource, /searchParams\.get\(['"]key['"]\)/);
  // fileUrl 是客户端可传字段，反解出的 key 必须过业务前缀白名单，否则等于把任意
  // OSS 对象换成一条带签名的预览能力地址
  assert.match(procurementServiceSource, /isKeyUnderBusinessType/);
  assert.match(procurementServiceSource, /resolveAttachmentFileKey\(a\.fileKey, a\.fileUrl\)/);
  assert.match(procurementServiceSource, /resolveAttachmentFileKey\(a\.fileKey \?\? null, a\.fileUrl\)/);
  // 用内联预览地址而不是 OSS 直链：bucket 设了 x-oss-force-download，直链会变成强制下载
  assert.match(procurementServiceSource, /buildInlinePreviewUrl\(objectKey\)/);
  assert.match(attachmentPreviewSource, /export type PreviewableAttachment/);
  assert.match(attachmentPreviewSource, /MobileZoomableImage/);
  assert.match(attachmentPreviewSource, /parseXlsxForPreview/);
  assert.match(attachmentPreviewSource, /application\/pdf/);
  assert.match(attachmentPreviewSource, /startsWith\("video\/"\)/);
  assert.match(procurementCardSource, /AttachmentPreviewDialog/);
  assert.match(procurementCardSource, /setPreviewAttachment/);
  assert.match(procurementDetailSource, /AttachmentPreviewDialog/);
  assert.match(procurementDetailSource, /setPreviewAttachment/);
  assert.doesNotMatch(procurementDetailSource, /href=\{attachment\.fileUrl\} target="_blank"/);
});
