import React from 'react';
import { AlertCircle, Inbox, Loader2, MousePointerClick } from 'lucide-react';
import { HorizonEmptyState } from '../../components/horizon/HorizonPage';
import { t } from '../../lib/i18n';

export function OrderSelectionState({ loading = false, failed = false, hasOrders = false, filtered = false, source = 'upload' }: {
  loading?: boolean;
  failed?: boolean;
  hasOrders?: boolean;
  filtered?: boolean;
  source?: 'upload' | 'wecom_mail';
}) {
  const title = failed ? '订单读取失败' : loading ? '正在加载订单' : hasOrders ? '选择一张订货单' : filtered ? '没有匹配的订货单' : '当前来源没有订货单';
  const description = failed ? '请使用上方“重试加载”重新读取，加载失败不代表没有订单。'
    : loading ? '正在读取当前来源的订单，请稍候。'
    : hasOrders ? '从左侧选择订单后，显示客户、商品核对与发票操作。'
    : filtered ? '请调整或清空左侧搜索条件，查看当前来源的其他订单。'
    : source === 'wecom_mail' ? '可检查左侧邮箱与搜索条件，或切换为手动上传来源。'
    : '使用上方“上传订货单”开始，或从左侧切换到企业微信邮箱。';
  return <section className="order-horizon-selection-state min-w-0 p-6" role="status" aria-live="polite">
    <HorizonEmptyState Icon={failed ? AlertCircle : loading ? Loader2 : hasOrders ? MousePointerClick : Inbox}
      title={t(title)} description={t(description)} />
  </section>;
}
