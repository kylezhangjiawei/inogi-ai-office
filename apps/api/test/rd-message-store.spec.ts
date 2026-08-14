// 站内消息从 SystemSetting['rd.messages'] 的 JSON 大数组迁到 RdMessage 表之后的行为锁定。
//
// 原先那组「并发写互相覆盖」的用例连同串行锁一起删了 —— 行级 INSERT 天然不存在读改写竞态。
// 这里锁的是表化引入的新风险：
//   ① 落列的 recipientNameKey / type / taskId 必须与服务层解析口径一致，
//      且 recipientNameKey 必须与迁移 SQL 里的 pg_rd_msg_name_key 等价（回填靠它对上号）；
//   ② 收件人 where 条件不能在「三标识全空」时退化成匹配全部消息；
//   ③ 返回给前端的字段名仍是 rdApi.ts 里那套 snake_case 契约。
import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

type Call = { method: string; args: any };

/** 只记录 Prisma 调用、不连库的服务桩。 */
function makeService(rows: any[] = []) {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  const calls: Call[] = [];
  service.prisma = {
    rdMessage: {
      create: async ({ data }: any) => {
        calls.push({ method: 'create', args: data });
        return { meta: null, ...data };
      },
      createMany: async ({ data }: any) => {
        calls.push({ method: 'createMany', args: data });
        return { count: data.length };
      },
      findMany: async (args: any) => {
        calls.push({ method: 'findMany', args });
        return rows;
      },
      findUnique: async (args: any) => {
        calls.push({ method: 'findUnique', args });
        return rows.find((r) => r.id === args.where.id) ?? null;
      },
      update: async ({ where, data }: any) => {
        calls.push({ method: 'update', args: { where, data } });
        return { ...rows.find((r) => r.id === where.id), ...data };
      },
      updateMany: async (args: any) => {
        calls.push({ method: 'updateMany', args });
        return { count: args.where.id.in.length };
      },
    },
  };
  return { service, calls };
}

const payload = (over: Record<string, unknown> = {}) => ({
  sender: { id: null, name: '系统通知', role: 'system' },
  recipient_id: 'user-1',
  subject: '主题',
  body: '正文',
  ...over,
});

test('扇出 N 个收件人只发一条 createMany', async () => {
  const { service, calls } = makeService();

  const created = await service.createMessages(
    Array.from({ length: 12 }, (_, i) => payload({ recipient_id: `user-${i}` })),
  );

  const writes = calls.filter((c) => c.method === 'createMany' || c.method === 'create');
  assert.equal(writes.length, 1, '12 个收件人只应产生 1 次写入调用');
  assert.equal(writes[0].method, 'createMany');
  assert.equal(writes[0].args.length, 12);
  assert.equal(created.length, 12);
  assert.equal(new Set(created.map((m: any) => m.id)).size, 12, '同批消息 id 不能相撞');
});

test('空收件人列表不发起任何写入', async () => {
  const { service, calls } = makeService();
  await service.createMessages([]);
  assert.equal(calls.length, 0);
});

test('结构化 body 的 type / task_id 落列，纯文本 body 留空', async () => {
  const { service } = makeService();

  const structured = service.buildMessageRecord(
    payload({ body: JSON.stringify({ type: 'review_request', task_id: 'task-9', review_type: 'proposal' }) }),
  );
  assert.equal(structured.type, 'review_request');
  assert.equal(structured.taskId, 'task-9');

  const plain = service.buildMessageRecord(payload({ body: '普通文本通知' }));
  assert.equal(plain.type, null);
  assert.equal(plain.taskId, null);

  // 以 { 开头但不是合法 JSON：不能让解析异常冒出来
  const broken = service.buildMessageRecord(payload({ body: '{不是合法json' }));
  assert.equal(broken.type, null);
  assert.equal(broken.taskId, null);
});

// 迁移 SQL 的 pg_rd_msg_name_key 必须与这里逐例一致，否则历史「按姓名投递」的消息回填后对不上人。
// SQL 侧对应：regexp_replace(btrim(t),'[（(][^）)]*[）)]','','g') → lower() → regexp_replace(...,'\s','','g')
test('recipientNameKey 归一化：去括号后缀、转小写、去空白', async () => {
  const { service } = makeService();
  const keyOf = (name: string) => service.buildMessageRecord(payload({ recipient_id: null, recipient_name: name })).recipientNameKey;

  assert.equal(keyOf('张三'), '张三');
  assert.equal(keyOf('  张三  '), '张三');
  assert.equal(keyOf('张 三'), '张三');
  assert.equal(keyOf('张三（研发）'), '张三');
  assert.equal(keyOf('张三(RD)'), '张三');
  assert.equal(keyOf('Alice Wang'), 'alicewang');
  assert.equal(keyOf('ALICE'), 'alice');
});

test('三个收件人标识全空时不能匹配全部消息', async () => {
  const { service } = makeService();

  const empty = service.messageRecipientWhere({ userId: '', nameKey: '', personIds: new Set() });
  assert.deepEqual(empty, { id: { in: [] } }, '必须是恒假条件，绝不能是 {}（那等于匹配全表）');

  const full = service.messageRecipientWhere({
    userId: 'u1',
    nameKey: '张三',
    personIds: new Set(['p1', 'p2']),
  });
  assert.deepEqual(full, {
    OR: [
      { recipientId: 'u1' },
      { recipientPersonId: { in: ['p1', 'p2'] } },
      { recipientNameKey: '张三' },
    ],
  });
});

test('listMessages 返回前端契约的 snake_case 字段', async () => {
  const createdAt = new Date('2026-08-13T02:03:04.000Z');
  const { service } = makeService([
    {
      id: 'msg-1',
      senderId: null,
      senderName: '系统通知',
      senderRole: 'system',
      recipientId: 'user-1',
      recipientPersonId: null,
      recipientName: '张三',
      recipientNameKey: '张三',
      subject: '待审核',
      body: '正文',
      meta: null,
      type: null,
      taskId: null,
      source: 'rd',
      category: 'notice',
      read: false,
      handled: false,
      createdAt,
    },
  ]);

  const [message] = await service.listMessages({ limit: 10 }, { userId: 'user-1', hasFullAccess: true });

  assert.deepEqual(Object.keys(message).sort(), [
    'body', 'category', 'created_at', 'handled', 'id', 'read',
    'recipient_id', 'recipient_name', 'recipient_person_id',
    'sender_id', 'sender_name', 'sender_role', 'source', 'subject',
  ]);
  assert.equal(message.source, 'rd');
  assert.equal(message.category, 'notice');
  assert.equal(message.created_at, createdAt.toISOString());
  assert.equal(message.recipient_id, 'user-1');
  assert.ok(!('meta' in message), 'meta 为空时不应出现在返回里（与表化前一致）');
});

test('审核通知置为已处理：先按索引列缩候选，再按 review_type 精确匹配', async () => {
  const { service, calls } = makeService([
    { id: 'msg-a', body: JSON.stringify({ review_type: 'proposal' }) },
    { id: 'msg-b', body: JSON.stringify({ review_type: 'result' }) },
    { id: 'msg-c', body: '不是 json' },
  ]);

  await service.markReviewRequestMessagesHandledForTasks(new Set(['task-1']), 'proposal');

  const query = calls.find((c) => c.method === 'findMany')!;
  assert.deepEqual(
    query.args.where,
    { type: 'review_request', taskId: { in: ['task-1'] }, handled: false },
    '必须靠 (type, taskId, handled) 索引缩候选，而不是全表拉回来逐条 parse',
  );

  const write = calls.find((c) => c.method === 'updateMany')!;
  assert.deepEqual(write.args.where, { id: { in: ['msg-a'] } }, '只有 review_type 对得上的那条被置位');
  assert.deepEqual(write.args.data, { handled: true, read: true });
});

test('标已读只更新本条的标志位', async () => {
  const { service, calls } = makeService([
    {
      id: 'msg-1',
      recipientId: 'user-1',
      senderId: null,
      recipientName: null,
      read: false,
      handled: false,
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
    },
  ]);

  await service.patchMessage('msg-1', { read: true }, { userId: 'user-1', hasFullAccess: false });

  const write = calls.find((c) => c.method === 'update')!;
  assert.deepEqual(write.args, { where: { id: 'msg-1' }, data: { read: true } });
});

test('未读数走 count，不把消息拉回来数', async () => {
  const { service, calls } = makeService();
  service.prisma.rdMessage.count = async (args: any) => {
    calls.push({ method: 'count', args });
    return 7;
  };
  service.getMessageRecipientIdentity = async () => ({
    userId: 'user-1',
    nameKey: '张三',
    personIds: new Set<string>(),
  });

  const result = await service.countUnreadMessages({ recipient_id: 'user-1' }, { userId: 'user-1', hasFullAccess: true });

  assert.deepEqual(result, { unread: 7 });
  assert.equal(calls.filter((c) => c.method === 'findMany').length, 0, '不应有任何列表查询');
  const counted = calls.find((c) => c.method === 'count')!;
  assert.ok(
    counted.args.where.AND.some((c: any) => c.read === false && c.handled === false),
    '只数未读且未处理的',
  );
});

test('分页游标按 (createdAt, id) 复合比较，不会在同批扇出的边界上漏页', async () => {
  const { service, calls } = makeService();
  service.getMessageRecipientIdentity = async () => ({
    userId: 'user-1',
    nameKey: '',
    personIds: new Set<string>(),
  });

  await service.listMessages(
    {
      recipient_id: 'user-1',
      limit: 50,
      before_created_at: '2026-08-13T02:00:00.000Z',
      before_id: 'msg-x',
    },
    { userId: 'user-1', hasFullAccess: true },
  );

  const query = calls.find((c) => c.method === 'findMany')!;
  const cursor = query.args.where.AND.find((c: any) => Array.isArray(c.OR) && c.OR.some((o: any) => o.createdAt?.lt));
  assert.ok(cursor, '游标条件必须存在');
  assert.deepEqual(cursor.OR[1], {
    createdAt: new Date('2026-08-13T02:00:00.000Z'),
    id: { lt: 'msg-x' },
  }, '同一时间戳内要靠 id 继续往下走，只比时间会整批跳过或重复');
  assert.deepEqual(query.args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  assert.equal(query.args.take, 50);
});

test('非法游标时间被忽略，不会退化成空结果', async () => {
  const { service, calls } = makeService();
  service.getMessageRecipientIdentity = async () => ({
    userId: 'user-1',
    nameKey: '',
    personIds: new Set<string>(),
  });

  await service.listMessages(
    { recipient_id: 'user-1', before_created_at: '不是时间' },
    { userId: 'user-1', hasFullAccess: true },
  );

  const query = calls.find((c) => c.method === 'findMany')!;
  const hasCursor = query.args.where.AND.some((c: any) => Array.isArray(c.OR) && c.OR.some((o: any) => o.createdAt?.lt));
  assert.equal(hasCursor, false, '解析不出的游标应当直接忽略');
});

test('handled=false 下推到 SQL，顶栏拉几条就是几条待办', async () => {
  const { service, calls } = makeService();
  service.getMessageRecipientIdentity = async () => ({
    userId: 'user-1',
    nameKey: '',
    personIds: new Set<string>(),
  });

  await service.listMessages(
    { recipient_id: 'user-1', limit: 5, handled: false },
    { userId: 'user-1', hasFullAccess: true },
  );

  const query = calls.find((c) => c.method === 'findMany')!;
  assert.ok(query.args.where.AND.some((c: any) => c.handled === false));
  assert.equal(query.args.take, 5);
});

// 这条锁的是本轮最初那个问题：采购主管兼有研发权限，就被卷进研发审核通知。
test('审核通知收件人只认 rd-task:review-notify，不再认 rd-task:edit', async () => {
  const { service } = makeService();
  const users = [
    { id: 'u-super', name: '超管', role: { permissions: ['*'] } },
    // 真正的研发审核人
    { id: 'u-rd-admin', name: '研发管理员', role: { permissions: ['rd-task:review-notify', 'page:rd-task-management'] } },
    // 采购主管：兼有研发操作码与页面码，但没有接收审核通知的码
    { id: 'u-purchase', name: '采购主管', role: { permissions: ['rd-task:edit', 'page:rd-task-management'] } },
    // 有通知码但不属研发池（页面码是协同池的）
    { id: 'u-collab', name: '协同管理员', role: { permissions: ['rd-task:review-notify', 'page:us-collab-cockpit'] } },
    // 普通研发人员：默认角色持有 rd-task:edit，从前会收到全部审核通知
    { id: 'u-member', name: '研发人员', role: { permissions: ['rd-task:edit', 'page:rd-my-workspace'] } },
  ];
  service.prisma.user = { findMany: async () => users };

  const recipients = await service.getUsersWithAnyPermission(['rd-task:review-notify']);
  const ids = recipients.map((r: any) => r.id).sort();

  assert.deepEqual(ids, ['u-rd-admin', 'u-super'], '只有超管和持通知码的研发池成员收到');
  assert.ok(!ids.includes('u-purchase'), '采购主管不再收到研发审核通知');
  assert.ok(!ids.includes('u-member'), 'rd-task:edit 不再等同于「该收通知」');
  assert.ok(!ids.includes('u-collab'), '协同池成员不进研发池的收件人（页面码定池未变）');
});

// 迁移 20260813190000 的回填 CASE 是这张映射表的镜像，两处必须一致，
// 否则历史消息归在「待办」、同类新消息归在「通知」。
test('分类由消息类型派生，未知类型归为通知', async () => {
  const { service } = makeService();
  const categoryOf = (body: string) => service.buildMessageRecord(payload({ body })).category;
  const structured = (type: string) => JSON.stringify({ type, task_id: 't' });

  assert.equal(categoryOf(structured('review_request')), 'todo');
  assert.equal(categoryOf(structured('perf_self_assessment')), 'todo');
  assert.equal(categoryOf(structured('review_result')), 'result');
  assert.equal(categoryOf(structured('procurement_review_result')), 'result');
  assert.equal(categoryOf(structured('discussion_mention')), 'mention');
  assert.equal(categoryOf(structured('某种以后才有的新类型')), 'notice');
  assert.equal(categoryOf('纯文本通知'), 'notice', '无结构化 type 的消息归为通知');
});

test('来源：调用方自报优先，未报则按当前工作区', async () => {
  const { service } = makeService();

  assert.equal(service.buildMessageRecord(payload({ source: 'procurement' })).source, 'procurement');
  assert.equal(service.buildMessageRecord(payload()).source, 'rd', '默认工作区即研发池');
});

test('来源/分类筛选下推到 SQL，空数组视为不筛', async () => {
  const { service, calls } = makeService();
  service.getMessageRecipientIdentity = async () => ({ userId: 'u1', nameKey: '', personIds: new Set<string>() });

  await service.listMessages(
    { recipient_id: 'u1', source: ['procurement', 'video'], category: ['todo'] },
    { userId: 'u1', hasFullAccess: true },
  );
  const withFilter = calls.find((c) => c.method === 'findMany')!;
  assert.ok(withFilter.args.where.AND.some((c: any) => c.source?.in?.join() === 'procurement,video'));
  assert.ok(withFilter.args.where.AND.some((c: any) => c.category?.in?.join() === 'todo'));

  calls.length = 0;
  await service.listMessages(
    { recipient_id: 'u1', source: [], category: [] },
    { userId: 'u1', hasFullAccess: true },
  );
  const noFilter = calls.find((c) => c.method === 'findMany')!;
  assert.ok(
    !noFilter.args.where.AND.some((c: any) => c.source || c.category),
    '空数组绝不能下推成 in: []，那会一条都查不出来',
  );
});

test('无权修改他人消息', async () => {
  const { service } = makeService([
    { id: 'msg-1', recipientId: 'user-1', senderId: null, recipientName: null },
  ]);
  service.listIdentityUsers = async () => [];

  await assert.rejects(
    () => service.patchMessage('msg-1', { read: true }, { userId: 'user-2', hasFullAccess: false }),
    /无权修改此消息/,
  );
});
