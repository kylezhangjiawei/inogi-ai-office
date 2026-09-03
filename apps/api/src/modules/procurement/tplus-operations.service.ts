import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

type Query = Record<string, unknown>;
type InventoryStatus = '正常' | '偏低' | '缺货';
type PurchaseOrderStatus = '待确认' | '已下单' | '部分到货' | '已完成' | '异常';

export interface InventoryViewRow {
  id: string;
  name: string;
  category: string;
  spec: string;
  unit: string;
  stock: number;
  available: number;
  safe: number;
  in: number;
  out: number;
  status: InventoryStatus;
  warehouses: Array<{ name: string; stock: number; available: number; inTransit: number }>;
  syncedAt: string | null;
}

export interface PurchaseTaskLink {
  id: string;
  code: string;
  materialName: string;
  status: string;
  quantity: number;
  arrivedQty: number;
  buyer: string;
}

export interface PurchaseOrderViewLine {
  sku: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
  receivedQty: number;
  unitPrice: number;
}

export interface PurchaseOrderView {
  id: string;
  poNo: string;
  supplier: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  buyer: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  etaDate: string;
  itemCount: number;
  amount: number;
  currency: 'CNY';
  warehouse: string;
  owner: string;
  approvalStatus?: string;
  remark: string;
  sourceFile: string;
  syncedAt: string | null;
  items: PurchaseOrderViewLine[];
  taskLinks: PurchaseTaskLink[];
}

/**
 * 将畅捷通只读镜像转换为「采购订单 / 库存管理」现有页面的数据协议。
 *
 * 这里不复制数据，也不允许页面回写库存。T+ 仍是采购单与库存的唯一事实源，
 * 页面只负责检索、汇总和展示。
 */
@Injectable()
export class TplusOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listInventory(query: Query) {
    const balances = await this.prisma.procInventoryBalance.findMany({
      include: {
        material: {
          select: {
            id: true,
            name: true,
            spec: true,
            unit: true,
            category: true,
            safeStock: true,
          },
        },
      },
      orderBy: [{ materialName: 'asc' }, { warehouse: 'asc' }],
    });

    const grouped = new Map<string, InventoryViewRow>();
    for (const balance of balances) {
      const key = balance.materialId || balance.tpInventoryCode;
      const material = balance.material;
      const current = grouped.get(key) ?? {
        id: balance.tpInventoryCode,
        name: material?.name || balance.materialName || balance.tpInventoryCode,
        category: material?.category || '未分类',
        spec: material?.spec || balance.spec || '',
        unit: material?.unit || balance.unit || '',
        stock: 0,
        available: 0,
        safe: Number(material?.safeStock ?? 0),
        in: 0,
        out: 0,
        status: '正常' as InventoryStatus,
        warehouses: [],
        syncedAt: null,
      };
      const stock = Number(balance.stockQty);
      const available = Number(balance.availableQty);
      const inTransit = Number(balance.inTransitQty);
      current.stock += stock;
      current.available += available;
      current.in += inTransit;
      current.out += Math.max(0, stock - available);
      current.warehouses.push({
        name: balance.warehouse || '未指定仓库',
        stock,
        available,
        inTransit,
      });
      const syncedAt = balance.syncedAt?.toISOString() ?? null;
      if (syncedAt && (!current.syncedAt || syncedAt > current.syncedAt)) current.syncedAt = syncedAt;
      grouped.set(key, current);
    }

    const allRows = Array.from(grouped.values()).map((row) => ({
      ...row,
      status: this.inventoryStatus(row.available, row.safe),
    }));
    const q = this.text(query.q).toLowerCase();
    const category = this.text(query.category);
    const status = this.text(query.status);
    const filtered = allRows.filter((row) => {
      if (q && !`${row.id} ${row.name} ${row.spec}`.toLowerCase().includes(q)) return false;
      if (category && category !== 'all' && row.category !== category) return false;
      if (status && status !== 'all' && row.status !== status) return false;
      return true;
    });
    const requestedPage = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 50), 10_000);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;

    return {
      source: 'tplus',
      readOnly: true,
      summary: {
        totalSku: allRows.length,
        normal: allRows.filter((row) => row.status === '正常').length,
        low: allRows.filter((row) => row.status === '偏低').length,
        shortage: allRows.filter((row) => row.status === '缺货').length,
      },
      inventory: {
        items: filtered.slice(start, start + pageSize),
        page,
        pageSize,
        total: filtered.length,
        totalPages,
      },
      categories: [...new Set(allRows.map((row) => row.category).filter(Boolean))].sort(),
      statuses: ['正常', '偏低', '缺货'] satisfies InventoryStatus[],
      recentMovements: [],
      syncedAt: this.latestDate(allRows.map((row) => row.syncedAt)),
    };
  }

  async getInventoryDetail(idOrInventoryCode: string) {
    const inventoryCode = decodeURIComponent(idOrInventoryCode);
    const [inventory, purchaseRows] = await Promise.all([
      this.listInventory({ page: 1, pageSize: 10_000 }),
      this.prisma.procPurchaseOrderMirror.findMany({
        where: { inventoryCode },
        orderBy: [{ orderDate: 'desc' }, { tpOrderNo: 'desc' }],
        take: 30,
      }),
    ]);
    const item = inventory.inventory.items.find((row) => row.id === inventoryCode);
    if (!item) throw new NotFoundException('畅捷通库存记录不存在，请先执行同步');
    return {
      source: 'tplus',
      readOnly: true,
      item,
      movements: [],
      relatedOrders: [],
      relatedPurchaseOrders: purchaseRows.map((row) => ({
        id: row.id,
        poNo: row.tpOrderNo,
        supplier: row.supplierName,
        orderedQty: Number(row.orderedQty),
        receivedQty: Number(row.receivedQty),
        unitPrice: Number(row.unitPrice ?? 0),
        orderDate: this.day(row.orderDate),
        etaDate: this.day(row.etaDate),
        approvalStatus: row.approvalStatus,
        status: this.purchaseOrderStatus([row]),
        syncedAt: row.syncedAt?.toISOString() ?? null,
      })),
    };
  }

  async exportInventory(query: Query) {
    const result = await this.listInventory({ ...query, page: 1, pageSize: 10_000 });
    const lines = [
      ['存货编码', '存货名称', '分类', '规格', '单位', '现存量', '可用量', '在途量', '安全库存', '状态', '仓库'].join(','),
      ...result.inventory.items.map((row) =>
        [
          row.id,
          row.name,
          row.category,
          row.spec,
          row.unit,
          row.stock,
          row.available,
          row.in,
          row.safe,
          row.status,
          row.warehouses.map((warehouse) => warehouse.name).join(' / '),
        ]
          .map((value) => this.csv(value))
          .join(','),
      ),
    ];
    return {
      fileName: `tplus-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: lines.join('\n'),
    };
  }

  async listPurchaseOrders(query: Query) {
    const [rows, suppliers] = await Promise.all([
      this.prisma.procPurchaseOrderMirror.findMany({
        orderBy: [{ orderDate: 'desc' }, { tpOrderNo: 'desc' }, { tpLineNo: 'asc' }],
      }),
      this.prisma.procSupplier.findMany({
        where: { source: 'tplus' },
        select: { name: true, contact: true, phone: true, email: true },
      }),
    ]);
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.name, supplier]));
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = grouped.get(row.tpOrderNo) ?? [];
      group.push(row);
      grouped.set(row.tpOrderNo, group);
    }
    const allOrders = Array.from(grouped.entries()).map(([orderNo, lines]) =>
      this.purchaseOrder(orderNo, lines, supplierMap.get(lines[0]?.supplierName ?? '')),
    );

    const q = this.text(query.q).toLowerCase();
    const status = this.text(query.status);
    const supplier = this.text(query.supplier);
    const dateFrom = this.text(query.dateFrom);
    const dateTo = this.text(query.dateTo);
    const filtered = allOrders.filter((order) => {
      const haystack = `${order.poNo} ${order.supplier} ${order.items.map((item) => `${item.sku} ${item.name}`).join(' ')}`.toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (status === 'in_transit' && !['已下单', '部分到货'].includes(order.status)) return false;
      if (status && status !== 'all' && status !== 'in_transit' && order.status !== status) return false;
      if (supplier && supplier !== 'all' && order.supplier !== supplier) return false;
      if (dateFrom && order.orderDate !== '-' && order.orderDate < dateFrom) return false;
      if (dateTo && order.orderDate !== '-' && order.orderDate > dateTo) return false;
      return true;
    });
    const requestedPage = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 50), 200);
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;

    return {
      source: 'tplus',
      readOnly: true,
      orders: {
        items: filtered.slice(start, start + pageSize),
        page,
        pageSize,
        total: filtered.length,
        totalPages,
      },
      suppliers: [...new Set(allOrders.map((order) => order.supplier).filter(Boolean))].sort(),
      stats: {
        total: filtered.length,
        open: filtered.filter((order) => order.status === '待确认' || order.status === '已下单').length,
        inbound: filtered.filter((order) => order.status === '部分到货').length,
        abnormal: filtered.filter((order) => order.status === '异常').length,
        amount: filtered.reduce((sum, order) => sum + order.amount, 0),
      },
      syncedAt: this.latestDate(allOrders.map((order) => order.syncedAt)),
    };
  }

  async getPurchaseOrder(idOrOrderNo: string) {
    const orderNo = decodeURIComponent(idOrOrderNo);
    const rows = await this.prisma.procPurchaseOrderMirror.findMany({
      where: { tpOrderNo: orderNo },
      orderBy: { tpLineNo: 'asc' },
    });
    if (rows.length === 0) throw new NotFoundException('畅捷通采购订单不存在，请先执行同步');
    const [supplier, refs] = await Promise.all([
      rows[0]?.supplierName
        ? this.prisma.procSupplier.findFirst({
            where: { source: 'tplus', name: rows[0].supplierName },
            select: { name: true, contact: true, phone: true, email: true },
          })
        : Promise.resolve(null),
      this.prisma.procPurchaseOrderRef.findMany({
        where: { tpOrderNo: orderNo },
        include: {
          task: {
            select: {
              id: true,
              code: true,
              materialName: true,
              status: true,
              quantity: true,
              arrivedQty: true,
              buyer: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const taskLinks = refs.map((ref) => ({
      id: ref.task.id,
      code: ref.task.code,
      materialName: ref.task.materialName,
      status: ref.task.status,
      quantity: Number(ref.task.quantity),
      arrivedQty: Number(ref.task.arrivedQty),
      buyer: ref.task.buyer,
    }));
    return { order: { ...this.purchaseOrder(orderNo, rows, supplier ?? undefined), taskLinks } };
  }

  private purchaseOrder(
    orderNo: string,
    lines: Array<{
      tpOrderNo: string;
      inventoryCode: string;
      inventoryName: string;
      spec: string;
      unit: string;
      orderedQty: unknown;
      receivedQty: unknown;
      unitPrice: unknown;
      supplierName: string;
      orderDate: Date | null;
      etaDate: Date | null;
      approvalStatus: string | null;
      status: string | null;
      syncedAt: Date | null;
    }>,
    supplier?: { name: string; contact: string | null; phone: string | null; email: string | null },
  ): PurchaseOrderView {
    const items = lines.map((line) => ({
      sku: line.inventoryCode || '-',
      name: line.inventoryName || line.inventoryCode || '未命名存货',
      spec: line.spec || '',
      unit: line.unit || '',
      qty: Number(line.orderedQty),
      receivedQty: Number(line.receivedQty),
      unitPrice: Number(line.unitPrice ?? 0),
    }));
    const status = this.purchaseOrderStatus(lines);
    const approvalStatus = lines.find((line) => line.approvalStatus)?.approvalStatus ?? undefined;
    return {
      id: orderNo,
      poNo: orderNo,
      supplier: lines[0]?.supplierName || supplier?.name || '未指定供应商',
      supplierContact: supplier?.contact ?? undefined,
      supplierPhone: supplier?.phone ?? undefined,
      supplierEmail: supplier?.email ?? undefined,
      buyer: '畅捷通',
      status,
      orderDate: this.day(lines.find((line) => line.orderDate)?.orderDate),
      etaDate: this.day(
        lines
          .map((line) => line.etaDate)
          .filter((date): date is Date => Boolean(date))
          .sort((a, b) => a.getTime() - b.getTime())[0],
      ),
      itemCount: items.length,
      amount: items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0),
      currency: 'CNY',
      warehouse: '-',
      owner: '畅捷通 T+',
      approvalStatus,
      remark: '采购订单及到货数量来自畅捷通 T+，本系统只读展示。',
      sourceFile: '畅捷通 T+',
      syncedAt: this.latestDate(lines.map((line) => line.syncedAt?.toISOString() ?? null)),
      items,
      taskLinks: [],
    };
  }

  private purchaseOrderStatus(
    lines: Array<{ orderedQty: unknown; receivedQty: unknown; approvalStatus: string | null; status: string | null }>,
  ): PurchaseOrderStatus {
    const ordered = lines.reduce((sum, line) => sum + Number(line.orderedQty), 0);
    const received = lines.reduce((sum, line) => sum + Number(line.receivedQty), 0);
    const raw = lines.map((line) => `${line.approvalStatus ?? ''} ${line.status ?? ''}`).join(' ');
    if (/作废|取消|终止|异常|cancel|void/i.test(raw)) return '异常';
    if (ordered > 0 && received >= ordered) return '已完成';
    if (received > 0) return '部分到货';
    if (/[未审草稿待审]/.test(raw)) return '待确认';
    return '已下单';
  }

  private inventoryStatus(available: number, safe: number): InventoryStatus {
    if (available <= 0) return '缺货';
    if (safe > 0 && available < safe) return '偏低';
    return '正常';
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private positiveInt(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private day(date?: Date | null) {
    return date ? date.toISOString().slice(0, 10) : '-';
  }

  private latestDate(dates: Array<string | null>) {
    return dates.filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
  }

  private csv(value: unknown) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
