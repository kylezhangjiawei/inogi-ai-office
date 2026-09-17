import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const exportButton = source("src/app/components/RdTaskExportButton.tsx");
const categoryTable = source("src/app/components/RdCategoryTaskTable.tsx");
const auditTimeline = source("src/app/RDAuditTimeline.tsx");
const progressEvidence = source("src/app/RDProgressEvidence.tsx");
const performanceScore = source("src/app/RDPerformanceScoreDialog.tsx");
const performanceReport = source("src/app/RDPerformanceReportDialog.tsx");
const attachmentPreview = source("src/app/components/AttachmentPreviewDialog.tsx");

const surfaces = {
  "研发任务导出": exportButton,
  "类目任务表": categoryTable,
  "审计时间线": auditTimeline,
  "进度与附件": progressEvidence,
  "绩效评分": performanceScore,
  "绩效报表": performanceReport,
  "通用附件预览": attachmentPreview,
};

test("导出、绩效评分和绩效报表使用项目 Dialog 原语与 Horizon 弹层", () => {
  for (const [name, page] of Object.entries({ exportButton, performanceScore, performanceReport })) {
    assert.match(page, /components?\/ui\/dialog|\.\/ui\/dialog/, `${name}应导入项目 Dialog 原语`);
    assert.match(page, /<Dialog open=\{open\}/, `${name}应使用受控 Dialog`);
    assert.match(page, /<DialogContent[\s\S]{0,240}className="horizon-portal/, `${name}应接入 Horizon portal`);
    assert.match(page, /<DialogTitle/);
    assert.match(page, /<DialogDescription/);
    assert.doesNotMatch(page, /createPortal/);
    assert.doesNotMatch(page, /className="fixed inset-0/);
  }
  assert.match(exportButton, /<DialogTrigger asChild>/, "导出入口应由 DialogTrigger 自动管理焦点归还");
});

test("专用图片与附件预览保留手势能力并使用可恢复焦点的标准弹层", () => {
  assert.match(progressEvidence, /components\/ui\/dialog/);
  assert.equal((progressEvidence.match(/<Dialog open onOpenChange=/g) ?? []).length, 2);
  assert.match(progressEvidence, /<DialogTitle className="sr-only">/);
  assert.match(progressEvidence, /h-dvh/);
  assert.doesNotMatch(progressEvidence, /createPortal/);
  assert.doesNotMatch(progressEvidence, /backdrop-blur/);

  assert.match(attachmentPreview, /\.\/ui\/dialog/);
  assert.match(attachmentPreview, /<Dialog open onOpenChange=/);
  assert.match(attachmentPreview, /className="horizon-portal flex h-\[90dvh\]/);
  assert.match(attachmentPreview, /onCloseAutoFocus=/);
  assert.match(attachmentPreview, /openerRef\.current\.focus\(\)/);
  assert.match(attachmentPreview, /<DialogClose asChild>/);
  assert.doesNotMatch(attachmentPreview, /createPortal|window\.addEventListener\("keydown"/);
  assert.doesNotMatch(attachmentPreview, /backdrop-blur/);
  assert.match(progressEvidence, /pinchTaskImageTransform/);
  assert.match(progressEvidence, /zoomTaskImageTransform/);
  assert.match(progressEvidence, /onPointerDown=/);
  assert.match(progressEvidence, /onDoubleClick=/);
  assert.match(progressEvidence, /aria-expanded=\{!collapsed\}/);
  assert.match(progressEvidence, /aria-controls=\{galleryPanelId\}/);
  assert.match(progressEvidence, /id=\{galleryPanelId\}/);
  assert.doesNotMatch(progressEvidence, /event\.key === "Escape"/, "Escape 关闭应交由 Radix Dialog 统一处理");
  assert.match(attachmentPreview, /<MobileZoomableImage/);
});

test("研发共享附属面统一使用 Horizon 主题 并清除旧视觉噪声", () => {
  const forbiddenPatterns = [
    ["旧紫色", /\b(?:indigo|violet|purple|fuchsia|pink)-/i],
    ["暗色变体", /\bdark:/],
    ["渐变", /(?:bg-|linear-|radial-)?gradient/i],
    ["装饰字距", /\btracking-/],
    ["全属性过渡", /\btransition-all\b/],
    ["悬停位移", /hover:-translate|group-hover:scale/],
  ];

  for (const [name, page] of Object.entries(surfaces)) {
    for (const [label, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(page, pattern, `${name}不应包含${label}`);
    }
  }

  for (const page of Object.values(surfaces)) assert.match(page, /primary|accent/);
});

test("导出、审计、附件与绩效业务契约保持完整", () => {
  assert.match(exportButton, /exportRdTasksXlsx\(allTasks, \{ start, end \}, peopleDirectory\)/);
  assert.match(categoryTable, /workspaceTaskPreview\(task\)/);
  assert.match(categoryTable, /isTaskOverdue\(task\)/);
  assert.match(auditTimeline, /await onAddNote\(log\.id, text\)/);
  assert.match(auditTimeline, /auditActorMatchesIdentity/);
  assert.match(progressEvidence, /getAttachmentDownloadUrl/);
  assert.match(progressEvidence, /getAttachmentPreviewUrl/);
  assert.match(progressEvidence, /parseXlsxForPreview/);
  assert.match(performanceScore, /submitRdSelfAssessment/);
  assert.match(performanceScore, /submitRdSupervisorAssessment/);
  assert.match(performanceReport, /createRdPerformanceReport/);
  assert.match(performanceReport, /fetchRdPerformanceReports/);
  assert.match(performanceReport, /downloadPerformanceXlsx\(report\)/);
  assert.match(attachmentPreview, /parseXlsxForPreview/);
});

test("共享附属面的排版、数值与图标按钮满足 baseline 约束", () => {
  assert.match(exportButton, /text-balance/);
  assert.match(exportButton, /text-pretty/);
  assert.match(exportButton, /tabular-nums/);
  assert.match(categoryTable, /text-pretty/);
  assert.match(categoryTable, /tabular-nums/);
  assert.match(auditTimeline, /text-pretty/);
  assert.match(auditTimeline, /tabular-nums/);
  assert.match(progressEvidence, /text-balance/);
  assert.match(progressEvidence, /text-pretty/);
  assert.match(progressEvidence, /tabular-nums/);
  assert.match(performanceScore, /text-balance/);
  assert.match(performanceScore, /text-pretty/);
  assert.match(performanceScore, /tabular-nums/);
  assert.match(performanceReport, /text-balance/);
  assert.match(performanceReport, /text-pretty/);
  assert.match(performanceReport, /tabular-nums/);
  assert.match(attachmentPreview, /text-balance/);
  assert.match(attachmentPreview, /text-pretty/);
  assert.match(attachmentPreview, /tabular-nums/);

  assert.match(progressEvidence, /aria-label="缩小图片"/);
  assert.match(progressEvidence, /aria-label="放大图片"/);
  assert.match(progressEvidence, /aria-label="下载原图"/);
  assert.match(progressEvidence, /aria-label="关闭(?:预览)?"/);
  assert.match(attachmentPreview, /aria-label=\{t\("关闭预览"\)\}/);
});
