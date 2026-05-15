import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";
import { RDPeopleManagementPage } from "./RDPeopleManagementPage";
import { RDProjectProposalDialog } from "./RDProjectProposalDialog";
import { AuditTimeline } from "./RDAuditTimeline";
import { AuditActor, recordAudit, useAuditLogs } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";
import { fetchRdDirectorDashboard, type RdDirectorDashboardPayload } from "./lib/rdApi";

const DIRECTOR_MOTION_EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];
const DIRECTOR_FAST_TRANSITION = { duration: 0.18, ease: DIRECTOR_MOTION_EASE };
const DIRECTOR_PANEL_TRANSITION = { duration: 0.24, ease: DIRECTOR_MOTION_EASE };
const DIRECTOR_AUDIT_ACTOR: AuditActor = { id: "u-wang-zy", name: "王志远", role: "厂长" };

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryProgress = {
  id: string;
  label: string;
  total: number;
  completed: number;
  in_progress: number;
  blocked: number;
  color: string;
};

type PersonLoad = {
  id: string;
  name: string;
  position: string;
  task_count: number;
  max_tasks: number;
  on_leave?: boolean;
  tasks: string[];
  // Extended fields for detail drawer
  email?: string;
  phone?: string;
  department?: string;
  joined_at?: string;
  completed_this_month?: number;
  blocked_count?: number;
  avg_completion?: number;
  recent_activities?: { date: string; action: string }[];
  // Task ids this person owns (for drilling into details)
  task_ids?: string[];
};

type BlockedTask = {
  task_id: string;
  title: string;
  owner: string;
  reason: string;
  days_blocked: number;
};

type PendingAssignTask = {
  task_id: string;
  title: string;
  category_path: string;
  ai_priority: "high" | "medium" | "low";
};

type TaskStatus = "in_progress" | "blocked" | "completed" | "pending_assign" | "on_hold";

type TaskDetail = {
  task_id: string;
  title: string;
  status: TaskStatus;
  owner: string;
  priority: "high" | "medium" | "low";
  progress: number;
  due_date?: string;
  category_path: string;
  description?: string;
  blocked_reason?: string;
  blocked_days?: number;
  attachments?: number;
  collaborators?: string[];
  recent_activities?: { date: string; action: string; actor?: string }[];
};

type DirectorDashboardPayload = RdDirectorDashboardPayload<
  CategoryProgress,
  PersonLoad,
  BlockedTask,
  PendingAssignTask
>;

const EMPTY_DIRECTOR_DASHBOARD: DirectorDashboardPayload = {
  categoryProgress: [],
  personLoads: [],
  blockedTasks: [],
  pendingAssign: [],
};

function normalizeDirectorDashboard(payload: Partial<DirectorDashboardPayload> | null | undefined): DirectorDashboardPayload {
  return {
    categoryProgress: Array.isArray(payload?.categoryProgress) ? payload.categoryProgress : [],
    personLoads: Array.isArray(payload?.personLoads) ? payload.personLoads : [],
    blockedTasks: Array.isArray(payload?.blockedTasks) ? payload.blockedTasks : [],
    pendingAssign: Array.isArray(payload?.pendingAssign) ? payload.pendingAssign : [],
  };
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const CATEGORY_PROGRESS: CategoryProgress[] = [
  { id: "hardware", label: "硬件", total: 18, completed: 7, in_progress: 8, blocked: 3, color: "bg-blue-400" },
  { id: "software", label: "软件", total: 12, completed: 5, in_progress: 6, blocked: 1, color: "bg-violet-400" },
  { id: "oc", label: "制氧机", total: 9, completed: 3, in_progress: 4, blocked: 2, color: "bg-emerald-400" },
  { id: "battery", label: "电池", total: 6, completed: 4, in_progress: 2, blocked: 0, color: "bg-amber-400" },
  { id: "car-charger", label: "车充", total: 5, completed: 1, in_progress: 3, blocked: 1, color: "bg-pink-400" },
];

const PERSON_LOADS: PersonLoad[] = [
  {
    id: "p1", name: "王磊", position: "硬件测试工程师", task_count: 5, max_tasks: 8,
    tasks: ["电磁阀温升测试", "Station 温升整机", "BOM 确认", "ECN 变更", "元器件选型"],
    task_ids: ["RD-2026-001", "RD-2026-003", "RD-2026-006", "RD-2026-014", "RD-2026-017"],
    email: "wanglei@inogi.com", phone: "138-0000-1111", department: "硬件组",
    joined_at: "2024-03-12", completed_this_month: 8, blocked_count: 1, avg_completion: 76,
    recent_activities: [
      { date: "2026-05-13", action: "更新 RD-2026-001 进度至 62%", actor: "王磊" },
      { date: "2026-05-12", action: "完成「BOM 确认」", actor: "王磊" },
      { date: "2026-05-10", action: "接手「Station 温升整机」任务", actor: "王磊" },
    ],
  },
  {
    id: "p2", name: "陈静", position: "质检员", task_count: 7, max_tasks: 8,
    tasks: ["电磁阀温升测试（协作）", "电池寿命测试（协作）", "首件检验", "出货检验×4"],
    task_ids: ["RD-2026-001", "RD-2026-006", "RD-2026-020", "RD-2026-021"],
    email: "chenjing@inogi.com", phone: "138-0000-2222", department: "质量组",
    joined_at: "2024-06-01", completed_this_month: 12, blocked_count: 0, avg_completion: 82,
    recent_activities: [
      { date: "2026-05-14", action: "标记「出货检验」为已完成", actor: "陈静" },
      { date: "2026-05-13", action: "评论 RD-2026-001 协作进度", actor: "陈静" },
    ],
  },
  {
    id: "p3", name: "张越", position: "嵌入式工程师", task_count: 3, max_tasks: 8,
    tasks: ["串口握手协议", "固件升级测试", "日志上传模块"],
    task_ids: ["RD-2026-024", "RD-2026-025", "RD-2026-026"],
    email: "zhangyue@inogi.com", phone: "138-0000-3333", department: "软件组",
    joined_at: "2024-08-15", completed_this_month: 5, blocked_count: 0, avg_completion: 68,
    recent_activities: [
      { date: "2026-05-13", action: "提交「串口握手协议」v0.3", actor: "张越" },
    ],
  },
  {
    id: "p4", name: "李静", position: "法规工程师", task_count: 8, max_tasks: 8,
    tasks: ["510K 资料整理", "IEC 60601 符合性", "技术文件归档", "注册证更新×5"],
    task_ids: ["RD-2026-030", "RD-2026-031", "RD-2026-032", "RD-2026-033"],
    on_leave: true,
    email: "lijing@inogi.com", phone: "138-0000-4444", department: "法规组",
    joined_at: "2023-11-20", completed_this_month: 3, blocked_count: 0, avg_completion: 71,
    recent_activities: [
      { date: "2026-05-08", action: "提交请假申请（至 2026-05-22）", actor: "李静" },
      { date: "2026-05-07", action: "完成「510K 资料整理」初稿", actor: "李静" },
    ],
  },
  {
    id: "p5", name: "赵强", position: "工艺工程师", task_count: 2, max_tasks: 8,
    tasks: ["电磁阀工艺规程更新", "焊接工艺优化"],
    task_ids: ["RD-2026-040", "RD-2026-041"],
    email: "zhaoqiang@inogi.com", phone: "138-0000-5555", department: "工艺组",
    joined_at: "2023-09-08", completed_this_month: 4, blocked_count: 0, avg_completion: 88,
    recent_activities: [
      { date: "2026-05-12", action: "更新「电磁阀工艺规程」v1.4", actor: "赵强" },
    ],
  },
  {
    id: "p6", name: "刘华", position: "项目工程师", task_count: 6, max_tasks: 8,
    tasks: ["ECN 变更管理", "里程碑追踪", "供应商沟通", "成本分析", "交付计划", "风险清单"],
    task_ids: ["RD-2026-050", "RD-2026-051", "RD-2026-052", "RD-2026-053"],
    email: "liuhua@inogi.com", phone: "138-0000-6666", department: "项目组",
    joined_at: "2024-01-10", completed_this_month: 10, blocked_count: 0, avg_completion: 79,
    recent_activities: [
      { date: "2026-05-14", action: "更新里程碑「样机交付」状态", actor: "刘华" },
      { date: "2026-05-13", action: "新增供应商沟通记录", actor: "刘华" },
    ],
  },
  {
    id: "p7", name: "陈工", position: "整机测试工程师", task_count: 4, max_tasks: 8,
    tasks: ["Station 温升整机测试", "整机噪声测试", "整机寿命验证", "EMC 自查"],
    task_ids: ["RD-2026-003", "RD-2026-061", "RD-2026-062", "RD-2026-063"],
    email: "chengong@inogi.com", phone: "138-0000-7777", department: "硬件组",
    joined_at: "2023-04-22", completed_this_month: 6, blocked_count: 1, avg_completion: 74,
    recent_activities: [
      { date: "2026-05-13", action: "标记「Station 温升整机测试」为阻塞", actor: "陈工" },
      { date: "2026-05-11", action: "上传测试方案 v1.2", actor: "陈工" },
    ],
  },
  {
    id: "p8", name: "周明", position: "电源工程师", task_count: 3, max_tasks: 8,
    tasks: ["车充电源拓扑评审", "DC-DC 效率优化", "充电曲线调优"],
    task_ids: ["RD-2026-070", "RD-2026-071", "RD-2026-072"],
    email: "zhouming@inogi.com", phone: "138-0000-8888", department: "硬件组",
    joined_at: "2024-09-01", completed_this_month: 3, blocked_count: 0, avg_completion: 65,
    recent_activities: [
      { date: "2026-05-14", action: "完成「DC-DC 效率优化」初步方案", actor: "周明" },
    ],
  },
  {
    id: "p9", name: "黄薇", position: "结构工程师", task_count: 5, max_tasks: 8,
    tasks: ["外壳结构强度评审", "散热风道优化", "模具开发跟进", "DFM 评审", "样件试装"],
    task_ids: ["RD-2026-080", "RD-2026-081", "RD-2026-082", "RD-2026-083", "RD-2026-084"],
    email: "huangwei@inogi.com", phone: "138-0000-9999", department: "结构组",
    joined_at: "2023-07-15", completed_this_month: 7, blocked_count: 0, avg_completion: 81,
    recent_activities: [
      { date: "2026-05-13", action: "完成模具 T0 评审", actor: "黄薇" },
    ],
  },
];

const BLOCKED_TASKS: BlockedTask[] = [
  { task_id: "RD-2026-003", title: "Station 温升整机测试", owner: "陈工", reason: "测试夹具未到位（等采购）", days_blocked: 3 },
  { task_id: "RD-2026-009", title: "OC-10 压力传感器标定", owner: "待指派", reason: "上游设计未定版，依赖 ECN", days_blocked: 5 },
  { task_id: "RD-2026-011", title: "车充 EMC 测试", owner: "外部机构", reason: "外部实验室排期延迟", days_blocked: 8 },
  { task_id: "RD-2026-018", title: "电池循环寿命测试 (低温)", owner: "王磊", reason: "低温箱排期冲突", days_blocked: 2 },
  { task_id: "RD-2026-024", title: "串口握手协议联调", owner: "张越", reason: "对接设备 SDK 缺失", days_blocked: 1 },
  { task_id: "RD-2026-040", title: "电磁阀工艺规程更新", owner: "赵强", reason: "等待新规试样物料", days_blocked: 4 },
];

const PENDING_ASSIGN: PendingAssignTask[] = [
  { task_id: "RD-2026-005", title: "制氧机压力传感器标定", category_path: "制氧机/压力模块/测试类", ai_priority: "medium" },
  { task_id: "RD-2026-013", title: "车充 5V/3A 稳定性验证", category_path: "车充/电性能/测试类", ai_priority: "high" },
  { task_id: "RD-2026-019", title: "电池组防尘等级 IP54 测试", category_path: "电池/外壳/测试类", ai_priority: "medium" },
  { task_id: "RD-2026-022", title: "OC-10 风扇噪声基线建立", category_path: "制氧机/风扇/测试类", ai_priority: "low" },
];

// Full task registry — used by TaskDetailDrawer
const TASK_REGISTRY: Record<string, TaskDetail> = {
  "RD-2026-001": {
    task_id: "RD-2026-001", title: "电磁阀温升测试", status: "in_progress", owner: "王磊",
    priority: "high", progress: 62, due_date: "2026-05-20",
    category_path: "硬件/电磁阀/测试类",
    description: "针对新规电磁阀进行 8 小时连续工作的温升测试，覆盖 1.2A / 1.5A / 2.0A 三档电流。",
    attachments: 3, collaborators: ["陈静"],
    recent_activities: [
      { date: "2026-05-13", action: "上传第三轮测试数据", actor: "王磊" },
      { date: "2026-05-11", action: "陈静评论：建议增加 -10°C 工况", actor: "陈静" },
      { date: "2026-05-09", action: "任务进入测试阶段", actor: "王磊" },
    ],
  },
  "RD-2026-003": {
    task_id: "RD-2026-003", title: "Station 温升整机测试", status: "blocked", owner: "陈工",
    priority: "high", progress: 35, due_date: "2026-05-20",
    category_path: "硬件/Station/测试类",
    description: "对 Station 整机进行 8 小时连续工作温升测试，记录关键点温度曲线并对比设计预期。",
    blocked_reason: "测试夹具未到位（等采购）", blocked_days: 3,
    attachments: 2, collaborators: ["王磊", "陈静"],
    recent_activities: [
      { date: "2026-05-13", action: "标记为阻塞 · 等待夹具", actor: "陈工" },
      { date: "2026-05-11", action: "上传测试方案 v1.2", actor: "陈工" },
      { date: "2026-05-09", action: "接手任务", actor: "陈工" },
    ],
  },
  "RD-2026-006": {
    task_id: "RD-2026-006", title: "电池循环寿命测试", status: "in_progress", owner: "王磊",
    priority: "high", progress: 48, due_date: "2026-05-30",
    category_path: "电池/寿命/测试类",
    description: "持续记录 500 次循环数据，每周生成寿命报告。",
    attachments: 5, collaborators: ["陈静"],
    recent_activities: [
      { date: "2026-05-12", action: "完成第 240 次循环", actor: "王磊" },
    ],
  },
  "RD-2026-009": {
    task_id: "RD-2026-009", title: "OC-10 压力传感器标定", status: "blocked", owner: "待指派",
    priority: "medium", progress: 0, due_date: "2026-05-25",
    category_path: "制氧机/压力模块/测试类",
    description: "对 OC-10 制氧机的压力传感器进行多点标定，校准误差控制在 ±2%。",
    blocked_reason: "上游设计未定版，依赖 ECN", blocked_days: 5,
    attachments: 1,
    recent_activities: [
      { date: "2026-05-09", action: "标记为阻塞 · 等待 ECN", actor: "系统" },
    ],
  },
  "RD-2026-011": {
    task_id: "RD-2026-011", title: "车充 EMC 测试", status: "blocked", owner: "外部机构",
    priority: "high", progress: 15, due_date: "2026-06-10",
    category_path: "车充/EMC/测试类",
    description: "委托 SGS 进行车充 EMC 全套测试（CISPR 25 + ISO 11452）。",
    blocked_reason: "外部实验室排期延迟", blocked_days: 8,
    attachments: 2,
    recent_activities: [
      { date: "2026-05-06", action: "样品已寄送 SGS", actor: "刘华" },
    ],
  },
  "RD-2026-005": {
    task_id: "RD-2026-005", title: "制氧机压力传感器标定", status: "pending_assign", owner: "待指派",
    priority: "medium", progress: 0, due_date: "2026-05-28",
    category_path: "制氧机/压力模块/测试类",
    description: "AI 解析任务规则未能匹配到合适的责任人，需手动指派。",
    attachments: 0,
    recent_activities: [
      { date: "2026-05-14", action: "AI 自动创建，待指派", actor: "AI 解析" },
    ],
  },
  "RD-2026-013": {
    task_id: "RD-2026-013", title: "车充 5V/3A 稳定性验证", status: "pending_assign", owner: "待指派",
    priority: "high", progress: 0, due_date: "2026-05-22",
    category_path: "车充/电性能/测试类",
    description: "验证车充 5V/3A 输出在不同负载下的稳定性。",
    attachments: 0,
    recent_activities: [
      { date: "2026-05-14", action: "AI 自动创建，待指派", actor: "AI 解析" },
    ],
  },
  "RD-2026-018": {
    task_id: "RD-2026-018", title: "电池循环寿命测试 (低温)", status: "blocked", owner: "王磊",
    priority: "medium", progress: 22, due_date: "2026-06-05",
    category_path: "电池/寿命/测试类",
    description: "低温环境下电池循环寿命测试，验证 -10°C 下的容量衰减率。",
    blocked_reason: "低温箱排期冲突", blocked_days: 2,
    attachments: 1,
    recent_activities: [
      { date: "2026-05-12", action: "标记为阻塞", actor: "王磊" },
    ],
  },
  "RD-2026-024": {
    task_id: "RD-2026-024", title: "串口握手协议联调", status: "blocked", owner: "张越",
    priority: "medium", progress: 45, due_date: "2026-05-26",
    category_path: "软件/通讯/开发类",
    description: "与外部 PLC 设备的串口握手协议联调，定位握手失败的根因。",
    blocked_reason: "对接设备 SDK 缺失", blocked_days: 1,
    attachments: 2,
    recent_activities: [
      { date: "2026-05-13", action: "标记为阻塞 · 等 SDK", actor: "张越" },
    ],
  },
  "RD-2026-019": {
    task_id: "RD-2026-019", title: "电池组防尘等级 IP54 测试", status: "pending_assign", owner: "待指派",
    priority: "medium", progress: 0, due_date: "2026-05-30",
    category_path: "电池/外壳/测试类",
    description: "对电池组进行 IP54 等级防尘防溅水测试。",
    attachments: 0,
    recent_activities: [
      { date: "2026-05-14", action: "AI 自动创建，待指派", actor: "AI 解析" },
    ],
  },
  "RD-2026-022": {
    task_id: "RD-2026-022", title: "OC-10 风扇噪声基线建立", status: "pending_assign", owner: "待指派",
    priority: "low", progress: 0, due_date: "2026-06-08",
    category_path: "制氧机/风扇/测试类",
    description: "建立 OC-10 工作时风扇噪声基线（dB 值），用于后续优化对比。",
    attachments: 0,
    recent_activities: [
      { date: "2026-05-14", action: "AI 自动创建，待指派", actor: "AI 解析" },
    ],
  },
  "RD-2026-040": {
    task_id: "RD-2026-040", title: "电磁阀工艺规程更新", status: "blocked", owner: "赵强",
    priority: "low", progress: 60, due_date: "2026-05-22",
    category_path: "硬件/电磁阀/工艺类",
    description: "依据新批次电磁阀样品，更新工艺规程文件（焊接温度、装配扭矩）。",
    blocked_reason: "等待新规试样物料", blocked_days: 4,
    attachments: 1,
    recent_activities: [
      { date: "2026-05-10", action: "提交规程草案 v1.4", actor: "赵强" },
    ],
  },
};

/** Look up a task by id; synthesize a minimal one if missing (for person task strings). */
function lookupTask(idOrTitle: string, ownerHint?: string): TaskDetail {
  if (TASK_REGISTRY[idOrTitle]) return TASK_REGISTRY[idOrTitle];
  // Synthesize from title
  return {
    task_id: idOrTitle.startsWith("RD-") ? idOrTitle : `TMP-${idOrTitle.slice(0, 8)}`,
    title: idOrTitle.startsWith("RD-") ? `任务 ${idOrTitle}` : idOrTitle,
    status: "in_progress",
    owner: ownerHint ?? "—",
    priority: "medium",
    progress: 50,
    category_path: "—",
    description: "暂无详细描述。",
    attachments: 0,
    recent_activities: [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Reusable mini pagination — used by blocked / pending / person lists
function MiniPagination({
  page,
  totalPages,
  onChange,
  className,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="上一页"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {Array.from({ length: totalPages }).map((_, i) => {
        const p = i + 1;
        const active = p === page;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "h-7 min-w-7 cursor-pointer rounded-md px-1.5 text-[11px] font-semibold tabular-nums transition-all duration-150 active:scale-90",
              active
                ? "bg-blue-50 text-blue-700 shadow-[0_6px_14px_rgba(37,99,235,0.08)] ring-1 ring-blue-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
            )}
            aria-current={active ? "page" : undefined}
          >
            {p}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="下一页"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DashboardEmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

function loadColor(count: number, max: number): string {
  const ratio = max > 0 ? count / max : 0;
  if (ratio >= 1) return "bg-red-400";
  if (ratio >= 0.75) return "bg-orange-400";
  if (ratio >= 0.5) return "bg-amber-400";
  return "bg-emerald-400";
}

function loadBg(count: number, max: number): string {
  const ratio = max > 0 ? count / max : 0;
  if (ratio >= 1) return "border-red-100 bg-red-50";
  if (ratio >= 0.75) return "border-orange-100 bg-orange-50";
  if (ratio >= 0.5) return "border-amber-100 bg-amber-50";
  return "border-emerald-100 bg-emerald-50";
}

const PRIORITY_CONFIG = {
  high: { label: "高", color: "bg-red-50 text-red-600 border-red-100" },
  medium: { label: "中", color: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  low: { label: "低", color: "bg-slate-50 text-slate-500 border-slate-100" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PersonCard({
  person,
  selected,
  onSelect,
}: {
  person: PersonLoad;
  selected: boolean;
  onSelect: (p: PersonLoad | null) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const ratio = person.max_tasks > 0 ? person.task_count / person.max_tasks : 0;
  return (
    <motion.div
      onClick={() => onSelect(selected ? null : person)}
      whileHover={shouldReduceMotion ? undefined : { y: -3, scale: 1.01 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className={cn(
        "cursor-pointer rounded-xl border p-3 transition-all hover:shadow-[0_14px_28px_rgba(15,23,42,0.08)]",
        selected ? "border-blue-300 bg-blue-50 shadow-[0_14px_32px_rgba(37,99,235,0.12)]" : loadBg(person.task_count, person.max_tasks),
        person.on_leave && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            {person.name}
            {person.on_leave && (
              <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">请假中</span>
            )}
          </div>
          <div className="text-xs text-slate-400">{person.position}</div>
        </div>
        <div className="text-right">
          <div className={cn("text-xl font-bold", ratio >= 1 ? "text-red-600" : ratio >= 0.75 ? "text-orange-600" : "text-slate-700")}>
            {person.task_count}
          </div>
          <div className="text-[10px] text-slate-400">/ {person.max_tasks}</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/50">
        <div
          className={cn("h-full rounded-full transition-all", loadColor(person.task_count, person.max_tasks))}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
    </motion.div>
  );
}

// ─── Batch Reassign Modal ─────────────────────────────────────────────────────

// ─── Task Detail Drawer ──────────────────────────────────────────────────────

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; bg: string; text: string; dot: string }> = {
  in_progress: { label: "进行中", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  blocked: { label: "阻塞", bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
  completed: { label: "已完成", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  pending_assign: { label: "待指派", bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
  on_hold: { label: "暂停", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
};

const TASK_PRIORITY_CONFIG = {
  high: { label: "高", color: "bg-red-50 text-red-600 border-red-100" },
  medium: { label: "中", color: "bg-yellow-50 text-yellow-700 border-yellow-100" },
  low: { label: "低", color: "bg-slate-50 text-slate-500 border-slate-100" },
};

function hashColor(name: string): string {
  const colors = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-pink-500", "bg-cyan-500", "bg-indigo-500", "bg-rose-500", "bg-teal-500"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function MiniAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initial = name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white", dim, hashColor(name))} title={name}>
      {initial}
    </span>
  );
}

function TaskDetailDrawer({
  task,
  onClose,
  onOpenPerson,
}: {
  task: TaskDetail;
  onClose: () => void;
  onOpenPerson?: (name: string) => void;
}) {
  const sCfg = TASK_STATUS_CONFIG[task.status];
  const pCfg = TASK_PRIORITY_CONFIG[task.priority];
  const taskLogs = useAuditLogs({ resourceType: "task", resourceId: task.task_id });
  const canEditTask = usePermission(PERMISSIONS.RD_TASK_EDIT);
  const canReassignTask = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const recordDirectorTaskAction = (action: "task.edited" | "task.handoff_requested" | "task.status_changed") => {
    if (action === "task.handoff_requested" && !canReassignTask) {
      toast.error("当前账号没有转派任务权限");
      return;
    }
    if (action !== "task.handoff_requested" && !canEditTask) {
      toast.error("当前账号没有编辑任务权限");
      return;
    }
    const isComplete = action === "task.status_changed";
    recordAudit({
      actor: DIRECTOR_AUDIT_ACTOR,
      action,
      resource: { type: "task", id: task.task_id, name: task.title },
      changes: isComplete
        ? [{ field: "status", before: task.status, after: "completed" }]
        : action === "task.handoff_requested"
          ? [{ field: "owner", before: task.owner, after: "待转派确认" }]
          : undefined,
      comment:
        action === "task.edited"
          ? "从厂长驾驶舱进入编辑任务"
          : action === "task.handoff_requested"
            ? "从厂长驾驶舱发起任务转派"
            : "从厂长驾驶舱标记任务完成",
      source: "web",
    });
    toast.success("操作已留痕");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm animate-rd-fade-in"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-100 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)] animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-xs text-slate-400">{task.task_id}</span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", sCfg.bg, sCfg.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", sCfg.dot)} />
                {sCfg.label}
              </span>
              <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-bold", pCfg.color)}>{pCfg.label}</span>
            </div>
            <h3 className="text-base font-semibold leading-snug text-slate-900">{task.title}</h3>
            <p className="mt-1 text-xs text-slate-400">{task.category_path}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          {/* Blocked banner */}
          {task.status === "blocked" && task.blocked_reason && (
            <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-orange-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                阻塞中 {task.blocked_days && <span>· 已 {task.blocked_days} 天</span>}
              </div>
              <p className="mt-1 text-xs text-orange-600">{task.blocked_reason}</p>
            </div>
          )}
          {task.status === "pending_assign" && (
            <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-violet-700">
                <Loader2 className="h-3.5 w-3.5" />
                等待人工指派
              </div>
              <p className="mt-1 text-xs text-violet-600">规则未能自动匹配责任人，请手动选择。</p>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">主责人</div>
              <button
                type="button"
                onClick={() => task.owner !== "待指派" && task.owner !== "外部机构" && onOpenPerson?.(task.owner)}
                disabled={task.owner === "待指派" || task.owner === "外部机构"}
                className="mt-1 flex items-center gap-2 rounded-md py-0.5 text-sm font-medium text-slate-800 transition-colors enabled:cursor-pointer enabled:hover:text-blue-600 disabled:cursor-default"
              >
                <MiniAvatar name={task.owner} size="sm" />
                {task.owner}
                {task.owner !== "待指派" && task.owner !== "外部机构" && <ChevronRight className="h-3 w-3 opacity-50" />}
              </button>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">截止日期</div>
              <div className="mt-1 text-sm font-medium tabular-nums text-slate-800">
                {task.due_date ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">进度</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className={cn("h-full rounded-full", sCfg.dot)} style={{ width: `${task.progress}%` }} />
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-800">{task.progress}%</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">附件</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{task.attachments ?? 0} 个</div>
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">任务描述</h4>
              <p className="rounded-lg border border-slate-100 bg-white px-4 py-3 text-sm leading-relaxed text-slate-700">
                {task.description}
              </p>
            </section>
          )}

          {/* Collaborators */}
          {task.collaborators && task.collaborators.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">协作人</h4>
              <div className="flex flex-wrap gap-2">
                {task.collaborators.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onOpenPerson?.(c)}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <MiniAvatar name={c} size="sm" />
                    {c}
                    <ChevronRight className="h-3 w-3 opacity-0 transition-all group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Activity timeline */}
          {task.recent_activities && task.recent_activities.length > 0 && (
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">最近动态</h4>
              <ul className="relative space-y-3 border-l border-slate-200 pl-4">
                {task.recent_activities.map((a, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-2 ring-white" />
                    <div className="text-xs tabular-nums text-slate-400">{a.date}</div>
                    <div className="mt-0.5 text-sm text-slate-700">
                      {a.action}
                      {a.actor && <span className="ml-1.5 text-xs text-slate-400">· {a.actor}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">操作留痕</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {taskLogs.length} 条
              </span>
            </div>
            <AuditTimeline logs={taskLogs} showResource={false} emptyText="暂无此任务的操作记录" />
          </section>
        </div>

        {(canEditTask || canReassignTask) && (
          <footer className="flex items-center gap-2 border-t border-slate-100 bg-white px-6 py-3">
            {canEditTask && (
              <button onClick={() => recordDirectorTaskAction("task.edited")} className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]">
                编辑
              </button>
            )}
            {canReassignTask && (
              <button onClick={() => recordDirectorTaskAction("task.handoff_requested")} className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]">
                转派
              </button>
            )}
            {canEditTask && task.status !== "completed" && (
              <button onClick={() => recordDirectorTaskAction("task.status_changed")} className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(5,150,105,0.2)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98]">
                标记完成
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

// ─── Person Detail Drawer ────────────────────────────────────────────────────

function PersonDetailDrawer({
  person,
  onClose,
  onOpenTask,
}: {
  person: PersonLoad;
  onClose: () => void;
  onOpenTask: (taskId: string, ownerHint?: string) => void;
}) {
  const ratio = person.max_tasks > 0 ? person.task_count / person.max_tasks : 0;
  const ratioPct = Math.round(ratio * 100);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const canReassignTask = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const tone =
    ratio >= 1 ? { label: "超负荷", text: "text-red-600", bg: "bg-red-50", dot: "bg-red-500" } :
    ratio >= 0.75 ? { label: "高负载", text: "text-orange-600", bg: "bg-orange-50", dot: "bg-orange-500" } :
    ratio >= 0.5 ? { label: "中等", text: "text-amber-600", bg: "bg-amber-50", dot: "bg-amber-500" } :
    { label: "轻负载", text: "text-emerald-600", bg: "bg-emerald-50", dot: "bg-emerald-500" };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm animate-rd-fade-in"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-100 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)] animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/30 px-6 py-5">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white ring-4 ring-white", hashColor(person.name))}>
              {person.name.replace(/\(.+?\)/g, "").trim().slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">{person.name}</h3>
                {person.on_leave && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">请假中</span>
                )}
              </div>
              <p className="text-xs text-slate-500">{person.position}</p>
              {person.department && <p className="mt-0.5 text-[11px] text-slate-400">{person.department}</p>}
            </div>
          </div>

          {/* Load indicator */}
          <div className={cn("mt-4 rounded-xl border px-3 py-2.5", tone.bg.replace("bg-", "border-").replace("50", "100"), tone.bg)}>
            <div className="flex items-center justify-between text-xs">
              <span className={cn("font-semibold", tone.text)}>{tone.label} · {person.task_count} / {person.max_tasks}</span>
              <span className={cn("tabular-nums font-bold", tone.text)}>{ratioPct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/70">
              <div className={cn("h-full rounded-full", tone.dot, person.on_leave && "opacity-50")} style={{ width: `${Math.min(100, ratioPct)}%` }} />
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          {/* Stats */}
          <section className="grid grid-cols-3 gap-2 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            <div className="text-center">
              <div className="text-xl font-semibold tabular-nums text-emerald-600">{person.completed_this_month ?? 0}</div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">本月完成</div>
            </div>
            <div className="border-x border-slate-200 text-center">
              <div className={cn("text-xl font-semibold tabular-nums", (person.blocked_count ?? 0) > 0 ? "text-orange-600" : "text-slate-300")}>
                {person.blocked_count ?? 0}
              </div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">阻塞中</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold tabular-nums text-slate-800">{person.avg_completion ?? 0}%</div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-500">平均完成率</div>
            </div>
          </section>

          {/* Contact */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">联系方式</h4>
            <div className="space-y-2 rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-sm">
              {person.email && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">邮箱</span>
                  <span className="font-mono text-xs text-slate-700">{person.email}</span>
                </div>
              )}
              {person.phone && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">电话</span>
                  <span className="font-mono text-xs text-slate-700">{person.phone}</span>
                </div>
              )}
              {person.joined_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">入职日期</span>
                  <span className="text-xs tabular-nums text-slate-700">{person.joined_at}</span>
                </div>
              )}
            </div>
          </section>

          {/* Tasks */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">当前任务</h4>
              <span className="text-[11px] tabular-nums text-slate-400">{person.tasks.length} 项</span>
            </div>
            <ul className="space-y-1.5">
              {person.tasks.map((taskTitle, idx) => {
                const taskId = person.task_ids?.[idx];
                const task = taskId ? TASK_REGISTRY[taskId] : null;
                const sCfg = task ? TASK_STATUS_CONFIG[task.status] : null;
                return (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(taskId ?? taskTitle, person.name)}
                      className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-50/60 hover:shadow-[0_4px_12px_rgba(15,23,42,0.05)] active:translate-y-0"
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sCfg?.dot ?? "bg-slate-300")} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                          {task?.title ?? taskTitle}
                        </div>
                        {task && (
                          <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                            <span className={cn("font-semibold", sCfg?.text)}>{sCfg?.label}</span>
                            <span className="text-slate-300">·</span>
                            <span className="tabular-nums text-slate-500">{task.progress}%</span>
                            {task.due_date && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="tabular-nums text-slate-500">{task.due_date}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Activity */}
          {person.recent_activities && person.recent_activities.length > 0 && (
            <section>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">最近动态</h4>
              <ul className="relative space-y-3 border-l border-slate-200 pl-4">
                {person.recent_activities.map((a, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-slate-300 ring-2 ring-white" />
                    <div className="text-xs tabular-nums text-slate-400">{a.date}</div>
                    <div className="mt-0.5 text-sm text-slate-700">{a.action}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <footer className="flex items-center gap-2 border-t border-slate-100 bg-white px-6 py-3">
          {canManagePeople && (
            <button className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]">
              编辑信息
            </button>
          )}
          <button className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]">
            发消息
          </button>
          {canReassignTask && (
            <button className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.2)] transition-all duration-150 hover:bg-blue-700 active:scale-[0.98]">
              重分配
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ─── Category Detail Drawer ──────────────────────────────────────────────────

const CATEGORY_LABEL_TO_PATH_PREFIX: Record<string, string> = {
  hardware: "硬件",
  software: "软件",
  oc: "制氧机",
  battery: "电池",
  "car-charger": "车充",
};

function CategoryDetailDrawer({
  category,
  onClose,
  onOpenTask,
  onOpenPerson,
}: {
  category: CategoryProgress;
  onClose: () => void;
  onOpenTask: (taskId: string, owner?: string) => void;
  onOpenPerson: (name: string) => void;
}) {
  const completedRate = category.total > 0 ? Math.round((category.completed / category.total) * 100) : 0;
  const inProgressRate = category.total > 0 ? Math.round((category.in_progress / category.total) * 100) : 0;
  const notStarted = category.total - category.completed - category.in_progress - category.blocked;

  // Filter tasks from registry that match this category path prefix
  const pathPrefix = CATEGORY_LABEL_TO_PATH_PREFIX[category.id] ?? category.label;
  const relatedTasks = Object.values(TASK_REGISTRY).filter((t) =>
    t.category_path.startsWith(pathPrefix),
  );

  // Compute top contributors from related tasks
  const contributorCounts = new Map<string, number>();
  for (const t of relatedTasks) {
    if (t.owner && t.owner !== "待指派" && t.owner !== "外部机构") {
      contributorCounts.set(t.owner, (contributorCounts.get(t.owner) ?? 0) + 1);
    }
    for (const c of t.collaborators ?? []) {
      contributorCounts.set(c, (contributorCounts.get(c) ?? 0) + 0.5);
    }
  }
  const topContributors = Array.from(contributorCounts.entries())
    .map(([name, count]) => ({ name, count: Math.ceil(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm animate-rd-fade-in"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-100 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)] animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/30 px-6 py-5">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_18px_rgba(15,23,42,0.12)]", category.color)}>
              <BarChart2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-slate-900">{category.label}</h3>
              <p className="text-xs text-slate-500">{category.total} 个任务 · 完成率 {completedRate}%</p>
            </div>
          </div>

          {/* Stacked progress */}
          <div className="mt-4">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-400 transition-all" style={{ width: `${completedRate}%` }} />
              <div className="bg-blue-300 transition-all" style={{ width: `${inProgressRate}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-slate-500">已完成</span>
                <span className="font-semibold tabular-nums text-emerald-700">{category.completed}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                <span className="text-slate-500">进行中</span>
                <span className="font-semibold tabular-nums text-blue-700">{category.in_progress}</span>
              </span>
              {category.blocked > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="text-slate-500">阻塞</span>
                  <span className="font-semibold tabular-nums text-red-700">{category.blocked}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                <span className="text-slate-500">未开始</span>
                <span className="font-semibold tabular-nums text-slate-700">{notStarted}</span>
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
          {/* Stats summary */}
          <section className="grid grid-cols-4 gap-2 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
            {[
              { label: "总数", value: category.total, tone: "text-slate-900" },
              { label: "完成率", value: `${completedRate}%`, tone: "text-emerald-600" },
              { label: "进行", value: category.in_progress, tone: "text-blue-600" },
              { label: "阻塞", value: category.blocked, tone: category.blocked > 0 ? "text-red-600" : "text-slate-300" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className={cn("text-xl font-semibold tabular-nums tracking-tight", s.tone)}>{s.value}</div>
                <div className="mt-0.5 text-[10px] font-medium text-slate-500">{s.label}</div>
              </div>
            ))}
          </section>

          {/* Key tasks */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">关键任务</h4>
              <span className="text-[11px] tabular-nums text-slate-400">
                显示 {relatedTasks.length} 项 · 共 {category.total} 项
              </span>
            </div>
            {relatedTasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/40 py-6 text-center text-xs text-slate-400">
                暂无关键任务录入
              </div>
            ) : (
              <ul className="space-y-1.5">
                {relatedTasks.map((t) => {
                  const sCfg = TASK_STATUS_CONFIG[t.status];
                  return (
                    <li key={t.task_id}>
                      <button
                        type="button"
                        onClick={() => onOpenTask(t.task_id, t.owner)}
                        className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-50/60 hover:shadow-[0_4px_12px_rgba(15,23,42,0.05)] active:translate-y-0"
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sCfg.dot)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-400">{t.task_id}</span>
                            <span className="truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">{t.title}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                            <span className={cn("font-semibold", sCfg.text)}>{sCfg.label}</span>
                            <span className="text-slate-300">·</span>
                            <span className="tabular-nums text-slate-500">{t.progress}%</span>
                            {t.owner && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="text-slate-500">{t.owner}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Top contributors */}
          {topContributors.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">主要贡献人</h4>
              <ul className="space-y-1.5">
                {topContributors.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      onClick={() => onOpenPerson(c.name)}
                      className="group flex w-full items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-50/60 active:translate-y-0"
                    >
                      <MiniAvatar name={c.name} size="sm" />
                      <span className="flex-1 truncate text-sm font-medium text-slate-800 group-hover:text-slate-900">
                        {c.name}
                      </span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                        {c.count} 项
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-slate-600" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center gap-2 border-t border-slate-100 bg-white px-6 py-3">
          <button className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]">
            导出报表
          </button>
          <button className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)] transition-all duration-150 hover:bg-blue-700 active:scale-[0.98]">
            查看完整清单
          </button>
        </footer>
      </div>
    </div>
  );
}

function BatchReassignModal({
  onClose,
  blockedTasks,
  personLoads,
}: {
  onClose: () => void;
  blockedTasks: BlockedTask[];
  personLoads: PersonLoad[];
}) {
  const shouldReduceMotion = useReducedMotion();
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [targetPerson, setTargetPerson] = useState<PersonLoad | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const BLOCKED_TASKS = blockedTasks;
  const PERSON_LOADS = personLoads;

  const toggleTask = (id: string) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const confirmReassign = () => {
    if (selectedTasks.size === 0 || !targetPerson) return;
    const selected = BLOCKED_TASKS.filter((task) => selectedTasks.has(task.task_id));
    recordAudit({
      actor: DIRECTOR_AUDIT_ACTOR,
      action: "system.bulk_reassign",
      resource: { type: "system", id: `batch-${Date.now()}`, name: "批量重分配任务" },
      comment: `批量转派 ${selected.length} 个阻塞任务给 ${targetPerson.name}`,
      metadata: {
        to: targetPerson.name,
        task_count: selected.length,
        task_ids: selected.map((task) => task.task_id),
      },
      source: "web",
    });
    selected.forEach((task) => {
      recordAudit({
        actor: DIRECTOR_AUDIT_ACTOR,
        action: "task.reassigned",
        resource: { type: "task", id: task.task_id, name: task.title },
        changes: [{ field: "owner", before: task.owner, after: targetPerson.name }],
        comment: "批量重分配中转派任务",
        metadata: { blocked_days: task.days_blocked, reason: task.reason },
        source: "web",
      });
    });
    setConfirmed(true);
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={DIRECTOR_FAST_TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={DIRECTOR_PANEL_TRANSITION}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <span className="font-semibold text-slate-800">批量重分配任务</span>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!confirmed ? (
            <>
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">选择要转派的任务</div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {BLOCKED_TASKS.length === 0 ? (
                    <DashboardEmptyPanel title="暂无可转派任务" description="后端当前没有返回阻塞任务，无法执行批量转派。" />
                  ) : (
                    BLOCKED_TASKS.map((t) => (
                      <label key={t.task_id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selectedTasks.has(t.task_id)}
                          onChange={() => toggleTask(t.task_id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-800">{t.title}</div>
                          <div className="text-xs text-slate-400">{t.task_id} · 阻塞 {t.days_blocked} 天</div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">选择目标负责人</div>
                <div className="grid grid-cols-2 gap-2">
                  {PERSON_LOADS.filter((p) => !p.on_leave).length === 0 ? (
                    <div className="col-span-2">
                      <DashboardEmptyPanel title="暂无可用负责人" description="请先在人员管理中维护研发成员后再执行转派。" />
                    </div>
                  ) : (
                    PERSON_LOADS.filter((p) => !p.on_leave).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setTargetPerson(p)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          targetPerson?.id === p.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50",
                        )}
                      >
                        <div className="font-medium text-slate-800">{p.name}</div>
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>{p.position}</span>
                          <span className={cn(
                            "font-semibold",
                            p.max_tasks > 0 && p.task_count / p.max_tasks >= 0.75 ? "text-orange-500" : "text-emerald-600",
                          )}>
                            {p.task_count} 个任务
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  取消
                </button>
                <button
                  disabled={selectedTasks.size === 0 || !targetPerson}
                  onClick={confirmReassign}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.20)] transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
                >
                  确认转派
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <div className="py-4 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
              <p className="font-semibold text-slate-800">转派成功</p>
              <p className="mt-1 text-sm text-slate-500">
                已将 {selectedTasks.size} 个任务转派给 {targetPerson?.name}，痕迹已记录。
              </p>
              <button onClick={onClose} className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200">
                关闭
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RDDirectorDashboardPage() {
  const shouldReduceMotion = useReducedMotion();
  const [selectedPerson, setSelectedPerson] = useState<PersonLoad | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryProgress | null>(null);
  const [showReassign, setShowReassign] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [showProposalDialog, setShowProposalDialog] = useState(false);
  const [dashboard, setDashboard] = useState<DirectorDashboardPayload>(EMPTY_DIRECTOR_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canReassignTasks = usePermission(PERMISSIONS.RD_TASK_REASSIGN);
  const canManagePeople = usePermission(PERMISSIONS.RD_PEOPLE_MANAGE);
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);

  const loadDashboard = () => {
    setLoading(true);
    fetchRdDirectorDashboard<DirectorDashboardPayload>()
      .then((payload) => {
        setDashboard(normalizeDirectorDashboard(payload));
        setLoadError(null);
      })
      .catch((error) => {
        setDashboard(EMPTY_DIRECTOR_DASHBOARD);
        setLoadError(error instanceof Error ? error.message : "负责人看板数据读取失败");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRdDirectorDashboard<DirectorDashboardPayload>()
      .then((payload) => {
        if (cancelled) return;
        setDashboard(normalizeDirectorDashboard(payload));
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setDashboard(EMPTY_DIRECTOR_DASHBOARD);
        setLoadError(error instanceof Error ? error.message : "负责人看板数据读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const CATEGORY_PROGRESS = dashboard.categoryProgress;
  const PERSON_LOADS = dashboard.personLoads;
  const BLOCKED_TASKS = dashboard.blockedTasks;
  const PENDING_ASSIGN = dashboard.pendingAssign;

  // Pagination state for the three lists
  const [blockedPage, setBlockedPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [personPage, setPersonPage] = useState(1);
  const BLOCKED_PAGE_SIZE = 3;
  const PENDING_PAGE_SIZE = 3;
  const PERSON_PAGE_SIZE = 6;

  const blockedTotalPages = Math.max(1, Math.ceil(BLOCKED_TASKS.length / BLOCKED_PAGE_SIZE));
  const pendingTotalPages = Math.max(1, Math.ceil(PENDING_ASSIGN.length / PENDING_PAGE_SIZE));
  const personTotalPages = Math.max(1, Math.ceil(PERSON_LOADS.length / PERSON_PAGE_SIZE));

  const blockedSafePage = Math.min(blockedPage, blockedTotalPages);
  const pendingSafePage = Math.min(pendingPage, pendingTotalPages);
  const personSafePage = Math.min(personPage, personTotalPages);
  const blockedRangeStart = BLOCKED_TASKS.length === 0 ? 0 : (blockedSafePage - 1) * BLOCKED_PAGE_SIZE + 1;
  const pendingRangeStart = PENDING_ASSIGN.length === 0 ? 0 : (pendingSafePage - 1) * PENDING_PAGE_SIZE + 1;
  const personRangeStart = PERSON_LOADS.length === 0 ? 0 : (personSafePage - 1) * PERSON_PAGE_SIZE + 1;

  const blockedPaged = BLOCKED_TASKS.slice(
    (blockedSafePage - 1) * BLOCKED_PAGE_SIZE,
    blockedSafePage * BLOCKED_PAGE_SIZE,
  );
  const pendingPaged = PENDING_ASSIGN.slice(
    (pendingSafePage - 1) * PENDING_PAGE_SIZE,
    pendingSafePage * PENDING_PAGE_SIZE,
  );
  const personPaged = PERSON_LOADS.slice(
    (personSafePage - 1) * PERSON_PAGE_SIZE,
    personSafePage * PERSON_PAGE_SIZE,
  );

  // Open a person by name (used from task collaborators / owner links)
  const openPersonByName = (name: string) => {
    const p = PERSON_LOADS.find((x) => x.name === name);
    if (p) {
      setSelectedTask(null);
      setSelectedPerson(p);
    }
  };

  // Open a task by id or title (used from person tasks list, blocked, pending)
  const openTask = (idOrTitle: string, ownerHint?: string) => {
    setSelectedTask(lookupTask(idOrTitle, ownerHint));
  };

  const totalTasks = CATEGORY_PROGRESS.reduce((s, c) => s + c.total, 0);
  const totalCompleted = CATEGORY_PROGRESS.reduce((s, c) => s + c.completed, 0);
  const totalInProgress = CATEGORY_PROGRESS.reduce((s, c) => s + c.in_progress, 0);
  const totalBlocked = CATEGORY_PROGRESS.reduce((s, c) => s + c.blocked, 0);
  const overallRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;
  const isDashboardEmpty =
    !loading &&
    CATEGORY_PROGRESS.length === 0 &&
    PERSON_LOADS.length === 0 &&
    BLOCKED_TASKS.length === 0 &&
    PENDING_ASSIGN.length === 0;

  // ───── People management drill-down (hidden sub-page) ─────────────────────
  if (showPeople && canManagePeople) {
    return <RDPeopleManagementPage onBack={() => setShowPeople(false)} />;
  }

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={DIRECTOR_PANEL_TRANSITION}
      className="min-h-full p-8"
    >
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">厂长驾驶舱</h1>
            <p className="mt-0.5 text-sm text-slate-500">全局视图 · 高级权限专属 · 实时同步</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在同步
              </span>
            )}
            {loadError && !loading && (
              <button
                type="button"
                onClick={loadDashboard}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
              >
                接口读取失败，点击重试
              </button>
            )}
            {canReassignTasks && (
              <button
                onClick={() => setShowReassign(true)}
                className="flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/60 hover:text-blue-700 hover:shadow-[0_12px_24px_rgba(37,99,235,0.08)] active:translate-y-0 active:scale-[0.98]"
              >
                <Users className="h-4 w-4" />
                批量重分配
              </button>
            )}
            {canDirectProject && (
              <button
                onClick={() => setShowProposalDialog(true)}
                className="group flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(99,102,241,0.28)] transition-all duration-150 hover:-translate-y-0.5 hover:from-violet-700 hover:to-blue-700 hover:shadow-[0_14px_28px_rgba(99,102,241,0.32)] active:translate-y-0 active:scale-[0.98]"
                title="拥有直接立项权限时可绕过审核流程"
              >
                <Sparkles className="h-4 w-4 transition-transform group-hover:rotate-12" />
                AI 立项
                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
            {canManagePeople && (
              <button
                onClick={() => setShowPeople(true)}
                className="group flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.24)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-[0_14px_28px_rgba(37,99,235,0.28)] active:translate-y-0 active:scale-[0.98]"
              >
                <UserCog className="h-4 w-4" />
                人员管理
                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        </div>

        {/* KPI Row */}
        <div className="mb-5 grid grid-cols-4 gap-4">
          {[
            { label: "总任务数", value: totalTasks, sub: "全部分类", color: "text-slate-800" },
            { label: "完成率", value: `${overallRate}%`, sub: `${totalCompleted} 已完成`, color: "text-emerald-600" },
            { label: "进行中", value: totalInProgress, sub: "正常执行", color: "text-blue-600" },
            { label: "阻塞/异常", value: totalBlocked, sub: "需要关注", color: "text-red-500" },
          ].map((kpi) => (
            <motion.div
              key={kpi.label}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={DIRECTOR_PANEL_TRANSITION}
              whileHover={shouldReduceMotion ? undefined : { y: -2 }}
              className="rounded-2xl border border-white bg-white p-4 shadow-sm transition-shadow hover:shadow-[0_14px_30px_rgba(15,23,42,0.07)]"
            >
              <div className={cn("text-3xl font-bold", kpi.color)}>{kpi.value}</div>
              <div className="mt-1 text-sm font-medium text-slate-700">{kpi.label}</div>
              <div className="text-xs text-slate-400">{kpi.sub}</div>
            </motion.div>
          ))}
        </div>

        {(loading || isDashboardEmpty) && (
          <div className="mb-5 rounded-2xl border border-dashed border-slate-200 bg-white/70 p-6 text-center shadow-sm">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <BarChart2 className="h-5 w-5" />}
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-800">
              {loading ? "正在读取研发负责人看板" : "暂无负责人看板数据"}
            </div>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-400">
              {loading
                ? "正在从后端接口同步分类进度、人员负载、阻塞任务和待指派任务。"
                : "后端当前返回空数据，页面已保留完整结构，新增任务或导入研发数据后会自动呈现看板内容。"}
            </p>
            {loadError && (
              <p className="mt-2 text-xs text-amber-600">{loadError}</p>
            )}
            {!loading && (
              <button
                type="button"
                onClick={loadDashboard}
                className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                重新读取
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-5">
          {/* Left: Category Progress + Bottlenecks */}
          <div className="col-span-2 space-y-5">
            {/* Category Progress */}
            <div className="rounded-2xl border border-white bg-white/70 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <BarChart2 className="h-4 w-4 text-blue-500" />
                  分类进度
                </h2>
                <span className="text-[11px] text-slate-400">点击分类查看详情</span>
              </div>
              <div className="space-y-2">
                {CATEGORY_PROGRESS.length === 0 ? (
                  <DashboardEmptyPanel
                    title={loading ? "正在读取分类进度" : "暂无分类进度"}
                    description={loading ? "请稍候，系统正在同步研发分类统计。" : "当前没有研发分类任务数据。"}
                  />
                ) : CATEGORY_PROGRESS.map((cat) => {
                  const completedRate = cat.total > 0 ? Math.round((cat.completed / cat.total) * 100) : 0;
                  const inProgressRate = cat.total > 0 ? Math.round((cat.in_progress / cat.total) * 100) : 0;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className="group w-full cursor-pointer rounded-xl border border-transparent px-3 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-200 hover:bg-white hover:shadow-[0_8px_20px_rgba(15,23,42,0.05)] active:translate-y-0 active:scale-[0.99]"
                    >
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium text-slate-700">
                          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", cat.color)} />
                          {cat.label}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-slate-400">
                          {cat.completed}/{cat.total} 完成
                          {cat.blocked > 0 && (
                            <span className="text-red-400">⚠ {cat.blocked} 阻塞</span>
                          )}
                          <ChevronRight className="h-3 w-3 text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-slate-500" />
                        </span>
                      </div>
                      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="bg-emerald-400 transition-all"
                          style={{ width: `${completedRate}%` }}
                          title={`已完成 ${completedRate}%`}
                        />
                        <div
                          className="bg-blue-300 transition-all"
                          style={{ width: `${inProgressRate}%` }}
                          title={`进行中 ${inProgressRate}%`}
                        />
                      </div>
                      <div className="mt-0.5 flex gap-4 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-2.5 rounded-sm bg-emerald-400" />已完成 {completedRate}%</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-2.5 rounded-sm bg-blue-300" />进行中 {inProgressRate}%</span>
                        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-2.5 rounded-sm bg-slate-200" />未开始 {100 - completedRate - inProgressRate}%</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottlenecks */}
            <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  瓶颈识别 · 阻塞任务
                  <span className="rounded-full bg-orange-100 px-1.5 text-xs text-orange-700">{BLOCKED_TASKS.length}</span>
                </h2>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {blockedRangeStart}
                  {" - "}
                  {Math.min(blockedSafePage * BLOCKED_PAGE_SIZE, BLOCKED_TASKS.length)}
                  <span className="mx-1 text-slate-300">/</span>
                  {BLOCKED_TASKS.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {blockedPaged.length === 0 ? (
                  <DashboardEmptyPanel
                    title={loading ? "正在读取阻塞任务" : "暂无阻塞任务"}
                    description={loading ? "请稍候，系统正在同步异常任务。" : "当前没有阻塞或异常任务。"}
                  />
                ) : blockedPaged.map((t) => (
                    <div
                      key={t.task_id}
                      onClick={() => openTask(t.task_id, t.owner)}
                      className="group flex cursor-pointer items-start gap-3 rounded-xl border border-orange-100 bg-white px-4 py-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_8px_20px_rgba(234,88,12,0.08)] active:translate-y-0"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-xs font-bold text-red-600 transition-transform group-hover:scale-105">
                        {t.days_blocked}天
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-400">{t.task_id}</span>
                          <span className="text-sm font-medium text-slate-800 group-hover:text-slate-900">{t.title}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          负责人: {t.owner} · 阻塞原因: {t.reason}
                        </div>
                      </div>
                      {canReassignTasks && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowReassign(true); }}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700 transition-all hover:bg-orange-100 active:scale-95"
                        >
                          转派
                          <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              {BLOCKED_TASKS.length > 0 && (
                <MiniPagination
                  page={blockedSafePage}
                  totalPages={blockedTotalPages}
                  onChange={setBlockedPage}
                  className="mt-3 justify-end"
                />
              )}
            </div>

            {/* Pending Assign */}
            {(PENDING_ASSIGN.length > 0 || loading || isDashboardEmpty) && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Loader2 className="h-4 w-4 text-blue-500" />
                    待人工指派
                    <span className="rounded-full bg-blue-100 px-1.5 text-xs text-blue-700">{PENDING_ASSIGN.length}</span>
                  </h2>
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {pendingRangeStart}
                    {" - "}
                    {Math.min(pendingSafePage * PENDING_PAGE_SIZE, PENDING_ASSIGN.length)}
                    <span className="mx-1 text-slate-300">/</span>
                    {PENDING_ASSIGN.length}
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-500">以下任务规则未能自动匹配责任人，请手动指派并补充映射规则</p>
                <div className="space-y-2">
                  {pendingPaged.length === 0 ? (
                    <DashboardEmptyPanel
                      title={loading ? "正在读取待指派任务" : "暂无待指派任务"}
                      description={loading ? "请稍候，系统正在同步任务分配状态。" : "当前没有需要人工指派的研发任务。"}
                    />
                  ) : pendingPaged.map((t) => {
                    const pCfg = PRIORITY_CONFIG[t.ai_priority];
                    return (
                      <div
                        key={t.task_id}
                        onClick={() => openTask(t.task_id, "待指派")}
                        className="group flex cursor-pointer items-center gap-3 rounded-xl border border-blue-100 bg-white px-4 py-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_8px_20px_rgba(37,99,235,0.08)] active:translate-y-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-400">{t.task_id}</span>
                            <span className={cn("rounded border px-1.5 py-0.5 text-xs font-semibold", pCfg.color)}>{pCfg.label}</span>
                          </div>
                          <div className="mt-0.5 text-sm font-medium text-slate-800 group-hover:text-slate-900">{t.title}</div>
                          <div className="text-xs text-slate-400">{t.category_path}</div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowReassign(true); }}
                          className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_16px_rgba(37,99,235,0.18)] transition-all hover:bg-blue-700 active:scale-95"
                        >
                          手动指派
                        </button>
                      </div>
                    );
                  })}
                </div>
                {PENDING_ASSIGN.length > 0 && (
                  <MiniPagination
                    page={pendingSafePage}
                    totalPages={pendingTotalPages}
                    onChange={setPendingPage}
                    className="mt-3 justify-end"
                  />
                )}
              </div>
            )}
          </div>

          {/* Right: Personnel Heatmap */}
          <div className="space-y-5">
            <div className="rounded-2xl border border-white bg-white/70 p-5 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <Users className="h-4 w-4 text-slate-500" />
                  人员负载热力图
                  <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{PERSON_LOADS.length}</span>
                </h2>
                <span className="text-[11px] tabular-nums text-slate-400">
                  {personRangeStart}
                  {" - "}
                  {Math.min(personSafePage * PERSON_PAGE_SIZE, PERSON_LOADS.length)}
                  <span className="mx-1 text-slate-300">/</span>
                  {PERSON_LOADS.length}
                </span>
              </div>
              <p className="mb-4 text-xs text-slate-400">点击查看个人详情和当前任务</p>
              <div className="space-y-2.5">
                {personPaged.length === 0 ? (
                  <DashboardEmptyPanel
                    title={loading ? "正在读取人员负载" : "暂无人员负载数据"}
                    description={loading ? "请稍候，系统正在同步研发成员任务负载。" : "请先维护研发成员，或等待任务数据同步后生成负载热力图。"}
                  />
                ) : personPaged.map((p) => (
                    <PersonCard key={p.id} person={p} selected={selectedPerson?.id === p.id} onSelect={setSelectedPerson} />
                  ))}
              </div>
              {PERSON_LOADS.length > 0 && (
                <MiniPagination
                  page={personSafePage}
                  totalPages={personTotalPages}
                  onChange={setPersonPage}
                  className="mt-3 justify-end"
                />
              )}

              <div className="mt-4 flex flex-wrap gap-2 text-[10px]">
                {[
                  { color: "bg-emerald-400", label: "< 50% 负载" },
                  { color: "bg-amber-400", label: "50–75%" },
                  { color: "bg-orange-400", label: "75–100%" },
                  { color: "bg-red-400", label: "超负荷" },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-1 text-slate-400">
                    <span className={cn("inline-block h-2 w-2 rounded-sm", l.color)} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Hint card: prompt user to click a person */}
            {!selectedPerson && PERSON_LOADS.length > 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/40 p-4 text-center">
                <p className="text-xs text-slate-400">点击左侧任意人员卡片，查看详细档案和任务列表</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals & Drawers */}
      {showReassign && canReassignTasks && (
        <BatchReassignModal
          blockedTasks={BLOCKED_TASKS}
          personLoads={PERSON_LOADS}
          onClose={() => setShowReassign(false)}
        />
      )}
      {selectedPerson && (
        <PersonDetailDrawer
          person={selectedPerson}
          onClose={() => setSelectedPerson(null)}
          onOpenTask={(id, hint) => openTask(id, hint)}
        />
      )}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onOpenPerson={openPersonByName}
        />
      )}
      {selectedCategory && (
        <CategoryDetailDrawer
          category={selectedCategory}
          onClose={() => setSelectedCategory(null)}
          onOpenTask={(id, hint) => {
            setSelectedCategory(null);
            openTask(id, hint);
          }}
          onOpenPerson={(name) => {
            setSelectedCategory(null);
            openPersonByName(name);
          }}
        />
      )}

      <RDProjectProposalDialog
        open={showProposalDialog && canDirectProject}
        onClose={() => setShowProposalDialog(false)}
        userRole="director"
      />
    </motion.div>
  );
}
