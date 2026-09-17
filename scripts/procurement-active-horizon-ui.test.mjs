import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const sources = {
  "采购共享组件": source("src/app/procurement/components/common.tsx"),
  "供应商报价库": source("src/app/procurement/QuoteBookPage.tsx"),
  "物料详情": source("src/app/procurement/components/MaterialDetailDrawer.tsx"),
  "采购驾驶舱": source("src/app/procurement/ProcurementCockpitPage.tsx"),
  "采购人员页面": source("src/app/procurement/ProcPeopleManagementPage.tsx"),
  "任务移动": source("src/app/procurement/components/MoveTaskDialog.tsx"),
  "人员管理抽屉": source("src/app/procurement/components/PeopleManageDrawer.tsx"),
  "价格历史": source("src/app/procurement/components/PriceHistoryModal.tsx"),
  "采购系统树": source("src/app/procurement/components/ProcurementSystemTree.tsx"),
  "采购任务卡": source("src/app/procurement/components/ProcurementTaskCard.tsx"),
  "报价编辑": source("src/app/procurement/components/QuoteFormDrawer.tsx"),
  "任务详情": source("src/app/procurement/components/TaskDetailDrawer.tsx"),
  "重点物料": source("src/app/procurement/components/TaskCriticalMaterials.tsx"),
  "报价导入": source("src/app/procurement/components/QuoteImportModal.tsx"),
};

test("活跃采购页面统一使用 Horizon 单强调视觉", () => {
  for (const [name, page] of Object.entries(sources)) {
    assert.match(page, /(?:text|bg|border(?:-t)?|ring)-primary/, `${name}应使用共享品牌强调色`);
    assert.match(page, /tabular-nums/, `${name}的数据应使用等宽数字`);
    assert.doesNotMatch(
      page,
      /\b(?:indigo|violet|purple|fuchsia|pink|blue|cyan|teal|orange|sky|red)-/,
      `${name}不应保留旧多色强调`,
    );
    assert.doesNotMatch(page, /\bdark:/, `${name}不应保留暗色分支`);
    assert.doesNotMatch(page, /(?:bg-|linear-|radial-)gradient/, `${name}不应使用渐变`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name}不应修改字距`);
    assert.doesNotMatch(page, /\btransition-all\b/, `${name}不应使用全属性过渡`);
    assert.doesNotMatch(page, /hover:-translate|hover:translate/, `${name}不应使用悬停位移`);
  }
});

test("采购弹窗和键盘交互继续使用项目可访问原语", () => {
  const moveTask = sources["任务移动"];
  const quoteImport = sources["报价导入"];
  const quoteForm = sources["报价编辑"];
  const taskDetail = sources["任务详情"];
  const systemTree = sources["采购系统树"];
  const taskCard = sources["采购任务卡"];

  assert.match(moveTask, /<Dialog open/);
  assert.match(moveTask, /aria-pressed=\{isSelected\}/);
  assert.doesNotMatch(moveTask, /role="button"/);

  assert.match(quoteImport, /<Dialog open/);
  assert.match(quoteImport, /<(?:Button|UiButton)[\s\S]*?onDragOver=/);
  assert.doesNotMatch(quoteImport, /role="button"/);

  assert.match(quoteForm, /<Sheet open/);
  assert.match(quoteForm, /aria-label=\{t\("预览商品图片"\)\}/);
  assert.match(taskDetail, /<Sheet open/);
  assert.match(taskDetail, /<AlertDialog open=/);
  assert.match(taskDetail, /<Collapsible\b[^>]*\bopen=\{logsOpen\}/);

  assert.match(systemTree, /<Tabs value=/);
  assert.match(systemTree, /<Select[\s\S]*?<SelectTrigger/);
  assert.match(systemTree, /<AlertDialog open(?:\s|=)/);
  assert.match(systemTree, /aria-label=\{t\("新增名称节点"\)\}/);

  assert.match(taskCard, /<DropdownMenu>/);
  assert.match(taskCard, /aria-label=\{t\("更多操作"\)\}/);
  assert.match(taskCard, /aria-label=\{t\("预览附件：\{name\}"/);
});

test("采购视觉改造保留核心数据和写操作契约", () => {
  assert.match(sources["供应商报价库"], /listQuoteBook\(\)/);
  assert.match(sources["报价编辑"], /createSupplierQuote\(input\)/);
  assert.match(sources["报价编辑"], /updateSupplierQuote\(quote\.id, input\)/);
  assert.match(sources["报价导入"], /importSupplierQuotes\(withImages\)/);
  assert.match(sources["物料详情"], /reviewMaterial\(material\.id, reviewStatus/);
  assert.match(sources["任务移动"], /moveProcTasks\(/);
  assert.match(sources["人员管理抽屉"], /batchReassignProcTasks\(/);
  assert.match(sources["采购人员页面"], /batchReassignProcTasks\(/);
  assert.match(sources["重点物料"], /setProcTaskCriticalMaterials\(task\.id, items\)/);
  assert.match(sources["任务详情"], /listQuotations\(\{ taskId: task\.id \}\)/);
  assert.match(sources["采购系统树"], /listProcTaskTree\(/);
  assert.match(sources["采购驾驶舱"], /refreshProcurement\(\)/);
});
