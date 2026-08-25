// 研发侧「转采购」组件：真实查询关联任务、上传附件并调用采购接口。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import { AlertTriangle, ExternalLink, Loader2, Paperclip, RotateCcw, ShoppingCart, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { toast } from "sonner";

import { useAuth } from "../../auth";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import {
  getProcTaskByRdTask,
  transferProcTask,
  uploadProcurementAttachment,
  type ProcurementTask,
} from "../../lib/procurementApi";
import { formatRdFileSize } from "../../RDProgressEvidence";
import { announceProcurementRefresh, DEFAULT_PROCUREMENT_PRODUCT_ID, PROCUREMENT_REFRESH_EVENT, useProcurementProducts } from "../data";
import { DateInput, PROC_STATUS_META } from "./common";
import { usePermission } from "../../hooks/usePermission";

/** 转采购可携带的研发任务附件。fileKey 用于采购侧按需重签访问地址。 */
export type TransferAttachmentInput = {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  fileUrl: string;
  fileKey?: string;
};

/** 按研发任务 id 查询真实采购关联，替代原先按标题写死的静态映射。 */
export function useProcurementTaskLink(rdTaskId?: string) {
  const [task, setTask] = useState<ProcurementTask | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const id = rdTaskId?.trim();
    if (!id) {
      setTask(null);
      return null;
    }
    setLoading(true);
    try {
      const linked = await getProcTaskByRdTask(id, signal);
      setTask(linked);
      return linked;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setTask(null);
      return null;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [rdTaskId]);

  useEffect(() => {
    let controller = new AbortController();
    const revalidate = () => {
      controller.abort();
      controller = new AbortController();
      void refresh(controller.signal);
    };
    revalidate();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener(PROCUREMENT_REFRESH_EVENT, revalidate);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      window.removeEventListener(PROCUREMENT_REFRESH_EVENT, revalidate);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  return { task, loading, refresh, setTask };
}

/** 关联采购 chip：点击跳采购驾驶舱对应任务。 */
export function ProcurementLinkChip({ task, onJump }: { task: ProcurementTask; onJump: (procTaskId: string) => void }) {
  const { t } = useI18n();
  const canOpenProcurementCockpit = usePermission("page:proc-cockpit");
  const statusLabel = PROC_STATUS_META[task.status]?.label ?? task.status;
  if (task.status === "pending_rd_review" || !canOpenProcurementCockpit) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
        {t("转采购：")}{t(statusLabel)}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onJump(task.id)}
      className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100"
      title={t("打开采购任务 {code}", { code: task.code })}
    >
      {t("关联采购：")}{t(statusLabel)}
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}

/** 采购动态时间线（真实读取 ProcTaskLog）。 */
export function ProcurementActivitySection({ task }: { task: ProcurementTask }) {
  const { t } = useI18n();
  const statusLabel = PROC_STATUS_META[task.status]?.label ?? task.status;
  return (
    <div className="rd-procurement-activity rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-indigo-700">{t("采购动态")}</div>
        <div className="text-[11px] text-indigo-500">{task.code} · {t(statusLabel)}</div>
      </div>
      {task.logs.length > 0 ? (
        <ul className="space-y-2">
          {task.logs.slice(-5).reverse().map((event, index) => (
            <li key={`${event.at}-${index}`} className="flex gap-3 text-sm">
              <span className="rd-procurement-activity__dot mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
              <div>
                <AutoTranslatedText as="div" className="text-slate-600" text={event.text} />
                <div className="text-[11px] text-slate-400">{event.at}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-slate-400">{t("暂无采购动态")}</div>
      )}
    </div>
  );
}

type TransferAttachmentRow = {
  key: string;
  name: string;
  size?: number;
  source: "task" | "manual";
  file?: File;
  mimeType?: string;
  fileUrl?: string;
  fileKey?: string;
};

type TransferModalProps = {
  taskId: string;
  taskTitle: string;
  productId?: string;
  owner: string;
  ownerUserId?: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
  attachments?: TransferAttachmentInput[];
  /** 已取消的关联采购任务：重新提交时按它回填，避免把首次填好的规格/数量等清空后覆盖回后端。 */
  resubmitFrom?: ProcurementTask | null;
  onTransferred?: (task: ProcurementTask) => void;
  onClose: () => void;
};

/** 转采购确认弹窗。研发已有附件直接复用 OSS 引用，新增附件先上传再提交。 */
export function TransferToProcurementModal({
  taskId,
  taskTitle,
  productId = DEFAULT_PROCUREMENT_PRODUCT_ID,
  owner,
  ownerUserId,
  priority = "medium",
  dueDate = "",
  attachments = [],
  resubmitFrom = null,
  onTransferred,
  onClose,
}: TransferModalProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const products = useProcurementProducts();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    productId: resubmitFrom?.productId ?? productId,
    materialName: resubmitFrom?.materialName
      ?? (taskTitle.replace(/选型|测试|复核|反馈|核查|调整|完善|沟通/g, "").trim() || taskTitle),
    spec: resubmitFrom?.spec ?? "",
    quantity: resubmitFrom ? String(resubmitFrom.quantity) : "1",
    needDate: resubmitFrom?.needDate ?? dueDate,
    deadline: resubmitFrom?.deadline ?? dueDate,
    link: resubmitFrom?.purchaseLink ?? "",
    rdContact: resubmitFrom?.rdContact ?? owner,
    note: resubmitFrom?.consumableNote ?? "",
  });
  const taskRows = useMemo<TransferAttachmentRow[]>(
    () => attachments.map((item) => ({
      key: `task-${item.id}`,
      name: item.name,
      size: item.size,
      source: "task",
      mimeType: item.mimeType,
      fileUrl: item.fileUrl,
      fileKey: item.fileKey,
    })),
    [attachments],
  );
  const [files, setFiles] = useState<TransferAttachmentRow[]>(taskRows);
  const removedTaskCount = taskRows.filter((row) => !files.some((current) => current.key === row.key)).length;

  const addManualFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const stamp = Date.now();
    const added = Array.from(list).map<TransferAttachmentRow>((file, index) => ({
      key: `manual-${stamp}-${index}`,
      name: file.name,
      size: file.size,
      source: "manual",
      file,
      mimeType: file.type || undefined,
    }));
    setFiles((current) => [...current, ...added]);
  };

  const restoreTaskRows = () => {
    setFiles((current) => [...taskRows.filter((row) => !current.some((item) => item.key === row.key)), ...current]);
  };

  const submit = async () => {
    const materialName = form.materialName.trim();
    const quantity = Number(form.quantity);
    if (!materialName) {
      toast.error(t("请填写物料名称"));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error(t("请填写正确的数量"));
      return;
    }
    if (files.length === 0) {
      toast.error(t("转采购必须携带至少一份图纸附件"));
      return;
    }

    setSubmitting(true);
    try {
      const attachmentInputs = await Promise.all(files.map(async (row) => {
        if (row.source === "manual") {
          if (!row.file) throw new Error(t("附件内容丢失，请重新选择文件"));
          const uploaded = await uploadProcurementAttachment(row.file);
          if (!uploaded.signedUrl) throw new Error(t("附件上传成功，但无法生成访问地址"));
          return {
            fileName: uploaded.fileName,
            fileUrl: uploaded.signedUrl,
            fileKey: uploaded.objectKey,
            fileSize: uploaded.fileSize,
            mimeType: uploaded.mimeType,
            kind: "drawing" as const,
          };
        }
        if (!row.fileUrl) throw new Error(t("研发附件「{name}」缺少访问地址", { name: row.name }));
        return {
          fileName: row.name,
          fileUrl: row.fileUrl,
          fileKey: row.fileKey,
          fileSize: row.size,
          mimeType: row.mimeType,
          kind: "drawing" as const,
        };
      }));

      const rdContact = form.rdContact.trim() || owner;
      const procTask = await transferProcTask({
        productId: form.productId,
        rdTaskId: taskId,
        rdTaskTitle: taskTitle,
        rdContact,
        // 对接人姓名被手工改动后不能继续沿用原账号，避免把消息发给错误的人。
        rdContactUserId: rdContact === owner ? ownerUserId : undefined,
        materialName,
        spec: form.spec.trim(),
        unit: "件",
        quantity,
        method: form.link.trim() ? "direct" : "inquiry",
        purchaseLink: form.link.trim() || undefined,
        businessLine: "rd",
        priority,
        needDate: form.needDate || undefined,
        deadline: form.deadline || undefined,
        requesterDept: user?.department ?? undefined,
        consumableNote: form.note.trim() || undefined,
        attachments: attachmentInputs,
      });
      onTransferred?.(procTask);
      announceProcurementRefresh();
      toast.success(procTask.alreadyTransferred
        ? t("该研发任务已关联采购任务 {code}", { code: procTask.code })
        : t("已提交转采购审核 {code}", { code: procTask.code }));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("转采购失败，请稍后重试"));
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: keyof typeof form, label: string, placeholder = "", hint?: string, type = "text") => (
    <div>
      <span className="text-xs font-medium text-slate-500">{t(label)}</span>
      {type === "date" ? (
        <DateInput
          value={form[key]}
          onChange={(value) => setForm((current) => ({ ...current, [key]: value }))}
          className="mt-1"
        />
      ) : (
        <Input
          type={type}
          value={form[key]}
          onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
          placeholder={placeholder ? t(placeholder) : ""}
          className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
        />
      )}
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{t(hint)}</span>}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-100 px-6 py-4">
          <DialogTitle className="text-base font-bold text-slate-900">
            {resubmitFrom ? t("转采购 · 重新提交 {code}", { code: resubmitFrom.code }) : t("转采购 · 生成采购任务")}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
            <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0" />
            {resubmitFrom
              ? t("已沿用上次提交的内容与附件，可直接修改；提交后在原单号上重走研发管理员审核。")
              : t("已带入研发任务与附件；提交后先由研发管理员审核，通过后才进入采购驾驶舱并分配采购负责人。")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <span className="text-xs font-medium text-slate-500">{t("归属产品系统")}</span>
              <Select value={form.productId} onValueChange={(value) => setForm((current) => ({ ...current, productId: value }))}>
                <SelectTrigger className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>{t(product.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {field("materialName", "物料名称")}
            {field("spec", "规格", "如 50×20mm 橡胶")}
            {field("quantity", "数量", "如 2000", undefined, "number")}
            {field("needDate", "需求日期", undefined, undefined, "date")}
            {field("deadline", "Deadline", undefined, undefined, "date")}
            {field("link", "购买链接（选填）", "https://…", "填写后自动转为电商直购")}
            {field("rdContact", "研发对接人")}
            <div className="col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  {t("图纸附件（{count}）", { count: files.length })}
                  <span className="ml-1 font-normal text-slate-400">{t("默认带入任务全部附件，可移除或新增")}</span>
                </span>
                <div className="flex items-center gap-2">
                  {removedTaskCount > 0 && (
                    <button type="button" onClick={restoreTaskRows} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-indigo-600">
                      <RotateCcw className="h-3 w-3" />{t("恢复任务附件（{count}）", { count: removedTaskCount })}
                    </button>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-indigo-200 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50">
                    <Upload className="h-3 w-3" />{t("新增附件")}
                    <Input type="file" multiple className="hidden" onChange={(event) => { addManualFiles(event.target.files); event.target.value = ""; }} />
                  </label>
                </div>
              </div>
              {files.length > 0 ? (
                <ul className="mt-1.5 max-h-36 space-y-1.5 overflow-y-auto">
                  {files.map((row) => (
                    <li key={row.key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate" title={row.name}>{row.name}</span>
                      {row.size ? <span className="shrink-0 text-[10px] text-slate-400">{formatRdFileSize(row.size)}</span> : null}
                      <span className={row.source === "task" ? "shrink-0 rounded-full bg-indigo-50 px-1.5 text-[10px] text-indigo-500" : "shrink-0 rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-600"}>{t(row.source === "task" ? "任务附件" : "新增附件")}</span>
                      <button type="button" onClick={() => setFiles((current) => current.filter((item) => item.key !== row.key))} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-500" title={t("移除")}><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {t("转采购必须携带至少一份图纸附件，请恢复任务附件或上传新图纸")}
                </div>
              )}
            </div>
            <label className="col-span-2 block">
              <span className="text-xs font-medium text-slate-500">{t("低值易耗品备注")}</span>
              <Input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={t("如为低值易耗品可备注按年用量备货")} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button type="button" disabled={submitting} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t("取消")}</button>
          <button type="button" disabled={files.length === 0 || submitting} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? t("正在生成…") : t("确认生成采购任务")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
