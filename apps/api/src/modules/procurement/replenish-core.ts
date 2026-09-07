/**
 * 补货建议的纯计算核心：无 DI、无 Prisma 依赖，供 MaterialReplenishService 与
 * MateChat 采购查询工具共用同一口径（后者因 Chat↔Procurement 模块循环依赖无法注入服务）。
 *
 * 口径：建议量 = 安全库存 − 当前库存 − T+ 在途（镜像未到齐行）− 尚未计入订单的任务未到量，
 * ≤0 标记 covered（缺口已被覆盖）但仍然列出；排序按缺口金额（建议量 × 最近单价）降序，
 * covered 行沉到末尾。
 */

/**
 * 作废 / 取消 / 终止的采购单不能算在途：它永远不会到货，计入只会把真实缺口抵消掉。
 * 判定词与 tplus-operations.service.ts 的单据状态归类保持一致。
 */
const VOIDED_ORDER_STATUS = /作废|取消|终止|异常|cancel|void|abort/i;

/** 单据状态或审批状态任一命中作废词即视为无效单。 */
export function isVoidedOrderStatus(...values: Array<string | null | undefined>) {
  return values.some((value) => typeof value === 'string' && VOIDED_ORDER_STATUS.test(value));
}

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
  tpOrderNo?: string;
  tpLineNo?: string | null;
  orderedQty: number;
  receivedQty: number;
  supplierName: string;
  unitPrice: number | null;
  /** T+ 单据状态；作废/取消的单整行不参与在途、最近一单与包装粒度 */
  status?: string | null;
  /** T+ 审批状态；同上 */
  approvalStatus?: string | null;
  /** 须按 orderDate 降序传入：首次出现即「最近一单」 */
}

export interface ReplenishTaskInput {
  materialId: string;
  quantity: number;
  arrivedQty: number;
  purchaseOrderRefs?: Array<{
    tpOrderNo: string;
    tpLineNo?: string | null;
    orderedQty: number;
    receivedQty: number;
    status?: string | null;
    approvalStatus?: string | null;
  }>;
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
  /** 缺口已被在途/进行中任务覆盖时为 0；此时 covered 为 true */
  suggestQty: number;
  /**
   * 缺口已被在途或进行中任务完全覆盖。这类物料仍然缺料，只是暂时不需要下单，
   * 保留在清单里是为了让「在途量算错」这件事可见——静默丢弃会让缺料预警与
   * 补货建议两个数字长期对不上，且没人知道差额去了哪。
   */
  covered: boolean;
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
  const ordersByMaterial = new Map<string, Map<string, ReplenishMirrorInput>>();
  for (const row of mirrorRowsDesc) {
    const orderNo = row.tpOrderNo?.trim();
    if (orderNo) {
      const key = `${row.materialId}\u0000${orderNo}`;
      const lines = ordersByMaterial.get(key) ?? new Map<string, ReplenishMirrorInput>();
      lines.set(row.tpLineNo?.trim() ?? '', row);
      ordersByMaterial.set(key, lines);
    }
    // 作废单整行跳过：既不计在途，也不当作「最近一单」的供应商/单价参考，
    // 更不参与包装粒度推断——它代表的采购从未真正发生。
    if (isVoidedOrderStatus(row.status, row.approvalStatus)) continue;
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
    const linkedByLine = new Map<string, number>();
    for (const ref of t.purchaseOrderRefs ?? []) {
      const orderNo = ref.tpOrderNo.trim();
      if (!orderNo) continue; // 免费样品没有 ERP 订单身份，不能与正式采购在途合并。
      const orderKey = `${t.materialId}\u0000${orderNo}`;
      const lines = ordersByMaterial.get(orderKey);
      const lineNo = ref.tpLineNo?.trim() ?? '';
      // 历史引用可能没有行号；只有同订单、同物料唯一一行时才可确定，不能猜第一行。
      const mirror = lineNo
        ? lines?.get(lineNo)
        : lines?.get('') ?? (lines?.size === 1 ? [...lines.values()][0] : undefined);
      if (!mirror && !isVoidedOrderStatus(ref.status, ref.approvalStatus)) continue;
      const linkedOpen = ref.orderedQty > 0
        ? Math.max(0, ref.orderedQty - ref.receivedQty)
        : mirror ? Math.max(0, mirror.orderedQty - mirror.receivedQty) : 0;
      const key = `${orderKey}\u0000${mirror?.tpLineNo?.trim() ?? lineNo}`;
      linkedByLine.set(key, Math.max(linkedByLine.get(key) ?? 0, linkedOpen));
    }
    // 关联份额交由 ERP 镜像计算：已到齐/作废单不得借滞后的任务再次成为在途。
    // 每个任务独立去掉重复来源；多任务引用同一单也只留下镜像中的一份供给。
    const linkedOpen = [...linkedByLine.values()].reduce((sum, quantity) => sum + quantity, 0);
    const open = Math.max(0, t.quantity - t.arrivedQty - linkedOpen);
    openTaskById.set(t.materialId, (openTaskById.get(t.materialId) ?? 0) + open);
  }

  const rows: ReplenishRow[] = [];
  for (const m of shortage) {
    const inTransit = inTransitById.get(m.id) ?? 0;
    const openTaskQty = openTaskById.get(m.id) ?? 0;
    const gap = Math.ceil(m.safeStock - m.stock - inTransit - openTaskQty);
    const covered = gap <= 0;
    let suggestQty = covered ? 0 : gap;
    // 按历史包装/起订粒度向上取整（如历史都是 500 的倍数就凑到 500 的倍数）
    const packStep = packStepOf(orderedQtysById.get(m.id) ?? []);
    if (!covered && packStep) suggestQty = Math.ceil(suggestQty / packStep) * packStep;
    const last = lastOrderById.get(m.id);
    rows.push({
      covered,
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
  // 可下单的排前面；已被覆盖的沉到末尾供核对，不占据视线
  rows.sort((a, b) => {
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    return b.suggestQty * (b.lastPrice ?? 0) - a.suggestQty * (a.lastPrice ?? 0);
  });
  return rows;
}
