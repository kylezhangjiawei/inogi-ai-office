import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isDiscussionCapabilityPath,
  isWorkspaceAllowed,
  isWorkspaceExemptPath,
  requestPathOnly,
} from '../src/modules/research-development/rd-workspace.context';

/**
 * 池级准入的豁免匹配必须只看路径。历史实现直接匹配 req.url（含查询串），
 * 任意 `?x=/messages` 参数即可伪造豁免、跳过 isWorkspaceAllowed，造成双向跨池越权。
 */

const COLLAB_ADMIN = ['page:us-collab-cockpit', 'page:us-collab-workspace', 'rd-people:manage', 'rd-task:reassign'];
const RD_ENGINEER = ['page:rd-task-management', 'page:rd-my-workspace', 'rd-task:edit'];

/** 复刻 RdWorkspaceInterceptor 的判定顺序，返回该请求最终落到哪个池，或 'denied'。 */
function admissionOutcome(url: string, permissions: string[]): string {
  const path = requestPathOnly(url);
  const raw = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '').get('workspace');
  const workspace = raw && raw.trim() ? raw.trim() : 'rd';
  if (isWorkspaceExemptPath(path)) return 'rd';
  const discussionCapability = isDiscussionCapabilityPath(path);
  if (!discussionCapability && !isWorkspaceAllowed(workspace, permissions)) return 'denied';
  return workspace;
}

test('requestPathOnly strips the query string and hash', () => {
  assert.equal(requestPathOnly('/api/research-development/snapshot'), '/api/research-development/snapshot');
  assert.equal(requestPathOnly('/api/research-development/snapshot?workspace=us-collab'), '/api/research-development/snapshot');
  assert.equal(requestPathOnly('/api/research-development/snapshot?x=/messages'), '/api/research-development/snapshot');
  assert.equal(requestPathOnly('/api/research-development/snapshot#/messages'), '/api/research-development/snapshot');
});

test('message exemption matches only the controller-owned messages routes', () => {
  for (const path of [
    '/api/research-development/messages',
    '/api/research-development/messages/msg-1',
  ]) {
    assert.equal(isWorkspaceExemptPath(path), true, path);
  }
  // 讨论回复同样以 /messages 结尾，但它属于讨论线程，必须留在各自工作区，不能落到默认池
  assert.equal(isWorkspaceExemptPath('/api/research-development/task-discussions/TASK-1/messages'), false);
  assert.equal(isWorkspaceExemptPath('/api/research-development/snapshot'), false);
});

test('discussion capability matches only real task-discussion routes', () => {
  for (const path of [
    '/api/research-development/task-discussions/TASK-1',
    '/api/research-development/task-discussions/TASK-1/messages',
    '/api/research-development/task-discussions/TASK-1/read',
  ]) {
    assert.equal(isDiscussionCapabilityPath(path), true, path);
  }
  assert.equal(isDiscussionCapabilityPath('/api/research-development/snapshot'), false);
  assert.equal(isDiscussionCapabilityPath('/api/research-development/task-discussions'), false);
});

test('query-string forgery can no longer buy an exemption', () => {
  for (const url of [
    '/api/research-development/snapshot?x=/messages',
    '/api/research-development/snapshot?x=/messages&y=1',
    '/api/research-development/snapshot?x=/task-discussions/a',
    '/api/research-development/task-categories?workspace=us-collab&x=/task-discussions/a',
  ]) {
    const path = requestPathOnly(url);
    assert.equal(isWorkspaceExemptPath(path), false, url);
    assert.equal(isDiscussionCapabilityPath(path), false, url);
  }
});

test('collab-only admin cannot reach the rd pool by forging an exemption', () => {
  assert.equal(admissionOutcome('/api/research-development/snapshot', COLLAB_ADMIN), 'denied');
  assert.equal(admissionOutcome('/api/research-development/snapshot?workspace=rd', COLLAB_ADMIN), 'denied');
  assert.equal(admissionOutcome('/api/research-development/snapshot?x=/messages', COLLAB_ADMIN), 'denied');
  assert.equal(admissionOutcome('/api/research-development/snapshot?x=/task-discussions/a', COLLAB_ADMIN), 'denied');
});

test('rd-only engineer cannot reach the us-collab pool by forging an exemption', () => {
  assert.equal(admissionOutcome('/api/research-development/snapshot?workspace=us-collab', RD_ENGINEER), 'denied');
  assert.equal(
    admissionOutcome('/api/research-development/snapshot?workspace=us-collab&x=/task-discussions/a', RD_ENGINEER),
    'denied',
  );
  assert.equal(
    admissionOutcome('/api/research-development/task-categories?workspace=us-collab&x=/task-discussions/a', RD_ENGINEER),
    'denied',
  );
});

test('legitimate routes keep their intended admission behaviour', () => {
  // 消息端点：任意可登录研发/协同页面的用户都以默认池读写自己的消息
  assert.equal(admissionOutcome('/api/research-development/messages', COLLAB_ADMIN), 'rd');
  assert.equal(admissionOutcome('/api/research-development/messages?workspace=us-collab', COLLAB_ADMIN), 'rd');
  // 讨论线程：跳过整池页面码门禁，但保留请求的工作区上下文（service 再按成员/受邀人精确校验）
  assert.equal(
    admissionOutcome('/api/research-development/task-discussions/TASK-1?workspace=us-collab', RD_ENGINEER),
    'us-collab',
  );
  assert.equal(
    admissionOutcome('/api/research-development/task-discussions/TASK-1/messages?workspace=us-collab', COLLAB_ADMIN),
    'us-collab',
  );
  // 正常路径：持有本池页面码即放行
  assert.equal(admissionOutcome('/api/research-development/snapshot', RD_ENGINEER), 'rd');
  assert.equal(admissionOutcome('/api/research-development/snapshot?workspace=us-collab', COLLAB_ADMIN), 'us-collab');
});

test('workspace admission rules for the four documented roles are unchanged', () => {
  const collabKbAdmin = ['page:dept-kb-us-collab', 'rd-people:manage'];
  const legacyPeopleOnly = ['rd-people:manage'];

  assert.equal(isWorkspaceAllowed('us-collab', COLLAB_ADMIN), true);
  assert.equal(isWorkspaceAllowed('rd', COLLAB_ADMIN), false);
  assert.equal(isWorkspaceAllowed('rd', [...RD_ENGINEER, 'rd-people:manage']), true);
  assert.equal(isWorkspaceAllowed('us-collab', [...RD_ENGINEER, 'rd-people:manage']), false);
  assert.equal(isWorkspaceAllowed('rd', collabKbAdmin), false);
  assert.equal(isWorkspaceAllowed('us-collab', collabKbAdmin), true);
  assert.equal(isWorkspaceAllowed('rd', legacyPeopleOnly), true);
  assert.equal(isWorkspaceAllowed('us-collab', legacyPeopleOnly), true);
  assert.equal(isWorkspaceAllowed('rd', ['*']), true);
});
