import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const list = source('src/app/order-processing/pages/PurchaseOrders.tsx');
const detail = source('src/app/order-processing/pages/PurchaseOrderDetail.tsx');

test('采购订单列表忽略过期筛选请求并只由当前请求收口加载态', () => {
  assert.match(list, /const loadRequestRef = useRef\(0\)/);
  assert.match(list, /const requestId = \+\+loadRequestRef\.current/);
  assert.match(list, /if \(requestId !== loadRequestRef\.current\) return/);
  assert.match(list, /if \(requestId === loadRequestRef\.current\) setLoading\(false\)/);
  assert.match(list, /loadRequestRef\.current \+= 1/);
  assert.match(list, /useDeferredValue\(query\.trim\(\)\)/);
  assert.match(list, /const requestParamsRef = useRef\(requestParams\)/);
  assert.match(list, /async \(params: PurchaseOrderQuery = requestParamsRef\.current\)/);
  assert.match(list, /void loadOrders\(requestParams\)/);
});

test('采购订单筛选具有明确语义、有效筛选计数和单一清除入口', () => {
  assert.match(list, /role="search" aria-label=\{t\('采购订单筛选'\)\}/);
  assert.match(list, /aria-label=\{t\('按订单状态筛选'\)\}/);
  assert.match(list, /aria-label=\{t\('按供应商筛选'\)\}/);
  assert.match(list, /max=\{dateTo \|\| undefined\}/);
  assert.match(list, /min=\{dateFrom \|\| undefined\}/);
  assert.match(list, /const activeFilterCount =/);
  assert.match(list, /hasActiveFilters \? \(/);
  assert.match(list, /清除全部采购订单筛选，共 \{count\} 项/);
});

test('采购订单列表提供局部错误、重试、骨架、空态和可滚动表格说明', () => {
  assert.match(list, /const \[loadError, setLoadError\] = useState\(''\)/);
  assert.match(list, /role="alert"[\s\S]*?采购订单更新失败[\s\S]*?loadOrders\(\)/);
  assert.match(list, /title=\{t\('采购订单加载失败'\)\}[\s\S]*?重新加载/);
  assert.match(list, /purchase-order-skeleton-/);
  assert.match(list, /暂无匹配的采购订单/);
  assert.match(list, /暂无采购订单/);
  assert.match(list, /role="region"[\s\S]*?tabIndex=\{0\}/);
  assert.match(list, /采购订单列表，可横向滚动查看更多字段/);
});

test('采购订单列表只向有详情权限的用户提供具名入口', () => {
  assert.match(list, /usePermission\('page:purchase-order-detail'\)/);
  assert.match(list, /canViewDetail \? \(/);
  assert.match(list, /查看采购订单 \{poNo\}/);
  assert.match(list, /无详情权限/);
});

test('采购订单金额、数量和日期采用等宽数字并兼顾窄屏控件', () => {
  assert.match(list, /order\.itemCount[\s\S]{0,100}tabular-nums|tabular-nums[\s\S]{0,100}order\.itemCount/);
  assert.match(list, /formatCurrency\(order\.amount, order\.currency\)[\s\S]{0,120}tabular-nums|tabular-nums[\s\S]{0,120}formatCurrency\(order\.amount, order\.currency\)/);
  assert.match(list, /w-full min-w-0 sm:min-w-\[220px\]/);
  assert.match(list, /w-full rounded-full[\s\S]*?sm:w-\[148px\]/);
  assert.match(list, /px-4 py-4 sm:px-5/);
});

test('采购订单详情路由切换不会被旧请求覆盖，并分流不存在与可重试错误', () => {
  assert.match(detail, /const loadRequestRef = useRef\(0\)/);
  assert.match(detail, /const requestId = \+\+loadRequestRef\.current/);
  assert.match(detail, /setOrder\(null\)/);
  assert.match(detail, /const \[resolvedId, setResolvedId\] = useState\(''\)/);
  assert.match(detail, /if \(loading \|\| resolvedId !== decodedId\)/);
  assert.match(detail, /if \(requestId !== loadRequestRef\.current\) return/);
  assert.match(detail, /loadRequestRef\.current \+= 1/);
  assert.match(detail, /setNotFound\(\/(?:.|\n)*不存在(?:.|\n)*404/);
  assert.match(detail, /role=\{notFound \? 'status' : 'alert'\}/);
  assert.match(detail, /!notFound \? \([\s\S]*?loadOrder\(\)[\s\S]*?重新加载/);
});

test('详情不虚构商品明细，未同步时提供明确说明和恢复动作', () => {
  assert.doesNotMatch(detail, /buildFallbackItems|IMPORT-SUMMARY|导入汇总明细|未提供明细行/);
  assert.match(detail, /const items = order\?\.items \?\? \[\]/);
  assert.match(detail, /hasItemDetails \? \(/);
  assert.match(detail, /商品明细尚未同步/);
  assert.match(detail, /重新加载详情/);
  assert.match(detail, /hasItemDetails \? `\$\{fulfillment\}%` : '-'/);
});

test('详情表格和关联任务具备键盘焦点、访问名称与权限保护', () => {
  assert.match(detail, /aria-labelledby="purchase-order-lines-title"[\s\S]*?tabIndex=\{0\}/);
  assert.match(detail, /tabular-nums/);
  assert.match(detail, /usePermission\('page:proc-cockpit'\)/);
  assert.match(detail, /canOpenProcurementCockpit \? \(/);
  assert.match(detail, /打开关联采购任务 \{code\}/);
  assert.match(detail, /focus-visible:ring-2 focus-visible:ring-\[#002fa7\] focus-visible:ring-offset-2/);
  assert.match(detail, /无采购任务查看权限/);
});
