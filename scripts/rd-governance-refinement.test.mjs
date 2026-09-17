import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const aiSettings = source("src/app/RDAiSettingsPage.tsx");
const rdApi = source("src/app/lib/rdApi.ts");
const approvalFlow = source("src/app/RDApprovalFlowPage.tsx");
const sheet = source("src/app/RDSheetPage.tsx");
const theme = source("src/styles/theme.css");

test("研发 AI 策略提供标准标题、脏状态与可恢复的读写反馈", () => {
  assert.match(aiSettings, /<h2 className="[^"]*text-balance/);
  assert.doesNotMatch(aiSettings, /<h1/, "页面壳已提供唯一主标题，AI 策略内容区不应重复 h1");
  assert.match(aiSettings, /const dirty = settings !== savedSettings/);
  assert.match(aiSettings, /id="rd-ai-save-error"[\s\S]{0,180}role="alert"/);
  assert.match(aiSettings, /研发 AI 策略读取失败/);
  assert.match(aiSettings, /onClick=\{\(\) => void loadSettings\(\)\}/);
  assert.match(aiSettings, /savingRef\.current/);
  assert.match(aiSettings, /requestId !== loadRequestRef\.current/);
  assert.match(aiSettings, /baseUpdatedAtRef\.current = payload\.updated_at \?\? ""/);
  assert.match(aiSettings, /saveRdAiSettings\(submittedSettings, submittedBaseUpdatedAt\)/);
  assert.match(aiSettings, /\(error as RdApiError\)\.status === 409/);
  assert.match(aiSettings, /reloadSettingsKeepingDraft/);
  assert.match(aiSettings, /重新读取并保留草稿/);
  assert.match(aiSettings, /aria-busy=\{saving \|\| loading\}/);
  assert.match(rdApi, /saveRdAiSettings\(payload: RdAiSettingsPayload, baseUpdatedAt: string\)/);
  assert.match(rdApi, /JSON\.stringify\(\{ settings: payload, base_updated_at: baseUpdatedAt \}\)/);
});

test("研发 AI 场景控件具备上下文名称并保持单一 Horizon 主题 强调色", () => {
  for (const wording of ["{name}主模型", "{name}兜底模型", "{name} Prompt 版本", "{name}置信度阈值"]) {
    assert.match(aiSettings, new RegExp(wording.replace(/[{}]/g, "\\$&")));
  }
  assert.match(aiSettings, /border-primary\/25 bg-accent text-primary/);
  assert.doesNotMatch(aiSettings, /\b(?:indigo|purple|violet|fuchsia|pink)-/i);
  assert.doesNotMatch(aiSettings, /\btracking-|\buppercase\b|shadow-\[/);
});

test("研发数据表在编辑器首屏提供明确失败恢复和可访问历史状态", () => {
  assert.match(sheet, /研发数据表加载失败/);
  assert.match(sheet, /onClick=\{\(\) => void load\(\)\}/);
  assert.match(sheet, /role=\{error \? "alert" : "status"\}/);
  assert.match(sheet, /正在加载历史版本/);
  assert.match(sheet, /历史版本读取失败/);
  assert.match(sheet, /onClick=\{\(\) => void loadVersions\(\)\}/);
  assert.match(sheet, /versionsRequestIdRef\.current !== requestId/);
  assert.doesNotMatch(sheet, /\.catch\(\(\) => setVersions\(\[\]\)\)/);
  assert.match(sheet, /<time[^>]+dateTime=\{v\.updated_at\}/);
  assert.match(sheet, /rounded-xl border border-slate-200 bg-white shadow-sm/);
  assert.doesNotMatch(sheet, /shadow-\[/);
});

test("审批流节点在窄容器和长候选列表中保留完整操作语义", () => {
  assert.match(approvalFlow, /min-w-0 flex-1 sm:min-w-\[220px\]/);
  assert.match(approvalFlow, /inputMode="numeric"/);
  assert.match(approvalFlow, /切换节点 \{name\} 的超时升级/);
  assert.match(approvalFlow, /仅显示前 20 位候选/);
  assert.match(approvalFlow, /addableCandidates\.length > 20/);
  assert.match(approvalFlow, /aria-label=\{t\("流程概览"\)\}/);
  assert.doesNotMatch(approvalFlow, /id="approval-flow-(?:summary|nodes)-title"/);
});

test("研发 AI Horizon 卡片使用可见边界与克制阴影", () => {
  const start = theme.indexOf(".rd-horizon-ai-settings {");
  const end = theme.indexOf("@media (prefers-reduced-motion: reduce)", start);
  const scopedTheme = theme.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(scopedTheme, /border: 1px solid var\(--rd-line\) !important/);
  assert.match(scopedTheme, /border-radius: 14px !important/);
  assert.doesNotMatch(scopedTheme, /var\(--rd-shadow-focal\)/);
  assert.doesNotMatch(scopedTheme, /letter-spacing:/);
});
