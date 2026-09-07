import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ExpenseService, type ExpenseScope } from '../src/modules/expense/expense.service';

const scope: ExpenseScope = {
  departmentCode: 'RD',
  departmentName: '研发部',
  hasViewAll: false,
};

const actor = {
  id: 'user-1',
  name: '当前用户',
  canSubmitOnBehalf: false,
};

function linkedInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    invoice_no: 'FP-001',
    amount: 128,
    status: '已关联',
    matched_voucher_id: 'voucher-1',
    project: '研发项目',
    department_code: 'RD',
    ...overrides,
  };
}

function reimbursementPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: '测试报销单',
    applicant: '伪造申请人',
    invoice_ids: ['invoice-1'],
    voucher_ids: ['伪造凭证'],
    wecom_creator_userid: 'forged-wecom-user',
    ...overrides,
  };
}

function createService(prisma: Record<string, unknown> = {}) {
  return new ExpenseService(
    prisma as never,
    {} as never,
    { get: () => undefined } as never,
    { isEnabled: false, getSignedUrl: () => null } as never,
    {} as never,
  );
}

function stubExpenseRecords(
  service: ExpenseService,
  invoices: Array<Record<string, unknown>>,
  reimbursements: Array<Record<string, unknown>> = [],
) {
  const internal = service as unknown as {
    ensureInvoices: () => Promise<Array<Record<string, unknown>>>;
    ensureReimbursements: () => Promise<Array<Record<string, unknown>>>;
    recordEvent: () => Promise<void>;
  };
  internal.ensureInvoices = async () => invoices;
  internal.ensureReimbursements = async () => reimbursements;
  internal.recordEvent = async () => undefined;
}

test('报销单拒绝重复票据、未关联票据和已被其他报销单占用的票据', async () => {
  const service = createService();

  await assert.rejects(
    service.createReimbursement(
      reimbursementPayload({ invoice_ids: ['invoice-1', 'invoice-1'] }) as never,
      scope,
      actor,
    ),
    /重复票据/,
  );

  stubExpenseRecords(service, [linkedInvoice({ status: '已识别', matched_voucher_id: undefined })]);
  await assert.rejects(
    service.createReimbursement(reimbursementPayload() as never, scope, actor),
    /尚未关联有效付款凭证/,
  );

  stubExpenseRecords(service, [linkedInvoice()], [
    { id: 'expense-existing', status: '审批中', invoice_ids: ['invoice-1'] },
  ]);
  await assert.rejects(
    service.createReimbursement(reimbursementPayload() as never, scope, actor),
    /已进入其他报销单/,
  );
});

test('普通用户创建报销单时以后端登录身份为准，并只采用真实关联凭证', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const prisma = {
    $transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        $queryRaw: async () => [],
        systemSetting: {
          findMany: async () => [{ value: linkedInvoice() }],
          create: async ({ data }: { data: Record<string, unknown> }) => {
            writes.push(data);
            return data;
          },
        },
      }),
  };
  const service = createService(prisma);
  stubExpenseRecords(service, [linkedInvoice()]);

  const result = await service.createReimbursement(
    reimbursementPayload() as never,
    scope,
    actor,
  );

  assert.equal(result.applicant, actor.name);
  assert.equal(result.applicant_user_id, actor.id);
  assert.equal(result.wecom_creator_userid, undefined);
  assert.deepEqual(result.voucher_ids, ['voucher-1']);
  assert.equal(writes.length, 2);
  assert.match(String(writes[0].key), /^expense_reimbursement_invoice:invoice-1$/);
  assert.equal(writes[1].category, 'expense_reimbursement');
});

test('组单后修改发票金额或税额会被拒绝，元数据仍可修正且已驳回后可重新维护金额', async () => {
  let invoice: Record<string, unknown> = linkedInvoice({ tax: 10, project: '原项目' });
  let reimbursements = [{ id: 'EXP-1', status: '草稿', invoice_ids: ['invoice-1'] }];
  let writes = 0;
  const locks: string[] = [];
  const settings = {
    findUnique: async () => ({ value: invoice }),
    findMany: async () => reimbursements.map((value) => ({ value })),
    update: async ({ data }: { data: { value: typeof invoice } }) => { writes += 1; invoice = data.value; },
    upsert: async ({ update }: { update: { value: typeof invoice } }) => { writes += 1; invoice = update.value; },
  };
  const tx = { systemSetting: settings, $queryRaw: async (_sql: TemplateStringsArray, key: string) => { locks.push(key); return []; } };
  const service = createService({ systemSetting: settings, $transaction: async (run: (client: typeof tx) => unknown) => run(tx) });
  stubExpenseRecords(service, [invoice], reimbursements);
  for (const status of ['草稿', '审批中', '已通过', '已付款']) {
    reimbursements = [{ ...reimbursements[0], status }];
    for (const patch of [{ amount: 256 }, { tax: 20 }]) {
      await assert.rejects(service.updateInvoice('invoice-1', patch as never, scope), /报销单|已报销/);
      assert.equal(invoice.amount, 128);
      assert.equal(invoice.tax, 10);
    }
  }
  assert.equal(writes, 0);
  await service.updateInvoice('invoice-1', { project: '修正项目' } as never, scope);
  assert.equal(invoice.project, '修正项目');
  reimbursements = [{ ...reimbursements[0], status: '已驳回' }];
  await service.updateInvoice('invoice-1', { amount: 256 } as never, scope);
  assert.equal(invoice.amount, 256);
  assert.ok(locks.every((key) => key === 'expense-invoice:invoice-1'));
});

test('组单事务锁内发现票据已被编辑时拒绝旧金额快照，刷新后可按新金额组单', async () => {
  let current = linkedInvoice();
  let replaceOnLock = true;
  let writes = 0;
  const tx = {
    $queryRaw: async () => { if (replaceOnLock) current = linkedInvoice({ amount: 256 }); return []; },
    systemSetting: {
      findMany: async () => [{ value: current }],
      create: async ({ data }: { data: Record<string, unknown> }) => { writes += 1; return data; },
    },
  };
  const service = createService({ $transaction: async (run: (client: typeof tx) => unknown) => run(tx) });
  stubExpenseRecords(service, [linkedInvoice()]);
  await assert.rejects(service.createReimbursement(reimbursementPayload() as never, scope, actor), /票据.*变更|票据.*更新/);
  assert.equal(writes, 0);
  replaceOnLock = false;
  stubExpenseRecords(service, [current]);
  const saved = await service.createReimbursement(reimbursementPayload() as never, scope, actor);
  assert.equal(saved.amount, 256);
  assert.equal(writes, 2);
});

test('历史草稿金额与发票不一致时不调用外部审批并释放操作锁', async () => {
  const service = createService();
  stubExpenseRecords(service, [linkedInvoice({ amount: 256 })]);
  let released = 0;
  let externalReads = 0;
  const internal = service as any;
  internal.acquireReimbursementOperation = async () => undefined;
  internal.releaseReimbursementOperation = async () => { released += 1; };
  internal.getReimbursementOrThrow = async () => ({ id: 'EXP-1', status: '草稿', invoice_ids: ['invoice-1'], amount: 128 });
  internal.getResolvedIntegrationConfig = async () => { externalReads += 1; throw new Error('不应读取外部审批配置'); };
  await assert.rejects(service.submitWeComApproval('EXP-1', scope), /金额.*不一致|票据.*变更/);
  assert.equal(externalReads, 0);
  assert.equal(released, 1);
});

test('归档配置会拒绝重复分类 ID，并移除指向不存在分类的映射', async () => {
  let saved: Record<string, unknown> | undefined;
  const service = createService({
    systemSetting: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        saved = create;
        return create;
      },
    },
  });

  await assert.rejects(
    service.saveArchiveConfig({
      tree: [
        { id: 'same', name: '分类一' },
        { id: 'same', name: '分类二' },
      ],
      manual_category: {},
      excluded_ids: [],
    }),
    /分类 ID 重复/,
  );

  const result = await service.saveArchiveConfig({
    tree: [{ id: 'valid', name: '有效分类' }],
    manual_category: {
      'voucher-1': 'valid',
      'voucher-2': 'missing',
    },
    excluded_ids: ['voucher-3', 'voucher-3'],
  });

  assert.deepEqual(result.manual_category, { 'voucher-1': 'valid' });
  assert.deepEqual(result.excluded_ids, ['voucher-3']);
  assert.equal(saved?.category, 'expense_archive');
});

test('OSS 未配置时阻止上传，避免生成没有原始附件的财务记录', async () => {
  const service = createService();
  await assert.rejects(
    service.uploadInvoices(
      [{
        originalname: 'invoice.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4'),
      }],
      {},
      scope,
    ),
    /OSS 文件存储尚未配置/,
  );
});

test('删除未提交草稿时会同时释放票据占用锁', async () => {
  const deletedKeys: string[] = [];
  const service = createService({
    systemSetting: {
      create: async () => ({}),
      deleteMany: async ({ where }: { where: { key?: string } }) => {
        if (where.key) deletedKeys.push(where.key);
        return { count: 1 };
      },
    },
    $transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        systemSetting: {
          deleteMany: async ({ where }: { where: { key?: string | { in?: string[] } } }) => {
            if (typeof where.key === 'string') deletedKeys.push(where.key);
            if (where.key && typeof where.key === 'object') deletedKeys.push(...(where.key.in ?? []));
            return { count: 1 };
          },
        },
      }),
  });
  const internal = service as unknown as {
    getReimbursementOrThrow: () => Promise<Record<string, unknown>>;
    recordEvent: () => Promise<void>;
  };
  internal.getReimbursementOrThrow = async () => ({
    id: 'expense-draft',
    title: '可删除草稿',
    status: '草稿',
    wecom_flow_id: '',
    invoice_ids: ['invoice-1', 'invoice-2'],
    department_code: 'RD',
    department_name: '研发部',
  });
  internal.recordEvent = async () => undefined;

  const result = await service.deleteDraftReimbursement('expense-draft', scope);

  assert.deepEqual(result, { ok: true });
  assert.ok(deletedKeys.includes('expense_reimbursement:expense-draft'));
  assert.ok(deletedKeys.includes('expense_reimbursement_invoice:invoice-1'));
  assert.ok(deletedKeys.includes('expense_reimbursement_invoice:invoice-2'));
  assert.ok(deletedKeys.includes('expense_reimbursement_operation:expense-draft'));
});
