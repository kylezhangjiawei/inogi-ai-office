import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = source("src/app/RDSheetPage.tsx");
const app = source("src/app/App.tsx");

test("研发数据表保持真实路由并使用 Horizon 外壳与页内二级标题", () => {
  assert.match(app, /page:rd-sheet[\s\S]{0,180}<RDSheetPage \/>[\s\S]{0,100}page:rd-sheet/);
  assert.match(page, /<main[\s\S]{0,180}className="horizon-theme hz-page rd-horizon-module rd-horizon-sheet/);
  assert.match(page, /<HorizonPageHeader/);
  assert.match(page, /titleLevel=\{2\}/);
  assert.match(page, /title=\{t\("研发数据表"\)\}/);
  assert.match(page, /eyebrow=\{t\("研发协同 \/ 共享数据资产"\)\}/);
  assert.match(page, /#002fa7/);
});

test("六类确认流程统一使用可异步等待的标准 AlertDialog", () => {
  assert.equal((page.match(/requestConfirmation\(\{/g) ?? []).length, 6);
  assert.match(page, /return new Promise<boolean>/);
  assert.match(page, /confirmationResolverRef\.current = resolve/);
  assert.match(page, /<AlertDialog[\s\S]{0,220}open=\{Boolean\(confirmation\)\}/);
  assert.match(page, /<AlertDialogContent className="horizon-portal rd-horizon-sheet-confirm-dialog">/);
  assert.match(page, /<AlertDialogTitle/);
  assert.match(page, /<AlertDialogDescription/);
  assert.match(page, /<AlertDialogCancel/);
  assert.match(page, /<AlertDialogAction/);
  assert.doesNotMatch(page, /window\.confirm\s*\(/);
  assert.doesNotMatch(page, /fixed\s+inset-0/);
});

test("草稿、离开、整簿导入、冲突覆盖、撤销与历史恢复文案和分支均保留", () => {
  for (const wording of [
    "恢复本地未保存草稿",
    "使用服务器版本",
    "放弃改动并离开",
    "导入并替换整个工作簿",
    "覆盖服务器版本",
    "撤销全部未保存改动",
    "恢复历史版本",
  ]) {
    assert.match(page, new RegExp(wording));
  }

  for (const contract of [
    /loadRdSheetDraft\(\)/,
    /baseUpdatedAtRef\.current = draft\.base_updated_at \?\? res\.updated_at/,
    /blocker\.proceed\(\)/,
    /blocker\.reset\(\)/,
    /xlsxToUniverSnapshot\(buf, WORKBOOK_ID\)/,
    /setSnapshot\(snap as Snapshot\)/,
    /status === 409/,
    /force = true/,
    /if \(dirty\) await clearRdSheetDraft\(\);\s*load\(\)/,
    /await restoreRdSheetVersion\(version\.id\)/,
    /await restoreRdSheetVersion\(version\.id\)[\s\S]{0,220}await clearRdSheetDraft\(\)[\s\S]{0,140}load\(\)/,
  ]) {
    assert.match(page, contract);
  }
});

test("工作簿 API、乐观锁、草稿兜底和 Univer 编辑器契约未改变", () => {
  for (const contract of [
    /fetchRdSheetWorkbook\(controller\.signal\)/,
    /externalizeSnapshotImages\(/,
    /saveRdSheetWorkbook\(snap, \{/,
    /baseUpdatedAt: baseUpdatedAtRef\.current/,
    /saveRdSheetDraft\(\{/,
    /window\.setInterval\(\(\) => void writeDraft\(\), 30_000\)/,
    /window\.addEventListener\("beforeunload", handler\)/,
    /fetchRdSheetVersions\(\)/,
    /const requestId = versionsRequestIdRef\.current \+ 1/,
    /versionsRequestIdRef\.current !== requestId/,
    /历史版本读取失败/,
    /onClick=\{\(\) => void loadVersions\(\)\}/,
    /<LazyUniverEditor/,
    /readOnly=\{!canEdit \|\| saving\}/,
    /const saveRevision = editRevisionRef\.current/,
    /structuredClone\(currentSnapshot\)/,
    /editRevisionRef\.current \+= 1/,
  ]) {
    assert.match(page, contract);
  }
});

test("页面清除旧紫靛装饰并保留加载、提示与错误语义", () => {
  const forbidden = [
    [/gradient/i, "渐变"],
    [/\b(?:indigo|purple|violet|fuchsia|pink)-/i, "旧紫靛色"],
    [/\btracking-\b|\buppercase\b/, "装饰性字距"],
    [/(?:hover|group-hover):-?translate|\btransition-all\b/, "悬停位移或全属性过渡"],
    [/\bh-screen\b/, "固定视口高度"],
  ];
  for (const [pattern, label] of forbidden) assert.doesNotMatch(page, pattern, `不应包含${label}`);

  assert.match(page, /aria-busy=\{loading \|\| saving \|\| importing \|\| converting\}/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(page, /role="alert"/);
  assert.match(page, /min-h-\[480px\]/);
  assert.match(page, /min-w-0/);
});
