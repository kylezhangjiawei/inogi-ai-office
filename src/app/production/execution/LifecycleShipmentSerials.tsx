import type { Lifecycle } from '../../lib/productionLifecycleApi';
import { LifecycleTable, lifecycleDate } from './LifecycleViews';
import { ProductionMetrics } from './ProductionView';

export function LifecycleShipmentSerials({ shipment }: { shipment: Lifecycle['shipments'][number] }) {
  const serials = shipment.serials ?? [];
  return <div className="space-y-4">
    <ProductionMetrics items={[{ label: '原单实发数量', value: `${shipment.quantity} 台` }, { label: '本单已关联 SN', value: `${serials.length} 个` }, { label: '本单 SN 待补', value: `${Math.max(0, shipment.quantity - serials.length)} 台` }]} />
    <LifecycleTable title={shipment.reversed ? '原发货 SN（已随原单冲销）' : '本次实发 SN'} scope="shipmentSerials" rows={serials} rowKey={row => row.number} searchText={row => `${row.number} ${row.softwareVersion} ${row.hardwareVersion}`} searchPlaceholder="搜索 SN、软件或硬件版本" description="仅关联本批次已有号码，未采集的保持待补。版本按关联时保存，后续批次更正保留原发货依据。" emptyTitle="本单 SN 待补录" emptyDescription="批次中登记了 SN，不代表这些实物已发出。核对本次实发清单后再关联。" columns={[
      { label: '实发 SN', className: 'production-cell-main', cell: row => <span className="break-all">{row.number}</span> },
      { label: '关联时软件版本', cell: row => row.softwareVersion || '待补' },
      { label: '关联时硬件版本', cell: row => row.hardwareVersion || '待补' },
    ]} />
    {!!shipment.serialHistory?.length && <details className="production-note"><summary className="cursor-pointer text-primary">SN 关联与冲销历史（{shipment.serialHistory.length} 条）</summary><div className="mt-3 space-y-3">{shipment.serialHistory.map((entry, index) => <div key={`${entry.at}-${index}`}><p>{entry.action === 'reverse' ? '随原发货单冲销' : '关联已有 SN'} · {entry.serials.length} 个 · {entry.actorName} · {lifecycleDate(entry.at)}</p><p className="break-all">{entry.serials.map(serial => serial.number).join('、') || '原单尚未关联 SN'}</p><p className="production-meta">{entry.reason}</p></div>)}</div></details>}
  </div>;
}
