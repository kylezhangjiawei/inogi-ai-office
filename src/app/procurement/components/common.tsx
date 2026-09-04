// 采购模块 · 共享展示组件与元数据（复刻研发驾驶舱同款视觉）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../../auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { CalendarDays } from "lucide-react";
import { Calendar } from "../../components/ui/calendar";
import { Command, CommandItem, CommandList } from "../../components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Toggle } from "../../components/ui/toggle";
import { cn } from "../../components/ui/utils";
import { MobileZoomableImage } from "../../components/MobileZoomableImage";
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

type BuyerDirectoryScope = "eligible" | "department" | "all";
const buyerCache = new Map<BuyerDirectoryScope, BuyerCandidate[]>();
const buyerPromise = new Map<BuyerDirectoryScope, Promise<BuyerCandidate[]>>();

function loadBuyersOnce(scope: BuyerDirectoryScope): Promise<BuyerCandidate[]> {
  const cached = buyerCache.get(scope);
  if (cached) return Promise.resolve(cached);
  if (!buyerPromise.has(scope)) {
    buyerPromise.set(
      scope,
      listBuyerCandidates(undefined, scope)
        .then((list) => { buyerCache.set(scope, list); return list; })
        .catch(() => { buyerPromise.delete(scope); return [] as BuyerCandidate[]; }),
    );
  }
  return buyerPromise.get(scope)!;
}

/**
 * 负责人目录：suggestions 供输入建议；resolveUserId 把输入的姓名映射为 userId
 * （同名多人时返回 undefined，宁可只存名字也不张冠李戴，与头像目录同原则）。
 */
export function useBuyerDirectory(options?: { includeAll?: boolean; departmentOnly?: boolean }) {
  const includeAll = options?.includeAll ?? false;
  const departmentOnly = options?.departmentOnly ?? false;
  const scope: BuyerDirectoryScope = departmentOnly ? "department" : includeAll ? "all" : "eligible";
  const [users, setUsers] = useState<BuyerCandidate[]>(buyerCache.get(scope) ?? []);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void loadBuyersOnce(scope).then((list) => { if (alive) setUsers(list); });
    };
    refresh();
    const unsubscribe = subscribeDepartmentChanges(() => {
      buyerCache.clear();
      buyerPromise.clear();
      refresh();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [scope]);
  return useMemo(() => {
    const idByName = new Map<string, string | null>(); // null = 同名冲突
    const deptByName = new Map<string, string | undefined>();
    for (const u of users.filter((user) => user.canReceiveTasks !== false)) {
      idByName.set(u.name, idByName.has(u.name) ? null : u.id);
      if (!deptByName.has(u.name)) deptByName.set(u.name, u.department);
    }
    const names = new Set(users.filter((user) => user.canReceiveTasks !== false).map((u) => u.name));
    return {
      users,
      suggestions: Array.from(names),
      deptOf: (name: string) => deptByName.get(name),
      resolveUserId: (name: string): string | undefined => idByName.get(name) ?? undefined,
    };
  }, [users]);
}


export const fmtMoney = (n?: number) => (typeof n === "number" ? `¥${n.toLocaleString(i18nLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");

// ── 状态元数据（含「下一步」按钮文案）─────────────────────────────────────────
export const PROC_STATUS_META: Record<ProcStatus, { label: string; pill: string; next?: string }> = {
  pending_rd_review: { label: "待继续转采购", pill: "border-[#002fa7]/20 bg-[#002fa7]/5 text-[#002fa7]" },
  pending_confirm: { label: "待处理", pill: "border-rose-300 bg-rose-50 text-rose-700", next: "确认提交" },
  pending_inquiry: { label: "待询价", pill: "border-amber-200 bg-amber-50 text-amber-700", next: "选择报价" },
  inquiring: { label: "询价中", pill: "border-[#002fa7]/20 bg-[#002fa7]/5 text-[#002fa7]", next: "完成询价" },
  pending_sample: { label: "待到样", pill: "border-[#002fa7]/20 bg-[#002fa7]/5 text-[#002fa7]", next: "样品已到" },
  testing: { label: "测试中", pill: "border-[#002fa7]/20 bg-[#002fa7]/5 text-[#002fa7]", next: "录入测试结论" },
  priced: { label: "已定价", pill: "border-[#002fa7]/20 bg-[#002fa7]/5 text-[#002fa7]", next: "标记已下单" },
  pending_purchase: { label: "待购买", pill: "border-slate-200 bg-slate-50 text-slate-700", next: "打开链接下单" },
  in_transit: { label: "已下单/在途", pill: "border-[#002fa7]/20 bg-[#002fa7]/5 text-[#002fa7]", next: "登记到货" },
  partial_arrival: { label: "部分到货", pill: "border-[#002fa7]/20 bg-[#002fa7]/5 text-[#002fa7]", next: "登记到货" },
  completed: { label: "已完成", pill: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  cancelled: { label: "已取消", pill: "border-slate-200 bg-slate-100 text-slate-500" },
};

/**
 * 只能登记免费样品来货的状态，与服务端 PROC_FREE_SAMPLE_ONLY_STATUSES 一致。
 * 这两档还没选定报价，T+ 里不可能有采购单号；放开登记只为让供应商提前寄样当场留痕。
 */
export const FREE_SAMPLE_ONLY_STATUSES: ProcStatus[] = ["pending_inquiry", "inquiring"];

/**
 * 允许「重新维护报价」的状态，与服务端 PROC_QUOTATION_RESETTABLE_STATUSES 一致。
 * 已下单及之后不在其中：那时单价已随采购单出去，改报价会与 T+ 对不上。
 */
export const QUOTE_RESETTABLE_STATUSES: ProcStatus[] = ["inquiring", "pending_sample", "testing", "priced"];

/** 询价长流程 / 直购短流程步骤条节点。 */
export const INQUIRY_FLOW: ProcStatus[] = ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "in_transit", "partial_arrival", "completed"];
export const DIRECT_FLOW: ProcStatus[] = ["pending_confirm", "pending_purchase", "in_transit", "completed"];

/**
 * 回退可选节点，与服务端 PROC_ROLLBACK_MAIN_FLOW / PROC_ROLLBACK_DIRECT_FLOW 一致。
 *
 * 不复用上面的 INQUIRY_FLOW / DIRECT_FLOW：那两个是步骤条的展示序列，含
 * pending_rd_review（采购侧无权处置的审核前置环节），拿来当回退目标会给出一个
 * 必然被服务端 400 的选项。
 */
const ROLLBACK_MAIN_FLOW: ProcStatus[] = ["pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "in_transit", "partial_arrival", "completed"];
const ROLLBACK_DIRECT_FLOW: ProcStatus[] = ["pending_confirm", "pending_purchase", "in_transit", "partial_arrival", "completed"];

/** 采购侧不可回退的状态，与服务端 PROC_ROLLBACK_BLOCKED_STATUSES 一致。 */
const ROLLBACK_BLOCKED_STATUSES: ProcStatus[] = ["pending_rd_review", "cancelled"];

/**
 * 当前状态可回退到哪些节点：同一条流程线上排在它前面的全部节点，越靠后的越靠近当前。
 * 只能往回退，不能借回退往前跳——这与服务端 rollbackTargetsOf 是同一套判据。
 */
export function rollbackTargetsOf(status: ProcStatus, method?: string | null): ProcStatus[] {
  if (ROLLBACK_BLOCKED_STATUSES.includes(status)) return [];
  const flow = method === "direct" ? ROLLBACK_DIRECT_FLOW : ROLLBACK_MAIN_FLOW;
  const index = flow.indexOf(status);
  if (index <= 0) return [];
  return flow.slice(0, index);
}

/**
 * 回退到目标节点会清掉哪些数据，用于确认框里如实告知。
 * 判据与服务端 rollbackCleanupFor 一致：目标节点下本不该存在的数据都会被清理。
 */
export function rollbackCleanupHintOf(target: ProcStatus): string[] {
  const flow = ROLLBACK_MAIN_FLOW;
  const index = target === "pending_purchase" ? flow.indexOf("priced") : flow.indexOf(target);
  const hints: string[] = [];
  if (index >= 0 && index <= flow.indexOf("pending_inquiry")) hints.push("已确认的报价与报价金额");
  if (index >= 0 && index < flow.indexOf("in_transit")) hints.push("T+ 采购单关联与到货数量");
  return hints;
}

export function StatusPill({ status, className }: { status: ProcStatus; className?: string }) {
  useI18n();
  const m = PROC_STATUS_META[status];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", m.pill, className)}>{translate(m.label)}</span>;
}
export function SourcePill({ source }: { source: ProcSource }) {
  useI18n();
  return source === "rd" ? (
    <span className="inline-flex items-center rounded-full border border-[#002fa7]/20 bg-[#002fa7]/5 px-2 py-0.5 text-xs font-medium text-[#002fa7]">{translate("研发流转")}</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">{translate("采购自建")}</span>
  );
}
export function BusinessLinePill({ line }: { line: BusinessLine }) {
  useI18n();
  return line === "rd" ? (
    <span className="inline-flex items-center rounded-full border border-[#002fa7]/20 bg-[#002fa7]/5 px-2 py-0.5 text-xs font-medium text-[#002fa7]">{translate("研发")}</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">{translate("生产")}</span>
  );
}
export function MethodPill({ method }: { method: ProcMethod }) {
  useI18n();
  return method === "inquiry" ? (
    <span className="inline-flex items-center rounded-full border border-[#002fa7]/20 bg-[#002fa7]/5 px-2 py-0.5 text-xs font-medium text-[#002fa7]">{translate("询价采购")}</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">{translate("电商直购")}</span>
  );
}
export function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  useI18n();
  const m = { high: ["高优先", "border-rose-200 bg-rose-50 text-rose-600"], medium: ["中优先", "border-amber-200 bg-amber-50 text-amber-600"], low: ["低优先", "border-slate-200 bg-slate-50 text-slate-500"] }[priority];
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
      pill = "border-rose-200 bg-rose-50 text-rose-600";
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
const PALETTE = ["bg-[#002fa7]/10 text-[#002fa7]", "bg-slate-100 text-slate-600", "bg-[#002fa7]/5 text-[#002fa7]", "bg-slate-200 text-slate-700"];
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
  indigo: { text: "text-[#002fa7]", chip: "bg-[#002fa7]/5 text-[#002fa7]", bar: "bg-[#002fa7]/60" },
  violet: { text: "text-[#002fa7]", chip: "bg-[#002fa7]/5 text-[#002fa7]", bar: "bg-[#002fa7]/60" },
  amber: { text: "text-amber-600", chip: "bg-amber-50 text-amber-600", bar: "bg-amber-400" },
  emerald: { text: "text-emerald-600", chip: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-400" },
  red: { text: "text-rose-600", chip: "bg-rose-50 text-rose-600", bar: "bg-rose-400" },
};
export function StatCell({ label, value, tone = "slate", active, badge, onClick, Icon }: { label: string; value: React.ReactNode; tone?: Tone; active?: boolean; badge?: boolean; onClick?: () => void; Icon?: React.ComponentType<{ className?: string }> }) {
  const t = TONES[tone];
  const content = (
    <>
      <span className={cn("absolute inset-y-0 left-0 w-1", t.bar)} />
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-xs text-slate-400">
          {label}
          {badge && <span className="inline-block size-1.5 rounded-full bg-rose-500" />}
        </div>
        <div className={cn("mt-0.5 text-2xl font-bold tabular-nums", t.text)}>{value}</div>
      </div>
      {Icon && <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", t.chip)}><Icon className="size-4" /></span>}
    </>
  );
  const className = cn(
    "material-card relative flex h-auto items-center justify-between gap-2 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-shadow duration-150 sm:px-4 sm:py-3",
    onClick && "cursor-pointer hover:shadow-md",
    active && "ring-2 ring-[#002fa7]/20",
  );
  if (!onClick) return <div className={className}>{content}</div>;
  return (
    <Toggle pressed={Boolean(active)} onPressedChange={onClick} className={className}>
      {content}
    </Toggle>
  );
}
export function PageHeader({ Icon, badge, title, description, right }: { Icon?: React.ComponentType<{ className?: string }>; badge?: string; title: string; description?: string; right?: React.ReactNode }) {
  return (
    <div className="material-card mb-3 flex items-start justify-between gap-4 px-6 py-5">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#002fa7] text-white shadow-sm"><Icon className="h-5 w-5" /></span>}
        <div className="min-w-0">
          {badge && <span className="inline-block rounded-full bg-[#002fa7]/5 px-2.5 py-0.5 text-[11px] font-semibold text-[#002fa7]">{badge}</span>}
          <h1 className={cn("text-balance text-xl font-bold text-slate-900", badge && "mt-2")}>{title}</h1>
          {description && <p className="mt-1 text-pretty text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** 灰色圆角占位图（代替真实图纸/附件）。 */
export function PlaceholderImage({ label, className }: { label: string; className?: string }) {
  return (
    <div role="img" aria-label={label} className={cn("flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-400", className)}>
      <span aria-hidden="true" className="text-lg">🖼️</span>
      <span className="px-1 text-center text-[10px] leading-tight">{label}</span>
    </div>
  );
}

// ── 联想输入组合框（替代原生 datalist：Input + Popover + Command）────────────

export interface ComboOption {
  value: string;
  /** 右侧灰字提示（如部门），仅展示 */
  hint?: string;
}

/**
 * 可自由输入的联想组合框：输入过滤候选、点选回填，也允许提交列表外的自由文本。
 * 候选点击用 onSelect（cmdk 处理 pointer 事件），焦点始终留在输入框。
 */
export function ComboInput({
  value, onChange, options, placeholder, className, disabled, autoFocus, ariaLabel, onEnter, onEscape,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<ComboOption | string>;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** 回车（弹层已收起后）提交，如「输入姓名回车添加」 */
  onEnter?: () => void;
  onEscape?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const normalized = useMemo(
    () => options.map((o) => (typeof o === "string" ? { value: o } : o)),
    [options],
  );
  const kw = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = kw ? normalized.filter((o) => o.value.toLowerCase().includes(kw)) : normalized;
    return list.slice(0, 50);
  }, [normalized, kw]);
  // 输入值恰好等于唯一候选时不再弹层（选完即收）
  const show = open && filtered.length > 0 && !(filtered.length === 1 && filtered[0].value === value);
  return (
    // modal：在 Dialog/Sheet 内使用时，点击候选不被外层判定为 outside 而误关弹窗
    <Popover modal open={show} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={className}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          // 用 pointerdown 而非 focus 触发：避免 Dialog/Sheet 打开时的自动聚焦把候选列表弹出来
          onPointerDown={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") setOpen(false);
            if (e.key === "Enter") onEnter?.();
            if (e.key === "Escape") onEscape?.();
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popper-anchor-width)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-52">
            {filtered.map((opt) => (
              <CommandItem
                key={opt.value}
                value={opt.value}
                // onMouseDown 先于 popover 的 dismiss 逻辑执行，避免弹层先收起吃掉 click
                onMouseDown={(e) => { e.preventDefault(); onChange(opt.value); setOpen(false); }}
                onSelect={() => { onChange(opt.value); setOpen(false); }}
              >
                <span className="truncate">{opt.value}</span>
                {opt.hint && <span className="ml-auto shrink-0 text-xs text-slate-400">{opt.hint}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── 日期选择（替代原生 type=date：按钮触发 Popover + Calendar，对齐研发模块形态）──

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 日期输入：值为 YYYY-MM-DD 或空串；可清除。modal 模式保证在 Dialog/Sheet 内点选不误关外层弹窗。 */
export function DateInput({
  value, onChange, placeholder, ariaLabel, className, clearable = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // 用本地时区构造，避免 UTC 解析导致日期偏移一天
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          aria-label={ariaLabel}
          variant="outline"
          className={cn(
            "flex h-9 w-full justify-between rounded-lg border-slate-200 bg-input-background px-3 text-left text-sm font-normal hover:bg-input-background hover:text-inherit",
            !value && "text-slate-400",
            className,
          )}
        >
          <span className="tabular-nums">{value || placeholder || translate("选择日期")}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => { onChange(d ? fmtDay(d) : ""); setOpen(false); }}
          // 中文界面本地化月份/星期（零依赖，不影响其他模块的 Calendar）；英文界面走默认
          {...(i18nLocale() === "zh-CN"
            ? {
                formatters: {
                  formatCaption: (month: Date) => `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`,
                  formatWeekdayName: (weekday: Date) => ["日", "一", "二", "三", "四", "五", "六"][weekday.getDay()],
                },
              }
            : {})}
        />
        {clearable && value && (
          <div className="border-t border-slate-100 px-3 py-2 text-right">
            <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(""); setOpen(false); }} className="h-7 rounded-lg px-2 text-xs text-slate-500 hover:text-[#002fa7]">{translate("清除")}</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 负责人联想输入：候选来自用户目录 + 历史负责人，hint 显示部门。 */
export function BuyerComboInput({
  ...props
}: Omit<React.ComponentProps<typeof ComboInput>, "options">) {
  const { suggestions, deptOf } = useBuyerDirectory();
  const options = useMemo(
    () => suggestions.map((name) => ({ value: name, hint: deptOf(name) })),
    [suggestions, deptOf],
  );
  return <ComboInput {...props} options={options} />;
}

// ── 图片大图预览（OSS bucket 强制下载，导航打开会变下载；img 渲染不受影响）──

export function ImageLightbox({ url, alt = translate("商品图片预览"), onClose }: { url: string; alt?: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="w-auto max-w-[90vw] border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">{alt}{!alt && translate("商品图片预览")}</DialogTitle>
        <MobileZoomableImage
          src={url}
          alt={alt}
          className="h-[85vh] w-[90vw]"
          imageClassName="rounded-xl bg-white shadow-2xl"
          stopPropagation={false}
        />
      </DialogContent>
    </Dialog>
  );
}

// ── 确认对话框（替代 window.confirm，Radix AlertDialog）──────────────────────

interface ConfirmRequest {
  title: string;
  /** 已翻译的说明文案 */
  desc?: string;
  /** 确认按钮文案，缺省「确定」 */
  actionLabel?: string;
  /** danger = 红色确认键（删除类） */
  tone?: "danger" | "default";
  onConfirm: () => void | boolean | Promise<void | boolean>;
}

/**
 * 用法：const { confirm, confirmDialog } = useConfirmDialog();
 * confirm({ title, desc, tone: 'danger', onConfirm: () => doDelete() });
 * 异步操作必须返回 Promise；失败可抛出异常或返回 false，保留原请求供重试。
 * 页面 JSX 末尾渲染 {confirmDialog}。文案由调用方先 t() 好再传入。
 */
export function useConfirmDialog() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const confirm = useCallback((request: ConfirmRequest) => {
    if (busyRef.current) return;
    setError(null);
    setReq(request);
  }, []);
  const execute = async () => {
    if (!req || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await req.onConfirm();
      if (result !== false) setReq(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : translate("操作失败，请重试"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const confirmDialog = req ? (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busyRef.current) setReq(null); }}>
      <AlertDialogContent
        aria-busy={busy}
        onOpenAutoFocus={() => { previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => {
          const trigger = previousFocusRef.current;
          if (trigger?.isConnected) { event.preventDefault(); trigger.focus(); }
        }}
        className="rounded-2xl"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance text-base font-bold text-slate-900">{req.title}</AlertDialogTitle>
          {req.desc && <AlertDialogDescription className="text-pretty text-sm text-slate-500">{req.desc}</AlertDialogDescription>}
        </AlertDialogHeader>
        {error && <p role="alert" className="text-pretty text-sm text-rose-600">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{translate("取消")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={cn(req.tone === "danger" && "bg-rose-600 text-white hover:bg-rose-700")}
            onClick={(event) => { event.preventDefault(); void execute(); }}
          >
            {busy ? translate("处理中…") : req.actionLabel ?? translate("确定")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
  return { confirm, confirmDialog };
}
