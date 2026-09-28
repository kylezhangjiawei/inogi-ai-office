import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Award,
  Bot,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Download,
  FileUp,
  GraduationCap,
  FolderUp,
  Loader2,
  Mail,
  MapPin,
  MessageSquarePlus,
  Phone,
  RefreshCw,
  Send,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Upload,
  UserRoundSearch,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { MaterialInput, MaterialSelect, MaterialTextarea } from "./components/MaterialFields";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { Label } from "./components/ui/label";
import { cn } from "./components/ui/utils";
import { ImageWithFallback } from "./components/figma/ImageWithFallback";
import { formatAiModelConfigLabel, getAiModelUsage } from "./lib/aiModelOptions";
import {
  type CandidateDetail,
  type CandidateAiChatMessage,
  type CandidateAiUpdateSuggestion,
  type CandidateFilterSessionMessage,
  type CandidateFilterSessionVersion,
  type CandidateFilterTask,
  CandidateFilterTaskHttpError,
  type CandidateListItem,
  type Decision,
  type HealthResponse,
  type JobRule,
  type MailConfigItem,
  type MailSyncRunResult,
  type MailSyncSchedule,
  type OpenAiConfigItem,
  type PaginationMeta,
  type ResumeUploadRunResult,
  type ResumeUploadStatusItem,
  recruitmentApi,
} from "./lib/recruitmentApi";
import { usePermission } from "./hooks/usePermission";
import { PERMISSIONS } from "./lib/permissions";
import { useAuth } from "./auth";
import { getStoredUser } from "./lib/authSession";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { Textarea } from "./components/ui/textarea";

type RuleFormState = {
  id?: string;
  name: string;
  jd_text: string;
  enabled: boolean;
};

type ScheduleFormState = MailSyncSchedule;

type DeleteConfirmState =
  | {
      kind: "job-rule";
      id: string;
      title: string;
      description: string;
      confirmLabel?: string;
    }
  | {
      kind: "candidate-batch";
      ids: string[];
      title: string;
      description: string;
      confirmLabel?: string;
    }
  | {
      kind: "candidate";
      id: string;
      title: string;
      description: string;
      confirmLabel?: string;
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
  recommend: { label: "推荐", classes: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" },
  hold: { label: "待定", classes: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200" },
  reject: { label: "淘汰", classes: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" },
};

const decisionOptions = [
  { label: "全部结论", value: "" },
  { label: "推荐", value: "recommend" },
  { label: "待定", value: "hold" },
  { label: "淘汰", value: "reject" },
];

const screeningDimensionLabels: Record<string, string> = {
  job_match: "岗位匹配",
  experience: "经验匹配",
  skills: "技能匹配",
  stability: "稳定性",
  location: "地域匹配",
  education: "学历匹配",
  salary: "薪资风险",
};

const MATECHAT_AVATAR = "https://matechat.gitcode.com/logo.svg";

const candidateProfilePatchLabels: Record<string, string> = {
  name: "姓名",
  gender: "性别",
  birth_or_age: "年龄",
  education: "学历",
  status: "状态",
  city: "城市",
  hukou: "户口",
  target_job: "求职岗位",
  target_city: "目标城市",
  salary_expectation: "薪资期望",
  recent_company: "最近公司",
  recent_title: "最近职位",
  years_experience: "工作年限",
  work_summary: "工作摘要",
  email: "邮箱",
  phone: "电话",
  language_skills: "语言能力",
};

const candidateScreeningPatchLabels: Record<string, string> = {
  ai_job: "AI 岗位",
  score: "分数",
  decision: "结论",
  tags: "标签",
  dimensions: "多维评分",
  matched_points: "命中点",
  risks: "风险",
  summary: "摘要",
  next_step: "下一步",
};

const defaultCandidatePagination: PaginationMeta = {
  page: 1,
  page_size: 10,
  total: 0,
  total_pages: 0,
  has_next: false,
  has_previous: false,
};

type SyncMailPreview = NonNullable<MailSyncRunResult["mail_previews"]>[number];
type UploadFilePreview = NonNullable<ResumeUploadRunResult["file_previews"]>[number];
type CandidateLoadOptions = {
  silent?: boolean;
  jobRuleId?: string;
  screeningVersion?: string;
};

type CandidateDetailLoadOptions = {
  silent?: boolean;
  screeningVersion?: string;
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

function formatDateParts(value?: string | null) {
  if (!value) return { date: "-", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };
  const pad = (input: number) => String(input).padStart(2, "0");
  return {
    date: `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function compactReportText(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function csvEscape(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function scoreTone(score?: number | null) {
  if (typeof score !== "number") return "bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200";
  if (score >= 80) return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  if (score >= 60) return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
}

function parseAgeFromBirthOrAge(value?: string | null): number | null {
  if (!value) return null;
  const normalized = value.trim();
  const ageMatch = normalized.match(/^(\d{1,3})\s*岁?$/);
  if (ageMatch) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 1 && age <= 120) return age;
  }
  const yearMatch = normalized.match(/^(19|20)(\d{2})/);
  if (yearMatch) {
    const year = parseInt(normalized.slice(0, 4), 10);
    const age = new Date().getFullYear() - year;
    if (age >= 1 && age <= 120) return age;
  }
  return null;
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
    return `${name}`;
  }
  if (candidate.job_rule_name) {
    return `${name}`;
  }
  return name;
}

function normalizeJobLabel(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function buildCandidateJobLabels(candidate: CandidateListItem) {
  const labels = [
    normalizeJobLabel(candidate.target_job) || normalizeJobLabel(extractAppliedJobTitle(candidate.source_subject)),
    normalizeJobLabel(candidate.job_rule_name),
  ].filter(Boolean);

  const seen = new Set<string>();
  const uniqueLabels = labels.filter((label) => {
    const key = label.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return uniqueLabels.length ? uniqueLabels : ["-"];
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
    if (message.includes("已处理过") || message.includes("已同步") || message.includes("无需重复")) {
      return {
        status: "已处理",
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

function shouldDisplayUploadPreview(_file: UploadFilePreview) {
  // 后端会为每个文件返回处理结果（已入队 / 格式不支持 / 不符合岗位 / 已存在 / 待配置 AI / 处理失败 等），
  // 其中“已入队”文案还带有动态岗位名（如「已入队，AI 正在分析（机械制图员）」）。
  // 这里展示全部结果，让用户清楚每个文件的去向；切勿再用固定字符串白名单过滤——
  // 否则只要后端文案改动，整段上传反馈就会静默丢失（曾导致“上传后无任何有效提示”）。
  return true;
}

function toCandidateScreeningStatus(status?: string | null) {
  return status?.trim().toLowerCase() || null;
}

function buildScreeningTags(screening?: CandidateDetail["active_screening"] | null) {
  const fromTags = screening?.tags?.map((item) => item.trim()).filter(Boolean) ?? [];
  const fallback = [...(screening?.matched_points ?? []), ...(screening?.risks ?? [])]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const source = fromTags.length ? fromTags : fallback;
  return Array.from(new Set(source)).slice(0, 12);
}

function getDimensionEntries(screening?: CandidateDetail["active_screening"] | null) {
  const dimensions = screening?.dimensions ?? {};
  return Object.entries(dimensions)
    .filter(([, value]) => value && (value.label || value.reason || typeof value.score === "number"))
    .map(([key, value]) => ({
      key,
      label: screeningDimensionLabels[key] ?? key,
      score: value.score,
      valueLabel: value.label,
      reason: value.reason,
    }));
}

function normalizeAiChatText(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function getPatchKeys(value?: object) {
  if (!value) return [];
  return Object.entries(value)
    .filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === "object") return Object.keys(item).length > 0;
      return item !== undefined && item !== null && String(item).trim() !== "";
    })
    .map(([key]) => key);
}

function hasCandidateAiUpdateSuggestion(update?: CandidateAiUpdateSuggestion) {
  return Boolean(getPatchKeys(update?.profile_patch).length || getPatchKeys(update?.screening_patch).length);
}

function formatPatchValue(value: unknown) {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value && typeof value === "object") return Object.keys(value).join("、");
  return String(value ?? "");
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
    <Button variant="unstyled"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[4px] border transition disabled:cursor-not-allowed disabled:opacity-60",
        tone === "danger" && "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
        tone === "default" && "material-neu-button",
      )}
    >
      {children}
    </Button>
  );
}

export function ResumeScreeningPage() {
  const { user: filterUser } = useAuth();
  const filterUserId = filterUser?.id ?? "";
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [jobRules, setJobRules] = useState<JobRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [deletingJobRuleId, setDeletingJobRuleId] = useState<string | null>(null);
  const [batchDeletingCandidates, setBatchDeletingCandidates] = useState(false);
  const [checkedCandidateIds, setCheckedCandidateIds] = useState<Set<string>>(new Set());
  const [exportingCandidates, setExportingCandidates] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(null);
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
  const canDeleteCandidate = usePermission(PERMISSIONS.RESUME_DELETE);
  const canScreenCandidates = usePermission(PERMISSIONS.RESUME_SCREEN);
  const filterPermissionRef = useRef(canScreenCandidates);
  filterPermissionRef.current = canScreenCandidates;

  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(defaultScheduleForm);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<MailSyncRunResult | null>(null);
  const [uploadingFolder, setUploadingFolder] = useState(false);
  const [lastUploadResult, setLastUploadResult] = useState<ResumeUploadRunResult | null>(null);
  const [showJobRuleManager, setShowJobRuleManager] = useState(false);
  const [showSyncSettings, setShowSyncSettings] = useState(false);

  const [decisionFilter, setDecisionFilter] = useState<Decision | "">("");
  const [jobRuleFilter, setJobRuleFilter] = useState("");
  const [minScoreFilter, setMinScoreFilter] = useState("");
  const [minAgeFilter, setMinAgeFilter] = useState("");
  const [maxAgeFilter, setMaxAgeFilter] = useState("");
  const [candidateKeyword, setCandidateKeyword] = useState("");
  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [candidatePage, setCandidatePage] = useState(0);
  const [candidateRowsPerPage, setCandidateRowsPerPage] = useState(10);
  const [candidatePagination, setCandidatePagination] = useState<PaginationMeta>(defaultCandidatePagination);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [filterSessions, setFilterSessions] = useState<CandidateFilterSessionVersion[]>([]);
  const [selectedFilterVersion, setSelectedFilterVersion] = useState("");
  const [filterConversation, setFilterConversation] = useState<CandidateFilterSessionMessage[]>([]);
  const [filterInstruction, setFilterInstruction] = useState("");
  const [filterRunning, setFilterRunning] = useState(false);
  const [filterTask, setFilterTask] = useState<CandidateFilterTask | null>(null);
  const [filterQuerying, setFilterQuerying] = useState(false);
  const [filterQueryError, setFilterQueryError] = useState("");
  const [filterQueryEpoch, setFilterQueryEpoch] = useState(0);
  const filterRequestRef = useRef<AbortController | null>(null);
  const filterSubmitRef = useRef<AbortController | null>(null);
  const appliedFilterTaskRef = useRef("");
  const filterTaskUserRef = useRef("");
  const pendingFilterScopeRef = useRef<{ jobRuleId: string; version: string } | null>(null);
  const filterContextRef = useRef({ userId: filterUserId, jobRuleId: jobRuleFilter, version: selectedFilterVersion });
  if (filterContextRef.current.userId !== filterUserId || filterContextRef.current.jobRuleId !== jobRuleFilter || filterContextRef.current.version !== selectedFilterVersion) {
    filterContextRef.current = { userId: filterUserId, jobRuleId: jobRuleFilter, version: selectedFilterVersion };
  }
  const filterResultPending = Boolean(canScreenCandidates && filterTask?.status === "completed" && filterTask.result
    && appliedFilterTaskRef.current !== filterTask.task_id && filterTaskUserRef.current === filterUserId
    && (filterTask.job_rule_id ?? "") === jobRuleFilter && (filterTask.base_version ?? "") === selectedFilterVersion);
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateDetail | null>(null);
  const [candidateDetailDialogOpen, setCandidateDetailDialogOpen] = useState(false);
  const [interviewQaExpanded, setInterviewQaExpanded] = useState(false);
  const [screeningHistoryExpanded, setScreeningHistoryExpanded] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [candidateAiQuestion, setCandidateAiQuestion] = useState("");
  const [candidateAiMessagesById, setCandidateAiMessagesById] = useState<Record<string, CandidateAiChatMessage[]>>({});
  const [candidateAiLoadingId, setCandidateAiLoadingId] = useState<string | null>(null);
  const [candidateAiApplyingKey, setCandidateAiApplyingKey] = useState<string | null>(null);
  const [candidateAiDialogId, setCandidateAiDialogId] = useState<string | null>(null);
  const deferredCandidateKeyword = useDeferredValue(candidateKeyword);
  const selectedCandidateIdRef = useRef(selectedCandidateId);
  const lastCandidateFilterKeyRef = useRef("");
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFilesInputRef = useRef<HTMLInputElement | null>(null);
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
      total: candidatePagination.total,
      recommend,
      hold,
      reject,
      average,
    };
  }, [candidatePagination.total, candidates]);

  const filteredCandidates = candidates;
  const allCurrentPageChecked =
    filteredCandidates.length > 0 && filteredCandidates.every((item) => checkedCandidateIds.has(item.id));
  const someCurrentPageChecked = filteredCandidates.some((item) => checkedCandidateIds.has(item.id));
  const selectedFilterSession = useMemo(
    () => filterSessions.find((item) => item.version_id === selectedFilterVersion) ?? null,
    [filterSessions, selectedFilterVersion],
  );

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
  // 实时统计后台仍在筛选中的份数：随着轮询把每个文件状态从「已入队…」更新为完成/失败，
  // 这里的计数会自动递减，用于主页面的「正在后台筛选 N 份」进度提示。
  const pendingUploadCount = useMemo(
    () => lastUploadResult?.file_previews?.filter((file) => isSyncMailLoading(file.status)).length ?? 0,
    [lastUploadResult?.file_previews],
  );
  const pendingSyncMailCount = useMemo(
    () => lastSyncResult?.mail_previews?.filter((mail) => isSyncMailLoading(mail.status)).length ?? 0,
    [lastSyncResult?.mail_previews],
  );
  const pendingBackgroundCount = pendingUploadCount + pendingSyncMailCount;
  const hasActiveCandidateFilters = Boolean(
    candidateKeyword.trim() ||
      decisionFilter ||
      jobRuleFilter ||
      minScoreFilter.trim() ||
      minAgeFilter.trim() ||
      maxAgeFilter.trim(),
  );
  const advancedFilterCount = [minScoreFilter, minAgeFilter, maxAgeFilter].filter((value) => value.trim()).length;
  const candidateFilterKey = useMemo(
    () =>
      JSON.stringify({
        keyword: deferredCandidateKeyword,
        decision: decisionFilter,
        jobRuleId: jobRuleFilter,
        minScore: minScoreFilter,
        minAge: minAgeFilter,
        maxAge: maxAgeFilter,
        screeningVersion: selectedFilterVersion,
      }),
    [decisionFilter, deferredCandidateKeyword, jobRuleFilter, maxAgeFilter, minAgeFilter, minScoreFilter, selectedFilterVersion],
  );

  useEffect(() => {
    void loadBootstrap();
  }, []);

  // 页面加载（含刷新）时恢复后台筛选进度提示：
  // lastUploadResult 是会话内状态，刷新后会丢失，导致主页横幅与列表空态提示消失（即便 AI 仍在后台筛选）。
  // 这里查询后端仍处于 queued 的【上传】日志，若存在则重建一个最小的 lastUploadResult，
  // 让既有的轮询 effect 自动接管（拉取状态、静默刷新候选人列表、完成后自动停止），无需用户重新上传。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await recruitmentApi.listPendingResumeUploads();
        if (cancelled || !pending.length) {
          return;
        }
        setLastUploadResult((current) => {
          // 不覆盖本会话已有的上传结果（例如用户刚点过上传），避免丢失更完整的反馈信息。
          if (current) {
            return current;
          }
          return {
            uploaded_count: pending.length,
            processed: 0,
            created_candidates: 0,
            skipped: 0,
            failed: 0,
            queued_for_ai: pending.length,
            file_previews: pending.map((item) => ({
              unique_key: item.unique_key,
              candidate_id: item.candidate_id ?? undefined,
              file_name: item.file_name,
              file_type: item.file_type,
              received_at: item.received_at,
              preview: "",
              candidate_name: "",
              status: item.status, // 'queued' → isSyncMailLoading 判定为加载中，驱动进度横幅
              error_message: item.error_message,
            })),
            message: `检测到 ${pending.length} 份简历仍在后台筛选中，已为你恢复进度提示。`,
          };
        });
      } catch {
        // 静默失败：恢复进度提示属增强能力，失败不应影响页面其余功能。
      }
    })();
    return () => {
      cancelled = true;
    };
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
    const filtersChanged = lastCandidateFilterKeyRef.current !== candidateFilterKey;
    lastCandidateFilterKeyRef.current = candidateFilterKey;
    if (filtersChanged) {
      setCheckedCandidateIds(new Set());
    }
    if (filtersChanged && candidatePage !== 0) {
      setCandidatePage(0);
      return;
    }
    void loadCandidates();
  }, [candidateFilterKey, candidatePage, candidateRowsPerPage]);

  useEffect(() => {
    setSelectedFilterVersion(pendingFilterScopeRef.current?.jobRuleId === jobRuleFilter ? pendingFilterScopeRef.current.version : "");
    pendingFilterScopeRef.current = null;
    setFilterConversation([]);
    void loadCandidateFilterSessions(jobRuleFilter);
  }, [jobRuleFilter]);

  useEffect(() => {
    setFilterTask(null);
    setFilterRunning(false);
    setFilterQueryError("");
    setFilterInstruction("");
    setFilterConversation([]);
    setFilterSessions([]);
    setSelectedFilterVersion("");
    setJobRuleFilter("");
    setCandidates([]);
    setSelectedCandidateId("");
    setSelectedCandidate(null);
    appliedFilterTaskRef.current = "";
    filterTaskUserRef.current = "";
    return () => { filterRequestRef.current?.abort(); filterSubmitRef.current?.abort(); };
  }, [filterUserId]);

  useEffect(() => {
    if (!filterUserId || !canScreenCandidates) {
      filterRequestRef.current?.abort();
      filterSubmitRef.current?.abort();
      filterTaskUserRef.current = "";
      setFilterTask(null);
      setFilterRunning(false);
      setFilterQuerying(false);
      setFilterQueryError("");
      setShowFilterDialog(false);
      return;
    }
    const controller = new AbortController();
    filterRequestRef.current?.abort();
    filterSubmitRef.current?.abort();
    filterRequestRef.current = controller;
    const scope = filterContextRef.current;
    const valid = () => filterPermissionRef.current && !controller.signal.aborted && filterContextRef.current === scope && getStoredUser()?.id === scope.userId;
    const receive = (task: CandidateFilterTask | null) => {
      if (!valid()) return;
      filterTaskUserRef.current = scope.userId;
      setFilterTask(task);
      setFilterRunning(task?.status === "pending" || task?.status === "processing");
      if (task && task.status !== "completed" && (task.job_rule_id ?? "") === scope.jobRuleId && (task.base_version ?? "") === scope.version) {
        setFilterInstruction((current) => current || task.instruction);
      }
    };
    setFilterQuerying(true);
    setFilterQueryError("");
    void (async () => {
      if (filterTask && filterTaskUserRef.current === filterUserId) {
        await recruitmentApi.watchCandidateFilterTask(filterTask.task_id, { signal: controller.signal, onProgress: receive });
        return;
      }
      const task = await recruitmentApi.getCurrentCandidateFilterTask(controller.signal);
      if (!valid()) return;
      receive(task);
      if (task?.status === "pending" || task?.status === "processing") {
        await recruitmentApi.watchCandidateFilterTask(task.task_id, { signal: controller.signal, onProgress: receive });
      }
    })().catch((error) => {
      if (!valid()) return;
      if (error instanceof CandidateFilterTaskHttpError && error.status === 404 && filterTask) {
        setFilterTask(null);
        setFilterRunning(false);
      } else setFilterQueryError(getErrorMessage(error, "任务查询暂时中断，请点击继续查询。"));
    }).finally(() => { if (valid()) setFilterQuerying(false); });
    return () => controller.abort();
  }, [canScreenCandidates, filterUserId, jobRuleFilter, selectedFilterVersion, filterQueryEpoch, filterTask?.task_id]);

  useEffect(() => {
    if (!canScreenCandidates || !filterTask || filterTaskUserRef.current !== filterUserId || filterTask.status !== "completed" || !filterTask.result || appliedFilterTaskRef.current === filterTask.task_id) return;
    const scope = filterContextRef.current;
    if ((filterTask.job_rule_id ?? "") !== scope.jobRuleId || (filterTask.base_version ?? "") !== scope.version) return;
    let stopped = false;
    const valid = () => filterPermissionRef.current && !stopped && filterContextRef.current === scope && getStoredUser()?.id === scope.userId;
    void (async () => {
      const response = filterTask.result!;
      const sessions = response.action === "filter" && response.version_id
        ? await recruitmentApi.listCandidateFilterSessions(scope.jobRuleId || undefined) : null;
      if (!valid()) return;
      appliedFilterTaskRef.current = filterTask.task_id;
      setFilterInstruction((current) => current.trim() === filterTask.instruction.trim() ? "" : current);
      setFilterConversation((current) => {
        const messages = current.at(-1)?.role === "user" && current.at(-1)?.content === filterTask.instruction
          ? current : [...current, { role: "user" as const, content: filterTask.instruction }];
        return [...messages, { role: "assistant" as const, content: response.answer || response.filter_summary }].slice(-12);
      });
      if (sessions && response.version_id) {
        setFilterSessions(sessions);
        setSelectedFilterVersion(response.version_id);
        setCandidatePage(0);
        toast.success(`已生成新筛选版本，共 ${response.total_count} 人`);
      }
    })().catch((error) => { if (valid()) setFilterQueryError(getErrorMessage(error, "读取筛选结果失败，请继续查询。")); });
    return () => { stopped = true; };
  }, [canScreenCandidates, filterTask, filterUserId, jobRuleFilter, selectedFilterVersion, filterQueryEpoch]);

  useEffect(() => {
    if (!selectedFilterVersion) {
      return;
    }
    const targetSession = filterSessions.find((item) => item.version_id === selectedFilterVersion);
    if (!targetSession) {
      return;
    }
    const orderedSessions = [...filterSessions]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .filter((session) => Date.parse(session.created_at) <= Date.parse(targetSession.created_at));
    const reconstructed = orderedSessions.flatMap<CandidateFilterSessionMessage>((session) => [
      { role: "user", content: session.instruction || session.filter_summary },
      { role: "assistant", content: session.answer || session.filter_summary },
    ]).filter((message) => message.content.trim());
    setFilterConversation(reconstructed.slice(-12));
  }, [filterSessions, selectedFilterVersion]);

  useEffect(() => {
    if (!openAiConfigs.length) return;
    const isValid = openAiConfigs.some((c) => c.id === selectedOpenAiConfigId);
    if (!isValid) {
      setSelectedOpenAiConfigId(openAiConfigs.find((c) => c.enabled)?.id ?? openAiConfigs[0].id);
    }
  }, [openAiConfigs, selectedOpenAiConfigId]);

  useEffect(() => {
    if (selectedJobRuleId || !resolvedSelectedJobRule) {
      return;
    }

    hydrateRule(resolvedSelectedJobRule);
  }, [resolvedSelectedJobRule, selectedJobRuleId]);

  useEffect(() => {
    setInterviewQaExpanded(false);
    setScreeningHistoryExpanded(false);
    setCandidateAiQuestion("");
    if (!selectedCandidateId) {
      setSelectedCandidate(null);
      return;
    }
    void loadCandidateDetail(selectedCandidateId);
  }, [selectedCandidateId, selectedFilterVersion]);

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
      loadCandidateFilterSessions(),
    ]);
  }

  async function loadHealth() {
    try {
      const next = await recruitmentApi.getHealth();
      setHealth(next);
    } catch (error) {
      toast.error(getErrorMessage(error, "读取健康状态失败"));
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
      const raw = await recruitmentApi.listOpenAiConfigs();
      // Defensive: filter out image-only models (backend should already exclude them)
      const next = raw.filter((c) => {
        if (c.usage_kind === 'image') return false;
        if (c.usage_kind && c.usage_kind !== 'auto') return true;
        const n = (c.model ?? '').toLowerCase();
        return !(n.includes('gpt-image') || n.includes('image-to-image') || n === 'dall-e-2' || n.startsWith('dall-e-'));
      });
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

  async function loadCandidateFilterSessions(jobRuleId = jobRuleFilter) {
    const userId = filterContextRef.current.userId;
    const valid = () => filterContextRef.current.jobRuleId === jobRuleId && getStoredUser()?.id === userId;
    try {
      const next = await recruitmentApi.listCandidateFilterSessions(jobRuleId || undefined);
      if (!valid()) return;
      setFilterSessions(next);
      setSelectedFilterVersion((current) => {
        if (!current || next.some((item) => item.version_id === current)) {
          return current;
        }
        return "";
      });
    } catch (error) {
      if (!valid()) return;
      toast.error(getErrorMessage(error, "读取 AI 迭代筛选记录失败"));
    }
  }

  async function loadCandidates(options: CandidateLoadOptions = {}) {
    const scope = filterContextRef.current;
    const valid = () => filterContextRef.current === scope && getStoredUser()?.id === scope.userId;
    if (!options.silent) {
      setLoadingCandidates(true);
    }
    try {
      const minScore = minScoreFilter.trim() ? Number(minScoreFilter) : undefined;
      const minAge = minAgeFilter.trim() ? Number(minAgeFilter) : undefined;
      const maxAge = maxAgeFilter.trim() ? Number(maxAgeFilter) : undefined;
      const response = await recruitmentApi.listCandidates({
        keyword: deferredCandidateKeyword,
        decision: decisionFilter,
        jobRuleId: typeof options.jobRuleId === "string" ? options.jobRuleId : jobRuleFilter,
        minScore: typeof minScore === "number" && Number.isFinite(minScore) ? minScore : undefined,
        minAge: typeof minAge === "number" && Number.isFinite(minAge) ? minAge : undefined,
        maxAge: typeof maxAge === "number" && Number.isFinite(maxAge) ? maxAge : undefined,
        screeningVersion:
          typeof options.screeningVersion === "string" ? options.screeningVersion || undefined : selectedFilterVersion || undefined,
        page: candidatePage + 1,
        pageSize: candidateRowsPerPage,
      });
      const next = response.items;
      if (!valid()) return;
      setCandidates(next);
      setCandidatePagination(response.pagination);
      const normalizedPage = Math.max(0, response.pagination.page - 1);
      if (normalizedPage !== candidatePage) {
        setCandidatePage(normalizedPage);
      }
      setSelectedCandidateId((current) => {
        if (current && next.some((item) => item.id === current)) return current;
        return "";
      });
    } catch (error) {
      if (!valid()) return;
      if (!options.silent) {
        toast.error(getErrorMessage(error, "读取候选人列表失败"));
        setCandidates([]);
        setCandidatePagination(defaultCandidatePagination);
        setSelectedCandidateId("");
      }
    } finally {
      if (!options.silent && valid()) {
        setLoadingCandidates(false);
      }
    }
  }

  async function loadCandidateDetail(candidateId: string, options: CandidateDetailLoadOptions = {}) {
    const scope = filterContextRef.current;
    const valid = () => filterContextRef.current === scope && getStoredUser()?.id === scope.userId;
    if (!options.silent) {
      setLoadingDetail(true);
    }
    try {
      const next = await recruitmentApi.getCandidateDetail(candidateId, {
        screeningVersion:
          typeof options.screeningVersion === "string" ? options.screeningVersion || undefined : selectedFilterVersion || undefined,
      });
      const detailActiveScreening = next.active_screening ?? next.screenings?.[0] ?? null;
      if (!valid()) return;
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
      if (!valid()) return;
      if (!options.silent) {
        toast.error(getErrorMessage(error, "读取候选人详情失败"));
        setSelectedCandidate(null);
      }
    } finally {
      if (!options.silent && valid()) {
        setLoadingDetail(false);
      }
    }
  }

  function resetRuleForm() {
    // 仅重置“当前岗位 / 规则编辑”状态，不要联动表格的岗位筛选（jobRuleFilter）。
    // 表格有自己独立的岗位筛选下拉，顶部 select 不应影响它。
    setSelectedJobRuleId("");
    setRuleForm(emptyRuleForm);
  }

  function hydrateRule(jobRule: JobRule) {
    // 同上：选择/水合当前岗位只更新顶部 select 与规则表单，不改动表格筛选 jobRuleFilter。
    setSelectedJobRuleId(jobRule.id);
    setRuleForm({
      id: jobRule.id,
      name: jobRule.name,
      jd_text: jobRule.jd_text,
      enabled: jobRule.enabled,
    });
  }

  async function handleSaveRule() {
    if (!ruleForm.jd_text.trim()) {
      toast.error("请先填写完整岗位规则");
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

  function toggleCandidateChecked(candidateId: string, checked: boolean) {
    setCheckedCandidateIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(candidateId);
      } else {
        next.delete(candidateId);
      }
      return next;
    });
  }

  function toggleAllCurrentPageChecked(checked: boolean) {
    setCheckedCandidateIds((current) => {
      const next = new Set(current);
      filteredCandidates.forEach((item) => {
        if (checked) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
      });
      return next;
    });
  }

  function handleResetCandidateFilters() {
    setCandidateKeyword("");
    setDecisionFilter("");
    setJobRuleFilter("");
    setMinScoreFilter("");
    setMinAgeFilter("");
    setMaxAgeFilter("");
    setCandidatePage(0);
  }

  function openCandidateDetail(candidateId: string) {
    setScreeningHistoryExpanded(false);
    if (selectedCandidateId !== candidateId) {
      setSelectedCandidate(null);
      setInterviewQaExpanded(false);
    }
    setSelectedCandidateId(candidateId);
    setCandidateDetailDialogOpen(true);
  }

  async function handleExportCandidates() {
    setExportingCandidates(true);
    try {
      const minScore = minScoreFilter.trim() ? Number(minScoreFilter) : undefined;
      const minAge = minAgeFilter.trim() ? Number(minAgeFilter) : undefined;
      const maxAge = maxAgeFilter.trim() ? Number(maxAgeFilter) : undefined;
      const baseFilters = {
        keyword: deferredCandidateKeyword,
        decision: decisionFilter,
        jobRuleId: jobRuleFilter,
        minScore: typeof minScore === "number" && Number.isFinite(minScore) ? minScore : undefined,
        minAge: typeof minAge === "number" && Number.isFinite(minAge) ? minAge : undefined,
        maxAge: typeof maxAge === "number" && Number.isFinite(maxAge) ? maxAge : undefined,
        screeningVersion: selectedFilterVersion || undefined,
      };
      const all: CandidateListItem[] = [];
      let page = 1;
      for (;;) {
        const response = await recruitmentApi.listCandidates({ ...baseFilters, page, pageSize: 100 });
        all.push(...response.items);
        if (!response.pagination.has_next || page >= 100) break;
        page += 1;
      }
      if (!all.length) {
        toast.info("当前筛选条件下没有候选人可导出");
        return;
      }
      const headers = ["姓名", "岗位", "分数", "结论", "城市", "年龄", "学历", "求职状态", "筛选状态", "收件时间", "邮箱", "电话", "AI 摘要"];
      const rows = all.map((candidate) => {
        const age = parseAgeFromBirthOrAge(candidate.birth_or_age);
        const screeningStatus = candidate.screening_status ?? candidate.active_screening_status;
        const mappedStatus = mapScreeningStatusToMailStatus(screeningStatus, candidate.screening_error_message);
        return [
          candidate.name || "",
          buildCandidateJobLabels(candidate).join(" / "),
          typeof candidate.score === "number" ? String(candidate.score) : "",
          candidate.decision ? decisionMeta[candidate.decision].label : "",
          candidate.city || "",
          age != null ? String(age) : candidate.birth_or_age || "",
          candidate.education || "",
          candidate.status || "",
          mappedStatus?.status || "待处理",
          formatDate(candidate.received_at),
          candidate.email || "",
          candidate.phone || "",
          candidate.summary || "",
        ];
      });
      const csv = [headers, ...rows].map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\r\n");
      const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const now = new Date();
      const pad = (input: number) => String(input).padStart(2, "0");
      link.href = url;
      link.download = `候选人筛选结果_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${all.length} 位候选人`);
    } catch (error) {
      toast.error(getErrorMessage(error, "导出候选人失败"));
    } finally {
      setExportingCandidates(false);
    }
  }

  async function handleBatchDeleteCandidates(candidateIds: string[]) {
    if (!candidateIds.length) return;
    setBatchDeletingCandidates(true);
    const succeeded = new Set<string>();
    let failed = 0;
    try {
      for (const candidateId of candidateIds) {
        try {
          await recruitmentApi.deleteCandidate(candidateId);
          succeeded.add(candidateId);
        } catch {
          failed += 1;
        }
      }
      setCandidates((current) => current.filter((item) => !succeeded.has(item.id)));
      setCheckedCandidateIds((current) => {
        const next = new Set(current);
        succeeded.forEach((id) => next.delete(id));
        return next;
      });
      if (selectedCandidateId && succeeded.has(selectedCandidateId)) {
        setSelectedCandidateId("");
        setSelectedCandidate(null);
        setInterviewQaExpanded(false);
        setScreeningHistoryExpanded(false);
      }
      if (candidateAiDialogId && succeeded.has(candidateAiDialogId)) {
        setCandidateAiDialogId(null);
      }
      if (failed) {
        toast.warning(`批量删除完成：成功 ${succeeded.size} 位，失败 ${failed} 位。`);
      } else {
        toast.success(`已删除 ${succeeded.size} 位候选人。`);
      }
      void loadCandidates({ silent: true });
    } finally {
      setBatchDeletingCandidates(false);
    }
  }

  async function handleDeleteCandidate(candidateId: string) {
    setDeletingCandidateId(candidateId);
    try {
      const result = await recruitmentApi.deleteCandidate(candidateId);
      setCandidates((current) => current.filter((item) => item.id !== candidateId));
      if (selectedCandidateId === candidateId) {
        setSelectedCandidateId("");
        setSelectedCandidate(null);
        setInterviewQaExpanded(false);
        setScreeningHistoryExpanded(false);
      }
      if (candidateAiDialogId === candidateId) {
        setCandidateAiDialogId(null);
      }
      toast.success(
        `已删除候选人，共清理 ${result.deleted_screenings} 条筛选记录、${result.deleted_logs} 条打点记录。`,
      );
      void loadCandidates({ silent: true });
    } catch (error) {
      toast.error(getErrorMessage(error, "删除候选人失败"));
    } finally {
      setDeletingCandidateId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;

    if (deleteConfirm.kind === "job-rule") {
      const target = jobRules.find((item) => item.id === deleteConfirm.id);
      if (target) {
        await handleDeleteJobRule(target);
      }
    } else if (deleteConfirm.kind === "candidate") {
      await handleDeleteCandidate(deleteConfirm.id);
    } else {
      await handleBatchDeleteCandidates(deleteConfirm.ids);
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
      await loadCandidates();
      // 只刷新执行时间戳，不覆盖用户在表单里选择的邮箱、AI 模型、回溯小时、抓取上限
      try {
        const latestSchedule = await recruitmentApi.getMailSyncSchedule();
        setScheduleForm((current) => ({
          ...current,
          last_run_at: latestSchedule.last_run_at ?? null,
          last_run_result: latestSchedule.last_run_result ?? null,
        }));
      } catch {
        // 非关键，忽略
      }
      toast.success(result.message || "同步执行完成");
    } catch (error) {
      toast.error(getErrorMessage(error, "执行同步失败"));
    } finally {
      setRunningSync(false);
    }
  }

  async function handleUploadResumes(event: React.ChangeEvent<HTMLInputElement>) {
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
      // 根据真实处理结果给出反馈，而不是一律 success：
      // 没有任何文件入队（格式不支持/不符合岗位/重复/未配置 AI）时必须报错提示，
      // 否则用户会误以为“上传成功”却看不到任何识别结果。
      const queuedCount = result.queued_for_ai ?? 0;
      const failedCount = result.failed ?? 0;
      const skippedCount = result.skipped ?? 0;
      const uploadFeedback = result.message || "简历上传完成";
      if (queuedCount > 0) {
        if (failedCount > 0 || skippedCount > 0) {
          toast.warning(uploadFeedback);
        } else {
          toast.success(uploadFeedback);
        }
      } else {
        toast.error(uploadFeedback);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "上传简历失败"));
    } finally {
      setUploadingFolder(false);
      event.target.value = "";
    }
  }

  async function handleIterateCandidateFilter() {
    if (!canScreenCandidates) return;
    const instruction = filterInstruction.trim();
    if (!instruction) {
      toast.error("请输入本轮筛选希望 AI 关注的条件");
      return;
    }
    if (filterRunning || filterQuerying || filterQueryError || filterResultPending || filterSubmitRef.current) return;
    const scope = filterContextRef.current;
    const controller = new AbortController();
    filterRequestRef.current?.abort();
    filterSubmitRef.current = controller;
    const valid = () => filterPermissionRef.current && !controller.signal.aborted && filterContextRef.current === scope && getStoredUser()?.id === scope.userId;
    setFilterRunning(true);
    try {
      const task = await recruitmentApi.createCandidateFilterTask({
        job_rule_id: scope.jobRuleId || undefined,
        instruction,
        base_version: scope.version || undefined,
        history: filterConversation.slice(-10),
      }, controller.signal);
      if (!valid()) return;
      filterTaskUserRef.current = scope.userId;
      setFilterTask(task);
      setFilterRunning(task.status === "pending" || task.status === "processing");
      setFilterConversation((current) => [...current, { role: "user" as const, content: instruction }].slice(-12));
      setFilterQueryEpoch((value) => value + 1);
    } catch (error) {
      if (!valid()) return;
      setFilterRunning(false);
      // A lost POST response may already have created a durable task. Recover via GET before any resend.
      if (!(error instanceof CandidateFilterTaskHttpError) || error.status >= 500 || error.status === 409) {
        setFilterTask(null);
        setFilterQueryError("提交结果暂未确认，输入已保留。请继续查询后台任务。");
      } else toast.error(getErrorMessage(error, "AI 二次筛选提交失败"));
    } finally {
      if (filterSubmitRef.current === controller) filterSubmitRef.current = null;
    }
  }

  async function handleRetryCandidateFilterTask() {
    if (!canScreenCandidates || !filterTask?.retryable || filterQuerying || filterRunning || filterSubmitRef.current) return;
    const taskId = filterTask.task_id;
    const scope = filterContextRef.current;
    const controller = new AbortController();
    filterSubmitRef.current = controller;
    const valid = () => filterPermissionRef.current && !controller.signal.aborted && filterContextRef.current === scope && getStoredUser()?.id === scope.userId;
    setFilterRunning(true);
    setFilterQueryError("");
    try {
      const task = await recruitmentApi.retryCandidateFilterTask(taskId, controller.signal);
      if (!valid()) return;
      filterTaskUserRef.current = scope.userId;
      setFilterTask(task);
      setFilterQueryEpoch((value) => value + 1);
    } catch (error) {
      if (!valid()) return;
      setFilterRunning(false);
      setFilterQueryError(getErrorMessage(error, "继续执行结果暂未确认，请继续查询。"));
    } finally {
      if (filterSubmitRef.current === controller) filterSubmitRef.current = null;
    }
  }

  function showCandidateFilterTaskScope() {
    if (!canScreenCandidates || !filterTask) return;
    const next = { jobRuleId: filterTask.job_rule_id ?? "", version: filterTask.base_version ?? "" };
    if (next.jobRuleId === jobRuleFilter) setSelectedFilterVersion(next.version);
    else { pendingFilterScopeRef.current = next; setJobRuleFilter(next.jobRuleId); }
    if (filterTask.status !== "completed") setFilterInstruction(filterTask.instruction);
    setShowFilterDialog(true);
  }

  function renderCandidateFilterProgress() {
    if (!canScreenCandidates) return null;
    const task = filterTaskUserRef.current === filterUserId ? filterTask : null;
    if (!task && !filterQueryError) return null;
    const phaseLabels: Record<CandidateFilterTask["phase"], string> = {
      queued: "等待处理", preparing: "正在准备候选人", analyzing: "正在分析筛选条件",
      scoring: "正在逐批评分", saving: "正在保存完整版本", complete: "本轮已完成", failed: "本轮处理暂停",
    };
    const sameScope = task && (task.job_rule_id ?? "") === jobRuleFilter
      && ((task.base_version ?? "") === selectedFilterVersion || task.result?.version_id === selectedFilterVersion);
    return (
      <div className="mt-3 rounded-lg border border-blue-100 bg-white px-4 py-3 text-sm text-slate-700" role="status" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-medium">
            {filterRunning && !filterQueryError ? <Loader2 className="size-4 animate-spin text-blue-700" /> : <Clock3 className="size-4 text-blue-700" />}
            {task ? phaseLabels[task.phase] : "确认后台任务"}
          </span>
          {task ? <span className="tabular-nums">已评分 {task.processed_count} / {task.total_count} 人</span> : null}
        </div>
        {task ? <p className="mt-2 text-xs text-slate-500">范围：{task.job_rule_id ? jobRules.find((rule) => rule.id === task.job_rule_id)?.name || "指定岗位" : "全部岗位"} · 关闭页面后仍会继续处理</p> : null}
        {task?.status === "failed" && task.error ? <p className="mt-2 break-words text-sm text-red-700">{task.error}</p> : null}
        {filterQueryError ? <p className="mt-2 text-sm text-amber-800">{filterQueryError}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {filterQueryError ? <Button size="sm" variant="outline" disabled={filterQuerying} onClick={() => setFilterQueryEpoch((value) => value + 1)}>{filterQuerying ? "查询中" : "继续查询"}</Button> : null}
          {task?.status === "failed" && task.retryable && !filterQueryError ? <Button size="sm" variant="outline" disabled={filterRunning || filterQuerying} onClick={() => void handleRetryCandidateFilterTask()}>继续执行</Button> : null}
          {task && !sameScope ? <Button size="sm" variant="outline" onClick={showCandidateFilterTaskScope}>查看任务范围</Button> : null}
        </div>
      </div>
    );
  }

  async function handleAskCandidateAi() {
    const question = candidateAiQuestion.trim();
    const target = candidateAiTarget;
    if (!target || !question || candidateAiLoadingId === target.id) {
      return;
    }

    const candidateId = target.id;
    const currentMessages = candidateAiMessagesById[candidateId] ?? [];
    const nextMessages: CandidateAiChatMessage[] = [...currentMessages, { role: "user", content: question }];
    setCandidateAiMessagesById((current) => ({
      ...current,
      [candidateId]: nextMessages,
    }));
    setCandidateAiQuestion("");
    setCandidateAiLoadingId(candidateId);
    try {
      const response = await recruitmentApi.askCandidateAi(candidateId, {
        question,
        history: currentMessages,
      });
      const suffix = [
        response.recommended_action ? `建议动作：${response.recommended_action}` : "",
        response.suggested_tags?.length ? `补充标签：${response.suggested_tags.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const fullAnswer = normalizeAiChatText(suffix ? `${response.answer}\n\n${suffix}` : response.answer);
      const assistantIndex = nextMessages.length;
      const aiUpdate: CandidateAiUpdateSuggestion = {
        profile_patch: response.profile_patch,
        screening_patch: response.screening_patch,
        update_reason: response.update_reason,
        source_answer: fullAnswer,
      };
      setCandidateAiMessagesById((current) => ({
        ...current,
        [candidateId]: [
          ...(current[candidateId] ?? nextMessages),
          {
            role: "assistant",
            content: "",
            ai_update: hasCandidateAiUpdateSuggestion(aiUpdate) ? aiUpdate : undefined,
          },
        ],
      }));

      let cursor = 0;
      const timer = window.setInterval(() => {
        cursor += Math.max(1, Math.ceil(fullAnswer.length / 80));
        const nextContent = fullAnswer.slice(0, cursor);
        setCandidateAiMessagesById((current) => {
          const messages = current[candidateId] ?? [];
          return {
            ...current,
            [candidateId]: messages.map((message, index) =>
              index === assistantIndex ? { ...message, content: nextContent } : message,
            ),
          };
        });
        if (cursor >= fullAnswer.length) {
          window.clearInterval(timer);
        }
      }, 24);
    } catch (error) {
      setCandidateAiMessagesById((current) => ({
        ...current,
        [candidateId]: currentMessages,
      }));
      toast.error(getErrorMessage(error, "AI 追问失败"));
    } finally {
      setCandidateAiLoadingId((current) => (current === candidateId ? null : current));
    }
  }

  async function handleApplyCandidateAiUpdate(candidateId: string, messageIndex: number, update: CandidateAiUpdateSuggestion) {
    if (!hasCandidateAiUpdateSuggestion(update)) {
      toast.error("当前 AI 回复没有可应用的结构化建议。");
      return;
    }

    const applyingKey = `${candidateId}:${messageIndex}`;
    setCandidateAiApplyingKey(applyingKey);
    try {
      const nextDetail = await recruitmentApi.applyCandidateAiUpdate(candidateId, update);
      setSelectedCandidate(nextDetail);
      setSelectedCandidateId(candidateId);
      await loadCandidates({ silent: true });
      setCandidateAiMessagesById((current) => ({
        ...current,
        [candidateId]: (current[candidateId] ?? []).map((message, index) =>
          index === messageIndex
            ? {
                ...message,
                ai_update: {
                  ...message.ai_update,
                  profile_patch: undefined,
                  screening_patch: undefined,
                  update_reason: update.update_reason ? `${update.update_reason}（已应用）` : "已应用到候选人详情",
                },
              }
            : message,
        ),
      }));
      toast.success("AI 建议已应用到候选人详情");
    } catch (error) {
      toast.error(getErrorMessage(error, "应用 AI 建议失败"));
    } finally {
      setCandidateAiApplyingKey((current) => (current === applyingKey ? null : current));
    }
  }

  const activeScreening = selectedCandidate?.active_screening ?? selectedCandidate?.screenings?.[0];
  const activeScreeningTags = buildScreeningTags(activeScreening ?? null);
  const activeDimensionEntries = getDimensionEntries(activeScreening ?? null);
  const selectedCandidateProfile = selectedCandidate?.parsed_candidate_profile;
  const reportSummary =
    selectedCandidateProfile?.work_summary?.trim() ||
    activeScreening?.summary?.trim() ||
    "暂无摘要";
  const reportHighlights = reportSummary
    .split(/[\n。；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const reportCompetencies = (
    activeScreeningTags.length
      ? activeScreeningTags
      : (selectedCandidateProfile?.language_skills?.filter(Boolean) ?? [])
  ).slice(0, 10);
  const reportStrengths = activeScreening?.matched_points?.filter(Boolean).slice(0, 7) ?? [];
  const reportGaps = activeScreening?.risks?.filter(Boolean).slice(0, 7) ?? [];
  const reportScore = typeof activeScreening?.score === "number" ? Math.max(0, Math.min(100, Math.round(activeScreening.score))) : null;
  const reportScoreTen = reportScore == null ? null : Math.max(0, Math.min(10, Math.round(reportScore / 10)));
  const reportRole =
    selectedCandidateProfile?.target_job ||
    selectedCandidateProfile?.recent_title ||
    activeScreening?.ai_job ||
    "岗位待确认";
  const reportCompany = selectedCandidateProfile?.recent_company || selectedCandidate?.source_subject || "最近经历待确认";
  const reportLocation = selectedCandidateProfile?.city || selectedCandidateProfile?.target_city || selectedCandidateProfile?.hukou || "-";
  const reportDecision = activeScreening?.decision ? decisionMeta[activeScreening.decision] : null;
  const reportGrade =
    reportScore == null
      ? "待评估"
      : reportScore >= 80
        ? "优先沟通"
        : reportScore >= 60
          ? "建议复核"
          : "谨慎推进";
  const reportGradeClass =
    reportScore == null
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : reportScore >= 80
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : reportScore >= 60
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-rose-200 bg-rose-50 text-rose-700";
  const reportBrief = compactReportText(reportSummary, 260);
  const reportProfileRows = [
    { label: "目标岗位", value: reportRole, Icon: Target },
    { label: "最近职位", value: selectedCandidateProfile?.recent_title || "-", Icon: Briefcase },
    { label: "最近公司", value: selectedCandidateProfile?.recent_company || "-", Icon: Database },
    { label: "工作年限", value: selectedCandidateProfile?.years_experience || "-", Icon: Clock3 },
    { label: "学历", value: selectedCandidateProfile?.education || "-", Icon: GraduationCap },
    { label: "城市", value: reportLocation, Icon: MapPin },
  ];
  const reportContactRows = [
    { label: "邮箱", value: selectedCandidateProfile?.email || "-", Icon: Mail },
    { label: "电话", value: selectedCandidateProfile?.phone || "-", Icon: Phone },
    { label: "来源", value: selectedCandidate?.source_sender_email || selectedCandidate?.source_sender_name || "-", Icon: FileUp },
    { label: "收件", value: formatDate(selectedCandidate?.received_at), Icon: Clock3 },
  ];
  const reportDimensionRows = (
    activeDimensionEntries.length
      ? activeDimensionEntries
      : [
          { key: "target", label: "岗位匹配", score: reportScore ?? 0, reason: "待补充维度说明", valueLabel: "" },
          { key: "experience", label: "经验匹配", score: reportScore ?? 0, reason: "待补充维度说明", valueLabel: "" },
          { key: "risk", label: "风险控制", score: Math.max(0, 100 - reportGaps.length * 18), reason: "按当前风险条目粗略估算", valueLabel: "" },
        ]
  ).slice(0, 6);
  const reportActionLabel =
    activeScreening?.decision === "recommend"
      ? "建议进入电话初筛"
      : activeScreening?.decision === "hold"
        ? "建议人工复核"
        : activeScreening?.decision === "reject"
          ? "建议暂不推进"
          : "等待筛选结论";
  const reportActionPanelClass =
    activeScreening?.decision === "recommend"
      ? "border-emerald-200 bg-emerald-50/75"
      : activeScreening?.decision === "hold"
        ? "border-amber-200 bg-amber-50/75"
        : activeScreening?.decision === "reject"
          ? "border-rose-200 bg-rose-50/75"
          : "border-slate-200 bg-slate-50";
  const reportActionTextClass =
    activeScreening?.decision === "recommend"
      ? "text-emerald-800"
      : activeScreening?.decision === "hold"
        ? "text-amber-800"
        : activeScreening?.decision === "reject"
          ? "text-rose-800"
          : "text-slate-700";
  const reportPrimaryReason =
    reportGaps[0] ||
    reportStrengths[0] ||
    activeScreening?.summary?.trim() ||
    "暂无明确原因";
  const reportConstraintRows = [
    { label: "年龄/出生", value: selectedCandidateProfile?.birth_or_age || "-" },
    { label: "薪资期望", value: selectedCandidateProfile?.salary_expectation || "-" },
    { label: "目标城市", value: selectedCandidateProfile?.target_city || reportLocation },
    { label: "户籍", value: selectedCandidateProfile?.hukou || "-" },
  ];
  const reportJudgementCards = [
    { label: "建议动作", value: reportActionLabel, helper: reportGrade, tone: reportActionTextClass },
    { label: "主要依据", value: compactReportText(reportPrimaryReason, 54), helper: reportGaps.length ? "风险优先" : "命中优先", tone: "text-slate-800" },
    { label: "下一步", value: activeScreening?.next_step ? "可继续沟通" : "先复核硬性条件", helper: activeScreening?.next_step ? "进入流程" : "暂停推进", tone: "text-blue-800" },
  ];
  const reportMissingInfo = [
    !selectedCandidateProfile?.phone ? "电话号码" : "",
    !selectedCandidateProfile?.email ? "邮箱" : "",
    !selectedCandidateProfile?.salary_expectation ? "薪资期望" : "",
    !selectedCandidateProfile?.years_experience ? "工作年限" : "",
    !selectedCandidateProfile?.target_city ? "目标城市" : "",
  ].filter(Boolean);
  const reportReviewQuestions = [
    reportGaps[0] ? `确认：${reportGaps[0]}` : `${reportRole} 的硬性筛选条件是否必须满足？`,
    reportStrengths[0] ? `追问：${reportStrengths[0]} 是否有可验证项目案例？` : "最近一段经历中有哪些可量化交付？",
    "电话沟通到岗时间、薪资区间与工作地点接受度。",
  ];
  const reportDecisionStats = [
    { label: "评分", value: reportScore ?? "--", helper: "AI 初筛", tone: "text-blue-800" },
    { label: "风险", value: reportGaps.length, helper: "需优先核实", tone: "text-rose-700" },
    { label: "命中", value: reportStrengths.length, helper: "可验证亮点", tone: "text-emerald-700" },
  ];
  const reportTopFacts = [
    { label: "目标岗位", value: reportRole },
    { label: "最近公司", value: reportCompany },
    { label: "城市", value: reportLocation },
    { label: "薪资期望", value: selectedCandidateProfile?.salary_expectation || "-" },
  ];
  const candidateAiTarget =
    (candidateAiDialogId ? candidates.find((candidate) => candidate.id === candidateAiDialogId) : null) ??
    selectedCandidate;
  const candidateAiProfile = candidateAiTarget
    ? "parsed_candidate_profile" in candidateAiTarget
      ? candidateAiTarget.parsed_candidate_profile
      : candidateAiTarget
    : null;
  const candidateAiMessages = candidateAiTarget ? candidateAiMessagesById[candidateAiTarget.id] ?? [] : [];
  const candidateAiLoading = Boolean(candidateAiTarget && candidateAiLoadingId === candidateAiTarget.id);
  const candidatePageFrom = candidatePagination.total > 0 ? candidatePage * candidateRowsPerPage + 1 : 0;
  const candidatePageTo = Math.min((candidatePage + 1) * candidateRowsPerPage, candidatePagination.total);

  return (
    <div className="horizon-theme hz-page resume-screening-surface mx-auto flex max-w-[1720px] flex-col gap-3 overflow-x-hidden px-5 py-4">
      <HorizonPageHeader
        Icon={Briefcase}
        eyebrow="人事招聘 · AI 初筛"
        title="简历筛选工作台"
        meta={(
          <>
            <span>邮箱 {health?.mail_configured ? "已连接" : "待配置"}</span>
            <span>·</span>
            <span>AI {health?.openai_configured ? `${connectedAiLabel} 已连接` : "待配置"}</span>
            <span>·</span>
            <span>数据库 {health?.ok ? "正常" : "待检查"}</span>
          </>
        )}
        actions={(
          <>
            <Button type="button" variant="outline" onClick={() => setShowJobRuleManager(true)}>
              <Database className="size-4" />
              管理岗位规则
            </Button>
            <Button type="button" className="hz-primary-action" onClick={() => setShowSyncSettings(true)}>
              <Clock3 className="size-4" />
              同步与上传
            </Button>
          </>
        )}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={UserRoundSearch} label="候选人" value={stats.total} note="当前筛选结果" tone="brand" />
        <HorizonMetric Icon={Award} label="推荐" value={stats.recommend} note="建议进入下一步" tone="success" />
        <HorizonMetric Icon={Clock3} label="待定" value={stats.hold} note="仍需人工核实" tone="warning" />
        <HorizonMetric Icon={Target} label="平均分" value={stats.average} note="AI 初筛平均得分" tone="neutral" />
      </HorizonMetricGrid>

      <Input
        ref={uploadFolderInputRef}
        type="file"
        aria-label="上传简历文件夹"
        multiple
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => void handleUploadResumes(event)}
      />
      <Input
        ref={uploadFilesInputRef}
        type="file"
        aria-label="上传简历文件"
        multiple
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => void handleUploadResumes(event)}
      />

      <section className="hz-surface overflow-hidden border bg-white">
        <HorizonSectionHeader
          Icon={Sparkles}
          title="筛选与导入控制"
          trailing={hasPendingBackgroundAnalysis ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 tabular-nums">处理中 {pendingBackgroundCount}</span> : null}
        />
        <div className="p-4 sm:px-5">
        <div className="resume-import-layout grid items-start gap-4">
          <div className="grid min-w-0 gap-3">
            <MaterialSelect
              label="当前岗位"
              value={selectedJobRuleId}
              onValueChange={(value) => {
                const matched = jobRules.find((item) => item.id === value);
                if (matched) {
                  hydrateRule(matched);
                } else {
                  resetRuleForm();
                }
              }}
              options={[{ label: "全部岗位 / 自动匹配", value: "" }, ...jobRules.map((item) => ({ label: item.name, value: item.id }))]}
              placeholder={loadingRules ? "正在加载岗位..." : "全部岗位 / 自动匹配"}
            />
            <Button variant="ghost" size="sm"
              type="button"
              onClick={() => setShowJobRuleManager(true)}
              className="w-fit text-muted-foreground"
            >
              <Database className="h-4 w-4" />
              管理规则
            </Button>
          </div>

          <div className="resume-import-controls grid min-w-0 gap-3 sm:grid-cols-2">
            <MaterialSelect
              label="企业邮箱"
              value={selectedMailConfigId}
              onValueChange={setSelectedMailConfigId}
              options={mailConfigs.map((item) => ({
                label: `${item.email}${item.enabled ? "（默认启用）" : ""}`,
                value: item.id,
              }))}
              placeholder={loadingMailConfigs ? "加载中..." : "选择邮箱"}
            />
            <MaterialSelect
              label="AI 模型"
              value={selectedOpenAiConfigId}
              onValueChange={setSelectedOpenAiConfigId}
              options={openAiConfigs.map((item) => ({
                label: formatAiModelConfigLabel(item),
                value: item.id,
                description: getAiModelUsage(item.model).description,
              }))}
              placeholder={loadingOpenAiConfigs ? "加载中..." : "选择 AI"}
            />
            <MaterialInput
              label="回溯（小时）"
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
              label="上限（封）"
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
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 resume-import-actions">
            <Button size="lg"
              type="button"
              onClick={() => void handleRunSync()}
              disabled={runningSync}
            >
              {runningSync ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              同步
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg"
                  type="button"
                  disabled={uploadingFolder}
                >
                  {uploadingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  上传
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuItem onSelect={() => uploadFilesInputRef.current?.click()}>
                  <FileUp className="h-4 w-4" />
                  上传文件（可多选）
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => uploadFolderInputRef.current?.click()}>
                  <FolderUp className="h-4 w-4" />
                  上传文件夹
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="lg"
              type="button"
              onClick={() => setShowSyncSettings(true)}
              className="text-muted-foreground"
            >
              <Clock3 className="h-4 w-4" />
              设置
            </Button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>近 {scheduleForm.since_hours || 72} 小时，最多抓取 {scheduleForm.limit || 20} 封。</span>
          {lastSyncResult ? (
            <span>最近同步：匹配 {lastSyncResult.matched_count ?? 0}，入队 {lastSyncResult.queued_for_ai ?? 0}，失败 {lastSyncResult.failed}。</span>
          ) : null}
          {lastUploadResult ? (
            <span>最近上传：入队 {lastUploadResult.queued_for_ai ?? 0}，失败 {lastUploadResult.failed}。</span>
          ) : null}
        </div>
        {hasPendingBackgroundAnalysis ? (
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-700">
            <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" />
            <div className="min-w-0 leading-5">
              <p className="text-sm font-semibold">
                正在后台筛选 {pendingBackgroundCount || lastUploadResult?.queued_for_ai || ""} 份简历…
              </p>
              <p className="mt-0.5 text-pretty text-xs text-blue-600/80">
                AI 正在逐条读取并打分，完成后会自动出现在下方候选人列表，无需刷新页面或重复上传。
              </p>
            </div>
          </div>
        ) : null}
        </div>
      </section>

      <Dialog open={showJobRuleManager} onOpenChange={setShowJobRuleManager}>
        <DialogContent className="horizon-portal resume-screening-surface max-h-[90vh] w-[calc(100vw-32px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 sm:max-w-[1180px]">
          <div className="flex items-center justify-between gap-4">
            <DialogHeader className="space-y-0 text-left">
              <DialogTitle className="text-balance text-2xl font-semibold text-slate-900">岗位规则</DialogTitle>
              <DialogDescription className="mt-2 text-pretty text-base text-slate-500">在左侧选择规则，也可编辑当前岗位 JD 和启用状态。</DialogDescription>
            </DialogHeader>
            <div className="material-neu-chip rounded-[4px] px-4 py-2 text-sm text-slate-500">
              共 {jobRules.length} 条规则
            </div>
          </div>

          <div className="mt-7 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="material-neu-inset rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Database className="h-4 w-4" />
                规则列表
              </div>
              <div className="material-scrollbar mt-4 max-h-[520px] space-y-3 overflow-y-auto">
                {loadingRules && !jobRules.length ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    正在加载规则...
                  </div>
                ) : jobRules.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-muted-foreground">
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
                          "w-full cursor-pointer rounded-lg px-4 py-4 text-left transition",
                          active
                            ? "border border-blue-200 bg-accent text-blue-950"
                            : "border border-transparent bg-white hover:border-primary/25 hover:bg-accent hover:text-primary-hover",
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
                                  kind: "job-rule",
                                  id: jobRule.id,
                                  title: "确认删除岗位规则",
                                  description: `删除将移除规则“${jobRule.name}”，该操作不可撤销。`,
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
              <div className="material-neu-inset rounded-xl px-5 py-4">
                <div className="text-sm font-semibold text-slate-500">系统识别岗位名称</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {derivedRuleName || "等待输入岗位描述后识别"}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  直接粘贴完整岗位描述即可，系统会自动识别岗位名称和岗位职责
                </p>
              </div>
              <MaterialTextarea
                label="岗位描述"
                value={ruleForm.jd_text}
                onChange={(event) => setRuleForm((current) => ({ ...current, jd_text: event.target.value }))}
                placeholder={"例如：\n岗位名称：测试工程师\n岗位职责\n1. 负责测试计划与执行\n2. 推动缺陷闭环"}
                className="h-[320px] min-h-[320px] resize-none overflow-y-auto"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="unstyled"
                  type="button"
                  onClick={() => void handleSaveRule()}
                  disabled={savingRule}
                  className="material-neu-primary inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[4px] px-6 text-base font-semibold text-white transition disabled:opacity-60"
                >
                  {savingRule ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {ruleForm.id ? "保存规则" : "新建规则"}
                </Button>
                <label className="material-neu-button inline-flex h-11 min-w-[96px] items-center justify-center gap-2 rounded-[4px] px-4 text-sm font-semibold text-slate-600">
                  <Checkbox
                    className="h-4 w-4"
                    checked={ruleForm.enabled}
                    onCheckedChange={(checkedValue) => setRuleForm((current) => ({ ...current, enabled: (checkedValue === true) }))}
                  />
                  启用
                </label>
                <Button variant="unstyled"
                  type="button"
                  onClick={resetRuleForm}
                  className="material-neu-button inline-flex h-11 cursor-pointer items-center justify-center rounded-[4px] px-4 text-sm font-medium text-slate-500 transition"
                >
                  重置
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSyncSettings} onOpenChange={setShowSyncSettings}>
        <DialogContent className="horizon-portal resume-screening-surface max-h-[90vh] w-[calc(100vw-32px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 sm:max-w-[1180px]">
          <div className="flex flex-col gap-4 pr-0 sm:pr-32">
            <DialogHeader className="max-w-[560px] space-y-0 text-left">
              <DialogTitle className="text-balance text-2xl font-semibold text-slate-900">同步控制</DialogTitle>
              <DialogDescription className="mt-2 text-pretty text-base leading-7 text-slate-500">
                检查环境、手动同步，也可配置每天定时轮询自动抓取简历邮件。
              </DialogDescription>
            </DialogHeader>
            <Button variant="unstyled"
              type="button"
              onClick={() => void Promise.all([loadHealth(), loadMailConfigs(), loadOpenAiConfigs(), loadSchedule(), loadCandidates()])}
              className="material-neu-button inline-flex h-10 w-fit cursor-pointer items-center gap-2 self-start rounded-[4px] px-4 text-sm font-medium text-slate-600 transition sm:absolute sm:right-8 sm:top-8"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>

          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-xs leading-5 text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-semibold">上传提示</span>
              <span>支持 PDF / DOCX，扫描 PDF、图片版或旧 DOC 暂不保证解析效果。</span>
            </div>
            <div className="material-neu-inset rounded-lg p-5">
              <div className="text-sm font-semibold text-muted-foreground">同步参数</div>
              <div className="mt-4 grid gap-4 xl:grid-cols-4 sm:grid-cols-2">
                <MaterialSelect
                  label="企业邮箱"
                  value={selectedMailConfigId}
                  onValueChange={setSelectedMailConfigId}
                  options={mailConfigs.map((item) => ({
                    label: `${item.email}${item.enabled ? "（默认启用）" : ""}`,
                    value: item.id,
                  }))}
                  placeholder={loadingMailConfigs ? "正在加载企业邮箱配置..." : "选择企业邮箱配置"}
                />
                <MaterialSelect
                  label="AI 模型"
                  value={selectedOpenAiConfigId}
                  onValueChange={setSelectedOpenAiConfigId}
                  className="h-12"
                  options={openAiConfigs.map((item) => ({
                    label: formatAiModelConfigLabel(item),
                    value: item.id,
                    description: getAiModelUsage(item.model).description,
                  }))}
                  placeholder={loadingOpenAiConfigs ? "正在加载 AI 配置..." : "选择 AI 配置"}
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
                  label="抓取上限（封）"
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
                  当前计划默认按{scheduleForm.since_hours || 72} 小时内回溯，单次最多抓取{scheduleForm.limit || 20} 封简历。
                </div>
              </div>
            </div>
          </div>


          <div className="mt-5 flex flex-col gap-3">
            <div className="flex flex-wrap gap-3 justify-between">
            <Button variant="unstyled"
              type="button"
              onClick={() => void handleRunSync()}
              disabled={runningSync}
              className="material-neu-primary inline-flex h-13 min-w-[280px] cursor-pointer items-center justify-center gap-3 rounded-xl px-7 text-l font-semibold text-white transition disabled:opacity-60"
            >
              {runningSync ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              执行一次同步
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="unstyled"
                  type="button"
                  disabled={uploadingFolder}
                  className="material-neu-button inline-flex h-13 min-w-[280px] cursor-pointer items-center justify-center gap-3 rounded-xl px-7 text-l font-semibold text-slate-700 transition disabled:opacity-60"
                >
                  {uploadingFolder ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                  上传简历
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px]">
                <DropdownMenuItem onSelect={() => uploadFilesInputRef.current?.click()}>
                  <FileUp className="h-4 w-4" />
                  上传文件（可多选）
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => uploadFolderInputRef.current?.click()}>
                  <FolderUp className="h-4 w-4" />
                  上传文件夹
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>

            <div className="px-1 py-1 text-sm leading-6 text-slate-600">
              手动同步会立即执行；若已开启轮询，后续会继续按计划自动运行。
              {lastSyncResult ? (
                <span className="ml-2 text-slate-500">
                  本次结果：检查{lastSyncResult.scanned_count ?? 0}，匹配{lastSyncResult.matched_count ?? 0}，入队{lastSyncResult.queued_for_ai ?? 0}，处理{lastSyncResult.processed}，新增{lastSyncResult.created_candidates}，跳过{lastSyncResult.skipped}，失败{lastSyncResult.failed}。
                </span>
              ) : null}
            </div>
          </div>

          {lastSyncResult ? (
            <div className="material-neu-card mt-5 rounded-lg px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">邮件同步结果</div>
                  <div className="mt-1 text-sm text-slate-500">{lastSyncResult.message}</div>
                  {hasPendingSyncMail ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      已入队 {lastSyncResult.queued_for_ai} 封，后台正在逐条筛选，候选人列表会自动刷新。
                    </div>
                  ) : lastSyncResult.mail_previews?.length ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-[4px] border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      正在获取邮件状态，请稍后刷新。
                    </div>
                  ) : null}
                  {lastSyncResult.actual_screening_model ? (
                    <div className="mt-1 text-xs text-muted-foreground">实际筛选模型：{lastSyncResult.actual_screening_model}</div>
                  ) : null}
                </div>
                <div className="rounded-[4px] border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {lastSyncResult.mail_previews?.length ?? 0} 封邮件
                </div>
              </div>

              <div className="material-scrollbar mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-2">
                {lastSyncResult.mail_previews?.length ? (
                  lastSyncResult.mail_previews.map((mail: SyncMailPreview, index) => {
                    const statusMeta = getSyncMailStatusMeta(mail.status);
                    return (
                    <div key={mail.unique_key || `${mail.received_at}-${index}`} className="material-neu-inset rounded-lg px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900">{mail.subject || "无主题邮件"}</div>
                          <div className="mt-1 text-xs text-slate-500 break-all">
                            {mail.sender_name || mail.sender_email || "未知发件人"}
                          </div>
                        </div>
                        <div className="shrink-0 text-center">
                          <div className={cn("inline-flex items-center gap-1.5 rounded-[4px] border px-3 py-1 text-xs font-medium", statusMeta.className)}>
                            {statusMeta.icon}
                            {mail.status}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">{formatDate(mail.received_at)}</div>
                        </div>
                      </div>
                      {mail.candidate_name ? (
                        <div className="mt-3 text-xs font-medium text-slate-500">候选人：{mail.candidate_name}</div>
                      ) : null}
                      {mail.preview ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-slate-600">
                            查看邮件正文预览（{mail.preview.length} 字符）
                          </summary>
                          <pre className="mt-2 max-h-52 overflow-auto rounded-md border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 whitespace-pre-wrap break-all">
                            {mail.preview}
                          </pre>
                        </details>
                      ) : (
                        <div className="mt-3 text-xs text-muted-foreground">邮件正文为空</div>
                      )}
                      {mail.error_message ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                          {mail.error_message}
                        </div>
                      ) : null}
                    </div>
                  )})
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-muted-foreground">
                    本次没有可回溯的邮件摘要。
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {lastUploadResult ? (
            <div className="material-neu-card mt-5 rounded-lg px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">简历上传结果</div>
                  <div className="mt-1 text-sm text-slate-500">{lastUploadResult.message}</div>
                  {hasPendingUploadFile ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      已入队 {lastUploadResult.queued_for_ai ?? 0} 份，后台正在逐条筛选，候选人列表会自动刷新。
                    </div>
                  ) : visibleUploadPreviews.length ? (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-[4px] border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      正在获取上传文件状态，请稍后刷新。
                    </div>
                  ) : null}
                  {lastUploadResult.actual_extract_model || lastUploadResult.actual_screening_model ? (
                    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {lastUploadResult.actual_extract_model ? (
                        <div>实际文件读取模型：{lastUploadResult.actual_extract_model}</div>
                      ) : null}
                      {lastUploadResult.actual_screening_model ? (
                        <div>实际筛选判断模型：{lastUploadResult.actual_screening_model}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-[4px] border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {visibleUploadPreviews.length} 个文件
                </div>
              </div>

              <div className="material-scrollbar mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-2">
                {visibleUploadPreviews.length ? (
                  visibleUploadPreviews.map((file: UploadFilePreview, index) => {
                    const statusMeta = getSyncMailStatusMeta(file.status);
                    return (
                      <div key={file.unique_key || `${file.file_name}-${index}`} className="material-neu-inset rounded-lg px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-900">{file.file_name || "未命名文件"}</div>
                            <div className="mt-1 text-xs text-slate-500">{file.file_type}</div>
                          </div>
                          <div className="shrink-0 text-center">
                            <div className={cn("inline-flex items-center gap-1.5 rounded-[4px] border px-3 py-1 text-xs font-medium", statusMeta.className)}>
                              {statusMeta.icon}
                              {file.status}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">{formatDate(file.received_at)}</div>
                          </div>
                        </div>
                        {file.candidate_name ? (
                          <div className="mt-3 text-xs font-medium text-slate-500">候选人：{file.candidate_name}</div>
                        ) : null}
                        {file.preview ? (
                          <details className="mt-3">
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-slate-600">
                              查看解析文本预览（{file.preview.length} 字符）
                            </summary>
                            <pre className="mt-2 max-h-52 overflow-auto rounded-md border border-slate-200 bg-slate-100 p-3 text-xs text-slate-700 whitespace-pre-wrap break-all">
                              {file.preview}
                            </pre>
                          </details>
                        ) : (
                          <div className="mt-3 text-xs text-muted-foreground">当前没有可展示的文本预览</div>
                        )}
                        {file.error_message ? (
                          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                            {file.error_message}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-muted-foreground">
                    本次没有需要展示的上传摘要。
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <section className="hz-surface flex min-w-0 flex-col overflow-hidden border bg-white">
          <HorizonSectionHeader
            Icon={UserRoundSearch}
            title="候选人清单"
            trailing={(
              <div className="flex flex-wrap items-center justify-end gap-2">
              {checkedCandidateIds.size > 0 && canDeleteCandidate ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={batchDeletingCandidates}
                  onClick={() =>
                    setDeleteConfirm({
                      kind: "candidate-batch",
                      ids: Array.from(checkedCandidateIds),
                      title: `删除已选的 ${checkedCandidateIds.size} 位候选人？`,
                      description: "将永久删除所选候选人及其全部筛选记录与打点数据，该操作不可撤销。",
                      confirmLabel: "批量删除",
                    })
                  }
                  className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                >
                  {batchDeletingCandidates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  删除已选（<span className="tabular-nums">{checkedCandidateIds.size}</span>）
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleExportCandidates()}
                disabled={exportingCandidates || loadingCandidates || !candidatePagination.total}
              >
                {exportingCandidates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                导出
              </Button>
              {hasActiveCandidateFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleResetCandidateFilters}
                >
                  <X className="h-4 w-4" />
                  清除筛选
                </Button>
              ) : null}
              <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                <Search className="h-4 w-4" />
                <span className="tabular-nums">{hasActiveCandidateFilters ? `已筛选 ${candidatePagination.total} 人` : `共 ${candidatePagination.total} 人`}</span>
              </div>
              </div>
            )}
          />

          <div className="grid gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-4 md:grid-cols-3 sm:px-5">
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
          </div>
          <div className="border-b border-slate-200 bg-slate-50/80 px-4 pb-4 sm:px-5">
            <Button variant="unstyled"
              type="button"
              onClick={() => setShowMoreFilters((current) => !current)}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-primary transition hover:text-primary-hover"
            >
              {showMoreFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              更多筛选{advancedFilterCount ? `（已设 ${advancedFilterCount} 项）` : ""}
            </Button>
          </div>
          {showMoreFilters ? (
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/80 px-4 pb-4 md:grid-cols-3 sm:px-5">
              <MaterialInput
                label="最低分"
                type="number"
                min={0}
                value={minScoreFilter}
                onChange={(event) => setMinScoreFilter(event.target.value)}
                placeholder="请输入"
                className="h-9.5"
              />
              <MaterialInput
                label="最小年龄"
                type="number"
                min={1}
                max={100}
                value={minAgeFilter}
                onChange={(event) => setMinAgeFilter(event.target.value)}
                placeholder="不限"
                className="h-9.5"
              />
              <MaterialInput
                label="最大年龄"
                type="number"
                min={1}
                max={100}
                value={maxAgeFilter}
                onChange={(event) => setMaxAgeFilter(event.target.value)}
                placeholder="不限"
                className="h-9.5"
              />
            </div>
          ) : null}

          <div className="mx-4 mt-4 border-l-4 border-l-[var(--primary)] bg-[#f7f9ff] p-4 sm:mx-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI 迭代筛选
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600">
                  AI 会先分析筛选意图；条件不明确时会追问，明确后才生成新的列表评分版本。
                </div>
              </div>
              <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto sm:min-w-[260px]">
                <MaterialSelect
                  value={selectedFilterVersion}
                  onValueChange={setSelectedFilterVersion}
                  options={[
                    { label: "初筛结果 / 当前最新", value: "" },
                    ...filterSessions.map((session) => ({
                      label: `${session.label} · ${session.recommend_count}/${session.total_count} 推荐`,
                      value: session.version_id,
                    })),
                  ]}
                  placeholder="选择筛选版本"
                  className="h-10"
                />
                {canScreenCandidates ? <Button variant="unstyled"
                  type="button"
                  onClick={() => setShowFilterDialog(true)}
                  className="material-neu-primary inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[var(--m3-shape-small)] px-4 text-sm font-semibold text-white transition"
                >
                  <Sparkles className="h-4 w-4" />
                  AI 二次筛选
                </Button> : null}
              </div>
            </div>

            {renderCandidateFilterProgress()}

            {selectedFilterSession ? (
              <div className="mt-3 rounded-lg border border-blue-100 bg-white px-3 py-2 text-pretty text-xs leading-5 text-blue-950">
                {selectedFilterSession.filter_summary || selectedFilterSession.instruction}
              </div>
            ) : null}
          </div>

          <div className="mx-4 mb-5 mt-4 flex min-h-0 flex-auto flex-col overflow-hidden rounded-xl border border-slate-200 bg-white sm:mx-5">
            {loadingCandidates ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-4 py-12 text-center text-sm text-slate-500" role="status">
                <Loader2 className="mb-2 h-4 w-4 animate-spin" />
                正在加载候选人...
              </div>
            ) : filteredCandidates.length === 0 ? (
              hasPendingBackgroundAnalysis ? (
                <div className="flex min-h-56 flex-col items-center justify-center px-4 py-12 text-center text-sm text-blue-700" role="status">
                  <Loader2 className="mb-2 h-4 w-4 animate-spin" />
                  <p className="max-w-xl text-pretty">
                    正在后台筛选 <span className="tabular-nums">{pendingBackgroundCount || lastUploadResult?.queued_for_ai || ""}</span> 份简历，完成后会自动出现在此处，无需刷新。
                  </p>
                </div>
              ) : (
                <HorizonEmptyState
                  Icon={UserRoundSearch}
                  title={hasActiveCandidateFilters ? "没有符合当前条件的候选人" : "还没有候选人"}
                  description={hasActiveCandidateFilters ? "调整筛选条件，或清除筛选查看全部候选人。" : "上传简历文件后，系统会自动解析并加入候选人清单。"}
                  action={(
                    <Button
                      type="button"
                      variant={hasActiveCandidateFilters ? "outline" : "default"}
                      className={hasActiveCandidateFilters ? undefined : "hz-primary-action"}
                      onClick={hasActiveCandidateFilters ? handleResetCandidateFilters : () => uploadFilesInputRef.current?.click()}
                    >
                      {hasActiveCandidateFilters ? <X className="size-4" /> : <FileUp className="size-4" />}
                      {hasActiveCandidateFilters ? "清除筛选" : "上传简历"}
                    </Button>
                  )}
                />
              )
            ) : (
              <div className="material-scrollbar overflow-x-auto">
                <table className={cn("w-full table-fixed text-left text-sm", canDeleteCandidate ? "min-w-[1248px]" : "min-w-[1110px]")}>
                  <caption className="sr-only">候选人筛选结果及评估操作</caption>
                  <colgroup>
                    {canDeleteCandidate ? <col className="w-12" /> : null}
                    <col className="w-[150px]" />
                    <col className="w-[190px]" />
                    <col className="w-[76px]" />
                    <col className="w-[88px]" />
                    <col className="w-[178px]" />
                    <col className="w-[104px]" />
                    <col className="w-[124px]" />
                    <col className={canDeleteCandidate ? "w-[280px]" : "w-[210px]"} />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-accent text-xs font-semibold text-slate-700">
                    <tr className="border-b border-blue-100">
                      {canDeleteCandidate ? (
                        <th scope="col" className="px-4 py-3">
                          <Checkbox
                            checked={allCurrentPageChecked ? true : someCurrentPageChecked ? "indeterminate" : false}
                            onCheckedChange={(checked) => toggleAllCurrentPageChecked(checked === true)}
                            aria-label="全选当前页候选人"
                            className="bg-white"
                          />
                        </th>
                      ) : null}
                      <th scope="col" className="px-3 py-3">候选人</th>
                      <th scope="col" className="px-3 py-3">岗位</th>
                      <th scope="col" className="px-3 py-3">分数</th>
                      <th scope="col" className="px-3 py-3">结论</th>
                      <th scope="col" className="px-3 py-3">基本信息</th>
                      <th scope="col" className="px-3 py-3">状态</th>
                      <th scope="col" className="px-3 py-3">收件时间</th>
                      <th scope="col" className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCandidates.map((candidate) => {
                      const candidateTitle = buildCandidateCardTitle(candidate);
                      const jobLabels = buildCandidateJobLabels(candidate).join(" / ");
                      const screeningStatus = candidate.screening_status ?? candidate.active_screening_status;
                      const mappedStatus = mapScreeningStatusToMailStatus(screeningStatus, candidate.screening_error_message);
                      const age = parseAgeFromBirthOrAge(candidate.birth_or_age);
                      const selected = selectedCandidateId === candidate.id;
                      const received = formatDateParts(candidate.received_at);
                      const basicFacts = joinCandidateFacts([
                        candidate.city,
                        age != null ? `${age} 岁` : candidate.birth_or_age,
                        candidate.education,
                      ]);

                      return (
                        <tr
                          key={candidate.id}
                          className={cn(
                            "transition-colors",
                            selected ? "bg-accent shadow-[inset_3px_0_0_var(--primary)]" : "bg-white hover:bg-slate-50",
                          )}
                        >
                          {canDeleteCandidate ? (
                            <td className="px-4 py-3">
                              <Checkbox
                                checked={checkedCandidateIds.has(candidate.id)}
                                onCheckedChange={(checked) => toggleCandidateChecked(candidate.id, checked === true)}
                                aria-label={`选择 ${candidate.name || "候选人"}`}
                                className="bg-white"
                              />
                            </td>
                          ) : null}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700">
                                {candidate.avatar_url ? (
                                  <ImageWithFallback
                                    src={candidate.avatar_url}
                                    alt={candidate.name || "候选人头像"}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  (candidate.name || "?").slice(0, 1)
                                )}
                              </div>
                              <div className="min-w-0">
                                <OverflowTooltipText text={candidateTitle} maxChars={16} className="font-semibold text-slate-900" />
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <OverflowTooltipText text={jobLabels} maxChars={18} className="max-w-[180px] text-slate-600" />
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-flex min-w-12 items-center justify-center rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums",
                                scoreTone(candidate.score),
                              )}
                            >
                              {typeof candidate.score === "number" ? candidate.score : "-"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {candidate.decision ? (
                              <span className={cn("inline-flex min-w-14 justify-center rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap", decisionMeta[candidate.decision].classes)}>
                                {decisionMeta[candidate.decision].label}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <OverflowTooltipText text={basicFacts} maxChars={16} className="max-w-[170px] text-slate-600" />
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex min-w-16 justify-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 whitespace-nowrap">
                              {mappedStatus?.status || "待处理"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs leading-5 text-slate-500 tabular-nums">
                            <div>{received.date}</div>
                            {received.time ? <div className="text-[11px] text-muted-foreground">{received.time}</div> : null}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => openCandidateDetail(candidate.id)}>
                                <UserRoundSearch className="h-3.5 w-3.5" />
                                详情
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedCandidateId(candidate.id);
                                  setCandidateAiDialogId(candidate.id);
                                  setCandidateAiQuestion("");
                                }}
                              >
                                <MessageSquarePlus className="h-3.5 w-3.5" />
                                AI 讨论
                              </Button>
                              {canDeleteCandidate ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={deletingCandidateId === candidate.id}
                                  onClick={() =>
                                    setDeleteConfirm({
                                      kind: "candidate",
                                      id: candidate.id,
                                      title: "删除该候选人？",
                                      description: `将永久删除「${candidate.name || "未命名候选人"}」及其全部筛选记录与打点数据，该操作不可撤销。`,
                                      confirmLabel: "删除候选人",
                                    })
                                  }
                                  className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                >
                                  {deletingCandidateId === candidate.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                  删除
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {candidatePagination.total > 0 ? (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <Label htmlFor="candidate-rows-per-page" className="text-sm font-medium">每页</Label>
                  <NativeSelect
                    id="candidate-rows-per-page"
                    value={candidateRowsPerPage}
                    onChange={(event) => {
                      setCandidateRowsPerPage(Number(event.target.value));
                      setCandidatePage(0);
                    }}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                  </NativeSelect>
                </div>
                <span className="tabular-nums">{candidatePageFrom}-{candidatePageTo} / 共 {candidatePagination.total} 人</span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={candidatePage <= 0 || !candidatePagination.has_previous}
                    onClick={() => setCandidatePage((current) => Math.max(0, current - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!candidatePagination.has_next}
                    onClick={() => setCandidatePage((current) => current + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
      </section>

      <Dialog
        open={candidateDetailDialogOpen}
        onOpenChange={(open) => {
          setCandidateDetailDialogOpen(open);
          if (!open) {
            setScreeningHistoryExpanded(false);
          }
        }}
      >
        <DialogContent className="horizon-portal resume-screening-surface flex h-[88vh] w-[calc(100vw-28px)] grid-rows-none flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#f6f8fb] p-0 shadow-[0_24px_72px_rgba(15,23,42,0.22)] sm:max-w-[1180px] [&>button]:right-5 [&>button]:top-5 [&>button]:rounded-md [&>button]:bg-white [&>button]:p-2 [&>button]:shadow-sm">
          <div className="border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div className="min-w-0 pr-12">
              <div className="text-xs font-semibold text-slate-500">候选人评估报告</div>
              <DialogTitle className="mt-1 text-balance text-xl font-semibold text-slate-950">
                {selectedCandidateProfile?.name || "候选人详情"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-pretty text-sm text-slate-500">
                聚合简历解析、AI 初筛结论、命中点与风险，用于快速复核是否推进下一步。
              </DialogDescription>
            </div>
          </div>

          <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {loadingDetail ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-white text-sm text-muted-foreground">
                <Loader2 className="mb-2 h-4 w-4 animate-spin" />
                正在加载候选人详情...
              </div>
            ) : !selectedCandidate || !selectedCandidateProfile ? (
              <div className="flex h-full min-h-[420px] items-center justify-center rounded-[8px] border border-dashed border-slate-300 bg-white text-sm text-muted-foreground">
                请从候选人列表点击“详情”查看画像报告
              </div>
            ) : (
              <article className="mx-auto flex max-w-[1120px] flex-col gap-4">
                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-[8px] border border-slate-200 bg-slate-100">
                        {selectedCandidateProfile.avatar_url ? (
                          <ImageWithFallback
                            src={selectedCandidateProfile.avatar_url}
                            alt={selectedCandidateProfile.name || "候选人头像"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-blue-50 text-3xl font-semibold text-blue-800">
                            {(selectedCandidateProfile.name || "?").slice(0, 1)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-500">候选人画像</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-balance text-2xl font-semibold text-slate-950">
                            {selectedCandidateProfile.name || "未命名候选人"}
                          </h2>
                          <span className={cn("inline-flex rounded-[4px] border px-2.5 py-1 text-xs font-semibold", reportGradeClass)}>
                            {reportGrade}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-blue-700">{reportRole}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{reportCompany}</p>
                        <p className="mt-3 line-clamp-3 text-pretty text-sm leading-6 text-slate-600">{reportBrief}</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {reportTopFacts.map((item) => (
                        <div key={item.label} className="min-w-0 rounded-[6px] bg-slate-50 px-3 py-2">
                          <div className="text-[11px] text-muted-foreground">{item.label}</div>
                          <div className="mt-1 truncate text-sm font-semibold text-slate-800">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={cn("rounded-[8px] border p-4 shadow-sm", reportActionPanelClass)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">当前判断</span>
                      {reportDecision ? (
                        <span className={cn("inline-flex rounded-[4px] px-2.5 py-1 text-xs font-semibold", reportDecision.classes)}>
                          {reportDecision.label}
                        </span>
                      ) : null}
                      {activeScreening?.model_name ? (
                        <span className="inline-flex rounded-[4px] border border-white/80 bg-white/70 px-2.5 py-1 text-xs font-medium text-slate-500">
                          {activeScreening.model_name}
                        </span>
                      ) : null}
                    </div>
                    <div className={cn("mt-2 text-balance text-2xl font-semibold", reportActionTextClass)}>
                      {reportActionLabel}
                    </div>
                    <p className="mt-2 line-clamp-3 text-pretty text-sm leading-6 text-slate-600">
                      {activeScreening?.summary?.trim() || reportBrief}
                    </p>
                    <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-[6px] border border-slate-100 bg-white/80">
                      {reportDecisionStats.map((item, index) => (
                        <div key={item.label} className={cn("px-3 py-3 text-center", index > 0 && "border-l border-slate-100")}>
                          <div className={cn("text-xl font-semibold tabular-nums", item.tone)}>{item.value}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{item.label}</div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">{item.helper}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-[6px] bg-white/65 px-3 py-2.5">
                      <div className="flex size-12 items-center justify-center rounded-full border-[6px] border-blue-100 bg-white">
                        <div className="flex items-center justify-center text-sm font-semibold text-blue-950 tabular-nums">
                          {reportScoreTen ?? "-"}<span className="text-[10px]">/10</span>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-slate-500">综合匹配度</div>
                        <div className="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">{reportScore ?? "--"}</div>
                      </div>
                    </div>
                  </section>
                </section>

                <div className="grid gap-4 lg:grid-cols-[284px_minmax(0,1fr)]">
                  <aside className="space-y-4">
                    <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <UserRoundSearch className="h-4 w-4 text-blue-700" />
                      基础画像
                    </div>
                    <div className="space-y-1.5">
                      {reportProfileRows.map((item) => (
                        <div key={item.label} className="grid grid-cols-[18px_72px_minmax(0,1fr)] items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-slate-50">
                          <item.Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{item.label}</span>
                          <span className="min-w-0 break-words text-xs font-medium leading-5 text-slate-700">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <Target className="h-4 w-4 text-blue-700" />
                      关键约束
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {reportConstraintRows.map((item) => (
                        <div key={item.label} className="min-w-0 rounded-[6px] bg-slate-50 px-3 py-2">
                          <div className="text-[11px] text-muted-foreground">{item.label}</div>
                          <div className="mt-1 truncate text-sm font-semibold text-slate-800">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <Mail className="h-4 w-4 text-blue-700" />
                      联系与来源
                    </div>
                    <div className="space-y-1.5">
                      {reportContactRows.map((item) => (
                        <div key={item.label} className="grid grid-cols-[18px_48px_minmax(0,1fr)] items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-slate-50">
                          <item.Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{item.label}</span>
                          <span className="min-w-0 break-words text-xs font-medium leading-5 text-slate-700">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      待补充信息
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(reportMissingInfo.length ? reportMissingInfo : ["暂无明显缺口"]).map((item) => (
                        <span key={item} className="rounded-[4px] border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
                          {item}
                        </span>
                      ))}
                    </div>
                  </section>
                </aside>

                <main className="min-w-0 space-y-4">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <section className="rounded-[8px] border border-rose-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
                          <AlertCircle className="h-4 w-4" />
                          风险缺口
                        </div>
                        <span className="rounded-[4px] bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                          优先核实
                        </span>
                      </div>
                      <div className="space-y-2">
                        {(reportGaps.length ? reportGaps : ["暂无风险提示"]).map((item, index) => (
                          <div key={`${item}-${index}`} className="flex gap-2 rounded-[6px] bg-rose-50/60 px-3 py-2 text-sm leading-6 text-slate-700">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                            <span className="min-w-0">{item}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[8px] border border-emerald-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4" />
                          关键命中
                        </div>
                        <span className="rounded-[4px] bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          可验证亮点
                        </span>
                      </div>
                      <div className="space-y-2">
                        {(reportStrengths.length ? reportStrengths : ["暂无命中点"]).map((item, index) => (
                          <div key={`${item}-${index}`} className="flex gap-2 rounded-[6px] bg-emerald-50/60 px-3 py-2 text-sm leading-6 text-slate-700">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                            <span className="min-w-0">{item}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                        <Sparkles className="h-4 w-4 text-blue-700" />
                        判断依据
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {activeScreening?.model_name || "当前筛选版本"}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {reportJudgementCards.map((item) => (
                        <div key={item.label} className="min-w-0 rounded-[6px] bg-slate-50 px-3 py-2.5">
                          <div className="text-[11px] text-muted-foreground">{item.label}</div>
                          <div className={cn("mt-1 truncate text-sm font-semibold", item.tone)}>{item.value}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{item.helper}</div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{activeScreening?.summary?.trim() || reportBrief}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(reportCompetencies.length ? reportCompetencies : ["暂无标签"]).slice(0, 8).map((tag, index) => (
                        <span key={`${tag}-${index}`} className="inline-flex items-center gap-1 rounded-[4px] border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                          <ShieldCheck className="h-3 w-3" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-blue-100 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <MessageSquarePlus className="h-4 w-4 text-blue-700" />
                      复核建议
                    </div>
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                      <div>
                        <div className="mb-2 text-xs font-semibold text-muted-foreground">电话/面试优先确认</div>
                        <div className="space-y-2">
                          {reportReviewQuestions.map((item, index) => (
                            <div key={item} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 text-sm leading-6 text-slate-700">
                              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                                {index + 1}
                              </span>
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-[6px] bg-slate-50 px-3 py-3">
                        <div className="text-xs font-semibold text-muted-foreground">推进条件</div>
                        <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                          <div className="flex gap-2">
                            <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span>{activeScreening?.next_step ? "可进入下一轮沟通" : "先确认硬性条件后再决定"}</span>
                          </div>
                          <div className="flex gap-2">
                            <ShieldCheck className="mt-1 h-3.5 w-3.5 shrink-0 text-blue-600" />
                            <span>{reportMissingInfo.length ? `补齐 ${reportMissingInfo.slice(0, 2).join("、")}` : "资料完整度可接受"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <Button variant="unstyled"
                      type="button"
                      onClick={() => setInterviewQaExpanded((current) => !current)}
                      className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 text-left"
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                        <MessageSquarePlus className="h-4 w-4 text-blue-700" />
                        追问准备
                        <span className="rounded-[4px] bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                          {selectedCandidate.interview_qa?.length ?? 0} 条
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                        {interviewQaExpanded ? "收起问答" : "展开问答"}
                        {interviewQaExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </Button>
                    <div className="mt-1 text-xs text-muted-foreground">结合当前 JD 和候选人简历生成的电话/面试参考问答。</div>
                    <div className={cn("overflow-hidden transition-colors motion-reduce:transition-none duration-200", interviewQaExpanded ? "mt-4 max-h-[2400px] opacity-100" : "max-h-0 opacity-0")}>
                      {selectedCandidate.interview_qa?.length ? (
                        <div className="space-y-3">
                          {selectedCandidate.interview_qa.map((item, index) => (
                            <div key={`${item.question}-${index}`} className="rounded-[6px] border border-slate-100 bg-slate-50 px-3 py-3">
                              <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                                  Q{index + 1}
                                </span>
                                <div className="min-w-0 text-sm font-semibold leading-6 text-slate-900">{item.question}</div>
                              </div>
                              <div className="mt-3 rounded-[6px] bg-white px-3 py-3 text-sm leading-7 text-slate-700">
                                <span className="mr-2 font-semibold text-slate-500">参考答</span>
                                {item.answer}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[6px] border border-dashed border-slate-200 px-3 py-4 text-sm text-muted-foreground">
                          暂无问答建议
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <Award className="h-4 w-4 text-blue-700" />
                      能力评分
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {reportDimensionRows.map((item) => {
                        const score = typeof item.score === "number" ? Math.max(0, Math.min(100, Math.round(item.score))) : null;
                        return (
                          <div key={item.key} className="rounded-[6px] border border-slate-100 bg-slate-50 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-semibold text-slate-800">{item.label}</span>
                              <span className="text-sm font-semibold text-slate-600">{score ?? "-"}%</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                              <div className="h-full rounded-full bg-blue-600" style={{ width: `${score ?? 0}%` }} />
                            </div>
                            {item.reason ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{item.reason}</p> : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <Briefcase className="h-4 w-4 text-blue-700" />
                      经历线索
                    </div>
                    <div className="space-y-3">
                      {[
                        {
                          title: selectedCandidateProfile.recent_title || reportRole,
                          meta: reportCompany,
                          items: reportHighlights.length ? reportHighlights : ["暂无结构化经历，当前使用简历摘要作为经历线索。"],
                        },
                        {
                          title: "筛选记录",
                          meta: activeScreening?.created_at ? formatDate(activeScreening.created_at) : "当前版本",
                          items: [activeScreening?.summary || "暂无筛选摘要"].filter(Boolean),
                        },
                      ].map((group, index) => (
                        <div key={`${group.title}-${index}`} className="grid gap-3 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0 md:grid-cols-[136px_minmax(0,1fr)]">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-800">{group.title}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">{group.meta}</div>
                          </div>
                          <ul className="space-y-1.5 text-sm leading-6 text-slate-600">
                            {group.items.slice(0, 4).map((item) => (
                              <li key={item} className="flex gap-2">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                  </main>
                </div>

                <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => setScreeningHistoryExpanded((current) => !current)}
                    className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <Clock3 className="h-4 w-4 text-blue-700" />
                      筛选历史
                      <span className="rounded-[4px] bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                        {selectedCandidate.screenings.length} 条
                      </span>
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                      {screeningHistoryExpanded ? "收起历史" : "展开历史"}
                      {screeningHistoryExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </Button>

                  <div className={cn("overflow-hidden transition-colors motion-reduce:transition-none duration-200", screeningHistoryExpanded ? "mt-4 max-h-[3200px] opacity-100" : "max-h-0 opacity-0")}>
                    <div className="space-y-3">
                    {selectedCandidate.screenings.length ? (
                      selectedCandidate.screenings.map((item) => (
                        <div key={item.id} className="rounded-[6px] border border-slate-100 bg-slate-50 px-3 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {item.decision ? (
                                <span className={cn("inline-flex rounded-[4px] px-2.5 py-1 text-xs font-semibold", decisionMeta[item.decision].classes)}>
                                  {decisionMeta[item.decision].label}
                                </span>
                              ) : null}
                              <span className="rounded-[4px] bg-white px-2.5 py-1 text-xs font-medium text-slate-500">{item.model_name || "-"}</span>
                              <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                            </div>
                            <div className="text-xs text-slate-500">
                              分数：{typeof item.score === "number" ? item.score : "-"} / 耗时：{item.duration_ms ?? "-"} ms
                            </div>
                          </div>
                          <div className="mt-3 text-sm leading-6 text-slate-600">{item.summary?.trim() || "暂无摘要"}</div>
                          {item.error_message ? (
                            <div className="mt-3 rounded-[6px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                              错误：{item.error_message}
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-3">
                            {item.request_payload ? (
                              <details className="min-w-[220px] flex-1">
                                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-slate-600">查看 AI 请求</summary>
                                <pre className="material-scrollbar mt-2 max-h-60 overflow-auto rounded-[6px] border border-slate-200 bg-white p-3 text-xs whitespace-pre-wrap break-all text-slate-700">
                                  {JSON.stringify(item.request_payload, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                            {item.response_payload ? (
                              <details className="min-w-[220px] flex-1">
                                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-slate-600">查看 AI 原始响应</summary>
                                <pre className="material-scrollbar mt-2 max-h-60 overflow-auto rounded-[6px] border border-slate-200 bg-white p-3 text-xs whitespace-pre-wrap break-all text-slate-700">
                                  {JSON.stringify(item.response_payload, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[6px] border border-dashed border-slate-200 px-3 py-4 text-sm text-muted-foreground">
                        暂无筛选历史
                      </div>
                    )}
                    </div>
                  </div>
                </section>

                <section className="rounded-[8px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <FileUp className="h-4 w-4 text-blue-700" />
                      原始材料
                    </div>
                    <div className="text-xs text-muted-foreground">{selectedCandidate.source_subject || "来源邮件/简历"}</div>
                  </div>
                  {selectedCandidate.raw_email_text?.trim() ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-slate-600">展开原始邮件/简历文本</summary>
                      <pre className="material-scrollbar mt-2 max-h-72 overflow-auto rounded-[6px] border border-slate-200 bg-slate-50 p-3 text-xs leading-6 whitespace-pre-wrap break-words text-slate-700">
                        {selectedCandidate.raw_email_text}
                      </pre>
                    </details>
                  ) : (
                    <div className="mt-3 rounded-[6px] border border-dashed border-slate-200 px-3 py-4 text-sm text-muted-foreground">
                      暂无原始邮件/简历文本
                    </div>
                  )}
                </section>
              </article>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={canScreenCandidates && showFilterDialog} onOpenChange={setShowFilterDialog}>
        <DialogContent className="horizon-portal resume-screening-surface flex h-[78vh] w-[calc(100vw-32px)] grid-rows-none flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-0 sm:max-w-[900px]">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 py-5">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">候选人池 · MateChat</div>
              <DialogTitle className="mt-1 text-balance text-xl text-slate-900">AI 迭代筛选</DialogTitle>
              <DialogDescription className="mt-1 text-pretty text-sm text-slate-500">
                AI 会先分析筛选意图；条件不明确时会追问，明确后才生成新的评分版本。
              </DialogDescription>
            </div>
            <div className="mr-8 min-w-[260px]">
              <MaterialSelect
                value={selectedFilterVersion}
                onValueChange={setSelectedFilterVersion}
                options={[
                  { label: "初筛结果 / 当前最新", value: "" },
                  ...filterSessions.map((session) => ({
                    label: `${session.label} · ${session.recommend_count}/${session.total_count} 推荐`,
                    value: session.version_id,
                  })),
                ]}
                placeholder="选择筛选版本"
                className="h-10"
              />
            </div>
          </div>

          <div className="material-scrollbar flex-1 overflow-y-auto bg-slate-50 px-6 py-6">
            {renderCandidateFilterProgress()}
            {selectedFilterSession ? (
              <div className="mb-5 rounded-lg border border-blue-100 bg-white px-4 py-3 text-pretty text-sm leading-6 text-blue-950">
                {selectedFilterSession.filter_summary || selectedFilterSession.instruction}
              </div>
            ) : null}

            {filterConversation.length || filterRunning ? (
              <div className="space-y-4">
                {filterConversation.map((message, index) => {
                  const isUser = message.role === "user";
                  return (
                    <div key={`${message.role}-${index}`} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[82%] rounded-xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap",
                          isUser
                            ? "material-neu-inset rounded-tr-md text-slate-800"
                            : "material-neu-card rounded-tl-md text-slate-800",
                        )}
                      >
                        {message.content}
                      </div>
                    </div>
                  );
                })}
                {filterRunning ? (
                  <div className="flex justify-start">
                    <div className="material-neu-card inline-flex items-center gap-2 rounded-xl rounded-tl-md px-4 py-3 text-sm text-slate-600">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      {filterQueryError ? "后台任务仍保留，可继续查询进度" : "AI 正在处理候选人，可关闭页面稍后查看"}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center text-sm leading-7 text-muted-foreground">
                输入新的筛选偏好，AI 会先判断是否足够明确；不明确会继续追问，明确后才会生成新的候选人列表版本。
              </div>
            )}
          </div>

          <div className="border-t border-slate-200/80 bg-white/72 px-6 py-4">
            <div className="material-neu-inset rounded-xl p-3">
              <Textarea
                aria-label="输入 AI 迭代筛选偏好"
                rows={3}
                value={filterInstruction}
                onChange={(event) => setFilterInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void handleIterateCandidateFilter();
                  }
                }}
                disabled={!canScreenCandidates || filterRunning || filterQuerying || filterResultPending}
                className="material-scrollbar min-h-[72px] w-full resize-none bg-transparent text-sm leading-7 text-slate-700 outline-none placeholder:text-muted-foreground disabled:opacity-50"
                placeholder="例如：优先保留机械制图经验明确、会 SolidWorks、南京周边、薪资不超过 10k 的候选人；对道路工程背景降权。"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">处理当前岗位范围的全部候选人；Ctrl/Command + Enter 发送。</div>
                <Button variant="unstyled"
                  type="button"
                  onClick={() => void handleIterateCandidateFilter()}
                  disabled={!canScreenCandidates || !filterInstruction.trim() || filterRunning || filterQuerying || filterResultPending || Boolean(filterQueryError)}
                  className="material-neu-primary inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[var(--m3-shape-small)] px-5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {filterRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {filterRunning ? "处理中" : "发送给 AI"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(candidateAiDialogId)}
        onOpenChange={(open) => {
          if (!open) {
            setCandidateAiDialogId(null);
            setCandidateAiQuestion("");
          }
        }}
      >
        <DialogContent className="horizon-portal resume-screening-surface flex h-[82vh] w-[calc(100vw-32px)] grid-rows-none flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-0 sm:max-w-[980px]">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-5">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500">候选人 · MateChat</div>
              <DialogTitle className="mt-1 truncate text-balance text-xl text-slate-900">
                {candidateAiTarget ? `${candidateAiProfile?.name || "未命名候选人"} · AI 讨论` : "候选人 AI 讨论"}
              </DialogTitle>
              <DialogDescription className="mt-1 truncate text-pretty text-sm text-slate-500">
                {candidateAiTarget
                  ? `${candidateAiTarget.job_rule_name || candidateAiProfile?.target_job || "未匹配岗位"} / ${candidateAiProfile?.city || "城市未知"}`
                  : "基于候选人简历、JD 和筛选结果回答"}
              </DialogDescription>
            </div>
            <div className="material-neu-chip mr-8 flex shrink-0 items-center gap-2 rounded-[4px] px-3 py-1.5 text-xs font-medium text-slate-500">
              <Bot className="h-3.5 w-3.5" />
               独立候选人上下文
            </div>
          </div>

          <div className="material-scrollbar flex-1 overflow-y-auto bg-slate-50 px-6 py-6">
            {candidateAiMessages.length || candidateAiLoading ? (
              <div className="space-y-5">
                {candidateAiMessages.map((message, index) => {
                  const isUser = message.role === "user";
                  return (
                    <div key={`${message.role}-${index}`} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                      <div className={cn("flex max-w-[84%] gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
                        <div
                          className={cn(
                            "mt-1 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[4px] shadow-sm",
                            isUser ? "bg-primary text-sm font-semibold text-white" : "bg-white",
                          )}
                        >
                          {isUser ? candidateAiProfile?.name?.slice(0, 1) || "U" : <img src={MATECHAT_AVATAR} alt="MateChat" className="h-8 w-8 object-contain" />}
                        </div>
                        <div className={isUser ? "text-right" : ""}>
                          <div
                            className={cn(
                              "rounded-xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap",
                              isUser
                                ? "material-neu-inset rounded-tr-md text-slate-800"
                                : "material-neu-card rounded-tl-md text-slate-800",
                            )}
                          >
                            {normalizeAiChatText(message.content)}
                            {!isUser && candidateAiLoading && index === candidateAiMessages.length - 1 && !message.content ? (
                              <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-slate-500 align-middle" />
                            ) : null}
                          </div>
                          {!isUser && message.ai_update ? (
                            <div className="mt-2 rounded-lg border border-blue-100 bg-white px-3 py-3 text-left shadow-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-xs font-semibold text-slate-700">可应用到详情的 AI 建议</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {message.ai_update.update_reason || "AI 认为该回复包含可同步到候选人详情的结构化修正。"}
                                  </div>
                                </div>
                                {hasCandidateAiUpdateSuggestion(message.ai_update) && candidateAiTarget ? (
                                  <Button
                                    type="button"
                                    onClick={() => void handleApplyCandidateAiUpdate(candidateAiTarget.id, index, message.ai_update as CandidateAiUpdateSuggestion)}
                                    disabled={candidateAiApplyingKey === `${candidateAiTarget.id}:${index}`}
                                    className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {candidateAiApplyingKey === `${candidateAiTarget.id}:${index}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                    应用到详情
                                  </Button>
                                ) : (
                                  <span className="rounded-[4px] bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                                    已应用
                                  </span>
                                )}
                              </div>

                              {hasCandidateAiUpdateSuggestion(message.ai_update) ? (
                                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                                  {getPatchKeys(message.ai_update.profile_patch).length ? (
                                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                                      <div className="font-semibold text-slate-700">候选人画像</div>
                                      <div className="mt-1 space-y-1">
                                        {getPatchKeys(message.ai_update.profile_patch).slice(0, 6).map((key) => (
                                          <div key={key} className="truncate">
                                            {candidateProfilePatchLabels[key] ?? key}：{formatPatchValue((message.ai_update?.profile_patch as Record<string, unknown> | undefined)?.[key])}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                  {getPatchKeys(message.ai_update.screening_patch).length ? (
                                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                                      <div className="font-semibold text-slate-700">筛选结果</div>
                                      <div className="mt-1 space-y-1">
                                        {getPatchKeys(message.ai_update.screening_patch).slice(0, 6).map((key) => (
                                          <div key={key} className="truncate">
                                            {candidateScreeningPatchLabels[key] ?? key}：{formatPatchValue((message.ai_update?.screening_patch as Record<string, unknown> | undefined)?.[key])}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {candidateAiLoading ? (
                  <div className="flex justify-start">
                    <div className="flex max-w-[84%] gap-3">
                      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-white shadow-sm">
                        <img src={MATECHAT_AVATAR} alt="MateChat" className="h-8 w-8 object-contain" />
                      </div>
                      <div className="rounded-xl rounded-tl-md bg-[#f5f5fb] px-4 py-4 shadow-sm">
                        <span className="flex items-center gap-1.5">
                          {[0, 1, 2].map((item) => (
                            <span
                              key={item}
                              className="h-2 w-2 animate-bounce rounded-[4px] bg-slate-400"
                              style={{ animationDelay: `${item * 160}ms`, animationDuration: "0.72s" }}
                            />
                          ))}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center text-sm leading-7 text-muted-foreground">
                开启一段独立于 MateChat 的候选人对话。可以追问“为什么评分偏低？如果忽略地域限制，是否建议进入面试？请给出电话初筛重点”。
              </div>
            )}
          </div>

          <div className="border-t border-slate-200/80 bg-white/72 px-6 py-4">
            <div className="material-neu-inset rounded-xl p-3">
              <Textarea
                aria-label="向候选人 AI 提问"
                rows={3}
                value={candidateAiQuestion}
                onChange={(event) => setCandidateAiQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleAskCandidateAi();
                  }
                }}
                disabled={!candidateAiTarget || candidateAiLoading}
                className="material-scrollbar min-h-[72px] w-full resize-none bg-transparent text-sm leading-7 text-slate-700 outline-none placeholder:text-muted-foreground disabled:opacity-50"
                placeholder={candidateAiTarget ? "输入问题，Enter 发送，Shift+Enter 换行" : "请先选择候选人"}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">回复会基于当前候选人的简历、JD、标签和筛选记录。</div>
                <Button variant="unstyled"
                  type="button"
                  onClick={() => void handleAskCandidateAi()}
                  disabled={!candidateAiQuestion.trim() || candidateAiLoading || !candidateAiTarget}
                  className="material-neu-primary inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[4px] px-5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {candidateAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {candidateAiLoading ? "分析中" : "发送"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => {
          if (!open && !deletingJobRuleId && !batchDeletingCandidates && !deletingCandidateId) {
            setDeleteConfirm(null);
          }
        }}
      >
        <AlertDialogContent className="horizon-portal w-[calc(100vw-32px)] rounded-xl border border-slate-200 bg-white sm:max-w-[460px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance">{deleteConfirm?.title || "确认删除？"}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">{deleteConfirm?.description || "该操作不可撤销。"}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingJobRuleId) || batchDeletingCandidates || Boolean(deletingCandidateId)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={Boolean(deletingJobRuleId) || batchDeletingCandidates || Boolean(deletingCandidateId)}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600"
            >
              {deletingJobRuleId || batchDeletingCandidates || deletingCandidateId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleteConfirm?.confirmLabel || "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
