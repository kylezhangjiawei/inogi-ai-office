import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
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
import { cn } from "./components/ui/utils";
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
  kind: "job-rule";
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

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-2 rounded-[20px] border border-slate-200 bg-white/80 px-4 py-3 sm:grid-cols-[112px_1fr]">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="text-sm text-slate-800">{value?.trim() ? value : "-"}</div>
    </div>
  );
}

function OverflowTooltipText({
  text,
  className,
}: {
  text?: string | null;
  className?: string;
}) {
  const safeText = text?.trim() || "-";
  return (
    <div title={safeText} className={cn("truncate", className)}>
      {safeText}
    </div>
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
        "inline-flex h-9 w-9 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60",
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

  const [decisionFilter, setDecisionFilter] = useState<Decision | "">("");
  const [jobRuleFilter, setJobRuleFilter] = useState("");
  const [minScoreFilter, setMinScoreFilter] = useState("");
  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    void loadCandidates();
  }, [decisionFilter, jobRuleFilter, minScoreFilter]);

  useEffect(() => {
    if (!selectedCandidateId) {
      setSelectedCandidate(null);
      return;
    }
    void loadCandidateDetail(selectedCandidateId);
  }, [selectedCandidateId]);

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
    } catch (error) {
      toast.error(getErrorMessage(error, "读取轮询计划失败"));
    }
  }

  async function loadCandidates() {
    setLoadingCandidates(true);
    try {
      const minScore = minScoreFilter.trim() ? Number(minScoreFilter) : undefined;
      const next = await recruitmentApi.listCandidates({
        decision: decisionFilter,
        jobRuleId: jobRuleFilter,
        minScore: typeof minScore === "number" && Number.isFinite(minScore) ? minScore : undefined,
      });
      setCandidates(next);
      setSelectedCandidateId((current) => {
        if (current && next.some((item) => item.id === current)) return current;
        return next[0]?.id ?? "";
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "读取候选人列表失败"));
      setCandidates([]);
      setSelectedCandidateId("");
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function loadCandidateDetail(candidateId: string) {
    setLoadingDetail(true);
    try {
      const next = await recruitmentApi.getCandidateDetail(candidateId);
      setSelectedCandidate((current) => (candidateId === selectedCandidateId ? next : current));
    } catch (error) {
      toast.error(getErrorMessage(error, "读取候选人详情失败"));
      setSelectedCandidate(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  function resetRuleForm() {
    setSelectedJobRuleId("");
    setRuleForm(emptyRuleForm);
  }

  function hydrateRule(jobRule: JobRule) {
    setSelectedJobRuleId(jobRule.id);
    setRuleForm({
      id: jobRule.id,
      name: jobRule.name,
      jd_text: jobRule.jd_text,
      enabled: jobRule.enabled,
    });
  }

  async function handleSaveRule() {
    if (!ruleForm.name.trim() || !ruleForm.jd_text.trim()) {
      toast.error("请先填写岗位名称和 JD 文本");
      return;
    }

    setSavingRule(true);
    try {
      const saved = await recruitmentApi.saveJobRule({
        id: ruleForm.id,
        name: ruleForm.name.trim(),
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

    if (deleteConfirm.kind === "job-rule") {
      const target = jobRules.find((item) => item.id === deleteConfirm.id);
      if (target) {
        await handleDeleteJobRule(target);
      }
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
        job_rule_id: selectedJobRuleId || undefined,
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
        job_rule_id: selectedJobRuleId || undefined,
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

  const activeScreening = selectedCandidate?.screenings?.[0];

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
                AI：{health?.openai_configured ? "OpenAI 已连接" : "等待 OpenAI 配置"}
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
              <div className="material-scrollbar mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-2">
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
                          "w-full rounded-[22px] border px-4 py-4 text-left transition",
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
                                  kind: "job-rule",
                                  id: jobRule.id,
                                  title: "确认删除岗位规则？",
                                  description: `删除后将移除此规则“${jobRule.name}”，该操作不可撤销。`,
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
              <MaterialInput
                label="岗位名称"
                value={ruleForm.name}
                onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：前端开发工程师 / 注册专员 / 质量工程师"
              />
              <MaterialTextarea
                label="岗位 JD 文本"
                value={ruleForm.jd_text}
                onChange={(event) => setRuleForm((current) => ({ ...current, jd_text: event.target.value }))}
                placeholder="直接粘贴完整岗位描述"
                className="min-h-[320px]"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSaveRule()}
                  disabled={savingRule}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-base font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
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
                  className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  清空表单
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="material-panel relative rounded-[32px] px-8 py-8">
          <div className="flex flex-col gap-4 pr-0 sm:pr-32">
            <div className="max-w-[560px]">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">同步控制</h2>
              <p className="mt-2 text-base leading-7 text-slate-400">
                检查环境后可手动同步，也可以启用每天定点轮询自动拉取邮箱简历。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void Promise.all([loadHealth(), loadMailConfigs(), loadOpenAiConfigs(), loadSchedule(), loadCandidates()])}
              className="inline-flex h-10 w-fit items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 sm:absolute sm:right-8 sm:top-8"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.82fr)]">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[26px] border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                    <Mail className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold leading-[1.3] text-slate-900">企业邮箱</div>
                    <div className="mt-1 text-xs text-slate-400">选择当前用于拉取简历的邮箱配置</div>
                  </div>
                </div>
                <div className="mt-4">
                  <MaterialSelect
                    label="邮箱配置"
                    value={selectedMailConfigId}
                    onValueChange={setSelectedMailConfigId}
                    options={mailConfigs.map((item) => ({
                      label: `${item.email}${item.enabled ? "（已启用）" : ""}`,
                      value: item.id,
                    }))}
                    placeholder={loadingMailConfigs ? "正在加载企业邮箱配置..." : "暂无企业邮箱配置"}
                  />
                </div>
                <div className="mt-4 rounded-[18px] bg-slate-50 px-4 py-3">
                  <div
                    className={cn(
                      "inline-flex items-center gap-2 text-[15px] font-semibold",
                      selectedMailConfig ? "text-emerald-600" : "text-amber-600",
                    )}
                  >
                    {selectedMailConfig ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                    <span className="shrink-0">{selectedMailConfig ? "已选择配置" : "待配置"}</span>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-slate-500">
                    {selectedMailConfig ? selectedMailConfig.email : "当前未检测到可用的企业邮箱配置。"}
                  </div>
                </div>
              </div>

              <div className="rounded-[26px] border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                    <Bot className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold leading-[1.3] text-slate-900">OpenAI</div>
                    <div className="mt-1 text-xs text-slate-400">选择当前用于简历解析和筛选的模型配置</div>
                  </div>
                </div>
                <div className="mt-4">
                  <MaterialSelect
                    label="模型配置"
                    value={selectedOpenAiConfigId}
                    onValueChange={setSelectedOpenAiConfigId}
                    options={openAiConfigs.map((item) => ({
                      label: `${item.name} / ${item.model}`,
                      value: item.id,
                    }))}
                    placeholder={loadingOpenAiConfigs ? "正在加载 OpenAI 配置..." : "暂无 OpenAI 配置"}
                  />
                </div>
                <div className="mt-4 rounded-[18px] bg-slate-50 px-4 py-3">
                  <div
                    className={cn(
                      "inline-flex items-center gap-2 text-[15px] font-semibold",
                      selectedOpenAiConfig ? "text-emerald-600" : "text-amber-600",
                    )}
                  >
                    {selectedOpenAiConfig ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                    <span className="shrink-0">{selectedOpenAiConfig ? "已选择配置" : "待配置"}</span>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-slate-500">
                    {selectedOpenAiConfig ? `${selectedOpenAiConfig.name} / ${selectedOpenAiConfig.model}` : "当前未检测到可用的 OpenAI 模型配置。"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-slate-50/85 p-5">
              <div className="text-sm font-semibold text-slate-400">同步参数</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <MaterialInput
                  label="回溯小时"
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
              <div className="mt-4 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-500">
                当前计划默认按 {scheduleForm.since_hours || 72} 小时窗口回溯，单次最多抓取 {scheduleForm.limit || 20} 份简历。
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.75))] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-[560px]">
                <div className="flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Clock3 className="h-4 w-4 text-slate-500" />
                  启用定点轮询获取邮箱简历
                </div>
                <div className="mt-2 text-sm leading-7 text-slate-500">
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
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
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

          <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <button
              type="button"
              onClick={() => void handleRunSync()}
              disabled={runningSync}
              className="inline-flex h-[82px] items-center justify-center gap-3 rounded-[28px] bg-[linear-gradient(90deg,#5477e8,#5ac3a6)] px-8 text-2xl font-semibold text-white shadow-[0_20px_35px_rgba(84,119,232,0.25)] transition hover:translate-y-[-1px] disabled:opacity-60"
            >
              {runningSync ? <Loader2 className="h-6 w-6 animate-spin" /> : <Sparkles className="h-6 w-6" />}
              运行一次同步
            </button>

            <div className="rounded-[28px] border border-blue-200 bg-blue-50/75 px-6 py-5 text-sm leading-7 text-slate-600">
              手动同步会立即执行；若已开启轮询，后续会继续按计划自动运行。
              {lastSyncResult ? (
                <span className="ml-2 text-slate-500">
                  本次结果：处理 {lastSyncResult.processed}，新增 {lastSyncResult.created_candidates}，跳过 {lastSyncResult.skipped}，失败 {lastSyncResult.failed}。
                </span>
              ) : null}
            </div>
          </div>
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

          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_0.8fr]">
            <MaterialSelect
              label="筛选结论"
              value={decisionFilter}
              onValueChange={(value) => setDecisionFilter(value as Decision | "")}
              options={decisionOptions}
              placeholder="全部结论"
            />
            <MaterialSelect
              label="岗位规则"
              value={jobRuleFilter}
              onValueChange={setJobRuleFilter}
              options={[{ label: "全部岗位", value: "" }, ...jobRules.map((item) => ({ label: item.name, value: item.id }))]}
              placeholder="全部岗位"
            />
            <MaterialInput
              label="最低分"
              type="number"
              min={0}
              value={minScoreFilter}
              onChange={(event) => setMinScoreFilter(event.target.value)}
              placeholder="例如 80"
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
                    "w-full rounded-[24px] border px-5 py-5 text-left transition",
                    selectedCandidateId === candidate.id
                      ? "border-cyan-300 bg-cyan-50 shadow-[0_12px_30px_rgba(34,211,238,0.12)]"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="text-lg font-semibold text-slate-900">{candidate.name || "未命名候选人"}</div>
                        {candidate.decision ? (
                          <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", decisionMeta[candidate.decision].classes)}>
                            {decisionMeta[candidate.decision].label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-slate-500 md:grid-cols-2">
                        <div>{candidate.email || "-"}</div>
                        <div>{candidate.phone || "-"}</div>
                        <div>{candidate.target_job || "-"}</div>
                        <div>{candidate.job_rule_name || "-"}</div>
                      </div>
                      <div className="mt-3 text-sm leading-7 text-slate-500">{candidate.summary?.trim() || "暂无摘要"}</div>
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
                    <div>
                      <div className="text-2xl font-semibold text-slate-900">
                        {selectedCandidate.parsed_candidate_profile.name || "未命名候选人"}
                      </div>
                      <div className="mt-2 text-sm text-slate-500">
                        {selectedCandidate.source_sender_name || selectedCandidate.source_sender_email || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{selectedCandidate.source_subject || "-"}</div>
                    </div>
                    {activeScreening?.decision ? (
                      <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", decisionMeta[activeScreening.decision].classes)}>
                        {decisionMeta[activeScreening.decision].label}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <FieldRow label="邮箱" value={selectedCandidate.parsed_candidate_profile.email} />
                    <FieldRow label="电话" value={selectedCandidate.parsed_candidate_profile.phone} />
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
              className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={Boolean(deletingJobRuleId)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-rose-600 px-6 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
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
