/** 采购前端可独立验证的纯业务逻辑。保持无 React/网络依赖，便于覆盖乱序与边界数据。 */

/** 搜索后的全选只影响可见项，保留其他筛选条件下已经选中的任务。 */
export function setVisibleProcurementSelection(selected: ReadonlySet<string>, visibleIds: readonly string[], checked: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of visibleIds) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** 任务刷新后移除已失效的选择；可用集合必须取自完整任务范围，而非搜索结果。 */
export function retainAvailableProcurementSelection(selected: ReadonlySet<string>, availableIds: ReadonlySet<string>): Set<string> {
  return new Set([...selected].filter((id) => availableIds.has(id)));
}

/** 不静默丢弃无效行：用户勾选的整组补货数量都有效时才允许提交。 */
export function validateReplenishmentSelection(selected: ReadonlyMap<string, string>) {
  const invalidIds: string[] = [];
  const items: Array<{ materialId: string; quantity: number }> = [];
  for (const [materialId, rawQuantity] of selected) {
    const quantity = Number(rawQuantity);
    if (!rawQuantity.trim() || !Number.isSafeInteger(quantity) || quantity <= 0) invalidIds.push(materialId);
    else items.push({ materialId, quantity });
  }
  return { invalidIds, items: invalidIds.length > 0 ? [] : items };
}

export interface LatestRequestGate {
  begin: () => number;
  isCurrent: (token: number) => boolean;
  invalidate: () => void;
}

/** 只允许最后一次请求提交结果；卸载时 invalidate 可让所有在途响应失效。 */
export function createLatestRequestGate(): LatestRequestGate {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (token) => token === current,
    invalidate: () => { current += 1; },
  };
}

export interface ComparableSupplierQuote {
  currency: string;
  validUntil?: string | null;
  tiers: ReadonlyArray<{ minQty: number; unitPrice: number }>;
}

export interface CurrencyBest<TQuote extends ComparableSupplierQuote> {
  quote: TQuote;
  price: number;
  minQty: number;
}

/** 无汇率时按币种独立选最低有效阶梯价，严禁直接比较不同币种的裸数值。 */
export function lowestActiveTierByCurrency<TQuote extends ComparableSupplierQuote>(
  quotes: ReadonlyArray<TQuote>,
  today: string,
): Array<CurrencyBest<TQuote>> {
  const bestByCurrency = new Map<string, CurrencyBest<TQuote>>();
  for (const quote of quotes) {
    if (quote.validUntil && quote.validUntil < today) continue;
    for (const tier of quote.tiers) {
      const current = bestByCurrency.get(quote.currency);
      if (!current || tier.unitPrice < current.price) {
        bestByCurrency.set(quote.currency, { quote, price: tier.unitPrice, minQty: tier.minQty });
      }
    }
  }
  return Array.from(bestByCurrency.values()).sort((a, b) => a.quote.currency.localeCompare(b.quote.currency));
}

export interface QuoteImportIdentity {
  materialName: string;
  supplierName: string;
}

const QUOTE_IDENTITY_SEPARATOR = String.fromCharCode(0);

function quoteIdentity(item: QuoteImportIdentity): string {
  return `${item.materialName}${QUOTE_IDENTITY_SEPARATOR}${item.supplierName}`;
}

/** 部分导入失败后只保留失败报价及其同索引图片；无法定位失败项时安全回退为全部保留。 */
export function selectFailedQuoteImportEntries<TItem extends QuoteImportIdentity, TAttachment>(
  items: ReadonlyArray<TItem>,
  attachments: ReadonlyArray<TAttachment>,
  failures: ReadonlyArray<QuoteImportIdentity>,
): { items: TItem[]; attachments: TAttachment[] } {
  const failedKeys = new Set(failures.map(quoteIdentity));
  const failedIndexes = items
    .map((item, index) => ({ index, key: quoteIdentity(item) }))
    .filter((item) => failedKeys.has(item.key))
    .map((item) => item.index);
  const retryIndexes = failedIndexes.length > 0
    ? failedIndexes
    : items.map((_, index) => index);
  return {
    items: retryIndexes.map((index) => items[index]),
    attachments: retryIndexes.map((index) => attachments[index]),
  };
}

export interface ProcurementOwnerLike {
  buyerUserId?: string | null;
  buyer?: string | null;
}

/** 缺料预警保留安全库存阈值和旧任务姓名回退，但有物料 ID 的任务只影响该物料。 */
export function countProcurementMaterialShortages(
  materials: ReadonlyArray<{ id: string; name: string; safeStock: number; stockQty: number }>,
  activeTasks: ReadonlyArray<{ materialId?: string | null; materialName: string }>,
): number {
  const materialIds = new Set(activeTasks.flatMap((task) => task.materialId ? [task.materialId] : []));
  const legacyNames = new Set(activeTasks.filter((task) => !task.materialId).map((task) => task.materialName));
  return materials.filter((material) => material.safeStock > 0
    ? material.stockQty < material.safeStock
    : material.stockQty === 0 && (materialIds.has(material.id) || legacyNames.has(material.name))).length;
}

/** 个人工作台按账号归属；仅无账号 ID 的历史任务保留姓名回退。 */
export function isProcurementTaskAssignedToUser(
  task: ProcurementOwnerLike,
  user?: { id?: string; name?: string } | null,
): boolean {
  if (task.buyerUserId) return Boolean(user?.id && task.buyerUserId === user.id);
  return Boolean(task.buyer && task.buyer === user?.name);
}

export function uniqueRosterUserIdsByName(
  members: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string | null> {
  const ids = new Map<string, string | null>();
  for (const member of members) {
    ids.set(member.name, ids.has(member.name) ? null : member.id);
  }
  return ids;
}

/** 驾驶舱统计与任务流共享负责人范围，历史姓名仅在名单内唯一时匹配。 */
export function procurementTasksForBuyer<T extends ProcurementOwnerLike>(
  tasks: readonly T[],
  buyerId: string | null,
  uniqueNameIds: ReadonlyMap<string, string | null>,
): T[] {
  return tasks.filter(task => !buyerId || (task.buyerUserId
    ? task.buyerUserId === buyerId
    : Boolean(task.buyer && uniqueNameIds.get(task.buyer) === buyerId)));
}

/** 优先使用稳定用户 ID；只有缺失/歧义 ID 的历史任务才退回姓名 key。 */
export function resolveProcurementOwner(
  task: ProcurementOwnerLike,
  uniqueNameIds: ReadonlyMap<string, string | null>,
  unassignedKey: string,
  userKey: (userId: string) => string = (userId) => userId,
): { key: string; userId?: string } {
  const userId = task.buyerUserId
    || (task.buyer ? uniqueNameIds.get(task.buyer) ?? undefined : undefined);
  return {
    key: userId ? userKey(userId) : task.buyer ? `name:${task.buyer}` : unassignedKey,
    userId,
  };
}
