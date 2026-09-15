import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ResumeScreeningController } from '../src/modules/resume-screening/resume-screening.controller';
import { ResumeScreeningService } from '../src/modules/resume-screening/resume-screening.service';
import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';

type ModelResult = Awaited<ReturnType<OpenAiScreeningService['iterateCandidateFilter']>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const payload = { instruction: '海外品牌与内容营销经理，如果没有美国经验、没有医疗背景，一律低分', job_rule_id: 'job-1' };
function modelResult(count = 1, action: 'filter' | 'clarify' = 'filter'): ModelResult {
  const result = { action, answer: action === 'filter' ? '已完成评分。' : '美国经验是否为必选条件？',
    clarification_question: '', filter_summary: '优先美国市场与医疗行业经验。', criteria: ['美国市场经验', '医疗行业经验'],
    candidate_updates: action === 'filter' ? Array.from({ length: count }, (_, i) => ({ candidate_id: `candidate-${i + 1}`, score: 30, decision: 'reject', summary: '缺少医疗行业经验。', change_reason: '缺少必要背景。' })) : [],
  };
  return { result, modelName: 'test-model', durationMs: 120000,
    usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
    requestPayload: { job_context: {}, candidates: [], conversation_history: [], recruiter_instruction: payload.instruction, task: 'test' },
    responsePayload: { raw_output: JSON.stringify(result), structured_output: result },
  };
}

// Business-service tests inject the store contract. SQL locking/fencing is tested against real PostgreSQL separately.
function memoryStore() {
  const tasks = new Map<string, any>();
  const owned = async (id: string, userId: string) => {
    const task = tasks.get(id);
    if (!task || task.userId !== userId) throw new NotFoundException();
    return task;
  };
  const current = async (userId: string) => [...tasks.values()].find((task) => task.userId === userId && ['pending', 'processing'].includes(task.status)) ?? null;
  return { tasks, getOwned: owned, getCurrent: current,
    latest: async (userId: string) => [...tasks.values()].filter((task) => task.userId === userId).at(-1) ?? null,
    create: async (userId: string, fingerprint: string, data: unknown, initial: { snapshot: unknown; totalCount: number }) => {
      const active = await current(userId);
      if (active) { if (active.fingerprint === fingerprint) return active; throw new ConflictException(); }
      const task = { id: `task-${tasks.size + 1}`, userId, fingerprint, status: 'pending', phase: 'queued', payloadJson: data,
        snapshotJson: JSON.parse(JSON.stringify(initial.snapshot)), totalCount: initial.totalCount, processedCount: 0,
        createdAt: new Date(), updatedAt: new Date(), batches: [], analysisJson: null, resultJson: null };
      tasks.set(task.id, task); return task;
    },
    claim: async () => {
      const task = [...tasks.values()].find((task) => task.status === 'pending');
      if (!task) return null;
      task.status = 'processing'; task.claimToken = `claim-${task.id}`; return task;
    },
    heartbeat: async (claim: any) => tasks.get(claim.id)?.claimToken === claim.claimToken,
    setPhase: async (claim: any, phase: string) => { tasks.get(claim.id).phase = phase; },
    finalize: async (claim: any, publish: (tx: any) => Promise<unknown>): Promise<unknown> => { throw new Error('fixture must attach publisher'); },
    fail: async (claim: any, error: string) => { Object.assign(tasks.get(claim.id), { status: 'failed', phase: 'failed', error }); return true; },
    retry: async (id: string, userId: string) => {
      const task = await owned(id, userId); const active = await current(userId);
      if (active && active.id !== id) throw new ConflictException();
      if (task.status !== 'failed') throw new BadRequestException();
      Object.assign(task, { status: 'pending', phase: 'queued', error: null }); return task;
    },
  };
}
function fixture(count = 1, sharedStore = memoryStore()) {
  const model = deferred<ModelResult>();
  const calls = { model: 0, transactions: 0, rows: [] as any[], query: null as any };
  const jobRule = { id: 'job-1', name: '海外品牌与内容营销经理', jdText: '负责美国市场医疗行业营销。' };
  const source = Array.from({ length: count }, (_, i) => ({ id: `candidate-${i + 1}`, jobRuleId: jobRule.id, jobRule, screenings: [],
    name: '匿名候选人', rawEmailText: '美国市场品牌营销经验。', uniqueKey: `resume-${i}`, sourceSubject: '应聘', parsedCandidateProfile: {} }));
  const prisma = {
    jobRule: { findUnique: async () => jobRule }, candidate: { findMany: async (query: unknown) => { calls.query = query; return source; } },
    user: { findUnique: async () => ({ status: 'ACTIVE', role: { permissions: ['*'] } }) },
    integrationConfig: { findMany: async () => [] },
    candidateScreening: { createMany: async ({ data }: { data: any[] }) => { calls.rows.push(...data); return { count: data.length }; } },
    $transaction: async (run: (tx: any) => Promise<unknown>) => { calls.transactions += 1; return run(prisma); },
  };
  sharedStore.finalize = async (claim, publish) => {
    const result = await prisma.$transaction(publish);
    Object.assign(sharedStore.tasks.get(claim.id), { status: 'completed', phase: 'complete', resultJson: result }); return result;
  };
  const permissions = { filterDisabled: async (codes: string[]) => codes };
  const service = new ResumeScreeningService(prisma as never, {} as never, {} as never, {} as never,
    { extractCandidateProfile: () => ({}) } as never,
    { isConfigured: () => true, iterateCandidateFilter: () => { calls.model += 1; return model.promise; } } as never, {} as never, permissions as never);
  (service as any).filterStore = sharedStore;
  return { service, model, calls, source, store: sharedStore, prisma, permissions };
}
async function drain() { for (let i = 0; i < 8; i += 1) await setImmediate(); }

test('提交冻结全部500人范围后立即返回任务，模型尚未完成时不保存评分', async () => {
  const f = fixture(500);
  const submitted = await f.service.createCandidateFilterTask('user-1', payload);
  assert.equal(submitted.total_count, 500);
  assert.equal(submitted.result, undefined);
  assert.equal(f.calls.query.take, 5001, '不再静默截断80人');
  assert.equal(f.calls.query.include.screenings.take, 1, '每人只读本轮基础评分，避免加载80个历史版本');
  await drain(); assert.equal(f.calls.model, 1); assert.equal(f.calls.rows.length, 0);
  const repeated = await f.service.createCandidateFilterTask('user-1', payload);
  assert.equal(repeated.task_id, submitted.task_id);
  f.source[0].rawEmailText = '提交后发生的变更';
  f.source.push({ ...f.source[0], id: 'new-after-submission' });
  f.model.resolve(modelResult(500)); await drain();
  const completed = await f.service.getCandidateFilterTask('user-1', submitted.task_id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.result?.total_count, 500);
  assert.equal(f.calls.transactions, 1); assert.equal(f.calls.rows.length, 500);
  assert.ok(f.calls.rows.every((row) => row.promptVersion === `iterative-filter:filter-${submitted.task_id}`));
  assert.doesNotMatch(JSON.stringify(f.calls.rows), /提交后发生的变更|new-after-submission/);
  assert.equal((await f.service.getCurrentCandidateFilterTask('user-1'))?.task_id, submitted.task_id);
  assert.equal(f.calls.rows.length, 500, '重复读取不重复发布');
});

test('超出5000人范围明确拒绝，不能只返回前5000人', async () => {
  const f = fixture(5001);
  await assert.rejects(f.service.createCandidateFilterTask('user-1', payload), /超过 5000/);
  assert.equal(f.store.tasks.size, 0); assert.equal(f.calls.model, 0);
});

test('共享数据库中的任务可跨服务实例读取和恢复最近结果', async () => {
  const f = fixture(); const submission = await f.service.createCandidateFilterTask('user-1', payload);
  const second = fixture(1, f.store);
  assert.equal((await second.service.getCurrentCandidateFilterTask('user-1'))?.task_id, submission.task_id);
  f.model.resolve(modelResult(1, 'clarify')); await drain();
  const result = await second.service.getCandidateFilterTask('user-1', submission.task_id);
  assert.equal(result.status, 'completed'); assert.equal(result.result?.action, 'clarify');
  assert.equal(second.calls.rows.length, 0);
});

test('网关503保留一次真实状态与追踪编号，失败任务可在原任务上重试', async () => {
  const f = fixture(); const submission = await f.service.createCandidateFilterTask('user-1', payload); await drain();
  f.model.reject(new ServiceUnavailableException({ message: 'AI 服务暂时不可用，请稍后重试', request_id: 'gateway-request-503', error_code: 'UPSTREAM_ERROR', scene: 'hr.resume_screening', attempts: [{ apiKey: 'test-secret' }] }));
  await drain(); const failed = await f.service.getCandidateFilterTask('user-1', submission.task_id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.retryable, true);
  assert.equal((failed.error?.match(/status=/g) ?? []).length, 1);
  assert.match(failed.error ?? '', /status=503/); assert.match(failed.error ?? '', /request_id=gateway-request-503/);
  assert.match(failed.error ?? '', /error_code=UPSTREAM_ERROR/); assert.doesNotMatch(JSON.stringify(failed), /test-secret|attempts|status=400/);
  assert.equal(f.calls.rows.length, 0);
  const retry = await f.service.retryCandidateFilterTask('user-1', submission.task_id);
  assert.equal(retry.task_id, submission.task_id); await drain();
});

test('不完整模型返回不会发布混杂新旧评分版本', async () => {
  const f = fixture(20); const submission = await f.service.createCandidateFilterTask('user-1', payload);
  f.model.resolve(modelResult(1)); await drain();
  assert.equal((await f.service.getCandidateFilterTask('user-1', submission.task_id)).status, 'failed');
  assert.equal(f.calls.transactions, 0); assert.equal(f.calls.rows.length, 0);
});

test('无身份、空条件、非法人数立即拒绝，任务按账号隔离', async () => {
  const f = fixture();
  await assert.rejects(f.service.createCandidateFilterTask('', payload), UnauthorizedException);
  await assert.rejects(f.service.getCandidateFilterTask('', 'task'), UnauthorizedException);
  await assert.rejects(f.service.createCandidateFilterTask('user', { instruction: ' ' }), BadRequestException);
  await assert.rejects(f.service.createCandidateFilterTask('user', { ...payload, limit: 5001 }), BadRequestException);
  const task = await f.service.createCandidateFilterTask('user', payload);
  await assert.rejects(f.service.createCandidateFilterTask('user', { instruction: '其他条件' }), ConflictException);
  await assert.rejects(f.service.getCandidateFilterTask('other', task.task_id), NotFoundException);
  await assert.rejects(f.service.retryCandidateFilterTask('other', task.task_id), NotFoundException);
  f.model.resolve(modelResult()); await drain();
});

test('长时间排队后用户失去筛选权限，不继续发送简历或发布结果', async () => {
  const f = fixture(); f.prisma.user.findUnique = async () => ({ status: 'DISABLED', role: { permissions: ['*'] } });
  const task = await f.service.createCandidateFilterTask('user', payload); await drain();
  const failed = await f.service.getCandidateFilterTask('user', task.task_id);
  assert.equal(failed.status, 'failed'); assert.match(failed.error ?? '', /权限已变更/);
  assert.equal(f.calls.model, 0); assert.equal(f.calls.rows.length, 0);
});

test('内部执行的网关响应保留状态，只透传安全追踪字段', async () => {
  const f = fixture(); const request = f.service.iterateCandidateFilter(payload);
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof HttpException); assert.equal(error.getStatus(), 503);
    assert.deepEqual(error.getResponse(), { message: 'AI 迭代筛选失败：模型暂不可用', error_code: 'UPSTREAM_ERROR' }); return true;
  });
  await drain(); f.model.reject(new ServiceUnavailableException({ message: '模型暂不可用', error_code: 'UPSTREAM_ERROR', request_id: 'https://private/token?secret=example', scene: 'unsafe\ntrace' }));
  await rejected;
});

test('权限目录停用筛选后，排队任务不调用模型，运行中的结果不发布', async () => {
  const queued = fixture();
  queued.permissions.filterDisabled = async () => [];
  const task = await queued.service.createCandidateFilterTask('user', payload); await drain();
  assert.equal((await queued.service.getCandidateFilterTask('user', task.task_id)).status, 'failed');
  assert.equal(queued.calls.model, 0);

  const running = fixture();
  const active = await running.service.createCandidateFilterTask('user', payload); await drain();
  assert.equal(running.calls.model, 1);
  running.permissions.filterDisabled = async () => [];
  running.model.resolve(modelResult()); await drain();
  assert.equal((await running.service.getCandidateFilterTask('user', active.task_id)).status, 'failed');
  assert.equal(running.calls.rows.length, 0);
});

test('服务关闭中止模型请求并保留可接管任务，不把部署取消记为模型故障', async () => {
  const f = fixture();
  let signal: AbortSignal | undefined;
  const runtimeUpdates: unknown[] = [];
  (f.service as any).updateOpenAiModelRuntime = async (...args: unknown[]) => { runtimeUpdates.push(args); };
  (f.service as any).openAiScreeningService.iterateCandidateFilter = (...args: any[]) => {
    signal = args[8].signal;
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  };
  const task = await f.service.createCandidateFilterTask('user', payload); await drain();
  assert.equal(signal?.aborted, false);
  f.service.onModuleDestroy(); await drain();
  assert.equal(signal?.aborted, true);
  assert.equal((await f.service.getCandidateFilterTask('user', task.task_id)).status, 'processing');
  assert.equal(f.calls.rows.length, 0);
  assert.deepEqual(runtimeUpdates, []);
  assert.equal((f.service as any).filterWorkers.size, 0);
});

test('旧提交接口与异步接口均进入同一持久队列，所有查询重试使用登录账号', async () => {
  const calls: unknown[][] = [];
  const controller = new ResumeScreeningController({
    createCandidateFilterTask: (...args: unknown[]) => { calls.push(args); return {}; },
    getCandidateFilterTask: (...args: unknown[]) => { calls.push(args); return {}; },
    getCurrentCandidateFilterTask: (...args: unknown[]) => { calls.push(args); return {}; },
    retryCandidateFilterTask: (...args: unknown[]) => { calls.push(args); return {}; },
  } as never);
  controller.iterateCandidateFilter(payload, { user: { id: 'u' } });
  controller.createCandidateFilterTask({ user: { sub: 'u' } }, payload);
  controller.getCandidateFilterTask({ user: { id: 'u' } }, 't');
  const currentResponses: unknown[] = [];
  const response = { json: (body: unknown) => { currentResponses.push(body); } };
  await controller.getCurrentCandidateFilterTask({ user: { id: 'u', sub: 'ignored-sub' } }, response as never);
  await controller.getCurrentCandidateFilterTask({ user: { sub: 'sub-user' } }, response as never);
  controller.retryCandidateFilterTask({ user: { id: 'u' } }, 't');
  assert.deepEqual(calls, [['u', payload], ['u', payload], ['u', 't'], ['u'], ['sub-user'], ['u', 't']]);
  assert.deepEqual(currentResponses, [{}, {}]);
});
