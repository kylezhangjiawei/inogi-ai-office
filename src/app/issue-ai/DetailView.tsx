/**
 * 问题记录与 AI 定位 — 详情视图（DetailView）。
 *
 * 主列：头部元数据 + 问题描述/附件 + AI 根因分析 + 对话调整（留痕）。
 * 右栏：当前采纳方案（pinned）+ 版本与留痕时间线（append-only）。
 *
 * 数据源唯一来自 IssueService；每次 analyze/adjust/adopt 后都 reload(service.get) 刷新整页。
 * 留痕（messages / analyses）只增不改——本视图绝不提供任何编辑/删除入口。
 */
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  Loader2,
  Lock,
  Paperclip,
  Pin,
  Send,
  Sparkles,
  User as UserIcon,
} from "lucide-react";

import { cn } from "../components/ui/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  DimensionChip,
  LikelihoodIndicator,
  Mono,
  SeverityBadge,
  SolutionTypeBadge,
  StatusBadge,
} from "./badges";
import { SOURCE_LABEL } from "../lib/issue/config";
import type {
  AnalysisVersion,
  Issue,
  IssueMessage,
  IssueService,
  PossibleCause,
  Solution,
} from "../lib/issue/types";

// ── 工具 ───────────────────────────────────────────────────────────────────────

const card =
  "rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_10px_rgba(15,23,42,0.05),0_16px_32px_rgba(15,23,42,0.08)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_2px_8px_rgba(0,0,0,0.4)]";
const sectionTitle =
  "text-sm font-semibold text-slate-800 dark:text-slate-100";
const muted = "text-slate-500 dark:text-slate-400";

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 版本触发类型中文。 */
function triggerLabel(t: AnalysisVersion["triggerType"]): string {
  return t === "initial" ? "初次生成" : "对话调整";
}

// ── 元数据格 ────────────────────────────────────────────────────────────────────

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={cn("text-xs", muted)}>{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-800 dark:text-slate-100">{children ?? "—"}</dd>
    </div>
  );
}

// ── 附件行（可展开已提取文本）──────────────────────────────────────────────────

function AttachmentRow({ att }: { att: Issue["attachments"][number] }) {
  const [open, setOpen] = React.useState(false);
  const hasText = Boolean(att.extractedText && att.extractedText.trim());
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-center gap-2">
        <Paperclip className="size-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{att.fileName}</span>
        <span className={cn("shrink-0 text-xs", muted)}>{att.fileType}</span>
        {hasText && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-indigo-700 outline-none hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            已提取文本
          </button>
        )}
      </div>
      {hasText && open && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {att.extractedText}
        </pre>
      )}
    </li>
  );
}

// ── 单条原因卡 ──────────────────────────────────────────────────────────────────

function CauseCard({
  cause,
  readOnly,
  adoptedSolutionId,
  adoptingSolutionId,
  onAdopt,
}: {
  cause: PossibleCause;
  readOnly: boolean;
  adoptedSolutionId?: string;
  adoptingSolutionId: string | null;
  onAdopt: (cause: PossibleCause, solution: Solution) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/30">
      <div className="flex flex-wrap items-center gap-2">
        <DimensionChip value={cause.dimension} full />
        <LikelihoodIndicator value={cause.likelihood} />
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{cause.cause}</span>
      </div>
      <p className={cn("mt-1.5 text-xs leading-relaxed", muted)}>{cause.evidence}</p>
      <ul className="mt-2.5 space-y-1.5">
        {cause.solutions.map((sol) => {
          const isAdopted = adoptedSolutionId === sol.id;
          const isBusy = adoptingSolutionId === sol.id;
          return (
            <li
              key={sol.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 dark:bg-slate-900",
                isAdopted
                  ? "border-emerald-300 dark:border-emerald-500/40"
                  : "border-slate-200 dark:border-slate-700",
              )}
            >
              <span className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">{sol.action}</span>
              <SolutionTypeBadge value={sol.type} />
              {sol.owner && <span className={cn("text-xs", muted)}>责任：{sol.owner}</span>}
              {isAdopted ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  已采纳
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={readOnly || isBusy}
                  onClick={() => onAdopt(cause, sol)}
                  className="h-7 shrink-0 px-2.5 text-xs"
                >
                  {isBusy && <Loader2 className="size-3.5 animate-spin" />}
                  采纳
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── 对话气泡 ────────────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: IssueMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <span
        className={cn(
          "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        )}
      >
        {isUser ? <UserIcon className="size-4" /> : <Bot className="size-4" />}
      </span>
      <div className={cn("min-w-0 max-w-[80%]", isUser && "items-end text-right")}>
        <div className={cn("flex items-center gap-2 text-xs", muted, isUser && "flex-row-reverse")}>
          <span>{isUser ? msg.operator ?? "操作人" : "AI 助手"}</span>
          <Mono>{fmtTime(msg.createdAt)}</Mono>
        </div>
        <div
          className={cn(
            "mt-1 inline-block whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed",
            isUser
              ? "bg-indigo-600 text-white dark:bg-indigo-600"
              : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
          )}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────────────────

export function DetailView({
  service,
  issueId,
  onBack,
}: {
  service: IssueService;
  issueId: string;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();

  const [issue, setIssue] = React.useState<Issue | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [analyzing, setAnalyzing] = React.useState(false);
  const [adoptingSolutionId, setAdoptingSolutionId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);

  /** 选中查看的版本号（默认 = 最新）。 */
  const [viewVersion, setViewVersion] = React.useState<number | null>(null);

  /** 复用来源历史问题（kind === 'reuse' 时按需取）。 */
  const [reusedIssue, setReusedIssue] = React.useState<Issue | null>(null);

  // mount 时若 status === 'analyzing' 且尚无分析版本，自动触发一次 analyze（drawer 已起步的兜底）。
  const autoKicked = React.useRef(false);

  const reload = React.useCallback(async () => {
    const next = await service.get(issueId);
    setIssue(next);
    return next;
  }, [service, issueId]);

  React.useEffect(() => {
    let alive = true;
    setIssue(null);
    setLoadError(null);
    autoKicked.current = false;
    setViewVersion(null);
    setReusedIssue(null);
    service
      .get(issueId)
      .then((data) => {
        if (alive) setIssue(data);
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(err instanceof Error ? err.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [service, issueId]);

  // 取复用来源问题的采纳方案（仅当 adopted.kind === 'reuse'）。
  React.useEffect(() => {
    if (issue?.adopted?.kind !== "reuse") {
      setReusedIssue(null);
      return;
    }
    let alive = true;
    const from = issue.adopted.reusedFrom;
    service
      .get(from)
      .then((data) => {
        if (alive) setReusedIssue(data);
      })
      .catch(() => {
        if (alive) setReusedIssue(null);
      });
    return () => {
      alive = false;
    };
  }, [service, issue?.adopted]);

  const runAnalyze = React.useCallback(async () => {
    setAnalyzing(true);
    try {
      await service.analyze(issueId);
      await reload();
      toast.success("AI 根因分析完成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "分析失败");
    } finally {
      setAnalyzing(false);
    }
  }, [service, issueId, reload]);

  // 兜底自动触发：analyzing 且无分析版本。
  React.useEffect(() => {
    if (!issue) return;
    if (autoKicked.current) return;
    if (issue.status === "analyzing" && issue.analyses.length === 0 && !analyzing) {
      autoKicked.current = true;
      void runAnalyze();
    }
  }, [issue, analyzing, runAnalyze]);

  const handleAdopt = React.useCallback(
    async (cause: PossibleCause, solution: Solution) => {
      setAdoptingSolutionId(solution.id);
      try {
        await service.adopt(issueId, { kind: "analysis", causeId: cause.id, solutionId: solution.id });
        await reload();
        toast.success("已采纳该方案");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "采纳失败");
      } finally {
        setAdoptingSolutionId(null);
      }
    },
    [service, issueId, reload],
  );

  const handleSend = React.useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await service.adjust(issueId, text);
      setDraft("");
      await reload();
      setViewVersion(null); // 跳回最新版本
      toast.success("已生成新分析版本");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }, [draft, sending, service, issueId, reload]);

  // ── 加载/错误态 ──────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto size-8 text-red-500" />
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">加载问题失败：{loadError}</p>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          <ArrowLeft className="size-4" />
          返回
        </Button>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex items-center justify-center px-4 py-24 text-slate-400">
        <Loader2 className="size-5 animate-spin" />
        <span className="ml-2 text-sm">加载中…</span>
      </div>
    );
  }

  // ── 派生数据 ──────────────────────────────────────────────────────────────────
  const analyses = [...issue.analyses].sort((a, b) => a.version - b.version);
  const latest = analyses.length ? analyses[analyses.length - 1] : null;
  const shownVersion =
    viewVersion != null ? analyses.find((a) => a.version === viewVersion) ?? latest : latest;
  const isLatestShown = !shownVersion || shownVersion.version === latest?.version;
  const totalVersions = analyses.length;

  const adopted = issue.adopted;
  const adoptedSolutionId = adopted?.kind === "analysis" ? adopted.solutionId : undefined;

  const isReuse = adopted?.kind === "reuse";

  // 已采纳方案（kind==='analysis'）的解析。
  let pinnedCause: PossibleCause | undefined;
  let pinnedSolution: Solution | undefined;
  if (adopted?.kind === "analysis") {
    for (const v of analyses) {
      const c = v.content.possibleCauses.find((pc) => pc.id === adopted.causeId);
      if (c) {
        pinnedCause = c;
        pinnedSolution = c.solutions.find((s) => s.id === adopted.solutionId);
        if (pinnedSolution) break;
      }
    }
  }

  const reusedAdopted: { cause: PossibleCause; solution: Solution } | null = (() => {
    const ra = reusedIssue?.adopted;
    if (!reusedIssue || ra?.kind !== "analysis") return null;
    for (const v of reusedIssue.analyses) {
      const c = v.content.possibleCauses.find((pc) => pc.id === ra.causeId);
      if (c) {
        const s = c.solutions.find((x) => x.id === ra.solutionId);
        if (s) return { cause: c, solution: s };
      }
    }
    return null;
  })();

  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
      {/* 顶部返回（shell 也提供面包屑，这里再给一个干净入口）。 */}
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-slate-500 outline-none hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:text-slate-400 dark:hover:text-slate-100"
      >
        <ArrowLeft className="size-4" />
        返回列表
      </button>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ══════════ 主列 ══════════ */}
        <div className="min-w-0 space-y-4">
          {/* 1) 头部 */}
          <motion.section {...fade} className={cn(card, "p-4 sm:p-5")}>
            <div className="flex flex-wrap items-center gap-2">
              <Mono className="text-xs text-slate-500 dark:text-slate-400">{issue.id}</Mono>
              <SeverityBadge value={issue.severity} />
              <StatusBadge value={issue.status} />
            </div>
            <h1 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{issue.title}</h1>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <MetaCell label="来源">{SOURCE_LABEL[issue.source]}</MetaCell>
              <MetaCell label="产品">{issue.product}</MetaCell>
              <MetaCell label="批次">{issue.batch}</MetaCell>
              <MetaCell label="工序">{issue.station}</MetaCell>
              <MetaCell label="不良率">{issue.defectRate ? <Mono>{issue.defectRate}</Mono> : "—"}</MetaCell>
              <MetaCell label="创建">
                <span>
                  {issue.createdBy} · <Mono className="text-xs">{fmtTime(issue.createdAt)}</Mono>
                </span>
              </MetaCell>
            </dl>
          </motion.section>

          {/* 2) 问题描述 + 附件 */}
          <motion.section {...fade} className={cn(card, "p-4 sm:p-5")}>
            <h2 className={sectionTitle}>问题描述</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              {issue.description || <span className={muted}>（无描述）</span>}
            </p>
            {issue.attachments.length > 0 && (
              <div className="mt-4">
                <h3 className={cn("flex items-center gap-1.5 text-xs font-medium", muted)}>
                  <Paperclip className="size-3.5" />
                  附件 {issue.attachments.length}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {issue.attachments.map((att) => (
                    <AttachmentRow key={att.id} att={att} />
                  ))}
                </ul>
              </div>
            )}
          </motion.section>

          {/* 3) AI 根因分析 */}
          <motion.section {...fade} className={cn(card, "p-4 sm:p-5")}>
            <div className="flex items-center justify-between gap-2">
              <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
                <Sparkles className="size-4 text-indigo-500" />
                AI 根因分析
              </h2>
              {totalVersions > 0 && shownVersion && (
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-xs", muted)}>
                    版本 <Mono>v{shownVersion.version}</Mono>（共 {totalVersions} 版）
                  </span>
                  {totalVersions > 1 && (
                    <select
                      value={shownVersion.version}
                      onChange={(e) => setViewVersion(Number(e.target.value))}
                      aria-label="查看历史版本"
                      className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {analyses
                        .slice()
                        .reverse()
                        .map((v) => (
                          <option key={v.id} value={v.version}>
                            v{v.version}（{triggerLabel(v.triggerType)}）
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* a. 复用历史方案块（无分析版本时） */}
            {isReuse && analyses.length === 0 && (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                <p className="flex items-center gap-1.5 text-sm font-medium text-indigo-800 dark:text-indigo-200">
                  <CheckCircle2 className="size-4" />
                  已复用历史方案
                </p>
                <p className={cn("mt-1 text-xs", muted)}>
                  复用自 <Mono className="text-indigo-700 dark:text-indigo-300">{adopted?.kind === "reuse" ? adopted.reusedFrom : ""}</Mono>
                </p>
                {reusedAdopted ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center gap-2">
                      <DimensionChip value={reusedAdopted.cause.dimension} full />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{reusedAdopted.cause.cause}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-slate-700 dark:text-slate-200">{reusedAdopted.solution.action}</span>
                      <SolutionTypeBadge value={reusedAdopted.solution.type} />
                    </div>
                  </div>
                ) : (
                  <p className={cn("mt-2 text-xs", muted)}>（历史方案详情可在下方对话调整中进一步细化）</p>
                )}
              </div>
            )}

            {/* b. 加载态：正在分析 */}
            {(analyzing || (issue.status === "analyzing" && analyses.length === 0)) && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
                <Loader2 className="size-4 animate-spin text-indigo-500" />
                AI 正在分析根因，请稍候…
              </div>
            )}

            {/* c. CTA：待分析且无分析（analyzing 状态走加载态 b） */}
            {issue.status === "pending" && analyses.length === 0 && !analyzing && !isReuse && (
              <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-3 py-6 text-center dark:border-slate-600 dark:bg-slate-800/30">
                <p className={cn("text-sm", muted)}>尚未进行 AI 根因分析。</p>
                <Button onClick={runAnalyze} disabled={analyzing}>
                  <Sparkles className="size-4" />
                  开始 AI 分析
                </Button>
              </div>
            )}

            {/* d. 展示某版本分析结果 */}
            {shownVersion && (
              <div className="mt-3 space-y-3">
                {!isLatestShown && (
                  <p className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    <Lock className="size-3" />
                    历史版本 · 只读
                  </p>
                )}
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700 dark:bg-slate-800/40 dark:text-slate-200">
                  {shownVersion.summary}
                </p>
                {shownVersion.content.referencedCases.length > 0 && (
                  <p className={cn("text-xs", muted)}>
                    参考历史问题：
                    {shownVersion.content.referencedCases.map((c, i) => (
                      <React.Fragment key={c}>
                        {i > 0 && "、"}
                        <Mono className="text-slate-600 dark:text-slate-300">{c}</Mono>
                      </React.Fragment>
                    ))}
                  </p>
                )}
                <div className="space-y-2.5">
                  {shownVersion.content.possibleCauses.map((cause) => (
                    <CauseCard
                      key={cause.id}
                      cause={cause}
                      readOnly={!isLatestShown}
                      adoptedSolutionId={adoptedSolutionId}
                      adoptingSolutionId={adoptingSolutionId}
                      onAdopt={handleAdopt}
                    />
                  ))}
                </div>
              </div>
            )}
          </motion.section>

          {/* 4) 对话调整（留痕） */}
          <motion.section {...fade} className={cn(card, "p-4 sm:p-5")}>
            <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
              <History className="size-4 text-slate-400" />
              对话调整（留痕）
            </h2>
            <p className={cn("mt-1 text-xs", muted)}>每次调整都会生成新的分析版本，对话只增不改。</p>

            <div className="mt-3 space-y-3">
              {issue.messages.length === 0 ? (
                <p className={cn("rounded-lg bg-slate-50 px-3 py-4 text-center text-sm dark:bg-slate-800/40", muted)}>
                  暂无对话。可在下方补充信息以调整 AI 分析。
                </p>
              ) : (
                [...issue.messages]
                  .sort((a, b) => a.seq - b.seq)
                  .map((m) => <MessageBubble key={m.id} msg={m} />)
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="补充线索 / 提出调整方向…"
                disabled={sending}
                aria-label="对话输入"
              />
              <Button onClick={handleSend} disabled={sending || !draft.trim()}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                发送
              </Button>
            </div>
          </motion.section>
        </div>

        {/* ══════════ 右栏 ══════════ */}
        <aside className="min-w-0 space-y-4">
          {/* 当前采纳方案 */}
          <section className={cn(card, "p-4")}>
            <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
              <Pin className="size-4 text-indigo-500" />
              当前采纳方案
            </h2>
            {!adopted ? (
              <p className={cn("mt-2 rounded-lg bg-slate-50 px-3 py-3 text-sm dark:bg-slate-800/40", muted)}>
                尚未采纳方案
              </p>
            ) : isReuse ? (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">复用历史方案</p>
                <p className={cn("mt-1 text-xs", muted)}>
                  来自 <Mono className="text-slate-700 dark:text-slate-200">{adopted.kind === "reuse" ? adopted.reusedFrom : ""}</Mono>
                </p>
                {reusedAdopted && (
                  <div className="mt-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DimensionChip value={reusedAdopted.cause.dimension} />
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{reusedAdopted.cause.cause}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-sm text-slate-700 dark:text-slate-200">{reusedAdopted.solution.action}</span>
                      <SolutionTypeBadge value={reusedAdopted.solution.type} />
                    </div>
                  </div>
                )}
              </div>
            ) : pinnedCause && pinnedSolution ? (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <div className="flex flex-wrap items-center gap-1.5">
                  <DimensionChip value={pinnedCause.dimension} />
                  <LikelihoodIndicator value={pinnedCause.likelihood} />
                </div>
                <p className="mt-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">{pinnedCause.cause}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-slate-700 dark:text-slate-200">{pinnedSolution.action}</span>
                  <SolutionTypeBadge value={pinnedSolution.type} />
                </div>
                {pinnedSolution.owner && (
                  <p className={cn("mt-1 text-xs", muted)}>责任岗位：{pinnedSolution.owner}</p>
                )}
              </div>
            ) : (
              <p className={cn("mt-2 rounded-lg bg-slate-50 px-3 py-3 text-sm dark:bg-slate-800/40", muted)}>
                已采纳方案（详情待加载）
              </p>
            )}
          </section>

          {/* 版本与留痕 时间线 */}
          <section className={cn(card, "p-4")}>
            <div className="flex items-center justify-between gap-2">
              <h2 className={cn(sectionTitle, "flex items-center gap-1.5")}>
                <History className="size-4 text-slate-400" />
                版本与留痕
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <Lock className="size-2.5" />
                只增不改 · append-only
              </span>
            </div>

            {analyses.length === 0 ? (
              <p className={cn("mt-3 text-sm", muted)}>暂无版本记录</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {analyses
                  .slice()
                  .reverse()
                  .map((v) => (
                    <li key={v.id} className="relative flex gap-2.5 pl-1">
                      <span className="mt-1 flex flex-col items-center">
                        <span
                          className={cn(
                            "size-2.5 shrink-0 rounded-full ring-2",
                            v.isAdopted
                              ? "bg-emerald-500 ring-emerald-200 dark:ring-emerald-500/30"
                              : "bg-indigo-500 ring-indigo-200 dark:ring-indigo-500/30",
                          )}
                        />
                      </span>
                      <div className="min-w-0 flex-1 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Mono className="text-sm font-semibold text-slate-800 dark:text-slate-100">v{v.version}</Mono>
                          <span className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {triggerLabel(v.triggerType)}
                          </span>
                          {v.basedOnVersion != null && (
                            <span className={cn("text-[10px]", muted)}>
                              基于 <Mono>v{v.basedOnVersion}</Mono>
                            </span>
                          )}
                          {v.isAdopted && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" />
                              已采纳
                            </span>
                          )}
                        </div>
                        <p className={cn("mt-0.5 line-clamp-2 text-xs", muted)}>{v.summary}</p>
                        <p className={cn("mt-0.5 text-[10px]", muted)}>
                          {v.createdBy} · {v.model} · <Mono>{fmtTime(v.createdAt)}</Mono>
                        </p>
                      </div>
                    </li>
                  ))}
              </ol>
            )}

            {/* 关键留痕事件（用户消息）摘要 */}
            {issue.messages.some((m) => m.role === "user") && (
              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <h3 className={cn("flex items-center gap-1 text-[11px] font-medium", muted)}>
                  <FileText className="size-3" />
                  调整留痕
                </h3>
                <ol className="mt-1.5 space-y-1.5">
                  {[...issue.messages]
                    .filter((m) => m.role === "user")
                    .sort((a, b) => b.seq - a.seq)
                    .map((m) => (
                      <li key={m.id} className={cn("text-[11px] leading-snug", muted)}>
                        <Mono>{fmtTime(m.createdAt)}</Mono> · {m.operator ?? "操作人"}：
                        <span className="text-slate-600 dark:text-slate-300"> {m.content}</span>
                      </li>
                    ))}
                </ol>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
