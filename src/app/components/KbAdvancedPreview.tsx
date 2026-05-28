/**
 * 知识库非媒体类文件的客户端预览组件。
 *
 * - HTML: iframe + sandbox（沙箱化避免 KB 内嵌脚本影响主站）
 * - TXT/MD/JSON/CSV: fetch 纯文本 → <pre>
 * - XLSX/XLS/CSV: SheetJS 解析 → 表格视图
 * - DOCX/DOC: mammoth 转 HTML → div 渲染
 *
 * 所有解析都在浏览器内完成，文件不会离开用户网络（不像微软 Office Online viewer 把文件传到第三方）。
 */
import React, { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

type KbFileType = "html" | "text" | "xlsx" | "docx";

type Props = {
  fileUrl: string;
  fileType: KbFileType;
  fileName?: string;
};

export function KbAdvancedPreview({ fileUrl, fileType, fileName }: Props) {
  if (fileType === "html") {
    return <HtmlPreview fileUrl={fileUrl} title={fileName} />;
  }
  if (fileType === "text") {
    return <TextPreview fileUrl={fileUrl} />;
  }
  if (fileType === "xlsx") {
    return <XlsxPreview fileUrl={fileUrl} />;
  }
  if (fileType === "docx") {
    return <DocxPreview fileUrl={fileUrl} />;
  }
  return null;
}

// ─── HTML：iframe 沙箱 ────────────────────────────────────────────────────────

function HtmlPreview({ fileUrl, title }: { fileUrl: string; title?: string }) {
  return (
    <iframe
      src={fileUrl}
      className="w-full h-[70vh] border-0 bg-white"
      sandbox="allow-same-origin"
      title={title ?? "HTML 预览"}
    />
  );
}

// ─── TXT/MD/JSON/CSV：fetch 纯文本 ────────────────────────────────────────────

function TextPreview({ fileUrl }: { fileUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(fileUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((content) => {
        if (cancelled) return;
        // 最多展示前 50000 字符，超过截断（防止把浏览器卡死）
        setText(content.length > 50000 ? content.slice(0, 50000) + "\n\n…（已截断，剩余内容请下载查看）" : content);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "文件加载失败");
      });
    return () => { cancelled = true; };
  }, [fileUrl]);

  if (error) return <PreviewError message={error} />;
  if (text === null) return <PreviewLoading label="正在读取文本…" />;
  return (
    <pre className="m-0 max-h-[70vh] w-full overflow-auto bg-white p-4 font-mono text-[13px] leading-6 text-slate-800 whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

// ─── XLSX / XLS / CSV：SheetJS 解析 ───────────────────────────────────────────

function XlsxPreview({ fileUrl }: { fileUrl: string }) {
  const [sheets, setSheets] = useState<{ name: string; html: string }[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    (async () => {
      try {
        const [{ default: XLSX }, buf] = await Promise.all([
          // dynamic import：xlsx 包大约 700KB，只在用户真要预览时才下载
          import("xlsx") as Promise<{ default: typeof import("xlsx") }>,
          fetch(fileUrl).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
        ]);
        if (cancelled) return;
        const workbook = XLSX.read(buf, { type: "array" });
        const parsed = workbook.SheetNames.map((name) => ({
          name,
          html: XLSX.utils.sheet_to_html(workbook.Sheets[name], { editable: false }),
        }));
        if (cancelled) return;
        setSheets(parsed);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Excel 解析失败");
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  if (error) return <PreviewError message={error} />;
  if (sheets === null) return <PreviewLoading label="正在解析 Excel…" />;
  if (sheets.length === 0) return <PreviewError message="Excel 没有可显示的工作表" />;

  return (
    <div className="flex h-[70vh] w-full flex-col bg-white">
      {sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          {sheets.map((s, idx) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveSheet(idx)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                idx === activeSheet
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div
        className="flex-1 overflow-auto p-3 text-[12px] [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold"
        // SheetJS 生成的 HTML 已经做过转义，xlsx 库本身是可信源
        dangerouslySetInnerHTML={{ __html: sheets[activeSheet].html }}
      />
    </div>
  );
}

// ─── DOCX：mammoth 转 HTML ────────────────────────────────────────────────────

function DocxPreview({ fileUrl }: { fileUrl: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    (async () => {
      try {
        const [mammoth, buf] = await Promise.all([
          // dynamic import：mammoth 约 250KB，按需加载
          import("mammoth") as Promise<typeof import("mammoth")>,
          fetch(fileUrl).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          }),
        ]);
        if (cancelled) return;
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (cancelled) return;
        setHtml(result.value || "<p style='color:#94a3b8'>（文档为空）</p>");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Word 文档解析失败");
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  if (error) return <PreviewError message={error} />;
  if (html === null) return <PreviewLoading label="正在解析 Word 文档…" />;

  return (
    <div className="h-[70vh] w-full overflow-auto bg-white px-8 py-6">
      <div
        className="prose prose-slate prose-sm max-w-none [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ─── 共用 loading / error 视图 ────────────────────────────────────────────────

function PreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-slate-400">
      <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

function PreviewError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 px-6 text-center">
      <div className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
        <AlertCircle className="h-8 w-8 text-red-500" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">无法预览此文件</p>
        <p className="mt-1 text-xs text-slate-400">{message}</p>
        <p className="mt-2 text-xs text-slate-400">请下载到本地后用对应软件查看</p>
      </div>
    </div>
  );
}
