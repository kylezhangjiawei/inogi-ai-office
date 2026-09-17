import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const attendance = source("src/app/components/AttendanceImportDialog.tsx");
const app = source("src/app/App.tsx");
const root = source("src/app/Root.tsx");
const mobileShell = source("src/app/MobileShell.tsx");
const login = source("src/app/LoginPage.tsx");
const procurementSources = {
  "采购通用弹窗": source("src/app/procurement/components/modals.tsx"),
  "采购任务动作": source("src/app/procurement/components/taskActions.tsx"),
  "研发转采购": source("src/app/procurement/components/rdInsertion.tsx"),
  "核心配件全景": source("src/app/procurement/components/CoreMaterialsPanorama.tsx"),
  "采购子系统详情": source("src/app/procurement/components/ProcurementModuleDetail.tsx"),
  "采购物料表": source("src/app/procurement/components/MaterialTable.tsx"),
};

const visualSources = { "考勤导入": attendance, ...procurementSources };

test("考勤导入和采购深层交互统一使用 Horizon 浅色单强调视觉", () => {
  for (const [name, page] of Object.entries(visualSources)) {
    assert.doesNotMatch(page, /\b(?:indigo|violet|purple|fuchsia|pink)-/, `${name}不应保留旧紫色强调`);
    assert.doesNotMatch(page, /\bdark:/, `${name}不应保留暗色分支`);
    assert.doesNotMatch(page, /(?:bg-|linear-|radial-)gradient/, `${name}不应使用渐变`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name}不应修改字距`);
    assert.doesNotMatch(page, /\btransition-all\b/, `${name}不应使用全属性过渡`);
    assert.doesNotMatch(page, /hover:-translate/, `${name}不应使用悬停位移`);
  }

  assert.match(attendance, /className="horizon-theme horizon-portal/);
  for (const [name, page] of Object.entries(procurementSources)) {
    assert.match(page, /primary|proc-horizon/, `${name}应接入采购 Horizon 视觉`);
  }
});

test("全局错误恢复入口在 Horizon 作用域外仍使用 Horizon 主题 与可见焦点", () => {
  assert.doesNotMatch(app, /bg-indigo-(?:500|600)/);
  assert.match(app, /import \{ Button \} from "\.\/components\/ui\/button"/);
  assert.match(app, /<Button[\s\S]*onClick=\{\(\) => window\.location\.reload\(\)\}/);
  assert.match(app, /focus-visible:ring-primary\/30/);
  assert.match(app, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
});

test("业务外壳保留统一页脚挂载，登录页备案调用不附加底色", () => {
  assert.match(root, /<SiteRecordFooter tone="horizon" className="backdrop-blur-none" \/>/);
  assert.match(mobileShell, /<SiteRecordFooter tone="horizon" className="pb-\[max\(0\.5rem,env\(safe-area-inset-bottom\)\)\] backdrop-blur-none" \/>/);
  assert.match(login, /<SiteRecordFooter className="mt-4 w-full max-w-5xl" \/>/);
});

test("考勤导入继续保留预览、人员选择和确认写库契约", () => {
  assert.match(attendance, /await previewAttendanceImport\(picked\)/);
  assert.match(attendance, /await confirmAttendanceImport\(file, \[\.\.\.selected\]\)/);
  assert.match(attendance, /setSelected\(new Set\(result\.groups\.map/);
  assert.match(attendance, /if \(busy\) return;/);
  assert.match(attendance, /onImported\(result\.month\)/);
  assert.match(attendance, /<Dialog open=\{open\}/);
});

test("采购深层弹窗继续使用项目原语并保留核心业务调用", () => {
  const modals = procurementSources["采购通用弹窗"];
  const actions = procurementSources["采购任务动作"];
  const insertion = procurementSources["研发转采购"];

  assert.match(modals, /<Dialog open/);
  assert.match(modals, /horizon-theme horizon-portal proc-horizon-overlay/);
  assert.match(modals, /await createProcTask\(/);
  assert.match(modals, /await importProcMaterials\(items\)/);
  assert.match(modals, /await uploadProcurementAttachment\(file\)/);
  assert.match(modals, /await syncTplusMaterialMaster\(\)/);
  assert.match(modals, /await syncTplusPurchaseOrdersFull\(\)/);

  assert.match(actions, /<AlertDialog open=\{quoteConfirmOpen\}/);
  assert.match(actions, /horizon-theme horizon-portal proc-horizon-overlay/);
  assert.match(actions, /deleteProcTask/);
  assert.match(actions, /applyProcTaskUpdate/);

  assert.match(insertion, /horizon-theme horizon-portal proc-horizon-overlay/);
  assert.match(insertion, /await Promise\.all\(files\.map/);
  assert.match(insertion, /await uploadProcurementAttachment\(row\.file\)/);
});

test("核心配件、模块详情和物料表继续保留筛选与任务入口", () => {
  const core = procurementSources["核心配件全景"];
  const detail = procurementSources["采购子系统详情"];
  const materials = procurementSources["采购物料表"];

  assert.match(core, /const saveConfig = async \(\) =>/);
  assert.match(core, /<Dialog open=\{editorOpen\}/);
  assert.match(detail, /<TaskDetailDrawer/);
  assert.match(detail, /<NewRequirementModal/);
  assert.match(detail, /<EditTaskModal/);
  assert.match(materials, /materialAggregates\(tasks, m\)/);
  assert.match(materials, /onFiltersChange/);
  assert.match(materials, /onOpen\(m\)/);
});
