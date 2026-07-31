import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { FilesService } from '../src/modules/files/files.service';

function makeHarness(options: { createError?: Error } = {}) {
  const deleted: string[] = [];
  const created: unknown[] = [];
  const objectKey = 'prod/assets/user-1/2026/07/31/key-report.pdf';
  const prisma = {
    fileAsset: {
      findUnique: async () => null,
      create: async ({ data }: { data: unknown }) => {
        created.push(data);
        if (options.createError) throw options.createError;
        return {
          id: 'file-1',
          objectKey,
          fileName: 'report.pdf',
          mimeType: 'application/pdf',
          fileSize: 42,
        };
      },
    },
  };
  const oss = {
    isEnabled: true,
    buildObjectKey: () => objectKey,
    generatePutSignedUrl: () => 'https://oss.example.com/signed-put',
    resolveKeyPrefix: (prefix: string) => `prod/${prefix}`,
    headObject: async () => ({ size: 42, contentType: 'application/pdf' }),
    getSignedUrl: () => 'https://oss.example.com/signed-get',
    deleteObject: async (key: string) => {
      deleted.push(key);
    },
  };
  return {
    service: new FilesService(prisma as never, oss as never),
    objectKey,
    created,
    deleted,
  };
}

test('presigns user-scoped direct uploads with immutable private browser caching', () => {
  const { service, objectKey } = makeHarness();
  const result = service.presignUpload('user-1', {
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 42,
    businessType: 'assets',
  });
  assert.equal(result.objectKey, objectKey);
  assert.equal(result.cacheControl, 'private, max-age=31536000, immutable');
  assert.match(result.putUrl, /^https:\/\/oss\.example\.com/);
});

test('registers a direct upload only after OSS size and content type verification', async () => {
  const { service, objectKey, created, deleted } = makeHarness();
  const result = await service.registerUpload('user-1', {
    objectKey,
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 42,
    businessType: 'assets',
  });
  assert.equal(result.fileId, 'file-1');
  assert.equal(created.length, 1);
  assert.deepEqual(deleted, []);
});

test('removes the OSS object when metadata registration fails', async () => {
  const { service, objectKey, deleted } = makeHarness({ createError: new Error('database unavailable') });
  await assert.rejects(() => service.registerUpload('user-1', {
    objectKey,
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 42,
    businessType: 'assets',
  }));
  assert.deepEqual(deleted, [objectKey]);
});

test('rejects direct-upload registration outside the authenticated user prefix', async () => {
  const { service } = makeHarness();
  await assert.rejects(() => service.registerUpload('user-2', {
    objectKey: 'prod/assets/user-1/2026/07/31/key-report.pdf',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 42,
    businessType: 'assets',
  }));
});
