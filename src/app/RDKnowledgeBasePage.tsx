import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Cpu,
  Edit3,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderPlus,
  FlaskConical,
  FolderOpen,
  Link,
  Loader2,
  MoveRight,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { NativeSelect } from "./components/ui/native-select";
import { Separator } from "./components/ui/separator";
import { Slider } from "./components/ui/slider";
import { Textarea } from "./components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { cn } from "./components/ui/utils";
import { useAuth } from "./auth";
import { hasPermission } from "./lib/permissions";
import {
  fetchKbCategories,
  fetchKbEntries,
  fetchKbEntry,
  createKbCategory,
  updateKbCategory,
  deleteKbCategory,
  deleteKbEntry,
  moveKbEntry,
  uploadKbFiles,
  classifyKbFiles,
  recordKbView,
  repairKbFilenames,
  type KbCategory,
  type KbEntry,
  type KbVisibility,
  type KbClassifyResult,
} from "./lib/rdApi";

// ── Constants ─────────────────────────────────────────────────────────────────

const KB_PAGE_SIZE = 12;

const FILE_TYPE_FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'pdf', label: 'PDF' },
  { value: 'doc', label: '文档' },
  { value: 'video', label: '视频' },
  { value: 'other', label: '其他' },
] as const;

/**
 * Map a 0-100 permission score to display config.
 * Legacy values 1-5 (old level system) fall in the "公开" band — still readable.
 */
function getPermissionScoreConfig(score: number): {
  label: string;
  badgeClass: string;
  sliderClass: string;
} {
  if (score <= 25) return {
    label: '公开',
    badgeClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    sliderClass: '[&_[data-slot=slider-range]]:bg-emerald-500',
  };
  if (score <= 50) return {
    label: '内部',
    badgeClass: 'text-blue-700 bg-blue-50 border-blue-200',
    sliderClass: '[&_[data-slot=slider-range]]:bg-blue-500',
  };
  if (score <= 75) return {
    label: '受限',
    badgeClass: 'text-amber-700 bg-amber-50 border-amber-200',
    sliderClass: '[&_[data-slot=slider-range]]:bg-amber-500',
  };
  return {
    label: '机密',
    badgeClass: 'text-red-700 bg-red-50 border-red-200',
    sliderClass: '[&_[data-slot=slider-range]]:bg-red-500',
  };
}

const SOURCE_CONFIG = {
  task_attachment: { label: '任务附件', className: 'bg-violet-50 text-violet-700' },
  manual: { label: '手动上传', className: 'bg-slate-100 text-slate-600' },
  import: { label: '批量导入', className: 'bg-sky-50 text-sky-700' },
};

const CAT_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Cpu,
  Code2,
  FlaskConical,
  ShieldCheck,
  Archive,
  FolderOpen,
  BookOpen,
};

// ── Helper functions ──────────────────────────────────────────────────────────

function getFileType(
  fileName?: string | null,
  _mime?: string | null,
): 'image' | 'pdf' | 'doc' | 'video' | 'link' | 'other' {
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return 'doc';
  if (['mp4', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
  return 'other';
}

function getCatIcon(iconName?: string) {
  return (iconName && CAT_ICON_MAP[iconName]) ?? FolderOpen;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function formatSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Imperatively download / open a KB entry — handles OSS URLs, lazy base64 fetch, and external links. */
async function downloadKbEntry(entry: KbEntry): Promise<void> {
  if (entry.external_url) {
    window.open(entry.external_url, '_blank');
    return;
  }
  const directUrl = entry.oss_url ?? null;
  if (directUrl) {
    const a = document.createElement('a');
    a.href = directUrl;
    a.download = entry.file_name ?? entry.title;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  if (entry.has_data_file) {
    try {
      const full = await fetchKbEntry(entry.id);
      const url = full.oss_url ?? full.data_url;
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = entry.file_name ?? entry.title;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        toast.error('文件内容不可用');
      }
    } catch {
      toast.error('获取文件内容失败');
    }
    return;
  }
  toast.error('该条目没有可下载的文件');
}

function flattenCategories(cats: KbCategory[]): KbCategory[] {
  const result: KbCategory[] = [];
  for (const cat of cats) {
    result.push(cat);
    if (cat.children) {
      for (const child of cat.children) {
        result.push(child);
      }
    }
  }
  return result;
}

function findCategoryById(categories: KbCategory[], id?: string | null): KbCategory | null {
  if (!id) return null;
  for (const category of categories) {
    if (category.id === id) return category;
    const found = findCategoryById(category.children ?? [], id);
    if (found) return found;
  }
  return null;
}

function getCategoryTotalEntryCount(category: KbCategory): number {
  const fromApi = Number(category.total_entry_count);
  if (Number.isFinite(fromApi)) return fromApi;
  const direct = Number(category.entry_count);
  return (Number.isFinite(direct) ? direct : 0) +
    (category.children ?? []).reduce((sum, child) => sum + getCategoryTotalEntryCount(child), 0);
}

function collectCategoryIds(category: KbCategory): string[] {
  return [category.id, ...(category.children ?? []).flatMap(collectCategoryIds)];
}

function getCategoryScopeIds(categories: KbCategory[], selectedId: string | null): Set<string> | null {
  if (!selectedId) return null;
  const selected = findCategoryById(categories, selectedId);
  return new Set(selected ? collectCategoryIds(selected) : [selectedId]);
}

function updateCategoryCountsForMove(
  categories: KbCategory[],
  fromCategoryId: string,
  toCategoryId: string,
): KbCategory[] {
  if (!fromCategoryId || !toCategoryId || fromCategoryId === toCategoryId) return categories;

  const updateNode = (category: KbCategory): KbCategory => {
    const directCount = Math.max(
      0,
      Number(category.entry_count ?? 0) +
        (category.id === fromCategoryId ? -1 : 0) +
        (category.id === toCategoryId ? 1 : 0),
    );
    const children = (category.children ?? []).map(updateNode);
    const childTotal = children.reduce((sum, child) => sum + getCategoryTotalEntryCount(child), 0);

    return {
      ...category,
      entry_count: directCount,
      total_entry_count: directCount + childTotal,
      children,
    };
  };

  return categories.map(updateNode);
}

function fileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]): File[] {
  const seen = new Set(current.map(fileKey));
  const next = [...current];

  for (const file of incoming) {
    const key = fileKey(file);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(file);
    }
  }

  return next;
}

function toListEntry(entry: KbEntry): KbEntry {
  const { data_url, ...rest } = entry;
  return {
    ...rest,
    has_data_file: Boolean(data_url) || Boolean(rest.has_data_file) || Boolean(rest.oss_url),
  };
}

function dragEventHasFiles(event: React.DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FileTypeIcon({ entry, className }: { entry: KbEntry; className?: string }) {
  const t = getFileType(entry.file_name, entry.file_type);
  if (t === 'image') return <FileImage className={cn('text-emerald-500', className)} />;
  if (t === 'pdf') return <FileText className={cn('text-red-500', className)} />;
  if (t === 'doc') return <FileSpreadsheet className={cn('text-blue-500', className)} />;
  if (t === 'video') return <FileVideo className={cn('text-violet-500', className)} />;
  if (entry.external_url) return <Link className={cn('text-sky-500', className)} />;
  return <File className={cn('text-slate-400', className)} />;
}

// ── Entry Card ────────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: KbEntry;
  canManage: boolean;
  onDelete: (entry: KbEntry) => void;
  onMove: (entry: KbEntry) => void;
  onPreview: (entry: KbEntry) => void;
}

const EntryCard = React.memo(React.forwardRef<HTMLDivElement, EntryCardProps>(function EntryCard(
  { entry, canManage, onDelete, onMove, onPreview },
  ref,
) {
  const fileType = getFileType(entry.file_name, entry.file_type);
  const srcCfg = SOURCE_CONFIG[entry.source] ?? SOURCE_CONFIG.manual;
  const hasFile = entry.has_data_file || !!entry.oss_url;
  const hasAction = hasFile || !!entry.external_url;
  const isPreviewable = (fileType === 'image' || fileType === 'pdf' || fileType === 'video') && hasFile;

  return (
    <div
      ref={ref}
      className="group relative overflow-hidden bg-white rounded-lg border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 flex flex-col gap-3 transition-shadow duration-200 hover:shadow-[0_6px_20px_rgba(30,64,175,0.08)] hover:border-blue-200/80 [content-visibility:auto] [contain-intrinsic-size:260px]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-400 opacity-60 transition-opacity duration-200 group-hover:opacity-100" />

      {/* Icon + title + description */}
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 p-2 bg-slate-50 rounded-lg ring-1 ring-slate-200/70">
          <FileTypeIcon entry={entry} className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 leading-snug break-words">{entry.title}</p>
          {entry.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{entry.description}</p>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="secondary" className={cn('text-[11px] font-medium px-2 py-0.5 rounded-md ring-1 ring-inset ring-current/10', srcCfg.className)}>
          {srcCfg.label}
        </Badge>
        {(() => {
          const score = entry.permission_level ?? 0;
          const cfg = getPermissionScoreConfig(score);
          return (
            <div
              className={cn('flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold border cursor-default select-none', cfg.badgeClass)}
              title={`权限分值 ${score}/100 · ${cfg.label}，用户分值 ≥ ${score} 方可访问`}
            >
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span>{score}</span>
              <span className="relative h-1.5 w-11 overflow-hidden rounded-full bg-white/70 ring-1 ring-current/10">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-current/70"
                  style={{ width: `${score}%` }}
                />
              </span>
              <span className="font-normal opacity-70">{cfg.label}</span>
            </div>
          );
        })()}
      </div>

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag className="w-3 h-3 text-slate-400 shrink-0" />
          {entry.tags.slice(0, 3).map((tag) => (
            <Badge variant="secondary" key={tag} className="text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md ring-1 ring-inset ring-slate-200/70">
              {tag}
            </Badge>
          ))}
          {entry.tags.length > 3 && <span className="text-[11px] text-slate-400">+{entry.tags.length - 3}</span>}
        </div>
      )}

      {/* Uploader + stats */}
      <div className="flex items-center gap-2 mt-auto pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0 shadow-sm">
            {(entry.created_by_name ?? '?').charAt(0).toUpperCase()}
          </div>
          <span className="text-[11px] text-slate-600 font-medium truncate">{entry.created_by_name ?? '未知'}</span>
          <span className="text-[11px] text-slate-400 shrink-0">· {relativeTime(entry.created_at)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-400">
          <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" />{entry.view_count}</span>
          <span className="flex items-center gap-0.5"><ArrowDownToLine className="w-3 h-3" />{entry.download_count}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100/80">
        {isPreviewable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPreview(entry)}
            className="h-8 flex-1 rounded-lg border-blue-100 bg-blue-50/70 px-2.5 text-xs font-semibold text-blue-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] hover:border-blue-200 hover:bg-blue-100"
          >
            <Eye className="w-3.5 h-3.5" />
            预览
          </Button>
        )}
        {hasAction && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void downloadKbEntry(entry)}
            className={cn(
              "h-8 rounded-lg px-2.5 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]",
              isPreviewable ? "flex-1" : "flex-1 border-blue-100 bg-blue-50/70 text-blue-700 hover:border-blue-200 hover:bg-blue-100",
              isPreviewable && "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
            )}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            {entry.external_url ? '打开链接' : '下载'}
          </Button>
        )}
        {canManage && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onMove(entry)}
              className="ml-auto h-7 px-2.5 text-xs font-medium text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-md gap-1.5"
            >
              <MoveRight className="w-3.5 h-3.5" />
              移动
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDelete(entry)}
              className="h-7 px-2.5 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 rounded-md gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </Button>
          </>
        )}
      </div>
    </div>
  );
}));

EntryCard.displayName = "EntryCard";

// ── Category Sidebar ──────────────────────────────────────────────────────────

interface CategorySidebarProps {
  categories: KbCategory[];
  selectedCatId: string | null;
  canManage: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (parentId: string | null) => void;
  onEdit: (category: KbCategory) => void;
  onDelete: (category: KbCategory) => void;
  categoryFileCounts: Record<string, number>;
}

const CategorySidebar = React.memo(function CategorySidebar({
  categories,
  selectedCatId,
  canManage,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  categoryFileCounts,
}: CategorySidebarProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderActions = (category: KbCategory, allowChild: boolean) => {
    if (!canManage) return null;
    const locked = (categoryFileCounts[category.id] ?? 0) > 0;
    const selected = selectedCatId === category.id;
    const actionClass = cn(
      "h-6 w-6 rounded-md transition-colors disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-35",
      selected
        ? "text-white/80 hover:bg-white/15 hover:text-white"
        : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
    );
    const stopAction = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    };

    return (
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 pr-1 opacity-100 transition-opacity",
          !selected && "lg:opacity-55 lg:group-hover/category:opacity-100",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {allowChild && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(event) => {
              stopAction(event);
              onCreate(category.id);
            }}
            className={actionClass}
            title="新增子类目"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={locked}
          onClick={(event) => {
            stopAction(event);
            if (!locked) {
              onEdit(category);
            }
          }}
          className={actionClass}
          title={locked ? "类目下有文件，需先移动文件后编辑" : "编辑类目"}
        >
          <Edit3 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={locked || category.id === 'kb-other'}
          onClick={(event) => {
            stopAction(event);
            if (!locked && category.id !== 'kb-other') {
              onDelete(category);
            }
          }}
          className={cn(actionClass, selected ? "hover:text-white" : "hover:text-red-600 hover:bg-red-50")}
          title={locked ? "类目下有文件，需先移动文件后删除" : category.id === 'kb-other' ? "默认类目不能删除" : "删除类目"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  };

  return (
    <Card className="w-full lg:w-80 lg:shrink-0 bg-white rounded-lg border border-slate-200/80 p-2.5 flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-y-auto shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="hidden lg:flex items-center justify-between px-3 pb-2 pt-1 text-[11px] font-semibold uppercase text-slate-400">
        <span>知识域</span>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onCreate(null)}
              className="h-6 w-6 rounded-md text-slate-400 hover:bg-blue-50 hover:text-blue-700"
              title="新增一级类目"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {/* All */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSelect(null)}
        className={cn(
          'h-auto min-w-max lg:min-w-0 justify-between w-full px-3 py-2 rounded-md text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-300',
          selectedCatId === null
            ? 'bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(37,99,235,0.16)]'
            : 'text-slate-600 hover:bg-slate-50',
        )}
      >
        <span className="flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          全部
        </span>
      </Button>

      {/* Category tree */}
      {categories.map((cat) => {
        const CatIcon = getCatIcon(cat.icon);
        const hasChildren = cat.children && cat.children.length > 0;
        const isExpanded = expandedIds.has(cat.id);
        const isSelected = selectedCatId === cat.id;

        return (
          <div key={cat.id} className="group/category lg:w-full">
            <div
              className={cn(
                'flex min-w-max items-center rounded-md transition-colors duration-200 lg:min-w-0',
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(37,99,235,0.16)]'
                  : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onSelect(cat.id);
                  if (hasChildren) toggleExpand(cat.id);
                }}
                className={cn(
                  'h-auto min-w-0 flex-1 justify-between px-3 py-2 text-sm font-medium text-current hover:bg-transparent hover:text-current focus-visible:ring-2 focus-visible:ring-blue-300',
                  canManage ? 'rounded-r-none pr-1' : 'rounded-md',
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <CatIcon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{cat.label}</span>
                </span>
                <div className="flex h-5 w-5 shrink-0 items-center justify-end">
                  {hasChildren && (
                    <ChevronRight
                      className={cn(
                        'w-3.5 h-3.5 text-current/45 transition-transform',
                        isExpanded && 'rotate-90',
                      )}
                    />
                  )}
                </div>
              </Button>
              {renderActions(cat, true)}
            </div>

            {/* Children */}
            {hasChildren && isExpanded && (
              <div className="ml-3 mt-1 hidden flex-col gap-0.5 border-l border-slate-200 pl-2 lg:flex">
                {cat.children!.map((child) => {
                  const ChildIcon = getCatIcon(child.icon);
                  const isChildSelected = selectedCatId === child.id;
                  return (
                    <div
                      key={child.id}
                      className={cn(
                        'group/category flex w-full items-center rounded-md transition-colors duration-200',
                        isChildSelected
                          ? 'bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(37,99,235,0.16)]'
                          : 'text-slate-500 hover:bg-slate-50',
                      )}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelect(child.id)}
                        className={cn(
                          'h-auto min-w-0 flex-1 justify-between px-2 py-1.5 text-xs font-medium text-current hover:bg-transparent hover:text-current focus-visible:ring-2 focus-visible:ring-blue-300',
                          canManage ? 'rounded-r-none pr-1' : 'rounded-md',
                        )}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <ChildIcon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{child.label}</span>
                        </span>
                      </Button>
                      {renderActions(child, false)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
});

CategorySidebar.displayName = "CategorySidebar";

// ── Category Management Dialogs ───────────────────────────────────────────────

type CategoryDialogState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'edit'; category: KbCategory };

type CategorySubmitPayload = {
  label: string;
  parent_id?: string;
  icon?: string;
  color?: string;
};

const CATEGORY_ICON_OPTIONS = [
  { value: 'BookOpen', label: '通用', icon: BookOpen },
  { value: 'Cpu', label: '硬件', icon: Cpu },
  { value: 'Code2', label: '软件', icon: Code2 },
  { value: 'FlaskConical', label: '测试', icon: FlaskConical },
  { value: 'ShieldCheck', label: '规范', icon: ShieldCheck },
  { value: 'Archive', label: '归档', icon: Archive },
  { value: 'FolderOpen', label: '其他', icon: FolderOpen },
];

const CATEGORY_COLOR_OPTIONS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#6366f1', '#0ea5e9', '#64748b'];

function CategoryFormDialog({
  state,
  categories,
  saving,
  onSubmit,
  onClose,
}: {
  state: CategoryDialogState;
  categories: KbCategory[];
  saving: boolean;
  onSubmit: (payload: CategorySubmitPayload) => void;
  onClose: () => void;
}) {
  const isEdit = state.mode === 'edit';
  const [label, setLabel] = useState(isEdit ? state.category.label : '');
  const [icon, setIcon] = useState(isEdit ? (state.category.icon ?? 'FolderOpen') : 'FolderOpen');
  const [color, setColor] = useState(isEdit ? (state.category.color ?? '#3b82f6') : '#3b82f6');
  const parentCategory = state.mode === 'create' ? findCategoryById(categories, state.parentId) : null;
  const ParentIcon = getCatIcon(parentCategory?.icon);

  useEffect(() => {
    setLabel(isEdit ? state.category.label : '');
    setIcon(isEdit ? (state.category.icon ?? 'FolderOpen') : 'FolderOpen');
    setColor(isEdit ? (state.category.color ?? '#3b82f6') : '#3b82f6');
  }, [isEdit, state]);

  const trimmedLabel = label.trim();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)] [&>button]:hidden">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              {isEdit ? <Edit3 className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}
            </span>
            {isEdit ? '编辑知识库类目' : '新增知识库类目'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            设置知识库类目的名称、图标和颜色。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">所属层级</Label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <ParentIcon className="h-4 w-4 text-slate-500" />
                <span>{parentCategory ? `${parentCategory.label} / 子类目` : '一级类目'}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">类目名称 *</Label>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={40}
              placeholder="例如：硬件研发"
              className="h-10 rounded-lg border-slate-200 bg-white text-sm focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-600">图标</Label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORY_ICON_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = icon === option.value;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    onClick={() => setIcon(option.value)}
                    className={cn(
                      "h-10 rounded-lg px-2 text-xs",
                      selected
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-600">颜色</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLOR_OPTIONS.map((value) => {
                const selected = color === value;
                return (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setColor(value)}
                    className={cn(
                      "h-8 w-8 rounded-lg border-slate-200 bg-white p-1 hover:bg-slate-50",
                      selected && "border-blue-300 ring-2 ring-blue-100",
                    )}
                    title={value}
                  >
                    <span className="flex h-full w-full items-center justify-center rounded-md" style={{ backgroundColor: value }}>
                      {selected && <Check className="h-3.5 w-3.5 text-white" />}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>

          {isEdit && getCategoryTotalEntryCount(state.category) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
              该类目下已有文件，后端会拒绝编辑。请先将文件移动到其他类目后再修改。
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-slate-100 px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving} className="h-9 rounded-lg px-4 text-slate-600">
            取消
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit({
              label: trimmedLabel,
              parent_id: isEdit ? undefined : (state.parentId || undefined),
              icon,
              color,
            })}
            disabled={saving || !trimmedLabel}
            className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? '保存修改' : '创建类目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCategoryDialog({
  category,
  loading,
  onConfirm,
  onCancel,
}: {
  category: KbCategory;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)] [&>button]:hidden">
        <DialogTitle className="sr-only">确认删除知识库类目</DialogTitle>
        <DialogDescription className="sr-only">
          删除空的知识库类目，已有文件的类目不能删除。
        </DialogDescription>
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 ring-1 ring-red-100">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-950">确认删除类目</h3>
              <p className="mt-0.5 text-xs text-slate-400">仅空类目允许删除</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
            {category.label}
          </div>
          <p className="text-xs leading-5 text-slate-500">
            删除后该类目会从知识域导航移除；如果类目下存在文件，接口会拒绝删除。
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading} className="h-8 rounded-lg px-4 text-sm text-slate-600">
            取消
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading} className="h-8 rounded-lg bg-red-500 px-4 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MoveEntryDialog({
  entry,
  categories,
  loading,
  onConfirm,
  onCancel,
}: {
  entry: KbEntry;
  categories: KbCategory[];
  loading: boolean;
  onConfirm: (categoryId: string) => void;
  onCancel: () => void;
}) {
  const flatCats = useMemo(() => flattenCategories(categories), [categories]);
  const [targetId, setTargetId] = useState(entry.category_id);

  useEffect(() => {
    setTargetId(entry.category_id);
  }, [entry]);

  const currentCategory = flatCats.find((category) => category.id === entry.category_id);
  const targetCategory = flatCats.find((category) => category.id === targetId);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)] [&>button]:hidden">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <MoveRight className="h-4 w-4" />
            </span>
            移动文件类目
          </DialogTitle>
          <DialogDescription className="sr-only">
            选择目标类目并将当前知识库文件移动过去。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <FileTypeIcon entry={entry} className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{entry.title}</p>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                当前：{currentCategory?.label ?? entry.category_id}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">目标类目</Label>
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
              {flatCats.map((category) => (
                <Button
                  key={category.id}
                  type="button"
                  variant={targetId === category.id ? "default" : "ghost"}
                  onClick={() => setTargetId(category.id)}
                  className={cn(
                    "h-8 justify-start rounded-md px-2 text-xs",
                    targetId === category.id
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {(() => {
                    const Icon = getCatIcon(category.icon);
                    return <Icon className="h-3.5 w-3.5" />;
                  })()}
                  <span className={cn("truncate", !categories.some((parent) => parent.id === category.id) && "pl-3")}>
                    {category.label}
                  </span>
                  {targetId === category.id && <Check className="ml-auto h-3.5 w-3.5" />}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              {targetCategory ? `将移动到：${targetCategory.label}` : '请选择目标类目'}
            </p>
          </div>
        </div>
        <DialogFooter className="border-t border-slate-100 px-5 py-4">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading} className="h-9 rounded-lg px-4 text-slate-600">
            取消
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(targetId)}
            disabled={loading || !targetId || targetId === entry.category_id}
            className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            确认移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  entry: KbEntry;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({ entry, loading, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.22)] [&>button]:hidden">
        <DialogTitle className="sr-only">确认删除文件</DialogTitle>
        <DialogDescription className="sr-only">
          删除知识库文件，此操作不可撤销。
        </DialogDescription>
        <div className="p-6 flex flex-col gap-4">
          {/* Icon + heading */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100">
              <Trash2 className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">确认删除文件</h3>
              <p className="text-xs text-slate-400 mt-0.5">此操作不可撤销</p>
            </div>
          </div>
          {/* File preview row */}
          <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2.5 flex items-center gap-2.5">
            <FileTypeIcon entry={entry} className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-slate-800 font-medium truncate">{entry.title}</p>
              {entry.file_name && entry.file_name !== entry.title && (
                <p className="text-xs text-slate-400 mt-0.5 truncate">{entry.file_name}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            删除后文件数据将被永久移除，相关访问链接同步失效，无法恢复。
          </p>
        </div>
        <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={loading}
            className="h-8 px-4 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="h-8 px-4 text-sm font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg shadow-[0_4px_12px_rgba(239,68,68,0.28)] focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-1"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

interface PreviewModalProps {
  entry: KbEntry;
  onClose: () => void;
}

function PreviewModal({ entry, onClose }: PreviewModalProps) {
  const fileType = getFileType(entry.file_name, entry.file_type);
  const [fileUrl, setFileUrl] = React.useState<string | null>(entry.oss_url ?? null);
  const [loading, setLoading] = React.useState(false);
  const permScore = entry.permission_level ?? 0;
  const permCfg = getPermissionScoreConfig(permScore);
  const srcCfg = SOURCE_CONFIG[entry.source] ?? SOURCE_CONFIG.manual;
  const isDarkBg = fileType === 'image' || fileType === 'video';
  const canPreview = fileType === 'image' || fileType === 'pdf' || fileType === 'video';
  const hasDownloadable = entry.has_data_file || !!entry.oss_url || !!entry.external_url;

  React.useEffect(() => {
    if (fileUrl || !entry.has_data_file) return;
    setLoading(true);
    fetchKbEntry(entry.id)
      .then((full) => setFileUrl(full.oss_url ?? full.data_url ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [entry.id, entry.has_data_file, fileUrl]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl w-[calc(100vw-2rem)] gap-0 rounded-2xl border-0 bg-white p-0 shadow-[0_32px_80px_rgba(15,23,42,0.36)] [&>button]:hidden overflow-hidden">
        <DialogDescription className="sr-only">
          预览知识库文件并查看文件元数据。
        </DialogDescription>

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 bg-white">
          {/* File icon */}
          <div className="shrink-0 p-2 rounded-lg bg-slate-50 ring-1 ring-slate-200/80">
            <FileTypeIcon entry={entry} className="w-4 h-4" />
          </div>

          {/* Title + meta */}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold text-slate-900 truncate leading-snug">
              {entry.title}
            </DialogTitle>
            <div className="flex items-center gap-2 mt-0.5">
              {entry.file_name && entry.file_name !== entry.title && (
                <span className="text-[11px] text-slate-400 truncate min-w-0">{entry.file_name}</span>
              )}
              {entry.file_size && (
                <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 h-4 bg-slate-100 text-slate-500 border-0 font-mono">
                  {formatSize(entry.file_size)}
                </Badge>
              )}
            </div>
          </div>

          {/* Permission score pill (simplified — slider moved to tooltip) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border shrink-0 cursor-default select-none',
                permCfg.badgeClass,
              )}>
                <ShieldCheck className="w-3 h-3 shrink-0" />
                <span className="tabular-nums">{permScore}</span>
                <span className="opacity-70">· {permCfg.label}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="space-y-1.5">
                <p className="font-semibold">权限分值 {permScore}/100 · {permCfg.label}</p>
                <Slider
                  value={[permScore]}
                  min={0}
                  max={100}
                  step={5}
                  disabled
                  className={cn(
                    'w-40 pointer-events-none data-[disabled]:opacity-100 [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:hidden',
                    permCfg.sliderClass,
                  )}
                />
                <p className="opacity-70 text-[11px]">用户分值 ≥ {permScore} 方可访问</p>
              </div>
            </TooltipContent>
          </Tooltip>

          {hasDownloadable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void downloadKbEntry(entry)}
              className="h-8 shrink-0 gap-1.5 rounded-lg border-blue-200 bg-blue-50/70 px-3 text-xs font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-100"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{entry.external_url ? '打开链接' : '下载'}</span>
            </Button>
          )}

          {/* Close button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* ── Preview body ── */}
        <div className={cn(
          'flex items-center justify-center overflow-hidden',
          isDarkBg
            ? 'bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 min-h-[320px]'
            : fileType === 'pdf'
              ? 'bg-slate-100'
              : 'bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:18px_18px] bg-white min-h-[240px]',
        )}>
          {loading && (
            <div className="flex flex-col items-center gap-3 py-14 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
              <p className="text-sm font-medium">正在加载文件…</p>
            </div>
          )}

          {/* Image preview */}
          {!loading && fileType === 'image' && fileUrl && (
            <div className="flex items-center justify-center w-full p-4">
              <img
                src={fileUrl}
                alt={entry.title}
                className="max-w-full max-h-[70vh] object-contain rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
                draggable={false}
              />
            </div>
          )}

          {/* PDF viewer */}
          {!loading && fileType === 'pdf' && fileUrl && (
            <iframe
              src={fileUrl}
              className="w-full h-[70vh] border-0"
              title={entry.title}
            />
          )}

          {/* Video player */}
          {!loading && fileType === 'video' && fileUrl && (
            <video
              src={fileUrl}
              controls
              className="max-w-full max-h-[70vh] outline-none rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
            />
          )}

          {/* Previewable type but URL failed to load */}
          {!loading && canPreview && !fileUrl && (
            <div className="flex flex-col items-center gap-4 py-14">
              <div className="p-5 rounded-2xl bg-slate-100 ring-1 ring-slate-200">
                <FileTypeIcon entry={entry} className="w-12 h-12 text-slate-300" />
              </div>
              <p className="text-sm text-slate-400">文件加载失败，请尝试下载查看</p>
            </div>
          )}

          {/* Not previewable — rich fallback card */}
          {!loading && !canPreview && (
            <div className="flex flex-col items-center gap-5 py-16 px-8 text-center">
              <div className="relative">
                <div className="p-7 rounded-3xl bg-white ring-1 ring-slate-200 shadow-[0_12px_36px_rgba(15,23,42,0.08)]">
                  <FileTypeIcon entry={entry} className="w-14 h-14" />
                </div>
                {entry.file_size && (
                  <div className="absolute -bottom-2 -right-2 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-mono text-slate-500 shadow-sm">
                    {formatSize(entry.file_size)}
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-1">该文件不支持在线预览</p>
                <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                  {entry.external_url ? '点击按钮在新标签页中打开外部链接' : '点击下载按钮将文件保存到本地后查看'}
                </p>
              </div>
              {hasDownloadable && (
                <Button
                  type="button"
                  onClick={() => void downloadKbEntry(entry)}
                  className="h-9 px-6 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-[0_6px_18px_rgba(37,99,235,0.28)] gap-2"
                >
                  <ArrowDownToLine className="w-4 h-4" />
                  {entry.external_url ? '打开链接' : '下载文件'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── Metadata footer ── */}
        <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-2.5 flex items-center gap-3 flex-wrap text-xs text-slate-500">
          {/* Uploader */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Avatar className="h-5 w-5 shrink-0">
              <AvatarFallback className="bg-linear-to-br from-blue-500 to-cyan-500 text-white text-[9px] font-bold">
                {(entry.created_by_name ?? '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium text-slate-700">{entry.created_by_name ?? '未知'}</span>
          </div>

          <Separator orientation="vertical" className="h-3.5 shrink-0" />
          <span className="text-slate-400 shrink-0">{relativeTime(entry.created_at)}</span>

          <Separator orientation="vertical" className="h-3.5 shrink-0" />
          <span className={cn('flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium shrink-0', srcCfg.className)}>
            {srcCfg.label}
          </span>

          <Separator orientation="vertical" className="h-3.5 shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 shrink-0 cursor-default">
                <Eye className="w-3 h-3" />
                <strong className="font-semibold text-slate-600 tabular-nums">{entry.view_count}</strong>
              </span>
            </TooltipTrigger>
            <TooltipContent>浏览次数</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 shrink-0 cursor-default">
                <ArrowDownToLine className="w-3 h-3" />
                <strong className="font-semibold text-slate-600 tabular-nums">{entry.download_count}</strong>
              </span>
            </TooltipTrigger>
            <TooltipContent>下载次数</TooltipContent>
          </Tooltip>

          {/* Tags */}
          {entry.tags.length > 0 && (
            <>
              <Separator orientation="vertical" className="h-3.5 shrink-0" />
              <div className="flex items-center gap-1 min-w-0">
                <Tag className="w-3 h-3 text-slate-400 shrink-0" />
                {entry.tags.slice(0, 4).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-white text-slate-600 border border-slate-200">
                    {tag}
                  </Badge>
                ))}
                {entry.tags.length > 4 && (
                  <span className="text-[10px] text-slate-400">+{entry.tags.length - 4}</span>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── (DetailDrawer removed — info is now shown directly on each card) ──────────

// ── Upload Dialog ─────────────────────────────────────────────────────────────

interface UploadDialogProps {
  categories: KbCategory[];
  initialFiles?: File[];
  onClose: () => void;
  onUploaded: (entries: KbEntry[]) => void;
}

function UploadDialog({ categories, initialFiles = [], onClose, onUploaded }: UploadDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>(() => initialFiles);
  const [categoryId, setCategoryId] = useState('');
  const [categorySource, setCategorySource] = useState<'manual' | 'rule' | 'ai' | null>(null);
  const [classifyResults, setClassifyResults] = useState<KbClassifyResult>([]);
  const [classifying, setClassifying] = useState(false);
  const [permissionLevel, setPermissionLevel] = useState<number>(20);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const flatCats = useMemo(() => flattenCategories(categories), [categories]);

  useEffect(() => {
    if (initialFiles.length === 0) return;
    setSelectedFiles((prev) => mergeFiles(prev, initialFiles));
  }, [initialFiles]);

  // Auto-classify whenever the file list changes
  useEffect(() => {
    if (selectedFiles.length === 0) {
      setClassifyResults([]);
      return;
    }
    let cancelled = false;
    setClassifying(true);
    classifyKbFiles(selectedFiles.map((f) => f.name))
      .then((results) => {
        if (cancelled) return;
        setClassifyResults(results);
        // Pick best suggestion: highest confidence among results
        const best = [...results].sort((a, b) => b.confidence - a.confidence)[0];
        if (best && best.category_id && best.confidence >= 0.3) {
          setCategoryId((prev) => {
            // Only auto-fill if user hasn't manually selected something
            if (prev && categorySource === 'manual') return prev;
            setCategorySource(best.method === 'ai' ? 'ai' : 'rule');
            return best.category_id!;
          });
        }
      })
      .catch(() => { /* silently ignore */ })
      .finally(() => { if (!cancelled) setClassifying(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFiles]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    setSelectedFiles((prev) => mergeFiles(prev, Array.from(files)));
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) {
      toast.error('请选择至少一个文件');
      return;
    }
    if (!categoryId) {
      toast.error('请选择知识库分类');
      return;
    }
    setUploading(true);
    try {
      const entries = await uploadKbFiles({
        files: selectedFiles,
        category_id: categoryId,
        description: description || undefined,
        permission_level: permissionLevel,
        tags: tags || undefined,
      });
      toast.success(`成功上传 ${entries.length} 个文件`);
      onUploaded(entries);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!dragEventHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!dragEventHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!dragEventHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!dragEventHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="w-full max-w-xl overflow-hidden rounded-lg border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.32)] sm:max-w-xl [&>button]:hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
        {/* Dialog header */}
        <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[linear-gradient(135deg,#ffffff_0%,#eff6ff_52%,#ecfeff_100%)] px-6 py-4 pr-12 text-left">
          <div className="absolute inset-0 opacity-45 bg-[linear-gradient(rgba(30,64,175,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,0.04)_1px,transparent_1px)] bg-[size:28px_28px]" />
          <DialogTitle className="relative text-base font-semibold text-slate-950">上传知识库文件</DialogTitle>
          <DialogDescription className="sr-only">
            选择文件、分类和访问权限后上传到研发知识库。
          </DialogDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="relative h-8 w-8 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <X className="w-4 h-4" />
          </Button>
        </DialogHeader>

        <div className="bg-[#f8fafc] p-6 flex flex-col gap-5 overflow-y-auto max-h-[72vh]">
          {/* Drop zone — use <label> so clicking anywhere (including the icon) natively opens file picker */}
          <label
            onDragOver={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              setDragging(false);
            }}
            onDrop={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            tabIndex={0}
            className={cn(
              'relative min-h-[184px] overflow-hidden border border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-3 cursor-pointer outline-none transition-all duration-200',
              dragging
                ? 'border-blue-400 bg-blue-50 ring-4 ring-blue-100 shadow-[0_16px_36px_rgba(37,99,235,0.12)]'
                : 'border-slate-300 bg-white hover:border-blue-300 hover:bg-blue-50/50',
            )}
          >
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.08)_1px,transparent_1px)] bg-[size:24px_24px]" />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 shadow-[0_12px_24px_rgba(37,99,235,0.12)]">
              <Upload className="w-7 h-7" />
            </span>
            <p className="relative text-sm font-semibold text-slate-800 text-center">
              {dragging ? '释放文件添加到上传队列' : '点击或拖拽文件到此处'}
            </p>
            <p className="relative text-xs text-slate-500">支持图片、PDF、文档等多种格式</p>
            {/* Native input — label click activates it without any programmatic .click() needed */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
          </label>

          {/* Selected file list */}
          {selectedFiles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                已选文件({selectedFiles.length})
              </p>
              <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                {selectedFiles.map((file, i) => {
                  const suggestion = classifyResults.find((r) => r.filename === file.name);
                  const suggestedCat = suggestion?.category_id
                    ? flatCats.find((c) => c.id === suggestion.category_id)
                    : null;
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 px-3 py-2 bg-white rounded-lg border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-slate-700 truncate">{file.name}</span>
                        {suggestedCat && (
                          <span className={cn(
                            'text-[10px] truncate mt-0.5',
                            suggestion?.method === 'ai' ? 'text-violet-500' : 'text-blue-500',
                          )}>
                            {suggestion?.method === 'ai' ? '✨' : '⚡'} {suggestedCat.label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-400">{formatSize(file.size)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFile(i)}
                          className="h-6 w-6 rounded-md text-slate-400 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-red-200"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold text-slate-600">知识库分类 *</Label>
              {classifying && (
                <span className="flex items-center gap-1 text-[11px] text-blue-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  分析中...
                </span>
              )}
              {!classifying && categorySource === 'ai' && (
                <span className="flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600 border border-violet-200">
                  ✨ AI 推荐
                </span>
              )}
              {!classifying && categorySource === 'rule' && (
                <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 border border-blue-200">
                  ⚡ 自动识别
                </span>
              )}
            </div>
            <NativeSelect
              value={categoryId}
              onValueChange={(v) => { setCategoryId(v); setCategorySource('manual'); }}
              placeholder="请选择分类"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none transition-shadow focus:ring-2 focus:ring-blue-200"
            >
              <option value="">请选择分类</option>
              {flatCats.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {categories.some((parent) => parent.id === cat.id) ? cat.label : `  ${cat.label}`}
                </option>
              ))}
            </NativeSelect>
          </div>

          {/* Permission Score */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-600">访问权限分值</Label>
              {(() => {
                const cfg = getPermissionScoreConfig(permissionLevel);
                return (
                  <div className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold border select-none', cfg.badgeClass)}>
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    <span>{permissionLevel}</span>
                    <span className="font-normal opacity-75">· {cfg.label}</span>
                  </div>
                );
              })()}
            </div>
            {/* Slider */}
            <div className="px-1 py-1">
              {(() => {
                const cfg = getPermissionScoreConfig(permissionLevel);
                return (
                  <Slider
                    value={[permissionLevel]}
                    onValueChange={([v]) => setPermissionLevel(v ?? 0)}
                    min={0}
                    max={100}
                    step={5}
                    className={cn(
                      'w-full [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-4',
                      cfg.sliderClass,
                    )}
                  />
                );
              })()}
            </div>
            {/* Scale marks */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5 select-none">
              <span>0 · 完全公开</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100 · 绝密</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              仅用户知识库分值 ≥ 此值的成员方可查看。分值越高，访问限制越严格。
            </p>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-slate-600">描述（可选）</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="对文件的简要说明..."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none transition-shadow focus:ring-2 focus:ring-blue-200 resize-none"
            />
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-slate-600">标签（逗号分隔，可选）</Label>
            <Input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如：API设计, 架构图"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none transition-shadow focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        {/* Dialog footer */}
        <DialogFooter className="border-t border-slate-200 bg-white px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={uploading || selectedFiles.length === 0}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg outline-none transition-colors duration-200 shadow-[0_8px_18px_rgba(37,99,235,0.20)] focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2"
          >
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            <Upload className="w-4 h-4" />
            {uploading ? '上传中...' : `上传 ${selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function RDKnowledgeBasePage() {
  const { user } = useAuth();

  const canUpload =
    !!user &&
    (hasPermission(user.permissions, 'rd-kb:upload') ||
      hasPermission(user.permissions, 'rd-task:create') ||
      user.permissions.includes('*'));
  const canManage =
    !!user &&
    (hasPermission(user.permissions, 'rd-kb:manage') || user.permissions.includes('*'));

  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [visibleCount, setVisibleCount] = useState(KB_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [fileTypeFilter, setFileTypeFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState(100);
  const [levelFilterDraft, setLevelFilterDraft] = useState(100);
  /** Entry pending deletion — drives the confirmation modal. */
  const [deletingEntry, setDeletingEntry] = useState<KbEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<KbCategory | null>(null);
  const [categoryDeleteLoading, setCategoryDeleteLoading] = useState(false);
  const [movingEntry, setMovingEntry] = useState<KbEntry | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  /** Entry whose preview modal is open. */
  const [previewEntry, setPreviewEntry] = useState<KbEntry | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [pageDragActive, setPageDragActive] = useState(false);
  const pageDragDepthRef = useRef(0);
  /** Always-current categories — readable inside callbacks without stale closure. */
  const categoriesRef = useRef<KbCategory[]>([]);
  /** Always-current entries.length — readable inside IntersectionObserver callback. */
  const entriesLengthRef = useRef(0);
  /** Sentinel div observed for infinite scroll. */
  const sentinelRef = useRef<HTMLDivElement>(null);
  /** Skips first run of the filter-change effect (which fires on mount). */
  const filterInitializedRef = useRef(false);

  // Keep refs in sync so callbacks always read fresh values without stale closures
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  useEffect(() => { entriesLengthRef.current = entries.length; }, [entries.length]);

  // Debounce keyword → triggers a server-side re-filter 400 ms after the user stops typing
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 400);
    return () => clearTimeout(timer);
  }, [keyword]);

  // Build API query params from current filter state
  const buildParams = useCallback(() => {
    type Params = NonNullable<Parameters<typeof fetchKbEntries>[0]>;
    const params: Params = {};
    if (selectedCatId) {
      params.category_id = Array.from(getCategoryScopeIds(categoriesRef.current, selectedCatId) ?? [selectedCatId]).join(',');
    }
    if (debouncedKeyword) params.keyword = debouncedKeyword;
    if (sourceFilter !== 'all') params.source = sourceFilter;
    if (fileTypeFilter !== 'all') params.file_type = fileTypeFilter;
    if (levelFilter < 100) params.permission_level = levelFilter;
    return params;
  }, [selectedCatId, debouncedKeyword, sourceFilter, fileTypeFilter, levelFilter]);

  // Initial load — categories + all entries with no filters
  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([fetchKbCategories(), fetchKbEntries()])
      .then(([cats, ents]) => {
        setCategories(cats);
        categoriesRef.current = cats;
        setEntries(ents);
        setVisibleCount(KB_PAGE_SIZE);
      })
      .catch(() => toast.error('知识库数据加载失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Re-fetch entries via API whenever any filter changes (server-side filtering)
  useEffect(() => {
    if (!filterInitializedRef.current) {
      // Skip the first run (component just mounted; loadData handles initial fetch)
      filterInitializedRef.current = true;
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchKbEntries(buildParams())
      .then((ents) => {
        if (cancelled) return;
        React.startTransition(() => {
          setEntries(ents);
          setVisibleCount(KB_PAGE_SIZE);
        });
      })
      .catch(() => { if (!cancelled) toast.error('知识库数据加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [buildParams]);

  // Refresh button handler — re-fetches categories + entries with current filters
  const handleRefresh = useCallback(() => {
    setLoading(true);
    Promise.all([fetchKbCategories(), fetchKbEntries(buildParams())])
      .then(([cats, ents]) => {
        React.startTransition(() => {
          setCategories(cats);
          categoriesRef.current = cats;
          setEntries(ents);
          setVisibleCount(KB_PAGE_SIZE);
        });
      })
      .catch(() => toast.error('知识库数据加载失败'))
      .finally(() => setLoading(false));
  }, [buildParams]);

  // Infinite scroll — show KB_PAGE_SIZE more cards each time the sentinel enters the viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          React.startTransition(() => {
            setVisibleCount((prev) => {
              const total = entriesLengthRef.current;
              if (prev >= total) return prev;
              return Math.min(prev + KB_PAGE_SIZE, total);
            });
          });
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const [repairing, setRepairing] = useState(false);
  const handleRepairFilenames = useCallback(async () => {
    setRepairing(true);
    try {
      const result = await repairKbFilenames();
      toast.success(`文件名编码修复完成：共处理 ${result.total} 条，修复 ${result.fixed} 条`);
      if (result.fixed > 0) handleRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修复失败');
    } finally {
      setRepairing(false);
    }
  }, [handleRefresh]);

  // ── Derived ────────────────────────────────────────────────────────────────

  /** True when any filter is actively applied (uses debounced keyword to stay in sync with API results). */
  const hasActiveFilters =
    selectedCatId !== null ||
    debouncedKeyword.trim() !== '' ||
    sourceFilter !== 'all' ||
    fileTypeFilter !== 'all' ||
    levelFilter < 100;

  const categoryFileCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const walk = (category: KbCategory) => {
      counts[category.id] = getCategoryTotalEntryCount(category);
      for (const child of category.children ?? []) walk(child);
    };
    categories.forEach(walk);
    return counts;
  }, [categories]);

  const visibleEntries = useMemo(
    () => entries.slice(0, visibleCount),
    [entries, visibleCount],
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleSelectCategory = useCallback((id: string | null) => {
    React.startTransition(() => setSelectedCatId(id));
  }, []);

  const handleFileTypeFilterChange = useCallback((value: string) => {
    React.startTransition(() => setFileTypeFilter(value));
  }, []);

  const handleCreateCategoryDialog = useCallback((parentId: string | null) => {
    setCategoryDialog({ mode: 'create', parentId });
  }, []);

  const handleEditCategoryDialog = useCallback((category: KbCategory) => {
    setCategoryDialog({ mode: 'edit', category });
  }, []);

  const handleMoveRequest = useCallback((entry: KbEntry) => {
    setMovingEntry(entry);
  }, []);

  /** Opens the preview modal and records a view. */
  const handlePreview = useCallback((entry: KbEntry) => {
    setPreviewEntry(entry);
    void recordKbView(entry.id).catch(() => undefined);
    React.startTransition(() => {
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, view_count: e.view_count + 1 } : e)),
      );
    });
  }, []);

  /** Opens the delete confirmation modal. */
  const handleDelete = useCallback((entry: KbEntry) => {
    setDeletingEntry(entry);
  }, []);

  const syncCategories = useCallback((nextCategories: KbCategory[]) => {
    setCategories(nextCategories);
    categoriesRef.current = nextCategories;
  }, []);

  /** Called when user confirms deletion in the modal. */
  async function handleConfirmDelete() {
    if (!deletingEntry) return;
    setDeleteLoading(true);
    try {
      await deleteKbEntry(deletingEntry.id);
      toast.success('已删除');
      setEntries((prev) => prev.filter((e) => e.id !== deletingEntry.id));
      void fetchKbCategories().then(syncCategories).catch(() => undefined);
      setDeletingEntry(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleCategorySubmit(payload: CategorySubmitPayload) {
    if (!categoryDialog) return;
    setCategorySaving(true);
    try {
      const result = categoryDialog.mode === 'create'
        ? await createKbCategory(payload)
        : await updateKbCategory(categoryDialog.category.id, {
            label: payload.label,
            icon: payload.icon,
            color: payload.color,
          });
      syncCategories(result.categories);
      setCategoryDialog(null);
      toast.success(categoryDialog.mode === 'create' ? '类目已创建' : '类目已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '类目保存失败');
    } finally {
      setCategorySaving(false);
    }
  }

  async function handleConfirmDeleteCategory() {
    if (!deletingCategory) return;
    setCategoryDeleteLoading(true);
    try {
      const deletedIds = new Set(collectCategoryIds(deletingCategory));
      const result = await deleteKbCategory(deletingCategory.id);
      syncCategories(result.categories);
      if (selectedCatId && deletedIds.has(selectedCatId)) setSelectedCatId(null);
      setDeletingCategory(null);
      toast.success('类目已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '类目删除失败');
    } finally {
      setCategoryDeleteLoading(false);
    }
  }

  async function handleConfirmMoveEntry(categoryId: string) {
    if (!movingEntry) return;
    setMoveLoading(true);
    try {
      const previousCategoryId = movingEntry.category_id;
      const updatedEntry = toListEntry(await moveKbEntry(movingEntry.id, categoryId));
      const nextCategories = updateCategoryCountsForMove(categoriesRef.current, previousCategoryId, updatedEntry.category_id);
      const activeCategoryScope = getCategoryScopeIds(nextCategories, selectedCatId);

      syncCategories(nextCategories);
      setEntries((prev) => {
        const movedEntryVisible = !activeCategoryScope || activeCategoryScope.has(updatedEntry.category_id);
        return prev
          .map((entry) => (entry.id === updatedEntry.id ? updatedEntry : entry))
          .filter((entry) => entry.id !== updatedEntry.id || movedEntryVisible);
      });
      setMovingEntry(null);
      toast.success('文件已移动');
      void Promise.all([fetchKbCategories(), fetchKbEntries(buildParams())])
        .then(([nextCats, nextEntries]) => {
          React.startTransition(() => {
            syncCategories(nextCats);
            setEntries(nextEntries);
            setVisibleCount(KB_PAGE_SIZE);
          });
        })
        .catch(() => undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '文件移动失败');
    } finally {
      setMoveLoading(false);
    }
  }

  function handleUploaded(newEntries: KbEntry[]) {
    // API returns full entries (possibly with data_url). Strip it here so the
    // list stays consistent with what getKnowledgeEntries returns (metadata only).
    const sanitized = newEntries.map(toListEntry);
    setEntries((prev) => [...sanitized, ...prev]);
    void fetchKbCategories().then(syncCategories).catch(() => undefined);
  }

  function openUploadDialog(files: File[] = []) {
    setPendingUploadFiles(files);
    setShowUpload(true);
  }

  function closeUploadDialog() {
    setShowUpload(false);
    setPendingUploadFiles([]);
  }

  function handlePageDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!canUpload || !dragEventHasFiles(e)) return;
    e.preventDefault();
    pageDragDepthRef.current += 1;
    setPageDragActive(true);
  }

  function handlePageDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!canUpload || !dragEventHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handlePageDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!canUpload || !dragEventHasFiles(e)) return;
    e.preventDefault();
    pageDragDepthRef.current = Math.max(0, pageDragDepthRef.current - 1);
    if (pageDragDepthRef.current === 0) setPageDragActive(false);
  }

  function handlePageDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!canUpload || !dragEventHasFiles(e)) return;
    e.preventDefault();
    pageDragDepthRef.current = 0;
    setPageDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) openUploadDialog(files);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const { imageCount, docCount, pdfCount } = useMemo(() => {
    let image = 0;
    let doc = 0;
    let pdf = 0;

    for (const entry of entries) {
      const type = getFileType(entry.file_name, entry.file_type);
      if (type === 'image') image += 1;
      if (type === 'doc') doc += 1;
      if (type === 'pdf') pdf += 1;
    }

    return { imageCount: image, docCount: doc, pdfCount: pdf };
  }, [entries]);

  return (
    <div
      className="relative min-h-full bg-slate-50/30 flex flex-col text-slate-900"
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {pageDragActive && canUpload && !showUpload && (
        <div className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-2xl border border-blue-200 bg-white/88 shadow-[0_28px_80px_rgba(30,64,175,0.18)] backdrop-blur-sm">
          <div className="absolute inset-0 rounded-2xl bg-[linear-gradient(rgba(30,64,175,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,0.05)_1px,transparent_1px)] bg-[size:28px_28px]" />
          <div className="relative flex items-center gap-4 rounded-xl border border-blue-100 bg-white/95 px-6 py-5 text-slate-900 shadow-[0_16px_36px_rgba(30,64,175,0.12)]">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-blue-100 bg-blue-50">
              <Upload className="h-6 w-6 text-blue-600" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-950">释放文件，进入上传队列</p>
              <p className="mt-1 text-xs text-slate-500">松开鼠标后选择分类与可见范围</p>
            </div>
          </div>
        </div>
      )}
      {/* Page header */}
      <div className="relative mx-4 mt-5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.06)] sm:mx-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/45 to-transparent" />
        <div className="relative z-10 mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-3 text-xl font-semibold text-slate-950">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_10px_22px_rgba(37,99,235,0.22)]">
                <BookOpen className="w-4 h-4" />
              </span>
              <span className="truncate">研发知识库</span>
            </h1>
            <p className="mt-1.5 text-sm font-medium text-slate-500">
              统一管理研发文档、技术资料与任务成果附件
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {/* Stats */}
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50/80 px-3 font-medium">
                <span className="text-slate-400">共</span><strong className="font-semibold tabular-nums text-slate-800">{entries.length}</strong><span className="text-slate-400">条</span>
              </span>
              <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50/80 px-3 font-medium">
                <span className="text-slate-400">文档</span><strong className="font-semibold tabular-nums text-blue-700">{docCount}</strong>
              </span>
              <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50/80 px-3 font-medium">
                <span className="text-slate-400">PDF</span><strong className="font-semibold tabular-nums text-blue-700">{pdfCount}</strong>
              </span>
              <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50/80 px-3 font-medium">
                <span className="text-slate-400">图片</span><strong className="font-semibold tabular-nums text-blue-700">{imageCount}</strong>
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={loading}
              className="h-9 w-9 rounded-lg border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
              title="刷新（保留当前筛选条件）"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleRepairFilenames}
                disabled={repairing}
                className="h-9 w-9 rounded-lg border-amber-200 bg-white text-amber-600 hover:bg-amber-50 hover:text-amber-800 focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                title="修复历史文件名乱码（一次性操作）"
              >
                <Wrench className={cn('w-4 h-4', repairing && 'animate-spin')} />
              </Button>
            )}
            {canUpload && (
              <Button
                type="button"
                onClick={() => openUploadDialog()}
                className="h-9 gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(37,99,235,0.20)] transition-all duration-200 hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2"
              >
                <Plus className="w-4 h-4" />
                上传文件
              </Button>
            )}
          </div>
        </div>

        {/* Search + filters */}
        <div className="relative z-10 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 lg:grid-cols-[minmax(24rem,1fr)_10rem_minmax(20rem,25rem)]">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索标题、描述、标签.."
              className="h-11 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 outline-none transition-shadow placeholder-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
            {keyword && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 rounded-md text-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          <div className="min-w-0">
            <NativeSelect
              value={fileTypeFilter}
              onValueChange={handleFileTypeFilterChange}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-shadow focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              {FILE_TYPE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label === '全部' ? '全部类型' : option.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {(() => {
              const cfg = levelFilterDraft === 100
                ? {
                    label: '全部',
                    badgeClass: 'border-blue-200 bg-blue-50 text-blue-700',
                    sliderClass: '[&_[data-slot=slider-range]]:bg-blue-500',
                  }
                : getPermissionScoreConfig(levelFilterDraft);
              return (
                <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex min-w-[8.75rem] items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-500">权限分值</span>
                    <Badge variant="secondary" className={cn("max-w-full rounded-full border px-2 py-0.5 text-[11px] font-semibold", cfg.badgeClass)}>
                      ≤ {levelFilterDraft} · {cfg.label}
                    </Badge>
                  </div>
                  <Slider
                    value={[levelFilterDraft]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={([value]) => setLevelFilterDraft(Math.max(0, Math.min(100, Math.round(value ?? 100))))}
                    onValueCommit={([value]) => setLevelFilter(Math.max(0, Math.min(100, Math.round(value ?? 100))))}
                    className={cn(
                      'min-w-32 flex-1 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-4',
                      cfg.sliderClass,
                    )}
                  />
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-col lg:flex-row gap-4 px-4 sm:px-6 py-5 flex-1 min-h-0">
        {/* Sidebar */}
        <CategorySidebar
          categories={categories}
          selectedCatId={selectedCatId}
          canManage={canManage}
          onSelect={handleSelectCategory}
          onCreate={handleCreateCategoryDialog}
          onEdit={handleEditCategoryDialog}
          onDelete={setDeletingCategory}
          categoryFileCounts={categoryFileCounts}
        />

        {/* Entry grid */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {/* Result count */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <span>
              {loading
                ? '加载中...'
                : hasActiveFilters
                  ? `筛选结果 ${entries.length} 条`
                  : `共 ${entries.length} 条记录`}
            </span>
            <span className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-blue-700">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              KB_INDEX
            </span>
          </div>

          {/* Loading */}
          {loading && entries.length === 0 && (
            <div className="flex-1 flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span className="text-sm">加载中..</span>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && entries.length === 0 && (
            <div className="flex-1 flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <BookOpen className="w-12 h-12 text-slate-200" />
                <p className="text-sm font-medium">
                  {hasActiveFilters ? '没有符合条件的条目' : '知识库暂无内容'}
                </p>
                <p className="text-xs text-slate-300">
                  {hasActiveFilters
                    ? '尝试修改搜索词或筛选条件'
                    : '上传第一个文件开始构建知识库'}
                </p>
                {!hasActiveFilters && canUpload && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openUploadDialog()}
                    className="mt-2 flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm font-medium rounded-lg transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    上传文件
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Grid */}
          {entries.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 auto-rows-min">
              {visibleEntries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  canManage={canManage}
                  onDelete={handleDelete}
                  onMove={handleMoveRequest}
                  onPreview={handlePreview}
                />
              ))}
              {/* Infinite-scroll sentinel — IntersectionObserver loads next batch when visible */}
              <div ref={sentinelRef} className="col-span-full h-4" aria-hidden />
            </div>
          )}
        </div>

      </div>

      {/* Upload dialog */}
      {showUpload && (
        <UploadDialog
          categories={categories}
          initialFiles={pendingUploadFiles}
          onClose={closeUploadDialog}
          onUploaded={handleUploaded}
        />
      )}

      {categoryDialog && (
        <CategoryFormDialog
          state={categoryDialog}
          categories={categories}
          saving={categorySaving}
          onSubmit={(payload) => void handleCategorySubmit(payload)}
          onClose={() => setCategoryDialog(null)}
        />
      )}

      {deletingCategory && (
        <DeleteCategoryDialog
          category={deletingCategory}
          loading={categoryDeleteLoading}
          onConfirm={() => void handleConfirmDeleteCategory()}
          onCancel={() => setDeletingCategory(null)}
        />
      )}

      {movingEntry && (
        <MoveEntryDialog
          entry={movingEntry}
          categories={categories}
          loading={moveLoading}
          onConfirm={(categoryId) => void handleConfirmMoveEntry(categoryId)}
          onCancel={() => setMovingEntry(null)}
        />
      )}

      {/* Delete confirmation modal */}
      {deletingEntry && (
        <DeleteConfirmDialog
          entry={deletingEntry}
          loading={deleteLoading}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeletingEntry(null)}
        />
      )}

      {/* Preview modal */}
      {previewEntry && (
        <PreviewModal
          entry={previewEntry}
          onClose={() => setPreviewEntry(null)}
        />
      )}
    </div>
  );
}
