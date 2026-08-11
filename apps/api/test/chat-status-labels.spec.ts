import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_STATUS_LABELS, resolveStatusLabelsFromSlot } from '../src/modules/chat/chat.service';

/**
 * 等待期阶段提示的运营配置解析。
 *
 * 这段文案在上游首字慢到几十秒时是用户唯一能看到的反馈，所以任何解析异常都必须回退到
 * 内置默认，绝不能显示空串——空串比中文更糟，用户会以为界面卡死了。
 */

test('未配置时使用内置默认', () => {
  assert.deepEqual(resolveStatusLabelsFromSlot(undefined), DEFAULT_STATUS_LABELS);
  assert.deepEqual(resolveStatusLabelsFromSlot(null), DEFAULT_STATUS_LABELS);
  assert.deepEqual(resolveStatusLabelsFromSlot({}), DEFAULT_STATUS_LABELS);
});

test('关闭模式（off）忽略已填的列表，用内置默认', () => {
  const result = resolveStatusLabelsFromSlot({ mode: 'off', staticList: ['甲', '乙', '丙', '丁'] });

  assert.deepEqual(result, DEFAULT_STATUS_LABELS);
});

test('固定模式下按顺序覆盖四条文案', () => {
  const result = resolveStatusLabelsFromSlot({
    mode: 'static',
    staticList: ['读题中', '翻资料中', '琢磨中', '收尾中'],
  });

  assert.deepEqual(result, {
    understanding: '读题中',
    retrieving: '翻资料中',
    thinking: '琢磨中',
    organizing: '收尾中',
  });
});

test('只填前两条时，后两条仍用内置默认，不会变成空串', () => {
  const result = resolveStatusLabelsFromSlot({ mode: 'static', staticList: ['读题中', '翻资料中'] });

  assert.equal(result.understanding, '读题中');
  assert.equal(result.retrieving, '翻资料中');
  assert.equal(result.thinking, DEFAULT_STATUS_LABELS.thinking);
  assert.equal(result.organizing, DEFAULT_STATUS_LABELS.organizing);
});

test('空串与纯空白被当作未填，回退内置默认', () => {
  const result = resolveStatusLabelsFromSlot({ mode: 'static', staticList: ['', '   ', '琢磨中', ''] });

  assert.equal(result.understanding, DEFAULT_STATUS_LABELS.understanding);
  assert.equal(result.retrieving, DEFAULT_STATUS_LABELS.retrieving);
  assert.equal(result.thinking, '琢磨中');
  assert.equal(result.organizing, DEFAULT_STATUS_LABELS.organizing);
});

test('非字符串项被忽略，不会把数字或对象渲染给用户', () => {
  const result = resolveStatusLabelsFromSlot({ mode: 'static', staticList: [123, { a: 1 }, null, '收尾中'] });

  assert.equal(result.understanding, DEFAULT_STATUS_LABELS.understanding);
  assert.equal(result.retrieving, DEFAULT_STATUS_LABELS.retrieving);
  assert.equal(result.thinking, DEFAULT_STATUS_LABELS.thinking);
  assert.equal(result.organizing, '收尾中');
});

test('staticList 不是数组时整体回退，不炸', () => {
  assert.deepEqual(resolveStatusLabelsFromSlot({ mode: 'static', staticList: '甲乙丙丁' }), DEFAULT_STATUS_LABELS);
  assert.deepEqual(resolveStatusLabelsFromSlot({ mode: 'static' }), DEFAULT_STATUS_LABELS);
});

test('多填的条目被忽略，不影响四条口径', () => {
  const result = resolveStatusLabelsFromSlot({
    mode: 'static',
    staticList: ['甲', '乙', '丙', '丁', '戊', '己'],
  });

  assert.deepEqual(Object.keys(result), ['understanding', 'retrieving', 'thinking', 'organizing']);
  assert.equal(result.organizing, '丁');
});

test('内置默认本身不为空——它们是「中文即 key」的翻译键，空了英文也会跟着空', () => {
  for (const [key, value] of Object.entries(DEFAULT_STATUS_LABELS)) {
    assert.ok(value.trim().length > 0, `${key} 的内置默认不能为空`);
  }
});
