import React, { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  Lock,
  Plus,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
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
        id: i + 1, name, operator: "", date: "", params: [], equipmentId: "", materialBatch: "", status: "未开始" as StepStatus, locked: false,
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
          if (s.id === stepId) return { ...s, status: "已完成" as StepStatus, locked: true, operator: "当前用户", date: new Date().toISOString().split("T")[0] };
          if (s.id === stepId + 1) return { ...s, status: "进行中" as StepStatus };
          return s;
        }),
      }
    ));
    toast.success(`工序 ${stepId} 已提交并锁定`);
  };

  const handleOpenModify = (stepId: number, field: string, original: string) => {
    setModifyModal({ batchId: selectedBatchId, stepId, field, original });
    setModifyValue(original);
    setModifyReason("");
  };

  const handleSubmitModify = () => {
    if (!modifyReason.trim()) { toast.error("请填写修改原因"); return; }
    if (!modifyModal) return;
    const entry: AuditEntry = {
      id: Date.now(),
      modifier: "当前用户",
      time: new Date().toLocaleString("zh-CN"),
      field: modifyModal.field,
      original: modifyModal.original,
      updated: modifyValue,
      reason: modifyReason,
    };
    setBatches((prev) => prev.map((b) =>
      b.id !== modifyModal.batchId ? b : { ...b, audit: [entry, ...b.audit] }
    ));
    setModifyModal(null);
    toast.success("修改已记录至审计轨迹");
  };

  return (
    <div className="flex h-full gap-0 bg-gray-50 min-h-0 overflow-hidden">
      {/* Left: Batch List */}
      <div className="w-56 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 text-sm">批次列表</h3>
          <button onClick={handleAddBatch} className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
            <Plus className="w-3.5 h-3.5" /> 新建
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {batches.map((b) => (
            <button key={b.id} onClick={() => setSelectedBatchId(b.id)}
              className={cn("w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors", selectedBatchId === b.id && "bg-teal-50")}>
              <div className="text-sm font-medium text-gray-800">{b.id}</div>
              <div className="text-xs text-gray-500 mt-0.5">{b.product}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs text-gray-400">{b.productionDate}</span>
                <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", batchStatusColor[b.status])}>{b.status}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Center: Process Steps */}
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 bg-white flex items-center gap-3">
          <div>
            <div className="font-semibold text-gray-800">{selectedBatch.id}</div>
            <div className="text-sm text-gray-500">{selectedBatch.product} · {selectedBatch.productionDate} · {selectedBatch.operator}</div>
          </div>
          <span className={cn("ml-auto text-sm px-2.5 py-1 rounded-full font-medium", batchStatusColor[selectedBatch.status])}>{selectedBatch.status}</span>
        </div>

        <div className="p-5 space-y-3">
          {selectedBatch.steps.map((step, idx) => (
            <div key={step.id} className={cn("bg-white rounded-xl border overflow-hidden",
              step.status === "进行中" ? "border-teal-200 shadow-sm" : "border-gray-100"
            )}>
              <button
                onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
              >
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                  step.status === "已完成" ? "bg-green-100 text-green-700" :
                  step.status === "进行中" ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-400"
                )}>
                  {step.status === "已完成" ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{step.name}</span>
                    {step.locked && <Lock className="w-3 h-3 text-gray-400" />}
                    {step.status === "进行中" && <span className="text-xs bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full font-medium">当前工序</span>}
                  </div>
                  {step.operator && <div className="text-xs text-gray-400 mt-0.5">{step.operator} · {step.date}</div>}
                </div>
                {expandedStep === step.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {expandedStep === step.id && (
                <div className="px-5 pb-4 border-t border-gray-50">
                  {step.locked ? (
                    // Locked view
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {step.params.map((p) => (
                          <div key={p.key} className="bg-gray-50 rounded-lg p-2.5">
                            <div className="text-xs text-gray-400">{p.key}</div>
                            <div className="text-sm font-medium text-gray-700 mt-0.5">{p.value}{p.unit}</div>
                          </div>
                        ))}
                        {step.equipmentId && (
                          <div className="bg-gray-50 rounded-lg p-2.5">
                            <div className="text-xs text-gray-400">设备编号</div>
                            <div className="text-sm font-medium text-gray-700 mt-0.5">{step.equipmentId}</div>
                          </div>
                        )}
                        {step.materialBatch && (
                          <div className="bg-gray-50 rounded-lg p-2.5">
                            <div className="text-xs text-gray-400">物料批次</div>
                            <div className="text-sm font-medium text-gray-700 mt-0.5">{step.materialBatch}</div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleOpenModify(step.id, "工艺参数", step.params[0]?.value ?? "—")}
                        className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                      >
                        <Edit3 className="w-3 h-3" /> 申请修改
                      </button>
                    </div>
                  ) : step.status === "进行中" ? (
                    // Active editable form
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {["操作人", "操作日期", "设备编号", "物料批次"].map((label) => (
                          <div key={label}>
                            <label className="text-xs text-gray-400 block mb-1">{label}</label>
                            <input
                              type={label === "操作日期" ? "date" : "text"}
                              className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                              value={activeFormData[label] ?? ""}
                              onChange={(e) => setActiveFormData((prev) => ({ ...prev, [label]: e.target.value }))}
                            />
                          </div>
                        ))}
                        {step.params.map((p) => (
                          <div key={p.key}>
                            <label className="text-xs text-gray-400 block mb-1">{p.key} {p.unit && `(${p.unit})`}</label>
                            <input
                              className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                              value={activeFormData[p.key] ?? ""}
                              onChange={(e) => setActiveFormData((prev) => ({ ...prev, [p.key]: e.target.value }))}
                            />
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => handleSubmitStep(step.id)}
                        className="flex items-center gap-1.5 text-sm bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                      >
                        <Lock className="w-3.5 h-3.5" /> 提交并锁定
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-gray-400 flex items-center gap-2">
                      <Clock className="w-4 h-4" /> 等待前置工序完成后开放录入
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Audit Trail */}
      <div className="w-64 flex-shrink-0 bg-white border-l border-gray-100 flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-500" />
            <h3 className="font-semibold text-gray-800 text-sm">审计轨迹</h3>
          </div>
          <div className="text-xs text-teal-600 bg-teal-50 rounded-lg px-2 py-1 mt-2 font-medium">
            FDA 21 CFR Part 11 合规
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {selectedBatch.audit.length === 0 ? (
            <div className="text-center text-xs text-gray-400 mt-6">暂无修改记录</div>
          ) : (
            <div className="space-y-3">
              {selectedBatch.audit.map((entry) => (
                <div key={entry.id} className="bg-gray-50 rounded-xl p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between font-medium text-gray-700">
                    <span>{entry.modifier}</span>
                    <span className="text-gray-400">{entry.time}</span>
                  </div>
                  <div className="text-gray-500">字段：{entry.field}</div>
                  <div className="flex gap-1 items-center flex-wrap">
                    <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded line-through">{entry.original}</span>
                    <span className="text-gray-400">→</span>
                    <span className="bg-green-50 text-green-600 px-1.5 py-0.5 rounded">{entry.updated}</span>
                  </div>
                  <div className="text-gray-400">原因：{entry.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modify Modal */}
      {modifyModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96">
            <h3 className="font-semibold text-gray-800 mb-4">申请修改已锁定记录</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">字段名</label>
                <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{modifyModal.field}</div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">原始值（不可修改）</label>
                <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 line-through">{modifyModal.original}</div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">新值</label>
                <input className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  value={modifyValue} onChange={(e) => setModifyValue(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">修改原因 <span className="text-red-500">*</span></label>
                <textarea className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 h-20 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400"
                  value={modifyReason} onChange={(e) => setModifyReason(e.target.value)} placeholder="请填写修改原因..." />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setModifyModal(null)} className="flex-1 text-sm border border-gray-200 rounded-lg py-2 hover:bg-gray-50 transition-colors">取消</button>
              <button onClick={handleSubmitModify} className="flex-1 text-sm bg-teal-500 hover:bg-teal-600 text-white rounded-lg py-2 font-medium transition-colors">提交修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
