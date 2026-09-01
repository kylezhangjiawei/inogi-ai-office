import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const inventory = readFileSync(
  new URL('../src/app/order-processing/pages/Inventory.tsx', import.meta.url),
  'utf8',
);

test('库存列表只允许最新请求提交结果，并在失败后提供原位重试', () => {
  assert.match(inventory, /const requestId = \+\+listRequestRef\.current/);
  assert.match(inventory, /requestId !== listRequestRef\.current/);
  assert.match(inventory, /setListError\(error instanceof Error/);
  assert.match(inventory, /title=\{t\('库存加载失败'\)\}/);
  assert.match(inventory, /onClick=\{\(\) => void loadInventory\(\)\}/);
});

test('库存详情关闭或切换后会废弃旧请求，错误状态可重试', () => {
  assert.match(inventory, /const requestId = \+\+detailRequestRef\.current/);
  assert.match(inventory, /detailIdRef\.current !== itemId/);
  assert.match(inventory, /const closeDetail = \(\) => \{\s*detailRequestRef\.current \+= 1;/);
  assert.match(inventory, /if \(!open\) closeDetail\(\)/);
  assert.match(inventory, /t\('重新加载详情'\)/);
});

test('同步与导出使用同步锁阻止快速连击重复提交', () => {
  assert.match(inventory, /if \(syncingRef\.current\) return;/);
  assert.match(inventory, /if \(exportingRef\.current\) return;/);
  assert.match(inventory, /aria-busy=\{syncing\}/);
  assert.match(inventory, /aria-busy=\{exporting\}/);
  assert.match(inventory, /t\('重新同步'\)/);
  assert.match(inventory, /t\('重新导出'\)/);
});

test('筛选采用搜索表单并为分类、状态筛选提供可访问名称', () => {
  assert.match(inventory, /<form role="search" aria-label=\{t\('库存筛选'\)\}/);
  assert.match(inventory, /value=\{queryDraft\}/);
  assert.match(inventory, /type="submit"/);
  assert.match(inventory, /aria-label=\{t\('按库存分类筛选'\)\}/);
  assert.match(inventory, /aria-label=\{t\('按库存状态筛选'\)\}/);
  assert.match(inventory, /id="inventory-filter-summary" role="status" aria-live="polite"/);
});

test('库存页具备结构化加载、明确空态和窄屏布局', () => {
  assert.match(inventory, /LOADING_ROW_KEYS\.map/);
  assert.match(inventory, /t\('暂无匹配库存'\)/);
  assert.match(inventory, /px-3 py-3 sm:px-5 sm:py-4/);
  assert.match(inventory, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(inventory, /w-full rounded-full[\s\S]*?sm:w-\[170px\]/);
});

test('关联采购单使用独立状态语义，并受详情页权限控制', () => {
  assert.match(inventory, /function purchaseOrderStatusClass\(status: PurchaseOrderStatus\)/);
  assert.match(inventory, /purchaseOrderStatusClass\(order\.status\)/);
  assert.match(inventory, /usePermission\('page:purchase-order-detail'\)/);
  assert.match(inventory, /canViewPurchaseOrderDetail \? \(/);
  assert.match(inventory, /encodeURIComponent\(order\.id\)/);
  assert.doesNotMatch(
    inventory,
    /statusClass\(\s*order\.status === '已完成'/,
    '采购订单状态不应继续借用库存风险色阶',
  );
});

test('库存页面继续复用现有只读 API 契约', () => {
  assert.match(inventory, /orderProcessingApi\.getInventory\(/);
  assert.match(inventory, /orderProcessingApi\.getInventoryDetail\(itemId\)/);
  assert.match(inventory, /orderProcessingApi\.exportInventory\(/);
  assert.match(inventory, /syncTplusOperations\(\)/);
});
