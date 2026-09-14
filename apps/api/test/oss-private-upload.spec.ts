import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { OssService } from '../src/modules/oss/oss.service';

type PutOptions = { mime: string; headers: Record<string, string> };
type PutCall = { key: string; buffer: Buffer; options: PutOptions };
type FakeClient = { put: (key: string, buffer: Buffer, options: PutOptions) => Promise<void> };

function makeClient(calls: PutCall[], fail = false): FakeClient {
  return { put: async (key, buffer, options) => {
    calls.push({ key, buffer, options });
    if (fail) throw new Error('Synthetic upload failure');
  } };
}

function makeService(internal: FakeClient | null, fallback: FakeClient | null = internal) {
  // Do not initialize the SDK or read environment configuration: every upload stays in memory.
  const service = new OssService({ get: () => undefined } as never);
  Object.assign(service, {
    internalClient: internal,
    publicClient: fallback,
    logger: { log() {}, warn() {}, error() {} },
  });
  return service;
}

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'x-oss-object-acl': 'private' };

test('private uploads explicitly set object ACL and disable caching', async () => {
  const calls: PutCall[] = [];
  const fallbackCalls: PutCall[] = [];
  const service = makeService(makeClient(calls), makeClient(fallbackCalls));
  const bytes = Buffer.from('synthetic attachment');
  const key = await service.uploadBuffer(bytes, 'applicant-forms/template/session', 'file.pdf', 'application/pdf', { private: true });

  assert.equal(calls.length, 1);
  assert.equal(fallbackCalls.length, 0);
  assert.equal(key, calls[0].key);
  assert.match(key ?? '', /^prod\/applicant-forms\/template\/session\//);
  assert.equal(calls[0].buffer, bytes);
  assert.equal(calls[0].options.mime, 'application/pdf');
  assert.deepEqual(calls[0].options.headers, PRIVATE_HEADERS);
});

test('fallback uploads preserve private ACL, cache policy, content and object key', async () => {
  const internalCalls: PutCall[] = [];
  const publicCalls: PutCall[] = [];
  const service = makeService(makeClient(internalCalls, true), makeClient(publicCalls));
  const bytes = Buffer.from('synthetic photo');
  const key = await service.uploadBuffer(bytes, 'applicant-forms/template/session', 'photo.png', undefined, { private: true });

  assert.equal(internalCalls.length, 1);
  assert.equal(publicCalls.length, 1);
  assert.equal(key, internalCalls[0].key);
  assert.equal(publicCalls[0].key, key);
  assert.equal(publicCalls[0].buffer, bytes);
  for (const call of [...internalCalls, ...publicCalls]) {
    assert.equal(call.options.mime, 'image/png');
    assert.deepEqual(call.options.headers, PRIVATE_HEADERS);
  }
});

test('existing callers keep their default cache policy and do not override object ACL', async () => {
  const calls: PutCall[] = [];
  const service = makeService(makeClient(calls));
  await service.uploadBuffer(Buffer.from('legacy'), 'rd', 'legacy.pdf');
  await service.uploadBuffer(Buffer.from('explicit'), 'rd', 'explicit.pdf', 'application/pdf', { private: false });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.mime, 'application/pdf');
    assert.deepEqual(call.options.headers, { 'Cache-Control': 'public, max-age=31536000, immutable' });
    assert.equal(Object.prototype.hasOwnProperty.call(call.options.headers, 'x-oss-object-acl'), false);
  }
});

test('private uploads return null when disabled or when every endpoint fails', async () => {
  const bytes = Buffer.from('synthetic attachment');
  assert.equal(await makeService(null).uploadBuffer(bytes, 'applicant-forms', 'file.pdf', undefined, { private: true }), null);
  const internalCalls: PutCall[] = [];
  const publicCalls: PutCall[] = [];
  const service = makeService(makeClient(internalCalls, true), makeClient(publicCalls, true));
  assert.equal(await service.uploadBuffer(bytes, 'applicant-forms', 'file.pdf', undefined, { private: true }), null);
  assert.equal(internalCalls.length, 1);
  assert.equal(publicCalls.length, 1);
  assert.deepEqual(internalCalls[0].options.headers, PRIVATE_HEADERS);
  assert.deepEqual(publicCalls[0].options.headers, PRIVATE_HEADERS);
});
