import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

type RecordValue = Record<string, unknown>;

function relationCategories(): RecordValue[] {
  return [{
    id: 'category',
    children: [{
      id: 'project',
      tasks: [{
        task_id: 'task-root',
        title: 'Root',
        primary_owner: 'Root owner',
        primary_owner_user_id: 'user-root',
        collaborators: [],
        subtasks: [{
          task_id: 'task-child',
          title: 'Child',
          primary_owner: 'Child owner',
          primary_owner_user_id: 'user-child',
          collaborators: [],
          subtasks: [{
            task_id: 'task-grandchild',
            title: 'Grandchild',
            primary_owner: 'Grandchild owner',
            primary_owner_user_id: 'user-grandchild',
            collaborators: [],
            subtasks: [],
          }],
        }],
      }],
    }],
  }];
}

test('merged task unread summary is aggregated onto the relation root', async () => {
  const categories = relationCategories();
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.getProgressNoteMap = async () => ({
    'task-child': [{
      id: 'note-child',
      created_at: '2026-08-11T10:00:00.000Z',
      actor: { id: 'user-other', name: 'Other' },
    }],
    'task-grandchild': [{
      id: 'note-grandchild',
      created_at: '2026-08-11T10:05:00.000Z',
      actor: { id: 'user-other', name: 'Other' },
    }],
  });
  service.readValue = async () => ({
    'user-viewer': { _baseline: '2026-08-11T09:00:00.000Z' },
  });
  service.getMergedTaskCategories = async () => categories;
  service.getDiscussionUnreadSummary = async () => ({
    'task-child': 2,
    'task-grandchild': 1,
  });

  const result = await service.getNoteUnreadSummary({
    userId: 'user-viewer',
    userName: 'Viewer',
    canAccessAny: true,
  });

  assert.deepEqual(result, { 'task-root': 5 });
});

test('opening any merged task marks the entire relation group read', async () => {
  const categories = relationCategories();
  let stored: RecordValue = {
    'user-viewer': {
      _baseline: '2026-08-11T09:00:00.000Z',
      'task-unrelated': '2026-08-11T09:30:00.000Z',
    },
  };
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.getMergedTaskCategories = async () => categories;
  service.withProgressNoteLock = async (run: () => Promise<void>) => run();
  service.readValue = async () => stored;
  service.writeValue = async (_key: string, value: RecordValue) => {
    stored = value;
  };

  const result = await service.markTaskNotesRead('task-child', { userId: 'user-viewer' });
  const mine = stored['user-viewer'] as RecordValue;

  assert.deepEqual(result, { ok: true });
  assert.equal(typeof mine['task-root'], 'string');
  assert.equal(mine['task-root'], mine['task-child']);
  assert.equal(mine['task-child'], mine['task-grandchild']);
  assert.equal(mine['task-unrelated'], '2026-08-11T09:30:00.000Z');
  assert.equal(mine._baseline, '2026-08-11T09:00:00.000Z');
});
