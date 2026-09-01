import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pagePaths = [
  "src/app/CustomsAI.tsx",
  "src/app/CustomsDocs.tsx",
  "src/app/ExternalDocsPage.tsx",
  "src/app/RAKnowledgePage.tsx",
  "src/app/QualityDMSPage.tsx",
  "src/app/QATraceability.tsx",
];

const pages = Object.fromEntries(pagePaths.map((path) => [path, readFileSync(path, "utf8")]));

test("文件与知识六个入口统一挂载 Horizon 页面骨架", () => {
  for (const [path, source] of Object.entries(pages)) {
    assert.match(source, /horizon-theme hz-page/, `${path} 缺少 Horizon 页面根节点`);
    assert.match(source, /HorizonPageHeader/, `${path} 缺少统一页头`);
    assert.match(source, /HorizonMetricGrid/, `${path} 缺少指标带`);
  }
});

test("报关单证页面保留处理链路并使用标准对话框与就地校验", () => {
  const ai = pages["src/app/CustomsAI.tsx"];
  const docs = pages["src/app/CustomsDocs.tsx"];

  assert.match(ai, /page:customs-docs/);
  assert.match(ai, /page:external-docs/);
  assert.match(ai, /<Dialog open=/);
  assert.match(ai, /horizon-portal/);
  assert.match(docs, /aria-invalid=/);
  assert.match(docs, /role="alert"/);
  assert.match(docs, /HorizonEmptyState/);
});

test("对外资料版本保留真实 API 契约并采用可访问上传与归档流程", () => {
  const source = pages["src/app/ExternalDocsPage.tsx"];
  for (const apiName of [
    "listExternalDocuments",
    "getExternalDocument",
    "createExternalDocument",
    "uploadExternalDocumentVersion",
    "replaceExternalComparisonCandidate",
    "reviewExternalDifference",
    "reviewAllExternalDifferences",
    "regenerateExternalComparisonSummary",
    "archiveExternalComparison",
    "getExternalDocumentVersionDownloadContent",
  ]) {
    assert.match(source, new RegExp(apiName), `ExternalDocsPage 缺少 ${apiName} 调用链`);
  }
  assert.match(source, /<Dialog open=\{showUpload\}/);
  assert.match(source, /<AlertDialog>/);
  assert.match(source, /htmlFor="external-doc-/);
  assert.match(source, /uploadError/);
});

test("法规知识库提供延迟检索、显式筛选与条款版本工作区", () => {
  const source = pages["src/app/RAKnowledgePage.tsx"];
  assert.match(source, /useDeferredValue/);
  assert.match(source, /matchesRegulation\(regulation, normalizedKeyword, searchMode\)/);
  assert.match(source, /SEMANTIC_TERMS/);
  assert.match(source, /<Checkbox/);
  assert.match(source, /<Tabs/);
  assert.match(source, /<details/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /HorizonEmptyState/);
});

test("质量 DMS 与全链路追溯使用语义证据表和确认操作", () => {
  const dms = pages["src/app/QualityDMSPage.tsx"];
  const trace = pages["src/app/QATraceability.tsx"];

  assert.match(dms, /<caption/);
  assert.match(dms, /<AlertDialog/);
  assert.match(dms, /<Tabs/);
  assert.match(trace, /<caption/);
  assert.match(trace, /aria-invalid=/);
  assert.match(trace, /role="alert"/);
  assert.match(trace, /<AlertDialog/);
  assert.match(trace, /page:quality-dms/);
});

test("文件与知识页面不包含禁用视觉、MUI 与手写弹层模式", () => {
  const forbidden = /bg-gradient|from-(?:purple|violet|indigo)|to-(?:purple|violet|indigo)|(?:text|bg|border|ring)-(?:purple|violet|indigo)-|tracking-|fixed\s+inset|h-screen|backdrop-blur|@mui\/material/;
  for (const [path, source] of Object.entries(pages)) {
    assert.doesNotMatch(source, forbidden, `${path} 仍包含禁用的视觉或交互模式`);
  }
});
