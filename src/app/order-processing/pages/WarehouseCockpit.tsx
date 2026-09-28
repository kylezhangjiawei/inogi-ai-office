import { Navigate, useSearchParams } from 'react-router';
import { routePath } from '../../lib/routePaths';

// Preserve bookmarks without keeping a second warehouse experience.
export function WarehouseCockpit() {
  const [params] = useSearchParams();
  const query = new URLSearchParams(params);
  if (query.has('cockpitTab') && !query.has('workbenchTab')) query.set('workbenchTab', query.get('cockpitTab')!);
  query.delete('cockpitTab');
  return <Navigate replace to={routePath('page:warehouse-flow', '/warehouse-flow') + (query.size ? '?' + query : '')} />;
}
