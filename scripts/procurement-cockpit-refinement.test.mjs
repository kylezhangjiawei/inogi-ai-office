import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const cockpit = source("src/app/procurement/ProcurementCockpitPage.tsx");
const workspace = source("src/app/procurement/ProcMyWorkspacePage.tsx");
const systemTree = source("src/app/procurement/components/ProcurementSystemTree.tsx");
const taskCard = source("src/app/procurement/components/ProcurementTaskCard.tsx");
const taskDetail = source("src/app/procurement/components/TaskDetailDrawer.tsx");
const coreMaterials = source("src/app/procurement/components/CoreMaterialsPanorama.tsx");
const moduleDetail = source("src/app/procurement/components/ProcurementModuleDetail.tsx");

const surfaces = {
  "采购驾驶舱": cockpit,
  "采购个人工作台": workspace,
  "采购系统树": systemTree,
  "采购任务卡": taskCard,
  "采购任务详情": taskDetail,
  "核心配件全景": coreMaterials,
  "采购模块详情": moduleDetail,
};

test("驾驶舱页面组遵守 Horizon 精修约束", () => {
  for (const [name, page] of Object.entries(surfaces)) {
    assert.match(page, /#002fa7/, `${name}应继续使用 Klein Blue 单主强调色`);
    assert.match(page, /tabular-nums/, `${name}的业务数字应使用等宽数字`);
    assert.doesNotMatch(page, /(?:bg-|linear-|radial-)gradient/, `${name}不应新增渐变`);
    assert.doesNotMatch(page, /backdrop-blur/, `${name}不应新增大面积模糊`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name}不应修改字距`);
    assert.doesNotMatch(page, /\btransition-all\b/, `${name}不应使用全属性过渡`);
    assert.doesNotMatch(page, /hover:-translate|hover:translate/, `${name}不应使用悬停位移`);
  }
  assert.doesNotMatch(systemTree, /motion\/react|<motion\.|AnimatePresence|\banimate\(/);
});

test("采购驾驶舱首屏让统计、搜索与失败恢复都可直接操作", () => {
  assert.match(cockpit, /StatCell label=\{t\('进行中'\)\}[\s\S]*?Icon=\{Activity\}/);
  assert.match(cockpit, /StatCell label=\{t\('逾期'\)\}[\s\S]*?Icon=\{AlertTriangle\}/);
  assert.match(cockpit, /aria-label=\{t\('搜索采购任务'\)\}/);
  assert.match(cockpit, /aria-label=\{t\('清空搜索'\)\}/);
  assert.match(cockpit, /role="alert"[\s\S]*?采购任务加载失败[\s\S]*?refreshProcurement\(\)/);
  assert.match(cockpit, /正在加载采购任务[\s\S]*?min-h-52/);
  assert.match(cockpit, /没有符合条件的任务[\s\S]*?clearFilters/);
  assert.match(cockpit, /const buyerNameById = useMemo[\s\S]*?new Map/);
  assert.match(cockpit, /const visibleTasks = useMemo/);
  assert.match(cockpit, /getProcCoreMaterialConfig/);
  assert.match(cockpit, /setProcCoreMaterialConfig/);
});

test("个人工作台支持搜索、阶段分组和可恢复空态", () => {
  assert.match(workspace, /aria-label=\{t\("我的采购任务筛选"\)\}/);
  assert.match(workspace, /aria-label=\{t\("搜索我的采购任务"\)\}/);
  assert.match(workspace, /const stageGroups = useMemo/);
  assert.match(workspace, /StageIcon className="size-4/);
  assert.match(workspace, /role="alert"[\s\S]*?我的采购任务加载失败/);
  assert.match(workspace, /正在加载我的采购任务[\s\S]*?min-h-52/);
  assert.match(workspace, /当前没有分配给你的采购任务[\s\S]*?查看采购驾驶舱/);
  assert.match(workspace, /没有符合筛选条件的任务[\s\S]*?clearFilters/);
  assert.match(workspace, /<ProcurementTaskCard/);
  assert.match(workspace, /taskAction\.runNext/);
});

test("系统树与核心配件筛选避免重复昂贵查找并提供下一步", () => {
  assert.match(systemTree, /const visibleNodeMetrics = useMemo[\s\S]*?new Map/);
  assert.match(systemTree, /metrics=\{visibleNodeMetrics\.get\(node\.id\)!\}/);
  assert.match(systemTree, /const materialById = useMemo[\s\S]*?new Map/);
  assert.match(systemTree, /aria-label=\{t\("搜索采购分类与名称节点"\)\}/);
  assert.match(systemTree, /系统全景加载失败[\s\S]*?重新加载/);
  assert.match(systemTree, /没有匹配的节点[\s\S]*?setKeyword\(""\)/);
  assert.match(systemTree, /<AlertDialog open/);
  assert.match(systemTree, /listProcTaskTree\(/);
  assert.match(systemTree, /createProcTaskTreeNode\(/);
  assert.match(systemTree, /updateProcTaskTreeNode\(/);
  assert.match(systemTree, /deleteProcTaskTreeNode\(/);

  assert.match(coreMaterials, /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\)/);
  assert.match(coreMaterials, /selectedIdSet\.has\(material\.id\)/);
  assert.match(coreMaterials, /aria-label=\{t\("搜索核心配件库存"\)\}/);
  assert.match(coreMaterials, /aria-label=\{t\("搜索核心配件候选"\)\}/);
  assert.match(coreMaterials, /没有符合当前筛选条件的核心配件[\s\S]*?clearInventoryFilters/);
  assert.match(coreMaterials, /没有匹配的核心配件候选[\s\S]*?clearConfigFilters/);
  assert.match(coreMaterials, /onSave\(productId, selectedIds\)/);
});

test("共享任务卡和详情抽屉兼顾长文本、附件、报价失败与破坏性确认", () => {
  assert.match(taskCard, /aria-labelledby=\{titleId\}/);
  assert.match(taskCard, /line-clamp-2 text-balance text-\[15px\] font-bold/);
  assert.match(taskCard, /proc-horizon-task-summary line-clamp-2/);
  assert.match(taskCard, /aria-label=\{t\("预览附件：\{name\}"/);
  assert.match(taskCard, /<DropdownMenu>/);
  assert.match(taskCard, /<TaskCriticalMaterials task=\{task\} materials=\{materials\} compact/);

  assert.match(taskDetail, /<Sheet open/);
  assert.match(taskDetail, /SheetTitle className="[^"]*text-balance/);
  assert.match(taskDetail, /className="mt-1 text-pretty/);
  assert.match(taskDetail, /const \[quotesLoading, setQuotesLoading\]/);
  assert.match(taskDetail, /const \[quotesError, setQuotesError\]/);
  assert.match(taskDetail, /listQuotations\(\{ taskId: task\.id \}\)/);
  assert.match(taskDetail, /供应商报价加载失败[\s\S]*?重新加载报价/);
  assert.match(taskDetail, /暂无供应商报价[\s\S]*?下一步操作维护报价/);
  assert.match(taskDetail, /<AlertDialog open=\{rejecting\}/);
  assert.match(taskDetail, /<AlertDialog open=\{Boolean\(unlinking\)\}/);
  assert.match(taskDetail, /<AlertDialog open=\{resetting\}/);
  assert.match(taskDetail, /Math\.min\(100, Math\.max\(0/);
});

test("模块详情保留库存、任务下钻和编辑契约", () => {
  assert.match(moduleDetail, /getTplusInventoryDetail\(inventoryCode, controller\.signal\)/);
  assert.match(moduleDetail, /controller\.abort\(\)/);
  assert.match(moduleDetail, /仓库库存加载失败[\s\S]*?retryInventory/);
  assert.match(moduleDetail, /下一步：前往物料库关联 T\+ 存货编码/);
  assert.match(moduleDetail, /scope="col"/);
  assert.match(moduleDetail, /<TaskDetailDrawer task=\{openTask\}/);
  assert.match(moduleDetail, /<EditTaskModal task=\{editTask\}/);
  assert.match(moduleDetail, /taskAction\.remove\(task\)/);
});
