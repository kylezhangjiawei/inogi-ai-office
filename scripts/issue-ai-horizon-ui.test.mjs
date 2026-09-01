import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const moduleSource = source("src/app/IssueAiModule.tsx");
const listSource = source("src/app/issue-ai/ListView.tsx");
const detailSource = source("src/app/issue-ai/DetailView.tsx");
const drawerSource = source("src/app/issue-ai/NewIssueDrawer.tsx");
const menuSource = source("src/app/issue-ai/MenuSelect.tsx");
const badgeSource = source("src/app/issue-ai/badges.tsx");

const implementations = {
  "问题工作台外壳": moduleSource,
  "问题清单": listSource,
  "问题详情": detailSource,
  "新建问题抽屉": drawerSource,
  "问题筛选菜单": menuSource,
  "问题状态标识": badgeSource,
};

test("问题 AI 工作台接入统一 Horizon 页头与五项真实指标", () => {
  assert.match(moduleSource, /className="horizon-theme hz-page[^"]*rd-horizon-issue-ai/);
  assert.match(listSource, /<HorizonPageHeader/);
  assert.match(listSource, /<HorizonMetricGrid/);
  assert.equal((listSource.match(/<HorizonMetric\b/g) ?? []).length, 5);

  for (const field of ["stats?.total", "stats?.pending", "stats?.solved", "stats.reuseRate", "stats?.avgLocateHours"]) {
    assert.match(listSource, new RegExp(field.replace(/[?.]/g, "\\$&")), `指标应继续使用 ${field}`);
  }
});

test("问题清单、详情、相似复用与附件分析业务契约保持完整", () => {
  assert.match(moduleSource, /useSearchParams\(\)/);
  assert.match(moduleSource, /p\.set\("issue", id\)/);
  assert.match(moduleSource, /p\.delete\("issue"\)/);
  assert.match(listSource, /service\.stats\(\)/);
  assert.match(listSource, /service\.list\(query\)/);
  assert.match(drawerSource, /service\.create\(input\)/);
  assert.match(drawerSource, /service\.findSimilar\(input\)/);
  assert.match(drawerSource, /await service\.uploadAttachment\(/);
  assert.match(drawerSource, /await service\.processAttachment\(/);
  assert.match(drawerSource, /service\.adopt\(createdIssue\.id/);
  assert.match(detailSource, /service\.get\(issueId\)/);
  assert.match(detailSource, /service\.analyze\(issueId\)/);
  assert.match(detailSource, /service\.sendChat\(issueId/);
  assert.match(detailSource, /await service\.adopt\(issueId/);
  assert.match(detailSource, /await service\.resolveIssue\(issueId/);
  assert.match(detailSource, /await service\.uploadAttachment\(/);
  assert.match(detailSource, /await service\.processAttachment\(/);
});

test("新建问题使用项目 Sheet 原语并在关闭后归还真实触发点焦点", () => {
  assert.match(drawerSource, /<Sheet[\s\S]*open=\{open\}/);
  assert.match(drawerSource, /onOpenChange=\{\(nextOpen\) => \{[\s\S]*if \(!nextOpen\) onClose\(\)/);
  assert.match(drawerSource, /<SheetContent/);
  assert.match(drawerSource, /<SheetTitle/);
  assert.match(drawerSource, /<SheetDescription/);
  assert.match(drawerSource, /className="horizon-portal/);
  assert.match(listSource, /const drawerOpenerRef = React\.useRef<HTMLButtonElement \| null>\(null\)/);
  assert.equal((listSource.match(/onClick=\{openDrawer\}/g) ?? []).length, 2);
  assert.match(listSource, /returnFocusRef=\{drawerOpenerRef\}/);
  assert.match(drawerSource, /onCloseAutoFocus=\{\(event\) => \{/);
  assert.match(drawerSource, /event\.preventDefault\(\)/);
  assert.match(drawerSource, /if \(opener\?\.isConnected\) opener\.focus\(\)/);
  assert.doesNotMatch(drawerSource, /createPortal|FOCUSABLE_SELECTOR|document\.addEventListener\("keydown"/);
  assert.doesNotMatch(drawerSource, /fixed inset-0/);
});

test("问题 AI 页面清除旧紫色、暗色和高噪声交互视觉", () => {
  for (const [name, page] of Object.entries(implementations)) {
    assert.doesNotMatch(page, /\b(?:indigo|violet|purple|fuchsia|pink)-/, `${name}不应使用旧紫色强调`);
    assert.doesNotMatch(page, /\bdark:/, `${name}应保持 Horizon 浅色工作台`);
    assert.doesNotMatch(page, /bg-gradient|linear-gradient|radial-gradient/, `${name}不应使用渐变`);
    assert.doesNotMatch(page, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/, `${name}不应修改字距`);
    assert.doesNotMatch(page, /\btransition-all\b/, `${name}不应使用全属性过渡`);
    assert.doesNotMatch(page, /hover:-translate/, `${name}不应使用悬停位移`);
  }
});
