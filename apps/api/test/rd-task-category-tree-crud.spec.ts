import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  ensureDefaultSubProject,
  ResearchDevelopmentService,
} from '../src/modules/research-development/research-development.service';

const editableTree = [{
  id: 'cat-base',
  label: '底部结构（新）',
  children: [
    {
      id: 'cat-base-part-1',
      label: '底座（新）',
      tasks: [{
        task_id: 'task-parent',
        title: '路径同步测试',
        category_path: '底部结构 / 底座 / 研发任务',
        subtasks: [{
          task_id: 'task-child',
          title: '子任务',
          category_path: '底部结构 / 底座 / 研发任务',
        }],
      }],
    },
    {
      id: 'rd-sub-custom-empty',
      label: '新增空部件',
      tasks: [],
    },
  ],
}, {
  id: 'rd-cat-custom',
  label: '自定义系统',
  children: [],
}];

/** 模拟服务端读路径：读出来的树一定补过默认子项 */
function injected<T>(value: T): T {
  return ensureDefaultSubProject(value as unknown as Array<Record<string, unknown>>) as unknown as T;
}

function cloneTree<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// 与服务端读路径同源：readNormalizedTaskCategories / readProductTaskCategorySnapshot 都会
// 给空 children 的一级分类补默认子项，客户端手里的版本号就是按补完的树算的。
// 这里少这一步，就会把生产上正常的提交在测试里判成冲突。
function structureRevision(rawCategories: typeof editableTree): string {
  const categories = ensureDefaultSubProject(
    rawCategories as unknown as Array<Record<string, unknown>>,
  ) as unknown as typeof editableTree;
  const projectTask = (task: Record<string, unknown>): Record<string, unknown> => ({
    task_id: String(task.task_id ?? '').trim(),
    subtasks: ((task.subtasks as Array<Record<string, unknown>> | undefined) ?? []).map(projectTask),
  });
  const projection = categories.map((category) => ({
    id: category.id.trim(),
    label: category.label.trim(),
    children: category.children.map((child) => ({
      id: child.id.trim(),
      label: child.label.trim(),
      tasks: child.tasks.map((task) => projectTask(task as unknown as Record<string, unknown>)),
    })),
  }));
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex').slice(0, 24);
}

function versionedStructurePayload<T extends typeof editableTree>(current: typeof editableTree, next: T): T {
  const revision = structureRevision(current);
  return next.map((category) => ({ ...category, _structure_revision: revision })) as unknown as T;
}

function withoutStructureRevision(categories: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return categories.map(({ _structure_revision: _revision, ...category }) => category);
}

test('whole-tree save preserves editable nodes exactly and synchronizes task category paths', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let written: unknown;

  service.refreshProductionMirrorsIfNeeded = async () => undefined;
  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  const currentTree = cloneTree(editableTree);
  currentTree[0].label = 'old-system-name';
  currentTree[0].children[0].label = 'old-node-name';
  currentTree[0].children[0].tasks[0].title = '服务端最新标题';
  (currentTree[0].children[0].tasks[0] as Record<string, unknown>).progress = 77;
  service.readNormalizedTaskCategories = async () => injected(currentTree);
  service.writeValue = async (_key: string, value: unknown) => {
    written = value;
    return value;
  };
  service.recomputeDirectorDashboard = async () => undefined;

  const saved = await service.saveTaskCategories(versionedStructurePayload(currentTree, editableTree));

  assert.deepEqual(
    saved.map((category: Record<string, unknown>) => category.id),
    ['cat-base', 'rd-cat-custom'],
    'deleted default systems must not be silently recreated',
  );
  const base = saved[0] as Record<string, unknown>;
  const children = base.children as Array<Record<string, unknown>>;
  assert.deepEqual(
    children.map((child) => child.id),
    ['cat-base-part-1', 'rd-sub-custom-empty'],
    'added empty children must persist and deleted default children must stay deleted',
  );
  const task = (children[0].tasks as Array<Record<string, unknown>>)[0];
  assert.equal(task.title, '服务端最新标题', 'stale structure payload must not roll back task fields');
  assert.equal(task.progress, 77);
  assert.equal(task.category_path, '底部结构（新） / 底座（新） / 研发任务');
  assert.equal(
    ((task.subtasks as Array<Record<string, unknown>>)[0]).category_path,
    '底部结构（新） / 底座（新） / 研发任务',
  );
  assert.ok(saved.every((category: Record<string, unknown>) => typeof category._structure_revision === 'string'));
  assert.deepEqual(written, withoutStructureRevision(saved));
});

test('whole-tree save rejects deleting a node that still contains tasks', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let writes = 0;

  service.refreshProductionMirrorsIfNeeded = async () => undefined;
  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  service.readNormalizedTaskCategories = async () => injected(cloneTree(editableTree));
  service.writeValue = async (_key: string, value: unknown) => {
    writes += 1;
    return value;
  };
  service.recomputeDirectorDashboard = async () => undefined;

  const treeWithoutPopulatedNode = cloneTree(editableTree);
  treeWithoutPopulatedNode[0].children = treeWithoutPopulatedNode[0].children.slice(1);

  await assert.rejects(
    () => service.saveTaskCategories(versionedStructurePayload(editableTree, treeWithoutPopulatedNode)),
    /node.*tasks|节点.*任务/i,
  );
  assert.equal(writes, 0);
});

test('whole-tree save rejects removing only a nested subtask', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let writes = 0;

  service.refreshProductionMirrorsIfNeeded = async () => undefined;
  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  service.readNormalizedTaskCategories = async () => injected(cloneTree(editableTree));
  service.writeValue = async () => { writes += 1; };
  service.recomputeDirectorDashboard = async () => undefined;

  const treeWithoutNestedTask = cloneTree(editableTree);
  treeWithoutNestedTask[0].children[0].tasks[0].subtasks = [];
  await assert.rejects(
    () => service.saveTaskCategories(versionedStructurePayload(editableTree, treeWithoutNestedTask)),
    /node.*tasks|节点.*任务/i,
  );
  assert.equal(writes, 0);
});

test('product-tree save returns server truth and refreshes downstream dashboard data', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let stored: unknown;
  let dashboardRefreshes = 0;

  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  const currentTree = cloneTree(editableTree);
  currentTree[0].label = '旧系统名';
  currentTree[0].children[0].tasks[0].title = '产品库最新标题';
  (currentTree[0].children[0].tasks[0] as Record<string, unknown>).progress = 88;
  service.readProductCategoryStore = async () => ({ 'product-a': currentTree });
  service.saveProductCategoryStore = async (value: unknown) => {
    stored = value;
  };
  service.recomputeDirectorDashboard = async () => {
    dashboardRefreshes += 1;
  };

  const result = await service.saveProductTaskCategoriesForProduct(
    'product-a',
    versionedStructurePayload(currentTree, editableTree),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    withoutStructureRevision(result.categories),
    (stored as Record<string, unknown>)['product-a'],
  );
  const savedTask = result.categories[0].children as Array<Record<string, unknown>>;
  assert.equal(((savedTask[0].tasks as Array<Record<string, unknown>>)[0]).title, '产品库最新标题');
  assert.equal(((savedTask[0].tasks as Array<Record<string, unknown>>)[0]).progress, 88);
  assert.equal(dashboardRefreshes, 1);
});

test('product-tree save rejects deleting a system that still contains tasks', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let saves = 0;

  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  service.readProductCategoryStore = async () => ({ 'product-a': cloneTree(editableTree) });
  service.saveProductCategoryStore = async () => {
    saves += 1;
  };
  service.recomputeDirectorDashboard = async () => undefined;

  await assert.rejects(
    () => service.saveProductTaskCategoriesForProduct(
      'product-a',
      versionedStructurePayload(editableTree, [editableTree[1]] as typeof editableTree),
    ),
    /node.*tasks|节点.*任务/i,
  );
  assert.equal(saves, 0);
});

test('structure save rejects injected and duplicate task ids', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let writes = 0;

  service.refreshProductionMirrorsIfNeeded = async () => undefined;
  service.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  service.readNormalizedTaskCategories = async () => injected(cloneTree(editableTree));
  service.writeValue = async () => { writes += 1; };
  service.recomputeDirectorDashboard = async () => undefined;

  const injectedTree = cloneTree(editableTree);
  injectedTree[0].children[0].tasks.push({
    task_id: 'task-injected',
    title: '越权注入',
    category_path: '底部结构 / 底座 / 研发任务',
    subtasks: [],
  });
  await assert.rejects(
    () => service.saveTaskCategories(versionedStructurePayload(editableTree, injectedTree)),
    /node.*tasks|节点.*任务/i,
  );

  const duplicatedTree = cloneTree(editableTree);
  duplicatedTree[0].children[0].tasks.push(cloneTree(duplicatedTree[0].children[0].tasks[0]));
  await assert.rejects(
    () => service.saveTaskCategories(versionedStructurePayload(editableTree, duplicatedTree)),
    /task|任务/i,
  );
  assert.equal(writes, 0);
});

test('product-tree structure save cannot overwrite a task added while its stale snapshot is waiting', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let store: Record<string, unknown> = { 'product-a': cloneTree(editableTree) };
  let releaseTaskWrite: (() => void) | undefined;
  let taskWriteStarted: (() => void) | undefined;
  const taskWriteReady = new Promise<void>((resolve) => { taskWriteStarted = resolve; });
  const taskWriteGate = new Promise<void>((resolve) => { releaseTaskWrite = resolve; });

  service.taskTreeWriteLock = Promise.resolve();
  service.readProductCategoryStore = async () => cloneTree(store);
  service.saveProductCategoryStore = async (next: Record<string, unknown>) => { store = cloneTree(next); };
  service.recomputeDirectorDashboard = async () => undefined;

  const internalTaskWrite = service.withTaskTreeLock(async () => {
    const current = cloneTree(store['product-a']) as typeof editableTree;
    taskWriteStarted?.();
    await taskWriteGate;
    current[0].children[0].tasks.push({
      task_id: 'RD-2026-NEW',
      title: '并发新任务',
      category_path: '底部结构（新） / 底座（新） / 研发任务',
      subtasks: [],
    });
    await service.writeTaskCategoriesForProduct('product-a', current);
  });

  await taskWriteReady;
  const staleRename = cloneTree(editableTree);
  staleRename[0].label = '过时的结构改名';
  const structureSave = service.saveProductTaskCategoriesForProduct(
    'product-a',
    versionedStructurePayload(editableTree, staleRename),
  );
  releaseTaskWrite?.();

  await internalTaskWrite;
  await assert.rejects(
    () => structureSave,
    /updated|refresh|已.*更新|刷新/i,
  );
  const savedTree = store['product-a'] as typeof editableTree;
  assert.equal(savedTree[0].children[0].tasks.some((task) => task.task_id === 'RD-2026-NEW'), true);
});

test('stale structure revisions cannot roll back another administrator node edit', async () => {
  const staleBase = cloneTree(editableTree);
  const latestTree = cloneTree(editableTree);
  latestTree[0].children[1].label = '管理员 A 新增名称';
  const staleEdit = cloneTree(editableTree);
  staleEdit[1].label = '管理员 B 的陈旧修改';

  const mainService = Object.create(ResearchDevelopmentService.prototype) as any;
  let mainWrites = 0;
  mainService.refreshProductionMirrorsIfNeeded = async () => undefined;
  mainService.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  mainService.readNormalizedTaskCategories = async () => injected(cloneTree(latestTree));
  mainService.writeValue = async () => { mainWrites += 1; };
  mainService.recomputeDirectorDashboard = async () => undefined;
  await assert.rejects(
    () => mainService.saveTaskCategories(versionedStructurePayload(staleBase, staleEdit)),
    /updated|refresh|已.*更新|刷新/i,
  );
  assert.equal(mainWrites, 0);

  const productService = Object.create(ResearchDevelopmentService.prototype) as any;
  let productWrites = 0;
  productService.withTaskTreeLock = (operation: () => Promise<unknown>) => operation();
  productService.readProductCategoryStore = async () => ({ 'product-a': cloneTree(latestTree) });
  productService.saveProductCategoryStore = async () => { productWrites += 1; };
  productService.recomputeDirectorDashboard = async () => undefined;
  await assert.rejects(
    () => productService.saveProductTaskCategoriesForProduct(
      'product-a',
      versionedStructurePayload(staleBase, staleEdit),
    ),
    /updated|refresh|已.*更新|刷新/i,
  );
  assert.equal(productWrites, 0);
});

test('normalizing read paths never write an old task-tree snapshot', async () => {
  const mainService = Object.create(ResearchDevelopmentService.prototype) as any;
  let mainWrites = 0;
  mainService.readArray = async () => cloneTree(editableTree);
  mainService.getIdentityContext = async () => ({ people: [], users: [] });
  mainService.writeValue = async () => { mainWrites += 1; };
  const mainResult = await mainService.readNormalizedTaskCategories();
  assert.equal(mainResult[0].children[0].tasks[0].category_path, '底部结构（新） / 底座（新） / 研发任务');
  assert.equal(mainWrites, 0);

  const productService = Object.create(ResearchDevelopmentService.prototype) as any;
  let productWrites = 0;
  productService.readProductCategoryStore = async () => ({ 'product-a': cloneTree(editableTree) });
  productService.saveProductCategoryStore = async () => { productWrites += 1; };
  const productResult = await productService.getProductTaskCategoriesUnlocked('product-a');
  assert.equal(productResult[0].children[0].tasks[0].category_path, '底部结构（新） / 底座（新） / 研发任务');
  assert.equal(productWrites, 0);
});

test('director dashboard recomputes are serialized', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  service.directorDashboardWriteLock = Promise.resolve();
  const started: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  service.recomputeDirectorDashboardUnlocked = async () => {
    const call = started.length + 1;
    started.push(call);
    if (call === 1) await firstGate;
  };

  const first = service.recomputeDirectorDashboard();
  const second = service.recomputeDirectorDashboard();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1]);
  releaseFirst?.();
  await Promise.all([first, second]);
  assert.deepEqual(started, [1, 2]);
});

test('late database reads cannot overwrite a newer store or task-resource cache generation', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;
  let releaseRead: ((value: { value: unknown }) => void) | undefined;
  let readStarted: (() => void) | undefined;
  const readReady = new Promise<void>((resolve) => { readStarted = resolve; });
  const delayedRead = new Promise<{ value: unknown }>((resolve) => { releaseRead = resolve; });
  let databaseReads = 0;

  service.rdStoreReadCache = new Map();
  service.rdStoreCacheGenerations = new Map();
  service.rdTaskResourceCache = new Map();
  service.rdTaskResourceCacheGeneration = 0;
  service.prisma = {
    systemSetting: {
      findUnique: async () => {
        databaseReads += 1;
        readStarted?.();
        return delayedRead;
      },
      upsert: async ({ update }: { update: { value: unknown } }) => ({ value: cloneTree(update.value) }),
    },
  };

  const staleResourceKey = service.taskResourceCacheKey('task-categories', [], { hasFullAccess: true });
  const oldRead = service.readValue('rd.taskCategories');
  await readReady;
  const latestTree = cloneTree(editableTree);
  latestTree[0].label = '最新数据';
  await service.writeValue('rd.taskCategories', latestTree);
  releaseRead?.({ value: cloneTree(editableTree) });

  const oldResult = await oldRead;
  assert.equal(oldResult[0].label, '底部结构（新）');
  const cachedLatest = await service.readValue('rd.taskCategories');
  assert.equal(cachedLatest[0].label, '最新数据');
  assert.equal(databaseReads, 1, 'the second read must use the newer write-through cache');

  service.writeTaskResourceCache(staleResourceKey, { label: '过时派生数据' });
  const currentResourceKey = service.taskResourceCacheKey('task-categories', [], { hasFullAccess: true });
  assert.notEqual(staleResourceKey, currentResourceKey);
  assert.equal(service.readTaskResourceCache(currentResourceKey), undefined);
});

// 「移动归类」失败时的报错必须说清是哪种处境：
// 旧文案「可能是子任务或已不存在」把两种完全不同的原因混在一句里，用户无从判断
// 该去父任务里摘出、还是该重新生成确认卡；而 Agent 的查询是递归进 subtasks 的，
// 它会说「任务都存在」，与只认顶层的移动判定直接冲突。
test('移动归类失败时区分「已并入父任务」与「确实不存在」', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;

  const trees = new Map<string, any[]>([
    ['main', [
      {
        id: 'cat-1',
        label: '系统 A',
        children: [
          {
            id: 'sub-1',
            label: '子项 1',
            tasks: [
              {
                task_id: 'RD-PARENT',
                title: '压缩机总成',
                subtasks: [{ task_id: 'RD-CHILD', title: '压缩机罩测试' }],
              },
            ],
          },
        ],
      },
    ]],
  ]);

  const message = service.describeUnmovableTasks(
    ['RD-CHILD', 'RD-GONE'],
    trees,
    new Map(),
  );

  assert.match(message, /RD-CHILD（已并入「压缩机总成」）/, '子任务要报出它的父任务标题');
  assert.match(message, /从父任务摘出/, '要告诉用户下一步做什么');
  assert.match(message, /RD-GONE/, '不存在的任务要单独列出');
  assert.match(message, /重新生成/, '不存在的情况要引导重新生成确认卡');
  assert.ok(
    !/可能是子任务或已不存在/.test(message),
    '不能再出现把两种原因混为一谈的旧文案',
  );
});

// 同时选中父任务和它的子任务时，父任务已被摘走，子任务在剩余树里也找不到——
// 若只扫剩余树会把它误报成「不存在」，实际它是随父任务一起被收走的。
test('父任务已被摘出时，其子任务仍能被认出是子任务而非不存在', async () => {
  const service = Object.create(ResearchDevelopmentService.prototype) as any;

  const collected = new Map<string, any>([
    ['RD-PARENT', { task_id: 'RD-PARENT', title: '压缩机总成', subtasks: [{ task_id: 'RD-CHILD', title: '罩测试' }] }],
  ]);

  const message = service.describeUnmovableTasks(['RD-CHILD'], new Map(), collected);

  assert.match(message, /RD-CHILD（已并入「压缩机总成」）/);
  assert.ok(!/不存在/.test(message), '不能误报成不存在');
});
