import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("采购瀑布流在列表滚动容器内追加，切表格或离开后停止观察", () => {
  const text = source("src/app/procurement/ProcurementCockpitPage.tsx");
  const ast = ts.createSourceFile("cockpit.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  let dependencies;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
      && node.arguments[0]?.getText(ast).includes("new IntersectionObserver")) {
      effect = node.arguments[0];
      dependencies = node.arguments[1];
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect);
  assert.ok(dependencies?.elements.some((node) => node.getText(ast) === "taskDisplay"), "切换显示模式必须清理旧观察器");
  const code = ts.transpileModule(`return ${effect.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let count = 20;
  const created = [];
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; created.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  }
  const mount = (cockpitTab, view, taskStreamElement, sentinelElement, taskDisplay = "masonry") => new Function("cockpitTab", "view", "taskStreamElement", "sentinelElement", "taskDisplay", "visibleCount", "filtered", "WATERFALL_PAGE_SIZE", "setVisibleCount", "IntersectionObserver", code)(
    cockpitTab, view, taskStreamElement, sentinelElement, taskDisplay, count, Array.from({ length: 45 }), 20, (update) => { count = update(count); }, Observer,
  )();
  const firstContainer = {};
  const first = {};
  assert.equal(mount("tasks", "tasks", null, first), undefined);
  assert.equal(created.length, 0, "滚动容器尚未挂载时不应建立观察器");
  assert.equal(mount("tasks", "tasks", firstContainer, first, "table"), undefined);
  assert.equal(created.length, 0, "表格采用页码分页，不创建滚动追加观察器");
  const cleanup = mount("tasks", "tasks", firstContainer, first);
  assert.equal(created[0].element, first);
  assert.equal(created[0].options.root, firstContainer, "分页应观察列表滚动容器的可见区域");
  assert.equal(created[0].options.rootMargin, "200px");
  created[0].callback([{ isIntersecting: false }]);
  assert.equal(count, 20);
  created[0].callback([{ isIntersecting: true }]);
  assert.equal(count, 40);
  cleanup();
  assert.equal(mount("tasks", "tasks", firstContainer, first, "table"), undefined);
  created[0].callback([{ isIntersecting: true }]);
  assert.equal(count, 40);
  assert.equal(created[0].disconnected, true);
  assert.equal(mount("stock-plans", "tasks", firstContainer, first), undefined);
  assert.equal(mount("samples", "tasks", firstContainer, first), undefined);
  assert.equal(mount("tasks", "systems", firstContainer, first), undefined);
  assert.equal(created.length, 1, "离开采购任务列表不应建立新的观察器");
  const secondContainer = {};
  const second = {};
  const secondCleanup = mount("tasks", "tasks", secondContainer, second);
  assert.equal(created[1].element, second);
  assert.equal(created[1].options.root, secondContainer, "返回采购任务后应绑定新挂载的滚动容器");
  created[1].callback([{ isIntersecting: true }]);
  assert.equal(count, 45, "最后一批不能超出筛选后任务数量");
  secondCleanup();
  assert.equal(mount("tasks", "tasks", secondContainer, second), undefined);
  assert.equal(created.length, 2, "全部加载后不应继续建立观察器");
});

const schema = source("apps/api/prisma/schema.prisma");
const service = source("apps/api/src/modules/procurement/procurement.service.ts");
const dto = source("apps/api/src/modules/procurement/dto/procurement.dto.ts");
const controller = source("apps/api/src/modules/procurement/procurement.controller.ts");
const api = source("src/app/lib/procurementApi.ts");
const cockpit = source("src/app/procurement/ProcurementCockpitPage.tsx");
const card = source("src/app/procurement/components/ProcurementTaskCard.tsx");
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
  const inventoryIndex = card.indexOf("<TaskCriticalMaterials task={task} materials={materials} compact />");
  assert.ok(paymentIndex >= 0, "任务卡应包含付款到货信息条");
  assert.ok(inventoryIndex > paymentIndex, "重点库存应位于付款到货信息条下方");
  assert.equal(inventoryIndex, card.lastIndexOf("<TaskCriticalMaterials task={task} materials={materials} compact />"));
  assert.match(taskInventory, /compact\?: boolean/);
  assert.match(taskInventory, /proc-horizon-critical-summary/);
});

test("采购任务详情复用同一份重点库存数据和过滤口径", () => {
  const basicInfoIndex = taskDetail.indexOf("{/* 基本信息 */}");
  const inventoryIndex = taskDetail.indexOf("<TaskCriticalMaterials task={task} materials={materials} />");
  const attachmentIndex = taskDetail.indexOf("{/* 研发转采购时携带的图纸/说明");
  assert.match(taskDetail, /useProcurementData\(\)/);
  assert.ok(inventoryIndex > basicInfoIndex, "重点库存应显示在详情基本信息之后");
  assert.ok(inventoryIndex < attachmentIndex, "重点库存应位于需求附件之前");
});

test("历史核心配件配置接口保留数据约束", () => {
  assert.match(dto, /class SetProcCoreMaterialsDto/);
  assert.match(dto, /@ArrayMaxSize\(30\)/);
  assert.match(controller, /task-tree\/core-materials/);
  assert.match(service, /procurement:core-materials:v1:/);
  assert.match(service, /parentId: \{ not: null \}/);
  assert.match(service, /核心配件必须来自当前产品的子系统叶子物料/);
  assert.match(service, /核心配件必须已关联 T\+ 并完成库存同步/);
  assert.match(service, /children: \{ none: \{\} \}/);
  assert.match(api, /interface ProcCoreMaterialConfig/);
});

test("核心配件入口直达全部关键物料，旧配置流程不再挂载", () => {
  assert.match(cockpit, /canViewKeyMaterials && <Button[^\n]*aria-label=\{t\("核心配件"\)\}[^\n]*onClick=\{\(\) => navigate\(routePath\("page:proc-key-materials", "\/proc-key-materials"\)\)\}/);
  assert.match(cockpit, /if \(params.get\("core"\) === "1"\) return <Navigate replace to=\{routePath\("page:proc-key-materials", "\/proc-key-materials"\)\}/);
  assert.doesNotMatch(cockpit, /getProcCoreMaterialConfig|setProcCoreMaterialConfig|coreInventorySummary|setCoreMode/);
  assert.doesNotMatch(systemTree, /CoreMaterialsPanorama|coreMode|配置核心配件/);
  assert.match(systemTree, /<Tabs value=\{activeProductId\}/);
});

test("采购驾驶舱保留研发式任务卡，个人工作台使用紧凑任务行与右侧详情", () => {
  assert.match(cockpit, /<ProcurementTaskCard/);
  assert.match(workspace, /<ProcWorkspaceTaskList/);
  assert.match(workspace, /<TaskDetailDrawer[^\n]*presentation="workspace"/);
  assert.match(cockpit, /materials=\{materials\}/);
  assert.match(workspace, /materials=\{materials\}/);
  assert.doesNotMatch(card, /role="button"/);
  assert.match(card, /aria-label=\{t\("查看任务"\)\}/);
  assert.match(card, /rounded-2xl border border-slate-200\/80 bg-white/);
  assert.doesNotMatch(card, /hover:-translate-y-0\.5|group-hover\/attachment:scale/);
  assert.match(card, /line-clamp-2 text-balance text-\[15px\] font-bold/);
  assert.match(card, /DropdownMenu/);
  assert.match(card, /tabular-nums/);
  assert.doesNotMatch(card, /material-card relative w-full overflow-hidden p-4/);
  assert.match(workspace, /proc-s01-layout/);
  assert.match(source("src/app/procurement/procurementWorkspace.css"), /\.proc-s01-layout[\s\S]*?grid-template-columns/);
});

test("采购驾驶舱人员泳道只按采购部门负责人账号统计和筛选", () => {
  assert.match(cockpit, /useBuyerDirectory\(\{ departmentOnly: true \}\)/);
  const exports = {};
  const code = ts.transpileModule(source("src/app/procurement/procurementLogic.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", code)(exports);
  const roster = exports.uniqueRosterUserIdsByName([{ id: "u1", name: "张工" }, { id: "u2", name: "张工" }, { id: "u3", name: "李工" }]);
  const tasks = [
    { id: "account-1", buyerUserId: "u1", buyer: "张工" },
    { id: "account-2", buyerUserId: "u2", buyer: "张工" },
    { id: "ambiguous-history", buyer: "张工" },
    { id: "unique-history", buyer: "李工" },
    { id: "unrelated-role", buyerUserId: "elsewhere", buyer: "李工", rdContact: "张工", requesterName: "张工" },
  ];
  assert.deepEqual(exports.procurementTasksForBuyer(tasks, "u1", roster).map(row => row.id), ["account-1"]);
  assert.deepEqual(exports.procurementTasksForBuyer(tasks, "u2", roster).map(row => row.id), ["account-2"]);
  assert.deepEqual(exports.procurementTasksForBuyer(tasks, "u3", roster).map(row => row.id), ["unique-history"]);
  assert.deepEqual(exports.procurementTasksForBuyer(tasks, null, roster), tasks, "全部范围保留同名待核对与离册任务");
  assert.equal(tasks.length, 5, "筛选不删除原始任务");
});

test("采购模块的高频键盘交互统一使用项目 Radix 封装", () => {
  assert.doesNotMatch(cockpit, /<Tabs(?:List|Trigger)?\b/);
  assert.match(cockpit, /components\/ui\/toggle-group/);
  assert.match(cockpit, /<ToggleGroup\s+type="single"\s+value=\{line\}[\s\S]*?aria-label=\{t\("按采购业务线筛选"\)\}/);
  assert.match(cockpit, /aria-label=\{t\("按采购负责人筛选"\)\}/);
  assert.doesNotMatch(cockpit, /role="tablist"|role="tab"/);

  assert.match(systemTree, /components\/ui\/tabs/);
  assert.match(systemTree, /<Tabs value=\{activeProductId\}/);
  assert.doesNotMatch(systemTree, /role="tablist"|role="tab"/);

  assert.match(priceHistory, /components\/ui\/toggle-group/);
  assert.match(priceHistory, /components\/ui\/toggle/);
  assert.match(taskDetail, /components\/ui\/collapsible/);
  assert.match(peopleManagement, /components\/ui\/table/);
  assert.match(peopleManagement, /components\/ui\/checkbox/);
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
  assert.match(actions, /applyProcTaskUpdate\(result, requestScope\)/);
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
  assert.doesNotMatch(procData, /materialName: string,\r?\n\): \{ inTransit/);
  assert.match(procData, /material: Pick<Material, "id" \| "name">,\r?\n\): \{ inTransit/);
  // 两个调用点都改为传物料对象
  assert.match(drawer, /materialAggregates\(tasks, material\)/);
  assert.match(table, /materialAggregates\(tasks, m\)/);
  // 抽屉的关联任务列表走同一条判定，不再自己比名字
  assert.match(drawer, /tasks\.filter\(\(t\) => isTaskOfMaterial\(t, material\)\)/);
  assert.doesNotMatch(drawer, /t\.materialName === material\.name/);
});

// ── 免费样品登记与实际到样确认必须分开 ────────────────────────────────────
const procTypes = source("apps/api/src/modules/procurement/procurement.types.ts");
const procCommon = source("src/app/procurement/components/common.tsx");

test("询价两档只收免费样品，前后端用同一份状态清单", () => {
  // 后端是判据来源；前端拿它决定按钮显隐与勾选框锁死，两处写歪就会出现「点得开但提交被拒」
  assert.match(procTypes, /PROC_FREE_SAMPLE_ONLY_STATUSES:\s*ProcStatus\[\]\s*=\s*\['pending_inquiry',\s*'inquiring'\]/);
  assert.match(procCommon, /FREE_SAMPLE_ONLY_STATUSES:\s*ProcStatus\[\]\s*=\s*\["pending_inquiry",\s*"inquiring"\]/);
  // T+ 单据匹配候选必须是另一份：询价档 T+ 里没有单据，混进去会把真实采购单建议关联到询价中的任务
  assert.match(procTypes, /PROC_PO_MATCHABLE_STATUSES/);
  assert.doesNotMatch(
    source("apps/api/src/modules/procurement/tplus-po-match.service.ts"),
    /PROC_PO_LINKABLE_STATUSES/,
  );
});

test("详情页在询价两档也给出登记入口，且文案与「待到样」区分", () => {
  assert.match(taskDetail, /FREE_SAMPLE_ONLY_STATUSES\.includes\(task\.status\)/);
  assert.match(taskDetail, /pending_sample" \? '登记出样单' : '登记免费样品来货'/);
});

test("询价档表单锁死免费样品勾选，不给填采购单号的机会", () => {
  // 勾选框可取消的话，用户会填个单号再被后端拒掉——错误应该在界面上就不可达
  assert.match(actions, /disabled=\{isFreeSampleOnly\}/);
  assert.match(actions, /freeSample: isFreeSampleOnly/);
});

test("需样报价等待实际到样确认，不把免费登记当成收样事实", () => {
  assert.match(actions, /选定后进入「待到样」/);
  assert.match(actions, /选定后直接进入「已定价」/);
  assert.match(actions, /实际收到样品后再确认「样品已到」/);
  assert.doesNotMatch(actions, /freeSampleUnlocked|fetchedFreeSampleSuppliers/);
  assert.doesNotMatch(service, /allArrived \? 'testing' : 'pending_sample'/);
});

test("询价阶段免费登记成功提示进入待到样，并仍锁定无采购单号", () => {
  assert.match(actions, /isFreeSampleOnly\s*\n?\s*\? t\("已登记 \{count\} 条免费样品，任务已进入「待到样」/);
  assert.match(actions, /登记不代表已收到样品/);
  assert.match(actions, /disabled=\{isFreeSampleOnly\}/);
});

test("历史免费样品通过人工确认修正，保留报价并携带当前来源状态", () => {
  assert.match(taskDetail, /样品未到，修正为待到样/);
  assert.match(actions, /确认本轮免费样品尚未收到/);
  assert.match(actions, /已有免费样品登记属于本轮需求/);
  assert.match(actions, /transitionProcTask\(task\.id, "pending_sample", "历史免费样品状态修正[^\n]*task\.status\)/);
  assert.doesNotMatch(actions, /rollbackProcTask/);
  assert.match(taskDetail, /can\("proc-task:inquiry"\)/);
  assert.doesNotMatch(service, /nextAfterQuoteSelected\(\s*task,\s*selectedRows\.map/);
  assert.match(service, /任务进入「询价中」，待「完成询价」后继续/);
});

test("登记供应商必须从T+目录选择，报价读取失败可原位恢复", () => {
  assert.match(actions, /<TplusSupplierSelect/);
  assert.match(actions, /validSuppliers\[item\.key\] !== item\.supplierName/);
  assert.match(actions, /请从畅捷通供应商目录中选择每一行的供应商/);
  assert.match(actions, /purchaseOrdersError/);
  assert.match(actions, /重新读取报价/);
});

test('步骤模型覆盖直购部分到货，免样阶段不冒充已完成，需样阶段仍逐步显示', () => {
  const text = source('src/app/procurement/components/common.tsx');
  const ast = ts.createSourceFile('common.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'procurementStepsOf');
  const inquiry = JSON.parse(text.match(/INQUIRY_FLOW: ProcStatus\[\] = (\[[^;]+\]);/)[1]);
  const direct = JSON.parse(text.match(/DIRECT_FLOW: ProcStatus\[\] = (\[[^;]+\]);/)[1]);
  const js = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, '') + '\nreturn procurementStepsOf;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const stepsOf = new Function('INQUIRY_FLOW', 'DIRECT_FLOW', js)(inquiry, direct);
  const partial = stepsOf({ method: 'direct', status: 'partial_arrival', needSample: false });
  assert.equal(partial.filter(step => step.current).length, 1);
  assert.equal(partial.find(step => step.current).status, 'partial_arrival');
  const exempt = stepsOf({ method: 'inquiry', status: 'priced', needSample: false });
  assert.deepEqual(exempt.filter(step => step.skipped).map(step => step.status), ['pending_sample', 'testing']);
  assert.ok(exempt.filter(step => step.skipped).every(step => !step.completed));
  const sample = stepsOf({ method: 'inquiry', status: 'testing', needSample: true });
  assert.ok(sample.every(step => !step.skipped));
  assert.equal(sample.find(step => step.current).status, 'testing');
  assert.equal(sample.find(step => step.status === 'priced').completed, false);
});
