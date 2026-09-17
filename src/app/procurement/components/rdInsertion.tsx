// 研发侧「转采购」组件：真实查询关联任务、上传附件并调用采购接口。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Input } from "../../components/ui/input";
import { AlertTriangle, ExternalLink, FlaskConical, Loader2, Paperclip, ShoppingCart, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import { toast } from "sonner";

import { useAuth } from "../../auth";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { TransferDraftSupport } from './TransferDraftSupport';
import { clearTransferDraft } from '../transferDraftStore';
import {
  continueRdProcurementTransfer,
  getProcTaskByRdTask,
  transferProcTask,
  uploadProcurementAttachment,
  type ProcurementTask,
} from "../../lib/procurementApi";
import { formatRdFileSize } from "../../RDProgressEvidence";
import { announceProcurementRefresh, DEFAULT_PROCUREMENT_PRODUCT_ID, PROCUREMENT_REFRESH_EVENT, useProcurementProducts } from "../data";
import { DateInput, PROC_STATUS_META } from "./common";
import { usePermission } from "../../hooks/usePermission";
import { currentRdWorkspace } from "../../lib/rdApi";
import { fetchRdTechnicalDocuments, type RdTechnicalDocument } from "../../lib/rdTechnicalDocumentsApi";
import { mergeRdTransferAttachments } from "../../lib/rdProcurementTransfer";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";

/** 转采购可携带的研发任务附件。fileKey 用于采购侧按需重签访问地址。 */
export type TransferAttachmentInput = {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  fileUrl: string;
  fileKey?: string;
  technicalDocumentVersionId?: string;
  versionName?: string;
  category?: string;
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
  const canTransfer = usePermission("proc-task:transfer");
  const [continuing, setContinuing] = useState(false);
  const statusLabel = PROC_STATUS_META[task.status]?.label ?? task.status;
  if (task.status === "pending_rd_review" && canTransfer) {
    return (
      <Button variant="unstyled"
        type="button"
        disabled={continuing}
        onClick={async (event) => {
          event.stopPropagation();
          setContinuing(true);
          try {
            await continueRdProcurementTransfer(task.id);
            announceProcurementRefresh();
            toast.success(t("已转采购并分配采购负责人"));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : t("转采购失败，请稍后重试"));
          } finally {
            setContinuing(false);
          }
        }}
        className="inline-flex items-center gap-1 rounded-full border border-[#c9d8ff] bg-accent px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-[#dce6ff] disabled:opacity-50"
      >
        {continuing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShoppingCart className="h-3 w-3" />}
        {t("继续转采购")}
      </Button>
    );
  }
  if (task.status === "pending_rd_review" || !canOpenProcurementCockpit) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--primary-soft-border)] bg-accent px-2 py-0.5 text-[11px] font-medium text-primary">
        {t("转采购：")}{t(statusLabel)}
      </span>
    );
  }
  return (
    <Button variant="unstyled"
      type="button"
      onClick={() => onJump(task.id)}
      className="inline-flex items-center gap-1 rounded-full border border-[var(--primary-soft-border)] bg-accent px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
      title={t("打开采购任务 {code}", { code: task.code })}
    >
      {t("关联采购：")}{t(statusLabel)}
      <ExternalLink className="h-3 w-3" />
    </Button>
  );
}

/** 采购动态时间线（真实读取 ProcTaskLog）。 */
export function ProcurementActivitySection({ task }: { task: ProcurementTask }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const canRdWorkspace = usePermission("page:rd-my-workspace");
  const canProcurementCockpit = usePermission("page:proc-cockpit");
  const canMaterials = usePermission("page:proc-materials");
  const canOwnProcurement = usePermission("page:proc-my-workspace");
  const statusLabel = PROC_STATUS_META[task.status]?.label ?? task.status;
  const sample = task.sampleTest;
  const isResearchWorkspace = currentRdWorkspace() === null;
  const showSample = isResearchWorkspace && (task.needSample || Boolean(sample) || task.status === "pending_sample" || task.status === "testing");
  const canOpenSample = canRdWorkspace && (sample?.testerUserId === user?.id || canProcurementCockpit || canMaterials
    || (canOwnProcurement && task.buyerUserId === user?.id));
  const sampleResult = sample?.result === "passed" ? "测试通过" : sample?.result === "failed_resample" ? "测试不通过，重新送样"
    : sample?.result === "failed_requote" ? "测试不通过，重新询价" : task.status === "testing" ? "待本人确认测试结论"
      : task.status === "pending_sample" ? "待到样" : "暂无已确认测试结论";
  const snapshots = task.rdTransferSnapshots ?? [];
  const latest = snapshots.at(-1);
  return (
    <div className="rd-procurement-activity rounded-xl border border-[var(--primary-soft-border)] bg-accent/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-primary">{t("采购动态")}</div>
        <div className="text-[11px] text-primary/70">{task.code} · {t(statusLabel)}</div>
      </div>
      {showSample ? <div className="mb-3 rounded-lg border border-[var(--primary-soft-border)] bg-white/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-primary"><FlaskConical className="size-4" aria-hidden="true" />{t("样品验证")} · {t(sampleResult)}</p>
          {canOpenSample ? <Button variant="unstyled" type="button" onClick={() => navigate(`/rd-my-workspace?sampleTest=${encodeURIComponent(task.id)}`)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-accent">{t(sample?.result === null && sample.testerUserId === user?.id && task.status === "testing" ? "填写测试结论" : "查看样品记录")}<ExternalLink className="size-3.5" aria-hidden="true" /></Button> : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("测试人")}：{sample?.testerName || t("待指定")} · {t("当前采购节点")}：{t(statusLabel)}</p>
        {sample?.note ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{sample.note}</p> : null}
        {sample?.confirmedAt ? <p className="mt-1 text-xs text-muted-foreground">{t("本人确认")}：{sample.confirmedByName || sample.testerName} · {new Date(sample.confirmedAt).toLocaleString()}</p> : null}
        {task.sampleStatusNeedsReview ? <p className="mt-2 text-xs text-amber-700">{t("历史样品状态待核对，请由指定测试人补充结论。")}</p> : null}
      </div> : null}
      {isResearchWorkspace ? latest ? <details className="mb-3 rounded-lg border border-[var(--primary-soft-border)] bg-white/80 p-3">
        <summary className="cursor-pointer text-sm font-medium text-primary">{t("本次交付资料")} · {latest.attachments.length} {t("份")} · {latest.submittedByName}</summary>
        <p className="mt-2 break-words text-xs text-slate-600">{latest.requirement.materialName} · {latest.requirement.spec || t("规格未填写")} · {latest.requirement.quantity} {latest.requirement.unit}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("按提交时内容保存；研发后续换版不会替换这次交付。")}</p>
        <ul className="mt-2 space-y-2">{latest.attachments.map((attachment, index) => <li key={`${attachment.technicalDocumentVersionId || attachment.fileName}-${index}`} className="flex min-w-0 items-start gap-2 text-xs"><Paperclip className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><a href={attachment.fileUrl} target="_blank" rel="noreferrer" className="min-w-0 break-words text-primary underline underline-offset-2">{attachment.fileName}</a><span className="shrink-0 text-slate-500">{attachment.version ? `${t("版本")} ${attachment.version}` : t("未登记版本")}</span></li>)}</ul>
        {snapshots.length > 1 ? <details className="mt-3 border-t border-slate-100 pt-2"><summary className="cursor-pointer text-xs text-slate-500">{t("历史交付")}（{snapshots.length - 1}）</summary><ul className="mt-2 space-y-2">{snapshots.slice(0, -1).reverse().map((snapshot) => <li key={snapshot.id} className="text-xs text-slate-500"><p>{new Date(snapshot.submittedAt).toLocaleString()} · {snapshot.submittedByName} · {snapshot.requirement.materialName} · {snapshot.requirement.quantity} {snapshot.requirement.unit}</p><p className="mt-1 break-words">{snapshot.attachments.map((attachment) => `${attachment.fileName} (${attachment.version || t("未登记版本")})`).join("、")}</p></li>)}</ul></details> : null}
      </details> : <p className="mb-3 text-xs text-slate-500">{t("历史采购未保存交付版本快照，原附件与记录仍保留。")}</p> : null}
      {task.logs.length > 0 ? (
        <ul className="space-y-2">
          {task.logs.slice(-5).reverse().map((event, index) => (
            <li key={`${event.at}-${index}`} className="flex gap-3 text-sm">
              <span className="rd-procurement-activity__dot mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
              <div>
                <AutoTranslatedText as="div" className="text-slate-600" text={event.text} />
                <div className="text-[11px] text-muted-foreground">{event.at}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">{t("暂无采购动态")}</div>
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
  technicalDocumentVersionId?: string;
  versionName?: string;
  category?: string;
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
  /** 异步读到既有关联时保留本次填写内容，并阻止重复生成。 */
  blockingTask?: Pick<ProcurementTask, "id" | "code"> | null;
  onTransferred?: (task: ProcurementTask) => void;
  onClose: () => void;
};

type TransferErrors = Partial<Record<"materialName" | "quantity" | "unit" | "files" | "submit", string>>;

/** 转采购确认弹窗。研发已有附件直接复用 OSS 引用，新增附件先上传再提交。 */
export function TransferToProcurementModal(props: TransferModalProps) {
  const { user } = useAuth();
  const workspace = currentRdWorkspace();
  return <ScopedTransferToProcurementModal key={JSON.stringify([props.taskId, user?.id, workspace])} {...props} />;
}

export function ScopedTransferToProcurementModal({
  taskId,
  taskTitle,
  productId = DEFAULT_PROCUREMENT_PRODUCT_ID,
  owner,
  ownerUserId,
  priority = "medium",
  dueDate = "",
  attachments = [],
  resubmitFrom = null,
  blockingTask = null,
  onTransferred,
  onClose,
}: TransferModalProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const products = useProcurementProducts();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [draftWriting, setDraftWriting] = useState(false);
  const draftWritingRef = useRef(false);
  const mountedRef = useRef(true);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const openerLayerRef = useRef(openerRef.current?.closest<HTMLElement>('[role="dialog"], .rd-horizon-detail-shell, main') ?? null);
  const discardFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [errors, setErrors] = useState<TransferErrors>({});
  const workspace = currentRdWorkspace();
  const isResearchWorkspace = workspace === null;
  const scope = JSON.stringify([taskId, user?.id, workspace]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const blockingTaskRef = useRef(blockingTask);
  blockingTaskRef.current = blockingTask;
  const linkedTaskMessage = (code: string) => t("该研发任务已关联采购任务 {code}，不能重复生成。本次填写尚未提交；关闭后可在任务页查看关联采购。", { code });
  const [technicalDocuments, setTechnicalDocuments] = useState<RdTechnicalDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(isResearchWorkspace);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsReload, setDocumentsReload] = useState(0);
  useEffect(() => {
    if (!isResearchWorkspace) return;
    const controller = new AbortController();
    setDocumentsLoading(true);
    setDocumentsError(null);
    void fetchRdTechnicalDocuments(taskId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setTechnicalDocuments(result.documents);
    }).catch((error) => {
      if (!controller.signal.aborted) setDocumentsError(error instanceof Error ? error.message : t("技术资料读取失败，请重试"));
    }).finally(() => { if (!controller.signal.aborted) setDocumentsLoading(false); });
    return () => controller.abort();
  }, [taskId, isResearchWorkspace, documentsReload, t]);
  const [form, setForm] = useState({
    productId: resubmitFrom?.productId ?? productId,
    materialName: resubmitFrom?.materialName
      ?? (taskTitle.replace(/选型|测试|复核|反馈|核查|调整|完善|沟通/g, "").trim() || taskTitle),
    spec: resubmitFrom?.spec ?? "",
    quantity: resubmitFrom ? String(resubmitFrom.quantity) : "1",
    unit: resubmitFrom?.unit || "件",
    needDate: resubmitFrom?.needDate ?? dueDate,
    deadline: resubmitFrom?.deadline ?? dueDate,
    link: resubmitFrom?.purchaseLink ?? "",
    rdContact: resubmitFrom?.rdContact ?? owner,
    note: resubmitFrom?.consumableNote ?? "",
  });
  const taskRows = useMemo<TransferAttachmentRow[]>(
    () => (isResearchWorkspace ? mergeRdTransferAttachments(attachments, technicalDocuments) : attachments).map((item) => ({
      key: `task-${item.technicalDocumentVersionId || JSON.stringify([item.id, item.fileKey || item.fileUrl])}`,
      name: item.name,
      size: item.size,
      source: "task",
      mimeType: item.mimeType,
      fileUrl: item.fileUrl,
      fileKey: item.fileKey,
      technicalDocumentVersionId: item.technicalDocumentVersionId,
      versionName: item.versionName,
      category: item.category,
    })),
    [attachments, technicalDocuments, isResearchWorkspace],
  );
  const [files, setFiles] = useState<TransferAttachmentRow[]>(() => isResearchWorkspace ? [] : taskRows);
  const selectedKeys = new Set(files.map((row) => row.key));
  const initialDraft = useRef({ form: JSON.stringify(form), files: JSON.stringify([...selectedKeys].sort()) });
  const dirty = JSON.stringify(form) !== initialDraft.current.form || JSON.stringify([...selectedKeys].sort()) !== initialDraft.current.files;
  const interactionRef = useRef({ dirty, discardOpen });
  interactionRef.current = { dirty, discardOpen };
  const canEdit = () => mountedRef.current && !submittingRef.current && !draftWritingRef.current && !discardingRef.current && !interactionRef.current.discardOpen;
  const requestClose = () => {
    if (!mountedRef.current || submittingRef.current || draftWritingRef.current || interactionRef.current.discardOpen) return;
    if (!interactionRef.current.dirty) { onClose(); return; }
    discardFocusRef.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDiscardOpen(true);
  };

  const addManualFiles = (list: FileList | null) => {
    if (!canEdit() || !list?.length) return;
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
    setErrors((current) => ({ ...current, files: undefined, submit: undefined }));
  };

  const submit = async () => {
    if (!canEdit()) return;
    if (blockingTaskRef.current) {
      setErrors({ submit: linkedTaskMessage(blockingTaskRef.current.code) });
      return;
    }
    if (documentsLoading || documentsError) {
      setErrors({ submit: documentsError || t("正在核对技术资料版本，请稍候") });
      return;
    }
    const materialName = form.materialName.trim();
    const quantity = Number(form.quantity);
    const nextErrors: TransferErrors = {};
    if (!materialName) {
      nextErrors.materialName = t("请填写物料名称");
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      nextErrors.quantity = t("请填写正确的数量");
    }
    if (!form.unit.trim() || form.unit.trim().length > 20) nextErrors.unit = t("请填写 20 字以内的数量单位");
    if (files.length === 0) {
      nextErrors.files = t("转采购必须携带至少一份图纸附件");
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error(nextErrors.materialName ?? nextErrors.quantity ?? nextErrors.unit ?? nextErrors.files ?? t("请检查表单"));
      return;
    }

    setErrors({});
    submittingRef.current = true;
    setSubmitting(true);
    const submittedScope = scope;
    const isCurrentSubmission = () => mountedRef.current && scopeRef.current === submittedScope;
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
          technicalDocumentVersionId: row.technicalDocumentVersionId,
        };
      }));

      if (!isCurrentSubmission()) return;
      if (blockingTaskRef.current) {
        setErrors({ submit: linkedTaskMessage(blockingTaskRef.current.code) });
        return;
      }

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
        unit: form.unit.trim(),
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
      if (!isCurrentSubmission()) return;
      onTransferred?.(procTask);
      announceProcurementRefresh();
      toast.success(procTask.alreadyTransferred
        ? t("该研发任务已关联采购任务 {code}", { code: procTask.code })
        : t("已生成采购任务 {code}，并分配采购负责人", { code: procTask.code }));
      await clearTransferDraft(scope).catch(() => { toast.warning(t('采购任务已生成，但本机旧草稿清除失败；请勿重复提交。')); });
      if (isCurrentSubmission()) onClose();
    } catch (error) {
      if (!isCurrentSubmission()) return;
      const message = error instanceof Error ? error.message : t("转采购失败，请稍后重试");
      setErrors({ submit: message });
      toast.error(message);
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const field = (key: keyof typeof form, label: string, placeholder = "", hint?: string, type = "text") => (
    <div>
      <span className="text-xs font-medium text-slate-500">{t(label)}</span>
      {type === "date" ? (
        <DateInput
          value={form[key]}
          disabled={submitting || draftWriting}
          onChange={(value) => { if (!canEdit()) return; setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, submit: undefined })); }}
          ariaLabel={t(label)}
          className="mt-1"
        />
      ) : (
        <Input
          type={type}
          value={form[key]}
          disabled={submitting || draftWriting}
          aria-label={t(label)}
          aria-invalid={Boolean(key === "materialName" ? errors.materialName : key === "quantity" ? errors.quantity : key === "unit" ? errors.unit : false)}
          onChange={(event) => { if (!canEdit()) return; setForm((current) => ({ ...current, [key]: event.target.value })); setErrors((current) => ({ ...current, [key === "materialName" ? "materialName" : key === "quantity" ? "quantity" : key === "unit" ? "unit" : "submit"]: undefined, submit: undefined })); }}
          placeholder={placeholder ? t(placeholder) : ""}
          className={cn("mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15", type === "number" && "tabular-nums", (key === "materialName" ? errors.materialName : key === "quantity" ? errors.quantity : key === "unit" ? errors.unit : false) && "border-rose-300")}
        />
      )}
      {hint && <span className="mt-0.5 block text-[10px] text-muted-foreground">{t(hint)}</span>}
      {key === "materialName" && errors.materialName && <span role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{errors.materialName}</span>}
      {key === "quantity" && errors.quantity && <span role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{errors.quantity}</span>}
      {key === "unit" && errors.unit && <span role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{errors.unit}</span>}
    </div>
  );

  return (
    <><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent ref={dialogRef} closeDisabled={submitting || draftWriting} aria-modal="true" aria-busy={submitting || draftWriting}
        onEscapeKeyDown={(event) => { if (submittingRef.current || draftWritingRef.current) event.preventDefault(); }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          // 遮罩点击不要在确认框打开后又把浏览器焦点移回 body。
          event.detail.originalEvent.preventDefault();
          requestClose();
        }}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current;
          if (opener?.isConnected && opener.getClientRects().length && !opener.matches(':disabled')) {
            event.preventDefault(); opener.focus();
          } else if (openerLayerRef.current?.isConnected) {
            const fallback = Array.from(openerLayerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]')).find((element) => element.getClientRects().length && !element.closest('[inert]'));
            if (fallback) { event.preventDefault(); fallback.focus(); }
          }
        }}
        className="horizon-theme horizon-portal proc-horizon-overlay flex flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-slate-100 px-6 py-4">
          <DialogTitle className="text-balance text-base font-bold text-slate-900">
            {resubmitFrom ? t("转采购 · 重新提交 {code}", { code: resubmitFrom.code }) : t("转采购 · 生成采购任务")}
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-pretty text-xs text-muted-foreground">{t("核对采购物料、数量和图纸附件，提交后直接进入采购待处理并分配采购负责人。")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50/70 px-6 py-2.5">
          {[t("核对物料"), t("确认图纸附件"), t("生成采购任务")].map((label, index) => {
            const active = !form.materialName.trim() || !(Number(form.quantity) > 0) ? 0 : files.length === 0 ? 1 : 2;
            return <div key={label} className={cn("flex items-center gap-1.5 text-[11px]", index === active ? "font-semibold text-primary" : index < active ? "text-emerald-700" : "text-muted-foreground")}><span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", index === active ? "border-primary bg-primary text-white" : index < active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>{index + 1}</span><span className="truncate">{label}</span></div>;
          })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3"><TransferDraftSupport key={scope} scope={scope} snapshot={{ form, files }} dirty={dirty} busy={submitting || discardOpen} restoreReady={!documentsLoading && !documentsError} onWritingChange={writing => {
            if (!mountedRef.current || scopeRef.current !== scope || writing && submittingRef.current) return false;
            draftWritingRef.current = writing; setDraftWriting(writing); return true;
          }} onClose={onClose} onRestore={(saved) => {
            if (!canEdit()) return;
            setForm(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, typeof saved.form[key] === 'string' ? saved.form[key] : value])) as typeof current);
            const restored = saved.files.flatMap<TransferAttachmentRow>(row => row.source === 'manual' && row.file instanceof File ? [{ ...row, file: row.file }] : taskRows.filter(current => current.key === row.key));
            setFiles(restored);
            if (restored.length !== saved.files.length) toast.warning(t('部分旧研发附件已不可用，请重新选择本次资料。'));
          }} /></div>
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-[var(--primary-soft-border)] bg-accent px-3 py-2 text-pretty text-xs text-primary">
            <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0" />
            {resubmitFrom
              ? t("已沿用上次需求，请重新勾选本次交付附件；提交后原采购任务回到待处理，并保留历史交付。")
              : t("请勾选本次交付给采购的资料。提交后保存需求与附件版本，并自动分配采购负责人。")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <span className="text-xs font-medium text-slate-500">{t("归属产品系统")}</span>
              <Select value={form.productId} disabled={submitting || draftWriting} onValueChange={(value) => { if (canEdit()) setForm((current) => ({ ...current, productId: value })); }}>
                <SelectTrigger aria-label={t("归属产品系统")} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="proc-horizon-overlay">
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>{t(product.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {field("materialName", "物料名称")}
            {field("spec", "规格", "如 50×20mm 橡胶")}
            {field("quantity", "数量", "如 2000", undefined, "number")}
            {field("unit", "数量单位", "如 件、套、米")}
            {field("needDate", "需求日期", undefined, undefined, "date")}
            {field("deadline", "Deadline", undefined, undefined, "date")}
            {field("link", "购买链接（选填）", "https://…", "填写后自动转为电商直购")}
            {field("rdContact", "研发对接人")}
            <div className="col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  {t("图纸附件（{count}）", { count: files.length })}
                  <span className="ml-1 font-normal text-muted-foreground">{t("请明确勾选本次交付资料")}</span>
                </span>
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--primary-soft-border)] px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent">
                    <Upload className="h-3 w-3" />{t("新增附件")}
                    <Input type="file" multiple disabled={submitting || draftWriting} aria-label={t("新增图纸附件")} className="hidden" onChange={(event) => { addManualFiles(event.target.files); event.target.value = ""; }} />
                  </label>
                </div>
              </div>
              {documentsLoading ? <p role="status" className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />{t("正在核对技术资料版本…")}</p> : null}
              {documentsError ? <div role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"><p className="break-words">{documentsError}</p><Button variant="unstyled" type="button" disabled={submitting || draftWriting} onClick={() => { if (canEdit()) setDocumentsReload((value) => value + 1); }} className="mt-1 min-h-10 underline underline-offset-2">{t("重新读取技术资料")}</Button></div> : null}
              {isResearchWorkspace && taskRows.length > 0 ? <fieldset className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2"><legend className="px-1 text-xs text-slate-500">{t("可交付的研发资料")}</legend>{taskRows.map((row) => <label key={row.key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 py-2 text-xs hover:bg-accent"><Checkbox checked={selectedKeys.has(row.key)} disabled={submitting || draftWriting || documentsLoading || Boolean(documentsError)} onCheckedChange={(checkedValue) => { if (!canEdit() || documentsLoading || documentsError) return; const checked = (checkedValue === true); setFiles((current) => checked ? [...current.filter((item) => item.key !== row.key), row] : current.filter((item) => item.key !== row.key)); setErrors((current) => ({ ...current, files: undefined, submit: undefined })); }} className="size-4 shrink-0 accent-[var(--primary)]" aria-label={`${t("交付附件：{name}", { name: row.name })} · ${row.technicalDocumentVersionId ? `${t("版本")} ${row.versionName || ""}` : t("未登记版本")}`} /><span className="min-w-0 flex-1 break-words text-slate-700">{row.name}<span className="mt-1 block text-[11px] text-muted-foreground">{row.technicalDocumentVersionId ? `${t("已登记版本")} ${row.versionName || ""}` : t("未登记版本，按本次原文件交付")}</span></span>{row.size ? <span className="shrink-0 text-[10px] text-muted-foreground">{formatRdFileSize(row.size)}</span> : null}</label>)}</fieldset> : null}
              {files.length > 0 ? (
                <ul className="mt-1.5 max-h-36 space-y-1.5 overflow-y-auto">
                  {files.map((row) => (
                    <li key={row.key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={row.name}>{row.name}</span>
                      {row.size ? <span className="shrink-0 text-[10px] text-muted-foreground">{formatRdFileSize(row.size)}</span> : null}
                      <span className={row.source === "task" ? "shrink-0 rounded-full bg-accent px-1.5 text-[10px] text-primary" : "shrink-0 rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-600"}>{t(row.source === "task" ? "任务附件" : "新增附件")}</span>
                      <Button variant="unstyled" type="button" aria-label={t("移除附件：{name}", { name: row.name })} disabled={submitting || draftWriting} onClick={() => { if (!canEdit()) return; setFiles((current) => current.filter((item) => item.key !== row.key)); setErrors((current) => ({ ...current, files: undefined, submit: undefined })); }} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-white hover:text-rose-500" title={t("移除")}><X className="h-3.5 w-3.5" /></Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {t("请勾选至少一份本次交付资料，或上传新附件")}
                </div>
              )}
              {errors.files && <p role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{errors.files}</p>}
            </div>
            <label className="col-span-2 block">
              <span className="text-xs font-medium text-slate-500">{t("低值易耗品备注")}</span>
              <Input value={form.note} disabled={submitting || draftWriting} onChange={(event) => { if (canEdit()) setForm((current) => ({ ...current, note: event.target.value })); }} placeholder={t("如为低值易耗品可备注按年用量备货")} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15" />
            </label>
          </div>
          {!blockingTask && errors.submit ? <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{errors.submit}</div> : null}
        </div>
        <div className="shrink-0 border-t border-slate-100 px-6 py-3">
          <p role={blockingTask ? "alert" : "status"} className={cn("mb-2 text-pretty text-xs leading-5", blockingTask ? "text-amber-800" : "text-slate-500")}>{blockingTask ? linkedTaskMessage(blockingTask.code) : t(submitting ? "正在上传附件并生成采购任务，请等待处理完成。" : dirty ? "填写内容尚未提交，可保存草稿后继续处理。" : "确认生成后才会提交需求与附件。")}</p>
          <div className="flex flex-wrap justify-end gap-2">
          <Button variant="unstyled" type="button" disabled={submitting || draftWriting} onClick={requestClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t("取消")}</Button>
          <Button variant="unstyled" type="button" disabled={files.length === 0 || submitting || draftWriting || documentsLoading || Boolean(documentsError) || Boolean(blockingTask)} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? t("正在生成…") : t("确认生成采购任务")}
          </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialogContent aria-modal="true" className="horizon-theme horizon-portal proc-horizon-overlay" onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (discardingRef.current || !mountedRef.current) return;
        const target = discardFocusRef.current;
        if (target?.isConnected && dialogRef.current?.contains(target)) target.focus();
        else dialogRef.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("放弃未提交的采购需求？")}</AlertDialogTitle>
          <AlertDialogDescription>{t("放弃将清除本机草稿和本次填写内容。需要保留时请继续填写，再选择保存草稿并关闭。原研发附件和已有采购记录会保留。")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("继续填写")}</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => {
            if (submittingRef.current || draftWritingRef.current || !mountedRef.current) { event.preventDefault(); return; }
            discardingRef.current = true;
            void clearTransferDraft(scope).catch(() => { toast.warning(t('旧草稿未能清除，下次打开时请核对并清除。')); });
            setDiscardOpen(false);
            onClose();
          }}>{t("放弃并关闭")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog></>
  );
}
