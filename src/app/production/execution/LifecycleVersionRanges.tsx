import { Button } from '../../components/ui/button';
import type { LifecycleVersionRange } from '../../lib/productionLifecycleApi';
import { LifecycleTable, lifecycleDate } from './LifecycleViews';

export function LifecycleVersionRanges({ rows, batchQuantity, canEdit, onEdit }: { rows: LifecycleVersionRange[]; batchQuantity: number; canEdit: boolean; onEdit: (row?: LifecycleVersionRange) => void }) {
  const active = rows.filter(row => !rows.some(next => next.supersedesId === row.id));
  const covered = active.reduce((sum, row) => sum + row.quantity, 0), serialCount = active.reduce((sum, row) => sum + row.serialNumbers.length, 0);
  return <div className="space-y-4"><p className="production-note">已登记适用范围 {covered} / {batchQuantity} 台 · 未登记范围 {Math.max(0, batchQuantity - covered)} 台 · 已有 SN {serialCount} 个。未填写的版本与 SN 明确待补；不会自动生成 SN。</p>
    <LifecycleTable title="软硬件适用范围" scope="batchVersions" rows={rows} rowKey={row => row.id} searchText={row => `${row.range} ${row.softwareVersion} ${row.hardwareVersion} ${row.serialNumbers.join(' ')} ${row.actorName}`} searchPlaceholder="搜索版本、范围、已有 SN 或登记人" actions={canEdit && <Button onClick={() => onEdit()}>登记版本范围</Button>} emptyTitle="版本范围待补" emptyDescription="按实物适用数量逐段登记，已有 SN 可关联；尚未采集的保持待补。" columns={[
      { label: '适用范围 / 数量', cell: row => <><p>{row.range}</p><p className="production-meta">{row.quantity} 台 · {active.includes(row) ? '当前有效' : '已被更正，保留历史'}</p></> },
      { label: '软件 / 硬件', cell: row => <><p>软件：{row.softwareVersion || '待补'}</p><p className="production-meta">硬件：{row.hardwareVersion || '待补'}</p></> },
      { label: '已有 SN', className: 'production-cell-note', cell: row => <><p className="break-all">{row.serialNumbers.join('、') || '待采集'}</p>{row.serialNumbers.length < row.quantity && <p className="production-meta">{row.quantity - row.serialNumbers.length} 台 SN 待补</p>}</> },
      { label: '登记依据', className: 'production-cell-note', cell: row => <><p>{row.evidence}</p><p className="production-meta">{row.actorName} · {lifecycleDate(row.at)}</p></> },
      { label: '操作', cell: row => canEdit && active.includes(row) ? <Button size="sm" variant="outline" onClick={() => onEdit(row)}>补充 / 更正</Button> : '—' },
    ]} />
  </div>;
}
