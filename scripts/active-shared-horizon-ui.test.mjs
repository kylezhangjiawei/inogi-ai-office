import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const root = source("src/app/Root.tsx");
const routes = {
  rdWorkspace: source("src/app/RDMyWorkspacePage.tsx"),
  externalDocs: source("src/app/ExternalDocsPage.tsx"),
  knowledgeBase: source("src/app/RDKnowledgeBasePage.tsx"),
  dailyReport: source("src/app/RDDailyReportPanel.tsx"),
  monthlyReport: source("src/app/RDMonthlyReportPanel.tsx"),
  expenseStatistics: source("src/modules/expense/components/ExpenseStatistics.tsx"),
};

const visualSources = {
  "全局页头": source("src/app/components/header_1.tsx"),
  "全局侧边栏": source("src/app/components/sidebar_1.tsx"),
  "成员提及": source("src/app/components/MentionInput.tsx"),
  "外部文档原文证据": source("src/app/components/ExternalDocumentEvidenceViewer.tsx"),
  "费用指标卡": source("src/modules/expense/components/KPICard.tsx"),
  "知识库高级预览": source("src/app/components/KbAdvancedPreview.tsx"),
  "移动图片预览": source("src/app/components/MobileZoomableImage.tsx"),
  "报告详情抽屉": source("src/app/components/ReportDetailDrawer.tsx"),
  "动态文本翻译": source("src/app/components/TranslatableText.tsx"),
};

test("只纳入真实挂载的共享组件，旧 Sidebar 不进入改造范围", () => {
  assert.match(root, /from "\.\/components\/header_1"/);
  assert.match(root, /from "\.\/components\/sidebar_1"/);
  assert.doesNotMatch(root, /from "\.\/components\/Sidebar"/);
  assert.match(routes.rdWorkspace, /from "\.\/components\/MentionInput"/);
  assert.match(routes.externalDocs, /from "\.\/components\/ExternalDocumentEvidenceViewer"/);
  assert.match(routes.knowledgeBase, /from "\.\/components\/KbAdvancedPreview"/);
  assert.match(routes.knowledgeBase, /from "\.\/components\/MobileZoomableImage"/);
  assert.match(routes.dailyReport, /from "\.\/components\/ReportDetailDrawer"/);
  assert.match(routes.monthlyReport, /from "\.\/components\/ReportDetailDrawer"/);
  assert.match(routes.expenseStatistics, /from "\.\/KPICard"/);
});

test("活跃共享组件统一使用 Horizon 浅色单强调视觉", () => {
  for (const [name, component] of Object.entries(visualSources)) {
    assert.doesNotMatch(component, /\b(?:indigo|violet|purple|fuchsia|pink)-/, `${name}不应保留旧紫色强调`);
    assert.doesNotMatch(component, /\bdark:/, `${name}不应保留暗色分支`);
    assert.doesNotMatch(component, /(?:bg-|linear-|radial-)gradient/, `${name}不应使用渐变`);
    assert.doesNotMatch(component, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name}不应修改字距`);
    assert.doesNotMatch(component, /\btransition-all\b/, `${name}不应使用全属性过渡`);
    assert.doesNotMatch(component, /hover:-translate/, `${name}不应使用悬停位移`);
    assert.doesNotMatch(component, /backdrop-blur/, `${name}不应使用背景模糊`);
    assert.match(component, /primary|horizon-theme|rd-horizon-global-(?:header|sidebar)/, `${name}应接入 Horizon 主题视觉`);
  }
});

test("页头继续保留搜索、消息、语言和账号入口", () => {
  const header = visualSources["全局页头"];
  assert.match(header, /updateCockpitKeyword/);
  assert.match(header, /fetchRdMessages/);
  assert.match(header, /fetchRdUnreadMessageCount/);
  assert.match(header, /patchRdMessage/);
  assert.match(header, /setI18nLang/);
  assert.match(header, /<Popover open=\{open\}/);
  assert.match(header, /<DropdownMenu>/);
  assert.match(header, /aria-label=\{lang === "en" \? "Open notification preview"/);
});

test("成员提及和翻译继续保留原有数据契约", () => {
  const mentions = visualSources["成员提及"];
  const translation = visualSources["动态文本翻译"];
  assert.match(mentions, /parseActiveQuery/);
  assert.match(mentions, /mentionsForSubmit/);
  assert.match(mentions, /requestAnimationFrame/);
  assert.match(mentions, /renderTextWithMentions/);
  assert.match(translation, /fetchContentTranslation/);
  assert.match(translation, /\/api\/i18n\/translate-content/);
  assert.match(translation, /MAX_CONCURRENT = 4/);
  assert.match(translation, /toast\.error/);
});

test("文档与图片预览使用统一原语且保留读取、缩放和返回键行为", () => {
  const evidence = visualSources["外部文档原文证据"];
  const mobileImage = visualSources["移动图片预览"];
  const knowledgePreview = visualSources["知识库高级预览"];

  assert.match(evidence, /<Dialog open/);
  assert.match(evidence, /horizon-theme horizon-portal/);
  assert.match(evidence, /getExternalDocumentVersionPreviewContent/);
  assert.match(evidence, /renderAsync\(blob/);
  assert.match(evidence, /downloadBlob\(blob, version\.fileName\)/);

  assert.match(mobileImage, /<Dialog open/);
  assert.match(mobileImage, /MOBILE_IMAGE_PREVIEW_HISTORY_KEY/);
  assert.match(mobileImage, /window\.history\.pushState/);
  assert.match(mobileImage, /window\.history\.back\(\)/);
  assert.match(mobileImage, /pinchTaskImageTransform/);
  assert.match(mobileImage, /onDoubleClick/);
  assert.match(mobileImage, /aria-label="缩小图片"/);
  assert.match(mobileImage, /aria-label="放大图片"/);

  assert.match(knowledgePreview, /import\("xlsx"\)/);
  assert.match(knowledgePreview, /import\("mammoth"\)/);
  assert.match(knowledgePreview, /sandbox="allow-same-origin"/);
});

test("报告抽屉与费用指标卡保留可调整宽度和点击入口", () => {
  const report = visualSources["报告详情抽屉"];
  const kpi = visualSources["费用指标卡"];
  assert.match(report, /<Sheet open/);
  assert.match(report, /DRAWER_MIN_WIDTH = 640/);
  assert.match(report, /setPointerCapture/);
  assert.match(report, /setWidth\(Math\.min/);
  assert.match(report, /aria-label="拖拽调整报告详情宽度"/);
  assert.match(kpi, /onClick=\{onClick\}/);
  assert.match(kpi, /<Progress value=\{progress\}/);
  assert.doesNotMatch(kpi, /motion\.div|whileHover/);
});


test("所有前端模块继承共享品牌，不再硬编码旧 Klein Blue", () => {
  const root = new URL("../src/", import.meta.url);
  for (const path of readdirSync(root, { recursive: true })) {
    if (!/\.(?:tsx?|css)$/.test(path)) continue;
    const text = readFileSync(new URL(path.replaceAll("\\", "/"), root), "utf8");
    assert.doesNotMatch(text, /#002fa7|#002581|rgba\(0,\s*47,\s*167/ig, path);
  }
});

test("MateChat 入口在顶栏正常布局内，避免覆盖各业务页的分页和表单", () => {
  const header = source("src/app/components/header_1.tsx");
  const root = source("src/app/Root.tsx");
  const chat = source("src/app/components/MateChatBubble.tsx");
  assert.match(header, /<MateChatBubble \/>/);
  assert.doesNotMatch(root, /<MateChatBubble/);
  assert.match(chat, /<Button ref=\{triggerRef\}/);
  assert.match(chat, /triggerRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(chat, /FLOATING_BOTTOM_SAFE_AREA|setBubblePos|draggingRef/);
});


test("业务页面的基础交互控件统一经由项目 UI 库渲染", async () => {
  const ts = (await import("typescript")).default;
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const violations = [];
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!path.replaceAll("\\", "/").endsWith("/components/ui")) inspect(path);
      } else if (/\.[jt]sx$/.test(entry.name)) {
        const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        function visit(node) {
          if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ["input", "select", "textarea", "button"].includes(node.tagName.getText(ast))) {
            violations.push(path + ":" + (ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1));
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
    }
  }
  inspect(root);
  assert.deepEqual(violations, [], "基础控件应使用 Input、NativeSelect、Textarea、Button、Checkbox、RadioGroup 或 Slider，原生标签只在 UI 原语内部使用");
});
