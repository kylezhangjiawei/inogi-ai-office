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
const detailFrame = source("src/app/procurement/components/ProcurementDetailFrame.tsx");
const moduleDetail = source("src/app/procurement/components/ProcurementModuleDetail.tsx");

const surfaces = {
  "采购驾驶舱": cockpit,
  "采购个人工作台": [workspace, source("src/app/procurement/components/ProcWorkspaceTaskList.tsx"), source("src/app/procurement/components/ProcWorkspaceTaskPanel.tsx"), source("src/app/procurement/components/ProcWorkspaceArrivals.tsx")].join("\n"),
  "采购系统树": systemTree,
  "采购任务卡": taskCard,
  "采购任务详情": taskDetail,
  "采购模块详情": moduleDetail,
};

test("驾驶舱页面组遵守 Horizon 精修约束", () => {
  for (const [name, page] of Object.entries(surfaces)) {
    assert.match(page, /(?:text|bg|border(?:-t)?|ring)-primary/, `${name}应继续使用共享品牌强调色`);
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
  assert.match(cockpit, /StatCell[^\n]*value=\{counts\.inprogress\}[^\n]*Icon=\{Activity\}[^\n]*toggleStat\("inprogress"\)/);
  assert.match(cockpit, /StatCell[^\n]*value=\{counts\.overdue\}[^\n]*Icon=\{AlertTriangle\}[^\n]*toggleStat\("overdue"\)/);
  assert.match(cockpit, /aria-label=\{t\('搜索采购任务'\)\}/);
  assert.match(cockpit, /aria-label=\{t\('清空搜索'\)\}/);
  assert.match(cockpit, /role="alert"[\s\S]*?采购任务加载失败[\s\S]*?refreshProcurement\(\)/);
  assert.match(cockpit, /正在加载采购任务[\s\S]*?min-h-52/);
  assert.match(cockpit, /没有符合条件的任务[\s\S]*?clearFilters/);
  assert.match(cockpit, /procurementTasksForBuyer\(treeScopedTasks, buyerUserId, uniqueBuyerIdsByName\)/);
  assert.match(cockpit, /const visibleTasks = useMemo/);
  assert.doesNotMatch(cockpit, /getProcCoreMaterialConfig/);
  assert.doesNotMatch(cockpit, /setProcCoreMaterialConfig/);
});

test("个人工作台支持搜索、业务筛选、任务列表和可恢复空态", () => {
  assert.match(workspace, /aria-label=\{t\("我的采购任务筛选"\)\}/);
  assert.match(workspace, /aria-label=\{t\("搜索我的采购任务"\)\}/);
  assert.match(workspace, /WorkspaceSelect label=\{t\("所属业务"\)\}/);
  assert.match(workspace, /WorkspaceSelect label=\{t\("状态"\)\}/);
  assert.match(workspace, /role="alert"[\s\S]*?我的采购任务加载失败/);
  assert.match(workspace, /正在加载我的采购任务[\s\S]*?min-h-52/);
  assert.match(workspace, /当前没有分配给你的采购任务[\s\S]*?重新加载/);
  assert.match(workspace, /没有符合筛选条件的任务[\s\S]*?clearFilters/);
  assert.match(workspace, /<ProcWorkspaceTaskList/);
  assert.match(workspace, /taskAction\.runNext/);
});

test("系统树筛选避免重复昂贵查找并提供下一步", () => {
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

});

test("共享任务卡和详情抽屉兼顾长文本、附件、报价失败与破坏性确认", () => {
  assert.match(taskCard, /aria-labelledby=\{titleId\}/);
  assert.match(taskCard, /line-clamp-2 text-balance text-\[15px\] font-bold/);
  assert.match(taskCard, /proc-horizon-task-summary line-clamp-2/);
  assert.match(taskCard, /aria-label=\{t\("预览附件：\{name\}"/);
  assert.match(taskCard, /<DropdownMenu>/);
  assert.match(taskCard, /<TaskCriticalMaterials task=\{task\} materials=\{materials\} compact/);

  assert.match(taskDetail, /<ProcurementDetailFrame page=\{page\}/);
  assert.match(detailFrame, /<Sheet open/);
  assert.match(taskDetail, /SheetTitle className="[^"]*text-balance/);
  assert.match(taskDetail, /className="mt-1 text-pretty/);
  assert.match(taskDetail, /const \[quotesLoading, setQuotesLoading\]/);
  assert.match(taskDetail, /const \[quotesError, setQuotesError\]/);
  assert.match(taskDetail, /listQuotations\(\{ taskId: task\.id \}\)/);
  assert.match(taskDetail, /供应商报价加载失败[\s\S]*?重新加载报价/);
  assert.match(taskDetail, /task\.method === "inquiry" && quotes\.length === 0/);
  assert.match(taskDetail, /暂无供应商报价[\s\S]*?报价记录会在这里展示价格、交期与确认状态/);
  assert.match(taskDetail, /<AlertDialog open=\{rejecting\}/);
  assert.match(taskDetail, /<AlertDialog open=\{Boolean\(unlinking\)\}/);
  assert.match(taskDetail, /<AlertDialog open=\{resetting\}/);
  assert.match(taskDetail, /Math\.min\(100, Math\.max\(0/);
});

test("模块详情保留库存查询，任务仅提供只读抽屉", () => {
  assert.match(moduleDetail, /getTplusInventoryDetail\(inventoryCode, controller\.signal\)/);
  assert.match(moduleDetail, /controller\.abort\(\)/);
  assert.match(moduleDetail, /仓库库存加载失败[\s\S]*?retryInventory/);
  assert.match(moduleDetail, /下一步：前往物料库关联 T\+ 存货编码/);
  assert.match(moduleDetail, /scope="col"/);
  assert.match(moduleDetail, /<ProcurementTaskSummaryDrawer task=\{openTask\} materials=\{materials\} readOnly/);
  assert.doesNotMatch(moduleDetail, /EditTaskModal|NewRequirementModal|taskAction\.remove/);
  assert.match(moduleDetail, /日常备货批量物料/);
  assert.match(moduleDetail, /<StockPlanPanel[^>]+productId=\{node.productId\}[^>]+treeNodeId=\{node.id\}/);
});
