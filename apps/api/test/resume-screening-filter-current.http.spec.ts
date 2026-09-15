import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { createAccessCredentialVersion } from '../src/modules/auth/access-credential-version';
import { PermissionCatalogService } from '../src/modules/permission-catalog/permission-catalog.service';
import { ResumeScreeningController } from '../src/modules/resume-screening/resume-screening.controller';
import { ResumeScreeningService } from '../src/modules/resume-screening/resume-screening.service';

// Exercise Nest's real Express response adapter over loopback HTTP. Mock only
// business/data services: these tests never start a worker or contact DB/AI.
async function fixture(t: TestContext, result: unknown = null) {
  const calls: string[] = [];
  const secret = 'synthetic-resume-current-http-test-secret';
  const passwordHash = 'synthetic-resume-current-password-hash';
  const module = await Test.createTestingModule({
    imports: [PassportModule, JwtModule.register({ secret })],
    controllers: [ResumeScreeningController],
    providers: [
      { provide: ResumeScreeningService, useValue: {
        getCurrentCandidateFilterTask: async (userId: string) => { calls.push(userId); return result; },
      } },
      { provide: PrismaService, useValue: { user: { findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id, passwordHash, status: 'ACTIVE',
        role: { permissions: where.id === 'view-only' ? ['page:resume-screening'] : ['resume:screen'] },
      }) } } },
      { provide: PermissionCatalogService, useValue: { filterDisabled: async (permissions: string[]) => permissions } },
      { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  t.after(() => app.close());
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/recruitment/candidate-filter-tasks/current`;
  const jwt = module.get(JwtService);
  const request = (userId?: string, suffix = '') => fetch(`${url}${suffix}`, {
    headers: userId ? { authorization: `Bearer ${jwt.sign({
      sub: userId, credentialVersion: createAccessCredentialVersion(secret, userId, passwordHash),
    }, { expiresIn: 600 })}` } : {},
    signal: AbortSignal.timeout(3000),
  });
  return { calls, request };
}

test('current-task HTTP returns JSON null when this account has no task', async (t) => {
  const f = await fixture(t);
  const response = await f.request('user-with-no-task');
  const body = await response.clone().text();
  t.diagnostic(`HTTP ${response.status}, body=${JSON.stringify(body)}, content-type=${response.headers.get('content-type')}`);
  assert.equal(response.status, 200);
  assert.equal(await response.json(), null, 'a fresh account must be readable with Response.json()');
  assert.equal(body, 'null');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(f.calls, ['user-with-no-task']);
});

test('current-task HTTP preserves the existing direct task response and no-store header', async (t) => {
  const task = {
    task_id: 'task-owned-by-user', status: 'processing', phase: 'scoring',
    processed_count: 16, total_count: 101, instruction: '优先美国市场经验',
    job_rule_id: 'job-1', base_version: null, retryable: false,
    created_at: '2026-09-10T00:00:00.000Z', updated_at: '2026-09-10T00:01:00.000Z',
  };
  const f = await fixture(t, task);
  const response = await f.request('owner');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), task, 'do not wrap the task in a new envelope');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(f.calls, ['owner']);
});

test('current-task HTTP forwards only the verified account identity and keeps authentication/permissions', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request()).status, 401);
  assert.equal((await f.request('view-only')).status, 403);
  assert.deepEqual(f.calls, [], 'unauthorized requests must not reach the task service');
  const response = await f.request('authenticated-user', '?userId=other-account&sub=other-account');
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, ['authenticated-user']);
  await response.text();
});
