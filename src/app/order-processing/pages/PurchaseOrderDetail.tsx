import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Loader2,
  Mail,
  PackageCheck,
  Phone,
  Truck,
  UserRound,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  formatCurrency,
  statusBadgeClass,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from './PurchaseOrders';
import { orderProcessingApi } from '../../lib/orderProcessingApi';

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildFallbackItems(order: PurchaseOrder): PurchaseOrderLine[] {
  const qty = Math.max(order.itemCount || 1, 1);
  const receivedQty = order.status === '已完成' ? qty : order.status === '部分到货' ? Math.max(1, Math.floor(qty / 2)) : 0;
  return [
    {
      sku: 'IMPORT-SUMMARY',
      name: '导入汇总明细',
      spec: order.sourceFile ? `来源文件：${order.sourceFile}` : '未提供明细行',
      unit: '批',
      qty,
      receivedQty,
      unitPrice: order.amount / qty,
    },
  ];
}

function InfoItem({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-50 py-2.5 last:border-b-0">
      <span className="shrink-0 text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium text-slate-800">{value || '-'}</span>
    </div>
  );
}

function TimelineItem({ active, title, desc }: { active: boolean; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`mt-1 h-3 w-3 rounded-full ${active ? 'bg-blue-600 ring-4 ring-blue-100' : 'bg-slate-200'}`} />
        <span className="h-full min-h-8 w-px bg-slate-100" />
      </div>
      <div className="pb-4">
        <div className={`text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-500'}`}>{title}</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">{desc}</div>
      </div>
    </div>
  );
}

export function PurchaseOrderDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const decodedId = safeDecode(id);
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErrorMessage('');
    orderProcessingApi.getPurchaseOrder(decodedId)
      .then((data) => {
        if (alive) setOrder(data.order);
      })
      .catch((error) => {
        if (alive) setErrorMessage(error instanceof Error ? error.message : '采购订单加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [decodedId]);

  const items = order ? (order.items?.length ? order.items : buildFallbackItems(order)) : [];
  const itemAmount = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const receivedTotal = items.reduce((sum, item) => sum + item.receivedQty, 0);
  const orderedTotal = items.reduce((sum, item) => sum + item.qty, 0);

  if (loading) {
    return (
      <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
        <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        <p className="mt-3 text-sm text-slate-500">正在加载采购订单详情</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
        <PackageCheck className="h-12 w-12 text-slate-300" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">未找到采购订单</h1>
        <p className="mt-2 text-sm text-slate-500">{errorMessage || '当前链接对应的采购订单不存在，可能已被清理或尚未导入。'}</p>
        <Button className="mt-5" onClick={() => navigate('/purchase-orders')}>
          返回采购订单
        </Button>
      </div>
    );
  }

  const timeline = [
    { key: 'created', title: '创建采购单', desc: `${order.orderDate} 由 ${order.buyer} 创建，所属 ${order.owner}` },
    { key: 'approved', title: '审批确认', desc: order.approvalStatus || '等待采购主管确认' },
    { key: 'ordered', title: '供应商履约', desc: order.deliveryTerm || '等待供应商确认交付方式' },
    { key: 'inbound', title: '到货入库', desc: `目标仓库：${order.warehouse}，预计 ${order.etaDate} 到货` },
  ];
  const activeTimelineCount =
    order.status === '已完成' ? 4 : order.status === '部分到货' ? 3 : order.status === '已下单' ? 2 : order.status === '异常' ? 2 : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 px-5 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate('/purchase-orders')}
            className="h-9 rounded-full border-slate-200 bg-white px-3 text-slate-600 shadow-sm hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <PackageCheck className="h-4 w-4 text-blue-500" />
              采购订单详情
            </div>
            <h1 className="mt-1 font-mono text-2xl font-semibold tracking-normal text-slate-900">{order.poNo}</h1>
          </div>
        </div>
        <Badge variant="secondary" className={`rounded-full px-3 py-1 font-medium ${statusBadgeClass(order.status)}`}>
          {order.status}
        </Badge>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>订单金额</span>
            <FileText className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{formatCurrency(order.amount, order.currency)}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>SKU / 数量</span>
            <PackageCheck className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{items.length} / {orderedTotal}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>已到货数量</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{receivedTotal}</div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>预计到货</span>
            <CalendarDays className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900">{order.etaDate}</div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">商品明细</h2>
            </div>
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="px-4">SKU</TableHead>
                  <TableHead>商品名称</TableHead>
                  <TableHead>规格</TableHead>
                  <TableHead className="text-right">采购数量</TableHead>
                  <TableHead className="text-right">已到货</TableHead>
                  <TableHead className="text-right">单价</TableHead>
                  <TableHead className="text-right">小计</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.sku}-${item.name}`}>
                    <TableCell className="px-4 font-mono text-slate-800">{item.sku}</TableCell>
                    <TableCell className="font-medium text-slate-900">{item.name}</TableCell>
                    <TableCell className="text-slate-600">{item.spec}</TableCell>
                    <TableCell className="text-right text-slate-700">{item.qty} {item.unit}</TableCell>
                    <TableCell className="text-right text-slate-700">{item.receivedQty} {item.unit}</TableCell>
                    <TableCell className="text-right text-slate-700">{formatCurrency(item.unitPrice, order.currency)}</TableCell>
                    <TableCell className="text-right font-semibold text-slate-900">{formatCurrency(item.qty * item.unitPrice, order.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
              <span className="text-slate-500">明细合计</span>
              <span className="font-semibold text-slate-900">{formatCurrency(itemAmount, order.currency)}</span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900">
                <UserRound className="h-4 w-4 text-blue-500" />
                采购与供应商
              </div>
              <InfoItem label="供应商" value={order.supplier} />
              <InfoItem label="联系人" value={order.supplierContact} />
              <InfoItem label="联系电话" value={order.supplierPhone ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{order.supplierPhone}</span> : '-'} />
              <InfoItem label="邮箱" value={order.supplierEmail ? <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{order.supplierEmail}</span> : '-'} />
              <InfoItem label="采购员" value={order.buyer} />
              <InfoItem label="采购组" value={order.owner} />
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900">
                <ClipboardCheck className="h-4 w-4 text-blue-500" />
                合同与结算
              </div>
              <InfoItem label="付款条件" value={order.paymentTerm || '未配置'} />
              <InfoItem label="交付方式" value={order.deliveryTerm || '未配置'} />
              <InfoItem label="发票类型" value={order.invoiceType || '未配置'} />
              <InfoItem label="审批状态" value={order.approvalStatus || '未配置'} />
              <InfoItem label="来源文件" value={order.sourceFile || '系统样例'} />
              <InfoItem label="内部 ID" value={<span className="font-mono">{order.id}</span>} />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
              <Truck className="h-4 w-4 text-blue-500" />
              履约进度
            </div>
            <div>
              {timeline.map((item, index) => (
                <TimelineItem key={item.key} active={index < activeTimelineCount} title={item.title} desc={item.desc} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 text-base font-semibold text-slate-900">备注</div>
            <p className="min-h-24 rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600">
              {order.remark || '暂无备注'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
