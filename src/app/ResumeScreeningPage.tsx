import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User,
  UserRoundSearch,
} from "lucide-react";
import { toast } from "sonner";

import { MaterialInput, MaterialSelect, MaterialTextarea } from "./components/MaterialFields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { cn } from "./components/ui/utils";
import { ImageWithFallback } from "./components/figma/ImageWithFallback";
import {
  type CandidateDetail,
  type CandidateListItem,
  type Decision,
  type HealthResponse,
  type JobRule,
  type MailConfigItem,
  type MailSyncRunResult,
  type MailSyncSchedule,
  type OpenAiConfigItem,
  type ResumeUploadRunResult,
  type ResumeUploadStatusItem,
  recruitmentApi,
} from "./lib/recruitmentApi";

type RuleFormState = {
  id?: string;
  name: string;
  jd_text: string;
  enabled: boolean;
};

type ScheduleFormState = MailSyncSchedule;

type DeleteConfirmState = {
  id: string;
  title: string;
  description: string;
};

const emptyRuleForm: RuleFormState = {
  name: "",
  jd_text: "",
  enabled: true,
};

const defaultScheduleForm: ScheduleFormState = {
  enabled: false,
  run_at: "09:00",
  since_hours: 72,
  limit: 20,
  last_run_at: null,
  last_run_result: null,
  job_rule_id: null,
};

const decisionMeta: Record<Decision, { label: string; classes: string }> = {
  recommend: { label: "推荐", classes: "bg-emerald-100 text-emerald-700" },
  hold: { label: "待定", classes: "bg-amber-100 text-amber-700" },
  reject: { label: "淘汰", classes: "bg-rose-100 text-rose-700" },
};

const decisionOptions = [
  { label: "全部结论", value: "" },
  { label: "推荐", value: "recommend" },
  { label: "待定", value: "hold" },
  { label: "淘汰", value: "reject" },
];

type SyncMailPreview = NonNullable<MailSyncRunResult["mail_previews"]>[number];
type UploadFilePreview = NonNullable<ResumeUploadRunResult["file_previews"]>[number];
type CandidateLoadOptions = {
  silent?: boolean;
  jobRuleId?: string;
};

type CandidateDetailLoadOptions = {
  silent?: boolean;
};

function isSyncMailLoading(status?: string | null) {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized.includes("queue") || normalized.includes("loading") || status.includes("入队") || status.includes("筛选中");
}

function getSyncMailStatusMeta(status?: string | null) {
  if (isSyncMailLoading(status)) {
    return {
      className: "border-blue-200 bg-blue-50 text-blue-700",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    };
  }
  if (status && (status.includes("完成") || status.includes("success") || status.toLowerCase().includes("completed"))) {
    return {
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    };
  }
  if (status && (status.includes("失败") || status.toLowerCase().includes("failed"))) {
    return {
      className: "border-rose-200 bg-rose-50 text-rose-700",
      icon: <AlertCircle className="h-3.5 w-3.5" />,
    };
  }
  if (status && (status.includes("跳过") || status.toLowerCase().includes("skip"))) {
    return {
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: <Clock3 className="h-3.5 w-3.5" />,
    };
  }
  return {
    className: "border-slate-200 bg-white text-slate-600",
    icon: null,
  };
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function scoreTone(score?: number | null) {
  if (typeof score !== "number") return "bg-slate-200 text-slate-500";
  if (score >= 80) return "bg-emerald-500 text-white";
  if (score >= 60) return "bg-amber-400 text-slate-900";
  return "bg-rose-500 text-white";
}

function joinCandidateFacts(values: Array<string | null | undefined>) {
  const normalized = values
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  return normalized.length ? normalized.join(" | ") : "-";
}

function deriveJobRuleName(jdText?: string | null) {
  const normalized = jdText?.replace(/\r\n/g, "\n").trim() || "";
  if (!normalized) return "";

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const titlePattern = /^(?:岗位名称|职位名称|招聘岗位|应聘岗位|岗位|职位|job\s*title|title)\s*[:：]\s*(.+)$/i;

  for (const line of lines.slice(0, 6)) {
    const match = line.match(titlePattern);
    if (match?.[1]?.trim()) {
      return match[1].replace(/\s+/g, " ").trim().slice(0, 100);
    }
  }

  const firstLine = lines[0] || "";
  const shortHeadingCandidate =
    firstLine.length <= 40 &&
    !/[，。；;：:?]/.test(firstLine) &&
    !/^(岗位职责|工作职责|职位描述|岗位描述|职位要求|岗位要求|任职要求)$/i.test(firstLine);

  if (shortHeadingCandidate) {
    return firstLine.slice(0, 100);
  }

  return firstLine.slice(0, 30);
}

function extractAppliedJobTitle(subject?: string | null) {
  const normalized = subject?.trim() || "";
  const match = normalized.match(/智联招聘-([^-]+?)-[^-]+$/);
  return match?.[1]?.trim() || "";
}

function buildCandidateCardTitle(candidate: CandidateListItem) {
  const appliedJobTitle = extractAppliedJobTitle(candidate.source_subject);
  const name = candidate.name?.trim() || "未命名候选人";
  if (appliedJobTitle) {
    return `${appliedJobTitle} - ${name}`;
  }
  if (candidate.job_rule_name) {
    return `${candidate.job_rule_name} - ${name}`;
  }
  return name;
}

function mapScreeningStatusToMailStatus(status?: string | null, errorMessage?: string | null) {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "completed") {
    return {
      status: "已完成",
      error_message: errorMessage ?? undefined,
    };
  }
  if (normalized === "failed") {
    return {
      status: "处理失败",
      error_message: errorMessage ?? undefined,
    };
  }
  if (normalized === "skipped") {
    const message = errorMessage ?? "";
    if (message.includes("未匹配") || message.includes("不符合")) {
      return {
        status: "不符合岗位",
        error_message: errorMessage ?? undefined,
      };
    }
    if (message.includes("已上传处理") || message.includes("已同步") || message.includes("无需重复")) {
      return {
        status: "已存在",
        error_message: errorMessage ?? undefined,
      };
    }
    if (message.includes("仅支持 PDF 和 DOCX") || message.includes("格式")) {
      return {
        status: "格式不支持",
        error_message: errorMessage ?? undefined,
      };
    }
    return {
      status: "未处理",
      error_message: errorMessage ?? undefined,
    };
  }
  if (normalized === "pending_config") {
    return {
      status: "待配置 AI",
      error_message: errorMessage ?? "已保存候选人，但尚未配置 AI 模型。",
    };
  }
  return {
    status: "已入队，后台 AI 筛选中",
    error_message: errorMessage ?? undefined,
  };
}

function mapUploadStatusItemToPreview(
  file: UploadFilePreview,
  statusItem?: ResumeUploadStatusItem | null,
): UploadFilePreview {
  if (!statusItem) {
    return file;
  }

  const mappedStatus = mapScreeningStatusToMailStatus(statusItem.status, statusItem.error_message);
  if (!mappedStatus) {
    return file;
  }

  return {
    ...file,
    candidate_id: statusItem.candidate_id ?? file.candidate_id,
    status: mappedStatus.status,
    error_message: mappedStatus.error_message,
  };
}

function shouldDisplayUploadPreview(file: UploadFilePreview) {
  return ["已入队，后台 AI 筛选中", "已完成", "处理失败"].includes(file.status);
}

function toCandidateScreeningStatus(status?: string | null) {
  return status?.trim().toLowerCase() || null;
}

function FieldRow({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string;
  value?: string | null;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("grid gap-2 rounded-[20px] border border-slate-200 bg-white/80 px-4 py-3 sm:grid-cols-[112px_1fr]", className)}>
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={cn("min-w-0 text-sm text-slate-800", valueClassName)}>{value?.trim() ? value : "-"}</div>
    </div>
  );
}

function OverflowTooltipText({
  text,
  className,
  maxChars = 20,
}: {
  text?: string | null;
  className?: string;
  maxChars?: number;
}) {
  const safeText = text?.trim() || "-";
  const characters = Array.from(safeText);
  const shouldShowTooltip = safeText !== "-" && characters.length > maxChars;
  const previewText = shouldShowTooltip ? `${characters.slice(0, maxChars).join("")}...` : safeText;

  if (!shouldShowTooltip) {
    return (
      <div className={cn("truncate", className)} title={safeText !== "-" ? safeText : undefined}>
        {previewText}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("max-w-full cursor-help truncate", className)} title={safeText}>
          {previewText}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-[320px] whitespace-pre-wrap break-all leading-6">
        {safeText}
      </TooltipContent>
    </Tooltip>
  );
}

function TooltipIconButton({
  children,
  label,
  tone = "default",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  tone?: "default" | "danger" | "success";
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60",
        tone === "danger" && "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
        tone === "default" && "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white/85 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

export function ResumeScreeningPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [jobRules, setJobRules] = useState<JobRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [deletingJobRuleId, setDeletingJobRuleId] = useState<string | null>(null);
  const [togglingJobRuleId, setTogglingJobRuleId] = useState<string | null>(null);
  const [selectedJobRuleId, setSelectedJobRuleId] = useState<string>("");
  const [ruleForm, setRuleForm] = useState<RuleFormState>(emptyRuleForm);

  const [mailConfigs, setMailConfigs] = useState<MailConfigItem[]>([]);
  const [openAiConfigs, setOpenAiConfigs] = useState<OpenAiConfigItem[]>([]);
  const [loadingMailConfigs, setLoadingMailConfigs] = useState(false);
  const [loadingOpenAiConfigs, setLoadingOpenAiConfigs] = useState(false);
  const [selectedMailConfigId, setSelectedMailConfigId] = useState("");
  const [selectedOpenAiConfigId, setSelectedOpenAiConfigId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);

  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(defaultScheduleForm);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<MailSyncRunResult | null>(null);
  const [uploadingFolder, setUploadingFolder] = useState(false);
  const [lastUploadResult, setLastUploadResult] = useState<ResumeUploadRunResult | null>(null);

  const [decisionFilter, setDecisionFilter] = useState<Decision | "">("");
  const [jobRuleFilter, setJobRuleFilter] = useState("");
  const [minScoreFilter, setMinScoreFilter] = useState("");
  const [candidateKeyword, setCandidateKeyword] = useState("");
  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateDetail | null>(null);
  const [interviewQaExpanded, setInterviewQaExpanded] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const deferredCandidateKeyword = useDeferredValue(candidateKeyword);
  const selectedCandidateIdRef = useRef(selectedCandidateId);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleExecutionRef = useRef<Pick<ScheduleFormState, "last_run_at" | "last_run_result">>({
    last_run_at: defaultScheduleForm.last_run_at ?? null,
    last_run_result: defaultScheduleForm.last_run_result ?? null,
  });
  useEffect(() => {
    selectedCandidateIdRef.current = selectedCandidateId;
  }, [selectedCandidateId]);
  useEffect(() => {
    scheduleExecutionRef.current = {
      last_run_at: scheduleForm.last_run_at ?? null,
      last_run_result: scheduleForm.last_run_result ?? null,
    };
  }, [scheduleForm.last_run_at, scheduleForm.last_run_result]);

  const stats = useMemo(() => {
    const recommend = candidates.filter((item) => item.decision === "recommend").length;
    const hold = candidates.filter((item) => item.decision === "hold").length;
    const reject = candidates.filter((item) => item.decision === "reject").length;
    const scored = candidates.filter((item) => typeof item.score === "number");
    const average = scored.length
      ? Math.round(scored.reduce((sum, item) => sum + Number(item.score || 0), 0) / scored.length)
      : "-";

    return {
      total: candidates.length,
      recommend,
      hold,
      reject,
      average,
    };
  }, [candidates]);

  const selectedMailConfig = useMemo(
    () => mailConfigs.find((item) => item.id === selectedMailConfigId) ?? null,
    [mailConfigs, selectedMailConfigId],
  );

  const selectedOpenAiConfig = useMemo(
    () => openAiConfigs.find((item) => item.id === selectedOpenAiConfigId) ?? null,
    [openAiConfigs, selectedOpenAiConfigId],
  );
  const connectedAiLabel = useMemo(() => {
    const configName = selectedOpenAiConfig?.name?.trim();
    const modelName = selectedOpenAiConfig?.model?.trim();
    return configName || modelName || "AI 模型";
  }, [selectedOpenAiConfig]);
  const resolvedSelectedJobRule = useMemo(() => {
    const candidateIds = [
      selectedJobRuleId.trim(),
      ruleForm.id?.trim() ?? "",
      scheduleForm.job_rule_id?.trim() ?? "",
    ].filter(Boolean);

    for (const jobRuleId of candidateIds) {
      const matchedRule = jobRules.find((item) => item.id === jobRuleId);
      if (matchedRule) {
        return matchedRule;
      }
    }

    return null;
  }, [jobRules, ruleForm.id, scheduleForm.job_rule_id, selectedJobRuleId]);
  const resolvedSelectedJobRuleId = resolvedSelectedJobRule?.id ?? "";

  const derivedRuleName = useMemo(() => deriveJobRuleName(ruleForm.jd_text) || ruleForm.name.trim(), [ruleForm.jd_text, ruleForm.name]);
  const hasPendingSyncMail = useMemo(
    () => Boolean(lastSyncResult?.mail_previews?.some((mail) => isSyncMailLoading(mail.status))),
    [lastSyncResult?.mail_previews],
  );
  const hasPendingUploadFile = useMemo(
    () => Boolean(lastUploadResult?.file_previews?.some((file) => isSyncMailLoading(file.status))),
    [lastUploadResult?.file_previews],
  );
  const visibleUploadPreviews = useMemo(
    () => lastUploadResult?.file_previews?.filter(shouldDisplayUploadPreview) ?? [],
    [lastUploadResult?.file_previews],
  );
  const hasPendingBackgroundAnalysis = hasPendingSyncMail || hasPendingUploadFile;

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    const node = uploadFolderInputRef.current;
    if (!node) {
      return;
    }
    node.setAttribute("webkitdirectory", "");
    node.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    void loadCandidates();
  }, [decisionFilter, jobRuleFilter, minScoreFilter, deferredCandidateKeyword]);

  useEffect(() => {
    if (selectedJobRuleId || !resolvedSelectedJobRule) {
      return;
    }

    hydrateRule(resolvedSelectedJobRule);
  }, [resolvedSelectedJobRule, selectedJobRuleId]);

  useEffect(() => {
    setInterviewQaExpanded(false);
    if (!selectedCandidateId) {
      setSelectedCandidate(null);
      return;
    }
    void loadCandidateDetail(selectedCandidateId);
  }, [selectedCandidateId]);

  useEffect(() => {
    if (!hasPendingBackgroundAnalysis) return;

    let remainingPolls = 60;
    let disposed = false;

    const syncPendingState = async () => {
      let hasPendingUpload = hasPendingUploadFile;

      if (lastUploadResult?.file_previews?.length) {
        try {
          const uniqueKeys = lastUploadResult.file_previews
            .map((file) => file.unique_key?.trim())
            .filter((item): item is string => Boolean(item));

          if (uniqueKeys.length) {
            const statuses = await recruitmentApi.getResumeUploadStatuses(uniqueKeys);
            if (disposed) {
              return;
            }

            const statusMap = new Map(statuses.map((item) => [item.unique_key, item]));
            hasPendingUpload = statuses.some((item) => isSyncMailLoading(item.status));

            setLastUploadResult((current) => {
              if (!current?.file_previews?.length) {
                return current;
              }

              let changed = false;
              const nextPreviews = current.file_previews.map((file) => {
                const nextFile = mapUploadStatusItemToPreview(file, statusMap.get(file.unique_key ?? ""));
                if (
                  nextFile.status !== file.status ||
                  (nextFile.error_message ?? "") !== (file.error_message ?? "") ||
                  (nextFile.candidate_id ?? "") !== (file.candidate_id ?? "")
                ) {
                  changed = true;
                }
                return nextFile;
              });

              return changed ? { ...current, file_previews: nextPreviews } : current;
            });
          }
        } catch {
          // Ignore upload status polling errors and keep page responsive.
        }
      }

      remainingPolls -= 1;
      await loadCandidates({ silent: true });
      const currentId = selectedCandidateIdRef.current;
      if (currentId) {
        await loadCandidateDetail(currentId, { silent: true });
      }

      if ((!hasPendingSyncMail && !hasPendingUpload) || remainingPolls <= 0) {
        window.clearInterval(timer);
      }
    };

    void syncPendingState();
    const timer = window.setInterval(() => {
      void syncPendingState();
    }, 4000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingBackgroundAnalysis, hasPendingSyncMail, hasPendingUploadFile, lastUploadResult?.file_previews]);

  useEffect(() => {
    if (!lastSyncResult?.mail_previews?.length || !candidates.length) {
      return;
    }

    setLastSyncResult((current) => {
      if (!current?.mail_previews?.length) {
        return current;
      }

      let changed = false;
      const nextPreviews = current.mail_previews.map((mail) => {
        const matchedCandidate =
          candidates.find((candidate) => candidate.id === mail.candidate_id) ??
          candidates.find(
            (candidate) =>
              candidate.unique_key &&
              mail.unique_key &&
              candidate.unique_key === mail.unique_key,
          ) ??
          candidates.find(
            (candidate) =>
              candidate.source_subject === mail.subject &&
              candidate.source_sender_email === mail.sender_email,
          );

        if (!matchedCandidate) {
          return mail;
        }

        const mappedStatus = mapScreeningStatusToMailStatus(
          matchedCandidate.screening_status ?? matchedCandidate.active_screening_status,
          matchedCandidate.screening_error_message,
        );

        if (!mappedStatus) {
          return mail;
        }

        if (
          mappedStatus.status === mail.status &&
          (mappedStatus.error_message ?? "") === (mail.error_message ?? "")
        ) {
          return mail;
        }

        changed = true;
        return {
          ...mail,
          status: mappedStatus.status,
          error_message: mappedStatus.error_message,
        };
      });

      return changed ? { ...current, mail_previews: nextPreviews } : current;
    });
  }, [candidates, lastSyncResult?.mail_previews]);

  useEffect(() => {
    if (!lastUploadResult?.file_previews?.length || !candidates.length) {
      return;
    }

    setLastUploadResult((current) => {
      if (!current?.file_previews?.length) {
        return current;
      }

      let changed = false;
      const nextPreviews = current.file_previews.map((file) => {
        const matchedCandidate =
          candidates.find((candidate) => candidate.id === file.candidate_id) ??
          candidates.find(
            (candidate) =>
              candidate.unique_key &&
              file.unique_key &&
              candidate.unique_key === file.unique_key,
          );

        if (!matchedCandidate) {
          return file;
        }

        const mappedStatus = mapScreeningStatusToMailStatus(
          matchedCandidate.screening_status ?? matchedCandidate.active_screening_status,
          matchedCandidate.screening_error_message,
        );

        if (!mappedStatus) {
          return file;
        }

        if (
          mappedStatus.status === file.status &&
          (mappedStatus.error_message ?? "") === (file.error_message ?? "")
        ) {
          return file;
        }

        changed = true;
        return {
          ...file,
          status: mappedStatus.status,
          error_message: mappedStatus.error_message,
        };
      });

      return changed ? { ...current, file_previews: nextPreviews } : current;
    });
  }, [candidates, lastUploadResult?.file_previews]);

  useEffect(() => {
    if (!scheduleForm.enabled) {
      return;
    }

    let disposed = false;
    const syncScheduledRunState = async () => {
      try {
        const next = await recruitmentApi.getMailSyncSchedule();
        if (disposed) {
          return;
        }

        const previous = scheduleExecutionRef.current;
        const nextLastRunAt = next.last_run_at ?? null;
        const nextLastRunResult = next.last_run_result ?? null;
        const executionChanged =
          previous.last_run_at !== nextLastRunAt ||
          previous.last_run_result !== nextLastRunResult;

        if (!executionChanged) {
          return;
        }

        scheduleExecutionRef.current = {
          last_run_at: nextLastRunAt,
          last_run_result: nextLastRunResult,
        };
        setScheduleForm((current) => ({
          ...current,
          last_run_at: nextLastRunAt,
          last_run_result: nextLastRunResult,
        }));

        await loadCandidates({ silent: true });
        const currentId = selectedCandidateIdRef.current;
        if (currentId) {
          await loadCandidateDetail(currentId, { silent: true });
        }
      } catch {
        // Ignore background polling errors to keep the page stable.
      }
    };

    void syncScheduledRunState();
    const timer = window.setInterval(() => {
      void syncScheduledRunState();
    }, 30000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleForm.enabled]);

  async function loadBootstrap() {
    await Promise.allSettled([
      loadHealth(),
      loadJobRules(),
      loadMailConfigs(),
      loadOpenAiConfigs(),
      loadSchedule(),
      loadCandidates(),
    ]);
  }

  async function loadHealth() {
    try {
      const next = await recruitmentApi.getHealth();
      setHealth(next);
    } catch (error) {
      toast.error(getErrorMessage(error, "读取环境状态失败"));
    }
  }

  async function loadJobRules(showLoading = true) {
    if (showLoading) {
      setLoadingRules(true);
    }
    try {
      const next = await recruitmentApi.listJobRules();
      setJobRules(next);
      if (selectedJobRuleId && !next.some((item) => item.id === selectedJobRuleId)) {
        resetRuleForm();
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "读取岗位规则失败"));
    } finally {
      if (showLoading) {
        setLoadingRules(false);
      }
    }
  }

  async function loadMailConfigs() {
    setLoadingMailConfigs(true);
    try {
      const next = await recruitmentApi.listMailConfigs();
      setMailConfigs(next);
      setSelectedMailConfigId((current) => {
        if (current && next.some((item) => item.id === current)) return current;
        return next.find((item) => item.enabled)?.id ?? next[0]?.id ?? "";
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "读取企业邮箱配置失败"));
    } finally {
      setLoadingMailConfigs(false);
    }
  }

  async function loadOpenAiConfigs() {
    setLoadingOpenAiConfigs(true);
    try {
      const next = await recruitmentApi.listOpenAiConfigs();
      setOpenAiConfigs(next);
      setSelectedOpenAiConfigId((current) => {
        if (current && next.some((item) => item.id === current)) return current;
        return next.find((item) => item.enabled)?.id ?? next[0]?.id ?? "";
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "读取 OpenAI 配置失败"));
    } finally {
      setLoadingOpenAiConfigs(false);
    }
  }

  async function loadSchedule() {
    try {
      const next = await recruitmentApi.getMailSyncSchedule();
      setScheduleForm({
        enabled: next.enabled,
        run_at: next.run_at || "09:00",
        since_hours: next.since_hours || 72,
        limit: next.limit || 20,
        job_rule_id: next.job_rule_id ?? null,
        last_run_at: next.last_run_at ?? null,
        last_run_result: next.last_run_result ?? null,
      });
      if (next.mail_config_id) {
        setSelectedMailConfigId(next.mail_config_id);
      }
      if (next.openai_config_id) {
        setSelectedOpenAiConfigId(next.openai_config_id);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "读取轮询计划失败"));
    }
  }

  async function loadCandidates(options: CandidateLoadOptions = {}) {
    if (!options.silent) {
      setLoadingCandidates(true);
    }
    try {
      const minScore = minScoreFilter.trim() ? Number(minScoreFilter) : undefined;
      const next = await recruitmentApi.listCandidates({
        keyword: deferredCandidateKeyword,
        decision: decisionFilter,
        jobRuleId: typeof options.jobRuleId === "string" ? options.jobRuleId : jobRuleFilter,
        minScore: typeof minScore === "number" && Number.isFinite(minScore) ? minScore : undefined,
      });
      setCandidates(next);
      setSelectedCandidateId((current) => {
        if (current && next.some((item) => item.id === current)) return current;
        return next[0]?.id ?? "";
      });
    } catch (error) {
      if (!options.silent) {
        toast.error(getErrorMessage(error, "读取候选人列表失败"));
        setCandidates([]);
        setSelectedCandidateId("");
      }
    } finally {
      if (!options.silent) {
        setLoadingCandidates(false);
      }
    }
  }

  async function loadCandidateDetail(candidateId: string, options: CandidateDetailLoadOptions = {}) {
    if (!options.silent) {
      setLoadingDetail(true);
    }
    try {
      const next = await recruitmentApi.getCandidateDetail(candidateId);
      const detailActiveScreening = next.active_screening ?? next.screenings?.[0] ?? null;
      const detailScreeningStatus = toCandidateScreeningStatus(detailActiveScreening?.status);

      setSelectedCandidate((current) => (candidateId === selectedCandidateIdRef.current ? next : current));
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.id !== next.id
            ? candidate
            : {
                ...candidate,
                name: next.parsed_candidate_profile.name || candidate.name,
                target_job:
                  next.parsed_candidate_profile.target_job ||
                  extractAppliedJobTitle(next.source_subject) ||
                  candidate.target_job,
                source_sender_email: next.source_sender_email || candidate.source_sender_email,
                avatar_url: next.parsed_candidate_profile.avatar_url || candidate.avatar_url,
                score: typeof detailActiveScreening?.score === "number" ? detailActiveScreening.score : candidate.score,
                decision: detailActiveScreening?.decision ?? candidate.decision,
                summary: detailActiveScreening?.summary ?? candidate.summary,
                active_screening_status: detailScreeningStatus ?? candidate.active_screening_status,
                screening_status: detailScreeningStatus ?? candidate.screening_status,
                screening_error_message: detailActiveScreening?.error_message ?? candidate.screening_error_message,
              },
        ),
      );
      setLastSyncResult((current) => {
        if (!current?.mail_previews?.length) {
          return current;
        }

        let changed = false;
        const mappedStatus = mapScreeningStatusToMailStatus(detailScreeningStatus, detailActiveScreening?.error_message);
        if (!mappedStatus) {
          return current;
        }

        const nextPreviews = current.mail_previews.map((mail) => {
          const sameCandidateId = mail.candidate_id && mail.candidate_id === next.id;
          const sameUniqueKey = mail.unique_key && next.unique_key && mail.unique_key === next.unique_key;
          const sameMail = mail.subject === next.source_subject && mail.sender_email === next.source_sender_email;
          if (!sameCandidateId && !sameUniqueKey && !sameMail) {
            return mail;
          }

          if (
            mail.status === mappedStatus.status &&
            (mail.error_message ?? "") === (mappedStatus.error_message ?? "")
          ) {
            return mail;
          }

          changed = true;
          return {
            ...mail,
            candidate_id: mail.candidate_id || next.id,
            unique_key: mail.unique_key || next.unique_key || undefined,
            candidate_name: next.parsed_candidate_profile.name || mail.candidate_name,
            status: mappedStatus.status,
            error_message: mappedStatus.error_message,
          };
        });

        return changed ? { ...current, mail_previews: nextPreviews } : current;
      });
    } catch (error) {
      if (!options.silent) {
        toast.error(getErrorMessage(error, "读取候选人详情失败"));
        setSelectedCandidate(null);
      }
    } finally {
      if (!options.silent) {
        setLoadingDetail(false);
      }
    }
  }

  function resetRuleForm() {
    setSelectedJobRuleId("");
    setJobRuleFilter("");
    setRuleForm(emptyRuleForm);
  }

  function hydrateRule(jobRule: JobRule) {
    setSelectedJobRuleId(jobRule.id);
    setJobRuleFilter(jobRule.id);
    setRuleForm({
      id: jobRule.id,
      name: jobRule.name,
      jd_text: jobRule.jd_text,
      enabled: jobRule.enabled,
    });
  }

  async function handleSaveRule() {
    if (!ruleForm.jd_text.trim()) {
      toast.error("请先填写完整岗位描述");
      return;
    }

    setSavingRule(true);
    try {
      const saved = await recruitmentApi.saveJobRule({
        id: ruleForm.id,
        name: undefined,
        jd_text: ruleForm.jd_text.trim(),
        enabled: ruleForm.enabled,
      });
      await loadJobRules(false);
      setSelectedJobRuleId(saved.id);
      setRuleForm({
        id: saved.id,
        name: saved.name,
        jd_text: saved.jd_text,
        enabled: saved.enabled,
      });
      toast.success(ruleForm.id ? "岗位规则已更新" : "岗位规则已创建");
    } catch (error) {
      toast.error(getErrorMessage(error, "保存岗位规则失败"));
    } finally {
      setSavingRule(false);
    }
  }

  function mergeRule(saved: JobRule) {
    setJobRules((current) => {
      const exists = current.some((item) => item.id === saved.id);
      if (!exists) return [saved, ...current];
      return current.map((item) => (item.id === saved.id ? saved : item));
    });
  }

  async function handleToggleJobRule(jobRule: JobRule) {
    const nextEnabled = !jobRule.enabled;
    setTogglingJobRuleId(jobRule.id);
    setJobRules((current) =>
      current.map((item) => (item.id === jobRule.id ? { ...item, enabled: nextEnabled } : item)),
    );
    if (selectedJobRuleId === jobRule.id) {
      setRuleForm((current) => ({ ...current, enabled: nextEnabled }));
    }

    try {
      const saved = await recruitmentApi.saveJobRule({
        id: jobRule.id,
        name: jobRule.name,
        jd_text: jobRule.jd_text,
        enabled: nextEnabled,
      });
      mergeRule(saved);
      toast.success(jobRule.enabled ? "岗位规则已停用" : "岗位规则已启用");
    } catch (error) {
      setJobRules((current) =>
        current.map((item) => (item.id === jobRule.id ? { ...item, enabled: jobRule.enabled } : item)),
      );
      if (selectedJobRuleId === jobRule.id) {
        setRuleForm((current) => ({ ...current, enabled: jobRule.enabled }));
      }
      toast.error(getErrorMessage(error, "更新岗位规则状态失败"));
    } finally {
      setTogglingJobRuleId(null);
    }
  }

  async function handleDeleteJobRule(jobRule: JobRule) {
    setDeletingJobRuleId(jobRule.id);
    try {
      await recruitmentApi.deleteJobRule(jobRule.id);
      setJobRules((current) => current.filter((item) => item.id !== jobRule.id));
      await loadCandidates();
      if (selectedJobRuleId === jobRule.id) {
        resetRuleForm();
      }
      if (jobRuleFilter === jobRule.id) {
        setJobRuleFilter("");
      }
      toast.success("岗位规则已删除");
    } catch (error) {
      toast.error(getErrorMessage(error, "删除岗位规则失败"));
    } finally {
      setDeletingJobRuleId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;

    const target = jobRules.find((item) => item.id === deleteConfirm.id);
    if (target) {
      await handleDeleteJobRule(target);
    }

    setDeleteConfirm(null);
  }

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    try {
      const saved = await recruitmentApi.saveMailSyncSchedule({
        enabled: scheduleForm.enabled,
        run_at: scheduleForm.run_at,
        since_hours: Number(scheduleForm.since_hours || 72),
        limit: Number(scheduleForm.limit || 20),
        job_rule_id: resolvedSelectedJobRuleId || undefined,
        mail_config_id: selectedMailConfigId || undefined,
        openai_config_id: selectedOpenAiConfigId || undefined,
      });
      setScheduleForm({
        enabled: saved.enabled,
        run_at: saved.run_at,
        since_hours: saved.since_hours,
        limit: saved.limit,
        job_rule_id: saved.job_rule_id ?? null,
        last_run_at: saved.last_run_at ?? null,
        last_run_result: saved.last_run_result ?? null,
      });
      toast.success("轮询计划已保存");
    } catch (error) {
      toast.error(getErrorMessage(error, "保存轮询计划失败"));
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleRunSync() {
    setRunningSync(true);
    try {
      const result = await recruitmentApi.runMailSync({
        job_rule_id: resolvedSelectedJobRuleId || undefined,
        mail_config_id: selectedMailConfigId || undefined,
        openai_config_id: selectedOpenAiConfigId || undefined,
        ignore_last_uid: true,
        since_hours: Number(scheduleForm.since_hours || 72),
        limit: Number(scheduleForm.limit || 20),
      });
      setLastSyncResult(result);
      await Promise.all([loadCandidates(), loadSchedule()]);
      toast.success(result.message || "同步执行完成");
    } catch (error) {
      toast.error(getErrorMessage(error, "执行同步失败"));
    } finally {
      setRunningSync(false);
    }
  }

  async function handleUploadResumeFolder(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) {
      return;
    }

    const supportedFiles = selectedFiles.filter((file) => /\.(pdf|docx)$/i.test(file.name));
    if (!supportedFiles.length) {
      toast.error("当前仅支持上传 PDF 和 DOCX 简历文件。");
      event.target.value = "";
      return;
    }

    const formData = new FormData();
    supportedFiles.forEach((file) => {
      formData.append("files", file);
    });
    if (resolvedSelectedJobRuleId) {
      formData.append("job_rule_id", resolvedSelectedJobRuleId);
    }
    if (selectedOpenAiConfigId) {
      formData.append("openai_config_id", selectedOpenAiConfigId);
    }

    setUploadingFolder(true);
    try {
      const result = await recruitmentApi.uploadResumeFiles(formData);
      setLastUploadResult(result);
      await loadCandidates({ jobRuleId: jobRuleFilter });
      toast.success(result.message || "简历文件夹上传完成");
    } catch (error) {
      toast.error(getErrorMessage(error, "上传简历文件夹失败"));
    } finally {
      setUploadingFolder(false);
      event.target.value = "";
    }
  }

  const activeScreening = selectedCandidate?.active_screening ?? selectedCandidate?.screenings?.[0];

  return (
    <div className="mx-auto flex max-w-[1680px] flex-col gap-6 px-6 py-6">
      <section className="material-panel rounded-[32px] px-8 py-8">
        <div className="grid gap-6 xl:grid-cols-[1.5fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
              <Mail className="h-3.5 w-3.5" />
              企业邮箱简历初筛
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-900">邮件收件、AI 初筛、结果复核</h1>
            <p className="mt-3 max-w-3xl text-base leading-8 text-slate-500">
              先配置岗位规则，再同步邮箱，最后在下方候选人列表中查看摘要、得分与筛选记录。
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-500">
              <span className="rounded-full border border-slate-200 bg-white px-4 py-2">
                数据源：{health?.mail_configured ? "企业邮箱已连接" : "等待邮箱配置"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-4 py-2">
                AI：{health?.openai_configured ? `${connectedAiLabel} 已连接` : "等待 AI 配置"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-4 py-2">
                数据库：{health?.ok ? "正常" : "待检查"}
              </span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatPill label="候选人总数" value={stats.total} />
            <StatPill label="推荐" value={stats.recommend} />
            <StatPill label="待定" value={stats.hold} />
            <StatPill label="平均分" value={stats.average} />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <section className="material-panel rounded-[32px] px-8 py-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">岗位规则</h2>
              <p className="mt-2 text-base text-slate-400">左侧选择规则，右侧编辑当前岗位 JD 与启用状态。</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
              共 {jobRules.length} 条规则
            </div>
          </div>

          <div className="mt-7 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[28px] border border-slate-200 bg-[rgba(248,250,252,0.62)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
                <Database className="h-4 w-4" />
                规则列表
              </div>
              <div className="material-scrollbar mt-4 max-h-[520px] space-y-3 overflow-y-auto">
                {loadingRules && !jobRules.length ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-400">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    正在加载规则...
                  </div>
                ) : jobRules.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-400">
                    暂无岗位规则
                  </div>
                ) : (
                  jobRules.map((jobRule) => {
                    const active = selectedJobRuleId === jobRule.id;
                    return (
                      <div
                        key={jobRule.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => hydrateRule(jobRule)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            hydrateRule(jobRule);
                          }
                        }}
                        className={cn(
                          "w-full cursor-pointer rounded-[22px] border px-4 py-4 text-left transition",
                          active
                            ? "border-cyan-300 bg-cyan-50"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                        )}
                      >
                        <OverflowTooltipText text={jobRule.name} className="text-base font-semibold leading-6 text-slate-900" />
                        <div className="mt-3 flex items-end justify-between gap-3">
                          <OverflowTooltipText text={jobRule.jd_text} className="max-w-[220px] text-xs leading-5 text-slate-500" />
                          <div className="flex shrink-0 items-center gap-1.5">
                            <TooltipIconButton
                              label={jobRule.enabled ? "停用规则" : "启用规则"}
                              tone={jobRule.enabled ? "success" : "default"}
                              disabled={togglingJobRuleId === jobRule.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleJobRule(jobRule);
                              }}
                            >
                              {togglingJobRuleId === jobRule.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : jobRule.enabled ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <AlertCircle className="h-4 w-4" />
                              )}
                            </TooltipIconButton>
                            <TooltipIconButton
                              label="删除规则"
                              tone="danger"
                              disabled={deletingJobRuleId === jobRule.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteConfirm({
                                  id: jobRule.id,
                                  title: "确认删除岗位规则？",
                                  description: `删除后将移除这条规则“${jobRule.name}”，此操作不可撤销。`,
                                });
                              }}
                            >
                              {deletingJobRuleId === jobRule.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </TooltipIconButton>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-4">
                <div className="text-sm font-semibold text-slate-500">系统识别岗位名称</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {derivedRuleName || "等待从下方岗位描述中识别"}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  直接粘贴完整岗位描述即可，系统会自动拆分岗位名称和岗位职责。                </p>
              </div>
              <MaterialTextarea
                label="岗位描述"
                value={ruleForm.jd_text}
                onChange={(event) => setRuleForm((current) => ({ ...current, jd_text: event.target.value }))}
                placeholder={"例如：\n岗位名称：测试工程师\n岗位职责：\n1. 负责测试计划与执行\n2. 跟进缺陷闭环"}
                className="h-[320px] min-h-[320px] resize-none overflow-y-auto"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSaveRule()}
                  disabled={savingRule}
                  className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-base font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingRule ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {ruleForm.id ? "保存规则" : "新建规则"}
                </button>
                <label className="inline-flex h-11 min-w-[96px] items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={ruleForm.enabled}
                    onChange={(event) => setRuleForm((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  启用
                </label>
                <button
                  type="button"
                  onClick={resetRuleForm}
                  className="inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  清空内容
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="material-panel relative rounded-[32px] px-8 py-8">
          <input
            ref={uploadFolderInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(event) => void handleUploadResumeFolder(event)}
          />
          <div className="flex flex-col gap-4 pr-0 sm:pr-32">
            <div className="max-w-[560px]">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">同步控制</h2>
              <p className="mt-2 text-base leading-7 text-slate-400">
                检查环境后可手动同步，也可以启用每天定点轮询自动拉取邮箱简历。              </p>
            </div>
            <button
              type="button"
              onClick={() => void Promise.all([loadHealth(), loadMailConfigs(), loadOpenAiConfigs(), loadSchedule(), loadCandidates()])}
              className="inline-flex h-10 w-fit cursor-pointer items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 sm:absolute sm:right-8 sm:top-8"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>

          <div className="mt-6">
            <div className="mb-5 rounded-[24px] border border-amber-200 bg-amber-50/80 px-5 py-4 text-sm leading-6 text-amber-800">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4" />
                文件夹上传提示              </div>
              <div className="mt-2">
                当前第一版仅支持文件夹中的<span className="font-semibold">PDF / DOCX</span> 简历文件，系统会优先将文件直接交给 AI
                文档能力读取；扫描版 PDF、图片简历和 DOC 暂不保证效果，建议优先上传可复制文字的 PDF 或 DOCX。
              </div>
            </div>
            <div className="rounded-[26px] border border-slate-200 bg-slate-50/85 p-5">
              <div className="text-sm font-semibold text-slate-400">同步参数</div>
              <div className="mt-4 grid gap-4 xl:grid-cols-4 sm:grid-cols-2">
                <MaterialSelect
                  label="企业邮箱"
                  value={selectedMailConfigId}
                  onValueChange={setSelectedMailConfigId}
                  options={mailConfigs.map((item) => ({
                    label: `${item.email}${item.enabled ? "（已启用）" : ""}`,
                    value: item.id,
                  }))}
                  placeholder={loadingMailConfigs ? "正在加载企业邮箱配置..." : "暂无企业邮箱配置"}
                />
                <MaterialSelect
                  label="AI 模型"
                  value={selectedOpenAiConfigId}
                  onValueChange={setSelectedOpenAiConfigId}
                  className="h-12"
                  options={openAiConfigs.map((item) => ({
                    label: `${item.name} / ${item.model}`,
                    value: item.id,
                  }))}
                  placeholder={loadingOpenAiConfigs ? "正在加载 AI 配置..." : "暂无 AI 配置"}
                />
                <MaterialInput
                  label="回溯小时"
                  className="h-9"
                  type="number"
                  min={1}
                  value={String(scheduleForm.since_hours)}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setScheduleForm((current) => ({
                      ...current,
                      since_hours: Number.isFinite(value) && value > 0 ? value : 0,
                    }));
                  }}
                />
                <MaterialInput
                  label="抓取上限"
                  className="h-9"
                  type="number"
                  min={1}
                  value={String(scheduleForm.limit)}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setScheduleForm((current) => ({
                      ...current,
                      limit: Number.isFinite(value) && value > 0 ? value : 0,
                    }));
                  }}
                />
              </div>
              <div className="mt-4  ">
                <div className="text-xs leading-6 text-slate-500">
                  当前计划默认按{scheduleForm.since_hours || 72} 小时窗口回溯，单次最多抓取{scheduleForm.limit || 20} 份简历。                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.75))] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-full">
                <div className="flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  启用定点轮询获取邮箱简历
                </div>
                <div className="mt-2 text-sm  text-slate-500">
                  到点后会自动拉取邮箱简历，并按当前启用规则执行筛选。若左侧已选中规则，则优先使用该规则。
                </div>
              </div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
                {scheduleForm.enabled ? "轮询已启用" : "轮询未启用"}
              </div>
            </div>

            <div className="mt-5 rounded-[22px] border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-400">执行控制</div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,1.15fr)_minmax(180px,0.85fr)_minmax(180px,0.85fr)] lg:items-end">
                <label className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={scheduleForm.enabled}
                    onChange={(event) => setScheduleForm((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  <span className="whitespace-nowrap">启用轮询</span>
                </label>
                <input
                  type="time"
                  value={scheduleForm.run_at}
                  onChange={(event) => setScheduleForm((current) => ({ ...current, run_at: event.target.value }))}
                  className="material-input h-11 w-full min-w-0"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveSchedule()}
                  disabled={savingSchedule}
                  className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  {savingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                  保存计划
                </button>
              </div>
              <div className="mt-4 text-xs leading-6 text-slate-500">
                最近执行：{scheduleForm.last_run_at ? `${formatDate(scheduleForm.last_run_at)} / ${scheduleForm.last_run_result || "已完成"}` : "暂无记录"}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            <div className="flex flex-wrap gap-3 justify-between">
            <button
              type="button"
              onClick={() => void handleRunSync()}
              disabled={runningSync}
              className="inline-flex cursor-pointer h-13 min-w-[280px] items-center justify-center gap-3 rounded-[24px] bg-[linear-gradient(90deg,#5477e8,#5ac3a6)] px-7 text-l font-semibold text-white shadow-[0_16px_28px_rgba(84,119,232,0.22)] transition hover:translate-y-[-1px] disabled:opacity-60"
            >
              {runningSync ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              运行一次同步
            </button>
            <button
              type="button"
              onClick={() => uploadFolderInputRef.current?.click()}
              disabled={uploadingFolder}
              className="inline-flex h-13 min-w-[280px] cursor-pointer items-center justify-center gap-3 rounded-[24px] border border-slate-200 bg-white px-7 text-l font-semibold text-slate-700 shadow-[0_10px_22px_rgba(15,23,42,0.08)] transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              {uploadingFolder ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              上传简历文件夹
            </button>
            </div>

            <div className="px-1 py-1 text-sm leading-6 text-slate-600">
              手动同步会立即执行；若已开启轮询，后续会继续按计划自动运行。              {lastSyncResult ? (
                <span className="ml-2 text-slate-500">
                  本次结果：检查{lastSyncResult.scanned_count ?? 0}，匹配{lastSyncResult.matched_count ?? 0}，入队{lastSyncResult.queued_for_ai ?? 0}，处理{lastSyncResult.processed}，新增{lastSyncResult.created_candidates}，跳过{lastSyncResult.skipped}，失败{lastSyncResult.failed}。                </span>
              ) : null}
            </div>
          </div>

          {lastSyncResult ? (
            <div className="mt-5 rounded-[26px] border border-slate-200 bg-white/80 px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">本次同步回显</div>
                  <div className="mt-1 text-sm text-slate-500">{lastSyncResult.message}</div>
                  {hasPendingSyncMail ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      已入队 {lastSyncResult.queued_for_ai} 封，后台正在逐条筛选，候选人列表会自动刷新。
                    </div>
                  ) : lastSyncResult.mail_previews?.length ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      本次入队邮件状态已完成刷新。
                    </div>
                  ) : null}
                  {lastSyncResult.actual_screening_model ? (
                    <div className="mt-1 text-xs text-slate-400">实际筛选模型：{lastSyncResult.actual_screening_model}</div>
                  ) : null}
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {lastSyncResult.mail_previews?.length ?? 0} 封邮件
                </div>
              </div>

              <div className="material-scrollbar mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-2">
                {lastSyncResult.mail_previews?.length ? (
                  lastSyncResult.mail_previews.map((mail: SyncMailPreview, index) => {
                    const statusMeta = getSyncMailStatusMeta(mail.status);
                    return (
                    <div key={mail.unique_key || `${mail.received_at}-${index}`} className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900">{mail.subject || "无主题邮件"}</div>
                          <div className="mt-1 text-xs text-slate-500 break-all">
                            {mail.sender_name || mail.sender_email || "未知发件人"}
                          </div>
                        </div>
                        <div className="shrink-0 text-center">
                          <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", statusMeta.className)}>
                            {statusMeta.icon}
                            {mail.status}
                          </div>
                          <div className="mt-2 text-xs text-slate-400">{formatDate(mail.received_at)}</div>
                        </div>
                      </div>
                      {mail.candidate_name ? (
                        <div className="mt-3 text-xs font-medium text-slate-500">候选人：{mail.candidate_name}</div>
                      ) : null}
                      {mail.preview ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                            查看邮件捕获内容（{mail.preview.length} 字符）
                          </summary>
                          <pre className="mt-2 max-h-52 overflow-auto rounded-[12px] border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 whitespace-pre-wrap break-all">
                            {mail.preview}
                          </pre>
                        </details>
                      ) : (
                        <div className="mt-3 text-xs text-slate-400">邮件正文为空</div>
                      )}
                      {mail.error_message ? (
                        <div className="mt-3 rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                          {mail.error_message}
                        </div>
                      ) : null}
                    </div>
                  )})
                ) : (
                  <div className="rounded-[20px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                    本次没有可回显的邮件内容。
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {lastUploadResult ? (
            <div className="mt-5 rounded-[26px] border border-slate-200 bg-white/80 px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">本次文件夹上传回显</div>
                  <div className="mt-1 text-sm text-slate-500">{lastUploadResult.message}</div>
                  {hasPendingUploadFile ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      已入队 {lastUploadResult.queued_for_ai ?? 0} 份，后台正在逐条筛选，候选人列表会自动刷新。
                    </div>
                  ) : visibleUploadPreviews.length ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      本次上传文件状态已完成刷新。
                    </div>
                  ) : null}
                  {lastUploadResult.actual_extract_model || lastUploadResult.actual_screening_model ? (
                    <div className="mt-1 space-y-1 text-xs text-slate-400">
                      {lastUploadResult.actual_extract_model ? (
                        <div>实际文件读取模型：{lastUploadResult.actual_extract_model}</div>
                      ) : null}
                      {lastUploadResult.actual_screening_model ? (
                        <div>实际筛选评分模型：{lastUploadResult.actual_screening_model}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {visibleUploadPreviews.length} 份文件
                </div>
              </div>

              <div className="material-scrollbar mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-2">
                {visibleUploadPreviews.length ? (
                  visibleUploadPreviews.map((file: UploadFilePreview, index) => {
                    const statusMeta = getSyncMailStatusMeta(file.status);
                    return (
                      <div key={file.unique_key || `${file.file_name}-${index}`} className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-900">{file.file_name || "未命名文件"}</div>
                            <div className="mt-1 text-xs text-slate-500">{file.file_type}</div>
                          </div>
                          <div className="shrink-0 text-center">
                            <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", statusMeta.className)}>
                              {statusMeta.icon}
                              {file.status}
                            </div>
                            <div className="mt-2 text-xs text-slate-400">{formatDate(file.received_at)}</div>
                          </div>
                        </div>
                        {file.candidate_name ? (
                          <div className="mt-3 text-xs font-medium text-slate-500">候选人：{file.candidate_name}</div>
                        ) : null}
                        {file.preview ? (
                          <details className="mt-3">
                            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                              查看解析文本预览（{file.preview.length} 字符）
                            </summary>
                            <pre className="mt-2 max-h-52 overflow-auto rounded-[12px] border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 whitespace-pre-wrap break-all">
                              {file.preview}
                            </pre>
                          </details>
                        ) : (
                          <div className="mt-3 text-xs text-slate-400">当前没有可展示的文本预览</div>
                        )}
                        {file.error_message ? (
                          <div className="mt-3 rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                            {file.error_message}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[20px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                    本次没有需要展示的上传结果。
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="material-panel rounded-[32px] px-8 py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">候选人列表</h2>
              <p className="mt-2 text-base text-slate-400">按筛选结论、岗位和分数查看候选人摘要。</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
              <Search className="h-4 w-4" />
              共 {candidates.length} 人
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1.3fr_1fr_1fr_0.8fr]">
            <MaterialInput
              label="关键词搜索"
              value={candidateKeyword}
              onChange={(event) => setCandidateKeyword(event.target.value)}
              placeholder="请输入"
              className="h-9.5"
            />
            <MaterialSelect
              label="筛选结论"
              value={decisionFilter}
              onValueChange={(value) => setDecisionFilter(value as Decision | "")}
              options={decisionOptions}
              placeholder="全部结论"
              className="h-13"
            />
            <MaterialSelect
              label="岗位规则"
              value={jobRuleFilter}
              onValueChange={setJobRuleFilter}
              options={[{ label: "全部岗位", value: "" }, ...jobRules.map((item) => ({ label: item.name, value: item.id }))]}
              placeholder="全部岗位"
              className="h-13"
            />
            <MaterialInput
              label="最低分"
              type="number"
              min={0}
              value={minScoreFilter}
              onChange={(event) => setMinScoreFilter(event.target.value)}
              placeholder="请输入"
              className="h-9.5"
            />
          </div>

          <div className="material-scrollbar mt-6 max-h-[920px] space-y-4 overflow-y-auto pr-2">
            {loadingCandidates ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-400">
                <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                正在加载候选人...
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-400">
                暂无候选人
              </div>
            ) : (
              candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  className={cn(
                    "w-full cursor-pointer rounded-[24px] border px-5 py-5 text-left transition",
                    selectedCandidateId === candidate.id
                      ? "border-cyan-300 bg-cyan-50 shadow-[0_12px_30px_rgba(34,211,238,0.12)]"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-[linear-gradient(135deg,#dbeafe_0%,#bfdbfe_45%,#e0f2fe_100%)] text-3xl font-semibold text-sky-700 shadow-inner">
                      {candidate.avatar_url ? (
                        <ImageWithFallback
                          src={candidate.avatar_url}
                          alt={candidate.name || "候选人头像"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <User className="h-9 w-9 text-sky-500" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="text-lg font-semibold text-slate-900">{buildCandidateCardTitle(candidate)}</div>
                        {candidate.decision ? (
                          <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", decisionMeta[candidate.decision].classes)}>
                            {decisionMeta[candidate.decision].label}
                          </span>
                        ) : candidate.screening_status ? (
                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            {mapScreeningStatusToMailStatus(candidate.screening_status)?.status || "待处理"}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-slate-500">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div>{candidate.target_job || extractAppliedJobTitle(candidate.source_subject) || "-"}</div>
                          <div>{candidate.job_rule_name || "-"}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-3">
                      <div
                        className={cn(
                          "inline-flex min-w-[58px] items-center justify-center rounded-full px-3 py-1.5 text-sm font-semibold",
                          scoreTone(candidate.score),
                        )}
                      >
                        {typeof candidate.score === "number" ? candidate.score : "-"}
                      </div>
                      <div className="text-xs text-slate-400">{formatDate(candidate.received_at)}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="material-panel rounded-[32px] px-8 py-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">候选人详情</h2>
              <p className="mt-2 text-base text-slate-400">查看解析画像、筛选结论、命中点和风险说明。</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
              <UserRoundSearch className="mr-2 inline h-4 w-4" />
              详情面板
            </div>
          </div>

          <div className="material-scrollbar mt-6 max-h-[920px] space-y-4 overflow-y-auto pr-2">
            {loadingDetail ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-400">
                <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                正在加载候选人详情...
              </div>
            ) : !selectedCandidate ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-400">
                请选择左侧候选人查看详情
              </div>
            ) : (
              <>
                <div className="rounded-[26px] border border-slate-200 bg-white px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-18 w-18 shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-[linear-gradient(135deg,#dbeafe_0%,#bfdbfe_45%,#e0f2fe_100%)] text-2xl font-semibold text-sky-700 shadow-inner">
                        {selectedCandidate.parsed_candidate_profile.avatar_url ? (
                          <ImageWithFallback
                            src={selectedCandidate.parsed_candidate_profile.avatar_url}
                            alt={selectedCandidate.parsed_candidate_profile.name || "候选人头像"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <User className="h-8 w-8 text-sky-500" />
                        )}
                      </div>
                      <div>
                        <div className="text-2xl font-semibold text-slate-900">
                          {selectedCandidate.parsed_candidate_profile.name || "未命名候选人"}
                        </div>
                        <div className="mt-2 text-sm text-slate-500">
                          {selectedCandidate.source_sender_name || selectedCandidate.source_sender_email ? "招聘专员：" : ""} {selectedCandidate.source_sender_name || selectedCandidate.source_sender_email || "-"}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{selectedCandidate.source_subject || "-"}</div>
                      </div>
                    </div>
                    {activeScreening?.decision ? (
                      <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", decisionMeta[activeScreening.decision].classes)}>
                        {decisionMeta[activeScreening.decision].label}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <FieldRow label="目标岗位" value={selectedCandidate.parsed_candidate_profile.target_job} />
                    <FieldRow label="目标城市" value={selectedCandidate.parsed_candidate_profile.target_city} />
                    <FieldRow label="学历" value={selectedCandidate.parsed_candidate_profile.education} />
                    <FieldRow label="工作年限" value={selectedCandidate.parsed_candidate_profile.years_experience} />
                    <FieldRow label="最近公司" value={selectedCandidate.parsed_candidate_profile.recent_company} />
                    <FieldRow label="最近职位" value={selectedCandidate.parsed_candidate_profile.recent_title} />
                  </div>
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white px-5 py-5">
                  <div className="text-sm font-semibold text-slate-500">候选人摘要</div>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                    {selectedCandidate.parsed_candidate_profile.work_summary?.trim() || activeScreening?.summary?.trim() || "暂无摘要"}
                  </div>
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white px-5 py-5">
                  <button
                    type="button"
                    onClick={() => setInterviewQaExpanded((current) => !current)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-500">问答区域</div>
                      <div className="mt-1 text-xs text-slate-400">结合当前 JD 与候选人简历自动生成 5 个面试问答。</div>
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                      {interviewQaExpanded ? "收起" : "展开"}
                      {interviewQaExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>
                  <div className={cn("overflow-hidden transition-all duration-200", interviewQaExpanded ? "mt-4 max-h-[2200px] opacity-100" : "max-h-0 opacity-0")}>
                    {selectedCandidate.interview_qa?.length ? (
                      <div className="space-y-3">
                        {selectedCandidate.interview_qa.map((item, index) => (
                          <div key={`${item.question}-${index}`} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                            <div className="text-sm font-semibold text-slate-900">
                              Q{index + 1}. {item.question}
                            </div>
                            <div className="mt-3 rounded-[16px] bg-white px-4 py-3 text-sm leading-7 text-slate-700">
                              <span className="mr-2 font-semibold text-slate-500">参考答案</span>
                              {item.answer}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400">暂无问答内容</div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[26px] border border-slate-200 bg-white px-5 py-5">
                    <div className="text-sm font-semibold text-slate-500">命中点</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeScreening?.matched_points?.length ? (
                        activeScreening.matched_points.map((item) => (
                          <span key={item} className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            {item}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400">暂无命中点</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-slate-200 bg-white px-5 py-5">
                    <div className="text-sm font-semibold text-slate-500">风险提示</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeScreening?.risks?.length ? (
                        activeScreening.risks.map((item) => (
                          <span key={item} className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                            {item}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400">暂无风险提示</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white px-5 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-500">筛选历史</div>
                    <div className="text-xs text-slate-400">
                      共 {selectedCandidate.screenings.length} 条记录
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {selectedCandidate.screenings.length ? (
                      selectedCandidate.screenings.map((item) => (
                        <div key={item.id} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {item.decision ? (
                                <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", decisionMeta[item.decision].classes)}>
                                  {decisionMeta[item.decision].label}
                                </span>
                              ) : null}
                              <span className="text-xs text-slate-500">{item.model_name || "-"}</span>
                              <span className="text-xs text-slate-400">{formatDate(item.created_at)}</span>
                            </div>
                            <div className="text-xs text-slate-500">
                              分数：{typeof item.score === "number" ? item.score : "-"} / 用时：{item.duration_ms ?? "-"} ms
                            </div>
                          </div>
                          <div className="mt-3 text-sm leading-7 text-slate-600">{item.summary?.trim() || "暂无摘要"}</div>
                          {item.error_message ? (
                            <div className="mt-3 rounded-[16px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                              错误：{item.error_message}
                            </div>
                          ) : null}
                          {item.request_payload ? (
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">查看 AI 入参</summary>
                              <pre className="mt-2 max-h-60 overflow-auto rounded-[12px] border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 whitespace-pre-wrap break-all">
                                {JSON.stringify(item.request_payload, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                          {item.response_payload ? (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">查看 AI 原始输出</summary>
                              <pre className="mt-2 max-h-60 overflow-auto rounded-[12px] border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 whitespace-pre-wrap break-all">
                                {JSON.stringify(item.response_payload, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-400">暂无筛选历史</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <Dialog open={Boolean(deleteConfirm)} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-[460px] rounded-[28px] border-slate-200 bg-white p-6">
          <DialogHeader>
              <DialogTitle>{deleteConfirm?.title || "确认删除？"}</DialogTitle>
              <DialogDescription>{deleteConfirm?.description || "该操作不可撤销。"}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex-row justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteConfirm(null)}
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={Boolean(deletingJobRuleId)}
              className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {deletingJobRuleId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              确认删除
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}


