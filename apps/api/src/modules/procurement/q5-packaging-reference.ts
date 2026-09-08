import type { InventoryReadinessBalance, InventoryReadinessBomLeaf } from './inventory-readiness';
import type { InventoryMatchDiagnostic } from './inventory-match-diagnostic';

export interface Q5PackagingReferenceItem {
  id: string;
  sourceRow: number;
  code: string;
  name: string;
  unit: string;
  /** 同编码已有 Q5 装配用量参考；不是包材表提供的随箱数量，不加入 BOM 需求。 */
  qtyPer: number | null;
  stock: number | null;
  available: number | null;
  inTransit: number | null;
  syncedAt: string | null;
  issue: 'code_conflict' | 'missing_qty' | 'inventory_unmatched' | null;
  inventoryDiagnostic?: InventoryMatchDiagnostic;
  /** 原表完全重复行的首次 Excel 行号；保留展示，不增加装配用量。 */
  duplicateOfRow: number | null;
}

export interface Q5PackagingReference {
  sourceFile: string;
  sourceSheet: string;
  items: Q5PackagingReferenceItem[];
}

/**
 * 2026-09-08 来源版本：用户提供「包材盘点清单 - 副本.xlsx」Sheet1，Excel 第 2–38 行。
 * 只读保留全部 37 行原始货号、品名与顺序（包括重复及冲突）；原表未提供配套数量或库存。
 * 此清单独立于 Q5 装配 BOM，不写入数据库，不参加装配齐套计算。
 */
export const Q5_PACKAGING_REFERENCE_SOURCE = {
  sourceFile: '包材盘点清单 - 副本.xlsx',
  sourceSheet: 'Sheet1',
  items: [
    ['USA01-008/5', '飞机盒底部标贴Q5-251119'],
    ['AC01-01/5', '整机贴Q5-251119'],
    ['AC06-01', '704动力电池顶部贴251020'],
    ['AC05-01', '电池底部操作贴251020'],
    ['USA01-009/5', '飞机盒型号贴-Q5-251119'],
    ['A10-134', '泡棉移除提示贴'],
    ['A10-142', '请勿堵塞通风口提示贴英文'],
    ['AC03-01', '开机指导贴251010'],
    ['AC04-01', '分子筛防撕毁标贴'],
    ['AC10-01', '车充标贴251010'],
    ['AC07-01', '电池绝缘贴'],
    ['A10-145', '飞机盒覆盖标贴'],
    ['A10-132', '整机真空袋'],
    ['A10-133', '【棉】按键防误触泡棉'],
    ['A07-059', '【软材】红色防尘帽'],
    ['A10-141', '背贴-底部过滤盖板（英文）'],
    ['USA02-001', '【运输箱】Transport Case'],
    ['E05-03', '数据线透明扎带'],
    ['A08-069', '减压垫肩'],
    ['A10-131', '飞机盒'],
    ['USA01-006', '使用手册'],
    ['USA01-005', '快速使用指南'],
    ['AC13-01', '车充说明书'],
    ['A10-143', '过滤棉使用说明书'],
    ['A10-087', '双面20丝环保标平口包-CPE装'],
    ['A09-001', 'OPP扎带（3.5*15.5cm）'],
    ['A08-062', 'type-c数据线PD100W-C'],
    ['A08-070', 'type-c数据线'],
    ['A08-061', '磁环'],
    ['B04-055', '护角90*90'],
    ['B04-055', '护角60*60'],
    ['A07-061', '【软材】肩带挂钩保护套'],
    ['A10-144', '纸浆托'],
    ['A08-031', '鼻氧管'],
    ['A07-053', '底部进气过滤棉（新）'],
    ['A08-030', '内六角扳手（配件）'],
    ['E05-03', '数据线透明扎带'],
  ].map(([code, name], index) => ({
    id: `q5-packaging-20260908-row-${index + 2}`,
    sourceRow: index + 2,
    code,
    name,
  })),
} as const;

export function buildQ5PackagingReference(
  leaves: readonly InventoryReadinessBomLeaf[],
  balances: ReadonlyMap<string, InventoryReadinessBalance>,
  materials: readonly { tpInventoryCode: string | null; unit: string | null }[],
  inventoryDiagnostics: ReadonlyMap<string, InventoryMatchDiagnostic> = new Map(),
): Q5PackagingReference {
  const quantities = new Map<string, number | null>();
  for (const leaf of leaves) {
    const code = leaf.code?.trim();
    if (!code) continue;
    const validQty = leaf.qtyPer !== null && Number.isFinite(leaf.qtyPer) && leaf.qtyPer > 0;
    quantities.set(code, !validQty || quantities.get(code) === null
      ? null
      : (quantities.get(code) ?? 0) + leaf.qtyPer!);
  }
  const units = new Map(materials.map((material) => [material.tpInventoryCode, material.unit?.trim() || '件']));
  const namesByCode = new Map<string, Set<string>>();
  for (const row of Q5_PACKAGING_REFERENCE_SOURCE.items) {
    const names = namesByCode.get(row.code) ?? new Set<string>();
    names.add(row.name);
    namesByCode.set(row.code, names);
  }
  const firstRows = new Map<string, number>();
  const items = Q5_PACKAGING_REFERENCE_SOURCE.items.map((row): Q5PackagingReferenceItem => {
    const duplicateKey = `${row.code}\u0000${row.name}`;
    const duplicateOfRow = firstRows.get(duplicateKey) ?? null;
    if (duplicateOfRow === null) firstRows.set(duplicateKey, row.sourceRow);
    const conflict = namesByCode.get(row.code)!.size > 1;
    const balance = conflict ? undefined : balances.get(row.code);
    const qtyPer = conflict ? null : quantities.get(row.code) ?? null;
    const inventoryDiagnostic = !conflict && !balance ? inventoryDiagnostics.get(row.code) : undefined;
    return {
      ...row,
      unit: units.get(row.code) ?? '件',
      qtyPer,
      stock: balance?.stock ?? null,
      available: balance?.available ?? null,
      inTransit: balance?.inTransit ?? null,
      syncedAt: balance?.syncedAt ?? null,
      issue: conflict ? 'code_conflict' : qtyPer === null ? 'missing_qty' : !balance ? 'inventory_unmatched' : null,
      duplicateOfRow,
      ...(inventoryDiagnostic ? { inventoryDiagnostic } : {}),
    };
  });
  return { sourceFile: Q5_PACKAGING_REFERENCE_SOURCE.sourceFile, sourceSheet: Q5_PACKAGING_REFERENCE_SOURCE.sourceSheet, items };
}
