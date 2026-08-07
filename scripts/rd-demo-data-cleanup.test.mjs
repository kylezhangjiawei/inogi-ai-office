import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDemoCleanupUpdates } from "../apps/api/scripts/lib/us-collab-demo-cleanup.mjs";

test("demo cleanup removes only prefixed demo records and preserves real collaboration data", () => {
  const values = {
    "rdws.us-collab.taskCategories": [
      {
        id: "cat-real",
        label: "真实分类",
        children: [{
          id: "sub-real",
          tasks: [
            { task_id: "real-1", title: "真实任务", subtasks: [] },
            { task_id: "ustask-001", title: "演示任务", subtasks: [{ task_id: "real-child", title: "真实子任务" }] },
          ],
        }],
      },
      { id: "uscat-support", label: "Demo", children: [{ id: "demo-sub", tasks: [{ task_id: "pzdemo-001" }] }] },
    ],
    "rdws.us-collab.people": [{ id: "real-person", name: "真实成员" }, { id: "uscp-mike", name: "Mike" }],
    "rdws.us-collab.taskProgressNotes": {
      "real-1": [{ id: "note-real" }, { id: "note-pzdemo-reference" }],
      "pzdemo-001": [{ id: "note-demo" }],
    },
    "rdws.us-collab.dailyReports": [{ id: "report-real" }, { id: "report-demo", task_id: "ustask-001" }],
    "rdws.us-collab.noteReads": { user: { "real-1": "read", "pzdemo-001": "read" } },
    "rdws.us-collab.knowledgeEntries": [{ id: "kb-real" }, { id: "kb-demo", source_task_id: "pzdemo-001" }],
    "rdws.us-collab.auditLogs": [{ id: "log-real" }, { id: "log-demo", resource: { id: "ustask-001" } }],
    "rd.messages": [{ id: "msg-real" }, { id: "msg-pzdemo-1" }, { id: "msg-demo-user", recipient_person_id: "uscp-mike" }],
    "rdws.us-collab.directorDashboard": {
      personLoads: [
        { id: "real-person", task_ids: ["real-1", "pzdemo-001"], task_count: 2, tasks: ["真实任务", "演示任务"] },
        { id: "uscp-mike", task_ids: ["ustask-001"], task_count: 1 },
      ],
      blockedTasks: [{ task_id: "real-1" }, { task_id: "ustask-001" }],
      pendingAssign: [],
      categoryProgress: [{ id: "cat-real" }, { id: "uscat-support" }],
    },
  };

  const { updates, summary } = buildDemoCleanupUpdates(values);
  const realTasks = updates["rdws.us-collab.taskCategories"][0].children[0].tasks;
  assert.deepEqual(realTasks.map((task) => task.task_id), ["real-1", "real-child"]);
  assert.equal(updates["rdws.us-collab.taskCategories"].some((category) => category.id === "uscat-support"), false);
  assert.deepEqual(updates["rdws.us-collab.people"].map((person) => person.id), ["real-person"]);
  assert.deepEqual(Object.keys(updates["rdws.us-collab.taskProgressNotes"]), ["real-1"]);
  assert.deepEqual(updates["rdws.us-collab.taskProgressNotes"]["real-1"].map((note) => note.id), ["note-real"]);
  assert.deepEqual(updates["rdws.us-collab.dailyReports"].map((report) => report.id), ["report-real"]);
  assert.deepEqual(Object.keys(updates["rdws.us-collab.noteReads"].user), ["real-1"]);
  assert.deepEqual(updates["rd.messages"].map((message) => message.id), ["msg-real"]);
  assert.deepEqual(updates["rdws.us-collab.directorDashboard"].personLoads.map((person) => person.id), ["real-person"]);
  assert.deepEqual(updates["rdws.us-collab.directorDashboard"].personLoads[0].task_ids, ["real-1"]);
  assert.deepEqual(updates["rdws.us-collab.directorDashboard"].personLoads[0].tasks, ["真实任务"]);
  assert.equal(summary.tasks, 2);
  assert.equal(summary.people, 1);
});
