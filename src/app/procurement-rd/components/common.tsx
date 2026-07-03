// 采购与研发协同 · 共享展示组件与状态元数据。
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, MessageSquare, RotateCcw, Upload, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { procActions, useProc } from "../store";
import type { ContractApproval, PaymentApproval, ReqStatus, ReviewItem } from "../data/types";

// ── 需求状态元数据 ────────────────────────────────────────────────────────────
export const REQ_STATUS_META: Record<ReqStatus, { label: string; pill: string; bar: string }> = {
  draft: { label: "草稿", pill: "border-slate-200 bg-slate-50 text-slate-600", bar: "bg-slate-400" },
  pending_inquiry: { label: "待询价", pill: "border-amber-200 bg-amber-50 text-amber-700", bar: "bg-amber-500" },
  inquiring: { label: "询价中", pill: "border-blue-200 bg-blue-50 text-blue-700", bar: "bg-blue-500" },
  pending_sample: { label: "待到样", pill: "border-violet-200 bg-violet-50 text-violet-700", bar: "bg-violet-500" },
  testing: { label: "测试中", pill: "border-cyan-200 bg-cyan-50 text-cyan-700", bar: "bg-cyan-500" },
  priced: { label: "已定价", pill: "border-emerald-200 bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  pending_contract: { label: "待签合同", pill: "border-indigo-200 bg-indigo-50 text-indigo-700", bar: "bg-indigo-500" },
};

/** 需求流程完整步骤（步骤条用）。 */
export const REQ_FLOW: ReqStatus[] = [
  "draft",
  "pending_inquiry",
  "inquiring",
  "pending_sample",
  "testing",
  "priced",
  "pending_contract",
];

export function StatusPill({ status, className }: { status: ReqStatus; className?: string }) {
  const m = REQ_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.pill, className)}>
      {m.label}
    </span>
  );
}

export function SourceTag({ source }: { source: "rd" | "self" }) {
  return source === "rd" ? (
    <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
      研发流转
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
      采购自建
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const map = {
    high: { label: "高", cls: "border-red-200 bg-red-50 text-red-600" },
    medium: { label: "中", cls: "border-amber-200 bg-amber-50 text-amber-600" },
    low: { label: "低", cls: "border-slate-200 bg-slate-50 text-slate-500" },
  }[priority];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", map.cls)}>{map.label}优先</span>;
}

/** 企业微信小图标示意（审批来源）。 */
export function WeChatMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded bg-[#07C160]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#07C160]", className)}>
      <MessageSquare className="h-3 w-3" />
      企微
    </span>
  );
}

export function ContractApprovalPill({ status }: { status: ContractApproval }) {
  const map: Record<ContractApproval, { label: string; cls: string }> = {
    approving: { label: "审批中", cls: "border-amber-200 bg-amber-50 text-amber-700" },
    effective: { label: "已通过·已生效", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    rejected: { label: "已驳回", cls: "border-red-200 bg-red-50 text-red-700" },
  };
  const m = map[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.cls)}>{m.label}</span>
      <WeChatMark />
    </span>
  );
}

export function PaymentPill({ status }: { status: PaymentApproval }) {
  const map: Record<PaymentApproval, { label: string; cls: string }> = {
    none: { label: "未发起", cls: "border-slate-200 bg-slate-50 text-slate-500" },
    approving: { label: "审批中", cls: "border-amber-200 bg-amber-50 text-amber-700" },
    partial: { label: "首付已通过", cls: "border-blue-200 bg-blue-50 text-blue-700" },
    approved: { label: "已通过", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  };
  const m = map[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.cls)}>{m.label}</span>
      <WeChatMark />
    </span>
  );
}

/** 灰色圆角占位图（代替真实图纸/附件）。 */
export function PlaceholderImage({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-400", className)}>
      <FileText className="h-5 w-5" />
      <span className="px-2 text-center text-[11px] leading-tight">{label}</span>
    </div>
  );
}

/** 需求流程横向步骤条。 */
export function StepBar({ current }: { current: ReqStatus }) {
  const idx = REQ_FLOW.indexOf(current);
  return (
    <div className="flex items-center">
      {REQ_FLOW.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold",
                  done && "border-emerald-500 bg-emerald-500 text-white",
                  active && "border-indigo-500 bg-indigo-500 text-white",
                  !done && !active && "border-slate-200 bg-white text-slate-400",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("whitespace-nowrap text-[10px]", active ? "font-semibold text-indigo-600" : "text-slate-400")}>
                {REQ_STATUS_META[s].label}
              </span>
            </div>
            {i < REQ_FLOW.length - 1 && <div className={cn("mx-1 h-0.5 w-6", done ? "bg-emerald-400" : "bg-slate-200")} />}
          </div>
        );
      })}
    </div>
  );
}

/** 评审模式「待确认」橙色标签，点击弹出事项说明。评审模式关闭时不渲染。 */
export function ReviewTag({ item, className }: { item: ReviewItem; className?: string }) {
  const { reviewMode } = useProc();
  const [open, setOpen] = useState(false);
  if (!reviewMode) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-600 shadow-sm transition hover:bg-orange-100",
          className,
        )}
      >
        {item.label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-orange-100 bg-orange-50/70 px-6 py-4">
              <div>
                <div className="text-xs font-semibold text-orange-500">{item.label} · 待确认事项</div>
                <h3 className="mt-1 text-base font-bold text-slate-900">{item.title}</h3>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-5 text-sm leading-6 text-slate-600">{item.text}</div>
            <div className="flex justify-end border-t border-slate-100 px-6 py-3">
              <button type="button" onClick={() => setOpen(false)} className="material-button-primary px-4 py-2 text-sm">
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const fmtMoney = (n: number) => `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── 人员彩色头像（按名字取色）─────────────────────────────────────────────────
const AVATAR_PALETTE = [
  "bg-indigo-100 text-indigo-600",
  "bg-violet-100 text-violet-600",
  "bg-blue-100 text-blue-600",
  "bg-cyan-100 text-cyan-600",
  "bg-emerald-100 text-emerald-600",
  "bg-amber-100 text-amber-600",
  "bg-rose-100 text-rose-600",
  "bg-teal-100 text-teal-600",
];
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
export function PersonAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm",
        avatarColor(name),
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}

// ── KPI 概览卡 ────────────────────────────────────────────────────────────────
type Tone = "slate" | "indigo" | "violet" | "amber" | "emerald";
const STAT_TONES: Record<Tone, { text: string; chip: string; bar: string }> = {
  slate: { text: "text-slate-900", chip: "bg-slate-100 text-slate-500", bar: "bg-slate-300" },
  indigo: { text: "text-indigo-600", chip: "bg-indigo-50 text-indigo-600", bar: "bg-indigo-400" },
  violet: { text: "text-violet-600", chip: "bg-violet-50 text-violet-600", bar: "bg-violet-400" },
  amber: { text: "text-amber-600", chip: "bg-amber-50 text-amber-600", bar: "bg-amber-400" },
  emerald: { text: "text-emerald-600", chip: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-400" },
};
export function StatCard({
  label,
  value,
  hint,
  tone = "slate",
  Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  Icon?: React.ComponentType<{ className?: string }>;
}) {
  const t = STAT_TONES[tone];
  return (
    <div className="material-card relative overflow-hidden px-5 py-4">
      <span className={cn("absolute inset-y-0 left-0 w-1", t.bar)} />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-slate-400">{label}</div>
          <div className={cn("mt-1 text-2xl font-bold tabular-nums", t.text)}>{value}</div>
          {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
        </div>
        {Icon && (
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", t.chip)}>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
    </div>
  );
}

// ── 页面 Hero 头（图标 + 标题 + 说明 + 右侧插槽）──────────────────────────────
export function PageHeader({
  badge,
  title,
  description,
  right,
  Icon,
}: {
  badge?: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
  Icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="material-card mb-3 flex items-start justify-between gap-4 px-6 py-5">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div>
          {badge && <span className="inline-block rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">{badge}</span>}
          <h1 className={cn("text-xl font-bold text-slate-900", badge && "mt-2")}>{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// ── 分页器 ────────────────────────────────────────────────────────────────────
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const clamp = (p: number) => Math.min(pages, Math.max(1, p));
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
      <span>
        共 <b className="text-slate-700">{total}</b> 条 · 每页 {pageSize} 条 · 第 {clamp(page)}/{pages} 页
      </span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(clamp(page - 1))} className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50">
          <ChevronLeft className="h-3.5 w-3.5" />
          上一页
        </button>
        {Array.from({ length: pages }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPage(i + 1)}
            className={cn("h-7 w-7 rounded-lg border text-xs", clamp(page) === i + 1 ? "border-indigo-300 bg-indigo-50 font-semibold text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}
          >
            {i + 1}
          </button>
        ))}
        <button type="button" disabled={page >= pages} onClick={() => onPage(clamp(page + 1))} className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-slate-50">
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── 通用导入弹窗（SheetJS 解析 xlsx，按表头映射；含模板下载与示例数据）────────────
export function ImportModal({
  title,
  templateColumns,
  onImport,
  onSample,
  onClose,
}: {
  title: string;
  templateColumns: string[];
  onImport: (rows: Record<string, string>[]) => number;
  onSample?: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const parseFile = async (file: File) => {
    setBusy(true);
    try {
      const mod = await import("xlsx");
      const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
      const cleaned = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])));
      const n = onImport(cleaned);
      if (n > 0) onClose();
    } catch {
      // 交由调用方 toast
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = async () => {
    const mod = await import("xlsx");
    const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([templateColumns]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "模板");
    XLSX.writeFile(wb, `${title}_导入模板.xlsx`);
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">批量导入 · {title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 px-6 py-5">
          <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center transition hover:border-indigo-300 hover:bg-indigo-50/40", busy && "pointer-events-none opacity-60")}>
            <FileSpreadsheet className="h-8 w-8 text-indigo-400" />
            <span className="text-sm font-medium text-slate-600">{busy ? "正在解析…" : "点击选择 .xlsx 文件导入"}</span>
            <span className="text-[11px] text-slate-400">按表头自动映射字段；表头需与模板一致</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void parseFile(f);
              }}
            />
          </label>
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline">
              <Download className="h-3.5 w-3.5" />
              下载导入模板
            </button>
            {onSample && (
              <button type="button" onClick={() => { onSample(); onClose(); }} className="inline-flex items-center gap-1 font-medium text-slate-500 hover:text-indigo-600">
                <Upload className="h-3.5 w-3.5" />
                载入示例数据（演示）
              </button>
            )}
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
            模板列：{templateColumns.join(" / ")}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 各页右上角常驻：评审模式开关（默认开启）+ 重置演示数据。 */
export function DemoControls() {
  const { reviewMode } = useProc();
  return (
    <div className="mb-3 flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={() => procActions.setReviewMode(!reviewMode)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
          reviewMode ? "border-orange-300 bg-orange-50 text-orange-600" : "border-slate-200 bg-white text-slate-500",
        )}
        title="开启后各界面显示「待确认」标签；关闭用于会后截干净的界面图"
      >
        <span className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition", reviewMode ? "bg-orange-400" : "bg-slate-300")}>
          <span className={cn("absolute h-3 w-3 rounded-full bg-white transition", reviewMode ? "left-3.5" : "left-0.5")} />
        </span>
        评审模式
      </button>
      <button
        type="button"
        onClick={() => procActions.reset()}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        重置演示数据
      </button>
    </div>
  );
}
