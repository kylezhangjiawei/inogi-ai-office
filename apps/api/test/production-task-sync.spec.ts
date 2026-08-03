import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import { DEFAULT_PERMISSION_CATALOG } from '../src/modules/permission-catalog/permission-catalog.defaults';
import {
  buildProductionMirrorTask,
  isProductionMirrorTask,
  mergeProductionMirrorTasks,
} from '../src/modules/research-development/production-task-sync';
import {
  currentRdWorkspace,
  isWorkspaceAllowed,
  resolveRdStoreKey,
  runInRdWorkspace,
} from '../src/modules/research-development/rd-workspace.context';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

test('production discussion proxy declares a stable object return type for watch compilation', () => {
  const serviceSource = readFileSync(
    resolve(__dirname, '../src/modules/research-development/research-development.service.ts'),
    'utf8',
  );
  assert.match(serviceSource, /async getTaskDiscussion\([\s\S]*?\): Promise<TaskDiscussionResponse> \{/);
});

test('production workspace has an isolated task store and only accepts its page permission', async () => {
  await runInRdWorkspace('production', async () => {
    assert.equal(resolveRdStoreKey('rd.taskCategories'), 'rdws.production.taskCategories');
  });

  assert.equal(isWorkspaceAllowed('production', ['page:rd-director-dashboard']), true);
  assert.equal(isWorkspaceAllowed('production', ['page:rd-task-management']), false);
  assert.equal(isWorkspaceAllowed('rd', ['page:rd-director-dashboard']), false);
  assert.equal(isWorkspaceAllowed('rd', ['page:rd-task-management']), true);

  const permission = DEFAULT_PERMISSION_CATALOG.find((item) => item.code === 'rd-task:sync-production');
  assert.ok(permission);
  assert.equal(permission.type, 'action');
  assert.equal(permission.groupLabel, '操作权限 · 研发任务管理');
});

test('production mirror marks the full task tree read-only and keeps source identity', () => {
  const mirrored = buildProductionMirrorTask(
    {
      task_id: 'rd-parent',
      title: '研发父任务',
      status: 'in_progress',
      subtasks: [{ task_id: 'rd-child', title: '研发子任务', status: 'draft' }],
    },
    {
      rootTaskId: 'rd-parent',
      syncedAt: '2026-08-03T08:00:00.000Z',
    },
  );

  assert.equal(isProductionMirrorTask(mirrored), true);
  assert.deepEqual(mirrored.production_sync, {
    source_workspace: 'rd',
    source_task_id: 'rd-parent',
    root_source_task_id: 'rd-parent',
    synced_at: '2026-08-03T08:00:00.000Z',
    read_only: true,
  });
  const child = (mirrored.subtasks as Array<Record<string, unknown>>)[0];
  assert.equal(isProductionMirrorTask(child), true);
  assert.equal((child.production_sync as Record<string, unknown>).source_task_id, 'rd-child');
  assert.equal((child.production_sync as Record<string, unknown>).root_source_task_id, 'rd-parent');
});

test('mirror refresh is idempotent, updates snapshots, preserves native tasks, and removes revoked mirrors', () => {
  const existing = [{
    id: 'system-a',
    label: '系统 A',
    children: [{
      id: 'part-a',
      label: '部件 A',
      tasks: [
        { task_id: 'production-native', title: '生产原生任务' },
        buildProductionMirrorTask(
          { task_id: 'rd-task', title: '旧标题' },
          { rootTaskId: 'rd-task', syncedAt: '2026-08-02T08:00:00.000Z' },
        ),
      ],
    }],
  }];

  const refreshed = mergeProductionMirrorTasks(existing, [{
    categoryId: 'system-a',
    categoryLabel: '系统 A',
    subProjectId: 'part-a',
    subProjectLabel: '部件 A',
    task: buildProductionMirrorTask(
      { task_id: 'rd-task', title: '新标题' },
      { rootTaskId: 'rd-task', syncedAt: '2026-08-03T08:00:00.000Z' },
    ),
  }]);

  const refreshedTasks = (refreshed[0].children as Array<Record<string, unknown>>)[0]
    .tasks as Array<Record<string, unknown>>;
  assert.deepEqual(refreshedTasks.map((task) => task.task_id), ['production-native', 'rd-task']);
  assert.equal(refreshedTasks[1].title, '新标题');

  const repeated = mergeProductionMirrorTasks(refreshed, [{
    categoryId: 'system-a',
    categoryLabel: '系统 A',
    subProjectId: 'part-a',
    subProjectLabel: '部件 A',
    task: refreshedTasks[1],
  }]);
  assert.deepEqual(repeated, refreshed);

  const revoked = mergeProductionMirrorTasks(refreshed, []);
  const revokedTasks = (revoked[0].children as Array<Record<string, unknown>>)[0]
    .tasks as Array<Record<string, unknown>>;
  assert.deepEqual(revokedTasks.map((task) => task.task_id), ['production-native']);
});

test('backend write guard rejects a production mirror even for privileged callers', () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  const mirror = buildProductionMirrorTask(
    { task_id: 'rd-task', title: '研发任务' },
    { rootTaskId: 'rd-task', syncedAt: '2026-08-03T08:00:00.000Z' },
  );

  assert.throws(
    () => service.assertTaskWritable(mirror),
    (error: unknown) => error instanceof ForbiddenException
      && error.message.includes('只读'),
  );
  assert.doesNotThrow(() => service.assertTaskWritable({ task_id: 'production-native' }));
});

test('service refresh writes the latest task, notes, and score only into production stores', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  const sourceTask = {
    task_id: 'rd-task',
    title: '研发最新标题',
    status: 'completed',
    subtasks: [{ task_id: 'rd-child', title: '研发子任务', status: 'completed' }],
  };
  const sourceTree = [{
    id: 'system-a',
    label: '系统 A',
    children: [{ id: 'part-a', label: '部件 A', tasks: [sourceTask] }],
  }];
  const productionTree = [{
    id: 'system-a',
    label: '系统 A',
    children: [{ id: 'part-a', label: '部件 A', tasks: [{ task_id: 'production-native', title: '生产原生任务' }] }],
  }];
  const writes: Array<{ key: string; value: unknown }> = [];

  service.productionMirrorRefreshLock = Promise.resolve();
  service.taskTreeWriteLock = Promise.resolve();
  service.readProductionSyncRegistry = async () => ({
    'rd-task': {
      task_id: 'rd-task',
      active: true,
      first_synced_at: '2026-08-03T08:00:00.000Z',
      synced_at: '2026-08-03T08:00:00.000Z',
      synced_by_id: 'user-rd',
      synced_by_name: '研发成员',
      revoked_at: null,
      revoked_by_id: null,
      revoked_by_name: null,
    },
    'rd-child': {
      task_id: 'rd-child',
      active: true,
      first_synced_at: '2026-08-03T08:05:00.000Z',
      synced_at: '2026-08-03T08:05:00.000Z',
      synced_by_id: 'user-rd',
      synced_by_name: '研发成员',
      revoked_at: null,
      revoked_by_id: null,
      revoked_by_name: null,
    },
  });
  service.readAllTaskTrees = async () => ({
    trees: new Map([['prod-portable-o2', sourceTree]]),
    store: {},
  });
  service.getProgressNoteMap = async () => ({
    'rd-task': [{ id: 'note-parent', text: '最新进展' }],
    'rd-child': [{ id: 'note-child', text: '子任务进展' }],
  });
  service.readNormalizedTaskCategories = async () => {
    assert.equal(currentRdWorkspace(), 'production');
    return productionTree;
  };
  service.readValue = async (key: string) => {
    if (currentRdWorkspace() === 'rd') {
      assert.equal(key, 'rd.taskCompletionScores');
      return { 'rd-task': { total: 95 }, 'rd-child': { total: 90 } };
    }
    if (key === 'rd.taskProgressNotes') return {};
    if (key === 'rd.taskCompletionScores') return {};
    throw new Error(`unexpected production read: ${key}`);
  };
  service.buildSettingUpsert = (key: string, value: unknown) => ({ key, value });
  service.prisma = {
    $transaction: async (operations: Array<{ key: string; value: unknown }>) => {
      assert.equal(currentRdWorkspace(), 'production');
      writes.push(...operations);
      return operations;
    },
  };
  service.invalidateCachedStoreValues = () => undefined;

  await service.refreshProductionMirrors();

  const taskWrite = writes.find((write) => write.key === 'rd.taskCategories');
  const noteWrite = writes.find((write) => write.key === 'rd.taskProgressNotes');
  const scoreWrite = writes.find((write) => write.key === 'rd.taskCompletionScores');
  assert.ok(taskWrite);
  assert.ok(noteWrite);
  assert.ok(scoreWrite);
  const tasks = (((taskWrite.value as Array<Record<string, unknown>>)[0].children as Array<Record<string, unknown>>)[0]
    .tasks as Array<Record<string, unknown>>);
  assert.deepEqual(tasks.map((task) => task.task_id), ['production-native', 'rd-task']);
  assert.equal(tasks[1].title, '研发最新标题');
  assert.equal(((tasks[1].subtasks as Array<Record<string, unknown>>)[0]).task_id, 'rd-child');
  assert.deepEqual(Object.keys(noteWrite.value as Record<string, unknown>).sort(), ['rd-child', 'rd-task']);
  assert.deepEqual(Object.keys(scoreWrite.value as Record<string, unknown>).sort(), ['rd-child', 'rd-task']);
});
