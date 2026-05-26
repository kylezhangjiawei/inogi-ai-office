import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileUp,
  FolderPlus,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { cn } from "./components/ui/utils";
import { Calendar } from "./components/ui/calendar";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { usePermission } from "./hooks/usePermission";
import { toast } from "sonner";
import {
  ApprovalNode,
  fetchApprovalPoolsApi,
  getActiveFlow,
  getPoolForPermission,
  PoolMember,
} from "./lib/approvalFlowConfig";
import { AuditActor, recordAudit, useAuditActor } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import {
  createRdTask,
  fetchRdDirectorDashboard,
  extractRdTasksFromFile,
  extractRdTasksFromText,
  fetchRdPeople,
  fetchRdTaskCategories,
  refineRdProposalTasks,
  recomputeRdDirectorDashboard,
  saveRdProposalDraft,
  saveRdTaskCategories,
  type RdAiPersonContext,
  type RdAiProposalRefineResult,
  type RdAiProposalRefineScope,
  type RdAiTaskDraft,
  type RdCategory,
  type RdPersonLoad,
} from "./lib/rdApi";

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserRole = "user" | "admin" | "director";
type Priority = "high" | "medium" | "low";
type Step = 1 | 2 | 3 | 4;

type ProposedTask = {
  id: string;
  title: string;
  description?: string;
  owner: string;
  owner_reason: string;
  collaborators: string[];
  due_date: string;
  priority: Priority;
  category_path: string;
  estimated_days: number;       // 人工调整工时（可编辑）
  ai_estimated_days?: number;   // AI 建议工时（只读参考）
  duration_basis: string;
};

type ParentProjectOption = {
  id: string;
  label: string;
  task_count: number;
};

type ProposalRefinePreview = {
  tasks: ProposedTask[];
  changeSummary: string[];
  warnings: string[];
  provider: RdAiProposalRefineResult["provider"];
  model: string;
};

type ProposalRefineDiff = {
  added: ProposedTask[];
  removed: ProposedTask[];
  changed: ProposedTask[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RD_POC_BOM_CATEGORY_TREE = [
  { id: "cat-power", label: "电源部分", parts: ["电池", "电池PCB"] },
  { id: "cat-base", label: "底部结构", parts: ["底座", "底座减震器", "底座进气隔板", "底座过滤棉"] },
  { id: "cat-compression", label: "压缩系统", parts: ["压缩机", "压缩机罩"] },
  { id: "cat-valve-310", label: "310阀系统", parts: ["310阀组", "310电磁阀"] },
  { id: "cat-cooling", label: "风冷系统", parts: ["电风扇"] },
  { id: "cat-air-storage", label: "储气系统", parts: ["储气罐", "储气罐进气隔板"] },
  { id: "cat-valve-210", label: "210阀系统", parts: ["210阀组", "210电磁阀"] },
  { id: "cat-top", label: "Top结构", parts: ["Top板", "成孔螺丝", "显示屏"] },
  { id: "cat-molecular-sieve", label: "分子筛系统", parts: ["分子筛转接板", "分子筛", "分子筛衬板", "分子筛隔板", "分子筛筛料", "分子筛弹簧", "分子筛上密封圈", "分子筛下密封圈"] },
  { id: "cat-exterior", label: "外观结构", parts: ["外罩", "隔热贴"] },
  { id: "cat-accessories", label: "配件系统", parts: ["车充", "快充", "普充"] },
  { id: "cat-tube", label: "气管系统", parts: ["硅胶管", "接头", "卡箍"] },
  { id: "cat-harness", label: "线束系统", parts: ["主线束", "电池线", "风扇线", "屏线"] },
  { id: "cat-fastener", label: "紧固件系统", parts: ["螺丝", "铜柱", "螺母"] },
  { id: "cat-sealing", label: "密封系统", parts: ["O-ring", "泡棉", "密封胶"] },
] as const;

const DEFAULT_TASK_TYPE_FOR_CATEGORY = "研发任务";
const REVIEW_SELECT_TRIGGER_CLASS =
  "h-11 rounded-md border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-none outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 data-[placeholder]:text-slate-400";

type OwnerOption = {
  value: string;
  label: string;
  description?: string;
};

type CategoryPathGroup = {
  label: string;
  options: { value: string; label: string; description?: string }[];
};

function normalizeCategoryKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "")
    .replace(/[\/／\\|>＞·•・._-]/g, "");
}

function splitCategoryPath(value: string): string[] {
  return value
    .split(/[\/／>＞|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function bomChildId(systemId: string, partIndex: number): string {
  return `${systemId}-part-${partIndex + 1}`;
}

function ensureProposalCategoryTree(categories: RdCategory[]): { categories: RdCategory[]; changed: boolean } {
  let changed = false;
  const next = categories.map((category) => ({
    ...category,
    children: category.children.map((child) => ({
      ...child,
      tasks: [...child.tasks],
    })),
  }));

  RD_POC_BOM_CATEGORY_TREE.forEach((system) => {
    let category = next.find((item) => item.id === system.id || normalizeCategoryKey(item.label) === normalizeCategoryKey(system.label));
    if (!category) {
      category = {
        id: system.id,
        label: system.label,
        children: system.parts.map((part, index) => ({
          id: bomChildId(system.id, index),
          label: part,
          tasks: [],
        })),
      };
      next.push(category);
      changed = true;
      return;
    }

    if (category.id !== system.id || category.label !== system.label) {
      category.id = system.id;
      category.label = system.label;
      changed = true;
    }

    system.parts.forEach((part, index) => {
      const child = category.children.find((item) => normalizeCategoryKey(item.label) === normalizeCategoryKey(part));
      const expectedId = bomChildId(system.id, index);
      if (!child) {
        category.children.push({ id: expectedId, label: part, tasks: [] });
        changed = true;
      } else if (child.id !== expectedId || child.label !== part) {
        child.id = expectedId;
        child.label = part;
        changed = true;
      }
    });
  });

  return { categories: next, changed };
}

function resolveCategoryTargetFromPath(task: ProposedTask, categories: RdCategory[]): { categoryId: string; subProjectId: string } | null {
  const [categoryLabel, childLabel] = splitCategoryPath(task.category_path);
  if (!categoryLabel) return null;

  const category = categories.find((item) => normalizeCategoryKey(item.label) === normalizeCategoryKey(categoryLabel));
  if (!category) return null;

  const child = childLabel
    ? category.children.find((item) => normalizeCategoryKey(item.label) === normalizeCategoryKey(childLabel)) ?? category.children[0]
    : category.children[0];
  if (!child) return null;

  return { categoryId: category.id, subProjectId: child.id };
}

function categoriesToOptions(categories: RdCategory[]): ParentProjectOption[] {
  return categories.map((cat) => ({
    id: cat.id,
    label: cat.label,
    task_count: cat.children.reduce((sum, ch) => sum + ch.tasks.length, 0),
  }));
}

function toAiPersonContext(person: RdPersonLoad): RdAiPersonContext {
  return {
    id: person.id,
    name: person.name,
    position: person.position,
    task_count: person.task_count,
    max_tasks: person.max_tasks,
    on_leave: person.on_leave,
    tasks: Array.isArray(person.tasks) ? person.tasks.slice(0, 6) : [],
    department: person.department,
    completed_this_month: person.completed_this_month,
    blocked_count: person.blocked_count,
    avg_completion: person.avg_completion,
  };
}

function mergePeopleForAi(basePeople: RdPersonLoad[], livePeople: RdPersonLoad[]): RdPersonLoad[] {
  const byName = new Map<string, RdPersonLoad>();
  basePeople.forEach((person) => {
    if (person.name) byName.set(person.name, person);
  });
  livePeople.forEach((person) => {
    if (!person.name) return;
    const existing = byName.get(person.name);
    byName.set(person.name, existing ? { ...existing, ...person } : person);
  });
  return Array.from(byName.values());
}

function buildOwnerOptions(peopleProfiles: RdAiPersonContext[], currentOwner?: string): OwnerOption[] {
  const byName = new Map<string, OwnerOption>();
  byName.set("待指派", { value: "待指派", label: "待指派", description: "暂不指定主责人" });
  peopleProfiles.forEach((person) => {
    const name = person.name?.trim();
    if (!name) return;
    const description = [person.position, person.department]
      .filter(Boolean)
      .join(" · ");
    byName.set(name, {
      value: name,
      label: name,
      description: description || undefined,
    });
  });
  const owner = currentOwner?.trim();
  if (owner && !byName.has(owner)) {
    byName.set(owner, { value: owner, label: owner, description: "当前 AI 输出，未在人员管理列表中匹配" });
  }
  return Array.from(byName.values());
}

function buildCategoryPathGroups(categories: RdCategory[]): CategoryPathGroup[] {
  const systems = new Map<string, Set<string>>();
  RD_POC_BOM_CATEGORY_TREE.forEach((system) => {
    systems.set(system.label, new Set<string>(system.parts));
  });
  categories.forEach((category) => {
    const parts = systems.get(category.label) ?? new Set<string>();
    category.children.forEach((child) => {
      if (child.label) parts.add(child.label);
    });
    systems.set(category.label, parts);
  });

  return Array.from(systems.entries()).map(([systemLabel, parts]) => ({
    label: systemLabel,
    options: Array.from(parts).map((part) => ({
      value: `${systemLabel} / ${part} / ${DEFAULT_TASK_TYPE_FOR_CATEGORY}`,
      label: part,
      description: `${systemLabel} / ${part}`,
    })),
  }));
}

function withCurrentCategoryPath(groups: CategoryPathGroup[], currentPath: string): CategoryPathGroup[] {
  const value = currentPath.trim();
  if (!value) return groups;
  const exists = groups.some((group) => group.options.some((option) => option.value === value));
  if (exists) return groups;
  return [
    {
      label: "当前值",
      options: [{ value, label: value, description: "AI 输出或人工录入路径" }],
    },
    ...groups,
  ];
}

function parseReviewDate(value: string): Date | undefined {
  const match = value.trim().replace(/\//g, "-").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatReviewDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayReviewDate(value: string): string {
  return value ? value.replace(/-/g, "/") : "选择日期";
}

function proposedTaskToAiDraft(task: ProposedTask): RdAiTaskDraft {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    owner: task.owner,
    owner_reason: task.owner_reason,
    due_date: task.due_date,
    priority: task.priority,
    category_path: task.category_path,
    estimated_days: task.estimated_days,
    ai_estimated_days: task.ai_estimated_days,
    duration_basis: task.duration_basis,
  };
}

function aiDraftToProposedTaskWithFallback(
  draft: RdAiTaskDraft,
  fallback: ProposedTask | undefined,
  idx: number,
): ProposedTask {
  const safeDays = Number.isFinite(draft.estimated_days) && draft.estimated_days >= 1
    ? Math.min(365, Math.round(draft.estimated_days))
    : fallback?.estimated_days ?? 5;
  const aiDays = Number.isFinite(draft.ai_estimated_days) && (draft.ai_estimated_days ?? 0) >= 1
    ? Math.min(365, Math.round(draft.ai_estimated_days ?? safeDays))
    : fallback?.ai_estimated_days ?? safeDays;
  const priority = draft.priority === "high" || draft.priority === "low" || draft.priority === "medium"
    ? draft.priority
    : fallback?.priority ?? "medium";

  return {
    id: draft.id ?? fallback?.id ?? `refined-${Date.now()}-${idx}`,
    title: draft.title?.trim() || fallback?.title || "未命名任务",
    description: draft.description ?? fallback?.description,
    owner: draft.owner?.trim() || fallback?.owner || "待指派",
    owner_reason: draft.owner_reason?.trim() || fallback?.owner_reason || "由 AI 微调建议分配",
    collaborators: fallback?.collaborators ?? [],
    due_date: draft.due_date || fallback?.due_date || formatReviewDateValue(new Date()),
    priority,
    category_path: draft.category_path?.trim() || fallback?.category_path || "待定 / 待确认 / 研发任务",
    estimated_days: safeDays,
    ai_estimated_days: aiDays,
    duration_basis: draft.duration_basis?.trim() || fallback?.duration_basis || "由 AI 微调估算",
  };
}

function buildRefineDiff(before: ProposedTask[], after: ProposedTask[]): ProposalRefineDiff {
  const beforeById = new Map(before.map((task) => [task.id, task]));
  const afterById = new Map(after.map((task) => [task.id, task]));
  const comparableKeys: Array<keyof ProposedTask> = [
    "title",
    "description",
    "owner",
    "owner_reason",
    "due_date",
    "priority",
    "category_path",
    "estimated_days",
    "ai_estimated_days",
    "duration_basis",
  ];

  const added = after.filter((task) => !beforeById.has(task.id));
  const removed = before.filter((task) => !afterById.has(task.id));
  const changed = after.filter((task) => {
    const previous = beforeById.get(task.id);
    if (!previous) return false;
    return comparableKeys.some((key) => String(previous[key] ?? "").trim() !== String(task[key] ?? "").trim());
  });

  return { added, removed, changed };
}

function TaskDueDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseReviewDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            REVIEW_SELECT_TRIGGER_CLASS,
            "flex w-full items-center justify-between text-left",
            !value && "text-slate-400",
          )}
        >
          <span className="tabular-nums">{displayReviewDate(value)}</span>
          <CalendarDays className="h-4 w-4 text-slate-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-xl border-slate-200 bg-white p-0 shadow-xl">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(formatReviewDateValue(date));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Returns the approval nodes applicable to this user role.
 * - director: no review nodes (can direct-dispatch)
 * - admin: skips the L1 review (only L2+ left)
 * - user: all nodes from configured flow
 */
function getApplicableNodes(userRole: UserRole): ApprovalNode[] {
  const flow = getActiveFlow("project_proposal");
  if (userRole === "director") return [];
  if (userRole === "admin") {
    // Admins skip review-l1 (they ARE the L1 reviewers), only L2+ apply
    return flow.nodes.filter((n) => n.permission_code !== "rd-project:review-l1");
  }
  return flow.nodes;
}

const MODE_LABEL: Record<"single" | "any" | "all", { label: string; text: string; bg: string }> = {
  single: { label: "单人审", text: "text-slate-700", bg: "bg-slate-100" },
  any: { label: "任一审", text: "text-blue-700", bg: "bg-blue-100" },
  all: { label: "全员审", text: "text-violet-700", bg: "bg-violet-100" },
};

function createProposalId(): string {
  return `PRJ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

// ─── CSV / text parser ───────────────────────────────────────────────────────

function parseCsvLine(line: string, sep: string): string[] {
  if (sep !== ",") return line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur.trim().replace(/^"|"$/g, ""));
  return result;
}

function findCol(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = header.findIndex((h) => h.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseDate(raw: string): string {
  if (!raw?.trim()) return "";
  const s = raw.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return s;
  const m = s.match(/(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return `2026-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  return "";
}

function parsePriority(raw: string): Priority {
  const t = (raw ?? "").toLowerCase();
  if (/高|high|紧急|urgent|p0|p1/.test(t)) return "high";
  if (/低|low|p3/.test(t)) return "low";
  return "medium";
}

function parseTasksFromContent(proposalTitle: string, content: string): ProposedTask[] {
  const seed = Date.now();
  const defaultDue = "2026-06-30";
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return fallbackTasks(proposalTitle, content, seed);

  // Detect separator: tab > comma > semicolon
  const sample = lines[0];
  const sep = sample.includes("\t") ? "\t"
    : sample.split(",").length >= sample.split(";").length ? ","
    : ";";

  const rows = lines.map((l) => parseCsvLine(l, sep));
  const header = rows[0].map((h) => h.toLowerCase().replace(/[\s ]/g, ""));

  // Map columns
  const iTitle   = findCol(header, ["任务内容", "任务名称", "任务", "标题", "title", "事项", "工作项", "工作内容"]);
  const iOwner   = findCol(header, ["负责人", "责任人", "执行人", "owner", "人员", "分配"]);
  const iDue     = findCol(header, ["截止日期", "截止时间", "完成时间", "期限", "date", "日期", "时间"]);
  const iPri     = findCol(header, ["优先级", "优先", "重要程度", "priority", "级别"]);
  const iDesc    = findCol(header, ["描述", "备注", "说明", "remark", "详情", "内容", "detail"]);
  const iCat     = findCol(header, ["分类", "类别", "模块", "category", "项目"]);

  if (iTitle === -1) {
    // No header found — try one-task-per-line (plain list)
    return plainListToTasks(proposalTitle, lines, seed, defaultDue);
  }

  const tasks: ProposedTask[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const title = row[iTitle]?.trim();
    if (!title || /^[-—–\s]*$/.test(title)) continue;

    const owner   = iOwner >= 0 ? (row[iOwner]?.trim() || "待指派") : "待指派";
    const dueRaw  = iDue  >= 0 ? parseDate(row[iDue])  : "";
    const due     = dueRaw || defaultDue;
    const pri     = iPri  >= 0 ? parsePriority(row[iPri]) : "medium";
    const desc    = iDesc >= 0 ? row[iDesc]?.trim()    : "";
    const cat     = iCat  >= 0 ? row[iCat]?.trim()     : "";

    tasks.push({
      id: `t-${seed}-${i}`,
      title,
      description: desc || undefined,
      owner,
      owner_reason: owner !== "待指派" ? `文件中指定：${owner}` : "文件中未指定，待分配",
      collaborators: [],
      due_date: due,
      priority: pri,
      category_path: cat || proposalTitle || "待定",
      estimated_days: 5,
      duration_basis: "来自上传文件",
    });
  }

  return tasks.length > 0 ? tasks : fallbackTasks(proposalTitle, content, seed);
}

/** When file has no header: infer grouped blocks "负责人\n任务1\n任务2\n\n负责人2\n..." */
function plainListToTasks(proposalTitle: string, lines: string[], seed: number, defaultDue: string): ProposedTask[] {
  // Heuristic: short lines (≤8 chars, no common punctuation) that look like names → owner header
  const PERSON_RE = /^[一-龥a-zA-Z]{1,8}(（.*?）|\(.*?\))?$/;
  const tasks: ProposedTask[] = [];
  let currentOwner = "待指派";
  let idx = 0;

  for (const line of lines) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (PERSON_RE.test(clean) && clean.length <= 12) {
      currentOwner = clean;
    } else {
      tasks.push({
        id: `t-${seed}-${idx++}`,
        title: clean,
        owner: currentOwner,
        owner_reason: currentOwner !== "待指派" ? `文件中归属：${currentOwner}` : "文件中未指定",
        collaborators: [],
        due_date: defaultDue,
        priority: "medium",
        category_path: proposalTitle || "待定",
        estimated_days: 5,
        duration_basis: "来自上传文件",
      });
    }
  }

  return tasks.length > 0 ? tasks : [];
}

/** Last-resort keyword template (original mock) — only used when file has no parseable content */
function fallbackTasks(proposalTitle: string, description: string, seed: number): ProposedTask[] {
  const text = description.toLowerCase();
  const today = new Date(2026, 4, 18);
  const dateAfter = (days: number) =>
    new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);

  const base = (n: number, title: string, owner: string, days: number, priority: Priority, cat: string): ProposedTask => ({
    id: `t-${seed}-${n}`,
    title,
    owner,
    owner_reason: `关键词模板匹配，请人工确认`,
    collaborators: [],
    due_date: dateAfter(days),
    priority,
    category_path: cat,
    estimated_days: days,
    duration_basis: "默认工期估算",
  });

  if (/电磁阀|阀/.test(text)) return [
    base(1, "电磁阀温升测试方案制定", "待指派", 7, "high", `${proposalTitle || "310阀系统"} / 测试类`),
    base(2, "电磁阀 BOM 影响评估",   "待指派", 4, "medium", `${proposalTitle || "310阀系统"} / 文档类`),
    base(3, "电磁阀寿命测试夹具准备", "待指派", 10, "medium", `${proposalTitle || "310阀系统"} / 工艺类`),
  ];
  if (/电池|寿命|充放电/.test(text)) return [
    base(1, "电池循环寿命测试",  "待指派", 14, "high",   `${proposalTitle || "电源部分"} / 测试类`),
    base(2, "低温放电曲线采集", "待指派",  7, "high",   `${proposalTitle || "电源部分"} / 测试类`),
    base(3, "电池规格书更新",   "待指派", 20, "medium", `${proposalTitle || "电源部分"} / 文档类`),
  ];
  if (/制氧|氧浓度|分子筛|压力/.test(text)) return [
    base(1, "压力传感器标定",    "待指派", 10, "high",   `${proposalTitle || "储气系统"} / 测试类`),
    base(2, "氧浓度稳定性测试", "待指派",  5, "medium", `${proposalTitle || "分子筛系统"} / 测试类`),
    base(3, "分子筛性能基线",   "待指派",  8, "medium", `${proposalTitle || "分子筛系统"} / 工艺类`),
  ];
  if (/车充|emc|快充/.test(text)) return [
    base(1, "车充 EMC 整改测试", "待指派", 14, "high",   `${proposalTitle || "配件系统"} / 测试类`),
    base(2, "车充电源拓扑评审", "待指派",  7, "medium", `${proposalTitle || "配件系统"} / 文档类`),
  ];
  return [
    base(1, "需求确认与边界梳理", "待指派",  3, "high",   `${proposalTitle || "待定"}`),
    base(2, "技术方案初稿",       "待指派",  7, "medium", `${proposalTitle || "待定"}`),
    base(3, "评审与归档",         "待指派", 10, "low",    `${proposalTitle || "待定"}`),
  ];
}

function mockSuggestProject(description: string, categories: RdCategory[]): string | null {
  const text = description.toLowerCase();
  const RULES: [RegExp, RegExp][] = [
    [/电磁阀|工艺|阀/, /阀/],
    [/制氧|分子筛|压力|氧浓度/, /制氧|氧/],
    [/电池|寿命/, /电池/],
    [/车充|emc/, /车充|emc/i],
  ];
  for (const cat of categories) {
    const label = cat.label.toLowerCase();
    for (const [descRe, labelRe] of RULES) {
      if (descRe.test(text) && labelRe.test(label)) return cat.id;
    }
  }
  return null;
}

// ─── Avatar helper ───────────────────────────────────────────────────────────

function hashColor(name: string): string {
  const colors = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-pink-500", "bg-cyan-500", "bg-indigo-500", "bg-rose-500", "bg-teal-500"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function MiniAvatar({ name, size = "sm" }: { name: string; size?: "xs" | "sm" }) {
  const initial = name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  const dim = size === "xs" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white", dim, hashColor(name))} title={name}>
      {initial}
    </span>
  );
}

const PRIORITY_OPTIONS: { value: Priority; label: string; chip: string }[] = [
  { value: "high", label: "高", chip: "bg-red-50 text-red-700 border-red-100" },
  { value: "medium", label: "中", chip: "bg-amber-50 text-amber-700 border-amber-100" },
  { value: "low", label: "低", chip: "bg-slate-50 text-slate-600 border-slate-100" },
];

// ─── Step 1: Input ───────────────────────────────────────────────────────────

const PROPOSAL_ATTACHMENT_EXTENSIONS = [
  "csv",
  "xlsx",
  "xls",
  "tsv",
  "doc",
  "docx",
  "txt",
  "md",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
];
const PROPOSAL_ATTACHMENT_ACCEPT = PROPOSAL_ATTACHMENT_EXTENSIONS.map((item) => `.${item}`).join(",");
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz", "tgz"]);
const BROWSER_TEXT_EXTENSIONS = new Set(["csv", "tsv", "txt", "md", "json"]);
const MAX_BROWSER_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 12000;

function attachmentExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index + 1).trim().toLowerCase() : "";
}

function proposalFileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function mergeProposalFiles(current: File[], incoming: File[]) {
  const byKey = new Map(current.map((file) => [proposalFileKey(file), file]));
  for (const file of incoming) {
    byKey.set(proposalFileKey(file), file);
  }
  return Array.from(byKey.values());
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

function describeAttachment(file: File) {
  const extension = attachmentExtension(file.name);
  const type = ARCHIVE_EXTENSIONS.has(extension) ? "压缩包" : extension ? extension.toUpperCase() : "文件";
  return `${type} · ${formatAttachmentSize(file.size)}`;
}

async function extractProposalAttachmentText(files: File[]) {
  const chunks = await Promise.all(
    files.map(async (file) => {
      const extension = attachmentExtension(file.name);
      const header = `附件：${file.name}（${formatAttachmentSize(file.size)}）`;
      if (BROWSER_TEXT_EXTENSIONS.has(extension) && file.size <= MAX_BROWSER_TEXT_BYTES) {
        const text = await file.text();
        return `${header}\n${text.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}`;
      }
      if (ARCHIVE_EXTENSIONS.has(extension)) {
        return `${header}\n压缩包已上传，按策略将先解包，再对内部 Excel / Word / PDF / 图片继续解析。`;
      }
      return header;
    }),
  );
  return chunks.filter(Boolean).join("\n\n");
}

async function extractProposalAttachmentParseText(files: File[]) {
  const chunks = await Promise.all(
    files.map(async (file) => {
      const extension = attachmentExtension(file.name);
      if (BROWSER_TEXT_EXTENSIONS.has(extension) && file.size <= MAX_BROWSER_TEXT_BYTES) {
        return (await file.text()).slice(0, MAX_ATTACHMENT_TEXT_CHARS);
      }
      return "";
    }),
  );
  return chunks.filter(Boolean).join("\n\n");
}

/**
 * 判断是否是"AI 模型未配置"导致的错误（而非模型已配置但 API 调用失败）。
 * 仅匹配配置缺失类信息，不匹配 API 调用失败（502/服务调用失败）等运行时错误，
 * 避免在模型已正确配置但调用出错时误报"AI 未配置"。
 */
function isAiConfigurationError(message: string) {
  return /AI\s*未配置|OPENAI_API_KEY|DASHSCOPE_API_KEY|QWEN_API_KEY|qwen-doc-turbo|未配置.*模型|模型.*未配置|请配置.*API\s*Key|需要配置.*OCR/i.test(message);
}

function StepInput({
  title,
  setTitle,
  description,
  setDescription,
  files,
  setFiles,
  onNext,
  onClose,
}: {
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  files: File[];
  setFiles: (f: File[]) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const hasDescription = description.trim().length > 0;
  const hasFiles = files.length > 0;
  const canSubmit = hasDescription || hasFiles;

  // Mutual-exclusive mode: when one is filled, the other becomes "disabled-look" (optional supplement)
  // but still editable. Validation only requires ONE of them.
  const descPrimary = hasDescription || !hasFiles; // description is "primary" when active or both empty
  const filesPrimary = hasFiles || !hasDescription;
  const [dragActive, setDragActive] = useState(false);

  const addFiles = (incoming: FileList | File[]) => {
    const incomingFiles = Array.from(incoming).filter((file) => file.size > 0);
    if (!incomingFiles.length) return;
    const nextFiles = mergeProposalFiles(files, incomingFiles);
    setFiles(nextFiles);
    setDragActive(false);
    if (nextFiles.length === files.length) {
      toast.info("文件已在上传列表中");
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files ?? []);
    event.currentTarget.value = "";
  };

  const handleFileDrag = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  };

  const handleFileDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    addFiles(event.dataTransfer.files);
  };

  return (
    <div className="space-y-4 px-6 py-5">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-700">
          立项标题（可选，AI 会自动生成）
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例：电磁阀工艺升级 v2.1"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* Banner: explain the either-or rule */}
      <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-[11px] text-blue-700">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          <span className="font-semibold">立项描述</span> 与 <span className="font-semibold">附件</span> 二选其一即可，提供任一项 AI 都能开始解析；同时提供则 AI 会综合两者。
        </span>
      </div>

      {/* Description */}
      <div className={cn("transition-opacity", !descPrimary && "opacity-60")}>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-slate-700">
            立项描述
            {hasDescription && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                <CheckCircle2 className="h-3 w-3" />
                已填写
              </span>
            )}
          </label>
          <span className="text-[10px] text-slate-400">
            {hasFiles && !hasDescription ? "可省略（附件已提供）" : "或粘贴文本"}
          </span>
        </div>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="粘贴会议纪要、邮件正文，或直接描述立项目标、范围与关键节点。"
          className="w-full resize-none rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2.5 text-sm leading-relaxed outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* OR divider */}
      <div className="relative flex items-center">
        <div className="flex-1 border-t border-dashed border-slate-200" />
        <span className="mx-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          或
        </span>
        <div className="flex-1 border-t border-dashed border-slate-200" />
      </div>

      {/* Attachments */}
      <div className={cn("transition-opacity", !filesPrimary && "opacity-60")}>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-slate-700">
            上传附件
            {hasFiles && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                <CheckCircle2 className="h-3 w-3" />
                已选 {files.length} 个
              </span>
            )}
          </label>
          <span className="text-[10px] text-slate-400">
            {hasDescription && !hasFiles ? "可省略（描述已提供）" : "或拖入文件"}
          </span>
        </div>
        <label
          className={cn(
            "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm transition-all",
            dragActive
              ? "border-blue-400 bg-blue-50 text-blue-700 ring-2 ring-blue-100"
              : "border-slate-300 bg-slate-50/40 text-slate-500 hover:border-blue-300 hover:bg-blue-50/30 hover:text-blue-600",
          )}
          onDragEnter={handleFileDrag}
          onDragOver={handleFileDrag}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
        >
          <FileUp className="h-4 w-4" />
          {hasFiles
            ? `已选 ${files.length} 个文件，点击继续添加`
            : "拖入或点击上传 Excel / Word / PDF / 图片"}
          <Input
            type="file"
            className="hidden"
            accept={PROPOSAL_ATTACHMENT_ACCEPT}
            multiple
            onChange={handleFileInputChange}
          />
        </label>
        <p className="mt-1.5 text-[10px] text-slate-400">
          支持 Excel / Word / PDF / 图片 / zip、rar、7z 压缩包；拖入后会显示在下方列表。
        </p>
        {hasFiles && (
          <ul className="mt-2 space-y-1">
            {files.map((f, idx) => (
              <li
                key={proposalFileKey(f)}
                className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
              >
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{describeAttachment(f)}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                  className="ml-2 shrink-0 text-slate-400 hover:text-red-500"
                  aria-label="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <span className="text-[11px] text-slate-400">
          {canSubmit
            ? hasDescription && hasFiles
              ? "✓ 描述 + 附件 已就绪，AI 将综合两者解析"
              : hasDescription
                ? "✓ 描述已就绪，可继续"
                : "✓ 附件已就绪，可继续"
            : "请提供描述或附件中的任一项"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onNext}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] transition-all hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 解析
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Processing ──────────────────────────────────────────────────────

function StepProcessing({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-5 px-6 py-10">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-200/60" />
        <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-[0_12px_32px_rgba(37,99,235,0.3)]">
          <Sparkles className="h-7 w-7" />
        </span>
      </div>
      <div className="text-center">
        <h3 className="text-base font-semibold text-slate-900">AI 正在解析您的立项</h3>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </div>
      <div className="w-full max-w-xs">
        <div className="h-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-center text-[11px] tabular-nums text-slate-400">{progress}%</div>
      </div>
    </div>
  );
}

// ─── Step 3: Review ──────────────────────────────────────────────────────────

function TaskEditRow({
  task,
  ownerOptions,
  categoryPathGroups,
  onChange,
  onDelete,
  onRequestAiHelp,
  selected = false,
  onSelectedChange,
}: {
  task: ProposedTask;
  ownerOptions: OwnerOption[];
  categoryPathGroups: CategoryPathGroup[];
  onChange: (t: ProposedTask) => void;
  onDelete: () => void;
  onRequestAiHelp?: () => void;
  selected?: boolean;
  onSelectedChange?: (checked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pCfg = PRIORITY_OPTIONS.find((p) => p.value === task.priority)!;
  const categoryGroups = withCurrentCategoryPath(categoryPathGroups, task.category_path);
  const effectiveOwnerOptions = buildOwnerOptions([], task.owner).reduce((options, option) => {
    if (ownerOptions.some((item) => item.value === option.value)) return options;
    return [option, ...options];
  }, ownerOptions);

  return (
    <div className="rounded-lg border border-slate-200 bg-white transition-all hover:border-slate-300 hover:shadow-[0_4px_12px_rgba(15,23,42,0.05)]">
      <div className="flex items-start gap-3 px-3.5 py-3">
        {onSelectedChange && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-200"
            aria-label={`选择任务 ${task.title}`}
          />
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label={expanded ? "收起" : "展开"}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-90")} />
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <Input
            value={task.title}
            onChange={(e) => onChange({ ...task, title: e.target.value })}
            className="w-full rounded border-0 bg-transparent px-0 py-0 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:bg-slate-50 focus:px-1.5"
            placeholder="任务标题"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-500">
            {/* Owner */}
            <span className="flex items-center gap-1.5" title={task.owner_reason}>
              <MiniAvatar name={task.owner} size="xs" />
              <span className="font-medium text-slate-700">{task.owner}</span>
              <span className="cursor-help text-[10px] text-slate-400">ⓘ</span>
            </span>
            <span className="text-slate-300">·</span>
            {/* Due */}
            <span className="tabular-nums">{task.due_date}</span>
            <span className="text-slate-300">·</span>
            {/* Priority */}
            <span className={cn("rounded border px-1.5 py-0.5 font-semibold", pCfg.chip)}>
              {pCfg.label}
            </span>
            <span className="text-slate-300">·</span>
            {/* Duration */}
            <span className="flex items-center gap-1" title={task.duration_basis}>
              {task.ai_estimated_days !== undefined && task.ai_estimated_days !== task.estimated_days ? (
                <>
                  <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] font-semibold text-violet-600">
                    AI {task.ai_estimated_days}天
                  </span>
                  <span className="font-semibold text-slate-700">{task.estimated_days}天</span>
                </>
              ) : (
                <span>预估 {task.estimated_days} 天</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onRequestAiHelp && (
            <button
              type="button"
              onClick={onRequestAiHelp}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-violet-50 hover:text-violet-600"
              title="请 AI 微调此任务"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/40 px-3.5 py-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">描述</label>
            <Textarea
              value={task.description ?? ""}
              onChange={(e) => onChange({ ...task, description: e.target.value })}
              rows={2}
              className="w-full resize-none rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">主责人</label>
              <Select
                value={task.owner || "待指派"}
                onValueChange={(owner) =>
                  onChange({
                    ...task,
                    owner,
                    owner_reason: owner === "待指派" ? "人工选择：待指派" : `人工选择主责人：${owner}`,
                  })
                }
              >
                <SelectTrigger className={REVIEW_SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="选择主责人" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {effectiveOwnerOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="rounded-lg py-2 pl-3 pr-9 text-sm text-slate-700"
                      description={option.description}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">截止日期</label>
              <TaskDueDatePicker
                value={task.due_date}
                onChange={(due_date) => onChange({ ...task, due_date })}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">优先级</label>
              <Select
                value={task.priority}
                onValueChange={(priority) => onChange({ ...task, priority: priority as Priority })}
              >
                <SelectTrigger className={REVIEW_SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="选择优先级" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="rounded-lg py-2 pl-3 pr-9 text-sm text-slate-700">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">分类路径</label>
              <Select
                value={task.category_path}
                onValueChange={(category_path) => onChange({ ...task, category_path })}
              >
                <SelectTrigger className={REVIEW_SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="选择分类路径" />
                </SelectTrigger>
                <SelectContent className="max-h-80 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {categoryGroups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel className="px-2 py-1.5 text-[11px] font-semibold text-slate-400">
                        {group.label}
                      </SelectLabel>
                      {group.options.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className="rounded-lg py-2 pl-3 pr-9 text-sm text-slate-700"
                          description={option.description}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* Duration: AI suggestion + manual override */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">AI 建议工时（天）</label>
              <div className="flex h-11 items-center rounded border border-slate-100 bg-slate-100/60 px-3 text-sm text-slate-400">
                {task.ai_estimated_days ?? "—"}
                <span className="ml-1 text-[11px]">天</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">人工调整工时（天）</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={task.estimated_days}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    // 只在用户输入合法正整数时立即更新；空/非数字时等 onBlur 再校正
                    if (Number.isFinite(v) && v >= 1) {
                      onChange({ ...task, estimated_days: Math.min(365, v) });
                    }
                  }}
                  onBlur={(e) => {
                    // 离开时兜底：非正整数恢复 AI 建议值或默认 5
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isFinite(v) || v < 1) {
                      onChange({ ...task, estimated_days: task.ai_estimated_days ?? 5 });
                    }
                  }}
                  className="h-11 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                />
                <span className="shrink-0 text-xs text-slate-400">天</span>
              </div>
            </div>
          </div>
          <div className="rounded border border-blue-100 bg-blue-50/40 px-2.5 py-2 text-[11px] leading-relaxed text-blue-700">
            <span className="font-semibold">AI 推荐理由：</span>
            {task.owner_reason}
            <div className="mt-0.5 text-blue-600/80">工期依据：{task.duration_basis}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CapacityPanel ───────────────────────────────────────────────────────────

const DEFAULT_CAPACITY_DAYS = 20; // 每人每月可用工作日参考上限

function CapacityPanel({
  tasks,
  peopleProfiles,
}: {
  tasks: ProposedTask[];
  peopleProfiles: RdAiPersonContext[];
}) {
  const profileByName = useMemo(() => {
    const map = new Map<string, RdAiPersonContext>();
    for (const p of peopleProfiles) if (p.name) map.set(p.name, p);
    return map;
  }, [peopleProfiles]);

  const rows = useMemo(() => {
    const byOwner = new Map<string, { aiDays: number; manualDays: number; taskCount: number }>();
    for (const t of tasks) {
      if (!t.owner || t.owner === "待指派") continue;
      const row = byOwner.get(t.owner) ?? { aiDays: 0, manualDays: 0, taskCount: 0 };
      row.aiDays += t.ai_estimated_days ?? t.estimated_days;
      row.manualDays += t.estimated_days;
      row.taskCount += 1;
      byOwner.set(t.owner, row);
    }
    return Array.from(byOwner.entries())
      .map(([name, data]) => {
        const profile = profileByName.get(name);
        const capacityDays = profile ? (profile.max_tasks ?? 8) * 3 : DEFAULT_CAPACITY_DAYS;
        return { name, ...data, capacityDays, profile };
      })
      .sort((a, b) => b.manualDays - a.manualDays);
  }, [tasks, profileByName]);

  const pendingCount = tasks.filter((t) => !t.owner || t.owner === "待指派").length;
  const totalAiDays = tasks.reduce((s, t) => s + (t.ai_estimated_days ?? t.estimated_days), 0);
  const totalManualDays = tasks.reduce((s, t) => s + t.estimated_days, 0);

  if (rows.length === 0 && pendingCount === 0) return null;

  return (
    <section className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-700">人力容量预估</h4>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span>
            AI建议合计：<span className="font-semibold text-violet-600">{totalAiDays} 天</span>
          </span>
          <span className="text-slate-300">|</span>
          <span>
            人工调整合计：<span className="font-semibold text-slate-700">{totalManualDays} 天</span>
          </span>
        </div>
      </div>

      {rows.map(({ name, aiDays, manualDays, taskCount, capacityDays }) => {
        const ratio = manualDays / capacityDays;
        const overload = ratio > 1;
        const warn = ratio > 0.75 && !overload;
        const barColor = overload ? "bg-red-500" : warn ? "bg-amber-400" : "bg-emerald-500";
        const textColor = overload ? "text-red-600" : warn ? "text-amber-600" : "text-emerald-600";
        const aiDiffers = aiDays !== manualDays;

        return (
          <div key={name} className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                <MiniAvatar name={name} size="xs" />
                <span className="font-medium text-slate-700">{name}</span>
                <span className="text-slate-400">{taskCount} 个任务</span>
              </div>
              <div className="flex items-center gap-2">
                {aiDiffers && (
                  <span className="text-violet-500">AI {aiDays}天</span>
                )}
                <span className={cn("font-semibold tabular-nums", textColor)}>
                  {manualDays} / {capacityDays} 天
                </span>
                {overload && <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-bold text-red-600">超载</span>}
                {warn && <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-600">较满</span>}
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn("h-full rounded-full transition-all", barColor)}
                style={{ width: `${Math.min(100, ratio * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        );
      })}

      {pendingCount > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          {pendingCount} 个任务尚未指派，未计入容量
        </div>
      )}
    </section>
  );
}

function StepReview({
  title,
  setTitle,
  originalInput,
  parentProjectId,
  setParentProjectId,
  newProjectName,
  setNewProjectName,
  tasks,
  setTasks,
  proposalId,
  auditActor,
  categories,
  peopleProfiles,
  onBack,
  onNext,
}: {
  title: string;
  setTitle: (v: string) => void;
  originalInput?: string;
  parentProjectId: string | "new";
  setParentProjectId: (v: string | "new") => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  tasks: ProposedTask[];
  setTasks: (t: ProposedTask[]) => void;
  proposalId: string;
  auditActor: AuditActor;
  categories: RdCategory[];
  peopleProfiles: RdAiPersonContext[];
  onBack: () => void;
  onNext: () => void;
}) {
  const ownerOptions = useMemo(() => buildOwnerOptions(peopleProfiles), [peopleProfiles]);
  const categoryPathGroups = useMemo(() => buildCategoryPathGroups(categories), [categories]);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refineScope, setRefineScope] = useState<RdAiProposalRefineScope>("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [refining, setRefining] = useState(false);
  const [refinePreview, setRefinePreview] = useState<ProposalRefinePreview | null>(null);
  const [previousTasks, setPreviousTasks] = useState<ProposedTask[] | null>(null);
  const selectedCount = selectedTaskIds.length;
  const previewDiff = useMemo(
    () => (refinePreview ? buildRefineDiff(tasks, refinePreview.tasks) : null),
    [tasks, refinePreview],
  );

  useEffect(() => {
    const existingIds = new Set(tasks.map((task) => task.id));
    setSelectedTaskIds((prev) => prev.filter((id) => existingIds.has(id)));
  }, [tasks]);

  const addTask = () => {
    const taskId = `t-${Date.now()}`;
    setTasks([
      ...tasks,
      {
        id: taskId,
        title: "新增任务",
        description: "",
        owner: "待指派",
        owner_reason: "人工新增，待规则匹配",
        collaborators: [],
        due_date: "2026-05-30",
        priority: "medium",
        category_path: "待定 / 需明确",
        estimated_days: 3,
        duration_basis: "默认 3 天",
      },
    ]);
    recordAudit({
      actor: auditActor,
      action: "task.created",
      resource: { type: "task", id: taskId, name: "新增任务" },
      comment: "在立项审阅阶段手动追加任务草稿",
      metadata: { proposal_id: proposalId, origin: "manual_draft" },
      source: "web",
    });
  };

  const updateTask = (id: string, t: ProposedTask) => {
    setTasks(tasks.map((x) => (x.id === id ? t : x)));
  };

  const deleteTask = (id: string) => {
    const target = tasks.find((x) => x.id === id);
    setTasks(tasks.filter((x) => x.id !== id));
    if (target) {
      recordAudit({
        actor: auditActor,
        action: "task.edited",
        resource: { type: "task", id: target.id, name: target.title },
        comment: "在立项审阅阶段移除了任务草稿",
        metadata: { proposal_id: proposalId, removed: true },
        source: "web",
      });
    }
  };

  const runAiRefine = async (options?: {
    scope?: RdAiProposalRefineScope;
    selectedIds?: string[];
    instruction?: string;
  }) => {
    const instruction = (options?.instruction ?? refineInstruction).trim();
    if (!instruction) {
      toast.error("请先写清楚希望 AI 如何微调");
      return;
    }
    if (tasks.length === 0) {
      toast.error("当前没有可微调的任务");
      return;
    }

    const scope = options?.scope ?? refineScope;
    const selectedIds = options?.selectedIds ?? selectedTaskIds;
    if ((scope === "selected" || scope === "single") && selectedIds.length === 0) {
      toast.error("请先勾选要微调的任务");
      return;
    }

    setRefining(true);
    setRefinePreview(null);
    try {
      const result = await refineRdProposalTasks({
        proposalTitle: title || undefined,
        originalInput: originalInput?.trim() || undefined,
        currentTasks: tasks.map(proposedTaskToAiDraft),
        instruction,
        peopleNames: peopleProfiles.map((person) => person.name).filter(Boolean),
        peopleProfiles,
        categoryLabels: categories.map((category) => category.label),
        scope,
        selectedTaskIds: selectedIds,
      });
      const fallbackById = new Map(tasks.map((task) => [task.id, task]));
      const refinedTasks = (result.tasks ?? []).map((draft, idx) =>
        aiDraftToProposedTaskWithFallback(draft, fallbackById.get(draft.id ?? ""), idx),
      );
      setRefinePreview({
        tasks: refinedTasks.length > 0 ? refinedTasks : tasks,
        changeSummary: result.change_summary ?? [],
        warnings: result.warnings ?? [],
        provider: result.provider,
        model: result.model,
      });
      recordAudit({
        actor: auditActor,
        action: "ai.proposal_refined",
        resource: { type: "proposal", id: proposalId, name: title || "AI 立项" },
        comment: instruction,
        metadata: {
          proposal_id: proposalId,
          scope,
          selected_task_ids: selectedIds,
          task_count: tasks.length,
          provider: result.provider,
          model: result.model,
        },
        source: "web",
      });
      toast.success("已生成 AI 微调预览", { description: "确认后再应用到当前任务草稿" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 微调失败";
      toast.error(message, { description: "当前任务草稿未被修改" });
    } finally {
      setRefining(false);
    }
  };

  const applyRefinePreview = () => {
    if (!refinePreview) return;
    setPreviousTasks(tasks);
    setTasks(refinePreview.tasks);
    setSelectedTaskIds([]);
    setRefinePreview(null);
    recordAudit({
      actor: auditActor,
      action: "ai.proposal_refine_applied",
      resource: { type: "proposal", id: proposalId, name: title || "AI 立项" },
      comment: "应用 AI 微调预览到立项任务草稿",
      metadata: { proposal_id: proposalId, task_count: refinePreview.tasks.length },
      source: "web",
    });
    toast.success("已应用 AI 微调结果");
  };

  const undoLastRefine = () => {
    if (!previousTasks) return;
    setTasks(previousTasks);
    setPreviousTasks(null);
    setRefinePreview(null);
    toast.success("已撤回上次 AI 微调应用");
  };

  const requestAiHelpForTask = (id: string) => {
    void runAiRefine({ scope: "single", selectedIds: [id] });
  };

  const requestAiOptimizeAll = () => {
    void runAiRefine({ scope: "all" });
  };

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="space-y-4 overflow-auto px-6 py-5">
        {/* Project meta */}
        <section className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/40 p-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">立项标题</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <FolderPlus className="h-3 w-3" />
              归属项目节点
            </label>
            <NativeSelect
              value={parentProjectId}
              onChange={(e) => setParentProjectId(e.target.value as string | "new")}
              className="w-full cursor-pointer rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              <option value="new">+ 创建新项目节点</option>
              {categoriesToOptions(categories).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}（已有 {p.task_count} 个任务）
                </option>
              ))}
            </NativeSelect>
            {parentProjectId === "new" && (
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="新项目名称（例：电磁阀工艺升级 v2.1）"
                className="mt-2 w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              {parentProjectId === "new"
                ? "AI 未找到合适的现有项目，将创建新节点；任务按各自分类路径散落到分类树。"
                : "任务将归属到此项目下，仍按各自分类路径散落到分类树。"}
            </p>
          </div>
        </section>

        {/* AI refine */}
        <section className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold text-slate-800">AI 微调立项草稿</h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                先生成预览，确认后再应用；已手工调整的内容不会被立即覆盖。
              </p>
            </div>
            {previousTasks && (
              <button
                type="button"
                onClick={undoLastRefine}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 active:scale-95"
              >
                <RefreshCw className="h-3 w-3" />
                撤回上次应用
              </button>
            )}
          </div>

          <Textarea
            value={refineInstruction}
            onChange={(event) => setRefineInstruction(event.target.value)}
            rows={3}
            placeholder="例如：把测试类任务拆得更细；优先安排给低负载人员；把交付日期压缩到 6 月 10 日前；不要改动采购跟进任务。"
            className="w-full resize-none rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          />

          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              value={refineScope}
              onChange={(event) => setRefineScope(event.target.value as RdAiProposalRefineScope)}
              className="h-9 min-w-36 cursor-pointer rounded-md border border-violet-100 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
            >
              <option value="all">微调全部任务</option>
              <option value="selected">只微调已选任务</option>
            </NativeSelect>
            <button
              type="button"
              disabled={
                refining ||
                !refineInstruction.trim() ||
                tasks.length === 0 ||
                (refineScope === "selected" && selectedCount === 0)
              }
              onClick={() => void runAiRefine()}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(124,58,237,0.18)] transition-all hover:bg-violet-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              生成微调预览
            </button>
            <span className="text-[11px] text-slate-500">
              已选 {selectedCount} / {tasks.length} 个
            </span>
          </div>

          {refinePreview && previewDiff && (
            <div className="rounded-lg border border-violet-100 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-800">微调预览</div>
                <div className="text-[11px] text-slate-400">
                  {refinePreview.provider} / {refinePreview.model}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                  新增 {previewDiff.added.length}
                </span>
                <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-700">
                  调整 {previewDiff.changed.length}
                </span>
                <span className="rounded bg-rose-50 px-2 py-1 font-medium text-rose-700">
                  移除 {previewDiff.removed.length}
                </span>
              </div>
              {refinePreview.changeSummary.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-600">
                  {refinePreview.changeSummary.slice(0, 4).map((item, index) => (
                    <li key={`${item}-${index}`} className="flex gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
              {refinePreview.warnings.length > 0 && (
                <div className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700">
                  {refinePreview.warnings.slice(0, 3).join("；")}
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRefinePreview(null)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 active:scale-95"
                >
                  放弃预览
                </button>
                <button
                  type="button"
                  onClick={applyRefinePreview}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-slate-800 active:scale-95"
                >
                  应用这次微调
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Capacity */}
        <CapacityPanel tasks={tasks} peopleProfiles={peopleProfiles} />

        {/* Tasks */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                AI 解析出 {tasks.length} 个任务
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                点击行展开编辑 · 可调整人工工时 · 已选 {selectedCount} 个用于局部微调
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={refining || !refineInstruction.trim() || tasks.length === 0}
                onClick={requestAiOptimizeAll}
                className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition-all hover:-translate-y-0.5 hover:bg-violet-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Sparkles className="h-3 w-3" />
                请 AI 微调全部
              </button>
              <button
                type="button"
                onClick={addTask}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all hover:-translate-y-0.5 hover:bg-slate-50 active:scale-95"
              >
                <Plus className="h-3 w-3" />
                手动添加
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/40 py-8 text-center text-xs text-slate-400">
                所有任务已被删除，请添加至少一个任务
              </div>
            ) : (
              tasks.map((task) => (
                <TaskEditRow
                  key={task.id}
                  task={task}
                  ownerOptions={ownerOptions}
                  categoryPathGroups={categoryPathGroups}
                  onChange={(t) => updateTask(task.id, t)}
                  onDelete={() => deleteTask(task.id)}
                  onRequestAiHelp={() => requestAiHelpForTask(task.id)}
                  selected={selectedTaskIds.includes(task.id)}
                  onSelectedChange={(checked) => {
                    setSelectedTaskIds((prev) =>
                      checked
                        ? Array.from(new Set([...prev, task.id]))
                        : prev.filter((id) => id !== task.id),
                    );
                  }}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="group inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
        >
          <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          返回修改
        </button>
        <button
          type="button"
          disabled={tasks.length === 0}
          onClick={onNext}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.2)] transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一步：审核流程
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </footer>
    </div>
  );
}

// ─── Step 4: Submit ──────────────────────────────────────────────────────────

function StepSubmit({
  userRole,
  taskCount,
  title,
  parentProjectId,
  newProjectName,
  comment,
  setComment,
  categories,
  submitting,
  onBack,
  onSubmit,
  onSaveDraft,
  onDirectDispatch,
  canSubmitProposal,
  canDirectProject,
}: {
  userRole: UserRole;
  taskCount: number;
  title: string;
  parentProjectId: string | "new";
  newProjectName: string;
  comment: string;
  setComment: (v: string) => void;
  categories: RdCategory[];
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
  onSaveDraft: () => void;
  onDirectDispatch: () => void;
  canSubmitProposal: boolean;
  canDirectProject: boolean;
}) {
  const reviewNodes = useMemo(() => getApplicableNodes(userRole), [userRole]);
  const [approvalPools, setApprovalPools] = useState<Record<string, PoolMember[]>>({});
  const canDirect = canDirectProject;
  const directOnly = userRole === "director" && canDirectProject;

  useEffect(() => {
    const permissionCodes = Array.from(new Set(reviewNodes.map((node) => node.permission_code)));
    if (permissionCodes.length === 0) {
      setApprovalPools({});
      return;
    }
    let cancelled = false;
    fetchApprovalPoolsApi(permissionCodes)
      .then((pools) => {
        if (!cancelled) setApprovalPools(pools);
      })
      .catch(() => {
        if (!cancelled) setApprovalPools({});
      });
    return () => {
      cancelled = true;
    };
  }, [reviewNodes]);

  const projectName =
    parentProjectId === "new"
      ? newProjectName || "（新项目节点）"
      : categories.find((c) => c.id === parentProjectId)?.label ?? "—";

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="space-y-5 overflow-auto px-6 py-5">
        {/* Summary */}
        <section className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/20 p-4">
          <div className="mb-2 text-xs font-medium text-slate-500">立项摘要</div>
          <h3 className="text-base font-semibold text-slate-900">{title || "未命名立项"}</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-500">归属项目</div>
              <div className="mt-0.5 font-medium text-slate-800">{projectName}</div>
            </div>
            <div>
              <div className="text-slate-500">任务数</div>
              <div className="mt-0.5 font-medium text-slate-800">{taskCount} 个</div>
            </div>
          </div>
        </section>

        {/* Review chain — driven by configured approval flow */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {directOnly ? "审批流程" : "审核流程"}
            </h4>
            {!directOnly && reviewNodes.length > 0 && (
              <span className="text-[10px] text-slate-400">
                来自审批流配置 · 共 {reviewNodes.length} 级
              </span>
            )}
          </div>

          {reviewNodes.length === 0 ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-xs text-emerald-700">
              <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
              {canDirect ? "你有直接立项权限，立项可直接生效并自动分配" : "当前审批流没有后续审核节点，请联系管理员配置审批流或分配直接立项权限"}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Origin */}
              <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
                <MiniAvatar name="你" />
                <div className="flex-1">
                  <div className="text-xs font-medium text-slate-700">提交人</div>
                  <div className="text-[10px] text-slate-500">你</div>
                </div>
              </div>
              {/* Chain of approval nodes */}
              {reviewNodes.map((node, idx) => {
                const pool = approvalPools[node.permission_code] ?? getPoolForPermission(node.permission_code);
                const modeCfg = MODE_LABEL[node.mode];
                return (
                  <React.Fragment key={node.id}>
                    <div className="flex justify-center text-slate-300">
                      <ChevronRight className="h-3 w-3 rotate-90" />
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[10px] font-bold text-white">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-slate-800">{node.label}</span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                              modeCfg.bg,
                              modeCfg.text,
                            )}
                          >
                            {modeCfg.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {pool.length > 0 ? `${pool.length} 人审核组` : "暂无候选人"}
                        </span>
                      </div>
                      {pool.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {pool.slice(0, 4).map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600"
                              title={`${m.name} · ${m.position}`}
                            >
                              <MiniAvatar name={m.name} size="xs" />
                              {m.name}
                            </span>
                          ))}
                          {pool.length > 4 && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              +{pool.length - 4}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="rounded border border-dashed border-amber-200 bg-amber-50/40 px-2 py-1.5 text-[10px] text-amber-700">
                          ⚠ 当前无人持有权限「{node.permission_code}」，请到角色权限页分配
                        </div>
                      )}
                      {node.description && (
                        <p className="mt-1.5 text-[10px] text-slate-400">{node.description}</p>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
              {/* Terminal */}
              <div className="flex justify-center text-slate-300">
                <ChevronRight className="h-3 w-3 rotate-90" />
              </div>
              <div className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">通过 · 任务自动分配</span>
              </div>
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-slate-400">
            {directOnly
              ? "研发主管可直接立项，无需审核"
              : canDirect
                ? "你有「直接立项」权限，可选择跳过审核（适用于紧急/已对齐过的立项）"
                : "提交后进入审核队列。或签模式下任一审核人通过即转下一级，会签则需池内全部通过"}
          </p>
        </section>

        {/* Comment */}
        <section>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            备注 / 提交说明（可选）
          </label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="例：本立项已与研发主管口头对齐，关键节点请尽快推进。"
            className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
          />
        </section>

        {/* Warning */}
        {parentProjectId === "new" && !newProjectName.trim() && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              新项目节点未命名，将使用默认名「{title || "未命名立项"}」
            </span>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="group inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          返回
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={submitting}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40"
          >
            保存草稿
          </button>
          {userRole === "user" && reviewNodes.length > 0 && canSubmitProposal && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] transition-all hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              提交审核
            </button>
          )}
          {canDirect && (
            <button
              type="button"
              onClick={onDirectDispatch}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(5,150,105,0.25)] transition-all hover:from-emerald-600 hover:to-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {directOnly ? "立项并分配" : "直接立项并分配"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── Main Dialog ─────────────────────────────────────────────────────────────

export function RDProjectProposalDialog({
  open,
  onClose,
  onCompleted,
  userRole = "user",
}: {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void | Promise<void>;
  userRole?: UserRole;
}) {
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tasks, setTasks] = useState<ProposedTask[]>([]);
  const [parentProjectId, setParentProjectId] = useState<string | "new">("new");
  const [newProjectName, setNewProjectName] = useState("");
  const [comment, setComment] = useState("");
  const [aiProgress, setAiProgress] = useState(0);
  const [aiLabel, setAiLabel] = useState("");
  const [proposalId, setProposalId] = useState(createProposalId);
  const [categories, setCategories] = useState<RdCategory[]>([]);
  const [peopleNames, setPeopleNames] = useState<string[]>([]);
  const [peopleProfiles, setPeopleProfiles] = useState<RdAiPersonContext[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const canSubmitProposal = usePermission(PERMISSIONS.RD_PROJECT_PROPOSE);
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);
  const canReviewProjectL1 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L1);
  const canReviewProjectL2 = usePermission(PERMISSIONS.RD_PROJECT_REVIEW_L2);
  const effectiveUserRole: UserRole = canDirectProject
    ? "director"
    : canReviewProjectL1 || canReviewProjectL2
      ? "admin"
      : userRole;
  const auditActor = useAuditActor(effectiveUserRole === "director" ? "研发主管" : effectiveUserRole === "admin" ? "研发管理员" : "研发成员");

  useEffect(() => {
    if (open) {
      fetchRdTaskCategories().then(setCategories).catch(() => {});
      Promise.allSettled([fetchRdPeople(), fetchRdDirectorDashboard()])
        .then(([peopleResult, dashboardResult]) => {
          const people = peopleResult.status === "fulfilled" ? peopleResult.value : [];
          const livePeople = dashboardResult.status === "fulfilled" ? dashboardResult.value.personLoads : [];
          const mergedPeople = mergePeopleForAi(people, livePeople);
          setPeopleNames(mergedPeople.map((p) => p.name).filter(Boolean));
          setPeopleProfiles(mergedPeople.map(toAiPersonContext).filter((person) => person.name));
        })
        .catch(() => {});
    }
  }, [open]);

  const STEP_LABELS: Record<Step, string> = {
    1: "描述内容",
    2: "AI 解析中",
    3: "审阅 AI 输出",
    4: "提交审核",
  };

  const reset = () => {
    setStep(1);
    setTitle("");
    setDescription("");
    setFiles([]);
    setTasks([]);
    setParentProjectId("new");
    setNewProjectName("");
    setComment("");
    setAiProgress(0);
    setProposalId(createProposalId());
    setSubmitting(false);
  };

  const handleClose = () => {
    onClose();
    setTimeout(reset, 200); // wait for close animation
  };

  const notifyCompleted = async () => {
    try {
      await onCompleted?.();
    } catch {
      // Parent refresh failure is non-fatal; data has already been saved.
    }
  };

  // Convert backend AI draft to local ProposedTask shape
  const aiDraftToProposedTask = (draft: RdAiTaskDraft, idx: number): ProposedTask => {
    // 防御：后端已做过 clamp，但前端再兜一次：非正整数统一 fallback 到 5
    const safeDays = Number.isFinite(draft.estimated_days) && draft.estimated_days >= 1
      ? draft.estimated_days
      : 5;
    return {
      id: `t-${Date.now()}-${idx}`,
      title: draft.title,
      description: draft.description,
      owner: draft.owner,
      owner_reason: draft.owner_reason,
      collaborators: [],
      due_date: draft.due_date,
      priority: draft.priority,
      category_path: draft.category_path,
      estimated_days: safeDays,
      ai_estimated_days: safeDays,   // 记录 AI 原始建议（用户调整后与此对比）
      duration_basis: "由 AI 估算",
    };
  };

  // Real AI parsing: text or file → backend AI → structured tasks
  const runAiParse = () => {
    recordAudit({
      actor: auditActor,
      action: "ai.parse_triggered",
      resource: { type: "proposal", id: proposalId, name: title || "AI 立项" },
      comment: "发起 AI 立项解析",
      metadata: {
        input_type: description.trim() ? (files.length > 0 ? "text_and_files" : "text") : "files",
        attachment_count: files.length,
      },
      source: "web",
    });

    setStep(2);
    setAiProgress(0);
    setAiLabel("准备中…");

    // Background progress animation — slows down past 90 until the API resolves
    let currentProgress = 0;
    setAiLabel(files.length > 0 ? "上传并读取文件…" : "调用 AI 模型解析…");
    const progressTimer = setInterval(() => {
      currentProgress = Math.min(90, currentProgress + (currentProgress < 50 ? 3 : currentProgress < 80 ? 1.5 : 0.4));
      setAiProgress(Math.round(currentProgress));
      if (currentProgress >= 50 && currentProgress < 60) setAiLabel("AI 模型分析中…");
      else if (currentProgress >= 60 && currentProgress < 80) setAiLabel("提取任务条目…");
      else if (currentProgress >= 80) setAiLabel("整理字段与优先级…");
    }, 200);

    const categoryLabels = categories.map((c) => c.label);

    const aiCall: Promise<{ tasks: RdAiTaskDraft[]; suggested_category?: string; summary?: string }> =
      files.length > 0
          ? extractRdTasksFromFile({
              file: files[0],
              peopleNames,
              peopleProfiles,
              categoryLabels,
              proposalTitle: title || undefined,
            })
          : extractRdTasksFromText({
              text: description.trim(),
              peopleNames,
              peopleProfiles,
              categoryLabels,
              proposalTitle: title || undefined,
            });

    aiCall
      .then((result) => {
        const drafted = (result.tasks ?? []).map((draft, idx) => ({
          ...aiDraftToProposedTask(draft, idx),
          duration_basis: result.provider === "local" ? "本地规则解析" : "由 AI 估算",
        }));
        setTasks(drafted);
        if (!title && drafted[0]) {
          setTitle(drafted[0].title.replace(/[（(].*$/, "").trim() || "AI 立项");
        }
        // Try to match suggested_category against existing real categories
        if (result.suggested_category) {
          const match = categories.find(
            (c) => c.label === result.suggested_category || c.label.includes(result.suggested_category!) || result.suggested_category!.includes(c.label),
          );
          if (match) setParentProjectId(match.id);
        }
        setAiProgress(100);
        setAiLabel(`${result.provider === "local" ? "本地解析" : "AI 解析"}完成，共 ${drafted.length} 个任务`);
        if (result.provider === "local") {
          toast.warning("AI 未配置，已使用本地规则解析继续立项", {
            description: "如需模型增强抽取，请在 AI 模型管理中配置可用模型。",
          });
        }
        setTimeout(() => setStep(3), 250);
      })
      .catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : "AI 解析失败";
        const isConfigMissing = isAiConfigurationError(message);

        if (isConfigMissing) {
          // 未配置 AI 模型 — 本地兜底解析，让用户仍可继续流程
          try {
            const attachmentText = await extractProposalAttachmentParseText(files);
            const localText = [description.trim(), attachmentText].filter(Boolean).join("\n\n");
            if (!localText.trim()) throw new Error("No local parseable content");
            const drafted = parseTasksFromContent(title, localText).map((task, idx) => ({
              ...task,
              id: `local-${Date.now()}-${idx}`,
              duration_basis: task.duration_basis || "本地文件解析",
            }));
            if (drafted.length > 0) {
              setTasks(drafted);
              if (!title && drafted[0]) {
                setTitle(drafted[0].title.replace(/[（(].*$/, "").trim() || "AI 立项");
              }
              setAiProgress(100);
              setAiLabel(`本地解析完成，共 ${drafted.length} 个任务`);
              toast.warning("AI 未配置，已使用本地文件解析继续立项", {
                description: "如需 AI 增强抽取，请在「AI 模型管理」中配置可用模型。",
              });
              setTimeout(() => setStep(3), 250);
              return;
            }
          } catch {
            // 本地解析也失败，继续向下报错
          }
          toast.error(`AI 未配置：${message}`);
        } else {
          // AI 已配置但调用失败（超时、网络、模型错误等）
          // 不降级本地解析 — 显示真实错误，让用户重试或检查配置
          toast.error(`AI 解析失败：${message}`, {
            description: "请检查网络连接、API Key 是否有效，或稍后重试。",
            duration: 8000,
          });
        }

        setTasks([]);
        setAiProgress(0);
        setStep(1);
      })
      .finally(() => {
        clearInterval(progressTimer);
      });
  };

  const ensurePersistentCategoryTree = async (): Promise<RdCategory[]> => {
    const result = ensureProposalCategoryTree(categories);
    if (result.changed) {
      await saveRdTaskCategories(result.categories);
      setCategories(result.categories);
    }
    return result.categories;
  };

  const resolveFallbackTargetIds = async (
    baseCategories: RdCategory[],
  ): Promise<{ target: { categoryId: string; subProjectId: string } | null; categories: RdCategory[] }> => {
    if (parentProjectId === "new") {
      const catId = `rd-cat-${Date.now()}`;
      const subId = `rd-sub-${Date.now()}`;
      const newCat: RdCategory = {
        id: catId,
        label: newProjectName.trim() || title.trim() || "未命名立项",
        children: [{ id: subId, label: "立项任务", tasks: [] }],
      };
      const updated = [...baseCategories, newCat];
      await saveRdTaskCategories(updated);
      setCategories(updated);
      return { target: { categoryId: catId, subProjectId: subId }, categories: updated };
    }
    const cat = baseCategories.find((c) => c.id === parentProjectId);
    const firstChild = cat?.children[0];
    if (!firstChild) {
      toast.error("所选分类下暂无子项目，请先添加子项目");
      return { target: null, categories: baseCategories };
    }
    return { target: { categoryId: parentProjectId, subProjectId: firstChild.id }, categories: baseCategories };
  };

  const createTasksFromProposal = async (status: "pending_review" | "in_progress") => {
    let workingCategories = await ensurePersistentCategoryTree();
    let fallbackTarget: { categoryId: string; subProjectId: string } | null = null;

    const getFallbackTarget = async () => {
      if (fallbackTarget) return fallbackTarget;
      const resolved = await resolveFallbackTargetIds(workingCategories);
      workingCategories = resolved.categories;
      fallbackTarget = resolved.target;
      return fallbackTarget;
    };

    for (const task of tasks) {
      const target = resolveCategoryTargetFromPath(task, workingCategories) ?? await getFallbackTarget();
      if (!target) return false;

      await createRdTask({
        category_id: target.categoryId,
        sub_project_id: target.subProjectId,
        title: task.title,
        primary_owner: task.owner,
        status,
        final_priority: task.priority,
        ai_priority: task.priority,
        due_date: task.due_date,
        description: task.description,
        category_path: task.category_path,
      });
    }

    return true;
  };

  const handleSubmit = async () => {
    if (effectiveUserRole !== "user") {
      toast.error("只有研发成员需要提交立项审核，当前角色请使用直接立项流程");
      return;
    }
    if (!canSubmitProposal) {
      toast.error("当前账号没有立项申请权限");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createTasksFromProposal("pending_review");
      if (!created) { setSubmitting(false); return; }
      await recomputeRdDirectorDashboard().catch(() => {});
      await notifyCompleted();

      recordAudit({
        actor: auditActor,
        action: "proposal.submitted",
        resource: { type: "proposal", id: proposalId, name: title || "未命名立项" },
        comment: comment || "提交立项审核",
        metadata: {
          task_count: tasks.length,
          review_node_count: getApplicableNodes(effectiveUserRole).length,
          parent_project_id: parentProjectId,
        },
        source: "web",
      });
      toast.success("立项已提交审核", {
        description: `共 ${tasks.length} 个任务，已进入主管驾驶舱待审核队列`,
      });
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    setSubmitting(true);
    try {
      const saved = await saveRdProposalDraft({
        draft_id: proposalId,
        title: title || "未命名立项",
        description,
        comment,
        parent_project_id: parentProjectId === "new" ? "new" : parentProjectId,
        new_project_name: newProjectName,
        tasks: tasks as unknown[],
        file_names: files.map((f) => f.name),
      });
      recordAudit({
        actor: auditActor,
        action: "proposal.draft_saved",
        resource: { type: "proposal", id: saved.id, name: saved.title },
        comment: comment || "保存立项草稿",
        metadata: { task_count: tasks.length, attachment_count: files.length, draft_id: saved.id },
        source: "web",
      });
      toast.success("立项已保存为草稿", {
        description: `已存档 ${tasks.length} 个任务草案，可后续继续编辑或提交`,
      });
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "草稿保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectDispatch = async () => {
    if (!canDirectProject) {
      toast.error("当前账号没有直接立项权限");
      return;
    }
    setSubmitting(true);
    try {
      let failed = 0;
      const created = await createTasksFromProposal("in_progress");
      if (!created) { setSubmitting(false); return; }
      await recomputeRdDirectorDashboard().catch(() => {});
      await notifyCompleted();

      recordAudit({
        actor: auditActor,
        action: "proposal.direct_dispatched",
        resource: { type: "proposal", id: proposalId, name: title || "未命名立项" },
        comment: comment || "直接立项并分配任务",
        metadata: {
          task_count: tasks.length,
          parent_project_id: parentProjectId,
          project_name: parentProjectId === "new" ? newProjectName || title || "未命名立项" : parentProjectId,
        },
        source: "web",
      });
      tasks.forEach((task) => {
        recordAudit({
          actor: auditActor,
          action: "task.created",
          resource: { type: "task", id: task.id, name: task.title },
          changes: [
            { field: "owner", before: undefined, after: task.owner },
            { field: "priority", before: undefined, after: task.priority },
            { field: "due_date", before: undefined, after: task.due_date },
          ],
          comment: "立项直接生效后自动创建任务",
          metadata: { proposal_id: proposalId, category_path: task.category_path },
          source: "web",
        });
      });

      if (failed > 0) {
        toast.warning(`立项完成，但 ${failed} 个任务创建失败`, {
          description: "请到任务驾驶舱手动补录",
        });
      } else {
        toast.success("立项已生效并自动分配", {
          description: `${tasks.length} 个任务已下发至责任人，相关人员将收到通知`,
        });
      }
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "立项失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-[0_8px_18px_rgba(37,99,235,0.25)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">AI 立项</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                第 {step} / 4 步 · {STEP_LABELS[step]}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            type="button"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Step progress bar */}
        <div className="flex h-1 bg-slate-100">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={cn(
                "flex-1 transition-all duration-300",
                s <= step ? "bg-gradient-to-r from-blue-500 to-violet-500" : "bg-transparent",
              )}
            />
          ))}
        </div>

        {/* Step content */}
        {step === 1 && (
          <StepInput
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            files={files}
            setFiles={setFiles}
            onNext={runAiParse}
            onClose={handleClose}
          />
        )}
        {step === 2 && <StepProcessing progress={aiProgress} label={aiLabel} />}
        {step === 3 && (
          <StepReview
            title={title}
            setTitle={setTitle}
            originalInput={description}
            parentProjectId={parentProjectId}
            setParentProjectId={setParentProjectId}
            newProjectName={newProjectName}
            setNewProjectName={setNewProjectName}
            tasks={tasks}
            setTasks={setTasks}
            proposalId={proposalId}
            auditActor={auditActor}
            categories={categories}
            peopleProfiles={peopleProfiles}
            onBack={() => setStep(1)}
            onNext={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <StepSubmit
            userRole={effectiveUserRole}
            taskCount={tasks.length}
            title={title}
            parentProjectId={parentProjectId}
            newProjectName={newProjectName}
            comment={comment}
            setComment={setComment}
            categories={categories}
            submitting={submitting}
            onBack={() => setStep(3)}
            onSubmit={handleSubmit}
            onSaveDraft={handleSaveDraft}
            onDirectDispatch={handleDirectDispatch}
            canSubmitProposal={canSubmitProposal}
            canDirectProject={canDirectProject}
          />
        )}
      </div>
    </div>
  );
}

export default RDProjectProposalDialog;
