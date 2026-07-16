import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Info,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
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
import { AuditActor, AuditChange, recordAudit, useAuditActor } from "./lib/auditLog";
import { i18nLocale, t, useI18n } from "./lib/i18n";
import { PERMISSIONS } from "./lib/permissions";
import { isUsCollabWorkspace } from "./lib/rdApi";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-pink-500", "bg-cyan-500", "bg-indigo-500", "bg-rose-500", "bg-teal-500",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function MiniAvatar({ name }: { name: string }) {
  const initial = name.trim().slice(0, 1) || "?";
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white",
        hashColor(name),
      )}
      title={name}
    >
      {initial}
    </span>
  );
}

const MODE_BADGE: Record<ApprovalMode, { label: string; bg: string; text: string; icon: string }> = {
  single: { label: "单人", bg: "bg-slate-100", text: "text-slate-700", icon: "👤" },
  any: { label: "或签", bg: "bg-blue-50", text: "text-blue-700", icon: "👥" },
  all: { label: "会签", bg: "bg-violet-50", text: "text-violet-700", icon: "✦" },
};

// ─── Node Card ───────────────────────────────────────────────────────────────

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
  readOnly,
}: {
  node: ApprovalNode;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<ApprovalNode>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pools: Record<string, PoolMember[]>;
  /** 「添加审核人」候选（本工作区有审批能力的人；只读账号拿不到，传空数组） */
  candidates: PoolMember[];
  readOnly?: boolean;
}) {
  useI18n(); // 订阅语言切换（本卡片文案全部经 t()）
  const derived = pools[node.permission_code] ?? getPoolForPermission(node.permission_code);
  const excludedIds = new Set(node.excluded_member_ids ?? []);
  const removedMembers = derived.filter((m) => excludedIds.has(m.id));
  const pool = effectiveNodePool(node, derived);
  const extraIds = new Set((node.extra_members ?? []).map((m) => m.id));
  const [addOpen, setAddOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const poolIds = new Set(pool.map((m) => m.id));
  const keyword = candidateSearch.trim();
  const addableCandidates = candidates.filter(
    (c) => !poolIds.has(c.id) && (!keyword || c.name.includes(keyword) || (c.position ?? "").includes(keyword)),
  );

  /**
   * 不变式：extra_members 与 excluded_member_ids **恒不相交**。
   * 二者都能装同一个人时会自相矛盾——芯片区（走 effectiveNodePool，extras 兜住）显示在池里，
   * 「已移出」区（只看 excluded）同时显示删除线，且 ✕ 按钮按 extraIds 分发，点一次只清掉
   * extras、人还在派生池里 → 表现为「移除按钮失灵、要点两次」。故每次写入都把另一侧同 id 清掉。
   */
  const excludeMember = (id: string) =>
    onChange({
      excluded_member_ids: [...new Set([...(node.excluded_member_ids ?? []), id])],
      extra_members: (node.extra_members ?? []).filter((m) => m.id !== id),
    });
  const restoreMember = (id: string) =>
    onChange({
      excluded_member_ids: (node.excluded_member_ids ?? []).filter((x) => x !== id),
      extra_members: (node.extra_members ?? []).filter((m) => m.id !== id),
    });
  const removeExtra = (id: string) =>
    onChange({ extra_members: (node.extra_members ?? []).filter((m) => m.id !== id) });
  const addExtra = (c: PoolMember) => {
    onChange({
      // 派生池里被移出过的人重新添加：清掉 excluded 让他回归派生成员，而不是再塞一份 extras
      excluded_member_ids: (node.excluded_member_ids ?? []).filter((x) => x !== c.id),
      extra_members: derived.some((m) => m.id === c.id)
        ? (node.extra_members ?? []).filter((m) => m.id !== c.id)
        : [...(node.extra_members ?? []).filter((m) => m.id !== c.id), { id: c.id, name: c.name, position: c.position, email: c.email }],
    });
    setAddOpen(false);
    setCandidateSearch("");
  };

  const modeCfg = MODE_BADGE[node.mode];

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white shadow-[0_4px_14px_rgba(15,23,42,0.04)] transition-all hover:shadow-[0_8px_22px_rgba(15,23,42,0.06)]">
      {/* Level badge (left edge) */}
      <div className="absolute -left-3 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white shadow-[0_4px_10px_rgba(79,70,229,0.3)]">
        {node.level}
      </div>

      <div className="px-5 py-4">
        {/* Header row */}
        <div className="mb-3 flex items-center gap-3">
          <Input
            value={node.label}
            onChange={(e) => onChange({ label: e.target.value })}
            readOnly={readOnly}
            placeholder={t("节点名称")}
            className={cn(
              "flex-1 rounded border-0 bg-transparent text-base font-semibold text-slate-900 outline-none focus:bg-slate-50 focus:px-2 focus:py-1",
              readOnly && "cursor-default text-slate-700 focus:bg-transparent focus:px-0 focus:py-0",
            )}
          />
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              modeCfg.bg,
              modeCfg.text,
            )}
          >
            {t(modeCfg.label)}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={readOnly || isFirst}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              title={t("上移")}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={readOnly || isLast}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              title={t("下移")}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={readOnly}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
              title={t("删除节点")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Description */}
        <Input
          value={node.description ?? ""}
          onChange={(e) => onChange({ description: e.target.value })}
          readOnly={readOnly}
          placeholder={t("节点说明（可选）")}
          className="mb-3 w-full rounded border border-slate-100 bg-slate-50/40 px-3 py-1.5 text-xs text-slate-600 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />

        {/* Config grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Permission */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("关联权限")}
            </label>
            <NativeSelect
              value={node.permission_code}
              onChange={(e) => onChange({ permission_code: e.target.value })}
              disabled={readOnly}
              className="w-full cursor-pointer rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              {APPROVAL_PERMISSION_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {t(opt.label)}
                </option>
              ))}
            </NativeSelect>
            <p className="mt-1 text-[10px] text-slate-400">
              {t("拥有此权限的所有用户自动入审核池")}
            </p>
          </div>

          {/* Mode */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("审核模式")}
            </label>
            <div className="flex gap-1 rounded border border-slate-200 bg-slate-50 p-0.5">
              {APPROVAL_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ mode: opt.value })}
                  disabled={readOnly}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-xs font-medium transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60",
                    node.mode === opt.value
                      ? "bg-white text-slate-900 shadow-[0_2px_6px_rgba(15,23,42,0.08)]"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                  title={t(opt.helper)}
                >
                  {t(opt.label)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              {t(APPROVAL_MODE_OPTIONS.find((o) => o.value === node.mode)?.helper ?? "")}
            </p>
          </div>

          {/* SLA */}
          <div>
            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Clock className="h-3 w-3" />
              {t("SLA 时长（小时）")}
            </label>
            <Input
              type="number"
              min={1}
              value={node.sla_hours ?? ""}
              onChange={(e) =>
                onChange({ sla_hours: e.target.value ? Number(e.target.value) : undefined })
              }
              readOnly={readOnly}
              placeholder={t("例：48")}
              className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-[10px] text-amber-600">
              {t("已预留，本期不触发自动催办")}
            </p>
          </div>

          {/* Escalate */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("超时升级")}
            </label>
            <button
              type="button"
              onClick={() => onChange({ escalate_on_timeout: !node.escalate_on_timeout })}
              disabled={readOnly}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded border px-2.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-70",
                node.escalate_on_timeout
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500",
              )}
            >
              <span
                className={cn(
                  "relative h-4 w-7 rounded-full transition-colors",
                  node.escalate_on_timeout ? "bg-emerald-500" : "bg-slate-300",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all",
                    node.escalate_on_timeout ? "left-3.5" : "left-0.5",
                  )}
                />
              </span>
              {node.escalate_on_timeout ? t("超时自动升级") : t("超时不升级")}
            </button>
          </div>
        </div>

        {/* 审核池：权限码派生打底，支持手动增删（存进节点数据，随流程保存，两池各存各的） */}
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
              <Users className="h-3 w-3" />
              {t("当前审核池")}
              <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700">
                {pool.length}
              </span>
            </span>
            <span className="text-[10px] text-slate-400">{t("默认按「角色权限」自动入池，可在此手动增删")}</span>
          </div>
          {pool.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">
              {t("池为空：到「角色权限」给角色分配该权限码，或点下方「添加审核人」手动指定")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pool.map((m) => (
                <PoolMemberChip
                  key={m.id}
                  member={m}
                  manual={extraIds.has(m.id)}
                  onRemove={
                    readOnly ? undefined : () => (extraIds.has(m.id) ? removeExtra(m.id) : excludeMember(m.id))
                  }
                  removeTitle={t("移出此节点")}
                />
              ))}
            </div>
          )}

          {removedMembers.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-slate-200 pt-2">
              <span className="text-[10px] text-slate-400">{t("已移出 {n} 人：", { n: removedMembers.length })}</span>
              {removedMembers.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400 line-through">
                  {m.name}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => restoreMember(m.id)}
                      className="cursor-pointer text-[10px] font-semibold text-indigo-600 no-underline hover:text-indigo-800"
                      style={{ textDecoration: "none" }}
                    >
                      {t("恢复")}
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {!readOnly && (
            <div className="mt-2">
              {addOpen ? (
                <div className="rounded-md border border-indigo-100 bg-white p-2 shadow-sm">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Input
                      autoFocus
                      value={candidateSearch}
                      onChange={(e) => setCandidateSearch(e.target.value)}
                      placeholder={t("搜索姓名或角色…")}
                      className="h-7 flex-1 rounded border border-slate-200 px-2 text-xs outline-none focus:border-indigo-300"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setAddOpen(false);
                        setCandidateSearch("");
                      }}
                      className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {addableCandidates.length === 0 ? (
                    <p className="px-1 py-1.5 text-[11px] text-slate-400">
                      {t("没有可添加的人了。候选范围＝本工作区有审批权限的成员（保证加进来就能审）。")}
                    </p>
                  ) : (
                    <div className="max-h-36 space-y-0.5 overflow-y-auto">
                      {addableCandidates.slice(0, 20).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => addExtra(c)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-slate-700 transition-colors hover:bg-indigo-50"
                        >
                          <MiniAvatar name={c.name} />
                          <span className="font-medium">{c.name}</span>
                          <span className="text-[10px] text-slate-400">{t(c.position)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-700"
                >
                  <Plus className="h-3 w-3" />
                  {t("添加审核人")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PoolMemberChip({
  member,
  manual,
  onRemove,
  removeTitle,
}: {
  member: PoolMember;
  /** 手动增补的成员，样式与派生成员区分 */
  manual?: boolean;
  onRemove?: () => void;
  removeTitle?: string;
}) {
  return (
    <span
      className={cn(
        "group/chip inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-slate-700 transition-colors",
        manual ? "border-indigo-200 bg-indigo-50/70" : "border-slate-200 bg-white hover:bg-slate-50",
      )}
    >
      <MiniAvatar name={member.name} />
      <span className="font-medium">{member.name}</span>
      {member.position ? <span className="text-[10px] text-slate-400">{t(member.position)}</span> : null}
      {manual ? (
        <span className="rounded bg-indigo-100 px-1 text-[9px] font-semibold leading-4 text-indigo-700">{t("手动")}</span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          title={removeTitle}
          className="ml-0.5 hidden h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600 group-hover/chip:inline-flex"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </span>
  );
}

// ─── Connector arrow between nodes ───────────────────────────────────────────

function FlowConnector() {
  return (
    <div className="flex items-center justify-center py-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <ArrowDown className="h-3 w-3" />
      </div>
    </div>
  );
}

/**
 * 默认流程模板：协同池用自己的名字，与研发的默认流程在视觉上区分开。
 * 节点结构相同是有意的起点——保存后两池各存各的（rdws.* 键隔离），可独立增删改。
 */
function defaultFlowTemplate(): ApprovalFlow {
  return isUsCollabWorkspace()
    ? { ...DEFAULT_PROJECT_FLOW, name: "协同立项审批 · 默认流程" }
    : DEFAULT_PROJECT_FLOW;
}

function nodeSummary(node: ApprovalNode): string {
  return `${node.level}.${node.label}(${node.permission_code}/${node.mode})`;
}

function nodeEditChanges(before: ApprovalNode, after: ApprovalNode): AuditChange[] {
  const changes: AuditChange[] = [];
  (
    [
      "level",
      "label",
      "permission_code",
      "mode",
      "description",
      "sla_hours",
      "escalate_on_timeout",
      "extra_members",
      "excluded_member_ids",
    ] as const
  ).forEach((field) => {
    const b = before[field];
    const a = after[field];
    // 数组字段（手动增删名单）按内容比较——引用比较会把「没改」也记成变更
    const changed =
      Array.isArray(b) || Array.isArray(a) ? JSON.stringify(b ?? []) !== JSON.stringify(a ?? []) : b !== a;
    if (changed) {
      changes.push({ field, before: b, after: a });
    }
  });
  return changes;
}

function recordFlowSaveAudit(previous: ApprovalFlow | undefined, next: ApprovalFlow, actor: AuditActor) {
  const resource = { type: "flow" as const, id: next.id, name: next.name };
  const previousNodes = new Map(previous?.nodes.map((node) => [node.id, node]) ?? []);
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));

  next.nodes.forEach((node) => {
    if (!previousNodes.has(node.id)) {
      recordAudit({
        actor,
        action: "flow.node_added",
        resource,
        comment: `新增审批节点：${node.label}`,
        metadata: { node: nodeSummary(node) },
        source: "web",
      });
    }
  });

  previousNodes.forEach((node, nodeId) => {
    if (!nextNodes.has(nodeId)) {
      recordAudit({
        actor,
        action: "flow.node_removed",
        resource,
        comment: `删除审批节点：${node.label}`,
        metadata: { node: nodeSummary(node) },
        source: "web",
      });
    }
  });

  next.nodes.forEach((node) => {
    const before = previousNodes.get(node.id);
    if (!before) return;
    const changes = nodeEditChanges(before, node);
    if (changes.length === 0) return;
    recordAudit({
      actor,
      action: changes.some((change) => change.field === "mode") ? "flow.mode_changed" : "flow.node_edited",
      resource,
      changes,
      comment: `修改审批节点：${node.label}`,
      source: "web",
    });
  });

  recordAudit({
    actor,
    action: "flow.saved",
    resource,
    changes: previous
      ? [{ field: "node_count", before: previous.nodes.length, after: next.nodes.length }]
      : [{ field: "node_count", before: 0, after: next.nodes.length }],
    comment: "保存审批流配置",
    source: "web",
  });
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function RDApprovalFlowPage() {
  useI18n(); // 订阅语言切换：本页文案全部经 t()
  const flowAuditActor = useAuditActor("研发管理员");
  const [flows, setFlowsState] = useState<ApprovalFlow[]>([]);
  const [savedFlows, setSavedFlows] = useState<ApprovalFlow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvalPools, setApprovalPools] = useState<Record<string, PoolMember[]>>({});
  const [candidates, setCandidates] = useState<PoolMember[]>([]);
  const canManageFlow = usePermission(PERMISSIONS.RD_APPROVAL_FLOW_MANAGE);

  // 「添加审核人」候选：仅管理员需要（端点也只对 rd-approval-flow:manage 开放）
  useEffect(() => {
    if (!canManageFlow) return;
    let cancelled = false;
    fetchApprovalCandidatesApi()
      .then((list) => {
        if (!cancelled) setCandidates(list);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canManageFlow]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const loaded = await fetchFlowsApi();
        if (cancelled) return;
        setFlowsState(loaded);
        setSavedFlows(loaded);
        setActiveFlowId(loaded[0]?.id ?? "");
      } catch (error) {
        if (cancelled) return;
        const fallback = loadFlows();
        setFlowsState(fallback);
        setSavedFlows(fallback);
        setActiveFlowId(fallback[0]?.id ?? "");
        setLoadError(error instanceof Error ? error.message : t("审批流接口加载失败"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const permissionCodes = Array.from(
      new Set(flows.flatMap((flow) => flow.nodes.map((node) => node.permission_code))),
    );
    if (permissionCodes.length === 0) {
      setApprovalPools({});
      return;
    }
    let cancelled = false;
    fetchApprovalPoolsApi(permissionCodes)
      .then((pools) => {
        if (!cancelled) setApprovalPools(pools);
      })
      .catch(() => {
        if (!cancelled) setApprovalPools({});
      });
    return () => {
      cancelled = true;
    };
  }, [flows]);

  const activeFlow = useMemo(
    () => flows.find((f) => f.id === activeFlowId),
    [flows, activeFlowId],
  );

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50/40 px-6 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-100 bg-white px-6 py-10 text-sm text-slate-500 shadow-[0_18px_45px_rgba(15,23,42,0.05)]">
          {t("正在从后端加载审批流配置…")}
        </div>
      </div>
    );
  }

  const createDefaultDraft = () => {
    if (!canManageFlow) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    const now = new Date().toISOString();
    const draft = { ...defaultFlowTemplate(), created_at: now, updated_at: now };
    setFlowsState([draft]);
    setSavedFlows([]);
    setActiveFlowId(draft.id);
    setDirty(true);
    setLoadError(null);
  };

  if (!activeFlow) {
    return (
      <div className="min-h-full bg-slate-50/40 px-6 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-[0_18px_45px_rgba(15,23,42,0.04)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900 text-white">
            <GitBranch className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-slate-950">{t("暂无审批流配置")}</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            {t("后端当前没有任何研发审批流数据。可以从空白状态开始配置，或创建一份默认草稿后再保存到后端。")}
          </p>
          {loadError && (
            <p className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {loadError}
            </p>
          )}
          {canManageFlow ? (
            <button
              type="button"
              onClick={createDefaultDraft}
              className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)] transition-all hover:bg-slate-800 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              {t("创建默认草稿")}
            </button>
          ) : (
            <span className="mt-5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
              {t("只读账号无权创建审批流")}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Update a single node
  const updateNode = (nodeId: string, patch: Partial<ApprovalNode>) => {
    if (!canManageFlow) return;
    setFlowsState((prev) =>
      prev.map((f) =>
        f.id === activeFlowId
          ? {
              ...f,
              nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
              updated_at: new Date().toISOString(),
            }
          : f,
      ),
    );
    setDirty(true);
  };

  const deleteNode = (nodeId: string) => {
    if (!canManageFlow) return;
    setFlowsState((prev) =>
      prev.map((f) =>
        f.id === activeFlowId
          ? {
              ...f,
              nodes: f.nodes
                .filter((n) => n.id !== nodeId)
                .map((n, idx) => ({ ...n, level: idx + 1 })),
            }
          : f,
      ),
    );
    setDirty(true);
  };

  const moveNode = (nodeId: string, direction: "up" | "down") => {
    if (!canManageFlow) return;
    setFlowsState((prev) =>
      prev.map((f) => {
        if (f.id !== activeFlowId) return f;
        const idx = f.nodes.findIndex((n) => n.id === nodeId);
        if (idx < 0) return f;
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= f.nodes.length) return f;
        const newNodes = [...f.nodes];
        [newNodes[idx], newNodes[targetIdx]] = [newNodes[targetIdx], newNodes[idx]];
        return {
          ...f,
          nodes: newNodes.map((n, i) => ({ ...n, level: i + 1 })),
        };
      }),
    );
    setDirty(true);
  };

  const addNode = () => {
    if (!canManageFlow) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    setFlowsState((prev) =>
      prev.map((f) =>
        f.id === activeFlowId
          ? {
              ...f,
              nodes: [
                ...f.nodes,
                {
                  id: `node-${Date.now()}`,
                  level: f.nodes.length + 1,
                  // 新节点默认名随创建者语言（节点名是用户数据，创建后可改）
                  label: t("审核节点 {n}", { n: f.nodes.length + 1 }),
                  permission_code: APPROVAL_PERMISSION_OPTIONS[0].code,
                  mode: "any",
                  description: "",
                  sla_hours: 48,
                  escalate_on_timeout: false,
                },
              ],
            }
          : f,
      ),
    );
    setDirty(true);
  };

  const save = () => {
    if (!canManageFlow) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    const previousFlow = savedFlows.find((f) => f.id === activeFlow.id);
    recordFlowSaveAudit(previousFlow, activeFlow, flowAuditActor);
    saveFlows(flows);
    setSavedFlows(flows);
    setDirty(false);
    toast.success(t("审批流配置已保存"), {
      description: `${t(activeFlow.name)} · ${t("{n} 个节点", { n: activeFlow.nodes.length })}`,
    });
  };

  const reset = () => {
    if (!canManageFlow) {
      toast.error(t("当前账号没有管理审批流权限"));
      return;
    }
    const previousFlow = activeFlow;
    const template = defaultFlowTemplate();
    recordAudit({
      actor: flowAuditActor,
      action: "flow.reset",
      resource: { type: "flow", id: template.id, name: template.name },
      changes: [{ field: "node_count", before: previousFlow.nodes.length, after: template.nodes.length }],
      comment: "恢复系统默认审批流",
      source: "web",
    });
    setFlowsState([template]);
    setSavedFlows([template]);
    setActiveFlowId(template.id);
    saveFlows([template]);
    setConfirmReset(false);
    setDirty(false);
    toast.info(t("已恢复默认审批流"));
  };

  return (
    <div className="min-h-full bg-slate-50/40 px-6 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Header */}
        <header className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-[0_8px_18px_rgba(79,70,229,0.25)]">
                <GitBranch className="h-4 w-4" />
              </span>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                {t(isUsCollabWorkspace() ? "协同审批流配置" : "审批流配置")}
              </h1>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">
              {t("配置「立项 / 任务封存 / 转派」等流程的审核节点 · 池成员由「角色权限」页分配")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManageFlow ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 active:scale-[0.98]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("恢复默认")}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.2)] transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-900"
                >
                  <Save className="h-3.5 w-3.5" />
                  {dirty ? t("保存配置") : t("已保存")}
                </button>
              </>
            ) : (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                {t("只读")}
              </span>
            )}
          </div>
        </header>

        {/* Flow selector */}
        <section className="rounded-xl border border-slate-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{t(activeFlow.name)}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {t("适用范围：")}
                {activeFlow.scope === "project_proposal" ? t("立项审批") : t("任务流程")} ·
                {t("共 {n} 个节点", { n: activeFlow.nodes.length })} ·
                {t("最后修改")} {new Date(activeFlow.updated_at).toLocaleDateString(i18nLocale())}
              </p>
            </div>
            {activeFlow.is_default && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                {t("默认流程")}
              </span>
            )}
          </div>

          {/* Info banner */}
          <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-[11px] text-blue-700">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              <span className="font-semibold">{t("如何添加审核人？")}</span> {t("在「角色权限」页面，给某角色勾选对应权限码（如")}
              <code className="mx-1 rounded bg-white px-1 font-mono">rd-project:review-l1</code>{t("），所有拥有该角色的用户会自动加入对应节点的审核池。")}
            </span>
          </div>
        </section>

        {/* Nodes */}
        <section className="space-y-1">
          {activeFlow.nodes.map((node, idx) => (
            <React.Fragment key={node.id}>
              <div className="ml-3">
                <ApprovalNodeCard
                  node={node}
                  isFirst={idx === 0}
                  isLast={idx === activeFlow.nodes.length - 1}
                  onChange={(patch) => updateNode(node.id, patch)}
                  onDelete={() => deleteNode(node.id)}
                  onMoveUp={() => moveNode(node.id, "up")}
                  onMoveDown={() => moveNode(node.id, "down")}
                  pools={approvalPools}
                  candidates={candidates}
                  readOnly={!canManageFlow}
                />
              </div>
              {idx < activeFlow.nodes.length - 1 && <FlowConnector />}
            </React.Fragment>
          ))}

          {/* Terminal node */}
          <div className="flex items-center justify-center py-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <ArrowDown className="h-3 w-3" />
            </div>
          </div>
          <div className="ml-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-700">{t("通过 · 任务自动分配")}</span>
          </div>

          {/* Add node button */}
          {canManageFlow && (
            <div className="pt-3">
            <button
              type="button"
              onClick={addNode}
              className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-transparent px-4 py-3 text-sm font-medium text-slate-500 transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/30 hover:text-blue-600"
            >
              <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
              {t("添加审核节点")}
            </button>
          </div>
          )}
        </section>

        {/* Footer tip */}
        <footer className="rounded-lg border border-amber-100 bg-amber-50/40 px-4 py-3 text-[11px] text-amber-700">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
            <div>
              <div className="font-semibold">{t("关于 SLA 与超时升级")}</div>
              <p className="mt-0.5 leading-relaxed">
                {t("字段已预留，本期不接入自动催办与升级。后端就绪后将开放定时任务：")}
                <span className="font-mono">{t("SLA 到期 → 站内信催办 → 升级到下一级")}</span>。
              </p>
            </div>
          </div>
        </footer>
      </div>

      {/* Reset confirm dialog */}
      {canManageFlow && confirmReset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
          >
            <div className="px-6 pt-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">{t("恢复默认审批流？")}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                {t("这将丢弃当前所有配置，恢复为系统默认的「一审 → 终审」两级或签流程。")}
              </p>
            </div>
            <footer className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
              >
                {t("取消")}
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(217,119,6,0.25)] transition-all hover:bg-amber-700 active:scale-[0.98]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("恢复默认")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

export default RDApprovalFlowPage;
