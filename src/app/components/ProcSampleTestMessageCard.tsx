import { ArrowRight, ClipboardCheck } from "lucide-react";
import { Button } from "./ui/button";
import { useI18n } from "../lib/i18n";
import {
  sampleTestMessageRoute,
  sampleTestNextAction,
  sampleTestResultLabel,
  type ProcurementSampleTestMessageBody,
} from "../lib/procurementSampleTestMessage";

export function ProcSampleTestMessageCard({ body, onOpen }: { body: ProcurementSampleTestMessageBody; onOpen: (route: string) => void }) {
  const { t } = useI18n();
  const request = body.type === "procurement_sample_test_request";
  const route = sampleTestMessageRoute(body);
  const details = [
    [t("采购编号"), body.procurement_code || body.procurement_task_id],
    [t("规格"), body.specification],
    [t("任务需求数量"), body.quantity === null ? "" : `${body.quantity} ${body.unit}`.trim()],
    [t("研发测试人"), body.tester_name],
    [t("采购负责人"), body.buyer_name],
    [t("来源研发任务"), body.rd_task_title],
  ].filter(([, value]) => value);
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label={t(request ? "样品测试待办" : "样品测试结果")}>
    <div className="flex items-center gap-2 text-sm font-semibold text-primary"><ClipboardCheck className="size-4" aria-hidden="true" />{t(request ? "样品测试待办" : sampleTestResultLabel(body.result))}</div>
    <h3 className="text-base font-semibold text-slate-900">{body.material_name || t("样品测试")}</h3>
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-sm text-slate-800">{value}</dd></div>)}</dl>
    {!request && <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs font-semibold text-slate-500">{t("测试结论")}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{body.conclusion || t("结论待补充")}</p></div>}
    <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2"><p className="text-xs font-semibold text-slate-600">{t("下一步")}</p><p className="mt-1 text-sm leading-6 text-slate-700">{sampleTestNextAction(body)}</p></div>
    {request && <p className="text-xs leading-5 text-slate-500">{t("只有填写并确认测试结论才会推进采购流程；已读或关闭通知不会完成测试。")}</p>}
    {route ? <Button type="button" size="sm" onClick={(event) => { event.stopPropagation(); onOpen(route); }}>{t(request ? "填写并确认测试结论" : body.action_label || "查看采购任务")}<ArrowRight className="size-3.5" aria-hidden="true" /></Button>
      : <p className="text-xs text-amber-700">{t("通知缺少有效任务入口，请联系采购负责人核对。")}</p>}
  </section>;
}
