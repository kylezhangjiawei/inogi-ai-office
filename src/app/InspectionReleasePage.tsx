import React, { useState } from "react";
import {
  Archive,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  Plus,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";

type InspectionType = "IQC" | "IPQC" | "FQC";
type InspectionResult = "合格" | "不合格";
type ReleaseStatus = "待放行" | "已放行" | "已拒绝";
type NCRDisposition = "返工" | "报废" | "让步接收";

interface InspectionItem {
  name: string;
  standard: string;
  min: number;
  max: number;
  actual: string;
  result: "合格" | "不合格" | "—";
}

interface InspectionRecord {
  id: string;
  batch: string;
  type: InspectionType;
  date: string;
  inspector: string;
  supplier?: string;
  result: InspectionResult;
  releaseStatus: ReleaseStatus;
  items: InspectionItem[];
  ncr?: NCRDisposition;
}

const mockRecords: InspectionRecord[] = [
  {
    id: "IQC-2026-041",
    batch: "OC10-240416",
    type: "IQC",
    date: "2026-04-16",
    inspector: "刘婧",
    supplier: "华润元器件",
    result: "合格",
    releaseStatus: "待放行",
    items: [
      { name: "外观检验", standard: "无破损/划痕", min: 0, max: 0, actual: "合格", result: "合格" },
      { name: "尺寸测量", standard: "50±0.5mm", min: 49.5, max: 50.5, actual: "50.1", result: "合格" },
      { name: "绝缘电阻", standard: "≥100MΩ", min: 100, max: 9999, actual: "320", result: "合格" },
    ],
  },
  {
    id: "IQC-2026-040",
    batch: "OC5-240414",
    type: "IPQC",
    date: "2026-04-14",
    inspector: "周远",
    result: "合格",
    releaseStatus: "已放行",
    items: [
      { name: "压力测试", standard: "4.0±0.2cmH₂O", min: 3.8, max: 4.2, actual: "4.1", result: "合格" },
      { name: "噪音检测", standard: "≤30dB(A)", min: 0, max: 30, actual: "27", result: "合格" },
    ],
  },
  {
    id: "IQC-2026-039",
    batch: "OC3-240412",
    type: "FQC",
    date: "2026-04-12",
    inspector: "韩青",
    result: "不合格",
    releaseStatus: "已拒绝",
    ncr: "返工",
    items: [
      { name: "外观检验", standard: "无破损/划痕", min: 0, max: 0, actual: "3处划痕", result: "不合格" },
      { name: "功能测试", standard: "全功能正常", min: 0, max: 0, actual: "合格", result: "合格" },
    ],
  },
];

const typeColors: Record<InspectionType, string> = {
  IQC: "bg-accent text-primary",
  IPQC: "bg-slate-100 text-slate-700",
  FQC: "bg-sky-50 text-sky-700",
};

const releaseColors: Record<ReleaseStatus, string> = {
  "待放行": "bg-amber-50 text-amber-700",
  "已放行": "bg-green-50 text-green-600",
  "已拒绝": "bg-red-50 text-red-600",
};

// New IQC form state
interface NewFormItem {
  name: string;
  standard: string;
  actual: string;
  result: "合格" | "不合格" | "";
}

const defaultItems: NewFormItem[] = [
  { name: "外观检验", standard: "无破损/划痕", actual: "", result: "" },
  { name: "尺寸测量", standard: "标准范围内", actual: "", result: "" },
  { name: "功能测试", standard: "全功能正常", actual: "", result: "" },
];

export function InspectionReleasePage() {
  const [records, setRecords] = useState<InspectionRecord[]>(mockRecords);
  const [selectedId, setSelectedId] = useState(mockRecords[0].id);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({
    batch: "", type: "IQC" as InspectionType, date: new Date().toISOString().split("T")[0],
    inspector: "", supplier: "",
  });
  const [newItems, setNewItems] = useState<NewFormItem[]>(defaultItems);
  const [rejectionReason, setRejectionReason] = useState("");
  const [formAttempted, setFormAttempted] = useState(false);
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [rejectAttempted, setRejectAttempted] = useState(false);

  const selected = records.find((r) => r.id === selectedId)!;

  const handleSubmitNew = () => {
    setFormAttempted(true);
    if (!newForm.batch.trim() || !newForm.inspector.trim() || newItems.some((item) => !item.actual.trim() || !item.result)) return;
    const computedItems = newItems.map((item) => ({
      ...item,
      min: 0, max: 0,
      result: item.result as "合格" | "不合格",
    }));
    const overallResult: InspectionResult = computedItems.some((i) => i.result === "不合格") ? "不合格" : "合格";
    const id = `IQC-2026-${String(records.length + 40).padStart(3, "0")}`;
    const newRecord: InspectionRecord = {
      id, batch: newForm.batch, type: newForm.type, date: newForm.date,
      inspector: newForm.inspector, supplier: newForm.supplier || undefined,
      result: overallResult, releaseStatus: "待放行",
      items: computedItems,
    };
    setRecords((prev) => [newRecord, ...prev]);
    setSelectedId(id);
    setShowNewForm(false);
    setNewForm({ batch: "", type: "IQC", date: new Date().toISOString().split("T")[0], inspector: "", supplier: "" });
    setNewItems(defaultItems);
    setFormAttempted(false);
    toast.success(`检验记录 ${id} 已提交`);
  };

  const handleRelease = () => {
    setRecords((prev) => prev.map((r) => r.id === selectedId ? { ...r, releaseStatus: "已放行" } : r));
    setReleaseConfirmOpen(false);
    toast.success("批次已批准放行");
  };

  const handleReject = () => {
    setRejectAttempted(true);
    if (!rejectionReason.trim()) return;
    setRecords((prev) => prev.map((r) => r.id === selectedId ? { ...r, releaseStatus: "已拒绝" } : r));
    setRejectConfirmOpen(false);
    setRejectionReason("");
    setRejectAttempted(false);
    toast.success("已拒绝放行");
  };

  return (
    <div className="horizon-theme hz-page flex min-h-full min-w-0 flex-col gap-3 overflow-y-auto px-3 py-3 sm:px-4 xl:h-full xl:min-h-0 xl:overflow-hidden xl:px-5 xl:py-4">
      <HorizonPageHeader
        Icon={ShieldCheck}
        eyebrow="QUALITY CONTROL · RELEASE"
        title="检验与放行"
        description="集中管理来料、过程与成品检验，确保放行动作经过明确复核。"
        meta={<><span>{records.length} 条检验记录</span><span aria-hidden="true">·</span><span>当前批次 {selected.batch}</span></>}
        actions={<Button type="button" className="hz-primary-action" onClick={() => setShowNewForm(true)}><Plus className="size-4" />新建检验</Button>}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={ClipboardCheck} label="检验记录" value={records.length} note="全部质量记录" />
        <HorizonMetric Icon={Lock} label="待放行" value={records.filter((record) => record.releaseStatus === "待放行").length} note="需要 QA 复核" tone="warning" />
        <HorizonMetric Icon={BadgeCheck} label="已放行" value={records.filter((record) => record.releaseStatus === "已放行").length} note="允许进入后续流转" tone="success" />
        <HorizonMetric Icon={XCircle} label="不合格" value={records.filter((record) => record.result === "不合格").length} note="包含待处置记录" tone="danger" />
      </HorizonMetricGrid>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <nav className="hz-surface flex min-w-0 flex-col overflow-hidden" aria-label="检验记录">
          <HorizonSectionHeader title="检验记录" description="按批次选择并查看放行状态" trailing={<span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600 tabular-nums">{records.length} 条</span>} />
          <div className="flex gap-2 overflow-x-auto p-3 xl:block xl:flex-1 xl:space-y-1 xl:overflow-y-auto">
            {records.map((record) => {
              const selectedNow = selectedId === record.id;
              return (
                <Button variant="unstyled"
                  key={record.id}
                  type="button"
                  aria-pressed={selectedNow}
                  aria-current={selectedNow ? "true" : undefined}
                  onClick={() => setSelectedId(record.id)}
                  className={cn(
                    "relative min-w-[235px] rounded-xl border border-transparent px-3 py-3 text-left transition-colors xl:w-full xl:min-w-0",
                    selectedNow ? "border-[#cfdafe] bg-accent before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary" : "bg-slate-50/70 hover:bg-slate-100",
                  )}
                >
                  <div className="flex items-center justify-between gap-2"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", typeColors[record.type])}>{record.type}</span><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", releaseColors[record.releaseStatus])}>{record.releaseStatus}</span></div>
                  <div className="mt-2 truncate text-sm font-semibold text-[#1b2559] tabular-nums">{record.batch}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-500 tabular-nums">{record.date} · {record.inspector}</span><span className={cn("inline-flex items-center gap-1 font-semibold", record.result === "合格" ? "text-emerald-700" : "text-rose-700")}>{record.result === "合格" ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}{record.result}</span></div>
                  {record.releaseStatus === "待放行" ? <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Lock className="size-3" />未放行，不可出库</div> : null}
                </Button>
              );
            })}
          </div>
        </nav>

        <section className="hz-surface flex min-w-0 flex-col overflow-hidden" aria-labelledby="inspection-detail-title">
          <HorizonSectionHeader
            Icon={Archive}
            title={`${selected.batch} · ${selected.type}`}
            description={`${selected.date} · 检验人 ${selected.inspector}${selected.supplier ? ` · 供应商 ${selected.supplier}` : ""}`}
            trailing={<span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", releaseColors[selected.releaseStatus])}>{selected.releaseStatus}</span>}
          />
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3"><h2 id="inspection-detail-title" className="text-sm font-semibold text-[#1b2559]">检验项目明细</h2><span className="text-xs text-slate-500 tabular-nums">{selected.items.length} 项</span></div>
              <div className="overflow-hidden rounded-xl border border-[#e9edf7]">
                {selected.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className={cn("grid gap-3 border-b border-[#e9edf7] px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,.45fr)_auto] sm:items-center", item.result === "不合格" && "bg-rose-50/70")}>
                    <div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{item.name}</div><div className="mt-0.5 text-xs text-slate-500">标准：{item.standard}</div></div>
                    <div className="text-sm text-slate-700 tabular-nums"><span className="text-xs text-slate-500">实测</span><div className="mt-0.5 font-semibold">{item.actual || "—"}</div></div>
                    <span className={cn("w-fit rounded-full px-2 py-0.5 text-xs font-semibold", item.result === "合格" ? "bg-emerald-50 text-emerald-700" : item.result === "不合格" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500")}>{item.result}</span>
                  </div>
                ))}
              </div>
              <div className={cn("mt-3 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold", selected.result === "合格" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-rose-100 bg-rose-50 text-rose-700")}>{selected.result === "合格" ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}整体判定：{selected.result}</div>
              {selected.ncr ? <div className="mt-2 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertTriangle className="size-4" />NCR 处置方案：<strong>{selected.ncr}</strong></div> : null}
            </div>

            {selected.releaseStatus === "待放行" ? (
              <div className="rounded-xl border border-[#dce4f8] bg-[#f8faff] p-4">
                <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"><BadgeCheck className="size-5" /></span><div><h3 className="text-sm font-semibold text-[#1b2559]">QA 放行审批</h3><p className="mt-1 text-pretty text-xs leading-5 text-slate-600">确认后将更新批次放行状态。请复核批号、检验结论和检验人信息。</p></div></div>
                {selected.result === "不合格" ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-800">当前整体判定为不合格；如需让步接收，请先核对 NCR 处置依据。</div> : null}
                <div className="mt-4 flex flex-col gap-2 sm:flex-row"><Button type="button" className="hz-primary-action sm:flex-1" onClick={() => setReleaseConfirmOpen(true)}><CheckCircle2 className="size-4" />批准放行</Button><Button type="button" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50 sm:flex-1" onClick={() => { setRejectAttempted(false); setRejectConfirmOpen(true); }}><XCircle className="size-4" />拒绝放行</Button></div>
              </div>
            ) : (
              <div className={cn("flex items-start gap-3 rounded-xl border p-4", selected.releaseStatus === "已放行" ? "border-emerald-100 bg-emerald-50" : "border-rose-100 bg-rose-50")}>
                {selected.releaseStatus === "已放行" ? <CheckCircle2 className="size-5 shrink-0 text-emerald-700" /> : <XCircle className="size-5 shrink-0 text-rose-700" />}
                <div><div className={cn("text-sm font-semibold", selected.releaseStatus === "已放行" ? "text-emerald-800" : "text-rose-800")}>{selected.releaseStatus === "已放行" ? "此批次已放行，可进入后续流转" : "此批次已拒绝放行，不可出库"}</div><div className="mt-1 text-xs text-slate-600">当前记录已完成状态更新；后续处理请按质量流程执行。</div></div>
              </div>
            )}
          </div>
        </section>
      </div>

      <Dialog open={showNewForm} onOpenChange={(open) => { setShowNewForm(open); if (!open) setFormAttempted(false); }}>
        <DialogContent className="horizon-portal max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <form onSubmit={(event) => { event.preventDefault(); handleSubmitNew(); }}>
            <DialogHeader className="border-b border-[#e9edf7] px-5 py-4 text-left"><DialogTitle className="text-balance text-[#1b2559]">新建检验记录</DialogTitle><DialogDescription className="text-pretty">录入批次信息、检验实测值和明确判定后提交。</DialogDescription></DialogHeader>
            <div className="space-y-5 px-5 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { label: "批号", key: "batch", required: true },
                  { label: "检验人", key: "inspector", required: true },
                  { label: "供应商", key: "supplier", required: false },
                  { label: "检验日期", key: "date", required: true, type: "date" },
                ].map((field) => {
                  const id = `inspection-${field.key}`;
                  const invalid = formAttempted && field.required && !(newForm as Record<string, string>)[field.key].trim();
                  return <div key={field.key} className="space-y-1.5"><Label htmlFor={id}>{field.label}{field.required ? <span className="text-rose-600">*</span> : null}</Label><Input id={id} type={field.type ?? "text"} required={field.required} aria-invalid={invalid} value={(newForm as Record<string, string>)[field.key]} onChange={(event) => setNewForm((prev) => ({ ...prev, [field.key]: event.target.value }))} /></div>;
                })}
              </div>
              <fieldset><legend className="text-sm font-medium text-slate-800">检验类型</legend><div className="mt-2 grid grid-cols-3 gap-2">{(["IQC", "IPQC", "FQC"] as InspectionType[]).map((type) => <Button key={type} type="button" variant="outline" aria-pressed={newForm.type === type} className={cn("rounded-lg", newForm.type === type && "border-primary bg-accent text-primary")} onClick={() => setNewForm((prev) => ({ ...prev, type }))}>{type}</Button>)}</div></fieldset>
              <fieldset className="space-y-3"><legend className="text-sm font-semibold text-[#1b2559]">检验项目</legend>{newItems.map((item, index) => {
                const actualId = `inspection-item-${index}`;
                const invalid = formAttempted && (!item.actual.trim() || !item.result);
                return <div key={item.name} className="rounded-xl border border-[#e9edf7] bg-slate-50/70 p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><Label htmlFor={actualId}>{item.name}</Label><span className="text-xs text-slate-500">标准：{item.standard}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Input id={actualId} placeholder="录入实测值或观察结果" aria-invalid={invalid} value={item.actual} onChange={(event) => setNewItems((prev) => prev.map((current, itemIndex) => itemIndex === index ? { ...current, actual: event.target.value } : current))} /><div className="grid grid-cols-2 gap-1"><Button type="button" size="sm" variant="outline" aria-pressed={item.result === "合格"} className={cn("rounded-lg", item.result === "合格" && "border-emerald-300 bg-emerald-50 text-emerald-700")} onClick={() => setNewItems((prev) => prev.map((current, itemIndex) => itemIndex === index ? { ...current, result: "合格" } : current))}>合格</Button><Button type="button" size="sm" variant="outline" aria-pressed={item.result === "不合格"} className={cn("rounded-lg", item.result === "不合格" && "border-rose-300 bg-rose-50 text-rose-700")} onClick={() => setNewItems((prev) => prev.map((current, itemIndex) => itemIndex === index ? { ...current, result: "不合格" } : current))}>不合格</Button></div></div></div>;
              })}</fieldset>
              {formAttempted && (!newForm.batch.trim() || !newForm.inspector.trim() || newItems.some((item) => !item.actual.trim() || !item.result)) ? <p role="alert" className="text-sm text-rose-700">请填写批号、检验人及全部项目的实测值和判定。</p> : null}
            </div>
            <DialogFooter className="sticky bottom-0 border-t border-[#e9edf7] bg-white px-5 py-4"><Button type="button" variant="outline" onClick={() => setShowNewForm(false)}>取消</Button><Button type="submit" className="hz-primary-action">提交检验记录</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={releaseConfirmOpen} onOpenChange={setReleaseConfirmOpen}>
        <AlertDialogContent className="horizon-portal"><AlertDialogHeader><AlertDialogTitle className="text-balance text-[#1b2559]">确认批准放行？</AlertDialogTitle><AlertDialogDescription className="text-pretty">批号 {selected.batch} · {selected.type} · 整体判定 {selected.result} · 检验人 {selected.inspector}。确认后将更新批次放行状态。</AlertDialogDescription></AlertDialogHeader>{selected.result === "不合格" ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">该记录判定为不合格，请确认已具备让步接收或其他处置依据。</div> : null}<AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="hz-primary-action" onClick={handleRelease}>确认放行</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejectConfirmOpen} onOpenChange={(open) => { setRejectConfirmOpen(open); if (!open) { setRejectAttempted(false); setRejectionReason(""); } }}>
        <AlertDialogContent className="horizon-portal"><form onSubmit={(event) => { event.preventDefault(); handleReject(); }}><AlertDialogHeader><AlertDialogTitle className="text-balance text-[#1b2559]">拒绝批次放行</AlertDialogTitle><AlertDialogDescription className="text-pretty">批号 {selected.batch} 将保持不可出库状态，请填写可追溯的拒绝原因。</AlertDialogDescription></AlertDialogHeader><div className="mt-4 space-y-1.5"><Label htmlFor="release-rejection-reason">拒绝原因</Label><Textarea id="release-rejection-reason" value={rejectionReason} aria-invalid={rejectAttempted && !rejectionReason.trim()} placeholder="说明问题、风险或后续处置要求" onChange={(event) => setRejectionReason(event.target.value)} />{rejectAttempted && !rejectionReason.trim() ? <p role="alert" className="text-sm text-rose-700">请填写拒绝原因。</p> : null}</div><AlertDialogFooter className="mt-4"><AlertDialogCancel>取消</AlertDialogCancel><Button type="submit" variant="destructive">确认拒绝</Button></AlertDialogFooter></form></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
