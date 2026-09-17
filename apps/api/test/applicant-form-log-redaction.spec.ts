import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpException, type ArgumentsHost, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { APPLICANT_FORM_LOG_OMITTED, applicantFormLogPath } from '../src/common/applicant-form-log-policy';
import { GlobalExceptionFilter } from '../src/common/global-exception.filter';
import { AuditInterceptor } from '../src/modules/audit/audit.interceptor';
import { ApiRequestLogInterceptor } from '../src/modules/ops-center/api-request-log.interceptor';
import { OpsCenterService } from '../src/modules/ops-center/ops-center.service';

const sensitive = 'synthetic-applicant-private-value';
function request(path: string, route?: string) {
  return {
    method: 'POST', path, url: `${path}?fillToken=${sensitive}&search=${sensitive}`,
    originalUrl: `${path}?fillToken=${sensitive}&search=${sensitive}`,
    ...(route ? { route: { path: route } } : {}),
    user: { id: 'admin-1', name: '管理人员' }, ip: '127.0.0.1',
    query: { fillToken: sensitive, search: sensitive, answers: { customField: sensitive } },
    body: { answers: { customField: sensitive }, fillToken: sensitive, dataBase64: sensitive, note: sensitive },
    files: [{ originalname: `${sensitive}.pdf`, fieldname: sensitive, mimetype: 'application/pdf', size: 20 }],
    header: (name: string) => ({ 'x-request-id': sensitive, 'user-agent': sensitive,
      'content-type': `multipart/form-data; boundary=${sensitive}`, 'content-length': '20' })[name],
  };
}

function harness(req: ReturnType<typeof request>) {
  const auditRows: any[] = [];
  const apiRows: any[] = [];
  const headers: Record<string, string> = {};
  const prisma = {
    auditLog: { create: async ({ data }: any) => { auditRows.push(data); } },
    apiRequestLog: { create: async ({ data }: any) => { apiRows.push(data); } },
  };
  const res = { statusCode: 200, setHeader: (key: string, value: string) => { headers[key] = value; } };
  const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  const audit = new AuditInterceptor(prisma as never);
  const api = new ApiRequestLogInterceptor(prisma as never);
  const run = (next: CallHandler) => firstValueFrom(api.intercept(context, {
    handle: () => audit.intercept(context, next),
  }));
  return { auditRows, apiRows, headers, run, audit };
}

test('公开与管理接口只记路由和运行元数据，请求、响应、查询与上传名称均不落日志', async () => {
  for (const [path, route] of [
    [`/api/public/applicant-forms/${sensitive}/submit`, '/api/public/applicant-forms/:slug/submit'],
    [`/api/applicant-forms/submissions/${sensitive}`, '/api/applicant-forms/submissions/:id'],
  ]) {
    const req = request(path, route);
    const bodyBefore = JSON.stringify(req.body);
    const h = harness(req);
    const response = { answers: { custom: sensitive }, fillToken: sensitive, files: [{ url: sensitive }] };
    assert.equal(await h.run({ handle: () => of(response) }), response, '不得修改用户实际收到的响应');
    assert.equal(JSON.stringify(req.body), bodyBefore, '不得修改业务请求');
    assert.equal(h.auditRows.length, 1); assert.equal(h.apiRows.length, 1);
    assert.equal(h.auditRows[0].resource, 'applicant-forms');
    assert.equal(h.auditRows[0].resourceId, null);
    assert.equal(h.auditRows[0].userId, 'admin-1');
    assert.equal(h.apiRows[0].path, route.replace(/^\/api/, ''));
    assert.equal(h.apiRows[0].requestMeta.body, APPLICANT_FORM_LOG_OMITTED);
    assert.equal(h.apiRows[0].responseMeta.body, APPLICANT_FORM_LOG_OMITTED);
    assert.match(h.headers['x-request-id'], /^[a-f0-9-]{36}$/);
    assert.ok(!JSON.stringify([h.auditRows, h.apiRows, h.headers]).includes(sensitive));
  }
});

test('CSV/文本响应和无路由模板时的原始URL不能绕过省略策略', async () => {
  const req = request(`/api/applicant-forms/submissions/${sensitive}/export`);
  req.method = 'GET';
  const h = harness(req);
  assert.equal(await h.run({ handle: () => of(`姓名,电话\n${sensitive},${sensitive}`) }), `姓名,电话\n${sensitive},${sensitive}`);
  assert.equal(h.auditRows.length, 0);
  assert.equal(h.apiRows[0].path, '/applicant-forms/[redacted]');
  assert.ok(!JSON.stringify(h.apiRows).includes(sensitive));
});

test('错误响应、异常message/stack和日志写入失败都不保存应聘内容', async () => {
  for (const error of [new HttpException({ message: sensitive, answers: sensitive }, 400), new Error(sensitive)]) {
    const h = harness(request(`/api/public/applicant-forms/${sensitive}/files`));
    await assert.rejects(h.run({ handle: () => throwError(() => error) }), (actual: unknown) => actual === error);
    assert.equal(h.apiRows[0].statusCode, error instanceof HttpException ? 400 : 500);
    assert.equal(h.auditRows[0].meta.failed_status, error instanceof HttpException ? 400 : 500);
    assert.equal(h.apiRows[0].errorStack, null);
    assert.ok(!JSON.stringify([h.auditRows, h.apiRows]).includes(sensitive));
  }
  const h = harness(request(`/api/applicant-forms/${sensitive}`));
  const failures: unknown[] = [];
  Object.assign(h.audit, { prisma: { auditLog: { create: async () => { throw new Error(sensitive); } } },
    logger: { error: (...args: unknown[]) => { failures.push(args); } } });
  await h.run({ handle: () => of({ ok: true }) });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(failures.length, 1);
  assert.ok(!JSON.stringify(failures).includes(sensitive));
});

test('识别两类前缀与编码路径，类似名称的其他模块不受影响', () => {
  assert.equal(applicantFormLogPath({ originalUrl: '/API/Public/%61pplicant-forms/secret?token=private' }), '/public/applicant-forms/[redacted]');
  assert.equal(applicantFormLogPath({ path: '/api/applicant-forms' }), '/applicant-forms/[redacted]');
  assert.equal(applicantFormLogPath({ path: '/api/applicant-forms-other/123' }), null);
  assert.equal(applicantFormLogPath({ path: '/api/public/applicant-forms-extra/123' }), null);
  assert.equal(applicantFormLogPath({ path: '/api/procurement/tasks?redirect=/applicant-forms' }), null);
});

test('其他业务的现有请求内容、响应、审计及请求ID保持不变', async () => {
  const req = request('/api/procurement/tasks/123', '/api/procurement/tasks/:id');
  req.body = { note: '正常操作', answers: { customField: '业务字段' }, fillToken: '', dataBase64: '' };
  const h = harness(req);
  const response = { status: 'completed', password: 'should-redact' };
  await h.run({ handle: () => of(response) });
  assert.equal(h.headers['x-request-id'], sensitive);
  assert.equal(h.apiRows[0].path, req.path.replace(/^\/api/, ''));
  assert.equal(h.apiRows[0].requestMeta.body.note, '正常操作');
  assert.equal(h.apiRows[0].responseMeta.body.status, 'completed');
  assert.equal(h.apiRows[0].responseMeta.body.password, '[redacted]');
  assert.equal(h.auditRows[0].meta.note, '正常操作');
  assert.equal(h.auditRows[0].resource, 'procurement');
});

const capability = 'synthetic-log-capability-secret';
const previewPath = '/research-development/oss-preview';
const previewUrl = `/api${previewPath}?key=drawings%2Fa.pdf&exp=1999999999&sig=${capability}`;
const ossUrl = `https://files.example.invalid/a.pdf?OSSAccessKeyId=public-id&Expires=1999999999&Signature=${capability}`;
const cdnUrl = `https://cdn.example.invalid/a.pdf?auth_key=${capability}&download=1`;

test('能力链接的路径、签名字段和请求/响应URL均脱敏，业务原值与普通诊断保持不变', async () => {
  const req = Object.assign(request(`/api${previewPath}`), {
    method: 'GET', originalUrl: previewUrl, url: previewUrl,
    query: { key: 'drawings/a.pdf', exp: '1999999999', sig: capability, page: '2' },
    body: { note: '正常操作', design: '设计说明', url: ossUrl, nested: { auth_key: capability },
      longUrl: `${'x'.repeat(470)} ${previewUrl}` },
  });
  const before = JSON.stringify(req);
  const response = { url: cdnUrl, attachments: [previewUrl, { Signature: capability, url: ossUrl }] };
  const h = harness(req);
  assert.equal(await h.run({ handle: () => of(response) }), response);
  assert.equal(JSON.stringify(req), before);
  assert.equal(response.url, cdnUrl);
  const row = h.apiRows[0];
  assert.equal(row.path, previewPath);
  assert.equal(row.requestMeta.query.sig, '[redacted]');
  assert.equal(row.requestMeta.query.key, 'drawings/a.pdf');
  assert.equal(row.requestMeta.query.page, '2');
  assert.equal(row.requestMeta.body.design, '设计说明');
  assert.equal(row.requestMeta.body.note, '正常操作');
  assert.equal(row.responseMeta.body.url, 'https://cdn.example.invalid/a.pdf?auth_key=[redacted]&download=1');
  assert.ok(!JSON.stringify(row).includes(capability));

  const textHarness = harness(req);
  assert.equal(await textHarness.run({ handle: () => of(`Preview: ${previewUrl}`) }), `Preview: ${previewUrl}`);
  assert.ok(!JSON.stringify(textHarness.apiRows).includes(capability));
});

test('能力URL出现在异常message/stack和错误响应时仍脱敏，业务异常保持原样', async () => {
  const req = Object.assign(request('/api/files/access-failures'), { method: 'GET' });
  for (const error of [new HttpException({ message: `Preview: ${previewUrl}`, url: ossUrl }, 400),
    new Error(`Cannot fetch ${cdnUrl}`)]) {
    const h = harness(req);
    const originalMessage = error.message;
    await assert.rejects(h.run({ handle: () => throwError(() => error) }), (actual: unknown) => actual === error);
    assert.equal(error.message, originalMessage);
    assert.ok(!JSON.stringify(h.apiRows).includes(capability));
  }
});

function historicalLog() {
  return {
    id: 'historical-log', requestId: 'historical-request', createdAt: new Date('2026-09-16T00:00:00Z'),
    userId: null, method: 'GET', path: previewUrl.replace(/^\/api/, ''), statusCode: 500, durationMs: 12,
    ip: '127.0.0.1', userAgent: 'Test Browser', errorName: 'FetchError',
    errorMessage: `Cannot fetch ${previewUrl}`, errorStack: `FetchError: ${ossUrl}`,
    requestMeta: { query: { sig: capability, page: '2' }, body: { url: cdnUrl, design: '保留诊断' } },
    responseMeta: { body: [{ url: previewUrl }, ossUrl] },
  };
}

test('历史日志列表、错误分组、慢接口与接口统计均不重新暴露能力凭据', async () => {
  const row = historicalLog();
  const before = JSON.stringify(row);
  const prisma = { apiRequestLog: {
    count: async () => 1,
    findMany: async () => [row],
    groupBy: async () => [{ method: row.method, path: row.path, _count: { _all: 1 },
      _avg: { durationMs: 12 }, _max: { durationMs: 12, createdAt: row.createdAt } }],
  } };
  const service = new OpsCenterService(prisma as never, { isReady: async () => false } as never);
  const logs = await service.getApiErrors();
  assert.equal(logs.api_logs[0].path, previewPath);
  assert.equal((logs.api_logs[0].requestMeta as any).query.page, '2');
  const stats = await service.getEndpointStats();
  const slow = await (service as any).getSlowApis(new Date(0));
  assert.equal(stats.endpoints[0].path, previewPath);
  assert.equal(slow[0].path, previewPath);
  assert.ok(!JSON.stringify([logs, stats, slow]).includes(capability));
  assert.equal(JSON.stringify(row), before, '读取脱敏不能改写历史数据库对象');
});

test('历史日志交给AI分析前脱敏，缓存和新分析结果也不能返回能力凭据', async () => {
  const row = historicalLog();
  const before = JSON.stringify(row);
  const cachedAnalysis = { summary: `Inspect ${previewUrl}`, generated_by: 'ai' as const,
    probable_causes: [ossUrl], impact: '', investigation_steps: [cdnUrl], fix_suggestions: [] };
  for (const cached of [false, true]) {
    let context: any;
    const writes: any[] = [];
    const prisma = {
      apiRequestLog: { findUnique: async () => row, findMany: async () => [row] },
      systemSetting: { findUnique: async () => cached ? { value: { analysis: cachedAnalysis } } : null,
        upsert: async (value: unknown) => { writes.push(value); } },
    };
    const service = new OpsCenterService(prisma as never, {
      analyze: async (value: unknown) => { context = value; return cachedAnalysis; },
    } as never);
    const result = await service.analyzeApiError({ request_id: row.requestId });
    assert.equal(result.cached, cached);
    if (!cached) {
      assert.equal(context.path, previewPath);
      assert.equal(context.requestMeta.query.page, '2');
      assert.ok(!JSON.stringify(context).includes(capability));
      assert.equal(writes.length, 1);
    } else assert.equal(context, undefined);
    assert.ok(!JSON.stringify([result, writes]).includes(capability));
    assert.equal(JSON.stringify(row), before);
    assert.ok(cachedAnalysis.summary.includes(capability), '不能修改AI缓存原对象');
  }
});

test('全局500与流式异常日志同样省略应聘内容，其他模块仍保留原诊断', () => {
  for (const scoped of [true, false]) {
    for (const headersSent of [true, false]) {
      const req = request(scoped ? `/api/public/applicant-forms/${sensitive}` : '/api/procurement/tasks');
      const logged: unknown[] = [];
      let body: any;
      let ended = false;
      const response = { headersSent, writableEnded: false, end: () => { ended = true; },
        status: (_status: number) => response, json: (value: unknown) => { body = value; } };
      const filter = new GlobalExceptionFilter();
      Object.assign(filter, { logger: { error: (...args: unknown[]) => { logged.push(args); } } });
      filter.catch(new Error(sensitive), { switchToHttp: () => ({ getRequest: () => req, getResponse: () => response }) } as ArgumentsHost);
      assert.equal(logged.length, 1);
      assert.equal(ended, headersSent);
      if (scoped) {
        assert.ok(!JSON.stringify([logged, body]).includes(sensitive));
        if (!headersSent) assert.equal(body.detail, undefined);
      } else assert.ok(JSON.stringify(logged).includes(sensitive));
    }
  }
});
