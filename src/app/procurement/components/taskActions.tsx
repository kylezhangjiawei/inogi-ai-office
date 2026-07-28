// 采购任务「下一步」动作的统一执行器。
//
// 卡片和详情抽屉共用同一套动作语义，避免两处各写一遍流转规则：
//   待处理   → 确认接收（二次确认）
//   待询价   → 录报价（表单）
//   询价中   → 选定报价（决策类：卡片上只跳详情，在详情里对比报价后再选）
//   待到样   → 样品已到（二次确认）
//   测试中   → 录入测试结论（决策类：通过 → 已定价 / 不通过 → 退回询价，带结论备注）
//   已定价 / 待购买 → 标记已下单（填 T+ 采购单号；直购会先打开购买链接）
//   已下单 / 部分到货 → 登记到货（过渡期手工，T+ 接通后改由同步驱动）
//
// 位置策略：**做这个动作需不需要看卡片以外的信息**。
//   执行类（信息已充分）留在卡片，弹二次确认即可；
//   决策类（要对比报价 / 看图纸样品）在卡片上点只会打开详情，避免盲选。
// 所有写操作一律经过弹窗，不存在「点一下就变」的路径。
import { useCallback, useEffect, useState } from "react";
import { Input } from "../../components/ui/input";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { toast } from "sonner";

import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import {
  addQuotation,
  cancelProcTask,
  confirmProcTask,
  deleteProcTask,
  linkPurchaseOrder,
  listQuotations,
  reassignProcTask,
  receiveProcTask,
  selectQuotation,
  transitionProcTask,
  type ProcurementTask,
  type Quotation,
} from "../../lib/procurementApi";
import { refreshProcurement } from "../data";
import { BuyerComboInput, DateInput, fmtMoney, useBuyerDirectory } from "./common";

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

/**
 * 决策类状态：动作依赖卡片上看不到的信息（报价对比 / 图纸样品），
 * 从卡片触发时只打开详情，不在卡片上弹决策框。
 */
export const DECISION_STATUSES = ["inquiring", "testing"];

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
            : "确认后任务进入「待询价」，可开始录入供应商报价。",
        actionLabel: "确认接收",
        run: () => confirmProcTask(task.id),
        okText: "已确认接收",
      };
    case "pending_sample":
      return {
        title: "确认样品已到？",
        desc: "确认后任务进入「测试中」，由研发对接人评估样品是否达标。",
        actionLabel: "样品已到",
        run: () => transitionProcTask(task.id, "testing", "样品已到，进入测试"),
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
export function useProcTaskAction(options?: { onOpenDetail?: (task: ProcurementTask) => void }) {
  const [pending, setPending] = useState<PendingForm | null>(null);
  const [busy, setBusy] = useState(false);
  const onOpenDetail = options?.onOpenDetail;

  const run = useCallback(async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await fn();
      await refreshProcurement();
      toast.success(okText);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
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

  const remove = useCallback((task: ProcurementTask) => {
    // 已进入履约阶段的任务用「取消」保留留痕，未开始的才真删
    const started = !["pending_confirm", "pending_inquiry", "pending_purchase"].includes(task.status);
    const label = started ? "取消" : "删除";
    setPending({
      kind: "confirm",
      task,
      confirm: {
        title: `确定${label}任务「${task.materialName}」？`,
        desc: started
          ? "任务已进入执行阶段，将标记为「已取消」并保留操作留痕，不会真正删除。"
          : "该任务尚未开始执行，将被永久删除，此操作不可恢复。",
        actionLabel: label,
        tone: "danger",
        run: () => (started ? cancelProcTask(task.id, "手动取消") : deleteProcTask(task.id)),
        okText: `已${label}任务`,
      },
    });
  }, []);

  const modal = pending ? (
    <ActionModal
      pending={pending}
      busy={busy}
      onClose={() => setPending(null)}
      onSubmit={async (fn, okText) => {
        await run(fn, okText);
        setPending(null);
      }}
    />
  ) : null;

  return { runNext, reassign, remove, modal, busy };
}

// ── 表单弹窗 ──────────────────────────────────────────────────────────────────

const TITLES: Record<FormKind, string> = {
  quote: "录入供应商报价",
  select: "选定报价",
  order: "标记已下单",
  receive: "登记到货",
  reassign: "转派采购负责人",
  confirm: "",
  test: "录入测试结论",
};

function ActionModal({
  pending,
  busy,
  onClose,
  onSubmit,
}: {
  pending: PendingForm;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fn: () => Promise<unknown>, okText: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const { kind, task, confirm } = pending;
  const { resolveUserId } = useBuyerDirectory();

  const [supplierName, setSupplierName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [tpOrderNo, setTpOrderNo] = useState("");
  const [etaDate, setEtaDate] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [buyer, setBuyer] = useState(task.buyer);
  const [quotes, setQuotes] = useState<Quotation[]>([]);

  useEffect(() => {
    if (kind !== "select") return;
    let alive = true;
    void listQuotations({ taskId: task.id })
      .then((list) => { if (alive) setQuotes(list); })
      .catch(() => { if (alive) setQuotes([]); });
    return () => { alive = false; };
  }, [kind, task.id]);

  const remaining = Math.max(0, task.quantity - task.arrivedQty);

  const submit = () => {
    if (kind === "confirm" && confirm) {
      void onSubmit(confirm.run, t(confirm.okText));
      return;
    }
    if (kind === "quote") {
      const price = Number(unitPrice);
      if (!supplierName.trim() || !Number.isFinite(price) || price <= 0) {
        toast.error(t("请填写供应商与有效单价"));
        return;
      }
      void onSubmit(
        () => addQuotation(task.id, {
          supplierName: supplierName.trim(),
          unitPrice: price,
          leadTimeDays: Number(leadTimeDays) || 0,
          note: note.trim() || undefined,
        }),
        t("报价已录入"),
      );
      return;
    }
    if (kind === "order") {
      if (!tpOrderNo.trim()) {
        toast.error(t("请填写畅捷通 T+ 采购单号"));
        return;
      }
      void onSubmit(
        () => linkPurchaseOrder(task.id, {
          tpOrderNo: tpOrderNo.trim(),
          supplierName: supplierName.trim() || undefined,
          orderedQty: task.quantity,
          etaDate: etaDate || undefined,
        }),
        t("已关联采购单，任务转为已下单"),
      );
      return;
    }
    if (kind === "receive") {
      const n = Number(qty);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error(t("请填写有效的到货数量"));
        return;
      }
      void onSubmit(
        () => receiveProcTask(task.id, { qty: n, note: note.trim() || undefined }),
        t("到货已登记"),
      );
      return;
    }
    if (kind === "reassign") {
      if (!buyer.trim()) {
        toast.error(t("请填写采购负责人"));
        return;
      }
      // 命中用户目录时同步落 buyerUserId（同名冲突时只存名字）
      void onSubmit(() => reassignProcTask(task.id, buyer.trim(), resolveUserId(buyer.trim())), t("已转派"));
    }
  };

  const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300";
  const label = "mb-1 block text-xs font-medium text-slate-500";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md">
        <DialogHeader className="border-b border-slate-100 px-5 py-4">
          <DialogTitle className="text-base font-bold text-slate-900">
            {kind === "confirm" ? t(confirm?.title ?? "请确认") : t(TITLES[kind])}
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-slate-400">{task.code} · {task.materialName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          {kind === "confirm" && confirm && (
            <div className="flex gap-3">
              <span className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                confirm.tone === "danger" ? "bg-rose-50 text-rose-500" : "bg-indigo-50 text-indigo-500",
              )}>
                <AlertTriangle className="h-5 w-5" />
              </span>
              <p className="pt-1 text-sm leading-relaxed text-slate-600">{t(confirm.desc)}</p>
            </div>
          )}

          {kind === "test" && (
            <>
              <p className="text-sm text-slate-600">
                {t("样品测试是否通过？不通过将退回「询价中」，可重新选择供应商。")}
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
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSubmit(
                    () => transitionProcTask(task.id, "priced", note.trim() ? `测试通过：${note.trim()}` : "测试通过，已定价"),
                    t("已记录：测试通过"),
                  )}
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {t("测试通过")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSubmit(
                    () => transitionProcTask(task.id, "inquiring", note.trim() ? `测试不通过：${note.trim()}` : "测试不通过，退回询价"),
                    t("已记录：测试不通过，退回询价"),
                  )}
                  className="flex-1 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-60"
                >
                  {t("测试不通过")}
                </button>
              </div>
            </>
          )}

          {kind === "quote" && (
            <>
              <div><span className={label}>{t("供应商")}</span><Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={field} placeholder={t("如：宁波恒力")} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className={label}>{t("单价（元）")}</span><Input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={field} inputMode="decimal" placeholder="0.00" /></div>
                <div><span className={label}>{t("交期（天）")}</span><Input value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} className={field} inputMode="numeric" placeholder="15" /></div>
              </div>
              <div><span className={label}>{t("备注")}</span><Input value={note} onChange={(e) => setNote(e.target.value)} className={field} /></div>
            </>
          )}

          {kind === "select" && (
            quotes.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">{t("该任务还没有报价，请先录入报价")}</div>
            ) : (
              <div className="space-y-2">
                {quotes.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void onSubmit(() => selectQuotation(task.id, q.id), t("已选定报价"))}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50/40"
                  >
                    <span className="text-slate-700">{q.supplierName}</span>
                    <span className="flex items-center gap-3">
                      <b className="tabular-nums text-slate-900">{fmtMoney(q.unitPrice)}</b>
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
            <>
              <div><span className={label}>{t("畅捷通 T+ 采购单号")}</span><Input value={tpOrderNo} onChange={(e) => setTpOrderNo(e.target.value)} className={field} placeholder="CGDD-2026-0001" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className={label}>{t("供应商")}</span><Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={field} /></div>
                <div><span className={label}>{t("预计到货")}</span><DateInput value={etaDate} onChange={setEtaDate} className="mb-1 mt-1" /></div>
              </div>
              <p className="text-xs text-slate-400">{t("采购单在畅捷通 T+ 中创建，本系统只登记关联关系。")}</p>
            </>
          )}

          {kind === "receive" && (
            <>
              <div><span className={label}>{t("本次到货数量")}（{t("未到")} {remaining} {task.unit}）</span><Input value={qty} onChange={(e) => setQty(e.target.value)} className={field} inputMode="decimal" placeholder={String(remaining)} /></div>
              <div><span className={label}>{t("备注")}</span><Input value={note} onChange={(e) => setNote(e.target.value)} className={field} /></div>
              <p className="text-xs text-amber-600">{t("过渡期手工登记；畅捷通 T+ 接通后到货以同步数据为准。")}</p>
            </>
          )}

          {kind === "reassign" && (
            <div><span className={label}>{t("采购负责人")}</span><BuyerComboInput value={buyer} onChange={setBuyer} className={field} /></div>
          )}
        </div>

        {/* select 与 test 自带操作按钮，不再重复一个「确定」 */}
        {kind !== "select" && kind !== "test" && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t("取消")}</button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60",
                confirm?.tone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "material-button-primary",
              )}
            >
              {busy ? t("处理中…") : kind === "confirm" ? t(confirm?.actionLabel ?? "确定") : t("确定")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
