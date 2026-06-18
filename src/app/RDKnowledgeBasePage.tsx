import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Cpu,
  DatabaseZap,
  Edit3,
  Eye,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Filter,
  FolderPlus,
  FlaskConical,
  FolderOpen,
  LayoutGrid,
  Link,
  List,
  Loader2,
  MoreHorizontal,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
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
import { useAvatarDirectory } from "./lib/userAvatar";
import { hasPermission } from "./lib/permissions";
import { recordAudit, useAuditActor } from "./lib/auditLog";
import { KbAdvancedPreview } from "./components/KbAdvancedPreview";
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
  updateKbEntry,
  fetchMyKbPermissionLevel,
  classifyKbFiles,
  recordKbView,
  repairKbFilenames,
  type KbCategory,
  type KbEntry,
  type KbVisibility,
  type KbClassifyResult,
} from "./lib/rdApi";
import { backfillKbToRag } from "./lib/ragApi";

// ── 知识库作用域（研发库 / 部门库共用本页面）────────────────────────────────────
// kbId === undefined → 研发知识库（走 /knowledge/*，行为完全不变）；
// kbId === 部门 id（如 'finance'）→ 部门知识库（走 /dept-knowledge/{id}/*）。
// 用 Context 把 kbId 下发给所有子组件（缩略图 / 预览 / 编辑 / 上传弹窗），避免逐层 prop 透传。
const KbScopeContext = React.createContext<string | undefined>(undefined);
const useKbId = () => React.useContext(KbScopeContext);

/** 本页面对外的作用域入参：缺省即研发库。 */
export type KbScope = { kbId: string; label: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const KB_PAGE_SIZE = 24; // 每页条目数（分页）；网格视图大图卡片，列表视图紧凑行

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
): 'image' | 'pdf' | 'doc' | 'video' | 'link' | 'html' | 'text' | 'xlsx' | 'docx' | 'other' {
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  if (['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml'].includes(ext)) return 'text';
  if (['ppt', 'pptx'].includes(ext)) return 'doc';
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
async function downloadKbEntry(entry: KbEntry, kbId?: string): Promise<void> {
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
      const full = await fetchKbEntry(entry.id, kbId);
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

/**
 * 条目图片 URL 解析：图片类优先 oss_url / preview_url；列表为性能精简掉 data_url 时，
 * 按需取一次完整条目拿 base64 兜底。fetchKbEntry 只读、不计浏览量。
 */
function useEntryImageUrl(entry: KbEntry) {
  const kbId = useKbId();
  const fileType = getFileType(entry.file_name, entry.file_type);
  const isImage = fileType === 'image';
  const directUrl = isImage ? (entry.oss_url || entry.preview_url || null) : null;
  const [lazyUrl, setLazyUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!isImage || directUrl || lazyUrl || !entry.has_data_file) return;
    let alive = true;
    fetchKbEntry(entry.id, kbId)
      .then((full) => { if (alive && full.data_url) setLazyUrl(full.data_url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [entry.id, isImage, directUrl, lazyUrl, entry.has_data_file, kbId]);

  return { imageUrl: failed ? null : (directUrl ?? lazyUrl), onError: () => setFailed(true) };
}

/** 文件类型 → 封面底色 + 大图标（无图片预览时的占位封面）。 */
function getCoverStyle(entry: KbEntry): { Icon: React.ComponentType<{ className?: string }>; tint: string; icon: string } {
  const t = getFileType(entry.file_name, entry.file_type);
  if (t === 'pdf') return { Icon: FileText, tint: 'bg-red-50', icon: 'text-red-400' };
  if (t === 'image') return { Icon: FileImage, tint: 'bg-emerald-50', icon: 'text-emerald-400' };
  if (t === 'xlsx' || t === 'doc' || t === 'docx') return { Icon: FileSpreadsheet, tint: 'bg-blue-50', icon: 'text-blue-400' };
  if (t === 'video') return { Icon: FileVideo, tint: 'bg-violet-50', icon: 'text-violet-400' };
  if (entry.external_url) return { Icon: Link, tint: 'bg-sky-50', icon: 'text-sky-400' };
  return { Icon: File, tint: 'bg-slate-50', icon: 'text-slate-400' };
}

/** 卡片顶部封面：图片铺满；非图片显示带底色的大图标。填满父容器（父级定宽高比）。 */
function EntryCover({ entry }: { entry: KbEntry }) {
  const { imageUrl, onError } = useEntryImageUrl(entry);
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={entry.title}
        loading="lazy"
        draggable={false}
        onError={onError}
        className="h-full w-full object-cover"
      />
    );
  }
  const { Icon, tint, icon } = getCoverStyle(entry);
  return (
    <div className={cn('flex h-full w-full items-center justify-center', tint)}>
      <Icon className={cn('h-12 w-12', icon)} />
    </div>
  );
}

/** 列表行小缩略图：图片或类型图标。 */
function EntryThumbSmall({ entry, onClick }: { entry: KbEntry; onClick?: () => void }) {
  const { imageUrl, onError } = useEntryImageUrl(entry);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? '点击预览' : undefined}
      className={cn(
        'relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200/70',
        onClick && 'cursor-pointer transition hover:ring-2 hover:ring-indigo-300',
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={entry.title} loading="lazy" draggable={false} onError={onError} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center"><FileTypeIcon entry={entry} className="h-5 w-5" /></span>
      )}
    </button>
  );
}

/** 类型角标文案：优先文件扩展名（JPG/PNG/PDF…），无扩展名回退类型。 */
function getTypeLabel(entry: KbEntry): string {
  const name = entry.file_name ?? '';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  if (ext && ext.length <= 5) return ext;
  const t = getFileType(entry.file_name, entry.file_type);
  return t === 'image' ? 'IMG' : t.toUpperCase();
}

/** 来源副标题：有任务来源显示「来自任务 X · 标题」，否则用描述，再否则用来源标签。 */
function entrySubtitle(entry: KbEntry): string {
  if (entry.source_task_id) {
    return `来自任务 ${entry.source_task_id}${entry.source_task_title ? ` · ${entry.source_task_title}` : ''}`;
  }
  return entry.description || (SOURCE_CONFIG[entry.source] ?? SOURCE_CONFIG.manual).label;
}

/** 上传人头像：走全站头像目录（含按 user_id 派发的默认头像），无则首字母。 */
function UploaderAvatar({ name, userId, className }: { name?: string | null; userId?: string | null; className?: string }) {
  const resolveAvatar = useAvatarDirectory();
  const url = resolveAvatar(name ?? null, userId ?? null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [url]);
  if (url && !failed) {
    return <img src={url} alt={name ?? ''} onError={() => setFailed(true)} className={cn('shrink-0 rounded-full object-cover', className)} />;
  }
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white', className)}>
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  );
}

// ── Entry Card ────────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: KbEntry;
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  onEdit: (entry: KbEntry) => void;
  onDelete: (entry: KbEntry) => void;
  onMove: (entry: KbEntry) => void;
  onPreview: (entry: KbEntry) => void;
}

const EntryCard = React.memo(React.forwardRef<HTMLDivElement, EntryCardProps>(function EntryCard(
  { entry, canEdit, canMove, canDelete, onEdit, onDelete, onMove, onPreview },
  ref,
) {
  const kbId = useKbId();
  const hasManage = canEdit || canMove || canDelete;
  const fileType = getFileType(entry.file_name, entry.file_type);
  const hasFile = entry.has_data_file || !!entry.oss_url;
  const hasDownload = hasFile || !!entry.external_url;
  const isPreviewable = (
    fileType === 'image' || fileType === 'pdf' || fileType === 'video'
    || fileType === 'html' || fileType === 'text' || fileType === 'xlsx' || fileType === 'docx'
  ) && hasFile;
  const score = entry.permission_level ?? 0;
  const permCfg = getPermissionScoreConfig(score);

  return (
    <div
      ref={ref}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_14px_30px_-12px_rgba(79,70,229,0.28)] [content-visibility:auto] [contain-intrinsic-size:300px]"
    >
      {/* Cover */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-50">
        <EntryCover entry={entry} />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
          <FileTypeIcon entry={entry} className="h-3 w-3" />
          {getTypeLabel(entry)}
        </span>
        {(isPreviewable || hasDownload) && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900/35 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
            {isPreviewable && (
              <button
                type="button"
                onClick={() => onPreview(entry)}
                title="预览"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-indigo-700 shadow transition hover:bg-white"
              >
                <Eye className="h-4 w-4" />
              </button>
            )}
            {hasDownload && (
              <button
                type="button"
                onClick={() => void downloadKbEntry(entry, kbId)}
                title={entry.external_url ? '打开链接' : '下载'}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow transition hover:bg-white hover:text-indigo-700"
              >
                <ArrowDownToLine className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <button
          type="button"
          onClick={isPreviewable ? () => onPreview(entry) : undefined}
          disabled={!isPreviewable}
          title={entry.title}
          className={cn(
            'block max-w-full truncate text-left text-sm font-semibold text-slate-900 transition-colors',
            isPreviewable && 'cursor-pointer group-hover:text-indigo-600',
          )}
        >
          {entry.title}
        </button>
        <p className="line-clamp-2 text-xs leading-relaxed text-slate-500" title={entrySubtitle(entry)}>
          {entrySubtitle(entry)}
        </p>

        {/* Footer：默认显示上传人 + 权限分；悬停时浮出管理操作 */}
        <div className="relative mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <UploaderAvatar name={entry.created_by_name} userId={entry.created_by_id} className="h-5 w-5 text-[9px]" />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[11px] font-medium text-slate-600">{entry.created_by_name ?? '未知'}</div>
              <div className="text-[10px] text-slate-400">{relativeTime(entry.created_at)}</div>
            </div>
          </div>
          <span
            className={cn('flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold', permCfg.badgeClass)}
            title={`权限分值 ${score}/100 · ${permCfg.label}，用户分值 ≥ ${score} 方可访问`}
          >
            <ShieldCheck className="h-3 w-3" />
            {score}
          </span>

          {hasManage && (
            <div className="absolute inset-0 flex items-center justify-end gap-1 bg-white/95 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {canEdit && (
                <button type="button" onClick={() => onEdit(entry)} title="编辑" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700">
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
              )}
              {canMove && (
                <button type="button" onClick={() => onMove(entry)} title="移动" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700">
                  <MoveRight className="h-3.5 w-3.5" />
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={() => onDelete(entry)} title="删除" className="flex h-7 w-7 items-center justify-center rounded-md text-red-500 transition hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}));

EntryCard.displayName = "EntryCard";

// ── Entry Row (列表视图) ────────────────────────────────────────────────────────
const EntryRow = React.memo(function EntryRow({
  entry, canEdit, canMove, canDelete, onEdit, onDelete, onMove, onPreview,
}: EntryCardProps) {
  const kbId = useKbId();
  const hasManage = canEdit || canMove || canDelete;
  const fileType = getFileType(entry.file_name, entry.file_type);
  const hasFile = entry.has_data_file || !!entry.oss_url;
  const hasDownload = hasFile || !!entry.external_url;
  const isPreviewable = (
    fileType === 'image' || fileType === 'pdf' || fileType === 'video'
    || fileType === 'html' || fileType === 'text' || fileType === 'xlsx' || fileType === 'docx'
  ) && hasFile;
  const score = entry.permission_level ?? 0;
  const permCfg = getPermissionScoreConfig(score);
  const iconBtn = 'flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700';

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-slate-200/70 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-indigo-200 hover:shadow-[0_8px_18px_-10px_rgba(79,70,229,0.25)]">
      <EntryThumbSmall entry={entry} onClick={isPreviewable ? () => onPreview(entry) : undefined} />
      <span className="hidden shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200/70 sm:inline-flex">
        <FileTypeIcon entry={entry} className="h-3 w-3" />
        {getTypeLabel(entry)}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={isPreviewable ? () => onPreview(entry) : undefined}
          disabled={!isPreviewable}
          title={entry.title}
          className={cn('block max-w-full truncate text-left text-sm font-semibold text-slate-900', isPreviewable && 'cursor-pointer hover:text-indigo-600')}
        >
          {entry.title}
        </button>
        <p className="truncate text-xs text-slate-500" title={entrySubtitle(entry)}>{entrySubtitle(entry)}</p>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 md:flex">
        <UploaderAvatar name={entry.created_by_name} userId={entry.created_by_id} className="h-6 w-6 text-[10px]" />
        <div className="leading-tight">
          <div className="max-w-[88px] truncate text-[11px] font-medium text-slate-600">{entry.created_by_name ?? '未知'}</div>
          <div className="text-[10px] text-slate-400">{relativeTime(entry.created_at)}</div>
        </div>
      </div>
      <span
        className={cn('hidden shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold lg:flex', permCfg.badgeClass)}
        title={`权限分值 ${score}/100 · ${permCfg.label}`}
      >
        <ShieldCheck className="h-3 w-3" />
        {score}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        {isPreviewable && (
          <button type="button" onClick={() => onPreview(entry)} title="预览" className={iconBtn}><Eye className="h-3.5 w-3.5" /></button>
        )}
        {hasDownload && (
          <button type="button" onClick={() => void downloadKbEntry(entry, kbId)} title={entry.external_url ? '打开链接' : '下载'} className={iconBtn}><ArrowDownToLine className="h-3.5 w-3.5" /></button>
        )}
        {hasManage && (
          <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            {canEdit && <button type="button" onClick={() => onEdit(entry)} title="编辑" className={iconBtn}><Edit3 className="h-3.5 w-3.5" /></button>}
            {canMove && <button type="button" onClick={() => onMove(entry)} title="移动" className={iconBtn}><MoveRight className="h-3.5 w-3.5" /></button>}
            {canDelete && <button type="button" onClick={() => onDelete(entry)} title="删除" className="flex h-7 w-7 items-center justify-center rounded-md text-red-500 transition hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
          </span>
        )}
      </div>
    </div>
  );
});
EntryRow.displayName = "EntryRow";

// ── Edit Entry Dialog ─────────────────────────────────────────────────────────
// 编辑已上传文件的元数据（标题、描述、分类、标签、权限分值）。
// 不能改文件内容本身——那需要重新上传一个版本。
function EditEntryDialog({
  entry,
  categories,
  onSaved,
  onClose,
}: {
  entry: KbEntry;
  categories: KbCategory[];
  onSaved: (updated: KbEntry) => void;
  onClose: () => void;
}) {
  const kbId = useKbId();
  const flatCats = useMemo(() => flattenCategories(categories), [categories]);
  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.description ?? '');
  const [categoryId, setCategoryId] = useState(entry.category_id);
  const [tags, setTags] = useState((entry.tags ?? []).join(', '));
  const [permissionLevel, setPermissionLevel] = useState<number>(entry.permission_level ?? 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(entry.title);
    setDescription(entry.description ?? '');
    setCategoryId(entry.category_id);
    setTags((entry.tags ?? []).join(', '));
    setPermissionLevel(entry.permission_level ?? 0);
  }, [entry]);

  const permCfg = getPermissionScoreConfig(permissionLevel);

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error('标题不能为空');
      return;
    }
    if (!categoryId) {
      toast.error('请选择分类');
      return;
    }
    const tagsArray = tags
      .split(/[,，;\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      const updated = await updateKbEntry(entry.id, {
        title: trimmedTitle,
        description: description.trim(),
        category_id: categoryId,
        tags: tagsArray,
        permission_level: Math.max(0, Math.min(100, Math.round(permissionLevel))),
      }, kbId);
      toast.success('文件已更新');
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)] [&>button]:hidden">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Edit3 className="h-4 w-4" />
            </span>
            编辑文件信息
          </DialogTitle>
          <DialogDescription className="sr-only">
            修改已上传文件的元数据，包括标题、描述、分类、标签和权限分值。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {/* 文件基础信息条 */}
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <FileTypeIcon entry={entry} className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-slate-500">原文件名</p>
              <p className="mt-0.5 truncate text-xs text-slate-700">{entry.file_name ?? '—'}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">标题 <span className="text-red-500">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文件标题"
              className="h-9 rounded-md border-slate-200 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="文件描述（可选）"
              rows={2}
              className="rounded-md border-slate-200 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">分类 <span className="text-red-500">*</span></Label>
              <NativeSelect
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full h-9 cursor-pointer rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">请选择</option>
                {flatCats.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">标签</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="逗号分隔，如：研发,规范"
                className="h-9 rounded-md border-slate-200 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold text-slate-600">权限分值（0–100）</Label>
              <Badge className={cn('shrink-0 gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', permCfg.badgeClass)}>
                <ShieldCheck className="h-3 w-3" />
                {permissionLevel}/100 · {permCfg.label}
              </Badge>
            </div>
            <Slider
              value={[permissionLevel]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => setPermissionLevel(Math.max(0, Math.min(100, Math.round(v))))}
              className={cn('w-full [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-4', permCfg.sliderClass)}
            />
            <p className="text-[11px] leading-relaxed text-slate-400">
              用户分值 ≥ 文件分值才可访问。0 = 完全公开，100 = 最高密级。
            </p>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-100 px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving} className="h-9 rounded-lg px-4 text-slate-600">
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !title.trim() || !categoryId}
            className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Category Sidebar ──────────────────────────────────────────────────────────

interface CategorySidebarProps {
  categories: KbCategory[];
  selectedCatId: string | null;
  /** 任一管理权限存在时显示动作区；具体按钮再按 canCreate/canEdit/canDelete 单独控制 */
  canManage: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
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
  canCreate,
  canEdit,
  canDelete,
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
        {allowChild && canCreate && (
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
        {canEdit && (
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
        )}
        {canDelete && (
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
        )}
      </div>
    );
  };

  return (
    <Card className="w-full lg:w-80 lg:shrink-0 lg:min-h-0 bg-white rounded-lg border border-slate-200/80 p-2.5 flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-y-auto shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="hidden lg:flex items-center justify-between px-3 pb-2 pt-1 text-[11px] font-semibold uppercase text-slate-400">
        <span>知识域</span>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onCreate(null)}
              className="h-6 w-6 rounded-md text-slate-400 hover:bg-indigo-50 hover:text-indigo-700"
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
          'h-auto min-w-max lg:min-w-0 justify-between w-full px-3 py-2 rounded-md text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-300',
          selectedCatId === null
            ? 'bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.16)]'
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
                  ? 'bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.16)]'
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
                  'h-auto min-w-0 flex-1 justify-between px-3 py-2 text-sm font-medium text-current hover:bg-transparent hover:text-current focus-visible:ring-2 focus-visible:ring-indigo-300',
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
                          ? 'bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.16)]'
                          : 'text-slate-500 hover:bg-slate-50',
                      )}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelect(child.id)}
                        className={cn(
                          'h-auto min-w-0 flex-1 justify-between px-2 py-1.5 text-xs font-medium text-current hover:bg-transparent hover:text-current focus-visible:ring-2 focus-visible:ring-indigo-300',
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
      <DialogContent className="sm:max-w-md rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)] [&>button]:hidden">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
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
              className="h-10 rounded-lg border-slate-200 bg-white text-sm focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
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
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
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
                      selected && "border-indigo-300 ring-2 ring-indigo-100",
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
            className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
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
      <DialogContent className="sm:max-w-sm rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)] [&>button]:hidden">
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
      <DialogContent className="sm:max-w-md rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.24)] [&>button]:hidden">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
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
                      ? "bg-indigo-600 text-white hover:bg-indigo-700"
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
            className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
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
      <DialogContent className="sm:max-w-sm rounded-xl border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.22)] [&>button]:hidden">
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
  const kbId = useKbId();
  const fileType = getFileType(entry.file_name, entry.file_type);
  const [fileUrl, setFileUrl] = React.useState<string | null>(entry.oss_url ?? null);
  // Same-origin inline-preview proxy URL — used by iframe/fetch-based previews (pdf/html/text/xlsx/docx)
  // to bypass the OSS bucket's forced Content-Disposition: attachment and CORS restrictions.
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(entry.preview_url ?? entry.oss_url ?? null);
  const [loading, setLoading] = React.useState(false);
  const permScore = entry.permission_level ?? 0;
  const permCfg = getPermissionScoreConfig(permScore);
  const srcCfg = SOURCE_CONFIG[entry.source] ?? SOURCE_CONFIG.manual;
  const isDarkBg = fileType === 'image' || fileType === 'video';
  const canPreview = (
    fileType === 'image' || fileType === 'pdf' || fileType === 'video'
    || fileType === 'html' || fileType === 'text' || fileType === 'xlsx' || fileType === 'docx'
  );
  const hasDownloadable = entry.has_data_file || !!entry.oss_url || !!entry.external_url;

  React.useEffect(() => {
    if (fileUrl || !entry.has_data_file) return;
    setLoading(true);
    fetchKbEntry(entry.id, kbId)
      .then((full) => {
        const direct = full.oss_url ?? full.data_url ?? null;
        setFileUrl(direct);
        setPreviewUrl(full.preview_url ?? direct);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [entry.id, entry.has_data_file, fileUrl, kbId]);

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
              onClick={() => void downloadKbEntry(entry, kbId)}
              className="h-8 shrink-0 gap-1.5 rounded-lg border-indigo-200 bg-indigo-50/70 px-3 text-xs font-semibold text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100"
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
              <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
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
              src={previewUrl ?? fileUrl}
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

          {/* HTML / 纯文本 / Excel / Word：客户端解析渲染（走同源代理，规避 OSS 强制下载 + CORS） */}
          {!loading && fileUrl && (fileType === 'html' || fileType === 'text' || fileType === 'xlsx' || fileType === 'docx') && (
            <KbAdvancedPreview fileUrl={previewUrl ?? fileUrl} fileType={fileType} fileName={entry.file_name ?? undefined} />
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
                  onClick={() => void downloadKbEntry(entry, kbId)}
                  className="h-9 px-6 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-[0_6px_18px_rgba(79,70,229,0.28)] gap-2"
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
              <AvatarFallback className="bg-indigo-600 text-white text-[9px] font-bold">
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
  /** 是否允许手动调整权限分值：仅 KB 管理员/超管为 true；研发成员为 false（滑块置灰，锁定为其 kb_level）。 */
  canSetPermissionLevel?: boolean;
}

function UploadDialog({ categories, initialFiles = [], onClose, onUploaded, canSetPermissionLevel = false }: UploadDialogProps) {
  const { user } = useAuth();
  const kbId = useKbId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>(() => initialFiles);
  const [categoryId, setCategoryId] = useState('');
  const [categorySource, setCategorySource] = useState<'manual' | 'rule' | 'ai' | null>(null);
  const [classifyResults, setClassifyResults] = useState<KbClassifyResult>([]);
  const [classifying, setClassifying] = useState(false);
  // 研发库：默认 permission_level 取当前用户在「人员管理」里配置的 kb_level（拉不到时兜底 20）。
  // 部门库：一期默认全可见，无部门级人员分值，初值取 0（仅管理员可调）。
  const [permissionLevel, setPermissionLevel] = useState<number>(kbId ? 0 : 20);
  const [permissionLevelTouched, setPermissionLevelTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 挂载时拉当前用户的 kb_level 作为默认权限分值（仅研发库；部门库无此接口，跳过用初值 0）
  useEffect(() => {
    if (!user?.id || kbId) return;
    let cancelled = false;
    fetchMyKbPermissionLevel()
      .then((res) => {
        if (cancelled) return;
        const myKbLevel = typeof res?.permission_level === 'number' ? res.permission_level : null;
        if (myKbLevel !== null && !permissionLevelTouched) {
          setPermissionLevel(Math.max(0, Math.min(100, Math.round(myKbLevel))));
        }
      })
      .catch(() => { /* 静默：默认走 20 兜底 */ });
    return () => { cancelled = true; };
    // 故意只在挂载时拉一次，后续用户手动调滑块后即使再 refetch 也不要覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, kbId]);

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
    classifyKbFiles(selectedFiles.map((f) => f.name), kbId)
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
      }, kbId);
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
        <DialogHeader className="relative overflow-hidden border-b border-slate-100 bg-white px-6 py-4 pr-12 text-left">
          <div className="absolute inset-0 bg-slate-50/60" />
          <DialogTitle className="relative text-base font-semibold text-slate-950">上传知识库文件</DialogTitle>
          <DialogDescription className="sr-only">
            选择文件、分类和访问权限后上传到知识库。
          </DialogDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute right-4 top-1/2 h-8 w-8 -translate-y-1/2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo-200"
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
                ? 'border-indigo-400 bg-indigo-50 ring-4 ring-indigo-100 shadow-[0_16px_36px_rgba(79,70,229,0.12)]'
                : 'border-slate-300 bg-white hover:border-indigo-300 hover:bg-indigo-50/50',
            )}
          >
            <div className="pointer-events-none absolute inset-0 bg-slate-50/40" />
            <span className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-[0_12px_24px_rgba(79,70,229,0.12)]">
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
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none transition-shadow focus:ring-2 focus:ring-indigo-200"
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
                    disabled={!canSetPermissionLevel}
                    onValueChange={([v]) => {
                      if (!canSetPermissionLevel) return;
                      setPermissionLevel(v ?? 0);
                      setPermissionLevelTouched(true);
                    }}
                    min={0}
                    max={100}
                    step={5}
                    className={cn(
                      'w-full [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-4',
                      cfg.sliderClass,
                      !canSetPermissionLevel && 'cursor-not-allowed opacity-60',
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
            <p className="text-[11px] leading-relaxed text-slate-400">
              {canSetPermissionLevel
                ? "仅用户知识库分值 ≥ 此值的成员方可查看。分值越高，访问限制越严格。"
                : "权限分值按你在「人员管理」中配置的等级自动设定，研发成员不可调整。"}
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
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none transition-shadow focus:ring-2 focus:ring-indigo-200 resize-none"
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
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none transition-shadow focus:ring-2 focus:ring-indigo-200"
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
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-200"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={uploading || selectedFiles.length === 0}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg outline-none transition-colors duration-200 shadow-[0_8px_18px_rgba(79,70,229,0.20)] focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
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

export function RDKnowledgeBasePage({ kbScope }: { kbScope?: KbScope } = {}) {
  const { user } = useAuth();

  // 作用域：研发库 kbId=undefined（rd-kb:* 权限 + /knowledge 接口）；部门库 kbId=部门 id（dept-kb:* 权限 + /dept-knowledge 接口）
  const kbId = kbScope?.kbId;
  const userPerms = user?.permissions ?? [];
  // 按作用域选用的一套权限码：研发库用 rd-kb:*，部门库用共用的 dept-kb:*
  const P = kbId
    ? { upload: 'dept-kb:upload', manage: 'dept-kb:manage', entryEdit: 'dept-kb:entry:edit', entryMove: 'dept-kb:entry:move', entryDelete: 'dept-kb:entry:delete', catCreate: 'dept-kb:category:create', catEdit: 'dept-kb:category:edit', catDelete: 'dept-kb:category:delete' }
    : { upload: 'rd-kb:upload', manage: 'rd-kb:manage', entryEdit: 'rd-kb:entry:edit', entryMove: 'rd-kb:entry:move', entryDelete: 'rd-kb:entry:delete', catCreate: 'rd-kb:category:create', catEdit: 'rd-kb:category:edit', catDelete: 'rd-kb:category:delete' };
  // 留痕动作的 actor 信息，按当前账号填充；姓名/角色取自 user 对象
  const kbAuditActor = useAuditActor(user?.name || "成员");
  const isSuper = userPerms.includes('*');
  const canUpload =
    !!user &&
    (hasPermission(userPerms, P.upload) ||
      // 研发库额外放行「可建任务」的研发成员上传；部门库不沿用该旁路
      (!kbId && hasPermission(userPerms, 'rd-task:create')) ||
      isSuper);
  // 旧的笼统 manage 权限仍向后兼容；新拆分的 entry/category 权限按动作粒度判断
  const hasLegacyManage = hasPermission(userPerms, P.manage) || isSuper;
  const canEditEntry = hasLegacyManage || hasPermission(userPerms, P.entryEdit);
  const canMoveEntry = hasLegacyManage || hasPermission(userPerms, P.entryMove) || hasPermission(userPerms, P.entryEdit);
  const canDeleteEntry = hasLegacyManage || hasPermission(userPerms, P.entryDelete);
  const canCreateCategory = hasLegacyManage || hasPermission(userPerms, P.catCreate);
  const canEditCategory = hasLegacyManage || hasPermission(userPerms, P.catEdit);
  const canDeleteCategory = hasLegacyManage || hasPermission(userPerms, P.catDelete);
  // 兼容旧调用：原 `canManage` 现在等于"任一管理动作"
  const canManage = hasLegacyManage || canEditEntry || canDeleteEntry || canCreateCategory || canEditCategory || canDeleteCategory;

  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [page, setPage] = useState(1); // 当前页码（1 起；分页）
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); // 右侧条目展示：网格 / 列表
  const [loading, setLoading] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [fileTypeFilter, setFileTypeFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState(100);
  /** Entry pending deletion — drives the confirmation modal. */
  const [deletingEntry, setDeletingEntry] = useState<KbEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<KbCategory | null>(null);
  const [categoryDeleteLoading, setCategoryDeleteLoading] = useState(false);
  const [movingEntry, setMovingEntry] = useState<KbEntry | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KbEntry | null>(null);
  /** Entry whose preview modal is open. */
  const [previewEntry, setPreviewEntry] = useState<KbEntry | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [pageDragActive, setPageDragActive] = useState(false);
  const pageDragDepthRef = useRef(0);
  /** Always-current categories — readable inside callbacks without stale closure. */
  const categoriesRef = useRef<KbCategory[]>([]);
  /** Skips first run of the filter-change effect (which fires on mount). */
  const filterInitializedRef = useRef(false);

  // Keep refs in sync so callbacks always read fresh values without stale closures
  useEffect(() => { categoriesRef.current = categories; }, [categories]);

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
    Promise.all([fetchKbCategories(kbId), fetchKbEntries(undefined, kbId)])
      .then(([cats, ents]) => {
        setCategories(cats);
        categoriesRef.current = cats;
        setEntries(ents);
        setPage(1);
      })
      .catch(() => toast.error('知识库数据加载失败'))
      .finally(() => setLoading(false));
  }, [kbId]);

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
    fetchKbEntries(buildParams(), kbId)
      .then((ents) => {
        if (cancelled) return;
        React.startTransition(() => {
          setEntries(ents);
          setPage(1);
        });
      })
      .catch(() => { if (!cancelled) toast.error('知识库数据加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [buildParams, kbId]);

  // Refresh button handler — re-fetches categories + entries with current filters
  const handleRefresh = useCallback(() => {
    setLoading(true);
    Promise.all([fetchKbCategories(kbId), fetchKbEntries(buildParams(), kbId)])
      .then(([cats, ents]) => {
        React.startTransition(() => {
          setCategories(cats);
          categoriesRef.current = cats;
          setEntries(ents);
          setPage(1);
        });
      })
      .catch(() => toast.error('知识库数据加载失败'))
      .finally(() => setLoading(false));
  }, [buildParams, kbId]);

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

  // KB→RAG 一键回填：把知识库全部条目重新灌入向量索引，让 MateChat 能检索内部资料。
  // 适用场景：首次开启 RAG / 切换 Embedding 模型后 / 清理脏数据后。重复执行安全（幂等覆盖）。
  const [backfillingRag, setBackfillingRag] = useState(false);
  const handleBackfillRag = useCallback(async () => {
    if (backfillingRag) return;
    if (!window.confirm('将把知识库全部条目重新同步到 RAG 向量索引（按条调用 Embedding 模型，条目较多时可能耗时）。确定现在执行吗？')) return;
    setBackfillingRag(true);
    try {
      const res = await backfillKbToRag();
      toast.success(
        res.failed > 0
          ? `RAG 回填完成：成功索引 ${res.succeeded}/${res.total} 条，失败 ${res.failed} 条`
          : `RAG 回填完成：已索引 ${res.succeeded}/${res.total} 条知识库条目`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'RAG 回填失败，请稍后重试');
    } finally {
      setBackfillingRag(false);
    }
  }, [backfillingRag]);

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

  const totalPages = Math.max(1, Math.ceil(entries.length / KB_PAGE_SIZE));
  // 删除/移动后条目变少时，避免停留在已不存在的页码上
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const visibleEntries = useMemo(
    () => entries.slice((page - 1) * KB_PAGE_SIZE, page * KB_PAGE_SIZE),
    [entries, page],
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

  const handleEditRequest = useCallback((entry: KbEntry) => {
    setEditingEntry(entry);
  }, []);

  /** Opens the preview modal and records a view. */
  const handlePreview = useCallback((entry: KbEntry) => {
    setPreviewEntry(entry);
    void recordKbView(entry.id, kbId).catch(() => undefined);
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
      await deleteKbEntry(deletingEntry.id, kbId);
      toast.success('已删除');
      recordAudit({
        actor: kbAuditActor,
        action: "kb.entry.deleted",
        resource: { type: "knowledge", id: deletingEntry.id, name: deletingEntry.title },
        comment: `删除知识库文件「${deletingEntry.title}」`,
        metadata: {
          category_id: deletingEntry.category_id,
          file_name: deletingEntry.file_name,
          permission_level: deletingEntry.permission_level,
        },
        source: "web",
      });
      setEntries((prev) => prev.filter((e) => e.id !== deletingEntry.id));
      void fetchKbCategories(kbId).then(syncCategories).catch(() => undefined);
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
    const isCreate = categoryDialog.mode === 'create';
    const before = isCreate ? null : categoryDialog.category;
    try {
      const result = isCreate
        ? await createKbCategory(payload, kbId)
        : await updateKbCategory(categoryDialog.category.id, {
            label: payload.label,
            icon: payload.icon,
            color: payload.color,
          }, kbId);
      syncCategories(result.categories);

      // 留痕：新建或编辑分类
      if (isCreate) {
        recordAudit({
          actor: kbAuditActor,
          action: "kb.category.created",
          resource: { type: "knowledge", id: payload.label, name: payload.label },
          comment: `新建知识库分类「${payload.label}」`,
          metadata: {
            parent_id: payload.parent_id ?? null,
            icon: payload.icon,
            color: payload.color,
          },
          source: "web",
        });
      } else if (before) {
        const changes: { field: string; before?: unknown; after?: unknown }[] = [];
        if (before.label !== payload.label) changes.push({ field: 'label', before: before.label, after: payload.label });
        if (before.icon !== payload.icon) changes.push({ field: 'icon', before: before.icon, after: payload.icon });
        if (before.color !== payload.color) changes.push({ field: 'color', before: before.color, after: payload.color });
        recordAudit({
          actor: kbAuditActor,
          action: "kb.category.edited",
          resource: { type: "knowledge", id: before.id, name: payload.label },
          changes,
          comment: `编辑知识库分类「${payload.label}」`,
          source: "web",
        });
      }

      setCategoryDialog(null);
      toast.success(isCreate ? '类目已创建' : '类目已更新');
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
      const result = await deleteKbCategory(deletingCategory.id, kbId);
      syncCategories(result.categories);
      recordAudit({
        actor: kbAuditActor,
        action: "kb.category.deleted",
        resource: { type: "knowledge", id: deletingCategory.id, name: deletingCategory.label },
        comment: `删除知识库分类「${deletingCategory.label}」`,
        metadata: { affected_subcategory_ids: Array.from(deletedIds) },
        source: "web",
      });
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
      const updatedEntry = toListEntry(await moveKbEntry(movingEntry.id, categoryId, kbId));
      const nextCategories = updateCategoryCountsForMove(categoriesRef.current, previousCategoryId, updatedEntry.category_id);
      const activeCategoryScope = getCategoryScopeIds(nextCategories, selectedCatId);

      syncCategories(nextCategories);
      setEntries((prev) => {
        const movedEntryVisible = !activeCategoryScope || activeCategoryScope.has(updatedEntry.category_id);
        return prev
          .map((entry) => (entry.id === updatedEntry.id ? updatedEntry : entry))
          .filter((entry) => entry.id !== updatedEntry.id || movedEntryVisible);
      });
      recordAudit({
        actor: kbAuditActor,
        action: "kb.entry.moved",
        resource: { type: "knowledge", id: updatedEntry.id, name: updatedEntry.title },
        changes: [{ field: 'category_id', before: previousCategoryId, after: updatedEntry.category_id }],
        comment: `移动文件「${updatedEntry.title}」`,
        source: "web",
      });
      setMovingEntry(null);
      toast.success('文件已移动');
      void Promise.all([fetchKbCategories(kbId), fetchKbEntries(buildParams(), kbId)])
        .then(([nextCats, nextEntries]) => {
          React.startTransition(() => {
            syncCategories(nextCats);
            setEntries(nextEntries);
            setPage(1);
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
    void fetchKbCategories(kbId).then(syncCategories).catch(() => undefined);

    // 留痕：上传文件（每条文件分别记录，便于审计追溯到具体文件）
    for (const entry of sanitized) {
      recordAudit({
        actor: kbAuditActor,
        action: "kb.entry.uploaded",
        resource: { type: "knowledge", id: entry.id, name: entry.title },
        comment: `上传知识库文件「${entry.title}」`,
        metadata: {
          category_id: entry.category_id,
          file_name: entry.file_name,
          file_size: entry.file_size,
          file_type: entry.file_type,
          permission_level: entry.permission_level,
        },
        source: "web",
      });
    }
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
    <KbScopeContext.Provider value={kbId}>
    <div
      className="relative h-full overflow-hidden bg-slate-50/30 flex flex-col text-slate-900"
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {pageDragActive && canUpload && !showUpload && (
        <div className="pointer-events-none fixed inset-4 z-40 flex items-center justify-center rounded-2xl border border-indigo-200 bg-white/88 shadow-[0_28px_80px_rgba(79,70,229,0.18)] backdrop-blur-sm">
          <div className="absolute inset-0 rounded-2xl bg-slate-50/40" />
          <div className="relative flex items-center gap-4 rounded-xl border border-indigo-100 bg-white/95 px-6 py-5 text-slate-900 shadow-[0_16px_36px_rgba(79,70,229,0.12)]">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50">
              <Upload className="h-6 w-6 text-indigo-600" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-950">释放文件，进入上传队列</p>
              <p className="mt-1 text-xs text-slate-500">松开鼠标后选择分类与可见范围</p>
            </div>
          </div>
        </div>
      )}
      {/* Toolbar —— 单排：左 筛选/类型/权限；右 计数 + 视图切换 + 同步 + 更多 + 上传 */}
      <div className="mx-4 mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.05)] sm:mx-6">
        {/* 筛选输入 */}
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按标题、描述、标签筛选…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-800 outline-none transition-shadow placeholder-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition hover:text-slate-700"
              aria-label="清除筛选词"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 类型筛选 */}
        <NativeSelect
          value={fileTypeFilter}
          onValueChange={handleFileTypeFilterChange}
          className="h-9 w-auto min-w-[7rem] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-shadow focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        >
          {FILE_TYPE_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label === '全部' ? '全部类型' : option.label}
            </option>
          ))}
        </NativeSelect>

        {/* 权限筛选（下拉，语义同原滑块：展示权限分 ≤ N 的条目） */}
        <NativeSelect
          value={String(levelFilter)}
          onValueChange={(v) => setLevelFilter(Number(v))}
          className="h-9 w-auto min-w-[9rem] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-shadow focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="100">权限分 ≤ 100（全部）</option>
          <option value="75">权限分 ≤ 75（受限）</option>
          <option value="50">权限分 ≤ 50（内部）</option>
          <option value="25">权限分 ≤ 25（公开）</option>
        </NativeSelect>

        {/* 右侧：计数 + 视图切换 + 同步 + 更多 + 上传 */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* 计数（纯展示） */}
          <div className="hidden items-center gap-1.5 md:flex">
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">共 <span className="tabular-nums">{entries.length}</span></span>
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-600">文档 <span className="tabular-nums">{docCount}</span></span>
            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600">PDF <span className="tabular-nums">{pdfCount}</span></span>
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-600">图片 <span className="tabular-nums">{imageCount}</span></span>
          </div>

          {/* 网格 / 列表 视图切换 */}
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="网格视图"
              className={cn('flex h-7 w-8 items-center justify-center rounded-md transition', viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600')}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              title="列表视图"
              className={cn('flex h-7 w-8 items-center justify-center rounded-md transition', viewMode === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600')}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          {/* 同步（= 刷新，保留当前筛选） */}
          <Button
            type="button"
            variant="outline"
            onClick={handleRefresh}
            disabled={loading}
            className="h-9 gap-2 rounded-lg border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
            title="同步（保留当前筛选条件）"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            同步
          </Button>

          {/* 更多：修复文件名 / RAG 回填（仅研发库管理员） */}
          {!kbId && canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-lg border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-200"
                  title="更多操作"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleRepairFilenames} disabled={repairing} className="gap-2">
                  <Wrench className={cn('h-4 w-4', repairing && 'animate-spin')} />
                  {repairing ? '修复中…' : '修复文件名乱码'}
                </DropdownMenuItem>
                {hasLegacyManage && (
                  <DropdownMenuItem onClick={handleBackfillRag} disabled={backfillingRag} className="gap-2">
                    <DatabaseZap className={cn('h-4 w-4', backfillingRag && 'animate-pulse')} />
                    {backfillingRag ? 'RAG 回填中…' : 'RAG 回填'}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* 上传文件 */}
          {canUpload && (
            <Button
              type="button"
              onClick={() => openUploadDialog()}
              className="h-9 gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(79,70,229,0.20)] transition-all duration-200 hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" />
              上传文件
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-col lg:flex-row gap-4 px-4 sm:px-6 py-5 flex-1 min-h-0">
        {/* Sidebar */}
        <CategorySidebar
          categories={categories}
          selectedCatId={selectedCatId}
          canManage={canManage}
          canCreate={canCreateCategory}
          canEdit={canEditCategory}
          canDelete={canDeleteCategory}
          onSelect={handleSelectCategory}
          onCreate={handleCreateCategoryDialog}
          onEdit={handleEditCategoryDialog}
          onDelete={setDeletingCategory}
          categoryFileCounts={categoryFileCounts}
        />

        {/* Entry grid */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-4">
          {/* Result count */}
          <div className="shrink-0 flex items-center justify-between rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <span>
              {loading
                ? '加载中...'
                : hasActiveFilters
                  ? `筛选结果 ${entries.length} 条`
                  : `共 ${entries.length} 条记录`}
            </span>
            <span className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
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
                    className="mt-2 flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-sm font-medium rounded-lg transition-colors"
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
            <>
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                  {visibleEntries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      canEdit={canEditEntry}
                      canMove={canMoveEntry}
                      canDelete={canDeleteEntry}
                      onEdit={handleEditRequest}
                      onDelete={handleDelete}
                      onMove={handleMoveRequest}
                      onPreview={handlePreview}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {visibleEntries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      canEdit={canEditEntry}
                      canMove={canMoveEntry}
                      canDelete={canDeleteEntry}
                      onEdit={handleEditRequest}
                      onDelete={handleDelete}
                      onMove={handleMoveRequest}
                      onPreview={handlePreview}
                    />
                  ))}
                </div>
              )}
              </div>

              {/* 分页 — 仅在多于一页时出现 */}
              {totalPages > 1 && (
                <nav
                  aria-label="知识库分页"
                  className="shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                >
                  <span className="text-slate-500">
                    第 <span className="font-semibold tabular-nums text-slate-700">{page}</span> / {totalPages} 页 · 共{' '}
                    <span className="font-semibold tabular-nums text-slate-700">{entries.length}</span> 条
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-300 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="上一页"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                      <button
                        key={pg}
                        type="button"
                        onClick={() => setPage(pg)}
                        aria-current={pg === page ? 'page' : undefined}
                        className={cn(
                          'flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums transition',
                          pg === page
                            ? 'border-indigo-500 bg-indigo-600 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700',
                        )}
                      >
                        {pg}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={page === totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-300 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="下一页"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </nav>
              )}
            </>
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
          canSetPermissionLevel={hasLegacyManage}
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

      {/* Edit metadata modal */}
      {editingEntry && (
        <EditEntryDialog
          entry={editingEntry}
          categories={categories}
          onSaved={(updated) => {
            const before = editingEntry;
            const changes: { field: string; before?: unknown; after?: unknown }[] = [];
            if (before.title !== updated.title) changes.push({ field: 'title', before: before.title, after: updated.title });
            if ((before.description ?? '') !== (updated.description ?? '')) changes.push({ field: 'description', before: before.description, after: updated.description });
            if (before.category_id !== updated.category_id) changes.push({ field: 'category_id', before: before.category_id, after: updated.category_id });
            if (JSON.stringify(before.tags ?? []) !== JSON.stringify(updated.tags ?? [])) changes.push({ field: 'tags', before: before.tags, after: updated.tags });
            if ((before.permission_level ?? 0) !== (updated.permission_level ?? 0)) changes.push({ field: 'permission_level', before: before.permission_level, after: updated.permission_level });
            recordAudit({
              actor: kbAuditActor,
              action: "kb.entry.edited",
              resource: { type: "knowledge", id: updated.id, name: updated.title },
              changes,
              comment: `编辑知识库文件「${updated.title}」`,
              source: "web",
            });
            setEntries((prev) => prev.map((e) => (e.id === updated.id ? toListEntry(updated) : e)));
            void fetchKbCategories(kbId).then(syncCategories).catch(() => undefined);
            setEditingEntry(null);
          }}
          onClose={() => setEditingEntry(null)}
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
    </KbScopeContext.Provider>
  );
}
