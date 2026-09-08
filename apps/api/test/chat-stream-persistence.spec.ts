import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { ChatService, DEFAULT_STATUS_LABELS } from '../src/modules/chat/chat.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(options: {
  beforeCreate?: () => Promise<void>;
  beforeUpdate?: () => Promise<void>;
  afterFirstChunk?: () => Promise<void>;
  toolRound?: boolean;
} = {}) {
  const userMessage = { id: 'question', role: 'user', content: '查任务', attachments: null, createdAt: new Date() };
  const rows: Array<Record<string, any>> = [];
  const events: Array<Record<string, any>> = [];
  let creates = 0;
  let updates = 0;
  let rounds = 0;
  const messages = {
    findFirst: async () => userMessage,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `answer-${++creates}`;
      const snapshot = structuredClone(data);
      if (creates === 1) await options.beforeCreate?.();
      const row = { id, ...snapshot };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const snapshot = structuredClone(data);
      if (++updates === 1) await options.beforeUpdate?.();
      const row = rows.find((r) => r.id === where.id);
      assert.ok(row);
      Object.assign(row, snapshot);
      return row;
    },
  };
  const tx = {
    chatMessage: messages,
    chatUsageEvent: { create: async () => ({}) },
    chatConversation: {
      findUnique: async () => ({ id: 'conv', userId: 'u1', messages: [userMessage] }),
      update: async () => ({}),
    },
  };
  const gateway = {
    stream: (request: any) => (async function* () {
      request.onTargetSettled(request.targets[0]);
      if (rounds++ === 0) {
        yield { choices: [{ delta: { content: 'A'.repeat(850) } }] };
        await options.afterFirstChunk?.();
        if (options.toolRound) {
          yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'query_tasks', arguments: '{}' } }] } }] };
          return;
        }
      }
      yield { choices: [{ delta: { content: ' final' }, finish_reason: 'stop' }] };
    })(),
  };
  const service = new ChatService(
    { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } as never,
    { recordSystemEvent: async () => ({}) } as never,
    { get: () => undefined } as never, {} as never,
    { search: async () => ({ results: [], filteredByPermission: 0 }) } as never,
    { normalizeStored: () => [], isImage: () => false, buildExternalImageUrls: () => [], signForDisplay: (value: unknown) => value } as never,
    { parse: () => null } as never,
    { search: async () => ({ summary: '', sources: [] }) } as never,
    {
      buildAgentTools: async () => ({ definitions: options.toolRound ? [{ type: 'function', function: { name: 'query_tasks', parameters: {} } }] : [], imageQuotaExhausted: false }),
      toolLabel: () => '查询任务',
      execute: async () => ({ ok: true, summary: '找到任务', content: '任务观察值' }),
    } as never,
    { record: () => undefined } as never,
    gateway as never,
  );
  Object.assign(service, {
    resolveStatusLabels: async () => DEFAULT_STATUS_LABELS,
    resolveModelConfig: async () => ({ id: 'model', provider: 'mock', model: 'gpt-4.1', usageKind: 'chat', apiKey: 'test-key' }),
    buildHistoryWithAttachments: async () => [], maybeRewriteQuery: async () => '查任务',
    searchDatabase: async () => '', readToolTraces: async () => '', buildUserPersonaBlock: () => '',
    appendToolTraces: async () => undefined,
  });
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    setHeader: () => undefined, flushHeaders: () => undefined,
    write: (line: string) => { events.push(JSON.parse(line.slice(6))); return true; },
    end: () => { response.writableEnded = true; response.emit('close'); },
  });
  return {
    rows, events, creates: () => creates,
    run: () => service.streamMessage('conv', { content: '查任务', clientMessageId: 'retry-id', model: 'model' }, { userId: 'u1', permissions: ['*'] }, response as never),
  };
}

test('快速回答定稿等待慢占位创建，只保存一个 assistant 消息', async () => {
  const started = deferred();
  const release = deferred();
  const h = harness({ beforeCreate: async () => { started.resolve(); await release.promise; } });
  const running = h.run();
  await started.promise;
  await nextTurn();
  const doneBeforeRelease = h.events.some((e) => e.type === 'done');
  release.resolve();
  await running;
  assert.equal(doneBeforeRelease, false);
  assert.equal(h.creates(), 1);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].content, 'A'.repeat(850) + ' final');
  assert.equal(h.events.find((e) => e.type === 'done')?.messageId, h.rows[0].id);
});

test('ReAct 开始工具轮次时复用正在创建的占位，步骤与正文归属同一消息', async () => {
  const started = deferred();
  const release = deferred();
  const h = harness({ toolRound: true, beforeCreate: async () => { started.resolve(); await release.promise; } });
  const running = h.run();
  await started.promise;
  await nextTurn();
  const createsBeforeRelease = h.creates();
  release.resolve();
  await running;
  assert.equal(createsBeforeRelease, 1);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].toolSteps.length, 1);
  assert.equal(h.rows[0].toolSteps[0].status, 'ok');
  assert.ok(h.rows[0].content.endsWith(' final'));
});

test('迟到的增量更新不会在 done 后覆盖最终正文', async () => {
  const started = deferred();
  const release = deferred();
  const h = harness({
    beforeUpdate: async () => { started.resolve(); await release.promise; },
    afterFirstChunk: () => started.promise,
  });
  const running = h.run();
  await started.promise;
  await nextTurn();
  const doneBeforeRelease = h.events.some((e) => e.type === 'done');
  release.resolve();
  await running;
  assert.equal(doneBeforeRelease, false);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].content, 'A'.repeat(850) + ' final');
});
