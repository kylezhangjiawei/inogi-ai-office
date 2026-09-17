import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailSource = await readFile(
  new URL("../src/app/UsCollabTaskDetailPage.tsx", import.meta.url),
  "utf8",
);
const horizonSource = await readFile(
  new URL("../src/app/components/horizon/HorizonPage.tsx", import.meta.url),
  "utf8",
);

test("协同任务详情使用标准 Horizon 页面层级与可恢复状态", () => {
  assert.match(detailSource, /horizon-theme hz-page rd-horizon-module rd-horizon-us-detail/);
  assert.match(detailSource, /<HorizonPageHeader/);
  assert.match(detailSource, /eyebrow=\{t\("中美协同 · 任务档案"\)\}/);
  assert.match(detailSource, /<HorizonEmptyState[\s\S]*title=\{t\("无法打开协同任务"\)\}/);
  assert.match(detailSource, /onClick=\{\(\) => void loadTask\(\)\}/);
  assert.doesNotMatch(detailSource, />🔒</);
});

test("标题支持自动翻译节点并保留任务序列与优先级交互", () => {
  assert.match(horizonSource, /title: React\.ReactNode/);
  assert.match(detailSource, /const displayTaskTitle = task\.title\?\.trim\(\) \|\| t\("未命名协同任务"\)/);
  assert.match(detailSource, /title=\{<AutoTranslatedText text=\{displayTaskTitle\} \/>\}/);
  assert.match(detailSource, /onClick=\{\(\) => gotoSeq\(-1\)\}/);
  assert.match(detailSource, /onClick=\{\(\) => gotoSeq\(1\)\}/);
  assert.match(detailSource, /onValueChange=\{\(value\) => void savePriority/);
});

test("编辑任务信息使用标准 Dialog 与具名受控表单", () => {
  assert.match(detailSource, /<Dialog open onOpenChange=/);
  assert.match(detailSource, /horizon-theme horizon-portal rd-horizon-us-detail-dialog/);
  assert.match(detailSource, /<DialogDescription>/);
  assert.match(detailSource, /htmlFor="us-collab-task-title"/);
  assert.match(detailSource, /id="us-collab-task-title"[\s\S]*value=\{title\}[\s\S]*onChange=/);
  assert.match(detailSource, /htmlFor="us-collab-task-description"/);
  assert.match(detailSource, /ref=\{editTaskButtonRef\}/);
  assert.match(detailSource, /requestAnimationFrame\(\(\) => editTaskButtonRef\.current\?\.focus\(\)\)/);
  assert.doesNotMatch(detailSource, /className="fixed inset-0/);
});

test("协同任务详情移除旧靛紫视觉与位移悬停", () => {
  assert.doesNotMatch(detailSource, /(?:indigo|purple|violet)-/);
  assert.doesNotMatch(detailSource, /bg-gradient/);
  assert.doesNotMatch(detailSource, /hover:-translate/);
  assert.match(detailSource, /primary/);
});
