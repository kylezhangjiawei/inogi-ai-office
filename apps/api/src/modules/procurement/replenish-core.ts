/**
 * 补货建议的纯计算核心：无 DI、无 Prisma 依赖，供 MaterialReplenishService 与
 * MateChat 采购查询工具共用同一口径（后者因 Chat↔Procurement 模块循环依赖无法注入服务）。
 *
 * 口径：建议量 = 安全库存 − 当前库存 − T+ 在途（镜像未到齐行）− 进行中任务未到量，
 * ≤0 视为缺口已覆盖不列出；排序按缺口金额（建议量 × 最近单价）降序。
 */

export interface ReplenishMaterialInput {
  id: string;
  erpCode: string;
  name: string;
  spec: string;
  unit: string;
  safeStock: number;
  stock: number;
}

export interface ReplenishMirrorInput {
  materialId: string;
  orderedQty: number;
  receivedQty: number;
  supplierName: string;
  unitPrice: number | null;
  /** 须按 orderDate 降序传入：首次出现即「最近一单」 */
}

export interface ReplenishTaskInput {
  materialId: string;
  quantity: number;
  arrivedQty: number;
}

export interface ReplenishRow {
  materialId: string;
  code: string;
  name: string;
  spec: string;
  unit: string;
  stock: number;
  safeStock: number;
  inTransit: number;
  openTaskQty: number;
  suggestQty: number;
  /** 包装/起订粒度（历史采购量最大公约数 ≥5 才采信）；建议量已按此向上取整 */
  packStep: number | null;
  lastSupplier: string | null;
  lastPrice: number | null;
}

/**
 * 历史采购量的最大公约数：≥5 视为包装/起订粒度（500、1000 的倍数等）。
 * 须 ≥2 个样本——单笔订单的「公约数」就是订单量本身，会把小缺口凑成整单量，无意义；
 * 含小数的物料（按米/公斤计量）不取整。
 */
function packStepOf(quantities: number[]): number | null {
  const positives = quantities.filter((q) => q > 0);
  const ints = positives.filter((q) => Number.isInteger(q));
  if (ints.length < 2 || ints.length !== positives.length) return null;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const step = ints.reduce((acc, q) => gcd(acc, q));
  return step >= 5 ? step : null;
}

export function computeReplenishRows(
  shortage: ReplenishMaterialInput[],
  mirrorRowsDesc: ReplenishMirrorInput[],
  openTasks: ReplenishTaskInput[],
): ReplenishRow[] {
  const inTransitById = new Map<string, number>();
  const lastOrderById = new Map<string, { supplier: string | null; price: number | null }>();
  const orderedQtysById = new Map<string, number[]>();
  for (const row of mirrorRowsDesc) {
    const open = row.orderedQty - row.receivedQty;
    if (open > 0) inTransitById.set(row.materialId, (inTransitById.get(row.materialId) ?? 0) + open);
    if (!lastOrderById.has(row.materialId)) {
      lastOrderById.set(row.materialId, { supplier: row.supplierName || null, price: row.unitPrice });
    }
    const qtys = orderedQtysById.get(row.materialId) ?? [];
    qtys.push(row.orderedQty);
    orderedQtysById.set(row.materialId, qtys);
  }
  const openTaskById = new Map<string, number>();
  for (const t of openTasks) {
    const open = Math.max(0, t.quantity - t.arrivedQty);
    openTaskById.set(t.materialId, (openTaskById.get(t.materialId) ?? 0) + open);
  }

  const rows: ReplenishRow[] = [];
  for (const m of shortage) {
    const inTransit = inTransitById.get(m.id) ?? 0;
    const openTaskQty = openTaskById.get(m.id) ?? 0;
    let suggestQty = Math.ceil(m.safeStock - m.stock - inTransit - openTaskQty);
    if (suggestQty <= 0) continue;
    // 按历史包装/起订粒度向上取整（如历史都是 500 的倍数就凑到 500 的倍数）
    const packStep = packStepOf(orderedQtysById.get(m.id) ?? []);
    if (packStep) suggestQty = Math.ceil(suggestQty / packStep) * packStep;
    const last = lastOrderById.get(m.id);
    rows.push({
      packStep,
      materialId: m.id,
      code: m.erpCode,
      name: m.name,
      spec: m.spec,
      unit: m.unit,
      stock: m.stock,
      safeStock: m.safeStock,
      inTransit,
      openTaskQty,
      suggestQty,
      lastSupplier: last?.supplier ?? null,
      lastPrice: last?.price ?? null,
    });
  }
  rows.sort((a, b) => b.suggestQty * (b.lastPrice ?? 0) - a.suggestQty * (a.lastPrice ?? 0));
  return rows;
}
