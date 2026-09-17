import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileImage,
  FileText,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";

import { getExternalDocumentVersionPreviewContent } from "../lib/externalDocsApi";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "./ui/utils";
import { MobileZoomableImage } from "./MobileZoomableImage";
import { Button } from "./ui/button";

export type ExternalEvidenceVersion = {
  id: string;
  version: string;
  fileName: string;
};

export type ExternalEvidenceDifference = {
  id: string;
  title: string;
  location: string;
  before: string;
  after: string;
};

type EvidenceViewerProps = {
  difference: ExternalEvidenceDifference;
  baseline: ExternalEvidenceVersion;
  candidate: ExternalEvidenceVersion;
  onClose: () => void;
};

type PreviewKind = "docx" | "pdf" | "image" | "unsupported";

const DOCX_EXTENSIONS = new Set(["docx"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif"]);
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1];

function fileExtension(fileName: string) {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function previewKind(fileName: string): PreviewKind {
  const extension = fileExtension(fileName);
  if (DOCX_EXTENSIONS.has(extension)) return "docx";
  if (extension === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return "unsupported";
}

function lineNumberForSide(location: string, side: "baseline" | "candidate") {
  const pattern = side === "baseline" ? /基准第\s*(\d+)\s*行/ : /新版第\s*(\d+)\s*行/;
  const value = Number(location.match(pattern)?.[1] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function suggestedPageFromLine(lineNumber: number | null, pageCount: number) {
  if (!lineNumber || pageCount <= 1) return 1;
  // DOCX 文本行与视觉分页没有稳定的一一映射；这里只给出保守的建议页，
  // 用户仍可使用页码按钮逐页核对，避免把近似定位冒充精确坐标。
  return Math.min(pageCount, Math.max(1, Math.ceil(lineNumber / 40)));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DocxPageRenderer({
  blob,
  lineNumber,
}: {
  blob: Blob;
  lineNumber: number | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(0.65);

  const scrollToPage = useCallback((page: number, behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current;
    const pages = bodyRef.current?.querySelectorAll<HTMLElement>("section.docx");
    if (!viewport || !pages?.length) return;
    const nextPage = Math.min(pages.length, Math.max(1, page));
    const target = pages[nextPage - 1];
    const viewportRect = viewport.getBoundingClientRect();
    const pageRect = target.getBoundingClientRect();
    viewport.scrollTo({
      top: viewport.scrollTop + pageRect.top - viewportRect.top - 16,
      behavior,
    });
    setCurrentPage(nextPage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const body = bodyRef.current;
    if (!body) return;
    body.replaceChildren();
    setRendering(true);
    setError("");

    void import("docx-preview")
      .then(async ({ renderAsync }) => {
        if (cancelled) return;
        await renderAsync(blob, body, body, {
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderChanges: true,
          useBase64URL: true,
        });
        if (cancelled) return;
        const count = Math.max(1, body.querySelectorAll("section.docx").length);
        const suggestedPage = suggestedPageFromLine(lineNumber, count);
        setPageCount(count);
        setCurrentPage(suggestedPage);
        setRendering(false);
        window.requestAnimationFrame(() => scrollToPage(suggestedPage, "auto"));
      })
      .catch((renderError) => {
        if (cancelled) return;
        setRendering(false);
        setError(renderError instanceof Error ? renderError.message : "Word 页面渲染失败");
      });

    return () => {
      cancelled = true;
      body.replaceChildren();
    };
  }, [blob, lineNumber, scrollToPage]);

  const adjustZoom = (direction: -1 | 1) => {
    const currentIndex = ZOOM_STEPS.findIndex((value) => value === zoom);
    const nextIndex = Math.min(
      ZOOM_STEPS.length - 1,
      Math.max(0, currentIndex + direction),
    );
    setZoom(ZOOM_STEPS[nextIndex]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
        <div className="flex items-center gap-1">
          <Button variant="unstyled"
            type="button"
            onClick={() => scrollToPage(currentPage - 1)}
            disabled={rendering || currentPage <= 1}
            aria-label="上一页"
            title="上一页"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="min-w-[72px] text-center text-[11px] font-semibold tabular-nums text-slate-600">
            第 {currentPage} / {pageCount} 页
          </span>
          <Button variant="unstyled"
            type="button"
            onClick={() => scrollToPage(currentPage + 1)}
            disabled={rendering || currentPage >= pageCount}
            aria-label="下一页"
            title="下一页"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {lineNumber && (
            <span className="mr-2 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
              文本第 {lineNumber} 行附近
            </span>
          )}
          <Button variant="unstyled"
            type="button"
            onClick={() => adjustZoom(-1)}
            disabled={zoom === ZOOM_STEPS[0]}
            aria-label="缩小页面"
            title="缩小页面"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-35"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <span className="w-9 text-center text-[10px] font-semibold tabular-nums text-slate-500">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="unstyled"
            type="button"
            onClick={() => adjustZoom(1)}
            disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            aria-label="放大页面"
            title="放大页面"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-35"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="material-scrollbar relative min-h-0 flex-1 overflow-auto bg-slate-200"
      >
        {rendering && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100/95 text-slate-500">
            <Loader2 className="h-7 w-7 animate-spin text-blue-700" />
            <p className="mt-3 text-xs font-semibold">正在还原 Word 页面…</p>
            <p className="mt-1 text-[11px] text-muted-foreground">表格、图片与特殊符号均在浏览器本地解析</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white px-6 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="mt-3 text-sm font-semibold text-slate-800">无法生成 Word 页面预览</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{error}</p>
          </div>
        )}
        <div
          ref={bodyRef}
          style={{ zoom }}
          className={cn(
            "min-h-full origin-top-left py-4",
            "[&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0",
            "[&_section.docx]:!mb-5 [&_section.docx]:!shadow-[0_12px_32px_rgba(15,23,42,0.16)]",
          )}
        />
      </div>
    </div>
  );
}

function VersionEvidencePanel({
  version,
  excerpt,
  side,
  lineNumber,
}: {
  version: ExternalEvidenceVersion;
  excerpt: string;
  side: "baseline" | "candidate";
  lineNumber: number | null;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const kind = previewKind(version.fileName);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setBlob(null);
    void getExternalDocumentVersionPreviewContent(version.id, controller.signal)
      .then(setBlob)
      .catch((loadError) => {
        if ((loadError as Error).name !== "AbortError") {
          setError(loadError instanceof Error ? loadError.message : "原文件读取失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version.id]);

  const objectUrl = useMemo(() => blob ? URL.createObjectURL(blob) : "", [blob]);
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-slate-50">
      <div className={cn(
        "shrink-0 border-b px-4 py-3",
        side === "baseline" ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50/70",
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn(
                "rounded-md px-2 py-0.5 font-mono text-[11px] font-bold",
                side === "baseline" ? "bg-slate-100 text-slate-700" : "bg-white text-blue-700 ring-1 ring-blue-200",
              )}>
                {version.version}
              </span>
              <span className="text-[10px] font-semibold text-slate-500">
                {side === "baseline" ? "基准原文" : "候选原文"}
              </span>
            </div>
            <p className="mt-1.5 truncate text-xs font-semibold text-slate-800" title={version.fileName}>
              {version.fileName}
            </p>
          </div>
          <Button variant="unstyled"
            type="button"
            onClick={() => blob && downloadBlob(blob, version.fileName)}
            disabled={!blob}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px] border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[#8fa8df] hover:text-primary disabled:cursor-wait disabled:opacity-45"
          >
            <Download className="h-3.5 w-3.5" />
            下载原文件
          </Button>
        </div>
        <div className={cn(
          "mt-2 rounded-[4px] border px-3 py-2",
          side === "baseline" ? "border-rose-100 bg-rose-50/55" : "border-emerald-100 bg-emerald-50/60",
        )}>
          <p className="line-clamp-2 text-[11px] leading-5 text-slate-600" title={excerpt}>
            {excerpt || "该版本无可提取文本，请直接核对下方视觉原文。"}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-slate-100 text-slate-500">
          <Loader2 className="h-7 w-7 animate-spin text-blue-700" />
          <p className="mt-3 text-xs font-semibold">正在读取受控原文件…</p>
        </div>
      ) : error ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white px-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="mt-3 text-sm font-semibold text-slate-800">原文预览暂不可用</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{error}</p>
        </div>
      ) : blob && kind === "docx" ? (
        <DocxPageRenderer blob={blob} lineNumber={lineNumber} />
      ) : blob && kind === "pdf" ? (
        <iframe
          title={`${version.version} 原文预览`}
          src={`${objectUrl}#page=${suggestedPageFromLine(lineNumber, 20)}&zoom=page-width`}
          className="min-h-0 flex-1 border-0 bg-slate-200"
        />
      ) : blob && kind === "image" ? (
        <div className="material-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-slate-200 p-4">
          <MobileZoomableImage
            src={objectUrl}
            alt={`${version.version} 原文`}
            className="h-full w-full"
            imageClassName="rounded-sm bg-white shadow-[0_12px_32px_rgba(15,23,42,0.16)]"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white px-6 text-center">
          {kind === "image" ? <FileImage className="h-10 w-10 text-muted-foreground" /> : <FileText className="h-10 w-10 text-muted-foreground" />}
          <p className="mt-3 text-sm font-semibold text-slate-800">该格式暂不支持页面还原</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">可下载原文件使用对应软件核对，文本差异仍保留在主页面。</p>
        </div>
      )}
    </section>
  );
}

export function ExternalDocumentEvidenceViewer({
  difference,
  baseline,
  candidate,
  onClose,
}: EvidenceViewerProps) {
  const baselineLine = lineNumberForSide(difference.location, "baseline");
  const candidateLine = lineNumberForSide(difference.location, "candidate");

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        className="horizon-theme horizon-portal z-[90] flex h-[calc(100vh-16px)] w-[calc(100vw-16px)] max-w-none flex-col gap-0 overflow-hidden rounded-[4px] border border-slate-200 bg-slate-100 p-0 shadow-xl sm:max-w-none [&>button.absolute]:hidden"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#b8c8ec] bg-accent px-2.5 py-1 text-[10px] font-bold text-primary">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                受控原文视觉证据
              </span>
              <span className="text-[11px] text-muted-foreground">{difference.id} · {difference.location}</span>
            </div>
            <DialogTitle id="external-evidence-title" className="mt-2 truncate text-base font-semibold text-slate-950">
              {difference.title}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-slate-500">
              两个版本均在浏览器本地还原；建议页为辅助定位，最终以原文件及 SHA256 固化记录为准。
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="unstyled"
              type="button"
              aria-label="关闭原文视觉核对"
              title="关闭原文视觉核对"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-slate-200 bg-white text-slate-500 transition-colors hover:border-[#8fa8df] hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </DialogClose>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-slate-200">
          <VersionEvidencePanel
            version={baseline}
            excerpt={difference.before}
            side="baseline"
            lineNumber={baselineLine}
          />
          <VersionEvidencePanel
            version={candidate}
            excerpt={difference.after}
            side="candidate"
            lineNumber={candidateLine}
          />
        </div>

        <footer className="flex h-9 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            视觉预览用于核对复杂表格、图片、印章、特殊字体与低置信度文本
          </span>
          <span>文件未发送至第三方服务</span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
