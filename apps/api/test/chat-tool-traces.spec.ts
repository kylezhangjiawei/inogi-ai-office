import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatService } from '../src/modules/chat/chat.service';
import { fakeChatState } from './helpers/chat-state.fake';

test('不同实例同时保存工具记忆，不丢不同会话和同一会话的追加记录', async () => {
  const db = fakeChatState();
  const create = () => new ChatService(db as never, undefined as never, { get: () => undefined } as never,
    undefined as never, undefined as never, undefined as never, undefined as never,
    undefined as never, undefined as never, undefined as never, undefined as never) as any;
  const first = create();
  const second = create();
  const trace = (content: string) => [{ tool: 'query_tasks', args: '{}', content, at: new Date().toISOString() }];
  await Promise.all([
    first.appendToolTraces('A', trace('A1')),
    second.appendToolTraces('B', trace('B1')),
    second.appendToolTraces('A', trace('A2')),
  ]);
  const saved = db.settings.get('chat.toolTraces');
  assert.deepEqual(saved.A.entries.map((entry: any) => entry.content), ['A1', 'A2']);
  assert.equal(saved.B.entries[0].content, 'B1');
  assert.equal(db.activeTransactions(), 0);
});

test('工具记忆仍保留每会话最近八条和全局三百个会话', async () => {
  const db = fakeChatState();
  db.settings.set('chat.toolTraces', Object.fromEntries(Array.from({ length: 300 }, (_, i) => [
    `old-${i}`, { updatedAt: '2020-01-01', entries: [] },
  ])));
  const service = Object.create(ChatService.prototype) as any;
  service.prisma = db;
  await service.appendToolTraces('new', Array.from({ length: 10 }, (_, i) => ({
    tool: 'query_tasks', args: '{}', content: String(i), at: new Date().toISOString(),
  })));
  const saved = db.settings.get('chat.toolTraces');
  assert.equal(Object.keys(saved).length, 300);
  assert.equal(saved.new.entries.length, 8);
  assert.equal(saved.new.entries[0].content, '2');
});
