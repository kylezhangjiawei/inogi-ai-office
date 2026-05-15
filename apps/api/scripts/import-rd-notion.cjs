#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const csvPath = process.argv[2];

if (!csvPath) {
  console.error("Usage: node apps/api/scripts/import-rd-notion.cjs <csv-path>");
  process.exit(1);
}

const H = {
  type: "\u4efb\u52a1\u5c5e\u6027",
  title: "\u4efb\u52a1\u540d\u79f0",
  status: "\u72b6\u6001",
  priority: "\u4f18\u5148\u7ea7",
  owner: "\u8d1f\u8d23\u4eba",
  start: "\u5f00\u59cb\u65e5\u671f",
  end: "\u7ed3\u675f\u65e5\u671f",
  className: "\u5206\u7c7b",
  note: "\u5907\u6ce8",
  parent: "\u7236\u4efb\u52a1",
  valveGroup: "\u7535\u78c1\u9600\u5927\u7c7b\u9879",
};

const ZH = {
  done: "\u5df2\u5b8c\u6210",
  doing: "\u8fdb\u884c\u4e2d",
  delayed: "\u5df2\u5ef6\u671f",
  high: "\u9ad8",
  low: "\u4f4e",
  rdTeam: "\u7814\u53d1\u56e2\u961f",
  purchasing: "\u91c7\u8d2d",
  pendingOwner: "\u5f85\u6307\u6d3e",
  uncategorized: "\u672a\u5206\u7c7b\u4efb\u52a1",
  valveProject: "\u7535\u78c1\u9600\u4e13\u9879",
  generalTask: "\u7efc\u5408\u4efb\u52a1",
  reviewer: "\u8003\u6838\u4eba",
  rdDept: "\u7814\u53d1\u90e8",
  purchasingDept: "\u91c7\u8d2d\u90e8",
  rdMember: "\u7814\u53d1\u4eba\u5458",
  rdTeamLead: "\u56e2\u961f\u8d1f\u8d23\u4eba",
  purchasingContact: "\u91c7\u8d2d\u5bf9\u63a5",
  source: "\u6765\u6e90\uff1aNotion \u7814\u53d1\u90e8\u9879\u76ee\u8fdb\u5ea6\u8868",
  importActor: "\u7cfb\u7edf\u5bfc\u5165",
  importRole: "Notion \u521d\u59cb\u5316",
  created: "\u4ece Notion CSV \u521d\u59cb\u5316\u4efb\u52a1",
  note: "\u5907\u6ce8",
  parent: "\u7236\u4efb\u52a1",
  start: "\u5f00\u59cb",
  end: "\u7ed3\u675f",
  noDueDate: "\u5f85\u660e\u786e",
  statusDoing: "\u8fdb\u884c\u4e2d",
  statusBlocked: "\u53d7\u963b",
  nextAction: "\u6309 Notion \u4efb\u52a1\u8868\u8ddf\u8fdb\u4e0b\u4e00\u6b65\u95ed\u73af",
  deliverable: "\u4efb\u52a1\u7ed3\u679c\u6216\u9a8c\u8bc1\u8bb0\u5f55",
  blocker: "\u9700\u8865\u5145\u963b\u585e\u539f\u56e0\u6216\u4f9d\u8d56\u65b9",
  todoPrefix: "\u8ddf\u8fdb",
  blockedReason: "\u72b6\u6001\u5df2\u5ef6\u671f\uff0c\u9700\u8865\u5145\u539f\u56e0\u5e76\u91cd\u65b0\u786e\u8ba4\u8ba1\u5212",
  importedNow: "\u5df2\u5bfc\u5165\u7814\u53d1\u4efb\u52a1\u6a21\u5757",
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      if (source[index + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((header) => clean(header).replace(/^\uFEFF/, ""));
  return rows
    .filter((item) => item.some((cell) => clean(cell)))
    .map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] ?? ""])));
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function get(row, key) {
  return clean(row[key]);
}

function stripNotionRelation(value) {
  return clean(value).replace(/\s*\(https?:\/\/[^)]+\)\s*$/i, "").trim();
}

function stripProjectMarker(value) {
  return clean(value).replace(/^\u3010[^\u3011]+\u3011\s*/u, "").trim();
}

function parseDate(value) {
  const raw = clean(value);
  if (!raw) return undefined;
  const match = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function durationDays(startDate, endDate) {
  if (!startDate || !endDate) return undefined;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.round((end - start) / 86400000) + 1;
}

function statusOf(row) {
  if (!get(row, H.owner)) return "pending_assign";
  const status = get(row, H.status);
  if (status === ZH.done) return "completed";
  if (status === ZH.doing) return "in_progress";
  if (status === ZH.delayed) return "paused_blocked";
  return "draft";
}

function progressOf(status) {
  if (status === "completed") return 100;
  if (status === "in_progress") return 65;
  if (status === "paused_blocked") return 35;
  return 0;
}

function priorityOf(row) {
  const priority = get(row, H.priority);
  if (priority === ZH.high) return "high";
  if (priority === ZH.low) return "low";
  return "medium";
}

function primaryCategoryOf(row) {
  const explicitType = get(row, H.type);
  if (explicitType) return explicitType;
  const title = get(row, H.title);
  if (get(row, H.valveGroup) || stripNotionRelation(row[H.parent]) || /^\u3010[^\u3011]+\u3011/u.test(title)) {
    return ZH.valveProject;
  }
  return ZH.uncategorized;
}

function subCategoryOf(row) {
  const valveGroup = get(row, H.valveGroup);
  if (valveGroup) return valveGroup;
  const className = get(row, H.className);
  if (className) return className;
  const parent = stripNotionRelation(row[H.parent]);
  if (parent) return stripProjectMarker(parent) || parent;
  const projectTitle = stripProjectMarker(get(row, H.title));
  if (projectTitle && projectTitle !== get(row, H.title)) return projectTitle;
  return ZH.generalTask;
}

function categoryPathOf(row, primary, sub) {
  const parts = [primary, sub];
  const className = get(row, H.className);
  if (className && className !== primary && className !== sub) parts.push(className);
  return parts.join(" / ");
}

function stableId(prefix, value) {
  let hash = 2166136261;
  for (const char of clean(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function extractCollaborators(row, owner) {
  const note = get(row, H.note);
  if (!note) return [];
  const marker = ZH.reviewer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = note.match(new RegExp(`${marker}\\s*[:\\uFF1A]\\s*([^;\\uFF1B\\n]+)`, "u"));
  if (!match) return [];
  return match[1]
    .split(/[,\u3001\uFF0C/\\s]+/u)
    .map(clean)
    .filter((name) => name && name !== owner)
    .map((name) => ({ id: stableId("rd-collab", name), name, role: ZH.reviewer }));
}

function descriptionOf(row, startDate, endDate) {
  const parts = [ZH.source];
  const note = get(row, H.note);
  const parent = stripNotionRelation(row[H.parent]);
  if (note) parts.push(`${ZH.note}: ${note}`);
  if (parent) parts.push(`${ZH.parent}: ${parent}`);
  if (startDate) parts.push(`${ZH.start}: ${startDate}`);
  if (endDate) parts.push(`${ZH.end}: ${endDate}`);
  return parts.join("\n");
}

function taskFromRow(row, index) {
  const status = statusOf(row);
  const owner = get(row, H.owner) || ZH.pendingOwner;
  const primary = primaryCategoryOf(row);
  const sub = subCategoryOf(row);
  const startDate = parseDate(row[H.start]);
  const endDate = parseDate(row[H.end]);
  const priority = priorityOf(row);
  const task = {
    task_id: `RD-NOTION-${String(index + 1).padStart(3, "0")}`,
    title: get(row, H.title) || `Notion Task ${index + 1}`,
    description: descriptionOf(row, startDate, endDate),
    primary_owner: owner,
    collaborators: extractCollaborators(row, owner),
    status,
    progress: progressOf(status),
    ai_priority: priority,
    final_priority: priority,
    final_duration: durationDays(startDate, endDate),
    category_path: categoryPathOf(row, primary, sub),
    archived: false,
    attachments: stripNotionRelation(row[H.parent]) ? 1 : 0,
    due_date: endDate,
    ai_modified: false,
  };
  return { task, primary, sub, raw: row };
}

function buildCategories(mappedTasks) {
  const colors = [
    "bg-blue-400",
    "bg-emerald-400",
    "bg-violet-400",
    "bg-amber-400",
    "bg-pink-400",
    "bg-cyan-400",
    "bg-indigo-400",
    "bg-rose-400",
    "bg-teal-400",
  ];
  const categories = new Map();
  for (const item of mappedTasks) {
    const categoryId = stableId("rd-cat", item.primary);
    const subId = stableId("rd-sub", `${item.primary}/${item.sub}`);
    if (!categories.has(item.primary)) {
      categories.set(item.primary, {
        id: categoryId,
        label: item.primary,
        color: colors[categories.size % colors.length],
        children: new Map(),
      });
    }
    const category = categories.get(item.primary);
    if (!category.children.has(item.sub)) {
      category.children.set(item.sub, {
        id: subId,
        label: item.sub,
        tasks: [],
      });
    }
    category.children.get(item.sub).tasks.push(item.task);
  }
  return Array.from(categories.values()).map((category) => ({
    id: category.id,
    label: category.label,
    children: Array.from(category.children.values()),
  }));
}

function buildCategoryProgress(categories) {
  const colors = [
    "bg-blue-400",
    "bg-emerald-400",
    "bg-violet-400",
    "bg-amber-400",
    "bg-pink-400",
    "bg-cyan-400",
    "bg-indigo-400",
    "bg-rose-400",
    "bg-teal-400",
  ];
  return categories.map((category, index) => {
    const tasks = category.children.flatMap((child) => child.tasks);
    return {
      id: category.id,
      label: category.label,
      total: tasks.length,
      completed: tasks.filter((task) => task.status === "completed").length,
      in_progress: tasks.filter((task) => task.status === "in_progress").length,
      blocked: tasks.filter((task) => task.status === "paused_blocked").length,
      color: colors[index % colors.length],
    };
  });
}

function buildPeople(mappedTasks) {
  const owners = new Map();
  for (const { task } of mappedTasks) {
    if (!task.primary_owner || task.primary_owner === ZH.pendingOwner) continue;
    const current = owners.get(task.primary_owner) ?? { tasks: [], activeTasks: [], completed: 0, blocked: 0 };
    current.tasks.push(task);
    if (!["completed", "pending_assign", "archived"].includes(task.status)) current.activeTasks.push(task);
    if (task.status === "completed") current.completed += 1;
    if (task.status === "paused_blocked") current.blocked += 1;
    owners.set(task.primary_owner, current);
  }
  return Array.from(owners.entries())
    .sort((a, b) => b[1].activeTasks.length - a[1].activeTasks.length || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .map(([name, stats]) => {
      const isPurchasing = name === ZH.purchasing;
      const isTeam = name === ZH.rdTeam;
      return {
        id: stableId("rd-person", name),
        name,
        position: isTeam ? ZH.rdTeamLead : isPurchasing ? ZH.purchasingContact : ZH.rdMember,
        department: isPurchasing ? ZH.purchasingDept : ZH.rdDept,
        status: "active",
        max_tasks: Math.max(8, stats.activeTasks.length + 2),
        joined_at: "2026-05-15",
      };
    });
}

function buildPersonLoads(people, mappedTasks) {
  const taskByOwner = new Map();
  for (const { task } of mappedTasks) {
    if (!taskByOwner.has(task.primary_owner)) taskByOwner.set(task.primary_owner, []);
    taskByOwner.get(task.primary_owner).push(task);
  }
  return people.map((person) => {
    const tasks = taskByOwner.get(person.name) ?? [];
    const activeTasks = tasks.filter((task) => !["completed", "pending_assign", "archived"].includes(task.status));
    const completed = tasks.filter((task) => task.status === "completed").length;
    const blocked = tasks.filter((task) => task.status === "paused_blocked").length;
    const avgCompletion = tasks.length
      ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
      : 0;
    return {
      ...person,
      task_count: activeTasks.length,
      tasks: activeTasks.slice(0, 8).map((task) => task.title),
      task_ids: activeTasks.slice(0, 12).map((task) => task.task_id),
      completed_this_month: completed,
      blocked_count: blocked,
      avg_completion: avgCompletion,
      recent_activities: tasks.slice(0, 3).map((task) => ({
        date: "2026-05-15",
        action: `${task.task_id} ${ZH.importedNow}`,
        actor: ZH.importActor,
      })),
    };
  });
}

function buildBlockedTasks(mappedTasks) {
  return mappedTasks
    .map(({ task }) => task)
    .filter((task) => task.status === "paused_blocked")
    .map((task) => ({
      task_id: task.task_id,
      title: task.title,
      owner: task.primary_owner,
      reason: ZH.blockedReason,
      days_blocked: 1,
    }));
}

function buildPendingAssign(mappedTasks) {
  return mappedTasks
    .map(({ task }) => task)
    .filter((task) => task.status === "pending_assign")
    .map((task) => ({
      task_id: task.task_id,
      title: task.title,
      category_path: task.category_path,
      ai_priority: task.ai_priority,
    }));
}

function workspaceStatus(task) {
  if (task.status === "paused_blocked") return { status: "blocked", label: ZH.statusBlocked };
  return { status: "in_progress", label: ZH.statusDoing };
}

function workspaceTask(task, role) {
  const status = workspaceStatus(task);
  return {
    task_id: task.task_id,
    title: task.title,
    priority: task.final_priority,
    progress: task.progress,
    due_date: task.due_date ?? ZH.noDueDate,
    status: status.status,
    status_label: status.label,
    role,
    category_path: task.category_path,
    owner: task.primary_owner,
    collab_role: role === "collaborator" ? ZH.reviewer : undefined,
    description: task.description ?? ZH.source,
    next_action: ZH.nextAction,
    deliverables: [ZH.deliverable],
    blockers: task.status === "paused_blocked" ? [ZH.blockedReason] : [],
    timeline: [
      { label: ZH.created, time: "2026-05-15", state: "done" },
      { label: ZH.nextAction, time: ZH.noDueDate, state: "current" },
      { label: ZH.deliverable, time: task.due_date ?? ZH.noDueDate, state: "todo" },
    ],
  };
}

function buildWorkspace(mappedTasks) {
  const activeTasks = mappedTasks
    .map(({ task }) => task)
    .filter((task) => ["in_progress", "paused_blocked"].includes(task.status))
    .sort((a, b) => {
      const priorityScore = { high: 0, medium: 1, low: 2 };
      return priorityScore[a.final_priority] - priorityScore[b.final_priority] ||
        String(a.due_date ?? "9999-12-31").localeCompare(String(b.due_date ?? "9999-12-31"));
    });

  const myTasks = activeTasks.slice(0, 8).map((task) => workspaceTask(task, "primary"));
  const collabTasks = activeTasks.slice(8, 14).map((task) => workspaceTask(task, "collaborator"));
  const todayTodos = activeTasks.slice(0, 6).map((task) => ({
    text: `${ZH.todoPrefix} ${task.title}`,
    task_id: task.task_id,
  }));
  const notifications = activeTasks
    .filter((task) => task.status === "paused_blocked")
    .slice(0, 5)
    .map((task, index) => ({
      id: `rd-notion-blocked-${index + 1}`,
      type: "blocked",
      title: ZH.statusBlocked,
      message: `${task.task_id} / ${task.title}`,
      time: "2026-05-15",
      related_task_id: task.task_id,
    }));

  return {
    myTasks,
    collabTasks,
    todayTodos,
    aiSuggestions: [],
    notifications,
  };
}

function buildAuditLogs(mappedTasks, existingLogs) {
  const preservedLogs = existingLogs.filter((log) => log?.metadata?.source !== "notion-csv-import");
  const importLogs = mappedTasks.map(({ task }, index) => ({
    id: `rd-log-notion-${String(index + 1).padStart(3, "0")}`,
    timestamp: new Date(Date.UTC(2026, 4, 15, 8, index % 60, 0)).toISOString(),
    actor: {
      id: "system-notion-import",
      name: ZH.importActor,
      role: ZH.importRole,
    },
    action: "task.created",
    resource: {
      type: "task",
      id: task.task_id,
      name: task.title,
    },
    summary: ZH.created,
    changes: [
      { field: "primary_owner", before: null, after: task.primary_owner },
      { field: "status", before: null, after: task.status },
      { field: "category_path", before: null, after: task.category_path },
    ],
    metadata: {
      source: "notion-csv-import",
      priority: task.final_priority,
      due_date: task.due_date ?? null,
    },
  }));
  return [...importLogs, ...preservedLogs].slice(0, 1000);
}

function flattenTasks(categories) {
  return categories.flatMap((category) => category.children.flatMap((child) => child.tasks));
}

async function readSetting(prisma, key, fallback) {
  const record = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  return record?.value ?? fallback;
}

async function writeSetting(prisma, key, value) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: {
      category: "research-development",
      key,
      value,
      description: `R&D module data store: ${key}`,
    },
    update: {
      category: "research-development",
      value,
    },
  });
}

async function main() {
  const apiRoot = path.resolve(__dirname, "..");
  loadEnvFile(path.join(apiRoot, ".env"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check apps/api/.env.");
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const csvText = fs.readFileSync(csvPath, "utf8");
    const rows = parseCsv(csvText);
    const mappedTasks = rows.map(taskFromRow);
    const categories = buildCategories(mappedTasks);
    const people = buildPeople(mappedTasks);
    const dashboard = {
      categoryProgress: buildCategoryProgress(categories),
      personLoads: buildPersonLoads(people, mappedTasks),
      blockedTasks: buildBlockedTasks(mappedTasks),
      pendingAssign: buildPendingAssign(mappedTasks),
    };
    const workspace = buildWorkspace(mappedTasks);
    const existingLogs = await readSetting(prisma, "rd.auditLogs", []);
    const auditLogs = buildAuditLogs(mappedTasks, Array.isArray(existingLogs) ? existingLogs : []);

    await writeSetting(prisma, "rd.taskCategories", categories);
    await writeSetting(prisma, "rd.people", people);
    await writeSetting(prisma, "rd.directorDashboard", dashboard);
    await writeSetting(prisma, "rd.workspace", workspace);
    await writeSetting(prisma, "rd.auditLogs", auditLogs);

    const allTasks = flattenTasks(categories);
    const statusSummary = allTasks.reduce((summary, task) => {
      summary[task.status] = (summary[task.status] ?? 0) + 1;
      return summary;
    }, {});
    const ownerSummary = allTasks.reduce((summary, task) => {
      summary[task.primary_owner] = (summary[task.primary_owner] ?? 0) + 1;
      return summary;
    }, {});

    console.log(JSON.stringify({
      importedTasks: allTasks.length,
      categories: categories.length,
      subProjects: categories.reduce((sum, category) => sum + category.children.length, 0),
      people: people.length,
      blockedTasks: dashboard.blockedTasks.length,
      pendingAssign: dashboard.pendingAssign.length,
      workspace: {
        myTasks: workspace.myTasks.length,
        collabTasks: workspace.collabTasks.length,
        todayTodos: workspace.todayTodos.length,
        notifications: workspace.notifications.length,
      },
      statusSummary,
      ownerSummary,
      peopleNames: people.map((person) => person.name),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
