// 采购模块 · 共享展示组件与元数据（复刻研发驾驶舱同款视觉）。
import { useCallback, useEffect, useMemo, useState } from "react";
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
  pending_rd_review: { label: "待研发审核", pill: "border-violet-300 bg-violet-50 text-violet-700" },
  pending_confirm: { label: "待处理", pill: "border-rose-300 bg-rose-50 text-rose-700", next: "确认提交" },
  pending_inquiry: { label: "待询价", pill: "border-amber-200 bg-amber-50 text-amber-700", next: "选择报价" },
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
export const INQUIRY_FLOW: ProcStatus[] = ["pending_rd_review", "pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "in_transit", "partial_arrival", "completed"];
export const DIRECT_FLOW: ProcStatus[] = ["pending_rd_review", "pending_confirm", "pending_purchase", "in_transit", "completed"];

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
    active && "ring-2 ring-indigo-300",
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
  value, onChange, options, placeholder, className, disabled, autoFocus, onEnter, onEscape,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<ComboOption | string>;
  placeholder?: string;
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
  value, onChange, placeholder, className, clearable = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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
            <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(""); setOpen(false); }} className="h-7 rounded-lg px-2 text-xs text-slate-500 hover:text-indigo-600">{translate("清除")}</Button>
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

export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="w-auto max-w-[90vw] border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">{translate("商品图片")}</DialogTitle>
        <MobileZoomableImage
          src={url}
          alt={translate("商品图片")}
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
  onConfirm: () => void;
}

/**
 * 用法：const { confirm, confirmDialog } = useConfirmDialog();
 * confirm({ title, desc, tone: 'danger', onConfirm: () => void doDelete() });
 * 页面 JSX 末尾渲染 {confirmDialog}。文案由调用方先 t() 好再传入。
 */
export function useConfirmDialog() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback((request: ConfirmRequest) => setReq(request), []);
  const confirmDialog = req ? (
    <AlertDialog open onOpenChange={(open) => { if (!open) setReq(null); }}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-bold text-slate-900">{req.title}</AlertDialogTitle>
          {req.desc && <AlertDialogDescription className="text-sm text-slate-500">{req.desc}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{translate("取消")}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(req.tone === "danger" && "bg-rose-600 text-white hover:bg-rose-700")}
            onClick={() => { const run = req.onConfirm; setReq(null); run(); }}
          >
            {req.actionLabel ?? translate("确定")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
  return { confirm, confirmDialog };
}