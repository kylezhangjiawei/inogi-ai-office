import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';

import { Permissions } from '../src/modules/auth/decorators/permissions.decorator';
import {
  checkAgentPermission,
  requiredPermissionsFor,
  satisfiesPermissions,
} from '../src/modules/chat/agent-permission';

/**
 * Agent 权限桥。这是整个「让 AI 操作系统」功能的安全核心：
 * 权限码必须从控制器方法上反射得到，注册表里不许手抄；拿不到声明就必须拒绝。
 *
 * 用真的 @Permissions 装饰器构造被测类，确保测的是与线上同一套元数据机制，
 * 而不是我自己造的假元数据。
 */

class FakeController {
  @Permissions('rd-task:edit', 'rd-project:direct')
  updateTask() {
    return 'updated';
  }

  /** 空参声明：RolesGuard 视为放行，Agent 必须视为拒绝 */
  @Permissions()
  markRead() {
    return 'read';
  }

  /** 完全没有声明的写端点，系统里有几十个 */
  writeAuditLog() {
    return 'logged';
  }
}

@Permissions('page:rd-cockpit')
class ClassLevelController {
  listTasks() {
    return [];
  }

  @Permissions('rd-task:reassign')
  reassign() {
    return 'ok';
  }
}

// ── 反射权限码 ───────────────────────────────────────────────────────────────

test('从方法上反射出它声明的权限码，不需要任何手抄', () => {
  assert.deepEqual(requiredPermissionsFor(FakeController, 'updateTask'), [
    'rd-task:edit',
    'rd-project:direct',
  ]);
});

test('方法没声明时回退类级声明，与 RolesGuard 同序', () => {
  assert.deepEqual(requiredPermissionsFor(ClassLevelController, 'listTasks'), ['page:rd-cockpit']);
});

test('方法级声明覆盖类级，与 RolesGuard 同序', () => {
  assert.deepEqual(requiredPermissionsFor(ClassLevelController, 'reassign'), ['rd-task:reassign']);
});

test('@Permissions() 空参返回 null——守卫放行，Agent 必须拒绝', () => {
  assert.equal(requiredPermissionsFor(FakeController, 'markRead'), null);
});

test('完全没有权限声明的方法返回 null', () => {
  assert.equal(requiredPermissionsFor(FakeController, 'writeAuditLog'), null);
});

test('方法不存在时返回 null，不抛异常', () => {
  assert.equal(requiredPermissionsFor(FakeController, 'noSuchMethod'), null);
});

// ── 判定逻辑与 RolesGuard 对齐 ───────────────────────────────────────────────

test('命中任意一个权限码即放行（OR 逻辑）', () => {
  assert.equal(satisfiesPermissions(['rd-project:direct'], ['rd-task:edit', 'rd-project:direct']), true);
  assert.equal(satisfiesPermissions(['rd-task:edit'], ['rd-task:edit', 'rd-project:direct']), true);
});

test('一个都没命中则拒绝', () => {
  assert.equal(satisfiesPermissions(['page:rd-my-workspace'], ['rd-task:edit']), false);
  assert.equal(satisfiesPermissions([], ['rd-task:edit']), false);
});

test('通配权限放行', () => {
  assert.equal(satisfiesPermissions(['*'], ['rd-task:edit']), true);
});

test('required 为空时拒绝——这是与 RolesGuard 刻意的差异', () => {
  // 守卫在「端点没声明要求」时放行；Agent 在「拿不到要求」时必须拒绝
  assert.equal(satisfiesPermissions(['*'], []), false);
  assert.equal(satisfiesPermissions(['rd-task:edit'], []), false);
});

// ── 统一入口 ─────────────────────────────────────────────────────────────────

test('有权限的用户放行，并回带实际生效的权限码供审计', () => {
  const verdict = checkAgentPermission(FakeController, 'updateTask', ['rd-task:edit']);

  assert.deepEqual(verdict, { allowed: true, required: ['rd-task:edit', 'rd-project:direct'] });
});

test('无权限的用户被拒，理由是 denied', () => {
  const verdict = checkAgentPermission(FakeController, 'updateTask', ['page:rd-my-workspace']);

  assert.equal(verdict.allowed, false);
  assert.equal(verdict.allowed === false && verdict.reason, 'denied');
});

test('没有权限声明的方法一律拒绝，哪怕请求者是超管', () => {
  // 这是失败关闭的关键：系统里几十个裸奔写端点靠这条挡在 Agent 之外，
  // 超管也不例外——不是因为超管不该做，而是因为我们无法确认这些端点的内部校验。
  for (const handler of ['markRead', 'writeAuditLog', 'noSuchMethod']) {
    const verdict = checkAgentPermission(FakeController, handler, ['*']);
    assert.equal(verdict.allowed, false, `${handler} 不该放行`);
    assert.equal(verdict.allowed === false && verdict.reason, 'undeclared');
  }
});

test('反射到的权限码与控制器声明逐字一致——防止有人在注册表里手抄走样', () => {
  const declared = requiredPermissionsFor(FakeController, 'updateTask');

  assert.deepEqual(declared, ['rd-task:edit', 'rd-project:direct']);
  assert.notEqual(declared, null);
});
