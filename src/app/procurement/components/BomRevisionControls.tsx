import { useEffect, useRef, useState } from "react";
import { NativeSelect } from '../../components/ui/native-select';
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { useI18n } from "../../lib/i18n";
import { bindBomDevice, publishBomRevision, readBomRevisions, retireBomRevision, type BomRevisionState, type BomRevision } from "../../lib/procurementApi";

export function BomRevisionControls({ deviceId, canPublish }: { deviceId: string; canPublish: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<BomRevisionState | null>(null);
  const [error, setError] = useState(""); const [reload, setReload] = useState(0);
  const [action, setAction] = useState<"bind" | "publish" | "retire" | null>(null);
  const [productRootId, setProductRootId] = useState(""); const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<BomRevision | null>(null); const [view, setView] = useState<BomRevision | null>(null);
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  // Keep the request identity for an uncertain response; changing form content starts a new logical request.
  const submission = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setState(null); setError("");
    readBomRevisions(deviceId, controller.signal).then(data => { if (!controller.signal.aborted) { setState(data); setProductRootId(data.productRootId ?? ""); } }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [deviceId, reload]);
  const begin = (next: typeof action, revision?: BomRevision) => { setAction(next); setSelected(revision ?? null); setReason(""); setError(""); submission.current = null; };
  const submit = async () => {
    if (!state || !action || pending.current || !canPublish) return;
    if (!reason.trim() || (action === "bind" && !productRootId)) { setError(t("请选择归属并填写核对依据")); return; }
    pending.current = true; setBusy(true); setError("");
    const signature = JSON.stringify([deviceId, action, selected?.id, productRootId, reason, state.draftFingerprint]);
    if (submission.current?.signature !== signature) submission.current = { signature, id: crypto.randomUUID() };
    const base = { requestId: submission.current.id, reason: reason.trim() };
    try {
      if (action === "bind") await bindBomDevice(deviceId, { ...base, productRootId, expectedFingerprint: state.draftFingerprint });
      else if (action === "publish") await publishBomRevision(deviceId, { ...base, expectedFingerprint: state.draftFingerprint });
      else if (selected) await retireBomRevision(selected.id, base);
      setAction(null); setReload(v => v + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("操作失败，请保留填写内容并重试")); }
    finally { pending.current = false; setBusy(false); }
  };
  const latest = state?.revisions[0], product = state?.products.find(p => p.id === state.productRootId);
  return <section className="space-y-3 border-b p-4" aria-label={t("BOM 执行依据")}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1 text-sm"><h2 className="font-semibold text-balance">{t("BOM 执行依据")}</h2><p>{t("产品归属")}：{product?.name ?? t("未核对")}</p><p className="text-muted-foreground text-pretty">{t(!latest ? "当前为工作稿，尚未发布" : latest.fingerprint === state?.snapshotFingerprint ? "工作稿与最近发布版本一致" : "工作稿有变更，原发布版本不变")}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setReload(v => v + 1)}>{t("刷新依据")}</Button>{canPublish && state && <>{!state.revisions.length && <Button variant="outline" onClick={() => begin("bind")}>{t("确认产品归属")}</Button>}<Button disabled={Boolean(state.issue)} onClick={() => begin("publish")}>{t("发布新版本")}</Button></>}</div></div>
    {!state && !error && <p role="status">{t("正在加载执行依据…")}</p>}
    {state?.issue && <p role="status" className="text-sm text-amber-700">{state.issue}</p>}
    {!canPublish && <p className="text-sm text-muted-foreground">{t("如需核对或发布，请联系有 BOM 发布权限的人员。")}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {Boolean(state?.revisions.length) && <div className="max-h-64 overflow-auto"><table className="w-full text-sm tabular-nums"><thead><tr className="border-b text-left"><th className="py-2">{t("版本")}</th><th>{t("发布时间 / 发布人")}</th><th>{t("状态")}</th><th>{t("操作")}</th></tr></thead><tbody>{state!.revisions.map(row => <tr key={row.id} className="border-b"><td className="py-2">V{row.version}</td><td>{new Date(row.publishedAt).toLocaleDateString()} · {row.publishedByName}</td><td>{t(row.retiredAt ? "已停用" : "可引用")}</td><td><Button variant="ghost" size="sm" onClick={() => setView(row)}>{t("查看快照")}</Button>{canPublish && !row.retiredAt && <Button variant="ghost" size="sm" onClick={() => begin("retire", row)}>{t("停用")}</Button>}</td></tr>)}</tbody></table></div>}
    <AlertDialog open={Boolean(action)} onOpenChange={open => { if (!open && !busy) setAction(null); }}><AlertDialogContent className="horizon-theme horizon-portal"><AlertDialogHeader><AlertDialogTitle>{t(action === "bind" ? "确认产品归属" : action === "retire" ? "停用发布版本" : "发布 BOM 版本")}</AlertDialogTitle><AlertDialogDescription>{t(action === "retire" ? "停用后不能用于新计划；已有计划保留原快照。" : "发布后归属不可更换，快照不会随工作稿改变。请核对后确认。")}</AlertDialogDescription></AlertDialogHeader>
      {action === "bind" && <label className="grid gap-2 text-sm">{t("产品归属")}<NativeSelect className="rounded-md border bg-background p-2" value={productRootId} disabled={busy} onChange={e => setProductRootId(e.target.value)}><option value="">{t("请选择产品根节点")}</option>{state?.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></label>}
      <label className="grid gap-2 text-sm">{t("核对依据")}<Textarea aria-label={t("核对依据")} maxLength={2000} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setAction(null)}>{t("取消")}</Button><Button disabled={busy || !reason.trim()} onClick={() => void submit()}>{t(busy ? "正在提交…" : action === "publish" ? "确认发布" : action === "retire" ? "确认停用" : "确认归属")}</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <Dialog open={Boolean(view)} onOpenChange={open => { if (!open) setView(null); }}><DialogContent className="horizon-theme horizon-portal sm:max-w-2xl"><DialogHeader><DialogTitle>{t("BOM 发布快照")} · V{view?.version}</DialogTitle><DialogDescription>{view?.reason}</DialogDescription></DialogHeader><div className="max-h-96 overflow-auto"><table className="w-full text-sm tabular-nums"><thead><tr className="text-left"><th>{t("物料编码")}</th><th>{t("物料名称")}</th><th>{t("单机用量")}</th><th>{t("单位")}</th></tr></thead><tbody>{view?.snapshot.items.map(item => <tr key={item.code} className="border-b"><td className="py-2">{item.code}</td><td>{item.name}</td><td>{item.qtyPer}</td><td>{item.unit}</td></tr>)}</tbody></table></div><p className="break-all text-xs text-muted-foreground">{view?.fingerprint}</p></DialogContent></Dialog>
  </section>;
}
