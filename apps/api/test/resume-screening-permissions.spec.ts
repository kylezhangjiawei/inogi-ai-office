import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { ResumeScreeningController } from '../src/modules/resume-screening/resume-screening.controller';
import { ResumeScreeningService } from '../src/modules/resume-screening/resume-screening.service';

function allowed(method: keyof ResumeScreeningController, permissions?: string[]) {
  return new RolesGuard(new Reflector()).canActivate({
    getHandler: () => ResumeScreeningController.prototype[method],
    getClass: () => ResumeScreeningController,
    switchToHttp: () => ({ getRequest: () => ({ user: permissions ? { permissions } : undefined }) }),
  } as unknown as ExecutionContext);
}

test('招聘业务接口拒绝没有业务权限的登录账号，公开探活和公钥仍可访问', () => {
  const methods = Object.getOwnPropertyNames(ResumeScreeningController.prototype)
    .filter((name) => !['constructor', 'getHealth', 'getSecurityPublicKey'].includes(name));
  for (const method of methods) {
    assert.equal(allowed(method as keyof ResumeScreeningController, []), false, method);
    assert.equal(allowed(method as keyof ResumeScreeningController, ['*']), true, method);
  }
  assert.equal(allowed('getHealth'), true);
  assert.equal(allowed('getSecurityPublicKey'), true);
});

test('招聘查看权限不能清空、删除、上传或执行筛选，对应操作权限可以执行', () => {
  for (const method of ['listCandidates', 'getCandidateDetail', 'listMailConfigs', 'listOpenAiConfigs'] as const) {
    assert.equal(allowed(method, ['page:resume-screening']), true);
  }
  const cases = [
    ['clearCandidates', 'resume:delete'], ['deleteCandidate', 'resume:delete'],
    ['uploadResumeFiles', 'resume:upload'], ['runMailSync', 'resume:screen'],
    ['applyCandidateAiUpdate', 'resume:screen'], ['saveMailSyncSchedule', 'resume:screen'],
    ['createCandidateFilterTask', 'resume:screen'], ['getCandidateFilterTask', 'resume:screen'],
    ['saveMailConfig', 'page:mailbox-management'], ['saveOpenAiConfig', 'page:ai-model-management'],
  ] as const;
  for (const [method, permission] of cases) {
    assert.equal(allowed(method, ['page:resume-screening']), false, method);
    assert.equal(allowed(method, [permission]), true, method);
  }
});

test('招聘配置删除按配置类型校验管理权限，禁止删除其他模块配置', async () => {
  const configs = new Map([
    ['mail', { id: 'mail', kind: 'mail' }],
    ['model', { id: 'model', kind: 'openai' }],
    ['expense', { id: 'expense', kind: 'expense_wecom' }],
  ]);
  const deleted: string[] = [];
  const service = new ResumeScreeningService({ integrationConfig: {
    findUnique: async ({ where }: { where: { id: string } }) => configs.get(where.id),
    delete: async ({ where }: { where: { id: string } }) => { deleted.push(where.id); },
  } } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  await assert.rejects(service.deleteIntegrationConfig('mail', ['page:ai-model-management']), ForbiddenException);
  await assert.rejects(service.deleteIntegrationConfig('model', ['page:mailbox-management']), ForbiddenException);
  await assert.rejects(service.deleteIntegrationConfig('expense', ['*']), NotFoundException);
  await assert.rejects(service.deleteIntegrationConfig('missing', ['*']), NotFoundException);
  assert.deepEqual(deleted, []);
  await service.deleteIntegrationConfig('mail', ['page:mailbox-management']);
  await service.deleteIntegrationConfig('model', ['page:ai-model-management']);
  assert.deepEqual(deleted, ['mail', 'model']);
});
