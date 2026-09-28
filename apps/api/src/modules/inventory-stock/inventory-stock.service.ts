import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { isProductionWarehouse } from '../procurement/inventory-readiness';
import type { StockIssueSource, StockLedgerRecord } from '../procurement/warehouse-stock-ledger.model';
import { calculateStockRow, stockForCode, type StockQuery, type StockSnapshot } from './inventory-stock.model';
import { warehouseInventoryMovements } from '../procurement/warehouse-inventory-view';

@Injectable()
export class InventoryStockService {
  constructor(private readonly prisma: PrismaService) {}
  /** Compatibility read adapter. It never reads the retired order-processing balance table. */
  async inventory(query: Record<string, unknown>) {
    return this.prisma.$transaction(async db => {
      const balances = await db.procInventoryBalance.findMany({ include: { material: true } });
      const codes = [...new Set(balances.map(row => row.tpInventoryCode))];
      const snapshot = await this.read({ codes, scope: { kind: 'all' } }, db);
      const items = codes.map(code => {
        const first = balances.find(row => row.tpInventoryCode === code)!, material = first.material;
        const base = stockForCode(snapshot, code, material?.unit ?? first.unit);
        const safe = Number(material?.safeStock ?? 0);
        return { id: code, name: material?.name ?? first.materialName, spec: material?.spec ?? first.spec, category: material?.category || '未分类', unit: material?.unit ?? first.unit,
          stock: base.stockState === 'known' ? base.rows.reduce((sum, row) => sum.plus(row.bookQty!), new Prisma.Decimal(0)).toNumber() : null,
          available: base.available, safe, in: balances.filter(row => row.tpInventoryCode === code).reduce((sum, row) => sum.plus(row.inTransitQty), new Prisma.Decimal(0)).toNumber(),
          out: base.stockState === 'known' ? base.rows.reduce((sum, row) => sum.plus(row.bookQty!).minus(row.erpAvailable!), new Prisma.Decimal(0)).toNumber() : null,
          status: base.available === null ? '待核对' : base.available <= 0 ? '缺货' : base.available < safe ? '偏低' : '正常', stockState: base.stockState, ledgerIssues: base.issues,
          warehouses: base.rows.map(row => ({ ...row, name: row.warehouse, stock: row.bookQty, inTransit: Number(balances.find(balance => balance.tpInventoryCode === code && balance.warehouse === row.warehouse)?.inTransitQty ?? 0) })),
          scope: snapshot.scope, readAt: snapshot.readAt };
      });
      const q = String(query.q ?? '').trim().toLowerCase(), category = String(query.category ?? ''), status = String(query.status ?? '');
      const filtered = items.filter(row => (!q || `${row.id} ${row.name} ${row.spec}`.toLowerCase().includes(q)) && (!category || category === 'all' || category === row.category) && (!status || status === 'all' || status === row.status));
      const pageSize = Math.min(10000, Math.max(1, Math.floor(Number(query.pageSize) || 50))), totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)), page = Math.min(totalPages, Math.max(1, Math.floor(Number(query.page) || 1)));
      const states = await db.runtimeState.findMany({ where: { OR: [{ key: { startsWith: 'procurement:warehouse-record:v1:record:' } }, { key: { startsWith: 'procurement:warehouse-flow:v1:issue:' } }] } });
      const records: any[] = [], issues: any[] = [];
      for (const row of states) { try { const value = JSON.parse(row.value); if (row.key.startsWith('procurement:warehouse-record:')) { if (Array.isArray(value?.events)) records.push(value); } else if (Array.isArray(value?.history) && Array.isArray(value?.lines)) issues.push(value); } catch { /* The shared snapshot already marks damaged source records unknown. */ } }
      const movements = warehouseInventoryMovements(records, issues);
      return { source: 'tplus' as const, readOnly: true, summary: { totalSku: items.length, normal: items.filter(row => row.status === '正常').length, low: items.filter(row => row.status === '偏低').length, shortage: items.filter(row => row.status === '缺货').length }, inventory: { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, totalPages }, categories: [...new Set(items.map(row => row.category))], statuses: ['正常', '偏低', '缺货', '待核对'], recentMovements: movements.slice(0, 30), ledgerMovements: movements, stockScope: snapshot.scope, stockReadAt: snapshot.readAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async read(query: StockQuery, db?: Prisma.TransactionClient): Promise<StockSnapshot> {
    if (!query || !Array.isArray(query.codes) || query.codes.some(code => typeof code !== 'string' || !code.trim() || code.length > 128 || /[\u0000-\u001f\u007f]/.test(code))) throw new BadRequestException('库存物料编码无效');
    const codes = [...new Set(query.codes.map(code => code.trim()))].sort();
    const scope = query.scope;
    if (!scope || !['all', 'production', 'selected'].includes(scope.kind) || (scope.kind === 'selected' && (!Array.isArray(scope.warehouses) || !scope.warehouses.length || scope.warehouses.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)))) throw new BadRequestException('请选择有效的库存仓库范围');
    const selected = scope.kind === 'selected' ? [...new Set(scope.warehouses.map(name => name.trim()))].sort() : [];
    const canonicalScope = scope.kind === 'selected' ? { kind: 'selected' as const, warehouses: selected } : scope;
    const read = async (tx: Prisma.TransactionClient): Promise<StockSnapshot> => {
      const [balances, states] = await Promise.all([
        tx.procInventoryBalance.findMany({ where: { tpInventoryCode: { in: codes }, ...(scope.kind === 'selected' ? { warehouse: { in: selected } } : {}) } }),
        tx.runtimeState.findMany({ where: { OR: [{ key: { startsWith: 'procurement:warehouse-record:v1:record:' } }, { key: { startsWith: 'procurement:warehouse-flow:v1:issue:' } }] } }),
      ]);
      const records: StockLedgerRecord[] = [], issues: StockIssueSource[] = [], invalid: string[] = [];
      for (const state of states) {
        try {
          const value = JSON.parse(state.value);
          if (state.key.startsWith('procurement:warehouse-record:v1:record:')) {
            if (!value || typeof value.code !== 'string') throw new Error('invalid record');
            records.push(value);
          } else if (state.key.startsWith('procurement:warehouse-flow:v1:issue:')) {
            if (!value || !Array.isArray(value.lines) || !Array.isArray(value.history)) throw new Error('invalid issue');
            issues.push(value);
          }
        } catch { invalid.push(`库存来源记录 ${state.key} 无法读取，需核对`); }
      }
      const rows = balances.filter(row => codes.includes(row.tpInventoryCode) && (scope.kind === 'all' || (scope.kind === 'production' ? isProductionWarehouse(row.warehouse) : selected.includes(row.warehouse)))).map(balance => calculateStockRow({ balance, records, issues }));
      for (const row of rows) {
        row.issues.push(...invalid);
        if (new Set(rows.filter(item => item.code === row.code).map(item => item.unit)).size > 1) row.issues.push(`${row.code} 分仓单位不同，不可合计`);
        if (rows.filter(item => item.code === row.code && item.warehouse === row.warehouse).length > 1) row.issues.push(`${row.code}/${row.warehouse} 存在重复余额`);
        if (row.issues.length) { row.state = 'unknown'; row.available = null; }
      }
      rows.sort((a, b) => a.code.localeCompare(b.code) || a.warehouse.localeCompare(b.warehouse));
      return { readAt: new Date().toISOString(), sourceToken: createHash('sha256').update(JSON.stringify([canonicalScope, codes, rows, states.map(row => [row.key, row.value]).sort()])).digest('hex'), scope: canonicalScope, rows, missingCodes: codes.filter(code => !rows.some(row => row.code === code)) };
    };
    if (!codes.length) return { readAt: new Date().toISOString(), sourceToken: createHash('sha256').update(JSON.stringify([canonicalScope, codes])).digest('hex'), scope: canonicalScope, rows: [], missingCodes: [] };
    return db ? read(db) : this.prisma.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
