import React, { useState } from "react";
import { Copy, Download, FileText, RefreshCw, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type InputMode = "paste" | "upload";

interface VersionOutput {
  label: string;
  sublabel: string;
  charTarget: number;
  content: string;
}

const mockVersions: VersionOutput[] = [
  {
    label: "50字版",
    sublabel: "微信一句话结论",
    charTarget: 50,
    content: "Q1 销售额达 2,180 万，同比增长 34%，海外市占率提升至 43%；建议 Q2 重点加码墨西哥与东南亚分销渠道建设。",
  },
  {
    label: "100字版",
    sublabel: "会前预读版",
    charTarget: 100,
    content:
      "Q1 总销售额 2,180 万元，同比增长 34%，超出目标 8%。海外市场贡献 43%，较去年提升 11 个百分点，墨西哥单市场同比增长 67%。国内市场受竞争加剧影响增速放缓至 12%。建议 Q2 聚焦海外分销渠道扩张，同时针对国内大客户推出专属服务方案以巩固市占率。",
  },
  {
    label: "300字版",
    sublabel: "完整汇报版",
    charTarget: 300,
    content:
      "【Q1 销售业绩汇报摘要】\n\n本季度总销售额达 2,180 万元，同比增长 34%，超出季度目标 8 个百分点，创历史单季新高。\n\n海外市场表现突出，贡献占比提升至 43%（去年同期 32%）。其中墨西哥市场受益于当地分销商渠道整合，实现同比增长 67%，成为最大海外单一市场。东南亚市场稳步增长 28%，欧洲市场受 CE MDR 换证周期影响增速放缓至 9%。\n\n国内市场受到低价竞品冲击，增速降至 12%，主要集中在二三线城市终端渗透不足。三家核心大客户续约谈判顺利推进，合同金额合计 320 万元。\n\n【主要风险】欧洲 MDR 换证预计 Q2 末完成，届前存在发货受阻风险；原材料成本较去年上涨约 7%，毛利率压力需持续关注。\n\n【建议与下一步行动】Q2 重点部署墨西哥第二批经销商签约（目标新增 3 家）；启动东南亚区域仓建设方案；国内推出大客户专属响应服务包，目标将核心客户续约率从 78% 提升至 90%。",
  },
];

const structuredReport = {
  conclusion: "Q1 销售额超目标 8%，海外市占率创新高，建议 Q2 加速海外渠道布局。",
  evidence: [
    "总销售额 2,180 万元，同比 +34%，超目标 8%",
    "海外占比提升至 43%（去年 32%），墨西哥 +67%",
    "国内增速 12%，受低价竞品冲击有所放缓",
    "欧洲 MDR 换证 Q2 末完成，存在短期发货风险",
    "原材料成本上涨约 7%，毛利率承压",
  ],
  actions: [
    "Q2 墨西哥新增 3 家经销商签约",
    "启动东南亚区域仓建设方案评估",
    "国内大客户专属服务包：目标续约率 78% → 90%",
    "欧洲 MDR 换证进度周跟踪，备货方案提前锁定",
  ],
};

const mockPastedContent = `本季度我们总销售额达到了 2180 万人民币，与去年同期相比增长了 34%，超出了我们季度目标 8 个百分点。
海外市场方面，墨西哥市场表现非常好，同比增长 67%，东南亚也增长了 28%。欧洲市场因为认证换证的原因增速放缓到 9%。
国内市场受到低价竞争对手的冲击，增速只有 12%。
主要风险是欧洲 MDR 换证还没完成，另外原材料涨价了大约 7%，毛利会有压力。
下一步计划 Q2 要在墨西哥新开 3 家经销商，同时考虑在东南亚建立区域仓库。国内要推出大客户专属服务方案，把续约率从 78% 提升到 90%。`;

export function ReportCompressionPage() {
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [pasteText, setPasteText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [versions, setVersions] = useState<VersionOutput[] | null>(null);

  const handleGenerate = () => {
    if (inputMode === "paste" && !pasteText.trim()) {
      toast.error("请先粘贴原始材料");
      return;
    }
    setIsGenerating(true);
    setTimeout(() => {
      setVersions(mockVersions);
      setIsGenerating(false);
      toast.success("已生成三版压缩摘要");
    }, 1400);
  };

  const handleDemo = () => {
    setPasteText(mockPastedContent);
    toast.info("已填入示例内容");
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-gray-50 min-h-full">
      {/* Input Row */}
      <div className="flex gap-4">
        {/* Input Area */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <h2 className="font-semibold text-gray-800 text-sm">汇报材料压缩辅助</h2>
            <div className="ml-auto flex gap-1">
              {(["paste", "upload"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setInputMode(mode)}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-lg font-medium transition-colors",
                    inputMode === mode
                      ? "bg-orange-50 text-orange-600 border border-orange-200"
                      : "text-gray-500 hover:bg-gray-50"
                  )}
                >
                  {mode === "paste" ? "粘贴文本" : "上传文件"}
                </button>
              ))}
            </div>
          </div>

          {inputMode === "paste" ? (
            <textarea
              className="w-full h-36 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 placeholder:text-gray-300 leading-relaxed"
              placeholder="将原始汇报材料、周报、数据摘要等粘贴到此处..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
          ) : (
            <div className="h-36 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-orange-300 hover:bg-orange-50 transition-colors cursor-pointer">
              <Upload className="w-8 h-8 opacity-40" />
              <p className="text-sm">拖拽文件至此，或点击上传</p>
              <p className="text-xs opacity-60">支持 PDF、Word、TXT，可多文件</p>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleDemo}
              className="text-xs text-gray-400 hover:text-gray-600 underline-offset-2 underline"
            >
              填入示例内容
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="ml-auto flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  提炼中...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  AI 压缩提炼
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Three-Version Output */}
      {versions && (
        <div className="grid grid-cols-3 gap-4">
          {versions.map((v) => (
            <div key={v.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-gray-800 text-sm">{v.label}</div>
                  <div className="text-xs text-gray-400">{v.sublabel}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    v.content.length <= v.charTarget
                      ? "bg-green-50 text-green-600"
                      : "bg-orange-50 text-orange-600"
                  )}>
                    {v.content.replace(/\n/g, "").length} 字
                  </span>
                </div>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed flex-1 whitespace-pre-line">{v.content}</p>
              <div className="flex gap-2 pt-1 border-t border-gray-50">
                <button
                  onClick={() => { navigator.clipboard.writeText(v.content); toast.success(`${v.label}已复制`); }}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <Copy className="w-3 h-3" /> 复制
                </button>
                <button
                  onClick={() => toast.info("重新生成中...")}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> 重新生成
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Structured Report */}
      {versions && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-orange-500" />
              <h3 className="font-semibold text-gray-800 text-sm">结构化汇报稿</h3>
              <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">结论 → 数据/依据 → 建议与下一步</span>
            </div>
            <button
              onClick={() => toast.success("已导出 Word 文档")}
              className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <Download className="w-3 h-3" /> 导出 Word
            </button>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Conclusion */}
            <div className="border-l-4 border-orange-400 pl-4">
              <div className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-2">结论</div>
              <p className="text-sm font-semibold text-gray-800 leading-relaxed">{structuredReport.conclusion}</p>
            </div>

            {/* Evidence */}
            <div className="border-l-4 border-blue-300 pl-4">
              <div className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-2">数据 / 依据</div>
              <ul className="space-y-1.5">
                {structuredReport.evidence.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="w-4 h-4 rounded-full bg-blue-50 text-blue-500 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">
                      {i + 1}
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div className="border-l-4 border-green-400 pl-4">
              <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">建议与下一步</div>
              <ul className="space-y-1.5">
                {structuredReport.actions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="w-4 h-4 rounded-full bg-green-50 text-green-600 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                      →
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
