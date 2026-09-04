import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  GitBranch,
  Info,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Users,
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
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { NativeSelect } from "./components/ui/native-select";
import { Switch } from "./components/ui/switch";
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";
import {
  ApprovalFlow,
  ApprovalMode,
  ApprovalNode,
  APPROVAL_MODE_OPTIONS,
  APPROVAL_PERMISSION_OPTIONS,
  DEFAULT_PROJECT_FLOW,
  effectiveNodePool,
  fetchApprovalCandidatesApi,
  fetchApprovalPoolsApi,
  fetchFlowsApi,
  getPoolForPermission,
  loadFlows,
  PoolMember,
  saveFlows,
} from "./lib/approvalFlowConfig";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { PERMISSIONS } from "./lib/permissions";
import { isProductionWorkspace, isUsCollabWorkspace } from "./lib/rdApi";

type NodeField = "label" | "sla" | "mode";
type NodeErrors = Partial<Record<NodeField, string>>;

const MODE_BADGE: Record<ApprovalMode, { label: string; className: string }> = {
  single: { label: "单人", className: "border-slate-200 bg-slate-100 text-slate-700" },
  any: { label: "或签", className: "border-blue-200 bg-blue-50 text-[#002fa7]" },
  all: { label: "会签", className: "border-slate-300 bg-white text-slate-800" },
};

function cloneDefaultFlow(): ApprovalFlow {
  const base = DEFAULT_PROJECT_FLOW;
  return {
    ...base,
    name: isUsCollabWorkspace() ? "协同立项审批 · 默认流程" : base.name,
    nodes: base.nodes.map((node) => ({
      ...node,
      extra_members: node.extra_members?.map((member) => ({ ...member })),
      excluded_member_ids: node.excluded_member_ids ? [...node.excluded_member_ids] : undefined,
    })),
  };
}

function validateFlow(flow: ApprovalFlow): { nodeErrors: Record<string, NodeErrors>; message: string | null; firstKey: string | null } {
  if (flow.nodes.length === 0) {
    return { nodeErrors: {}, message: t("请至少添加一个审批节点后再保存。"), firstKey: null };
  }

  const nodeErrors: Record<string, NodeErrors> = {};
  let firstKey: string | null = null;
  for (const [index, node] of flow.nodes.entries()) {
    const errors: NodeErrors = {};
    if (!node.label.trim()) {
      errors.label = t("请输入节点名称。");
      firstKey ??= `${node.id}:label`;
    }
    if (node.sla_hours !== undefined && (!Number.isInteger(node.sla_hours) || node.sla_hours < 1)) {
      errors.sla = t("SLA 时长必须是大于 0 的整数。");
      firstKey ??= `${node.id}:sla`;
    }
    if (index === 0 && node.mode === "all") {
      errors.mode = t("当前版本首个生效节点暂不支持会签，请选择单人或或签。");
      firstKey ??= `${node.id}:mode`;
    }
    if (Object.keys(errors).length > 0) nodeErrors[node.id] = errors;
  }
  return {
    nodeErrors,
    message: firstKey ? t("请修正标记的节点配置后再保存。") : null,
    firstKey,
  };
}

function MiniAvatar({ name }: { name: string }) {
  const initial = name.trim().slice(0, 1) || "?";
  return (
    <span
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[#002fa7] text-[10px] font-semibold text-white ring-2 ring-white"
      title={name}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function PoolMemberChip({ member, manual, onRemove, removeTitle }: {
  member: PoolMember;
  manual?: boolean;
  onRemove?: () => void;
  removeTitle?: string;
}) {
  return (
    <li className={cn(
      "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-slate-700",
      manual ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white",
    )}>
      <MiniAvatar name={member.name} />
      <span className="max-w-28 truncate font-medium">{member.name}</span>
      {member.position ? <span className="hidden max-w-32 truncate text-[10px] text-slate-500 sm:inline">{t(member.position)}</span> : null}
      {manual ? <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-[#002fa7]">{t("手动")}</span> : null}
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={removeTitle}
          title={removeTitle}
          className="size-6 text-slate-500 hover:bg-red-50 hover:text-red-600"
        >
          <X className="size-3" aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

function ApprovalNodeCard({
  node,
  isFirst,
  isLast,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  pools,
  candidates,
  candidateLoading,
  candidateError,
  onRetryCandidates,
  errors,
  registerField,
  readOnly,
}: {
  node: ApprovalNode;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<ApprovalNode>) => void;
  onDelete: (trigger: HTMLButtonElement) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pools: Record<string, PoolMember[]>;
  candidates: PoolMember[];
  candidateLoading: boolean;
  candidateError: string | null;
  onRetryCandidates: () => void;
  errors?: NodeErrors;
  registerField: (field: NodeField, element: HTMLElement | null) => void;
  readOnly?: boolean;
}) {
  useI18n();
  const labelId = useId();
  const descriptionId = useId();
  const permissionId = useId();
  const slaId = useId();
  const escalateId = useId();
  const headingId = useId();
  const candidatePanelId = useId();
  const candidateSearchId = useId();
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");

  const derived = pools[node.permission_code] ?? getPoolForPermission(node.permission_code);
  const excludedIds = new Set(node.excluded_member_ids ?? []);
  const removedMembers = derived.filter((member) => excludedIds.has(member.id));
  const pool = effectiveNodePool(node, derived);
  const extraIds = new Set((node.extra_members ?? []).map((member) => member.id));
  const poolIds = new Set(pool.map((member) => member.id));
  const keyword = candidateSearch.trim().toLocaleLowerCase();
  const addableCandidates = candidates.filter((candidate) => {
    const searchable = `${candidate.name} ${candidate.position ?? ""}`.toLocaleLowerCase();
    return !poolIds.has(candidate.id) && (!keyword || searchable.includes(keyword));
  });
  const mode = MODE_BADGE[node.mode];

  const closeCandidatePanel = (restoreFocus = true) => {
    setAddOpen(false);
    setCandidateSearch("");
    if (restoreFocus) window.requestAnimationFrame(() => addTriggerRef.current?.focus());
  };

  const excludeMember = (id: string) => onChange({
    excluded_member_ids: [...new Set([...(node.excluded_member_ids ?? []), id])],
    extra_members: (node.extra_members ?? []).filter((member) => member.id !== id),
  });

  const restoreMember = (id: string) => onChange({
    excluded_member_ids: (node.excluded_member_ids ?? []).filter((memberId) => memberId !== id),
    extra_members: (node.extra_members ?? []).filter((member) => member.id !== id),
  });

  const removeExtra = (id: string) => onChange({
    extra_members: (node.extra_members ?? []).filter((member) => member.id !== id),
  });

  const addExtra = (candidate: PoolMember) => {
    onChange({
      excluded_member_ids: (node.excluded_member_ids ?? []).filter((memberId) => memberId !== candidate.id),
      extra_members: derived.some((member) => member.id === candidate.id)
        ? (node.extra_members ?? []).filter((member) => member.id !== candidate.id)
        : [
            ...(node.extra_members ?? []).filter((member) => member.id !== candidate.id),
            { id: candidate.id, name: candidate.name, position: candidate.position, email: candidate.email },
          ],
    });
    closeCandidatePanel();
  };

  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white" aria-labelledby={headingId}>
      <h3 id={headingId} className="sr-only">{t("审批节点 {n}", { n: node.level })}</h3>
      <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:min-w-[220px]">
            <Label htmlFor={labelId} className="mb-1.5 block text-xs font-semibold text-slate-700">
              {t("审批节点 {n} · 节点名称", { n: node.level })}
            </Label>
            <Input
              ref={(element) => registerField("label", element)}
              id={labelId}
              value={node.label}
              onChange={(event) => onChange({ label: event.target.value })}
              readOnly={readOnly}
              aria-invalid={Boolean(errors?.label)}
              aria-describedby={errors?.label ? `${labelId}-error` : undefined}
              placeholder={t("输入节点名称")}
              className="font-semibold text-slate-900"
            />
            {errors?.label ? <p id={`${labelId}-error`} role="alert" className="mt-1 text-xs text-red-600">{errors.label}</p> : null}
          </div>

          <span className={cn("inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold", mode.className)}>{t(mode.label)}</span>

          <div className="flex shrink-0 items-center gap-1" aria-label={t("节点排序与删除操作")}>
            <Button type="button" variant="ghost" size="icon" onClick={onMoveUp} disabled={readOnly || isFirst} aria-label={t("上移节点 {name}", { name: node.label || node.level })} title={t("上移")}>
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onMoveDown} disabled={readOnly || isLast} aria-label={t("下移节点 {name}", { name: node.label || node.level })} title={t("下移")}>
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(event) => onDelete(event.currentTarget)}
              disabled={readOnly}
              aria-label={t("删除节点 {name}", { name: node.label || node.level })}
              title={t("删除节点")}
              className="text-slate-500 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div>
          <Label htmlFor={descriptionId} className="mb-1.5 block text-xs font-semibold text-slate-700">{t("节点说明")}</Label>
          <Input id={descriptionId} value={node.description ?? ""} onChange={(event) => onChange({ description: event.target.value })} readOnly={readOnly} placeholder={t("说明此节点的审核职责（可选）")} />
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor={permissionId} className="mb-1.5 block text-xs font-semibold text-slate-700">{t("关联权限")}</Label>
            <NativeSelect id={permissionId} value={node.permission_code} onChange={(event) => onChange({ permission_code: event.target.value })} disabled={readOnly} className="w-full">
              {APPROVAL_PERMISSION_OPTIONS.map((option) => <option key={option.code} value={option.code}>{t(option.label)}</option>)}
            </NativeSelect>
            <p className="mt-1 text-pretty text-xs text-slate-500">{t("拥有此权限的成员会自动进入当前审核池。")}</p>
          </div>

          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-xs font-semibold text-slate-700">{t("审核模式")}</legend>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label={t("审核模式")}>
              {APPROVAL_MODE_OPTIONS.map((option) => (
                <button
                  ref={option.value === "all" ? (element) => registerField("mode", element) : undefined}
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ mode: option.value })}
                  disabled={readOnly || (isFirst && option.value === "all")}
                  aria-pressed={node.mode === option.value}
                  aria-invalid={option.value === "all" && Boolean(errors?.mode)}
                  title={t(option.helper)}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60",
                    node.mode === option.value ? "bg-white text-[#002fa7] shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900",
                  )}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-pretty text-xs text-slate-500">{t(APPROVAL_MODE_OPTIONS.find((option) => option.value === node.mode)?.helper ?? "")}</p>
            {errors?.mode ? <p role="alert" className="mt-1 text-xs text-red-600">{errors.mode}</p> : null}
          </fieldset>

          <div className="min-w-0">
            <Label htmlFor={slaId} className="mb-1.5 block text-xs font-semibold text-slate-700">{t("SLA 时长（小时）")}</Label>
            <Input
              ref={(element) => registerField("sla", element)}
              id={slaId}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={node.sla_hours ?? ""}
              onChange={(event) => onChange({ sla_hours: event.target.value ? Number(event.target.value) : undefined })}
              readOnly={readOnly}
              aria-invalid={Boolean(errors?.sla)}
              aria-describedby={`${slaId}-help${errors?.sla ? ` ${slaId}-error` : ""}`}
              placeholder={t("例：48")}
            />
            <p id={`${slaId}-help`} className="mt-1 text-pretty text-xs text-amber-700">{t("字段已预留，本期不触发自动催办。")}</p>
            {errors?.sla ? <p id={`${slaId}-error`} role="alert" className="mt-1 text-xs text-red-600">{errors.sla}</p> : null}
          </div>

          <div className="flex min-w-0 items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="min-w-0">
              <Label htmlFor={escalateId} className="text-xs font-semibold text-slate-700">{t("超时升级")}</Label>
              <p className="mt-1 text-pretty text-xs text-slate-500">{node.escalate_on_timeout ? t("SLA 到期后标记为待升级。") : t("SLA 到期后保持当前节点。")}</p>
            </div>
            <Switch id={escalateId} checked={Boolean(node.escalate_on_timeout)} onCheckedChange={(checked) => onChange({ escalate_on_timeout: checked })} disabled={readOnly} aria-label={t("切换节点 {name} 的超时升级", { name: node.label || node.level })} className="data-[state=checked]:bg-[#002fa7]" />
          </div>
        </div>

        <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label={t("当前审核池")}>
          <div>
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Users className="size-3.5 text-[#002fa7]" aria-hidden="true" />
              {t("当前审核池")}
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold tabular-nums">{pool.length}</span>
            </h4>
            <p className="mt-1 text-pretty text-xs text-slate-500">{t("默认按角色权限派生，也可对当前节点手动增删成员。")}</p>
          </div>

          {pool.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-pretty text-xs text-slate-500">{t("审核池为空。请在角色权限页分配对应权限，或手动添加具备审批能力的成员。")}</p>
          ) : (
            <ul className="mt-3 flex min-w-0 flex-wrap gap-2" aria-label={t("有效审核人名单")}>
              {pool.map((member) => (
                <PoolMemberChip
                  key={member.id}
                  member={member}
                  manual={extraIds.has(member.id)}
                  onRemove={readOnly ? undefined : () => (extraIds.has(member.id) ? removeExtra(member.id) : excludeMember(member.id))}
                  removeTitle={t("移出审核人 {name}", { name: member.name })}
                />
              ))}
            </ul>
          )}

          {removedMembers.length > 0 ? (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-500">{t("已从本节点移出 {n} 人", { n: removedMembers.length })}</p>
              <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("已移出审核人名单")}>
                {removedMembers.map((member) => (
                  <li key={member.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
                    <span className="line-through">{member.name}</span>
                    {!readOnly ? <button type="button" onClick={() => restoreMember(member.id)} className="font-semibold text-[#002fa7] hover:underline">{t("恢复")}</button> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!readOnly ? (
            <div className="mt-3">
              {addOpen ? (
                <div id={candidatePanelId} className="rounded-lg border border-blue-200 bg-white p-3">
                  <div className="flex min-w-0 items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={candidateSearchId} className="mb-1.5 block text-xs font-semibold text-slate-700">{t("搜索可添加审核人")}</Label>
                      <Input autoFocus id={candidateSearchId} value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder={t("姓名或岗位")} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => closeCandidatePanel()} aria-label={t("关闭审核人选择")}>
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>

                  {candidateLoading ? (
                    <div className="mt-3 space-y-2" role="status" aria-label={t("正在加载审核人候选")}>
                      <div className="h-8 rounded-md bg-slate-100" />
                      <div className="h-8 rounded-md bg-slate-100" />
                    </div>
                  ) : candidateError ? (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
                      <p className="text-pretty text-xs text-red-700">{candidateError}</p>
                      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetryCandidates}>
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        {t("重新读取候选")}
                      </Button>
                    </div>
                  ) : addableCandidates.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-pretty text-xs text-slate-500">{keyword ? t("没有匹配的可添加成员。") : t("当前没有更多可添加的审批成员。")}</p>
                  ) : (
                    <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto" aria-label={t("审核人候选名单")}>
                      {addableCandidates.slice(0, 20).map((candidate) => (
                        <li key={candidate.id}>
                          <button type="button" onClick={() => addExtra(candidate)} className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-slate-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500">
                            <MiniAvatar name={candidate.name} />
                            <span className="min-w-0 flex-1 truncate font-medium">{candidate.name}</span>
                            <span className="max-w-40 truncate text-slate-500">{t(candidate.position)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!candidateLoading && !candidateError && addableCandidates.length > 20 ? <p className="mt-2 text-pretty text-xs text-slate-500">{t("仅显示前 20 位候选，请继续输入姓名或岗位缩小范围。")}</p> : null}
                </div>
              ) : (
                <Button ref={addTriggerRef} type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)} aria-expanded={addOpen} aria-controls={candidatePanelId}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t("添加审核人")}
                </Button>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </article>
  );
}

function FlowConnector() {
  return (
    <div className="flex items-center justify-center py-2" aria-hidden="true">
      <span className="flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"><ArrowDown className="size-3.5" /></span>
    </div>
  );
}

function ApprovalFlowLoading() {
  return (
    <section className="hz-surface min-w-0 overflow-hidden" role="status" aria-label={t("正在加载审批流配置")} aria-busy="true">
      <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="h-5 w-40 rounded bg-slate-100" />
        <div className="mt-2 h-3 w-72 max-w-full rounded bg-slate-100" />
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="h-9 w-full rounded bg-slate-100" />
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="h-16 rounded bg-slate-100" /><div className="h-16 rounded bg-slate-100" /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RDApprovalFlowPage() {
  useI18n();
  const usCollabWorkspace = isUsCollabWorkspace();
  const canManageFlow = usePermission(PERMISSIONS.RD_APPROVAL_FLOW_MANAGE);
  const [flows, setFlowsState] = useState<ApprovalFlow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvalPools, setApprovalPools] = useState<Record<string, PoolMember[]>>({});
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PoolMember[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingDeleteNode, setPendingDeleteNode] = useState<ApprovalNode | null>(null);
  const [nodeErrors, setNodeErrors] = useState<Record<string, NodeErrors>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const flowRequestRef = useRef(0);
  const poolRequestRef = useRef(0);
  const candidateRequestRef = useRef(0);
  const savingRef = useRef(false);
  const savedFlowsRef = useRef<ApprovalFlow[] | null>(null);
  const fieldRefs = useRef(new Map<string, HTMLElement>());
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const addNodeButtonRef = useRef<HTMLButtonElement>(null);

  const loadConfiguration = useCallback(async () => {
    const requestId = ++flowRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await fetchFlowsApi();
      if (requestId !== flowRequestRef.current) return;
      setFlowsState(loaded);
      savedFlowsRef.current = loaded;
      setActiveFlowId((current) => loaded.some((flow) => flow.id === current) ? current : loaded[0]?.id ?? "");
      setDirty(false);
      setNodeErrors({});
      setSaveError(null);
    } catch (error) {
      if (requestId !== flowRequestRef.current) return;
      const fallback = loadFlows();
      savedFlowsRef.current = null;
      setFlowsState(fallback);
      setActiveFlowId((current) => fallback.some((flow) => flow.id === current) ? current : fallback[0]?.id ?? "");
      setDirty(false);
      setLoadError(error instanceof Error ? error.message : t("审批流接口加载失败，当前显示本地缓存。"));
    } finally {
      if (requestId === flowRequestRef.current) setLoading(false);
    }
  }, []);

  const loadCandidates = useCallback(async () => {
    if (!canManageFlow) return;
    const requestId = ++candidateRequestRef.current;
    setCandidateLoading(true);
    setCandidateError(null);
    try {
      const loaded = await fetchApprovalCandidatesApi();
      if (requestId !== candidateRequestRef.current) return;
      setCandidates(loaded);
    } catch (error) {
      if (requestId !== candidateRequestRef.current) return;
      setCandidates([]);
      setCandidateError(error instanceof Error ? error.message : t("审核人候选读取失败。"));
    } finally {
      if (requestId === candidateRequestRef.current) setCandidateLoading(false);
    }
  }, [canManageFlow]);

  useEffect(() => {
    void loadConfiguration();
    return () => { flowRequestRef.current += 1; };
  }, [loadConfiguration]);

  useEffect(() => {
    if (canManageFlow) void loadCandidates();
    return () => { candidateRequestRef.current += 1; };
  }, [canManageFlow, loadCandidates]);

  const permissionKey = useMemo(
    () => Array.from(new Set(flows.flatMap((flow) => flow.nodes.map((node) => node.permission_code)))).sort().join("|"),
    [flows],
  );

  useEffect(() => {
    if (!permissionKey) {
      setApprovalPools({});
      setPoolError(null);
      setPoolLoading(false);
      return undefined;
    }
    const requestId = ++poolRequestRef.current;
    setPoolLoading(true);
    setPoolError(null);
    fetchApprovalPoolsApi(permissionKey.split("|"))
      .then((loaded) => { if (requestId === poolRequestRef.current) setApprovalPools(loaded); })
      .catch((error: unknown) => {
        if (requestId !== poolRequestRef.current) return;
        setApprovalPools({});
        setPoolError(error instanceof Error ? error.message : t("审核池成员读取失败。"));
      })
      .finally(() => { if (requestId === poolRequestRef.current) setPoolLoading(false); });
    return () => { poolRequestRef.current += 1; };
  }, [permissionKey]);

  const activeFlow = useMemo(() => flows.find((flow) => flow.id === activeFlowId), [activeFlowId, flows]);
  const uniqueReviewerCount = useMemo(() => {
    if (!activeFlow) return 0;
    const reviewerIds = new Set<string>();
    for (const node of activeFlow.nodes) {
      const derived = approvalPools[node.permission_code] ?? getPoolForPermission(node.permission_code);
      for (const member of effectiveNodePool(node, derived)) reviewerIds.add(member.id);
    }
    return reviewerIds.size;
  }, [activeFlow, approvalPools]);
  const slaNodeCount = activeFlow?.nodes.filter((node) => typeof node.sla_hours === "number").length ?? 0;

  const clearNodeErrors = (nodeId: string, patch: Partial<ApprovalNode>) => {
    if (!("label" in patch) && !("sla_hours" in patch)) return;
    setNodeErrors((current) => {
      const existing = current[nodeId];
      if (!existing) return current;
      const nextNodeErrors = { ...existing };
      if ("label" in patch) delete nextNodeErrors.label;
      if ("sla_hours" in patch) delete nextNodeErrors.sla;
      const next = { ...current };
      if (Object.keys(nextNodeErrors).length === 0) delete next[nodeId];
      else next[nodeId] = nextNodeErrors;
      return next;
    });
    setSaveError(null);
  };

  const updateNode = (nodeId: string, patch: Partial<ApprovalNode>) => {
    if (!canManageFlow || loadError) return;
    const updatedAt = new Date().toISOString();
    setFlowsState((current) => current.map((flow) => flow.id === activeFlowId ? {
      ...flow,
      updated_at: updatedAt,
      nodes: flow.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    } : flow));
    clearNodeErrors(nodeId, patch);
    setDirty(true);
  };

  const deleteNode = (nodeId: string) => {
    if (!canManageFlow || loadError) return;
    const updatedAt = new Date().toISOString();
    setFlowsState((current) => current.map((flow) => flow.id === activeFlowId ? {
      ...flow,
      updated_at: updatedAt,
      nodes: flow.nodes.filter((node) => node.id !== nodeId).map((node, index) => ({ ...node, level: index + 1 })),
    } : flow));
    setNodeErrors((current) => { const next = { ...current }; delete next[nodeId]; return next; });
    setSaveError(null);
    setDirty(true);
  };

  const moveNode = (nodeId: string, direction: "up" | "down") => {
    if (!canManageFlow || loadError) return;
    setFlowsState((current) => current.map((flow) => {
      if (flow.id !== activeFlowId) return flow;
      const index = flow.nodes.findIndex((node) => node.id === nodeId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= flow.nodes.length) return flow;
      const nodes = [...flow.nodes];
      [nodes[index], nodes[targetIndex]] = [nodes[targetIndex], nodes[index]];
      return { ...flow, updated_at: new Date().toISOString(), nodes: nodes.map((node, nextIndex) => ({ ...node, level: nextIndex + 1 })) };
    }));
    setDirty(true);
  };

  const addNode = () => {
    if (!canManageFlow || loadError) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    const nodeId = `node-${Date.now()}`;
    setFlowsState((current) => current.map((flow) => flow.id === activeFlowId ? {
      ...flow,
      updated_at: new Date().toISOString(),
      nodes: [...flow.nodes, {
        id: nodeId,
        level: flow.nodes.length + 1,
        label: t("审核节点 {n}", { n: flow.nodes.length + 1 }),
        permission_code: APPROVAL_PERMISSION_OPTIONS[0].code,
        mode: "any",
        description: "",
        sla_hours: 48,
        escalate_on_timeout: false,
      }],
    } : flow));
    setDirty(true);
    setSaveError(null);
    window.requestAnimationFrame(() => fieldRefs.current.get(`${nodeId}:label`)?.focus());
  };

  const save = async () => {
    if (!canManageFlow || !activeFlow || loadError || !savedFlowsRef.current) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    if (savingRef.current) return;
    const validation = validateFlow(activeFlow);
    setNodeErrors(validation.nodeErrors);
    setSaveError(validation.message);
    if (validation.message) {
      if (validation.firstKey) window.requestAnimationFrame(() => fieldRefs.current.get(validation.firstKey ?? "")?.focus());
      toast.error(validation.message);
      return;
    }
    const updatedAt = new Date().toISOString();
    const nextFlows = flows.map((flow) => flow.id === activeFlow.id ? { ...flow, updated_at: updatedAt } : flow);
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const savedFlows = await saveFlows(nextFlows, savedFlowsRef.current);
      savedFlowsRef.current = savedFlows;
      setFlowsState(savedFlows);
      setDirty(false);
      toast.success(t("审批流配置已保存"), { description: `${t(activeFlow.name)} · ${t("{n} 个节点", { n: activeFlow.nodes.length })}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("审批流配置保存失败，请重试");
      setSaveError(message);
      setDirty(true);
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!canManageFlow || loadError || !savedFlowsRef.current) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    if (savingRef.current) return;
    const template = cloneDefaultFlow();
    const nextFlows = [template];
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const savedFlows = await saveFlows(nextFlows, savedFlowsRef.current);
      savedFlowsRef.current = savedFlows;
      setFlowsState(savedFlows);
      setActiveFlowId(savedFlows[0]?.id ?? template.id);
      setConfirmReset(false);
      setDirty(false);
      setNodeErrors({});
      toast.info(t("已恢复默认审批流"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("恢复默认审批流失败，请重试");
      setSaveError(message);
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const createDefaultDraft = () => {
    if (!canManageFlow || loadError) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    const now = new Date().toISOString();
    const template = cloneDefaultFlow();
    const draft = { ...template, created_at: now, updated_at: now };
    setFlowsState([draft]);
    setActiveFlowId(draft.id);
    setDirty(true);
    setLoadError(null);
    setNodeErrors({});
    setSaveError(null);
  };

  const openResetDialog = (trigger: HTMLElement) => { dialogTriggerRef.current = trigger; setConfirmReset(true); };
  const openDeleteDialog = (node: ApprovalNode, trigger: HTMLElement) => { dialogTriggerRef.current = trigger; setPendingDeleteNode(node); };
  const restoreDialogFocus = (event: Event) => {
    event.preventDefault();
    const trigger = dialogTriggerRef.current;
    dialogTriggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
      else addNodeButtonRef.current?.focus();
    });
  };

  const statusValue = loading ? "—" : dirty ? t("待保存") : t("已同步");
  const workspaceLabel = usCollabWorkspace ? t("中美协同工作区") : t("研发工作区");
  return (
    <main className="horizon-theme hz-page min-w-0" aria-busy={saving}>
      <div className="hz-page-inner min-w-0 space-y-3">
        <HorizonPageHeader
          Icon={GitBranch}
          titleLevel={2}
          eyebrow={usCollabWorkspace ? "GLOBAL COLLAB · APPROVAL FLOW" : "R&D GOVERNANCE · APPROVAL FLOW"}
          title={t(usCollabWorkspace ? "协同审批流配置" : "审批流配置")}
          description={t(!usCollabWorkspace && !isProductionWorkspace() ? "研发立项已直接生效，此处立项节点不再参与审核；成果验收和放弃任务仍需审核。" : "配置审核成员路由与预留节点；当前任务审批实际执行首个节点的一阶段审核。")}
          meta={<><span>{workspaceLabel}</span><span aria-hidden="true">·</span><span>{canManageFlow ? t("可管理") : t("只读访问")}</span></>}
          actions={canManageFlow ? (
            <>
              <Button type="button" variant="outline" onClick={(event) => openResetDialog(event.currentTarget)} disabled={loading || saving || Boolean(loadError)}>
                <RotateCcw className="size-4" aria-hidden="true" />{t("恢复默认")}
              </Button>
              <Button type="button" className="hz-primary-action" onClick={() => void save()} disabled={loading || saving || Boolean(loadError) || !dirty} aria-describedby={saveError ? "approval-flow-save-error" : undefined}>
                {saving ? <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}{saving ? t("保存中…") : dirty ? t("保存配置") : t("已保存")}
              </Button>
            </>
          ) : <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">{t("只读")}</span>}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={GitBranch} label={t("配置节点")} value={loading ? "—" : activeFlow?.nodes.length ?? 0} note={activeFlow ? t("首节点当前生效") : t("等待流程配置")} tone="brand" />
          <HorizonMetric Icon={Users} label={t("审核池成员")} value={loading || poolLoading ? "—" : uniqueReviewerCount} note={poolError ? t("成员数据暂不可用") : t("按当前流程去重统计")} tone="brand" />
          <HorizonMetric Icon={Clock} label={t("SLA 节点")} value={loading ? "—" : slaNodeCount} note={t("时长与升级策略已预留")} tone="warning" />
          <HorizonMetric Icon={Save} label={t("配置状态")} value={statusValue} note={canManageFlow ? t("保存后写入当前工作区") : t("当前账号没有编辑权限")} tone={dirty ? "warning" : "success"} />
        </HorizonMetricGrid>

        {loadError ? (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <div className="min-w-0">
              <p className="font-semibold text-amber-900">{t("审批流接口读取失败")}</p>
              <p className="mt-1 break-words text-pretty text-xs text-amber-800">{loadError} {flows.length > 0 ? t("当前本地缓存仅供参考，重新读取成功后方可编辑保存。") : null}</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void loadConfiguration()}><RefreshCw className="size-3.5" aria-hidden="true" />{t("重新读取")}</Button>
          </div>
        ) : null}

        {loading ? <ApprovalFlowLoading /> : !activeFlow ? (
          <section className="hz-surface min-w-0">
            <HorizonEmptyState
              Icon={GitBranch}
              title={t("暂无审批流配置")}
              description={t(usCollabWorkspace ? "当前协同工作区尚未配置审批流。创建默认草稿只会写入协同工作区。" : "当前研发工作区尚未配置审批流。可以从默认两级审批模板开始配置。")}
              action={canManageFlow ? <Button type="button" className="hz-primary-action" onClick={createDefaultDraft}><Plus className="size-4" aria-hidden="true" />{t("创建默认草稿")}</Button> : undefined}
            />
          </section>
        ) : (
          <>
            <section className="hz-surface min-w-0 overflow-hidden" aria-label={t("流程概览")}>
              <HorizonSectionHeader
                Icon={GitBranch}
                title={t(activeFlow.name)}
                description={t("确认流程范围、版本状态和审核池派生规则，再维护下方节点。")}
                trailing={activeFlow.is_default ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" aria-hidden="true" />{t("默认流程")}</span> : undefined}
              />
              <div className="grid min-w-0 gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
                <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div><dt className="text-xs text-slate-500">{t("适用范围")}</dt><dd className="mt-1 font-semibold text-slate-800">{activeFlow.scope === "project_proposal" ? t("立项审批") : t("任务流程")}</dd></div>
                  <div><dt className="text-xs text-slate-500">{t("节点数量")}</dt><dd className="mt-1 font-semibold text-slate-800 tabular-nums">{t("{n} 个节点", { n: activeFlow.nodes.length })}</dd></div>
                  <div><dt className="text-xs text-slate-500">{t("创建时间")}</dt><dd className="mt-1 text-slate-700 tabular-nums">{new Date(activeFlow.created_at).toLocaleDateString(i18nLocale())}</dd></div>
                  <div><dt className="text-xs text-slate-500">{t("最后修改")}</dt><dd className="mt-1 text-slate-700 tabular-nums">{new Date(activeFlow.updated_at).toLocaleDateString(i18nLocale())}</dd></div>
                </dl>
                {flows.length > 1 ? (
                  <div className="min-w-0">
                    <Label htmlFor="approval-active-flow" className="mb-1.5 block text-xs font-semibold text-slate-700">{t("当前流程")}</Label>
                    <NativeSelect id="approval-active-flow" value={activeFlowId} onChange={(event) => { setActiveFlowId(event.target.value); setNodeErrors({}); setSaveError(null); }} className="w-full" disabled={saving}>
                      {flows.map((flow) => <option key={flow.id} value={flow.id}>{t(flow.name)}</option>)}
                    </NativeSelect>
                    <p className="mt-1 text-pretty text-xs text-slate-500">{t("所有流程会作为一个配置集合统一保存。")}</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-pretty text-xs text-[#002fa7]"><Info className="mb-2 size-4" aria-hidden="true" />{t("审核池按角色权限自动派生；手动调整只影响当前节点，并随流程配置一并保存。")}</div>
                )}
              </div>
              {poolError ? <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-pretty text-xs text-amber-800" role="alert">{t("审核池成员读取失败：")}{poolError} {t("节点配置仍可编辑，但成员统计暂不完整。")}</div> : null}
            </section>

            <section className="hz-surface min-w-0 overflow-hidden" aria-label={t("审批节点编排")}>
              <HorizonSectionHeader Icon={GitBranch} title={t("审核节点配置")} description={t(!usCollabWorkspace && !isProductionWorkspace() ? "研发立项已直接生效，此处立项节点不再参与审核；成果验收和放弃任务仍需审核。" : "当前版本仅首节点参与真实授权与审核；其余节点作为后续多阶段流程的预留配置。可维护名称、权限、模式、SLA 与成员池。")} trailing={<span className="text-xs text-slate-500 tabular-nums">{activeFlow.nodes.length} {t("个节点")}</span>} />
              {saveError ? <p id="approval-flow-save-error" className="border-b border-red-200 bg-red-50 px-4 py-3 text-pretty text-sm text-red-700" role="alert">{saveError}</p> : null}
              <div className="min-w-0 p-3 sm:p-5">
                {activeFlow.nodes.length === 0 ? (
                  <HorizonEmptyState
                    Icon={GitBranch}
                    title={t("流程中还没有审批节点")}
                    description={t("添加首个审批节点，并配置对应权限和审核模式。")}
                    action={canManageFlow ? <Button ref={addNodeButtonRef} type="button" className="hz-primary-action" onClick={addNode}><Plus className="size-4" aria-hidden="true" />{t("添加首个节点")}</Button> : undefined}
                  />
                ) : (
                  <ol className="min-w-0" aria-label={t("审批节点顺序")}>
                    {activeFlow.nodes.map((node, index) => (
                      <li key={node.id} className="min-w-0">
                        <div className="mb-1 flex justify-end">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", index === 0 ? "border-blue-200 bg-blue-50 text-[#002fa7]" : "border-slate-200 bg-slate-50 text-slate-500")}>{index === 0 ? t("当前生效") : t("后续预留")}</span>
                        </div>
                        <ApprovalNodeCard
                          node={node}
                          isFirst={index === 0}
                          isLast={index === activeFlow.nodes.length - 1}
                          onChange={(patch) => updateNode(node.id, patch)}
                          onDelete={(trigger) => openDeleteDialog(node, trigger)}
                          onMoveUp={() => moveNode(node.id, "up")}
                          onMoveDown={() => moveNode(node.id, "down")}
                          pools={approvalPools}
                          candidates={candidates}
                          candidateLoading={candidateLoading}
                          candidateError={candidateError}
                          onRetryCandidates={() => void loadCandidates()}
                          errors={nodeErrors[node.id]}
                          registerField={(field, element) => { const key = `${node.id}:${field}`; if (element) fieldRefs.current.set(key, element); else fieldRefs.current.delete(key); }}
                          readOnly={!canManageFlow || saving || Boolean(loadError)}
                        />
                        {index < activeFlow.nodes.length - 1 ? <FlowConnector /> : null}
                      </li>
                    ))}
                  </ol>
                )}
                {activeFlow.nodes.length > 0 ? <><FlowConnector /><div className="flex min-w-0 items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50 px-4 py-3 text-center"><CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" /><span className="text-sm font-semibold text-emerald-700">{t("首节点通过 · 任务自动分配")}</span></div></> : null}
                {canManageFlow && activeFlow.nodes.length > 0 ? <Button ref={addNodeButtonRef} type="button" variant="outline" className="mt-4 w-full border-dashed" onClick={addNode} disabled={saving || Boolean(loadError)}><Plus className="size-4" aria-hidden="true" />{t("添加审批节点")}</Button> : null}
              </div>
            </section>

            <aside className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-pretty text-xs text-amber-800" aria-label={t("SLA 功能说明")}><span className="font-semibold">{t("SLA 与超时升级：")}</span>{t("字段已预留，本期不接入自动催办与升级；后端任务上线后将按“到期提醒 → 站内信催办 → 升级”执行。")}</aside>
          </>
        )}
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="horizon-portal" onCloseAutoFocus={restoreDialogFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">{t("恢复默认审批流？")}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">{t(usCollabWorkspace ? "这会丢弃当前协同工作区的全部流程配置，恢复为协同默认的两级或签流程，不影响研发工作区。" : "这会丢弃当前研发工作区的全部流程配置，恢复为研发默认的两级或签流程，不影响协同工作区。")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={saving}>{t("取消")}</AlertDialogCancel><AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => void reset()} disabled={saving}><RotateCcw className="size-4" aria-hidden="true" />{saving ? t("恢复中…") : t("恢复默认")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingDeleteNode)} onOpenChange={(open) => { if (!open) setPendingDeleteNode(null); }}>
        <AlertDialogContent className="horizon-portal" onCloseAutoFocus={restoreDialogFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">{t("删除审批节点？")}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">{t("节点“{name}”及其手动成员配置将从当前流程中移除。保存前可通过重新读取或恢复默认撤销整组修改。", { name: pendingDeleteNode?.label || t("未命名节点") })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => { if (pendingDeleteNode) deleteNode(pendingDeleteNode.id); setPendingDeleteNode(null); }}><Trash2 className="size-4" aria-hidden="true" />{t("删除节点")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export default RDApprovalFlowPage;
