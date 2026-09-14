import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { runInRdWorkspace } from '../src/modules/research-development/rd-workspace.context';
import { canReadRdTask, rdTaskReadViewer } from '../src/modules/research-development/rd-task-access';

const alice = { userId: 'alice', userName: '甲', hasFullAccess: false, canReadAll: false, enforceTaskScope: true };
const tree = [{ id: 'system', label: '系统', children: [{ id: 'part', label: '组件', tasks: [
  { task_id: 'hidden-parent', title: '他人父任务', primary_owner_user_id: 'bob', subtasks: [
    { task_id: 'mine', title: '我的子任务', primary_owner_user_id: 'alice', parent_task_id: 'hidden-parent', subtasks: [] },
    { task_id: 'hidden-sibling', title: '他人兄弟任务', primary_owner_user_id: 'bob', subtasks: [] },
  ] },
  { task_id: 'owned-parent', title: '我的父任务', primary_owner_user_id: 'alice', subtasks: [
    { task_id: 'hidden-child', title: '他人子任务', primary_owner_user_id: 'bob', subtasks: [] },
  ] },
] }] }];

function harness() {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.refreshProductionMirrorsIfNeeded = async () => {};
  service.readNormalizedTaskCategories = async () => structuredClone(tree);
  service.readMergedTaskCategories = async () => structuredClone(tree);
  service.readProductCategoryStore = async () => ({ other: [{ id: 'other', children: [{ tasks: [{ task_id: 'other-product', primary_owner_user_id: 'bob' }] }] }] });
  service.getProgressNoteMap = async () => ({
    mine: [{ id: 'mine-note', task_id: 'mine', actor: { id: 'bob' }, content: '可读协作进展', attachments: [] }],
    'hidden-sibling': [{ id: 'secret-note', task_id: 'hidden-sibling', actor: { id: 'alice' }, content: '已转走任务的旧进展', attachments: [] }],
  });
  service.readValue = async (key: string) => key === 'rd.taskCompletionScores'
    ? { mine: { total: 90, grade: 'A' }, 'hidden-sibling': { total: 70, grade: 'B' } } : {};
  service.decorateNotesWithPreview = (notes: unknown[]) => notes;
  service.taskAttachmentsMutable = () => false;
  service.findTaskAcrossStores = async (id: string) => {
    const walk = (tasks: any[]): any => tasks.flatMap((task) => [task, ...walk(task.subtasks ?? [])]);
    return walk(tree[0].children[0].tasks).find((task: any) => task.task_id === id) ?? null;
  };
  return service;
}

test('研发普通读取仅返回参与任务，隐藏父级提升可见子任务，隐藏兄弟与子任务不泄漏', async () => {
  const service = harness();
  const result = await service.getMergedTaskCategories({ viewer: alice });
  const tasks = result[0].children[0].tasks;
  assert.deepEqual(tasks.map((task: any) => task.task_id), ['mine', 'owned-parent']);
  assert.deepEqual(tasks[1].subtasks, []);
  assert.equal(tasks[0].parent_task_id, null);
  assert.equal(JSON.stringify(result).includes('hidden-sibling'), false);
  assert.equal(JSON.stringify(result).includes('hidden-parent'), false);
});

test('不同用户和管理范围不共享任务树缓存；协同和生产保留原有全树行为', async () => {
  const service = harness();
  await service.getMergedTaskCategories({ viewer: alice });
  const all = await service.getMergedTaskCategories({ viewer: { ...alice, canReadAll: true } });
  assert.equal(all[0].children[0].tasks[0].task_id, 'hidden-parent');
  const other = await service.getMergedTaskCategories({ viewer: { ...alice, userId: 'nobody', userName: '其他' } });
  assert.deepEqual(other, []);
  for (const workspace of ['us-collab', 'production']) {
    const result: any = await runInRdWorkspace(workspace, () => service.getMergedTaskCategories({ viewer: alice }));
    assert.equal(result[0].children[0].tasks[0].task_id, 'hidden-parent');
  }
});

test('研发任务组和全部进展仅包含参与任务；曾写备注不代表当前仍可读取', async () => {
  const service = harness();
  const group = await service.getTaskProgressNoteGroup('mine', alice);
  assert.equal(group.root_task_id, 'mine');
  assert.deepEqual(group.tasks.map((task: any) => task.task_id), ['mine']);
  assert.deepEqual(group.notes.map((note: any) => note.id), ['mine-note']);
  const all = await service.listAllTaskProgressNotes(alice);
  assert.deepEqual(Object.keys(all), ['mine']);
  await assert.rejects(() => service.getTaskProgressNotes('hidden-sibling', alice), /任务不存在|权限/);
  await assert.rejects(() => service.getTaskAttachments('hidden-sibling', alice), /任务不存在|权限/);
});

test('控制器在研发工作区传递个人范围，view-all 只获得读取权限', async () => {
  let options: any;
  const controller = new ResearchDevelopmentController({ getMergedTaskCategories: async (value: any) => { options = value; return []; } } as never, {} as never, {} as never);
  await (controller.mergedTaskCategories as any)(undefined, { user: { id: 'reader', name: '只读', permissions: ['page:rd-task-management', 'rd-task:view-all'] } });
  assert.equal(options.viewer.canReadAll, true);
  assert.equal(options.viewer.hasFullAccess, false);
  assert.equal(options.viewer.enforceTaskScope, true);
});

test('研发产品清单、单产品任务、统计均从同一可见任务范围计算', async () => {
  const service = harness();
  service.readValue = async () => [{ id: 'prod-portable-o2', name: '有参与任务的产品' }, { id: 'other', name: '他人产品' }];
  service.readProductTaskCategorySnapshot = async () => ({ categories: structuredClone(tree), needsWrite: false });
  service.readArray = async () => [];
  service.listIdentityUsers = async () => [];
  assert.deepEqual((await service.getProducts(alice)).map((p: any) => p.id), ['prod-portable-o2']);
  const tasks = await service.getProductTaskCategories('prod-portable-o2', alice);
  assert.deepEqual(tasks[0].children[0].tasks.map((task: any) => task.task_id), ['mine', 'owned-parent']);
  const dashboard = await service.getDirectorDashboard(alice);
  assert.equal(dashboard.categoryProgress.reduce((sum: number, row: any) => sum + row.total, 0), 2);
  assert.equal(JSON.stringify(dashboard).includes('hidden'), false);
});

test('技术资料权限辅助方法限制研发工作区、归档写入和只读跨任务权限', async () => {
  const service = harness();
  const owner = { userId: 'alice', userName: '甲', permissions: ['page:rd-my-workspace'] };
  await assert.doesNotReject(() => service.requireTaskDocumentWriteAccess('mine', owner));
  const reader = { userId: 'reader', permissions: ['rd-task:view-all'] };
  await assert.doesNotReject(() => service.requireTaskReadAccess('mine', reader));
  await assert.rejects(() => service.requireTaskDocumentWriteAccess('mine', reader), /只能维护/);
  await assert.doesNotReject(() => service.requireTaskDocumentWriteAccess('mine', { userId: 'manager', permissions: ['rd-project:review-l1'] }));
  await assert.rejects(() => service.requireTaskReadAccess('missing', owner), /不存在/);
  assert.deepEqual((await service.getTaskDocumentSourceNotes('mine', owner)).map((note: any) => note.id), ['mine-note']);
  for (const workspace of ['us-collab', 'production']) {
    await assert.rejects(() => runInRdWorkspace(workspace, () => service.requireTaskReadAccess('mine', owner)), /仅支持研发/);
  }
  service.findTaskAcrossStores = async () => ({ task_id: 'mine', primary_owner_user_id: 'alice', archived: true });
  await assert.doesNotReject(() => service.requireTaskReadAccess('mine', owner));
  await assert.rejects(() => service.requireTaskDocumentWriteAccess('mine', owner), /归档/);
  service.findTaskAcrossStores = async () => ({ task_id: 'mine', production_sync: { source_workspace: 'rd', source_task_id: 'mine', read_only: true } });
  await assert.rejects(() => service.requireTaskReadAccess('mine', reader), /不存在/);
});

test('授权严格按稳定账号 ID，历史未绑定姓名不能授予访问；协作人同样可读', () => {
  const viewer = rdTaskReadViewer({ userId: 'alice', userName: '同名（研发）', permissions: ['rd-task:edit'] });
  assert.equal(canReadRdTask({ primary_owner: '同名', primary_owner_user_id: 'bob' }, viewer), false);
  assert.equal(canReadRdTask({ primary_owner: '同名' }, viewer), false);
  assert.equal(canReadRdTask({ collaborators: [{ user_id: 'alice', name: '旧名' }] }, viewer), true);
  assert.equal(viewer.hasFullAccess, false);
});

test('只读跨任务权限可查看评分，但不会授予他人任务讨论的写入能力', async () => {
  const service = harness();
  const reader = { ...alice, userId: 'reader', canReadAll: true };
  assert.equal((await service.getTaskCompletionScores(['mine'], reader)).mine.total, 90);
  assert.equal((await service.getTaskCompletionScores(['hidden-sibling'], alice))['hidden-sibling'], null);
  const access = { task: { primary_owner_user_id: 'bob' }, scope: 'task', invitation: null };
  assert.equal(service.canPostToTaskDiscussion(access, { userId: 'reader', canAccessAny: true, canPost: true, enforceTaskScope: true }), false);
  assert.equal(service.canPostToTaskDiscussion(access, { userId: 'bob', canPost: true, enforceTaskScope: true }), true);
  assert.equal(service.canPostToTaskDiscussion(access, { userId: 'manager', canPost: true, canManageTasks: true, enforceTaskScope: true }), true);
});

test('严格任务审计包含参与任务的其他操作者，排除自己曾操作但已无权的任务', async () => {
  const service = harness();
  let where: any;
  service.prisma = { auditLog: { findMany: async (args: any) => {
    where = args.where;
    return [
      { id: 'allowed', resourceId: 'mine', userId: 'bob' },
      { id: 'denied', resourceId: 'hidden-sibling', userId: 'alice' },
    ].map((row) => ({ ...row, actorName: row.userId, resource: 'task', resourceName: '任务', action: 'task.updated', source: 'web', summary: null, meta: {}, notes: [], createdAt: new Date('2026-09-09') }));
  } } };
  const logs = await service.getAuditLogs(alice, { resourceType: 'task' });
  assert.deepEqual(logs.map((log: any) => log.id), ['allowed']);
  assert.deepEqual(where.OR[0].resourceId.in, ['mine', 'owned-parent']);
});

test('人员目录保留选人信息，但不携带不可读的任务标题和数量', async () => {
  const service = harness();
  service.peopleWriteLock = Promise.resolve();
  service.getPeopleUnlocked = async () => ({ people: [{ id: 'bob', user_id: 'bob', name: '乙', task_ids: ['hidden-sibling'], tasks: ['他人兄弟任务'], task_count: 1 }] });
  const people = await service.getPeople(alice);
  assert.equal(people[0].name, '乙');
  assert.deepEqual(people[0].task_ids, []);
  assert.deepEqual(people[0].tasks, []);
  assert.equal(people[0].task_count, 0);
});

test('技术资料登记提交完成前，原留痕附件变更必须等待；失败不会锁死后续登记', async () => {
  const service = harness();
  service.taskTreeWriteLock = Promise.resolve();
  service.progressNoteWriteLock = Promise.resolve();
  service.taskAttachmentsMutable = () => true;
  service.writeValue = async () => {};
  const events: string[] = [];
  let started!: () => void;
  const whenStarted = new Promise<void>((resolve) => { started = resolve; });
  let finish!: () => void;
  const whenFinished = new Promise<void>((resolve) => { finish = resolve; });
  const registration = service.withTaskDocumentWriteLock(async () => {
    events.push('registration-reading-source');
    started();
    await whenFinished;
    events.push('registration-committed');
  });
  await whenStarted;
  const replacement = service.mutateNoteAttachments({
    taskId: 'mine', noteId: 'mine-note', requesterUserId: 'alice',
    mutator: () => { events.push('attachment-replaced'); return { attachments: [], result: null }; },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['registration-reading-source']);
  finish();
  await Promise.all([registration, replacement]);
  assert.deepEqual(events, ['registration-reading-source', 'registration-committed', 'attachment-replaced']);
  await assert.rejects(() => service.withTaskDocumentWriteLock(async () => { throw new Error('transaction failed'); }), /transaction failed/);
  assert.equal(await service.withTaskDocumentWriteLock(async () => 'next registration'), 'next registration');
});
