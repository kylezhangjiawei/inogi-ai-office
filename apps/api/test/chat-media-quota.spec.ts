import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatMediaQuota, ChatMediaQuotaExceeded } from '../src/modules/chat/chat-media-quota';
import { ChatToolsService } from '../src/modules/chat/chat-tools.service';
import { fakeChatState } from './helpers/chat-state.fake';

const user = { userId: 'u1', permissions: ['*'] };
const addUsage = (db: ReturnType<typeof fakeChatState>, refId: string | null, modality = 'image') =>
  db.usage.push({ userId: 'u1', modality, refId, createdAt: new Date() });

test('从 19/20 挂载的工具跨轮执行时重新校验，最多再生成一张', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = fakeChatState();
  for (let i = 0; i < 19; i++) addUsage(db, `old-${i}`);
  let calls = 0;
  const service = new ChatToolsService(
    { ...db, auditLog: { create: async () => ({}) } } as never, undefined as never, undefined as never,
    {
      listActiveImageModelConfigs: async () => [{ id: 'image', model: 'image' }],
      generate: async () => {
        const id = `new-${++calls}`;
        assert.equal(db.activeTransactions(), 0, '外部调用不持有数据库事务');
        addUsage(db, id);
        return { id, imageData: 'data:image/png;base64,eA==' };
      },
    } as never,
    undefined as never,
    { persist: async () => ({ fileId: 'file', name: 'image.png', mime: 'image/png', size: 1, objectKey: 'mock' }) } as never,
  );
  const mounted = await service.buildAgentTools(user);
  assert.ok(mounted.definitions.some((d) => d.type === 'function' && d.function.name === 'generate_image'));
  const results: Awaited<ReturnType<ChatToolsService['execute']>>[] = [];
  for (let i = 0; i < 3; i++) results.push(await service.execute('generate_image', '{"prompt":"test"}', user, 'conv'));
  assert.deepEqual(results.map((r) => r.ok), [true, false, false]);
  assert.equal(calls, 1);
  assert.equal(db.usage.length, 20);
  assert.equal((await service.buildAgentTools(user)).imageQuotaExhausted, true);
});

test('两个实例并发争抢最后一个额度，只允许一次调用；在途请求未计费也占额度', async () => {
  const db = fakeChatState();
  const first = new ChatMediaQuota(db as never);
  const second = new ChatMediaQuota(db as never);
  let calls = 0;
  const operation = async () => { calls++; return { id: `img-${calls}` }; };
  const results = await Promise.allSettled([
    first.run('u1', 'image', 1, operation), second.run('u1', 'image', 1, operation),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(calls, 1);
  assert.equal(await second.usage('u1', 'image'), 1);
});

test('用量异步入账前后不重复扣额度，其他来源的用量仍计入', async () => {
  const db = fakeChatState();
  const quota = new ChatMediaQuota(db as never);
  await quota.run('u1', 'image', 3, async () => ({ id: 'own-image' }));
  assert.equal(await quota.usage('u1', 'image'), 1);
  addUsage(db, 'own-image');
  assert.equal(await quota.usage('u1', 'image'), 1);
  addUsage(db, null);
  addUsage(db, 'studio-image');
  assert.equal(await quota.usage('u1', 'image'), 3);
  await assert.rejects(quota.run('u1', 'image', 3, async () => ({ id: 'blocked' })), ChatMediaQuotaExceeded);
});

test('调用仍在执行时不释放预占，明确失败后允许再试', async () => {
  const db = fakeChatState();
  const quota = new ChatMediaQuota(db as never);
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const running = quota.run('u1', 'image', 1, async () => { started(); await held; throw new Error('生成失败'); });
  const rejected = assert.rejects(running, /生成失败/);
  await begun;
  await assert.rejects(quota.run('u1', 'image', 1, async () => ({ id: 'blocked' })), ChatMediaQuotaExceeded);
  release();
  await rejected;
  await quota.run('u1', 'image', 1, async () => ({ id: 'retry' }));
  assert.equal(await quota.usage('u1', 'image'), 1);
});

test('昨日预占不占今天额度，不同用户和媒体类型互不影响', async () => {
  const db = fakeChatState();
  db.settings.set('chat.mediaQuota:image:u1', { day: '2000-01-01', entries: [{ id: 'old' }] });
  const quota = new ChatMediaQuota(db as never);
  await quota.run('u1', 'image', 1, async () => ({ id: 'today' }));
  await quota.run('u1', 'video', 1, async () => ({ id: 'video' }));
  await quota.run('u2', 'image', 1, async () => ({ id: 'other-user' }));
  assert.equal(await quota.usage('u1', 'image'), 1);
});

test('视频确认卡在确认时检查日额度，用完后不能提交旧卡', async () => {
  const db = fakeChatState();
  for (let i = 0; i < 5; i++) addUsage(db, `video-${i}`, 'video');
  let submitted = 0;
  const action: any = {
    id: 'video-card', userId: 'u1', conversationId: 'conv', messageId: 'message',
    tool: 'generate_video', payload: { mode: 't2v', prompt: 'test', duration: 5 }, card: {},
    status: 'pending', expiresAt: new Date(Date.now() + 60000),
  };
  const service = new ChatToolsService({
    ...db,
    chatPendingAction: {
      findUnique: async () => action,
      updateMany: async ({ data }: any) => { Object.assign(action, data); return { count: 1 }; },
    },
  } as never, undefined as never, undefined as never, undefined as never,
  { submit: async () => { submitted++; return { id: 'video' }; } } as never, undefined as never);
  await assert.rejects(service.confirmPendingAction('video-card', user), ChatMediaQuotaExceeded);
  assert.equal(submitted, 0);
  assert.equal(action.status, 'pending');
});

test('无法预占额度时不调用付费服务', async () => {
  const quota = new ChatMediaQuota({ $transaction: async () => { throw new Error('database unavailable'); } } as never);
  let called = false;
  await assert.rejects(quota.run('u1', 'image', 20, async () => { called = true; return { id: 'image' }; }), /database unavailable/);
  assert.equal(called, false);
});

test('已挂载的改图和免确认视频工具同样不能绕过日配额', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const db = fakeChatState();
  for (let i = 0; i < 20; i++) addUsage(db, `image-${i}`);
  for (let i = 0; i < 5; i++) addUsage(db, `video-${i}`, 'video');
  let paidCalls = 0;
  const service = new ChatToolsService(
    { ...db, auditLog: { create: async () => ({}) } } as never, undefined as never, undefined as never,
    {
      listActiveImageModelConfigs: async () => [{ id: 'model', model: 'gpt-image-1' }],
      editImage: async () => { paidCalls++; return { id: 'edited' }; },
    } as never,
    {
      evaluateGate: async () => ({ require_confirm: false, blocked: false, estimate_yuan: 1 }),
      submit: async () => { paidCalls++; return { id: 'video' }; },
    } as never,
    undefined as never,
  );
  assert.equal((await service.execute('edit_image', '{"image_id":"old","instruction":"edit"}', user, 'conv')).ok, false);
  assert.equal((await service.execute('generate_video', '{"mode":"t2v","prompt":"test"}', user, 'conv')).ok, false);
  assert.equal(paidCalls, 0);
});
