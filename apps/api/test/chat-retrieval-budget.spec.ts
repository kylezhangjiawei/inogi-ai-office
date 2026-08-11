import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { withTimeout } from '../src/modules/chat/chat.service';

/**
 * 首答前的检索预算。RAG / 结构化检索都挡在模型调用之前，没有上限就会把第一个字一起拖住
 * （线上出现过 embedding 上游抽风、ragService.search 卡 33 秒的情况）。
 * 超时只放弃这一路的预取，模型仍可用 search_knowledge 工具按需检索，故快速降级是安全的。
 */

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('任务在预算内完成时返回真实结果，不受兜底值影响', async () => {
  const result = await withTimeout(tick(10).then(() => 'real'), 200, 'fallback');

  assert.equal(result, 'real');
});

test('任务超出预算时返回兜底值，调用方不再等待', async () => {
  const startedAt = Date.now();
  const result = await withTimeout(tick(5000).then(() => 'real'), 60, 'fallback');

  assert.equal(result, 'fallback');
  // 关键是「没等满 5 秒」，而不是精确耗时；放宽到 1 秒避免 CI 抖动误报
  assert.ok(Date.now() - startedAt < 1000, '超时后必须立即返回，不能等原任务');
});

test('超时时触发回调，供日志记录是哪一路降级了', async () => {
  let notified = 0;
  await withTimeout(tick(5000), 40, undefined, () => { notified += 1; });

  assert.equal(notified, 1);
});

test('按时完成时不触发超时回调，不产生假降级日志', async () => {
  let notified = 0;
  await withTimeout(tick(10), 300, undefined, () => { notified += 1; });
  await tick(400); // 等过原本的超时点，确认定时器已被清掉

  assert.equal(notified, 0);
});

test('任务已被上游 catch 成兜底值时原样透传，不当成超时', async () => {
  // 检索失败走的是各自的 .catch，返回空结果；withTimeout 不该再改写它
  const empty = { results: [], filteredByPermission: 0 };
  const result = await withTimeout(Promise.resolve(empty), 200, { results: ['x'], filteredByPermission: 9 });

  assert.deepEqual(result, empty);
});
