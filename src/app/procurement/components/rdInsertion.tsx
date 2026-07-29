// 研发侧「转采购」组件：真实查询关联任务、上传附件并调用采购接口。
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, Paperclip, RotateCcw, ShoppingCart, Upload, X } from "lucide-react";
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
import { refreshProcurement } from "../data";
import { PROC_STATUS_META } from "./common";

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
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return { task, loading, refresh, setTask };
}

/** 关联采购 chip：点击跳采购驾驶舱对应任务。 */
export function ProcurementLinkChip({ task, onJump }: { task: ProcurementTask; onJump: (procTaskId: string) => void }) {
  const { t } = useI18n();
  const statusLabel = PROC_STATUS_META[task.status]?.label ?? task.status;
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
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-indigo-700">{t("采购动态")}</div>
        <div className="text-[11px] text-indigo-500">{task.code} · {t(statusLabel)}</div>
      </div>
      {task.logs.length > 0 ? (
        <ul className="space-y-2">
          {task.logs.slice(-5).reverse().map((event, index) => (
            <li key={`${event.at}-${index}`} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
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
  owner: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
  attachments?: TransferAttachmentInput[];
  onTransferred?: (task: ProcurementTask) => void;
  onClose: () => void;
};

/** 转采购确认弹窗。研发已有附件直接复用 OSS 引用，新增附件先上传再提交。 */
export function TransferToProcurementModal({
  taskId,
  taskTitle,
  owner,
  priority = "medium",
  dueDate = "",
  attachments = [],
  onTransferred,
  onClose,
}: TransferModalProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    materialName: taskTitle.replace(/选型|测试|复核|反馈|核查|调整|完善|沟通/g, "").trim() || taskTitle,
    spec: "",
    quantity: "1",
    needDate: dueDate,
    deadline: dueDate,
    link: "",
    rdContact: owner,
    note: "",
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
    if (!Number.isFinite(quantity) || quantity < 0) {
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

      const procTask = await transferProcTask({
        rdTaskId: taskId,
        rdTaskTitle: taskTitle,
        rdContact: form.rdContact.trim() || owner,
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
      await refreshProcurement();
      onTransferred?.(procTask);
      toast.success(procTask.alreadyTransferred
        ? t("该研发任务已关联采购任务 {code}", { code: procTask.code })
        : t("已生成采购任务 {code}", { code: procTask.code }));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("转采购失败，请稍后重试"));
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: keyof typeof form, label: string, placeholder = "", hint?: string, type = "text") => (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{t(label)}</span>
      <input
        type={type}
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        placeholder={placeholder ? t(placeholder) : ""}
        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300"
      />
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{t(hint)}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/40 p-6" onClick={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">{t("转采购 · 生成采购任务")}</h3>
          <button type="button" disabled={submitting} onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
            <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0" />
            {t("已带入研发任务与附件，请确认采购需求；提交后会进入采购驾驶舱的待处理列表。")}
          </div>
          <div className="grid grid-cols-2 gap-3">
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
                    <input type="file" multiple className="hidden" onChange={(event) => { addManualFiles(event.target.files); event.target.value = ""; }} />
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
              <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={t("如为低值易耗品可备注按年用量备货")} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
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
      </div>
    </div>
  );
}
