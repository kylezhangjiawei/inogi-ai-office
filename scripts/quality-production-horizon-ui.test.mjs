import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const stylesEntry = source("src/styles/index.css");
const horizon = source("src/styles/horizon.css");
const horizonPage = source("src/app/components/horizon/HorizonPage.tsx");
const production = source("src/app/RDTaskManagementPage.tsx");
const ebpr = source("src/app/EBPRPage.tsx");
const inspection = source("src/app/InspectionReleasePage.tsx");
const bugLog = source("src/app/BugLogPage.tsx");

test("质量与生产页面复用全局 Horizon 页面原语", () => {
  assert.match(stylesEntry, /@import ['"]\.\/horizon\.css['"];?/);
  assert.match(horizon, /--hz-primary:\s*#002fa7;/i);
  assert.match(horizonPage, /export function HorizonPageHeader/);
  assert.match(horizonPage, /export function HorizonMetricGrid/);

  for (const [name, page] of [
    ["电子批记录", ebpr],
    ["检验与放行", inspection],
    ["缺陷日志", bugLog],
  ]) {
    assert.match(page, /className="horizon-theme hz-page/, `${name}应挂载 Horizon 页面作用域`);
    assert.match(page, /<HorizonPageHeader/, `${name}应使用统一 Horizon 页头`);
    assert.match(page, /<HorizonMetricGrid/, `${name}应使用统一指标带`);
  }
});

test("三套桌面驾驶舱接入 Horizon 视觉但保留研发专属行为边界", () => {
  assert.match(production, /const horizonCockpit = true;/);
  assert.match(production, /const nativeRdCockpit = !usCollab && !productionWorkspace;/);
  assert.match(production, /horizonVariant=\{horizonCockpit\}/);
  assert.match(production, /生产执行提示/);
  assert.match(production, /全部生产系统/);
  assert.match(production, /生产任务数据/);
});

test("电子批记录使用语义化工序和项目 Dialog，并真实落盘输入值", () => {
  assert.match(ebpr, /aria-expanded=\{expanded\}/);
  assert.match(ebpr, /role="region"/);
  assert.match(ebpr, /<Dialog open=\{Boolean\(modifyModal\)\}/);
  assert.match(ebpr, /params: s\.params\.map/);
  assert.match(ebpr, /params: step\.params\.map/);
  assert.doesNotMatch(ebpr, /fixed inset-0 bg-black\/30/);
  assert.doesNotMatch(ebpr, /FDA 21 CFR Part 11 合规/);
});

test("检验放行将新建表单移入 Dialog，并为高风险动作提供确认", () => {
  assert.match(inspection, /<Dialog open=\{showNewForm\}/);
  assert.match(inspection, /<AlertDialog open=\{releaseConfirmOpen\}/);
  assert.match(inspection, /<AlertDialog open=\{rejectConfirmOpen\}/);
  assert.match(inspection, /请填写拒绝原因/);
  assert.match(inspection, /result: "合格" \| "不合格" \| ""/);
  assert.doesNotMatch(inspection, /电子签名/);
  assert.doesNotMatch(inspection, /computeItemResult/);
});

test("缺陷日志在常用桌面宽度进入双栏，并补齐表格与上传语义", () => {
  assert.match(bugLog, /xl:grid-cols-\[280px_minmax\(0,1fr\)\]/);
  assert.match(bugLog, /2xl:grid-cols-\[280px_minmax\(0,1fr\)_320px\]/);
  assert.match(bugLog, /<caption className="sr-only">/);
  assert.match(bugLog, /scope="col"/);
  assert.match(bugLog, /aria-busy=\{isUploading\}/);
  assert.match(bugLog, /aria-label="关闭新增版本表单"/);
  assert.doesNotMatch(bugLog, /calc\(100vh/);
});

test("本批次独立页面不包含禁用的视觉捷径", () => {
  for (const [name, page] of [
    ["电子批记录", ebpr],
    ["检验与放行", inspection],
    ["缺陷日志", bugLog],
  ]) {
    assert.doesNotMatch(page, /bg-gradient|linear-gradient|radial-gradient/, `${name}不应使用渐变`);
    assert.doesNotMatch(page, /\b(?:indigo|purple)-/, `${name}不应使用旧紫色品牌强调`);
    assert.doesNotMatch(page, /\btracking-(?:wide|wider|widest|\[[^\]]+\])/, `${name}不应使用装饰性大字距`);
  }
});
