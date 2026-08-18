import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProcurementService } from '../src/modules/procurement/procurement.service';

/**
 * 研发转采购只存了当时的预览地址（带 24h HMAC 令牌）、没存 object key，
 * 令牌过期后附件与图片一律 404。修复口径：读取时按 key 重新构造地址，
 * 存量数据从旧地址的 key 参数反解。
 */
const LEGACY_KEY = 'prod/rd/progress-notes/2026/05/29/abc-q7-detail-02.png';
const LEGACY_URL = `/api/research-development/oss-preview?key=${encodeURIComponent(LEGACY_KEY)}&exp=1784851200&sig=deadbeef`;

// 读取路径先用业务前缀白名单校验 key（fileUrl 是客户端可传字段，不校验就能把任意 OSS key
// 换成一条带签名的预览能力地址），桩里按真实实现的 `${basePrefix}/${businessType}/` 前缀判断。
function ossStub(oss: Record<string, unknown>) {
  return {
    isKeyUnderBusinessType: (key: string, businessType: string) => key.startsWith(`prod/${businessType}/`),
    ...oss,
  };
}

function createService(attachments: Array<Record<string, unknown>>, oss: Record<string, unknown>) {
  const task = {
    id: 'task-1',
    materialName: '零件',
    spec: '',
    unit: '',
    quantity: 1,
    status: 'pending',
    buyer: '张三',
    attachments,
    logs: [],
    quotations: [],
    purchaseOrderRefs: [],
    criticalMaterials: [],
    material: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = { procTask: { findUnique: async () => task } };
  return new ProcurementService(prisma as never, ossStub(oss) as never, {} as never, {} as never);
}

test('存量附件没落 fileKey 时，从旧地址反解 key 并重新构造预览地址', async () => {
  const rebuilt: string[] = [];
  const service = createService(
    [{ id: 'a1', fileName: 'q7.png', fileUrl: LEGACY_URL, fileKey: null, fileSize: 100, mimeType: 'image/png', kind: 'drawing' }],
    {
      extractObjectKey: (url: string) => {
        const m = /[?&]key=([^&]+)/.exec(url ?? '');
        return m ? decodeURIComponent(m[1]) : null;
      },
      buildInlinePreviewUrl: (key: string, process?: string) => {
        rebuilt.push(process ? `${key}|${process}` : key);
        return `/api/research-development/oss-preview?key=${encodeURIComponent(key)}&exp=9999999999&sig=fresh${process ? `&process=${encodeURIComponent(process)}` : ""}`;
      },
      getSignedUrl: () => { throw new Error('不应使用 OSS 直链：bucket 强制下载，图片预览不了'); },
    },
  );

  const result = await service.getTask('task-1', { id: 'u1', name: '张三', permissions: ['*'] } as never);

  assert.deepEqual(
    rebuilt,
    [`${LEGACY_KEY}|image/resize,m_lfit,w_480/format,webp/quality,q_72`, LEGACY_KEY],
    '应从旧地址反解出 object key，并为图片额外构造一条缩放缩略图地址',
  );
  assert.match(result.attachmentList[0].fileUrl, /sig=fresh/, '必须换成现签的新地址');
  assert.doesNotMatch(result.attachmentList[0].fileUrl, /exp=1784851200/, '不能再吐出已过期的旧令牌');
  // 列表缩略图不能直接挂原图：几十条任务会把接口压满
  assert.match(result.attachmentList[0].thumbUrl ?? '', /process=image%2Fresize/);
});

test('已落 fileKey 的附件直接按 key 构造，不依赖旧地址', async () => {
  const service = createService(
    [{ id: 'a1', fileName: 'q7.png', fileUrl: LEGACY_URL, fileKey: 'prod/assets/new.png', fileSize: 100, mimeType: 'image/png', kind: 'drawing' }],
    {
      extractObjectKey: () => { throw new Error('已有 fileKey 时不该再去解析地址'); },
      buildInlinePreviewUrl: (key: string) => `/preview?key=${key}`,
    },
  );

  const result = await service.getTask('task-1', { id: 'u1', name: '张三', permissions: ['*'] } as never);

  assert.equal(result.attachmentList[0].fileUrl, '/preview?key=prod/assets/new.png');
});

test('key 反解不出来时保留原地址，不至于把附件整条丢掉', async () => {
  const service = createService(
    [{ id: 'a1', fileName: 'x.bin', fileUrl: 'https://legacy.example.com/x.bin', fileKey: null, fileSize: 1, mimeType: null, kind: 'other' }],
    {
      extractObjectKey: () => null,
      buildInlinePreviewUrl: () => { throw new Error('没有 key 就不该构造'); },
    },
  );

  const result = await service.getTask('task-1', { id: 'u1', name: '张三', permissions: ['*'] } as never);

  assert.equal(result.attachmentList[0].fileUrl, 'https://legacy.example.com/x.bin');
});

// 这条守的是合并事故：fileUrl 是客户端可传字段，两次改动里「按 key 重建地址」和
// 「业务前缀白名单」互相覆盖过。少了白名单，任何人加个附件就能拿到任意 OSS 对象的签名预览地址。
test('fileUrl 指向白名单外的 key 时不构造预览地址，避免签出任意对象的读取能力', async () => {
  const service = createService(
    [{
      id: 'a1',
      fileName: 'salary.xlsx',
      fileUrl: '/api/research-development/oss-preview?key=prod/expense/vouchers/2026-salary.xlsx&exp=1&sig=x',
      fileKey: 'prod/expense/vouchers/2026-salary.xlsx',
      fileSize: 1,
      mimeType: 'application/vnd.ms-excel',
      kind: 'other',
    }],
    {
      buildInlinePreviewUrl: () => { throw new Error('白名单外的 key 不该被签名'); },
      extractObjectKey: () => { throw new Error('不该绕过白名单去反解'); },
    },
  );

  const result = await service.getTask('task-1', { id: 'u1', name: '张三', permissions: ['*'] } as never);

  assert.equal(result.attachmentList[0].fileUrl, '/api/research-development/oss-preview?key=prod/expense/vouchers/2026-salary.xlsx&exp=1&sig=x', '原样返回旧地址，不重新签名');
  assert.equal(result.attachmentList[0].thumbUrl, undefined);
});
