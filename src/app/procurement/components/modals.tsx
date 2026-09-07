// 采购模块弹窗/面板：新建需求 / 批量导入 / 分类管理 / 批量转派 / 任务编辑 / 物料表单。均走真实接口。
// AiCreateModal 暂无入口（产品决定隐藏 AI 建单按钮），实现保留以便恢复；物料审核在 MaterialDetailDrawer 里做。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { AlertTriangle, CheckCircle2, FileDown, ImagePlus, Loader2, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import { DEFAULT_PROCUREMENT_PRODUCT_ID, refreshProcurement, useProcurementData, useProcurementProducts, useProductLines } from "../data";
import {
  aiParseProcTask,
  applyMaterialClassify,
  applySafeStock,
  batchReassignProcTasks,
  waitApplyJob,
  confirmPoMatch,
  createProcTask,
  createReplenishTasks,
  ignorePoMatch,
  listPoMirror,
  listReplenishSuggestions,
  previewSafeStock,
  runPoMatch,
  runTplusAutoSync,
  syncTplusMaterialMaster,
  syncTplusPurchaseOrdersFull,
  exchangeTplusAuthCode,
  getTplusConfig,
  getTplusStatus,
  getTplusSyncJob,
  importProcMaterials,
  previewMaterialClassify,
  renameProcCategory,
  saveTplusConfig,
  triggerTplusSync,
  updateProcTask,
  uploadProcurementAttachment,
  upsertProcMaterial,
  type AiTaskDraft,
  type BusinessLine,
  type ClassifyPreview,
  type ClassifyReport,
  type PoFullSyncResult,
  type PoMatchResult,
  type PoMirrorList,
  type ReplenishSuggestion,
  type TplusAutoSyncResult,
  type TplusMaterialMasterSyncResult,
  type SafeStockPreview,
  type SafeStockReport,
  type Material,
  type MaterialImportItem,
  type PaymentStatus,
  type ProcMethod,
  type ProcurementTask,
  type TplusConfigState,
  type UpdateProcTaskInput,
} from "../../lib/procurementApi";
import { BuyerComboInput, ComboInput, DateInput, useBuyerDirectory, useConfirmDialog } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";
import { retainAvailableProcurementSelection, setVisibleProcurementSelection, validateReplenishmentSelection } from "../procurementLogic";

/** 采购弹窗通用壳（Radix Dialog）：关闭 X 由 DialogContent 自带；宽度覆盖须带 sm: 断点（见 dialog.tsx 注释）。 */
function Shell({ title, description, busy = false, onClose, onEscapeKeyDown, children, footer, feedback, wide }: { title: string; description?: string; busy?: boolean; onClose: () => void; onEscapeKeyDown?: (event: KeyboardEvent) => void; children: React.ReactNode; footer?: React.ReactNode; feedback?: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const openerRef = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const parentDialogRef = useRef(openerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent
        closeDisabled={busy}
        className={cn("horizon-theme horizon-portal proc-horizon-overlay proc-business-dialog flex flex-col gap-0 overflow-hidden rounded-2xl p-0", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}
        onEscapeKeyDown={onEscapeKeyDown}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current;
          const target = opener?.isConnected && !opener.matches(":disabled") ? opener : parentDialogRef.current;
          if (target?.isConnected && target.getClientRects().length > 0) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b border-slate-100 px-6 py-4 pr-14">
          <DialogTitle className="text-balance text-base font-bold text-slate-900">{t(title)}</DialogTitle>
          <DialogDescription className={description ? "mt-0.5 text-pretty text-xs text-slate-400" : "sr-only"}>{description ? t(description) : t("采购业务操作窗口，请核对内容后提交。")}</DialogDescription>
        </DialogHeader>
        <div className="proc-business-dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        {feedback && <div className="max-h-32 shrink-0 overflow-y-auto overscroll-contain px-6 pb-3">{feedback}</div>}
        {footer && <DialogFooter className="shrink-0 gap-2 border-t border-slate-100 px-6 py-3">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

// ── 建单表单（新建需求与 AI 建单确认步共用）──────────────────────────────────

interface DraftState {
  productId: string;
  materialName: string;
  materialId?: string;
  quantity: string;
  needDate: string;
  spec: string;
  unit: string;
  deadline: string;
  method: ProcMethod;
  purchaseLink: string;
  businessLine: BusinessLine;
  priority: "high" | "medium" | "low";
  needSample: boolean;
  buyer: string;
}

export interface NewRequirementDefaults {
  productId: string;
  materialId?: string;
  materialName: string;
  spec?: string;
  unit?: string;
}

const EMPTY_DRAFT: DraftState = {
  productId: DEFAULT_PROCUREMENT_PRODUCT_ID,
  materialName: "", quantity: "", needDate: "", spec: "", unit: "", deadline: "",
  method: "inquiry", purchaseLink: "", businessLine: "production", priority: "medium",
  needSample: false, buyer: "",
};

function draftFromAi(d: AiTaskDraft): DraftState {
  return {
    ...EMPTY_DRAFT,
    materialName: d.materialName ?? "",
    materialId: d.materialId,
    quantity: d.quantity != null ? String(d.quantity) : "",
    needDate: d.needDate ?? "",
    spec: d.spec ?? "",
    unit: d.unit ?? "",
    deadline: d.deadline ?? "",
    method: d.method ?? "inquiry",
    purchaseLink: d.purchaseLink ?? "",
    priority: d.priority ?? "medium",
    needSample: d.needSample ?? false,
  };
}

/** 建单表单主体。more=false 时只展示 3 必填。 */
function DraftFields({ draft, setDraft, more, setMore, lockContext = false, disabled = false }: {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  more: boolean;
  setMore: (v: boolean) => void;
  lockContext?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const products = useProcurementProducts();
  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15";
  const label = "text-xs font-medium text-slate-500";
  const set = <K extends keyof DraftState>(key: K) => (value: DraftState[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <div className="proc-business-fields grid grid-cols-1 gap-3">
        <div className="col-span-full">
          <span className={label}>{t('归属产品系统')}</span>
          <Select value={draft.productId} onValueChange={set('productId')} disabled={disabled || lockContext}>
            <SelectTrigger aria-label={t('归属产品系统')} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.id} value={product.id}>{t(product.name)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="block">
          <span className={label}>{t('物料名称')}<span className="ml-0.5 text-rose-500">*</span></span>
          <Input value={draft.materialName} onChange={(e) => set('materialName')(e.target.value)} disabled={disabled || lockContext} placeholder={t('如 减震垫 DZC-950')} className={field} />
        </label>
        <label className="block">
          <span className={label}>{t('数量')}<span className="ml-0.5 text-rose-500">*</span></span>
          <Input value={draft.quantity} onChange={(e) => set('quantity')(e.target.value)} inputMode="decimal" placeholder={t('如 2000')} className={field} />
        </label>
        <div>
          <span className={label}>{t('需求日期')}<span className="ml-0.5 text-rose-500">*</span></span>
          <DateInput disabled={disabled} value={draft.needDate} onChange={set('needDate')} ariaLabel={t('需求日期')} className="mt-1" />
        </div>
        <div>
          <span className={label}>{t('业务线')}</span>
          <Select disabled={disabled} value={draft.businessLine} onValueChange={(v) => set('businessLine')(v as BusinessLine)}>
            <SelectTrigger aria-label={t('业务线')} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="production">{t('生产')}</SelectItem>
              <SelectItem value="rd">{t('研发')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <button type="button" onClick={() => setMore(!more)} className="mt-3 text-xs font-medium text-primary">{t(more ? "收起更多字段 ▲" : "展开更多字段 ▼")}</button>
      {more && (
        <div className="mt-2 proc-business-fields grid grid-cols-1 gap-3">
          <label className="block"><span className={label}>{t('规格')}</span><Input value={draft.spec} onChange={(e) => set('spec')(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>{t('单位')}</span><Input value={draft.unit} onChange={(e) => set('unit')(e.target.value)} placeholder={t('如 件')} className={field} /></label>
          <div><span className={label}>Deadline</span><DateInput disabled={disabled} value={draft.deadline} onChange={set('deadline')} ariaLabel="Deadline" className="mt-1" /></div>
          <div>
            <span className={label}>{t('采购方式')}</span>
            <Select disabled={disabled} value={draft.method} onValueChange={(v) => set('method')(v as ProcMethod)}>
              <SelectTrigger aria-label={t('采购方式')} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inquiry">{t('询价采购')}</SelectItem>
                <SelectItem value="direct">{t('电商直购')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.method === "direct" && (
            <label className="col-span-full block"><span className={label}>{t('商品链接（直购）')}</span><Input value={draft.purchaseLink} onChange={(e) => set('purchaseLink')(e.target.value)} placeholder="https://" className={field} /></label>
          )}
          <div>
            <span className={label}>{t('优先级')}</span>
            <Select disabled={disabled} value={draft.priority} onValueChange={(v) => set('priority')(v as DraftState["priority"])}>
              <SelectTrigger aria-label={t('优先级')} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">{t('高')}</SelectItem>
                <SelectItem value="medium">{t('中')}</SelectItem>
                <SelectItem value="low">{t('低')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><span className={label}>{t('采购负责人')}</span><BuyerComboInput disabled={disabled} ariaLabel={t('采购负责人')} value={draft.buyer} onChange={set('buyer')} className={field} /></div>
          <label className="col-span-full mt-1 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <Checkbox checked={draft.needSample} onCheckedChange={(v) => set('needSample')(v === true)} />
            {t('需要样品（选定报价后先到样测试）')}
          </label>
        </div>
      )}
    </fieldset>
  );
}

/** 校验 + 提交建单。成功返回 true（调用方负责关弹窗）。 */
async function submitDraft(
  draft: DraftState,
  t: (s: string) => string,
  resolveUserId?: (name: string) => string | undefined,
  onError?: (message: string) => void,
): Promise<boolean> {
  const fail = (message: string) => { onError?.(message); toast.error(message); return false; };
  const quantity = Number(draft.quantity);
  if (!draft.materialName.trim()) return fail(t('请填写物料名称'));
  if (!Number.isFinite(quantity) || quantity <= 0) return fail(t('请填写有效数量'));
  if (!draft.needDate) return fail(t('请选择需求日期'));
  try {
    const task = await createProcTask({
      productId: draft.productId,
      materialId: draft.materialId,
      materialName: draft.materialName.trim(),
      spec: draft.spec.trim() || undefined,
      unit: draft.unit.trim() || undefined,
      quantity,
      method: draft.method,
      purchaseLink: draft.method === "direct" ? draft.purchaseLink.trim() || undefined : undefined,
      businessLine: draft.businessLine,
      priority: draft.priority,
      needSample: draft.needSample,
      needDate: draft.needDate,
      deadline: draft.deadline || undefined,
      ...(draft.buyer.trim()
        ? { buyer: draft.buyer.trim(), buyerUserId: resolveUserId?.(draft.buyer.trim()) }
        : {}),
    });
    await refreshProcurement();
    toast.success(`${t('已创建采购任务')} ${task.code}`);
    return true;
  } catch (err) {
    return fail(err instanceof Error ? err.message : t('创建失败'));
  }
}

/** AI 建单：粘贴文字/商品链接 → AI 解析草稿 → 表单确认后落库。 */
export function AiCreateModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [formError, setFormError] = useState("");
  const [usedAI, setUsedAI] = useState(true);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [more, setMore] = useState(true);
  const { resolveUserId } = useBuyerDirectory();

  const parse = async () => {
    if (busyRef.current) return;
    if (!text.trim()) { setFormError(t('请先粘贴需求文字或商品链接')); return; }
    busyRef.current = true;
    setFormError("");
    setBusy(true);
    try {
      const result = await aiParseProcTask(text.trim());
      setDraft(draftFromAi(result.draft));
      setUsedAI(result.usedAI);
      setStep("confirm");
    } catch (err) {
      const message = err instanceof Error ? err.message : t('解析失败');
      setFormError(message);
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setFormError("");
    setBusy(true);
    try {
      const ok = await submitDraft(draft, t, resolveUserId, setFormError);
      if (ok) onClose();
    } finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <Shell
      title={t("AI 建单")}
      busy={busy}
      onClose={onClose}
      feedback={formError && <p role="alert" className="break-words text-pretty text-xs text-rose-700">{formError}</p>}
      footer={step === "input" ? (
        <>
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('取消')}</button>
          <button type="button" disabled={busy} onClick={() => void parse()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? t('解析中…') : t('解析生成任务')}
          </button>
        </>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={() => setStep("input")} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60">{t('返回修改')}</button>
          <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('确认创建')}
          </button>
        </>
      )}
    >
      {step === "input" ? (
        <>
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-[var(--primary-soft-border)] bg-accent px-3 py-2 text-pretty text-xs text-primary"><Sparkles className="mt-0.5 size-4 shrink-0" />{t('粘贴文字或商品链接，AI 将解析生成采购任务（物料、规格、数量、方式等）。')}</div>
          <Textarea disabled={busy} aria-label={t("采购需求文字或商品链接")} value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={t('例：采购 减震垫 DZC-950 橡胶 50×20mm 2000 件，7 月中旬前到货；或粘贴电商商品链接…')} className="w-full rounded-lg border-slate-200 px-3 py-2 text-sm focus:border-primary/40 focus:ring-2 focus:ring-primary/15" />
        </>
      ) : (
        <>
          <div className={cn("mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-pretty text-xs", usedAI ? "border-[var(--primary-soft-border)] bg-accent text-primary" : "border-amber-100 bg-amber-50/60 text-amber-700")}>
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            {t(usedAI ? 'AI 已解析出以下草稿，请核对并补全后创建。' : 'AI 暂不可用，已按规则粗解析，请人工核对后创建。')}
          </div>
          <DraftFields disabled={busy} draft={draft} setDraft={setDraft} more={more} setMore={setMore} />
        </>
      )}
    </Shell>
  );
}

/** 新建需求：3 必填 + 折叠更多，提交落库。 */
export function NewRequirementModal({
  onClose,
  defaults,
  lockContext = false,
}: {
  onClose: () => void;
  defaults?: NewRequirementDefaults;
  lockContext?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<DraftState>(() => ({
    ...EMPTY_DRAFT,
    ...defaults,
    spec: defaults?.spec ?? EMPTY_DRAFT.spec,
    unit: defaults?.unit ?? EMPTY_DRAFT.unit,
  }));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [formError, setFormError] = useState("");
  const { resolveUserId } = useBuyerDirectory();

  const submit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setFormError("");
    setBusy(true);
    try {
      const ok = await submitDraft(draft, t, resolveUserId, setFormError);
      if (ok) onClose();
    } finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <Shell
      title={t("新建采购需求")}
      busy={busy}
      onClose={onClose}
      feedback={formError && <p role="alert" className="break-words text-pretty text-xs text-rose-700">{formError}</p>}
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('取消')}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('提交')}
        </button>
      </>}
    >
      <DraftFields disabled={busy} draft={draft} setDraft={setDraft} more={more} setMore={setMore} lockContext={lockContext} />
    </Shell>
  );
}

// ── 批量导入物料 ──────────────────────────────────────────────────────────────

/** 模板列名 → UpsertMaterialDto 字段。 */
const IMPORT_COLUMNS = [
  "物料名称", "规格", "单位", "分类", "产品线", "ERP编码", "T+存货编码", "是否特殊物料", "是否耗材", "安全库存", "备注",
] as const;

function yes(v: unknown): boolean {
  return typeof v === "boolean" ? v : ["是", "true", "1", "y", "yes"].includes(String(v ?? "").trim().toLowerCase());
}

async function parseImportFile(file: File): Promise<{ items: MaterialImportItem[]; skipped: number }> {
  const mod = await import("xlsx");
  const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer());
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { items: [], skipped: 0 };
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const items: MaterialImportItem[] = [];
  let skipped = 0;
  for (const row of rows) {
    const name = String(row["物料名称"] ?? "").trim();
    if (!name) { skipped += 1; continue; }
    const safeStock = Number(row["安全库存"]);
    items.push({
      name,
      spec: String(row["规格"] ?? "").trim() || undefined,
      unit: String(row["单位"] ?? "").trim() || undefined,
      category: String(row["分类"] ?? "").trim() || undefined,
      productLine: String(row["产品线"] ?? "").trim() || undefined,
      erpCode: String(row["ERP编码"] ?? "").trim() || undefined,
      tpInventoryCode: String(row["T+存货编码"] ?? "").trim() || undefined,
      isSpecial: yes(row["是否特殊物料"]),
      isConsumable: yes(row["是否耗材"]),
      safeStock: Number.isFinite(safeStock) && safeStock >= 0 ? safeStock : undefined,
      remark: String(row["备注"] ?? "").trim() || undefined,
    });
  }
  return { items, skipped };
}

async function downloadImportTemplate() {
  const mod = await import("xlsx");
  const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
  const wb = XLSX.utils.book_new();
  const example = {
    物料名称: "减震垫 DZC-950", 规格: "50×20mm 橡胶", 单位: "件", 分类: "密封系统",
    产品线: "便携式制氧机", ERP编码: "MAT-0001", "T+存货编码": "", 是否特殊物料: "否",
    是否耗材: "否", 安全库存: 100, 备注: "",
  };
  const ws = XLSX.utils.json_to_sheet([example], { header: [...IMPORT_COLUMNS] });
  ws["!cols"] = IMPORT_COLUMNS.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, "物料导入模板");
  XLSX.writeFile(wb, "物料导入模板.xlsx");
}

/** 批量导入物料：解析 Excel → 预览 → 调后端导入（新建条目落为待审核）。 */
export function ImportMaterialsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<MaterialImportItem[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "parsing" | "ready" | "importing">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const requestIdRef = useRef(0);

  const pick = async (file: File) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = ++requestIdRef.current;
    setError("");
    setItems([]);
    setSkipped(0);
    setFileName(file.name);
    setPhase("parsing");
    setBusy(true);
    try {
      const parsed = await parseImportFile(file);
      if (requestId !== requestIdRef.current) return;
      setItems(parsed.items);
      setSkipped(parsed.skipped);
      setPhase("ready");
      if (parsed.items.length === 0) {
        const message = t('未解析到有效数据行（需包含「物料名称」列）');
        setError(message);
        toast.error(message);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const message = err instanceof Error ? err.message : t('文件解析失败');
      setError(message);
      toast.error(message);
      setPhase("ready");
    } finally {
      if (requestId === requestIdRef.current) {
        busyRef.current = false;
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  };

  const submit = async () => {
    if (busyRef.current) return;
    if (items.length === 0) {
      const message = t('请先选择并解析 Excel 文件');
      setError(message);
      toast.error(message);
      return;
    }
    busyRef.current = true;
    requestIdRef.current += 1;
    setError("");
    setPhase("importing");
    setBusy(true);
    try {
      const result = await importProcMaterials(items);
      await refreshProcurement();
      toast.success(t('导入完成：新增 {created} 条（待审核），更新 {updated} 条', { created: result.created, updated: result.updated }));
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('导入失败');
      setError(message);
      toast.error(message);
      setPhase("ready");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t("批量导入物料")}
      description={t("按模板解析 Excel，先核对新增与更新内容，再写入物料主数据。")}
      busy={busy}
      onClose={onClose}
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('取消')}</button>
        <button type="button" disabled={busy || items.length === 0} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{phase === "parsing" ? t('正在解析…') : phase === "importing" ? t('正在导入…') : items.length > 0 ? t('确认导入 {count} 条', { count: items.length }) : t('确认导入')}
        </button>
      </>}
    >
      <div className="mb-3 grid grid-cols-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
        {[t("选择文件"), t("核对解析结果"), t("导入生效")].map((label, index) => {
          const active = phase === "importing" ? 2 : phase === "ready" ? 1 : 0;
          return <div key={label} className={cn("flex items-center gap-1.5 text-[11px]", index === active ? "font-semibold text-primary" : index < active ? "text-emerald-700" : "text-slate-400")}><span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", index === active ? "border-primary bg-primary text-white" : index < active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>{index < active ? <CheckCircle2 className="size-3" /> : index + 1}</span><span className="truncate">{label}</span></div>;
        })}
      </div>
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center transition-colors", busy ? "cursor-wait opacity-70" : "cursor-pointer hover:border-primary/30 hover:bg-accent/50")}>
        <Upload aria-hidden="true" className="size-8 text-primary/70" />
        <span title={fileName || undefined} className="max-w-full break-words text-pretty text-sm font-medium text-slate-600">{phase === "parsing" ? t("正在解析表格…") : phase === "importing" ? t("正在写入物料主数据…") : fileName || t('点击选择 Excel 文件')}</span>
        <span className="text-[11px] text-slate-400">{t('支持 .xlsx，按下方模板字段解析')}</span>
      </button>
      <Input ref={inputRef} type="file" accept=".xlsx,.xls" disabled={busy} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
      {error && <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}</div>}
      {items.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-700">
          {t('已解析 {count} 条有效物料', { count: items.length })}
          {skipped > 0 && <span className="text-amber-600">，{t('跳过 {count} 条缺少物料名称的行', { count: skipped })}</span>}
          <div className="mt-1 break-words text-slate-500">
            {items.slice(0, 3).map((m, i) => <div key={i}>· {m.name}{m.spec ? ` · ${m.spec}` : ""}{m.category ? ` · ${m.category}` : ""}</div>)}
            {items.length > 3 && <div>…</div>}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
        <p className="min-w-0 flex-1 basis-64 text-pretty text-xs leading-5 text-slate-500">{t('模板列：物料名称（必填）/ 规格 / 单位 / 分类 / 产品线 / ERP编码 / T+存货编码 / 是否特殊物料 / 是否耗材 / 安全库存 / 备注。新增物料将进入审核队列，按名称+规格或 T+ 编码去重（已存在则更新）。')}</p>
        <button type="button" onClick={() => void downloadImportTemplate()} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"><FileDown className="size-3.5" />{t('下载模板')}</button>
      </div>
    </Shell>
  );
}

/** 分类管理：分类无独立表，这里支持重命名（目标已存在即合并到该分类）。 */
export function CategoryManageModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { materials } = useProcurementData();
  const { confirm: confirmAction, confirmDialog } = useConfirmDialog();
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const renameTriggersRef = useRef(new Map<string, HTMLButtonElement>());
  const cancelEditing = (category: string) => {
    setEditing(null);
    setNewName("");
    setError("");
    requestAnimationFrame(() => renameTriggersRef.current.get(category)?.focus());
  };
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const mat of materials) m.set(mat.category, (m.get(mat.category) ?? 0) + 1);
    return m;
  }, [materials]);
  // 分类可能上百个，按名称过滤定位
  const entries = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return [...byCat.entries()].filter(([c]) => !kw || c.toLowerCase().includes(kw));
  }, [byCat, keyword]);

  const doRename = async (from: string, to: string, merging: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await renameProcCategory(from, to);
      await refreshProcurement();
      toast.success(t(merging ? '已合并 {count} 个物料到「{to}」' : '已重命名，{count} 个物料随之更新', { count: result.updated, to }));
      setEditing(null);
      setNewName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : t('操作失败');
      setError(message);
      toast.error(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const rename = async (from: string) => {
    if (busyRef.current) return;
    const to = newName.trim();
    if (!to) { setError(t('请填写新分类名')); return; }
    if (to === from) { setEditing(null); return; }
    const merging = byCat.has(to);
    if (merging) {
      confirmAction({
        title: t('合并分类'),
        desc: t('分类「{to}」已存在，将把「{from}」下的物料并入其中，是否继续？', { to, from }),
        actionLabel: t('合并'),
        onConfirm: () => doRename(from, to, true),
      });
      return;
    }
    try {
      await doRename(from, to, false);
    } catch {
      // 错误已在当前弹层内提示；保留编辑状态供用户修正后重试。
    }
  };

  return (
    <Shell title={t("分类管理")} busy={busy} onClose={onClose} onEscapeKeyDown={(event) => {
      if (editing !== null && !busy) {
        event.preventDefault();
        cancelEditing(editing);
      }
    }} footer={<button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('关闭')}</button>}>
      {confirmDialog}
      <p className="mb-3 text-xs text-slate-400">{t('分类由物料主数据聚合而来；重命名会同步更新该分类下所有物料，改成已有分类名即为合并。')}</p>
      <Input
        aria-label={t("搜索物料分类")}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder={t('按分类名称过滤…')}
        className="mb-3 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
      />
      <div className="space-y-2">
        {entries.map(([c, n]) => (
          <div key={c} className="proc-material-category-row flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
            {editing === c ? (
              <>
                <Input aria-label={t("新分类名称")} aria-invalid={Boolean(error)} autoFocus disabled={busy} value={newName} onChange={(e) => { setError(""); setNewName(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") void rename(c); }} placeholder={c} className="h-9 min-w-0 flex-1 basis-full rounded-lg border border-[var(--primary-soft-border)] px-2 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15" />
                <button type="button" disabled={busy} onClick={() => void rename(c)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60">{busy ? t('处理中…') : t('保存')}</button>
                <button type="button" disabled={busy} onClick={() => cancelEditing(c)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">{t('取消')}</button>
              </>
            ) : (
              <>
                <AutoTranslatedText className="min-w-0 flex-1 break-words text-pretty text-slate-700" text={c || t("未分类")} />
                <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500">{t('{count} 物料', { count: n })}</span>
                <button ref={(node) => { if (node) renameTriggersRef.current.set(c, node); else renameTriggersRef.current.delete(c); }} type="button" onClick={() => { setEditing(c); setNewName(c); setError(""); }} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{t('重命名')}</button>
              </>
            )}
            {editing === c && error && <p role="alert" className="basis-full break-words rounded-lg bg-rose-50 p-3 text-pretty text-sm text-rose-700">{error}</p>}
          </div>
        ))}
        {entries.length === 0 && <div className="space-y-3 py-8 text-center text-sm text-slate-500"><p>{t(byCat.size === 0 ? '暂无分类' : '没有匹配的分类')}</p>{keyword.trim() && <button type="button" onClick={() => setKeyword("")} className="material-button-secondary px-3 py-2 text-xs">{t('清空搜索')}</button>}</div>}
      </div>
    </Shell>
  );
}

// ── AI 初步分类 ───────────────────────────────────────────────────────────────

/** 未分类物料的初步分类：打开即干跑统计（规则/AI 各能分多少），确认后一键应用。 */
export function MaterialClassifyModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ClassifyPreview | null>(null);
  const [report, setReport] = useState<ClassifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    previewMaterialClassify()
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : t('加载失败')));
  }, []);

  const run = async () => {
    setBusy(true);
    setProgress(t('任务已启动…'));
    try {
      // 异步任务：立即拿 jobId，轮询进度（AI 批量要几分钟，同步等会被网关超时切断）
      const { jobId } = await applyMaterialClassify();
      const result = await waitApplyJob<ClassifyReport>(jobId, setProgress);
      setReport(result);
      await refreshProcurement();
      // 刷新预演数据，让「当前分类分布」立即反映本次结果
      setPreview(await previewMaterialClassify().catch(() => preview));
      toast.success(t('分类完成：规则 {rule} 条，AI {ai} 条', { rule: result.ruleApplied, ai: result.aiApplied.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('分类失败'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const catChips = (cats: Record<string, number>) => (
    <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
      {Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
        <span key={c} className="h-fit rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
          <AutoTranslatedText as="span" text={c} /> · {n}
        </span>
      ))}
    </div>
  );

  return (
    <Shell
      title={t("AI 初步分类")}
      busy={busy}
      onClose={onClose}
      wide
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t(report ? '完成' : '关闭')}</button>
        {!report && (
          <button type="button" disabled={busy || !preview || preview.uncategorized === 0} onClick={() => void run()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{t(busy ? '分类中…' : '开始分类')}
          </button>
        )}
      </>}
    >
      <p className="mb-3 text-xs text-slate-400">{t('规则优先（名称【】前缀、编码段反推），AI 只兜规则分不出的尾部；AI 无把握的保持未分类，可再人工整理。')}</p>

      {error && <div className="py-8 text-center text-sm text-red-500">{error}</div>}
      {!error && !preview && <div className="py-8 text-center text-sm text-slate-400">{t('统计中')}…</div>}

      {busy && progress && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-[var(--primary-soft-border)] bg-accent p-3 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />{progress}
        </div>
      )}

      {/* 当前分类分布：分类结果留存，每次打开都能看到最新情况 */}
      {preview && Object.keys(preview.currentCategories).length > 0 && !report && (
        <div className="mb-3 rounded-xl border border-slate-100 p-3">
          <div className="text-xs font-medium text-slate-600">{t('当前分类分布（{n} 个分类）', { n: Object.keys(preview.currentCategories).length })}</div>
          {catChips(preview.currentCategories)}
        </div>
      )}

      {preview && !report && (
        preview.uncategorized === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">{t('没有未分类的物料，无需处理。')}</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3"><div className="text-lg font-semibold text-slate-800">{preview.uncategorized}</div><div className="text-xs text-slate-500">{t('未分类物料')}</div></div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3"><div className="text-lg font-semibold text-emerald-700">{preview.rule1 + preview.rule2}</div><div className="text-xs text-slate-500">{t('规则可分（确定性）')}</div></div>
              <div className="rounded-xl border border-[var(--primary-soft-border)] bg-accent p-3"><div className="text-lg font-semibold tabular-nums text-primary">{preview.aiPending}</div><div className="text-xs text-slate-500">{t('需 AI 判断')}</div></div>
            </div>
            {Object.keys(preview.ruleCategories).length > 0 && (
              <div className="rounded-xl border border-slate-100 p-3">
                <div className="text-xs font-medium text-slate-600">{t('规则分类分布')}</div>
                {catChips(preview.ruleCategories)}
              </div>
            )}
            {preview.aiSamples.length > 0 && (
              <div className="rounded-xl border border-slate-100 p-3">
                <div className="text-xs font-medium text-slate-600">{t('待 AI 判断示例')}</div>
                <ul className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-slate-500">
                  {preview.aiSamples.map((s) => <li key={s} className="truncate">{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        )
      )}

      {report && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm text-emerald-800">
            {t('规则应用 {rule} 条，AI 应用 {ai} 条，未分出 {skip} 条', { rule: report.ruleApplied, ai: report.aiApplied.length, skip: report.aiSkipped.length })}
            {report.model && <span className="ml-2 text-xs text-emerald-600">{t('模型')}: {report.model}</span>}
          </div>
          {report.aiError && <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-700">{t('AI 调用失败，已降级为仅应用规则结果')}：{report.aiError}</div>}
          {Object.keys(report.ruleCategories).length > 0 && (
            <div className="rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-medium text-slate-600">{t('规则分类分布')}</div>
              {catChips(report.ruleCategories)}
            </div>
          )}
          {report.aiApplied.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-medium text-slate-600">{t('AI 分类明细（metadata 已留痕，可在分类管理中纠正）')}</div>
              <ul className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-slate-600">
                {report.aiApplied.map((item) => (
                  <li key={`${item.code}-${item.name}`} className="truncate">
                    {item.code} <AutoTranslatedText as="span" text={item.name} /> → <AutoTranslatedText as="span" text={item.category} /> <span className="text-slate-400">({Math.round(item.confidence * 100)}%)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.aiSkipped.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-medium text-slate-600">{t('未分出（保持未分类，需人工整理）')}</div>
              <ul className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-slate-500">
                {report.aiSkipped.map((item) => (
                  <li key={`${item.code}-${item.name}`} className="truncate">{item.code} <AutoTranslatedText as="span" text={item.name} /> — {item.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

// ── 安全库存初始化 ────────────────────────────────────────────────────────────

/** 基于近 90 天采购镜像初始化安全库存：预演 → 一键应用 → 报告；只填空值不覆盖人工值。 */
export function SafeStockModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<SafeStockPreview | null>(null);
  const [report, setReport] = useState<SafeStockReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    previewSafeStock()
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : t('加载失败')));
  }, []);

  const run = async () => {
    setBusy(true);
    setProgress(t('任务已启动…'));
    try {
      // 异步任务：AI 判定要几分钟，轮询进度避免网关超时
      const { jobId } = await applySafeStock();
      const result = await waitApplyJob<SafeStockReport>(jobId, setProgress);
      setReport(result);
      await refreshProcurement();
      toast.success(t('安全库存已初始化：规则 {rule} 条，AI {ai} 条', { rule: result.ruleApplied, ai: result.aiApplied.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('应用失败'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Shell
      title={t("安全库存初始化")}
      busy={busy}
      onClose={onClose}
      wide
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t(report ? '完成' : '关闭')}</button>
        {!report && (
          <button type="button" disabled={busy || !preview || (preview.ruleCount === 0 && preview.aiPending === 0)} onClick={() => void run()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{t(busy ? '计算中…' : '一键初始化')}
          </button>
        )}
      </>}
    >
      <p className="mb-3 text-xs text-slate-400">{t('依据近 {days} 天 T+ 采购单用量：频次 ≥2 单按月均 × {factor} 直接建议；仅 1 单的由 AI 判断常备性；只填未设置的物料，人工值不覆盖。', { days: preview?.windowDays ?? 90, factor: preview?.coverFactor ?? 1.5 })}</p>

      {error && <div className="py-8 text-center text-sm text-red-500">{error}</div>}
      {!error && !preview && <div className="py-8 text-center text-sm text-slate-400">{t('统计中')}…</div>}

      {busy && progress && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-[var(--primary-soft-border)] bg-accent p-3 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />{progress}
        </div>
      )}

      {preview && !report && (
        preview.ruleCount === 0 && preview.aiPending === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">{t('没有可初始化的物料（近 90 天有采购记录且安全库存为空的物料为 0）。')}</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3"><div className="text-lg font-semibold text-slate-800">{preview.usageMaterialCount}</div><div className="text-xs text-slate-500">{t('近 90 天有采购的物料')}</div></div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3"><div className="text-lg font-semibold text-emerald-700">{preview.ruleCount}</div><div className="text-xs text-slate-500">{t('规则可算（频次 ≥2）')}</div></div>
              <div className="rounded-xl border border-[var(--primary-soft-border)] bg-accent p-3"><div className="text-lg font-semibold tabular-nums text-primary">{preview.aiPending}</div><div className="text-xs text-slate-500">{t('需 AI 判断（仅 1 单）')}</div></div>
            </div>
            {preview.skippedManual > 0 && <div className="text-[11px] text-slate-400">{t('另有 {n} 个物料已人工设置安全库存，不会改动。', { n: preview.skippedManual })}</div>}
            {preview.samples.length > 0 && (
              <div className="rounded-xl border border-slate-100 p-3">
                <div className="text-xs font-medium text-slate-600">{t('建议值示例（按月均用量排序）')}</div>
                <ul className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-slate-500">
                  {preview.samples.map((s) => (
                    <li key={s.code + s.name} className="truncate">{s.code} <AutoTranslatedText as="span" text={s.name} /> · {t('{n} 单', { n: s.orders })} · {t('月均')} {s.monthlyAvg} → <span className="font-medium text-slate-700">{s.suggest}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      )}

      {report && (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm text-emerald-800">
            {t('规则应用 {rule} 条，AI 应用 {ai} 条，跳过 {skip} 条', { rule: report.ruleApplied, ai: report.aiApplied.length, skip: report.aiSkipped.length })}
            {report.model && <span className="ml-2 text-xs text-emerald-600">{t('模型')}: {report.model}</span>}
          </div>
          {report.aiError && <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-700">{t('AI 调用失败，已降级为仅应用规则结果')}：{report.aiError}</div>}
          {report.aiApplied.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-medium text-slate-600">{t('AI 判定常备并应用')}</div>
              <ul className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-slate-600">
                {report.aiApplied.map((item) => (
                  <li key={item.code + item.name} className="truncate">{item.code} <AutoTranslatedText as="span" text={item.name} /> → {item.suggest} <span className="text-slate-400">({Math.round(item.confidence * 100)}%)</span></li>
                ))}
              </ul>
            </div>
          )}
          {report.aiSkipped.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-medium text-slate-600">{t('未设置（一次性采购或无把握）')}</div>
              <ul className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-slate-500">
                {report.aiSkipped.map((item) => (
                  <li key={item.code + item.name} className="truncate">{item.code} <AutoTranslatedText as="span" text={item.name} /> — {item.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

// ── 补货建议 ──────────────────────────────────────────────────────────────────

/** 缺料 → 补货清单（缺口已扣在途与进行中任务）→ 勾选/改量 → 批量生成采购任务。 */
export function ReplenishModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReplenishSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const [submitError, setSubmitError] = useState("");
  const { invalidIds, items } = validateReplenishmentSelection(selected);
  const quantityError = invalidIds.length > 0 ? t("请为已勾选物料填写大于 0 的整数补货量") : selected.size > 100 ? t("单次最多生成 100 个任务，请减少勾选项") : "";
  const [createdCodes, setCreatedCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setRows(null); setError(null);
    try {
      const result = await listReplenishSuggestions();
      if (requestId !== requestRef.current) return;
      setRows(result.rows);
      setSelected(new Map(result.rows.map((row) => [row.materialId, String(row.suggestQty)])));
    } catch (err) {
      if (requestId === requestRef.current) setError(err instanceof Error ? err.message : t('加载失败'));
    }
  }, [t]);
  useEffect(() => { void load(); return () => { requestRef.current += 1; }; }, [load]);

  const toggle = (id: string, suggest: number) => {
    if (busyRef.current) return;
    setSubmitError("");
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(id)) next.delete(id);
      else next.set(id, String(suggest));
      return next;
    });
  };
  const setQty = (id: string, qty: string) => {
    if (busyRef.current) return;
    setSubmitError("");
    setSelected((cur) => {
      const next = new Map(cur);
      next.set(id, qty);
      return next;
    });
  };

  const submit = async () => {
    if (busyRef.current) return;
    if (quantityError || !items.length) { setSubmitError(quantityError || t('请至少勾选一条补货建议')); return; }
    busyRef.current = true;
    setSubmitError("");
    setBusy(true);
    try {
      const result = await createReplenishTasks(items);
      setCreatedCodes(result.codes);
      await refreshProcurement();
      toast.success(t('已生成 {n} 个采购任务', { n: result.created }));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('生成失败');
      setSubmitError(message);
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t("补货建议")}
      busy={busy}
      onClose={onClose}
      wide
      feedback={(quantityError || submitError) && <p role="alert" className="text-pretty text-xs text-rose-700">{quantityError || submitError}</p>}
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t(createdCodes ? '完成' : '关闭')}</button>
        {!createdCodes && (
          <button type="button" disabled={busy || !rows || Boolean(error) || Boolean(quantityError) || selected.size === 0} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? t('正在生成采购任务…') : t('生成 {n} 个采购任务', { n: selected.size })}
          </button>
        )}
      </>}
    >
      <p className="mb-3 text-xs text-slate-400">{t('建议量 = 安全库存 − 当前库存 − T+ 在途 − 进行中采购任务未到量；零库存物料生成的任务自动高优先级。')}</p>

      {error && <div role="alert" className="space-y-3 py-8 text-center text-sm text-rose-600"><p className="break-words">{error}</p><button type="button" onClick={() => void load()} className="material-button-secondary px-3 py-2 text-xs">{t("重新加载")}</button></div>}
      {!error && !rows && <div role="status" className="py-8 text-center text-sm text-slate-500">{t('计算中')}…</div>}

      {createdCodes ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm text-emerald-800">
          {t('已生成 {n} 个采购任务，可在供应链任务驾驶舱查看：', { n: createdCodes.length })}
          <div className="mt-1 text-xs">{createdCodes.join('、')}</div>
        </div>
      ) : rows && (
        rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">{t('没有需要补货的物料：所有缺口已被在途或进行中任务覆盖。')}</div>
        ) : (
          <div role="region" aria-label={t("补货建议明细")} tabIndex={0} className="max-h-[380px] overflow-auto overscroll-contain rounded-xl border border-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
            <table className="w-full min-w-[48rem] text-xs">
              <caption className="sr-only">{t("补货建议明细")}</caption>
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium"></th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">{t('物料')}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">{t('库存/安全')}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">{t('在途')}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">{t('任务中')}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">{t('补货量')}</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">{t('最近供应商/单价')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.materialId} className={cn("border-t border-slate-100", !selected.has(r.materialId) && "opacity-50")}>
                    <td className="px-2 py-1.5"><Checkbox aria-label={t("选择补货物料：{name}", { name: r.name })} disabled={busy} checked={selected.has(r.materialId)} onCheckedChange={() => toggle(r.materialId, r.suggestQty)} className="size-3.5" /></td>
                    <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-700" title={r.name}>{r.code} <AutoTranslatedText as="span" text={r.name} /></td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", r.stock <= 0 ? "font-semibold text-rose-600" : "text-amber-600")}>{r.stock.toLocaleString()} / {r.safeStock.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.inTransit.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.openTaskQty.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Input
                        type="number"
                        aria-label={t("{name} 补货量", { name: r.name })}
                        aria-invalid={invalidIds.includes(r.materialId)}
                        aria-describedby={invalidIds.includes(r.materialId) ? `replenish-error-${r.materialId}` : undefined}
                        min={1}
                        step={1}
                        value={selected.get(r.materialId) ?? r.suggestQty}
                        disabled={busy || !selected.has(r.materialId)}
                        onChange={(e) => setQty(r.materialId, e.target.value)}
                        className="h-9 w-24 rounded border border-slate-200 px-1.5 text-right text-xs tabular-nums outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15 disabled:bg-slate-50 md:text-xs"
                      />
                      {invalidIds.includes(r.materialId) && <p id={`replenish-error-${r.materialId}`} className="mt-1 max-w-24 text-pretty text-left text-[11px] text-rose-700">{t("请输入正整数")}</p>}
                    </td>
                    <td className="max-w-[140px] truncate px-2 py-1.5 text-slate-400" title={r.lastSupplier ?? undefined}>
                      {r.lastSupplier ? <AutoTranslatedText as="span" text={r.lastSupplier} /> : '—'}{r.lastPrice != null ? ` · ¥${r.lastPrice}` : ''}{r.packStep ? ` · ${t('按 {n} 起订', { n: r.packStep })}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </Shell>
  );
}

// ── 批量转派 ──────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = ["completed", "cancelled"];

/** 批量转派：勾选进行中任务 → 输入新采购负责人 → 逐个调转派接口。 */
export function BatchReassignModal({ tasks, onClose }: { tasks: ProcurementTask[]; onClose: () => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [buyer, setBuyer] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const { resolveUserId } = useBuyerDirectory();

  const eligibleTasks = useMemo(() => tasks.filter((task) => !TERMINAL_STATUSES.includes(task.status)), [tasks]);
  const eligibleIds = useMemo(() => new Set(eligibleTasks.map((task) => task.id)), [eligibleTasks]);
  const validSelected = useMemo(() => retainAvailableProcurementSelection(selected, eligibleIds), [selected, eligibleIds]);
  // 在本次渲染提交前清除失效项，避免旧选择在任务重新开放后意外复活。
  if (validSelected.size !== selected.size) setSelected(validSelected);

  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return eligibleTasks.filter((task) => !kw || `${task.code} ${task.materialName} ${task.buyer}`.toLowerCase().includes(kw));
  }, [eligibleTasks, keyword]);

  const toggle = (id: string) => { if (busyRef.current || !eligibleIds.has(id)) return; setError(""); setSelected((cur) => {
    const next = retainAvailableProcurementSelection(cur, eligibleIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }); };
  const allChecked = candidates.length > 0 && candidates.every((task) => validSelected.has(task.id));
  const toggleAll = () => {
    if (busyRef.current) return;
    setSelected((current) => setVisibleProcurementSelection(retainAvailableProcurementSelection(current, eligibleIds), candidates.map((task) => task.id), !allChecked));
  };

  const submit = async () => {
    if (busyRef.current) return;
    const name = buyer.trim();
    if (!name) {
      const message = t('请填写新采购负责人');
      setError(message);
      toast.error(message);
      return;
    }
    if (validSelected.size === 0) {
      const message = t('请至少勾选一个任务');
      setError(message);
      toast.error(message);
      return;
    }
    busyRef.current = true;
    setError("");
    setBusy(true);
    try {
      // 后端事务原子执行：任一任务已完结/不存在则整批回滚，不会转一半
      const result = await batchReassignProcTasks(Array.from(validSelected), name, resolveUserId(name));
      await refreshProcurement();
      toast.success(t('已转派 {count} 个任务给 {name}', { count: result.updated, name }));
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('转派失败');
      setError(message);
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t("批量转派")}
      description={t("先选择进行中任务，再指定接收负责人；整批操作失败时不会部分转派。")}
      busy={busy}
      onClose={onClose}
      wide
      feedback={error && <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}</div>}
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('取消')}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? t('正在转派…') : validSelected.size > 0 ? t('转派 {count} 个任务', { count: validSelected.size }) : t('转派')}
        </button>
      </>}
    >
      <div className="mb-3 grid grid-cols-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
        {[t("选择任务"), t("确认接收人")].map((label, index) => { const active = validSelected.size > 0 ? 1 : 0; return <div key={label} className={cn("flex items-center gap-2 text-xs", index === active ? "font-semibold text-primary" : "text-emerald-700")}><span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", index === active ? "border-primary bg-primary text-white" : "border-emerald-300 bg-emerald-50")}>{index < active ? <CheckCircle2 className="size-3" /> : index + 1}</span>{label}</div>; })}
      </div>
      <fieldset disabled={busy} className="min-w-0">
      <div className="proc-business-fields mb-3 grid grid-cols-1 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">{t('新采购负责人')}<span className="ml-0.5 text-rose-500">*</span></span>
          <BuyerComboInput disabled={busy} ariaLabel={t('新采购负责人')} value={buyer} onChange={(value) => { setBuyer(value); setError(""); }} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">{t('筛选任务')}</span>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t('搜索单号 / 物料 / 当前负责人')} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15" />
        </label>
      </div>
      <label className="mb-1 flex cursor-pointer items-center gap-2 px-1 py-1 text-xs text-slate-500">
        <Checkbox disabled={busy || candidates.length === 0} checked={allChecked ? true : candidates.some((task) => validSelected.has(task.id)) ? "indeterminate" : false} onCheckedChange={() => { toggleAll(); setError(""); }} />
        {t('全选（{count} 个进行中任务）', { count: candidates.length })}
      </label>
      <p aria-live="polite" className="mb-2 text-xs tabular-nums text-slate-500">{t("已选 {count} 个，其中 {hidden} 个不在当前筛选中", { count: validSelected.size, hidden: [...validSelected].filter((id) => !candidates.some((task) => task.id === id)).length })}</p>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((task) => (
          <label key={task.id} className={cn("flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm", validSelected.has(task.id) ? "border-[var(--primary-soft-border)] bg-accent" : "border-slate-100 hover:bg-slate-50")}>
            <Checkbox disabled={busy} checked={validSelected.has(task.id)} onCheckedChange={() => toggle(task.id)} />
            <span className="max-w-full break-all text-xs tabular-nums text-slate-400">{task.code}</span>
            <AutoTranslatedText className="min-w-0 flex-1 basis-48 break-words text-slate-700" text={task.materialName} />
            <span className="max-w-full break-words text-xs text-slate-500">{t('当前')}：{task.buyer || t('未指派')}</span>
          </label>
        ))}
        {candidates.length === 0 && <div className="py-8 text-center text-sm text-slate-400">{t('没有可转派的进行中任务')}</div>}
      </div>
      </fieldset>
    </Shell>
  );
}

// ── 任务编辑 ──────────────────────────────────────────────────────────────────

const ORDER_STAGE = ["priced", "pending_purchase", "in_transit", "partial_arrival", "completed"];

/** 任务信息编辑：数量/优先级/日期 + 下单阶段的付款登记。只提交有变化的字段。 */
export function EditTaskModal({ task, onClose }: { task: ProcurementTask; onClose: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    quantity: String(task.quantity),
    priority: task.priority,
    needDate: task.needDate ?? "",
    deadline: task.deadline ?? "",
    expectedArrivalDate: task.expectedArrivalDate ?? "",
    paymentStatus: task.paymentStatus,
    paymentDate: task.paymentDate ?? "",
    paymentNote: task.paymentNote ?? "",
    purchaseLink: task.purchaseLink ?? "",
    consumableNote: task.consumableNote ?? "",
  }));
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => { setError(""); setForm((f) => ({ ...f, [key]: value })); };
  const orderStage = ORDER_STAGE.includes(task.status);
  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15";
  const label = "text-xs font-medium text-slate-500";

  const submit = async () => {
    if (busyRef.current) return;
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const message = t('请填写有效数量');
      setError(message);
      toast.error(message);
      return;
    }
    // 全量对比初值，只提交改过的字段（后端会记一条「更新任务信息」留痕）
    const input: UpdateProcTaskInput = {};
    if (quantity !== task.quantity) input.quantity = quantity;
    if (form.priority !== task.priority) input.priority = form.priority;
    if (form.needDate !== (task.needDate ?? "")) input.needDate = form.needDate;
    if (form.deadline !== (task.deadline ?? "")) input.deadline = form.deadline;
    if (form.expectedArrivalDate !== (task.expectedArrivalDate ?? "")) input.expectedArrivalDate = form.expectedArrivalDate;
    if (form.paymentStatus !== task.paymentStatus) input.paymentStatus = form.paymentStatus;
    if (form.paymentDate !== (task.paymentDate ?? "")) input.paymentDate = form.paymentDate;
    if (form.paymentNote !== (task.paymentNote ?? "")) input.paymentNote = form.paymentNote.trim();
    if (form.purchaseLink !== (task.purchaseLink ?? "")) input.purchaseLink = form.purchaseLink.trim();
    if (form.consumableNote !== (task.consumableNote ?? "")) input.consumableNote = form.consumableNote.trim();
    if (Object.keys(input).length === 0) { setError(t('没有修改任何内容')); toast.info(t('没有修改任何内容')); return; }
    busyRef.current = true;
    setError("");
    setBusy(true);
    try {
      await updateProcTask(task.id, input);
      await refreshProcurement();
      toast.success(t('任务信息已更新'));
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('更新失败');
      setError(message);
      toast.error(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t("编辑任务信息")}
      description={t("仅调整任务基础信息与付款记录；业务状态仍通过任务卡的下一步操作推进。")}
      busy={busy}
      onClose={onClose}
      feedback={error && <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}</div>}
      footer={<>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('取消')}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? t('正在保存…') : t('保存任务信息')}
        </button>
      </>}
    >
      <fieldset disabled={busy} className="min-w-0">
      <p className="mb-3 truncate text-xs tabular-nums text-slate-400" title={`${task.code} · ${task.materialName}`}>{task.code} · <AutoTranslatedText as="span" text={task.materialName} /></p>
      <div className="proc-business-fields grid grid-cols-1 gap-3">
        <label className="block"><span className={label}>{t('数量')}</span><Input aria-invalid={Boolean(error && !(Number(form.quantity) > 0))} value={form.quantity} onChange={(e) => set('quantity')(e.target.value)} inputMode="decimal" className={cn(field, "tabular-nums")} /></label>
        <div>
          <span className={label}>{t('优先级')}</span>
          <Select disabled={busy} value={form.priority} onValueChange={(v) => set('priority')(v as typeof form.priority)}>
            <SelectTrigger aria-label={t('优先级')} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">{t('高')}</SelectItem>
              <SelectItem value="medium">{t('中')}</SelectItem>
              <SelectItem value="low">{t('低')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><span className={label}>{t('需求日期')}</span><DateInput disabled={busy} value={form.needDate} onChange={set('needDate')} ariaLabel={t('需求日期')} className="mt-1" /></div>
        <div><span className={label}>Deadline</span><DateInput disabled={busy} value={form.deadline} onChange={set('deadline')} ariaLabel="Deadline" className="mt-1" /></div>
        {task.method === "direct" && (
          <label className="col-span-full block"><span className={label}>{t('商品链接')}</span><Input value={form.purchaseLink} onChange={(e) => set('purchaseLink')(e.target.value)} className={field} /></label>
        )}
        <label className="col-span-full block"><span className={label}>{t('低值易耗品备注')}</span><Input value={form.consumableNote} onChange={(e) => set('consumableNote')(e.target.value)} className={field} /></label>
      </div>
      {orderStage && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-600">{t('下单与付款')}</div>
          <div className="proc-business-fields grid grid-cols-1 gap-3">
            <div><span className={label}>{t('预计到货')}</span><DateInput disabled={busy} value={form.expectedArrivalDate} onChange={set('expectedArrivalDate')} ariaLabel={t('预计到货日期')} className="mt-1" /></div>
            <div>
              <span className={label}>{t('付款状态')}</span>
              <Select disabled={busy} value={form.paymentStatus} onValueChange={(v) => set('paymentStatus')(v as PaymentStatus)}>
                <SelectTrigger aria-label={t('付款状态')} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">{t('未付款')}</SelectItem>
                  <SelectItem value="partial">{t('部分付款')}</SelectItem>
                  <SelectItem value="paid">{t('已付款')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><span className={label}>{t('付款日期')}</span><DateInput disabled={busy} value={form.paymentDate} onChange={set('paymentDate')} ariaLabel={t('付款日期')} className="mt-1" /></div>
            <label className="block"><span className={label}>{t('付款备注')}</span><Input value={form.paymentNote} onChange={(e) => set('paymentNote')(e.target.value)} placeholder={t('如：首付 30% 已付')} className={field} /></label>
          </div>
        </div>
      )}
      </fieldset>
    </Shell>
  );
}

// ── 物料新增/编辑 ─────────────────────────────────────────────────────────────

const MATERIAL_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MATERIAL_IMAGE_MAX_SIZE = 10 * 1024 * 1024;

/** 物料主数据表单：传 material 为编辑（后端 PUT 全量覆盖，务必带全字段），不传为新建。 */
export function MaterialFormModal({ material, onClose }: { material?: Material; onClose: () => void }) {
  const { t } = useI18n();
  const { materials } = useProcurementData();
  const productLines = useProductLines();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [imageError, setImageError] = useState("");
  const [form, setForm] = useState(() => ({
    name: material?.name ?? "",
    spec: material?.spec ?? "",
    unit: material?.unit ?? "",
    category: material?.category ?? "",
    productLine: material?.productLine ?? "",
    erpCode: material?.erpCode ?? "",
    tpInventoryCode: material?.tpInventoryCode ?? "",
    isSpecial: material?.isSpecial ?? false,
    isConsumable: material?.isConsumable ?? false,
    safeStock: material != null ? String(material.safeStock) : "",
    remark: material?.remark ?? "",
  }));
  const imageInputRef = useRef<HTMLInputElement>(null);
  const materialNameRef = useRef<HTMLInputElement>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const [imageKeyPatch, setImageKeyPatch] = useState<string | undefined>(undefined);
  const [imagePreview, setImagePreview] = useState<string | null>(material?.imageUrl ?? null);
  const [imageName, setImageName] = useState(material?.imageUrl ? t("已保存的商品图片") : "");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageDragging, setImageDragging] = useState(false);
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => { setFormError(""); setForm((f) => ({ ...f, [key]: value })); };
  const categories = useMemo(() => Array.from(new Set(materials.map((m) => m.category).filter(Boolean))), [materials]);
  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15";
  const label = "text-xs font-medium text-slate-500";

  const replaceImagePreview = (url: string | null, local = false) => {
    if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    localPreviewUrlRef.current = local && url ? url : null;
    setImagePreview(url);
  };

  useEffect(
    () => () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    },
    [],
  );

  const uploadImage = async (file: File | undefined) => {
    if (!file || busy || imageBusy) return;
    setImageError("");
    if (!MATERIAL_IMAGE_TYPES.has(file.type)) {
      const message = t("请选择 JPG、PNG、WebP 或 GIF 图片");
      setImageError(message);
      toast.error(message);
      return;
    }
    if (file.size > MATERIAL_IMAGE_MAX_SIZE) {
      const message = t("商品图片不能超过 10 MB");
      setImageError(message);
      toast.error(message);
      return;
    }
    setImageBusy(true);
    try {
      const uploaded = await uploadProcurementAttachment(file);
      const localUrl = uploaded.signedUrl ? null : URL.createObjectURL(file);
      replaceImagePreview(uploaded.signedUrl ?? localUrl, Boolean(localUrl));
      setImageKeyPatch(uploaded.objectKey);
      setImageName(file.name);
      toast.success(t("商品图片已上传，保存商品后生效"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("商品图片上传失败");
      setImageError(message);
      toast.error(message);
    } finally {
      setImageBusy(false);
      setImageDragging(false);
    }
  };

  const removeImage = () => {
    setImageKeyPatch("");
    replaceImagePreview(null);
    setImageName("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const submit = async () => {
    if (!form.name.trim()) {
      const message = t('请填写物料名称');
      setFormError(message);
      materialNameRef.current?.focus();
      toast.error(message);
      return;
    }
    setFormError("");
    const safeStock = Number(form.safeStock);
    setBusy(true);
    try {
      // 后端更新为部分更新：编辑时空串照发（显式清空该字段），新建时空串省略走默认值
      const str = (v: string) => (material ? v.trim() : v.trim() || undefined);
      await upsertProcMaterial({
        name: form.name.trim(),
        spec: str(form.spec),
        unit: str(form.unit),
        category: str(form.category),
        productLine: str(form.productLine),
        erpCode: str(form.erpCode),
        tpInventoryCode: str(form.tpInventoryCode),
        isSpecial: form.isSpecial,
        isConsumable: form.isConsumable,
        safeStock: Number.isFinite(safeStock) && safeStock >= 0 ? safeStock : undefined,
        remark: str(form.remark),
        // undefined 表示编辑时保留原图，空串表示移除图片。
        imageKey: imageKeyPatch,
      }, material?.id);
      await refreshProcurement();
      toast.success(t(material ? '物料已更新' : '物料已创建，进入审核队列'));
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('保存失败');
      setFormError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t(material ? "编辑物料" : "新增物料")}
      description={t(material ? "更新物料主数据与商品图片，保存后同步刷新采购页面。" : "创建商品主数据；新建记录将进入审核队列后再用于采购业务。")}
      busy={busy || imageBusy}
      onClose={onClose}
      feedback={formError ? <p role="alert" className="break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-pretty text-sm text-rose-700">{formError}</p> : undefined}
      footer={<>
        <button type="button" disabled={busy || imageBusy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('取消')}</button>
        <button type="button" disabled={busy || imageBusy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? t('正在保存…') : t(material ? '更新物料' : '创建物料')}
        </button>
      </>}
    >
      <fieldset disabled={busy} className="proc-material-form-fields grid min-w-0 grid-cols-1 gap-3 border-0 p-0">
        <label className="block min-w-0"><span className={label}>{t('物料名称')}<span className="ml-0.5 text-rose-500">*</span></span><Input ref={materialNameRef} aria-invalid={Boolean(formError && !form.name.trim())} value={form.name} onChange={(e) => set('name')(e.target.value)} className={cn(field, formError && !form.name.trim() && "border-rose-300")} /></label>
        <label className="block min-w-0"><span className={label}>{t('规格')}</span><Input value={form.spec} onChange={(e) => set('spec')(e.target.value)} className={field} /></label>
        <div className="col-span-full">
          <span className={label}>{t('商品图片')} <span className="font-normal text-slate-400">{t('（选填）')}</span></span>
          <input
            ref={imageInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            className="hidden"
            disabled={busy || imageBusy}
            onChange={(event) => {
              void uploadImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div
            onDragEnter={(event) => { event.preventDefault(); if (!busy && !imageBusy) setImageDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setImageDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setImageDragging(false);
              if (!busy && !imageBusy) void uploadImage(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              "mt-1 flex min-h-28 flex-wrap items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3",
              imageDragging
                ? "border-primary/40 bg-accent ring-2 ring-primary/15"
                : "border-slate-200 bg-slate-50/60",
              imageBusy && "cursor-wait opacity-70",
            )}
          >
            {imagePreview ? (
              <>
                <button type="button" disabled={imageBusy} onClick={() => imageInputRef.current?.click()} className="flex min-w-0 flex-1 basis-48 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-wait">
                  <img src={imagePreview} alt={t("商品图片预览")} className="size-16 shrink-0 rounded-lg border border-slate-200 bg-white object-cover" />
                  <span className="min-w-0 flex-1">
                    <span title={imageName || undefined} className="block break-words text-pretty text-sm font-semibold text-slate-700">{imageName || t("商品图片")}</span>
                    <span className="mt-1 block text-pretty text-xs text-slate-400">{imageBusy ? t("正在上传…") : t("点击更换，或拖入新图片")}</span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={imageBusy}
                  onClick={(event) => { event.stopPropagation(); removeImage(); }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />{t("移除")}
                </button>
              </>
            ) : (
              <button type="button" disabled={imageBusy} onClick={() => imageInputRef.current?.click()} className="flex w-full flex-col items-center justify-center rounded-lg py-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-wait">
                {imageBusy ? <Loader2 className="size-6 animate-spin text-primary" /> : <ImagePlus className="size-7 text-primary" />}
                <p className="mt-2 text-sm font-medium text-slate-700">{imageBusy ? t("正在上传商品图片…") : t("点击选择或拖拽上传商品图片")}</p>
                <p className="mt-1 text-xs text-slate-400">{t("支持 JPG、PNG、WebP、GIF，最大 10 MB；可不上传")}</p>
              </button>
            )}
          </div>
          {imageError && <p role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{imageError}</p>}
        </div>
        <label className="block min-w-0"><span className={label}>{t('单位')}</span><Input value={form.unit} onChange={(e) => set('unit')(e.target.value)} placeholder={t('如 件')} className={field} /></label>
        <label className="block min-w-0">
          <span className={label}>{t('分类')}</span>
          <ComboInput value={form.category} onChange={set('category')} options={categories} placeholder={t('输入或从已有分类中选')} className={field} />
        </label>
        <label className="block min-w-0">
          <span className={label}>{t('产品线')}</span>
          <ComboInput value={form.productLine} onChange={set('productLine')} options={productLines} placeholder={t('如 R1 / R2 / 通用')} className={field} />
        </label>
        <label className="block min-w-0"><span className={label}>{t('ERP 编码')}</span><Input value={form.erpCode} onChange={(e) => set('erpCode')(e.target.value)} className={field} /></label>
        <label className="block min-w-0"><span className={label}>{t('T+ 存货编码')}</span><Input value={form.tpInventoryCode} onChange={(e) => set('tpInventoryCode')(e.target.value)} className={field} /></label>
        <label className="block min-w-0"><span className={label}>{t('安全库存')}</span><Input value={form.safeStock} onChange={(e) => set('safeStock')(e.target.value)} inputMode="decimal" placeholder="0" className={field} /></label>
        <label className="col-span-full block"><span className={label}>{t('备注')}</span><Input value={form.remark} onChange={(e) => set('remark')(e.target.value)} className={field} /></label>
        <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-slate-600"><Checkbox checked={form.isSpecial} onCheckedChange={(v) => set('isSpecial')(v === true)} />{t('特殊物料')}</label>
        <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-slate-600"><Checkbox checked={form.isConsumable} onCheckedChange={(v) => set('isConsumable')(v === true)} />{t('低值易耗品')}</label>
      </fieldset>
    </Shell>
  );
}

// ── 畅捷通 T+ 集成 ────────────────────────────────────────────────────────────

function formatTplusAutoSyncTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date).replaceAll("/", "-");
}

/**
 * T+ 集成弹窗：凭据录入（appSecret 由管理员现场填写，后端落库加密、不回显）
 * + 同步状态、手动同步、OAuth 授权与每日自动同步配置。
 */
export function TplusConfigModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<TplusConfigState | null>(null);
  const [mirrored, setMirrored] = useState<{ suppliers: number; materials: number; balances: number; purchaseOrderRefs: number } | null>(null);
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [autoSyncBusy, setAutoSyncBusy] = useState(false);
  const working = busy || syncing !== null || autoSyncBusy;
  // 回调地址随凭据保存进后端，须与开放平台应用配置一致
  const defaultRedirectUri = `${window.location.origin}/api/procurement/tplus/oauth/callback`;

  const reload = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [cfg, status] = await Promise.all([getTplusConfig(), getTplusStatus()]);
      setConfig(cfg);
      setMirrored(status.mirrored);
      setBaseUrl(cfg.baseUrl);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('加载配置失败'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  const syncFull = async () => {
    setActionError("");
    setSyncing("purchase-orders-full");
    setSyncProgress(t('任务已启动…'));
    try {
      // 异步任务：逐单精查要几分钟，同步等响应会被网关超时切断
      const { jobId } = await syncTplusPurchaseOrdersFull();
      const r = await waitApplyJob<PoFullSyncResult>(jobId, setSyncProgress, getTplusSyncJob);
      toast.success(t('全量同步完成：{orders} 张单 / {lines} 行，物料命中 {m}，失败 {f}', { orders: r.orders, lines: r.lines, m: r.matchedMaterials, f: r.failed }));
      void reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('同步失败'));
    } finally {
      setSyncing(null);
      setSyncProgress(null);
    }
  };

  const syncMaterials = async () => {
    setActionError("");
    setSyncing("materials");
    setSyncProgress(t('任务已启动…'));
    try {
      const { jobId } = await syncTplusMaterialMaster();
      const result = await waitApplyJob<TplusMaterialMasterSyncResult>(jobId, setSyncProgress, getTplusSyncJob);
      await Promise.all([refreshProcurement(), reload()]);
      toast.success(t('物料主档同步完成：收到 {received}，新增 {created}，更新 {updated}，任务树补链 {linked}', {
        received: result.received,
        created: result.created,
        updated: result.updated,
        linked: result.linkedNodes,
      }));
      if (result.conflicts > 0 || result.ambiguousNodes > 0) {
        toast.warning(t('有 {conflicts} 条物料编码冲突、{ambiguous} 个任务树节点存在歧义，已安全跳过', {
          conflicts: result.conflicts,
          ambiguous: result.ambiguousNodes,
        }));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('同步失败'));
    } finally {
      setSyncing(null);
      setSyncProgress(null);
    }
  };

  const syncAll = async () => {
    setActionError("");
    setSyncing("auto");
    setSyncProgress(t('任务已启动…'));
    try {
      const { jobId } = await runTplusAutoSync();
      const r = await waitApplyJob<TplusAutoSyncResult>(jobId, setSyncProgress, getTplusSyncJob);
      if (r.skipped) toast.warning(t('已跳过：{reason}', { reason: r.reason ?? '' }));
      else if ((r.failedSteps ?? 0) > 0) toast.warning(t('全同步已结束，但有 {count} 个步骤失败：{summary}', { count: r.failedSteps ?? 0, summary: r.summary ?? '' }));
      else toast.success(t('全同步完成：{summary}', { summary: r.summary ?? '' }));
      void reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('同步失败'));
    } finally {
      setSyncing(null);
      setSyncProgress(null);
    }
  };

  const toggleAutoSync = async (next: boolean) => {
    if (!config || autoSyncBusy) return;
    setActionError("");
    setAutoSyncBusy(true);
    try {
      // 只传开关：appKey/appSecret 后端保留已存值，避免误覆盖
      const saved = await saveTplusConfig({ autoSync: next });
      setConfig(saved);
      toast.success(t(next ? '已开启每日自动同步（3:00）' : '已关闭每日自动同步'));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('操作失败'));
    } finally {
      setAutoSyncBusy(false);
    }
  };

  const save = async () => {
    if (!config || loading || working) return;
    setActionError("");
    if (!appKey.trim() && !config?.appKeyMasked) { setActionError(t('请填写 appKey')); return; }
    if (!config?.hasSecret && !appSecret.trim()) { setActionError(t('首次配置需填写 appSecret')); return; }
    setBusy(true);
    try {
      const next = await saveTplusConfig({
        appKey: appKey.trim() || undefined,
        appSecret: appSecret.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        redirectUri: config?.redirectUri ?? defaultRedirectUri,
      });
      setConfig(next);
      setAppSecret("");
      toast.success(t('T+ 凭据已保存（appSecret 已加密存储）'));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const sync = async (kind: "suppliers" | "inventory" | "purchase-orders", label: string) => {
    setActionError("");
    setSyncing(kind);
    try {
      const result = await triggerTplusSync(kind);
      await refreshProcurement();
      toast.success(`${t(label)}${t('同步完成')}：${Object.entries(result).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      void reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('同步失败'));
    } finally {
      setSyncing(null);
    }
  };

  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15";
  const label = "text-xs font-medium text-slate-500";
  const lastAutoSyncText = config?.lastAutoSyncAt
    ? `${t('上次自动同步')} ${formatTplusAutoSyncTime(config.lastAutoSyncAt)}${config.lastAutoSyncSummary ? ` · ${config.lastAutoSyncSummary}` : ''}`
    : t('尚未执行自动同步');
  const lastMaterialSyncText = config?.lastMaterialSyncAt
    ? `${t('上次物料主档同步')} ${formatTplusAutoSyncTime(config.lastMaterialSyncAt)}${config.lastMaterialSyncSummary ? ` · ${config.lastMaterialSyncSummary}` : ''}`
    : t('尚未执行物料主档同步');

  return (
    <Shell
      title={t("畅捷通 T+ 集成")}
      busy={working}
      onClose={onClose}
      wide
      feedback={actionError ? <p role="alert" className="break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-pretty text-sm text-rose-700">{actionError}</p> : undefined}
      footer={<>
        <button type="button" disabled={working} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{t('关闭')}</button>
        <button type="button" disabled={working || loading || !config} onClick={() => void save()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('保存凭据')}
        </button>
      </>}
    >
      {loadError && <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        <p className="break-words text-pretty">{loadError}</p>
        <button type="button" disabled={loading} onClick={() => void reload()} className="material-button-secondary mt-3 px-3 py-2 text-xs">{t('重新加载')}</button>
      </div>}
      {!config && loading && <div role="status" className="space-y-3 py-2"><p className="text-sm text-slate-500">{t('正在加载 T+ 配置')}</p><div className="h-16 rounded-lg bg-slate-100" /><div className="h-16 rounded-lg bg-slate-100" /></div>}
      {config && <>
      {/* 状态条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-full border px-2 py-0.5", config?.configured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500")}>
          {t(config?.configured ? '凭据已配置' : '凭据未配置')}{config?.appKeyMasked ? ` · ${config.appKeyMasked}` : ''}
        </span>
        <span className={cn("rounded-full border px-2 py-0.5", config?.authorized ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
          {config?.authorized
            ? `${t('已授权')}${config.tokenExpireAt ? ` · token ${t('有效至')} ${config.tokenExpireAt.slice(0, 10)}` : ''}`
            : t('待授权')}
        </span>
        {mirrored && (
          <span className="text-slate-400">{t('已镜像')}：{t('物料')} {mirrored.materials ?? 0} · {t('供应商')} {mirrored.suppliers} · {t('库存')} {mirrored.balances} · {t('采购单')} {mirrored.purchaseOrderRefs}</span>
        )}
      </div>

      {/* 凭据表单：appSecret 不回显，留空表示保留已存值 */}
      <div className="space-y-3">
        <label className="block"><span className={label}>appKey<span className="ml-0.5 text-rose-500">*</span></span>
          <Input disabled={working || loading} value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder={config?.appKeyMasked ? t('已配置（{masked}），重新填写将覆盖', { masked: config.appKeyMasked }) : t('开放平台应用的 appKey')} className={field} />
        </label>
        <label className="block"><span className={label}>appSecret{!config?.hasSecret && <span className="ml-0.5 text-rose-500">*</span>}</span>
          <Input disabled={working || loading} type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={config?.hasSecret ? t('已加密存储，留空保持不变') : t('开放平台应用的 appSecret')} autoComplete="new-password" className={field} />
        </label>
        <label className="block"><span className={label}>{t('网关地址')}</span>
          <Input disabled={working || loading} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openapi.chanjet.com" className={field} />
        </label>
        <p className="text-[11px] leading-5 text-slate-400">{t('appSecret 仅在保存时传输一次，后端加密存储、任何接口不回显。')}</p>
      </div>

      {/* 授权区：凭据已配置即展示——更换 appKey/appSecret 后旧 token 会失效，须能随时重新授权 */}
      {config?.configured && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <div className="mb-1 text-xs font-semibold text-amber-800">{t(config.authorized ? '重新授权（更换 appKey/appSecret 后旧 token 会失效）' : '完成开放平台授权（一次性）')}</div>
          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-5 text-amber-700">
            <li>{t('在开放平台「应用管理」里把 OAuth 回调地址配置为：')}<code className="mx-1 select-all break-all rounded bg-white px-1 py-0.5 text-xs text-slate-700">{config.redirectUri ?? defaultRedirectUri}</code></li>
            <li>{t('从开放平台后台对该应用发起授权（用 T+ 管理员账号），授权完成会自动跳回本页并写入 token；')}</li>
            <li>{t('若跳转失败但你拿到了授权码 code（10 分钟内有效），粘贴到下面手动换取：')}</li>
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input aria-label={t("授权码")} disabled={working || loading} value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder={t('粘贴授权码 code')} className="h-9 min-w-0 flex-1 basis-48 rounded-lg border border-amber-200 bg-white px-2 text-sm outline-none focus:border-amber-400" />
            <button
              type="button"
              disabled={working || loading || !authCode.trim()}
              onClick={() => {
                setActionError("");
                setBusy(true);
                void exchangeTplusAuthCode(authCode.trim())
                  .then((next) => { setConfig(next); setAuthCode(""); toast.success(t('授权完成，token 已写入')); })
                  .catch((err) => setActionError(err instanceof Error ? err.message : t('换取失败')))
                  .finally(() => setBusy(false));
              }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >{t('换取 Token')}</button>
          </div>
        </div>
      )}

      {/* 手动同步 */}
      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
        <div className="mb-2 text-xs font-semibold text-slate-600">{t('手动同步（T+ 为唯一事实源，只拉不推）')}</div>
        {!config.authorized && <p className="mb-2 text-pretty text-xs text-slate-500">{t("请先完成授权，再同步数据。")}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={working || loading || !config.authorized} onClick={() => void syncMaterials()} title={t('全量拉取 T+ 存货档案，包含零库存物料')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary-soft-border)] bg-accent px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60">
            {syncing === "materials" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t('物料主档')}
          </button>
          {([["suppliers", "供应商"], ["inventory", "库存现存量"], ["purchase-orders", "采购单到货"]] as const).map(([kind, lbl]) => (
            <button key={kind} type="button" disabled={working || loading || !config.authorized} onClick={() => void sync(kind, lbl)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {syncing === kind && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t(lbl)}
            </button>
          ))}
          <button type="button" disabled={working || loading || !config.authorized} onClick={() => void syncFull()} title={t('近 90 天采购订单全量镜像，供任务匹配')} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary-soft-border)] bg-accent px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60">
            {syncing === "purchase-orders-full" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t('采购单全量')}
          </button>
          <button type="button" disabled={working || loading || !config.authorized} onClick={() => void syncAll()} title={t('物料主档→供应商→库存→采购单全量→匹配，与每日自动同步同一条链路')} className="material-button-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
            {syncing === "auto" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t('立即全同步')}
          </button>
        </div>
        {syncing && syncProgress && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />{syncProgress}
          </div>
        )}
        <p className={cn("mt-2 truncate text-[11px] tabular-nums", config?.lastMaterialSyncSucceeded === false ? "text-rose-500" : "text-slate-400")} title={lastMaterialSyncText}>
          {lastMaterialSyncText}
        </p>
        {config && (
          <div className="mt-2 grid min-w-0 grid-cols-1 items-start gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            <label className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-pretty">
              <Checkbox disabled={working || loading} checked={config.autoSync} onCheckedChange={(v) => void toggleAutoSync(v === true)} className="size-3.5" />
              {t('每日 3:00（北京时间）自动同步')}
            </label>
            <span className="block min-w-0 break-words text-pretty text-slate-500 tabular-nums" title={lastAutoSyncText}>
              {lastAutoSyncText}
            </span>
          </div>
        )}
      </div>

      {/* 单据匹配（与驾驶舱「单据匹配」弹窗共用面板） */}
      <PoMatchPanel />
      </>}
    </Shell>
  );
}

// ── T+ 单据匹配（共用面板 + 驾驶舱弹窗） ──────────────────────────────────────

/** 单据匹配面板：自加载镜像清单，运行匹配 → 建议列表 → 确认/忽略。 */
export function PoMatchPanel() {
  const { t } = useI18n();
  const [poMirror, setPoMirror] = useState<PoMirrorList | null>(null);
  const [matchBusy, setMatchBusy] = useState<string | null>(null);

  useEffect(() => {
    listPoMirror().then(setPoMirror).catch(() => setPoMirror(null));
  }, []);

  const doMatch = async () => {
    setMatchBusy("run");
    try {
      // 异步任务：AI 名称匹配单次调用可能超网关时限
      const { jobId } = await runPoMatch();
      const r = await waitApplyJob<PoMatchResult>(jobId, undefined, getTplusSyncJob);
      toast.success(t('匹配完成：规则建议 {a} 条，AI 建议 {b} 条，未匹配 {c} 条', { a: r.suggested, b: r.aiSuggested, c: r.unmatched }));
      setPoMirror(await listPoMirror());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('匹配失败'));
    } finally {
      setMatchBusy(null);
    }
  };

  const decide = async (id: string, action: "confirm" | "ignore") => {
    setMatchBusy(id);
    try {
      const next = action === "confirm" ? await confirmPoMatch(id) : await ignorePoMatch(id);
      setPoMirror(next);
      if (action === "confirm") await refreshProcurement();
      toast.success(t(action === "confirm" ? '已关联到任务，任务转入在途' : '已忽略'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('操作失败'));
    } finally {
      setMatchBusy(null);
    }
  };

  if (!poMirror || (poMirror.rows.length === 0 && Object.keys(poMirror.counts).length === 0)) {
    return (
      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-center text-[11px] text-slate-400">
        {t('暂无 T+ 单据镜像；先在「T+ 集成」里做「采购单全量」同步。')}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-600">
          {t('单据匹配')}
          <span className="ml-2 font-normal text-slate-400">
            {t('建议 {s} · 未匹配 {u} · 已确认 {c}', { s: poMirror.counts.suggested ?? 0, u: poMirror.counts.unmatched ?? 0, c: poMirror.counts.confirmed ?? 0 })}
          </span>
        </div>
        <button type="button" disabled={matchBusy !== null} onClick={() => void doMatch()} className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary-soft-border)] bg-white px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent disabled:opacity-60">
          {matchBusy === "run" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{t('运行匹配')}
        </button>
      </div>
      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {poMirror.rows.filter((r) => r.matchStatus === "suggested").map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate text-slate-700">
                {r.tpOrderNo}{r.tpLineNo ? `#${r.tpLineNo}` : ''} <AutoTranslatedText as="span" text={r.inventoryName || r.inventoryCode} /> × {r.orderedQty.toLocaleString()}
              </div>
              <div className="truncate text-[10px] text-slate-400">
                → {r.task ? <>{r.task.code} <AutoTranslatedText as="span" text={r.task.materialName} /></> : t('无目标任务')}
                {r.matchConfidence != null && ` · ${Math.round(r.matchConfidence * 100)}%`}
                {r.matchReason && ` · ${r.matchReason}`}
              </div>
            </div>
            <button type="button" disabled={matchBusy !== null} onClick={() => void decide(r.id, "confirm")} className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
              {matchBusy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('确认')}
            </button>
            <button type="button" disabled={matchBusy !== null} onClick={() => void decide(r.id, "ignore")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-60">{t('忽略')}</button>
          </div>
        ))}
        {poMirror.rows.filter((r) => r.matchStatus === "suggested").length === 0 && (
          <div className="py-3 text-center text-[11px] text-slate-400">{t('暂无待确认建议；先「采购单全量」同步，再「运行匹配」。')}</div>
        )}
      </div>
    </div>
  );
}

/** 驾驶舱入口：采购员确认 T+ 单据匹配建议，不必进 T+ 集成弹窗。 */
export function PoMatchModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Shell title={t("T+ 单据匹配")} onClose={onClose} wide footer={<button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('关闭')}</button>}>
      <p className="mb-1 text-xs text-slate-400">{t('确认建议即把 T+ 采购单关联到任务，任务自动转入在途、到货随同步回推。')}</p>
      <PoMatchPanel />
    </Shell>
  );
}
