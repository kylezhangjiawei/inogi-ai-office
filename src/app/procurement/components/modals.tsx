// 采购模块弹窗/面板：新建需求 / 批量导入 / 分类管理 / 批量转派 / 任务编辑 / 物料表单。均走真实接口。
// AiCreateModal 暂无入口（产品决定隐藏 AI 建单按钮），实现保留以便恢复；物料审核在 MaterialDetailDrawer 里做。
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../components/ui/utils";
import { refreshProcurement, useProcurementData, useProductLines } from "../data";
import {
  aiParseProcTask,
  batchReassignProcTasks,
  createProcTask,
  exchangeTplusAuthCode,
  getTplusConfig,
  getTplusStatus,
  importProcMaterials,
  renameProcCategory,
  saveTplusConfig,
  triggerTplusSync,
  updateProcTask,
  upsertProcMaterial,
  type AiTaskDraft,
  type BusinessLine,
  type Material,
  type MaterialImportItem,
  type PaymentStatus,
  type ProcMethod,
  type ProcurementTask,
  type TplusConfigState,
  type UpdateProcTaskInput,
} from "../../lib/procurementApi";
import { BuyerSuggestDatalist, useBuyerDirectory } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";

function Shell({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cn("w-full overflow-hidden rounded-2xl bg-white shadow-2xl", wide ? "max-w-2xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">{t(title)}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── 建单表单（新建需求与 AI 建单确认步共用）──────────────────────────────────

interface DraftState {
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

const EMPTY_DRAFT: DraftState = {
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
function DraftFields({ draft, setDraft, more, setMore }: {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  more: boolean;
  setMore: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300";
  const label = "text-xs font-medium text-slate-500";
  const set = <K extends keyof DraftState>(key: K) => (value: DraftState[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>{t('物料名称')}<span className="ml-0.5 text-rose-500">*</span></span>
          <input value={draft.materialName} onChange={(e) => set('materialName')(e.target.value)} placeholder={t('如 减震垫 DZC-950')} className={field} />
        </label>
        <label className="block">
          <span className={label}>{t('数量')}<span className="ml-0.5 text-rose-500">*</span></span>
          <input value={draft.quantity} onChange={(e) => set('quantity')(e.target.value)} inputMode="decimal" placeholder={t('如 2000')} className={field} />
        </label>
        <label className="block">
          <span className={label}>{t('需求日期')}<span className="ml-0.5 text-rose-500">*</span></span>
          <input type="date" value={draft.needDate} onChange={(e) => set('needDate')(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className={label}>{t('业务线')}</span>
          <select value={draft.businessLine} onChange={(e) => set('businessLine')(e.target.value as BusinessLine)} className={field}>
            <option value="production">{t('生产')}</option>
            <option value="rd">{t('研发')}</option>
          </select>
        </label>
      </div>
      <button type="button" onClick={() => setMore(!more)} className="mt-3 text-xs font-medium text-indigo-600">{t(more ? "收起更多字段 ▲" : "展开更多字段 ▼")}</button>
      {more && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="block"><span className={label}>{t('规格')}</span><input value={draft.spec} onChange={(e) => set('spec')(e.target.value)} className={field} /></label>
          <label className="block"><span className={label}>{t('单位')}</span><input value={draft.unit} onChange={(e) => set('unit')(e.target.value)} placeholder={t('如 件')} className={field} /></label>
          <label className="block"><span className={label}>Deadline</span><input type="date" value={draft.deadline} onChange={(e) => set('deadline')(e.target.value)} className={field} /></label>
          <label className="block">
            <span className={label}>{t('采购方式')}</span>
            <select value={draft.method} onChange={(e) => set('method')(e.target.value as ProcMethod)} className={field}>
              <option value="inquiry">{t('询价采购')}</option>
              <option value="direct">{t('电商直购')}</option>
            </select>
          </label>
          {draft.method === "direct" && (
            <label className="col-span-2 block"><span className={label}>{t('商品链接（直购）')}</span><input value={draft.purchaseLink} onChange={(e) => set('purchaseLink')(e.target.value)} placeholder="https://" className={field} /></label>
          )}
          <label className="block">
            <span className={label}>{t('优先级')}</span>
            <select value={draft.priority} onChange={(e) => set('priority')(e.target.value as DraftState["priority"])} className={field}>
              <option value="high">{t('高')}</option>
              <option value="medium">{t('中')}</option>
              <option value="low">{t('低')}</option>
            </select>
          </label>
          <label className="block"><span className={label}>{t('采购负责人')}</span><input value={draft.buyer} onChange={(e) => set('buyer')(e.target.value)} list="proc-buyer-list" className={field} /><BuyerSuggestDatalist /></label>
          <label className="col-span-2 mt-1 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={draft.needSample} onChange={(e) => set('needSample')(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
            {t('需要样品（选定报价后先到样测试）')}
          </label>
        </div>
      )}
    </>
  );
}

/** 校验 + 提交建单。成功返回 true（调用方负责关弹窗）。 */
async function submitDraft(
  draft: DraftState,
  t: (s: string) => string,
  resolveUserId?: (name: string) => string | undefined,
): Promise<boolean> {
  const quantity = Number(draft.quantity);
  if (!draft.materialName.trim()) { toast.error(t('请填写物料名称')); return false; }
  if (!Number.isFinite(quantity) || quantity <= 0) { toast.error(t('请填写有效数量')); return false; }
  if (!draft.needDate) { toast.error(t('请选择需求日期')); return false; }
  try {
    const task = await createProcTask({
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
    toast.error(err instanceof Error ? err.message : t('创建失败'));
    return false;
  }
}

/** AI 建单：粘贴文字/商品链接 → AI 解析草稿 → 表单确认后落库。 */
export function AiCreateModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [busy, setBusy] = useState(false);
  const [usedAI, setUsedAI] = useState(true);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [more, setMore] = useState(true);
  const { resolveUserId } = useBuyerDirectory();

  const parse = async () => {
    if (!text.trim()) { toast.error(t('请先粘贴需求文字或商品链接')); return; }
    setBusy(true);
    try {
      const result = await aiParseProcTask(text.trim());
      setDraft(draftFromAi(result.draft));
      setUsedAI(result.usedAI);
      setStep("confirm");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('解析失败'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    const ok = await submitDraft(draft, t, resolveUserId);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Shell
      title={t("AI 建单")}
      onClose={onClose}
      footer={step === "input" ? (
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button>
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
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" />{t('粘贴文字或商品链接，AI 将解析生成采购任务（物料、规格、数量、方式等）。')}</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={t('例：采购 减震垫 DZC-950 橡胶 50×20mm 2000 件，7 月中旬前到货；或粘贴电商商品链接…')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300" />
        </>
      ) : (
        <>
          <div className={cn("mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs", usedAI ? "border-indigo-100 bg-indigo-50/60 text-indigo-700" : "border-amber-100 bg-amber-50/60 text-amber-700")}>
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            {t(usedAI ? 'AI 已解析出以下草稿，请核对并补全后创建。' : 'AI 暂不可用，已按规则粗解析，请人工核对后创建。')}
          </div>
          <DraftFields draft={draft} setDraft={setDraft} more={more} setMore={setMore} />
        </>
      )}
    </Shell>
  );
}

/** 新建需求：3 必填 + 折叠更多，提交落库。 */
export function NewRequirementModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const { resolveUserId } = useBuyerDirectory();

  const submit = async () => {
    setBusy(true);
    const ok = await submitDraft(draft, t, resolveUserId);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Shell
      title={t("新建采购需求")}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('提交')}
        </button>
      </>}
    >
      <DraftFields draft={draft} setDraft={setDraft} more={more} setMore={setMore} />
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
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const parsed = await parseImportFile(file);
      setItems(parsed.items);
      setSkipped(parsed.skipped);
      setFileName(file.name);
      if (parsed.items.length === 0) toast.error(t('未解析到有效数据行（需包含「物料名称」列）'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('文件解析失败'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (items.length === 0) { toast.error(t('请先选择并解析 Excel 文件')); return; }
    setBusy(true);
    try {
      const result = await importProcMaterials(items);
      await refreshProcurement();
      toast.success(t('导入完成：新增 {created} 条（待审核），更新 {updated} 条', { created: result.created, updated: result.updated }));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('导入失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t("批量导入物料")}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button>
        <button type="button" disabled={busy || items.length === 0} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{items.length > 0 ? t('确认导入 {count} 条', { count: items.length }) : t('确认导入')}
        </button>
      </>}
    >
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center hover:border-indigo-300">
        <Upload className="h-8 w-8 text-indigo-400" />
        <span className="text-sm font-medium text-slate-600">{fileName || t('点击选择 Excel 文件')}</span>
        <span className="text-[11px] text-slate-400">{t('支持 .xlsx，按下方模板字段解析')}</span>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
      </label>
      {items.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-700">
          {t('已解析 {count} 条有效物料', { count: items.length })}
          {skipped > 0 && <span className="text-amber-600">，{t('跳过 {count} 条缺少物料名称的行', { count: skipped })}</span>}
          <div className="mt-1 text-slate-500">
            {items.slice(0, 3).map((m, i) => <div key={i}>· {m.name}{m.spec ? ` · ${m.spec}` : ""}{m.category ? ` · ${m.category}` : ""}</div>)}
            {items.length > 3 && <div>…</div>}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-[11px] leading-5 text-slate-500">{t('模板列：物料名称（必填）/ 规格 / 单位 / 分类 / 产品线 / ERP编码 / T+存货编码 / 是否特殊物料 / 是否耗材 / 安全库存 / 备注。新增物料将进入审核队列，按名称+规格或 T+ 编码去重（已存在则更新）。')}</p>
        <button type="button" onClick={() => void downloadImportTemplate()} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"><FileDown className="h-3.5 w-3.5" />{t('下载模板')}</button>
      </div>
    </Shell>
  );
}

/** 分类管理：分类无独立表，这里支持重命名（目标已存在即合并到该分类）。 */
export function CategoryManageModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { materials } = useProcurementData();
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const mat of materials) m.set(mat.category, (m.get(mat.category) ?? 0) + 1);
    return m;
  }, [materials]);

  const rename = async (from: string) => {
    const to = newName.trim();
    if (!to) { toast.error(t('请填写新分类名')); return; }
    if (to === from) { setEditing(null); return; }
    const merging = byCat.has(to);
    if (merging && !window.confirm(t('分类「{to}」已存在，将把「{from}」下的物料并入其中，是否继续？', { to, from }))) return;
    setBusy(true);
    try {
      const result = await renameProcCategory(from, to);
      await refreshProcurement();
      toast.success(t(merging ? '已合并 {count} 个物料到「{to}」' : '已重命名，{count} 个物料随之更新', { count: result.updated, to }));
      setEditing(null);
      setNewName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('操作失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={t("分类管理")} onClose={onClose} footer={<button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('关闭')}</button>}>
      <p className="mb-3 text-xs text-slate-400">{t('分类由物料主数据聚合而来；重命名会同步更新该分类下所有物料，改成已有分类名即为合并。')}</p>
      <div className="space-y-2">
        {Array.from(byCat.entries()).map(([c, n]) => (
          <div key={c} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
            {editing === c ? (
              <>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void rename(c); if (e.key === "Escape") setEditing(null); }} placeholder={c} className="h-8 flex-1 rounded-lg border border-indigo-200 px-2 text-sm outline-none focus:border-indigo-400" />
                <button type="button" disabled={busy} onClick={() => void rename(c)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? t('处理中…') : t('保存')}</button>
                <button type="button" disabled={busy} onClick={() => { setEditing(null); setNewName(""); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">{t('取消')}</button>
              </>
            ) : (
              <>
                <AutoTranslatedText className="text-slate-700" text={c} />
                <span className="ml-auto text-xs text-slate-400">{t('{count} 物料', { count: n })}</span>
                <button type="button" onClick={() => { setEditing(c); setNewName(c); }} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{t('重命名')}</button>
              </>
            )}
          </div>
        ))}
        {byCat.size === 0 && <div className="py-8 text-center text-sm text-slate-400">{t('暂无分类')}</div>}
      </div>
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
  const { resolveUserId } = useBuyerDirectory();

  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return tasks
      .filter((task) => !TERMINAL_STATUSES.includes(task.status))
      .filter((task) => !kw || `${task.code} ${task.materialName} ${task.buyer}`.toLowerCase().includes(kw));
  }, [tasks, keyword]);

  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = candidates.length > 0 && candidates.every((task) => selected.has(task.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(candidates.map((task) => task.id)));

  const submit = async () => {
    const name = buyer.trim();
    if (!name) { toast.error(t('请填写新采购负责人')); return; }
    if (selected.size === 0) { toast.error(t('请至少勾选一个任务')); return; }
    setBusy(true);
    try {
      // 后端事务原子执行：任一任务已完结/不存在则整批回滚，不会转一半
      const result = await batchReassignProcTasks(Array.from(selected), name, resolveUserId(name));
      await refreshProcurement();
      toast.success(t('已转派 {count} 个任务给 {name}', { count: result.updated, name }));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('转派失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t("批量转派")}
      onClose={onClose}
      wide
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{selected.size > 0 ? t('转派 {count} 个任务', { count: selected.size }) : t('转派')}
        </button>
      </>}
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">{t('新采购负责人')}<span className="ml-0.5 text-rose-500">*</span></span>
          <input value={buyer} onChange={(e) => setBuyer(e.target.value)} list="proc-buyer-list" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
          <BuyerSuggestDatalist />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-500">{t('筛选任务')}</span>
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t('搜索单号 / 物料 / 当前负责人')} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
        </label>
      </div>
      <label className="mb-1 flex items-center gap-2 px-1 py-1 text-xs text-slate-500">
        <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
        {t('全选（{count} 个进行中任务）', { count: candidates.length })}
      </label>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((task) => (
          <label key={task.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", selected.has(task.id) ? "border-indigo-200 bg-indigo-50/50" : "border-slate-100 hover:bg-slate-50")}>
            <input type="checkbox" checked={selected.has(task.id)} onChange={() => toggle(task.id)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
            <span className="shrink-0 text-xs tabular-nums text-slate-400">{task.code}</span>
            <AutoTranslatedText className="min-w-0 flex-1 truncate text-slate-700" text={task.materialName} />
            <span className="shrink-0 text-xs text-slate-400">{t('当前')}：{task.buyer || t('未指派')}</span>
          </label>
        ))}
        {candidates.length === 0 && <div className="py-8 text-center text-sm text-slate-400">{t('没有可转派的进行中任务')}</div>}
      </div>
    </Shell>
  );
}

// ── 任务编辑 ──────────────────────────────────────────────────────────────────

const ORDER_STAGE = ["priced", "pending_purchase", "in_transit", "partial_arrival", "completed"];

/** 任务信息编辑：数量/优先级/日期 + 下单阶段的付款登记。只提交有变化的字段。 */
export function EditTaskModal({ task, onClose }: { task: ProcurementTask; onClose: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
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
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const orderStage = ORDER_STAGE.includes(task.status);
  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300";
  const label = "text-xs font-medium text-slate-500";

  const submit = async () => {
    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) { toast.error(t('请填写有效数量')); return; }
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
    if (Object.keys(input).length === 0) { toast.info(t('没有修改任何内容')); return; }
    setBusy(true);
    try {
      await updateProcTask(task.id, input);
      await refreshProcurement();
      toast.success(t('任务信息已更新'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('更新失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t("编辑任务信息")}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('保存')}
        </button>
      </>}
    >
      <p className="mb-3 text-xs text-slate-400">{task.code} · <AutoTranslatedText as="span" text={task.materialName} />（{t('状态流转请用任务卡上的下一步操作，此处只改任务信息')}）</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>{t('数量')}</span><input value={form.quantity} onChange={(e) => set('quantity')(e.target.value)} inputMode="decimal" className={field} /></label>
        <label className="block">
          <span className={label}>{t('优先级')}</span>
          <select value={form.priority} onChange={(e) => set('priority')(e.target.value as typeof form.priority)} className={field}>
            <option value="high">{t('高')}</option>
            <option value="medium">{t('中')}</option>
            <option value="low">{t('低')}</option>
          </select>
        </label>
        <label className="block"><span className={label}>{t('需求日期')}</span><input type="date" value={form.needDate} onChange={(e) => set('needDate')(e.target.value)} className={field} /></label>
        <label className="block"><span className={label}>Deadline</span><input type="date" value={form.deadline} onChange={(e) => set('deadline')(e.target.value)} className={field} /></label>
        {task.method === "direct" && (
          <label className="col-span-2 block"><span className={label}>{t('商品链接')}</span><input value={form.purchaseLink} onChange={(e) => set('purchaseLink')(e.target.value)} className={field} /></label>
        )}
        <label className="col-span-2 block"><span className={label}>{t('低值易耗品备注')}</span><input value={form.consumableNote} onChange={(e) => set('consumableNote')(e.target.value)} className={field} /></label>
      </div>
      {orderStage && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-600">{t('下单与付款')}</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={label}>{t('预计到货')}</span><input type="date" value={form.expectedArrivalDate} onChange={(e) => set('expectedArrivalDate')(e.target.value)} className={field} /></label>
            <label className="block">
              <span className={label}>{t('付款状态')}</span>
              <select value={form.paymentStatus} onChange={(e) => set('paymentStatus')(e.target.value as PaymentStatus)} className={field}>
                <option value="unpaid">{t('未付款')}</option>
                <option value="partial">{t('部分付款')}</option>
                <option value="paid">{t('已付款')}</option>
              </select>
            </label>
            <label className="block"><span className={label}>{t('付款日期')}</span><input type="date" value={form.paymentDate} onChange={(e) => set('paymentDate')(e.target.value)} className={field} /></label>
            <label className="block"><span className={label}>{t('付款备注')}</span><input value={form.paymentNote} onChange={(e) => set('paymentNote')(e.target.value)} placeholder={t('如：首付 30% 已付')} className={field} /></label>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── 物料新增/编辑 ─────────────────────────────────────────────────────────────

/** 物料主数据表单：传 material 为编辑（后端 PUT 全量覆盖，务必带全字段），不传为新建。 */
export function MaterialFormModal({ material, onClose }: { material?: Material; onClose: () => void }) {
  const { t } = useI18n();
  const { materials } = useProcurementData();
  const productLines = useProductLines();
  const [busy, setBusy] = useState(false);
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
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const categories = useMemo(() => Array.from(new Set(materials.map((m) => m.category).filter(Boolean))), [materials]);
  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300";
  const label = "text-xs font-medium text-slate-500";

  const submit = async () => {
    if (!form.name.trim()) { toast.error(t('请填写物料名称')); return; }
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
      }, material?.id);
      await refreshProcurement();
      toast.success(t(material ? '物料已更新' : '物料已创建，进入审核队列'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('保存失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={t(material ? "编辑物料" : "新增物料")}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('保存')}
        </button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={label}>{t('物料名称')}<span className="ml-0.5 text-rose-500">*</span></span><input value={form.name} onChange={(e) => set('name')(e.target.value)} className={field} /></label>
        <label className="block"><span className={label}>{t('规格')}</span><input value={form.spec} onChange={(e) => set('spec')(e.target.value)} className={field} /></label>
        <label className="block"><span className={label}>{t('单位')}</span><input value={form.unit} onChange={(e) => set('unit')(e.target.value)} placeholder={t('如 件')} className={field} /></label>
        <label className="block">
          <span className={label}>{t('分类')}</span>
          <input value={form.category} onChange={(e) => set('category')(e.target.value)} list="proc-cat-list" placeholder={t('输入或从已有分类中选')} className={field} />
          <datalist id="proc-cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="block">
          <span className={label}>{t('产品线')}</span>
          <input value={form.productLine} onChange={(e) => set('productLine')(e.target.value)} list="proc-line-list" placeholder={t('如 R1 / R2 / 通用')} className={field} />
          <datalist id="proc-line-list">{productLines.map((pl) => <option key={pl} value={pl} />)}</datalist>
        </label>
        <label className="block"><span className={label}>{t('ERP 编码')}</span><input value={form.erpCode} onChange={(e) => set('erpCode')(e.target.value)} className={field} /></label>
        <label className="block"><span className={label}>{t('T+ 存货编码')}</span><input value={form.tpInventoryCode} onChange={(e) => set('tpInventoryCode')(e.target.value)} className={field} /></label>
        <label className="block"><span className={label}>{t('安全库存')}</span><input value={form.safeStock} onChange={(e) => set('safeStock')(e.target.value)} inputMode="decimal" placeholder="0" className={field} /></label>
        <label className="col-span-2 block"><span className={label}>{t('备注')}</span><input value={form.remark} onChange={(e) => set('remark')(e.target.value)} className={field} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.isSpecial} onChange={(e) => set('isSpecial')(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />{t('特殊物料')}</label>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.isConsumable} onChange={(e) => set('isConsumable')(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />{t('低值易耗品')}</label>
      </div>
    </Shell>
  );
}

// ── 畅捷通 T+ 集成 ────────────────────────────────────────────────────────────

/**
 * T+ 集成弹窗：凭据录入（appSecret 由管理员现场填写，后端落库加密、不回显）
 * + 同步状态与三个手动同步触发。授权（openToken）流程接入前，同步会返回待授权提示。
 */
export function TplusConfigModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<TplusConfigState | null>(null);
  const [mirrored, setMirrored] = useState<{ suppliers: number; balances: number; purchaseOrderRefs: number } | null>(null);
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  // 回调地址随凭据保存进后端，须与开放平台应用配置一致
  const defaultRedirectUri = `${window.location.origin}/api/procurement/tplus/oauth/callback`;

  const reload = async () => {
    try {
      const [cfg, status] = await Promise.all([getTplusConfig(), getTplusStatus()]);
      setConfig(cfg);
      setMirrored(status.mirrored);
      setBaseUrl(cfg.baseUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('加载配置失败'));
    }
  };
  useEffect(() => { void reload(); }, []);

  const save = async () => {
    if (!appKey.trim()) { toast.error(t('请填写 appKey')); return; }
    if (!config?.hasSecret && !appSecret.trim()) { toast.error(t('首次配置需填写 appSecret')); return; }
    setBusy(true);
    try {
      const next = await saveTplusConfig({
        appKey: appKey.trim(),
        appSecret: appSecret.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        redirectUri: config?.redirectUri ?? defaultRedirectUri,
      });
      setConfig(next);
      setAppSecret("");
      toast.success(t('T+ 凭据已保存（appSecret 已加密存储）'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const sync = async (kind: "suppliers" | "inventory" | "purchase-orders", label: string) => {
    setSyncing(kind);
    try {
      const result = await triggerTplusSync(kind);
      await refreshProcurement();
      toast.success(`${t(label)}${t('同步完成')}：${Object.entries(result).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('同步失败'));
    } finally {
      setSyncing(null);
    }
  };

  const field = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300";
  const label = "text-xs font-medium text-slate-500";

  return (
    <Shell
      title={t("畅捷通 T+ 集成")}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('关闭')}</button>
        <button type="button" disabled={busy} onClick={() => void save()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('保存凭据')}
        </button>
      </>}
    >
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
          <span className="text-slate-400">{t('已镜像')}：{t('供应商')} {mirrored.suppliers} · {t('库存')} {mirrored.balances} · {t('采购单')} {mirrored.purchaseOrderRefs}</span>
        )}
      </div>

      {/* 凭据表单：appSecret 不回显，留空表示保留已存值 */}
      <div className="space-y-3">
        <label className="block"><span className={label}>appKey<span className="ml-0.5 text-rose-500">*</span></span>
          <input value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder={config?.appKeyMasked ? t('已配置（{masked}），重新填写将覆盖', { masked: config.appKeyMasked }) : t('开放平台应用的 appKey')} className={field} />
        </label>
        <label className="block"><span className={label}>appSecret{!config?.hasSecret && <span className="ml-0.5 text-rose-500">*</span>}</span>
          <input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={config?.hasSecret ? t('已加密存储，留空保持不变') : t('开放平台应用的 appSecret')} autoComplete="new-password" className={field} />
        </label>
        <label className="block"><span className={label}>{t('网关地址')}</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openapi.chanjet.com" className={field} />
        </label>
        <p className="text-[11px] leading-5 text-slate-400">{t('appSecret 仅在保存时传输一次，后端加密存储、任何接口不回显。')}</p>
      </div>

      {/* 授权区：凭据已配置但未授权时引导完成 OAuth；已授权则不展示 */}
      {config?.configured && !config.authorized && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <div className="mb-1 text-xs font-semibold text-amber-800">{t('完成开放平台授权（一次性）')}</div>
          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-5 text-amber-700">
            <li>{t('在开放平台「应用管理」里把 OAuth 回调地址配置为：')}<code className="mx-1 select-all rounded bg-white px-1 py-0.5 text-[10px] text-slate-700">{config.redirectUri ?? defaultRedirectUri}</code></li>
            <li>{t('从开放平台后台对该应用发起授权（用 T+ 管理员账号），授权完成会自动跳回本页并写入 token；')}</li>
            <li>{t('若跳转失败但你拿到了授权码 code（10 分钟内有效），粘贴到下面手动换取：')}</li>
          </ol>
          <div className="mt-2 flex items-center gap-2">
            <input value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder={t('粘贴授权码 code')} className="h-8 flex-1 rounded-lg border border-amber-200 bg-white px-2 text-sm outline-none focus:border-amber-400" />
            <button
              type="button"
              disabled={busy || !authCode.trim()}
              onClick={() => {
                setBusy(true);
                void exchangeTplusAuthCode(authCode.trim())
                  .then((next) => { setConfig(next); setAuthCode(""); toast.success(t('授权完成，token 已写入')); })
                  .catch((err) => toast.error(err instanceof Error ? err.message : t('换取失败')))
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
        <div className="flex flex-wrap gap-2">
          {([["suppliers", "供应商"], ["inventory", "库存现存量"], ["purchase-orders", "采购单到货"]] as const).map(([kind, lbl]) => (
            <button key={kind} type="button" disabled={syncing !== null} onClick={() => void sync(kind, lbl)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {syncing === kind && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t(lbl)}
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}
