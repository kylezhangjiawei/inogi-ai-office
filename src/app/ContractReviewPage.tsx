import React, { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSearch,
  FileText,
  ListChecks,
  RotateCcw,
  Scale,
  ShieldAlert,
  Sparkles,
  X,
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
import { cn } from "./components/ui/utils";

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
    reason: "约定适用英国法律并在英国仲裁，对我方极为不利：诉讼成本高、周期长，且我方对英国法律体系不熟悉，建议改为中国法律或第三方中立仲裁。",
    originalText: "本协议适用英国法律，争议由英国仲裁院仲裁解决。",
    suggestion: "本协议适用中华人民共和国法律，双方发生争议应友好协商解决；协商不成的，提交中国国际经济贸易仲裁委员会（CIETAC）北京分会仲裁解决。",
    adopted: false,
  },
  {
    id: "r2",
    level: "中",
    clauseTitle: "终止条件",
    reason: "对方享有 30 天无理由终止权，对我方项目投入存在较大风险。建议增加我方损失补偿条款，或将无理由终止窗口延长至 90 天。",
    originalText: "任一方提前 30 天书面通知对方，可无理由终止本协议。",
    suggestion: "任一方提前 90 天书面通知对方，可无理由终止本协议。提前终止方须向另一方支付剩余合同期内预期收益 30% 作为补偿。",
    adopted: false,
  },
  {
    id: "r3",
    level: "中",
    clauseTitle: "验收条款",
    reason: "「逾期视为自动接受」条款存在法律风险，若交付物存在隐性缺陷而我方未能及时发现，将丧失索赔权利。建议删除自动接受条款。",
    originalText: "甲方在收到交付物后 30 天内完成验收，逾期视为自动接受。",
    suggestion: "甲方在收到交付物后 30 天内完成验收，并出具书面验收报告。验收期间甲方可提出合理修改意见，乙方须在 10 个工作日内完成整改。",
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

const riskBadge: Record<RiskLevel, string> = {
  高: "border-rose-200 bg-rose-50 text-rose-700",
  中: "border-amber-200 bg-amber-50 text-amber-700",
  低: "border-blue-200 bg-blue-50 text-blue-700",
};

const overallBadge = {
  "建议签署": "bg-emerald-50 text-emerald-700",
  "修改后签署": "bg-amber-50 text-amber-700",
  "建议不签署": "bg-rose-50 text-rose-700",
} as const;

function createSampleRisks(): RiskItem[] {
  return mockRisks.map((risk) => ({ ...risk, adopted: false }));
}

function ClauseAccordion({ clauses }: { clauses: Clause[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="divide-y divide-slate-100">
      {clauses.map((clause) => (
        <div key={clause.id}>
          <Button variant="unstyled"
            type="button"
            onClick={() => setOpenId(openId === clause.id ? null : clause.id)}
            aria-expanded={openId === clause.id}
            aria-controls={`contract-clause-${clause.id}`}
            className="flex w-full cursor-pointer items-start justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-[#f7f9ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">{clause.title}</span>
              <span className="mt-1 block text-pretty text-xs leading-5 text-slate-500">{clause.extracted}</span>
            </span>
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
              {openId === clause.id ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </span>
          </Button>
          {openId === clause.id ? (
            <div id={`contract-clause-${clause.id}`} className="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <div className="text-xs font-semibold text-slate-700">示例条款原文</div>
              <p className="mt-1 text-pretty text-xs leading-6 text-slate-600">{clause.content}</p>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ContractReviewPage() {
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"全部" | RiskLevel>("全部");
  const [stance, setStance] = useState<Stance>("以我方主导");
  const [risks, setRisks] = useState<RiskItem[]>(createSampleRisks);
  const [expandedRisk, setExpandedRisk] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);

  const filteredRisks = riskFilter === "全部" ? risks : risks.filter((risk) => risk.level === riskFilter);
  const highRiskCount = risks.filter((risk) => risk.level === "高").length;
  const mediumRiskCount = risks.filter((risk) => risk.level === "中").length;
  const adoptedCount = risks.filter((risk) => risk.adopted).length;
  const riskOrder: Record<RiskLevel, number> = { 高: 0, 中: 1, 低: 2 };
  const overallVerdict: keyof typeof overallBadge =
    highRiskCount >= 2 ? "建议不签署" : highRiskCount === 1 ? "修改后签署" : "建议签署";
  const top3Risks = [...risks].sort((a, b) => riskOrder[a.level] - riskOrder[b.level]).slice(0, 3);

  const loadSampleContract = () => {
    setSampleLoaded(true);
    setRiskFilter("全部");
    setStance("以我方主导");
    setRisks(createSampleRisks());
    setExpandedRisk(null);
    setSummaryOpen(true);
    toast.success("已加载示例合同，可开始演示条款与风险审查");
  };

  const adoptSuggestion = (id: string) => {
    setRisks((current) => current.map((risk) => (risk.id === id ? { ...risk, adopted: true } : risk)));
    toast.success("已在本次演示中采纳该修改建议");
  };

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-4">
        <HorizonPageHeader
          Icon={Scale}
          eyebrow="LEGAL OPERATIONS · CONTRACT REVIEW"
          title="合同 AI 审查"
          description="基于预置示例演示条款提取、风险判断和修改建议；当前未连接真实文件上传或 AI 审查服务。"
          meta={(
            <>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 font-semibold text-primary">演示模式</span>
              <span>数据来源：页面内预置样例</span>
            </>
          )}
          actions={(
            <Button
              type="button"
              variant={sampleLoaded ? "outline" : "default"}
              className={cn(!sampleLoaded && "bg-primary text-white hover:bg-primary-hover")}
              onClick={loadSampleContract}
            >
              {sampleLoaded ? <RotateCcw className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
              {sampleLoaded ? "重新加载示例" : "加载示例合同"}
            </Button>
          )}
        />

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={FileText}
            title="审查入口"
            description="先加载一份预置 NDA 样例，再演示完整的法务审查流程。"
            trailing={sampleLoaded ? <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">示例已加载</span> : undefined}
          />
          {sampleLoaded ? (
            <div className="border-t border-slate-100">
              <dl className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  ["合同名称", contractInfo.name],
                  ["对方主体", contractInfo.party],
                  ["合同类型", contractInfo.type],
                  ["签署日期", contractInfo.date],
                  ["合同期限", contractInfo.duration],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 bg-white px-4 py-3">
                    <dt className="text-xs text-slate-500">{label}</dt>
                    <dd className="mt-1 truncate text-sm font-semibold text-slate-800 tabular-nums" title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex items-start gap-2 border-t border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-900" role="status">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-pretty leading-5">以上内容均为演示数据，不代表已完成真实合同解析，也不构成法律意见。</p>
              </div>
            </div>
          ) : (
            <HorizonEmptyState
              Icon={FileSearch}
              title="尚未加载演示合同"
              description="本页当前仅提供预置样例。加载后可体验条款展开、风险筛选、谈判立场和建议采纳。"
              action={<Button type="button" className="bg-primary text-white hover:bg-primary-hover" onClick={loadSampleContract}><FileText className="size-4" aria-hidden="true" />加载示例合同</Button>}
            />
          )}
        </section>

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={ShieldAlert}
            title="风险概览"
            description={sampleLoaded ? "按当前示例合同统计，点击下方等级可进一步筛选条款。" : "加载示例合同后显示条款和风险统计。"}
            trailing={sampleLoaded ? <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", overallBadge[overallVerdict])}>{overallVerdict}</span> : undefined}
          />
          <HorizonMetricGrid className="rounded-none border-x-0 border-b-0 shadow-none">
            <HorizonMetric Icon={FileText} label="合同类型" value={sampleLoaded ? contractInfo.type : "—"} note="当前演示标的" tone="brand" />
            <HorizonMetric Icon={ListChecks} label="关键条款" value={sampleLoaded ? mockClauses.length : "—"} note="预置提取结果" tone="neutral" />
            <HorizonMetric Icon={AlertTriangle} label="中高风险" value={sampleLoaded ? highRiskCount + mediumRiskCount : "—"} note={sampleLoaded ? `高 ${highRiskCount} · 中 ${mediumRiskCount}` : "待加载示例"} tone="danger" />
            <HorizonMetric Icon={CheckCircle2} label="已采纳建议" value={sampleLoaded ? adoptedCount : "—"} note={sampleLoaded ? `共 ${risks.length} 条风险建议` : "待加载示例"} tone={adoptedCount ? "success" : "neutral"} />
          </HorizonMetricGrid>
        </section>

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={FileSearch}
            title="条款工作区"
            description="左侧查看关键条款，右侧按风险等级处理修改建议。"
          />
          {sampleLoaded ? (
            <div className="grid min-w-0 border-t border-slate-100 xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.45fr)]">
              <aside className="min-w-0 border-b border-slate-100 xl:border-b-0 xl:border-r" aria-label="关键条款">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div>
                    <h3 className="text-balance text-sm font-semibold text-slate-800">关键条款</h3>
                    <p className="mt-1 text-pretty text-xs text-slate-500">展开后查看示例原文。</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 tabular-nums">{mockClauses.length} 条</span>
                </div>
                <ClauseAccordion clauses={mockClauses} />
              </aside>

              <div className="min-w-0">
                <div className="grid gap-3 border-b border-slate-100 bg-white px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div>
                    <div id="contract-risk-filter-label" className="text-xs font-semibold text-slate-700">风险等级</div>
                    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="contract-risk-filter-label">
                      {(["全部", "高", "中", "低"] as const).map((level) => {
                        const active = riskFilter === level;
                        return (
                          <Button
                            key={level}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            aria-pressed={active}
                            className={cn(active && "bg-primary text-white hover:bg-primary-hover")}
                            onClick={() => setRiskFilter(level)}
                          >
                            {level === "全部" ? "全部等级" : `${level}风险`}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div id="contract-stance-label" className="text-xs font-semibold text-slate-700">谈判立场</div>
                    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="contract-stance-label">
                      {(["以我方主导", "对等协商"] as const).map((item) => {
                        const active = stance === item;
                        return (
                          <Button
                            key={item}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            aria-pressed={active}
                            className={cn(active && "bg-primary text-white hover:bg-primary-hover")}
                            onClick={() => setStance(item)}
                          >
                            {item}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {filteredRisks.length ? (
                  <div className="space-y-3 p-3 sm:p-4" aria-live="polite">
                    {filteredRisks.map((risk) => {
                      const suggestion = stance === "以我方主导"
                        ? risk.suggestion
                        : risk.suggestion.replace("我方", "双方").replace("我们", "双方");
                      const expanded = expandedRisk === risk.id;

                      return (
                        <article key={risk.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                          <div className="p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", riskBadge[risk.level])}>{risk.level}风险</span>
                                  <h3 className="text-balance text-sm font-semibold text-slate-900">{risk.clauseTitle}</h3>
                                </div>
                                <p className="mt-2 max-w-4xl text-pretty text-sm leading-6 text-slate-600">{risk.reason}</p>
                              </div>
                              {risk.adopted ? (
                                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                  <CheckCircle2 className="size-3.5" aria-hidden="true" />已采纳
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-expanded={expanded}
                                aria-controls={`contract-risk-original-${risk.id}`}
                                onClick={() => setExpandedRisk(expanded ? null : risk.id)}
                              >
                                {expanded ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                                {expanded ? "收起原文" : "查看原文"}
                              </Button>
                              {!risk.adopted ? (
                                <Button type="button" size="sm" className="bg-primary text-white hover:bg-primary-hover" onClick={() => adoptSuggestion(risk.id)}>
                                  <CheckCircle2 className="size-4" aria-hidden="true" />采纳建议
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          {expanded ? (
                            <div id={`contract-risk-original-${risk.id}`} className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                              <div className="text-xs font-semibold text-slate-700">示例原文</div>
                              <p className="mt-1 text-pretty text-sm leading-6 text-slate-600">{risk.originalText}</p>
                            </div>
                          ) : null}

                          <div className="border-t border-blue-100 bg-blue-50/60 px-4 py-3">
                            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                              <Sparkles className="size-4" aria-hidden="true" />
                              修改建议（{stance}）
                            </div>
                            <p className="mt-2 text-pretty text-sm leading-6 text-slate-700">{suggestion}</p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <HorizonEmptyState
                    Icon={ShieldAlert}
                    title="当前等级没有风险条款"
                    description="可切换到其他风险等级，或恢复查看全部示例结果。"
                    action={<Button type="button" variant="outline" size="sm" onClick={() => setRiskFilter("全部")}>查看全部等级</Button>}
                  />
                )}
              </div>
            </div>
          ) : (
            <HorizonEmptyState
              Icon={ListChecks}
              title="条款工作区待启动"
              description="加载示例合同后，可逐条查看提取结果，并演示风险建议处理。"
              action={<Button type="button" className="bg-primary text-white hover:bg-primary-hover" onClick={loadSampleContract}>加载示例合同</Button>}
            />
          )}
        </section>

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={BadgeCheck}
            title="执行摘要"
            description="汇总合同信息、核心风险和当前演示结论。"
            trailing={(
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={summaryOpen}
                aria-controls="contract-executive-summary"
                onClick={() => setSummaryOpen((current) => !current)}
              >
                {summaryOpen ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                {summaryOpen ? "收起摘要" : "展开摘要"}
              </Button>
            )}
          />

          {summaryOpen ? (
            <div id="contract-executive-summary" className="border-t border-slate-100">
              {sampleLoaded ? (
                <div className="grid min-w-0 xl:grid-cols-3">
                  <div className="min-w-0 border-b border-slate-100 p-4 xl:border-b-0 xl:border-r">
                    <h3 className="text-balance text-sm font-semibold text-slate-800">合同基本信息</h3>
                    <dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {[
                        ["合同名称", contractInfo.name],
                        ["对方主体", contractInfo.party],
                        ["合同类型", contractInfo.type],
                        ["签署日期", contractInfo.date],
                        ["涉及金额", contractInfo.amount],
                        ["合同期限", contractInfo.duration],
                      ].map(([label, value]) => (
                        <div key={label} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[88px_minmax(0,1fr)]">
                          <dt className="text-xs text-slate-500">{label}</dt>
                          <dd className="break-words text-sm font-medium text-slate-800 tabular-nums sm:text-right">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="min-w-0 border-b border-slate-100 p-4 xl:border-b-0 xl:border-r">
                    <h3 className="text-balance text-sm font-semibold text-slate-800">核心风险 TOP 3</h3>
                    <div className="mt-3 space-y-2">
                      {top3Risks.map((risk, index) => (
                        <div key={risk.id} className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 tabular-nums">{index + 1}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", riskBadge[risk.level])}>{risk.level}</span>
                              <span className="text-sm font-semibold text-slate-800">{risk.clauseTitle}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-pretty text-xs leading-5 text-slate-500">{risk.reason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0 p-4">
                    <h3 className="text-balance text-sm font-semibold text-slate-800">整体评估</h3>
                    <div className={cn(
                      "mt-3 flex min-h-52 flex-col items-center justify-center rounded-xl border px-4 py-6 text-center",
                      overallVerdict === "建议签署"
                        ? "border-emerald-200 bg-emerald-50"
                        : overallVerdict === "修改后签署"
                          ? "border-amber-200 bg-amber-50"
                          : "border-rose-200 bg-rose-50",
                    )}>
                      <span className={cn(
                        "flex size-11 items-center justify-center rounded-full bg-white",
                        overallVerdict === "建议签署" ? "text-emerald-600" : overallVerdict === "修改后签署" ? "text-amber-600" : "text-rose-600",
                      )} aria-hidden="true">
                        {overallVerdict === "建议签署" ? <CheckCircle2 className="size-6" /> : overallVerdict === "修改后签署" ? <AlertTriangle className="size-6" /> : <X className="size-6" />}
                      </span>
                      <div className="mt-3 text-balance text-lg font-bold text-slate-900">{overallVerdict}</div>
                      <p className="mt-2 max-w-sm text-pretty text-sm leading-6 text-slate-600">
                        {overallVerdict === "建议签署"
                          ? "示例条款整体风险可控，仍需法务对原文完成人工复核。"
                          : overallVerdict === "修改后签署"
                            ? "存在中高风险示例条款，建议完成谈判修订与法务复核后再签署。"
                            : "存在多处高风险示例条款，建议暂缓签署并重新协商。"}
                      </p>
                      <div className="mt-3 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 tabular-nums">已采纳 {adoptedCount} / {risks.length}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <HorizonEmptyState
                  Icon={BadgeCheck}
                  title="执行摘要待生成"
                  description="加载示例合同后，这里会汇总合同信息、核心风险和演示结论。"
                  action={<Button type="button" variant="outline" onClick={loadSampleContract}>加载示例合同</Button>}
                />
              )}
            </div>
          ) : null}

          {sampleLoaded ? (
            <div className="flex items-start gap-2 border-t border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-pretty leading-5">下一步：由法务人员回到真实合同原文逐条复核，确认谈判口径后再在正式合同系统生成红线版本。</p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
