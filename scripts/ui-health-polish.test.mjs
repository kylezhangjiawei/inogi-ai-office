import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let fields;
before(async () => {
  server = await createServer({
    configFile: false, envFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false },
  });
  fields = await server.ssrLoadModule('/src/app/components/MaterialFields.tsx');
});
after(async () => { await server?.close(); });

test('shared date field preserves the native form contract behind its labelled calendar trigger', () => {
  const html = renderToStaticMarkup(React.createElement(fields.MaterialDateInput, {
    id: 'delivery-date', name: 'deliveryDate', label: '交货日期', hint: '按承诺交期填写',
    value: '2026-09-17', onChange() {}, required: true, min: '2026-09-10', max: '2026-09-20', step: 2,
  }));
  const trigger = html.match(/<button\b[^>]*id="delivery-date"[^>]*>/)?.[0];
  const native = html.match(/<input\b[^>]*type="date"[^>]*>/)?.[0];
  assert.ok(trigger, 'visible label targets the interactive project calendar');
  assert.match(trigger, /type="button"/);
  assert.match(trigger, /aria-required="true"/);
  assert.match(trigger, /aria-describedby="delivery-date-hint"/);
  assert.ok(native, 'native form validation and serialization remain available');
  for (const attribute of ['name="deliveryDate"', 'value="2026-09-17"', 'required=""', 'min="2026-09-10"', 'max="2026-09-20"', 'step="2"', 'tabindex="-1"', 'aria-hidden="true"']) assert.ok(native.includes(attribute), attribute);
});

for (const name of ['MaterialInput', 'MaterialTextarea', 'MaterialDateInput', 'MaterialSelect']) {
  test(`${name}: visible label and hint identify the actual field`, () => {
    const html = renderToStaticMarkup(React.createElement(fields[name], {
      label: '验收数量', hint: '按实收数量填写',
      ...(name === 'MaterialSelect' ? { value: '', onValueChange() {}, options: [] } : {}),
    }));
    const label = html.match(/<label[^>]*for="([^"]+)"/);
    assert.ok(label, 'visible field label must be associated, not a decorative div');
    const control = html.match(/<(?:input|textarea|button)\b[^>]*>/g)
      ?.find(tag => tag.includes(`id="${label[1]}"`));
    assert.ok(control, 'label target must be the focusable field');
    const description = control.match(/aria-describedby="([^"]+)"/);
    assert.ok(description, 'field must expose its hint');
    assert.ok(html.includes(`id="${description[1]}"`));
  });
}

test('caller-provided field IDs and error descriptions are preserved', () => {
  const html = renderToStaticMarkup(React.createElement(fields.MaterialInput, {
    id: 'quantity', label: '实收', hint: '单位：件', 'aria-describedby': 'quantity-error', 'aria-invalid': true,
  }));
  assert.match(html, /<label[^>]*for="quantity"/);
  const input = html.match(/<input\b[^>]*>/)[0];
  assert.match(input, /aria-invalid="true"/);
  const descriptions = input.match(/aria-describedby="([^"]+)"/)[1].split(' ');
  assert.ok(descriptions.includes('quantity-error'));
  assert.equal(descriptions.length, 2, 'keep existing error and append hint');
});

test('navigation first visit opens only the current group, saved choices win after navigation', async () => {
  const { initialCollapsedGroups } = await server.ssrLoadModule('/src/app/lib/navigationGroupState.ts');
  const labels = ['供应链', '订单与库存', '研发'];
  assert.deepEqual([...initialCollapsedGroups(labels, '研发', null)], ['供应链', '订单与库存']);
  assert.deepEqual([...initialCollapsedGroups(labels, '供应链', '["研发"]')], ['研发']);
  assert.deepEqual([...initialCollapsedGroups(labels, '研发', '[]')], []);
  assert.deepEqual([...initialCollapsedGroups(labels, '研发', 'broken')], ['供应链', '订单与库存']);
  assert.deepEqual([...initialCollapsedGroups(labels, '研发', '[3,"旧模块","订单与库存"]')], ['订单与库存']);
});

test('order selection states distinguish an error, a loading queue, an empty source and a pending selection', async () => {
  const { OrderSelectionState } = await server.ssrLoadModule('/src/app/order-processing/components/OrderSelectionState.tsx');
  for (const [props, expected] of [
    [{ failed: true }, '订单读取失败'],
    [{ loading: true }, '正在加载订单'],
    [{ hasOrders: true }, '选择一张订货单'],
    [{ filtered: true }, '没有匹配的订货单'],
    [{ source: 'upload' }, '当前来源没有订货单'],
    [{ source: 'wecom_mail' }, '当前来源没有订货单'],
  ]) {
    const html = renderToStaticMarkup(React.createElement(OrderSelectionState, props));
    assert.ok(html.includes(expected));
    assert.ok(!html.includes('¥0.00'), 'unselected orders never imply a real zero amount');
    assert.ok(!html.includes('<input'), 'unselected orders do not display empty customer fields');
  }
});
