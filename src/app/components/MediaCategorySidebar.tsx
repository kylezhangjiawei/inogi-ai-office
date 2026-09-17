import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Edit3,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Images,
  Loader2,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { cn } from "./ui/utils";
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
  MAX_CATEGORY_DEPTH,
  UNCATEGORIZED_FILTER,
  flattenCategories,
  subtreeHeight,
  subtreeIds,
  type CategoryFormPayload,
  type MediaCategoryNode,
} from "../lib/mediaCategory";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";

/** 侧边栏选中态：与研发知识库同款主色块 */
const SELECTED_ROW = "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(var(--primary-rgb),0.18)]";
const UNSELECTED_ROW = "text-slate-600 hover:bg-slate-50";
const SURFACE_CARD = "rounded-lg border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

type CategoryDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; category: MediaCategoryNode };

export function ModalShell({
  title,
  description,
  onClose,
  children,
  widthClass = "sm:max-w-md",
  dismissible = true,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
  dismissible?: boolean;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusCapturedRef = useRef(false);
  const mountedRef = useRef(false);

  if (!returnFocusCapturedRef.current && typeof document !== "undefined") {
    returnFocusCapturedRef.current = true;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body && activeElement.tabIndex >= 0) {
      returnFocusRef.current = activeElement;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const returnTarget = returnFocusRef.current;
      if (!returnTarget) return;
      window.requestAnimationFrame(() => {
        // 等 Radix 的 FocusScope 完成卸载清理后再恢复，否则其收尾会把焦点重新落到 body。
        window.requestAnimationFrame(() => {
          // React StrictMode 会在开发环境模拟一次 effect 卸载/重挂；真实弹窗仍在时不抢回焦点。
          if (mountedRef.current) return;
          if (!returnTarget.isConnected || returnTarget.hasAttribute("disabled")) return;
          returnTarget.focus({ preventScroll: true });
        });
      });
    };
  }, []);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && dismissible) onClose(); }}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          const returnTarget = returnFocusRef.current;
          if (!returnTarget || !returnTarget.isConnected || returnTarget.hasAttribute("disabled")) return;
          event.preventDefault();
          returnTarget.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (!dismissible) event.preventDefault(); }}
        className={cn(
          "horizon-portal flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-white p-0 shadow-xl [&>button]:right-4 [&>button]:top-4 [&>button]:z-10 [&>button]:bg-slate-100 [&>button]:p-2 [&>button]:text-slate-600 [&>button]:opacity-100",
          !dismissible && "[&>button]:hidden",
          widthClass,
        )}
      >
        <DialogHeader className="shrink-0 border-b border-slate-100 px-5 py-4 pr-14 text-left">
          <DialogTitle className="text-balance text-base text-slate-900">{title}</DialogTitle>
          <DialogDescription className={cn("text-pretty text-xs", !description && "sr-only")}>
            {description || "完成当前媒体分类操作。"}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CategoryTreeNode({
  category,
  selectedId,
  collapsedIds,
  busyId,
  canCreate,
  canEdit,
  canDelete,
  onSelect,
  onToggle,
  onCreateChild,
  onEdit,
  onDelete,
}: {
  category: MediaCategoryNode;
  selectedId: string;
  collapsedIds: Set<string>;
  busyId: string | null;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onEdit: (category: MediaCategoryNode) => void;
  onDelete: (category: MediaCategoryNode) => void;
}) {
  const children = category.children ?? [];
  const hasChildren = children.length > 0;
  const expanded = !collapsedIds.has(category.id);
  const selected = selectedId === category.id;
  const busy = busyId === category.id;
  const canAddChild = canCreate && category.depth < MAX_CATEGORY_DEPTH;
  const hasActions = canAddChild || canEdit || canDelete;

  const actionClass = cn(
    "flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    selected ? "text-white/80 hover:bg-white/15 hover:text-white" : "text-muted-foreground hover:bg-slate-100 hover:text-slate-700",
  );

  return (
    <div className="group/category w-full">
      <div className={cn("flex items-center rounded-md transition-colors duration-200", selected ? SELECTED_ROW : UNSELECTED_ROW)}>
        <Button variant="unstyled"
          type="button"
          onClick={() => {
            onSelect(category.id);
            if (hasChildren) onToggle(category.id);
          }}
          title={category.path}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 py-2 pl-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            hasActions ? "rounded-l-md pr-1" : "rounded-md pr-3",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderTree
              className="size-4 shrink-0"
              style={selected ? undefined : { color: category.color || undefined }}
            />
            <span className="truncate">{category.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[11px] tabular-nums opacity-70">{category.totalItemCount}</span>
            <span className="flex h-4 w-3.5 items-center justify-center">
              {hasChildren ? (
                <ChevronRight className={cn("size-3.5 opacity-45 transition-transform", expanded && "rotate-90")} />
              ) : null}
            </span>
          </span>
        </Button>

        {hasActions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 pr-1 transition-opacity",
              !selected && "lg:opacity-55 lg:group-hover/category:opacity-100",
            )}
          >
            {canAddChild ? (
              <Button variant="unstyled"
                type="button"
                onClick={() => onCreateChild(category.id)}
                title="新增子分类"
                aria-label={`在 ${category.name} 下新增子分类`}
                className={actionClass}
              >
                <FolderPlus className="size-3.5" />
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="unstyled"
                type="button"
                onClick={() => onEdit(category)}
                title="编辑分类"
                aria-label={`编辑分类 ${category.name}`}
                className={actionClass}
              >
                <Edit3 className="size-3.5" />
              </Button>
            ) : null}
            {canDelete ? (
              <Button variant="unstyled"
                type="button"
                onClick={() => onDelete(category)}
                disabled={busy}
                title="删除分类"
                aria-label={`删除分类 ${category.name}`}
                className={cn(actionClass, selected ? "hover:text-white" : "hover:bg-red-50 hover:text-red-600", "disabled:cursor-not-allowed disabled:opacity-40")}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Trash2 className="size-3.5" />}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasChildren && expanded ? (
        <div className="ml-3 mt-1 flex flex-col gap-0.5 border-l border-slate-200 pl-2">
          {children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              category={child}
              selectedId={selectedId}
              collapsedIds={collapsedIds}
              busyId={busyId}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              onSelect={onSelect}
              onToggle={onToggle}
              onCreateChild={onCreateChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CategoryFormDialog({
  state,
  categories,
  saving,
  onSubmit,
  onClose,
}: {
  state: CategoryDialogState;
  /** 已按前序平铺的分类 */
  categories: MediaCategoryNode[];
  saving: boolean;
  onSubmit: (payload: CategoryFormPayload) => void;
  onClose: () => void;
}) {
  const isEdit = state.mode === "edit";
  const [name, setName] = useState(isEdit ? state.category.name : "");
  const [color, setColor] = useState(isEdit ? state.category.color || DEFAULT_CATEGORY_COLOR : DEFAULT_CATEGORY_COLOR);
  const [parentId, setParentId] = useState(
    isEdit ? state.category.parentId ?? "" : state.parentId ?? "",
  );
  const [nameAttempted, setNameAttempted] = useState(false);

  const parentCategory = categories.find((item) => item.id === (isEdit ? state.category.parentId : state.parentId));

  /** 移动目标：排除自己和自己的子孙，并保证移动后整棵子树不超过层数上限。 */
  const parentOptions = useMemo(() => {
    if (!isEdit) return [];
    const blocked = new Set(subtreeIds(state.category));
    const height = subtreeHeight(state.category);
    return categories.filter((option) => !blocked.has(option.id) && option.depth + height <= MAX_CATEGORY_DEPTH);
  }, [categories, isEdit, state]);

  function submit() {
    setNameAttempted(true);
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("请输入分类名称");
      return;
    }
    onSubmit({ name: trimmed, color, parentId: parentId || null });
  }

  return (
    <ModalShell
      title={isEdit ? "编辑分类" : parentCategory ? `在「${parentCategory.name}」下新增子分类` : "新增一级分类"}
      description={`分类最多 ${MAX_CATEGORY_DEPTH} 层，同级不能重名`}
      onClose={onClose}
    >
      <div className="space-y-4 px-5 py-4">
        <div className="space-y-1.5">
          <label htmlFor="media-category-name" className="text-xs font-semibold text-slate-600">
            分类名称 <span className="text-red-500">*</span>
          </label>
          <Input
            id="media-category-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            maxLength={40}
            placeholder="如：产品图"
            aria-invalid={nameAttempted && !name.trim()}
            aria-describedby={nameAttempted && !name.trim() ? "media-category-name-error" : undefined}
            className="material-input h-10 w-full rounded-lg px-3 text-xs"
          />
          {nameAttempted && !name.trim() ? <p id="media-category-name-error" role="alert" className="text-xs text-rose-700">请输入分类名称。</p> : null}
        </div>

        {isEdit ? (
          <div className="space-y-1.5">
            <label htmlFor="media-category-parent" className="text-xs font-semibold text-slate-600">
              父分类
            </label>
            <NativeSelect
              id="media-category-parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="material-input h-10 w-full rounded-lg px-2 text-xs"
            >
              <option value="">根分类</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-600">颜色</span>
          <div className="flex items-center gap-1.5">
            {CATEGORY_COLORS.map((option) => (
              <Button variant="unstyled"
                key={option}
                type="button"
                onClick={() => setColor(option)}
                aria-label={`选择颜色 ${option}`}
                aria-pressed={color === option}
                className={cn(
                  "size-6 cursor-pointer rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  color === option ? "border-slate-900" : "border-transparent hover:border-slate-300",
                )}
                style={{ backgroundColor: option }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={saving}
          className="hz-primary-action"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Check className="size-3.5" />}
          保存
        </Button>
      </div>
    </ModalShell>
  );
}

/** 给单件作品设置分类：图像库与视频库共用，只有标题文案不同。 */
export function AssignCategoryModal({
  subtitle,
  currentId,
  categories,
  onClose,
  onSelect,
}: {
  /** 弹窗里展示的作品说明，如提示词或视频标题 */
  subtitle: string;
  currentId: string | null;
  /** 已按前序平铺的分类，depth 决定缩进 */
  categories: MediaCategoryNode[];
  onClose: () => void;
  onSelect: (categoryId: string | null) => void;
}) {
  const rowClass = (active: boolean) =>
    cn(
      "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      active ? "border-primary bg-accent text-primary" : "border-slate-200 bg-white text-slate-600 hover:border-primary/25 hover:bg-slate-50",
    );

  return (
    <ModalShell title="设置分类" description="选择未分类或一个目标分类，作品归属会立即更新。" onClose={onClose}>
      <div className="flex-1 space-y-1 overflow-y-auto px-5 py-4">
        <p className="line-clamp-2 pb-2 text-xs leading-5 text-slate-500">{subtitle}</p>

        <Button variant="unstyled" type="button" onClick={() => onSelect(null)} className={rowClass(currentId === null)}>
          <span className="flex items-center gap-2">
            <FolderOpen className="size-3.5" />
            未分类
          </span>
          {currentId === null ? <Check className="size-4" /> : null}
        </Button>

        {categories.map((category) => (
          <Button variant="unstyled"
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            title={category.path}
            // 缩进走 padding：按钮是 w-full，用 margin 会把行推出容器右边缘
            style={{ paddingLeft: `${0.75 + (category.depth - 1) * 0.875}rem` }}
            className={rowClass(currentId === category.id)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderTree className="size-3.5 shrink-0" style={{ color: category.color || undefined }} />
              <span className="truncate">{category.name}</span>
            </span>
            {currentId === category.id ? <Check className="size-4 shrink-0" /> : null}
          </Button>
        ))}

        {categories.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">还没有分类，请先在左侧新建。</p>
        ) : null}
      </div>
    </ModalShell>
  );
}

/**
 * 作品库分类侧边栏：全部 / 未分类 / 分类树 + 新增、编辑、删除。
 * 组件自己管展开态、弹窗态与提交中状态；调用方只负责数据加载、接口调用与提示文案。
 */
export function MediaCategorySidebar({
  categories,
  loading,
  selectedId,
  onSelect,
  totalCount,
  uncategorizedCount,
  canCreate,
  canEdit,
  canDelete,
  itemNoun,
  allIcon: AllIcon = Images,
  onCreate,
  onUpdate,
  onDelete,
  className,
}: {
  categories: MediaCategoryNode[];
  loading: boolean;
  /** "" = 全部，UNCATEGORIZED_FILTER = 未分类，其余为分类 id */
  selectedId: string;
  onSelect: (id: string) => void;
  totalCount: number;
  uncategorizedCount: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** 空态与删除确认里的量词，如「作品」「视频」 */
  itemNoun: string;
  allIcon?: LucideIcon;
  onCreate: (payload: CategoryFormPayload) => Promise<void>;
  onUpdate: (category: MediaCategoryNode, payload: CategoryFormPayload) => Promise<void>;
  onDelete: (category: MediaCategoryNode) => Promise<void>;
  className?: string;
}) {
  // 默认全展开，只记录被主动折叠的节点：分类树刷新后不用重新播种展开状态
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<CategoryDialogState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaCategoryNode | null>(null);

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const deleteSubtree = deleteTarget ? flattenCategories([deleteTarget]) : [];
  const deleteChildCount = Math.max(0, deleteSubtree.length - 1);
  const deleteItemCount = deleteSubtree.reduce((sum, node) => sum + node.itemCount, 0);

  function toggleCollapsed(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(payload: CategoryFormPayload) {
    if (!dialog) return;
    setSaving(true);
    try {
      if (dialog.mode === "create") await onCreate(payload);
      else await onUpdate(dialog.category, payload);
      setDialog(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(category: MediaCategoryNode) {
    setBusyId(category.id);
    try {
      await onDelete(category);
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {/* ── 分类侧边栏（同研发知识库：白卡片 + 行内悬停操作 + 子级左边线缩进）── */}
      <aside className={cn("flex w-full flex-col gap-1 p-2.5 lg:w-72 lg:min-h-0 lg:shrink-0 lg:overflow-y-auto", SURFACE_CARD, className)}>
        <div className="flex items-center justify-between px-3 pb-2 pt-1 text-[11px] font-semibold uppercase text-muted-foreground">
          <span>分类</span>
          {canCreate ? (
            <Button variant="unstyled"
              type="button"
              onClick={() => setDialog({ mode: "create", parentId: null })}
              title="新增一级分类"
              aria-label="新增一级分类"
              className="flex size-6 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <Button variant="unstyled"
          type="button"
          onClick={() => onSelect("")}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            selectedId === "" ? SELECTED_ROW : UNSELECTED_ROW,
          )}
        >
          <span className="flex items-center gap-2">
            <AllIcon className="size-4" />
            全部
          </span>
          <span className="text-[11px] tabular-nums opacity-70">{totalCount}</span>
        </Button>

        <Button variant="unstyled"
          type="button"
          onClick={() => onSelect(UNCATEGORIZED_FILTER)}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            selectedId === UNCATEGORIZED_FILTER ? SELECTED_ROW : UNSELECTED_ROW,
          )}
        >
          <span className="flex items-center gap-2">
            <FolderOpen className="size-4" />
            未分类
          </span>
          <span className="text-[11px] tabular-nums opacity-70">{uncategorizedCount}</span>
        </Button>

        {categories.map((category) => (
          <CategoryTreeNode
            key={category.id}
            category={category}
            selectedId={selectedId}
            collapsedIds={collapsedIds}
            busyId={busyId}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
            onSelect={onSelect}
            onToggle={toggleCollapsed}
            onCreateChild={(parentId) => setDialog({ mode: "create", parentId })}
            onEdit={(target) => setDialog({ mode: "edit", category: target })}
            onDelete={setDeleteTarget}
          />
        ))}

        {categories.length === 0 ? (
          <p className="px-3 py-3 text-xs leading-5 text-muted-foreground">
            {loading
              ? "分类加载中…"
              : canCreate
                ? "还没有分类，点右上角 + 新建。"
                : "还没有分类。"}
          </p>
        ) : null}
      </aside>

      {dialog ? (
        <CategoryFormDialog
          state={dialog}
          categories={flatCategories}
          saving={saving}
          onSubmit={(payload) => void handleSubmit(payload)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !busyId) setDeleteTarget(null); }}>
        <AlertDialogContent className="horizon-portal">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">确认删除分类“{deleteTarget?.name ?? "当前分类"}”？</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {deleteChildCount > 0 ? `将同时删除 ${deleteChildCount} 个子分类。` : "该分类没有子分类。"}
              {deleteItemCount > 0
                ? ` ${deleteItemCount} 件${itemNoun}会转为未分类，但${itemNoun}本身不会被删除。`
                : ` 分类中没有${itemNoun}，不会删除任何${itemNoun}。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={!deleteTarget || Boolean(busyId)}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) void handleDelete(deleteTarget);
              }}
            >
              {busyId ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="size-4" />}
              {busyId ? "正在删除" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
