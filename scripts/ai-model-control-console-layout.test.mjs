import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/AiModelManagementPage.tsx", import.meta.url),
  "utf8",
);

test("AI 模型页使用与 INOGI 一致的浅色内嵌控制台，而不是独立暗色产品皮肤", () => {
  assert.match(source, /border border-slate-200 bg-white\/95 text-slate-900/);
  assert.match(source, /AI 模型控制台/);
  assert.match(source, /<Tabs value=\{workspaceTab\}/);
  assert.match(source, /<TabsList className="relative flex h-auto w-full/);
  assert.match(source, /bg-slate-50\/80/);
  assert.match(source, /data-\[state=active\]:border-indigo-200/);
  assert.doesNotMatch(source, /bg-\[#090d13\]/);
  assert.doesNotMatch(source, /text-\[2rem\].*AI 模型与路由控制台/);
  assert.doesNotMatch(source, /sm:grid-cols-2 xl:grid-cols-4" aria-label="AI 控制台工作区"/);
});

test("模型连接采用可响应的卡片网格并在首屏集中展示状态与统计", () => {
  assert.match(source, /const PAGE_SIZE = 9;/);
  assert.match(source, /\[9, 18, 36, 90\]/);
  assert.match(source, /aria-label="AI 模型连接列表"/);
  assert.match(source, /grid gap-2\.5 sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(source, /本页启用 \{visibleEnabledCount\}\/\{rows.length\}/);
  assert.match(source, /今日 Token/);
  assert.match(source, /aria-label=\{`测试 \$\{row\.name\} 连通性`\}/);
  assert.doesNotMatch(source, /min-w-\[1560px\]/);
  assert.doesNotMatch(source, /<Table(?:Head|Header|Body|Row|Cell)?\b/);
});

test("AI 模型连接支持受控并发的全部连通性测试", () => {
  assert.match(source, /const BULK_TEST_CONCURRENCY = 3;/);
  assert.match(source, /function handleTestAllConnections/);
  assert.match(source, /await Promise\.all\(/);
  assert.match(source, /: "全部测试"/);
  assert.match(source, /测试中 \$\{bulkTestProgress\.completed\}\/\$\{bulkTestProgress\.total/);
  assert.match(source, /成功 \$\{succeededCount\}，失败 \$\{failures\.length\}/);
});

test("运行监控与路由工作区复用浅色材质卡片和靛蓝交互色", () => {
  assert.ok((source.match(/border border-slate-200 bg-white/g) ?? []).length >= 8);
  assert.match(source, /Gateway Pulse/);
  assert.match(source, /space-y-3/);
  assert.match(source, /data-\[state=checked\]:bg-indigo-600/);
  assert.doesNotMatch(source, /bg-\[#111720\]/);
});

test("默认回退场景初始折叠，路由配置区提供可执行的连接引导", () => {
  assert.match(source, /useState\(false\).*fallbackScenesOpen|fallbackScenesOpen, setFallbackScenesOpen.*useState\(false\)/s);
  assert.match(source, /<Collapsible open=\{fallbackScenesOpen\}/);
  assert.match(source, /默认回退场景/);
  assert.match(source, /使用\{suggestedModel\.is_default_enabled/);
  assert.match(source, /启用专用路由前，请至少添加一条模型连接/);
});

test("请求展开区展示请求摘要、Token 拆分、最终错误和逐次连接信息", () => {
  assert.match(source, /function GatewayRequestDetail/);
  assert.match(source, /请求摘要/);
  assert.match(source, /Token 用量/);
  assert.match(source, /最终错误/);
  assert.match(source, /连接 ID：/);
  assert.match(source, /aria-expanded=\{expanded\}/);
});

test("模型目录补齐截图中的语音、版本化 DeepSeek 和精确千问型号", () => {
  assert.match(source, /model: "qwen3\.8-max"/);
  assert.match(source, /model: "qwen-audio-3\.0-tts-plus"/);
  assert.match(source, /model: "qwen-audio-3\.0-realtime-plus"/);
  assert.match(source, /model: "deepseek-v4-flash-0731"/);
  assert.match(source, /BAILIAN_PRESET_MODELS\.filter\(\(item\) => !existingModels\.has/);
  assert.match(source, /enabled: Boolean\(sharedApiKey\)/);
});

test("AI 模型管理交互统一使用 Radix 原语，且不再残留原生 select 或 MUI Dialog", () => {
  assert.match(source, /components\/ui\/select/);
  assert.match(source, /components\/ui\/dialog/);
  assert.match(source, /components\/ui\/alert-dialog/);
  assert.match(source, /components\/ui\/checkbox/);
  assert.doesNotMatch(source, /@mui\/material/);
  assert.doesNotMatch(source, /<select\b/);
  assert.doesNotMatch(source, /type="checkbox"/);
});

test("运行监控覆盖全部模型连接并提供筛选、分页和可点击详情", () => {
  assert.match(source, /全部模型连接/);
  assert.match(source, /overview\?\.connections/);
  assert.match(source, /按供应商筛选模型连接/);
  assert.match(source, /每页模型监控数量/);
  assert.match(source, /查看该连接的调用明细/);
  assert.match(source, /按模型连接筛选请求/);
  assert.match(source, /每页请求明细数量/);
});
