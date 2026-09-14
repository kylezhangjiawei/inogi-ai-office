import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApplicantFormsService } from '../src/modules/applicant-forms/applicant-forms.service';
import { ApplicantFormsController, PublicApplicantFormsController } from '../src/modules/applicant-forms/applicant-forms.controller';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';
import { DEFAULT_FORM_SCHEMA } from '../src/modules/applicant-forms/types';
import { changeSummary, flattenFields, publicSchema, validateAnswers, validateSchema } from '../src/modules/applicant-forms/schema';
import { FILL_LIFETIME_SECONDS, issueFillToken, verifyFillToken } from '../src/modules/applicant-forms/fill-token';
import { validateUpload } from '../src/modules/applicant-forms/files';

const baseAnswers = { fullName: '测试候选人', phone: '13800138000', position: '工程师', declaration: true };
const schema = () => structuredClone(DEFAULT_FORM_SCHEMA);
const makeService = (prisma: unknown = {}, gateway: unknown = {}, oss: unknown = {}) => new ApplicantFormsService(prisma as never,
  { get: (key: string) => key === 'JWT_SECRET' ? 'isolated-applicant-test-secret' : undefined } as never, oss as never, gateway as never,
  { decryptFromStorage: () => 'fake-test-key' } as never);

test('内置模板可校验；公共投影移除所有入职、内部与隐藏字段，含组内字段', () => {
  const parsed = validateSchema(schema());
  const visible = publicSchema(parsed);
  assert.ok(flattenFields(visible).every((f) => f.stage === 'application' && f.visible));
  assert.ok(!JSON.stringify(visible).includes('identityNumber'));
  assert.ok(!JSON.stringify(visible).includes('salaryConfirmation'));
  assert.ok(!JSON.stringify(visible).includes('familyName'));
  assert.deepEqual(validateAnswers(parsed, baseAnswers).answers, baseAnswers);
  assert.equal(parsed.fields.find((f) => f.id === 'experience')?.condition?.fieldId, 'hasExperience');
});

test('隐藏必填不阻止提交，但内部字段/未知字段/条件未显示的字段均不能越权提交', () => {
  const draft = schema(); draft.fields.find((f) => f.id === 'identityNumber')!.required = true;
  assert.doesNotThrow(() => validateAnswers(validateSchema(draft), baseAnswers));
  for (const payload of [ { ...baseAnswers, salaryConfirmation: '10000' }, { ...baseAnswers, rogue: 'x' }, { ...baseAnswers, experience: [{ company: 'x', jobTitle: 'x' }] } ]) {
    assert.throws(() => validateAnswers(draft, payload), BadRequestException);
  }
  assert.throws(() => validateAnswers(draft, { ...baseAnswers, declaration: false }), BadRequestException);
});

test('条件显示、重复组与类型验证：按显示状态校验子字段，拒绝多层/重复ID/无效选择/非法日期', () => {
  const data = { ...baseAnswers, hasExperience: '有', experience: [{ company: '公司A', jobTitle: '工程师' }] };
  assert.deepEqual(validateAnswers(schema(), data).answers, data);
  assert.throws(() => validateAnswers(schema(), { ...data, experience: [{ company: '公司A' }] }), BadRequestException);
  assert.throws(() => validateAnswers(schema(), { ...baseAnswers, highestEducation: '自创选项' }), BadRequestException);
  assert.throws(() => validateAnswers(schema(), { ...baseAnswers, availableDate: '2026-02-30' }), BadRequestException);
  const draft = schema(); draft.fields[1].id = draft.fields[0].id;
  assert.throws(() => validateSchema(draft), BadRequestException);
  const nested = schema(); nested.fields.find((f) => f.id === 'education')!.children = [nested.fields.find((f) => f.id === 'training')!];
  assert.throws(() => validateSchema(nested), BadRequestException);
});

test('显示条件不能依赖内部字段或循环；AI和管理员模板均使用严格字段白名单', () => {
  const draft = schema(); draft.fields[0].condition = { fieldId: 'salaryConfirmation', equals: 'x' };
  assert.throws(() => validateSchema(draft), BadRequestException);
  const cyclic = schema(); cyclic.fields[0].condition = { fieldId: 'phone', equals: 'x' }; cyclic.fields[1].condition = { fieldId: 'fullName', equals: 'x' };
  assert.throws(() => validateSchema(cyclic), BadRequestException);
  assert.throws(() => validateSchema({ ...schema(), script: '<script>' }), BadRequestException);
  const excess = schema(); (excess.fields[0] as unknown as Record<string, unknown>).sql = 'drop';
  assert.throws(() => validateSchema(excess), BadRequestException);
});

test('填写token签名专用aud且24小时，篡改/过期/登录JWT形状被拒绝', () => {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { aud: 'applicant-form-fill' as const, templateId: randomUUID(), versionId: randomUUID(), sessionId: randomUUID(), iat, exp: iat + FILL_LIFETIME_SECONDS };
  const token = issueFillToken(claims, 'test-secret');
  assert.deepEqual(verifyFillToken(token, 'test-secret'), claims);
  assert.throws(() => verifyFillToken(token, 'different-secret'), UnauthorizedException);
  assert.throws(() => verifyFillToken(token, 'test-secret', claims.exp * 1000), UnauthorizedException);
  assert.throws(() => verifyFillToken(`${token}.login`, 'test-secret'), UnauthorizedException);
  assert.throws(() => verifyFillToken(issueFillToken({ ...claims, aud: 'login' } as never, 'test-secret'), 'test-secret'), UnauthorizedException);
});

test('附件只接受白名单文件和真实签名字节，拒绝路径/伪装文件/过量base64', () => {
  const field = schema().fields.find((f) => f.id === 'resume')!;
  const pdf = { fileName: '简历.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.7\ntest').toString('base64') };
  assert.equal(validateUpload(pdf, field).mimeType, 'application/pdf');
  assert.throws(() => validateUpload({ ...pdf, fileName: '../resume.pdf' }, field), BadRequestException);
  assert.throws(() => validateUpload({ ...pdf, dataBase64: Buffer.from('<script>alert(1)</script>').toString('base64') }, field), BadRequestException);
  assert.throws(() => validateUpload({ ...pdf, dataBase64: 'a'.repeat(14 * 1024 * 1024) }, field), BadRequestException);
  assert.throws(() => validateUpload(pdf, schema().fields.find((f) => f.id === 'photo')!), BadRequestException);
});

test('发布、编辑与记录权限独立，公开控制器没有记录读取动作', () => {
  const proto = ApplicantFormsController.prototype;
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, proto.publish), ['applicant-form:publish']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, proto.updateDraft), ['applicant-form:edit']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, proto.suggest), ['applicant-form:edit']);
  for (const fn of [proto.detail, proto.submissions, proto.updateRecord, proto.download]) assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, fn), ['applicant-form:records']);
  assert.deepEqual(Object.getOwnPropertyNames(PublicApplicantFormsController.prototype).sort(), ['constructor', 'form', 'submit', 'upload']);
});

test('5 MB 图片和10 MB文档合法base64不会触发正则栈溢出，超额一字节被拒绝', () => {
  const photo = Buffer.alloc(5 * 1024 * 1024); Buffer.from([255, 216, 255]).copy(photo);
  assert.equal(validateUpload({ fileName: '照片.jpg', mimeType: 'image/jpeg', dataBase64: photo.toString('base64') }, schema().fields.find((f) => f.id === 'photo')!).bytes.length, photo.length);
  const pdf = Buffer.alloc(10 * 1024 * 1024); pdf.write('%PDF-1.7');
  const field = schema().fields.find((f) => f.id === 'resume')!;
  assert.equal(validateUpload({ fileName: '简历.pdf', mimeType: 'application/pdf', dataBase64: pdf.toString('base64') }, field).bytes.length, pdf.length);
  assert.throws(() => validateUpload({ fileName: '简历.pdf', mimeType: 'application/pdf', dataBase64: Buffer.concat([pdf, Buffer.from('x')]).toString('base64') }, field), BadRequestException);
});

test('AI仅接收草稿与要求，不落库；摘要由服务端生成，异常/非法结果不会改草稿', async () => {
  let writes = 0; let captured: any;
  const next = schema(); next.title = '应聘资料';
  const gateway = { resolveTargets: async (_scene: string, targets: unknown[]) => ({ targets, source: 'fallback' }),
    complete: async (request: unknown) => { captured = request; return { content: JSON.stringify({ schema: next }), model: 'test-model' }; } };
  const prisma = { integrationConfig: { findMany: async () => [{ id: 'model-1', model: 'test-model', provider: 'openai', metadata: {}, encryptedSecret: 'fake' }] },
    applicantFormTemplate: { update: async () => { writes++; } } };
  const service = makeService(prisma, gateway);
  const result = await service.suggest({ schema: schema(), prompt: '调整标题' });
  assert.deepEqual(result.summary, changeSummary(validateSchema(schema()), validateSchema(next)));
  assert.equal(writes, 0); assert.equal(result.model, 'test-model');
  assert.deepEqual(Object.keys(JSON.parse(captured.messages[1].content)), ['schema', 'request']);
  gateway.complete = async () => ({ content: JSON.stringify({ schema: next, answers: baseAnswers }), model: 'test-model' });
  await assert.rejects(() => service.suggest({ schema: schema(), prompt: '调整' }), BadRequestException);
  gateway.complete = async () => ({ content: JSON.stringify({ schema: { ...next, fields: [{ ...next.fields[0], type: 'script' }] } }), model: 'test-model' });
  await assert.rejects(() => service.suggest({ schema: schema(), prompt: '调整' }), BadRequestException);
  assert.equal(writes, 0);
});

test('AI无可用模型清楚报错，公开表单未发布不生成session', async () => {
  const service = makeService({ integrationConfig: { findMany: async () => [] }, applicantFormTemplate: { findUnique: async () => ({ publishedVersion: null }) } },
    { resolveTargets: async () => ({ targets: [] }) });
  await assert.rejects(() => service.suggest({ schema: schema(), prompt: '调整' }), ServiceUnavailableException);
  await assert.rejects(() => service.getPublicForm('not-published', '127.0.0.1'), /尚未发布/);
});

test('北京时间日期筛选包含当日凌晨至23:59:59.999，排除前一天末毫秒与次日零点', async () => {
  const timestamps = ['2026-09-07T15:59:59.999Z', '2026-09-07T16:00:00.000Z', '2026-09-08T00:00:00.000Z', '2026-09-08T15:59:59.999Z', '2026-09-08T16:00:00.000Z'];
  const captured: Array<{ gte?: Date; lt?: Date }> = [];
  const service = makeService({
    applicantFormSubmission: {
      findMany: async ({ where }: { where: { submittedAt: { gte?: Date; lt?: Date } } }) => { captured.push(where.submittedAt); return []; },
      count: async ({ where }: { where: { submittedAt: { gte?: Date; lt?: Date } } }) => timestamps.filter((raw) => {
        const at = new Date(raw); return (!where.submittedAt.gte || at >= where.submittedAt.gte) && (!where.submittedAt.lt || at < where.submittedAt.lt);
      }).length,
    },
    $transaction: (requests: Promise<unknown>[]) => Promise.all(requests),
  });
  service.getTemplate = async () => ({}) as never;
  const result = await service.listSubmissions('isolated-template', { dateFrom: '2026-09-08', dateTo: '2026-09-08' });
  assert.equal(captured.at(-1)?.gte?.toISOString(), '2026-09-07T16:00:00.000Z');
  assert.equal(captured.at(-1)?.lt?.toISOString(), '2026-09-08T16:00:00.000Z');
  assert.equal(result.total, 3);
  await service.listSubmissions('isolated-template', { dateFrom: '2028-02-29' });
  assert.equal(captured.at(-1)?.gte?.toISOString(), '2028-02-28T16:00:00.000Z');
  assert.equal(captured.at(-1)?.lt, undefined);
  await service.listSubmissions('isolated-template', { dateTo: '2026-12-31' });
  assert.equal(captured.at(-1)?.gte, undefined);
  assert.equal(captured.at(-1)?.lt?.toISOString(), '2026-12-31T16:00:00.000Z');
  await assert.rejects(() => service.listSubmissions('isolated-template', { dateFrom: '2026-02-29' }), /日期格式无效/);
  await assert.rejects(() => service.listSubmissions('isolated-template', { dateFrom: '2026-09-09', dateTo: '2026-09-08' }), /开始日期不能晚于/);
});
