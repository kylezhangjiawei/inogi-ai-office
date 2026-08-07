export const QA_ARTIFACT_PATTERN = /qa-(?:rd|collab|Owner)|QA (?:超级管理员|协同成员|研发成员|协同主管|人员管理员)/i;

export const QA_CLEANUP_KEYS = [
  "rd.taskCategories",
  "rdws.us-collab.taskCategories",
  "rd.taskProgressNotes",
  "rdws.us-collab.taskProgressNotes",
  "rd.taskCompletionScores",
  "rdws.us-collab.taskCompletionScores",
  "rd.dailyReports",
  "rdws.us-collab.dailyReports",
  "rd.auditLogs",
  "rdws.us-collab.auditLogs",
  "rd.messages",
  "i18n.content-cache",
];

export function containsQaArtifact(value) {
  return QA_ARTIFACT_PATTERN.test(typeof value === "string" ? value : JSON.stringify(value ?? null));
}

function cleanTaskList(tasks, summary) {
  const next = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task !== "object") continue;
    const subtasks = cleanTaskList(task.subtasks, summary);
    if (containsQaArtifact(task.title) || containsQaArtifact(task.primary_owner)) {
      summary.tasks += 1;
      // 保留意外挂在测试父任务下的真实子任务。
      next.push(...subtasks);
      continue;
    }
    next.push({ ...task, subtasks });
  }
  return next;
}

function cleanCategories(value, summary) {
  return (Array.isArray(value) ? value : [])
    .filter((category) => category && typeof category === "object")
    .map((category) => ({
      ...category,
      children: (Array.isArray(category.children) ? category.children : [])
        .filter((child) => child && typeof child === "object")
        .map((child) => ({ ...child, tasks: cleanTaskList(child.tasks, summary) })),
    }));
}

function cleanArray(value, summary, key) {
  const list = Array.isArray(value) ? value : [];
  const next = list.filter((item) => !containsQaArtifact(item));
  summary.records[key] = list.length - next.length;
  return next;
}

function cleanObject(value, summary, key) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = {};
  let removed = 0;
  for (const [entryKey, entryValue] of Object.entries(source)) {
    if (containsQaArtifact(entryKey) || containsQaArtifact(entryValue)) {
      removed += 1;
      continue;
    }
    next[entryKey] = entryValue;
  }
  summary.records[key] = removed;
  return next;
}

export function buildQaArtifactCleanupUpdates(values) {
  const summary = { tasks: 0, records: {} };
  const updates = {};
  for (const key of QA_CLEANUP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const value = values[key];
    if (key.endsWith("taskCategories")) {
      updates[key] = cleanCategories(value, summary);
    } else if (
      key.endsWith("taskProgressNotes") ||
      key.endsWith("taskCompletionScores") ||
      key === "i18n.content-cache"
    ) {
      updates[key] = cleanObject(value, summary, key);
    } else {
      updates[key] = cleanArray(value, summary, key);
    }
  }
  return { updates, summary };
}

export function qaCleanupTotal(summary) {
  return summary.tasks + Object.values(summary.records).reduce((sum, value) => sum + Number(value || 0), 0);
}
