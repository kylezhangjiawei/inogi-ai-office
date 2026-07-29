// 采购模块 · 共享展示组件与元数据（复刻研发驾驶舱同款视觉）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../../auth";
import { cn } from "../../components/ui/utils";
import { useAvatarDirectory } from "../../lib/userAvatar";
import { subscribeDepartmentChanges } from "../../lib/departmentDirectory";
import { hasPermission } from "../../lib/permissions";
import { i18nLocale, t as translate, useI18n } from "../../lib/i18n";
import { listBuyerCandidates, type BuyerCandidate } from "../../lib/procurementApi";
import { taskMainDate, useProcurementData, type BusinessLine, type ProcMethod, type ProcSource, type ProcStatus, type ProcurementTask } from "../data";

/** 数据变更类动作统一轻提示（本阶段不接逻辑）。 */
export function stageToast() {
  toast.info(translate("流程逻辑将在下一阶段接入"));
}

/**
 * 操作码判断（动态码版）：can('proc-task:reassign')。
 * 码在系统管理 · 权限目录里配置到角色；固定码场景用 usePermission 即可。
 */
export function useProcCan() {
  const { user } = useAuth();
  const permissions = user?.permissions;
  return useCallback(
    (code: string | null | undefined) => Boolean(code && hasPermission(permissions ?? [], code)),
    [permissions],
  );
}

// ── 负责人目录（转派/建单人员选择）──────────────────────────────────────────
// 来源 GET /procurement/buyers（全部启用用户），并入现有任务里的历史负责人名。
// 模块级单例 + Promise 去重：一次会话只拉一次。

let buyerCache: BuyerCandidate[] | null = null;
let buyerPromise: Promise<BuyerCandidate[]> | null = null;

function loadBuyersOnce(): Promise<BuyerCandidate[]> {
  if (buyerCache) return Promise.resolve(buyerCache);
  if (!buyerPromise) {
    buyerPromise = listBuyerCandidates()
      .then((list) => { buyerCache = list; return list; })
      .catch(() => { buyerPromise = null; return [] as BuyerCandidate[]; });
  }
  return buyerPromise;
}

/**
 * 负责人目录：suggestions 供输入建议；resolveUserId 把输入的姓名映射为 userId
 * （同名多人时返回 undefined，宁可只存名字也不张冠李戴，与头像目录同原则）。
 */
export function useBuyerDirectory() {
  const { tasks } = useProcurementData();
  const [users, setUsers] = useState<BuyerCandidate[]>(buyerCache ?? []);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void loadBuyersOnce().then((list) => { if (alive) setUsers(list); });
    };
    refresh();
    const unsubscribe = subscribeDepartmentChanges(() => {
      buyerCache = null;
      buyerPromise = null;
      refresh();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return useMemo(() => {
    const idByName = new Map<string, string | null>(); // null = 同名冲突
    const deptByName = new Map<string, string | undefined>();
    for (const u of users) {
      idByName.set(u.name, idByName.has(u.name) ? null : u.id);
      if (!deptByName.has(u.name)) deptByName.set(u.name, u.department);
    }
    const names = new Set(users.map((u) => u.name));
    for (const task of tasks) if (task.buyer) names.add(task.buyer);
    return {
      suggestions: Array.from(names),
      deptOf: (name: string) => deptByName.get(name),
      resolveUserId: (name: string): string | undefined => idByName.get(name) ?? undefined,
    };
  }, [users, tasks]);
}

/** 负责人输入建议：渲染一次，input 上加 list="proc-buyer-list"。 */
export function BuyerSuggestDatalist() {
  const { suggestions, deptOf } = useBuyerDirectory();
  return (
    <datalist id="proc-buyer-list">
      {suggestions.map((name) => <option key={name} value={name} label={deptOf(name)} />)}
    </datalist>
  );
}

export const fmtMoney = (n?: number) => (typeof n === "number" ? `¥${n.toLocaleString(i18nLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");

// ── 状态元数据（含「下一步」按钮文案）─────────────────────────────────────────
export const PROC_STATUS_META: Record<ProcStatus, { label: string; pill: string; next?: string }> = {
  pending_confirm: { label: "待处理", pill: "border-rose-300 bg-rose-50 text-rose-700", next: "确认提交" },
  pending_inquiry: { label: "待询价", pill: "border-amber-200 bg-amber-50 text-amber-700", next: "录报价" },
  inquiring: { label: "询价中", pill: "border-blue-200 bg-blue-50 text-blue-700", next: "选定报价" },
  pending_sample: { label: "待到样", pill: "border-violet-200 bg-violet-50 text-violet-700", next: "样品已到" },
  testing: { label: "测试中", pill: "border-cyan-200 bg-cyan-50 text-cyan-700", next: "录入测试结论" },
  priced: { label: "已定价", pill: "border-teal-200 bg-teal-50 text-teal-700", next: "标记已下单" },
  pending_purchase: { label: "待购买", pill: "border-orange-200 bg-orange-50 text-orange-700", next: "打开链接下单" },
  in_transit: { label: "已下单/在途", pill: "border-indigo-200 bg-indigo-50 text-indigo-700", next: "登记到货" },
  partial_arrival: { label: "部分到货", pill: "border-indigo-200 bg-indigo-50 text-indigo-700", next: "登记到货" },
  completed: { label: "已完成", pill: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  cancelled: { label: "已取消", pill: "border-slate-200 bg-slate-100 text-slate-500" },
};

/** 询价长流程 / 直购短流程步骤条节点。 */
export const INQUIRY_FLOW: ProcStatus[] = ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "in_transit", "partial_arrival", "completed"];
export const DIRECT_FLOW: ProcStatus[] = ["pending_purchase", "in_transit", "completed"];

export function StatusPill({ status, className }: { status: ProcStatus; className?: string }) {
  useI18n();
  const m = PROC_STATUS_META[status];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.pill, className)}>{translate(m.label)}</span>;
}
export function SourcePill({ source }: { source: ProcSource }) {
  useI18n();
  return source === "rd" ? (
    <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">{translate("研发流转")}</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">{translate("采购自建")}</span>
  );
}
export function BusinessLinePill({ line }: { line: BusinessLine }) {
  useI18n();
  return line === "rd" ? (
    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{translate("研发")}</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">{translate("生产")}</span>
  );
}
export function MethodPill({ method }: { method: ProcMethod }) {
  useI18n();
  return method === "inquiry" ? (
    <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">{translate("询价采购")}</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">{translate("电商直购")}</span>
  );
}
export function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  useI18n();
  const m = { high: ["高优先", "border-red-200 bg-red-50 text-red-600"], medium: ["中优先", "border-amber-200 bg-amber-50 text-amber-600"], low: ["低优先", "border-slate-200 bg-slate-50 text-slate-500"] }[priority];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", m[1])}>{translate(m[0])}</span>;
}

/** 主日期徽标：剩 N 天 / 逾期 N 天 / 临期黄。 */
export function MainDateBadge({ task, big = false }: { task: ProcurementTask; big?: boolean }) {
  useI18n();
  const info = taskMainDate(task);
  let pill = "border-slate-200 bg-slate-50 text-slate-500";
  let text = "";
  if (info.days != null) {
    if (info.days < 0) {
      pill = "border-red-200 bg-red-50 text-red-600";
      text = translate("逾期 {count} 天", { count: Math.abs(info.days) });
    } else if (info.days <= 3) {
      pill = "border-amber-200 bg-amber-50 text-amber-600";
      text = translate("剩 {count} 天", { count: info.days });
    } else {
      text = translate("剩 {count} 天", { count: info.days });
    }
  }
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] text-slate-400">{translate(info.label)}</span>
      <span className={cn("font-bold tabular-nums text-slate-900", big ? "text-lg" : "text-sm")}>{info.date ?? "—"}</span>
      {text && <span className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-medium", pill)}>{text}</span>}
    </div>
  );
}

// ── 头像（按名取色）───────────────────────────────────────────────────────────
const PALETTE = ["bg-indigo-100 text-indigo-600", "bg-violet-100 text-violet-600", "bg-blue-100 text-blue-600", "bg-cyan-100 text-cyan-600", "bg-emerald-100 text-emerald-600", "bg-amber-100 text-amber-600", "bg-rose-100 text-rose-600", "bg-teal-100 text-teal-600"];
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function PersonAvatar({ name, size = "sm" }: { name: string; size?: "xs" | "sm" | "md" }) {
  // 真实用户头像目录（/api/auth/avatars，按姓名兜底匹配）；命中显示图片，否则回退首字圆圈
  const resolveAvatar = useAvatarDirectory();
  const avatarUrl = resolveAvatar(name);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [avatarUrl]);

  const dim = size === "xs" ? "h-6 w-6 text-[10px]" : size === "md" ? "h-9 w-9 text-sm" : "h-7 w-7 text-xs";
  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        title={name}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={cn("inline-block shrink-0 rounded-full object-cover", dim)}
      />
    );
  }
  return <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", dim, avatarColor(name))}>{name.slice(0, 1)}</span>;
}

// ── KPI 卡 / 页面头（复刻研发驾驶舱） ─────────────────────────────────────────
type Tone = "slate" | "indigo" | "violet" | "amber" | "emerald" | "red";
const TONES: Record<Tone, { text: string; chip: string; bar: string }> = {
  slate: { text: "text-slate-900", chip: "bg-slate-100 text-slate-500", bar: "bg-slate-300" },
  indigo: { text: "text-indigo-600", chip: "bg-indigo-50 text-indigo-600", bar: "bg-indigo-400" },
  violet: { text: "text-violet-600", chip: "bg-violet-50 text-violet-600", bar: "bg-violet-400" },
  amber: { text: "text-amber-600", chip: "bg-amber-50 text-amber-600", bar: "bg-amber-400" },
  emerald: { text: "text-emerald-600", chip: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-400" },
  red: { text: "text-red-600", chip: "bg-red-50 text-red-600", bar: "bg-red-400" },
};
export function StatCell({ label, value, tone = "slate", active, badge, onClick, Icon }: { label: string; value: React.ReactNode; tone?: Tone; active?: boolean; badge?: boolean; onClick?: () => void; Icon?: React.ComponentType<{ className?: string }> }) {
  const t = TONES[tone];
  return (
    <button type="button" onClick={onClick} className={cn("material-card relative flex items-center justify-between gap-2 overflow-hidden px-4 py-3 text-left transition", onClick && "cursor-pointer hover:shadow-md", active && "ring-2 ring-indigo-300")}>
      <span className={cn("absolute inset-y-0 left-0 w-1", t.bar)} />
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-xs text-slate-400">
          {label}
          {badge && <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />}
        </div>
        <div className={cn("mt-0.5 text-2xl font-bold tabular-nums", t.text)}>{value}</div>
      </div>
      {Icon && <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.chip)}><Icon className="h-4 w-4" /></span>}
    </button>
  );
}
export function PageHeader({ Icon, badge, title, description, right }: { Icon?: React.ComponentType<{ className?: string }>; badge?: string; title: string; description?: string; right?: React.ReactNode }) {
  return (
    <div className="material-card mb-3 flex items-start justify-between gap-4 px-6 py-5">
      <div className="flex items-start gap-3">
        {Icon && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm"><Icon className="h-5 w-5" /></span>}
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

/** 灰色圆角占位图（代替真实图纸/附件）。 */
export function PlaceholderImage({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-400", className)}>
      <span className="text-lg">🖼️</span>
      <span className="px-1 text-center text-[10px] leading-tight">{label}</span>
    </div>
  );
}
