import { SampleValidationPanel } from './SampleValidationPanel';
import type { ProcSampleCommercialConditions, ProcSampleTestAssignment, ProcSampleTestDetail } from '../../lib/procurementApi';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { sampleOperationTime } from './sampleTimingModel';

export const SAMPLE_TAX_LABELS = { inclusive: '含税', exclusive: '未税', unspecified: '未约定' };
export const SAMPLE_LEAD_START_LABELS = { order: '下单后', deposit: '定金到账后', approval: '资料确认后', agreed_date: '约定日期', other: '其他（见备注）', unspecified: '未约定' };

function time(value: string | undefined | null) {
  const parsed = sampleOperationTime(value);
  return parsed.value ? new Date(value!).toLocaleString(i18nLocale()) : parsed.state === 'invalid' ? '时间待核对' : '未记录';
}

export function SampleConditionsView({ conditions }: { conditions?: ProcSampleCommercialConditions | null }) {
  const { t } = useI18n();
  if (!conditions) return <p className="text-xs text-muted-foreground">{t('本轮采购条件未登记')}</p>;
  return <dl className="grid gap-3 text-sm sm:grid-cols-2">
    {[
      ['报价计价单位', conditions.priceUnit],
      ['含税口径', `${t(SAMPLE_TAX_LABELS[conditions.taxBasis] ?? '待核对')}${conditions.taxRate != null ? ` · ${conditions.taxRate}%` : ''}`],
      ['付款条件', conditions.paymentTerms], ['运费承担与交付条件', conditions.freightTerms],
      ['交期起算', `${t(SAMPLE_LEAD_START_LABELS[conditions.leadTimeStart] ?? '待核对')}${conditions.leadTimeStartDate ? ` · ${conditions.leadTimeStartDate}` : ''}`],
      ['条件备注', conditions.note],
    ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{t(label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value || t('未约定')}</dd></div>)}
  </dl>;
}

function Round({ round, current, canReadCommercial }: { round: ProcSampleTestAssignment; current?: boolean; canReadCommercial?: boolean }) {
  const { t } = useI18n();
  const reason = round.archiveReason === 'reassigned' ? '改派前轮次' : round.archiveReason === 'new_sample' ? '上一轮样品' : '流程结束保留';
  return <details className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">{round.testerName} · {t(current ? '当前保留轮次' : reason)} · {time(round.assignedAt)}</summary>
    <div className="mt-3 space-y-3">
      <p className="break-all text-xs text-muted-foreground">{t('轮次编号')}：{round.roundId}</p>
      <dl className="grid gap-3 text-xs sm:grid-cols-3">{[['实际到样', round.arrivedAt], ['实际开测', round.startedAt], ['实际结束', round.finishedAt], ['结论提交', round.confirmedAt], ['归档时间', round.archivedAt]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{t(label!)}</dt><dd className="mt-1 tabular-nums">{time(value)}</dd></div>)}</dl>
      <p className="whitespace-pre-wrap break-words text-sm">{t(round.result === 'passed' ? '测试通过' : round.result === 'failed_resample' ? '未通过，重新送样' : round.result === 'failed_requote' ? '未通过，重新询价' : '未提交结论')}{round.note ? `：${round.note}` : ''}</p>
      <details><summary className="cursor-pointer text-xs font-medium">{t("本轮验证依据")} · {t(round.validation?.kind === "transfer" ? "转产验证" : round.validation?.kind === "exploration" ? "研发探索" : "历史未分类")}</summary><div className="mt-3"><SampleValidationPanel value={round.validation ?? null} references={[]} readOnly /></div></details>
      {canReadCommercial && <SampleConditionsView conditions={round.commercial} />}
      <details><summary className="cursor-pointer text-xs text-muted-foreground">{t('登记与更正记录')}（{round.revisions?.length ?? 0}）</summary>
        {round.revisions?.length ? <ol className="mt-2 space-y-3">{round.revisions.map((revision, index) => <li key={`${revision.recordedAt}:${index}`} className="space-y-2 rounded bg-muted/50 p-3 text-xs">
          <p>{revision.recordedByName} · {time(revision.recordedAt)}</p>
          <p>{t('实际到样')}：{time(revision.arrivedAt)}；{t('实际开测')}：{time(revision.startedAt)}；{t('实际结束')}：{time(revision.finishedAt)}</p>
          {canReadCommercial && <SampleConditionsView conditions={revision.commercial} />}
        </li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">{t('旧轮次没有独立登记记录')}</p>}
      </details>
    </div>
  </details>;
}

export function SampleRoundHistory({ detail, unavailable }: { detail: ProcSampleTestDetail; unavailable?: boolean }) {
  const { t } = useI18n();
  const history = (detail.history ?? []).filter((round) => round.roundId !== detail.sampleTest?.roundId);
  return <section className="mb-4 space-y-3 rounded-xl border border-border bg-card p-4" aria-label={t('样品轮次与登记历史')}>
    <h3 className="text-sm font-semibold">{t('样品轮次与登记历史')}</h3>
    {unavailable ? <p className="text-xs text-muted-foreground">{t('正在核对轮次记录，请重新加载后查看。')}</p> : <>
      {detail.sampleTest && <Round round={detail.sampleTest} current canReadCommercial={detail.canReadCommercial} />}
      {[...history].reverse().map((round) => <Round key={round.roundId} round={round} canReadCommercial={detail.canReadCommercial} />)}
      {!history.length && <p className="text-xs text-muted-foreground">{t('尚无已归档轮次；未被历史系统保存的旧轮次无法补回。')}</p>}
      {detail.historyIncomplete && <p role="status" className="text-xs text-amber-700">{t('部分旧轮次格式不完整，已保留原记录但无法完整展示，请核对历史来源。')}</p>}
    </>}
  </section>;
}
