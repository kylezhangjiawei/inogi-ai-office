import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const workbench = source('src/app/order-processing/pages/Workbench.tsx');

test('工作台只允许最新列表与邮箱请求提交结果，并提供原位重试', () => {
  assert.match(workbench, /const loadRequestIdRef = useRef\(0\)/);
  assert.match(workbench, /const mailboxRequestIdRef = useRef\(0\)/);
  assert.match(workbench, /const requestId = \+\+loadRequestIdRef\.current/);
  assert.match(workbench, /if \(requestId !== loadRequestIdRef\.current\) return/);
  assert.match(workbench, /const requestId = \+\+mailboxRequestIdRef\.current/);
  assert.match(workbench, /if \(requestId !== mailboxRequestIdRef\.current\) return/);
  assert.match(workbench, /const \[workbenchError, setWorkbenchError\] = useState\(''\)/);
  assert.match(workbench, /const \[mailboxError, setMailboxError\] = useState\(''\)/);
  assert.match(workbench, /onClick=\{\(\) => void loadWorkbench\(\)\}/);
  assert.match(workbench, /onClick=\{\(\) => void loadMailboxes\(\)\}/);
});

test('工作台搜索节流并将来源、查询和选中订单同步到地址栏', () => {
  assert.match(workbench, /useSearchParams\(\)/);
  assert.match(workbench, /window\.setTimeout\(\(\) => setDebouncedOrderSearch\(orderSearch\.trim\(\)\), 250\)/);
  assert.match(workbench, /const next = new URLSearchParams\(current\)/);
  assert.match(workbench, /next\.set\('q', debouncedOrderSearch\)/);
  assert.match(workbench, /next\.set\('source', activeTab\)/);
  assert.match(workbench, /next\.set\('order', selectedOrderId\)/);
  assert.match(workbench, /\{ replace: true \}/);
});

test('上传、发票生成与导出使用即时锁防止快速重复提交', () => {
  for (const lock of ['uploadLockRef', 'invoiceSubmitLockRef', 'invoiceExportLockRef']) {
    assert.match(workbench, new RegExp(`const ${lock} = useRef\\(false\\)`));
    assert.match(workbench, new RegExp(`${lock}\\.current = true`));
    assert.match(workbench, new RegExp(`${lock}\\.current = false`));
  }
  assert.match(workbench, /if \(uploadLockRef\.current\) return/);
  assert.match(workbench, /if \(!orderId \|\| invoiceSubmitLockRef\.current\) return/);
  assert.match(workbench, /if \(!orderId \|\| invoiceExportLockRef\.current\) return/);
});

test('标准弹层负责焦点、遮罩与忙碌态保护', () => {
  assert.match(workbench, /function WorkbenchDialogSurface\(/);
  assert.match(workbench, /<DialogContent[\s\S]*?onEscapeKeyDown=/);
  assert.match(workbench, /onInteractOutside=/);
  assert.match(workbench, /onCloseAutoFocus=/);
  assert.match(workbench, /const modalReturnFocusRef = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(workbench, /modalReturnFocusRef\.current = trigger/);
  assert.match(workbench, /target\.focus\(\)/);
  assert.match(workbench, /<DialogTitle className="sr-only">/);
  assert.match(workbench, /<DialogDescription className="sr-only">/);
  assert.doesNotMatch(workbench, /role="presentation"/);
  assert.doesNotMatch(workbench, /modalRef/);
});

test('发票小计始终由数量乘以单价派生并在提交前校验', () => {
  assert.match(workbench, /const subtotal = roundMoney\(product\.orderQty \* unitPrice\)/);
  assert.match(workbench, /const subtotal = roundMoney\(line\.quantity \* unitPrice\)/);
  assert.match(workbench, /subtotal: roundMoney\(line\.quantity \* line\.unitPrice\)/);
  assert.match(workbench, /showInvoiceValidationError\('customer'/);
  assert.match(workbench, /showInvoiceValidationError\('orderId'/);
  assert.match(workbench, /showInvoiceValidationError\('date'/);
  assert.match(workbench, /data-invoice-field=/);
  assert.doesNotMatch(workbench, /subtotalText/);
});

test('发票预览不再虚构企业、银行、付款或客户地址信息', () => {
  for (const unsafeCopy of [
    '110 Cedar Street',
    'Wellesley',
    'SWIFT',
    'DDP',
    'Payment Received',
    'Total Amount Due (100%)',
  ]) {
    assert.doesNotMatch(workbench, new RegExp(unsafeCopy, 'i'));
  }
  assert.match(workbench, /企业信息未配置/);
  assert.match(workbench, /未配置的企业、地址和收款信息不会出现在预览或导出文件中/);
});

test('AI 模板生成使用真实请求身份且关闭后不写回旧结果', () => {
  assert.match(workbench, /const aiRequestIdRef = useRef\(0\)/);
  assert.match(workbench, /const requestId = \+\+aiRequestIdRef\.current/);
  assert.match(workbench, /requestId !== aiRequestIdRef\.current \|\| activeModal !== 'aiTemplate'/);
  assert.match(workbench, /orderProcessingApi\.generateAiTemplate\(files\)/);
  assert.doesNotMatch(workbench, /simulateAiTemplateGeneration/);
});

test('工作台提供结构化状态、可访问控件和准确的识别结果术语', () => {
  assert.match(workbench, /aria-busy=\{loading \|\| loadingMoreOrders\}/);
  assert.match(workbench, /aria-label=\{t\('搜索订货单'\)\}/);
  assert.match(workbench, /aria-label=\{t\('选择企业微信邮箱'\)\}/);
  assert.match(workbench, /role=\{invoiceValidationError \? 'alert' : undefined\}/);
  assert.match(workbench, /关闭订货单识别结果窗口/);
  assert.doesNotMatch(workbench, /关闭原始订货单窗口/);
});
