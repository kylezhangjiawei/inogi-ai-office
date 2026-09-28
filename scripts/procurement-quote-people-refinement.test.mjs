import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const files = {
  quoteBook: source("src/app/procurement/QuoteBookPage.tsx"),
  peoplePage: source("src/app/procurement/ProcPeopleManagementPage.tsx"),
  quoteForm: source("src/app/procurement/components/QuoteFormDrawer.tsx"),
  quoteImport: source("src/app/procurement/components/QuoteImportModal.tsx"),
  priceHistory: source("src/app/procurement/components/PriceHistoryModal.tsx"),
  peopleDrawer: source("src/app/procurement/components/PeopleManageDrawer.tsx"),
  moveTask: source("src/app/procurement/components/MoveTaskDialog.tsx"),
  actions: source("src/app/procurement/components/taskActions.tsx"),
  modals: source("src/app/procurement/components/modals.tsx"),
  insertion: source("src/app/procurement/components/rdInsertion.tsx"),
  common: source("src/app/procurement/components/common.tsx"),
};
const procurementLogic = source("src/app/procurement/procurementLogic.ts");

test("报价与人员精修保持 Horizon 单强调视觉和高密度排版约束", () => {
  for (const [name, page] of Object.entries(files)) {
    assert.doesNotMatch(page, /\b(?:indigo|violet|purple|fuchsia|pink)-/, `${name} 不应出现旧紫色系`);
    assert.doesNotMatch(page, /\bdark:/, `${name} 不应出现暗色分支`);
    assert.doesNotMatch(page, /(?:bg-|linear-|radial-)gradient/, `${name} 不应使用渐变`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name} 不应改字距`);
    assert.doesNotMatch(page, /\btransition-all\b/, `${name} 不应使用全属性过渡`);
    assert.doesNotMatch(page, /hover:-translate|hover:translate/, `${name} 不应使用悬停位移`);
    assert.doesNotMatch(page, /backdrop-blur|\bblur-/, `${name} 不应使用模糊装饰`);
    assert.match(page, /text-balance|text-pretty/, `${name} 应提供可读文本排版`);
  }
  assert.match(files.quoteBook, /tabular-nums/);
  assert.match(files.peoplePage, /tabular-nums/);
  assert.match(files.quoteForm, /tabular-nums/);
});

test("报价库首先呈现供应商、阶梯价、最优依据、历史差异和有效期风险", () => {
  const page = files.quoteBook;
  assert.match(page, /商品 \/ 供应商/);
  assert.match(page, /单位 \/ 阶梯报价/);
  assert.match(page, /依据 \{suppliers\} 家 \/ \{tiers\} 档有效报价/);
  assert.match(page, /currentDelta|recentDelta/);
  assert.match(page, /当前最优较最近采购低/);
  assert.match(page, /isExpiringSoon/);
  assert.match(page, /全部过期/);
  assert.match(page, /lowestActiveTierByCurrency\(row\.quotes, today\)/);
  assert.match(procurementLogic, /bestByCurrency\.set\(quote\.currency/);
  assert.match(page, /不同币种独立比较|不跨币种换算/);
  assert.match(page, /包含该币种最优档/);
  assert.match(page, /不限起订/);
  assert.match(page, /function localIsoDate/);
  assert.match(page, /const today = localIsoDate\(new Date\(\)\)/);
  assert.doesNotMatch(page, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.doesNotMatch(page, /useEffect\(\(\) => \{ setPage\(1\); \}, \[search, category, showAll, onlyExpired\]\)/);
  assert.match(page, /setSearch\(e\.target\.value\); setPage\(1\)/);
  assert.match(page, /SelectTrigger aria-label=\{t\("筛选商品分类"\)\}/);
});

test("报价库首次加载与刷新共用请求令牌，旧响应不能覆盖新状态", () => {
  const page = files.quoteBook;
  assert.match(page, /const quoteRequestGateRef = useRef<LatestRequestGate \| null>\(null\)/);
  assert.match(page, /createLatestRequestGate\(\)/);
  assert.match(page, /const reload = useCallback\(\(\) => \{/);
  assert.match(page, /const requestToken = gate\.begin\(\)/);
  assert.equal((page.match(/listQuoteBook\(\)/g) ?? []).length, 1, "首次加载和刷新应共用同一请求入口");
  assert.match(page, /if \(!gate\.isCurrent\(requestToken\)\) return;[\s\S]*?setRows\(list\)/);
  assert.match(page, /\.catch\([\s\S]*?if \(!gate\.isCurrent\(requestToken\)\) return;[\s\S]*?setError/);
  assert.match(page, /if \(gate\.isCurrent\(requestToken\)\) setLoading\(false\)/);
  assert.match(page, /return \(\) => \{ quoteRequestGateRef\.current\?\.invalidate\(\); \}/);
  assert.match(page, /\}, \[reload\]\)/);
});

test("采购人员页维护成员并只读显示任务数量，任务交接留在任务管理抽屉", () => {
  for (const page of [files.peopleDrawer]) {
    assert.match(page, /高负载/);
    assert.match(page, /负载可用/);
    assert.match(page, /在办任务/);
    assert.match(page, /isProcurementTaskOverdue/);
    assert.match(page, /batchReassignProcTasks/);
    assert.match(page, /role="alert"/);
  }
  assert.match(files.peoplePage, /listBuyerCandidates\(controller.signal, "all"\)/);
  assert.match(files.peoplePage, /任务数量/);
  assert.doesNotMatch(files.peoplePage, /batchReassignProcTasks|PersonTasksDrawer|autoAssignUnassigned|在办任务|任务交接/);
  assert.match(files.peoplePage, /busyRef\.current/);
  assert.match(files.peoplePage, /<Table aria-label=\{t\("采购成员列表"\)\}/);
  assert.doesNotMatch(files.peoplePage, /PeopleManageDrawer|OperationalTasksPanel|setManageOpen/);
  assert.match(files.peopleDrawer, /PROC_STATUS_META/);
  assert.match(files.peopleDrawer, /useConfirmDialog/);
  assert.match(files.peopleDrawer, /移出采购成员名录/);
  assert.match(files.peopleDrawer, /resolveProcurementOwner\(/);
  assert.match(procurementLogic, /task\.buyerUserId/);
  assert.match(files.peopleDrawer, /`user:\$\{member\.id\}`/);
  assert.match(files.peopleDrawer, /person\.active\.map\(\(x\) => x\.id\)/);
  assert.match(files.peopleDrawer, /onFocusPerson \? \(/);
  assert.match(files.peopleDrawer, /const working = busy \|\| rosterBusy/);
  for (const action of ["addMember", "removeMember", "submitHandover"]) {
    assert.match(files.peopleDrawer, new RegExp(`const ${action} = async [^\\n]*\\{\\s*if \\(busyRef\\.current \\|\\| rosterBusyRef\\.current`), `${action} 必须同时检查交接与名录提交锁`);
  }
  assert.match(files.peopleDrawer, /closeDisabled=\{working\}/);
  assert.match(files.peopleDrawer, /disabled=\{working\}\s+aria-expanded=\{handover === p\.key\}/, "交接中禁止切换目标");
  assert.match(files.peopleDrawer, /disabled=\{working\}\s+onClick=\{\(\) => \{ onFocusPerson/, "提交中禁止通过姓名跳转关闭抽屉");
  assert.match(files.peopleDrawer, /disabled=\{working \|\| Boolean\(rosterError\)\} onClick=\{\(\) => requestRemoveMember/, "交接中禁止移出名录");
  assert.match(files.peopleDrawer, /disabled=\{working \|\| rosterLoading \|\| Boolean\(rosterError\) \|\| !addName\.trim\(\)\}/, "提交中禁止新增成员");
  assert.match(files.peopleDrawer, /disabled=\{working \|\| p\.active\.length === 0\}/, "名录提交中禁止发起交接");
  assert.doesNotMatch(files.peopleDrawer, /disabled=\{(?:busy|rosterBusy)\}/, "交互不得退回独立的提交锁");
  assert.match(files.peopleDrawer, /if \(person\.active\.length === 0\)/);
  assert.match(files.peopleDrawer, /canReassign && p\.active\.length > 0/);
});

test("批量转派的计数与提交排除刷新后失效的任务", () => {
  const batch = files.modals.slice(files.modals.indexOf("export function BatchReassignModal"), files.modals.indexOf("// ── 任务编辑"));
  assert.match(batch, /eligibleTasks = useMemo\(\(\) => tasks\.filter\(\(task\) => !TERMINAL_STATUSES\.includes\(task\.status\)\)/);
  assert.match(batch, /retainAvailableProcurementSelection\(selected, eligibleIds\)/);
  assert.match(batch, /if \(validSelected\.size !== selected\.size\) setSelected\(validSelected\)/);
  assert.match(batch, /batchReassignProcTasks\(Array\.from\(validSelected\)/);
  assert.match(batch, /count: validSelected\.size, hidden: \[\.\.\.validSelected\]/);
  assert.doesNotMatch(batch, /batchReassignProcTasks\(Array\.from\(selected\)/);
});

test("报价表单、报价导入和任务移动提供清晰结构、就地错误与提交反馈", () => {
  assert.match(files.quoteForm, /QuoteFormErrors/);
  assert.match(files.quoteForm, /role="alert"/);
  assert.match(files.quoteForm, /供应商与报价条款/);
  assert.match(files.quoteForm, /阶梯报价/);
  assert.match(files.quoteForm, /正在保存报价/);
  assert.match(files.quoteForm, /<Sheet open/);
  assert.match(files.quoteForm, /<SheetDescription/);
  assert.match(files.quoteForm, /for \(const \[index, row\] of tiers\.entries\(\)\)/);
  assert.match(files.quoteForm, /submitBusyRef\.current/);
  assert.match(files.quoteForm, /event\.target\.value = ""/);
  assert.match(files.quoteForm, /localPreviewUrlRef/);
  assert.match(files.quoteForm, /URL\.revokeObjectURL\(localPreviewUrlRef\.current\)/);
  assert.match(files.quoteForm, /variant="ghost" disabled=\{imageBusy\}/);
  assert.match(files.quoteForm, /SelectTrigger aria-label=\{t\("币种"\)\}/);
  assert.match(files.quoteForm, /ariaLabel=\{t\("报价日期"\)\}/);
  assert.match(files.quoteForm, /ariaLabel=\{t\("有效期至"\)\}/);
  assert.match(files.quoteForm, /aria-label=\{t\("第 \{index\} 档起订量"/);
  assert.match(files.quoteForm, /aria-label=\{t\("第 \{index\} 档单价"/);

  assert.match(files.quoteImport, /currentStep/);
  assert.match(files.quoteImport, /核对识别结果/);
  assert.match(files.quoteImport, /operationError/);
  assert.match(files.quoteImport, /parseBusy/);
  assert.match(files.quoteImport, /OCR \+ AI/);
  assert.match(files.quoteImport, /requestIdRef/);
  assert.match(files.quoteImport, /requestId !== requestIdRef\.current/);
  assert.match(files.quoteImport, /setItems\(\[\]\);[\s\S]*?setImages\(\[\]\);[\s\S]*?parseQuoteBookFile\(picked\)/);
  assert.match(files.quoteImport, /disabled=\{busy \|\| parseBusy \|\| aiBusy\}/);
  assert.match(files.quoteImport, /const imagePreviewUrls = useMemo/);
  assert.match(files.quoteImport, /URL\.revokeObjectURL\(url\)/);
  assert.match(files.quoteImport, /importSupplierQuotes\(withImages\)/);
  assert.match(files.quoteImport, /const \[importErrors, setImportErrors\]/);
  assert.match(files.quoteImport, /setItems\(retryItems\)/);
  assert.match(files.quoteImport, /selectFailedQuoteImportEntries\(items, images, result\.errors\)/);
  assert.match(files.quoteImport, /setImportErrors\(result\.errors\.map/);
  assert.match(files.quoteImport, /导入失败的报价已保留在当前列表/);

  assert.match(files.moveTask, /选择待移动任务/);
  assert.match(files.moveTask, /重新加载归属树/);
  assert.match(files.moveTask, /actionError/);
  assert.match(files.moveTask, /moveProcTasks\(effectiveIds/);
});

test("历史价格对比提供加载恢复、决策摘要和非纯颜色最低价标识", () => {
  const page = files.priceHistory;
  assert.match(page, /已读最低/);
  assert.match(page, /最近报价/);
  assert.match(page, /已读均价/);
  assert.match(page, /供应商覆盖/);
  assert.match(page, /重新加载/);
  assert.match(page, /role="img"/);
  assert.match(page, /BadgeCheck/);
  assert.match(page, /const activeCurrency =/);
  assert.match(page, /const comparableRows = useMemo/);
  assert.match(page, /rows\.filter\(\(row\) => \(row\.currency \|\| "CNY"\) === activeCurrency\)/);
  assert.match(page, /fmtQuotationPrice/);
  assert.match(page, /不同币种不直接比较/);
  assert.match(page, /onClick=\{\(\) => toggleSort\("date"\)\}/);
  assert.match(page, /onClick=\{\(\) => toggleSort\("price"\)\}/);
  assert.match(page, /listQuotations\(exactMaterialId \? \{ materialId: exactMaterialId \} : \{ materialName \}\)/);
  assert.match(page, /同名候选报价/);
  assert.match(page, /最近最多 200 条/);
  assert.match(page, /const requestIdRef = useRef\(0\)/);
  assert.match(page, /<caption className="sr-only">/);
  assert.match(page, /<thead className="sr-only">/);
  assert.match(page, /scope="col"/);
});

test("共享操作弹层保留危险确认、原子提交和采购业务调用", () => {
  assert.match(files.common, /onConfirm: \(\) => void \| boolean \| Promise<void \| boolean>/);
  assert.match(files.common, /if \(!req \|\| busyRef\.current\) return/);
  assert.match(files.common, /if \(result !== false\) setReq\(null\)/);
  assert.match(files.common, /event\.preventDefault\(\); void execute\(\)/);
  assert.match(files.common, /if \(!open && !busyRef\.current\) setReq\(null\)/);
  assert.match(files.common, /aria-label=\{ariaLabel\}/);
  const comboInput = files.common.slice(
    files.common.indexOf("export function ComboInput("),
    files.common.indexOf("export function DateInput("),
  );
  assert.match(comboInput, /autoFocus=\{autoFocus\}/);
  assert.match(comboInput, /required=\{required\}/);
  assert.match(comboInput, /onEnter\?: \(\) => void/);
  assert.match(comboInput, /aria-label=\{ariaLabel\}/);
  assert.match(comboInput, /if \(e\.key === "Enter"\) onEnter\?\.\(\)/);

  assert.match(files.actions, /function ConfirmActionDialog/);
  assert.match(files.actions, /<AlertDialog open/);
  assert.match(files.actions, /event\.preventDefault\(\); void execute\(\)/);
  assert.match(files.actions, /interface ActionRunResult/);
  assert.match(files.actions, /if \(result\.ok\) setPending\(null\)/);
  assert.match(files.actions, /confirmQuotationsFromQuoteBook/);
  assert.match(files.actions, /linkPurchaseOrders/);
  assert.match(files.actions, /receiveProcTask/);
  assert.match(files.actions, /deleteProcTask/);
  assert.match(files.actions, /formatQuoteAmount\(q\.unitPrice, q\.currency\)/);
  assert.match(files.actions, /purchase-order-\$\{index\}-number/);
  assert.match(files.actions, /\{supplier\}采购数量/);
  assert.match(files.actions, /ariaLabel=\{t\("\{supplier\}\{dateType\}"/);
  assert.match(files.actions, /onOpenChange=\{\(open\) => \{ if \(open \|\| !busy\) setQuoteConfirmOpen\(open\); \}\}/);
  assert.match(files.actions, /event\.preventDefault\(\);[\s\S]*?confirmQuotationsFromQuoteBook/);
  assert.doesNotMatch(files.actions, /setQuoteConfirmOpen\(false\);/);
  assert.match(files.actions, /\{formError && <p role="alert"/);

  assert.match(files.modals, /DialogDescription/);
  assert.match(files.modals, /if \(!open && !busy\) onClose\(\)/);
  assert.match(files.modals, /phase.*parsing.*ready.*importing/);
  assert.match(files.modals, /const requestIdRef = useRef\(0\)/);
  assert.match(files.modals, /if \(busyRef\.current\) return/);
  assert.match(files.modals, /requestId !== requestIdRef\.current/);
  assert.match(files.modals, /type="file" accept="\.xlsx,\.xls" disabled=\{busy\}/);
  assert.match(files.modals, /<Shell title=\{t\("分类管理"\)\} busy=\{busy\}/);
  assert.ok((files.modals.match(/busy=\{busy\}/g) ?? []).length >= 9, "所有异步采购弹层应把 busy 传给通用壳");
  assert.match(files.modals, /const working = busy \|\| syncing !== null \|\| autoSyncBusy/);
  assert.match(files.modals, /busy=\{working\}/);
  assert.match(files.modals, /disabled=\{working\} onClick=\{onClose\}/);
  assert.match(files.modals, /SelectTrigger aria-label=\{t\('归属产品系统'\)\}/);
  const draftDate = files.modals.match(/<DateInput\b[^>]*value=\{draft\.needDate\}[^>]*>/)?.[0];
  assert.ok(draftDate, "建单需求日期控件必须存在");
  assert.match(draftDate, /disabled=\{disabled\}/);
  assert.match(draftDate, /ariaLabel=\{t\('需求日期'\)\}/);
  const editDate = files.modals.match(/<DateInput\b[^>]*value=\{form\.needDate\}[^>]*>/)?.[0];
  assert.ok(editDate, "任务编辑需求日期控件必须存在");
  assert.match(editDate, /disabled=\{busy\}/);
  assert.match(editDate, /ariaLabel=\{t\('需求日期'\)\}/);
  assert.match(files.modals, /SelectTrigger aria-label=\{t\('付款状态'\)\}/);
  assert.match(files.modals, /整批操作失败时不会部分转派/);
  assert.match(files.modals, /role="alert"/);
  assert.doesNotMatch(files.modals, /role="button"/);
  assert.match(files.modals, /await importProcMaterials\(items\)/);
  assert.match(files.modals, /await batchReassignProcTasks/);
  assert.match(files.modals, /await upsertProcMaterial/);

  assert.match(files.insertion, /TransferErrors/);
  assert.match(files.insertion, /核对物料/);
  assert.match(files.insertion, /确认图纸附件/);
  assert.match(files.insertion, /await Promise\.all\(files\.map/);
  assert.match(files.insertion, /await transferProcTask/);
  assert.match(files.insertion, /aria-label=\{t\("移除附件：\{name\}"/);
  assert.match(files.insertion, /aria-label=\{t\(label\)\}/);
  assert.match(files.insertion, /ariaLabel=\{t\(label\)\}/);
  assert.match(files.insertion, /aria-label=\{t\("归属产品系统"\)\}/);
});
