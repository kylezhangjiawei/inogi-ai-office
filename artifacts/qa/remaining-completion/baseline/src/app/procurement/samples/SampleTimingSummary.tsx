import type { ProcSampleTestDetail } from "../../lib/procurementApi";
import { i18nLocale, useI18n } from "../../lib/i18n";
import { sampleTiming, type SampleTimeValue } from "./sampleTimingModel";

export function SampleTimingSummary({ detail, loading = false, error = false }: {
  detail: Pick<ProcSampleTestDetail, "task" | "sampleTest">; loading?: boolean; error?: boolean;
}) {
  const { t } = useI18n();
  const timing = sampleTiming(detail);
  const unavailable = loading || error;
  const renderTime = (time: SampleTimeValue, dateOnly = false) => time.value
    ? <time dateTime={time.value}>{dateOnly ? time.value : new Date(time.value).toLocaleString(i18nLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
    : <span>{t(time.state === "invalid" ? "时间待核对" : "未记录")}</span>;
  return <section aria-label={t("到样与测试时间")} className="mb-4 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{t("到样与测试时间")}</h3>
      {!unavailable && <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{t({ none: "尚无测试分派", current: "当前有效测试记录", retained: "保留的测试记录", unverified: "测试记录待核对" }[timing.scope])}</span>}
    </div>
    {unavailable ? <p role="status" className="mt-3 text-pretty text-sm text-muted-foreground">{t(loading ? "正在刷新时间记录…" : "时间记录读取失败，重新加载后再核对。")}</p> : <>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 text-sm lg:grid-cols-4">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("任务预计到货")}</dt><dd className="mt-1 break-words tabular-nums">{renderTime(timing.expected, true)}</dd><dd className="mt-1 text-pretty text-xs text-muted-foreground">{t("采购任务登记日期")}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("实际到样")}</dt><dd className="mt-1">{t("未记录")}</dd><dd className="mt-1 text-pretty text-xs text-muted-foreground">{t("现有记录未提供实际日期")}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("测试分派")}</dt><dd className="mt-1 break-words tabular-nums">{renderTime(timing.assigned)}</dd><dd className="mt-1 break-words text-xs text-muted-foreground">{timing.tester || t("尚未指定测试人")}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("结论提交")}</dt><dd className="mt-1 break-words tabular-nums">{renderTime(timing.submitted)}</dd><dd className="mt-1 break-words text-xs text-muted-foreground">{timing.confirmedBy || t("尚无提交人记录")}</dd></div>
      </dl>
      {timing.scope === "retained" && <p className="mt-3 border-t border-border pt-3 text-pretty text-xs leading-5 text-muted-foreground">{t(timing.factsDescription)}</p>}
      {timing.scope === "unverified" && <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-pretty text-xs leading-5 text-amber-800">{t("测试记录的时间或人员信息不完整，不能确认其属于当前有效分派，请在采购详情核对。")}</p>}
      <p className="mt-3 text-pretty text-xs leading-5 text-muted-foreground">{t("预计到货属于采购任务，不等于本轮样品承诺日期。分派和提交是操作时间；实际到样、测试开始与结束尚无独立记录。")}</p>
    </>}
  </section>;
}
