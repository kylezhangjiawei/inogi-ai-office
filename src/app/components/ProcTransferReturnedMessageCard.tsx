import { ArrowRight, Undo2 } from "lucide-react";
import { Button } from "./ui/button";
import { useI18n } from "../lib/i18n";
import { transferReturnedMessageRoute, transferReturnedNextAction, type ProcurementTransferReturnedMessageBody } from "../lib/procurementTransferReturnedMessage";

export function ProcTransferReturnedMessageCard({ body, onOpen }: { body: ProcurementTransferReturnedMessageBody; onOpen: (route: string) => void }) {
  const { t } = useI18n();
  const route = transferReturnedMessageRoute(body);
  const details = [
    [t("采购编号"), body.procurement_code || body.procurement_task_id],
    [t("规格"), body.specification],
    [t("任务需求数量"), body.quantity === null ? "" : `${body.quantity} ${body.unit}`.trim()],
    [t("退回人"), body.returned_by],
    [t("来源研发任务"), body.rd_task_title || body.rd_task_id],
  ].filter(([, value]) => value);
  return <section aria-label={t("采购退回研发")} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Undo2 className="size-4" aria-hidden="true" />{t("采购退回研发")}</div>
    <h3 className="break-words text-base font-semibold text-slate-900">{body.material_name || t("采购需求")}</h3>
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-sm text-slate-800">{value}</dd></div>)}</dl>
    <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs font-semibold text-slate-500">{t("退回原因")}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{body.reason || t("请联系退回人核对原因。")}</p></div>
    <div className="rounded-lg border border-primary/15 bg-accent px-3 py-2"><p className="text-xs font-semibold text-slate-600">{t("下一步")}</p><p className="mt-1 text-sm leading-6 text-slate-700">{transferReturnedNextAction(body)}</p></div>
    {route ? <Button type="button" size="sm" onClick={(event) => { event.stopPropagation(); onOpen(route); }}>{t("继续转采购")}<ArrowRight className="size-3.5" aria-hidden="true" /></Button>
      : <p className="text-xs text-amber-700">{t("通知缺少有效的原研发任务入口，请联系退回人核对。")}</p>}
  </section>;
}
