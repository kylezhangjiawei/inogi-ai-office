import type { PurchaseOrderFulfillment } from '../purchaseOrderFulfillment';
import { i18nLocale, useI18n } from '../../lib/i18n';

export function PurchaseOrderQuantitySummary({ summary }: { summary: PurchaseOrderFulfillment }) {
  const { t } = useI18n();
  const quantity = (value: number | null) => value === null ? t('待核对') : value.toLocaleString(i18nLocale(), { maximumFractionDigits: 8 });
  return <section aria-label={t('按单位核对到货数量')} className="mb-4 min-w-0 rounded-xl border border-slate-200 bg-white p-4">
    <h2 className="text-sm font-semibold text-slate-900">{t('按单位核对到货数量')}</h2>
    <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{t('不同单位分别列示。未收差额与超收逐行计算，不互相抵扣；到货数量来自 ERP，不代表检验合格或可用库存。')}</p>
    <div className={`mt-3 grid gap-3 ${summary.groups.length > 1 ? 'lg:grid-cols-2' : ''}`}>
      {summary.groups.map((group) => <div key={group.unit ?? '__missing_unit'} className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs"><h3 className="font-semibold text-slate-800">{group.unit ? t('单位：{unit}', { unit: group.unit }) : t('单位待核对')}</h3><span className="text-slate-500">{t('{count} 行', { count: group.count })}</span></div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          {([
            ['订购数量', group.orderedQty], ['ERP 已到', group.receivedQty], ['未收差额', group.remainingQty], ['超收数量', group.overReceivedQty],
          ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{t(label)}</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums text-slate-800">{quantity(value)}</dd></div>)}
        </dl>
        {!group.complete ? <p className="mt-3 text-pretty text-xs leading-5 text-amber-700">{group.checkableCount < group.count
          ? t('本组有 {count} 行数量或单位待核对，暂不合计；可在下方筛选待核对行。', { count: group.count - group.checkableCount })
          : t('本组数量合计超出可显示范围，请逐行核对。')}</p> : null}
      </div>)}
    </div>
    <p className="mt-3 text-pretty text-xs leading-5 text-slate-500">{t('以上仅覆盖已读取的订单行，筛选明细不会改变汇总。未收差额未纳入取消、退货或冲销核算，不能作为供应商剩余交付义务。')}</p>
  </section>;
}
