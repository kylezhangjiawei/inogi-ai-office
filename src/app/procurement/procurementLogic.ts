/** 采购前端可独立验证的纯业务逻辑。保持无 React/网络依赖，便于覆盖乱序与边界数据。 */

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

export function uniqueRosterUserIdsByName(
  members: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string | null> {
  const ids = new Map<string, string | null>();
  for (const member of members) {
    ids.set(member.name, ids.has(member.name) ? null : member.id);
  }
  return ids;
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
