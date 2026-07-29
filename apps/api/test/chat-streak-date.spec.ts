import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayOrdinal, shanghaiDayKey } from '../src/modules/chat/chat-streak.service';

test('MateChat 每日边界固定使用上海自然日', () => {
  assert.equal(shanghaiDayKey(new Date('2026-07-28T15:59:59.000Z')), '2026-07-28');
  assert.equal(shanghaiDayKey(new Date('2026-07-28T16:00:00.000Z')), '2026-07-29');
});

test('相邻日期使用连续序号，日期进位时也不会重复轮换素材', () => {
  assert.equal(dayOrdinal('2026-07-10') - dayOrdinal('2026-07-09'), 1);
  assert.equal(dayOrdinal('2026-08-01') - dayOrdinal('2026-07-31'), 1);
});
