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

test("cockpit keeps the full-task AI workflow but hides its entry behind the release switch", () => {
  assert.match(cockpit, /onAiClassifyTasks/);
  assert.match(cockpit, /AI 全量归纳/);
  assert.match(cockpit, /const AI_FULL_CLASSIFICATION_VISIBLE = false/);
  assert.match(cockpit, /onAiClassifyTasks=\{AI_FULL_CLASSIFICATION_VISIBLE && canDirectProject/);
  assert.match(cockpit, /AI_FULL_CLASSIFICATION_VISIBLE && showProjectClassification \? \(/);
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

test("召回由本地全量两两比对完成，不再按批切分导致跨批漏检", () => {
  // 旧实现按 60 条切片、要求模型「在本批内找重复」，跨批的重复对没有任何一次调用同时看见过。
  assert.doesNotMatch(aiService, /const batchSize = 60/);
  assert.doesNotMatch(aiService, /这是全量任务分析的第 \$\{batchNumber\}/);
  assert.match(aiService, /private buildMergeCandidateClusters/);
  // 全量两两比对：双重循环 + 并查集
  const recall = aiService.slice(
    aiService.indexOf("private buildMergeCandidateClusters"),
    aiService.indexOf("private parseMergeVerdict"),
  );
  assert.match(recall, /for \(let i = 0; i < tasks\.length; i \+= 1\)/);
  assert.match(recall, /for \(let j = i \+ 1; j < tasks\.length; j \+= 1\)/);
  assert.match(recall, /projectTitleSimilarity\(left\.title, right\.title\) >= RD_MERGE_RECALL_THRESHOLD/);
  // 两条硬约束：父子层级不算重复、跨产品库不合并
  assert.match(recall, /isHierarchyRelated\(left\.task_id, right\.task_id\)/);
  assert.match(recall, /\(left\.product_name \|\| ''\) !== \(right\.product_name \|\| ''\)/);
});

test("AI 逐簇判定，每次只问一件事并给出主任务", () => {
  assert.match(aiService, /const RD_MERGE_RECALL_THRESHOLD = 0\.55/);
  assert.match(aiService, /const RD_MERGE_AUTO_CONFIDENCE = 0\.75/);
  assert.match(aiService, /const RD_MERGE_REVIEW_CONFIDENCE = 0\.5/);
  assert.match(aiService, /const adjudicate = async \(cluster/);
  assert.match(aiService, /你只需判定这一组能否合并为一条主任务/);
  assert.match(aiService, /"mergeable":boolean/);
  assert.match(aiService, /private parseMergeVerdict/);
  // 越界 / 编造的 task_id 必须被丢弃
  const verdict = aiService.slice(
    aiService.indexOf("private parseMergeVerdict"),
    aiService.indexOf("private buildLocalCategoryView"),
  );
  assert.match(verdict, /allowedIds\.has\(parsed\.primary_task_id\)/);
  assert.match(verdict, /allowedIds\.has\(id\)/);
  // 置信度分流：高置信可直接合并，中置信转人工确认
  assert.match(aiService, /verdict\.confidence >= RD_MERGE_AUTO_CONFIDENCE/);
  assert.match(aiService, /verdict\.confidence >= RD_MERGE_REVIEW_CONFIDENCE/);
});

test("描述性分组改为本地确定性生成，AI 额度全部用在合并判定上", () => {
  assert.match(aiService, /private buildLocalCategoryView/);
  assert.match(aiService, /private buildLocalMemberTaskLines/);
  assert.match(aiService, /categories: this\.buildLocalCategoryView\(tasks\)/);
  assert.match(aiService, /member_task_lines: this\.buildLocalMemberTaskLines\(tasks\)/);
});

test("高置信合并组默认勾选，一次点击即可应用", () => {
  // 「最少人工操作」的关键：AI 已选好主任务，高置信组开屏即勾上
  const duplicateDraft = cockpit.slice(
    cockpit.indexOf("const duplicateDrafts = next.duplicate_groups.map"),
    cockpit.indexOf("const homogeneousDrafts = next.homogeneous_clusters.map"),
  );
  assert.match(duplicateDraft, /enabled: true,/);
  assert.match(duplicateDraft, /group\.recommended_primary_task_id/);
  // 需人工确认的一组仍保持不勾
  const homogeneousDraft = cockpit.slice(
    cockpit.indexOf("const homogeneousDrafts = next.homogeneous_clusters.map"),
    cockpit.indexOf("setMergeDrafts(["),
  );
  assert.match(homogeneousDraft, /enabled: false,/);
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
  assert.match(aiService, /recommended_primary_task_id/);
  assert.match(cockpit, /成员主任务线/);
  assert.match(cockpit, /ProjectClassificationMergeDraft/);
  assert.match(cockpit, /chooseMergePrimary/);
  assert.match(cockpit, /toggleMergeSource/);
  assert.match(cockpit, /attachRdTasksToParent\(draft\.sourceTaskIds, draft\.primaryTaskId\)/);
  assert.match(cockpit, /确认并执行/);
  // 「内容完整保留」这句原先写在前端 recordAudit 的 comment 里；留痕下沉服务端后，
  // 它由 attachTasksAsSubtasks 产出 —— 走接口直调并入同样留得下这条记录。
  assert.match(rdService, /原任务内容与记录完整保留/);
  assert.match(rdService, /将任务并入主任务/);
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

test("任务类型预设：前后端两份清单锁死，详情页可人工纠正且不动分类归属", async () => {
  const detail = await readFile(new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url), "utf8");
  const extract = (src) => {
    const block = src.match(/RD_TASK_TYPE_PRESETS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
    return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  const backend = extract(aiService);
  const frontend = extract(apiClient);
  assert.ok(backend.length >= 12, `后端任务类型清单缺失或过短：${backend.length}`);
  assert.deepEqual(frontend, backend, "前后端任务类型预设不一致，选择器会给出 AI 不认的值");
  // 提示词由常量拼接，杜绝「清单改了提示词没改」
  assert.match(aiService, /任务类型要从任务内容中判断，例如：\$\{RD_TASK_TYPE_PRESETS\.join\('、'\)\}/);
  // 详情页只改 category_path 第三段：前两段是分类归属，归属变更走「移动归类」
  assert.match(detail, /const saveTaskType = async/);
  assert.match(detail, /withTaskType\(task\.category_path, value\)/);
  assert.match(detail, /updateRdTask\(task\.task_id, \{ category_path: nextPath \}\)/);
  // 预设之外允许自定义，否则清单外的新类型改不了
  assert.match(detail, /CUSTOM_TASK_TYPE_OPTION/);
  // task 与 allTasks 双源同步，否则人员任务弹层等派生视图仍显示旧 tag
  assert.match(detail, /setAllTasks\([\s\S]{0,240}category_path: nextPath/);
  // 原「主题」只读行已被取代，不该同一个值显示两遍
  assert.doesNotMatch(detail, /\{ label: t\("主题"\), value: topicLabel \}/);
});
