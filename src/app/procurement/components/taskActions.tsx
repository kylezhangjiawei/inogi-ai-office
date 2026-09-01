// 采购任务「下一步」动作的统一执行器。
//
// 卡片和详情抽屉共用同一套动作语义，避免两处各写一遍流转规则：
//   待处理   → 确认接收（二次确认）
//   待询价   → 从供应商报价库多选报价，一次确认并自动生成任务快照
//   询价中   → 选定报价（仅兼容历史任务；新流程不再停留于此节点）
//   待到样   → 样品已到（二次确认）；另可登记出样单（T+ 单号或免费样品，只登记不改状态）
//   测试中   → 录入测试结论（决策类：通过 → 已定价 / 不通过 → 改图重新出样回「待到样」，或退回询价换供应商）
//   已定价 / 待购买 → 标记已下单（填 T+ 采购单号；直购会先打开购买链接）
//   已下单 / 部分到货 → 登记到货（过渡期手工，T+ 接通后改由同步驱动）
//
// 位置策略：**做这个动作需不需要看卡片以外的信息**。
//   执行类（信息已充分）留在卡片，弹二次确认即可；
//   决策类（要对比报价 / 看图纸样品）在卡片上点只会打开详情，避免盲选。
// 所有写操作一律经过弹窗，不存在「点一下就变」的路径。
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import { AlertTriangle, ExternalLink, Loader2, Search, Store } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { Checkbox } from "../../components/ui/checkbox";
import { ScrollArea } from "../../components/ui/scroll-area";
import { toast } from "sonner";
import { useNavigate } from "react-router";

import { cn } from "../../components/ui/utils";
import { t as translate, useI18n } from "../../lib/i18n";
import {
  cancelProcTask,
  confirmQuotationsFromQuoteBook,
  confirmProcTask,
  deleteProcTask,
  linkPurchaseOrders,
  listTaskQuoteBookOptions,
  listQuotations,
  reassignProcTask,
  receiveProcTask,
  selectQuotation,
  transitionProcTask,
  type ProcurementTask,
  type Quotation,
  type TaskQuoteBookOption,
} from "../../lib/procurementApi";
import { applyProcTaskUpdate, refreshProcurement } from "../data";
import { BuyerComboInput, DateInput, fmtMoney, PROC_STATUS_META, useBuyerDirectory } from "./common";

type FormKind = "quote" | "select" | "order" | "receive" | "reassign" | "confirm" | "test";

/** 通用确认弹窗的内容配置。 */
interface ConfirmSpec {
  title: string;
  desc: string;
  actionLabel: string;
  tone?: "primary" | "danger";
  run: () => Promise<unknown>;
  okText: string;
}

interface PendingForm {
  kind: FormKind;
  task: ProcurementTask;
  confirm?: ConfirmSpec;
}

interface ActionRunResult {
  ok: boolean;
  error?: string;
}

/**
 * 决策类状态：动作依赖卡片上看不到的信息（报价对比 / 图纸样品），
 * 从卡片触发时只打开详情，不在卡片上弹决策框。
 */
export const DECISION_STATUSES = ["inquiring", "testing"];

/** 终态：后端 PROC_TERMINAL_STATUSES 的前端对应，这些任务不能再「取消」，只能删除记录。 */
const TERMINAL_STATUSES = ["completed", "cancelled"];

/** 尚未开始履约、删除不会丢业务留痕的状态。 */
const NOT_STARTED_STATUSES = ["pending_confirm", "pending_inquiry", "pending_purchase"];

/**
 * 采购任务的删除/取消处置档位。与后端保持一致：
 *   review    待研发审核 → 采购侧无权处置，只能由研发管理员从审核入口打回（DELETE/cancel 都会 400）
 *   terminal  已完成/已取消 → cancelTask 会报「任务已完结」，只能删记录
 *   cancel    履约中 → 标记「已取消」保留留痕
 *   delete    未开始 → 真删
 */
export function removalModeOf(task: ProcurementTask): "review" | "terminal" | "cancel" | "delete" {
  if (task.status === "pending_rd_review") return "review";
  if (TERMINAL_STATUSES.includes(task.status)) return "terminal";
  return NOT_STARTED_STATUSES.includes(task.status) ? "delete" : "cancel";
}

/**
 * 「下一步」按钮所需操作码（与后端各端点 @Permissions 一致），
 * 供卡片/详情按码显隐按钮；终态无下一步返回 null。
 */
export function nextPermissionOf(task: ProcurementTask): string | null {
  switch (task.status) {
    case "pending_confirm":
      return "proc-task:confirm";
    case "pending_inquiry":
    case "pending_sample":
    case "testing":
      return "proc-task:inquiry";
    case "inquiring":
      return "proc-task:select-quote";
    case "priced":
    case "pending_purchase":
      return "proc-task:order";
    case "in_transit":
    case "partial_arrival":
      return "proc-task:receive";
    default:
      return null;
  }
}

/** 执行类动作的二次确认文案；返回 null 表示该状态走表单。 */
function confirmSpecOf(task: ProcurementTask): ConfirmSpec | null {
  switch (task.status) {
    case "pending_confirm":
      return {
        title: "确认接收该采购需求？",
        desc:
          task.method === "direct"
            ? "确认后任务进入「待购买」，由你在电商平台下单。"
            : "确认后任务进入「待询价」，可从供应商报价库选择有效报价。",
        actionLabel: "确认接收",
        run: () => confirmProcTask(task.id),
        okText: "已确认接收",
      };
    case "pending_sample":
      return {
        title: "确认样品已到？",
        desc: "确认后任务进入「测试中」，由研发对接人评估样品是否达标。",
        actionLabel: "样品已到",
        run: () => transitionProcTask(task.id, "testing", "样品已到，进入测试", task.status),
        okText: "已标记样品到货",
      };
    default:
      return null;
  }
}

function formKindOf(task: ProcurementTask): FormKind | null {
  switch (task.status) {
    case "pending_inquiry":
      return "quote";
    case "inquiring":
      return "select";
    case "testing":
      return "test";
    case "priced":
    case "pending_purchase":
      return "order";
    case "in_transit":
    case "partial_arrival":
      return "receive";
    default:
      return null;
  }
}

/**
 * 用法：const { runNext, reassign, remove, modal } = useProcTaskAction({ onOpenDetail });
 * 把 modal 渲染到组件树里，按钮 onClick 调 runNext(task, 'card' | 'detail')。
 *
 * onOpenDetail 由列表页传入（打开详情抽屉）。决策类动作从卡片触发时走它；
 * 详情抽屉内部不传，动作就地弹窗。
 */
/** 写接口的返回值是不是一条采购任务（部分接口返回 { ok: true } 之类，不能拿来替换 store）。 */
function isProcurementTask(value: unknown): value is ProcurementTask {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; status?: unknown };
  return typeof candidate.id === "string" && typeof candidate.status === "string";
}

export function useProcTaskAction(options?: { onOpenDetail?: (task: ProcurementTask) => void }) {
  const [pending, setPending] = useState<PendingForm | null>(null);
  const [busy, setBusy] = useState(false);
  const onOpenDetail = options?.onOpenDetail;

  const run = useCallback(async (fn: () => Promise<unknown>, okText: string): Promise<ActionRunResult> => {
    setBusy(true);
    try {
      const result = await fn();
      // 写接口返回的就是更新后的任务，立刻替换 store 里的那一条。
      //
      // 不能只靠 refreshProcurement()：它要重拉全部任务和物料，数据量一上来好几秒，
      // 这期间界面还停在旧状态，用户看到的是「点了保存没反应」，于是再点一次——
      // 而「下一步」按钮的含义是由任务状态推导的，刷新一旦在两次点击之间落地，
      // 第二次点的其实已经是下一个动作，任务就这么一节节窜到了「已完成」。
      if (isProcurementTask(result)) applyProcTaskUpdate(result);
      toast.success(okText);
      // 整体刷新照旧在后台跑：物料聚合、列表统计等仍需要它
      void refreshProcurement();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      toast.error(message);
      return { ok: false, error: message };
    } finally {
      setBusy(false);
    }
  }, []);

  const runNext = useCallback(
    (task: ProcurementTask, context: "card" | "detail" = "detail") => {
      // 决策类动作依赖详情里的报价/图纸，从卡片点只打开详情，不在卡片上做决定
      if (context === "card" && DECISION_STATUSES.includes(task.status) && onOpenDetail) {
        onOpenDetail(task);
        return;
      }
      // 直购在标记已下单前先打开购买链接，符合线下实际操作顺序
      if (task.status === "pending_purchase" && task.purchaseLink) {
        window.open(task.purchaseLink, "_blank", "noopener");
      }
      const confirmSpec = confirmSpecOf(task);
      if (confirmSpec) {
        setPending({ kind: "confirm", task, confirm: confirmSpec });
        return;
      }
      const kind = formKindOf(task);
      if (kind) setPending({ kind, task });
    },
    [onOpenDetail],
  );

  const reassign = useCallback((task: ProcurementTask) => setPending({ kind: "reassign", task }), []);

  /** 「待到样」登记出样单：不是状态流转，所以不走 runNext，由详情单独触发。 */
  const linkSampleOrder = useCallback((task: ProcurementTask) => setPending({ kind: "order", task }), []);

  const remove = useCallback((task: ProcurementTask) => {
    const mode = removalModeOf(task);
    // 待研发审核的申请采购侧动不了：取消和删除后端都会 400，直接提示正确入口而不是弹一个必然失败的框
    if (mode === "review") {
      toast.error(translate("该申请尚待研发管理员审核，请由研发管理员从审核入口打回"));
      return;
    }
    const cancelling = mode === "cancel";
    const label = cancelling ? "取消" : "删除";
    setPending({
      kind: "confirm",
      task,
      confirm: {
        title: `确定${label}任务「${task.materialName}」？`,
        // 终态文案带状态名，必须走 t() 的占位符而不是模板字符串拼接：
        // 拼出来的整句不是字典 key，英文态永远查不到、也没法在 i18n 管理页补译。
        desc: cancelling
          ? "任务已进入执行阶段，将标记为「已取消」并保留操作留痕，不会真正删除。"
          : mode === "terminal"
            ? translate("任务已是「{status}」终态，删除后将连同留痕一并移出驾驶舱，此操作不可恢复。", {
                status: translate(PROC_STATUS_META[task.status].label),
              })
            : "该任务尚未开始执行，将被永久删除，此操作不可恢复。",
        actionLabel: label,
        tone: "danger",
        run: () => (cancelling ? cancelProcTask(task.id, "手动取消") : deleteProcTask(task.id)),
        okText: `已${label}任务`,
      },
    });
  }, []);

  const modal = pending ? (
    pending.kind === "confirm" && pending.confirm ? <ConfirmActionDialog
      pending={pending}
      busy={busy}
      onClose={() => setPending(null)}
      onSubmit={async (fn, okText) => {
        const result = await run(fn, okText);
        if (result.ok) setPending(null);
        return result;
      }}
    /> : <ActionModal
      pending={pending}
      busy={busy}
      onClose={() => setPending(null)}
      onSubmit={async (fn, okText) => {
        const result = await run(fn, okText);
        if (result.ok) setPending(null);
        return result;
      }}
    />
  ) : null;

  return { runNext, reassign, remove, linkSampleOrder, modal, busy };
}

// ── 表单弹窗 ──────────────────────────────────────────────────────────────────

const TITLES: Record<FormKind, string> = {
  quote: "选择供应商报价",
  select: "选定报价",
  order: "标记已下单",
  receive: "登记到货",
  reassign: "转派采购负责人",
  confirm: "",
  test: "录入测试结论",
};

function matchQuoteTier(
  tiers: TaskQuoteBookOption["tiers"],
  quantity: number,
): TaskQuoteBookOption["matchedTier"] | null {
  if (tiers.length === 0 || !Number.isFinite(quantity) || quantity <= 0) return null;
  let matched = tiers[0];
  for (const tier of tiers) {
    if (tier.minQty > quantity) break;
    matched = tier;
  }
  return matched;
}

function ConfirmActionDialog({
  pending,
  busy,
  onClose,
  onSubmit,
}: {
  pending: PendingForm;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fn: () => Promise<unknown>, okText: string) => Promise<ActionRunResult>;
}) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const { task, confirm } = pending;
  if (!confirm) return null;
  const execute = async () => {
    setError("");
    const result = await onSubmit(confirm.run, t(confirm.okText));
    if (!result.ok) setError(result.error ?? t("操作失败，请稍后重试"));
  };
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <AlertDialogContent className="horizon-theme horizon-portal proc-horizon-overlay sm:max-w-lg">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", confirm.tone === "danger" ? "bg-rose-50 text-rose-700" : "bg-[#eef3ff] text-[#002fa7]")}><AlertTriangle className="size-5" /></span>
            <div className="min-w-0">
              <AlertDialogTitle className="text-balance">{t(confirm.title)}</AlertDialogTitle>
              <p className="mt-1 truncate text-xs tabular-nums text-slate-400" title={`${task.code} · ${task.materialName}`}>{task.code} · {task.materialName}</p>
            </div>
          </div>
          <AlertDialogDescription className="pt-2 text-pretty leading-relaxed">{t(confirm.desc)}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("返回检查")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => { event.preventDefault(); void execute(); }}
            className={confirm.tone === "danger" ? "bg-rose-600 text-white hover:bg-rose-700" : "material-button-primary"}
          >
            {busy ? <><Loader2 className="size-4 animate-spin" />{t("正在处理…")}</> : t(confirm.actionLabel)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface PurchaseOrderDraft {
  key: string;
  supplierName: string;
  /** 文本态：下单数量允许现场改（出样 1 件 → 批量 500 件），提交时才解析。 */
  orderedQty: string;
  tpOrderNo: string;
  etaDate: string;
  /** 免费样品来货：T+ 里不会有采购单，本行不填单号。 */
  freeSample: boolean;
}

function formatQuoteAmount(value: number, currency: string): string {
  return currency === "CNY"
    ? fmtMoney(value)
    : `${currency} ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function ActionModal({
  pending,
  busy,
  onClose,
  onSubmit,
}: {
  pending: PendingForm;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fn: () => Promise<unknown>, okText: string) => Promise<ActionRunResult>;
}) {
  const { t } = useI18n();
  const { kind, task, confirm } = pending;
  const { resolveUserId } = useBuyerDirectory();
  const navigate = useNavigate();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderDraft[]>([]);
  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);
  // 只有本次在弹窗里手动改过数量才动任务需求量。存量任务里报价数量之和本就与需求量不等，
  // 不加这道闸，老任务点一次「标记已下单」就会被顺手改写需求数量。
  const [orderedQtyEdited, setOrderedQtyEdited] = useState(false);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [buyer, setBuyer] = useState(task.buyer);
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [quoteBookOptions, setQuoteBookOptions] = useState<TaskQuoteBookOption[]>([]);
  const [quoteBookMaterialId, setQuoteBookMaterialId] = useState<string | null>(task.materialId ?? null);
  const [quoteBookScope, setQuoteBookScope] = useState<"material" | "all">(task.materialId ? "material" : "all");
  const [quoteBookLoading, setQuoteBookLoading] = useState(false);
  const [quoteBookError, setQuoteBookError] = useState("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<string[]>([]);
  const [quoteQuantities, setQuoteQuantities] = useState<Record<string, string>>({});
  const [quoteDiscount, setQuoteDiscount] = useState("0");
  const [quoteConfirmOpen, setQuoteConfirmOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const deferredQuoteSearch = useDeferredValue(quoteSearch.trim().toLocaleLowerCase());
  const visibleQuoteBookOptions = useMemo(() => {
    if (!deferredQuoteSearch) return quoteBookOptions;
    return quoteBookOptions.filter((quote) =>
      `${quote.materialName} ${quote.materialSpec} ${quote.supplierName} ${quote.supplierModel}`
        .toLocaleLowerCase()
        .includes(deferredQuoteSearch),
    );
  }, [deferredQuoteSearch, quoteBookOptions]);
  const visibleQuoteIds = useMemo(
    () => visibleQuoteBookOptions.map((quote) => quote.id),
    [visibleQuoteBookOptions],
  );
  const allVisibleSelected =
    visibleQuoteIds.length > 0
    && visibleQuoteIds.every((id) => selectedQuoteIds.includes(id));
  const selectedQuoteBookOptions = useMemo(
    () => quoteBookOptions.filter((quote) => selectedQuoteIds.includes(quote.id)),
    [quoteBookOptions, selectedQuoteIds],
  );
  const selectedQuoteLines = useMemo(
    () => selectedQuoteBookOptions.map((quote) => {
      const quantity = Number(quoteQuantities[quote.id] ?? task.quantity);
      const matchedTier = matchQuoteTier(quote.tiers, quantity);
      const unitPrice = matchedTier?.unitPrice ?? 0;
      return {
        quote,
        quantity,
        matchedTier,
        unitPrice,
        lineTotal: Number.isFinite(quantity) && quantity > 0 ? unitPrice * quantity : 0,
        valid: Number.isFinite(quantity) && quantity > 0 && Boolean(matchedTier),
      };
    }),
    [quoteQuantities, selectedQuoteBookOptions, task.quantity],
  );
  const selectedQuoteLineById = useMemo(
    () => new Map(selectedQuoteLines.map((line) => [line.quote.id, line] as const)),
    [selectedQuoteLines],
  );
  const quoteCurrencies = useMemo(
    () => Array.from(new Set(selectedQuoteLines.map((line) => line.quote.currency))),
    [selectedQuoteLines],
  );
  const quoteCurrency = quoteCurrencies[0] ?? "CNY";
  const quoteSubtotal = selectedQuoteLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const quoteDiscountAmount = Number(quoteDiscount);
  const quoteTotal = Number.isFinite(quoteDiscountAmount)
    ? Math.max(0, quoteSubtotal - quoteDiscountAmount)
    : quoteSubtotal;

  useEffect(() => {
    if (kind !== "select") return;
    let alive = true;
    void listQuotations({ taskId: task.id })
      .then((list) => { if (alive) setQuotes(list); })
      .catch(() => { if (alive) setQuotes([]); });
    return () => { alive = false; };
  }, [kind, task.id]);

  useEffect(() => {
    if (kind !== "order") return;
    let alive = true;
    setPurchaseOrdersLoading(true);
    void listQuotations({ taskId: task.id })
      .then((list) => {
        if (!alive) return;
        const selected = list.filter((quotation) => quotation.isSelected);
        const grouped = new Map<string, { supplierName: string; orderedQty: number }>();
        for (const quotation of selected) {
          const supplierName = quotation.supplierName.trim();
          const key = supplierName || "__unknown__";
          const current = grouped.get(key) ?? { supplierName, orderedQty: 0 };
          current.orderedQty += quotation.quantity ?? task.quantity;
          grouped.set(key, current);
        }
        const drafts = [...grouped.entries()].map(([key, value]) => ({
          key,
          supplierName: value.supplierName,
          orderedQty: String(value.orderedQty),
          tpOrderNo: "",
          etaDate: "",
          freeSample: false,
        }));
        setPurchaseOrders(drafts.length > 0 ? drafts : [{
          key: "__direct__",
          supplierName: "",
          orderedQty: String(task.quantity),
          tpOrderNo: "",
          etaDate: "",
          freeSample: false,
        }]);
      })
      .catch(() => {
        if (!alive) return;
        setPurchaseOrders([{
          key: "__direct__",
          supplierName: "",
          orderedQty: String(task.quantity),
          tpOrderNo: "",
          etaDate: "",
          freeSample: false,
        }]);
      })
      .finally(() => {
        if (alive) setPurchaseOrdersLoading(false);
      });
    return () => { alive = false; };
  }, [kind, task.id, task.quantity]);

  const updatePurchaseOrder = (key: string, patch: Partial<PurchaseOrderDraft>) => {
    setFormError("");
    setPurchaseOrders((current) => current.map((item) => (
      item.key === key ? { ...item, ...patch } : item
    )));
  };

  useEffect(() => {
    if (kind !== "quote") return;
    const controller = new AbortController();
    setQuoteBookLoading(true);
    setQuoteBookError("");
    void listTaskQuoteBookOptions(task.id, controller.signal)
      .then((result) => {
        setQuoteBookOptions(result.quotes);
        setQuoteBookMaterialId(result.materialId);
        setQuoteBookScope(result.scope);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setQuoteBookOptions([]);
        setQuoteBookError(err instanceof Error ? err.message : "报价库加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoteBookLoading(false);
      });
    return () => controller.abort();
  }, [kind, task.id]);

  const remaining = Math.max(0, task.quantity - task.arrivedQty);
  // 「待到样」借用下单弹窗登记出样单：只落关联和预计到样，任务状态不动。
  const isSampleOrder = task.status === "pending_sample";
  // 免费样品不是需求量的一部分（样品 1 件 + 批量 500 件 ≠ 需要 501 件），不计入登记总量。
  const orderedTotal = purchaseOrders
    .filter((item) => !item.freeSample)
    .reduce((sum, item) => sum + (Number(item.orderedQty) || 0), 0);
  // 出样 1 件的任务改下批量单时，任务数量不跟着改，到货判定还按 1 件封顶，到 1 件就判完成。
  const quantityChanged = !isSampleOrder && orderedQtyEdited && orderedTotal > 0 && orderedTotal !== task.quantity;
  const toggleQuote = (quoteId: string) => {
    setFormError("");
    const selecting = !selectedQuoteIds.includes(quoteId);
    setSelectedQuoteIds((current) =>
      current.includes(quoteId)
        ? current.filter((id) => id !== quoteId)
        : [...current, quoteId],
    );
    if (selecting) {
      setQuoteQuantities((current) => (
        current[quoteId] === undefined
          ? { ...current, [quoteId]: String(task.quantity > 0 ? task.quantity : 1) }
          : current
      ));
    }
  };
  const toggleAllVisibleQuotes = () => {
    setSelectedQuoteIds((current) => {
      if (allVisibleSelected) {
        const visible = new Set(visibleQuoteIds);
        return current.filter((id) => !visible.has(id));
      }
      return Array.from(new Set([...current, ...visibleQuoteIds]));
    });
    if (!allVisibleSelected) {
      setQuoteQuantities((current) => {
        const next = { ...current };
        for (const quoteId of visibleQuoteIds) {
          if (next[quoteId] === undefined) {
            next[quoteId] = String(task.quantity > 0 ? task.quantity : 1);
          }
        }
        return next;
      });
    }
  };
  const goToQuoteBook = () => {
    const params = new URLSearchParams({ action: "add" });
    if (quoteBookMaterialId) params.set("materialId", quoteBookMaterialId);
    else if (quoteSearch.trim()) params.set("search", quoteSearch.trim());
    onClose();
    navigate(`/proc-quote-book?${params.toString()}`);
  };

  const fail = (message: string) => {
    setFormError(message);
    toast.error(message);
  };

  const execute = async (fn: () => Promise<unknown>, okText: string) => {
    setFormError("");
    const result = await onSubmit(fn, okText);
    if (!result.ok) setFormError(result.error ?? t("操作失败，请稍后重试"));
    return result;
  };

  const submit = () => {
    if (kind === "confirm" && confirm) {
      void execute(confirm.run, t(confirm.okText));
      return;
    }
    if (kind === "quote") {
      if (selectedQuoteIds.length === 0) {
        fail(t("请至少选择一条供应商报价"));
        return;
      }
      if (selectedQuoteLines.some((line) => !line.valid)) {
        fail(t("请为每条已选报价填写大于 0 的采购数量"));
        return;
      }
      if (quoteCurrencies.length > 1) {
        fail(t("不同币种的报价不能合并计算总价，请分开确认"));
        return;
      }
      if (!Number.isFinite(quoteDiscountAmount) || quoteDiscountAmount < 0) {
        fail(t("请填写有效的折扣金额"));
        return;
      }
      if (quoteDiscountAmount > quoteSubtotal) {
        fail(t("折扣金额不能大于报价小计"));
        return;
      }
      setQuoteConfirmOpen(true);
      return;
    }
    if (kind === "order") {
      // 免费样品来货 T+ 里没有采购单，勾了就不校验单号；其余行仍必须给号。
      if (purchaseOrders.length === 0 || purchaseOrders.some((item) => !item.freeSample && !item.tpOrderNo.trim())) {
        fail(t("请填写每家供应商的畅捷通 T+ 采购单号；免费样品请勾选「免费样品」"));
        return;
      }
      if (purchaseOrders.some((item) => !(Number(item.orderedQty) > 0))) {
        fail(t("请填写大于 0 的采购数量"));
        return;
      }
      const freeSampleCount = purchaseOrders.filter((item) => item.freeSample).length;
      const allFreeSample = freeSampleCount === purchaseOrders.length;
      void execute(
        () => linkPurchaseOrders(
          task.id,
          purchaseOrders.map((item) => ({
            tpOrderNo: item.freeSample ? undefined : item.tpOrderNo.trim(),
            isFreeSample: item.freeSample || undefined,
            supplierName: item.supplierName.trim() || undefined,
            orderedQty: Number(item.orderedQty),
            etaDate: item.etaDate || undefined,
          })),
          { syncTaskQuantity: quantityChanged },
        ),
        isSampleOrder
          ? allFreeSample
            ? t("已登记 {count} 条免费出样，任务仍在「待到样」", { count: freeSampleCount })
            : t("已登记 {count} 张出样单，任务仍在「待到样」", { count: purchaseOrders.length })
          : allFreeSample
            ? t("已登记 {count} 条免费样品来货，任务转为已下单", { count: freeSampleCount })
            : t("已关联 {count} 张采购单，任务转为已下单", { count: purchaseOrders.length }),
      );
      return;
    }
    if (kind === "receive") {
      const n = Number(qty);
      if (!Number.isFinite(n) || n <= 0) {
        fail(t("请填写有效的到货数量"));
        return;
      }
      void execute(
        () => receiveProcTask(task.id, { qty: n, note: note.trim() || undefined }),
        t("到货已登记"),
      );
      return;
    }
    if (kind === "reassign") {
      if (!buyer.trim()) {
        fail(t("请填写采购负责人"));
        return;
      }
      // 命中用户目录时同步落 buyerUserId（同名冲突时只存名字）
      void execute(() => reassignProcTask(task.id, buyer.trim(), resolveUserId(buyer.trim())), t("已转派"));
    }
  };

  const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#002fa7]/40 focus:ring-2 focus:ring-[#002fa7]/15";
  const label = "mb-1 block text-xs font-medium text-slate-500";
  const actionSteps = kind === "quote"
    ? [t("选择供应商"), t("核对数量与阶梯价"), t("确认总价")]
    : kind === "order"
      ? [t("核对供应商"), t("登记采购单"), t("保存关联")]
      : kind === "receive"
        ? [t("填写到货数量"), t("核对剩余数量"), t("提交登记")]
        : kind === "reassign"
          ? [t("选择负责人"), t("确认转派")]
          : [];
  const actionStep = kind === "quote"
    ? quoteConfirmOpen ? 2 : selectedQuoteIds.length === 0 ? 0 : 1
    : kind === "order"
      ? purchaseOrders.some((item) => item.freeSample || item.tpOrderNo.trim()) ? 2 : 1
      : kind === "receive"
        ? qty.trim() ? 1 : 0
        : kind === "reassign"
          ? buyer.trim() ? 1 : 0
          : 0;

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o && !quoteConfirmOpen && !busy) onClose(); }}>
        <DialogContent className={cn("horizon-theme horizon-portal proc-horizon-overlay gap-0 overflow-hidden rounded-2xl p-0", kind === "quote" ? "sm:max-w-2xl" : kind === "order" ? "sm:max-w-xl" : "sm:max-w-md")}>
        <DialogHeader className="border-b border-slate-100 px-5 py-4">
          <DialogTitle className="text-balance text-base font-bold text-slate-900">
            {kind === "confirm"
              ? t(confirm?.title ?? "请确认")
              : t(kind === "order" && isSampleOrder ? "登记出样单" : TITLES[kind])}
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-pretty text-xs text-slate-400">{task.code} · {task.materialName}</DialogDescription>
        </DialogHeader>

        {actionSteps.length > 0 && (
          <div className={cn("grid border-b border-slate-100 bg-slate-50/70 px-5 py-2.5", actionSteps.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
            {actionSteps.map((step, index) => <div key={step} className={cn("flex items-center gap-2 text-xs", index === actionStep ? "font-semibold text-[#002fa7]" : index < actionStep ? "text-emerald-700" : "text-slate-400")}><span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", index === actionStep ? "border-[#002fa7] bg-[#002fa7] text-white" : index < actionStep ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>{index + 1}</span><span className="truncate">{step}</span></div>)}
          </div>
        )}

        <div className="space-y-3 px-5 py-4">
          {formError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{formError}</div>}
          {kind === "confirm" && confirm && (
            <div className="flex gap-3">
              <span className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                confirm.tone === "danger" ? "bg-rose-50 text-rose-500" : "bg-[#eef3ff] text-[#002fa7]",
              )}>
                <AlertTriangle className="h-5 w-5" />
              </span>
              <p className="pt-1 text-sm leading-relaxed text-slate-600">{t(confirm.desc)}</p>
            </div>
          )}

          {kind === "test" && (
            <>
              <p className="text-sm text-slate-600">
                {t("样品测试是否通过？通过后进入「已定价」下批量单；不通过分两种走法：同一家供应商改图再出一次样，回「待到样」；换供应商则退回「询价中」重新选报价。")}
              </p>
              <div><span className={label}>{t("测试结论（写入操作留痕）")}</span>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className={cn(field, "h-auto resize-none")}
                  placeholder={t("如：尺寸公差 ±0.05 合格，硬度达标")}
                />
              </div>
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void execute(
                    () => transitionProcTask(task.id, "priced", note.trim() ? `测试通过：${note.trim()}` : "测试通过，已定价", task.status),
                    t("已记录：测试通过"),
                  )}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {t("测试通过 · 下批量")}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void execute(
                      () => transitionProcTask(task.id, "pending_sample", note.trim() ? `测试不通过，改图后重新出样：${note.trim()}` : "测试不通过，改图后重新出样", task.status),
                      t("已记录：测试不通过，等待重新出样"),
                    )}
                    className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                  >
                    {t("不通过 · 改图重新出样")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void execute(
                      () => transitionProcTask(task.id, "inquiring", note.trim() ? `测试不通过，退回询价：${note.trim()}` : "测试不通过，退回询价", task.status),
                      t("已记录：测试不通过，退回询价"),
                    )}
                    className="flex-1 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    {t("不通过 · 换供应商询价")}
                  </button>
                </div>
              </div>
            </>
          )}

          {kind === "quote" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[#dce6ff] bg-[#eef3ff] px-3 py-2 text-pretty text-xs leading-relaxed text-[#002fa7]">
                {quoteBookScope === "all"
                  ? t("该任务未绑定物料主数据，已读取全部有效报价。可按物料、供应商或型号搜索；系统会按任务数量 {count} {unit} 自动匹配阶梯价。", {
                    count: task.quantity.toLocaleString(),
                    unit: t(task.unit),
                  })
                  : t("系统已按任务数量 {count} {unit} 匹配该物料的报价库阶梯价。选择后将自动带出供应商、单价、税费、交期、有效期和备注，并保存为本任务报价快照。", {
                    count: task.quantity.toLocaleString(),
                    unit: t(task.unit),
                  })}
              </div>

              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={quoteSearch}
                    onChange={(event) => setQuoteSearch(event.target.value)}
                    className={cn(field, "pl-9")}
                    placeholder={t("搜索物料、供应商或厂家型号")}
                  />
                </div>
                <button
                  type="button"
                  onClick={goToQuoteBook}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-[#002fa7]/25 hover:bg-[#eef3ff] hover:text-[#002fa7]"
                >
                  <Store className="h-4 w-4" />{t("维护报价库")}<ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>

              {!quoteBookLoading && !quoteBookError && visibleQuoteBookOptions.length > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <label htmlFor="quote-book-select-visible" className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 hover:text-[#002fa7]">
                    <Checkbox
                      id="quote-book-select-visible"
                      checked={allVisibleSelected}
                      onCheckedChange={toggleAllVisibleQuotes}
                      aria-label={t(allVisibleSelected ? "取消全选当前结果" : "全选当前结果")}
                      className="size-[18px] rounded"
                    />
                    {t(allVisibleSelected ? "取消全选当前结果" : "全选当前结果")}
                  </label>
                  <span className="text-xs text-slate-500">
                    {t("已选 {selected} / 当前 {visible} 条", {
                      selected: selectedQuoteIds.length,
                      visible: visibleQuoteBookOptions.length,
                    })}
                  </span>
                </div>
              )}

              {quoteBookLoading ? (
                <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />{t("正在读取供应商报价库…")}
                </div>
              ) : quoteBookError ? (
                <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-4 text-center text-sm text-rose-600">
                  {t(quoteBookError)}
                </div>
              ) : quoteBookOptions.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-white text-[#002fa7] shadow-sm"><Store className="size-5" /></span>
                  <b className="mt-3 text-sm text-slate-700">{t(quoteBookScope === "all" ? "报价库中暂无有效报价" : "报价库中暂无该物料的有效报价")}</b>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{t("请先到供应商报价库新增或更新报价，维护完成后再返回任务选择。")}</p>
                  <button type="button" onClick={goToQuoteBook} className="material-button-primary mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm">
                    {t("去供应商报价库维护")}<ExternalLink className="h-4 w-4" />
                  </button>
                </div>
              ) : visibleQuoteBookOptions.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">{t("未找到匹配的物料、供应商或型号")}</div>
              ) : (
                <ScrollArea className="h-[320px] pr-3">
                <div className="space-y-2">
                  {visibleQuoteBookOptions.map((quote) => {
                    const selected = selectedQuoteIds.includes(quote.id);
                    const line = selectedQuoteLineById.get(quote.id);
                    const matchedTier = line?.matchedTier ?? quote.matchedTier;
                    const quantity = line?.quantity ?? task.quantity;
                    const belowMinOrder = matchedTier.minQty > quantity;
                    return (
                      <div
                        key={quote.id}
                        className={cn(
                          "grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-3 text-left transition",
                          selected ? "border-[#002fa7]/30 bg-[#eef3ff]" : "border-slate-200 hover:border-[#002fa7]/20 hover:bg-slate-50",
                        )}
                      >
                        <Checkbox
                          aria-label={t(selected ? "取消选择该报价" : "选择该报价")}
                          checked={selected}
                          onCheckedChange={() => toggleQuote(quote.id)}
                          className="size-[18px] rounded"
                        />
                        <button type="button" onClick={() => toggleQuote(quote.id)} className="min-w-0 text-left">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <b className="truncate text-sm text-slate-800">{quote.materialName}</b>
                            {quote.materialSpec && <span className="text-xs text-slate-400">{quote.materialSpec}</span>}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-xs font-medium text-slate-600">{quote.supplierName}</span>
                            {quote.supplierModel && <span className="text-xs text-slate-400">{quote.supplierModel}</span>}
                            <span className={cn(
                              "rounded-full border px-1.5 py-0.5 text-[10px]",
                              quote.taxIncluded ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
                            )}>{t(quote.taxIncluded ? "含税" : "未税")}</span>
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                            <span>{t("匹配阶梯")} ≥ {matchedTier.minQty.toLocaleString()}</span>
                            <span>{t("交期 {count} 天", { count: quote.leadTimeDays })}</span>
                            <span>{quote.validUntil ? t("有效期至 {date}", { date: quote.validUntil }) : t("长期有效")}</span>
                            {belowMinOrder && <span className="font-medium text-amber-600">{t("低于起订量")}</span>}
                          </span>
                        </button>
                        <span className="text-right">
                          <b className="block text-base tabular-nums text-slate-900">{formatQuoteAmount(matchedTier.unitPrice, quote.currency)}</b>
                          <small className="text-[10px] text-slate-400">{t("当前数量匹配单价")}</small>
                        </span>
                        {selected && line && (
                          <div className="col-span-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-lg border border-[#dce6ff] bg-white px-3 py-2">
                            <label className="text-xs font-medium text-slate-600">
                              <span className="mb-1 block">{t("采购数量")}</span>
                              <span className="flex items-center gap-2">
                                <Input
                                  value={quoteQuantities[quote.id] ?? String(task.quantity)}
                                  onChange={(event) => { setFormError(""); setQuoteQuantities((current) => ({
                                    ...current,
                                    [quote.id]: event.target.value,
                                  })); }}
                                  inputMode="decimal"
                                  aria-label={t("{material}采购数量", { material: quote.materialName })}
                                  className="h-8 w-32 rounded-lg border-slate-200 text-sm tabular-nums"
                                />
                                <span className="text-slate-400">{t(task.unit) || t("件")}</span>
                              </span>
                            </label>
                            <div className="text-right text-xs text-slate-500">
                              <span className="block">
                                {formatQuoteAmount(line.unitPrice, quote.currency)} × {Number.isFinite(line.quantity) ? line.quantity.toLocaleString() : "—"}
                              </span>
                              <b className="mt-0.5 block text-sm tabular-nums text-slate-900">
                                {t("行金额")} {formatQuoteAmount(line.lineTotal, quote.currency)}
                              </b>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </ScrollArea>
              )}

              {selectedQuoteLines.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_180px] items-end gap-4">
                    <div className="space-y-1 text-sm text-slate-600">
                      <div className="flex items-center justify-between gap-4">
                        <span>{t("报价小计")}</span>
                        <b className="tabular-nums text-slate-900">{formatQuoteAmount(quoteSubtotal, quoteCurrency)}</b>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-1.5">
                        <span className="font-medium text-slate-700">{t("折后总价")}</span>
                        <b className="text-base tabular-nums text-[#002fa7]">{formatQuoteAmount(quoteTotal, quoteCurrency)}</b>
                      </div>
                    </div>
                    <label className="text-xs font-medium text-slate-600">
                      <span className="mb-1 block">{t("折扣金额（{currency}）", { currency: quoteCurrency })}</span>
                      <Input
                        value={quoteDiscount}
                        onChange={(event) => { setQuoteDiscount(event.target.value); setFormError(""); }}
                        inputMode="decimal"
                        className="h-9 rounded-lg border-slate-200 bg-white text-right text-sm tabular-nums"
                        placeholder="0.00"
                      />
                    </label>
                  </div>
                  {quoteCurrencies.length > 1 && (
                    <p className="mt-2 text-xs text-rose-600">{t("不同币种不能合并计算总价，请分开确认。")}</p>
                  )}
                  {Number.isFinite(quoteDiscountAmount) && quoteDiscountAmount > quoteSubtotal && (
                    <p className="mt-2 text-xs text-rose-600">{t("折扣金额不能大于报价小计。")}</p>
                  )}
                </div>
              )}

              {quoteBookOptions.length > 0 && (
                <div className="text-xs text-slate-400">
                  {t("已选择 {count} 条报价；单价来自报价库，采购数量和折扣将在确认后保存。", { count: selectedQuoteIds.length })}
                </div>
              )}
            </div>
          )}

          {kind === "select" && (
            quotes.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">{t("该任务还没有报价，请先从供应商报价库选择")}</div>
            ) : (
              <div className="space-y-2">
                {quotes.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void execute(() => selectQuotation(task.id, q.id), t("已选定报价"))}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:border-[#002fa7]/30 hover:bg-[#eef3ff]/70"
                  >
                    <span className="text-slate-700">{q.supplierName}</span>
                    <span className="flex items-center gap-3">
                      <b className="tabular-nums text-slate-900">{formatQuoteAmount(q.unitPrice, q.currency)}</b>
                      <span className="text-xs text-slate-400">{t("交期 {n} 天", { n: q.leadTimeDays })}</span>
                    </span>
                  </button>
                ))}
                <p className="pt-1 text-xs text-slate-400">
                  {task.needSample ? t("选定后进入「待到样」") : t("选定后直接进入「已定价」")}
                </p>
              </div>
            )
          )}

          {kind === "order" && (
            <div className="space-y-3">
              {isSampleOrder && (
                <div className="rounded-lg border border-[#dce6ff] bg-[#eef3ff] px-3 py-2 text-pretty text-xs leading-relaxed text-[#002fa7]">
                  {t("登记本轮出样单：只保存采购单关联和预计到样日期，任务仍停在「待到样」，样品到了再点「样品已到」。")}
                </div>
              )}
              {purchaseOrders.length > 1 && (
                <div className="rounded-lg border border-[#dce6ff] bg-[#eef3ff] px-3 py-2 text-pretty text-xs leading-relaxed text-[#002fa7]">
                  {t("已按确认报价识别出 {count} 家供应商。请分别填写采购单号，确认后将一次性保存全部关联。", { count: purchaseOrders.length })}
                </div>
              )}
              {purchaseOrdersLoading ? (
                <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />{t("正在读取已确认报价…")}
                </div>
              ) : (
                <ScrollArea className="h-[380px] pr-3">
                <div className="space-y-3">
                  {purchaseOrders.map((item, index) => (
                    <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <b className="truncate text-sm text-slate-800">
                          {item.supplierName || t("未指定供应商")}
                        </b>
                        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                          {t("采购数量")}
                          <Input
                            id={`purchase-order-${index}-quantity`}
                            value={item.orderedQty}
                            onChange={(event) => {
                              setOrderedQtyEdited(true);
                              updatePurchaseOrder(item.key, { orderedQty: event.target.value });
                            }}
                            inputMode="decimal"
                            aria-label={t("{supplier}采购数量", { supplier: item.supplierName || t("未指定供应商") })}
                            className="h-7 w-24 rounded-lg border-slate-200 px-2 py-1 text-right text-xs"
                          />
                          {t(task.unit)}
                        </label>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <label htmlFor={`purchase-order-${index}-number`} className={cn(label, "mb-0")}>
                            {t("畅捷通 T+ 采购单号")}
                            {purchaseOrders.length > 1 ? ` ${index + 1}` : ""}
                          </label>
                          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                            <Checkbox
                              checked={item.freeSample}
                              onCheckedChange={(checked) => updatePurchaseOrder(item.key, {
                                freeSample: checked === true,
                                // 勾上就把已填的单号清掉，避免留一个不会提交的脏值
                                ...(checked === true ? { tpOrderNo: "" } : {}),
                              })}
                              className="size-[16px] rounded"
                            />
                            {t("免费样品 · 无采购单号")}
                          </label>
                        </div>
                        <Input
                          id={`purchase-order-${index}-number`}
                          value={item.tpOrderNo}
                          onChange={(event) => updatePurchaseOrder(item.key, { tpOrderNo: event.target.value })}
                          className={cn(field, item.freeSample && "bg-slate-100 text-slate-400")}
                          disabled={item.freeSample}
                          placeholder={item.freeSample ? t("免费样品来货，不登记采购单号") : `CGDD-2026-${String(index + 1).padStart(4, "0")}`}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor={`purchase-order-${index}-supplier`} className={label}>{t("供应商")}</label>
                          <Input
                            id={`purchase-order-${index}-supplier`}
                            value={item.supplierName}
                            onChange={(event) => updatePurchaseOrder(item.key, { supplierName: event.target.value })}
                            className={field}
                          />
                        </div>
                        <div>
                          <span className={label}>{t(isSampleOrder ? "预计到样" : "预计到货")}</span>
                          <DateInput
                            value={item.etaDate}
                            onChange={(value) => updatePurchaseOrder(item.key, { etaDate: value })}
                            ariaLabel={t("{supplier}{dateType}", {
                              supplier: item.supplierName || t("未指定供应商"),
                              dateType: t(isSampleOrder ? "预计到样日期" : "预计到货日期"),
                            })}
                            className="mb-1 mt-1"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                </ScrollArea>
              )}
              {quantityChanged && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                  {t("登记总量 {total} {unit} · 任务需求 {quantity} {unit}，确认后任务采购数量将同步更新为 {total} {unit}（到货完成按此数量判定）。", {
                    total: orderedTotal.toLocaleString(),
                    quantity: task.quantity.toLocaleString(),
                    unit: t(task.unit),
                  })}
                </div>
              )}
              <p className="text-xs text-slate-400">
                {t("采购单在畅捷通 T+ 中创建，本系统只登记关联关系。")}
                {t("免费样品来货 T+ 里没有采购单，勾选后只登记供应商与预计到货，不参与采购单同步。")}
              </p>
            </div>
          )}

          {kind === "receive" && (
            <>
              <label><span className={label}>{t("本次到货数量")}（{t("未到")} {remaining} {task.unit}）</span><Input value={qty} onChange={(e) => { setQty(e.target.value); setFormError(""); }} className={cn(field, "tabular-nums")} inputMode="decimal" placeholder={String(remaining)} /></label>
              <label><span className={label}>{t("备注")}</span><Input value={note} onChange={(e) => setNote(e.target.value)} className={field} /></label>
              <p className="text-xs text-amber-600">{t("过渡期手工登记；畅捷通 T+ 接通后到货以同步数据为准。")}</p>
            </>
          )}

          {kind === "reassign" && (
            <div><span className={label}>{t("采购负责人")}</span><BuyerComboInput ariaLabel={t("采购负责人")} value={buyer} onChange={(value) => { setBuyer(value); setFormError(""); }} className={field} /></div>
          )}
        </div>

        {/* select 与 test 自带操作按钮，不再重复一个「确定」 */}
        {kind !== "select" && kind !== "test" && (
          <div className={cn("flex gap-2 border-t border-slate-100 px-5 py-3", kind === "quote" ? "items-center justify-between" : "justify-end")}>
            {kind === "quote" && (
              <button type="button" onClick={goToQuoteBook} className="inline-flex items-center gap-1 text-xs font-medium text-[#002fa7] hover:underline">
                {t("没有合适报价？去报价库维护")}<ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t("取消")}</button>
              <button
                type="button"
                disabled={
                  busy
                  || (kind === "quote" && (quoteBookLoading || selectedQuoteIds.length === 0))
                  || (kind === "order" && purchaseOrdersLoading)
                }
                onClick={submit}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60",
                  confirm?.tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "material-button-primary",
                )}
              >
                {busy
                  ? t("处理中…")
                  : kind === "confirm"
                    ? t(confirm?.actionLabel ?? "确定")
                    : kind === "quote"
                      ? t("确认报价（{count}）", { count: selectedQuoteIds.length })
                      : t("确定")}
              </button>
            </div>
          </div>
        )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={quoteConfirmOpen} onOpenChange={(open) => { if (open || !busy) setQuoteConfirmOpen(open); }}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("确认这 {count} 条供应商报价？", { count: selectedQuoteIds.length })}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 leading-relaxed">
              <span className="block">
                {t("确认后，所选报价会合并保存到当前任务并全部标记为已确认，任务将直接进入「{status}」，无需再逐条选定。", {
                  status: task.needSample ? t("待到样") : t("已定价"),
                })}
              </span>
              {selectedQuoteLines.length > 0 && (
                <span className="block space-y-2 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  <span className="block max-h-36 space-y-1 overflow-y-auto">
                    {selectedQuoteLines.map((line) => (
                      <span key={line.quote.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {line.quote.materialName} · {line.quote.supplierName} · {line.quantity.toLocaleString()} {t(task.unit)}
                        </span>
                        <b className="shrink-0 tabular-nums text-slate-800">
                          {formatQuoteAmount(line.lineTotal, line.quote.currency)}
                        </b>
                      </span>
                    ))}
                  </span>
                  <span className="block border-t border-slate-200 pt-2">
                    <span className="flex justify-between">
                      <span>{t("报价小计")}</span>
                      <b>{formatQuoteAmount(quoteSubtotal, quoteCurrency)}</b>
                    </span>
                    <span className="mt-1 flex justify-between">
                      <span>{t("减：折扣金额")}</span>
                      <b>- {formatQuoteAmount(quoteDiscountAmount, quoteCurrency)}</b>
                    </span>
                    <span className="mt-1 flex justify-between text-sm text-[#002fa7]">
                      <b>{t("最终总价")}</b>
                      <b>{formatQuoteAmount(quoteTotal, quoteCurrency)}</b>
                    </span>
                  </span>
                </span>
              )}
            </AlertDialogDescription>
            {formError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700">{formError}</p>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("返回检查")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || selectedQuoteIds.length === 0}
              onClick={(event) => {
                event.preventDefault();
                void execute(
                  () => confirmQuotationsFromQuoteBook(task.id, {
                    selections: selectedQuoteLines.map((line) => ({
                      quoteId: line.quote.id,
                      quantity: line.quantity,
                    })),
                    discountAmount: quoteDiscountAmount,
                  }),
                  t("已合并确认 {count} 条报价", { count: selectedQuoteIds.length }),
                );
              }}
              className="material-button-primary"
            >
              {busy ? t("处理中…") : t("确认并生效")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
