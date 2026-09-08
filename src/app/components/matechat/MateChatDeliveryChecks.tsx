import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, Check, FileCheck2, FileText, Loader2, PencilLine, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { cn } from "../ui/utils";
import { deliveryTaskDraft, workspaceRequest, WorkspaceRequestError, type DeliveryCheck, type DeliveryRequirement, type DeliveryRow } from "./matechatWorkspaceApi";

const control = "min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7] disabled:cursor-not-allowed disabled:opacity-50";
const button = `${control} inline-flex items-center justify-center gap-1.5 hover:bg-slate-50`;
const primary = cn(button, "border-[#002fa7] bg-[#002fa7] text-white hover:bg-[#002581]");
const statusLabels: Record<DeliveryRow["status"], string> = { missing: "未找到资料", candidate: "待核对", confirmed: "已确认", not_required: "不适用" };
const statusColors: Record<DeliveryRow["status"], string> = { missing: "bg-rose-50 text-rose-700", candidate: "bg-amber-50 text-amber-800", confirmed: "bg-emerald-50 text-emerald-700", not_required: "bg-slate-100 text-slate-500" };
const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export function MateChatDeliveryChecks({ conversationId, active, taskId, launchKey, refreshKey, onDraftTask, onArchive, onLaunchHandled }: {
  conversationId: string; active: boolean; taskId?: string; launchKey: number; refreshKey: number;
  onDraftTask: (text: string, taskId: string) => void; onArchive: () => void;
  onLaunchHandled?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<DeliveryCheck[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [taskInput, setTaskInput] = useState(taskId ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<DeliveryRequirement[] | null>(null);
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const check = checks.find((item) => item.id === selectedId) ?? null;
  const seenLaunch = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  useEffect(() => {
    if (launchKey > seenLaunch.current) {
      seenLaunch.current = launchKey; setOpen(true); setTaskInput(taskId ?? ""); setEditing(null); setError("");
      setSelectedId("");
      onLaunchHandled?.();
    }
  }, [launchKey, taskId, onLaunchHandled]);
  useEffect(() => {
    if (!active) { setOpen(false); return; }
    if (!open && !refreshKey) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void workspaceRequest<DeliveryCheck[]>(`delivery-checks?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal }).then((items) => {
      if (controller.signal.aborted) return;
      setChecks(items);
      setSelectedFiles({}); setEditing(null);
      setSelectedId((current) => items.some((item) => item.id === current) ? current : (taskId ? items.find((item) => item.taskId === taskId)?.id : items[0]?.id) ?? "");
    }).catch((err) => {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : "无法读取检查记录"); setChecks([]); setSelectedId(""); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, open, conversationId, taskId, refreshKey, launchKey]);
  useEffect(() => { setSelectedFiles({}); setEditing(null); }, [selectedId]);

  const adopt = useCallback((value: DeliveryCheck) => {
    setChecks((current) => [value, ...current.filter((item) => item.id !== value.id)]);
    setSelectedId(value.id); setSelectedFiles({});
  }, []);
  const run = async (name: string, task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(name); setError(""); setNotice("");
    try { await task(controller.signal); }
    catch (err) {
      if (!controller.signal.aborted && mounted.current) {
        setError(err instanceof Error ? err.message : "操作未完成，请重试");
        if (err instanceof WorkspaceRequestError && [401, 403, 404].includes(err.status)) { setChecks([]); setSelectedId(""); }
        if (err instanceof WorkspaceRequestError && err.status === 409) {
          try {
            const latest = await workspaceRequest<DeliveryCheck[]>(`delivery-checks?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal });
            if (!controller.signal.aborted && mounted.current) { setChecks(latest); setSelectedFiles({}); setEditing(null); setNotice("已载入最新检查记录，请重新核对后操作。"); }
          } catch { if (!controller.signal.aborted && mounted.current) { setChecks([]); setSelectedId(""); } }
        }
      }
    }
    finally { if (operation.current === controller) operation.current = null; if (mounted.current) setBusy(""); }
  };
  const patchRow = (row: DeliveryRow, status: "open" | "confirmed" | "not_required") => run(row.id, async (signal) => {
    if (!check) return;
    const evidenceFileIds = selectedFiles[row.id] ?? row.evidenceFileIds;
    const result = await workspaceRequest<DeliveryCheck>(`delivery-checks/${encodeURIComponent(check.id)}`, { method: "PATCH", signal, body: {
      revision: check.revision, updates: [{ id: row.id, status, ...(status === "confirmed" ? { evidenceFileIds } : {}) }],
    } });
    if (!signal.aborted) adopt(result);
  });
  const preview = (fileId: string) => {
    if (!check || busy) return;
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    void run(`preview:${fileId}`, async (signal) => {
      try {
        const result = await workspaceRequest<{ url: string; name: string; isTaskPage: boolean }>(`delivery-checks/${encodeURIComponent(check.id)}/files/${encodeURIComponent(fileId)}/preview`, { signal, body: { revision: check.revision } });
        if (signal.aborted) { target?.close(); return; }
        if (!/^https?:\/\//i.test(result.url) && !/^\/(?!\/)/.test(result.url)) throw new Error("资料地址不可用，请从原任务查看");
        if (target) target.location.href = result.url;
        else setNotice("浏览器阻止了新窗口，请允许弹出窗口后重新点击查看原件。");
      } catch (err) { target?.close(); throw err; }
    });
  };

  return <>
    <button type="button" onClick={() => { setOpen(true); setTaskInput(taskId ?? ""); }} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs font-medium text-[#002fa7] hover:bg-[#eef3ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]">
      <FileCheck2 className="size-4" />结项资料检查{checks.length ? <span className="rounded bg-[#eef3ff] px-1.5 tabular-nums">{checks.length}</span> : null}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="horizon-portal flex max-h-[90dvh] w-[calc(100%-24px)] flex-col gap-0 overflow-hidden border-[#e9edf7] bg-white p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900"><FileCheck2 className="size-5 text-[#002fa7]" />研发结项资料检查</DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5 text-slate-500">核对清单、查看原件，再整理已确认的资料。检查结果会保存到当前会话。</DialogDescription>
        </DialogHeader>
        <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error ? <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div> : null}
          {notice ? <div role="status" className="mb-4 rounded-xl border border-[#dbe5ff] bg-[#eef3ff] p-3 text-sm text-[#002fa7]">{notice}</div> : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">研发任务编号<input value={taskInput} onChange={(event) => setTaskInput(event.target.value)} placeholder="例如 RD-2026-…" className={`${control} mt-1 block w-full min-w-40`} disabled={Boolean(busy)} /></label>
            <button type="button" className={primary} disabled={Boolean(busy) || loading || !taskInput.trim()} onClick={() => void run("create", async (signal) => {
              const result = await workspaceRequest<DeliveryCheck>("delivery-checks", { signal, body: { conversationId, taskId: taskInput.trim() } });
              if (!signal.aborted) { adopt(result); setEditing(null); }
            })}>{busy === "create" ? <Loader2 className="size-3.5 animate-spin" /> : <SearchIcon />}开始检查</button>
          </div>
          {checks.length ? <label className="mt-3 block text-xs text-slate-500">已有检查记录<select className={`${control} mt-1 w-full`} value={selectedId} disabled={Boolean(busy)} onChange={(event) => { setSelectedId(event.target.value); setError(""); setNotice(""); }}><option value="">选择检查记录</option>{checks.map((item) => <option key={item.id} value={item.id}>{item.taskTitle} · {formatTime(item.checkedAt)}</option>)}</select></label> : null}
          {loading ? <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />正在核验检查记录…</div> : check ? <>
            <div className="mt-5 border-y border-slate-200 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold text-slate-900">{check.taskTitle}</h3><p className="mt-1 text-xs text-slate-500">{check.taskId} · 检查于 {formatTime(check.checkedAt)}</p></div><div className="flex flex-wrap gap-2">
                <button type="button" className={button} disabled={Boolean(busy)} onClick={() => { setEditing(check.rows.map(({ id, title, keywords, required }) => ({ id, title, keywords, required }))); }}><PencilLine className="size-3.5" />调整清单</button>
                <button type="button" className={button} disabled={Boolean(busy)} onClick={() => void run("refresh", async (signal) => { const result = await workspaceRequest<DeliveryCheck>(`delivery-checks/${encodeURIComponent(check.id)}/refresh`, { signal, body: { revision: check.revision } }); if (!signal.aborted) { adopt(result); setNotice("已重新检查；已变更文件的确认状态会被撤回。"); } })}><RefreshCw className={`size-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />重新检查</button>
              </div></div>
              <p className="mt-3 text-sm leading-6 text-slate-700"><strong className="font-semibold text-emerald-700">{check.summary.confirmed} 项已确认</strong><span className="mx-2 text-slate-300">/</span>{check.summary.candidate} 项待核对<span className="mx-2 text-slate-300">/</span><span className="text-rose-700">{check.summary.missing} 项未找到</span></p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{check.templateLabel}。{check.scopeNote}</p>
              {check.warnings.map((warning) => <p key={warning} className="mt-2 text-xs leading-5 text-amber-800">{warning}</p>)}
            </div>
            {editing ? <section className="mt-4 rounded-xl border border-[#dbe5ff] bg-[#f8faff] p-3" aria-label="调整交付清单">
              <p className="mb-3 text-xs leading-5 text-slate-600">按实际交付要求修改清单。关键词匹配文件名及已有描述，多个关键词按任一命中查找。</p>
              <div className="space-y-3">{editing.map((item, index) => <div key={item.id ?? `new-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <div className="min-w-0 space-y-2"><label className="block text-xs text-slate-500">资料名称<input className={`${control} mt-1 block w-full`} value={item.title} maxLength={100} onChange={(event) => setEditing((rows) => rows!.map((row, i) => i === index ? { ...row, title: event.target.value } : row))} /></label><label className="block text-xs text-slate-500">查找关键词（用逗号分隔）<input className={`${control} mt-1 block w-full`} value={item.keywords.join("，")} onChange={(event) => setEditing((rows) => rows!.map((row, i) => i === index ? { ...row, keywords: event.target.value.split(/[,，]/) } : row))} /></label><label className="flex min-h-8 items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={item.required !== false} onChange={(event) => setEditing((rows) => rows!.map((row, i) => i === index ? { ...row, required: event.target.checked } : row))} />必需资料</label></div>
                <button type="button" className={button} disabled={editing.length <= 1 || Boolean(busy)} aria-label={`移除清单项 ${item.title || index + 1}`} onClick={() => setEditing((rows) => rows!.filter((_, i) => i !== index))}><Trash2 className="size-3.5" /></button>
              </div>)}</div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={editing.length >= 20 || Boolean(busy)} onClick={() => setEditing((rows) => [...rows!, { title: "", keywords: [], required: true }])}><Plus className="size-3.5" />添加资料项</button><button type="button" className={primary} disabled={Boolean(busy) || editing.some((row) => !row.title.trim() || !row.keywords.some((word) => word.trim()))} onClick={() => void run("save", async (signal) => { const result = await workspaceRequest<DeliveryCheck>(`delivery-checks/${encodeURIComponent(check.id)}`, { method: "PATCH", signal, body: { revision: check.revision, requirements: editing.map((row) => ({ ...row, keywords: row.keywords.map((word) => word.trim()).filter(Boolean) })) } }); if (!signal.aborted) { adopt(result); setEditing(null); } })}>保存并检查</button><button type="button" className={button} disabled={Boolean(busy)} onClick={() => setEditing(null)}>取消</button></div>
            </section> : <div className="divide-y divide-slate-200">{check.rows.map((row) => {
              const chosen = selectedFiles[row.id] ?? row.evidenceFileIds;
              return <section key={row.id} className="py-4" aria-label={row.title}>
                <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-800">{row.title}<span className="ml-2 text-xs font-normal text-slate-400">{row.required ? "必需" : "可选"}</span></h4><span className={`rounded-md px-2 py-1 text-xs font-medium ${statusColors[row.status]}`}>{statusLabels[row.status]}</span></div>
                {row.notice ? <p className="mt-2 text-xs leading-5 text-amber-800">{row.notice}</p> : null}
                {row.candidates.length && row.status !== "not_required" ? <div className="mt-2 space-y-1">{row.candidates.map((file) => <div key={file.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-2 py-2"><input type="checkbox" aria-label={`选择 ${row.title} 的资料 ${file.name}`} checked={chosen.includes(file.id)} disabled={Boolean(busy) || row.status === "confirmed" || (!chosen.includes(file.id) && chosen.length >= 10)} onChange={(event) => setSelectedFiles((current) => ({ ...current, [row.id]: event.target.checked ? [...chosen, file.id] : chosen.filter((id) => id !== file.id) }))} /><FileText className="size-4 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><p className="break-words text-xs font-medium text-slate-700">{file.name}</p><p className="mt-0.5 break-words text-[11px] text-slate-400">{file.folder}</p></div><button type="button" className={`${button} shrink-0`} disabled={Boolean(busy)} onClick={() => preview(file.id)}>查看原件</button></div>)}</div> : <p className="mt-2 text-xs leading-5 text-slate-500">{row.status === "not_required" ? "本次交付无需此项；可随时恢复核对。" : `在可访问的任务附件中未找到匹配项。关键词：${row.keywords.join("、")}`}</p>}
                {row.candidateCount > row.candidates.length ? <p className="mt-2 text-xs text-amber-800">共找到 {row.candidateCount} 个候选，当前列出 {row.candidates.length} 个；请细化关键词后重新检查。</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.status === "candidate" ? <button type="button" className={button} disabled={Boolean(busy) || !chosen.length} onClick={() => void patchRow(row, "confirmed")}><Check className="size-3.5" />确认所选资料</button> : null}
                  {row.status === "missing" ? <button type="button" className={button} disabled={Boolean(busy)} onClick={() => { onDraftTask(deliveryTaskDraft(check, row), check.taskId); setOpen(false); }}><Plus className="size-3.5" />准备补充任务</button> : null}
                  {row.status === "confirmed" || row.status === "not_required" ? <button type="button" className={button} disabled={Boolean(busy)} onClick={() => void patchRow(row, "open")}>恢复核对</button> : <button type="button" className={button} disabled={Boolean(busy)} onClick={() => void patchRow(row, "not_required")}>标记不适用</button>}
                </div>
              </section>;
            })}</div>}
          </> : !error ? <div className="py-10 text-center"><FileCheck2 className="mx-auto size-8 text-[#9db6f5]" /><p className="mt-3 text-sm font-medium text-slate-700">从一条研发任务开始检查</p><p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-500">使用可调整的参考清单，查找该任务及子任务的附件。匹配结果需要人工核对内容和版本，不能替代正式验收。</p></div> : null}
        </div>
        {check && !loading ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4"><p className="text-xs leading-5 text-slate-500">{check.summary.unresolvedRequired ? `还有 ${check.summary.unresolvedRequired} 项必需资料未确认；可先打包已确认部分。` : "本清单中的必需项已确认或标记不适用。"}</p><button type="button" className={primary} disabled={Boolean(busy) || !check.summary.confirmed || Boolean(editing)} onClick={() => void run("archive", async (signal) => { const result = await workspaceRequest<{ check: DeliveryCheck; archive: { id: string } }>(`delivery-checks/${encodeURIComponent(check.id)}/archive`, { signal, body: { revision: check.revision, filename: `${check.taskTitle}-已确认结项资料` } }); if (!signal.aborted) { adopt(result.check); setNotice("资料包已加入后台队列，可在 MateChat 资料包区域查看进度和下载。"); onArchive(); } })}>{busy === "archive" ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}打包已确认资料</button></div> : null}
      </DialogContent>
    </Dialog>
  </>;
}

function SearchIcon() { return <FileCheck2 className="size-3.5" />; }
