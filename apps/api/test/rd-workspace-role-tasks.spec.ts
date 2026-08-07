import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { runInRdWorkspace } from '../src/modules/research-development/rd-workspace.context';

type RecordValue = Record<string, unknown>;

function task(overrides: RecordValue): RecordValue {
  return {
    task_id: 'task-default',
    title: 'Default task',
    primary_owner: 'Current member',
    primary_owner_user_id: 'user-current',
    status: 'in_progress',
    progress: 35,
    final_priority: 'medium',
    category_path: 'Category / Subproject',
    due_date: '2026-08-18',
    collaborators: [],
    subtasks: [],
    ...overrides,
  };
}

function createWorkspaceService(categories: RecordValue[]) {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.readMergedTaskCategories = async () => categories;
  service.getProgressNoteMap = async () => ({});
  service.readValue = async (key: string) => key === 'rd.workspace'
    ? { todayTodos: [{ text: 'Existing collaboration todo', task_id: 'task-collab' }] }
    : {};
  service.getIdentityContext = async () => ({
    people: [{ id: 'person-current', name: 'Current member', user_id: 'user-current' }],
    users: [{ id: 'user-current', name: 'Current member' }],
  });
  service.collectInboxMessagesAsNotifications = async () => [];
  return service;
}

test('personal workspace returns separate primary and assist task sets without duplicates', async () => {
  const ownedTask = task({
    task_id: 'task-owned',
    title: 'Owned task',
    due_date: '',
    collaborators: [{ id: 'person-current', name: 'Current member', user_id: 'user-current', role: 'Collaborator' }],
  });
  const collaboratorTask = task({
    task_id: 'task-collab',
    title: 'Assisted task',
    primary_owner: 'Another member',
    primary_owner_user_id: 'user-other',
    collaborators: [{ id: 'person-current', name: 'Current member', user_id: 'user-current', role: 'Collaborator' }],
  });
  const categories = [
    { id: 'cat-workspace', label: 'Workspace category', children: [{ id: 'sub-workspace', label: 'Subproject', tasks: [ownedTask, collaboratorTask] }] },
  ];
  const service = createWorkspaceService(categories);

  const personal = await runInRdWorkspace('rd', () => service.getWorkspace('user-current', 'Current member')) as {
    myTasks: Array<{ task_id: string }>;
    collabTasks: Array<{ task_id: string }>;
    todayTodos: Array<{ task_id?: string }>;
  };
  assert.deepEqual(personal.myTasks.map((item) => item.task_id), ['task-owned']);
  assert.deepEqual(personal.collabTasks.map((item) => item.task_id), ['task-collab']);
  assert.equal(personal.collabTasks.some((item) => item.task_id === 'task-owned'), false);
  assert.deepEqual(personal.todayTodos.map((item) => item.task_id), ['task-collab']);

  const collaboration = await runInRdWorkspace('us-collab', () => service.getWorkspace('user-current', 'Current member')) as {
    collabTasks: Array<{ task_id: string }>;
  };
  assert.deepEqual(collaboration.collabTasks.map((item) => item.task_id), ['task-collab']);
});
