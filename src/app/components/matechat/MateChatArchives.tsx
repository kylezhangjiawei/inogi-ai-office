import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Check, Download, FileText, Loader2, Search, X } from "lucide-react";
import { authFetch } from "../../lib/authSession";
import { t, useI18n } from "../../lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { NativeSelect } from "../ui/native-select";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";

type FileItem = { id: string; name: string; folder: string; size: number; source: string };
type Selection = { selectionId: string | null; total: number; files: FileItem[]; warnings: string[]; nextOffset?: number | null; tooMany?: boolean; hasMore?: boolean };
type ArchiveJob = { id: string; filename: string; status: string; total: number; processed: number; succeeded: number; failed: number; bytes: number; error?: string; expiresAt: string; cancelRequested: boolean };
type Report = { rows: Array<{ id: string; name: string; path: string; status: string; error?: string }>; nextOffset: number | null };
const labels: Record<string, string> = { queued: "排队中", running: "打包中", succeeded: "已完成", partial: "部分完成", failed: "打包失败", canceled: "已取消", expired: "已过期" };
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : bytes > 0 ? `${Math.ceil(bytes / 1024)} KB` : t("大小待核验");
const control = "min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const action = `${control} inline-flex items-center justify-center gap-1.5 hover:bg-slate-50`;

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await authFetch(`/api/chat/${path}`, body === undefined ? { signal } : { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join("；") : payload.message || t("请求失败，请重试"));
  return payload as T;
}

/** 单会话一个轮询器；切换会话/关闭面板取消请求，后台任务继续运行。 */
export function MateChatArchives({ conversationId, active, refreshKey, selectionId }: {
  conversationId: string; active: boolean; refreshKey: number; selectionId?: string;
}) {
  useI18n();
  const [jobs, setJobs] = useState<ArchiveJob[]>([]);
  const [open, setOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [source, setSource] = useState("task");
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filename, setFilename] = useState("");
  const [grouping, setGrouping] = useState("source");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<{ id: string; filename: string; report: Report } | null>(null);
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const value = await request<ArchiveJob[]>(`conversations/${encodeURIComponent(conversationId)}/archives`, undefined, signal);
    if (!signal?.aborted && mounted.current) setJobs(value);
    return value;
  }, [conversationId]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 15000;
      try {
        if (!document.hidden) {
          const value = await refresh(controller.signal);
          if (value.some((job) => job.status === "queued" || job.status === "running")) delay = 3000;
        }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t("无法读取打包进度")); }
      if (!controller.signal.aborted) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, refresh, refreshKey]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = async () => {
      const latest = selectionId ?? (await request<Array<{ selectionId: string }>>(`conversations/${encodeURIComponent(conversationId)}/file-selections`, undefined, controller.signal))[0]?.selectionId;
      return latest ? request<Selection>(`file-selections/${encodeURIComponent(latest)}?conversationId=${encodeURIComponent(conversationId)}`, undefined, controller.signal) : null;
    };
    void load()
      .then((value) => { if (!controller.signal.aborted) { setSelection(value); setSelected(new Set()); if (value) setFiltersOpen(false); } })
      .catch(() => {});
    return () => controller.abort();
  }, [selectionId, conversationId, active]);

  const run = async (key: string, task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(key); setError("");
    try { await task(controller.signal); }
    catch (err) { if (!controller.signal.aborted && mounted.current) setError(err instanceof Error ? err.message : t("请求失败，请重试")); }
    finally { operation.current = null; if (mounted.current) setBusy(""); }
  };
  const search = () => run("search", async (signal) => {
    const result = await request<Selection>("files/search", { conversationId, sources: source === "all" ? undefined : [source],
      project: source === "task" ? project || undefined : undefined, query: query || undefined, types: type ? [type] : undefined,
      date_from: dateFrom || undefined, date_to: dateTo || undefined }, signal);
    setSelection(result); setSelected(new Set()); setFiltersOpen(false);
  });
  const more = () => run("more", async (signal) => {
    if (!selection?.selectionId) return;
    const result = await request<Selection>(`file-selections/${selection.selectionId}?conversationId=${encodeURIComponent(conversationId)}&offset=${selection.files.length}`, undefined, signal);
    setSelection((current) => current ? { ...result, files: [...current.files, ...result.files] } : result);
  });
  const create = (all: boolean) => run("create", async (signal) => {
    if (!selection?.selectionId) return;
    await request("archives", { conversationId, selection_ids: [selection.selectionId], file_ids: all ? undefined : [...selected], filename: filename || undefined, grouping }, signal);
    await refresh(signal); setOpen(false);
  });
  const jobAction = (job: ArchiveJob, verb: "cancel" | "retry" | "download") => run(job.id, async (signal) => {
    if (verb === "download") {
      const result = await request<{ url: string; filename: string }>(`archives/${job.id}/download`, {}, signal);
      const url = new URL(result.url, window.location.origin);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error(t("下载地址无效"));
      const anchor = document.createElement("a"); anchor.href = url.href; anchor.download = result.filename; anchor.rel = "noopener noreferrer"; anchor.target = "_blank"; anchor.click();
    } else { await request(`archives/${job.id}/${verb}`, {}, signal); await refresh(signal); }
  });
  const showReport = (job: ArchiveJob) => run(job.id, async (signal) => {
    const report = await request<Report>(`archives/${job.id}`, undefined, signal);
    setDetail({ id: job.id, filename: job.filename, report });
  });

  return <section className="mt-3 space-y-2" aria-label={t("资料包")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="unstyled" type="button" className={action} onClick={() => setOpen(true)}><Archive className="size-4" />{t("查找并打包")}{selection?.total ? <span className="tabular-nums text-primary">{selection.total}</span> : null}</Button>
      {jobs.some((job) => job.status === "running" || job.status === "queued") ? <span className="text-xs text-slate-500">{t("关闭聊天后仍会继续打包")}</span> : null}
    </div>
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p> : null}
    {jobs.length ? <div className="max-h-40 space-y-2 overflow-y-auto sm:max-h-64">{jobs.map((job) => {
      const running = job.status === "queued" || job.status === "running";
      return <article key={job.id} className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-start gap-2.5">
          <Archive className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium text-slate-800">{job.filename}</p><p className="mt-0.5 text-xs text-slate-500">{t(labels[job.status] ?? job.status)} · <span className="tabular-nums">{job.processed}/{job.total}</span> {t("个文件")}{job.failed ? ` · ${job.failed} ${t("个未打包")}` : ""}</p></div>
          {running ? <Loader2 className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-label={t("打包中")} /> : job.status === "succeeded" ? <Check className="size-4 shrink-0 text-emerald-600" /> : null}
        </div>
        {running ? <progress className="mt-2 h-1.5 w-full accent-primary" value={job.processed} max={job.total || 1} aria-label={t("文件处理进度")} /> : null}
        {job.error ? <p className="mt-2 text-xs text-rose-700">{job.error}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {["succeeded", "partial"].includes(job.status) ? <Button variant="unstyled" className={action} type="button" disabled={!!busy} onClick={() => void jobAction(job, "download")}><Download className="size-3.5" />{t("下载 ZIP")} · {size(job.bytes)}</Button> : null}
          {running ? <Button variant="unstyled" className={action} type="button" disabled={!!busy || job.cancelRequested} onClick={() => void jobAction(job, "cancel")}><X className="size-3.5" />{t(job.cancelRequested ? "正在取消" : "取消打包")}</Button> : null}
          {["failed", "partial", "canceled"].includes(job.status) ? <Button variant="unstyled" className={action} type="button" disabled={!!busy} onClick={() => void jobAction(job, "retry")}>{t("重试打包")}</Button> : null}
          {job.processed > 0 ? <Button variant="unstyled" className={action} type="button" disabled={!!busy} onClick={() => void showReport(job)}><FileText className="size-3.5" />{t("文件清单")}</Button> : null}
        </div>
        {["succeeded", "partial"].includes(job.status) ? <p className="mt-2 text-[11px] text-muted-foreground">{t("下载有效期至")} {new Date(job.expiresAt).toLocaleString()} · {t("下载时重新校验源文件权限")}</p> : null}
      </article>;
    })}</div> : null}

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[88dvh] max-w-2xl flex-col overflow-hidden bg-white">
      <DialogHeader><DialogTitle>{t("查找并打包")}</DialogTitle><DialogDescription>{t("只查找你有权访问的原文件。可按来源、时间和类型筛选，再选择文件生成 ZIP。")}</DialogDescription></DialogHeader>
      <details open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)} className="shrink-0"><summary className="mb-2 cursor-pointer text-xs font-medium text-primary">{t("筛选条件")}</summary>
      <form className="grid grid-cols-2 gap-2 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="space-y-1 text-xs text-slate-500">{t("资料来源")}<NativeSelect className={`${control} w-full`} value={source} onChange={(e) => setSource(e.target.value)}>{[["task", "项目任务附件"], ["knowledge", "知识库文件"], ["image", "我的图片作品"], ["video", "我的视频作品"], ["chat", "我的聊天附件"], ["all", "全部已接入来源"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</NativeSelect></label>
        {source === "task" ? <label className="space-y-1 text-xs text-slate-500">{t("项目或任务名称")}<Input className={`${control} w-full`} value={project} onChange={(e) => setProject(e.target.value)} placeholder={t("不填则不限项目")} /></label> : null}
        <label className="space-y-1 text-xs text-slate-500">{t("文件关键词")}<Input className={`${control} w-full`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("名称或已有描述")} /></label>
        <label className="space-y-1 text-xs text-slate-500">{t("文件类型")}<NativeSelect className={`${control} w-full`} value={type} onChange={(e) => setType(e.target.value)}>{[["", "全部类型"], ["image", "图片"], ["video", "视频"], ["pdf", "PDF"], ["document", "文档与表格"], ["audio", "音频"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</NativeSelect></label>
        <label className="space-y-1 text-xs text-slate-500">{t("开始日期")}<Input type="date" className={`${control} w-full`} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="space-y-1 text-xs text-slate-500">{t("结束日期")}<Input type="date" className={`${control} w-full`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <Button variant="unstyled" className={`${action} col-span-2 sm:col-span-3`} disabled={!!busy} type="submit">{busy === "search" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}{t("查找文件")}</Button>
      </form>
      </details>
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      {selection ? <>
        <div className="flex items-center justify-between text-xs text-slate-600"><span>{t("找到")} {selection.total} {t("个文件")} · {t("已选择")} {selected.size}</span><Button variant="unstyled" type="button" className={action} onClick={() => setSelected(new Set())}>{t("清除选择")}</Button></div>
        {selection.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-700">{warning}</p>)}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200">
          {selection.files.map((file) => <label key={file.id} className="flex cursor-pointer items-start gap-3 border-b border-slate-100 p-2.5 last:border-0 hover:bg-slate-50">
            <Checkbox className="mt-1 size-4 shrink-0 accent-primary" checked={selected.has(file.id)} onCheckedChange={(checkedValue) => setSelected((prev) => { const next = new Set(prev); if ((checkedValue === true)) next.add(file.id); else next.delete(file.id); return next; })} />
            <span className="min-w-0 flex-1"><span className="block break-all text-xs font-medium text-slate-800">{file.name}</span><span className="mt-1 block break-all text-[11px] text-slate-500">{file.folder} · {size(file.size)}</span></span>
          </label>)}
          {selection.selectionId && selection.files.length < selection.total ? <Button variant="unstyled" type="button" className={`${action} m-2`} onClick={() => void more()} disabled={!!busy}>{t("加载更多文件")}</Button> : null}
        </div>
        <div className="grid grid-cols-2 gap-2"><Input aria-label={t("压缩包名称")} className={control} placeholder={t("压缩包名称")} value={filename} onChange={(e) => setFilename(e.target.value)} /><NativeSelect aria-label={t("文件分组")} className={control} value={grouping} onChange={(e) => setGrouping(e.target.value)}><option value="source">{t("按来源分文件夹")}</option><option value="type">{t("按类型分文件夹")}</option><option value="flat">{t("不分文件夹")}</option></NativeSelect></div>
        <div className="flex flex-wrap gap-2"><Button variant="unstyled" className={action} type="button" disabled={!!busy || !selection.selectionId || !selected.size} onClick={() => void create(false)}>{t("打包已选")} ({selected.size})</Button><Button variant="unstyled" className={`${action} border-primary text-primary`} type="button" disabled={!!busy || !selection.selectionId || !selection.total} onClick={() => void create(true)}>{t("打包全部结果")} ({selection.total})</Button></div>
        <p className="text-[11px] text-slate-500">{t("全部结果包含尚未加载的文件。系统自动去重，并附上来源与失败清单。")}</p>
      </> : null}
    </DialogContent></Dialog>
    <Dialog open={!!detail} onOpenChange={(value) => { if (!value) setDetail(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto bg-white"><DialogHeader><DialogTitle>{t("文件清单")}</DialogTitle><DialogDescription>{detail?.filename}</DialogDescription></DialogHeader>
      {detail?.report.rows.map((row) => <div key={row.id} className="border-b border-slate-100 py-2 text-xs"><p className="break-all font-medium">{row.name}</p><p className={row.status === "failed" ? "mt-1 text-rose-700" : "mt-1 break-all text-slate-500"}>{row.status === "failed" ? row.error : `${row.status === "duplicate" ? t("重复内容，已合并") : t("已打包")} · ${row.path}`}</p></div>)}
      {detail?.report.nextOffset !== null && detail?.report.nextOffset !== undefined ? <Button variant="unstyled" type="button" className={action} disabled={!!busy} onClick={() => void run("report", async (signal) => { const report = await request<Report>(`archives/${detail.id}?offset=${detail.report.nextOffset}`, undefined, signal); setDetail((prev) => prev ? { ...prev, report: { ...report, rows: [...prev.report.rows, ...report.rows] } } : prev); })}>{t("加载更多文件")}</Button> : null}
    </DialogContent></Dialog>
  </section>;
}
