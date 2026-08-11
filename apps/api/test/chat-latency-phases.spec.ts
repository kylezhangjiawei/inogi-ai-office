import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatAnalyticsService } from '../src/modules/chat/chat-analytics.service';

/**
 * 首答延迟的分段汇总。
 *
 * 总耗时（latencyMs）只能说明"慢"，分不出是检索慢、模型慢还是工具慢。分段口径必须能：
 * 一是兼容老埋点（没有 timings 字段的历史数据不能让整块统计崩掉或被算成 0），
 * 二是用 p50/p95 而不是均值——延迟分布长尾，均值会被少数极端样本带偏。
 *
 * summarizePhaseTimings 只读传入的 events，不碰任何注入的服务，故可直接构造。
 */
const ctor = ChatAnalyticsService as unknown as new (...args: unknown[]) => ChatAnalyticsService;
const svc = new ctor(undefined, undefined, undefined, undefined, undefined, undefined);

type Summarize = (events: Array<{ metadata: unknown }>) => Array<{
  key: string;
  label: string;
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
}>;

const summarize = (svc as unknown as { summarizePhaseTimings: Summarize }).summarizePhaseTimings.bind(svc);

const withTimings = (timings: Record<string, unknown>) => ({ metadata: { latencyMs: 1000, timings } });

test('按阶段汇总出 p50 / p95 与样本数', () => {
  const events = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => withTimings({ ragSearch: n * 100 }));

  const [rag] = summarize(events);
  assert.equal(rag.key, 'ragSearch');
  assert.equal(rag.label, '知识库检索');
  assert.equal(rag.samples, 10);
  assert.equal(rag.p50Ms, 500);
  assert.equal(rag.p95Ms, 1000);
});

test('没有 timings 的老埋点被跳过，不会被当成 0 拉低统计', () => {
  const events = [
    { metadata: { latencyMs: 3000 } },
    { metadata: { latencyMs: 3000, timings: { ragSearch: 800 } } },
  ];

  const [rag] = summarize(events);
  assert.equal(rag.samples, 1, '只应统计真正带 timings 的那条');
  assert.equal(rag.p50Ms, 800);
});

test('metadata 结构异常时不炸，安静跳过', () => {
  const events = [
    { metadata: null },
    { metadata: 'not an object' },
    { metadata: [1, 2, 3] },
    { metadata: { timings: 'nope' } },
    { metadata: { timings: [1, 2] } },
    withTimings({ ragSearch: 400 }),
  ];

  const [rag] = summarize(events);
  assert.equal(rag.samples, 1);
});

test('非数字或负数的阶段值被丢弃', () => {
  const events = [
    withTimings({ ragSearch: 'slow' }),
    withTimings({ ragSearch: -1 }),
    withTimings({ ragSearch: Number.NaN }),
    withTimings({ ragSearch: 600 }),
  ];

  const [rag] = summarize(events);
  assert.equal(rag.samples, 1);
  assert.equal(rag.p50Ms, 600);
});

test('只返回本次真的有样本的阶段，不出现一排空行', () => {
  const result = summarize([withTimings({ firstToken: 1200, tools: 300 })]);

  assert.deepEqual(result.map((p) => p.key), ['firstToken', 'tools']);
});

test('阶段顺序固定为执行顺序，方便顺着读出瓶颈', () => {
  const result = summarize([
    withTimings({ tools: 1, firstToken: 1, ragSearch: 1, dbSearch: 1, rewrite: 1, history: 1 }),
  ]);

  assert.deepEqual(result.map((p) => p.key), [
    'history',
    'rewrite',
    'dbSearch',
    'ragSearch',
    'firstToken',
    'tools',
  ]);
});

test('没有任何带 timings 的样本时返回空数组，前端据此不渲染该板块', () => {
  assert.deepEqual(summarize([{ metadata: { latencyMs: 900 } }]), []);
  assert.deepEqual(summarize([]), []);
});
