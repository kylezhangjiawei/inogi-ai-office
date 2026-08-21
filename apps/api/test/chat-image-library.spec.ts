import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChatToolsService } from '../src/modules/chat/chat-tools.service';
import { RagService, type RagUserContext } from '../src/modules/rag/rag.service';
import { ImageGenerationService } from '../src/modules/image-generation/image-generation.service';

/**
 * MateChat 作品库检索：模型原来只有 generate_image，问「库里有没有 XX 图」只能重新生成。
 * 这里锁住新工具的三条底线：两路召回都要跑、结果按 id 去重、归属过滤走 SQL 不看向量库元数据。
 */

const USER: RagUserContext = { userId: 'u1', permissions: [], name: '张三' };

type Fakes = {
  semanticIds?: string[];
  semanticThrows?: boolean;
  ownedByIds?: Array<Record<string, unknown>>;
  keywordItems?: Array<Record<string, unknown>>;
  categoryId?: string | null;
  /** null = 该图没有 objectKey（历史 http 直链），走下载回传兜底 */
  objectKeyByImage?: null;
};

function makeService(fakes: Fakes = {}) {
  const calls = {
    ragSearch: [] as Array<{ query: string; opts: Record<string, unknown> }>,
    listImages: [] as unknown[][],
    findOwnedByIds: [] as Array<{ userId: string; ids: string[] }>,
    persisted: [] as unknown[],
    referenced: [] as string[],
  };
  const prisma = {
    imageCategory: {
      findFirst: async () => (fakes.categoryId ? { id: fakes.categoryId } : null),
    },
    auditLog: { create: async () => ({}) },
  };
  const ragService = {
    search: async (query: string, _user: RagUserContext, opts: Record<string, unknown>) => {
      calls.ragSearch.push({ query, opts });
      if (fakes.semanticThrows) throw new Error('embedding 未配置');
      return { results: (fakes.semanticIds ?? []).map((id) => ({ sourceId: id })), filteredByPermission: 0 };
    },
  };
  const imageGenerationService = {
    listImages: async (...args: unknown[]) => {
      calls.listImages.push(args);
      return { items: fakes.keywordItems ?? [], total: (fakes.keywordItems ?? []).length };
    },
    findOwnedImagesByIds: async (userId: string, ids: string[]) => {
      calls.findOwnedByIds.push({ userId, ids });
      return fakes.ownedByIds ?? [];
    },
    getOwnedImageObjectKey: async (_userId: string, imageId: string) =>
      fakes.objectKeyByImage === null ? null : `images/generated/${imageId}.png`,
  };
  const fileExportService = {
    // 引用现成 OSS 对象（作品库命中走这条）
    persistExistingObject: async (_userId: string, file: { objectKey: string; filename: string }) => {
      calls.referenced.push(file.objectKey);
      return { fileId: 'f1', name: file.filename, mime: 'image/png', size: 10, objectKey: file.objectKey };
    },
    // 下载+回传（只有历史 http 直链的老数据才会走）
    persist: async (_userId: string, file: { filename: string }) => {
      calls.persisted.push(file.filename);
      return { fileId: 'f2', name: file.filename, mime: 'image/png', size: 10, objectKey: 'k2' };
    },
  };
  const ctor = ChatToolsService as unknown as new (...args: unknown[]) => ChatToolsService;
  const service = new ctor(prisma, ragService, undefined, imageGenerationService, undefined, fileExportService);
  return { service, calls };
}

const image = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  prompt: `图 ${id}`,
  size: '1024x1024',
  model: 'gpt-image-1',
  isFavorite: false,
  imageUrl: null,
  imageData: 'data:image/png;base64,aGVsbG8=',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  category: null,
  ...extra,
});

test('语义命中与关键词命中合并去重，语义结果排在前面', async () => {
  const { service, calls } = makeService({
    semanticIds: ['img-a', 'img-b'],
    ownedByIds: [image('img-a'), image('img-b')],
    keywordItems: [image('img-b'), image('img-c')],
  });

  const result = await service.execute(
    'search_image_library',
    JSON.stringify({ query: '蓝色机箱渲染图' }),
    USER,
    'conv-1',
  );

  assert.equal(result.ok, true);
  assert.match(result.summary, /3 张/);
  const ids = [...result.content.matchAll(/id=([\w-]+)/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, '同一张图不能因为两路都命中就出现两次');
  assert.deepEqual([...ids].sort(), ['img-a', 'img-b', 'img-c']);
  // 关键词命中（SQL contains 到了字面）排在纯语义命中之前
  assert.ok(ids.indexOf('img-a') > ids.indexOf('img-b'));
  // 两路都要跑：语义补同义词，关键词兜住刚生成还没索引的
  assert.equal(calls.ragSearch.length, 1);
  assert.deepEqual(calls.ragSearch[0].opts.sourceTypes, ['image'], '只搜图片类型，别把知识库文本混进来');
  assert.equal(calls.listImages.length, 1);
});

test('语义命中的 id 一律按当前用户回查，不拿向量库元数据当权限闸', async () => {
  const { service, calls } = makeService({
    semanticIds: ['img-other'],
    ownedByIds: [], // 该图属于别人 → SQL 查不出来
    keywordItems: [],
  });

  const result = await service.execute(
    'search_image_library',
    JSON.stringify({ query: '别人的图' }),
    USER,
    'conv-1',
  );

  assert.deepEqual(calls.findOwnedByIds, [{ userId: 'u1', ids: ['img-other'] }]);
  assert.match(result.summary, /无匹配/);
  assert.match(result.content, /没有找到/);
});

test('向量检索不可用时降级为关键词检索，不整体失败', async () => {
  const { service, calls } = makeService({
    semanticThrows: true,
    keywordItems: [image('img-k')],
  });

  const result = await service.execute(
    'search_image_library',
    JSON.stringify({ query: '机箱' }),
    USER,
    'conv-1',
  );

  assert.equal(result.ok, true);
  assert.match(result.content, /id=img-k/);
  assert.equal(calls.listImages.length, 1);
});

test('命中后把最相关的一张作为附件展示，并提示可直接改图', async () => {
  const { service, calls } = makeService({
    semanticIds: ['img-a'],
    ownedByIds: [image('img-a')],
    keywordItems: [],
  });

  const result = await service.execute(
    'search_image_library',
    JSON.stringify({ query: '机箱' }),
    USER,
    'conv-1',
  );

  assert.ok(result.attachment, '命中却不给附件，用户还是看不到库里的图');
  // 原图已经在 OSS：只登记引用，不把字节下载回来再传一遍（实测十几秒，会把工具拖超时）
  assert.deepEqual(calls.referenced, ['images/generated/img-a.png']);
  assert.equal(calls.persisted.length, 0, '不应再走下载+回传');
  assert.match(result.content, /edit_image/);
  assert.match(result.content, /只有在库里没有、或用户明确表示都不合适/);
});

test('历史数据没有 objectKey 时回退到下载+回传，仍然给出附件', async () => {
  const { service, calls } = makeService({
    semanticIds: ['img-a'],
    ownedByIds: [image('img-a')],
    keywordItems: [],
    objectKeyByImage: null,
  });

  const result = await service.execute(
    'search_image_library',
    JSON.stringify({ query: '机箱' }),
    USER,
    'conv-1',
  );

  assert.ok(result.attachment);
  assert.equal(calls.referenced.length, 0);
  assert.equal(calls.persisted.length, 1);
});

/**
 * 图片进了向量库之后，通用检索必须搜不到它：
 * ① 图片 prompt 混进知识问答上下文纯属噪声；
 * ② 图片按人隔离，而 RagService 的权限判定里超管直通 visible_user_ids，
 *    通用检索会让超管看到别人的私人图片，与作品库页面口径不一致。
 */
test('image 类型只在显式点名 sourceTypes 时参与向量检索', async () => {
  const wheres: Array<Record<string, unknown>> = [];
  const prisma = {
    knowledgeChunk: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        return [];
      },
    },
  };
  const embedding = { embedOne: async () => [0.1, 0.2, 0.3] };
  const ctor = RagService as unknown as new (...args: unknown[]) => RagService;
  const rag = new ctor(prisma, undefined, embedding, undefined);

  await rag.search('机箱', USER, {});
  await rag.search('机箱', USER, { sourceTypes: ['image'] });

  assert.deepEqual(wheres[0].sourceType, { notIn: ['image'] }, '通用检索必须排除图片');
  assert.deepEqual(wheres[1].sourceType, { in: ['image'] }, '点名图片时只搜图片');
});

test('作品索引进向量库：文本含描述与分类，可见性限本人', async () => {
  const docs: Array<Record<string, unknown>> = [];
  const prisma = {
    generatedImage: {
      findUnique: async () => ({
        id: 'img-a',
        userId: 'u1',
        prompt: '蓝色机箱三视图渲染',
        revisedPrompt: 'a blue server chassis, three views',
        editInstruction: '',
        size: '1024x1024',
        model: 'gpt-image-1',
        createdAt: new Date('2026-08-01T00:00:00Z'),
        category: { id: 'c1', name: '产品渲染' },
      }),
    },
  };
  const ragService = {
    syncDocument: async (doc: Record<string, unknown>) => {
      docs.push(doc);
      return { inserted: 1 };
    },
  };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, undefined, undefined, undefined, ragService);

  await service.indexImageToRag('img-a');

  assert.equal(docs.length, 1);
  const doc = docs[0] as { sourceType: string; sourceId: string; text: string; metadata: Record<string, unknown> };
  assert.equal(doc.sourceType, 'image');
  assert.equal(doc.sourceId, 'img-a');
  assert.match(doc.text, /蓝色机箱三视图渲染/);
  assert.match(doc.text, /blue server chassis/, '模型改写后的英文 prompt 也要能被搜到');
  assert.match(doc.text, /分类：产品渲染/);
  assert.deepEqual(doc.metadata.visible_user_ids, ['u1'], '作品按人隔离，别人不能召回');
});

test('索引失败不冒泡：出图/上传主流程不受影响', async () => {
  const prisma = { generatedImage: { findUnique: async () => { throw new Error('db down'); } } };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, undefined, undefined, undefined, { syncDocument: async () => ({}) });

  await service.indexImageToRag('img-a');
});

test('字面命中的排在纯语义相近之前，并标注匹配强度', async () => {
  const { service } = makeService({
    // 语义先召回一堆相近但不是用户要的（模板化 prompt 会让向量互相很像）
    semanticIds: ['img-rabbit', 'img-tiger'],
    ownedByIds: [image('img-rabbit', { prompt: '一只可爱的卡通小兔子插画' }), image('img-tiger', { prompt: '一只可爱的卡通小老虎插画' })],
    keywordItems: [image('img-corgi', { prompt: '一只可爱的卡通柯基犬插画' })],
  });

  const result = await service.execute(
    'search_image_library',
    JSON.stringify({ query: '柯基 插画' }),
    USER,
    'conv-1',
  );

  const ids = [...result.content.matchAll(/id=([\w-]+)/g)].map((m) => m[1]);
  assert.equal(ids[0], 'img-corgi', '字面命中的必须排第一，否则模型会先推不相干的图');
  assert.match(result.content, /严格匹配 1 张/);
  assert.match(result.content, /\[严格匹配\] id=img-corgi/);
  assert.match(result.content, /\[语义相近\] id=img-rabbit/);
});

test('一张都没字面命中时，明确要求模型别把相近图当命中推给用户', async () => {
  const { service } = makeService({
    semanticIds: ['img-rabbit'],
    ownedByIds: [image('img-rabbit', { prompt: '一只可爱的卡通小兔子插画' })],
    keywordItems: [],
  });

  const result = await service.execute(
    'search_image_library',
    JSON.stringify({ query: '小狗 插画' }),
    USER,
    'conv-1',
  );

  assert.match(result.summary, /仅有 1 张相近作品/);
  assert.match(result.content, /严格匹配 0 张/);
  assert.match(result.content, /别把不相干的图当成命中推给用户/);
});

/**
 * 中文没有空格：「卡通柯基犬插画」整串当一个词去 contains，一条都搜不到。
 * 严格匹配为空时用 2 字滑窗放宽一次，作品库页面和 MateChat 检索都走这条路。
 */
test('严格匹配为空时按 2 字滑窗放宽，并回报 relaxed', async () => {
  const wheres: Array<Record<string, unknown>> = [];
  const rows = [{ id: 'img-corgi', prompt: '一只可爱的卡通柯基犬插画', imageUrl: '', imageData: '', createdAt: new Date() }];
  const prisma = {
    generatedImage: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        return wheres.length === 1 ? 0 : rows.length; // 第一次严格匹配 0 条，第二次放宽后有
      },
      findMany: async () => rows,
    },
    imageCategory: { findUnique: async () => ({ id: 'c1' }) },
  };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, { getSignedUrl: () => null, isEnabled: false }, undefined, undefined, undefined);

  const result = (await service.listImages('u1', 1, 12, false, undefined, undefined, '卡通柯基犬插画')) as {
    total: number;
    relaxed?: boolean;
  };

  assert.equal(result.total, 1);
  assert.equal(result.relaxed, true, '放宽过要告诉前端，否则用户以为是精确结果');
  const relaxedWhere = wheres[1] as { OR?: Array<Record<string, unknown>> };
  assert.ok(Array.isArray(relaxedWhere.OR) && relaxedWhere.OR.length > 0, '放宽查询应是滑窗 OR');
  const windows = relaxedWhere.OR.map((c) => (c.prompt as { contains?: string } | undefined)?.contains).filter(Boolean);
  assert.ok(windows.includes('柯基'), `滑窗里应包含「柯基」，实际：${windows.join(',')}`);
});

test('严格匹配有结果时不放宽', async () => {
  let counts = 0;
  const prisma = {
    generatedImage: {
      count: async () => {
        counts += 1;
        return 3;
      },
      findMany: async () => [],
    },
  };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, { getSignedUrl: () => null }, undefined, undefined, undefined);

  const result = (await service.listImages('u1', 1, 12, false, undefined, undefined, '柯基')) as { relaxed?: boolean };

  assert.equal(counts, 1, '严格匹配有结果就不该再查一次');
  assert.equal(result.relaxed, false);
});

test('作品的 OSS 对象被聊天附件引用时，删作品不删对象', async () => {
  const deleted: string[] = [];
  const assetUpdates: unknown[] = [];
  const img = { id: 'img-1', userId: 'u1', model: 'upload', imageUrl: 'library/images/a.png' };
  const prisma = {
    generatedImage: {
      findUnique: async () => img,
      delete: async () => img,
    },
    chatMessage: { findFirst: async () => ({ id: 'msg-1' }) }, // 有聊天引用
    fileAsset: { updateMany: async (args: unknown) => { assetUpdates.push(args); return { count: 1 }; } },
  };
  const oss = { deleteObject: async (key: string) => { deleted.push(key); } };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, oss, undefined, undefined, { removeChunksForSource: async () => ({ deleted: 0 }) });

  await service.deleteImage('img-1', 'u1');

  assert.deepEqual(deleted, [], '对象还被历史对话引用，删了那张图就 404 了');
  assert.equal(assetUpdates.length, 0, '资产登记也要留着');
});

test('没有聊天引用时，删上传作品照旧连 OSS 对象一起清', async () => {
  const deleted: string[] = [];
  const img = { id: 'img-2', userId: 'u1', model: 'upload', imageUrl: 'library/images/b.png' };
  const prisma = {
    generatedImage: { findUnique: async () => img, delete: async () => img },
    chatMessage: { findFirst: async () => null },
    fileAsset: { updateMany: async () => ({ count: 1 }) },
  };
  const oss = { deleteObject: async (key: string) => { deleted.push(key); } };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, oss, undefined, undefined, { removeChunksForSource: async () => ({ deleted: 0 }) });

  await service.deleteImage('img-2', 'u1');

  assert.deepEqual(deleted, ['library/images/b.png']);
});

/**
 * 生成缓存串图：原来按 Jaccard≥0.65 复用，中文按标点切短句，
 * 同模板只差动物名的两个 prompt 相似度 0.80，「仓鼠」的请求会拿到「柯基」的图。
 */
test('生成缓存只在 prompt 完全一致时复用，同模板不同主体不再串图', async () => {
  const queries: Array<Record<string, unknown>> = [];
  const prisma = {
    generatedImage: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        queries.push(where);
        return where.prompt === '一只可爱的卡通柯基犬，作为卡片背景的完整场景插画'
          ? { id: 'img-corgi', prompt: where.prompt, imageData: '', imageUrl: 'k', revisedPrompt: '', model: 'gpt-image-1', estimatedCostUsd: 0 }
          : null;
      },
    },
  };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, undefined, undefined, undefined, undefined);
  const findCached = (
    service as unknown as {
      findCachedImage: (p: string, style: string, size: string, quality: string, model: string) => Promise<unknown>;
    }
  ).findCachedImage.bind(service);

  const same = await findCached('一只可爱的卡通柯基犬，作为卡片背景的完整场景插画', 'vivid', '1024x1024', 'low', 'gpt-image-1');
  assert.ok(same, '同一个请求应命中缓存，不该重复烧钱');

  const other = await findCached('一只可爱的卡通仓鼠，作为卡片背景的完整场景插画', 'vivid', '1024x1024', 'low', 'gpt-image-1');
  assert.equal(other, null, '只差主体名的 prompt 不是同一个请求，命中就会把柯基的图存成仓鼠');

  // 查询必须带上 prompt 精确条件，而不是拉一批回来算相似度
  assert.equal(queries[0].prompt, '一只可爱的卡通柯基犬，作为卡片背景的完整场景插画');
});

test('生成缓存忽略首尾空白与多余空格差异', async () => {
  const seen: string[] = [];
  const prisma = {
    generatedImage: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        seen.push(String(where.prompt));
        return null;
      },
    },
  };
  const ctor = ImageGenerationService as unknown as new (...args: unknown[]) => ImageGenerationService;
  const service = new ctor(prisma, undefined, undefined, undefined, undefined, undefined, undefined);
  const findCached = (
    service as unknown as {
      findCachedImage: (p: string, style: string, size: string, quality: string, model: string) => Promise<unknown>;
    }
  ).findCachedImage.bind(service);

  await findCached('  a  cute   corgi  ', 'vivid', '1024x1024', 'low', 'gpt-image-1');
  assert.deepEqual(seen, ['a cute corgi']);
});
