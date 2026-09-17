import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Crown,
  FileText,
  MousePointerClick,
  Pencil,
  Plus,
  RefreshCw,
  Search,
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
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

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

async function readRoleError(res: Response, action: "读取" | "保存" | "删除"): Promise<string> {
  const error = await res.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
  if (res.status >= 500) return `服务器暂时无法${action}角色，请稍后重试`;
  if (res.status === 401) return "登录已失效，请重新登录后再试";
  if (error?.code === "ROLE_NAME_ALREADY_EXISTS") return "角色名称已存在，请更换名称";

  const messages = Array.isArray(error?.message) ? error.message : [error?.message];
  const readableMessages = messages
    .filter((message): message is string => typeof message === "string" && /[\u3400-\u9fff]/.test(message))
    .map((message) => message.trim());
  if (readableMessages.length) return readableMessages.join("；");

  switch (res.status) {
    case 400:
    case 422:
      return "角色信息有误，请检查填写内容后重试";
    case 403:
      return `没有${action}角色的权限，请联系管理员`;
    case 404:
      return "角色不存在或已被删除，请刷新列表后重试";
    case 409:
      return "角色信息存在冲突，请检查名称或刷新列表后重试";
    case 429:
      return "操作过于频繁，请稍后再试";
    default:
      return `${action}角色失败，请稍后重试`;
  }
}

async function apiListRoles(): Promise<Role[]> {
  const res = await authFetch("/api/roles").catch(() => {
    throw new Error("网络连接异常，请检查网络后重试");
  });
  if (!res.ok) throw new Error(await readRoleError(res, "读取"));
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
  }).catch(() => {
    throw new Error("网络连接异常，请检查网络后重试");
  });
  if (!res.ok) throw new Error(await readRoleError(res, "保存"));
  return res.json() as Promise<Role>;
}

async function apiDeleteRole(id: string): Promise<void> {
  const res = await authFetch(`/api/roles/${id}`, { method: "DELETE" }).catch(() => {
    throw new Error("网络连接异常，请检查网络后重试");
  });
  if (!res.ok) throw new Error(await readRoleError(res, "删除"));
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
  idPrefix,
  onReload,
  disabled = false,
  readOnly = false,
}: {
  selected: string[];
  onChange: (permissions: string[]) => void;
  isWildcard: boolean;
  groups: PermissionCatalogGroup[];
  idPrefix: string;
  onReload?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
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
    if (readOnly || disabled || isWildcard) return;
    if (selectedSet.has(code)) {
      onChange(selected.filter((p) => p !== code));
    } else {
      onChange([...selected, code]);
    }
  }

  function toggleGroupAll(codes: string[]) {
    if (readOnly || disabled || isWildcard || codes.length === 0) return;
    const allSelected = codes.every((c) => selectedSet.has(c));
    if (allSelected) {
      onChange(selected.filter((p) => !codes.includes(p)));
    } else {
      onChange(Array.from(new Set([...selected, ...codes])));
    }
  }

  if (orderedModules.length === 0) {
    return (
      <HorizonEmptyState
        Icon={Shield}
        title="权限目录暂无可配置项"
        description="请重新读取权限目录；若仍为空，请先在权限目录中启用权限项。"
        action={onReload ? (
          <Button type="button" variant="outline" onClick={onReload}>
            <RefreshCw className="size-4" aria-hidden="true" />
            重新读取
          </Button>
        ) : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-xs leading-5 text-slate-500">
          {readOnly
            ? "当前账号仅可查看授权范围。权限按模块与页面归档。"
            : disabled
              ? "权限正在保存，请稍候。"
              : "权限按模块和页面归档，展开页面即可配置对应的页面访问、按钮与功能权限。"}
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
      {orderedModules.map((mod, moduleIndex) => {
        const modCodes = uniqueCodes(mod.groups.flatMap((group) => group.permissions));
        const modSelected = isWildcard
          ? modCodes.length
          : modCodes.filter((c) => selectedSet.has(c)).length;
        const moduleHeadingId = `${idPrefix}-permission-module-${moduleIndex}`;
        return (
          <section
            key={mod.name}
            aria-labelledby={moduleHeadingId}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <span className="h-3.5 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <h3 id={moduleHeadingId} className="text-balance text-sm font-bold text-slate-900">{mod.name}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 tabular-nums">
                {mod.groups.filter((group) => group.kind === "page").length} 个页面
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {modSelected}/{modCodes.length}
              </span>
              <span className="h-px flex-1 bg-slate-100" />
            </div>
            <div className="space-y-2 bg-slate-50/70 p-3">
              {mod.groups.map((group, groupIndex) => {
                const groupCodes = uniqueCodes(group.permissions);
                const selectedCount = isWildcard
                  ? groupCodes.length
                  : groupCodes.filter((c) => selectedSet.has(c)).length;
                const allSelected = groupCodes.length > 0 && selectedCount === groupCodes.length;
                const noneSelected = selectedCount === 0;
                const isOpen = !collapsed[group.key];
                const Icon = group.kind === "shared" ? MousePointerClick : FileText;
                const progress = groupCodes.length === 0 ? 0 : (selectedCount / groupCodes.length) * 100;
                const panelId = `${idPrefix}-permission-group-${moduleIndex}-${groupIndex}`;

                return (
                  <div
                    key={group.key}
                    className={cn(
                      "overflow-hidden rounded-xl border bg-white",
                      noneSelected ? "border-slate-200" : "border-blue-200",
                    )}
                  >
                    <div className="flex w-full items-center gap-3 px-4 py-3 text-left">
                      <Checkbox
                        checked={allSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                        disabled={isWildcard || readOnly || disabled}
                        aria-label={`选择${group.label}全部权限`}
                        onCheckedChange={() => toggleGroupAll(groupCodes)}
                        className={cn(
                          "shrink-0",
                          allSelected && "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
                        )}
                      />
                      <Button variant="unstyled"
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-lg",
                            noneSelected ? "bg-slate-100 text-slate-500" : "bg-blue-50 text-primary",
                          )}
                          aria-hidden="true"
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-800">{group.label}</span>
                          {group.routePath ? (
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500">
                              {group.routePath}
                            </span>
                          ) : null}
                        </span>
                      </Button>

                      <div className="flex shrink-0 items-center gap-2.5">
                        <span className={cn("text-xs font-medium tabular-nums", noneSelected ? "text-slate-500" : "text-primary")}>
                          {selectedCount}/{groupCodes.length}
                        </span>
                        <Progress
                          value={progress}
                          aria-label={`${group.label}授权进度`}
                          className={cn(
                            "hidden h-1.5 w-16 sm:block",
                            noneSelected
                              ? "bg-slate-100 [&>[data-slot=progress-indicator]]:bg-slate-400"
                              : "bg-blue-100 [&>[data-slot=progress-indicator]]:bg-primary",
                          )}
                        />
                        <Button variant="unstyled"
                          type="button"
                          onClick={() => toggleGroup(group.key)}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          aria-label={`${isOpen ? "收起" : "展开"}${group.label}`}
                          className="rounded-md p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <ChevronDown className={cn("size-4 text-slate-500", isOpen && "rotate-180")} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    {isOpen ? (
                      <div id={panelId} className="border-t border-slate-100 bg-white">
                        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 2xl:grid-cols-3">
                          {group.permissions.map((perm) => {
                            const checked = isWildcard || selectedSet.has(perm.code);
                            const ItemIcon = perm.type === "action" ? MousePointerClick : FileText;
                            return (
                              <div
                                key={perm.code}
                                className={cn(
                                  "flex items-start gap-2.5 rounded-lg border p-2.5 text-sm",
                                  checked ? "border-blue-200 bg-blue-50/70" : "border-slate-200 bg-white",
                                  (isWildcard || readOnly || disabled) && "opacity-75",
                                )}
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={isWildcard || readOnly || disabled}
                                  aria-label={`${checked ? "取消" : "授予"}权限：${perm.label}`}
                                  onCheckedChange={() => togglePermission(perm.code)}
                                  className="mt-0.5 shrink-0"
                                />
                                <ItemIcon
                                  className={cn("mt-0.5 size-3.5 shrink-0", checked ? "text-primary" : "text-muted-foreground")}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="mb-1 text-[10px] font-medium text-slate-500">
                                    {perm.type === "action" ? "按钮 / 功能权限" : "页面访问权限"}
                                  </div>
                                  <div className={cn("text-sm font-medium leading-tight", checked ? "text-blue-900" : "text-slate-700")}>
                                    {perm.label}
                                  </div>
                                  {perm.description ? (
                                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
                                      {perm.description}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
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

type DialogMode = "create" | "copy" | "edit" | "deleteConfirm" | null;
type RoleFilter = "ALL" | "SUPER" | "CONFIGURED" | "EMPTY";
type FormErrors = Partial<Record<"name", string>>;

const ROLE_PAGE_SIZE = 8;
const ROLE_FILTER_TRIGGER_CLASS =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary";

export function RoleManagement() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionCatalogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [page, setPage] = useState(1);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [form, setForm] = useState<RoleFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [dialogError, setDialogError] = useState("");
  const [saving, setSaving] = useState(false);
  const [permissionSavingRoleId, setPermissionSavingRoleId] = useState<string | null>(null);
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rolesRequestRef = useRef(0);

  const loadRoles = useCallback(async () => {
    const requestId = ++rolesRequestRef.current;
    setLoading(true);
    setLoadError("");
    try {
      const [data, groups] = await Promise.all([
        apiListRoles(),
        permissionCatalogApi.listGroups(),
      ]);
      if (requestId !== rolesRequestRef.current) return;
      setRoles(data);
      setPermissionGroups(groups);
      setActiveRoleId((current) =>
        current && data.some((role) => role.id === current) ? current : (data[0]?.id ?? null),
      );
    } catch (err) {
      if (requestId !== rolesRequestRef.current) return;
      const message = err instanceof Error ? err.message : "数据加载失败";
      setLoadError(message);
      toast.error(message);
    } finally {
      if (requestId === rolesRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
    return () => { rolesRequestRef.current += 1; };
  }, [loadRoles]);

  function invalidatePendingRoleLoads() {
    rolesRequestRef.current += 1;
    setLoading(false);
  }

  const totalPermissions = useMemo(
    () => permissionGroups.reduce((sum, group) => sum + group.permissions.length, 0),
    [permissionGroups],
  );
  const assignedUsers = useMemo(
    () => roles.reduce((sum, role) => sum + (role._count?.users ?? 0), 0),
    [roles],
  );
  const wildcardRoleCount = useMemo(
    () => roles.filter((role) => role.permissions.includes("*")).length,
    [roles],
  );

  const filteredRoles = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return roles.filter((role) => {
      const matchesQuery =
        !query ||
        role.name.toLowerCase().includes(query) ||
        (role.description ?? "").toLowerCase().includes(query);
      const hasWildcard = role.permissions.includes("*");
      const matchesFilter =
        roleFilter === "ALL" ||
        (roleFilter === "SUPER" && hasWildcard) ||
        (roleFilter === "CONFIGURED" && !hasWildcard && role.permissions.length > 0) ||
        (roleFilter === "EMPTY" && !hasWildcard && role.permissions.length === 0);
      return matchesQuery && matchesFilter;
    });
  }, [keyword, roleFilter, roles]);

  useEffect(() => {
    setPage(1);
  }, [keyword, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRoles.length / ROLE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRoles = filteredRoles.slice(
    (safePage - 1) * ROLE_PAGE_SIZE,
    safePage * ROLE_PAGE_SIZE,
  );
  const activeRole =
    pagedRoles.find((role) => role.id === activeRoleId) ?? pagedRoles[0] ?? null;
  const isWildcard = activeRole?.permissions.includes("*") ?? false;
  const hasActiveFilters = Boolean(keyword.trim()) || roleFilter !== "ALL";

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  function prepareDialog(trigger?: HTMLButtonElement | null) {
    dialogTriggerRef.current = trigger ?? null;
    setFormErrors({});
    setDialogError("");
  }

  function openCreate(trigger?: HTMLButtonElement | null) {
    prepareDialog(trigger);
    setSelectedRole(null);
    setForm({ ...EMPTY_FORM });
    setDialogMode("create");
  }

  function openCopy(role: Role, trigger?: HTMLButtonElement | null) {
    prepareDialog(trigger);
    setSelectedRole(role);
    setForm({
      name: role.name + " 副本",
      description: role.description ?? "",
      permissions: [...role.permissions],
    });
    setDialogMode("copy");
  }

  function openEdit(role: Role, trigger?: HTMLButtonElement | null) {
    prepareDialog(trigger);
    setSelectedRole(role);
    setForm({
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      permissions: [...role.permissions],
    });
    setDialogMode("edit");
  }

  function openDelete(role: Role, trigger?: HTMLButtonElement | null) {
    prepareDialog(trigger);
    setSelectedRole(role);
    setDialogMode("deleteConfirm");
  }

  function closeDialog() {
    setDialogMode(null);
    setSelectedRole(null);
    setFormErrors({});
    setDialogError("");
  }

  async function handleSaveRole() {
    const nextErrors: FormErrors = {};
    if (!form.name.trim()) nextErrors.name = "请输入角色名称。";
    setFormErrors(nextErrors);
    if (nextErrors.name) {
      document.getElementById("role-name")?.focus();
      return;
    }

    const successMode = dialogMode;
    invalidatePendingRoleLoads();
    setDialogError("");
    setSaving(true);
    try {
      const saved = await apiSaveRole({ ...form, name: form.name.trim() });
      setRoles((current) => {
        const index = current.findIndex((role) => role.id === saved.id);
        if (index >= 0) {
          const next = [...current];
          next[index] = { ...next[index], ...saved };
          return next;
        }
        return [saved, ...current];
      });
      setKeyword("");
      setRoleFilter("ALL");
      setPage(1);
      setActiveRoleId(saved.id);
      toast.success(
        form.id ? "角色已更新" : successMode === "copy" ? "角色副本已创建" : "角色已创建",
      );
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickSavePermissions(role: Role, permissions: string[]) {
    invalidatePendingRoleLoads();
    setPermissionSavingRoleId(role.id);
    try {
      const saved = await apiSaveRole({
        id: role.id,
        name: role.name,
        description: role.description ?? "",
        permissions,
      });
      setRoles((current) =>
        current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)),
      );
      toast.success("权限已保存");
      await loadRoles();
    } catch (err) {
      setRoles((current) =>
        current.map((item) =>
          item.id === role.id ? { ...item, permissions: role.permissions } : item,
        ),
      );
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setPermissionSavingRoleId((current) => (current === role.id ? null : current));
    }
  }

  async function handleDeleteRole() {
    if (!selectedRole) return;
    invalidatePendingRoleLoads();
    setDialogError("");
    setSaving(true);
    try {
      await apiDeleteRole(selectedRole.id);
      setRoles((current) => current.filter((role) => role.id !== selectedRole.id));
      setActiveRoleId(null);
      toast.success("角色已删除");
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除失败";
      setDialogError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setKeyword("");
    setRoleFilter("ALL");
  }

  const dialogTitle =
    dialogMode === "edit" ? "编辑角色" : dialogMode === "copy" ? "复制角色" : "新建角色";

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={Shield}
          eyebrow="SYSTEM GOVERNANCE · ACCESS CONTROL"
          title="角色与权限"
          description="集中维护角色目录和页面、按钮级授权范围。权限修改即时保存，用户刷新登录状态后生效。"
          meta={(
            <>
              <span>权限目录</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {loading ? "正在同步" : loadError ? "同步异常" : roles.length + " 个角色"}
              </span>
            </>
          )}
          actions={(
            <>
              <Button type="button" variant="outline" onClick={() => void loadRoles()} disabled={loading}>
                <RefreshCw
                  className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")}
                  aria-hidden="true"
                />
                {loading ? "读取中…" : "刷新"}
              </Button>
              <PermissionGuard permission="role:create">
                <Button
                  type="button"
                  className="hz-primary-action"
                  onClick={(event) => openCreate(event.currentTarget)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  新建角色
                </Button>
              </PermissionGuard>
            </>
          )}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric
            Icon={Users}
            label="角色总数"
            value={loading && roles.length === 0 ? "—" : roles.length}
            note={(roles.length - wildcardRoleCount) + " 个常规角色"}
            tone="brand"
          />
          <HorizonMetric
            Icon={User}
            label="已分配用户"
            value={loading && roles.length === 0 ? "—" : assignedUsers}
            note="各角色关联账号合计"
            tone={assignedUsers > 0 ? "success" : "neutral"}
          />
          <HorizonMetric
            Icon={Crown}
            label="超级角色"
            value={loading && roles.length === 0 ? "—" : wildcardRoleCount}
            note="拥有全部权限的角色"
            tone={wildcardRoleCount > 0 ? "warning" : "neutral"}
          />
          <HorizonMetric
            Icon={Shield}
            label="权限目录"
            value={loading && permissionGroups.length === 0 ? "—" : totalPermissions}
            note={permissionGroups.length + " 个目录分组"}
            tone="brand"
          />
        </HorizonMetricGrid>

        <section
          className="grid min-w-0 gap-3 xl:grid-cols-[360px_minmax(0,1fr)]"
          aria-label="角色与权限工作台"
        >
          <div className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader
              Icon={Users}
              title="角色目录"
              description="检索角色并选择需要查看或授权的对象。"
              trailing={(
                <span className="text-xs text-slate-500">
                  显示 <span className="font-semibold tabular-nums text-slate-700">{filteredRoles.length}</span> / {roles.length}
                </span>
              )}
            />

            <div className="space-y-3 border-b border-slate-200 p-4">
              <div>
                <Label htmlFor="role-search" className="mb-1.5 block text-xs font-semibold text-slate-700">
                  搜索角色
                </Label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="role-search"
                    className="pl-9"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="角色名称或职责说明"
                  />
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as RoleFilter)}>
                  <SelectTrigger
                    aria-label="筛选角色授权类型"
                    className={ROLE_FILTER_TRIGGER_CLASS}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    <SelectItem value="ALL">全部角色</SelectItem>
                    <SelectItem value="SUPER">超级角色</SelectItem>
                    <SelectItem value="CONFIGURED">已配置权限</SelectItem>
                    <SelectItem value="EMPTY">未配置权限</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={clearFilters} disabled={!hasActiveFilters}>
                  清除
                </Button>
              </div>
            </div>

            {loadError && roles.length > 0 ? (
              <p role="alert" className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {loadError}
              </p>
            ) : null}

            <div className="p-3">
              {loading && roles.length === 0 ? (
                <div className="space-y-2" aria-label="正在加载角色目录">
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="h-20 rounded-xl border border-slate-200 bg-slate-100" aria-hidden="true" />
                  ))}
                </div>
              ) : pagedRoles.length === 0 ? (
                <HorizonEmptyState
                  Icon={hasActiveFilters ? Search : Users}
                  title={
                    hasActiveFilters
                      ? "没有匹配的角色"
                      : loadError
                        ? "角色目录加载失败"
                        : "尚未创建角色"
                  }
                  description={
                    hasActiveFilters
                      ? "调整检索条件或清除筛选后重试。"
                      : loadError
                        ? loadError
                        : "新建首个角色，并为其配置页面与操作权限。"
                  }
                  action={
                    hasActiveFilters ? (
                      <Button type="button" variant="outline" onClick={clearFilters}>清除筛选</Button>
                    ) : loadError ? (
                      <Button type="button" variant="outline" onClick={() => void loadRoles()}>
                        <RefreshCw className="size-4" aria-hidden="true" />
                        重新读取
                      </Button>
                    ) : (
                      <PermissionGuard permission="role:create">
                        <Button
                          type="button"
                          className="hz-primary-action"
                          onClick={(event) => openCreate(event.currentTarget)}
                        >
                          <Plus className="size-4" aria-hidden="true" />
                          新建角色
                        </Button>
                      </PermissionGuard>
                    )
                  }
                />
              ) : (
                <ul className="space-y-2" aria-label="角色列表">
                  {pagedRoles.map((role) => {
                    const selected = activeRole?.id === role.id;
                    const superRole = role.permissions.includes("*");
                    const userCount = role._count?.users ?? 0;
                    const RoleIcon = superRole ? Crown : User;

                    return (
                      <li
                        key={role.id}
                        className={cn(
                          "rounded-xl border bg-white",
                          selected ? "border-blue-300 bg-blue-50/50" : "border-slate-200",
                        )}
                      >
                        <div className="flex items-start gap-1 p-2">
                          <Button variant="unstyled"
                            type="button"
                            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg p-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => setActiveRoleId(role.id)}
                            aria-pressed={selected}
                          >
                            <span
                              className={cn(
                                "flex size-9 shrink-0 items-center justify-center rounded-xl",
                                superRole
                                  ? "bg-amber-50 text-amber-700"
                                  : selected
                                    ? "bg-blue-100 text-primary"
                                    : "bg-slate-100 text-slate-600",
                              )}
                              aria-hidden="true"
                            >
                              <RoleIcon className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-semibold text-slate-900">{role.name}</span>
                                {superRole ? (
                                  <Badge className="shrink-0 border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
                                    <Sparkles className="size-3" aria-hidden="true" />
                                    超级
                                  </Badge>
                                ) : null}
                              </span>
                              <span className="mt-1 line-clamp-2 block text-pretty text-xs leading-5 text-slate-500">
                                {role.description || "暂未填写角色职责说明"}
                              </span>
                              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                <span><span className="font-semibold tabular-nums text-slate-700">{userCount}</span> 名用户</span>
                                <span>{superRole ? "全部权限" : role.permissions.length + " 项权限"}</span>
                              </span>
                            </span>
                          </Button>

                          {!superRole ? (
                            <div className="flex shrink-0 flex-col gap-1">
                              <PermissionGuard permission="role:create">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={(event) => openCopy(role, event.currentTarget)}
                                  aria-label={"复制角色 " + role.name}
                                  title="复制角色"
                                >
                                  <Copy className="size-4" aria-hidden="true" />
                                </Button>
                              </PermissionGuard>
                              <PermissionGuard permission="role:edit">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={(event) => openEdit(role, event.currentTarget)}
                                  aria-label={"编辑角色 " + role.name}
                                  title="编辑角色"
                                >
                                  <Pencil className="size-4" aria-hidden="true" />
                                </Button>
                              </PermissionGuard>
                              <PermissionGuard permission="role:delete">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                  onClick={(event) => openDelete(role, event.currentTarget)}
                                  aria-label={"删除角色 " + role.name}
                                  title="删除角色"
                                >
                                  <Trash2 className="size-4" aria-hidden="true" />
                                </Button>
                              </PermissionGuard>
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <div>
                共 <span className="font-semibold tabular-nums text-slate-700">{filteredRoles.length}</span> 条，
                第 <span className="tabular-nums">{safePage} / {totalPages}</span> 页
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, safePage - 1))}
                  disabled={safePage === 1}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage === totalPages}
                >
                  下一页
                </Button>
              </div>
            </div>
          </div>

          <div className="hz-surface min-w-0 overflow-hidden">
            {loading && roles.length === 0 ? (
              <div className="space-y-3 p-5" aria-label="正在加载权限详情">
                <div className="h-10 w-2/3 rounded-xl bg-slate-100" aria-hidden="true" />
                <div className="h-24 rounded-xl bg-slate-100" aria-hidden="true" />
                <div className="h-48 rounded-xl bg-slate-100" aria-hidden="true" />
              </div>
            ) : !activeRole ? (
              <HorizonEmptyState
                Icon={Shield}
                title={hasActiveFilters ? "当前筛选下没有可授权角色" : "请选择角色"}
                description={
                  hasActiveFilters
                    ? "清除筛选或调整检索条件后，再选择需要维护的角色。"
                    : "从左侧角色目录选择一个角色，查看其权限范围。"
                }
                action={
                  hasActiveFilters ? (
                    <Button type="button" variant="outline" onClick={clearFilters}>清除筛选</Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <HorizonSectionHeader
                  Icon={isWildcard ? Crown : Shield}
                  title={activeRole.name}
                  description={activeRole.description || "暂未填写角色职责说明。"}
                  trailing={(
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {permissionSavingRoleId === activeRole.id ? (
                        <span role="status" className="text-xs text-slate-500">权限保存中…</span>
                      ) : null}
                      {!isWildcard ? (
                        <>
                          <PermissionGuard permission="role:create">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={(event) => openCopy(activeRole, event.currentTarget)}
                            >
                              <Copy className="size-4" aria-hidden="true" />
                              复制
                            </Button>
                          </PermissionGuard>
                          <PermissionGuard permission="role:edit">
                            <Button
                              type="button"
                              size="sm"
                              className="hz-primary-action"
                              onClick={(event) => openEdit(activeRole, event.currentTarget)}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                              编辑角色
                            </Button>
                          </PermissionGuard>
                        </>
                      ) : null}
                    </div>
                  )}
                />

                <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-3">
                  <div className="bg-white px-4 py-3">
                    <div className="text-xs text-slate-500">授权方式</div>
                    <div className="mt-1 text-sm font-semibold text-slate-800">
                      {isWildcard ? "超级权限" : "精细授权"}
                    </div>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <div className="text-xs text-slate-500">已授予权限</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-slate-800">
                      {isWildcard ? "全部" : activeRole.permissions.length + " 项"}
                    </div>
                  </div>
                  <div className="bg-white px-4 py-3">
                    <div className="text-xs text-slate-500">关联用户</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-slate-800">
                      {(activeRole._count?.users ?? 0) + " 名"}
                    </div>
                  </div>
                </div>

                {isWildcard ? (
                  <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-800">
                    <Sparkles className="mt-1 size-4 shrink-0" aria-hidden="true" />
                    <p className="text-pretty">
                      该角色拥有超级权限（*），可访问全部功能。超级角色在此页保持只读，避免误改核心访问边界。
                    </p>
                  </div>
                ) : null}

                <div className="p-4">
                  <PermissionGuard
                    permission="role:edit"
                    fallback={(
                      <PermissionMatrix
                        key={"readonly-" + activeRole.id}
                        idPrefix="role-detail-readonly"
                        selected={activeRole.permissions}
                        isWildcard={isWildcard}
                        groups={permissionGroups}
                        onReload={() => void loadRoles()}
                        readOnly
                        onChange={() => undefined}
                      />
                    )}
                  >
                    <PermissionMatrix
                      key={"editable-" + activeRole.id}
                      idPrefix="role-detail-editable"
                      selected={activeRole.permissions}
                      isWildcard={isWildcard}
                      groups={permissionGroups}
                      onReload={() => void loadRoles()}
                      disabled={permissionSavingRoleId === activeRole.id}
                      onChange={(permissions) => {
                        setRoles((current) =>
                          current.map((role) =>
                            role.id === activeRole.id ? { ...role, permissions } : role,
                          ),
                        );
                        void handleQuickSavePermissions(activeRole, permissions);
                      }}
                    />
                  </PermissionGuard>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <Dialog
        open={dialogMode === "create" || dialogMode === "copy" || dialogMode === "edit"}
        onOpenChange={(open) => {
          if (!open && !saving) closeDialog();
        }}
      >
        <DialogContent
          className="horizon-portal max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
            else document.getElementById("role-search")?.focus();
          }}
        >
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveRole();
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-balance text-slate-900">{dialogTitle}</DialogTitle>
              <DialogDescription className="text-pretty">
                {dialogMode === "copy"
                  ? "已复制“" + (selectedRole?.name ?? "当前角色") + "”的授权范围，请确认新角色名称与权限。"
                  : dialogMode === "edit"
                    ? "更新角色职责说明和页面、按钮级授权范围。"
                    : "创建角色并配置其页面访问与操作权限。"}
              </DialogDescription>
            </DialogHeader>

            {dialogError ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {dialogError}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div>
                <Label htmlFor="role-name" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  角色名称 <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="role-name"
                  autoFocus
                  value={form.name}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, name: event.target.value }));
                    if (formErrors.name) {
                      setFormErrors((current) => ({ ...current, name: undefined }));
                    }
                  }}
                  placeholder="请输入角色名称"
                  aria-invalid={Boolean(formErrors.name)}
                  aria-describedby={formErrors.name ? "role-name-error" : undefined}
                />
                {formErrors.name ? (
                  <p id="role-name-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                    {formErrors.name}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="role-desc" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  角色说明
                </Label>
                <Textarea
                  id="role-desc"
                  rows={2}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="简要说明该角色的职责范围"
                />
              </div>
            </div>

            <section className="border-t border-slate-200 pt-4" aria-labelledby="role-permissions-heading">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 id="role-permissions-heading" className="flex items-center gap-2 text-balance text-sm font-semibold text-slate-800">
                    <Shield className="size-4 text-primary" aria-hidden="true" />
                    权限配置
                  </h3>
                  <p className="mt-1 text-pretty text-xs text-slate-500">
                    选择该角色可访问的页面，以及页面内允许执行的操作。
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  已选 <strong className="font-semibold tabular-nums text-slate-700">
                    {form.permissions.filter((permission) => permission !== "*").length}
                  </strong> 项 / 共 {totalPermissions} 项
                </span>
              </div>

              <PermissionMatrix
                idPrefix="role-form"
                selected={form.permissions}
                isWildcard={form.permissions.includes("*")}
                groups={permissionGroups}
                onReload={() => void loadRoles()}
                onChange={(permissions) =>
                  setForm((current) => ({ ...current, permissions }))
                }
              />
            </section>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
                取消
              </Button>
              <Button type="submit" className="hz-primary-action" disabled={saving}>
                {saving ? "保存中…" : dialogMode === "copy" ? "创建副本" : "保存角色"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={dialogMode === "deleteConfirm"}
        onOpenChange={(open) => {
          if (!open && !saving) closeDialog();
        }}
      >
        <AlertDialogContent
          className="horizon-portal sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
            else document.getElementById("role-search")?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">确认删除角色？</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-6">
              即将永久删除角色“{selectedRole?.name ?? "当前角色"}”。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>

          {(selectedRole?._count?.users ?? 0) > 0 ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              该角色仍关联 <span className="font-semibold tabular-nums">{selectedRole?._count?.users}</span> 名用户，
              请先移除或重新分配后再删除。
            </p>
          ) : null}

          {dialogError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {dialogError}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>保留角色</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              disabled={saving || (selectedRole?._count?.users ?? 0) > 0}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteRole();
              }}
            >
              {saving ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
