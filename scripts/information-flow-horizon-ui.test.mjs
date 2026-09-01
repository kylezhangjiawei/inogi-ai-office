import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const pages = {
  "售后 Case 列表": source("src/app/AfterSalesList.tsx"),
  "售后 Case 新建": source("src/app/AfterSalesForm.tsx"),
  "售后 Case 详情": source("src/app/AfterSalesDetails.tsx"),
  "研发问题分流": source("src/app/RDIssues.tsx"),
  "注册项目里程碑": source("src/app/RegistrationProjects.tsx"),
  "BOM 确认存档": source("src/app/BOMArchive.tsx"),
  "设计开发变更": source("src/app/DesignChangesPage.tsx"),
};

test("信息流转七个路由页面统一挂载 Horizon 页面骨架", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /className="horizon-theme hz-page/, `${name}应挂载 Horizon 页面作用域`);
    assert.match(page, /<HorizonPageHeader/, `${name}应使用统一 Horizon 页头`);
  }
});

test("售后 Case 覆盖列表、表单和详情的关键交互语义", () => {
  const list = pages["售后 Case 列表"];
  const form = pages["售后 Case 新建"];
  const details = pages["售后 Case 详情"];

  assert.match(list, /<caption className="sr-only">/);
  assert.match(list, /<Dialog open=\{showFilterDialog\}/);
  assert.match(list, /aria-label=\{`查看工单/);
  assert.match(form, /aria-invalid=\{isMissing\("customerName"\)\}/);
  assert.match(form, /role="alert"/);
  assert.match(form, /aria-label=\{`移除附件/);
  assert.match(details, /<AlertDialog open=\{dialogMode === "delete"\}/);
  assert.match(details, /<AlertDialog open=\{Boolean\(statusConfirm\)\}/);
  assert.match(details, /aria-label=\{`复制工单编号/);
});

test("问题分流、注册里程碑和 BOM 存档形成清晰业务工作区", () => {
  const triage = pages["研发问题分流"];
  const registration = pages["注册项目里程碑"];
  const bom = pages["BOM 确认存档"];

  assert.match(triage, /AI 分类置信度/);
  assert.match(triage, /aria-invalid=\{showValidation/);
  assert.match(triage, /<HorizonMetricGrid>/);
  assert.match(registration, /<Dialog open=\{Boolean\(activeReminder\)\}/);
  assert.match(registration, /已完成 \$\{project\.stageIndex \+ 1\} 个阶段/);
  assert.match(bom, /<HorizonMetricGrid>/);
  assert.match(bom, /差异确认|流转就绪度/);
});

test("设计开发变更使用项目 Dialog、语义表格和可访问选择操作", () => {
  const design = pages["设计开发变更"];
  assert.doesNotMatch(design, /@mui\/material/);
  assert.match(design, /<Dialog open=\{dialogMode !== null\}/);
  assert.match(design, /<caption className="sr-only">/);
  assert.match(design, /scope="col"/);
  assert.match(design, /aria-label=\{`\$\{selectedRows\[item\.id\]/);
  assert.match(design, /useDeferredValue\(keyword\)/);
});

test("信息流转页面不包含禁用的视觉与手写弹层模式", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.doesNotMatch(page, /bg-gradient|linear-gradient|radial-gradient/, `${name}不应使用渐变`);
    assert.doesNotMatch(page, /\b(?:indigo|purple|violet)-/, `${name}不应使用旧紫色品牌强调`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name}不应修改字距`);
    assert.doesNotMatch(page, /fixed inset-0/, `${name}不应手写全屏弹层`);
    assert.doesNotMatch(page, /\bh-screen\b/, `${name}不应使用固定屏幕高度`);
  }
});
