import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { AiUsageService } from '../src/modules/ai-usage/ai-usage.service';
import { ImageGenerationService } from '../src/modules/image-generation/image-generation.service';
import { VideoGenerationService } from '../src/modules/video-generation/video-generation.service';

type Stub = Record<string, unknown>;

const OSS_PREFIX = 'prod';

/** 只实现上传入库用到的那几个方法：前缀判定与签名。 */
function ossStub(overrides: Stub = {}): Stub {
  return {
    isEnabled: true,
    isKeyUnderBusinessType: (key: string, businessType: string) =>
      key.startsWith(`${OSS_PREFIX}/${businessType}/`),
    getSignedUrl: (key: string) => `https://oss.example.com/${key}?sig=x`,
    getReadUrl: (key: string, expiresIn = 600, process?: string) => {
      const url = new URL(`https://oss.example.com/${key}`);
      url.searchParams.set('sig', 'x');
      if (process) url.searchParams.set('x-oss-process', process);
      return { url: url.toString(), expiresIn };
    },
    deleteObject: async () => undefined,
    ...overrides,
  };
}

function videoService(prisma: Stub, oss: Stub = ossStub()) {
  return new VideoGenerationService(prisma as never, {} as never, {} as never, oss as never, {} as never, {} as never);
}

function imageService(prisma: Stub, oss: Stub = ossStub()) {
  return new ImageGenerationService(
    prisma as never,
    {} as never,
    {} as never,
    oss as never,
    {} as never,
    {} as never,
    { syncDocument: async () => ({ inserted: 0 }), removeChunksForSource: async () => ({ deleted: 0 }) } as never,
  );
}

function videoAsset(overrides: Stub = {}) {
  return {
    objectKey: `${OSS_PREFIX}/library/videos/2026/08/19/abc-片子.mp4`,
    mimeType: 'video/mp4',
    fileName: '片子.mp4',
    uploadedBy: 'user-1',
    ...overrides,
  };
}

function imageAsset(overrides: Stub = {}) {
  return {
    objectKey: `${OSS_PREFIX}/library/images/2026/08/19/abc-图.png`,
    mimeType: 'image/png',
    fileName: '图.png',
    uploadedBy: 'user-1',
    ...overrides,
  };
}

// ── 上传入库：来源校验 ────────────────────────────────────────────────────────

test('视频入库：不是视频的文件被拒', async () => {
  const service = videoService({ fileAsset: { findFirst: async () => videoAsset({ mimeType: 'image/png' }) } });

  await assert.rejects(() => service.uploadVideo('user-1', { fileId: 'f1' }), /不是视频/);
});

test('视频入库：不能拿别人上传的文件入库', async () => {
  const service = videoService({ fileAsset: { findFirst: async () => videoAsset({ uploadedBy: 'user-2' }) } });

  await assert.rejects(() => service.uploadVideo('user-1', { fileId: 'f1' }), /只能把自己上传的文件/);
});

test('视频入库：objectKey 不在 library/videos 前缀下被拒（挡住拿别处 fileId 搬私有文件）', async () => {
  const service = videoService({
    fileAsset: { findFirst: async () => videoAsset({ objectKey: `${OSS_PREFIX}/recruitment/resumes/2026/x.mp4` }) },
  });

  await assert.rejects(() => service.uploadVideo('user-1', { fileId: 'f1' }), /不是上传到视频作品库/);
});

test('视频入库：落成已完成、零成本的 upload 记录，标题缺省用文件名', async () => {
  let created: Record<string, unknown> | null = null;
  const service = videoService({
    fileAsset: { findFirst: async () => videoAsset() },
    videoCategory: { findUnique: async () => ({ id: 'cat-1' }) },
    videoGeneration: {
      create: async (args: { data: Record<string, unknown> }) => {
        created = args.data;
        return { ...args.data, id: 'vid-1', ratio: '', errorMessage: null, conversationId: null, createdAt: new Date(), updatedAt: new Date(), upstreamVideoUrl: '' };
      },
    },
  });

  await service.uploadVideo('user-1', { fileId: 'f1', categoryId: 'cat-1', duration: 12, resolution: '1920x1080' });

  assert.equal(created!.mode, 'upload');
  assert.equal(created!.model, 'upload');
  assert.equal(created!.status, 'succeeded');
  assert.equal(created!.costYuan, 0);
  assert.equal(created!.billedSeconds, 0);
  assert.equal(created!.duration, 12);
  assert.equal(created!.resolution, '1920x1080');
  assert.equal(created!.categoryId, 'cat-1');
  assert.equal(created!.prompt, '片子.mp4');
});

test('图片入库：前缀不符被拒；正常入库标记为 upload 且不计成本', async () => {
  const wrongPrefix = imageService({
    fileAsset: { findFirst: async () => imageAsset({ objectKey: `${OSS_PREFIX}/expense/invoices/2026/x.png` }) },
  });
  await assert.rejects(() => wrongPrefix.uploadImage('user-1', { fileId: 'f1' }), /不是上传到图像作品库/);

  let created: Record<string, unknown> | null = null;
  const service = imageService({
    fileAsset: { findFirst: async () => imageAsset() },
    imageCategory: { findUnique: async () => ({ id: 'cat-1' }) },
    generatedImage: {
      create: async (args: { data: Record<string, unknown> }) => {
        created = args.data;
        return { ...args.data, id: 'img-1', createdAt: new Date() };
      },
    },
  });

  const result = await service.uploadImage('user-1', {
    fileId: 'f1',
    categoryId: 'cat-1',
    title: '产品主图',
    size: '1920x1080',
  });

  assert.equal(created!.model, 'upload');
  assert.equal(created!.prompt, '产品主图');
  assert.equal(created!.size, '1920x1080');
  assert.equal(created!.imageData, '', '上传件不存 base64，原图在 OSS');
  assert.equal(created!.imageUrl, imageAsset().objectKey);
  assert.equal(result.categoryId, 'cat-1');
  assert.equal(result.estimatedCostUsd, 0);
});

// ── 删除视频 ─────────────────────────────────────────────────────────────────

test('删除视频：不能删别人的', async () => {
  const service = videoService({
    videoGeneration: { findUnique: async () => ({ id: 'vid-1', userId: 'someone-else', status: 'succeeded', videoObjectKey: '' }) },
  });

  await assert.rejects(() => service.deleteVideo('user-1', 'vid-1'));
});

test('删除视频：生成中的任务不给删（后台还会回写这一行）', async () => {
  const service = videoService({
    videoGeneration: { findUnique: async () => ({ id: 'vid-1', userId: 'user-1', status: 'running', videoObjectKey: '' }) },
  });

  await assert.rejects(() => service.deleteVideo('user-1', 'vid-1'), /生成中的任务不能删除/);
});

test('删除视频：连 OSS 对象一起删；对象删失败不挡住删记录', async () => {
  const deleted: string[] = [];
  let rowDeleted = false;
  const assetUpdates: Array<Record<string, unknown>> = [];
  const prisma = {
    videoGeneration: {
      findUnique: async () => ({ id: 'vid-1', userId: 'user-1', status: 'succeeded', videoObjectKey: 'prod/library/videos/2026/x.mp4' }),
      delete: async () => {
        rowDeleted = true;
        return { id: 'vid-1' };
      },
    },
    fileAsset: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        assetUpdates.push(args.where);
        return { count: 1 };
      },
    },
  };

  const ok = videoService(prisma, ossStub({ deleteObject: async (key: string) => { deleted.push(key); } }));
  assert.deepEqual(await ok.deleteVideo('user-1', 'vid-1'), { ok: true });
  assert.deepEqual(deleted, ['prod/library/videos/2026/x.mp4']);
  assert.equal(rowDeleted, true);
  assert.deepEqual(assetUpdates[0], { objectKey: 'prod/library/videos/2026/x.mp4', status: 'active' });

  rowDeleted = false;
  const ossDown = videoService(prisma, ossStub({ deleteObject: async () => { throw new Error('oss down'); } }));
  assert.deepEqual(await ossDown.deleteVideo('user-1', 'vid-1'), { ok: true });
  assert.equal(rowDeleted, true, 'OSS 删不掉也要把库里的记录删掉');
});

// ── 用量回填口径 ─────────────────────────────────────────────────────────────

test('用量回填：上传入库的图片与视频不计入 AI 用量', async () => {
  const queries: Record<string, unknown> = {};
  const service = new AiUsageService({
    aiUsageLog: {
      deleteMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      createMany: async () => ({ count: 0 }),
    },
    chatUsageEvent: { findMany: async () => [] },
    generatedImage: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        queries.image = args.where;
        return [];
      },
    },
    videoGeneration: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        queries.video = args.where;
        return [];
      },
    },
  } as never);

  await service.backfill();

  assert.deepEqual((queries.image as Record<string, unknown>).model, { not: 'upload' });
  assert.deepEqual((queries.video as Record<string, unknown>).mode, { not: 'upload' });
});

test('删除图片：上传件连 OSS 对象一起清，生成件只删记录', async () => {
  const makeService = (img: Record<string, unknown>, deleted: string[]) =>
    imageService(
      {
        generatedImage: { findUnique: async () => img, delete: async () => img },
        fileAsset: { updateMany: async () => ({ count: 1 }) },
        // 删对象前会先查有没有聊天附件引用同一个 objectKey（这里都没有）
        chatMessage: { findFirst: async () => null },
      },
      ossStub({ deleteObject: async (key: string) => { deleted.push(key); } }),
    );

  const uploadedDeleted: string[] = [];
  await makeService(
    { id: 'img-1', userId: 'user-1', model: 'upload', imageUrl: 'prod/library/images/2026/x.png' },
    uploadedDeleted,
  ).deleteImage('img-1', 'user-1');
  assert.deepEqual(uploadedDeleted, ['prod/library/images/2026/x.png']);

  const generatedDeleted: string[] = [];
  await makeService(
    { id: 'img-2', userId: 'user-1', model: 'gpt-image-1', imageUrl: 'prod/images/generated/2026/y.png' },
    generatedDeleted,
  ).deleteImage('img-2', 'user-1');
  assert.deepEqual(generatedDeleted, [], '生成件维持原有行为：只删记录，不动 OSS 对象');
});
