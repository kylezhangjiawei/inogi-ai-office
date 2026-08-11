import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clipToolText,
  extractThought,
  finalizeToolCalls,
  mergeToolCallDeltas,
  shouldMountTools,
  THOUGHT_CHARS,
  THOUGHT_PARAM,
  TOOL_STEP_ARGS_CHARS,
  TOOL_STEP_OUTPUT_CHARS,
  type PendingToolCall,
} from '../src/modules/chat/react-loop';

/**
 * MateChat ReAct 循环的收敛保证与流式 tool_calls 归并。
 * 这两处坏掉都不会报错——只会表现为模型无限续调工具（烧钱）或工具参数被截断成坏 JSON，
 * 且只在线上暴露，故用单测钉死边界。
 */

// ── 收敛保证：最后一轮必须摘掉工具 ────────────────────────────────────────────

test('循环最后一轮不再挂工具，强制模型收敛出文字回答', () => {
  const MAX = 5;
  const mounted = [0, 1, 2, 3, 4, 5].map((round) => shouldMountTools(round, MAX, true));
  // round 0..4 挂工具，round 5（第 MAX 轮）必须摘掉，否则模型可以无限续调
  assert.deepEqual(mounted, [true, true, true, true, true, false]);
});

test('未启用 Agent 时任何一轮都不挂工具', () => {
  for (const round of [0, 1, 4, 5]) {
    assert.equal(shouldMountTools(round, 5, false), false);
  }
});

// ── 流式 tool_calls 分片归并 ─────────────────────────────────────────────────

test('同一调用的多个分片按 index 归并出完整 name 与 arguments', () => {
  const pending: PendingToolCall[] = [];
  mergeToolCallDeltas(pending, [{ index: 0, id: 'call_a', function: { name: 'query_' } }]);
  mergeToolCallDeltas(pending, [{ index: 0, function: { name: 'tasks', arguments: '{"status":' } }]);
  mergeToolCallDeltas(pending, [{ index: 0, function: { arguments: '"overdue"}' } }]);

  assert.deepEqual(pending, [{ id: 'call_a', name: 'query_tasks', args: '{"status":"overdue"}' }]);
});

test('单轮多个工具按各自 index 独立累加，参数不串台', () => {
  const pending: PendingToolCall[] = [];
  mergeToolCallDeltas(pending, [
    { index: 0, id: 'a', function: { name: 'query_tasks', arguments: '{"a"' } },
    { index: 1, id: 'b', function: { name: 'query_members', arguments: '{"b"' } },
  ]);
  mergeToolCallDeltas(pending, [
    { index: 1, function: { arguments: ':2}' } },
    { index: 0, function: { arguments: ':1}' } },
  ]);

  assert.deepEqual(pending, [
    { id: 'a', name: 'query_tasks', args: '{"a":1}' },
    { id: 'b', name: 'query_members', args: '{"b":2}' },
  ]);
});

test('index 跳号时补空位，后到的分片仍落在正确下标', () => {
  const pending: PendingToolCall[] = [];
  mergeToolCallDeltas(pending, [{ index: 2, id: 'c', function: { name: 'generate_image' } }]);

  assert.equal(pending.length, 3);
  assert.deepEqual(pending[2], { id: 'c', name: 'generate_image', args: '' });
  // 补出来的空位没有 name，定型时会被丢弃，不会变成一次「未知工具」调用
  assert.deepEqual(finalizeToolCalls(pending, 5, 0), [{ id: 'c', name: 'generate_image', args: '' }]);
});

test('缺省 index 的分片追加到末尾', () => {
  const pending: PendingToolCall[] = [{ id: 'a', name: 'query_tasks', args: '' }];
  mergeToolCallDeltas(pending, [{ id: 'b', function: { name: 'query_members' } }]);

  assert.equal(pending.length, 2);
  assert.equal(pending[1].name, 'query_members');
});

test('坏 index 与空分片被丢弃，不炸数组', () => {
  const pending: PendingToolCall[] = [];
  mergeToolCallDeltas(pending, [{ index: -1, function: { name: 'x' } }]);
  mergeToolCallDeltas(pending, [{ index: 1.5, function: { name: 'y' } }]);
  mergeToolCallDeltas(pending, undefined);
  mergeToolCallDeltas(pending, null);

  assert.deepEqual(pending, []);
});

// ── 本轮工具调用定型 ─────────────────────────────────────────────────────────

test('只有分片没有名字的空位不进入执行列表', () => {
  const pending: PendingToolCall[] = [
    { id: 'a', name: '', args: '{}' },
    { id: 'b', name: 'query_tasks', args: '{}' },
  ];

  assert.deepEqual(finalizeToolCalls(pending, 5, 0), [{ id: 'b', name: 'query_tasks', args: '{}' }]);
});

test('单轮工具数超过上限时截断，防模型爆调', () => {
  const pending: PendingToolCall[] = Array.from({ length: 8 }, (_, i) => ({
    id: `id_${i}`,
    name: 'query_tasks',
    args: '{}',
  }));

  assert.equal(finalizeToolCalls(pending, 5, 0).length, 5);
});

test('上游没给 id 时补轮内稳定 id，保证 tool 消息能与调用配对', () => {
  const pending: PendingToolCall[] = [
    { id: '', name: 'query_tasks', args: '{}' },
    { id: '', name: 'query_members', args: '{}' },
  ];

  const resolved = finalizeToolCalls(pending, 5, 3);
  assert.deepEqual(resolved.map((c) => c.id), ['call_3_0', 'call_3_1']);
  // id 必须唯一：重复 id 会让两条 tool 消息挂到同一个调用上，模型看到的观察值错位
  assert.equal(new Set(resolved.map((c) => c.id)).size, resolved.length);
});

test('上游给了 id 就保留原 id', () => {
  const pending: PendingToolCall[] = [{ id: 'call_upstream', name: 'query_tasks', args: '{}' }];

  assert.equal(finalizeToolCalls(pending, 5, 0)[0].id, 'call_upstream');
});

// ── 步骤展开面板的文本截断 ───────────────────────────────────────────────────

test('短文本原样保留，两端空白去掉', () => {
  assert.equal(clipToolText('  {"status":"overdue"}  ', TOOL_STEP_ARGS_CHARS), '{"status":"overdue"}');
});

test('超长文本截断并带明确的省略标记，不能让人误以为结果就这么多', () => {
  const clipped = clipToolText('x'.repeat(TOOL_STEP_OUTPUT_CHARS + 500), TOOL_STEP_OUTPUT_CHARS);

  assert.ok(clipped!.startsWith('x'.repeat(TOOL_STEP_OUTPUT_CHARS)));
  assert.ok(clipped!.endsWith('…（已截断）'));
});

test('恰好等于上限时不截断', () => {
  const exact = 'y'.repeat(TOOL_STEP_ARGS_CHARS);

  assert.equal(clipToolText(exact, TOOL_STEP_ARGS_CHARS), exact);
});

test('空值返回 undefined，前端据此判断该步骤不可展开', () => {
  assert.equal(clipToolText('', 100), undefined);
  assert.equal(clipToolText('   ', 100), undefined);
  assert.equal(clipToolText(undefined, 100), undefined);
  assert.equal(clipToolText(null, 100), undefined);
});

// ── ReAct 的 Thought：由工具参数承载 ─────────────────────────────────────────

test('从调用参数里取出模型填写的调用理由', () => {
  const args = JSON.stringify({ [THOUGHT_PARAM]: '先查逾期任务，再按负责人归类', status: 'overdue' });

  assert.equal(extractThought(args), '先查逾期任务，再按负责人归类');
});

test('模型没填 thought 时返回 undefined，步骤条只是不显示理由，调用照常', () => {
  assert.equal(extractThought(JSON.stringify({ status: 'overdue' })), undefined);
  assert.equal(extractThought('{}'), undefined);
  assert.equal(extractThought(''), undefined);
  assert.equal(extractThought(undefined), undefined);
});

test('坏 JSON 不炸，安静降级为没有理由', () => {
  // 模型偶发输出残缺参数串；此时工具本身也会按空参执行，Thought 缺失不该额外报错
  assert.equal(extractThought('{"thought": "查一下'), undefined);
  assert.equal(extractThought('not json at all'), undefined);
});

test('thought 不是字符串或只有空白时忽略', () => {
  assert.equal(extractThought(JSON.stringify({ [THOUGHT_PARAM]: 123 })), undefined);
  assert.equal(extractThought(JSON.stringify({ [THOUGHT_PARAM]: '   ' })), undefined);
  assert.equal(extractThought(JSON.stringify({ [THOUGHT_PARAM]: null })), undefined);
});

test('超长的理由截断，防止模型把整段推理塞进步骤条', () => {
  const long = '很'.repeat(THOUGHT_CHARS + 50);
  const got = extractThought(JSON.stringify({ [THOUGHT_PARAM]: long }))!;

  assert.equal(got.length, THOUGHT_CHARS + 1);
  assert.ok(got.endsWith('…'));
});

test('参数是数组或 null 时不当对象解，返回 undefined', () => {
  assert.equal(extractThought('[1,2,3]'), undefined);
  assert.equal(extractThought('null'), undefined);
});
