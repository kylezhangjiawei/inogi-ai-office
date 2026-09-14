import { readOverviewSources } from '../production/overview/overviewSources';
import { createShipmentState } from '../procurement/shipments/shipmentPreviewModel';
import type { CompanySources } from './companyOverviewModel';

/** Read projections only. Independent sample ledgers remain independent; this never calls a service. */
export function readCompanySources(): CompanySources {
  return { production: readOverviewSources(), shipments: createShipmentState(), readAt: new Date().toISOString() };
}
