import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  FolderOpen,
  History,
  Plus,
  RotateCcw,
  Shield,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type DocStatus = "草稿" | "审核中" | "已批准" | "已作废";
type ApprovalStep = "起草" | "审核" | "评审" | "批准" | "受控分发";

interface VersionRecord {
  version: string;
  editor: string;
  date: string;
  reason: string;
  summary: string;
}

interface QualityDoc {
  id: string;
  code: string;
  name: string;
  version: string;
  status: DocStatus;
  category: string;
  updatedAt: string;
  approver: string;
  currentStep: ApprovalStep;
  history: VersionRecord[];
}

const mockDocs: QualityDoc[] = [
  // 程序文件
  {
    id: "q1",
    code: "SOP-001",
    name: "文件控制程序",
    version: "V3.2",
    status: "已批准",
    category: "程序文件",
    updatedAt: "2026-04-01",
    approver: "张经理",
    currentStep: "受控分发",
    history: [
      { version: "V3.2", editor: "刘嘉", date: "2026-04-01", reason: "更新审批流程", summary: "增加数字签名要求，调整分发记录格式" },
      { version: "V3.1", editor: "刘嘉", date: "2026-01-15", reason: "年度例行审查", summary: "更新相关法规引用，修订章节编号" },
    ],
  },
  {
    id: "q2",
    code: "SOP-008",
    name: "变更控制程序",
    version: "V2.0",
    status: "审核中",
    category: "程序文件",
    updatedAt: "2026-04-10",
    approver: "王主管",
    currentStep: "审核",
    history: [
      { version: "V2.0", editor: "陈远", date: "2026-04-10", reason: "增加风险评估步骤", summary: "新增变更风险矩阵，更新影响评估表单" },
      { version: "V1.5", editor: "陈远", date: "2025-11-20", reason: "合规整改", summary: "按MDR要求补充变更通知条款" },
    ],
  },
  // 记录表单
  {
    id: "q3",
    code: "JL-014",
    name: "来料检验记录",
    version: "V1.6",
    status: "已批准",
    category: "记录表单",
    updatedAt: "2026-03-22",
    approver: "周质检",
    currentStep: "受控分发",
    history: [
      { version: "V1.6", editor: "周远", date: "2026-03-22", reason: "增加检测项目", summary: "增加生物相容性检测栏位，修订取样数量说明" },
    ],
  },
  {
    id: "q4",
    code: "JL-023",
    name: "不合格品处理记录",
    version: "V2.1",
    status: "草稿",
    category: "记录表单",
    updatedAt: "2026-04-13",
    approver: "（待定）",
    currentStep: "起草",
    history: [],
  },
  {
    id: "q5",
    code: "JL-031",
    name: "设备校准记录",
    version: "V1.0",
    status: "已作废",
    category: "记录表单",
    updatedAt: "2025-12-01",
    approver: "林监察",
    currentStep: "受控分发",
    history: [
      { version: "V1.0", editor: "林娜", date: "2025-06-10", reason: "初版发布", summary: "新建设备校准记录格式" },
    ],
  },
  // 作业指导书
  {
    id: "q6",
    code: "WI-022",
    name: "装配作业指导书",
    version: "V2.1",
    status: "审核中",
    category: "作业指导书",
    updatedAt: "2026-04-08",
    approver: "赵制造",
    currentStep: "评审",
    history: [
      { version: "V2.1", editor: "王工", date: "2026-04-08", reason: "工艺优化", summary: "更新装配顺序，增加防错说明图示" },
      { version: "V2.0", editor: "王工", date: "2026-02-11", reason: "设备更换", summary: "更新新设备操作参数" },
    ],
  },
  {
    id: "q7",
    code: "WI-035",
    name: "灭菌操作指导书",
    version: "V1.3",
    status: "已批准",
    category: "作业指导书",
    updatedAt: "2026-03-05",
    approver: "孙验证",
    currentStep: "受控分发",
    history: [
      { version: "V1.3", editor: "林娜", date: "2026-03-05", reason: "更新灭菌参数", summary: "根据验证报告V-2026-02更新温度曲线" },
    ],
  },
  // 说明书
  {
    id: "q8",
    code: "IFU-001",
    name: "产品使用说明书（中文版）",
    version: "V4.0",
    status: "已批准",
    category: "说明书",
    updatedAt: "2026-04-02",
    approver: "何RA",
    currentStep: "受控分发",
    history: [
      { version: "V4.0", editor: "何丽", date: "2026-04-02", reason: "年度更新+法规符合性", summary: "更新警示语，增加QR码，符合GB9706要求" },
      { version: "V3.8", editor: "何丽", date: "2025-09-18", reason: "勘误", summary: "修正第3章操作步骤顺序错误" },
    ],
  },
  {
    id: "q9",
    code: "IFU-002",
    name: "产品使用说明书（英文版）",
    version: "V3.9",
    status: "草稿",
    category: "说明书",
    updatedAt: "2026-04-14",
    approver: "（待定）",
    currentStep: "起草",
    history: [],
  },
];

const categories = ["程序文件", "记录表单", "作业指导书", "说明书"];

const statusConfig: Record<DocStatus, { label: string; cls: string }> = {
  草稿: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  审核中: { label: "审核中", cls: "bg-amber-100 text-amber-700" },
  已批准: { label: "已批准", cls: "bg-green-100 text-green-700" },
  已作废: { label: "已作废", cls: "bg-red-100 text-red-500" },
};

const approvalSteps: ApprovalStep[] = ["起草", "审核", "评审", "批准", "受控分发"];

const stepIndex = (step: ApprovalStep) => approvalSteps.indexOf(step);

// ─── Component ────────────────────────────────────────────────────────────────

export function QualityDMSPage() {
  const [docs, setDocs] = useState<QualityDoc[]>(mockDocs);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("q2");
  const [activeTab, setActiveTab] = useState<"approval" | "history">("approval");

  const filteredDocs = selectedCategory
    ? docs.filter((d) => d.category === selectedCategory)
    : docs;

  const selected = docs.find((d) => d.id === selectedId) ?? docs[0];

  const handleAction = (action: "pass" | "reject" | "approve" | "deny") => {
    const labels: Record<string, string> = {
      pass: "审核通过",
      reject: "打回修改",
      approve: "批准",
      deny: "驳回",
    };
    toast.success(`操作：${labels[action]}（模拟电子签名已记录）`);
    if (action === "pass") {
      setDocs((prev) =>
        prev.map((d) =>
          d.id === selectedId
            ? {
                ...d,
                currentStep: approvalSteps[stepIndex(d.currentStep) + 1] ?? d.currentStep,
              }
            : d,
        ),
      );
    }
  };

  const categoryCount = (cat: string) => docs.filter((d) => d.category === cat).length;

  return (
    <div className="flex h-full min-h-screen flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">质量文件管理系统（DMS）</h1>
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Left: Category Tree */}
        <div className="flex w-[20%] flex-col border-r border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">文件类别</span>
            <button
              onClick={() => toast.info("新建文件（模拟）")}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-3 w-3" />
              新建
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                !selectedCategory
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50",
              )}
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                全部文件
              </span>
              <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                {docs.length}
              </span>
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                  selectedCategory === cat
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50",
                )}
              >
                <span className="flex items-center gap-2">
                  <ChevronRight className="h-3.5 w-3.5" />
                  {cat}
                </span>
                <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                  {categoryCount(cat)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Center: Document List */}
        <div className="flex w-[45%] flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">
              {selectedCategory ?? "全部文件"}（{filteredDocs.length}）
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">文件编号</th>
                  <th className="px-2 py-2 text-left font-medium">文件名</th>
                  <th className="px-2 py-2 text-left font-medium">版本</th>
                  <th className="px-2 py-2 text-left font-medium">状态</th>
                  <th className="px-2 py-2 text-left font-medium">修改日</th>
                  <th className="px-2 py-2 text-left font-medium">审批人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredDocs.map((doc) => {
                  const isVoid = doc.status === "已作废";
                  return (
                    <tr
                      key={doc.id}
                      onClick={() => setSelectedId(doc.id)}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isVoid ? "opacity-50" : "",
                        selectedId === doc.id ? "bg-blue-50" : "hover:bg-gray-50",
                      )}
                    >
                      <td className="px-3 py-2.5 font-mono text-gray-600">{doc.code}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className={cn("font-medium text-gray-800", isVoid && "line-through text-gray-400")}>
                            {doc.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600">
                          {doc.version}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            statusConfig[doc.status].cls,
                          )}
                        >
                          {statusConfig[doc.status].label}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-gray-400">{doc.updatedAt}</td>
                      <td className="px-2 py-2.5 text-gray-500">{doc.approver}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Approval Panel */}
        <div className="flex w-[35%] flex-col bg-white">
          {selected && (
            <>
              {/* Header */}
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-xs text-gray-400 font-mono">{selected.code}</p>
                <p className="text-sm font-semibold text-gray-900">{selected.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                    {selected.version}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusConfig[selected.status].cls)}>
                    {statusConfig[selected.status].label}
                  </span>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-100">
                {[
                  { key: "approval", label: "审批流程" },
                  { key: "history", label: "版本历史" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as "approval" | "history")}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium transition-colors",
                      activeTab === tab.key
                        ? "border-b-2 border-blue-600 text-blue-600"
                        : "text-gray-500 hover:text-gray-700",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === "approval" && (
                <div className="flex-1 overflow-y-auto p-4">
                  {/* Step bar */}
                  <div className="mb-6">
                    <div className="flex items-center">
                      {approvalSteps.map((step, i) => {
                        const current = stepIndex(selected.currentStep);
                        const isDone = i < current;
                        const isActive = i === current;
                        return (
                          <React.Fragment key={step}>
                            <div className="flex flex-col items-center">
                              <div
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                                  isDone
                                    ? "bg-green-500 text-white"
                                    : isActive
                                      ? "bg-blue-600 text-white ring-2 ring-blue-200"
                                      : "bg-gray-200 text-gray-400",
                                )}
                              >
                                {isDone ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                              </div>
                              <span
                                className={cn(
                                  "mt-1 text-xs",
                                  isActive ? "font-semibold text-blue-600" : isDone ? "text-green-600" : "text-gray-400",
                                )}
                              >
                                {step}
                              </span>
                            </div>
                            {i < approvalSteps.length - 1 && (
                              <div
                                className={cn(
                                  "mx-1 mb-4 h-0.5 flex-1",
                                  i < current ? "bg-green-400" : "bg-gray-200",
                                )}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>

                  {/* Current step info */}
                  <div className="mb-4 rounded-xl bg-blue-50 p-3">
                    <p className="text-xs font-medium text-blue-700">
                      当前步骤：{selected.currentStep}
                    </p>
                    <p className="mt-0.5 text-xs text-blue-500">
                      审批人：{selected.approver}
                    </p>
                  </div>

                  {/* Action buttons */}
                  {selected.status === "审核中" && (
                    <div className="space-y-2">
                      {selected.currentStep === "审核" && (
                        <>
                          <p className="text-xs font-medium text-gray-500 mb-2">审核人操作</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAction("pass")}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700"
                            >
                              <ThumbsUp className="h-4 w-4" />
                              通过
                            </button>
                            <button
                              onClick={() => handleAction("reject")}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-orange-300 py-2.5 text-sm font-medium text-orange-600 hover:bg-orange-50"
                            >
                              <RotateCcw className="h-4 w-4" />
                              打回修改
                            </button>
                          </div>
                        </>
                      )}
                      {selected.currentStep === "评审" && (
                        <>
                          <p className="text-xs font-medium text-gray-500 mb-2">评审人操作</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAction("pass")}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700"
                            >
                              <ThumbsUp className="h-4 w-4" />
                              通过
                            </button>
                            <button
                              onClick={() => handleAction("reject")}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-orange-300 py-2.5 text-sm font-medium text-orange-600 hover:bg-orange-50"
                            >
                              <RotateCcw className="h-4 w-4" />
                              打回修改
                            </button>
                          </div>
                        </>
                      )}
                      {selected.currentStep === "批准" && (
                        <>
                          <p className="text-xs font-medium text-gray-500 mb-2">批准人操作</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAction("approve")}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              批准
                            </button>
                            <button
                              onClick={() => handleAction("deny")}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-300 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                            >
                              <XCircle className="h-4 w-4" />
                              驳回
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {selected.status !== "审核中" && (
                    <div className="rounded-xl bg-gray-50 p-3 text-center">
                      <p className="text-xs text-gray-400">
                        {selected.status === "已批准"
                          ? "文件已批准，审批流程完成"
                          : selected.status === "草稿"
                            ? "草稿阶段，提交审核后开始流程"
                            : "文件已作废"}
                      </p>
                    </div>
                  )}

                  {/* E-signature note */}
                  <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-3">
                    <div className="flex items-start gap-2">
                      <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <p className="text-xs text-gray-400">
                        所有审批操作均记录电子签名，具有法律效力，不可篡改。
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "history" && (
                <div className="flex-1 overflow-y-auto p-4">
                  {selected.history.length === 0 ? (
                    <div className="rounded-xl bg-gray-50 p-6 text-center">
                      <p className="text-xs text-gray-400">暂无版本历史</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selected.history.map((h, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="rounded bg-blue-100 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
                              {h.version}
                            </span>
                            <span className="text-xs text-gray-400">{h.date}</span>
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-1 text-xs">
                            <span className="text-gray-400">修改人：</span>
                            <span className="text-gray-700">{h.editor}</span>
                            <span className="text-gray-400">修改原因：</span>
                            <span className="text-gray-700">{h.reason}</span>
                          </div>
                          <p className="mt-1.5 text-xs text-gray-500 bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                            {h.summary}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
