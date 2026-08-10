import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * 驾驶舱 / 个人工作台的口径一致性回归。
 * 这些文件依赖过多相对导入，无法单文件转译执行，按仓库惯例做源码结构断言。
 */

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
const cockpitSource = await read("../src/app/RDTaskManagementPage.tsx");
const workspaceSource = await read("../src/app/RDMyWorkspacePage.tsx");
const metricsSource = await read("../src/app/lib/rdCockpitMetrics.ts");
const hookSource = await read("../src/app/hooks/useRDCockpitData.ts");
const mobileSource = await read("../src/app/MobileRDCockpit.tsx");
test("研发驾驶舱保持瀑布流任务卡片，并在任务名称区展示层级", () => {
  assert.match(cockpitSource, /function distributeIntoColumns<T>/);
  assert.match(cockpitSource, /function useMasonryColumns\(\): number/);
  assert.match(cockpitSource, /distributeIntoColumns\(shownTasks, masonryColumns\)/);
  assert.doesNotMatch(cockpitSource, /renderTopicTaskFeed/);
  assert.match(cockpitSource, /const hierarchySegments = splitCategoryPath\(task\.category_path\)\.slice\(-2\)/);
  assert.match(cockpitSource, /const directSubtaskCount = task\.subtasks\?\.length \?\? 0/);
  assert.match(cockpitSource, /const hierarchyRoleLabel = task\.parent_task_id/);
  assert.match(cockpitSource, /t\("主任务 · \{count\} 个下级"/);
});

test("驾驶舱与个人工作台任务卡采用同一信息层级", () => {
  // 驾驶舱：标签/附件/三点菜单 → 标题 → 摘要 → 小图带 → 进度 → 底部元数据。
  assert.match(cockpitSource, /const taskAttachmentCount = attachmentPreview\?\.attachment_count \?\? task\.attachments/);
  assert.match(cockpitSource, /const cardPreviewSlots = 4/);
  assert.match(cockpitSource, /flex min-h-\[220px\] min-w-0 flex-col/);
  assert.match(cockpitSource, /<MoreVertical className="h-4 w-4"/);
  assert.doesNotMatch(cockpitSource, /\{\/\* 左侧渐变竖条 \*\/\}/);
  const cockpitSummary = cockpitSource.indexOf("摘要优先使用最新进度");
  const cockpitAttachments = cockpitSource.indexOf("<TaskAttachmentStrip", cockpitSummary);
  const cockpitProgress = cockpitSource.indexOf("进度条：与参考卡片一致");
  const cockpitMetadata = cockpitSource.indexOf("参考卡片尾部：优先级 / 截止 / 风险在左");
  assert.ok(
    cockpitSummary > 0 && cockpitAttachments > cockpitSummary && cockpitProgress > cockpitAttachments && cockpitMetadata > cockpitProgress,
    "驾驶舱卡片应按摘要、附件、进度、元数据顺序展示",
  );

  // 个人工作台保持相同结构；批量加载当前可见任务附件，协同池不误用研发池预览。
  assert.match(workspaceSource, /fetchRdTaskAttachmentPreviews\(missingIds/);
  assert.match(workspaceSource, /const hierarchyTags = task\.category_path/);
  assert.match(workspaceSource, /const visibleAttachmentImages = attachmentImages\.slice\(0, 4\)/);
  assert.match(workspaceSource, /附件预览失败不阻断任务列表/);
  assert.match(workspaceSource, /flex min-h-\[220px\] min-w-0 flex-col/);
  assert.match(workspaceSource, /<MoreVertical className="h-4 w-4"/);
  assert.doesNotMatch(workspaceSource, /\{\/\* Left gradient stripe \*\/\}/);
  const workspaceSummary = workspaceSource.indexOf("<AutoTranslatedText text={cardSummary}");
  const workspaceAttachments = workspaceSource.indexOf("visibleAttachmentImages.length > 0", workspaceSummary);
  const workspaceProgress = workspaceSource.indexOf("{/* Progress bar */}");
  const workspaceMetadata = workspaceSource.indexOf("卡片尾部集中呈现执行信息");
  assert.ok(
    workspaceSummary > 0 && workspaceAttachments > workspaceSummary && workspaceProgress > workspaceAttachments && workspaceMetadata > workspaceProgress,
    "个人工作台卡片应按摘要、附件、进度、元数据顺序展示",
  );
});

test("任务卡内部操作不会通过键盘冒泡误开详情，更新人头像使用更新人账号", () => {
  assert.match(cockpitSource, /if \(e\.target !== e\.currentTarget\) return;/);
  assert.match(workspaceSource, /if \(e\.target !== e\.currentTarget\) return;/);
  assert.match(
    cockpitSource,
    /userId=\{task\.latest_progress_summary\s*\? task\.latest_progress_summary\.actor_user_id\s*:\s*task\.primary_owner_user_id\}/,
  );
});

test("三处页面都不再把「今天」存成模块级常量", () => {
  // 模块级（行首无缩进）的日期常量会在页面跨零点后失效
  for (const [label, source] of [
    ["驾驶舱", cockpitSource],
    ["工作台", workspaceSource],
    ["共享指标", metricsSource],
  ]) {
    assert.doesNotMatch(source, /^const\s+\w*(TODAY|Today|today)\w*\s*=\s*new Date\(/m, label);
  }
});

test("「今天」一律取本地日历日，不用 toISOString", () => {
  // toISOString() 取 UTC 日期，UTC+8 每天 0–8 点会整体错一天
  assert.doesNotMatch(workspaceSource, /new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]/);
  assert.match(workspaceSource, /todayLocalDateStr/);
  assert.match(cockpitSource, /todayLocalDateStr/);
});

test("到期天数统一走 lib/taskDue 的 daysUntilDue，不再各算一个今天", () => {
  for (const [label, source] of [
    ["驾驶舱", cockpitSource],
    ["工作台", workspaceSource],
    ["共享指标", metricsSource],
  ]) {
    assert.match(source, /daysUntilDue/, label);
  }
  // 工作台的 workspaceDaysUntil 必须只是 daysUntilDue 的转发，不能自建 today
  assert.match(workspaceSource, /function workspaceDaysUntil[\s\S]{0,160}?return daysUntilDue\(dateStr\);/);
});

test("驾驶舱指标只有一份实现，驾驶舱页面从共享库导入", () => {
  // 历史上驾驶舱页面自带一套副本，导致「限制成员页签」的修复只打了一半。
  for (const fn of ["computeRisks", "buildCatStats", "computePersonLoads", "flattenTasks"]) {
    assert.match(metricsSource, new RegExp(`export function ${fn}\\b`), `共享库应定义 ${fn}`);
    assert.doesNotMatch(cockpitSource, new RegExp(`^export function ${fn}\\b`, "m"), `驾驶舱不应再自建 ${fn}`);
  }
  assert.match(cockpitSource, /import \{[\s\S]{0,240}?computePersonLoads[\s\S]{0,240}?\} from "\.\/lib\/rdCockpitMetrics";/);
  // 风险判定的辅助链也不能再有第二份
  assert.doesNotMatch(cockpitSource, /^function getTaskRiskReason\b/m);
  assert.doesNotMatch(cockpitSource, /^function collectTaskRisks\b/m);
  // 类型同样单一来源
  for (const t of ["Risk", "CatStat", "PersonLoad"]) {
    assert.doesNotMatch(cockpitSource, new RegExp(`^export type ${t} = \\{`, "m"), `驾驶舱不应再自建 ${t} 类型`);
  }
});

test("computePersonLoads 接收并使用人员目录", () => {
  // 缺目录时 isTaskOwnerMember 只挡黑名单占位值，驾驶舱配置的成员白名单会整段失效
  assert.match(metricsSource, /peopleDirectory\?:\s*readonly/);
  assert.match(
    metricsSource,
    /isTaskOwnerMember\(\s*task\.primary_owner,\s*task\.primary_owner_user_id,\s*peopleDirectory\s*\)/,
  );
});

test("「谁算真人」全部走同一份占位值黑名单，不再各写一个正则", () => {
  // 历史上有三个变体：/已离职|待指派/、/已离职|待指派|外部机构/、以及共享黑名单，
  // 前两个都漏掉 未分配/未指派/暂无/采购/研发团队/系统，会把它们当成真人。
  assert.doesNotMatch(cockpitSource, /!\/[^/\n]*已离职[^/\n]*\/\.test\(/);
  const scoped = cockpitSource.match(/function computeScopedPersonLoads[\s\S]*?\n\}/);
  assert.ok(scoped, "未找到 computeScopedPersonLoads");
  assert.match(scoped[0], /isNonPersonTaskOwner\(task\.primary_owner\)/);
  assert.match(scoped[0], /isNonPersonTaskOwner\(collaborator\.name\)/);
  const aiProfiles = cockpitSource.match(/function buildAiPeopleProfiles[\s\S]*?\n\}/);
  assert.ok(aiProfiles, "未找到 buildAiPeopleProfiles");
  assert.match(aiProfiles[0], /isNonPersonTaskOwner\(owner\)/);
});

test("移动端驾驶舱把人员目录传进 computePersonLoads", () => {
  assert.match(hookSource, /fetchRdPeople/);
  assert.match(hookSource, /computePersonLoads\(categories,\s*8,\s*peopleDirectory\)/);
});

test("人员身份按 memberIdentityKey 索引，不用姓名当主键", () => {
  assert.match(metricsSource, /memberIdentityKey\(task\.primary_owner,\s*task\.primary_owner_user_id\)/);
  // PersonLoad 必须带 key 字段
  assert.match(metricsSource, /export type PersonLoad = \{[\s\S]{0,240}?\bkey:\s*string;/);
  // 选中的人存身份键，不再是裸姓名字符串
  assert.match(cockpitSource, /const \[selectedPerson, setSelectedPerson\] = useState</);
  assert.doesNotMatch(cockpitSource, /const \[selectedPersonName, setSelectedPersonName\]/);
  // 列表项与抽屉都按 key 定位，不按姓名
  assert.match(cockpitSource, /personLoads\.find\(\(load\) => load\.key === selectedPerson\?\.key\)/);
  assert.match(cockpitSource, /key=\{p\.key\}/);
});

test("人员抽屉与头像角标严格同口径：只取主责且活跃的根任务", () => {
  const drawer = cockpitSource.match(/const selectedPersonTasks = useMemo\(\(\) => \{[\s\S]*?\}, \[peopleAllTasks, selectedPerson\]\);/);
  assert.ok(drawer, "未找到 selectedPersonTasks");
  const body = drawer[0];
  assert.match(body, /memberIdentityKey\(task\.primary_owner,\s*task\.primary_owner_user_id\) === selectedPerson\.key/);
  assert.match(body, /!isArchivedTask\(task\)/);
  assert.match(body, /task\.status !== "completed"/);
  // 协助任务不能进抽屉，否则抽屉条数永远大于角标数
  assert.doesNotMatch(body, /collaborators/);
});

test("驾驶舱「活跃任务」排除已完成，与工作台同口径", () => {
  assert.match(cockpitSource, /const activeTasks = useMemo\(\s*\(\) => nonArchivedTasks\.filter\(\(task\) => task\.status !== "completed"\)/);
  assert.match(cockpitSource, /const totalActive = activeTasks\.length;/);
  // 完成率的分母仍是非归档总数，否则完成率恒为 0
  assert.match(cockpitSource, /rate: nonArchivedTasks\.length > 0/);
  // 工作台侧的既有口径不变
  assert.match(workspaceSource, /const activeRoleTasks = useMemo\(\(\) => roleTasks\.filter\(\(task\) => task\.status !== "completed"\)/);
});

test("成员页签把主责与协助分段，主责优先、协助折叠", () => {
  // 驾驶舱是给领导看「谁在负责什么」的：主责占第一屏，协助是下钻上下文
  const map = cockpitSource.match(/const personTasksMap = useMemo\(\(\) => \{[\s\S]*?\}, \[personLoads, allTasks, sortByUpdatedDesc, matchesKpiFilter, cockpitSearch\]\);/);
  assert.ok(map, "未找到 personTasksMap");
  assert.match(map[0], /\{ primary: Task\[\]; collaborating: Task\[\] \}/);
  assert.match(map[0], /memberIdentityKey\(task\.primary_owner, task\.primary_owner_user_id\) === p\.key/);
  assert.match(map[0], /task\.collaborators\.some\(\(c\) => memberIdentityKey\(c\.name, c\.user_id\) === p\.key\)/);
  // 两段应用同一套 KPI 筛选与搜索
  assert.match(map[0], /!matchesKpiFilter\(task\) \|\| !taskMatches\(task, cockpitSearch/);
  // 协助段默认折叠
  assert.match(cockpitSource, /const \[expandedCollabTabs, setExpandedCollabTabs\] = useState<Set<string>>\(\(\) => new Set\(\)\);/);
  assert.match(cockpitSource, /const collabExpanded = expandedCollabTabs\.has\(p\.key\);/);
  // 分页只驱动主责段
  assert.match(cockpitSource, /const shownTasks = primaryTasks\.slice\(0, visibleCount\);/);
  assert.match(cockpitSource, /loadNextTaskPage\(p\.key, primaryTasks\.length\)/);
});

test("成员页签按身份主键索引，同名同事不再合并", () => {
  // activeTab 是身份主键而非姓名
  assert.match(cockpitSource, /const tabOrder = useMemo\(\(\) => \["all", \.\.\.personLoads\.map\(\(p\) => p\.key\)\]/);
  assert.match(cockpitSource, /const isActive = activeTab === p\.key;/);
  assert.match(cockpitSource, /personLoads\.some\(\(p\) => p\.key === activeTab\)/);
  assert.match(cockpitSource, /const p = personLoads\.find\(\(x\) => x\.key === activeTab\);/);
  assert.doesNotMatch(cockpitSource, /const isActive = activeTab === p\.name;/);
  assert.doesNotMatch(cockpitSource, /personTasksMap\.get\(p\.name\)/);
  // resolveActivityPersonTab 返回主键
  const resolver = cockpitSource.match(/function resolveActivityPersonTab[\s\S]*?\n\}/);
  assert.ok(resolver, "未找到 resolveActivityPersonTab");
  assert.match(resolver[0], /return matchedById\.key;/);
  assert.doesNotMatch(resolver[0], /return matchedById\.name;/);
});

test("人员抽屉只列主责，但露出协助数量", () => {
  // 上一轮把协助移出抽屉后，标题若仍写「负责/协作任务」就是错的
  assert.doesNotMatch(cockpitSource, /t\("负责\/协作任务"\)/);
  assert.match(cockpitSource, /t\("主责任务"\)/);
  assert.match(cockpitSource, /collaboratingCount > 0 &&/);
  assert.match(cockpitSource, /另协助 \{count\} 个任务（在成员页签的「协助」分段中查看）/);
  assert.match(cockpitSource, /const selectedPersonCollaboratingCount = useMemo/);
});

test("移动端驾驶舱的到期计算与桌面同源，不再用 UTC 日期", () => {
  assert.doesNotMatch(mobileSource, /new Date\(new Date\(\)\.toISOString\(\)/);
  assert.match(mobileSource, /import \{ daysUntilDue \} from "\.\/lib\/taskDue";/);
  assert.match(mobileSource, /function daysLeft[\s\S]{0,120}?return daysUntilDue\(due\);/);
});

test("移动端人员筛选走成员目录与身份主键，不再裸用姓名", () => {
  // 历史实现直接聚合 primary_owner，会把「采购/研发团队/系统」当成人，且同名同事合并
  assert.match(mobileSource, /personLoads/);
  assert.match(mobileSource, /memberIdentityKey\(task\.primary_owner,\s*task\.primary_owner_user_id\)/);
  assert.match(mobileSource, /memberIdentityKey\(t\.primary_owner,\s*t\.primary_owner_user_id\) === person/);
  assert.doesNotMatch(mobileSource, /\(\(t\.primary_owner \|\| ""\)\.trim\(\) \|\| "未指派"\) === person/);
  // 「未指派」保留为独立筛选桶，不混进成员列表
  assert.match(mobileSource, /const UNASSIGNED_KEY = "__unassigned__";/);
});

test("移动端人员 chip 计数与点击后的列表同一口径", () => {
  // chip 若只数活跃任务，而列表含已完成（移动端有「已完成」页签），点进去条数会对不上
  const owners = mobileSource.match(/const owners = useMemo\(\(\) => \{[\s\S]*?\}, \[allTasks, personLoads\]\);/);
  assert.ok(owners, "未找到 owners");
  assert.match(owners[0], /if \(task\.archived\) continue;/);
  assert.doesNotMatch(owners[0], /status !== "completed"/);
  assert.match(owners[0], /counts\.get\(load\.key\)/);
});

test("移动端 summary 的活跃口径与桌面一致", () => {
  assert.match(hookSource, /const active = nonArchived\.filter\(\(t\) => t\.status !== "completed"\);/);
  assert.match(hookSource, /totalActive: active\.length,/);
  assert.match(hookSource, /rate: nonArchived\.length > 0/);
});
