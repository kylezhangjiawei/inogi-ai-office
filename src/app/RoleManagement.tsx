import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Crown,
  FileText,
  MousePointerClick,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { authFetch } from "./lib/authSession";
import { cn } from "./components/ui/utils";
import { PermissionGuard } from "./components/PermissionGuard";
import {
  type PermissionCatalogGroup,
  type PermissionCatalogPermission,
  permissionCatalogApi,
} from "./lib/permissionCatalogApi";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";
import { Checkbox } from "./components/ui/checkbox";
import { Progress } from "./components/ui/progress";
import { Separator } from "./components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  _count?: { users: number };
  createdAt: string;
  updatedAt: string;
};

type RoleFormData = {
  id?: string;
  name: string;
  description: string;
  permissions: string[];
};

const EMPTY_FORM: RoleFormData = { name: "", description: "", permissions: [] };

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiListRoles(): Promise<Role[]> {
  const res = await authFetch("/api/roles");
  if (!res.ok) throw new Error("获取角色列表失败");
  return res.json() as Promise<Role[]>;
}

async function apiSaveRole(payload: RoleFormData): Promise<Role> {
  const res = await authFetch("/api/roles", {
    method: "POST",
    body: JSON.stringify({
      id: payload.id,
      name: payload.name,
      description: payload.description || undefined,
      permissions: payload.permissions,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(err.message) ? err.message.join(", ") : (err.message ?? "保存失败");
    throw new Error(msg);
  }
  return res.json() as Promise<Role>;
}

async function apiDeleteRole(id: string): Promise<void> {
  const res = await authFetch(`/api/roles/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "删除失败");
  }
}

// ─── Permission Matrix ────────────────────────────────────────────────────────

/** 从组标签（"页面访问 · 研发任务管理" / "操作权限 · 研发任务管理"）取模块名（· 之后的部分）。 */
function moduleOf(label: string): string {
  const idx = label.indexOf("·");
  return (idx >= 0 ? label.slice(idx + 1) : label).trim();
}

type PermissionPageNode = {
  page: PermissionCatalogPermission;
  actions: PermissionCatalogPermission[];
};

type PermissionModuleNode = {
  name: string;
  pages: PermissionPageNode[];
  sharedActions: PermissionCatalogPermission[];
};

type DisplayPermissionGroup = PermissionCatalogGroup & {
  key: string;
  kind: "page" | "shared";
  routePath?: string;
};

type CatalogAction = {
  groupName: string;
  permission: PermissionCatalogPermission;
};

const CODE_TOKEN_ALIASES: Record<string, string> = {
  departments: "department",
  materials: "material",
  roles: "role",
  users: "user",
};

const CODE_TOKEN_NOISE = new Set([
  "center",
  "cockpit",
  "dashboard",
  "management",
  "manage",
  "page",
  "settings",
  "workspace",
]);

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[\s·/()（）_-]+/g, "");
}

function permissionCodeTokens(code: string) {
  const namespace = code.replace(/^page:/, "").split(":", 1)[0];
  return namespace
    .split("-")
    .map((token) => CODE_TOKEN_ALIASES[token] ?? token)
    .filter((token) => token && !CODE_TOKEN_NOISE.has(token));
}

function actionPageScore(action: CatalogAction, page: PermissionCatalogPermission) {
  const actionTokens = permissionCodeTokens(action.permission.code);
  const pageTokens = new Set(permissionCodeTokens(page.code));
  const matchedTokens = actionTokens.filter((token) => pageTokens.has(token)).length;
  const codeScore = actionTokens.length > 0 ? (matchedTokens / actionTokens.length) * 200 : 0;

  const groupLabel = normalizeLabel(action.groupName);
  const pageLabel = normalizeLabel(page.label);
  const labelScore =
    groupLabel === pageLabel
      ? 140
      : groupLabel.length >= 2 && pageLabel.length >= 2 &&
          (groupLabel.includes(pageLabel) || pageLabel.includes(groupLabel))
        ? 80
        : 0;

  return codeScore + labelScore;
}

function uniqueCodes(permissions: PermissionCatalogPermission[]) {
  return Array.from(new Set(permissions.map((permission) => permission.code)));
}

/**
 * 把权限目录转换成「模块 → 页面 → 按钮/功能」树。
 *
 * 页面所属模块以页面路由管理中的 groupLabel 为准。操作权限优先按页面码前缀和分组名称归档；
 * 无法唯一确认页面时留在模块公共权限中，避免把同一按钮错误挂到多个页面。
 */
function buildPermissionModules(groups: PermissionCatalogGroup[]): PermissionModuleNode[] {
  const modules = new Map<string, PermissionModuleNode>();
  const moduleOrder: string[] = [];
  const actions: CatalogAction[] = [];

  function ensureModule(name: string) {
    const existing = modules.get(name);
    if (existing) return existing;
    const next: PermissionModuleNode = { name, pages: [], sharedActions: [] };
    modules.set(name, next);
    moduleOrder.push(name);
    return next;
  }

  for (const group of groups) {
    const groupName = moduleOf(group.label);
    const pagePermissions = group.permissions.filter(
      (permission) => permission.type === "page" || group.label.startsWith("页面访问"),
    );
    if (pagePermissions.length > 0) {
      const module = ensureModule(groupName);
      for (const page of pagePermissions) module.pages.push({ page, actions: [] });
    }

    for (const permission of group.permissions) {
      if (permission.type === "action" || group.label.startsWith("操作权限")) {
        actions.push({ groupName, permission });
      }
    }
  }

  const allPages = Array.from(modules.values()).flatMap((module) =>
    module.pages.map((page) => ({ module, page })),
  );

  for (const action of actions) {
    const namedModule = modules.get(action.groupName);
    const candidates = namedModule
      ? namedModule.pages.map((page) => ({ module: namedModule, page }))
      : allPages;
    const scored = candidates
      .map((candidate) => ({ ...candidate, score: actionPageScore(action, candidate.page.page) }))
      .sort((left, right) => right.score - left.score);
    const bestScore = scored[0]?.score ?? 0;
    const best = scored.filter((candidate) => candidate.score === bestScore);

    if (bestScore >= 180 && best.length === 1) {
      best[0].page.actions.push(action.permission);
      continue;
    }

    if (namedModule) {
      namedModule.sharedActions.push(action.permission);
      continue;
    }

    const moduleFrequency = new Map<PermissionModuleNode, number>();
    for (const candidate of best) {
      moduleFrequency.set(candidate.module, (moduleFrequency.get(candidate.module) ?? 0) + 1);
    }
    const rankedModules = Array.from(moduleFrequency.entries()).sort((left, right) => right[1] - left[1]);
    if (bestScore > 0 && rankedModules[0] && rankedModules[0][1] > (rankedModules[1]?.[1] ?? 0)) {
      rankedModules[0][0].sharedActions.push(action.permission);
      continue;
    }

    ensureModule(action.groupName).sharedActions.push(action.permission);
  }

  return moduleOrder.map((name) => modules.get(name)!);
}

// ── 中美协同：展示层合成「操作权限」分组 ─────────────────────────────────────
// 协同池内操作与研发共用同一套操作码（页面码决定能进哪个池、操作码只在所进池内生效），
// 而权限目录表 code 唯一、同一码无法归属两个分组——服务端目录里这些码都挂在研发相关分组下。
// 这里在展示层为「中美协同」模块合成一个共享操作码分组，配置协同角色时不必去研发分组里找；
// 勾选状态与研发分组天然同步（同一个码）。label/description 覆盖为协同语境说明。
const US_COLLAB_SHARED_ACTIONS: Array<{ code: string; label: string; description: string }> = [
  { code: "rd-task:create", label: "新建任务（协同池）", description: "在协同驾驶舱/工作台创建任务；与研发「新建任务」同码，仅在有权进入的池内生效" },
  { code: "rd-task:edit", label: "编辑与审批任务（协同池）", description: "修改协同任务字段/状态、处理成果与协作审批；与研发同码" },
  { code: "rd-task:reassign", label: "批量转派（协同池）", description: "协同驾驶舱顶部「批量转派」按钮；与研发同码" },
  { code: "rd-task:review-notify", label: "接收审核通知（协同池）", description: "协同池审核提交时收到站内通知；与研发同码，只决定收不收通知，不决定能不能审批" },
  { code: "rd-task:move", label: "移动任务归类（协同池）", description: "协同任务移动到其他分组；与研发同码" },
  { code: "rd-task:override-priority", label: "覆盖优先级（协同池）", description: "协同任务详情页修改优先级；与研发同码" },
  { code: "rd-people:manage", label: "人员管理（协同池）", description: "协同驾驶舱顶部「人员管理」按钮，维护协同成员；与研发同码" },
  { code: "rd-project:direct", label: "直接立项（协同池）", description: "协同驾驶舱「立项」免审直接生效；与研发「直接立项」同码" },
  { code: "rd-project:review-l1", label: "立项一审（协同池）", description: "审核协同池立项申请（多级第一级）；与研发同码" },
  { code: "rd-project:review-l2", label: "立项终审（协同池）", description: "协同池立项终审通过；与研发同码" },
  { code: "rd-data:clear", label: "清空数据（协同池）", description: "协同驾驶舱顶部「清空数据」按钮；与研发同码，高危" },
];
const US_COLLAB_PAGE_GROUP_LABEL = "页面访问 · 中美协同";
const US_COLLAB_ACTION_GROUP_LABEL = "操作权限 · 中美协同";

/** 在中美协同页面组后插入合成操作组；目录里码不存在（被管理员停用/删除）则跳过该条 */
function withUsCollabActionGroup(groups: PermissionCatalogGroup[]): PermissionCatalogGroup[] {
  const idx = groups.findIndex((g) => g.label === US_COLLAB_PAGE_GROUP_LABEL);
  if (idx < 0 || groups.some((g) => g.label === US_COLLAB_ACTION_GROUP_LABEL)) return groups;
  const catalogCodes = new Set(groups.flatMap((g) => g.permissions.map((p) => p.code)));
  const permissions = US_COLLAB_SHARED_ACTIONS.filter((p) => catalogCodes.has(p.code)).map((p) => ({
    ...p,
    type: "action" as const,
  }));
  if (permissions.length === 0) return groups;
  const synth: PermissionCatalogGroup = { label: US_COLLAB_ACTION_GROUP_LABEL, permissions };
  return [...groups.slice(0, idx + 1), synth, ...groups.slice(idx + 1)];
}

function computeInitialCollapsed(
  groups: DisplayPermissionGroup[],
  selected: string[],
  isWildcard: boolean,
): Record<string, boolean> {
  if (isWildcard) return Object.fromEntries(groups.map((group) => [group.key, true]));
  const next: Record<string, boolean> = {};
  for (const group of groups) {
    const hasAnySelected = group.permissions.some((p) => selected.includes(p.code));
    if (!hasAnySelected) next[group.key] = true;
  }
  return next;
}

function PermissionMatrix({
  selected,
  onChange,
  isWildcard,
  groups,
}: {
  selected: string[];
  onChange: (permissions: string[]) => void;
  isWildcard: boolean;
  groups: PermissionCatalogGroup[];
}) {
  // 展示层注入中美协同共享操作码分组（勾选与研发分组同码联动）
  const displayGroups = useMemo(() => withUsCollabActionGroup(groups), [groups]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const orderedModules = useMemo(
    () => buildPermissionModules(displayGroups).map((module) => ({
      name: module.name,
      groups: [
        ...module.pages.map<DisplayPermissionGroup>((page) => ({
          key: `${module.name}::${page.page.code}`,
          kind: "page",
          label: page.page.label,
          routePath: page.page.routePath,
          permissions: [page.page, ...page.actions],
        })),
        ...(module.sharedActions.length > 0
          ? [{
              key: `${module.name}::shared-actions`,
              kind: "shared" as const,
              label: "模块公共功能权限",
              permissions: module.sharedActions,
            }]
          : []),
      ],
    })),
    [displayGroups],
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    computeInitialCollapsed(orderedModules.flatMap((module) => module.groups), selected, isWildcard),
  );

  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function setAllCollapsed(value: boolean) {
    if (!value) {
      setCollapsed({});
      return;
    }
    setCollapsed(Object.fromEntries(
      orderedModules.flatMap((module) => module.groups.map((group) => [group.key, true])),
    ));
  }

  function togglePermission(code: string) {
    if (selectedSet.has(code)) {
      onChange(selected.filter((p) => p !== code));
    } else {
      onChange([...selected, code]);
    }
  }

  function toggleGroupAll(codes: string[]) {
    const allSelected = codes.every((c) => selectedSet.has(c));
    if (allSelected) {
      onChange(selected.filter((p) => !codes.includes(p)));
    } else {
      onChange(Array.from(new Set([...selected, ...codes])));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-xs leading-5 text-slate-500">
          权限按模块和页面归档，展开页面即可配置对应的页面访问、按钮与功能权限。
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAllCollapsed(false)}>
            展开全部
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAllCollapsed(true)}>
            收起全部
          </Button>
        </div>
      </div>
      {orderedModules.map((mod) => {
        const modCodes = uniqueCodes(mod.groups.flatMap((group) => group.permissions));
        const modSelected = isWildcard
          ? modCodes.length
          : modCodes.filter((c) => selectedSet.has(c)).length;
        return (
          <section key={mod.name} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <span className="h-3.5 w-1 shrink-0 rounded-full bg-indigo-400" />
              <span className="text-balance text-sm font-bold text-slate-900">{mod.name}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 tabular-nums">
                {mod.groups.filter((group) => group.kind === "page").length} 个页面
              </span>
              <span className="text-[11px] tabular-nums text-slate-400">
                {modSelected}/{modCodes.length}
              </span>
              <span className="h-px flex-1 bg-slate-100" />
            </div>
            <div className="space-y-2 p-3">
              {mod.groups.map((group) => {
        const groupCodes = uniqueCodes(group.permissions);
        const selectedCount = isWildcard
          ? groupCodes.length
          : groupCodes.filter((c) => selectedSet.has(c)).length;
        const allSelected = selectedCount === groupCodes.length;
        const noneSelected = selectedCount === 0;
        const isOpen = !collapsed[group.key];
        const Icon = group.kind === "shared" ? MousePointerClick : FileText;
        const progress = groupCodes.length === 0 ? 0 : (selectedCount / groupCodes.length) * 100;

        return (
          <div
            key={group.key}
            className={cn(
              "overflow-hidden rounded-lg border transition-colors duration-200",
              allSelected
                ? "border-indigo-200 bg-indigo-50/60"
                : !noneSelected
                  ? "border-indigo-200 bg-indigo-50/30"
                  : "border-slate-200 bg-white",
            )}
          >
            {/* Group header */}
            <div className="group/grp flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/50">
              <Checkbox
                checked={allSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                disabled={isWildcard}
                onCheckedChange={() => {
                  if (!isWildcard) toggleGroupAll(groupCodes);
                }}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "shrink-0",
                  allSelected && "data-[state=checked]:border-indigo-600 data-[state=checked]:bg-indigo-600",
                )}
              />
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                    allSelected
                      ? "bg-indigo-100 text-indigo-600"
                      : !noneSelected
                        ? "bg-indigo-100 text-indigo-600"
                        : "bg-slate-100 text-slate-400",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{group.label}</span>
                  {group.routePath ? (
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
                      {group.routePath}
                    </span>
                  ) : null}
                </span>
              </button>

              {/* Progress + count */}
              <div className="flex items-center gap-2.5 shrink-0">
                <span
                  className={cn(
                    "text-xs tabular-nums font-medium",
                    allSelected
                      ? "text-indigo-600"
                      : !noneSelected
                        ? "text-indigo-600"
                        : "text-slate-400",
                  )}
                >
                  {selectedCount}/{groupCodes.length}
                </span>
                <Progress
                  value={progress}
                  className={cn(
                    "w-16 h-1.5 transition-colors",
                    allSelected ? "bg-indigo-100 [&>[data-slot=progress-indicator]]:bg-indigo-600" :
                      !noneSelected ? "bg-indigo-100 [&>[data-slot=progress-indicator]]:bg-indigo-500" :
                        "bg-slate-100 [&>[data-slot=progress-indicator]]:bg-slate-400",
                  )}
                />
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-label={`${isOpen ? "收起" : "展开"}${group.label}`}
                  className="rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-slate-400 transition-transform duration-200 ease-out",
                    isOpen && "rotate-180",
                  )}
                />
                </button>
              </div>
            </div>

            {isOpen ? (
              <div className="border-t border-slate-100 bg-white">
                  <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:grid-cols-3">
                    {group.permissions.map((perm) => {
                      const checked = isWildcard || selectedSet.has(perm.code);
                      const ItemIcon = perm.type === "action" ? MousePointerClick : FileText;
                      return (
                        <label
                          key={perm.code}
                          className={cn(
                            "group/perm flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors duration-150",
                            checked
                              ? "border-indigo-200 bg-indigo-50/70 hover:border-indigo-300"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                            isWildcard && "cursor-default opacity-70",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={isWildcard}
                            onCheckedChange={() => {
                              if (!isWildcard) togglePermission(perm.code);
                            }}
                            className="mt-0.5 shrink-0"
                          />
                          <ItemIcon
                            className={cn(
                              "mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors",
                              checked ? "text-indigo-500" : "text-slate-300 group-hover/perm:text-slate-400",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 text-[10px] font-medium text-slate-400">
                              {perm.type === "action" ? "按钮 / 功能权限" : "页面访问权限"}
                            </div>
                            <div className={cn(
                              "text-sm font-medium transition-colors leading-tight",
                              checked ? "text-indigo-800" : "text-slate-700",
                            )}>
                              {perm.label}
                            </div>
                            {perm.description && (
                              <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-2 leading-snug">
                                {perm.description}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
              </div>
            ) : null}
          </div>
        );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

type DialogMode = "create" | "edit" | "deleteConfirm" | null;

export function RoleManagement() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionCatalogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [form, setForm] = useState<RoleFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const [data, groups] = await Promise.all([
        apiListRoles(),
        permissionCatalogApi.listGroups(),
      ]);
      setRoles(data);
      setPermissionGroups(groups);
      if (!activeRoleId && data.length > 0) {
        setActiveRoleId(data[0].id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [activeRoleId]);

  useEffect(() => {
    void loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeRole = roles.find((r) => r.id === activeRoleId) ?? roles[0] ?? null;
  const isWildcard = activeRole?.permissions.includes("*") ?? false;

  const totalPermissions = useMemo(
    () => permissionGroups.reduce((sum, g) => sum + g.permissions.length, 0),
    [permissionGroups],
  );

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialogMode("create");
  }

  function openEdit(role: Role) {
    setSelectedRole(role);
    setForm({
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      permissions: role.permissions,
    });
    setDialogMode("edit");
  }

  function openDelete(role: Role) {
    setSelectedRole(role);
    setDialogMode("deleteConfirm");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedRole(null);
  }

  async function handleSaveRole() {
    if (!form.name.trim()) {
      toast.error("角色名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const saved = await apiSaveRole(form);
      setRoles((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...saved };
          return next;
        }
        return [saved, ...prev];
      });
      setActiveRoleId(saved.id);
      toast.success(form.id ? "角色已更新" : "角色已创建");
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickSavePermissions(role: Role, permissions: string[]) {
    try {
      const saved = await apiSaveRole({
        id: role.id,
        name: role.name,
        description: role.description ?? "",
        permissions,
      });
      setRoles((prev) => prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
      toast.success("权限已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function handleDeleteRole() {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await apiDeleteRole(selectedRole.id);
      setRoles((prev) => prev.filter((r) => r.id !== selectedRole.id));
      setActiveRoleId(null);
      toast.success("角色已删除");
      closeDialog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 xl:h-full xl:min-h-0 xl:overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <section className="material-card shrink-0 overflow-hidden">
        <div className="h-0.5 bg-indigo-600" />
        <div className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between md:p-8">
          <div className="min-w-0">
            <span className="material-chip bg-indigo-50 text-xs text-indigo-700">
              Permission Matrix
            </span>
            <h2 className="mt-3 text-balance text-2xl font-bold text-slate-950 sm:text-[1.75rem]">
              角色与权限
            </h2>
            <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-500">
              配置角色的页面访问权限与操作权限。权限变更实时生效——用户下次刷新 Token 后即可感知。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-500">角色</span>
              <span className="font-bold text-slate-800">{roles.length}</span>
              <Separator orientation="vertical" className="mx-1.5 h-3.5" />
              <Shield className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-500">权限项</span>
              <span className="font-bold text-slate-800">{totalPermissions}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadRoles()}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              刷新
            </Button>
            <PermissionGuard permission="role:create">
              <Button size="sm" onClick={openCreate} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                新建角色
              </Button>
            </PermissionGuard>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-5 xl:overflow-hidden">
        {/* ── Role list ──────────────────────────────────────────── */}
        <div className="material-card min-h-0 overflow-hidden xl:flex xl:flex-col">
          <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="text-sm">加载中…</span>
            </div>
          ) : roles.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
              <Users className="h-6 w-6 text-slate-200" />
              <span className="text-sm">暂无角色</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {roles.map((role) => {
                const isActive = activeRoleId === role.id;
                const isSuper = role.permissions.includes("*");
                const userCount = role._count?.users ?? 0;
                const RoleIcon = isSuper ? Crown : User;

                return (
                  <div
                    key={role.id}
                    onClick={() => setActiveRoleId(role.id)}
                    className={cn(
                      "group/role relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors duration-150",
                      isActive
                        ? "border-indigo-200 bg-indigo-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60",
                    )}
                  >
                    {/* Left active accent */}
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-indigo-600" />
                    )}

                    {/* Role icon */}
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                        isSuper
                          ? "bg-amber-100 text-amber-600 ring-1 ring-amber-200"
                          : isActive
                            ? "bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200"
                            : "bg-slate-100 text-slate-500 ring-1 ring-slate-200 group-hover/role:bg-slate-200",
                      )}
                    >
                      <RoleIcon className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-sm font-semibold",
                            isActive ? "text-indigo-700" : "text-slate-800",
                          )}
                        >
                          {role.name}
                        </span>
                        {isSuper && (
                          <Badge className="h-4 shrink-0 gap-0.5 border-0 bg-amber-500 px-1 text-[10px] font-bold text-white hover:bg-amber-600">
                            <Sparkles className="h-2 w-2" />
                            超级
                          </Badge>
                        )}
                      </div>
                      {role.description && (
                        <div className="mt-0.5 text-xs text-slate-400 line-clamp-2 leading-snug">
                          {role.description}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="flex items-center gap-0.5">
                          <Users className="h-2.5 w-2.5" />
                          {userCount}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span>
                          {isSuper ? "全部权限" : `${role.permissions.length} 项`}
                        </span>
                      </div>
                    </div>

                    {/* Actions (hover) */}
                    {!isSuper && (
                      <div className="ml-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-hover/role:opacity-100">
                        <PermissionGuard permission="role:edit">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`编辑角色 ${role.name}`}
                                className="size-6 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(role);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4}>编辑</TooltipContent>
                          </Tooltip>
                        </PermissionGuard>
                        <PermissionGuard permission="role:delete">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`删除角色 ${role.name}`}
                                className="size-6 text-slate-400 hover:bg-red-50 hover:text-red-500"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDelete(role);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={4}>删除</TooltipContent>
                          </Tooltip>
                        </PermissionGuard>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>

        {/* ── Permission matrix for active role ────────────────── */}
        <div className="material-card min-h-0 min-w-0 overflow-hidden xl:flex xl:flex-col">
          {!activeRole ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 p-6 text-slate-400 xl:h-full">
              <Shield className="h-8 w-8 text-slate-200" />
              <span className="text-sm">请从左侧选择角色</span>
            </div>
          ) : (
            <>
              <div className="shrink-0 p-4 pb-0 sm:p-6 sm:pb-0">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg",
                        isWildcard
                          ? "bg-amber-100 text-amber-600 ring-1 ring-amber-200"
                          : "bg-indigo-100 text-indigo-600 ring-1 ring-indigo-200",
                      )}
                    >
                      {isWildcard ? <Crown className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </span>
                    <h3 className="text-lg font-bold text-slate-900">{activeRole.name}</h3>
                    {isWildcard && (
                      <Badge className="h-5 gap-0.5 border-0 bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                        <Sparkles className="h-2.5 w-2.5" />
                        超级权限
                      </Badge>
                    )}
                  </div>
                  {activeRole.description && (
                    <p className="mt-1.5 text-sm text-slate-500 leading-6">{activeRole.description}</p>
                  )}
                  {isWildcard && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 leading-5">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>该角色拥有超级权限（*），可访问所有功能。若要限制权限，请编辑角色并手动指定权限列表。</span>
                    </div>
                  )}
                </div>
                {!isWildcard && (
                  <PermissionGuard permission="role:edit">
                    <Button size="sm" onClick={() => openEdit(activeRole)} className="shrink-0 gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      编辑角色
                    </Button>
                  </PermissionGuard>
                )}
              </div>

              <Separator className="mb-4" />
              </div>

              <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-0 sm:p-6 sm:pt-0">
              <PermissionMatrix
                key={activeRole.id}
                selected={activeRole.permissions}
                isWildcard={isWildcard}
                groups={permissionGroups}
                onChange={(permissions) => {
                  setRoles((prev) =>
                    prev.map((r) =>
                      r.id === activeRole.id ? { ...r, permissions } : r,
                    ),
                  );
                  void handleQuickSavePermissions(activeRole, permissions);
                }}
              />
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Create / Edit Dialog ─────────────────────────────────── */}
      <Dialog
        open={dialogMode === "create" || dialogMode === "edit"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="material-scrollbar sm:max-w-[50vw] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogMode === "edit" ? (
                <><Pencil className="h-4 w-4 text-indigo-500" />编辑角色</>
              ) : (
                <><Plus className="h-4 w-4 text-indigo-500" />新建角色</>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">
                  角色名称 <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="请输入角色名称"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-desc">角色说明</Label>
                <Textarea
                  id="role-desc"
                  rows={1}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="简要说明该角色的职责范围"
                  className="min-h-9"
                />
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Shield className="h-3.5 w-3.5 text-slate-400" />
                权限配置
              </Label>
              <span className="text-xs text-slate-400">
                已选 <strong className="text-slate-700 tabular-nums">{form.permissions.filter((p) => p !== "*").length}</strong> 项 / 共 {totalPermissions} 项
              </span>
            </div>

            <PermissionMatrix
              selected={form.permissions}
              isWildcard={form.permissions.includes("*")}
              groups={permissionGroups}
              onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void handleSaveRole()} disabled={saving} className="gap-1.5">
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "保存中…" : "保存角色"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ───────────────────────────────────────── */}
      <Dialog open={dialogMode === "deleteConfirm"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-500" />
              确认删除角色
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm leading-6 text-slate-600">
              即将永久删除角色「<strong className="text-slate-900">{selectedRole?.name}</strong>」。
            </p>
            {(selectedRole?._count?.users ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 leading-5">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  该角色下仍有 <strong>{selectedRole?._count?.users}</strong> 名用户，请先移除或重新分配后再删除。
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteRole()}
              disabled={saving || (selectedRole?._count?.users ?? 0) > 0}
              className="gap-1.5"
            >
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
