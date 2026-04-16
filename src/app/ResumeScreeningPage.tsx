import React, { useState } from "react";
import {
  AlertCircle,
  Bot,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Upload,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  name: string;
  score: number;
  title: string;
  years: string;
  skills: string[];
  risks: string[];
  summary: string;
  email: string;
  phone: string;
}

const mockCandidates: Candidate[] = [
  {
    id: "CV-001",
    name: "张晓明",
    score: 91,
    title: "高级质量工程师",
    years: "8年",
    skills: ["CAPA流程", "FDA 510(k)", "ISO 13485", "风险管理", "FMEA"],
    risks: [],
    summary: "具备8年医疗器械质量管理经验，主导过3次FDA审查，熟悉MDR/IVDR法规体系，管理能力突出。",
    email: "zhang.xiaoming@email.com",
    phone: "138-xxxx-8821",
  },
  {
    id: "CV-002",
    name: "李思涵",
    score: 85,
    title: "注册事务专员",
    years: "5年",
    skills: ["CE认证", "RA注册", "技术文件", "CER编写"],
    risks: ["无国内注册经验"],
    summary: "擅长欧盟MDR注册及技术文件编写，参与过多款II类器械上市注册，具备跨部门协调能力。",
    email: "li.sihan@email.com",
    phone: "139-xxxx-4412",
  },
  {
    id: "CV-003",
    name: "王建国",
    score: 72,
    title: "售后技术支持工程师",
    years: "4年",
    skills: ["客户培训", "现场维修", "故障分析"],
    risks: ["英语能力一般", "无三级维修资质"],
    summary: "有较丰富的医疗设备现场维修经验，客户沟通能力强，但技术文档编写能力有待提升。",
    email: "wang.jianguo@email.com",
    phone: "137-xxxx-7731",
  },
  {
    id: "CV-004",
    name: "陈雨婷",
    score: 68,
    title: "人力资源专员",
    years: "3年",
    skills: ["薪酬核算", "招聘面试", "HRIS系统"],
    risks: ["无医疗行业背景", "薪酬结构谈判空间有限"],
    summary: "HR基础扎实，熟悉薪酬体系设计，但缺乏医疗器械行业背景，适应期可能较长。",
    email: "chen.yuting@email.com",
    phone: "136-xxxx-5521",
  },
  {
    id: "CV-005",
    name: "赵磊",
    score: 55,
    title: "研发工程师（应届）",
    years: "0年",
    skills: ["SolidWorks", "MATLAB"],
    risks: ["无工作经验", "专业匹配度偏低", "薪资预期偏高"],
    summary: "应届毕业生，有一定CAD设计基础，但实际项目经验不足，岗位匹配度较低，建议储备人才库。",
    email: "zhao.lei@email.com",
    phone: "135-xxxx-2281",
  },
];

interface InterviewQuestion {
  phase: string;
  questions: Array<{ q: string; hint: string }>;
}

const generateInterviewQuestions = (c: Candidate): InterviewQuestion[] => [
  {
    phase: "基本背景确认",
    questions: [
      { q: `您目前的职位是 ${c.title}，能简单介绍一下您在前公司的主要职责吗？`, hint: "了解候选人实际职责与简历描述的吻合程度" },
      { q: `您提到有 ${c.years} 的相关经验，能描述一个最有成就感的项目吗？`, hint: "判断工作深度与自我认知" },
    ],
  },
  {
    phase: "工作经历深挖",
    questions: [
      {
        q: c.skills.length > 0
          ? `您简历上提到擅长 ${c.skills[0]}，能举一个具体案例说明您是如何应用的吗？`
          : "请描述一个您主导解决的技术问题？",
        hint: "验证技能深度，区分参与和主导",
      },
      { q: "在您上一份工作中，遇到的最大挑战是什么？您是如何解决的？", hint: "考察问题解决能力和抗压性" },
    ],
  },
  {
    phase: "能力验证",
    questions: [
      { q: "如果入职后发现现有流程存在明显缺陷，您会怎么处理？", hint: "考察主动性和跨部门协作意愿" },
      {
        q: c.risks.length > 0
          ? `我们注意到您在 ${c.risks[0]} 方面经验较少，您计划如何快速补充这方面的能力？`
          : "您认为您还有哪些方面需要进一步成长？",
        hint: "直接验证简历风险点，考察学习能力和自我认知",
      },
    ],
  },
  {
    phase: "动机了解",
    questions: [
      { q: "您为什么对这个职位感兴趣？为什么选择我们公司？", hint: "了解求职动机是否匹配岗位需求" },
      { q: "您对未来3-5年的职业发展有什么规划？", hint: "判断候选人稳定性和职业目标与公司方向的契合度" },
    ],
  },
];

const scoreColor = (score: number) => {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-orange-400";
  return "bg-red-400";
};

const scoreBadge = (score: number) => {
  if (score >= 80) return "bg-green-100 text-green-700";
  if (score >= 60) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-500";
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ResumeScreeningPage() {
  const [candidates, setCandidates] = useState<Candidate[]>(
    [...mockCandidates].sort((a, b) => b.score - a.score),
  );
  const [selectedId, setSelectedId] = useState<string>("CV-001");
  const [jdFile, setJdFile] = useState<string | null>(null);
  const [resumeFiles, setResumeFiles] = useState<string[]>([]);
  const [scoring, setScoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [eliminated, setEliminated] = useState<Set<string>>(new Set());
  const [advanced, setAdvanced] = useState<Set<string>>(new Set());

  const selected = candidates.find((c) => c.id === selectedId) ?? candidates[0];

  const handleJdUpload = () => {
    setJdFile("岗位描述_质量工程师.pdf");
    toast.success("JD 上传成功（模拟）");
  };

  const handleResumeUpload = () => {
    const newFiles = ["张晓明_简历.pdf", "李思涵_简历.pdf", "王建国_简历.pdf", "陈雨婷_简历.pdf", "赵磊_简历.pdf"];
    setResumeFiles(newFiles);
    toast.success(`已上传 ${newFiles.length} 份简历（模拟）`);
  };

  const handleBatchScore = () => {
    if (!jdFile) {
      toast.error("请先上传 JD 文件");
      return;
    }
    if (resumeFiles.length === 0) {
      toast.error("请先上传简历文件");
      return;
    }
    setScoring(true);
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setScoring(false);
          toast.success("AI 批量评分完成！");
          return 100;
        }
        return prev + 20;
      });
    }, 400);
  };

  const handleAdvance = (id: string) => {
    setAdvanced((prev) => new Set([...prev, id]));
    setEliminated((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    toast.success("已安排进入面试流程");
  };

  const handleEliminate = (id: string) => {
    setEliminated((prev) => new Set([...prev, id]));
    setAdvanced((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    toast.info("候选人已标记淘汰");
  };

  const interviewQuestions = selected ? generateInterviewQuestions(selected) : [];

  const handleCopyQuestions = () => {
    const text = interviewQuestions
      .map(
        (phase) =>
          `【${phase.phase}】\n` +
          phase.questions.map((q, i) => `Q${i + 1}: ${q.q}\n（考察点：${q.hint}）`).join("\n"),
      )
      .join("\n\n");
    navigator.clipboard.writeText(text).then(() => toast.success("面试问题已复制"));
  };

  return (
    <div className="flex h-full min-h-screen flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">简历筛选 & AI面试问题生成</h1>
        </div>
      </div>

      {/* Top Upload Zone */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-end gap-4">
          {/* JD Upload */}
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-gray-600">
              职位描述（JD）
            </label>
            <div
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-xl border-2 border-dashed px-4 py-3 transition-colors hover:bg-gray-50",
                jdFile ? "border-green-300 bg-green-50" : "border-gray-200",
              )}
              onClick={handleJdUpload}
            >
              <div className="flex items-center gap-2">
                <FileText className={cn("h-4 w-4", jdFile ? "text-green-600" : "text-gray-400")} />
                <span className={cn("text-sm", jdFile ? "text-green-700 font-medium" : "text-gray-400")}>
                  {jdFile ?? "点击上传 JD 文件（PDF/DOCX）"}
                </span>
              </div>
              {jdFile && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            </div>
          </div>

          {/* Resume Upload */}
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-gray-600">
              批量上传简历（{resumeFiles.length} 份）
            </label>
            <div
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-xl border-2 border-dashed px-4 py-3 transition-colors hover:bg-gray-50",
                resumeFiles.length > 0 ? "border-blue-300 bg-blue-50" : "border-gray-200",
              )}
              onClick={handleResumeUpload}
            >
              <div className="flex items-center gap-2">
                <Upload className={cn("h-4 w-4", resumeFiles.length > 0 ? "text-blue-600" : "text-gray-400")} />
                <span className={cn("text-sm", resumeFiles.length > 0 ? "text-blue-700 font-medium" : "text-gray-400")}>
                  {resumeFiles.length > 0
                    ? `已上传 ${resumeFiles.length} 份简历`
                    : "点击批量上传简历文件"}
                </span>
              </div>
              {resumeFiles.length > 0 && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {resumeFiles.length}
                </span>
              )}
            </div>
          </div>

          {/* Score button + progress */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={handleBatchScore}
              disabled={scoring}
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
            >
              {scoring ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              AI批量评分
            </button>
            {scoring && (
              <div className="w-full rounded-full bg-gray-200 h-1.5">
                <div
                  className="h-1.5 rounded-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Center: Candidate List */}
        <div className="flex w-[65%] flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-2.5">
            <span className="text-sm font-medium text-gray-700">
              候选人列表（{candidates.length}人，按匹配分降序）
            </span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {candidates.map((c) => {
              const isEliminated = eliminated.has(c.id);
              const isAdvanced = advanced.has(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "cursor-pointer px-4 py-3 transition-colors",
                    selectedId === c.id ? "bg-blue-50" : "hover:bg-gray-50",
                    isEliminated && "opacity-40",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
                      {c.name[0]}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{c.name}</span>
                        <span className="text-xs text-gray-400">{c.title} · {c.years}</span>
                        {isAdvanced && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            进入面试
                          </span>
                        )}
                        {isEliminated && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-500">
                            已淘汰
                          </span>
                        )}
                      </div>

                      {/* Score bar */}
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-gray-100 max-w-[120px]">
                          <div
                            className={cn("h-2 rounded-full transition-all", scoreColor(c.score))}
                            style={{ width: `${c.score}%` }}
                          />
                        </div>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", scoreBadge(c.score))}>
                          {c.score}分
                        </span>
                      </div>

                      {/* AI summary */}
                      <p className="mt-1 text-xs text-gray-500 line-clamp-1">{c.summary}</p>

                      {/* Chips */}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.skills.slice(0, 3).map((s) => (
                          <span key={s} className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                            {s}
                          </span>
                        ))}
                        {c.risks.slice(0, 2).map((r) => (
                          <span key={r} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                            ⚠ {r}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleAdvance(c.id)}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                          isAdvanced
                            ? "bg-green-100 text-green-700"
                            : "bg-green-600 text-white hover:bg-green-700",
                        )}
                      >
                        进入面试
                      </button>
                      <button
                        onClick={() => handleEliminate(c.id)}
                        className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                      >
                        淘汰
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Candidate Detail + Interview Questions */}
        <div className="flex w-[35%] flex-col bg-white">
          {selected && (
            <>
              {/* Candidate summary */}
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-base font-bold text-blue-700">
                    {selected.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{selected.name}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", scoreBadge(selected.score))}>
                        {selected.score}分
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{selected.title} · {selected.years}经验</p>
                    <p className="mt-1 text-xs text-gray-400">{selected.email} | {selected.phone}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl bg-gray-50 p-2.5">
                  <p className="text-xs text-gray-500 leading-relaxed">{selected.summary}</p>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {selected.skills.map((s) => (
                    <span key={s} className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      {s}
                    </span>
                  ))}
                  {selected.risks.map((r) => (
                    <span key={r} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                      ⚠ {r}
                    </span>
                  ))}
                </div>
              </div>

              {/* Interview Questions */}
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-medium text-gray-700">AI 面试问题</span>
                </div>
                <button
                  onClick={handleCopyQuestions}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制全部
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {interviewQuestions.map((phase, pi) => (
                  <div key={pi}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">
                        {pi + 1}
                      </span>
                      <span className="text-xs font-semibold text-purple-700">{phase.phase}</span>
                    </div>
                    <div className="space-y-2">
                      {phase.questions.map((q, qi) => (
                        <div
                          key={qi}
                          className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                        >
                          <p className="text-sm text-gray-800 font-medium leading-snug">
                            Q{qi + 1}. {q.q}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">考察：{q.hint}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
