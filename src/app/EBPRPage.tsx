import React, { useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  Edit3,
  Factory,
  History,
  Lock,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
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

type BatchStatus = "生产中" | "待检验" | "已放行";
type StepStatus = "已完成" | "进行中" | "未开始";

interface ProcessParam {
  key: string;
  value: string;
  unit: string;
}

interface ProcessStep {
  id: number;
  name: string;
  operator: string;
  date: string;
  params: ProcessParam[];
  equipmentId: string;
  materialBatch: string;
  status: StepStatus;
  locked: boolean;
}

interface AuditEntry {
  id: number;
  stepId?: number;
  stepName?: string;
  modifier: string;
  time: string;
  field: string;
  original: string;
  updated: string;
  reason: string;
}

interface Batch {
  id: string;
  product: string;
  productionDate: string;
  status: BatchStatus;
  operator: string;
  steps: ProcessStep[];
  audit: AuditEntry[];
}

const initialBatches: Batch[] = [
  {
    id: "BT-2026-001",
    product: "OC-10 CPAP",
    productionDate: "2026-04-15",
    status: "生产中",
    operator: "王工",
    steps: [
      { id: 1, name: "投料确认", operator: "王工", date: "2026-04-15", params: [{ key: "物料批次", value: "MAT-240415", unit: "" }, { key: "投料量", value: "100", unit: "套" }], equipmentId: "LINE-A1", materialBatch: "MAT-240415", status: "已完成", locked: true },
      { id: 2, name: "主板组装", operator: "李技", date: "2026-04-15", params: [{ key: "温度", value: "25", unit: "°C" }, { key: "湿度", value: "55", unit: "%" }], equipmentId: "ASSY-B2", materialBatch: "PCB-240401", status: "已完成", locked: true },
      { id: 3, name: "气路测试", operator: "陈检", date: "2026-04-16", params: [{ key: "压力", value: "4.0", unit: "cmH₂O" }, { key: "时长", value: "30", unit: "min" }], equipmentId: "TEST-C3", materialBatch: "—", status: "进行中", locked: false },
      { id: 4, name: "整机老化", operator: "", date: "", params: [{ key: "温度", value: "", unit: "°C" }, { key: "时长", value: "", unit: "h" }], equipmentId: "", materialBatch: "", status: "未开始", locked: false },
      { id: 5, name: "终检入库", operator: "", date: "", params: [], equipmentId: "", materialBatch: "", status: "未开始", locked: false },
    ],
    audit: [
      { id: 1, modifier: "王工", time: "2026-04-15 09:22", field: "投料量", original: "95套", updated: "100套", reason: "BOM更新，按新版本投料" },
    ],
  },
  {
    id: "BT-2026-002",
    product: "OC-5 BiPAP",
    productionDate: "2026-04-14",
    status: "待检验",
    operator: "陈工",
    steps: [
      { id: 1, name: "投料确认", operator: "陈工", date: "2026-04-14", params: [{ key: "物料批次", value: "MAT-240414", unit: "" }], equipmentId: "LINE-B1", materialBatch: "MAT-240414", status: "已完成", locked: true },
      { id: 2, name: "主板组装", operator: "孙技", date: "2026-04-14", params: [{ key: "温度", value: "24", unit: "°C" }], equipmentId: "ASSY-B1", materialBatch: "PCB-240400", status: "已完成", locked: true },
      { id: 3, name: "气路测试", operator: "韩检", date: "2026-04-15", params: [{ key: "压力", value: "4.2", unit: "cmH₂O" }], equipmentId: "TEST-C2", materialBatch: "—", status: "已完成", locked: true },
      { id: 4, name: "整机老化", operator: "老化组", date: "2026-04-15", params: [{ key: "温度", value: "40", unit: "°C" }, { key: "时长", value: "48", unit: "h" }], equipmentId: "AGING-D1", materialBatch: "—", status: "已完成", locked: true },
      { id: 5, name: "终检入库", operator: "", date: "", params: [], equipmentId: "", materialBatch: "", status: "未开始", locked: false },
    ],
    audit: [],
  },
  {
    id: "BT-2026-003",
    product: "OC-3 呼吸机",
    productionDate: "2026-04-10",
    status: "已放行",
    operator: "李工",
    steps: Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, name: ["投料确认", "主板组装", "气路测试", "整机老化", "终检入库"][i],
      operator: "李工", date: `2026-04-${10 + i}`,
      params: [{ key: "状态", value: "合格", unit: "" }],
      equipmentId: `EQ-${i + 1}`, materialBatch: "MAT-240410",
      status: "已完成" as StepStatus, locked: true,
    })),
    audit: [],
  },
];

const batchStatusColor: Record<BatchStatus, string> = {
  "生产中": "bg-yellow-50 text-yellow-700",
  "待检验": "bg-orange-50 text-orange-700",
  "已放行": "bg-green-50 text-green-600",
};

interface ModifyModalState {
  batchId: string;
  stepId: number;
  field: string;
  original: string;
}

export function EBPRPage() {
  const [batches, setBatches] = useState<Batch[]>(initialBatches);
  const [selectedBatchId, setSelectedBatchId] = useState(initialBatches[0].id);
  const [expandedStep, setExpandedStep] = useState<number | null>(3);
  const [modifyModal, setModifyModal] = useState<ModifyModalState | null>(null);
  const [modifyReason, setModifyReason] = useState("");
  const [modifyValue, setModifyValue] = useState("");
  const [modifyAttempted, setModifyAttempted] = useState(false);
  const [activeFormData, setActiveFormData] = useState<Record<string, string>>({});

  const selectedBatch = batches.find((b) => b.id === selectedBatchId)!;

  const handleAddBatch = () => {
    const year = new Date().getFullYear();
    const newId = `BT-${year}-${String(batches.length + 1).padStart(3, "0")}`;
    const newBatch: Batch = {
      id: newId,
      product: "新产品",
      productionDate: new Date().toISOString().split("T")[0],
      status: "生产中",
      operator: "—",
      steps: ["投料确认", "主板组装", "气路测试", "整机老化", "终检入库"].map((name, i) => ({
        id: i + 1, name, operator: "", date: "", params: [], equipmentId: "", materialBatch: "", status: (i === 0 ? "进行中" : "未开始") as StepStatus, locked: false,
      })),
      audit: [],
    };
    setBatches((prev) => [newBatch, ...prev]);
    setSelectedBatchId(newId);
    toast.success(`新建批次 ${newId}`);
  };

  const handleSubmitStep = (stepId: number) => {
    setBatches((prev) => prev.map((b) =>
      b.id !== selectedBatchId ? b : {
        ...b,
        steps: b.steps.map((s) => {
          if (s.id === stepId) {
            const fieldValue = (field: string) => activeFormData[`${selectedBatchId}:${stepId}:${field}`];
            return {
              ...s,
              status: "已完成" as StepStatus,
              locked: true,
              operator: fieldValue("操作人") || "当前用户",
              date: fieldValue("操作日期") || new Date().toISOString().split("T")[0],
              equipmentId: fieldValue("设备编号") || s.equipmentId,
              materialBatch: fieldValue("物料批次") || s.materialBatch,
              params: s.params.map((param) => ({
                ...param,
                value: fieldValue(`参数:${param.key}`) ?? param.value,
              })),
            };
          }
          if (s.id === stepId + 1) return { ...s, status: "进行中" as StepStatus };
          return s;
        }),
        status: stepId === b.steps.length ? "待检验" as BatchStatus : b.status,
      }
    ));
    toast.success(`工序 ${stepId} 已提交并锁定`);
  };

  const handleOpenModify = (stepId: number, field: string, original: string) => {
    setModifyModal({ batchId: selectedBatchId, stepId, field, original });
    setModifyValue(original);
    setModifyReason("");
    setModifyAttempted(false);
  };

  const handleSubmitModify = () => {
    setModifyAttempted(true);
    if (!modifyReason.trim() || !modifyValue.trim()) return;
    if (!modifyModal) return;
    const stepName = batches
      .find((batch) => batch.id === modifyModal.batchId)
      ?.steps.find((step) => step.id === modifyModal.stepId)?.name;
    const entry: AuditEntry = {
      id: Date.now(),
      stepId: modifyModal.stepId,
      stepName,
      modifier: "当前用户",
      time: new Date().toLocaleString("zh-CN"),
      field: modifyModal.field,
      original: modifyModal.original,
      updated: modifyValue,
      reason: modifyReason,
    };
    setBatches((prev) => prev.map((b) => b.id !== modifyModal.batchId ? b : {
      ...b,
      steps: b.steps.map((step) => step.id !== modifyModal.stepId ? step : {
        ...step,
        params: step.params.map((param) => param.key === modifyModal.field ? { ...param, value: modifyValue } : param),
      }),
      audit: [entry, ...b.audit],
    }));
    setModifyModal(null);
    setModifyAttempted(false);
    toast.success("修改已记录至审计轨迹");
  };

  const completedSteps = selectedBatch.steps.filter((step) => step.status === "已完成").length;
  const activeStep = selectedBatch.steps.find((step) => step.status === "进行中");
  const formValue = (stepId: number, field: string) => activeFormData[`${selectedBatchId}:${stepId}:${field}`] ?? "";
  const setFormValue = (stepId: number, field: string, value: string) => {
    setActiveFormData((prev) => ({ ...prev, [`${selectedBatchId}:${stepId}:${field}`]: value }));
  };

  return (
    <div className="horizon-theme hz-page flex min-h-full min-w-0 flex-col gap-3 overflow-y-auto px-3 py-3 sm:px-4 xl:h-full xl:min-h-0 xl:overflow-hidden xl:px-5 xl:py-4">
      <HorizonPageHeader
        Icon={Factory}
        eyebrow="QUALITY OPERATIONS · eBPR"
        title="电子批记录"
        description="批次工序、锁定记录与审计轨迹统一留痕，快速定位当前生产节点。"
        meta={<><span>{selectedBatch.id}</span><span aria-hidden="true">·</span><span>当前工序：{activeStep?.name ?? "已完成"}</span></>}
        actions={(
          <Button type="button" className="hz-primary-action" onClick={handleAddBatch}>
            <Plus className="size-4" />新建批次
          </Button>
        )}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={ClipboardCheck} label="全部批次" value={batches.length} note="当前生产台账" />
        <HorizonMetric Icon={Activity} label="生产中" value={batches.filter((batch) => batch.status === "生产中").length} note="工序正在执行" tone="brand" />
        <HorizonMetric Icon={Clock} label="待检验" value={batches.filter((batch) => batch.status === "待检验").length} note="等待质量检验" tone="warning" />
        <HorizonMetric Icon={CheckCircle2} label="已放行" value={batches.filter((batch) => batch.status === "已放行").length} note="已完成质量放行" tone="success" />
      </HorizonMetricGrid>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[220px_minmax(0,1fr)_288px]">
        <nav className="hz-surface flex min-w-0 flex-col overflow-hidden" aria-label="生产批次">
          <HorizonSectionHeader title="批次导航" description={`${batches.length} 个生产批次`} />
          <div className="flex gap-2 overflow-x-auto p-3 xl:block xl:flex-1 xl:space-y-1 xl:overflow-y-auto">
            {batches.map((batch) => {
              const selectedNow = selectedBatchId === batch.id;
              return (
                <Button variant="unstyled"
                  key={batch.id}
                  type="button"
                  aria-current={selectedNow ? "true" : undefined}
                  aria-pressed={selectedNow}
                  onClick={() => { setSelectedBatchId(batch.id); setExpandedStep(batch.steps.find((step) => step.status === "进行中")?.id ?? null); }}
                  className={cn(
                    "relative min-w-[205px] rounded-xl border border-transparent px-3 py-3 text-left transition-colors xl:w-full xl:min-w-0",
                    selectedNow ? "border-[#cfdafe] bg-accent before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary" : "bg-slate-50/70 hover:bg-slate-100",
                  )}
                >
                  <div className="truncate text-sm font-semibold text-[#1b2559] tabular-nums">{batch.id}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-600">{batch.product}</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500 tabular-nums">{batch.productionDate}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", batchStatusColor[batch.status])}>{batch.status}</span>
                  </div>
                </Button>
              );
            })}
          </div>
        </nav>

        <section className="hz-surface flex min-w-0 flex-col overflow-hidden" aria-labelledby="ebpr-process-title">
          <HorizonSectionHeader
            Icon={Factory}
            title={`${selectedBatch.id} · ${selectedBatch.product}`}
            description={`${selectedBatch.productionDate} · 负责人 ${selectedBatch.operator}`}
            trailing={<span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", batchStatusColor[selectedBatch.status])}>{selectedBatch.status}</span>}
          />
          <div className="border-b border-[#e9edf7] px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span id="ebpr-process-title" className="font-semibold text-[#1b2559]">工序完成度</span>
              <span className="text-slate-500 tabular-nums">{completedSteps} / {selectedBatch.steps.length}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`已完成 ${completedSteps} / ${selectedBatch.steps.length} 道工序`}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${(completedSteps / selectedBatch.steps.length) * 100}%` }} />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-4">
            <div className="overflow-hidden rounded-xl border border-[#e9edf7] bg-white">
              {selectedBatch.steps.map((step, index) => {
                const expanded = expandedStep === step.id;
                const panelId = `ebpr-step-${selectedBatch.id}-${step.id}`;
                return (
                  <div key={step.id} className={cn("relative border-b border-[#e9edf7] last:border-b-0", step.status === "进行中" && "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary")}>
                    <Button variant="unstyled"
                      id={`${panelId}-trigger`}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => setExpandedStep(expanded ? null : step.id)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50 sm:px-4"
                    >
                      <span className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        step.status === "已完成" ? "bg-emerald-50 text-emerald-700" : step.status === "进行中" ? "bg-accent text-primary" : "bg-slate-100 text-slate-500",
                      )}>
                        {step.status === "已完成" ? <CheckCircle2 className="size-4" /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#1b2559]">{step.name}</span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            step.status === "已完成" ? "bg-emerald-50 text-emerald-700" : step.status === "进行中" ? "bg-accent text-primary" : "bg-slate-100 text-slate-500",
                          )}>{step.status === "进行中" ? "当前工序" : step.status}</span>
                          {step.locked ? <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Lock className="size-3" />已锁定</span> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500 tabular-nums">{step.operator ? `${step.operator} · ${step.date}` : "等待录入"}</span>
                      </span>
                      {expanded ? <ChevronUp className="size-4 text-slate-500" /> : <ChevronDown className="size-4 text-slate-500" />}
                    </Button>

                    {expanded ? (
                      <div id={panelId} role="region" aria-labelledby={`${panelId}-trigger`} className="border-t border-[#e9edf7] bg-slate-50/55 px-4 py-4 sm:px-5">
                        {step.locked ? (
                          <div className="space-y-4">
                            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {step.params.map((param) => (
                                <div key={param.key}>
                                  <dt className="text-xs font-medium text-slate-500">{param.key}</dt>
                                  <dd className="mt-1 text-sm font-semibold text-slate-800 tabular-nums">{param.value || "—"}{param.unit}</dd>
                                </div>
                              ))}
                              <div><dt className="text-xs font-medium text-slate-500">设备编号</dt><dd className="mt-1 text-sm font-semibold text-slate-800 tabular-nums">{step.equipmentId || "—"}</dd></div>
                              <div><dt className="text-xs font-medium text-slate-500">物料批次</dt><dd className="mt-1 text-sm font-semibold text-slate-800 tabular-nums">{step.materialBatch || "—"}</dd></div>
                            </dl>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!step.params.length}
                              onClick={() => handleOpenModify(step.id, step.params[0]?.key ?? "工艺参数", step.params[0]?.value ?? "")}
                            ><Edit3 className="size-3.5" />申请修改首项参数</Button>
                          </div>
                        ) : step.status === "进行中" ? (
                          <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              {["操作人", "操作日期", "设备编号", "物料批次"].map((field) => {
                                const inputId = `${panelId}-${field}`;
                                return (
                                  <div key={field} className="space-y-1.5">
                                    <Label htmlFor={inputId} className="text-xs text-slate-600">{field}</Label>
                                    <Input id={inputId} type={field === "操作日期" ? "date" : "text"} value={formValue(step.id, field)} onChange={(event) => setFormValue(step.id, field, event.target.value)} />
                                  </div>
                                );
                              })}
                              {step.params.map((param) => {
                                const field = `参数:${param.key}`;
                                const inputId = `${panelId}-param-${param.key}`;
                                return (
                                  <div key={param.key} className="space-y-1.5">
                                    <Label htmlFor={inputId} className="text-xs text-slate-600">{param.key}{param.unit ? `（${param.unit}）` : ""}</Label>
                                    <Input id={inputId} value={formValue(step.id, field)} placeholder={param.value || "请输入实测值"} onChange={(event) => setFormValue(step.id, field, event.target.value)} />
                                  </div>
                                );
                              })}
                            </div>
                            <Button type="button" className="hz-primary-action" onClick={() => handleSubmitStep(step.id)}><Lock className="size-4" />提交并锁定</Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-slate-500"><Clock className="size-4" />等待前置工序完成后开放录入</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="hz-surface flex min-w-0 flex-col overflow-hidden" aria-label="审计轨迹">
          <HorizonSectionHeader Icon={ShieldCheck} title="审计轨迹" description={`${selectedBatch.audit.length} 条修改记录`} trailing={<span className="rounded-full bg-accent px-2 py-1 text-[11px] font-semibold text-primary">参考 21 CFR Part 11</span>} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedBatch.audit.length === 0 ? (
              <HorizonEmptyState Icon={History} title="暂无修改记录" description="锁定记录发生修改后，操作人与修改原因将显示在此。" />
            ) : (
              <ol className="space-y-4 border-l border-[#dce4f8] pl-4">
                {selectedBatch.audit.map((entry) => (
                  <li key={entry.id} className="relative text-xs before:absolute before:-left-[1.18rem] before:top-1 before:size-2 before:rounded-full before:bg-primary">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-[#1b2559]"><span>{entry.modifier}</span><time className="font-normal text-slate-500 tabular-nums">{entry.time}</time></div>
                    <div className="mt-1 text-slate-600">{entry.stepName ? `${entry.stepName} · ` : ""}{entry.field}</div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5">
                      <div><dt className="text-slate-500">原值</dt><dd className="mt-0.5 break-words font-medium text-rose-700 line-through">{entry.original}</dd></div>
                      <div><dt className="text-slate-500">新值</dt><dd className="mt-0.5 break-words font-medium text-emerald-700">{entry.updated}</dd></div>
                    </dl>
                    <p className="mt-2 rounded-lg bg-[#f4f7fe] p-2 text-pretty text-slate-600">原因：{entry.reason}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={Boolean(modifyModal)} onOpenChange={(open) => { if (!open) { setModifyModal(null); setModifyAttempted(false); } }}>
        <DialogContent className="horizon-portal gap-0 overflow-hidden p-0 sm:max-w-lg">
          <form onSubmit={(event) => { event.preventDefault(); handleSubmitModify(); }}>
            <DialogHeader className="border-b border-[#e9edf7] px-5 py-4 text-left">
              <DialogTitle className="text-balance text-[#1b2559]">申请修改已锁定记录</DialogTitle>
              <DialogDescription className="text-pretty">修改将同步更新工艺参数，并写入当前批次审计轨迹。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 px-5 py-5">
              {modifyModal ? (
                <dl className="grid grid-cols-2 gap-3 rounded-xl bg-[#f4f7fe] p-3 text-sm">
                  <div><dt className="text-xs text-slate-500">字段名</dt><dd className="mt-1 font-semibold text-slate-800">{modifyModal.field}</dd></div>
                  <div><dt className="text-xs text-slate-500">原始值</dt><dd className="mt-1 font-semibold text-slate-600 line-through">{modifyModal.original || "—"}</dd></div>
                </dl>
              ) : null}
              <div className="space-y-1.5"><Label htmlFor="ebpr-new-value">新值</Label><Input id="ebpr-new-value" value={modifyValue} aria-invalid={modifyAttempted && !modifyValue.trim()} onChange={(event) => setModifyValue(event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="ebpr-modify-reason">修改原因 <span className="text-rose-600">*</span></Label><Textarea id="ebpr-modify-reason" value={modifyReason} aria-invalid={modifyAttempted && !modifyReason.trim()} onChange={(event) => setModifyReason(event.target.value)} placeholder="说明修改原因与依据" /></div>
              {modifyAttempted && (!modifyValue.trim() || !modifyReason.trim()) ? <p role="alert" className="text-sm text-rose-700">请填写新值和修改原因后再提交。</p> : null}
            </div>
            <DialogFooter className="border-t border-[#e9edf7] bg-slate-50 px-5 py-4">
              <Button type="button" variant="outline" onClick={() => setModifyModal(null)}>取消</Button>
              <Button type="submit" className="hz-primary-action">提交修改</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
