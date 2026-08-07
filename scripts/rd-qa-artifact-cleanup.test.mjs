import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildQaArtifactCleanupUpdates,
  qaCleanupTotal,
} from "../apps/api/scripts/qa/qa-artifact-cleanup.mjs";

test("QA cleanup removes test tasks and their derived records while preserving real data", () => {
  const values = {
    "rd.taskCategories": [{
      id: "cat",
      children: [{ id: "sub", tasks: [
        { task_id: "real", title: "真实任务", subtasks: [] },
        { task_id: "qa", title: "qa-rd-主链路任务", subtasks: [{ task_id: "real-child", title: "真实子任务" }] },
      ] }],
    }],
    "rd.taskProgressNotes": {
      real: [{ text: "真实留痕" }],
      qa: [{ text: "qa-rd 自动化测试留痕" }],
    },
    "rd.taskCompletionScores": {
      real: { summary: "真实评分" },
      qa: { _debug: { prompt: "qa-rd-主链路任务" } },
    },
    "rd.dailyReports": [{ id: "real" }, { id: "qa", summary: "qa-collab-主链路任务" }],
    "rd.messages": [{ id: "real" }, { id: "qa", subject: "[任务删除] qa-rd-主链路任务" }],
    "i18n.content-cache": { real: { source: "真实任务" }, qa: { source: "qa-rd-主链路任务" } },
  };

  const { updates, summary } = buildQaArtifactCleanupUpdates(values);
  assert.deepEqual(updates["rd.taskCategories"][0].children[0].tasks.map((task) => task.task_id), ["real", "real-child"]);
  assert.deepEqual(Object.keys(updates["rd.taskProgressNotes"]), ["real"]);
  assert.deepEqual(Object.keys(updates["rd.taskCompletionScores"]), ["real"]);
  assert.deepEqual(updates["rd.dailyReports"].map((report) => report.id), ["real"]);
  assert.deepEqual(updates["rd.messages"].map((message) => message.id), ["real"]);
  assert.deepEqual(Object.keys(updates["i18n.content-cache"]), ["real"]);
  assert.equal(summary.tasks, 1);
  assert.ok(qaCleanupTotal(summary) >= 6);
});
