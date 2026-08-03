import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

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
