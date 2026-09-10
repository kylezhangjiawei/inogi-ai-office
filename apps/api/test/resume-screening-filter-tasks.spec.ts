import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ResumeScreeningController } from '../src/modules/resume-screening/resume-screening.controller';
import { ResumeScreeningService } from '../src/modules/resume-screening/resume-screening.service';
import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';

type ModelResult = Awaited<ReturnType<OpenAiScreeningService['iterateCandidateFilter']>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const payload = {
  instruction: '海外品牌与内容营销经理，如果没有美国经验、没有医疗背景，一律低分',
  job_rule_id: 'job-1',
  candidate_ids: ['candidate-1'],
};

function modelResult(action: 'filter' | 'clarify' = 'filter'): ModelResult {
  const result = {
    action,
    answer: action === 'filter' ? '已完成评分。' : '美国经验是否为必选条件？',
    clarification_question: action === 'clarify' ? '美国经验是否为必选条件？' : '',
    filter_summary: '优先美国市场与医疗行业经验。',
    criteria: ['美国市场经验', '医疗行业经验'],
    candidate_updates: action === 'filter' ? [{
      candidate_id: 'candidate-1', score: 30, decision: 'reject',
      summary: '缺少医疗行业经验。', change_reason: '缺少必要背景。',
    }] : [],
  };
  return {
    result,
    modelName: 'test-model',
    durationMs: 120000,
    usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
    requestPayload: { job_context: {}, candidates: [], conversation_history: [], recruiter_instruction: payload.instruction, task: 'test' },
    responsePayload: { raw_output: JSON.stringify(result), structured_output: result },
  };
}

function fixture() {
  const model = deferred<ModelResult>();
  const calls = { model: 0, transactions: 0, rows: [] as Record<string, unknown>[] };
  const jobRule = { id: 'job-1', name: '海外品牌与内容营销经理', jdText: '负责美国市场医疗行业营销。' };
  const service = new ResumeScreeningService({
    jobRule: { findUnique: async () => jobRule },
    candidate: { findMany: async () => [{
      id: 'candidate-1', jobRuleId: jobRule.id, jobRule, screenings: [],
      name: '测试候选人', rawEmailText: '美国市场品牌营销经验。',
      uniqueKey: 'test-resume', sourceSubject: '应聘', parsedCandidateProfile: {},
    }] },
    integrationConfig: { findMany: async () => [] },
    candidateScreening: { create: ({ data }: { data: Record<string, unknown> }) => {
      calls.rows.push(data);
      return Promise.resolve({ id: `screening-${calls.rows.length}`, ...data });
    } },
    $transaction: async (operations: Promise<unknown>[]) => {
      calls.transactions += 1;
      return Promise.all(operations);
    },
  } as never, {} as never, {} as never, {} as never, {
    extractCandidateProfile: () => ({}),
  } as never, {
    isConfigured: () => true,
    iterateCandidateFilter: () => { calls.model += 1; return model.promise; },
  } as never, {} as never);
  return { service, model, calls };
}

test('慢 AI 会阻塞原同步接口，异步提交立即返回并在后台只保存一次评分版本', async () => {
  const original = fixture();
  let originalReturned = false;
  const originalRequest = original.service.iterateCandidateFilter(payload).then((result) => {
    originalReturned = true;
    return result;
  });
  await setImmediate();
  assert.equal(original.calls.model, 1);
  assert.equal(originalReturned, false, '同步请求仍在等待模型，网关会继续占用连接');
  assert.equal(original.calls.transactions, 0);

  const { service, model, calls } = fixture();
  const submission = service.createCandidateFilterTask('user-1', payload);
  assert.equal(submission.status, 'pending');
  assert.ok(submission.task_id);
  await setImmediate();
  assert.equal(service.getCandidateFilterTask('user-1', submission.task_id).status, 'processing');
  assert.equal(calls.model, 1);
  assert.equal(calls.transactions, 0, '模型尚未完成时不应保存评分');

  const duplicate = service.createCandidateFilterTask('user-1', { ...payload });
  assert.equal(duplicate.task_id, submission.task_id);
  model.resolve(modelResult());
  await setImmediate();
  const completed = service.getCandidateFilterTask('user-1', submission.task_id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result?.action, 'filter');
  assert.equal(completed.result?.total_count, 1);
  assert.equal(completed.result?.reject_count, 1);
  assert.ok(completed.result && 'version_id' in completed.result && completed.result.version_id);
  assert.equal(calls.model, 1);
  assert.equal(calls.transactions, 1);
  assert.equal(calls.rows.length, 1);
  assert.equal(calls.rows[0].score, 30);
  assert.deepEqual(service.getCandidateFilterTask('user-1', submission.task_id), completed);
  assert.equal(calls.transactions, 1, '重复轮询不能重复写入评分');

  original.model.resolve(modelResult());
  await originalRequest;
  assert.equal(originalReturned, true);
});

test('澄清结果可以通过任务查询恢复，并且不会创建评分版本', async () => {
  const { service, model, calls } = fixture();
  const submission = service.createCandidateFilterTask('user-1', payload);
  model.resolve(modelResult('clarify'));
  await setImmediate();
  const completed = service.getCandidateFilterTask('user-1', submission.task_id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result?.action, 'clarify');
  assert.equal(completed.result?.answer, '美国经验是否为必选条件？');
  assert.equal(calls.transactions, 0);
  assert.equal(calls.rows.length, 0);
});

test('模型失败可查询明确错误，结束后允许重新提交', async () => {
  const { service, model, calls } = fixture();
  const submission = service.createCandidateFilterTask('user-1', payload);
  await setImmediate();
  model.reject(new Error('upstream request timed out'));
  await setImmediate();
  const failed = service.getCandidateFilterTask('user-1', submission.task_id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error ?? '', /AI 迭代筛选失败.*upstream request timed out/);
  assert.equal(failed.result, undefined);
  assert.equal(calls.transactions, 0);
  const retry = service.createCandidateFilterTask('user-1', payload);
  assert.notEqual(retry.task_id, submission.task_id);
  await setImmediate();
  assert.equal(calls.model, 2);
});

function unavailableGatewayError() {
  return new ServiceUnavailableException({
    message: 'AI 服务暂时不可用，请稍后重试',
    request_id: 'gateway-request-503',
    error_code: 'UPSTREAM_ERROR',
    scene: 'hr.resume_screening',
    attempts: [{ apiKey: 'test-secret-never-return', endpoint: 'https://private.example.invalid' }],
    upstream_payload: { secret: 'test-secret-never-return' },
  });
}

test('网关 503 经过异步筛选失败路径后只显示真实状态一次，并保留安全追踪信息', async () => {
  const { service, model, calls } = fixture();
  const submission = service.createCandidateFilterTask('user-1', payload);
  await setImmediate();
  model.reject(unavailableGatewayError());
  await setImmediate();
  const failed = service.getCandidateFilterTask('user-1', submission.task_id);
  assert.equal(failed.status, 'failed');
  assert.equal((failed.error?.match(/status=/g) ?? []).length, 1);
  assert.match(failed.error ?? '', /status=503/);
  assert.doesNotMatch(failed.error ?? '', /status=400/);
  assert.match(failed.error ?? '', /request_id=gateway-request-503/);
  assert.match(failed.error ?? '', /error_code=UPSTREAM_ERROR/);
  assert.match(failed.error ?? '', /scene=hr\.resume_screening/);
  assert.doesNotMatch(JSON.stringify(failed), /attempts|upstream_payload|test-secret|private\.example/);
  assert.equal(failed.result, undefined);
  assert.equal(calls.transactions, 0);
});

test('同步筛选保留网关 HTTP 状态，响应只包含错误消息与允许的追踪字段', async () => {
  const { service, model } = fixture();
  const request = service.iterateCandidateFilter(payload);
  const rejection = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 503);
    assert.deepEqual(error.getResponse(), {
      message: 'AI 迭代筛选失败：AI 服务暂时不可用，请稍后重试',
      request_id: 'gateway-request-503', error_code: 'UPSTREAM_ERROR', scene: 'hr.resume_screening',
    });
    return true;
  });
  await setImmediate();
  model.reject(unavailableGatewayError());
  await rejection;
});

test('非法追踪字段不会透传，普通输入与配置异常仍为 400', async () => {
  const { service, model } = fixture();
  const task = service.createCandidateFilterTask('user-1', payload);
  await setImmediate();
  model.reject(new ServiceUnavailableException({
    message: 'AI 服务暂时不可用，请稍后重试',
    request_id: 'https://private.example.invalid/token?secret=test-secret',
    error_code: { token: 'test-secret' },
    scene: 'unsafe\ntrace',
  }));
  await setImmediate();
  const failure = service.getCandidateFilterTask('user-1', task.task_id);
  assert.match(failure.error ?? '', /status=503/);
  assert.doesNotMatch(failure.error ?? '', /request_id=|error_code=|scene=|test-secret|private\.example|unsafe/);

  const configured = fixture();
  const request = configured.service.iterateCandidateFilter(payload);
  const rejection = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 400);
    assert.equal(error.message, 'AI 迭代筛选失败：模型配置不可用');
    return true;
  });
  await setImmediate();
  configured.model.reject(new BadRequestException('模型配置不可用'));
  await rejection;
  await assert.rejects(configured.service.iterateCandidateFilter({ instruction: ' ' }), BadRequestException);
});

test('同用户执行中的不同条件拒绝并发，不同用户的任务互相独立且禁止越权查询', async () => {
  const { service, model, calls } = fixture();
  const first = service.createCandidateFilterTask('user-1', payload);
  assert.throws(() => service.createCandidateFilterTask('user-1', { ...payload, instruction: '优先医疗经验' }), ConflictException);
  const second = service.createCandidateFilterTask('user-2', payload);
  assert.notEqual(second.task_id, first.task_id);
  assert.throws(() => service.getCandidateFilterTask('user-2', first.task_id), ForbiddenException);
  assert.throws(() => service.getCandidateFilterTask('user-1', 'missing-task'), NotFoundException);
  model.resolve(modelResult('clarify'));
  await setImmediate();
  assert.equal(calls.model, 2);
  assert.equal(service.getCandidateFilterTask('user-1', first.task_id).status, 'completed');
  assert.equal(service.getCandidateFilterTask('user-2', second.task_id).status, 'completed');
});

test('无身份或空筛选条件立即拒绝且不会启动 AI', async () => {
  const { service, calls } = fixture();
  assert.throws(() => service.createCandidateFilterTask('', payload), UnauthorizedException);
  assert.throws(() => service.getCandidateFilterTask('', 'some-task'), UnauthorizedException);
  assert.throws(() => service.createCandidateFilterTask('user-1', { instruction: '  \n ' }), BadRequestException);
  await setImmediate();
  assert.equal(calls.model, 0);
});

test('任务保留期从完成时计算，过期只回收结束任务并保留仍在执行的任务', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { service, model } = fixture();
  const first = service.createCandidateFilterTask('user-1', payload);
  await setImmediate();
  const isolated = fixture();
  const failedTask = isolated.service.createCandidateFilterTask('user-3', payload);
  await setImmediate();
  isolated.model.reject(new Error('model unavailable'));
  await setImmediate();
  now += 60 * 60 * 1000 + 1;
  assert.equal(service.getCandidateFilterTask('user-1', first.task_id).status, 'processing');
  assert.throws(() => isolated.service.getCandidateFilterTask('user-3', failedTask.task_id), NotFoundException);

  model.resolve(modelResult('clarify'));
  await setImmediate();
  assert.equal(service.getCandidateFilterTask('user-1', first.task_id).status, 'completed');
  now += 60 * 60 * 1000 - 1;
  assert.equal(service.getCandidateFilterTask('user-1', first.task_id).status, 'completed');
  now += 2;
  (service as unknown as { pruneExpiredCandidateFilterTasks(): void }).pruneExpiredCandidateFilterTasks();
  assert.throws(() => service.getCandidateFilterTask('user-1', first.task_id), NotFoundException);
});

test('控制器使用登录账号 id 或 sub 提交和读取任务，缺少身份不回退到共享账号', () => {
  const calls: unknown[][] = [];
  const controller = new ResumeScreeningController({
    createCandidateFilterTask: (userId: string, data: unknown) => { calls.push(['create', userId, data]); return 'created'; },
    getCandidateFilterTask: (userId: string, taskId: string) => { calls.push(['get', userId, taskId]); return 'read'; },
  } as never);
  assert.equal(controller.createCandidateFilterTask({ user: { id: 'user-id', sub: 'ignored-sub' } }, payload), 'created');
  assert.equal(controller.createCandidateFilterTask({ user: { sub: 'user-sub' } }, payload), 'created');
  assert.equal(controller.getCandidateFilterTask({ user: { sub: 'user-sub' } }, 'task-1'), 'read');
  controller.createCandidateFilterTask({}, payload);
  controller.getCandidateFilterTask({}, 'task-1');
  assert.deepEqual(calls, [
    ['create', 'user-id', payload], ['create', 'user-sub', payload],
    ['get', 'user-sub', 'task-1'], ['create', '', payload], ['get', '', 'task-1'],
  ]);
});
