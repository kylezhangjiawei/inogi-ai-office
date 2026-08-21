import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ImageGenerationService } from '../src/modules/image-generation/image-generation.service';

type PrismaStub = Record<string, unknown>;

/**
 * 只喂分类相关的 prisma 桩，其余依赖分类逻辑用不到。
 * updateCategory 会在事务里先 `SELECT ... FOR UPDATE` 锁住分类表，再用事务客户端做校验和写入，
 * 所以桩要同时提供 $transaction 与 $queryRaw，并把同一个桩当事务客户端回传。
 */
function withTransaction(prisma: PrismaStub): PrismaStub {
  const client: PrismaStub = {
    ...prisma,
    $queryRaw: async () => [],
  };
  client.$transaction = async (fn: (tx: PrismaStub) => Promise<unknown>) => fn(client);
  return client;
}

function makeService(prisma: PrismaStub) {
  return new ImageGenerationService(
    withTransaction(prisma) as never,
    {} as never,
    {} as never,
    { getSignedUrl: () => null, isEnabled: false } as never,
    {} as never,
    {} as never,
    // RagService：作品索引是 best-effort 旁路，分类用例不关心，给个空实现即可
    { syncDocument: async () => ({ inserted: 0 }), removeChunksForSource: async () => ({ deleted: 0 }) } as never,
  );
}

function category(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-1',
    name: '产品图',
    parentId: null,
    description: '',
    color: '#3b82f6',
    sortOrder: 10,
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** 三层样例：产品图 > 详情页 > 首屏；另有一个根分类 品牌图 */
const tree = [
  category({ id: 'root-a', name: '产品图', parentId: null }),
  category({ id: 'child-a', name: '详情页', parentId: 'root-a' }),
  category({ id: 'leaf-a', name: '首屏', parentId: 'child-a' }),
  category({ id: 'root-b', name: '品牌图', parentId: null }),
];

test('分类树：嵌套结构、路径、层号，以及含子孙的计数汇总', async () => {
  const service = makeService({
    imageCategory: { findMany: async () => tree },
    generatedImage: {
      groupBy: async () => [
        { categoryId: 'root-a', _count: { _all: 1 } },
        { categoryId: 'child-a', _count: { _all: 2 } },
        { categoryId: 'leaf-a', _count: { _all: 4 } },
      ],
      count: async () => 0,
    },
  });

  const result = await service.listCategories('user-1');
  const [productRoot, brandRoot] = result.items;
  const detail = productRoot.children[0];

  assert.equal(result.items.length, 2, '只有根分类在最外层');
  assert.equal(productRoot.depth, 1);
  assert.equal(detail.depth, 2);
  assert.equal(detail.children[0].depth, 3);
  assert.equal(detail.children[0].path, '产品图 / 详情页 / 首屏');
  // 直接计数与含子孙计数分开：父节点自己 1 件，子树合计 7 件
  assert.equal(productRoot.imageCount, 1);
  assert.equal(productRoot.totalImageCount, 7);
  assert.equal(detail.totalImageCount, 6);
  assert.equal(brandRoot.totalImageCount, 0);
});

test('分类列表的作品计数按当前用户口径（目录全局共享，作品按人隔离）', async () => {
  const countArgs: unknown[] = [];
  const service = makeService({
    imageCategory: { findMany: async () => [category()] },
    generatedImage: {
      groupBy: async () => [{ categoryId: 'cat-1', _count: { _all: 3 } }],
      count: async (args: { where: Record<string, unknown> }) => {
        countArgs.push(args.where);
        return countArgs.length === 1 ? 5 : 8;
      },
    },
  });

  const result = await service.listCategories('user-1');

  assert.equal(result.items[0].imageCount, 3);
  assert.equal(result.uncategorizedCount, 5);
  assert.equal(result.totalCount, 8);
  assert.deepEqual(countArgs[0], { userId: 'user-1', categoryId: null });
  assert.deepEqual(countArgs[1], { userId: 'user-1' });
});

test('创建子分类：校验父级存在，排序号只在同级内递增', async () => {
  let created: Record<string, unknown> | null = null;
  let aggregateWhere: unknown = null;
  const service = makeService({
    imageCategory: {
      findMany: async () => tree,
      findFirst: async () => null,
      aggregate: async (args: { where: unknown }) => {
        aggregateWhere = args.where;
        return { _max: { sortOrder: 30 } };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        created = args.data;
        return category(args.data);
      },
    },
  });

  await service.createCategory('user-9', { name: '  海报  ', parentId: 'root-a' });

  assert.equal(created!.name, '海报');
  assert.equal(created!.parentId, 'root-a');
  assert.equal(created!.sortOrder, 40);
  assert.deepEqual(aggregateWhere, { parentId: 'root-a' });
});

test('创建分类：父级已在第 3 层时拒绝再往下建', async () => {
  const service = makeService({
    imageCategory: { findMany: async () => tree, findFirst: async () => null },
  });

  await assert.rejects(
    () => service.createCategory('user-1', { name: '第四层', parentId: 'leaf-a' }),
    /分类最多 3 层/,
  );
});

test('创建分类：父级不存在报 404', async () => {
  const service = makeService({ imageCategory: { findMany: async () => tree } });

  await assert.rejects(() => service.createCategory('user-1', { name: 'x', parentId: 'ghost' }), /父分类不存在/);
});

test('重名校验按同级判定：不同父级下可以同名', async () => {
  const whereArgs: Array<Record<string, unknown>> = [];
  const service = makeService({
    imageCategory: {
      findMany: async () => tree,
      findFirst: async (args: { where: Record<string, unknown> }) => {
        whereArgs.push(args.where);
        return null;
      },
      aggregate: async () => ({ _max: { sortOrder: 0 } }),
      create: async (args: { data: Record<string, unknown> }) => category(args.data),
    },
  });

  await service.createCategory('user-1', { name: '详情页', parentId: 'root-b' });

  // 查重时必须带上 parentId，否则会把别的父级下的同名分类误判成冲突
  assert.deepEqual(whereArgs[0], { name: '详情页', parentId: 'root-b' });
});

test('同级重名被拒', async () => {
  const service = makeService({
    imageCategory: {
      findMany: async () => tree,
      findFirst: async () => ({ id: 'child-a' }),
    },
  });

  await assert.rejects(
    () => service.createCategory('user-1', { name: '详情页', parentId: 'root-a' }),
    /同级下已有同名分类/,
  );
});

test('移动分类：不能移到自己或自己的子孙下面', async () => {
  const service = makeService({
    imageCategory: {
      findUnique: async () => category({ id: 'root-a', parentId: null }),
      findMany: async () => tree,
    },
  });

  await assert.rejects(
    () => service.updateCategory('root-a', { parentId: 'root-a' }),
    /不能把分类移动到自己下面/,
  );
  await assert.rejects(
    () => service.updateCategory('root-a', { parentId: 'leaf-a' }),
    /不能把分类移动到自己的子分类下面/,
  );
});

test('移动分类：移动后整棵子树超过层数上限则拒绝', async () => {
  const service = makeService({
    imageCategory: {
      findUnique: async () => category({ id: 'root-a', parentId: null }),
      findMany: async () => tree,
    },
  });

  // root-a 自身高 3 层，挂到 root-b（第 1 层）下会变成 4 层
  await assert.rejects(() => service.updateCategory('root-a', { parentId: 'root-b' }), /分类最多 3 层/);
});

test('移动 + 改名：重名按移动后的父级校验', async () => {
  let nameCheckWhere: Record<string, unknown> | null = null;
  let updateData: Record<string, unknown> | null = null;
  const service = makeService({
    imageCategory: {
      findUnique: async () => category({ id: 'leaf-a', name: '首屏', parentId: 'child-a' }),
      findMany: async () => tree,
      findFirst: async (args: { where: Record<string, unknown> }) => {
        nameCheckWhere = args.where;
        return null;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        updateData = args.data;
        return category(args.data);
      },
    },
  });

  await service.updateCategory('leaf-a', { parentId: 'root-b', name: '首屏' });

  assert.deepEqual(nameCheckWhere, { name: '首屏', parentId: 'root-b', id: { not: 'leaf-a' } });
  assert.deepEqual(updateData, { parentId: 'root-b', name: '首屏' });
});

test('更新分类：分类不存在时报 404', async () => {
  const service = makeService({ imageCategory: { findUnique: async () => null } });

  await assert.rejects(() => service.updateCategory('missing', { name: 'x' }), /分类不存在/);
});

test('删除分类：连子孙一起算，作品不删除只解绑', async () => {
  let deletedImages = false;
  let countWhere: Record<string, unknown> | null = null;
  const service = makeService({
    imageCategory: {
      findUnique: async () => category({ id: 'root-a' }),
      findMany: async () => tree,
      delete: async () => category({ id: 'root-a' }),
    },
    generatedImage: {
      count: async (args: { where: Record<string, unknown> }) => {
        countWhere = args.where;
        return 7;
      },
      deleteMany: async () => {
        deletedImages = true;
        return { count: 0 };
      },
    },
  });

  const result = await service.deleteCategory('root-a');

  assert.equal(result.detachedImageCount, 7);
  assert.equal(result.deletedCategoryCount, 3);
  assert.deepEqual(result.deletedCategoryIds, ['root-a', 'child-a', 'leaf-a']);
  assert.deepEqual(countWhere, { categoryId: { in: ['root-a', 'child-a', 'leaf-a'] } });
  assert.equal(deletedImages, false);
});

test('设置归属：空值清空分类，非空值先校验分类存在', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const service = makeService({
    imageCategory: { findUnique: async () => category() },
    generatedImage: {
      findUnique: async () => ({ id: 'img-1', userId: 'user-1' }),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { id: 'img-1', categoryId: args.data.categoryId };
      },
    },
  });

  await service.assignImageCategory('user-1', 'img-1', 'cat-1');
  await service.assignImageCategory('user-1', 'img-1', '');
  await service.assignImageCategory('user-1', 'img-1', null);

  assert.deepEqual(updates, [{ categoryId: 'cat-1' }, { categoryId: null }, { categoryId: null }]);
});

test('设置归属：不能改别人的作品', async () => {
  const service = makeService({
    generatedImage: { findUnique: async () => ({ id: 'img-1', userId: 'someone-else' }) },
  });

  await assert.rejects(() => service.assignImageCategory('user-1', 'img-1', 'cat-1'));
});

test('列表筛选：选中父分类含子孙，叶子精确匹配，uncategorized 查未归类', async () => {
  const wheres: Array<Record<string, unknown>> = [];
  const service = makeService({
    imageCategory: { findMany: async () => tree },
    generatedImage: {
      count: async (args: { where: Record<string, unknown> }) => {
        wheres.push(args.where);
        return 0;
      },
      findMany: async () => [],
    },
  });

  await service.listImages('user-1', 1, 12, false, undefined, undefined, undefined, 'root-a');
  await service.listImages('user-1', 1, 12, false, undefined, undefined, undefined, 'leaf-a');
  await service.listImages('user-1', 1, 12, false, undefined, undefined, undefined, 'uncategorized');
  await service.listImages('user-1', 1, 12, false, undefined, undefined, undefined, '');

  assert.deepEqual(wheres[0].categoryId, { in: ['root-a', 'child-a', 'leaf-a'] });
  assert.equal(wheres[1].categoryId, 'leaf-a');
  assert.equal(wheres[2].categoryId, null);
  assert.equal('categoryId' in wheres[3], false);
});

// 防的是并发移动留下的成环数据：没有 visited 保护时 subtreeHeight 会 A→B→A 无限互递归爆栈，
// 让此后每一次移动校验都 500。updateCategory 已改为锁行事务，这里守住"万一还是成了环"的兜底。
test('父子关系成环时校验不爆栈，仍能给出正常业务报错', async () => {
  const cyclic = [
    category({ id: 'a', name: 'A', parentId: 'b' }),
    category({ id: 'b', name: 'B', parentId: 'a' }),
    category({ id: 'root-c', name: 'C', parentId: null }),
  ];
  const service = makeService({
    imageCategory: {
      findUnique: async () => category({ id: 'a', parentId: 'b' }),
      findMany: async () => cyclic,
    },
  });

  // 不抛 RangeError，而是走正常的业务校验分支
  await assert.rejects(
    () => service.updateCategory('a', { parentId: 'b' }),
    (error: Error) => error.name !== 'RangeError',
  );
  await assert.rejects(
    () => service.updateCategory('a', { parentId: 'root-c' }),
    (error: Error) => error.name !== 'RangeError',
  );
});
