import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ImageGenerationService } from '../src/modules/image-generation/image-generation.service';
import { OssService } from '../src/modules/oss/oss.service';

const OBJECT_KEY = 'prod/images/generated/example.png';
const THUMB_PROCESS = 'image/resize,m_lfit,w_640/format,webp/quality,q_82';

function makeService(prisma: Record<string, unknown> = {}) {
  const calls: Array<{ source: string; expires: number; process?: string }> = [];
  const oss = {
    isEnabled: true,
    getReadUrl(source: string, expires: number, process?: string) {
      calls.push({ source, expires, process });
      if (!source || source === 'unavailable-key' || source.startsWith('https://external.example/')) return null;
      const url = new URL(`https://img.example.com/${OBJECT_KEY}`);
      url.searchParams.set('auth_key', 'fresh-type-a-signature');
      const inheritedProcess = source.startsWith('http') ? new URL(source).searchParams.get('x-oss-process') : null;
      const resolvedProcess = process ?? inheritedProcess;
      if (resolvedProcess) url.searchParams.set('x-oss-process', resolvedProcess);
      return { url: url.toString(), expiresIn: 3600 };
    },
    getSignedUrl: (_key: string, ttl: number) => `https://bucket.oss.example.com/legacy?ttl=${ttl}`,
    uploadBuffer: async () => OBJECT_KEY,
    deleteObject: async () => {},
  };
  const service = new ImageGenerationService(
    prisma as never, {} as never, {} as never, oss as never, {} as never, {} as never,
    { syncDocument: async () => {}, removeChunksForSource: async () => {} } as never,
  );
  return { service, calls };
}

function image(source: string) {
  return {
    id: 'image-1', prompt: 'product image', revisedPrompt: '', style: '', size: '', quality: '',
    imageUrl: source, imageData: 'data:image/png;base64,dGVzdA==', model: 'gpt-image-1',
    isFavorite: false, createdAt: new Date('2026-09-10T00:00:00Z'),
  };
}

function renderBoth(service: ImageGenerationService, source: string) {
  return [service['toLibraryItem'](image(source)), service['toResponse'](image(source))];
}

test('作品列表和生成结果均通过读取入口续签对象键、历史 OSS/CDN URL 与预览代理 URL', () => {
  for (const source of [
    OBJECT_KEY,
    `https://bucket.oss.example.com/${OBJECT_KEY}?Expires=1&Signature=expired`,
    `https://img.example.com/${OBJECT_KEY}?auth_key=expired`,
    `/api/research-development/oss-preview?key=${encodeURIComponent(OBJECT_KEY)}&exp=1&sig=expired`,
  ]) {
    const { service, calls } = makeService();
    for (const rendered of renderBoth(service, source)) {
      assert.equal(new URL(rendered.imageUrl!).hostname, 'img.example.com');
      assert.equal(new URL(rendered.imageUrl!).searchParams.get('auth_key'), 'fresh-type-a-signature');
      assert.equal(new URL(rendered.thumbnailUrl!).searchParams.get('x-oss-process'), THUMB_PROCESS);
      assert.equal(rendered.imageData, undefined);
    }
    assert.equal(calls.length, 4);
    assert.ok(calls.every((call) => call.source === source && call.expires === 24 * 3600));
  }
});

test('历史图片处理参数交给读取入口保留，缩略图显式覆盖为作品库规格', () => {
  const originalProcess = 'image/resize,w_1280';
  const source = `https://bucket.oss.example.com/${OBJECT_KEY}?x-oss-process=${encodeURIComponent(originalProcess)}&Signature=old`;
  const { service } = makeService();
  for (const rendered of renderBoth(service, source)) {
    assert.equal(new URL(rendered.imageUrl!).searchParams.get('x-oss-process'), originalProcess);
    assert.equal(new URL(rendered.thumbnailUrl!).searchParams.get('x-oss-process'), THUMB_PROCESS);
  }
});

test('真实 OSS 读取签名器将本桶历史 URL 更新为 CDN 地址并保留图片处理参数', () => {
  const values: Record<string, string> = {
    OSS_REGION: 'oss-cn-beijing', OSS_BUCKET: 'example-private-bucket',
    OSS_ACCESS_KEY_ID: 'test-access-key', OSS_ACCESS_KEY_SECRET: 'test-access-secret',
    OSS_PUBLIC_ENDPOINT: 'oss-cn-beijing.aliyuncs.com', OSS_BASE_PREFIX: 'prod',
    OSS_CDN_DOMAIN: 'https://img.example.com', OSS_CDN_AUTH_TYPE: 'A',
    OSS_CDN_AUTH_KEY: 'test-cdn-key', OSS_CDN_AUTH_TTL_SECONDS: '604800',
  };
  const oss = new OssService({ get: (key: string) => values[key] } as never);
  oss.onModuleInit();
  const service = new ImageGenerationService(
    {} as never, {} as never, {} as never, oss, {} as never, {} as never, {} as never,
  );
  const process = 'image/resize,w_1280';
  for (const source of [
    `https://example-private-bucket.oss-cn-beijing.aliyuncs.com/${OBJECT_KEY}?Expires=1&Signature=expired&x-oss-process=${encodeURIComponent(process)}`,
    `https://img.example.com/${OBJECT_KEY}?auth_key=expired&x-oss-process=${encodeURIComponent(process)}`,
    `/api/research-development/oss-preview?key=${encodeURIComponent(OBJECT_KEY)}&exp=1&sig=expired&process=${encodeURIComponent(process)}`,
  ]) {
    for (const rendered of renderBoth(service, source)) {
      const url = new URL(rendered.imageUrl!);
      assert.equal(url.hostname, 'img.example.com');
      assert.match(url.searchParams.get('auth_key') ?? '', /^\d+-0-0-[a-f0-9]{32}$/);
      assert.equal(url.searchParams.get('x-oss-process'), process);
      assert.equal(url.searchParams.has('Signature'), false);
      assert.equal(new URL(rendered.thumbnailUrl!).searchParams.get('x-oss-process'), THUMB_PROCESS);
    }
  }
});

test('未知外部图片地址原样保留，无法生成链接时仍返回已有 base64', () => {
  const { service } = makeService();
  const external = 'https://external.example/image.png?provider_token=existing';
  for (const rendered of renderBoth(service, external)) {
    assert.equal(rendered.imageUrl, external);
    assert.equal(rendered.thumbnailUrl, external);
  }
  for (const source of ['', 'unavailable-key']) {
    for (const rendered of renderBoth(service, source)) {
      assert.equal(rendered.imageUrl, null);
      assert.equal(rendered.thumbnailUrl, null);
      assert.equal(rendered.imageData, image(source).imageData);
    }
  }
});

test('作品列表在用户数据范围内读取并签名，其他用户的上传文件不能生成作品链接', async () => {
  const { service, calls } = makeService({
    generatedImage: {
      count: async ({ where }: { where: { userId: string } }) => { assert.equal(where.userId, 'user-1'); return 1; },
      findMany: async ({ where }: { where: { userId?: string } }) => where.userId
        ? (assert.equal(where.userId, 'user-1'), [image(OBJECT_KEY)])
        : [],
    },
    fileAsset: { findFirst: async () => ({ uploadedBy: 'user-other', mimeType: 'image/png', objectKey: OBJECT_KEY }) },
  });
  const listed = await service.listImages('user-1');
  assert.equal(listed.items.length, 1);
  const countBeforeDeniedUpload = calls.length;
  await assert.rejects(() => service.uploadImage('user-1', { fileId: 'someone-elses-file' }), /只能把自己上传的文件加入作品库/);
  assert.equal(calls.length, countBeforeDeniedUpload);
});

test('后台上传仍只将对象键存库，视频来源图片继续采用两小时 OSS 签名', async () => {
  let stored: unknown;
  const { service, calls } = makeService({
    generatedImage: {
      update: async ({ data }: { data: unknown }) => { stored = data; },
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        assert.deepEqual(where, { id: 'image-1', userId: 'user-1' });
        return image(OBJECT_KEY);
      },
    },
  });
  await service['uploadAndSaveImageUrl']('image-1', image('').imageData);
  assert.deepEqual(stored, { imageUrl: OBJECT_KEY });
  assert.equal(await service.getShareableImageUrl('user-1', 'image-1'), 'https://bucket.oss.example.com/legacy?ttl=7200');
  assert.equal(calls.length, 0);
});

test('按图片 ID 续签先校验归属，不能为其他用户或不存在的图片签名', async () => {
  for (const stored of [null, { ...image(OBJECT_KEY), userId: 'other-user' }]) {
    const { service, calls } = makeService({ generatedImage: { findUnique: async () => stored } });
    await assert.rejects(() => service.getImageReadUrls('user-1', 'image-1'));
    assert.equal(calls.length, 0);
  }
});

test('图片 ID 续签返回新原图及缩略图，原图清除历史缩放参数且返回有效期', async () => {
  const source = `https://img.example.com/${OBJECT_KEY}?auth_key=expired&x-oss-process=image/resize,w_240`;
  const { service, calls } = makeService({
    generatedImage: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        assert.deepEqual(where, { id: 'image-1' });
        return { ...image(source), userId: 'user-1' };
      },
    },
  });
  const response = await service.getImageReadUrls('user-1', 'image-1');
  assert.equal(response.imageId, 'image-1');
  assert.equal(new URL(response.imageUrl!).searchParams.has('x-oss-process'), false);
  assert.equal(new URL(response.thumbnailUrl!).searchParams.get('x-oss-process'), THUMB_PROCESS);
  assert.equal(response.imageExpiresIn, 3600);
  assert.equal(response.thumbnailExpiresIn, 3600);
  assert.equal(response.imageData, undefined);
  assert.ok(calls.every((call) => call.source === source));
});

test('尚未上传 OSS 的已授权图片可通过续签接口读取 base64 原图', async () => {
  const { service } = makeService({ generatedImage: { findUnique: async () => ({ ...image(''), userId: 'user-1' }) } });
  const response = await service.getImageReadUrls('user-1', 'image-1');
  assert.equal(response.imageUrl, null);
  assert.equal(response.imageData, image('').imageData);
});
