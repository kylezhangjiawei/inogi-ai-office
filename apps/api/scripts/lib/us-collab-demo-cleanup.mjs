export const DEMO_TASK_PREFIXES = ["ustask-", "pzdemo-"];
export const DEMO_PERSON_PREFIX = "uscp-";
export const DEMO_CATEGORY_IDS = new Set(["uscat-fda", "uscat-local", "uscat-support"]);

export function isDemoTaskId(value) {
  const id = typeof value === "string" ? value : "";
  return DEMO_TASK_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function containsDemoReference(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return DEMO_TASK_PREFIXES.some((prefix) => serialized.includes(prefix));
}

function cleanTaskList(tasks, stats) {
  const output = [];
  for (const raw of Array.isArray(tasks) ? tasks : []) {
    if (!raw || typeof raw !== "object") continue;
    const cleanedSubtasks = cleanTaskList(raw.subtasks, stats);
    if (isDemoTaskId(raw.task_id)) {
      stats.tasks += 1;
      // 若有人把真实任务挂到了演示任务下面，提升真实子任务而不是一并删除。
      output.push(...cleanedSubtasks);
      continue;
    }
    output.push({ ...raw, subtasks: cleanedSubtasks });
  }
  return output;
}

function categoryHasTasks(category) {
  return (category?.children ?? []).some((child) => Array.isArray(child?.tasks) && child.tasks.length > 0);
}

export function cleanTaskCategories(value) {
  const stats = { tasks: 0, categories: 0 };
  const categories = [];
  for (const rawCategory of Array.isArray(value) ? value : []) {
    if (!rawCategory || typeof rawCategory !== "object") continue;
    const category = {
      ...rawCategory,
      children: (Array.isArray(rawCategory.children) ? rawCategory.children : [])
        .filter((child) => child && typeof child === "object")
        .map((child) => ({ ...child, tasks: cleanTaskList(child.tasks, stats) })),
    };
    if (DEMO_CATEGORY_IDS.has(String(category.id ?? "")) && !categoryHasTasks(category)) {
      stats.categories += 1;
      continue;
    }
    categories.push(category);
  }
  return { value: categories, stats };
}

export function cleanPeople(value) {
  const people = Array.isArray(value) ? value : [];
  const next = people.filter((person) => !String(person?.id ?? "").startsWith(DEMO_PERSON_PREFIX));
  return { value: next, removed: people.length - next.length };
}

export function cleanProgressNotes(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = {};
  let removed = 0;
  for (const [taskId, notes] of Object.entries(source)) {
    const list = Array.isArray(notes) ? notes : [];
    if (isDemoTaskId(taskId)) {
      removed += list.length;
      continue;
    }
    const kept = list.filter((note) => !containsDemoReference(note));
    removed += list.length - kept.length;
    if (kept.length > 0) next[taskId] = kept;
  }
  return { value: next, removed };
}

export function cleanReferenceArray(value) {
  const list = Array.isArray(value) ? value : [];
  const next = list.filter((item) => !containsDemoReference(item));
  return { value: next, removed: list.length - next.length };
}

export function cleanMessages(value) {
  const list = Array.isArray(value) ? value : [];
  const next = list.filter((message) => {
    if (String(message?.id ?? "").startsWith("msg-pzdemo-")) return false;
    if (String(message?.recipient_person_id ?? "").startsWith(DEMO_PERSON_PREFIX)) return false;
    return !containsDemoReference(message);
  });
  return { value: next, removed: list.length - next.length };
}

function cleanReferenceTree(value, stats) {
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      if (containsDemoReference(item)) {
        stats.removed += 1;
        continue;
      }
      next.push(cleanReferenceTree(item, stats));
    }
    return next;
  }
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (isDemoTaskId(key) || containsDemoReference(key)) {
      stats.removed += 1;
      continue;
    }
    next[key] = cleanReferenceTree(item, stats);
  }
  return next;
}

export function cleanNoteReads(value) {
  const stats = { removed: 0 };
  return { value: cleanReferenceTree(value, stats), removed: stats.removed };
}

export function cleanDirectorDashboard(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  let removed = 0;
  const personLoads = (Array.isArray(source.personLoads) ? source.personLoads : [])
    .filter((person) => {
      const isDemo = String(person?.id ?? "").startsWith(DEMO_PERSON_PREFIX);
      if (isDemo) removed += 1;
      return !isDemo;
    })
    .map((person) => {
      const rawTaskIds = Array.isArray(person?.task_ids) ? person.task_ids : [];
      const rawTaskTitles = Array.isArray(person?.tasks) ? person.tasks : [];
      const keptIndexes = rawTaskIds
        .map((id, index) => ({ id, index }))
        .filter(({ id }) => !isDemoTaskId(id));
      const taskIds = keptIndexes.map(({ id }) => id);
      const taskTitles = keptIndexes
        .map(({ index }) => rawTaskTitles[index])
        .filter((title) => typeof title === "string");
      return {
        ...person,
        task_ids: taskIds,
        tasks: taskTitles,
        task_count: taskIds.length,
        blocked_count: taskIds.length === 0 ? 0 : person.blocked_count,
      };
    });
  const stripDemoItems = (items) => (Array.isArray(items) ? items : []).filter((item) => {
    const demo = containsDemoReference(item);
    if (demo) removed += 1;
    return !demo;
  });
  const categoryProgress = (Array.isArray(source.categoryProgress) ? source.categoryProgress : []).filter((item) => {
    const demo = DEMO_CATEGORY_IDS.has(String(item?.id ?? ""));
    if (demo) removed += 1;
    return !demo;
  });
  return {
    value: {
      ...source,
      personLoads,
      blockedTasks: stripDemoItems(source.blockedTasks),
      pendingAssign: stripDemoItems(source.pendingAssign),
      categoryProgress,
    },
    removed,
  };
}

export function buildDemoCleanupUpdates(values) {
  const taskCategories = cleanTaskCategories(values["rdws.us-collab.taskCategories"]);
  const people = cleanPeople(values["rdws.us-collab.people"]);
  const progressNotes = cleanProgressNotes(values["rdws.us-collab.taskProgressNotes"]);
  const dailyReports = cleanReferenceArray(values["rdws.us-collab.dailyReports"]);
  const noteReads = cleanNoteReads(values["rdws.us-collab.noteReads"]);
  const knowledgeEntries = cleanReferenceArray(values["rdws.us-collab.knowledgeEntries"]);
  const auditLogs = cleanReferenceArray(values["rdws.us-collab.auditLogs"]);
  const messages = cleanMessages(values["rd.messages"]);
  const directorDashboard = cleanDirectorDashboard(values["rdws.us-collab.directorDashboard"]);

  return {
    updates: {
      "rdws.us-collab.taskCategories": taskCategories.value,
      "rdws.us-collab.people": people.value,
      "rdws.us-collab.taskProgressNotes": progressNotes.value,
      "rdws.us-collab.dailyReports": dailyReports.value,
      "rdws.us-collab.noteReads": noteReads.value,
      "rdws.us-collab.knowledgeEntries": knowledgeEntries.value,
      "rdws.us-collab.auditLogs": auditLogs.value,
      "rd.messages": messages.value,
      "rdws.us-collab.directorDashboard": directorDashboard.value,
    },
    summary: {
      tasks: taskCategories.stats.tasks,
      categories: taskCategories.stats.categories,
      people: people.removed,
      progressNotes: progressNotes.removed,
      dailyReports: dailyReports.removed,
      noteReads: noteReads.removed,
      knowledgeEntries: knowledgeEntries.removed,
      auditLogs: auditLogs.removed,
      messages: messages.removed,
      dashboardReferences: directorDashboard.removed,
    },
  };
}
