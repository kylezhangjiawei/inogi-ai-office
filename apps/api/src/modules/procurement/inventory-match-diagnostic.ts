import { isProductionWarehouse } from './inventory-readiness';

export interface InventoryMatchDiagnostic {
  reason: 'material_missing' | 'no_inventory_records' | 'other_warehouses_only';
  otherWarehouses: string[];
}

/**
 * 只解释当前镜像为什么没有量产仓记录，不推断真实库存为零或同步失败。
 * 全仓记录仅用于诊断；齐套数量仍由调用方限定量产仓后计算。
 */
export function buildInventoryMatchDiagnostics(
  codes: readonly string[],
  materials: readonly { tpInventoryCode: string | null }[],
  snapshots: readonly { tpInventoryCode: string; warehouse: string }[],
): Map<string, InventoryMatchDiagnostic> {
  const materialCodes = new Set(materials.map((material) => material.tpInventoryCode));
  const productionCodes = new Set<string>();
  const otherWarehousesByCode = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    if (isProductionWarehouse(snapshot.warehouse)) {
      productionCodes.add(snapshot.tpInventoryCode);
    } else {
      const warehouses = otherWarehousesByCode.get(snapshot.tpInventoryCode) ?? new Set<string>();
      warehouses.add(snapshot.warehouse.trim() || '未指定仓库');
      otherWarehousesByCode.set(snapshot.tpInventoryCode, warehouses);
    }
  }
  const diagnostics = new Map<string, InventoryMatchDiagnostic>();
  for (const code of codes) {
    // 即使数量为零或缺同步时间，有量产仓余额记录也属于已匹配。
    if (productionCodes.has(code)) continue;
    const otherWarehouses = [...(otherWarehousesByCode.get(code) ?? [])]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    diagnostics.set(code, !materialCodes.has(code)
      ? { reason: 'material_missing', otherWarehouses: [] }
      : otherWarehouses.length > 0
        ? { reason: 'other_warehouses_only', otherWarehouses }
        : { reason: 'no_inventory_records', otherWarehouses: [] });
  }
  return diagnostics;
}
