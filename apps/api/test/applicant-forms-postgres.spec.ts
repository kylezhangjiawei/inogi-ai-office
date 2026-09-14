import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ApplicantFormsService } from '../src/modules/applicant-forms/applicant-forms.service';
import { DEFAULT_FORM_SCHEMA, FormSchema } from '../src/modules/applicant-forms/types';
import { verifyFillToken } from '../src/modules/applicant-forms/fill-token';
import { IP_DAILY_BYTES, UPLOAD_LIMITS } from '../src/modules/applicant-forms/files';

const databaseUrl = process.env.APPLICANT_FORMS_TEST_DATABASE_URL;
const secret = 'isolated-applicant-secret';
const answers = { fullName: '独立测试人', phone: '13800138000', position: '测试岗位', declaration: true };

test('隔离 PostgreSQL：应聘模板发布、版本绑定、提交幂等与附件边界', { skip: !databaseUrl, timeout: 60000 }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.equal(url.hostname, 'localhost'); assert.equal(url.pathname, '/applicant_forms_test'); assert.equal(url.password, '');
  assert.match(url.searchParams.get('host') ?? '', /^\/private\/tmp\/applicant-forms-db-[A-Za-z0-9]+$/);
  const dbSchema = `applicant_test_${randomBytes(8).toString('hex')}`; url.searchParams.set('schema', dbSchema);
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const uploads: Array<unknown[]> = [];
  const downloadCalls: unknown[][] = [];
  const oss = { isEnabled: true,
    uploadBuffer: async (...args: unknown[]) => { uploads.push(args); return `private-test/${randomUUID()}`; },
    deleteObject: async (_key: string) => {},
    getSignedUrl: (...args: unknown[]) => { downloadCalls.push(args); return 'https://private-storage.invalid/signed-test'; },
  };
  const service = new ApplicantFormsService(prisma as never, { get: (key: string) => key === 'JWT_SECRET' ? secret : undefined } as never, oss as never, {} as never, {} as never);
  const draft = () => structuredClone(DEFAULT_FORM_SCHEMA);
  const receiptInput = (form: Awaited<ReturnType<ApplicantFormsService['getPublicForm']>>, values: unknown = answers, idempotencyKey = randomUUID()) => ({ versionId: form.versionId, fillToken: form.fillToken, idempotencyKey, answers: values });
  const uploadInput = (form: Awaited<ReturnType<ApplicantFormsService['getPublicForm']>>) => ({ versionId: form.versionId, fillToken: form.fillToken, fieldId: 'resume', fileName: '简历.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.7\nisolated-test').toString('base64') });
  const fixture = async () => {
    const template = await service.createTemplate({ schema: draft() });
    const published = await service.publish(template.id, { expectedRevision: template.revision });
    const form = await service.getPublicForm(template.slug, randomUUID());
    return { template: published.template, form };
  };
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${dbSchema}"`);
    const sql = await readFile(join(__dirname, '../prisma/migrations/20260908200000_applicant_forms/migration.sql'), 'utf8');
    for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').map((part) => part.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);

    await t.test('首次发布前关闭；编辑草稿不生效；旧版本不可变且旧填写凭证仍可提交', async () => {
      const created = await service.createTemplate({ name: '独立模板', schema: draft() });
      assert.equal(created.publicPath, null);
      await assert.rejects(() => service.getPublicForm(created.slug, randomUUID()), /尚未发布/);
      const first = await service.publish(created.id, { expectedRevision: 1 });
      const form1 = await service.getPublicForm(created.slug, randomUUID());
      const next = draft(); next.title = '第二版登记'; next.fields.find((f) => f.id === 'phone')!.label = '联系电话';
      const saved = await service.updateDraft(created.id, { schema: next, expectedRevision: first.template.revision });
      assert.equal((await service.getPublicForm(created.slug, randomUUID())).schema.title, DEFAULT_FORM_SCHEMA.title);
      await assert.rejects(() => service.updateDraft(created.id, { schema: draft(), expectedRevision: first.template.revision }), /内容已被更新/);
      const second = await service.publish(created.id, { expectedRevision: saved.revision });
      const current = await service.getPublicForm(created.slug, randomUUID());
      assert.equal(current.versionId, second.version.id); assert.equal(current.version, 2); assert.equal(current.schema.title, next.title);
      assert.notEqual(form1.versionId, current.versionId);
      assert.equal(((await prisma.applicantFormVersion.findUniqueOrThrow({ where: { id: form1.versionId } })).schema as unknown as FormSchema).title, DEFAULT_FORM_SCHEMA.title);
      const oldReceipt = await service.submit(created.slug, receiptInput(form1));
      assert.equal(oldReceipt.version, 1);
      const detail = await service.getSubmission(oldReceipt.id);
      assert.equal((detail.schema as unknown as FormSchema).title, DEFAULT_FORM_SCHEMA.title);
      assert.equal((await service.listVersions(created.id)).items.find((v) => v.version === 1)?.submissionCount, 1);
    });

    await t.test('并发同revision发布仅一个版本，同revision编辑仅一人成功', async () => {
      const template = await service.createTemplate({ schema: draft() });
      const publications = await Promise.allSettled([service.publish(template.id, { expectedRevision: 1 }), service.publish(template.id, { expectedRevision: 1 })]);
      assert.equal(publications.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(await prisma.applicantFormVersion.count({ where: { templateId: template.id } }), 1);
      const current = await service.getTemplate(template.id);
      const edits = await Promise.allSettled([service.updateDraft(template.id, { expectedRevision: current.revision, schema: draft() }), service.updateDraft(template.id, { expectedRevision: current.revision, schema: draft() })]);
      assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
    });

    await t.test('提交并发幂等同一条记录；重复key改内容及新的key重复session均拒绝', async () => {
      const { template, form } = await fixture(); const payload = receiptInput(form);
      const results = await Promise.all([service.submit(template.slug, payload), service.submit(template.slug, payload)]);
      assert.equal(results[0].id, results[1].id); assert.equal(results.filter((r) => r.duplicate).length, 1);
      assert.equal(await prisma.applicantFormSubmission.count({ where: { templateId: template.id } }), 1);
      await assert.rejects(() => service.submit(template.slug, { ...payload, answers: { ...answers, fullName: '更改' } }), /提交标识/);
      await assert.rejects(() => service.submit(template.slug, receiptInput(form)), /已经提交/);
    });

    await t.test('token绑定slug/version/session；未知、内部及不展示字段不写记录', async () => {
      const { template, form } = await fixture();
      await assert.rejects(() => service.submit('other-slug', receiptInput(form)), /凭证无效/);
      await assert.rejects(() => service.submit(template.slug, { ...receiptInput(form), versionId: randomUUID() }), /版本不匹配/);
      for (const field of ['salaryConfirmation', 'identityNumber', 'unknown']) await assert.rejects(() => service.submit(template.slug, receiptInput(form, { ...answers, [field]: 'secret' })), /未知、隐藏/);
      await assert.rejects(() => service.submit(template.slug, receiptInput(form, { ...answers, experience: [{ company: 'x' }] })), /未知、隐藏/);
      assert.equal(await prisma.applicantFormSubmission.count({ where: { templateId: template.id } }), 0);
    });

    await t.test('附件真实私有上传；跨session/跨字段均拒绝；记录权限下载只签60秒', async () => {
      const { template, form } = await fixture(); const other = await service.getPublicForm(template.slug, randomUUID());
      const file = await service.upload(template.slug, uploadInput(form));
      assert.deepEqual(uploads.at(-1)?.[4], { private: true });
      assert.ok(!('objectKey' in file));
      await assert.rejects(() => service.downloadFile(file.id), /尚未提交/);
      await assert.rejects(() => service.submit(template.slug, receiptInput(other, { ...answers, resume: { fileId: file.id } })), /不属于本次填写/);
      await assert.rejects(() => service.submit(template.slug, receiptInput(form, { ...answers, photo: { fileId: file.id } })), /对应字段/);
      await assert.rejects(() => service.submit(template.slug, receiptInput(form, { ...answers, resume: { fileId: file.id, url: 'https://evil.invalid' } })), /不支持/);
      const receipt = await service.submit(template.slug, receiptInput(form, { ...answers, resume: { fileId: file.id } }));
      assert.equal((await service.getSubmission(receipt.id)).files?.[0].id, file.id);
      const link = await service.downloadFile(file.id); assert.equal(link.expiresIn, 60); assert.equal(downloadCalls.at(-1)?.[1], 60);
    });

    await t.test('剩余一次上传额度并发只有一次成功，失败也不会绕过计数', async () => {
      const { template, form } = await fixture(); const claims = verifyFillToken(form.fillToken, secret);
      await prisma.applicantFormSession.update({ where: { id: claims.sessionId }, data: { uploadCount: UPLOAD_LIMITS.maxFiles - 1 } });
      const before = uploads.length;
      const results = await Promise.allSettled([service.upload(template.slug, uploadInput(form)), service.upload(template.slug, uploadInput(form))]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(uploads.length - before, 1);
      assert.equal((await prisma.applicantFormSession.findUniqueOrThrow({ where: { id: claims.sessionId } })).uploadCount, 8);
      assert.equal(await prisma.applicantFormUpload.count({ where: { sessionId: claims.sessionId } }), 1);
    });

    await t.test('跨会话IP每日额度限制在OSS之前执行，OSS未配置不占额、不伪造成功', async () => {
      const { template, form } = await fixture(); const claims = verifyFillToken(form.fillToken, secret);
      await prisma.applicantFormUpload.create({ data: { id: randomUUID(), sessionId: claims.sessionId, fieldId: 'resume', fileName: 'quota.pdf', mimeType: 'application/pdf', size: IP_DAILY_BYTES, status: 'failed' } });
      const before = uploads.length;
      await assert.rejects(() => service.upload(template.slug, uploadInput(form)), /今日附件上传额度/);
      assert.equal(uploads.length, before);
      const other = await fixture(); const otherClaims = verifyFillToken(other.form.fillToken, secret);
      oss.isEnabled = false;
      try { await assert.rejects(() => service.upload(other.template.slug, uploadInput(other.form)), /存储尚未配置/); }
      finally { oss.isEnabled = true; }
      assert.equal((await prisma.applicantFormSession.findUniqueOrThrow({ where: { id: otherClaims.sessionId } })).uploadCount, 0);
    });

    await t.test('记录版本/搜索/状态/日期/动态字段筛选，状态备注CAS不改变答案', async () => {
      const { template, form } = await fixture(); const receipt = await service.submit(template.slug, receiptInput(form));
      const updated = await service.updateSubmission(receipt.id, { expectedRevision: 1, status: 'interview', note: '等待电话联系' });
      assert.equal(updated.revision, 2); assert.deepEqual(updated.answers, answers);
      await assert.rejects(() => service.updateSubmission(receipt.id, { expectedRevision: 1, status: 'rejected' }), /内容已被更新/);
      const date = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const matched = await service.listSubmissions(template.id, { versionId: form.versionId, search: '独立测试', status: 'interview', dateFrom: date, dateTo: date, fieldId: 'position', fieldValue: '测试', page: '1', pageSize: '10' });
      assert.equal(matched.total, 1); assert.equal(matched.items[0].id, receipt.id);
      assert.equal((await service.listSubmissions(template.id, { status: 'new' })).total, 0);
      await assert.rejects(() => service.listSubmissions(template.id, { versionId: form.versionId, fieldId: 'salaryConfirmation', fieldValue: '' }), /普通字段/);
    });

    await t.test('OSS失败占用已保留额度，不能无限重试；上传期间提交则清理对象而不产生悬空附件', async () => {
      const { template, form } = await fixture(); const claims = verifyFillToken(form.fillToken, secret);
      const original = oss.uploadBuffer;
      oss.uploadBuffer = async () => { throw new Error('simulated-storage-failure'); };
      try { await assert.rejects(() => service.upload(template.slug, uploadInput(form)), /上传失败/); }
      finally { oss.uploadBuffer = original; }
      assert.equal((await prisma.applicantFormSession.findUniqueOrThrow({ where: { id: claims.sessionId } })).uploadCount, 1);
      assert.equal(await prisma.applicantFormUpload.count({ where: { sessionId: claims.sessionId, status: 'failed' } }), 1);
      let removed = false;
      oss.uploadBuffer = async () => { await service.submit(template.slug, receiptInput(form)); return 'private-test/finished-after-submit'; };
      oss.deleteObject = async (key: string) => { assert.equal(key, 'private-test/finished-after-submit'); removed = true; };
      try { await assert.rejects(() => service.upload(template.slug, uploadInput(form)), /登记已经提交/); }
      finally { oss.uploadBuffer = original; oss.deleteObject = async () => {}; }
      assert.equal(removed, true);
      assert.equal(await prisma.applicantFormUpload.count({ where: { sessionId: claims.sessionId, status: 'uploaded' } }), 0);
      assert.equal(await prisma.applicantFormSubmission.count({ where: { sessionId: claims.sessionId } }), 1);
    });

    await t.test('过期session不可提交或上传，公开响应没有内部字段或后台备注', async () => {
      const { template, form } = await fixture(); const claims = verifyFillToken(form.fillToken, secret);
      assert.ok(!JSON.stringify(form).includes('salaryConfirmation')); assert.ok(!JSON.stringify(form).includes('approvalNote'));
      await prisma.applicantFormSession.update({ where: { id: claims.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await assert.rejects(() => service.submit(template.slug, receiptInput(form)), /过期/);
      await assert.rejects(() => service.upload(template.slug, uploadInput(form)), /过期/);
    });
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${dbSchema}" CASCADE`);
    await prisma.$disconnect();
  }
});
