import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { ChatToolsService } from '../src/modules/chat/chat-tools.service';
import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { currentRdWorkspace, runInRdWorkspace } from '../src/modules/research-development/rd-workspace.context';

test('task creation endpoints accept proposal permission and pass a constrained actor policy', async () => {
  const createTaskPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ResearchDevelopmentController.prototype.createTask,
  ) as string[];
  const createSubtasksPermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ResearchDevelopmentController.prototype.createSubtasks,
  ) as string[];
  assert.ok(createTaskPermissions.includes('rd-project:propose'));
  assert.ok(createSubtasksPermissions.includes('rd-project:propose'));
  const saveTreePermissions = Reflect.getMetadata(
    PERMISSIONS_KEY,
    ResearchDevelopmentController.prototype.saveTaskCategories,
  ) as string[];
  assert.equal(saveTreePermissions.includes('rd-task:edit'), false);
  assert.equal(saveTreePermissions.includes('rd-task:create'), false);
  assert.ok(saveTreePermissions.includes('rd-project:direct'));

  let receivedActor: Record<string, unknown> | undefined;
  let receivedUpdateOptions: Record<string, unknown> | undefined;
  const controller = new ResearchDevelopmentController(
    {
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
  await controller.updateTask(
    'task-1',
    { title: '普通编辑' },
    { user: { id: 'user-1', name: '研发成员', permissions: ['page:rd-my-workspace', 'rd-task:edit'] } },
  );
  assert.equal(receivedUpdateOptions?.canEditAny, false);
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
    },
    { requesterUserId: 'user-a', canEditAny: false },
  );
  const task = ((categories[0].children as any[])[0].tasks as any[])[0];
  assert.equal(task.title, '合法标题');
  assert.equal(task.parent_task_id, 'parent-a');
  assert.deepEqual(task.subtasks, []);
  assert.equal(task.creation_request_scope, 'server-scope');
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
