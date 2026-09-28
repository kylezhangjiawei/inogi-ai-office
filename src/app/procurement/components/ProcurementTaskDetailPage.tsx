import { ArrowLeft, ClipboardList, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { HorizonEmptyState } from '../../components/horizon/HorizonPage';
import { useI18n } from '../../lib/i18n';
import { refreshProcurement, type ProcurementTask } from '../data';
import { TaskDetailDrawer } from './TaskDetailDrawer';

export function ProcurementTaskDetailPage({ task, loading, error, onClose, onNavigateRelated }: {
  task: ProcurementTask | null | undefined; loading: boolean; error: string | null;
  onClose: () => void; onNavigateRelated?: (path: string) => void;
}) {
  const { t } = useI18n();
  if (loading || !task || error) return <div className="horizon-theme space-y-4">
    <Button variant="ghost" onClick={onClose}><ArrowLeft className="size-4" />{t('返回任务列表')}</Button>
    {loading ? <p role="status">{t('正在加载采购任务…')}</p> : <HorizonEmptyState Icon={ClipboardList} title={t(error ? '采购任务加载失败' : '此采购任务暂不可用')} description={error || t('任务可能已删除、转派或不在当前账号的访问范围内。')} action={<Button variant="outline" onClick={() => void refreshProcurement()}><RefreshCw className="size-4" />{t('重新加载')}</Button>} />}
  </div>;
  return <TaskDetailDrawer key={task.id} presentation="page" task={task} onClose={onClose} onNavigateRelated={onNavigateRelated} />;
}
