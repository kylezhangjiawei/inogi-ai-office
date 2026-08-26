import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const schema = source("apps/api/prisma/schema.prisma");
const service = source("apps/api/src/modules/procurement/procurement.service.ts");
const dto = source("apps/api/src/modules/procurement/dto/procurement.dto.ts");
const controller = source("apps/api/src/modules/procurement/procurement.controller.ts");
const api = source("src/app/lib/procurementApi.ts");
const cockpit = source("src/app/procurement/ProcurementCockpitPage.tsx");
const card = source("src/app/procurement/components/ProcurementTaskCard.tsx");
const corePanorama = source("src/app/procurement/components/CoreMaterialsPanorama.tsx");
const systemTree = source("src/app/procurement/components/ProcurementSystemTree.tsx");
const taskInventory = source("src/app/procurement/components/TaskCriticalMaterials.tsx");
const taskDetail = source("src/app/procurement/components/TaskDetailDrawer.tsx");
const workspace = source("src/app/procurement/ProcMyWorkspacePage.tsx");
const priceHistory = source("src/app/procurement/components/PriceHistoryModal.tsx");
const peopleManagement = source("src/app/procurement/ProcPeopleManagementPage.tsx");
const quoteBook = source("src/app/procurement/QuoteBookPage.tsx");
const materialTable = source("src/app/procurement/components/MaterialTable.tsx");


test("重点物料配置归属采购任务，而不是全局物料主数据", () => {
  const materialModel = schema.match(/model ProcMaterial \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(materialModel, /cockpitVisible|cockpitOrder/);
  assert.match(schema, /model ProcTaskCriticalMaterial \{/);
  assert.match(schema, /task\s+ProcTask\s+@relation\(fields: \[taskId\]/);
  assert.match(schema, /material\s+ProcMaterial\s+@relation\(fields: \[materialId\]/);
  assert.match(schema, /@@unique\(\[taskId, materialId\]\)/);
  assert.match(dto, /class SetProcTaskCriticalMaterialsDto/);
  assert.match(dto, /@ArrayMaxSize\(4\)/);
  assert.match(dto, /@Max\(36500\)/);
  assert.match(controller, /tasks\/:id\/critical-materials/);
  assert.match(service, /setTaskCriticalMaterials/);
  assert.match(api, /criticalMaterials: ProcTaskCriticalMaterialSetting\[\]/);
  assert.match(service, /availableQty/);
  assert.match(service, /inTransitQty/);
  assert.match(service, /inventorySyncedAt/);
  assert.match(api, /availableQty: number/);
  assert.match(api, /inTransitQty: number/);
});

test("重点库存未配置时隐藏，配置入口位于任务省略号菜单", () => {
  assert.doesNotMatch(cockpit, /CriticalMaterialInventory|重点物料库存区域/);
  assert.match(card, /TaskCriticalMaterialsEditor/);
  assert.match(card, /materials=\{materials\}/);
  assert.match(card, /<DropdownMenuItem onSelect=\{openEditor\}>[\s\S]*?库存设置[\s\S]*?<\/DropdownMenuItem>/);
  assert.match(taskInventory, /if \(configured\.length === 0\) return null/);
  assert.match(taskInventory, /MAX_TASK_CRITICAL_MATERIALS\s*=\s*4/);
  assert.match(taskInventory, /setProcTaskCriticalMaterials/);
  assert.match(taskInventory, /可用/);
  assert.match(taskInventory, /安全/);
  assert.match(taskInventory, /在途/);
  assert.match(taskInventory, /采购周期/);
  assert.match(taskInventory, /数据待同步|未关联 T\+/);
});

test("重点库存候选只允许已关联 T+ 且完成库存同步的物料，零库存仍可选择", () => {
  assert.match(taskInventory, /function hasSyncedTplusInventory/);
  assert.match(taskInventory, /material\.tpInventoryCode\?\.trim\(\) && material\.inventorySyncedAt/);
  assert.match(taskInventory, /filter\(hasSyncedTplusInventory\)/);
  assert.match(taskInventory, /if \(!hasSyncedTplusInventory\(material\)\) continue/);
  assert.match(taskInventory, /库存为 0 的缺货物料仍可选择/);
  assert.doesNotMatch(taskInventory, /availableQty\s*>\s*0/);
  assert.match(service, /balances:[\s\S]*?where: \{ syncedAt: \{ not: null \} \}/);
  assert.match(service, /!material\.tpInventoryCode\?\.trim\(\) \|\| material\.balances\.length === 0/);
  assert.match(service, /重点物料必须已关联 T\+ 并完成库存同步/);
});

test("已配置的重点库存显示在付款到货信息条下方", () => {
  const paymentIndex = card.indexOf('t("未付款")');
  const inventoryIndex = card.indexOf("<TaskCriticalMaterials task={task} materials={materials} />");
  assert.ok(paymentIndex >= 0, "任务卡应包含付款到货信息条");
  assert.ok(inventoryIndex > paymentIndex, "重点库存应位于付款到货信息条下方");
  assert.equal(inventoryIndex, card.lastIndexOf("<TaskCriticalMaterials task={task} materials={materials} />"));
});

test("采购任务详情复用同一份重点库存数据和过滤口径", () => {
  const basicInfoIndex = taskDetail.indexOf("{/* 基本信息 */}");
  const inventoryIndex = taskDetail.indexOf("<TaskCriticalMaterials task={task} materials={materials} />");
  const attachmentIndex = taskDetail.indexOf("{/* 研发转采购时携带的图纸/说明");
  assert.match(taskDetail, /useProcurementData\(\)/);
  assert.ok(inventoryIndex > basicInfoIndex, "重点库存应显示在详情基本信息之后");
  assert.ok(inventoryIndex < attachmentIndex, "重点库存应位于需求附件之前");
});

test("核心长周期配件按产品从子系统叶子物料配置，不再展示分类库存合计", () => {
  assert.match(dto, /class SetProcCoreMaterialsDto/);
  assert.match(dto, /@ArrayMaxSize\(30\)/);
  assert.match(controller, /task-tree\/core-materials/);
  assert.match(service, /procurement:core-materials:v1:/);
  assert.match(service, /parentId: \{ not: null \}/);
  assert.match(service, /核心配件必须来自当前产品的子系统叶子物料/);
  assert.match(service, /核心配件必须已关联 T\+ 并完成库存同步/);
  assert.match(service, /children: \{ none: \{\} \}/);
  assert.match(api, /interface ProcCoreMaterialConfig/);
  assert.match(systemTree, /<CoreMaterialsPanorama/);
  assert.match(systemTree, /核心配件按 T\+ 物料去重，仅展示具体数量，不汇总分类节点库存/);
  assert.match(corePanorama, /collectLeafMaterialPaths/);
  assert.match(corePanorama, /node\.children\.length === 0 && node\.materialId/);
  assert.match(corePanorama, /material\?\.tpInventoryCode\?\.trim\(\) \|\| !material\.inventorySyncedAt/);
  assert.match(corePanorama, /可用库存/);
  assert.match(corePanorama, /现存数量/);
  assert.match(corePanorama, /在途数量/);
  assert.match(corePanorama, /安全库存/);
  assert.doesNotMatch(corePanorama, /stockQty\s*\+=/);
});

test("核心配件未配置时直接用真实候选库存展示建议预览", () => {
  assert.match(corePanorama, /const suggestions = useMemo/);
  assert.match(corePanorama, /系统已经找到 \{count\} 个有真实 T\+ 库存的叶子物料/);
  assert.match(corePanorama, /建议关注项预览/);
  assert.match(corePanorama, /确认建议项/);
  assert.match(corePanorama, /<CoreInventoryTable items=\{pagedInventoryItems\} preview \/>/);
  assert.match(corePanorama, /这不是自动保存结果/);
});

test("核心配件列表和配置弹窗提供筛选、分页与当前页全选", () => {
  assert.match(corePanorama, /const INVENTORY_PAGE_SIZE = 8/);
  assert.match(corePanorama, /const CONFIG_PAGE_SIZE = 10/);
  assert.match(corePanorama, /function InventoryFilterBar/);
  assert.match(corePanorama, /库存状态筛选/);
  assert.match(corePanorama, /全部子系统/);
  assert.match(corePanorama, /function InventoryPagination/);
  assert.match(corePanorama, /全选当前页/);
  assert.match(corePanorama, /toggleCurrentPage/);
  assert.match(corePanorama, /清空已选/);
});

test("采购驾驶舱提供核心配件数量和异常摘要入口", () => {
  assert.match(cockpit, /getProcCoreMaterialConfig/);
  assert.match(cockpit, /setProcCoreMaterialConfig/);
  assert.match(cockpit, /const coreInventorySummary = useMemo/);
  assert.match(cockpit, /next\.set\("core", "1"\)/);
  assert.match(cockpit, /核心配件/);
  assert.match(cockpit, /异常/);
});

test("采购驾驶舱和个人工作台共用研发式任务卡", () => {
  assert.match(cockpit, /<ProcurementTaskCard/);
  assert.match(workspace, /<ProcurementTaskCard/);
  assert.match(cockpit, /materials=\{materials\}/);
  assert.match(workspace, /materials=\{materials\}/);
  assert.doesNotMatch(card, /role="button"/);
  assert.match(card, /aria-label=\{t\("查看任务"\)\}/);
  assert.match(card, /rounded-2xl border border-slate-200\/80 bg-white/);
  assert.match(card, /hover:-translate-y-0\.5/);
  assert.match(card, /line-clamp-2 text-\[15px\] font-bold/);
  assert.match(card, /DropdownMenu/);
  assert.match(card, /tabular-nums/);
  assert.doesNotMatch(card, /material-card relative w-full overflow-hidden p-4/);
  assert.match(workspace, /grid-cols-1[\s\S]*md:grid-cols-2[\s\S]*xl:grid-cols-3/);
});

test("采购驾驶舱人员泳道只按采购部门负责人账号统计和筛选", () => {
  assert.match(cockpit, /useBuyerDirectory\(\{ departmentOnly: true \}\)/);
  assert.match(cockpit, /task\.buyerUserId === buyerUserId/);
  assert.match(cockpit, /countsByUserId/);
  assert.match(cockpit, /采购负责人/);
  assert.doesNotMatch(cockpit, /t\.buyer === person \|\| t\.rdContact === person/);
  assert.doesNotMatch(cockpit, /研发对接人 \+ 需求提出人/);
});

test("采购模块的高频键盘交互统一使用项目 Radix 封装", () => {
  assert.match(cockpit, /components\/ui\/tabs/);
  assert.match(cockpit, /<Tabs value=\{line\}/);
  assert.match(cockpit, /components\/ui\/toggle-group/);
  assert.match(cockpit, /aria-label=\{t\("按采购负责人筛选"\)\}/);
  assert.doesNotMatch(cockpit, /role="tablist"|role="tab"/);

  assert.match(systemTree, /components\/ui\/tabs/);
  assert.match(systemTree, /<Tabs value=\{coreMode \? "core" : "panorama"\}/);
  assert.doesNotMatch(systemTree, /role="tablist"|role="tab"/);

  assert.match(corePanorama, /components\/ui\/select/);
  assert.doesNotMatch(corePanorama, /components\/ui\/native-select/);
  assert.match(corePanorama, /components\/ui\/toggle-group/);
  assert.match(priceHistory, /components\/ui\/toggle-group/);
  assert.match(priceHistory, /components\/ui\/toggle/);
  assert.match(taskDetail, /components\/ui\/collapsible/);
  assert.match(peopleManagement, /components\/ui\/collapsible/);
  assert.match(quoteBook, /components\/ui\/pagination/);
  assert.match(materialTable, /components\/ui\/pagination/);
});

// ── 写操作后的刷新必须拿到写入之后的数据 ──────────────────────────────────────
//
// 曾经 refreshProcurement() 直接 `return inflight` 复用正在飞的请求。调用方是在自己写入
// 落库之后才调进来的，而那个请求可能早于写入就发出了，于是界面拿到旧快照、看起来「保存
// 没生效」。用户反复点，每次都真的推进一个节点，最后任务窜到终态。

const procData = source("src/app/procurement/data.ts");

test("写后刷新不复用可能早于本次写入发出的请求", () => {
  // 复用正在飞的请求（老写法）必须消失
  assert.doesNotMatch(
    procData,
    /if \(!inflight\) \{\s*inflight = load\(\)[\s\S]{0,80}\}\s*return inflight;\s*\}/,
    "不能再无条件复用 inflight",
  );
  // 有请求在飞时要排一次后续刷新
  assert.match(procData, /if \(!queued\) \{/);
  assert.match(procData, /queued = inflight/);
  // 后续刷新发起前先清空 queued，保证之后进来的调用另排一次
  assert.match(procData, /queued = null;\s*\n\s*inflight = load\(\)/);
});

test("刷新失败不会把后续刷新一起卡死", () => {
  // 排队链上必须吞掉前一次的异常，否则一次网络失败会让后面所有刷新永远 pending
  assert.match(procData, /inflight\s*\n?\s*\.catch\(\(\) => undefined\)/);
});

test("列表缩略图用 OSS 缩放地址，不下载原图", () => {
  // 后端给图片附件额外下发缩放地址
  assert.match(service, /image\/resize,m_lfit,w_480/);
  assert.match(api, /thumbUrl\?: string;/);
  // 关键是卡片上那张 64px 缩略图真的用了它。此前这里断言的是 common.tsx 里的一个
  // 映射函数，而那个函数早已没有任何调用者——测试一直在"通过"，页面却仍在拉原图。
  const card = source("src/app/procurement/components/ProcurementTaskCard.tsx");
  assert.match(card, /src=\{attachment\.thumbUrl \?\? attachment\.fileUrl\}/);
});

// ── 过期页面的重复推进必须被服务端拒绝 ────────────────────────────────────────
//
// 状态转移表和乐观锁只能挡住「非法跳步」和「并发双写」，挡不住一串各自合法的单步流转：
// 界面没刷新时用户每点一次都真的往前走一格，几下就窜到已完成。客户端把渲染时看到的
// 状态一并发上来，服务端对不上就拒绝。

const actions = source("src/app/procurement/components/taskActions.tsx");

test("流转请求携带界面当时的状态，服务端不一致即拒绝", () => {
  // from_status 必填。此前是可选的「老客户端兼容」，但可选就等于这道防护形同虚设：
  // 不带它的调用方可以连推数级直达终态（实测 询价中→已定价→已下单→已完成 三连全部放行）。
  assert.match(dto, /from_status!: string;/);
  assert.doesNotMatch(dto, /from_status\?: string;/);
  assert.match(service, /dto\.from_status !== task\.status/);
  assert.doesNotMatch(service, /dto\.from_status && dto\.from_status !== task\.status/);
  assert.match(service, /页面数据已过期，请刷新后再操作/);
  assert.match(api, /from_status: fromStatus/);
  // 所有流转调用点都要把 task.status 传上去，漏一个就等于留了个后门。
  // 实参里含 note.trim() 这类嵌套括号，按出现位置取窗口判断而不是匹配到第一个右括号。
  const marker = "transitionProcTask(";
  let found = 0;
  for (let at = actions.indexOf(marker); at !== -1; at = actions.indexOf(marker, at + 1)) {
    found += 1;
    const call = actions.slice(at, at + 220);
    assert.match(call, /task\.status/, `流转调用缺少来源状态：${call.split("\n")[0]}`);
  }
  assert.ok(found > 0, "应存在流转调用");
});

test("保存只等写入，刷新不阻塞界面，但界面要立刻反映新状态", () => {
  // 全量刷新仍放后台：它要重拉全部任务和物料，数据量一大弹窗要禁用好几秒
  assert.match(actions, /void refreshProcurement\(\);/);
  assert.doesNotMatch(actions, /await fn\(\);\s*\n\s*await refreshProcurement\(\);/);
  // 但只做后台刷新是不够的：那几秒里详情抽屉和「下一步」按钮还停在旧状态，
  // 用户看到的是「点了保存没反应」，于是再点一次——而按钮的动作由任务状态推导，
  // 刷新一旦在两次点击之间落地，第二次点的已经是下一个动作，任务就一节节窜到「已完成」。
  // 写接口返回的就是更新后的任务，必须立刻替换 store 里的那一条。
  assert.match(actions, /applyProcTaskUpdate\(result\)/);
  assert.match(source("src/app/procurement/data.ts"), /export function applyProcTaskUpdate\(/);
});

test("报价库一级商品行的移出按钮常显，无报价时置灰而不是消失", () => {
  const quoteBook = source("src/app/procurement/QuoteBookPage.tsx");
  // 不再按报价数决定渲染与否
  assert.doesNotMatch(quoteBook, /canWrite && row\.quotes\.length > 0 &&/);
  // 改为常显 + 无报价置灰（后端只删厂家报价，此时点下去是空操作）
  assert.match(quoteBook, /disabled=\{row\.quotes\.length === 0\}/);
  assert.match(quoteBook, /该商品还没有厂家报价，无需移出/);
});

test("物料关联任务按 materialId 匹配，同名不同 ID 的物料不互相串数据", () => {
  const procData = source("src/app/procurement/data.ts");
  const drawer = source("src/app/procurement/components/MaterialDetailDrawer.tsx");
  const table = source("src/app/procurement/components/MaterialTable.tsx");
  // 物料主档存在同名不同 ID 的记录（T+ 同步而来），只按名称匹配会把它们的任务混在一起
  assert.match(procData, /export function isTaskOfMaterial\(/);
  assert.match(procData, /task\.materialId \? task\.materialId === material\.id : task\.materialName === material\.name/);
  // materialAggregates 收物料对象而不是名字，调用方无法只传名称
  assert.doesNotMatch(procData, /materialName: string,\n\): \{ inTransit/);
  assert.match(procData, /material: Pick<Material, "id" \| "name">,\n\): \{ inTransit/);
  // 两个调用点都改为传物料对象
  assert.match(drawer, /materialAggregates\(tasks, material\)/);
  assert.match(table, /materialAggregates\(tasks, m\)/);
  // 抽屉的关联任务列表走同一条判定，不再自己比名字
  assert.match(drawer, /tasks\.filter\(\(t\) => isTaskOfMaterial\(t, material\)\)/);
  assert.doesNotMatch(drawer, /t\.materialName === material\.name/);
});
