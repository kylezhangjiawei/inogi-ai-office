import { Navigate, useSearchParams } from 'react-router';
import { usePermission } from '../../hooks/usePermission';
import { ProductionExecutionPage } from './ProductionExecutionPage';
import { ProductionEmpty } from './ProductionView';
import './production.css';

/** Legacy menu permissions remain at the route; real production data keeps its own permission. */
export function ProductionModuleEntry({ title, view }: { title: string; view: 'inspections' | 'archive' }) {
  const canRead = usePermission('page:production-execution');
  const [params] = useSearchParams();
  if (!canRead) return <main className="production-page"><h1 className="text-2xl font-semibold">{title}</h1><section className="production-surface"><ProductionEmpty title="需要生产工作台访问权限" description="此入口已连接正式生产记录。请联系管理员核对生产工作台权限；各项报工、检验和放行动作仍按原业务权限办理。" /></section></main>;
  // Old static-preview links must not carry sample selections into real records.
  if (params.get('view') === 'legacy') {
    const next = new URLSearchParams({ view });
    for (const key of ['month', 'plan']) { const value = params.get(key); if (value) next.set(key, value); }
    return <Navigate replace to={`?${next}`} />;
  }
  return <ProductionExecutionPage entry={{ title, view }} />;
}

export function ProductionInspectionEntry() { return <ProductionModuleEntry title="检验与放行" view="inspections" />; }
export function ProductionBatchRecordEntry() { return <ProductionModuleEntry title="电子批记录" view="archive" />; }
export function ProductionTraceabilityEntry() { return <ProductionModuleEntry title="全链路追溯" view="archive" />; }
