import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { ResearchDevelopmentController } from '../src/modules/research-development/research-development.controller';
import { PERMISSIONS_KEY } from '../src/modules/auth/decorators/permissions.decorator';

const KEY = 'prod/rd-sheet-assets/2026/09/11/中文 image.png';
const PROCESS = 'image/resize,w_240/format,webp';
const CDN_OLD = `https://img.example.test/${encodeURI(KEY)}?auth_key=1-0-0-expired`;
const OSS_OLD = `https://bucket.oss.example.test/${encodeURI(KEY)}?OSSAccessKeyId=old&Expires=1&Signature=expired`;
const PROXY_OLD = `/api/research-development/sheet-workbook/assets?key=${encodeURIComponent(KEY)}&exp=1&sig=expired`;
const PROCESSED_OLD = `${CDN_OLD}&x-oss-process=${encodeURIComponent(PROCESS)}`;

function image(source: string) {
  return { source, imageSourceType: 'URL', width: 240, height: 100, transform: { left: 17 } };
}

function workbook() {
  return {
    id: 'sheet-workbook', sheetOrder: ['s1'], styles: { red: { cl: 'red' } },
    sheets: { s1: { id: 's1', cellData: { 0: { 0: { v: CDN_OLD, p: { drawings: [image(OSS_OLD)] } } } } } },
    resources: [
      { name: 'drawing', data: JSON.stringify({ order: ['old', 'processed'], old: image(PROXY_OLD), processed: image(PROCESSED_OLD) }) },
      { name: 'unknown', data: '{"source":broken,"imageSourceType":"URL"}' },
      { name: 'external', data: ' { "drawing": { "imageSourceType": "URL", "source": "https://external.test/image.png" } } ' },
    ],
    pictures: [image(CDN_OLD), image(KEY), image('https://external.test/image.png'), image('data:image/png;base64,small')],
    otherBusiness: image('prod/private/not-a-sheet.png'),
    ordinaryObject: { source: CDN_OLD, meaning: 'not an image' },
  };
}

function fixture(snapshot = workbook()) {
  const service = Object.create(ResearchDevelopmentService.prototype) as ResearchDevelopmentService;
  let now = 10_000;
  let cdnEnabled = true;
  let current: any = { snapshot, updated_at: '2026-09-10T10:00:00.000Z', updated_by: 'prior-user' };
  const writes: any[] = [];
  const histories: any[] = [];
  const signed: Array<{ key: string; process?: string; disposition?: string }> = [];
  let uploads = 0;
  const recognized = new Map<string, { objectKey: string; process?: string }>([
    [KEY, { objectKey: KEY }], [CDN_OLD, { objectKey: KEY }], [OSS_OLD, { objectKey: KEY }],
    [PROXY_OLD, { objectKey: KEY }], [PROCESSED_OLD, { objectKey: KEY, process: PROCESS }],
    ['prod/private/not-a-sheet.png', { objectKey: 'prod/private/not-a-sheet.png' }],
  ]);
  const mock = service as any;
  mock.ossService = {
    isEnabled: true,
    // Host/path ownership parsing has its own OssService tests; these are already resolved managed sources.
    resolveManagedReadSource: (source: string) => recognized.get(source) ?? null,
    isKeyUnderBusinessType: (key: string, business: string) => key.startsWith(`prod/${business}/`),
    getCdnReadUrl: (key: string, process?: string, disposition?: string) => {
      signed.push({ key, process, disposition });
      if (!cdnEnabled) return null;
      const url = new URL(`https://img.example.test/${encodeURI(key)}`);
      url.searchParams.set('auth_key', `${now}-0-0-fresh`);
      if (process) url.searchParams.set('x-oss-process', process);
      if (disposition) url.searchParams.set('response-content-disposition', disposition);
      recognized.set(url.toString(), { objectKey: key, process });
      return url.toString();
    },
    signPreviewToken: () => ({ exp: now + 10 * 365 * 86400, sig: 'preview-test-signature' }),
    verifyPreviewToken: (_key: string, exp: number, sig: string) => exp > 10000 && sig === 'valid-test-proof',
    getReadUrl: () => ({ url: 'unused', expiresIn: 1537 }),
    buildInlinePreviewUrl: (key: string, process?: string) =>
      `/api/research-development/oss-preview?${new URLSearchParams({ key, process: process ?? '', exp: String(now + 600), sig: 'test' })}`,
    uploadBuffer: async () => { uploads += 1; return KEY; },
  };
  mock.readValue = async () => current;
  mock.writeValue = async (key: string, value: unknown) => { writes.push({ key, value }); current = value; };
  mock.prisma = { systemSetting: {
    upsert: async (args: any) => { histories.push(args.create); },
    findMany: async () => [],
    findUnique: async () => histories.length ? { value: histories[0].value } : null,
  } };
  Object.defineProperty(service, 'logger', { value: { warn: () => {} } });
  return {
    service, writes, histories, signed, recognized,
    current: () => current,
    advance: () => { now += 3600; },
    disableCdn: () => { cdnEnabled = false; },
    uploads: () => uploads,
    recognize: (source: string, process?: string) => recognized.set(source, { objectKey: KEY, process }),
  };
}

test('读取历史工作簿逐次续签受控图片，不写库、不改外部图或普通单元格内容', async () => {
  const state = fixture();
  const stored = JSON.stringify(state.current());
  const first = await state.service.getSheetWorkbook();
  const picture = (first.snapshot.pictures as any[])[0];
  assert.match(picture.source, /auth_key=10000-0-0-fresh/);
  const drawing = JSON.parse((first.snapshot.resources as any[])[0].data);
  assert.match(drawing.old.source, /auth_key=10000-0-0-fresh/);
  assert.equal(new URL(drawing.processed.source).searchParams.get('x-oss-process'), PROCESS);
  assert.equal((first.snapshot.sheets as any).s1.cellData[0][0].v, CDN_OLD);
  assert.match((first.snapshot.sheets as any).s1.cellData[0][0].p.drawings[0].source, /auth_key=10000/);
  assert.deepEqual((first.snapshot.pictures as any[]).slice(2), workbook().pictures.slice(2));
  assert.deepEqual(first.snapshot.otherBusiness, workbook().otherBusiness);
  assert.deepEqual(first.snapshot.ordinaryObject, workbook().ordinaryObject);
  assert.deepEqual((first.snapshot.resources as any[]).slice(1), workbook().resources.slice(1));
  assert.equal(first.updated_at, '2026-09-10T10:00:00.000Z');
  assert.equal(first.updated_by, 'prior-user');

  state.advance();
  const second = await state.service.getSheetWorkbook();
  assert.match((second.snapshot.pictures as any[])[0].source, /auth_key=13600/);
  assert.equal(JSON.stringify(state.current()), stored, '续签不得改写数据库快照或复用缓存对象');
  assert.equal(state.writes.length, 0);
  assert.equal(state.histories.length, 0);
  assert.ok(state.signed.every((call) => call.key === KEY && call.disposition === 'inline'));
});

test('保存与历史留档只持久化稳定图源，保留处理参数及用户输入快照', async () => {
  const state = fixture();
  const input = workbook();
  const original = JSON.stringify(input);
  await state.service.saveSheetWorkbook(input, { id: 'editor' }, { baseUpdatedAt: state.current().updated_at });
  const stored = state.current().snapshot;
  assert.equal(stored.pictures[0].source, KEY);
  assert.equal(stored.pictures[1].source, KEY);
  assert.equal(stored.sheets.s1.cellData[0][0].p.drawings[0].source, KEY);
  const resource = JSON.parse(stored.resources[0].data);
  assert.equal(resource.old.source, KEY);
  const pointer = new URL(resource.processed.source, 'https://office.example.test');
  assert.equal(pointer.pathname, '/api/research-development/sheet-workbook/assets');
  assert.equal(pointer.searchParams.get('key'), KEY);
  assert.equal(pointer.searchParams.get('process'), PROCESS);
  assert.equal(pointer.searchParams.size, 2, '稳定引用不应含临时鉴权参数');
  assert.equal(JSON.stringify(input), original, '保存归一化不能改动调用方当前编辑快照');
  assert.equal(state.histories[0].value.snapshot.pictures[0].source, KEY);
  assert.equal(state.histories[0].value.updated_at, '2026-09-10T10:00:00.000Z');

  state.recognize(resource.processed.source, PROCESS);
  state.advance();
  const reloaded = await state.service.getSheetWorkbook();
  assert.match((reloaded.snapshot.pictures as any[])[0].source, /auth_key=13600/);
  assert.equal(new URL(JSON.parse((reloaded.snapshot.resources as any[])[0].data).processed.source).searchParams.get('x-oss-process'), PROCESS);
});

test('无 CDN 时仍返回受控同源预览，处理参数也可恢复', async () => {
  const state = fixture();
  state.disableCdn();
  const { snapshot } = await state.service.getSheetWorkbook();
  const originalImage = new URL((snapshot.pictures as any[])[0].source, 'https://office.example.test');
  assert.equal(originalImage.pathname, '/api/research-development/sheet-workbook/assets');
  assert.equal(originalImage.searchParams.get('key'), KEY);
  assert.equal(originalImage.searchParams.get('sig'), 'preview-test-signature');
  const processed = new URL(JSON.parse((snapshot.resources as any[])[0].data).processed.source, 'https://office.example.test');
  assert.equal(processed.pathname, '/api/research-development/oss-preview');
  assert.equal(processed.searchParams.get('process'), PROCESS);
});

test('从历史版本恢复后仍保存稳定引用，下一次读取才生成新签名', async () => {
  const state = fixture();
  await state.service.saveSheetWorkbook(workbook(), { id: 'first-editor' });
  await state.service.restoreSheetWorkbookVersion('2026-09-10T10:00:00.000Z', { id: 'restorer' });
  assert.equal(state.current().snapshot.pictures[0].source, KEY);
  assert.equal(state.current().updated_by, 'restorer');
  assert.equal(state.signed.length, 0, '保存和恢复不生成只能暂时使用的 URL');
  const result = await state.service.getSheetWorkbook();
  assert.match((result.snapshot.pictures as any[])[0].source, /auth_key=10000/);
});

test('图片出仓与上传即时返回可显示 CDN 地址，出仓落库最终保存对象 key', async () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(5000)}`;
  const snapshot = workbook();
  snapshot.pictures = [image(dataUrl), image(dataUrl)];
  snapshot.resources = [];
  const state = fixture(snapshot);
  const uploaded = await state.service.uploadSheetAsset(Buffer.from('image-bytes'), 'a.png', 'image/png');
  assert.match(uploaded.url ?? '', /auth_key=10000/);
  const extracted = await state.service.extractSheetWorkbookAssets({ id: 'editor' });
  assert.equal(extracted.total, 1);
  assert.equal(extracted.converted, 1);
  assert.equal(extracted.failed, 0);
  assert.equal(state.uploads(), 2, '相同内嵌图片只上传一次，另一次来自显式上传调用');
  assert.deepEqual(state.current().snapshot.pictures.map((item: any) => item.source), [KEY, KEY]);
  assert.ok(extracted.size_after < extracted.size_before);
  state.advance();
  const loaded = await state.service.getSheetWorkbook();
  assert.match((loaded.snapshot.pictures as any[])[0].source, /auth_key=13600/);
});

test('批量续签只允许当前快照图片引用，外部地址、普通文本引用和任意业务key不获签名', async () => {
  const state = fixture();
  const guessed = 'prod/rd-sheet-assets/not-in-workbook.png';
  state.recognized.set(guessed, { objectKey: guessed });
  const before = JSON.stringify(state.current());
  const response = await state.service.renewSheetAssetUrls([CDN_OLD, CDN_OLD, PROCESSED_OLD, guessed, 'prod/private/not-a-sheet.png', 'https://external.test/image.png']);
  assert.equal(response.length, 2);
  assert.deepEqual(response.map((item) => item.source), [CDN_OLD, PROCESSED_OLD]);
  assert.ok(response.every((item) => item.expires_in === 1537));
  assert.equal(new URL(response[1].url).searchParams.get('x-oss-process'), PROCESS);
  assert.ok(state.signed.every((item) => item.key === KEY));
  assert.equal(JSON.stringify(state.current()), before);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, ResearchDevelopmentController.prototype.renewSheetAssetUrls), ['page:rd-sheet', 'rd-sheet:edit']);
  await assert.rejects(state.service.renewSheetAssetUrls(Array(101).fill(KEY)), /100/);
  await assert.rejects(state.service.renewSheetAssetUrls([42]), /100/);
});

test('尚未保存的同源资产必须带有效原能力才能续签，过期或伪造能力无效', async () => {
  const state = fixture();
  const uploadedKey = 'prod/rd-sheet-assets/unsaved.png';
  const valid = `/api/research-development/sheet-workbook/assets?key=${encodeURIComponent(uploadedKey)}&exp=20000&sig=valid-test-proof`;
  const expired = valid.replace('exp=20000', 'exp=1');
  const forged = valid.replace('valid-test-proof', 'forged');
  for (const source of [valid, expired, forged]) state.recognized.set(source, { objectKey: uploadedKey });
  const response = await state.service.renewSheetAssetUrls([valid, expired, forged]);
  assert.deepEqual(response.map((item) => item.source), [valid]);
});
