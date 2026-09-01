import { useRef, useState } from "react";
import { CloudUpload, FileVideo, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./ui/button";
import { cn } from "./ui/utils";
import { ModalShell } from "./MediaCategorySidebar";
import { uploadResourceFile, type ResourceBusinessType } from "../lib/resourceUpload";
import { flattenCategories, type MediaCategoryNode } from "../lib/mediaCategory";

export type MediaUploadKind = "image" | "video";

/** 前端量到的原始规格，仅用于卡片展示（服务端不做校验，只存字符串 / 秒数）。 */
export type MediaProbe = {
  /** 画面尺寸，如 1920x1080 */
  size?: string;
  /** 时长（秒，取整），仅视频有 */
  duration?: number;
};

export type MediaUploadInput = {
  fileId: string;
  title: string;
  categoryId: string | null;
  probe: MediaProbe;
};

// 大小上限与后端 OSS_MAX_FILE_SIZE['library/*'] 一致，前端先拦一道少传一趟
const KIND_CONFIG: Record<
  MediaUploadKind,
  { label: string; accept: string; businessType: ResourceBusinessType; maxBytes: number; hint: string }
> = {
  image: {
    label: "图片",
    accept: "image/jpeg,image/png,image/webp,image/gif",
    businessType: "library/images",
    maxBytes: 20 * 1024 * 1024,
    hint: "支持 JPG / PNG / WebP / GIF，单个文件最大 20MB",
  },
  video: {
    label: "视频",
    accept: "video/mp4,video/quicktime,video/webm",
    businessType: "library/videos",
    maxBytes: 200 * 1024 * 1024,
    hint: "支持 MP4 / MOV / WebM，单个文件最大 200MB",
  },
};

type RowStatus = "pending" | "uploading" | "done" | "error";

type UploadRow = {
  localId: string;
  file: File;
  status: RowStatus;
  error?: string;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 读原图尺寸；读不到就不填，不影响入库。 */
function probeImage(file: File): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image.naturalWidth && image.naturalHeight ? { size: `${image.naturalWidth}x${image.naturalHeight}` } : {});
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    image.src = url;
  });
}

/** 读视频画面尺寸与时长；读不到就不填，不影响入库。 */
function probeVideo(file: File): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (probe: MediaProbe) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(guard);
      URL.revokeObjectURL(url);
      resolve(probe);
    };
    const sizeOf = () =>
      video.videoWidth && video.videoHeight ? { size: `${video.videoWidth}x${video.videoHeight}` } : {};
    const durationOf = () =>
      Number.isFinite(video.duration) && video.duration > 0 ? { duration: Math.round(video.duration) } : {};

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = durationOf();
      if (duration.duration) {
        finish({ ...sizeOf(), ...duration });
        return;
      }
      // 有些 webm（尤其浏览器 MediaRecorder 录出来的）头里没写时长，duration 报 Infinity。
      // 跳到一个远超片长的位置，浏览器解析到文件末尾后会把真实时长回填进 duration。
      video.ontimeupdate = () => {
        video.ontimeupdate = null;
        finish({ ...sizeOf(), ...durationOf() });
      };
      video.currentTime = 1e6;
    };
    video.onerror = () => finish({});
    // 兜底：损坏文件可能既不触发 loadedmetadata 也不触发 error，别把上传卡在探测上
    const guard = window.setTimeout(() => finish(sizeOf()), 5000);
    video.src = url;
  });
}

/**
 * 作品库本地上传弹窗：图像库与视频库共用。
 * 逐个文件「直传 OSS → 调 register 登记入库」，成功的留痕在行上，失败的可以只重试它。
 */
export function MediaUploadDialog({
  kind,
  categories,
  defaultCategoryId,
  onClose,
  onUploaded,
  register,
}: {
  kind: MediaUploadKind;
  categories: MediaCategoryNode[];
  /** 打开时预选的分类（一般是当前筛选中的分类） */
  defaultCategoryId: string | null;
  onClose: () => void;
  /** 至少成功一件后回调，用于刷新列表与分类计数 */
  onUploaded: () => void;
  register: (input: MediaUploadInput) => Promise<void>;
}) {
  const config = KIND_CONFIG[kind];
  const flatCategories = flattenCategories(categories);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState("");

  const pendingCount = rows.filter((row) => row.status === "pending" || row.status === "error").length;

  function addFiles(fileList: FileList | null) {
    if (uploading || !fileList?.length) return;
    const incoming = Array.from(fileList);
    const tooLarge = incoming.filter((file) => file.size > config.maxBytes);
    if (tooLarge.length > 0) {
      const message = `${tooLarge.length} 个文件超过 ${formatSize(config.maxBytes)}，已跳过`;
      setSelectionError(message);
      toast.error(message);
    } else {
      setSelectionError("");
    }
    const accepted = incoming
      .filter((file) => file.size <= config.maxBytes)
      .map((file) => ({ localId: `${file.name}-${file.size}-${file.lastModified}`, file, status: "pending" as RowStatus }));
    setRows((current) => {
      const seen = new Set(current.map((row) => row.localId));
      return [...current, ...accepted.filter((row) => !seen.has(row.localId))];
    });
  }

  function updateRow(localId: string, patch: Partial<UploadRow>) {
    setRows((current) => current.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }

  async function handleUpload() {
    const targets = rows.filter((row) => row.status === "pending" || row.status === "error");
    if (targets.length === 0) return;

    setUploading(true);
    setProgress({ done: 0, total: targets.length });
    let succeeded = 0;
    // 串行上传：并发直传大文件容易把浏览器连接数和上游带宽打满，反而更慢更容易失败
    for (const row of targets) {
      updateRow(row.localId, { status: "uploading", error: undefined });
      try {
        const probe = kind === "image" ? await probeImage(row.file) : await probeVideo(row.file);
        const uploaded = await uploadResourceFile(row.file, config.businessType);
        await register({
          fileId: uploaded.fileId,
          title: row.file.name,
          categoryId: categoryId || null,
          probe,
        });
        updateRow(row.localId, { status: "done" });
        succeeded += 1;
      } catch (error) {
        updateRow(row.localId, {
          status: "error",
          error: error instanceof Error ? error.message : "上传失败",
        });
      }
      setProgress((current) => ({ ...current, done: current.done + 1 }));
    }
    setUploading(false);

    if (succeeded > 0) {
      toast.success(`已上传 ${succeeded} 个${config.label}`);
      onUploaded();
    }
    if (succeeded === targets.length) onClose();
  }

  return (
    <ModalShell
      title={`上传${config.label}`}
      description={config.hint}
      onClose={onClose}
      dismissible={!uploading}
      widthClass="sm:max-w-lg"
    >
      <div
        className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
      >
        <div
          role="button"
          tabIndex={uploading ? -1 : 0}
          aria-disabled={uploading}
          aria-describedby="media-upload-format-hint"
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          onClick={() => {
            if (!uploading) inputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (!uploading && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            uploading
              ? "cursor-not-allowed border-slate-200 bg-slate-50/60 opacity-60"
              : dragging
                ? "cursor-pointer border-blue-500 bg-blue-50"
                : "cursor-pointer border-slate-300 bg-slate-50 hover:border-blue-400",
          )}
        >
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
            {kind === "image" ? <ImagePlus className="size-5" /> : <FileVideo className="size-5" />}
          </div>
          <p className="text-xs font-semibold text-slate-700">
            点击选择，或把{config.label}拖到这里（可一次多个）
          </p>
          <p id="media-upload-format-hint" className="text-pretty text-[11px] text-slate-500">{config.hint}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={config.accept}
          className="hidden"
          aria-label={`选择要上传的${config.label}`}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {selectionError ? <p role="alert" className="text-pretty text-xs text-rose-700">{selectionError}</p> : null}

        <div className="space-y-1.5">
          <label htmlFor="media-upload-category" className="text-xs font-semibold text-slate-600">
            放入分类
          </label>
          <select
            id="media-upload-category"
            value={categoryId}
            disabled={uploading}
            onChange={(event) => setCategoryId(event.target.value)}
            className="material-input h-10 w-full rounded-md px-2 text-xs"
          >
            <option value="">未分类</option>
            {flatCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </select>
        </div>

        {rows.length > 0 ? (
          <div className="space-y-1.5">
            {rows.map((row) => (
              <div
                key={row.localId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={row.file.name}>
                  {row.file.name}
                </span>
                <span className="shrink-0 tabular-nums text-[11px] text-slate-400">{formatSize(row.file.size)}</span>
                {row.status === "uploading" ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-[#002fa7] motion-reduce:animate-none" />
                ) : row.status === "done" ? (
                  <span className="shrink-0 text-[11px] font-semibold text-emerald-600">已入库</span>
                ) : row.status === "error" ? (
                  <span className="shrink-0 text-[11px] font-semibold text-rose-700">
                    失败
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((item) => item.localId !== row.localId))}
                    aria-label={`移除 ${row.file.name}`}
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
                {row.status === "error" && row.error ? <p role="alert" className="basis-full text-pretty text-[11px] text-rose-700">{row.error}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {uploading ? (
        <div className="border-t border-slate-100 bg-blue-50 px-5 py-2 text-xs font-medium tabular-nums text-[#002fa7]" role="status" aria-live="polite">
          正在上传 {progress.done}/{progress.total}，请勿关闭窗口。
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={uploading}>
          {rows.some((row) => row.status === "done") ? "关闭" : "取消"}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleUpload()}
          disabled={uploading || pendingCount === 0}
          className="hz-primary-action"
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <CloudUpload className="size-3.5" />}
          {uploading
            ? `上传中 ${Math.min(progress.done + 1, progress.total)}/${progress.total}…`
            : pendingCount > 0
              ? `开始上传（${pendingCount}）`
              : "开始上传"}
        </Button>
      </div>
    </ModalShell>
  );
}

/** 页面工具条上的「上传」按钮，两个作品库共用同一套样式。 */
export function MediaUploadButton({
  kind,
  onClick,
  className,
}: {
  kind: MediaUploadKind;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className={cn(
        "hz-primary-action h-10 shrink-0 text-xs",
        className,
      )}
    >
      <CloudUpload className="size-4" />
      上传{KIND_CONFIG[kind].label}
    </Button>
  );
}
