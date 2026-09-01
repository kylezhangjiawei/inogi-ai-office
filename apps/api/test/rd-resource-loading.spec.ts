import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ChatToolsService } from '../src/modules/chat/chat-tools.service';
import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { currentRdWorkspace, runInRdWorkspace } from '../src/modules/research-development/rd-workspace.context';

test('消息读取与处理只要求登录，消息内容仍由服务层按当前用户隔离', () => {
  for (const handler of [
    ResearchDevelopmentController.prototype.countUnreadMessages,
    ResearchDevelopmentController.prototype.listMessages,
    ResearchDevelopmentController.prototype.patchMessage,
  ]) {
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, handler), []);
  }
});

test('转采购只能由任务参与人或研发管理员发起，并采用服务端任务标题', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.findTaskAcrossStores = async () => ({
    task_id: 'RD-001',
    title: '服务端研发任务',
    primary_owner: '研发甲',
    primary_owner_user_id: 'rd-1',
    collaborators: [{ name: '研发乙', user_id: 'rd-2' }],
  });

  const ownerResult = await service.requireProcurementTransferAccess('RD-001', {
    userId: 'rd-1',
    userName: '研发甲',
    permissions: ['proc-task:transfer'],
  });
  assert.deepEqual(ownerResult, {
    taskId: 'RD-001',
    title: '服务端研发任务',
    participantUserIds: ['rd-1', 'rd-2'],
    participantNames: ['研发甲', '研发乙'],
  });
  await assert.doesNotReject(() => service.requireProcurementTransferAccess('RD-001', {
    userId: 'rd-admin',
    userName: '研发管理员',
    permissions: ['proc-task:transfer', 'rd-people:manage'],
  }));
  await assert.rejects(
    () => service.requireProcurementTransferAccess('RD-001', {
      userId: 'rd-other',
      userName: '其他研发成员',
      permissions: ['proc-task:transfer'],
    }),
    /只能将自己主责或协作的研发任务转采购/,
  );
});

test('task creation endpoints accept proposal permission and pass a constrained actor policy', async () => {
  const createTaskPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ResearchDevelopmentController.prototype.createTask,
  ) as string[];
  const createSubtasksPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ResearchDevelopmentController.prototype.createSubtasks,
  ) as string[];
  const createTasksBatchPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ResearchDevelopmentController.prototype.createTasksBatch,
  ) as string[];
  assert.ok(createTaskPermissions.includes('rd-project:propose'));
  assert.ok(createSubtasksPermissions.includes('rd-project:propose'));
  assert.ok(createTasksBatchPermissions.includes('rd-project:propose'));
  const saveTreePermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ResearchDevelopmentController.prototype.saveTaskCategories,
  ) as string[];
  assert.equal(saveTreePermissions.includes('rd-task:edit'), false);
  assert.equal(saveTreePermissions.includes('rd-task:create'), false);
  assert.ok(saveTreePermissions.includes('rd-project:direct'));

  let receivedActor: Record<string, unknown> | undefined;
  let receivedBatchActor: Record<string, unknown> | undefined;
  let receivedUpdateOptions: Record<string, unknown> | undefined;
  const controller = new ResearchDevelopmentController(
    {
      createTasksBatch: async (
        _tasks: Record<string, unknown>[],
        _requestId: string,
        actor: Record<string, unknown>,
      ) => {
        receivedBatchActor = actor;
        return [];
      },
      createSubtasks: async (
        _parentTaskId: string,
        _tasks: Record<string, unknown>[],
        _requestId: string,
        actor: Record<string, unknown>,
      ) => {
        receivedActor = actor;
        return [];
      },
      updateTask: async (
        _taskId: string,
        _patch: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        receivedUpdateOptions = options;
        return { ok: true };
      },
    } as unknown as ResearchDevelopmentService,
    {} as never,
    {} as never,
  );
  await controller.createSubtasks(
    { parent_task_id: 'parent', request_id: 'request-1', tasks: [{ title: '子任务' }] },
    {
      user: {
        id: 'user-1',
        name: '研发成员',
        permissions: ['page:rd-my-workspace', 'rd-project:propose'],
      },
    },
  );
  assert.deepEqual(receivedActor, {
    requesterUserId: 'user-1',
    requesterName: '研发成员',
    canEditAny: false,
    proposalOnly: true,
  });
  await controller.createTasksBatch(
    { request_id: 'request-top-1', tasks: [{ title: '顶层任务' }] },
    {
      user: {
        id: 'user-1',
        name: '研发成员',
        permissions: ['page:rd-my-workspace', 'rd-project:propose'],
      },
    },
  );
  assert.deepEqual(receivedBatchActor, {
    requesterUserId: 'user-1',
    requesterName: '研发成员',
    canEditAny: false,
    proposalOnly: true,
  });
  await controller.updateTask(
    'task-1',
    { title: '普通编辑' },
    { user: { id: 'user-1', name: '研发成员', permissions: ['page:rd-my-workspace', 'rd-task:edit'] } },
  );
  assert.equal(receivedUpdateOptions?.canEditAny, false);
});

test('review action is fail-closed in both controller and service', async () => {
  let serviceCalls = 0;
  const controller = new ResearchDevelopmentController(
    {
      updateTask: async () => {
        serviceCalls += 1;
        return { ok: true };
      },
    } as unknown as ResearchDevelopmentService,
    {} as never,
    {} as never,
  );

  assert.throws(
    () => controller.updateTask(
      'task-1',
      { _review_action: 'approve_typo' },
      { user: { id: 'admin-1', name: '管理员', permissions: ['*'] } },
    ),
    (error: unknown) =>
      error instanceof Error
      && 'getStatus' in error
      && typeof error.getStatus === 'function'
      && error.getStatus() === 400,
  );
  assert.equal(serviceCalls, 0);

  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  await assert.rejects(
    () => service.updateTask('task-1', { _review_action: 'reject_typo' }, { canEditAny: true }),
    (error: unknown) =>
      error instanceof Error
      && 'getStatus' in error
      && typeof error.getStatus === 'function'
      && error.getStatus() === 400,
  );
});

test('AI settings endpoint requires and forwards the last loaded server version', async () => {
  let received: { settings?: Record<string, unknown>; baseUpdatedAt?: string } = {};
  const controller = new ResearchDevelopmentController(
    {
      saveAiSettings: async (settings: Record<string, unknown>, baseUpdatedAt: string) => {
        received = { settings, baseUpdatedAt };
        return { ...settings, updated_at: '2026-09-01T08:00:01.000Z' };
      },
    } as unknown as ResearchDevelopmentService,
    {} as never,
    {} as never,
  );

  const result = await controller.saveAiSettings({
    settings: { version: 2 },
    base_updated_at: '2026-09-01T08:00:00.000Z',
  });
  assert.deepEqual(received, {
    settings: { version: 2 },
    baseUpdatedAt: '2026-09-01T08:00:00.000Z',
  });
  assert.equal((result as Record<string, unknown>).updated_at, '2026-09-01T08:00:01.000Z');
  assert.throws(
    () => controller.saveAiSettings({ settings: { version: 3 } }),
    /缺少服务器版本基线/,
  );
});

test('AI settings CAS serializes concurrent saves and rejects the stale baseline without overwriting', async () => {
  let stored: Record<string, unknown> = {
    version: 1,
    updated_at: '2026-09-01T08:00:00.000Z',
  };
  let writes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.aiSettingsWriteLock = Promise.resolve();
  service.readValue = async () => structuredClone(stored);
  service.writeValue = async (_key: string, value: Record<string, unknown>) => {
    writes += 1;
    await Promise.resolve();
    stored = structuredClone(value);
    return value;
  };
  service.getAiSettings = async () => structuredClone(stored);

  const baseline = '2026-09-01T08:00:00.000Z';
  const settled = await Promise.allSettled([
    service.saveAiSettings({ version: 2 }, baseline),
    service.saveAiSettings({ version: 3 }, baseline),
  ]);

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult;
  assert.match(String(rejected.reason?.message ?? rejected.reason), /保存冲突/);
  assert.equal(writes, 1, 'only the first request using a shared baseline may write');
  assert.equal(stored.version, 2);
  assert.notEqual(stored.updated_at, baseline);
});

test('image gallery controls are excluded before the swipe surface captures a pointer', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../src/app/RDProgressEvidence.tsx'),
    'utf8',
  );
  const controlGuard = source.indexOf('event.target instanceof Element && event.target.closest("button, a")');
  const pointerCapture = source.indexOf('event.currentTarget.setPointerCapture(event.pointerId)');

  assert.ok(controlGuard >= 0, 'gallery pointer handling must ignore button and link controls');
  assert.ok(pointerCapture > controlGuard, 'interactive-control guard must run before pointer capture');
});

test('ordinary task edit permission cannot prepare a chat approval action', async () => {
  const service = Object.create(ChatToolsService.prototype) as any;
  const result = await service.prepareApproveTaskReview(
    {},
    { userId: 'member-1', permissions: ['rd-task:edit'] },
    'conversation-1',
  );
  assert.equal(result.ok, false);
  assert.equal(result.summary, '无审核权限');
});

test('proposal target endpoint can only append an empty structural container', async () => {
  const originalTask = { task_id: 'task-a', title: '保留任务', subtasks: [] };
  let saved: Array<Record<string, unknown>> | undefined;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  service.readTaskCategoriesForProduct = async () => [{
    id: 'existing-category',
    label: '已有分类',
    children: [{ id: 'existing-project', label: '已有项目', tasks: [originalTask] }],
  }];
  service.writeTaskCategoriesForProduct = async (_productId: string, categories: Array<Record<string, unknown>>) => {
    saved = categories;
  };

  const target = await service.ensureProposalTarget({
    productId: 'prod-portable-o2',
    categoryLabel: '新立项',
    subProjectLabel: '立项任务',
  });
  assert.ok(target.category_id.startsWith('rd-cat-'));
  assert.ok(target.sub_project_id.startsWith('rd-sub-'));
  assert.equal(((saved?.[0].children as any[])[0].tasks as any[])[0].task_id, 'task-a');
  const appended = saved?.find((category) => category.id === target.category_id);
  assert.deepEqual((appended?.children as any[])[0].tasks, []);

  saved = undefined;
  const existing = await service.ensureProposalTarget({
    productId: 'prod-portable-o2',
    categoryLabel: '已有分类',
    subProjectLabel: '立项任务',
  });
  assert.deepEqual(existing, { category_id: 'existing-category', sub_project_id: 'existing-project' });
  assert.equal(saved, undefined, 'an existing normalized target must not rewrite the task tree');
});

test('cockpit attachment previews batch reads once and returns only five lightweight items per task', async () => {
  const taskIds = ['task-a', 'task-b'];
  const attachments = Array.from({ length: 7 }, (_, index) => ({
    id: `attachment-${index}`,
    name: `image-${index}.png`,
    mime: 'image/png',
    size: 1024 + index,
    object_key: `prod/rd/progress-notes/user-1/image-${index}.png`,
    oss_url: `https://oss.example/image-${index}.png?signature=historical`,
    data_url: `data:image/png;base64,${'x'.repeat(200)}`,
    extracted_text: `large OCR payload ${index}`,
  }));
  let noteMapReads = 0;
  let categoryReads = 0;

  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.getProgressNoteMap = async () => {
    noteMapReads += 1;
    return Object.fromEntries(taskIds.map((taskId) => [
      taskId,
      [{
        id: `note-${taskId}`,
        created_at: '2026-07-31T00:00:00.000Z',
        attachments,
      }],
    ]));
  };
  service.readMergedTaskCategories = async () => {
    categoryReads += 1;
    return [{
      id: 'category',
      children: [{
        id: 'project',
        tasks: taskIds.map((taskId) => ({ task_id: taskId, subtasks: [] })),
      }],
    }];
  };
  service.decorateAttachmentForDisplay = (attachment: Record<string, unknown>) => ({
    ...attachment,
    preview_url: `/api/research-development/oss-preview?key=${attachment.object_key}`,
    thumb_url: `https://oss.example/thumb/${attachment.id}.webp`,
  });

  const result = await service.getTaskAttachmentPreviews(taskIds, {
    userId: 'user-1',
    hasFullAccess: true,
    canReadAll: true,
  });

  assert.equal(noteMapReads, 1);
  assert.equal(categoryReads, 1);
  for (const taskId of taskIds) {
    assert.equal(result[taskId].attachment_count, 7);
    assert.equal(result[taskId].attachments.length, 5);
    for (const attachment of result[taskId].attachments) {
      assert.deepEqual(
        Object.keys(attachment).sort(),
        ['id', 'mime', 'name', 'preview_url', 'size', 'thumb_url'],
      );
    }
  }
});

test('explicit full attachment request returns every item while keeping the payload lightweight', async () => {
  const attachments = Array.from({ length: 9 }, (_, index) => ({
    id: `attachment-${index}`,
    name: `file-${index}.png`,
    mime: 'image/png',
    size: 2048 + index,
    object_key: `prod/rd/progress-notes/user-1/file-${index}.png`,
    oss_url: `https://oss.example/file-${index}.png?signature=historical`,
    preview_url: `/api/research-development/oss-preview?key=file-${index}`,
    thumb_url: `https://oss.example/thumb/file-${index}.webp`,
    data_url: `data:image/png;base64,${'x'.repeat(200)}`,
    extracted_text: `large OCR payload ${index}`,
  }));
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.getTaskProgressNotes = async () => [{
    id: 'note-1',
    created_at: '2026-07-31T00:00:00.000Z',
    text: 'note body must not be returned',
    attachments,
  }];

  const result = await service.getTaskAttachments('task-a', {
    userId: 'user-1',
    hasFullAccess: true,
    canReadAll: true,
  });

  assert.equal(result.attachment_count, 9);
  assert.equal(result.attachments.length, 9);
  for (const attachment of result.attachments) {
    assert.equal('extracted_text' in attachment, false);
    assert.equal('data_url' in attachment, false);
    assert.equal('text' in attachment, false);
  }
});

test('RD JSON store reuses a short-lived read and returns an isolated copy', async () => {
  let reads = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.prisma = {
    systemSetting: {
      findUnique: async () => {
        reads += 1;
        return { value: { nested: { count: 1 } } };
      },
    },
  };

  const first = await service.readValue('rd.taskProgressNotes');
  first.nested.count = 99;
  const second = await service.readValue('rd.taskProgressNotes');

  assert.equal(reads, 1);
  assert.equal(second.nested.count, 1);
});

test('completion score batch reads score/category stores once and preserves per-task permissions', async () => {
  let scoreReads = 0;
  let categoryReads = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readValue = async (key: string) => {
    assert.equal(key, 'rd.taskCompletionScores');
    scoreReads += 1;
    return {
      'task-owner': { total: 91, _debug: { prompt: 'secret' } },
      'task-collaborator': { total: 88, _debug: { prompt: 'secret' } },
      'task-hidden': { total: 70, _debug: { prompt: 'secret' } },
    };
  };
  service.readMergedTaskCategories = async () => {
    categoryReads += 1;
    return [{
      id: 'category',
      children: [{
        id: 'project',
        tasks: [
          { task_id: 'task-owner', primary_owner_user_id: 'user-1', collaborators: [] },
          {
            task_id: 'task-collaborator',
            primary_owner_user_id: 'user-2',
            collaborators: [{ user_id: 'user-1', name: '协作人' }],
          },
          { task_id: 'task-hidden', primary_owner_user_id: 'user-2', collaborators: [] },
        ],
      }],
    }];
  };

  const result = await service.getTaskCompletionScores(
    ['task-owner', 'task-collaborator', 'task-hidden', 'task-missing'],
    { userId: 'user-1', hasFullAccess: false },
  );

  assert.equal(scoreReads, 1);
  assert.equal(categoryReads, 1);
  assert.equal(result['task-owner']?.total, 91);
  assert.equal(result['task-collaborator']?.total, 88);
  assert.equal('_debug' in (result['task-owner'] ?? {}), false);
  assert.equal(result['task-hidden'], null);
  assert.equal(result['task-missing'], null);
});

test('attaching a task with descendants preserves the full hierarchy', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [
      {
        id: 'target-project',
        label: '目标项目',
        tasks: [{
          task_id: 'target',
          title: '目标任务',
          category_path: '系统 A / 目标项目 / 研发任务',
          subtasks: [],
        }],
      },
      {
        id: 'source-project',
        label: '源项目',
        tasks: [{
          task_id: 'source',
          title: '源主任务',
          category_path: '系统 A / 源项目 / 研发任务',
          subtasks: [{
            task_id: 'child-a',
            title: '一级子任务',
            category_path: '系统 A / 源项目 / 测试任务',
            subtasks: [{
              task_id: 'child-b',
              title: '二级子任务',
              category_path: '系统 A / 源项目 / 验证任务',
              subtasks: [],
            }],
          }],
        }],
      },
    ],
  }];
  let written: Array<Record<string, unknown>> | null = null;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.commitTaskTrees = async (dirty: Map<string, Array<Record<string, unknown>>>) => {
    written = dirty.get('prod-portable-o2') ?? null;
  };
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;

  await service.attachTaskAsSubtaskUnlocked('source', 'target', {
    canEditAny: true,
    userId: 'admin-1',
    userName: '管理员',
  });

  const savedTree = written as Array<Record<string, unknown>> | null;
  assert.ok(savedTree);
  const children = (savedTree[0].children as Array<Record<string, unknown>>);
  const targetTasks = children[0].tasks as Array<Record<string, unknown>>;
  const sourceTasks = children[1].tasks as Array<Record<string, unknown>>;
  assert.equal(sourceTasks.length, 0);
  const attached = (targetTasks[0].subtasks as Array<Record<string, unknown>>)[0];
  const childA = (attached.subtasks as Array<Record<string, unknown>>)[0];
  const childB = (childA.subtasks as Array<Record<string, unknown>>)[0];
  assert.equal(attached.task_id, 'source');
  assert.equal(attached.parent_task_id, 'target');
  assert.equal(attached.subtask_origin, 'attached');
  assert.equal(childA.parent_task_id, 'source');
  assert.equal(childB.parent_task_id, 'child-a');
  assert.equal(attached.category_path, '系统 A / 目标项目 / 研发任务');
  assert.equal(childA.category_path, '系统 A / 目标项目 / 测试任务');
  assert.equal(childB.category_path, '系统 A / 目标项目 / 验证任务');
});

test('detaching a nested task lifts its entire subtree without flattening it', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'project-a',
      label: '项目 A',
      tasks: [{
        task_id: 'root',
        title: '根任务',
        subtasks: [{
          task_id: 'middle',
          title: '中间任务',
          parent_task_id: 'root',
          subtasks: [{
            task_id: 'nested',
            title: '待提升任务',
            parent_task_id: 'middle',
            subtask_origin: 'attached',
            subtasks: [{
              task_id: 'leaf',
              title: '原有下级',
              parent_task_id: 'nested',
              subtasks: [],
            }],
          }],
        }],
      }],
    }],
  }];
  let written: Array<Record<string, unknown>> | null = null;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.writeTaskCategoriesForProduct = async (_productId: string, value: Array<Record<string, unknown>>) => {
    written = value;
  };
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;

  await service.detachSubtaskUnlocked('nested', { canEditAny: true });

  const savedTree = written as Array<Record<string, unknown>> | null;
  assert.ok(savedTree);
  const tasks = ((savedTree[0].children as Array<Record<string, unknown>>)[0]
    .tasks as Array<Record<string, unknown>>);
  assert.deepEqual(tasks.map((task) => task.task_id), ['nested', 'root']);
  const detached = tasks[0];
  const root = tasks[1];
  const middle = (root.subtasks as Array<Record<string, unknown>>)[0];
  assert.equal((middle.subtasks as Array<Record<string, unknown>>).length, 0);
  assert.equal(detached.parent_task_id, null);
  assert.equal(detached.subtask_origin, null);
  assert.equal(((detached.subtasks as Array<Record<string, unknown>>)[0]).task_id, 'leaf');
});

test('batch attaching top-level trees to a nested task commits all sources together', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'project-a',
      label: '项目 A',
      tasks: [
        {
          task_id: 'root',
          title: '根任务',
          category_path: '系统 A / 项目 A / 研发任务',
          subtasks: [{
            task_id: 'target',
            title: '中间目标',
            category_path: '系统 A / 项目 A / 研发任务',
            subtasks: [],
          }],
        },
        {
          task_id: 'source-a',
          title: '来源 A',
          description: '来源任务的完整交付说明',
          primary_owner: '成员 A',
          due_date: '2026-08-31',
          status: 'completed',
          completion_score: { total: 92, grade: 'A' },
          pending_review_type: 'result',
          category_path: '系统 A / 项目 A / 测试任务',
          subtasks: [],
        },
        {
          task_id: 'source-b',
          title: '来源 B',
          category_path: '系统 A / 项目 A / 验证任务',
          subtasks: [{
            task_id: 'source-b-child',
            title: '来源 B 下级',
            category_path: '系统 A / 项目 A / 验证任务',
            subtasks: [],
          }],
        },
      ],
    }],
  }];
  let written: Array<Record<string, unknown>> | null = null;
  let commits = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.commitTaskTrees = async (dirty: Map<string, Array<Record<string, unknown>>>) => {
    commits += 1;
    written = dirty.get('prod-portable-o2') ?? null;
  };
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;

  const result = await service.attachTasksAsSubtasksUnlocked(
    ['source-a', 'source-b'],
    'target',
    { canEditAny: true, userName: '管理员' },
  );

  assert.equal(commits, 1);
  assert.deepEqual(result.task_ids, ['source-a', 'source-b']);
  const savedTree = written as Array<Record<string, unknown>> | null;
  assert.ok(savedTree);
  const tasks = ((savedTree[0].children as Array<Record<string, unknown>>)[0]
    .tasks as Array<Record<string, unknown>>);
  assert.deepEqual(tasks.map((task) => task.task_id), ['root']);
  const target = ((tasks[0].subtasks as Array<Record<string, unknown>>)[0]);
  const attached = target.subtasks as Array<Record<string, unknown>>;
  assert.deepEqual(attached.map((task) => task.task_id), ['source-a', 'source-b']);
  assert.equal(attached[0].parent_task_id, 'target');
  assert.equal(attached[0].description, '来源任务的完整交付说明');
  assert.equal(attached[0].primary_owner, '成员 A');
  assert.equal(attached[0].due_date, '2026-08-31');
  assert.equal(attached[0].status, 'completed');
  assert.deepEqual(attached[0].completion_score, { total: 92, grade: 'A' });
  assert.equal(attached[0].pending_review_type, 'result');
  assert.equal(attached[1].parent_task_id, 'target');
  assert.equal(
    ((attached[1].subtasks as Array<Record<string, unknown>>)[0]).parent_task_id,
    'source-b',
  );
});

test('combined personal workspace exposes only the current users tasks from research and collaboration', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.getWorkspace = async (userId: string) => ({
    myTasks: [{ task_id: `${currentRdWorkspace()}-mine`, owner_user_id: userId }],
    collabTasks: [{ task_id: `${currentRdWorkspace()}-assist` }],
    todayTodos: [],
    aiSuggestions: currentRdWorkspace() === 'rd' ? [{ id: 'rd-ai' }] : [{ id: 'collab-ai' }],
    notifications: currentRdWorkspace() === 'rd' ? [{ id: 'rd-note' }] : [{ id: 'collab-note' }],
  });

  const result = await runInRdWorkspace('rd', () => service.getCombinedWorkspace('user-1', '成员一')) as any;

  assert.deepEqual(result.myTasks.map((task: Record<string, unknown>) => [task.task_id, task.source_workspace]), [
    ['rd-mine', 'rd'],
    ['us-collab-mine', 'us-collab'],
  ]);
  assert.deepEqual(result.collabTasks.map((task: Record<string, unknown>) => [task.task_id, task.source_workspace]), [
    ['rd-assist', 'rd'],
    ['us-collab-assist', 'us-collab'],
  ]);
  assert.deepEqual(result.aiSuggestions, [{ id: 'rd-ai' }]);
  assert.deepEqual(result.notifications, [{ id: 'rd-note' }]);
});

test('administrator member view tags collaboration tasks without mixing them into the research tree', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.getMergedTaskCategories = async () => ([{
    id: 'system',
    children: [{ id: 'project', tasks: [{ task_id: `${currentRdWorkspace()}-task`, subtasks: [] }] }],
  }]);

  const result = await runInRdWorkspace('rd', () => service.getMemberTaskCategories()) as any;
  const researchTask = ((result[0].children[0] as Record<string, unknown>).tasks as Array<Record<string, unknown>>)[0];
  const collaborationTask = ((result[1].children[0] as Record<string, unknown>).tasks as Array<Record<string, unknown>>)[0];

  assert.equal(researchTask.source_workspace, 'rd');
  assert.equal(collaborationTask.source_workspace, 'us-collab');
  assert.equal(result[0].id, 'system');
  assert.equal(result[1].id, 'us-collab:system');
});

test('attaching to a nested target across product stores commits source and target atomically', async () => {
  const sourceCategories = [{
    id: 'source-system',
    label: '源系统',
    children: [{
      id: 'source-project',
      label: '源项目',
      tasks: [{ task_id: 'source', category_path: '源系统 / 源项目 / 研发任务', subtasks: [] }],
    }],
  }];
  const targetCategories = [{
    id: 'target-system',
    label: '目标系统',
    children: [{
      id: 'target-project',
      label: '目标项目',
      tasks: [{
        task_id: 'root',
        subtasks: [{
          task_id: 'target',
          category_path: '目标系统 / 目标项目 / 研发任务',
          subtasks: [],
        }],
      }],
    }],
  }];
  let dirtyTrees: Map<string, Array<Record<string, unknown>>> | null = null;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([
      ['product-source', sourceCategories],
      ['product-target', targetCategories],
    ]),
    store: { 'product-source': sourceCategories, 'product-target': targetCategories },
  });
  service.commitTaskTrees = async (dirty: Map<string, Array<Record<string, unknown>>>) => {
    dirtyTrees = dirty;
  };
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;

  await service.attachTasksAsSubtasksUnlocked(['source'], 'target', { canEditAny: true });

  const saved = dirtyTrees as Map<string, Array<Record<string, unknown>>> | null;
  assert.ok(saved);
  const sourceTasks = (((saved.get('product-source')![0].children as Array<Record<string, unknown>>)[0]
    .tasks) as Array<Record<string, unknown>>);
  assert.equal(sourceTasks.length, 0);
  const targetRoot = ((((saved.get('product-target')![0].children as Array<Record<string, unknown>>)[0]
    .tasks) as Array<Record<string, unknown>>)[0]);
  const target = ((targetRoot.subtasks as Array<Record<string, unknown>>)[0]);
  const attached = ((target.subtasks as Array<Record<string, unknown>>)[0]);
  assert.equal(attached.task_id, 'source');
  assert.equal(attached.parent_task_id, 'target');
  assert.equal(attached.category_path, '目标系统 / 目标项目 / 研发任务');
});

test('attaching an ancestor below its own descendant is rejected before commit', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'project-a',
      label: '项目 A',
      tasks: [{
        task_id: 'root',
        title: '根任务',
        subtasks: [{ task_id: 'child', title: '子任务', subtasks: [] }],
      }],
    }],
  }];
  let commits = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.commitTaskTrees = async () => { commits += 1; };

  await assert.rejects(
    () => service.attachTasksAsSubtasksUnlocked(['root'], 'child', { canEditAny: true }),
    /不能把上级任务并入自己的下级任务/,
  );
  assert.equal(commits, 0);
});

test('attaching a subtree beyond the configured maximum depth is rejected before commit', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'project-a',
      label: '项目 A',
      tasks: [
        {
          task_id: 'root',
          subtasks: [{
            task_id: 'level-2',
            subtasks: [{
              task_id: 'level-3',
              subtasks: [{ task_id: 'level-4', subtasks: [] }],
            }],
          }],
        },
        {
          task_id: 'source',
          subtasks: [{ task_id: 'source-child', subtasks: [] }],
        },
      ],
    }],
  }];
  let commits = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.commitTaskTrees = async () => { commits += 1; };

  await assert.rejects(
    () => service.attachTasksAsSubtasksUnlocked(['source'], 'level-4', { canEditAny: true }),
    /最多支持 5 层/,
  );
  assert.equal(commits, 0);
});

test('batch detaching direct siblings lifts every selected subtree in one write', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'project-a',
      label: '项目 A',
      tasks: [{
        task_id: 'root',
        title: '根任务',
        subtasks: [{
          task_id: 'middle',
          title: '中间任务',
          subtasks: [
            {
              task_id: 'left',
              title: '左侧子树',
              parent_task_id: 'middle',
              subtasks: [{ task_id: 'leaf', title: '叶子', parent_task_id: 'left', subtasks: [] }],
            },
            { task_id: 'right', title: '右侧子树', parent_task_id: 'middle', subtasks: [] },
            { task_id: 'kept', title: '保留任务', parent_task_id: 'middle', subtasks: [] },
          ],
        }],
      }],
    }],
  }];
  let written: Array<Record<string, unknown>> | null = null;
  let writes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.writeTaskCategoriesForProduct = async (_productId: string, value: Array<Record<string, unknown>>) => {
    writes += 1;
    written = value;
  };
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;

  await service.detachSubtasksUnlocked(['right', 'left'], 'middle', { canEditAny: true });

  assert.equal(writes, 1);
  const savedTree = written as Array<Record<string, unknown>> | null;
  assert.ok(savedTree);
  const tasks = ((savedTree[0].children as Array<Record<string, unknown>>)[0]
    .tasks as Array<Record<string, unknown>>);
  assert.deepEqual(tasks.map((task) => task.task_id), ['left', 'right', 'root']);
  assert.equal(tasks[0].parent_task_id, null);
  assert.equal(((tasks[0].subtasks as Array<Record<string, unknown>>)[0]).task_id, 'leaf');
  const middle = ((tasks[2].subtasks as Array<Record<string, unknown>>)[0]);
  assert.deepEqual(
    (middle.subtasks as Array<Record<string, unknown>>).map((task) => task.task_id),
    ['kept'],
  );
});

test('batch detach rejects tasks from different parents before writing', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'project-a',
      label: '项目 A',
      tasks: [{
        task_id: 'root',
        subtasks: [
          {
            task_id: 'parent-a',
            subtasks: [{ task_id: 'child-a', parent_task_id: 'parent-a', subtasks: [] }],
          },
          {
            task_id: 'parent-b',
            subtasks: [{ task_id: 'child-b', parent_task_id: 'parent-b', subtasks: [] }],
          },
        ],
      }],
    }],
  }];
  let writes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.writeTaskCategoriesForProduct = async () => { writes += 1; };

  await assert.rejects(
    () => service.detachSubtasksUnlocked(['child-a', 'child-b'], undefined, { canEditAny: true }),
    /同一父任务/,
  );
  assert.equal(writes, 0);
});

test('creating a child under a nested task inserts it at the requested depth', async () => {
  const categories = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'project-a',
      label: '项目 A',
      tasks: [{
        task_id: 'root',
        title: '根任务',
        subtasks: [{
        task_id: 'middle',
        title: '中间任务',
        primary_owner_user_id: 'user-1',
        primary_owner: '研发成员',
        category_path: '系统 A / 项目 A / 研发任务',
        subtasks: [],
        }],
      }],
    }],
  }];
  let written: Array<Record<string, unknown>> | null = null;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.getIdentityContext = async () => ({ people: [], users: [] });
  service.normalizeTaskIdentity = (task: Record<string, unknown>) => task;
  service.writeTaskCategoriesForProduct = async (_productId: string, value: Array<Record<string, unknown>>) => {
    written = value;
  };
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;
  service.getProposalReviewRecipients = async () => [];

  const created = await service.createTaskUnlocked(
    {
      task_id: 'new-child',
      parent_task_id: 'middle',
      title: '新下级',
      primary_owner: '伪造主责人',
      status: 'pending_review',
      pending_review_type: 'proposal',
    },
    {
      requesterUserId: 'user-1',
      requesterName: '研发成员',
      proposalOnly: true,
      canEditAny: false,
    },
  );

  assert.equal(created.parent_task_id, 'middle');
  assert.equal(created.status, 'pending_review');
  assert.equal(created.pending_review_type, 'proposal');
  assert.equal(created.primary_owner, '研发成员');
  assert.equal(created.primary_owner_user_id, 'user-1');
  assert.notEqual(created.task_id, 'new-child', 'task ids are server-owned and client values must be ignored');
  const savedTree = written as Array<Record<string, unknown>> | null;
  assert.ok(savedTree);
  const root = (((savedTree[0].children as Array<Record<string, unknown>>)[0]
    .tasks as Array<Record<string, unknown>>)[0]);
  const middle = ((root.subtasks as Array<Record<string, unknown>>)[0]);
  assert.equal(((middle.subtasks as Array<Record<string, unknown>>)[0]).task_id, created.task_id);
});

test('creating a child under another user task is rejected before any write', async () => {
  const categories = [{
    id: 'system-a',
    children: [{
      id: 'project-a',
      tasks: [{
        task_id: 'parent',
        primary_owner_user_id: 'user-b',
        primary_owner: '成员 B',
        collaborators: [],
        subtasks: [],
      }],
    }],
  }];
  let writes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.writeTaskCategoriesForProduct = async () => { writes += 1; };

  await assert.rejects(
    () => service.createSubtaskUnlocked(
      { task_id: 'forged-child', title: '越权子任务' },
      'parent',
      { requesterUserId: 'user-a', requesterName: '成员 A', canEditAny: false },
    ),
    /只能在自己负责或协作的任务下立项/,
  );
  assert.equal(writes, 0);
});

test('proposal-only task creation rejects direct activation before reading task trees', async () => {
  let reads = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => { reads += 1; return { trees: new Map(), store: {} }; };

  await assert.rejects(
    () => service.createTaskUnlocked(
      {
        parent_task_id: 'parent',
        title: '绕过审核',
        status: 'in_progress',
        pending_review_type: 'proposal',
      },
      { requesterUserId: 'user-a', requesterName: '成员 A', proposalOnly: true },
    ),
    /立项申请只能创建待审核任务/,
  );
  assert.equal(reads, 0);
});

test('creating a sixth-level child is rejected before any write or side effect', async () => {
  const level5 = { task_id: 'level-5', subtasks: [] };
  const level4 = { task_id: 'level-4', subtasks: [level5] };
  const level3 = { task_id: 'level-3', subtasks: [level4] };
  const level2 = { task_id: 'level-2', subtasks: [level3] };
  const level1 = { task_id: 'level-1', subtasks: [level2] };
  const categories = [{ id: 'system-a', children: [{ id: 'project-a', tasks: [level1] }] }];
  let writes = 0;
  let recomputes = 0;
  let ragSyncs = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.writeTaskCategoriesForProduct = async () => { writes += 1; };
  service.recomputeDirectorDashboard = async () => { recomputes += 1; };
  service.syncTaskToRag = () => { ragSyncs += 1; };

  await assert.rejects(
    () => service.createSubtaskUnlocked(
      { task_id: 'level-6', title: '第六层' },
      'level-5',
      { canEditAny: true },
    ),
    /最多支持 5 层/,
  );
  assert.equal(writes, 0);
  assert.equal(recomputes, 0);
  assert.equal(ragSyncs, 0);
});

test('batch child creation writes once and reuses the committed result on retry', async () => {
  let categories: Array<Record<string, unknown>> = [{
    id: 'system-a',
    children: [{
      id: 'project-a',
      tasks: [{ task_id: 'parent', primary_owner_user_id: 'owner-1', subtasks: [] }],
    }],
  }];
  let writes = 0;
  let recomputes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', categories]]),
    store: {},
  });
  service.getIdentityContext = async () => ({ people: [], users: [] });
  service.normalizeTaskIdentity = (task: Record<string, unknown>) => task;
  service.writeTaskCategoriesForProduct = async (_productId: string, value: Array<Record<string, unknown>>) => {
    writes += 1;
    categories = value;
  };
  service.recomputeDirectorDashboard = async () => { recomputes += 1; };
  service.syncTaskToRag = () => undefined;
  service.notifyAdminsOfPendingReview = async () => undefined;

  const payloads = [
    { task_id: 'child-a', title: '子任务 A', status: 'in_progress' },
    { task_id: 'child-b', title: '子任务 B', status: 'in_progress' },
  ];
  const first = await service.createSubtasksUnlocked(
    payloads,
    'parent',
    'proposal-request-1',
    { requesterUserId: 'user-a', canEditAny: true },
  );
  const retry = await service.createSubtasksUnlocked(
    payloads,
    'parent',
    'proposal-request-1',
    { requesterUserId: 'user-a', canEditAny: true },
  );

  assert.equal(writes, 1);
  assert.equal(recomputes, 1);
  assert.equal(first.length, 2);
  assert.deepEqual(
    retry.map((task: Record<string, unknown>) => task.task_id),
    first.map((task: Record<string, unknown>) => task.task_id),
  );
  assert.deepEqual(first.map((task: Record<string, unknown>) => task.creation_request_index), [0, 1]);

  const otherUser = await service.createSubtasksUnlocked(
    payloads,
    'parent',
    'proposal-request-1',
    { requesterUserId: 'user-b', canEditAny: true },
  );
  assert.equal(writes, 2, 'same client request id from another user must use a separate idempotency scope');
  assert.notDeepEqual(
    otherUser.map((task: Record<string, unknown>) => task.task_id),
    first.map((task: Record<string, unknown>) => task.task_id),
  );
});

test('研发人员整表写入串行执行，并发新增不会互相覆盖', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let peopleStore: Record<string, unknown>[] = [];
  service.peopleWriteLock = Promise.resolve();
  service.readArray = async (key: string) => key === 'rd.people' ? structuredClone(peopleStore) : [];
  service.listIdentityUsers = async () => [];
  service.writeValue = async (key: string, value: Record<string, unknown>[]) => {
    assert.equal(key, 'rd.people');
    await Promise.resolve();
    peopleStore = structuredClone(value);
    return value;
  };
  service.recordServerAudit = async () => undefined;
  service.recomputeDirectorDashboard = async () => undefined;

  await Promise.all([
    service.createPerson({ name: '研发甲', position: '工程师', department: '研发一组' }),
    service.createPerson({ name: '研发乙', position: '工程师', department: '研发二组' }),
  ]);

  assert.deepEqual(new Set(peopleStore.map((person) => person.name)), new Set(['研发甲', '研发乙']));
});

test('人员归属改写与任务树内驾驶舱重算不会形成 ABBA 死锁', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.peopleWriteLock = Promise.resolve();
  service.taskTreeWriteLock = Promise.resolve();
  service.directorDashboardWriteLock = Promise.resolve();
  service.readNormalizedTaskCategories = async () => [];
  service.readArray = async () => [];
  service.listIdentityUsers = async () => [];
  service.readProductCategoryStore = async () => ({});
  service.writeValue = async () => undefined;

  let markTaskEntered!: () => void;
  let markPeopleEntered!: () => void;
  const taskEntered = new Promise<void>((resolve) => { markTaskEntered = resolve; });
  const peopleEntered = new Promise<void>((resolve) => { markPeopleEntered = resolve; });

  const taskWrite = service.withTaskTreeLock(async () => {
    markTaskEntered();
    await peopleEntered;
    await service.recomputeDirectorDashboard();
  });
  await taskEntered;
  const peopleWrite = service.withPeopleWriteLock(async () => {
    markPeopleEntered();
    await taskEntered;
    await service.mutateAllStores((categories: unknown[]) => ({ categories, changed: false }));
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([taskWrite, peopleWrite]),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('people/task-tree ABBA deadlock')), 500);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

test('concurrent personnel rename preserves the task write that was already holding the tree lock', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.peopleWriteLock = Promise.resolve();
  service.taskTreeWriteLock = Promise.resolve();
  let peopleStore: Record<string, unknown>[] = [{
    id: 'person-a',
    name: '旧姓名',
    position: '工程师',
    department: '研发部',
  }];
  let categories: Array<Record<string, unknown>> = [{
    id: 'system-a',
    children: [{
      id: 'project-a',
      tasks: [{ task_id: 'task-existing', primary_owner: '旧姓名', subtasks: [] }],
    }],
  }];
  let markPeoplePersisted!: () => void;
  const peoplePersisted = new Promise<void>((resolve) => { markPeoplePersisted = resolve; });
  service.readArray = async (key: string) =>
    key === 'rd.people' ? structuredClone(peopleStore) : [];
  service.listIdentityUsers = async () => [];
  service.readNormalizedTaskCategories = async () => structuredClone(categories);
  service.readProductCategoryStore = async () => ({});
  service.writeValue = async (key: string, value: unknown) => {
    if (key === 'rd.people') {
      peopleStore = structuredClone(value as Record<string, unknown>[]);
      markPeoplePersisted();
    }
    if (key === 'rd.taskCategories') {
      categories = structuredClone(value as Array<Record<string, unknown>>);
    }
    return value;
  };
  service.recordServerAudit = async () => undefined;
  service.recomputeDirectorDashboard = async () => undefined;

  // 任务写先持锁，人员写先持 people 锁；人员落表后，任务写提交，再由归属改写读取最新任务树。
  const taskWrite = service.withTaskTreeLock(async () => {
    await peoplePersisted;
    const tasks = ((categories[0].children as Array<Record<string, unknown>>)[0].tasks as unknown[]);
    tasks.push({ task_id: 'task-concurrent', primary_owner: '旧姓名', subtasks: [] });
  });
  const personWrite = service.updatePerson('person-a', { name: '新姓名' });
  await Promise.all([taskWrite, personWrite]);

  const tasks = ((categories[0].children as Array<Record<string, unknown>>)[0].tasks as Array<Record<string, unknown>>);
  assert.deepEqual(tasks.map((task) => task.task_id), ['task-existing', 'task-concurrent']);
  assert.deepEqual(tasks.map((task) => task.primary_owner), ['新姓名', '新姓名']);
  assert.equal(peopleStore[0].name, '新姓名');
});

test('top-level proposal batch recognizes a complete legacy replay but forbids appending a tail', async () => {
  let categories: Array<Record<string, unknown>> = [{
    id: 'system-a',
    label: '系统 A',
    children: [{ id: 'project-a', label: '项目 A', tasks: [] }],
  }];
  let writes = 0;
  let recomputes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  service.readTaskCategoriesForProduct = async () => categories;
  service.getIdentityContext = async () => ({ people: [], users: [] });
  service.normalizeTaskIdentity = (task: Record<string, unknown>) => task;
  service.writeTaskCategoriesForProduct = async (_productId: string, value: Array<Record<string, unknown>>) => {
    writes += 1;
    categories = value;
  };
  service.recomputeDirectorDashboard = async () => { recomputes += 1; };
  service.recordServerAudit = async () => undefined;
  service.syncTaskToRag = () => undefined;
  service.notifyAdminsOfPendingReview = async () => undefined;
  service.getProposalReviewRecipients = async () => [];

  const payloads = [
    {
      product_id: 'prod-portable-o2',
      category_id: 'system-a',
      sub_project_id: 'project-a',
      title: '顶层任务 A',
      primary_owner: '研发甲',
      status: 'pending_review',
      pending_review_type: 'proposal',
    },
    {
      product_id: 'prod-portable-o2',
      category_id: 'system-a',
      sub_project_id: 'project-a',
      title: '顶层任务 B',
      primary_owner: '研发乙',
      status: 'pending_review',
      pending_review_type: 'proposal',
    },
  ];
  const actor = {
    requesterUserId: 'user-a',
    requesterName: '研发甲',
    canEditAny: false,
    proposalOnly: true,
  };

  // 模拟升级前逐条接口已经完成整批；旧记录没有 batch_hash / batch_size。
  const legacyTasks: Record<string, unknown>[] = [];
  for (const [index, payload] of payloads.entries()) {
    const legacyTask = await service.createTaskUnlocked(
      payload,
      actor,
      { requestId: 'proposal-top-1', requestIndex: index },
    );
    legacyTask.creation_request_hash = createHash('sha256').update(JSON.stringify({
      ...payload,
      creation_request_id: 'proposal-top-1',
      creation_request_index: index,
      status: 'pending_review',
      pending_review_type: 'proposal',
      primary_owner: '研发甲',
      primary_owner_user_id: 'user-a',
    })).digest('hex');
    legacyTasks.push(legacyTask);
  }
  writes = 0;
  recomputes = 0;

  const retry = await service.createTasksBatch(payloads, 'proposal-top-1', actor);

  assert.equal(writes, 0, 'a complete legacy replay must not write duplicate tasks');
  assert.equal(recomputes, 0);
  assert.deepEqual(
    retry.map((task: Record<string, unknown>) => task.task_id),
    legacyTasks.map((task) => task.task_id),
  );
  assert.equal(
    (((categories[0].children as any[])[0].tasks as any[]).length),
    2,
    'retry must not duplicate an already committed batch',
  );

  await assert.rejects(
    () => service.createTasksBatch(
      [
        ...payloads,
        {
          ...payloads[1],
          title: '试图追加的任务 C',
        },
      ],
      'proposal-top-1',
      actor,
    ),
    /旧版批量请求已完成.*不能.*追加任务/,
  );

  await assert.rejects(
    () => service.createTasksBatch(
      [payloads[0], { ...payloads[1], title: '篡改后的任务 B' }],
      'proposal-top-1',
      actor,
    ),
    /请求标识已被其它任务使用/,
  );
  assert.equal(writes, 0);
});

test('top-level proposal batch validates every target before writing any new task', async () => {
  const categories: Array<Record<string, unknown>> = [{
    id: 'system-a',
    label: '系统 A',
    children: [{ id: 'project-a', label: '项目 A', tasks: [] }],
  }];
  let writes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readTaskCategoriesForProduct = async () => categories;
  service.getIdentityContext = async () => ({ people: [], users: [] });
  service.normalizeTaskIdentity = (task: Record<string, unknown>) => task;
  service.writeTaskCategoriesForProduct = async () => { writes += 1; };

  await assert.rejects(
    () => service.createTasksBatchUnlocked(
      [
        { product_id: 'prod-portable-o2', category_id: 'system-a', sub_project_id: 'project-a', title: '合法任务' },
        { product_id: 'prod-portable-o2', category_id: 'missing-system', sub_project_id: 'missing-project', title: '非法任务' },
      ],
      'proposal-top-invalid',
      { requesterUserId: 'user-a', canEditAny: true },
    ),
    /指定的分类不存在/,
  );
  assert.equal(writes, 0, 'a validation failure must not persist the valid prefix of the batch');
  assert.equal((((categories[0].children as any[])[0].tasks as any[]).length), 0);
});

function createTaskMergeHarness(
  mergeTaskDescriptions: (input: Record<string, unknown>) => Promise<string | null>,
) {
  let categories: Array<Record<string, unknown>> = [{
    id: 'system-a',
    children: [{
      id: 'project-a',
      tasks: [
        {
          task_id: 'source-task',
          title: '源任务',
          description: '源描述',
          status: 'pending_review',
          pending_review_type: 'merge',
          pending_merge_target: 'target-task',
          pending_merge_reason: '内容重复',
          pending_merge_requested_by: '研发甲',
          pending_merge_requested_by_id: 'user-a',
          primary_owner: '研发甲',
          primary_owner_user_id: 'user-a',
          collaborators: [],
          subtasks: [{ task_id: 'source-child', title: '源子任务', subtasks: [] }],
          updated_at: '2026-09-01T01:00:00.000Z',
        },
        {
          task_id: 'target-task',
          title: '目标任务',
          description: '目标描述',
          status: 'in_progress',
          primary_owner: '研发乙',
          primary_owner_user_id: 'user-b',
          collaborators: [],
          subtasks: [],
          updated_at: '2026-09-01T01:00:00.000Z',
        },
      ],
    }],
  }];
  let writes = 0;
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  const findTask = (taskId: string): Record<string, unknown> | null => {
    let found: Record<string, unknown> | null = null;
    const walk = (tasks: unknown[]) => {
      for (const task of tasks) {
        if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
        const record = task as Record<string, unknown>;
        if (record.task_id === taskId) {
          found = record;
          return;
        }
        if (Array.isArray(record.subtasks)) walk(record.subtasks);
        if (found) return;
      }
    };
    for (const category of categories) {
      for (const child of (category.children as Array<Record<string, unknown>>)) {
        walk(child.tasks as unknown[]);
        if (found) return found;
      }
    }
    return found;
  };

  service.findTaskAcrossStores = async (taskId: string) => findTask(taskId);
  service.rdAiService = { mergeTaskDescriptions };
  service.mutateTaskAcrossStores = async (
    transform: (value: Array<Record<string, unknown>>) => { categories: unknown[]; found: boolean },
  ) => {
    const result = transform(structuredClone(categories));
    if (result.found) {
      writes += 1;
      categories = result.categories as Array<Record<string, unknown>>;
    }
    return { found: result.found, productId: result.found ? 'prod-portable-o2' : null };
  };
  service.withProgressNoteLock = async (operation: () => Promise<unknown>) => operation();
  service.getProgressNoteMap = async () => ({});
  service.notifyTaskMerged = async () => undefined;
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;
  return {
    service,
    findTask,
    getWrites: () => writes,
  };
}

test('merge approval commits source settlement and target update in one task-tree write', async () => {
  const harness = createTaskMergeHarness(async () => 'AI 合并后的描述');
  const result = await harness.service.applyTaskMerge(
    'source-task',
    'target-task',
    { id: 'user-a', name: '研发甲' },
  );

  assert.equal(harness.getWrites(), 1);
  assert.equal(result.source.status, 'pending_review');
  const source = harness.findTask('source-task')!;
  const target = harness.findTask('target-task')!;
  assert.equal(source.status, 'archived');
  assert.equal(source.pending_review_type, null);
  assert.equal(source.pending_merge_target, null);
  assert.deepEqual(source.subtasks, []);
  assert.equal(target.description, 'AI 合并后的描述');
  assert.deepEqual(
    (target.subtasks as Array<Record<string, unknown>>).map((task) => task.task_id),
    ['source-child'],
  );
});

test('merge approval CAS preserves a concurrently edited target and leaves source pending', async () => {
  let markAiStarted!: () => void;
  let finishAi!: (description: string) => void;
  const aiStarted = new Promise<void>((resolve) => { markAiStarted = resolve; });
  const aiResult = new Promise<string>((resolve) => { finishAi = resolve; });
  const harness = createTaskMergeHarness(async () => {
    markAiStarted();
    return aiResult;
  });

  const merge = harness.service.applyTaskMerge(
    'source-task',
    'target-task',
    { id: 'user-a', name: '研发甲' },
  );
  await aiStarted;
  const concurrentTarget = harness.findTask('target-task')!;
  concurrentTarget.description = '管理员并发修改后的描述';
  concurrentTarget.updated_at = '2026-09-01T02:00:00.000Z';
  finishAi('基于旧快照生成的描述');

  await assert.rejects(merge, /目标任务在合并审批期间已被修改/);
  assert.equal(harness.getWrites(), 0);
  assert.equal(harness.findTask('source-task')?.status, 'pending_review');
  assert.equal(harness.findTask('source-task')?.pending_review_type, 'merge');
  assert.equal(harness.findTask('target-task')?.description, '管理员并发修改后的描述');
});

test('merge approval propagates core failure without first clearing pending state', async () => {
  const pendingTask = {
    task_id: 'source-task',
    title: '源任务',
    status: 'pending_review',
    pending_review_type: 'merge',
    pending_merge_target: 'target-task',
    pending_merge_requested_by: '研发甲',
    pending_merge_requested_by_id: 'user-a',
  };
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let genericMutations = 0;
  let failureNotices = 0;
  service.assertTaskReviewAuthorized = async () => undefined;
  service.findTaskAcrossStores = async () => pendingTask;
  service.applyTaskMerge = async () => { throw new Error('atomic merge failed'); };
  service.notifyTaskMergeFailure = async () => { failureNotices += 1; };
  service.mutateTaskAcrossStores = async () => { genericMutations += 1; };

  await assert.rejects(
    () => service.updateTask(
      'source-task',
      { _review_action: 'approve', _reviewer_name: '管理员' },
      { requesterUserId: 'admin-1', requesterName: '管理员', canEditAny: true },
    ),
    /atomic merge failed/,
  );
  assert.equal(genericMutations, 0);
  assert.equal(failureNotices, 1);
  assert.equal(pendingTask.status, 'pending_review');
  assert.equal(pendingTask.pending_review_type, 'merge');
});

test('review approval fails closed if the task changes to merge after the special-path pre-read', async () => {
  const storedTask: Record<string, unknown> = {
    task_id: 'source-task',
    status: 'pending_review',
    pending_review_type: 'merge',
    pending_merge_target: 'target-task',
    primary_owner_user_id: 'admin-1',
    subtasks: [],
  };
  const categories: Array<Record<string, unknown>> = [{
    id: 'system-a',
    children: [{ id: 'project-a', tasks: [storedTask] }],
  }];
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let writes = 0;
  service.assertTaskReviewAuthorized = async () => undefined;
  // 特殊路径预读仍看到 result；真正持锁改写时任务已经变成 merge。
  service.findTaskAcrossStores = async () => ({
    ...storedTask,
    pending_review_type: 'result',
  });
  service.getIdentityContext = async () => ({ people: [], users: [] });
  service.mutateTaskAcrossStores = async (
    transform: (value: Array<Record<string, unknown>>) => { categories: unknown[]; found: boolean },
  ) => {
    const result = transform(categories);
    if (result.found) writes += 1;
    return { found: result.found, productId: 'prod-portable-o2' };
  };

  await assert.rejects(
    () => service.updateTask(
      'source-task',
      { _review_action: 'approve' },
      { requesterUserId: 'admin-1', requesterName: '管理员', canEditAny: true },
    ),
    /合并申请已变化，请刷新后重试/,
  );
  assert.equal(writes, 0);
  assert.equal(storedTask.status, 'pending_review');
  assert.equal(storedTask.pending_review_type, 'merge');
});

test('pending-review notification rechecks state after slow recipient lookup', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.taskTreeWriteLock = Promise.resolve();
  let currentTask: Record<string, unknown> = {
    task_id: 'task-1',
    title: '待审任务',
    status: 'pending_review',
    pending_review_type: 'result',
  };
  let markLookupStarted!: () => void;
  let finishLookup!: (admins: Array<{ id: string }>) => void;
  const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
  const admins = new Promise<Array<{ id: string }>>((resolve) => { finishLookup = resolve; });
  let messageWrites = 0;
  service.getUsersWithAnyPermission = async () => {
    markLookupStarted();
    return admins;
  };
  service.findTaskAcrossStores = async () => currentTask;
  service.createMessages = async () => { messageWrites += 1; };

  const notification = service.notifyAdminsOfPendingReview(currentTask, {});
  await lookupStarted;
  currentTask = { ...currentTask, status: 'completed', pending_review_type: null };
  finishLookup([{ id: 'admin-1' }]);
  await notification;

  assert.equal(messageWrites, 0, 'a settled review must not receive a late pending notification');
});

test('task patch cannot rewrite structural or server-owned idempotency fields', async () => {
  let categories: Array<Record<string, unknown>> = [{
    id: 'system-a',
    children: [{
      id: 'project-a',
      tasks: [{
        task_id: 'task-a',
        title: '原任务',
        primary_owner_user_id: 'user-a',
        parent_task_id: 'parent-a',
        subtasks: [],
        creation_request_scope: 'server-scope',
        creation_request_batch_hash: 'server-batch-hash',
        creation_request_batch_size: 2,
      }],
    }],
  }];
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.getIdentityContext = async () => ({ people: [], users: [] });
  service.normalizeTaskIdentity = (task: Record<string, unknown>) => task;
  service.mutateTaskAcrossStores = async (transform: (value: unknown[]) => { categories: unknown[] }) => {
    const result = transform(categories);
    categories = result.categories as Array<Record<string, unknown>>;
  };
  service.recomputeDirectorDashboard = async () => undefined;
  service.syncTaskToRag = () => undefined;

  await service.updateTask(
    'task-a',
    {
      title: '合法标题',
      parent_task_id: 'forged-parent',
      subtasks: [{ task_id: 'forged-child' }],
      creation_request_scope: 'forged-scope',
      creation_request_batch_hash: 'forged-batch-hash',
      creation_request_batch_size: 99,
    },
    { requesterUserId: 'user-a', canEditAny: false },
  );
  const task = ((categories[0].children as any[])[0].tasks as any[])[0];
  assert.equal(task.title, '合法标题');
  assert.equal(task.parent_task_id, 'parent-a');
  assert.deepEqual(task.subtasks, []);
  assert.equal(task.creation_request_scope, 'server-scope');
  assert.equal(task.creation_request_batch_hash, 'server-batch-hash');
  assert.equal(task.creation_request_batch_size, 2);
});

test('ordinary members cannot delete tasks they do not participate in', async () => {
  const categories = [{
    id: 'system-a',
    children: [{
      id: 'project-a',
      tasks: [{ task_id: 'task-a', primary_owner_user_id: 'owner-a', collaborators: [], subtasks: [] }],
    }],
  }];
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.mutateTaskAcrossStores = async (transform: (value: unknown[]) => unknown) => transform(categories);
  await assert.rejects(
    () => service.deleteTask('task-a', { userId: 'other-user', canEditAny: false }),
    /只能删除自己负责或协作的任务/,
  );
});

test('workspace task depth uses the authoritative nested structure', () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  const categories = [{
    children: [{
      tasks: [{
        task_id: 'level-1',
        subtasks: [{
          task_id: 'level-2',
          subtasks: [{ task_id: 'level-3', subtasks: [] }],
        }],
      }],
    }],
  }];
  const depths = service.collectTaskDepths(categories) as Map<string, number>;
  assert.equal(depths.get('level-1'), 1);
  assert.equal(depths.get('level-2'), 2);
  assert.equal(depths.get('level-3'), 3);
});
