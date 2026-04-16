import React, { useState } from "react";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Globe,
  Languages,
  Package,
  Plus,
  Send,
  Sparkles,
  Toggle,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface DocFile {
  id: string;
  name: string;
  version: string;
  purpose: string;
  stage: "L1" | "L2" | "L3";
  allowSend: boolean;
  updatedAt: string;
  hasNewVersion?: boolean;
}

const mockDocs: DocFile[] = [
  {
    id: "D001",
    name: "公司介绍册",
    version: "V2.3",
    purpose: "品牌宣传 / 初步了解",
    stage: "L1",
    allowSend: true,
    updatedAt: "2026-04-10",
  },
  {
    id: "D002",
    name: "产品彩页（CPAP系列）",
    version: "V3.1",
    purpose: "产品功能介绍",
    stage: "L1",
    allowSend: true,
    updatedAt: "2026-04-08",
    hasNewVersion: true,
  },
  {
    id: "D003",
    name: "CE 认证证书",
    version: "V1.5",
    purpose: "合规资质证明",
    stage: "L2",
    allowSend: true,
    updatedAt: "2026-03-22",
  },
  {
    id: "D004",
    name: "技术规格说明书",
    version: "V4.0",
    purpose: "深度技术沟通",
    stage: "L2",
    allowSend: false,
    updatedAt: "2026-04-01",
    hasNewVersion: true,
  },
  {
    id: "D005",
    name: "OEM 定制方案模板",
    version: "V1.2",
    purpose: "OEM/ODM 合作洽谈",
    stage: "L2",
    allowSend: true,
    updatedAt: "2026-03-15",
  },
  {
    id: "D006",
    name: "注册申报资料包",
    version: "V2.0",
    purpose: "RA 注册支持材料",
    stage: "L3",
    allowSend: false,
    updatedAt: "2026-02-28",
  },
  {
    id: "D007",
    name: "合同条款范本",
    version: "V1.8",
    purpose: "谈判签约参考",
    stage: "L3",
    allowSend: true,
    updatedAt: "2026-04-05",
  },
  {
    id: "D008",
    name: "客户FAQ（常见问题）",
    version: "V2.6",
    purpose: "售前咨询支持",
    stage: "L1",
    allowSend: true,
    updatedAt: "2026-04-12",
  },
];

const stageColors: Record<string, string> = {
  L1: "bg-blue-100 text-blue-700",
  L2: "bg-purple-100 text-purple-700",
  L3: "bg-orange-100 text-orange-700",
};

const stageLabels: Record<string, string> = {
  L1: "L1 初步接触",
  L2: "L2 深度沟通",
  L3: "L3 谈判签约",
};

type Lang = "中文" | "English" | "Español";

const aiRecommendations: Record<string, string[]> = {
  L1: ["D001", "D002", "D008"],
  L2: ["D003", "D004", "D005"],
  L3: ["D006", "D007", "D005"],
};

const aiReasons: Record<string, string> = {
  D001: "初步接触阶段首选，帮助客户快速建立品牌认知",
  D002: "直观展示核心产品线，引发客户进一步咨询兴趣",
  D008: "解答常见疑虑，降低沟通成本，提升客户信任感",
  D003: "深度沟通阶段需提供合规资质，增强产品可信度",
  D004: "技术规格说明满足客户深度了解产品的需求",
  D005: "OEM方案模板展示定制化合作能力，推进商务谈判",
  D006: "注册申报材料支持客户在目标市场的合规准入",
  D007: "合同范本加速双方条款确认，缩短签约周期",
};

const generateMessage = (docs: DocFile[], lang: Lang): string => {
  const docList = docs.map((d) => `• ${d.name}（${d.version}）`).join("\n");
  if (lang === "中文") {
    return `您好！\n\n感谢您对我司产品的关注。根据我们的沟通情况，现为您整理了以下资料，供参考：\n\n${docList}\n\n如有任何疑问或需要进一步了解，请随时与我们联系。期待与您的深入合作！\n\n此致\nINOGI 销售团队`;
  } else if (lang === "English") {
    return `Dear Valued Customer,\n\nThank you for your interest in INOGI's products. Based on our discussion, please find the following documents prepared for your reference:\n\n${docList}\n\nShould you have any questions or require further information, please do not hesitate to contact us. We look forward to a fruitful collaboration!\n\nBest regards,\nINOGI Sales Team`;
  } else {
    return `Estimado/a Cliente,\n\nGracias por su interés en los productos de INOGI. Según nuestra conversación, le adjuntamos los siguientes documentos para su referencia:\n\n${docList}\n\nSi tiene alguna pregunta o necesita más información, no dude en contactarnos. ¡Esperamos una colaboración fructífera!\n\nAtentamente,\nEquipo de Ventas INOGI`;
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ExternalDocsPage() {
  const [docs, setDocs] = useState<DocFile[]>(mockDocs);
  const [selectedStage, setSelectedStage] = useState<"L1" | "L2" | "L3">("L2");
  const [customQuery, setCustomQuery] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [recommendedIds, setRecommendedIds] = useState<string[]>(aiRecommendations["L2"]);
  const [packageIds, setPackageIds] = useState<string[]>([]);
  const [lang, setLang] = useState<Lang>("中文");
  const [message, setMessage] = useState(() =>
    generateMessage(
      mockDocs.filter((d) => aiRecommendations["L2"].includes(d.id)),
      "中文",
    ),
  );

  const hasNewVersion = docs.some((d) => d.hasNewVersion);

  const handleToggle = (id: string) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, allowSend: !d.allowSend } : d)),
    );
    toast.success("外发权限已更新");
  };

  const handleAiRecommend = () => {
    setAiRunning(true);
    setTimeout(() => {
      const ids = aiRecommendations[selectedStage] ?? aiRecommendations["L2"];
      setRecommendedIds(ids);
      setAiRunning(false);
      toast.success(`AI 已为 ${stageLabels[selectedStage]} 推荐 ${ids.length} 份文件`);
    }, 1200);
  };

  const handleAddToPackage = (id: string) => {
    if (packageIds.includes(id)) {
      toast.info("已在发包列表中");
      return;
    }
    const newIds = [...packageIds, id];
    setPackageIds(newIds);
    const newDocs = docs.filter((d) => newIds.includes(d.id));
    setMessage(generateMessage(newDocs, lang));
    toast.success("已加入发包列表，消息已更新");
  };

  const handleLangChange = (l: Lang) => {
    setLang(l);
    const selectedDocs =
      packageIds.length > 0
        ? docs.filter((d) => packageIds.includes(d.id))
        : docs.filter((d) => recommendedIds.includes(d.id));
    setMessage(generateMessage(selectedDocs, l));
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message).then(() => {
      toast.success("消息已复制到剪贴板");
    });
  };

  const handleSend = () => {
    toast.success("发包消息已发送（模拟）");
  };

  return (
    <div className="flex h-full min-h-screen flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">对外资料版本管理 & AI推荐发包</h1>
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Left: File Index */}
        <div className="flex w-[35%] flex-col border-r border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">文件索引（{docs.length}）</span>
            <button
              onClick={() => toast.info("上传新版本功能（模拟）")}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              上传新版本
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">文件名</th>
                  <th className="px-2 py-2 text-left font-medium">版本</th>
                  <th className="px-2 py-2 text-left font-medium">阶段</th>
                  <th className="px-2 py-2 text-left font-medium">外发</th>
                  <th className="px-2 py-2 text-left font-medium">更新日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-1.5">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <div>
                          <p className="font-medium text-gray-800">{doc.name}</p>
                          <p className="text-gray-400">{doc.purpose}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600">
                        {doc.version}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", stageColors[doc.stage])}>
                        {doc.stage}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        onClick={() => handleToggle(doc.id)}
                        className={cn(
                          "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
                          doc.allowSend ? "bg-green-500" : "bg-gray-300",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
                            doc.allowSend ? "translate-x-3.5" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-2 py-2.5 text-gray-400">{doc.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Center: AI Recommendation Panel */}
        <div className="flex w-[35%] flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium text-gray-700">AI 推荐发包</span>
            </div>
          </div>

          {/* Controls */}
          <div className="border-b border-gray-100 px-4 py-3 space-y-2">
            <div>
              <label className="mb-1 block text-xs text-gray-500">客户阶段</label>
              <div className="flex gap-1.5">
                {(["L1", "L2", "L3"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelectedStage(s)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      selectedStage === s
                        ? stageColors[s] + " ring-1 ring-inset ring-current"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                    )}
                  >
                    {stageLabels[s]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">自由查询（可选）</label>
              <div className="flex gap-2">
                <input
                  value={customQuery}
                  onChange={(e) => setCustomQuery(e.target.value)}
                  placeholder="如：欧洲客户需要哪些合规文件…"
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs placeholder-gray-400 focus:border-purple-400 focus:outline-none"
                />
                <button
                  onClick={handleAiRecommend}
                  disabled={aiRunning}
                  className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-60"
                >
                  {aiRunning ? (
                    <span className="animate-pulse">推荐中…</span>
                  ) : (
                    <>
                      <Bot className="h-3.5 w-3.5" />
                      AI推荐
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Recommendation Cards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <p className="text-xs text-gray-400">
              共推荐 {recommendedIds.length} 份文件 · 阶段：{stageLabels[selectedStage]}
            </p>
            {recommendedIds.map((id) => {
              const doc = docs.find((d) => d.id === id);
              if (!doc) return null;
              const inPackage = packageIds.includes(id);
              return (
                <div
                  key={id}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-3 hover:border-purple-200 hover:bg-purple-50/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-800">{doc.name}</span>
                        <span className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                          {doc.version}
                        </span>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", stageColors[doc.stage])}>
                          {doc.stage}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{aiReasons[id]}</p>
                    </div>
                    <button
                      onClick={() => handleAddToPackage(id)}
                      className={cn(
                        "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                        inPackage
                          ? "bg-green-100 text-green-700"
                          : "bg-purple-600 text-white hover:bg-purple-700",
                      )}
                    >
                      {inPackage ? (
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3" /> 已加入
                        </span>
                      ) : (
                        "加入发包"
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Package summary */}
          {packageIds.length > 0 && (
            <div className="border-t border-gray-100 bg-green-50 px-4 py-2">
              <p className="text-xs text-green-700">
                发包列表：{packageIds.length} 份文件已选 ·{" "}
                <button
                  onClick={() => {
                    setPackageIds([]);
                    setMessage(generateMessage(docs.filter((d) => recommendedIds.includes(d.id)), lang));
                    toast.info("发包列表已清空");
                  }}
                  className="underline"
                >
                  清空
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Right: Message Generator */}
        <div className="flex w-[30%] flex-col bg-white">
          {/* New version banner */}
          {hasNewVersion && (
            <div className="flex items-center gap-2 bg-orange-50 px-4 py-2 border-b border-orange-200">
              <Bell className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-orange-700 font-medium">
                有文件已更新新版本，请确认外发版本
              </span>
            </div>
          )}

          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-gray-700">外发消息生成器</span>
            </div>
          </div>

          {/* Language switch */}
          <div className="border-b border-gray-100 px-4 py-3">
            <label className="mb-1.5 block text-xs text-gray-500">发送语言</label>
            <div className="flex gap-1.5">
              {(["中文", "English", "Español"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => handleLangChange(l)}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    lang === l
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                  )}
                >
                  <Globe className="h-3 w-3" />
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Message textarea */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <label className="mb-1.5 block text-xs text-gray-500">
              外发消息（可编辑）
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="h-64 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm leading-relaxed text-gray-700 focus:border-blue-400 focus:outline-none"
            />

            <div className="mt-3 rounded-xl bg-blue-50 p-3">
              <p className="text-xs font-medium text-blue-700 mb-1">包含文件：</p>
              {(packageIds.length > 0 ? packageIds : recommendedIds).map((id) => {
                const doc = docs.find((d) => d.id === id);
                return doc ? (
                  <p key={id} className="text-xs text-blue-600">
                    · {doc.name} · {doc.version}
                  </p>
                ) : null;
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-gray-100 px-4 py-3 flex gap-2">
            <button
              onClick={handleCopy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Copy className="h-4 w-4" />
              复制
            </button>
            <button
              onClick={handleSend}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Send className="h-4 w-4" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
