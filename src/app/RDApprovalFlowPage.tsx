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
  fetchApprovalPoolsApi,
  fetchFlowsApi,
  getPoolForPermission,
  loadFlows,
  PoolMember,
  saveFlows,
} from "./lib/approvalFlowConfig";
import { AuditActor, AuditChange, recordAudit, useAuditActor } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";

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
  readOnly?: boolean;
}) {
  const pool = pools[node.permission_code] ?? getPoolForPermission(node.permission_code);
  const modeCfg = MODE_BADGE[node.mode];

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white shadow-[0_4px_14px_rgba(15,23,42,0.04)] transition-all hover:shadow-[0_8px_22px_rgba(15,23,42,0.06)]">
      {/* Level badge (left edge) */}
      <div className="absolute -left-3 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[11px] font-bold text-white shadow-[0_4px_10px_rgba(99,102,241,0.3)]">
        {node.level}
      </div>

      <div className="px-5 py-4">
        {/* Header row */}
        <div className="mb-3 flex items-center gap-3">
          <Input
            value={node.label}
            onChange={(e) => onChange({ label: e.target.value })}
            readOnly={readOnly}
            placeholder="节点名称"
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
            {modeCfg.label}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={readOnly || isFirst}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              title="上移"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={readOnly || isLast}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              title="下移"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={readOnly}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
              title="删除节点"
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
          placeholder="节点说明（可选）"
          className="mb-3 w-full rounded border border-slate-100 bg-slate-50/40 px-3 py-1.5 text-xs text-slate-600 outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />

        {/* Config grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Permission */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              关联权限
            </label>
            <NativeSelect
              value={node.permission_code}
              onChange={(e) => onChange({ permission_code: e.target.value })}
              disabled={readOnly}
              className="w-full cursor-pointer rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              {APPROVAL_PERMISSION_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </NativeSelect>
            <p className="mt-1 text-[10px] text-slate-400">
              拥有此权限的所有用户自动入审核池
            </p>
          </div>

          {/* Mode */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              审核模式
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
                  title={opt.helper}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              {APPROVAL_MODE_OPTIONS.find((o) => o.value === node.mode)?.helper}
            </p>
          </div>

          {/* SLA */}
          <div>
            <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <Clock className="h-3 w-3" />
              SLA 时长（小时）
            </label>
            <Input
              type="number"
              min={1}
              value={node.sla_hours ?? ""}
              onChange={(e) =>
                onChange({ sla_hours: e.target.value ? Number(e.target.value) : undefined })
              }
              readOnly={readOnly}
              placeholder="例：48"
              className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-[10px] text-amber-600">
              已预留，本期不触发自动催办
            </p>
          </div>

          {/* Escalate */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              超时升级
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
              {node.escalate_on_timeout ? "超时自动升级" : "超时不升级"}
            </button>
          </div>
        </div>

        {/* Pool preview */}
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
              <Users className="h-3 w-3" />
              当前审核池
              <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700">
                {pool.length}
              </span>
            </span>
            <span className="text-[10px] text-slate-400">由「角色权限」页面分配</span>
          </div>
          {pool.length === 0 ? (
            <p className="text-[11px] italic text-slate-400">
              暂无拥有此权限的用户，请到「角色权限」页面给某角色分配该权限
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pool.map((m) => (
                <PoolMemberChip key={m.id} member={m} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PoolMemberChip({ member }: { member: PoolMember }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 transition-colors hover:bg-slate-50">
      <MiniAvatar name={member.name} />
      <span className="font-medium">{member.name}</span>
      <span className="text-[10px] text-slate-400">{member.position}</span>
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

function nodeSummary(node: ApprovalNode): string {
  return `${node.level}.${node.label}(${node.permission_code}/${node.mode})`;
}

function nodeEditChanges(before: ApprovalNode, after: ApprovalNode): AuditChange[] {
  const changes: AuditChange[] = [];
  (["level", "label", "permission_code", "mode", "description", "sla_hours", "escalate_on_timeout"] as const).forEach((field) => {
    if (before[field] !== after[field]) {
      changes.push({ field, before: before[field], after: after[field] });
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
  const flowAuditActor = useAuditActor("研发管理员");
  const [flows, setFlowsState] = useState<ApprovalFlow[]>([]);
  const [savedFlows, setSavedFlows] = useState<ApprovalFlow[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvalPools, setApprovalPools] = useState<Record<string, PoolMember[]>>({});
  const canManageFlow = usePermission(PERMISSIONS.RD_APPROVAL_FLOW_MANAGE);

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
        setLoadError(error instanceof Error ? error.message : "审批流接口加载失败");
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
          正在从后端加载审批流配置…
        </div>
      </div>
    );
  }

  const createDefaultDraft = () => {
    if (!canManageFlow) {
      toast.error("当前账号没有管理审批流权限");
      return;
    }
    const now = new Date().toISOString();
    const draft = { ...DEFAULT_PROJECT_FLOW, created_at: now, updated_at: now };
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
          <h1 className="mt-4 text-lg font-semibold text-slate-950">暂无审批流配置</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            后端当前没有任何研发审批流数据。可以从空白状态开始配置，或创建一份默认草稿后再保存到后端。
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
              创建默认草稿
            </button>
          ) : (
            <span className="mt-5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
              只读账号无权创建审批流
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
      toast.error("当前账号没有管理审批流权限");
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
                  label: `审核节点 ${f.nodes.length + 1}`,
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
      toast.error("当前账号没有管理审批流权限");
      return;
    }
    const previousFlow = savedFlows.find((f) => f.id === activeFlow.id);
    recordFlowSaveAudit(previousFlow, activeFlow, flowAuditActor);
    saveFlows(flows);
    setSavedFlows(flows);
    setDirty(false);
    toast.success("审批流配置已保存", {
      description: `${activeFlow.name} · ${activeFlow.nodes.length} 个节点`,
    });
  };

  const reset = () => {
    if (!canManageFlow) {
      toast.error("当前账号没有管理审批流权限");
      return;
    }
    const previousFlow = activeFlow;
    recordAudit({
      actor: flowAuditActor,
      action: "flow.reset",
      resource: { type: "flow", id: DEFAULT_PROJECT_FLOW.id, name: DEFAULT_PROJECT_FLOW.name },
      changes: [{ field: "node_count", before: previousFlow.nodes.length, after: DEFAULT_PROJECT_FLOW.nodes.length }],
      comment: "恢复系统默认审批流",
      source: "web",
    });
    setFlowsState([DEFAULT_PROJECT_FLOW]);
    setSavedFlows([DEFAULT_PROJECT_FLOW]);
    setActiveFlowId(DEFAULT_PROJECT_FLOW.id);
    saveFlows([DEFAULT_PROJECT_FLOW]);
    setConfirmReset(false);
    setDirty(false);
    toast.info("已恢复默认审批流");
  };

  return (
    <div className="min-h-full bg-slate-50/40 px-6 py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Header */}
        <header className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-[0_8px_18px_rgba(99,102,241,0.25)]">
                <GitBranch className="h-4 w-4" />
              </span>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                审批流配置
              </h1>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">
              配置「立项 / 任务封存 / 转派」等流程的审核节点 ·
              池成员由「角色权限」页分配
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
                  恢复默认
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.2)] transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-900"
                >
                  <Save className="h-3.5 w-3.5" />
                  {dirty ? "保存配置" : "已保存"}
                </button>
              </>
            ) : (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                只读
              </span>
            )}
          </div>
        </header>

        {/* Flow selector */}
        <section className="rounded-xl border border-slate-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{activeFlow.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                适用范围：
                {activeFlow.scope === "project_proposal" ? "立项审批" : "任务流程"} ·
                共 {activeFlow.nodes.length} 个节点 ·
                最后修改 {new Date(activeFlow.updated_at).toLocaleDateString("zh-CN")}
              </p>
            </div>
            {activeFlow.is_default && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                默认流程
              </span>
            )}
          </div>

          {/* Info banner */}
          <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-[11px] text-blue-700">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              <span className="font-semibold">如何添加审核人？</span> 在「角色权限」页面，给某角色勾选对应权限码（如
              <code className="mx-1 rounded bg-white px-1 font-mono">rd-project:review-l1</code>），所有拥有该角色的用户会自动加入对应节点的审核池。
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
            <span className="text-sm font-semibold text-emerald-700">通过 · 任务自动分配</span>
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
              添加审核节点
            </button>
          </div>
          )}
        </section>

        {/* Footer tip */}
        <footer className="rounded-lg border border-amber-100 bg-amber-50/40 px-4 py-3 text-[11px] text-amber-700">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
            <div>
              <div className="font-semibold">关于 SLA 与超时升级</div>
              <p className="mt-0.5 leading-relaxed">
                字段已预留，本期不接入自动催办与升级。后端就绪后将开放定时任务：
                <span className="font-mono">SLA 到期 → 站内信催办 → 升级到下一级</span>。
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
              <h3 className="text-base font-semibold text-slate-900">恢复默认审批流？</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                这将丢弃当前所有配置，恢复为系统默认的「一审 → 终审」两级或签流程。
              </p>
            </div>
            <footer className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-6 py-3">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(217,119,6,0.25)] transition-all hover:bg-amber-700 active:scale-[0.98]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                恢复默认
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

export default RDApprovalFlowPage;
