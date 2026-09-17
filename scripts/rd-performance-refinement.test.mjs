import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const panel = source("src/app/RDPerformanceAssessmentPanel.tsx");
const proposal = source("src/app/RDProjectProposalDialog.tsx");

test("团队绩效刷新采用最新请求并在失败时保留上一版结果", () => {
  assert.match(panel, /const requestId = \+\+requestRef\.current/);
  assert.match(panel, /requestId === requestRef\.current/);
  assert.match(panel, /return \(\) => \{ requestRef\.current \+= 1; \}/);
  assert.match(panel, /当前继续显示上一次成功结果/);
  assert.match(panel, /\{data \? \(/);
  assert.doesNotMatch(panel, /mountedRef/);
});

test("团队绩效表格与状态反馈具备完整语义和恢复动作", () => {
  assert.match(panel, /aria-labelledby="rd-performance-assessment-title"/);
  assert.match(panel, /aria-busy=\{loading\}/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /研发团队绩效排名与评分明细/);
  assert.equal((panel.match(/scope="col"/g) ?? []).length, 7);
  assert.match(panel, /<th scope="row"/);
  assert.match(panel, /重新统计/);
  assert.equal((panel.match(/w-\[calc\(100vw-2rem\)\]/g) ?? []).length, 2);
  assert.match(panel, /w-\[calc\(100vw-2rem\)\] max-w-80 p-3/);
  assert.match(panel, /w-\[calc\(100vw-2rem\)\] max-w-96 p-3/);
  assert.doesNotMatch(panel, /<PopoverContent[^>]+className="w-(?:auto|96) p-3"/);
});

test("研发绩效与立项附属面清除紫靛和装饰性字距", () => {
  const forbidden = /\b(?:indigo|purple|violet|fuchsia|pink)-|\btracking-|\buppercase\b|shadow-\[/i;
  assert.doesNotMatch(panel, forbidden);
  assert.doesNotMatch(proposal, /\btracking-|\buppercase\b/);
  assert.match(panel, /primary/);
  assert.match(panel, /text-balance/);
  assert.match(panel, /text-pretty/);
});
