import { useMemo, useState } from "react";
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
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

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

/** 侧边栏选中态：与研发知识库同款主色块 */
const SELECTED_ROW = "bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.16)]";
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
  widthClass = "max-w-md",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/48 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={cn("flex max-h-[82vh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.32)]", widthClass)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-[11px] text-slate-400">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
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
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
    selected ? "text-white/80 hover:bg-white/15 hover:text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
  );

  return (
    <div className="group/category w-full">
      <div className={cn("flex items-center rounded-md transition-colors duration-200", selected ? SELECTED_ROW : UNSELECTED_ROW)}>
        <button
          type="button"
          onClick={() => {
            onSelect(category.id);
            if (hasChildren) onToggle(category.id);
          }}
          title={category.path}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 py-2 pl-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
            hasActions ? "rounded-l-md pr-1" : "rounded-md pr-3",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderTree
              className="h-4 w-4 shrink-0"
              style={selected ? undefined : { color: category.color || undefined }}
            />
            <span className="truncate">{category.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[11px] tabular-nums opacity-70">{category.totalItemCount}</span>
            <span className="flex h-4 w-3.5 items-center justify-center">
              {hasChildren ? (
                <ChevronRight className={cn("h-3.5 w-3.5 opacity-45 transition-transform", expanded && "rotate-90")} />
              ) : null}
            </span>
          </span>
        </button>

        {hasActions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 pr-1 transition-opacity",
              !selected && "lg:opacity-55 lg:group-hover/category:opacity-100",
            )}
          >
            {canAddChild ? (
              <button
                type="button"
                onClick={() => onCreateChild(category.id)}
                title="新增子分类"
                aria-label={`在 ${category.name} 下新增子分类`}
                className={actionClass}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={() => onEdit(category)}
                title="编辑分类"
                aria-label={`编辑分类 ${category.name}`}
                className={actionClass}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                onClick={() => onDelete(category)}
                disabled={busy}
                title="删除分类"
                aria-label={`删除分类 ${category.name}`}
                className={cn(actionClass, selected ? "hover:text-white" : "hover:bg-red-50 hover:text-red-600", "disabled:cursor-not-allowed disabled:opacity-40")}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
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

  const parentCategory = categories.find((item) => item.id === (isEdit ? state.category.parentId : state.parentId));

  /** 移动目标：排除自己和自己的子孙，并保证移动后整棵子树不超过层数上限。 */
  const parentOptions = useMemo(() => {
    if (!isEdit) return [];
    const blocked = new Set(subtreeIds(state.category));
    const height = subtreeHeight(state.category);
    return categories.filter((option) => !blocked.has(option.id) && option.depth + height <= MAX_CATEGORY_DEPTH);
  }, [categories, isEdit, state]);

  function submit() {
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
          <input
            id="media-category-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            maxLength={40}
            placeholder="如：产品图"
            className="material-input h-10 w-full rounded-md px-3 text-xs"
          />
        </div>

        {isEdit ? (
          <div className="space-y-1.5">
            <label htmlFor="media-category-parent" className="text-xs font-semibold text-slate-600">
              父分类
            </label>
            <select
              id="media-category-parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="material-input h-10 w-full rounded-md px-2 text-xs"
            >
              <option value="">根分类</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.path}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-600">颜色</span>
          <div className="flex items-center gap-1.5">
            {CATEGORY_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setColor(option)}
                aria-label={`选择颜色 ${option}`}
                aria-pressed={color === option}
                className={cn(
                  "h-6 w-6 cursor-pointer rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                  color === option ? "border-slate-900" : "border-transparent hover:border-slate-300",
                )}
                style={{ backgroundColor: option }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 cursor-pointer items-center rounded-md border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          保存
        </button>
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
      "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
      active ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200/70 bg-white text-slate-600 hover:border-indigo-200 hover:bg-slate-50",
    );

  return (
    <ModalShell title="设置分类" onClose={onClose}>
      <div className="flex-1 space-y-1 overflow-y-auto px-5 py-4">
        <p className="line-clamp-2 pb-2 text-xs leading-5 text-slate-500">{subtitle}</p>

        <button type="button" onClick={() => onSelect(null)} className={rowClass(currentId === null)}>
          <span className="flex items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5" />
            未分类
          </span>
          {currentId === null ? <Check className="h-4 w-4" /> : null}
        </button>

        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            title={category.path}
            // 缩进走 padding：按钮是 w-full，用 margin 会把行推出容器右边缘
            style={{ paddingLeft: `${0.75 + (category.depth - 1) * 0.875}rem` }}
            className={rowClass(currentId === category.id)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderTree className="h-3.5 w-3.5 shrink-0" style={{ color: category.color || undefined }} />
              <span className="truncate">{category.name}</span>
            </span>
            {currentId === category.id ? <Check className="h-4 w-4 shrink-0" /> : null}
          </button>
        ))}

        {categories.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">还没有分类，请先在左侧新建。</p>
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

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

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
    const subtree = flattenCategories([category]);
    const childCount = subtree.length - 1;
    const itemCount = subtree.reduce((sum, node) => sum + node.itemCount, 0);
    const detail = [
      childCount > 0 ? `连同 ${childCount} 个子分类` : "",
      itemCount > 0 ? `${itemCount} 件${itemNoun}将转为未分类` : "",
    ]
      .filter(Boolean)
      .join("，");
    if (!window.confirm(`确定删除分类「${category.name}」？${detail ? `${detail}。` : ""}${itemNoun}本身不会被删除。`)) {
      return;
    }

    setBusyId(category.id);
    try {
      await onDelete(category);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {/* ── 分类侧边栏（同研发知识库：白卡片 + 行内悬停操作 + 子级左边线缩进）── */}
      <aside className={cn("flex w-full flex-col gap-1 p-2.5 lg:w-72 lg:min-h-0 lg:shrink-0 lg:overflow-y-auto", SURFACE_CARD, className)}>
        <div className="flex items-center justify-between px-3 pb-2 pt-1 text-[11px] font-semibold uppercase text-slate-400">
          <span>分类</span>
          {canCreate ? (
            <button
              type="button"
              onClick={() => setDialog({ mode: "create", parentId: null })}
              title="新增一级分类"
              aria-label="新增一级分类"
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onSelect("")}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
            selectedId === "" ? SELECTED_ROW : UNSELECTED_ROW,
          )}
        >
          <span className="flex items-center gap-2">
            <AllIcon className="h-4 w-4" />
            全部
          </span>
          <span className="text-[11px] tabular-nums opacity-70">{totalCount}</span>
        </button>

        <button
          type="button"
          onClick={() => onSelect(UNCATEGORIZED_FILTER)}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
            selectedId === UNCATEGORIZED_FILTER ? SELECTED_ROW : UNSELECTED_ROW,
          )}
        >
          <span className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            未分类
          </span>
          <span className="text-[11px] tabular-nums opacity-70">{uncategorizedCount}</span>
        </button>

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
            onDelete={(target) => void handleDelete(target)}
          />
        ))}

        {categories.length === 0 ? (
          <p className="px-3 py-3 text-xs leading-5 text-slate-400">
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
    </>
  );
}
