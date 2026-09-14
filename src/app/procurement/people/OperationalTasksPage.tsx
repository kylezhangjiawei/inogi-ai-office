import { useAuth } from '../../auth';
import { hasAnyPermission, hasPermission } from '../../lib/permissions';
import { useI18n } from '../../lib/i18n';
import { OperationalTasksPanel } from './OperationalTasksPanel';
import '../horizon.css';

/** Ordinary operators access their assigned work without entering the team management page. */
export function OperationalTasksPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const permissions = user?.permissions ?? [];
  if (!user || !hasPermission(permissions, 'page:purchase-order-detail')
    || !hasAnyPermission(permissions, ['proc-purchase-order:receive', 'proc-purchase-order:inspect', 'page:proc-cockpit'])) {
    return <div role="status" className="mx-auto max-w-xl p-6 text-sm text-slate-600">{t('需要采购订单详情权限，以及仓管收货、质量检验或采购驾驶舱权限才能查看岗位任务。')}</div>;
  }
  return <div className="proc-horizon mx-auto min-w-0 max-w-[1400px] space-y-4 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold text-slate-900">{t('我的仓管与质量任务')}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{t('查看分派给本人的收货、检验任务和跨月未完成事项，打开原订单继续处理。')}</p></header>
    <OperationalTasksPanel personal />
  </div>;
}
