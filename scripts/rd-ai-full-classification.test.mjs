import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const cockpit = await readFile(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");
const apiClient = await readFile(new URL("../src/app/lib/rdApi.ts", import.meta.url), "utf8");
const aiController = await readFile(
  new URL("../apps/api/src/modules/research-development/rd-ai.controller.ts", import.meta.url),
  "utf8",
);
const aiService = await readFile(
  new URL("../apps/api/src/modules/research-development/rd-ai.service.ts", import.meta.url),
  "utf8",
);
const rdService = await readFile(
  new URL("../apps/api/src/modules/research-development/research-development.service.ts", import.meta.url),
  "utf8",
);
const classificationDialog = cockpit.slice(
  cockpit.indexOf("function ProjectClassificationDialog"),
  cockpit.indexOf("// ─── Main Page"),
);

test("cockpit exposes an independent full-task AI classification action", () => {
  assert.match(cockpit, /onAiClassifyTasks/);
  assert.match(cockpit, /AI 全量归纳/);
  assert.match(cockpit, /scopeLabel="全部线上任务（跨产品库）"/);
  assert.match(cockpit, /tasks=\{classificationTasks\}/);
  assert.doesNotMatch(cockpit, />\s*AI 归类总结\s*</);
});

test("AI classification attachments support drag-and-drop through the shared validator", () => {
  assert.match(cockpit, /const addFiles = useCallback/);
  assert.match(cockpit, /PROJECT_CLASSIFICATION_FILE_EXTENSIONS\.has\(extension\)/);
  assert.match(cockpit, /onDragEnter=\{handleFileDragEnter\}/);
  assert.match(cockpit, /onDragOver=\{handleFileDragOver\}/);
  assert.match(cockpit, /onDragLeave=\{handleFileDragLeave\}/);
  assert.match(cockpit, /onDrop=\{handleFileDrop\}/);
  assert.match(cockpit, /Array\.from\(event\.dataTransfer\.files\)/);
  assert.match(cockpit, /松开即可添加附件/);
  assert.match(cockpit, /拖拽附件到此处，或点击选择/);
});

test("AI classification modal closes only through explicit controls", () => {
  assert.match(classificationDialog, /aria-label="关闭全量任务归纳"/);
  assert.match(classificationDialog, />关闭<\/Button>/);
  assert.doesNotMatch(classificationDialog, /event\.target === event\.currentTarget/);
  assert.doesNotMatch(classificationDialog, /event\.key === "Escape"/);
});

test("server builds a trusted cross-product snapshot and excludes archived task trees", () => {
  assert.match(rdService, /if \(!categoryId\) \{/);
  assert.match(rdService, /readProductCategoryStore\(\)/);
  assert.match(rdService, /product_id: 'all-products'/);
  assert.match(rdService, /if \(!taskId \|\| archived\) continue/);
  assert.match(aiController, /@Post\('classify-project'\)/);
  assert.match(aiController, /@Permissions\('rd-project:direct'\)/);
  assert.match(apiClient, /if \(payload\.categoryId\) form\.append\("category_id"/);
});

test("200-plus tasks are analyzed in batches and consolidated across batches", () => {
  assert.match(aiService, /const batchSize = 60/);
  assert.match(aiService, /Math\.ceil\(tasks\.length \/ batchSize\)/);
  assert.match(aiService, /每轮最多并行 2 个模型请求/);
  assert.match(aiService, /全量任务索引/);
  assert.match(aiService, /跨批次、跨产品、跨现有类目的重复\/同质任务/);
  assert.match(aiService, /已将 \$\{tasks\.length\} 条任务分为 \$\{batchCount\} 批初筛/);
});

test("full-task analysis uses a background job instead of one proxy-bound long request", () => {
  assert.match(aiController, /@Post\('classify-project-jobs'\)/);
  assert.match(aiController, /setImmediate\(\(\) =>/);
  assert.match(aiController, /@Get\('classify-project-jobs\/:jobId'\)/);
  assert.match(aiController, /job\.userId !== request\.user\.id/);
  assert.match(apiClient, /\/ai\/classify-project-jobs/);
  assert.match(apiClient, /while \(Date\.now\(\) < deadline\)/);
  assert.match(apiClient, /job\.status === "completed"/);
  assert.match(apiClient, /网络连接中断，请确认服务可用后重试/);
});

test("analysis produces member task lines and supports reviewed duplicate or homogeneous merges", () => {
  assert.match(aiService, /member_task_lines/);
  assert.match(aiService, /不得把不同主责人的任务混入同一主任务线/);
  assert.match(aiService, /recommended_primary_task_id/);
  assert.match(cockpit, /成员主任务线/);
  assert.match(cockpit, /ProjectClassificationMergeDraft/);
  assert.match(cockpit, /chooseMergePrimary/);
  assert.match(cockpit, /toggleMergeSource/);
  assert.match(cockpit, /attachRdTasksToParent\(draft\.sourceTaskIds, draft\.primaryTaskId\)/);
  assert.match(cockpit, /确认并执行/);
  assert.match(cockpit, /原任务内容与记录完整保留/);
});

test("collaboration tasks are projected into personal and administrator member views without entering AI scope", () => {
  assert.match(apiClient, /includeCollaboration/);
  assert.match(apiClient, /fetchRdMemberTaskCategories/);
  assert.match(rdService, /getCombinedWorkspace/);
  assert.match(rdService, /getMemberTaskCategories/);
  assert.match(rdService, /source_workspace: workspace/);
  assert.match(cockpit, /const classificationTasks/);
  assert.match(cockpit, /tasks=\{classificationTasks\}/);
});
