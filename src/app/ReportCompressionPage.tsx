import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  FileText,
  History,
  RefreshCw,
  Scissors,
  Sparkles,
  Upload,
} from "lucide-react";
import { Link } from "react-router";
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
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import { routePath } from "./lib/routePaths";

type InputMode = "paste" | "upload";
type CompressionMode = "周报" | "经营汇报" | "会议纪要";

type VersionOutput = {
  label: string;
  sublabel: string;
  charTarget: number;
  content: string;
};

type TaskHistory = {
  id: string;
  title: string;
  mode: CompressionMode;
  updatedAt: string;
  owner: string;
};

const mockVersions: VersionOutput[] = [
  { label: "50字版", sublabel: "适合领导即看即懂", charTarget: 50, content: "Q1 销售额 2,180 万，同比增长 34%，海外占比升至 43%，建议 Q2 聚焦墨西哥与东南亚渠道加速。" },
  { label: "100字版", sublabel: "适合会前预读", charTarget: 100, content: "Q1 总销售额 2,180 万，同比增长 34%，超季度目标 8%。海外市场贡献 43%，其中墨西哥同比增长 67%，东南亚增长 28%。国内市场受低价竞争影响增速放缓至 12%。建议 Q2 加快海外渠道建设，并对国内重点客户推出定制化服务包。" },
  { label: "300字版", sublabel: "适合正式汇报", charTarget: 300, content: "Q1 总销售额达到 2,180 万元，同比增长 34%，超季度目标 8 个百分点。海外市场表现突出，收入占比升至 43%，其中墨西哥渠道同比增长 67%，东南亚增长 28%。国内市场增速放缓至 12%，主要受低价竞争影响。当前风险集中在欧洲 MDR 换证进度和原材料成本上涨两方面。建议 Q2 继续扩展墨西哥与东南亚渠道，提前锁定欧洲备货方案，并针对国内重点客户推出专属服务包，提升续约与复购表现。" },
];

const historyItems: TaskHistory[] = [
  { id: "RC-01", title: "Q1 海外经营汇报压缩", mode: "经营汇报", updatedAt: "今天 11:10", owner: "Luna" },
  { id: "RC-02", title: "法国外贸周报摘要", mode: "周报", updatedAt: "昨天", owner: "Noah" },
  { id: "RC-03", title: "研发例会纪要压缩版", mode: "会议纪要", updatedAt: "2天前", owner: "Mia" },
];

const structuredReport = {
  conclusion: "Q1 经营表现超预期，核心增量来自海外渠道，Q2 应继续强化海外交付与国内重点客户深挖。",
  evidence: [
    "总销售额 2,180 万，同比增长 34%，超季度目标 8%",
    "海外收入占比升至 43%，墨西哥同比增长 67%",
    "国内市场增速降至 12%，主要受低价竞争影响",
    "欧洲 MDR 换证仍在推进，存在短期交付风险",
  ],
  actions: [
    "Q2 新增墨西哥渠道伙伴 3 家",
    "评估东南亚区域仓方案，缩短交付半径",
    "为国内重点客户推出专属服务包",
    "对欧洲换证进度设置每周跟踪和预警",
  ],
};

const demoContent = "Q1 总销售额达到 2,180 万元，同比增长 34%，超出季度目标 8 个百分点。海外市场表现亮眼，其中墨西哥渠道同比增长 67%，东南亚增长 28%，海外收入占比升至 43%。国内市场增速降至 12%，主要受低价竞争影响。欧洲 MDR 换证仍在推进，原材料成本上涨 7%，对毛利有压力。Q2 计划继续扩展墨西哥渠道，并评估东南亚区域仓方案，同时针对国内重点客户推出专属服务包。";

export function ReportCompressionPage() {
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [compressionMode, setCompressionMode] = useState<CompressionMode>("经营汇报");
  const [pasteText, setPasteText] = useState("");
  const [inputError, setInputError] = useState("");
  const [versions, setVersions] = useState<VersionOutput[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const ratio = useMemo(() => {
    if (!versions || !pasteText.trim()) return null;
    const shortest = Math.min(...versions.map((item) => item.content.length));
    return `${Math.max(1, Math.round(pasteText.length / Math.max(shortest, 1)))}:1`;
  }, [versions, pasteText]);

  const useDemoSource = (message = "已填入示例经营汇报。") => {
    setPasteText(demoContent);
    setInputError("");
    toast.success(message);
  };

  const handleGenerate = () => {
    if (!pasteText.trim()) {
      setInputError(inputMode === "paste" ? "请先输入需要压缩的原始材料。" : "请先载入示例文件或切换到粘贴文本。" );
      return;
    }
    setInputError("");
    setIsGenerating(true);
    window.setTimeout(() => {
      setVersions(mockVersions);
      setIsGenerating(false);
      toast.success("已生成三档压缩结果。");
    }, 700);
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Scissors}
        eyebrow="COMMUNICATION · EXECUTIVE BRIEF"
        title="汇报材料压缩"
        description="把经营汇报、周报和会议纪要收敛为多档摘要，并保留结论、证据与行动建议。"
        meta={<><span>支持 3 类业务材料</span><span>·</span><span>输出 50 / 100 / 300 字版本</span><span>·</span><span>{historyItems.length} 条最近任务</span></>}
        actions={<Button asChild variant="outline"><Link to={routePath("page:meeting", "/meeting")}>进入会议纪要<ArrowRight className="size-4" /></Link></Button>}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={FileText} label="原始材料" value={pasteText.length} note="当前字符数" />
        <HorizonMetric Icon={ClipboardList} label="压缩场景" value={compressionMode} note="可随材料切换" />
        <HorizonMetric Icon={BarChart3} label="压缩比" value={ratio ?? "—"} note={versions ? "按最短版本计算" : "生成后自动统计"} tone={ratio ? "success" : "neutral"} />
        <HorizonMetric Icon={versions ? CheckCircle2 : Sparkles} label="输出版本" value={versions?.length ?? 0} note={versions ? "三档结果已就绪" : "等待生成"} tone={versions ? "success" : "neutral"} />
      </HorizonMetricGrid>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="hz-surface min-w-0 overflow-hidden border" aria-label="压缩输入设置">
            <HorizonSectionHeader Icon={Sparkles} title="输入与压缩设置" description="选择来源和场景后生成多档摘要。" />
            <div className="space-y-4 p-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">材料来源</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["paste", "upload"] as const).map((mode) => (
                    <Button key={mode} type="button" variant={inputMode === mode ? "default" : "outline"} className={inputMode === mode ? "hz-primary-action" : ""} aria-pressed={inputMode === mode} onClick={() => { setInputMode(mode); setInputError(""); }}>{mode === "paste" ? "粘贴文本" : "示例文件"}</Button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">材料类型</legend>
                <div className="flex flex-wrap gap-2">
                  {(["经营汇报", "周报", "会议纪要"] as const).map((mode) => (
                    <Button key={mode} type="button" size="sm" variant={compressionMode === mode ? "secondary" : "outline"} className={compressionMode === mode ? "border-blue-200 bg-blue-50 text-[#002fa7]" : ""} aria-pressed={compressionMode === mode} onClick={() => setCompressionMode(mode)}>{mode}</Button>
                  ))}
                </div>
              </fieldset>

              {inputMode === "paste" ? (
                <div className="space-y-2">
                  <Label htmlFor="report-source">原始材料</Label>
                  <Textarea id="report-source" value={pasteText} onChange={(event) => { setPasteText(event.target.value); if (inputError) setInputError(""); }} placeholder="粘贴原始汇报、长邮件、会议纪要或周报正文" className="min-h-48 resize-y bg-slate-50 text-sm leading-6" aria-invalid={Boolean(inputError)} aria-describedby={inputError ? "report-source-error" : "report-source-help"} />
                  {inputError ? <p id="report-source-error" className="text-pretty text-xs text-red-600" role="alert">{inputError}</p> : <p id="report-source-help" className="text-pretty text-xs text-slate-500">当前 {pasteText.length} 字，建议保留关键数据、风险和行动项。</p>}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                  <Upload className="mx-auto size-8 text-[#002fa7]" aria-hidden="true" />
                  <div className="mt-3 font-semibold text-slate-800">使用示例经营汇报文件</div>
                  <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">演示环境以结构化示例代替真实 PDF / Word 解析。</p>
                  <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => useDemoSource("示例文件已载入。")}>载入示例文件</Button>
                  {inputError ? <p className="mt-2 text-pretty text-xs text-red-600" role="alert">{inputError}</p> : null}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => useDemoSource()}>填入示例</Button>
                <Button type="button" className="hz-primary-action sm:ml-auto" onClick={handleGenerate} disabled={isGenerating}>{isGenerating ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}{isGenerating ? "正在压缩" : "开始压缩"}</Button>
              </div>
            </div>
          </section>

          <section className="hz-surface min-w-0 overflow-hidden border" aria-label="最近压缩任务">
            <HorizonSectionHeader Icon={History} title="最近任务" description="载入历史场景继续压缩。" />
            <ul className="divide-y divide-slate-100">
              {historyItems.map((item) => (
                <li key={item.id}>
                  <button type="button" className="w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-slate-50" onClick={() => { setCompressionMode(item.mode); useDemoSource(`已加载历史任务：${item.title}`); }}>
                    <div className="flex items-start justify-between gap-3"><span className="line-clamp-2 text-sm font-semibold text-slate-800">{item.title}</span><span className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500">{item.mode}</span></div>
                    <div className="mt-2 text-xs text-slate-500">{item.owner} · <span className="tabular-nums">{item.updatedAt}</span></div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section className="hz-surface min-w-0 overflow-hidden border" aria-label="压缩结果">
            <HorizonSectionHeader Icon={Scissors} title="压缩结果" description="根据阅读场景选择短版、中版或正式版。" trailing={<div className="flex items-center gap-2">{ratio ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">压缩比 {ratio}</span> : null}<Button type="button" size="sm" variant="outline" disabled={!versions} onClick={() => setExportOpen(true)}><Download className="size-4" />导出</Button></div>} />
            {versions ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 p-4">
                {versions.map((version) => (
                  <article key={version.label} className="flex min-w-0 flex-col rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="font-semibold text-slate-800">{version.label}</h3><p className="mt-1 text-xs text-slate-500">{version.sublabel}</p></div>
                      <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums", version.content.length <= version.charTarget ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{version.content.length} / {version.charTarget}</span>
                    </div>
                    <p className="mt-4 flex-1 text-pretty text-sm leading-6 text-slate-700">{version.content}</p>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(version.content); toast.success(`${version.label} 已复制。`); }}><Copy className="size-4" />复制</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={handleGenerate}><RefreshCw className="size-4" />重算</Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <HorizonEmptyState Icon={FileText} title="尚未生成压缩结果" description="输入原始材料后，系统会同时给出 50、100 和 300 字三个版本。" action={<Button type="button" size="sm" variant="outline" onClick={() => useDemoSource()}>填入示例材料</Button>} />
            )}
          </section>

          <section className="hz-surface min-w-0 overflow-hidden border" aria-label="结构化摘要">
            <HorizonSectionHeader Icon={ClipboardList} title="结构化摘要" description="同步提取结论、证据和下一步行动。" />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-0 divide-y divide-slate-100 p-4 sm:divide-y-0 2xl:divide-x">
              <div className="p-3"><div className="text-xs font-semibold text-[#002fa7]">核心结论</div><p className="mt-2 text-pretty text-sm font-semibold leading-6 text-slate-800">{structuredReport.conclusion}</p></div>
              <div className="p-3"><div className="text-xs font-semibold text-[#002fa7]">关键证据</div><ul className="mt-2 space-y-2">{structuredReport.evidence.map((item) => <li key={item} className="flex gap-2 text-pretty text-xs leading-5 text-slate-600"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#002fa7]" aria-hidden="true" />{item}</li>)}</ul></div>
              <div className="p-3"><div className="text-xs font-semibold text-[#002fa7]">行动建议</div><ul className="mt-2 space-y-2">{structuredReport.actions.map((item) => <li key={item} className="flex gap-2 text-pretty text-xs leading-5 text-slate-600"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#002fa7]" aria-hidden="true" />{item}</li>)}</ul></div>
            </div>
          </section>
        </div>
      </div>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="horizon-portal sm:max-w-xl">
          <DialogHeader><DialogTitle className="text-balance">导出预览</DialogTitle><DialogDescription className="text-pretty">确认导出内容后，将三档摘要与结构化结论一起输出。</DialogDescription></DialogHeader>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="font-semibold text-slate-800">{compressionMode} · 导出包</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-600"><li>三档压缩结果（50 / 100 / 300 字）</li><li>结构化摘要（结论 / 依据 / 建议）</li><li>原文与压缩比统计</li></ul>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setExportOpen(false)}>返回</Button><Button type="button" className="hz-primary-action" onClick={() => { setExportOpen(false); toast.success("Word 导出已触发。"); }}><Download className="size-4" />导出 Word</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
