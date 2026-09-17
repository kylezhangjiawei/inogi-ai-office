import { useEffect, useState } from "react";
import { AlertTriangle, FileCheck2, Loader2, RefreshCw, X } from "lucide-react";
import type { MateChatPageContext } from "./pageContext";
import { resolvePageContext, type ResolvedPageContext } from "./matechatWorkspaceApi";
import { Button } from "../ui/button";

const button = "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

export function MateChatContextCard({ context, active, disabled, onRemove, onCheck, onAsk }: {
  context: MateChatPageContext; active: boolean; disabled: boolean; onRemove: () => void; onCheck: () => void; onAsk: (text: string) => void;
}) {
  const [resolved, setResolved] = useState<ResolvedPageContext | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setResolved(null); setError("");
    void resolvePageContext(context, controller.signal).then((result) => {
      if (!controller.signal.aborted) setResolved(result);
    }).catch(() => { if (!controller.signal.aborted) setError("暂时无法读取当前任务，请重试或移除关联。"); });
    return () => controller.abort();
  }, [context, active, retry]);
  const ready = resolved?.status === "resolved" && Boolean(resolved.entity);
  const unavailable = Boolean(error) || resolved?.status === "unavailable";
  return <div className="mb-3 rounded-xl border border-[#dbe5ff] bg-[#f6f8ff] p-3" aria-label="当前关联任务">
    <div className="flex items-start gap-2">
      {unavailable ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" /> : ready ? <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />}
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className="text-[11px] font-medium text-slate-500">当前关联 · 研发任务</p>
        <p className="mt-0.5 break-words text-sm font-semibold text-slate-800">{ready ? resolved!.entity!.title : unavailable ? "当前任务暂不可用" : "正在读取任务…"}</p>
        <p className="mt-1 text-xs text-slate-500">{ready ? `${resolved!.entity!.id} · 发送时重新读取最新数据` : error || (unavailable ? "任务不可读取，请移除关联或重试。" : "核对任务信息与访问权限")}</p>
      </div>
      <Button variant="unstyled" type="button" onClick={onRemove} disabled={disabled} className={`${button} shrink-0 text-slate-500 hover:bg-white`} aria-label="移除当前任务关联"><X className="size-4" /></Button>
    </div>
    <div className="mt-2 flex flex-wrap gap-1">
      {ready ? <>
        <Button variant="unstyled" type="button" disabled={disabled} className={`${button} text-primary hover:bg-[#e8eeff]`} onClick={() => onAsk("这个任务目前有哪些阻塞，下一步应该做什么？")}>分析下一步</Button>
        <Button variant="unstyled" type="button" disabled={disabled} className={`${button} bg-white text-primary ring-1 ring-[#dbe5ff] hover:bg-[#e8eeff]`} onClick={onCheck}><FileCheck2 className="size-3.5" />检查结项资料</Button>
      </> : unavailable ? <Button variant="unstyled" type="button" className={`${button} text-primary`} onClick={() => setRetry((n) => n + 1)}><RefreshCw className="size-3.5" />重新读取</Button> : null}
    </div>
  </div>;
}
