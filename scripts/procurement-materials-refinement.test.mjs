import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const workbench = source("src/app/procurement/MaterialWorkbenchPage.tsx");
const table = source("src/app/procurement/components/MaterialTable.tsx");
const drawer = source("src/app/procurement/components/MaterialDetailDrawer.tsx");
const critical = source("src/app/procurement/components/TaskCriticalMaterials.tsx");
const common = source("src/app/procurement/components/common.tsx");
const sources = { workbench, table, drawer, critical, common };

test("物料页面组保持 Horizon 单强调视觉并移除装饰性样式", () => {
  for (const [name, page] of Object.entries(sources)) {
    assert.doesNotMatch(page, /\b(?:indigo|violet|purple|fuchsia|pink|blue|cyan|teal|orange|sky|red)-/, `${name} 不应保留旧多色强调`);
    assert.doesNotMatch(page, /\bdark:/, `${name} 不应保留暗色分支`);
    assert.doesNotMatch(page, /(?:bg-|linear-|radial-)gradient/, `${name} 不应使用渐变`);
    assert.doesNotMatch(page, /\b(?:backdrop-)?blur(?:-|\b)/, `${name} 不应使用模糊效果`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name} 不应修改字距`);
    assert.doesNotMatch(page, /\btransition-all\b/, `${name} 不应使用全属性过渡`);
    assert.doesNotMatch(page, /hover:-?translate/, `${name} 不应使用悬停位移`);
  }

  assert.match(workbench, /className="proc-horizon/);
  assert.match(table, /data-\[state=on\]:bg-accent data-\[state=on\]:text-primary/);
  assert.match(drawer, /proc-horizon-drawer/);
  assert.match(critical, /horizon-theme horizon-portal proc-horizon-overlay/);
});

test("物料表建立编码、库存、可用量与供应风险的高密度列层级", () => {
  for (const heading of ["物料编码", "物料名称", "规格型号", "现存量", "可用量", "安全库存", "采购在途", "供应风险", "审核状态"]) {
    assert.match(table, new RegExp(`t\\(\\"${heading}\\"\\)`), `缺少 ${heading} 列`);
  }

  assert.match(table, /data-supply-risk=\{risk\.tone\}/);
  assert.match(table, /RiskIcon[\s\S]*?t\(risk\.label\)/);
  assert.match(table, /ReviewPill status=\{material\.reviewStatus\}/);
  assert.match(table, /tabular-nums/);
  assert.match(table, /min-w-\[1480px\]/);
  assert.match(table, /role="region"/);
  assert.match(table, /tabIndex=\{0\}/);
  assert.match(table, /sticky right-0/);
  assert.match(table, /border-l border-slate-100 bg-white/);
  assert.match(table, /aria-label=\{t\("查看物料详情：\{name\}"/);
  assert.doesNotMatch(table, /<tr key=\{material\.id\}[^>]*onClick=/);
});

test("搜索筛选提供显式标签、清除状态与延迟计算反馈", () => {
  assert.match(table, /useDeferredValue\(normalizedKeyword\)/);
  assert.match(table, /htmlFor="material-search-filter"/);
  assert.match(table, /aria-labelledby="material-product-line-label"/);
  assert.match(table, /aria-labelledby="material-review-status-label"/);
  assert.match(table, /htmlFor="material-stock-filter"/);
  assert.match(table, /aria-label=\{t\("已启用筛选"\)\}/);
  assert.match(table, /activeFilterLabels\.map/);
  assert.match(table, /clearFilters/);
  assert.match(table, /aria-busy=\{filtersPending\}/);
  assert.match(table, /没有符合当前筛选条件的物料/);
  assert.match(table, /清除筛选并查看全部/);
});

test("任务聚合只建立一次稳定索引并保留旧任务名称回落口径", () => {
  assert.match(table, /function buildMaterialAggregateIndex\(materials: Material\[\], tasks: ProcurementTask\[\]\)/);
  assert.match(table, /const materialById = new Map/);
  assert.match(table, /const materialsByName = new Map/);
  assert.match(table, /for \(const task of tasks\)/);
  assert.match(table, /task\.materialId[\s\S]*?materialsByName\.get\(task\.materialName\)/);
  assert.match(table, /useMemo\([\s\S]*?buildMaterialAggregateIndex\(materials, tasks\)/);
  assert.doesNotMatch(table, /const materialRow[\s\S]{0,240}materialAggregates\(/);

  assert.match(workbench, /countProcurementMaterialShortages\(materials, active\)/);
});

test("详情抽屉展示物料摘要、库存同步、分仓明细和关联任务层级", () => {
  assert.match(drawer, /materialSupplyRisk\(material, inTransit\)/);
  assert.match(drawer, /inventorySyncedAt/);
  assert.match(drawer, /t\("物料摘要"\)/);
  assert.match(drawer, /t\("库存与供应"\)/);
  assert.match(drawer, /t\("现存量"\)/);
  assert.match(drawer, /t\("可用量"\)/);
  assert.match(drawer, /t\("安全库存"\)/);
  assert.match(drawer, /t\("分仓库存明细"\)/);
  assert.match(drawer, /tasks\.filter\(\(t\) => isTaskOfMaterial\(t, material\)\)/);
  assert.match(drawer, /materialAggregates\(tasks, material\)/);
  assert.match(drawer, /<StatusPill status=\{task\.status\}/);
  assert.match(drawer, /onClick=\{\(\) => onOpenTask\(task\.id\)\}/);
  assert.match(drawer, /material\.reviewNote/);
  assert.match(drawer, /t\(material\.reviewStatus === "rejected" \? "驳回原因" : "审核意见"\)/);
  assert.match(drawer, /text=\{material\.reviewNote\}/);
  assert.match(common, /<h1 className=\{cn\("text-balance text-xl font-bold/);
});

test("物料图片预览和审核错误在操作位置可访问", () => {
  assert.match(drawer, /aria-label=\{t\("预览\{name\}的商品图片"/);
  assert.match(drawer, /alt=\{t\("\{name\}商品图片"/);
  assert.match(drawer, /<ImageLightbox[\s\S]*?alt=\{t\("\{name\}商品图片预览"/);
  assert.match(common, /alt = translate\("商品图片预览"\)/);
  assert.match(common, /<DialogTitle className="sr-only">\{alt\}/);
  assert.match(common, /<MobileZoomableImage[\s\S]*?alt=\{alt\}/);
  assert.match(common, /role="img" aria-label=\{label\}/);

  assert.match(drawer, /reviewMaterial\(material\.id, reviewStatus, reviewNote\.trim\(\) \|\| undefined\)/);
  assert.match(drawer, /setReviewError\(message\)/);
  assert.match(drawer, /<p role="alert"/);
  assert.match(drawer, /htmlFor="material-review-note"/);
});

test("加载、错误和空数据状态均提供明确恢复动作", () => {
  assert.match(workbench, /function MaterialWorkbenchSkeleton/);
  assert.match(workbench, /role="status"/);
  assert.match(workbench, /role="alert"/);
  assert.match(workbench, /refreshProcurement\(\)/);
  assert.match(workbench, /t\("重新加载"\)/);
  assert.match(workbench, /t\("物料库暂无数据"\)/);
  assert.match(workbench, /setCreateOpen\(true\)/);
  assert.match(workbench, /setImportOpen\(true\)/);
  assert.match(workbench, /t\("刷新数据"\)/);
});

test("重点物料编辑器保留库存业务契约并优化长候选筛选", () => {
  assert.match(critical, /useDeferredValue\(normalizedSearch\)/);
  assert.match(critical, /htmlFor=\{searchId\}/);
  assert.match(critical, /aria-busy=\{searchPending\}/);
  assert.match(critical, /清空重点物料搜索/);
  assert.match(critical, /没有匹配的物料，可清除搜索查看全部候选/);
  assert.match(critical, /data-stock-state=\{state\.tone\}/);
  assert.match(critical, /StateIcon[\s\S]*?t\(state\.label\)/);
  assert.match(critical, /MAX_TASK_CRITICAL_MATERIALS = 4/);
  assert.match(critical, /hasSyncedTplusInventory/);
  assert.match(critical, /setProcTaskCriticalMaterials\(task\.id, items\)/);
  assert.match(critical, /await refreshProcurement\(\)/);
  assert.match(critical, /role="alert"/);
});
