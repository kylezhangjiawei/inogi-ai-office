import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { Logger, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { createAccessCredentialVersion } from '../src/modules/auth/access-credential-version';
import { PermissionCatalogService } from '../src/modules/permission-catalog/permission-catalog.service';
import { FileAccessFailureDto } from '../src/modules/files/dto/file-access-failure.dto';
import { FilesController } from '../src/modules/files/files.controller';
import { FilesService } from '../src/modules/files/files.service';

function harness(t: TestContext) {
  const service = new FilesService({} as never, {} as never);
  const entries: unknown[] = [];
  const internals = service as unknown as { logger: Logger; accessFailureWindows: Map<string, number> };
  t.mock.method(internals.logger, 'warn', (entry: unknown) => { entries.push(entry); });
  return { service, entries, windows: internals.accessFailureWindows };
}

// In-memory HTTP transport still traverses Express parsing, real Passport JWT
// verification, Nest guards, DTO validation and the real files controller/service.
async function request(server: Server, body: unknown, token?: string) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  const req = new IncomingMessage(socket as Socket);
  req.method = 'POST';
  req.url = '/api/files/access-failures';
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  req.complete = true;
  const encoded = Buffer.from(JSON.stringify(body));
  req.headers = {
    host: 'files-logging-test.invalid', connection: 'close',
    'content-type': 'application/json', 'content-length': String(encoded.length),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const res = new ServerResponse(req);
  res.assignSocket(socket as Socket);
  const finished = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('In-memory files request stalled')), 2000);
    res.once('finish', () => { clearTimeout(timeout); resolve(); });
    res.once('error', (error) => { clearTimeout(timeout); reject(error); });
  });
  req.push(encoded);
  req.push(null);
  server.emit('request', req, res);
  await finished;
  const response = Buffer.concat(chunks).toString('utf8');
  socket.destroy();
  return { status: res.statusCode, body: response.slice(response.indexOf('\r\n\r\n') + 4) };
}

test('access failure HTTP endpoint requires a current authenticated user and returns empty 204 responses', async (t) => {
  const { service, entries } = harness(t);
  const jwtSecret = 'synthetic-files-access-test-secret';
  const passwordHash = 'synthetic-files-access-password-hash';
  const module = await Test.createTestingModule({
    imports: [PassportModule, JwtModule.register({ secret: jwtSecret })],
    controllers: [FilesController],
    providers: [
      { provide: FilesService, useValue: service },
      { provide: PrismaService, useValue: { user: { findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'missing' ? null : { id: where.id, passwordHash, status: where.id === 'disabled' ? 'DISABLED' : 'ACTIVE', role: null },
      } } },
      { provide: PermissionCatalogService, useValue: { filterDisabled: async () => [] } },
      { provide: ConfigService, useValue: { getOrThrow: () => jwtSecret } },
      JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  try {
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    const server = app.getHttpServer() as Server;
    const jwt = module.get(JwtService);
    const sign = (sub: string, expiresIn = 600) => jwt.sign({
      sub, credentialVersion: createAccessCredentialVersion(jwtSecret, sub, passwordHash),
    }, { expiresIn });
    const token = sign('user-1');
    for (const unauthorizedToken of [undefined, 'invalid-token', sign('user-1', -1),
      sign('missing'), sign('disabled'), jwt.sign({ sub: 'user-1' })]) {
      assert.equal((await request(server, { stage: 'load', status: 403 }, unauthorizedToken)).status, 401);
    }
    assert.deepEqual(entries, []);

    for (const body of [
      {}, { stage: 'unknown' }, { stage: 'LOAD' }, { stage: null }, { stage: ['load'] },
      ...[null, '403', 99, 600, 403.5, {}, true].map((status) => ({ stage: 'load', status })),
      ...['url', 'key', 'message', 'userId'].map((field) => ({ stage: 'load', [field]: 'private-value' })),
      { stage: 'load', status: 403, extra: { url: 'https://example.invalid/?auth_key=private' } },
    ]) {
      assert.equal((await request(server, body, token)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(entries, [], 'Rejected payloads must never reach the application logger');

    for (const body of [{ stage: 'load' }, { stage: 'renew', status: 100 }, { stage: 'download', status: 599 },
      { stage: 'load', status: 403 }]) {
      assert.deepEqual(await request(server, body, token), { status: 204, body: '' });
    }
    assert.deepEqual(entries, [
      { event: 'file_access_failure', stage: 'load' },
      { event: 'file_access_failure', stage: 'renew', status: 100 },
      { event: 'file_access_failure', stage: 'download', status: 599 },
    ]);
  } finally {
    await app.close();
  }
});

test('controller and service also reject missing users without relying on a bypassable request field', (t) => {
  const { service, entries } = harness(t);
  const controller = new FilesController(service);
  for (const req of [{}, { user: {} }, { body: { userId: 'forged-user' } }]) {
    assert.throws(() => controller.reportAccessFailure(req as never, { stage: 'load' }), UnauthorizedException);
  }
  assert.throws(() => service.reportAccessFailure('', { stage: 'load' }), UnauthorizedException);
  controller.reportAccessFailure({ user: { sub: 'user-sub' } } as never, { stage: 'load' });
  assert.equal(entries.length, 1);
});

test('logging uses a fixed field whitelist and throttles per user/stage for exactly one minute', (t) => {
  const { service, entries } = harness(t);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const malicious = { stage: 'load', status: 403, url: 'https://example.invalid/?auth_key=secret',
    message: 'URL and credentials must not be logged', key: 'private-key' } as FileAccessFailureDto;
  service.reportAccessFailure('user-1', malicious);
  service.reportAccessFailure('user-1', { stage: 'load', status: 404 });
  now += 59_999;
  service.reportAccessFailure('user-1', { stage: 'load' });
  assert.deepEqual(entries, [{ event: 'file_access_failure', stage: 'load', status: 403 }]);
  service.reportAccessFailure('user-2', { stage: 'load' });
  service.reportAccessFailure('user-1', { stage: 'renew' });
  assert.equal(entries.length, 3);
  now += 1;
  service.reportAccessFailure('user-1', { stage: 'load', status: 401 });
  assert.equal(entries.length, 4);
  assert.doesNotMatch(JSON.stringify(entries), /https:|auth_key|private-key|credentials|user-1/);
});

test('rate-limit storage is bounded and a full map cannot evict active limits to reset quotas', (t) => {
  const { service, entries, windows } = harness(t);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  for (let index = 0; index < 10_000; index++) service.reportAccessFailure(`user-${index}`, { stage: 'load' });
  assert.equal(windows.size, 10_000);
  service.reportAccessFailure('overflow', { stage: 'load' });
  service.reportAccessFailure('user-0', { stage: 'load' });
  assert.equal(windows.size, 10_000);
  assert.equal(entries.length, 10_000);
  now += 60_000;
  service.reportAccessFailure('overflow', { stage: 'load' });
  assert.equal(windows.size, 1, 'Expired windows are reclaimed when capacity is needed');
  service.reportAccessFailure('user-0', { stage: 'load' });
  assert.equal(entries.length, 10_002);
});
