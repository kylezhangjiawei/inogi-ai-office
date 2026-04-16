import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Scale,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type RiskLevel = "高" | "中" | "低";
type ContractType = "采购合同" | "服务合同" | "合作协议" | "NDA" | "代理协议";
type Stance = "以我方主导" | "对等协商";

interface Clause {
  id: string;
  title: string;
  content: string;
  extracted: string;
}

interface RiskItem {
  id: string;
  level: RiskLevel;
  clauseTitle: string;
  reason: string;
  originalText: string;
  suggestion: string;
  adopted: boolean;
}

const mockClauses: Clause[] = [
  { id: "c1", title: "付款条件", content: "乙方应在合同签署后 90 天内完成付款。", extracted: "账期 90 天" },
  { id: "c2", title: "交付标准", content: "乙方提供的服务须符合 ISO/IEC 27001 信息安全管理标准。", extracted: "ISO/IEC 27001 认证" },
  { id: "c3", title: "验收条款", content: "甲方在收到交付物后 30 天内完成验收，逾期视为自动接受。", extracted: "30 天验收 / 逾期自动接受" },
  { id: "c4", title: "违约责任", content: "任一方违约，须支付合同总金额 5% 的违约金。", extracted: "5% 违约金（双向对等）" },
  { id: "c5", title: "知识产权", content: "在合同期间及终止后 5 年内，双方均不得向第三方披露对方商业秘密。", extracted: "保密期 5 年" },
  { id: "c6", title: "保密范围", content: "保密信息包括但不限于技术资料、商业计划、客户列表及定价信息。", extracted: "技术 / 商业 / 客户信息" },
  { id: "c7", title: "合同期限", content: "本协议自签署之日起生效，有效期为 2 年，到期可续签。", extracted: "2 年 / 到期可续签" },
  { id: "c8", title: "终止条件", content: "任一方提前 30 天书面通知对方，可无理由终止本协议。", extracted: "30 天无理由终止" },
  { id: "c9", title: "争议解决", content: "本协议适用英国法律，争议由英国仲裁院仲裁解决。", extracted: "英国法律 / 英国仲裁院" },
];

const mockRisks: RiskItem[] = [
  {
    id: "r1",
    level: "高",
    clauseTitle: "争议解决",
    reason:
      "约定适用英国法律并在英国仲裁，对我方极为不利：诉讼成本高、周期长，且我方对英国法律体系不熟悉，建议改为中国法律或第三方中立仲裁。",
    originalText: "本协议适用英国法律，争议由英国仲裁院仲裁解决。",
    suggestion:
      "本协议适用中华人民共和国法律，双方发生争议应友好协商解决；协商不成的，提交中国国际经济贸易仲裁委员会（CIETAC）北京分会仲裁解决。",
    adopted: false,
  },
  {
    id: "r2",
    level: "中",
    clauseTitle: "终止条件",
    reason:
      "对方享有 30 天无理由终止权，对我方项目投入存在较大风险。建议增加我方损失补偿条款，或将无理由终止窗口延长至 90 天。",
    originalText: "任一方提前 30 天书面通知对方，可无理由终止本协议。",
    suggestion:
      "任一方提前 90 天书面通知对方，可无理由终止本协议。提前终止方须向另一方支付剩余合同期内预期收益 30% 作为补偿。",
    adopted: false,
  },
  {
    id: "r3",
    level: "中",
    clauseTitle: "验收条款",
    reason:
      "「逾期视为自动接受」条款存在法律风险，若交付物存在隐性缺陷而我方未能及时发现，将丧失索赔权利。建议删除自动接受条款。",
    originalText: "甲方在收到交付物后 30 天内完成验收，逾期视为自动接受。",
    suggestion:
      "甲方在收到交付物后 30 天内完成验收，并出具书面验收报告。验收期间甲方可提出合理修改意见，乙方须在 10 个工作日内完成整改。",
    adopted: false,
  },
];

const contractInfo = {
  name: "NorthPeak 保密协议（NDA）",
  type: "NDA" as ContractType,
  party: "NorthPeak Technologies Ltd.",
  date: "2026-04-16",
  amount: "N/A",
  duration: "2 年",
};

const clauseTypeBadge: Record<ContractType, string> = {
  采购合同: "bg-blue-50 text-blue-700",
  服务合同: "bg-violet-50 text-violet-700",
  合作协议: "bg-teal-50 text-teal-700",
  NDA: "bg-amber-50 text-amber-700",
  代理协议: "bg-rose-50 text-rose-700",
};

const riskBadge: Record<RiskLevel, string> = {
  高: "bg-rose-50 text-rose-700 border-rose-200",
  中: "bg-amber-50 text-amber-700 border-amber-200",
  低: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

const overallBadge = {
  "建议签署": "bg-emerald-50 text-emerald-700",
  "修改后签署": "bg-amber-50 text-amber-700",
  "建议不签署": "bg-rose-50 text-rose-700",
} as const;

// ─── Sub-components ───────────────────────────────────────────────────────────

function ClauseAccordion({ clauses }: { clauses: Clause[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      {clauses.map((c) => (
        <div key={c.id} className="rounded-lg border border-slate-100 bg-slate-50">
          <button
            type="button"
            onClick={() => setOpenId(openId === c.id ? null : c.id)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="text-sm font-medium text-slate-700">{c.title}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{c.extracted}</span>
              {openId === c.id ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </div>
          </button>
          {openId === c.id && (
            <div className="border-t border-slate-100 px-4 pb-3 pt-2">
              <p className="text-xs leading-6 text-slate-600">{c.content}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ContractReviewPage() {
  const [uploaded, setUploaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"全部" | RiskLevel>("全部");
  const [stance, setStance] = useState<Stance>("以我方主导");
  const [risks, setRisks] = useState<RiskItem[]>(mockRisks);
  const [expandedRisk, setExpandedRisk] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);

  const handleUpload = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setUploaded(true);
      toast.success("合同解析完成，已识别类型：NDA，发现 3 处风险条款");
    }, 2000);
  };

  const handleAdopt = (id: string) => {
    setRisks((prev) => prev.map((r) => (r.id === id ? { ...r, adopted: true } : r)));
    toast.success("已采纳修改建议，可在导出时生成红线版本");
  };

  const filteredRisks = riskFilter === "全部" ? risks : risks.filter((r) => r.level === riskFilter);

  const highRiskCount = risks.filter((r) => r.level === "高").length;
  const overallVerdict: keyof typeof overallBadge =
    highRiskCount >= 2 ? "建议不签署" : highRiskCount === 1 ? "修改后签署" : "建议签署";

  const top3Risks = [...risks].sort((a, b) => {
    const order: Record<RiskLevel, number> = { 高: 0, 中: 1, 低: 2 };
    return order[a.level] - order[b.level];
  }).slice(0, 3);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">合同 AI 审查</h1>
          <p className="text-sm text-slate-500">风险扫描 · 条款提取 · 修改建议</p>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[30%_35%_35%]">
        {/* Left: Upload + Clause Extraction */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-800">合同上传 · 类型识别</h2>

          {/* Upload Area */}
          {!uploaded ? (
            <div
              className={cn(
                "mb-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 transition-colors",
                isProcessing
                  ? "border-violet-200 bg-violet-50"
                  : "cursor-pointer border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50",
              )}
              onClick={!isProcessing ? handleUpload : undefined}
            >
              {isProcessing ? (
                <>
                  <div className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
                  <p className="text-sm font-medium text-violet-600">AI 解析中…</p>
                  <p className="mt-1 text-xs text-violet-400">识别条款结构</p>
                </>
              ) : (
                <>
                  <Upload className="mb-3 h-10 w-10 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">点击上传合同文件</p>
                  <p className="mt-1 text-xs text-slate-400">支持 PDF / Word (.docx)</p>
                </>
              )}
            </div>
          ) : (
            <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-white">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{contractInfo.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{contractInfo.party}</div>
                  </div>
                </div>
                <span className={cn("rounded-full px-3 py-1 text-xs font-bold", clauseTypeBadge[contractInfo.type])}>
                  {contractInfo.type}
                </span>
              </div>
            </div>
          )}

          {/* Key Clause Extraction Accordion */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              <span className="text-sm font-semibold text-slate-700">关键条款提取</span>
              {!uploaded && <span className="text-xs text-slate-400">（上传后自动提取）</span>}
            </div>
            {uploaded ? (
              <ClauseAccordion clauses={mockClauses} />
            ) : (
              <div className="space-y-1.5">
                {mockClauses.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-dashed border-slate-100 bg-slate-50 px-4 py-2.5">
                    <span className="text-sm text-slate-400">{c.title}</span>
                    <span className="text-xs text-slate-300">待提取</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: Risk Scan */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              <h2 className="font-semibold text-slate-800">风险扫描</h2>
            </div>
            {uploaded ? (
              <div className="mt-3">
                <span className="rounded-full bg-rose-50 px-3 py-1 text-sm font-bold text-rose-700">
                  发现 {risks.length} 处风险条款
                </span>
              </div>
            ) : (
              <div className="mt-3">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
                  请先上传合同文件
                </span>
              </div>
            )}
          </div>

          {/* Risk Level Filter */}
          <div className="mb-4 flex flex-wrap gap-2">
            {(["全部", "高", "中", "低"] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setRiskFilter(lvl)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  riskFilter === lvl
                    ? "border-violet-200 bg-violet-50 text-violet-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                )}
              >
                {lvl === "全部" ? "全部等级" : `${lvl}风险`}
              </button>
            ))}
          </div>

          {/* Risk List */}
          {uploaded ? (
            <div className="space-y-3">
              {filteredRisks.map((risk) => (
                <div
                  key={risk.id}
                  className={cn(
                    "rounded-xl border p-4",
                    risk.level === "高"
                      ? "border-rose-100 bg-rose-50/50"
                      : risk.level === "中"
                      ? "border-amber-100 bg-amber-50/50"
                      : "border-yellow-100 bg-yellow-50/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-bold", riskBadge[risk.level])}>
                          {risk.level}风险
                        </span>
                        <span className="text-sm font-semibold text-slate-800">{risk.clauseTitle}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{risk.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedRisk(expandedRisk === risk.id ? null : risk.id)}
                      className="shrink-0 text-slate-400 hover:text-slate-600"
                    >
                      {expandedRisk === risk.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {expandedRisk === risk.id && (
                    <div className="mt-3 rounded-lg border border-slate-100 bg-white p-3">
                      <div className="mb-1 text-xs font-semibold text-slate-500">原文</div>
                      <p className="text-xs leading-5 text-slate-700">{risk.originalText}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 py-16">
              <AlertTriangle className="mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-400">上传合同后自动扫描风险</p>
            </div>
          )}
        </div>

        {/* Right: Modification Suggestions */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold text-slate-800">修改建议</h2>

            {/* Stance Toggle */}
            <div className="mt-3 flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(["以我方主导", "对等协商"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStance(s)}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors",
                    stance === s
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {uploaded ? (
            <div className="space-y-4">
              {risks
                .filter((r) => r.level === "高" || r.level === "中")
                .map((risk) => (
                  <div key={risk.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-bold", riskBadge[risk.level])}>
                          {risk.level}
                        </span>
                        <span className="text-sm font-semibold text-slate-800">{risk.clauseTitle}</span>
                      </div>
                      {risk.adopted && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          已采纳
                        </span>
                      )}
                    </div>

                    {/* Side-by-side comparison */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="mb-1 text-xs font-semibold text-rose-500">原文</div>
                        <div className="rounded-lg border border-rose-100 bg-rose-50 p-2.5 text-xs leading-5 text-slate-700">
                          {risk.originalText}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-semibold text-emerald-600">
                          建议{stance === "以我方主导" ? "（我方主导）" : "（对等版）"}
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5 text-xs leading-5 text-slate-700">
                          {stance === "以我方主导"
                            ? risk.suggestion
                            : risk.suggestion.replace("我方", "双方").replace("我们", "双方")}
                        </div>
                      </div>
                    </div>

                    {!risk.adopted && (
                      <button
                        type="button"
                        onClick={() => handleAdopt(risk.id)}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-xs font-semibold text-white hover:bg-violet-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        采纳建议
                      </button>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 py-16">
              <Sparkles className="mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-400">上传合同后生成修改建议</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Collapsible Executive Summary */}
      <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setSummaryOpen((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-4"
        >
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500" />
            <span className="font-semibold text-slate-800">执行摘要</span>
            {uploaded && (
              <span className={cn("ml-2 rounded-full px-3 py-0.5 text-xs font-bold", overallBadge[overallVerdict])}>
                {overallVerdict}
              </span>
            )}
          </div>
          {summaryOpen ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {summaryOpen && (
          <div className="border-t border-slate-100 px-6 pb-6 pt-5">
            {uploaded ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                {/* Contract Info */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">合同基本信息</h3>
                  <div className="space-y-2">
                    {[
                      ["合同名称", contractInfo.name],
                      ["对方主体", contractInfo.party],
                      ["合同类型", contractInfo.type],
                      ["签署日期", contractInfo.date],
                      ["合同期限", contractInfo.duration],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="text-right text-xs font-medium text-slate-800">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top 3 Risks */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">核心风险 TOP 3</h3>
                  <div className="space-y-2">
                    {top3Risks.map((risk, idx) => (
                      <div key={risk.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={cn("rounded-full border px-1.5 py-0.5 text-xs font-bold", riskBadge[risk.level])}>
                              {risk.level}
                            </span>
                            <span className="text-xs font-semibold text-slate-700">{risk.clauseTitle}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 leading-5">{risk.reason.slice(0, 60)}…</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Overall Assessment */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">整体评估</h3>
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center rounded-xl border-2 py-8",
                      overallVerdict === "建议签署"
                        ? "border-emerald-200 bg-emerald-50"
                        : overallVerdict === "修改后签署"
                        ? "border-amber-200 bg-amber-50"
                        : "border-rose-200 bg-rose-50",
                    )}
                  >
                    {overallVerdict === "建议签署" ? (
                      <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-500" />
                    ) : overallVerdict === "修改后签署" ? (
                      <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
                    ) : (
                      <X className="mb-3 h-10 w-10 text-rose-500" />
                    )}
                    <span
                      className={cn(
                        "text-lg font-bold",
                        overallVerdict === "建议签署"
                          ? "text-emerald-700"
                          : overallVerdict === "修改后签署"
                          ? "text-amber-700"
                          : "text-rose-700",
                      )}
                    >
                      {overallVerdict}
                    </span>
                    <p className="mt-2 max-w-xs text-center text-xs text-slate-500">
                      {overallVerdict === "建议签署"
                        ? "合同条款整体风险可控，建议直接签署。"
                        : overallVerdict === "修改后签署"
                        ? "存在中高风险条款，建议采纳 AI 建议后再行签署。"
                        : "存在多处高风险条款，建议暂缓签署并与对方重新协商。"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-10 text-sm text-slate-400">
                上传合同后自动生成执行摘要
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
