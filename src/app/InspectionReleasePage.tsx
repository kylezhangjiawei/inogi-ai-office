import React, { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Lock,
  Plus,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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
  IQC: "bg-blue-100 text-blue-700",
  IPQC: "bg-purple-100 text-purple-700",
  FQC: "bg-teal-100 text-teal-700",
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
}

const defaultItems: NewFormItem[] = [
  { name: "外观检验", standard: "无破损/划痕", actual: "" },
  { name: "尺寸测量", standard: "标准范围内", actual: "" },
  { name: "功能测试", standard: "全功能正常", actual: "" },
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
  const [showRejectInput, setShowRejectInput] = useState(false);

  const selected = records.find((r) => r.id === selectedId)!;

  const computeItemResult = (item: NewFormItem): "合格" | "不合格" | "—" => {
    if (!item.actual) return "—";
    if (item.actual === "合格" || item.actual === "通过") return "合格";
    if (item.actual === "不合格" || item.actual === "不通过") return "不合格";
    return "合格";
  };

  const handleSubmitNew = () => {
    if (!newForm.batch || !newForm.inspector) { toast.error("请填写批号和检验人"); return; }
    const computedItems = newItems.map((item) => ({
      ...item,
      min: 0, max: 0,
      result: computeItemResult(item),
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
    toast.success(`检验记录 ${id} 已提交`);
  };

  const handleRelease = () => {
    setRecords((prev) => prev.map((r) => r.id === selectedId ? { ...r, releaseStatus: "已放行" } : r));
    toast.success("批次已批准放行");
  };

  const handleReject = () => {
    if (!rejectionReason.trim()) { toast.error("请填写拒绝原因"); return; }
    setRecords((prev) => prev.map((r) => r.id === selectedId ? { ...r, releaseStatus: "已拒绝" } : r));
    setShowRejectInput(false);
    setRejectionReason("");
    toast.success("已拒绝放行");
  };

  return (
    <div className="flex h-full gap-4 p-4 bg-gray-50 min-h-0">
      {/* Left: IQC Form */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-500" />
              <h3 className="font-semibold text-gray-800 text-sm">检验表单</h3>
            </div>
            <button onClick={() => setShowNewForm(!showNewForm)}
              className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium">
              <Plus className="w-3.5 h-3.5" /> 新建
            </button>
          </div>

          {showNewForm && (
            <div className="space-y-2.5 border-t border-gray-50 pt-3">
              {[
                { label: "批号", key: "batch" },
                { label: "检验人", key: "inspector" },
                { label: "供应商", key: "supplier" },
                { label: "检验日期", key: "date", type: "date" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
                  <input
                    type={f.type ?? "text"}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    value={(newForm as Record<string, string>)[f.key]}
                    onChange={(e) => setNewForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-400 block mb-1">检验类型</label>
                <div className="flex gap-1">
                  {(["IQC", "IPQC", "FQC"] as InspectionType[]).map((t) => (
                    <button key={t} onClick={() => setNewForm((p) => ({ ...p, type: t }))}
                      className={cn("flex-1 text-xs py-1 rounded-lg font-medium transition-colors",
                        newForm.type === t ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      )}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-2">检验项目</div>
              {newItems.map((item, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-gray-400">{item.standard}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400"
                      placeholder="实测值"
                      value={item.actual}
                      onChange={(e) => setNewItems((prev) => prev.map((it, idx) => idx === i ? { ...it, actual: e.target.value } : it))}
                    />
                    {item.actual && (
                      <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0",
                        computeItemResult(item) === "合格" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                      )}>
                        {computeItemResult(item)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={handleSubmitNew}
                className="w-full bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium py-2 rounded-lg transition-colors mt-1">
                提交检验记录
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center: Record List */}
      <div className="w-72 flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">检验记录</h3>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {records.map((r) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)}
              className={cn("w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors", selectedId === r.id && "bg-teal-50")}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", typeColors[r.type])}>{r.type}</span>
                <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", releaseColors[r.releaseStatus])}>{r.releaseStatus}</span>
              </div>
              <div className="text-sm font-medium text-gray-800">{r.batch}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-400">{r.date} · {r.inspector}</span>
                <span className={cn("text-xs font-semibold flex items-center gap-1",
                  r.result === "合格" ? "text-green-600" : "text-red-600"
                )}>
                  {r.result === "合格" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {r.result}
                </span>
              </div>
              {r.releaseStatus === "待放行" && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Lock className="w-3 h-3 text-gray-400" />
                  <span className="text-xs text-gray-400">未放行，不可出库</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: QA Release Panel */}
      <div className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-1">
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", typeColors[selected.type])}>{selected.type}</span>
            <h3 className="font-semibold text-gray-800">{selected.batch}</h3>
            <span className={cn("ml-auto text-sm px-2.5 py-1 rounded-full font-medium", releaseColors[selected.releaseStatus])}>{selected.releaseStatus}</span>
          </div>
          <div className="text-xs text-gray-400">{selected.date} · 检验人：{selected.inspector}{selected.supplier && ` · 供应商：${selected.supplier}`}</div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Inspection Items */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">检验项目明细</div>
            <div className="space-y-2">
              {selected.items.map((item, i) => (
                <div key={i} className={cn("flex items-center justify-between p-3 rounded-xl border",
                  item.result === "不合格" ? "border-red-100 bg-red-50" : "border-gray-100 bg-gray-50"
                )}>
                  <div>
                    <div className="text-sm font-medium text-gray-800">{item.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">标准：{item.standard}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-700">实测：{item.actual || "—"}</div>
                    <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium",
                      item.result === "合格" ? "bg-green-50 text-green-600" :
                      item.result === "不合格" ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"
                    )}>
                      {item.result}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Overall result */}
            <div className={cn("mt-3 p-3 rounded-xl flex items-center gap-2 font-semibold",
              selected.result === "合格" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            )}>
              {selected.result === "合格" ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              整体判定：{selected.result}
            </div>

            {selected.ncr && (
              <div className="mt-2 p-3 rounded-xl bg-orange-50 border border-orange-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                <span className="text-sm text-orange-700">NCR 处置方案：<strong>{selected.ncr}</strong></span>
              </div>
            )}
          </div>

          {/* QA Release */}
          {selected.releaseStatus === "待放行" && (
            <div className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 text-teal-500" />
                <span className="text-sm font-semibold text-gray-800">QA 放行审批</span>
              </div>
              <div className="text-xs text-teal-600 bg-teal-50 rounded-lg p-2 font-medium">
                ⚠ 此操作视为电子签名，具有法律效力
              </div>
              <div className="flex gap-2">
                <button onClick={handleRelease}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm bg-teal-500 hover:bg-teal-600 text-white py-2 rounded-lg font-medium transition-colors">
                  <CheckCircle2 className="w-4 h-4" /> 批准放行
                </button>
                <button onClick={() => setShowRejectInput(!showRejectInput)}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm bg-red-50 hover:bg-red-100 text-red-600 py-2 rounded-lg font-medium border border-red-100 transition-colors">
                  <XCircle className="w-4 h-4" /> 拒绝放行
                </button>
              </div>
              {showRejectInput && (
                <div className="space-y-2">
                  <textarea
                    className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 h-16 resize-none focus:outline-none focus:ring-1 focus:ring-red-400"
                    placeholder="请填写拒绝原因..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                  <button onClick={handleReject}
                    className="w-full text-sm bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-medium transition-colors">
                    确认拒绝
                  </button>
                </div>
              )}
            </div>
          )}

          {selected.releaseStatus !== "待放行" && (
            <div className={cn("p-4 rounded-xl border flex items-center gap-3",
              selected.releaseStatus === "已放行" ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"
            )}>
              {selected.releaseStatus === "已放行" ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              )}
              <div>
                <div className={cn("font-semibold text-sm", selected.releaseStatus === "已放行" ? "text-green-700" : "text-red-700")}>
                  {selected.releaseStatus === "已放行" ? "此批次已放行，可正常出库" : "此批次已拒绝放行，不可出库"}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">已完成电子签名确认</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
