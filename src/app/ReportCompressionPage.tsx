import React, { useMemo, useState } from "react";
import {
  Copy,
  Download,
  FileText,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

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
  {
    label: "50字版",
    sublabel: "适合领导即看即懂",
    charTarget: 50,
    content: "Q1 销售额 2,180 万，同比增长 34%，海外占比升至 43%，建议 Q2 聚焦墨西哥与东南亚渠道加速。",
  },
  {
    label: "100字版",
    sublabel: "适合会前预读",
    charTarget: 100,
    content:
      "Q1 总销售额 2,180 万，同比增长 34%，超季度目标 8%。海外市场贡献 43%，其中墨西哥同比增长 67%，东南亚增长 28%。国内市场受低价竞争影响增速放缓至 12%。建议 Q2 加快海外渠道建设，并对国内重点客户推出定制化服务包。",
  },
  {
    label: "300字版",
    sublabel: "适合正式汇报",
    charTarget: 300,
    content:
      "Q1 总销售额达到 2,180 万元，同比增长 34%，超季度目标 8 个百分点。海外市场表现突出，收入占比升至 43%，其中墨西哥渠道同比增长 67%，东南亚增长 28%。国内市场增速放缓至 12%，主要受低价竞争影响。当前风险集中在欧洲 MDR 换证进度和原材料成本上涨两方面。建议 Q2 继续扩展墨西哥与东南亚渠道，提前锁定欧洲备货方案，并针对国内重点客户推出专属服务包，提升续约与复购表现。",
  },
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

const demoContent =
  "Q1 总销售额达到 2,180 万元，同比增长 34%，超出季度目标 8 个百分点。海外市场表现亮眼，其中墨西哥渠道同比增长 67%，东南亚增长 28%，海外收入占比升至 43%。国内市场增速降至 12%，主要受低价竞争影响。欧洲 MDR 换证仍在推进，原材料成本上涨 7%，对毛利有压力。Q2 计划继续扩展墨西哥渠道，并评估东南亚区域仓方案，同时针对国内重点客户推出专属服务包。";

export function ReportCompressionPage() {
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [compressionMode, setCompressionMode] = useState<CompressionMode>("经营汇报");
  const [pasteText, setPasteText] = useState("");
  const [versions, setVersions] = useState<VersionOutput[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const ratio = useMemo(() => {
    if (!versions || !pasteText.trim()) return null;
    const sourceLength = pasteText.length;
    const shortest = Math.min(...versions.map((item) => item.content.length));
    return `${Math.max(1, Math.round(sourceLength / Math.max(shortest, 1)))}:1`;
  }, [versions, pasteText]);

  const handleGenerate = () => {
    if (inputMode === "paste" && !pasteText.trim()) {
      toast.error("请先输入原始材料。");
      return;
    }
    setIsGenerating(true);
    window.setTimeout(() => {
      setVersions(mockVersions);
      setIsGenerating(false);
      toast.success("已生成三档压缩结果。");
    }, 1000);
  };

  return (
    <div className="flex h-full min-h-0 gap-4 bg-slate-50 p-4">
      <aside className="flex w-[360px] flex-shrink-0 flex-col gap-4">
        <section className="material-card p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-orange-500" />
            <h2 className="text-sm font-semibold text-slate-800">汇报材料压缩</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">支持经营汇报、周报和会议纪要三类场景，把长内容快速收敛成可读版本。</p>

          <div className="mt-4 flex gap-2">
            {(["paste", "upload"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setInputMode(mode)}
                className={cn(
                  "rounded-2xl px-3 py-2 text-sm font-medium transition",
                  inputMode === mode ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-500",
                )}
              >
                {mode === "paste" ? "粘贴文本" : "上传文件"}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(["经营汇报", "周报", "会议纪要"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setCompressionMode(item)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition",
                  compressionMode === item ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-500",
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {inputMode === "paste" ? (
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="粘贴原始汇报内容、长邮件、会议纪要或周报正文"
              className="mt-4 h-40 w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-orange-300 focus:bg-white"
            />
          ) : (
            <div className="mt-4 flex h-40 flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-slate-200 bg-slate-50 text-slate-400">
              <Upload className="h-8 w-8" />
              <p className="mt-3 text-sm">拖拽或点击上传 PDF / Word / TXT</p>
              <p className="mt-1 text-xs">当前为演示态，会生成示例压缩结果</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => setPasteText(demoContent)} className="material-button-secondary">
              填入示例
            </button>
            <button onClick={handleGenerate} disabled={isGenerating} className="material-button-primary ml-auto">
              {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              开始压缩
            </button>
          </div>
        </section>

        <section className="material-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">最近任务</h3>
            <Link to="/meeting" className="material-button-secondary text-xs">
              去会议纪要
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {historyItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setCompressionMode(item.mode);
                  setPasteText(demoContent);
                  toast.info(`已加载历史任务：${item.title}`);
                }}
                className="w-full rounded-[24px] border border-slate-100 bg-slate-50/80 p-4 text-left transition hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">{item.mode}</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {item.owner} · {item.updatedAt}
                </div>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="grid min-w-0 flex-1 grid-cols-12 gap-4">
        <section className="col-span-12 xl:col-span-8">
          <div className="material-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">压缩结果</h3>
                <p className="mt-1 text-sm text-slate-500">同时输出短版、中版和正式版，方便按汇报场景直接选用。</p>
              </div>
              <div className="flex items-center gap-2">
                {ratio && <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">压缩比 {ratio}</span>}
                <button
                  onClick={() => setExportOpen(true)}
                  disabled={!versions}
                  className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  导出预览
                </button>
              </div>
            </div>

            {versions ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                {versions.map((item) => (
                  <div key={item.label} className="rounded-[28px] border border-slate-100 bg-slate-50/80 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{item.label}</div>
                        <div className="mt-1 text-xs text-slate-400">{item.sublabel}</div>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-medium",
                          item.content.length <= item.charTarget ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600",
                        )}
                      >
                        {item.content.length} / {item.charTarget}
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-slate-700">{item.content}</p>
                    <div className="mt-5 flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(item.content);
                          toast.success(`${item.label} 已复制。`);
                        }}
                        className="material-button-secondary text-xs"
                      >
                        <Copy className="h-4 w-4" />
                        复制
                      </button>
                      <button onClick={handleGenerate} className="material-button-secondary text-xs">
                        <RefreshCw className="h-4 w-4" />
                        重算
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 flex h-80 items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-white text-center">
                <div>
                  <FileText className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm text-slate-400">生成后会在这里展示三档压缩版本。</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="col-span-12 xl:col-span-4">
          <div className="material-card h-full p-6">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-orange-500" />
              <h3 className="text-sm font-semibold text-slate-800">结构化摘要</h3>
            </div>
            <div className="mt-4 rounded-[24px] bg-slate-50/80 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Conclusion</div>
              <p className="mt-2 text-sm font-semibold leading-7 text-slate-800">{structuredReport.conclusion}</p>
            </div>
            <div className="mt-4 rounded-[24px] bg-slate-50/80 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Evidence</div>
              <div className="mt-3 space-y-2">
                {structuredReport.evidence.map((item) => (
                  <div key={item} className="text-sm leading-6 text-slate-600">
                    • {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 rounded-[24px] bg-slate-50/80 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Actions</div>
              <div className="mt-3 space-y-2">
                {structuredReport.actions.map((item) => (
                  <div key={item} className="text-sm leading-6 text-slate-600">
                    • {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {exportOpen && versions && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/20 p-4" onClick={() => setExportOpen(false)}>
          <div className="w-full max-w-3xl rounded-[28px] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">导出预览</h3>
                <p className="mt-1 text-sm text-slate-500">确认导出格式后，可将三档摘要和结构化摘要一起输出。</p>
              </div>
              <button onClick={() => setExportOpen(false)} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500">
                关闭
              </button>
            </div>
            <div className="mt-5 rounded-[24px] bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-800">{compressionMode} · 导出包</div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>• 三档压缩结果（50 / 100 / 300 字）</div>
                <div>• 结构化摘要（结论 / 依据 / 建议）</div>
                <div>• 原文与压缩比统计</div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setExportOpen(false)} className="material-button-secondary">
                返回
              </button>
              <button
                onClick={() => {
                  setExportOpen(false);
                  toast.success("Word 导出已触发。");
                }}
                className="material-button-primary"
              >
                <Download className="h-4 w-4" />
                导出 Word
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
