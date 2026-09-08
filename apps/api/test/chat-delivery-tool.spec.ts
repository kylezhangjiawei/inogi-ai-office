import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatToolsService } from '../src/modules/chat/chat-tools.service';

const user = { userId: 'u1', name: '测试用户', permissions: ['*'] };
function tool(create?: (...args: unknown[]) => Promise<unknown>) {
  const service = new ChatToolsService({} as never, undefined as never, undefined as never,
    undefined as never, undefined as never, undefined as never, undefined,
    create ? { create } as never : undefined);
  return (service as unknown as { tools: Record<string, { execute: (...args: unknown[]) => Promise<Record<string, unknown>> }> }).tools.check_delivery_documents;
}

test('delivery tool returns a trusted task binding and the server conversation scope', async () => {
  let actual: unknown[] = [];
  const result = await tool(async (...args) => {
    actual = args;
    return { id: 'check1', taskId: 'RD-001', taskTitle: '任务一', checkedAt: '2026-09-08T00:00:00Z',
      summary: { candidate: 1, missing: 1 }, scopeNote: '仅元数据候选', warnings: [],
      rows: [{ title: '测试报告', required: true, status: 'candidate', candidateCount: 1, candidates: [{ name: '测试报告.pdf', objectKey: 'secret-key' }] }] };
  }).execute({ task_id: 'RD-001', conversationId: 'forged' }, user, 'server-conversation', {});
  assert.equal(actual[2], 'server-conversation');
  assert.equal(result.deliveryCheckId, 'check1');
  assert.deepEqual((result.pageContext as { refs: unknown }).refs, [{ entityType: 'rd_task', entityId: 'RD-001', workspace: 'rd' }]);
  assert.match(String(result.content), /待核|核对/);
  assert.doesNotMatch(String(result.content), /secret-key/);
});

test('delivery tool rejects a conflicting task before any checklist is created', async () => {
  let called = false;
  await assert.rejects(tool(async () => { called = true; return {}; }).execute(
    { task_id: 'RD-OTHER' }, user, 'conv', { pageContextTaskId: 'RD-001' },
  ), /当前关联任务不同/);
  assert.equal(called, false);
});

test('delivery tool cannot report success when its service is unavailable', async () => {
  await assert.rejects(tool().execute({ task_id: 'RD-001' }, user, 'conv', {}), /服务不可用/);
});

test('pending cards do not expose page facts after resource access is lost', async () => {
  let listed = false;
  const ref = { schemaVersion: 1, pageKey: 'rd_task_detail', scope: 'entity', refs: [{ entityType: 'rd_task', entityId: 'RD-001', workspace: 'rd' }], capturedAt: '2026-09-08T00:00:00Z' };
  const prisma = { chatMessage: { findMany: async () => [{ pageContext: ref }] },
    chatPendingAction: { findMany: async () => { listed = true; return []; } } };
  const service = new ChatToolsService(prisma as never, undefined as never, undefined as never,
    undefined as never, undefined as never, undefined as never, undefined, undefined,
    { resolve: async () => ({ status: 'unavailable' }) } as never);
  assert.deepEqual(await service.listConversationPendingActions('conv', user), []);
  assert.equal(listed, false);
});
