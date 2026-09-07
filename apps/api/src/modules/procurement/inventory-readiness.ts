export type InventoryReadinessStatus =
  | 'ready'
  | 'low'
  | 'gap'
  | 'shortage'
  | 'unmatched'
  | 'data_missing';

export interface InventoryReadinessBomLeaf {
  id: string;
  category: string;
  bomPosition?: string;
  code: string | null;
  name: string;
  spec: string;
  unit: string;
  qtyPer: number | null;
  sourceLines?: InventoryReadinessBomSourceLine[];
}

export interface InventoryReadinessBomSourceLine {
  id: string;
  name: string;
  code: string | null;
  qtyPer: number | null;
  remark: string | null;
  parentId: string | null;
  category: string;
  bomPosition: string;
  updatedAt: string;
  unit: string;
}

export interface InventoryReadinessBalance {
  code: string;
  stock: number;
  available: number;
  inTransit: number;
  safeStock: number;
  syncedAt: string | null;
}

export interface InventoryReadinessItem {
  id: string;
  category: string;
  bomPosition?: string;
  code: string | null;
  name: string;
  spec: string;
  unit: string;
  qtyPer: number | null;
  stock: number;
  available: number;
  inTransit: number;
  safeStock: number;
  currentSets: number;
  withTransitSets: number;
  targetDemand: number;
  gapAfterTransit: number;
  status: InventoryReadinessStatus;
  issue: 'missing_code' | 'missing_qty' | 'inventory_unmatched' | null;
  syncedAt: string | null;
  sourceLines?: InventoryReadinessBomSourceLine[];
}

export interface InventoryReadinessCalculation {
  summary: {
    currentBuildableSets: number;
    withTransitBuildableSets: number;
    inTransitGainSets: number;
    targetSets: number;
    targetGapAfterTransit: number;
    warningMaterials: number;
    bottleneckMaterials: number;
    inTransitMaterials: number;
  };
  dataQuality: {
    totalBomLines: number;
    usableBomLines: number;
    invalidBomLines: number;
    inventoryMatchedLines: number;
    bomCompleteness: number;
    inventoryMatchRate: number;
    provisional: boolean;
  };
  items: InventoryReadinessItem[];
}

const safeFloor = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * ERP 仓库名称可能带有「【活】」一类状态前缀；齐套计算只认业务名称恰好为
 * 「量产仓 / 量产仓库」的记录，明确排除「研发量产仓」等相似名称。
 */
export function isProductionWarehouse(name: string): boolean {
  const canonicalName = name.trim().replace(/\s+/g, '').replace(/^【[^】]+】/, '');
  return canonicalName === '量产仓' || canonicalName === '量产仓库';
}

/**
 * 将产品 BOM 与已限定仓库范围的 ERP 库存快照合并为齐套口径。
 * 同一物料编码在 BOM 多处出现时先合并单机用量，防止重复物料被分别计算而高估齐套数。
 */
export function calculateInventoryReadiness(
  leaves: InventoryReadinessBomLeaf[],
  balances: InventoryReadinessBalance[],
  targetSets: number,
): InventoryReadinessCalculation {
  const normalizedTarget = Math.max(0, safeFloor(targetSets));
  const balanceByCode = new Map(balances.map((balance) => [balance.code, balance]));
  const aggregateByCode = new Map<string, InventoryReadinessBomLeaf & { qtyPer: number }>();
  const positionsByCode = new Map<string, Set<string>>();
  const invalidLeaves: InventoryReadinessBomLeaf[] = [];

  for (const leaf of leaves) {
    const code = leaf.code?.trim() || null;
    const qtyPer = leaf.qtyPer;
    if (!code || qtyPer === null || !Number.isFinite(qtyPer) || qtyPer <= 0) {
      invalidLeaves.push({ ...leaf, code });
      continue;
    }
    const current = aggregateByCode.get(code);
    if (leaf.bomPosition) {
      const positions = positionsByCode.get(code) ?? new Set<string>();
      positions.add(leaf.bomPosition);
      positionsByCode.set(code, positions);
    }
    aggregateByCode.set(code, current
      ? {
          ...current,
          qtyPer: current.qtyPer + qtyPer,
          ...((current.sourceLines || leaf.sourceLines)
            ? { sourceLines: [...(current.sourceLines ?? []), ...(leaf.sourceLines ?? [])] }
            : {}),
        }
      : { ...leaf, code, qtyPer });
  }

  const validItems: InventoryReadinessItem[] = [...aggregateByCode.values()].map((leaf) => {
    const balance = balanceByCode.get(leaf.code!);
    const stock = Math.max(0, balance?.stock ?? 0);
    const available = Math.max(0, balance?.available ?? 0);
    const inTransit = Math.max(0, balance?.inTransit ?? 0);
    const safeStock = Math.max(0, balance?.safeStock ?? 0);
    const currentSets = safeFloor(available / leaf.qtyPer);
    const withTransitSets = safeFloor((available + inTransit) / leaf.qtyPer);
    const targetDemand = normalizedTarget * leaf.qtyPer;
    const gapAfterTransit = Math.max(0, targetDemand - available - inTransit);
    let status: InventoryReadinessStatus = 'ready';
    let issue: InventoryReadinessItem['issue'] = null;
    if (!balance) {
      status = 'unmatched';
      issue = 'inventory_unmatched';
    } else if (available <= 0) {
      status = 'shortage';
    } else if (gapAfterTransit > 0) {
      status = 'gap';
    } else if (safeStock > 0 && available < safeStock) {
      status = 'low';
    }
    return {
      ...leaf,
      ...(positionsByCode.has(leaf.code!) ? { bomPosition: [...positionsByCode.get(leaf.code!)!].join('、') } : {}),
      stock,
      available,
      inTransit,
      safeStock,
      currentSets,
      withTransitSets,
      targetDemand,
      gapAfterTransit,
      status,
      issue,
      syncedAt: balance?.syncedAt ?? null,
    };
  });

  const invalidItems: InventoryReadinessItem[] = invalidLeaves.map((leaf) => ({
    ...leaf,
    stock: 0,
    available: 0,
    inTransit: 0,
    safeStock: 0,
    currentSets: 0,
    withTransitSets: 0,
    targetDemand: 0,
    gapAfterTransit: 0,
    status: 'data_missing',
    issue: leaf.code ? 'missing_qty' : 'missing_code',
    syncedAt: null,
  }));

  const currentBuildableSets = validItems.length > 0
    ? Math.min(...validItems.map((item) => item.currentSets))
    : 0;
  const withTransitBuildableSets = validItems.length > 0
    ? Math.min(...validItems.map((item) => item.withTransitSets))
    : 0;
  const bottleneckMaterials = validItems.filter((item) => item.currentSets === currentBuildableSets).length;
  const warningMaterials = [...validItems, ...invalidItems].filter((item) => item.status !== 'ready').length;
  const inventoryMatchedLines = leaves.filter((leaf) => {
    const code = leaf.code?.trim();
    return Boolean(code && leaf.qtyPer !== null && Number.isFinite(leaf.qtyPer) && leaf.qtyPer! > 0 && balanceByCode.has(code));
  }).length;
  const totalBomLines = leaves.length;
  const usableBomLines = totalBomLines - invalidItems.length;
  const items = [...validItems, ...invalidItems].sort((a, b) => {
    const rank: Record<InventoryReadinessStatus, number> = {
      data_missing: 0,
      unmatched: 1,
      shortage: 2,
      gap: 3,
      low: 4,
      ready: 5,
    };
    return rank[a.status] - rank[b.status]
      || b.gapAfterTransit - a.gapAfterTransit
      || a.category.localeCompare(b.category, 'zh-CN')
      || (a.code ?? '').localeCompare(b.code ?? '', 'zh-CN');
  });

  return {
    summary: {
      currentBuildableSets,
      withTransitBuildableSets,
      inTransitGainSets: Math.max(0, withTransitBuildableSets - currentBuildableSets),
      targetSets: normalizedTarget,
      targetGapAfterTransit: Math.max(0, normalizedTarget - withTransitBuildableSets),
      warningMaterials,
      bottleneckMaterials,
      inTransitMaterials: validItems.filter((item) => item.inTransit > 0).length,
    },
    dataQuality: {
      totalBomLines,
      usableBomLines,
      invalidBomLines: invalidItems.length,
      inventoryMatchedLines,
      bomCompleteness: totalBomLines > 0 ? usableBomLines / totalBomLines : 0,
      inventoryMatchRate: usableBomLines > 0 ? inventoryMatchedLines / usableBomLines : 0,
      provisional: invalidItems.length > 0 || inventoryMatchedLines < usableBomLines,
    },
    items,
  };
}
