import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/AiModelManagementPage.tsx", import.meta.url),
  "utf8",
);

test("AI 模型管理页采用 Horizon 页面骨架并只展示四项真实指标", () => {
  assert.match(source, /className="horizon-theme hz-page/);
  assert.match(source, /<HorizonPageHeader/);
  assert.equal((source.match(/<HorizonMetric\b/g) ?? []).length, 4);
  assert.match(source, /label="模型连接" value=\{loading && total === 0/);
  assert.match(source, /label="本页启用" value=\{loading && rows\.length === 0/);
  assert.match(source, /label="连接正常" value=\{loading && rows\.length === 0/);
  assert.match(source, /label="连接异常" value=\{loading && rows\.length === 0/);
});

test("模型 CRUD、连通性测试与批量受控并发契约保持完整", () => {
  assert.match(source, /integrationManagementApi\.listAiModels\(/);
  assert.match(source, /integrationManagementApi\.saveAiModel\(/);
  assert.match(source, /integrationManagementApi\.deleteAiModel\(selectedRow\.id\)/);
  assert.ok((source.match(/integrationManagementApi\.testAiModelConnection\(/g) ?? []).length >= 3);
  assert.match(source, /const BULK_TEST_CONCURRENCY = 3;/);
  assert.match(source, /await Promise\.all\(/);
  assert.match(source, /Math\.min\(BULK_TEST_CONCURRENCY, models\.length\)/);
});

test("路由策略、监控、请求日志与详情链路保持可达", () => {
  assert.match(source, /integrationManagementApi\.listAiGatewayRoutes\(/);
  assert.match(source, /integrationManagementApi\.saveAiGatewayRoute\(/);
  assert.match(source, /integrationManagementApi\.getAiGatewayOverview\(gatewayRange\)/);
  assert.match(source, /integrationManagementApi\.listAiGatewayCircuits\(/);
  assert.match(source, /integrationManagementApi\.listAiGatewayRequests\(/);
  assert.match(source, /function GatewayRequestDetail/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /连接 ID：/);
});

test("预设、导入导出、搜索筛选与分页能力均被保留", () => {
  assert.match(source, /function openPresetDialog/);
  assert.match(source, /function handlePresetCreate/);
  assert.match(source, /function handleExport/);
  assert.match(source, /function handleImportFile/);
  assert.match(source, /function handleImportCreate/);
  assert.match(source, /downloadJsonFile\(/);
  assert.match(source, /useDeferredValue\(keyword\)/);
  assert.match(source, /\[9, 18, 36, 90\]/);
  assert.match(source, /ariaLabel="按业务场景筛选请求"/);
  assert.match(source, /ariaLabel="按模型连接筛选请求"/);
});

test("弹窗统一使用项目原语、Horizon portal 并恢复触发点焦点", () => {
  assert.match(source, /components\/ui\/dialog/);
  assert.match(source, /components\/ui\/alert-dialog/);
  assert.ok((source.match(/horizon-portal/g) ?? []).length >= 6);
  assert.ok((source.match(/onCloseAutoFocus=/g) ?? []).length >= 6);
  assert.match(source, /<AlertDialogTitle>删除 AI 模型<\/AlertDialogTitle>/);
  assert.doesNotMatch(source, /createPortal|fixed inset-0|onKeyDown=\{handle.*Tab|focusTrap/i);
});

test("页面提供结构化 loading、error、empty 与语义化控件", () => {
  assert.match(source, /function WorkspaceErrorState/);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status"/);
  assert.match(source, /<HorizonEmptyState/);
  assert.match(source, /htmlFor="ai-model-name"/);
  assert.match(source, /htmlFor="ai-model-api-key"/);
  assert.match(source, /scope="col"/);
  assert.match(source, /focus-visible:ring-2/);
});

test("Horizon 企业后台视觉不含旧式装饰与整页横向溢出源", () => {
  assert.doesNotMatch(source, /gradient|purple-|violet-|indigo-|tracking-|transition-all|hover:-translate|blur-3xl/);
  assert.doesNotMatch(source, /h-screen|min-w-\[(?:1[1-9]\d{2}|[2-9]\d{3})px\]/);
  assert.match(source, /min-w-0 overflow-hidden rounded-2xl border border-slate-200/);
  assert.match(source, /material-scrollbar overflow-x-auto/);
});
