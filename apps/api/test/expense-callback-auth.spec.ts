import * as assert from 'node:assert/strict';
import { createCipheriv, createHash } from 'node:crypto';
import { test } from 'node:test';

import { ExpenseService } from '../src/modules/expense/expense.service';
import { DEFAULT_WECOM_EXPENSE_CONFIG } from '../src/modules/expense/wecom-approval.client';

const callbackKey = Buffer.alloc(32, 7);
const wecom = {
  ...DEFAULT_WECOM_EXPENSE_CONFIG, enabled: true, corp_id: 'test-corp',
  callback_token: 'test-callback-token', callback_aes_key: callbackKey.toString('base64').replace(/=$/, ''),
};
const xml = '<xml><Event><![CDATA[sys_approval_change]]></Event><SpNo>SP-1</SpNo><SpStatus>2</SpStatus></xml>';

function signedMessage() {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(Buffer.byteLength(xml));
  const message = Buffer.concat([Buffer.alloc(16), length, Buffer.from(xml), Buffer.from(wecom.corp_id)]);
  const padding = 32 - message.length % 32;
  const cipher = createCipheriv('aes-256-cbc', callbackKey, callbackKey.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([message, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64');
  const query = { timestamp: '1710000000', nonce: 'callback-nonce', msg_signature: '' };
  query.msg_signature = createHash('sha1').update([wecom.callback_token, query.timestamp, query.nonce, encrypted].sort().join('')).digest('hex');
  return { encrypted, query };
}

function harness() {
  const service = new ExpenseService({} as never, {} as never, {} as never, {} as never, {} as never);
  const internal = service as any;
  let reads = 0;
  let writes = 0;
  internal.getResolvedIntegrationConfig = async () => ({ wecom });
  internal.ensureReimbursements = async () => { reads += 1; return [{ id: 'EXP-1', wecom_flow_id: 'SP-1' }]; };
  internal.applyWeComStatus = async (_record: unknown, payload: Record<string, unknown>) => { writes += 1; return { title: 'test', status: payload.sp_status }; };
  internal.recordEvent = async () => undefined;
  return { service, reads: () => reads, writes: () => writes };
}

for (const [name, body] of [
  ['JSON 审批结果', { sp_no: 'SP-1', sp_status: '2' }],
  ['明文 XML', xml],
  ['明文 XML Buffer', Buffer.from(xml)],
] as const) {
  test(`公开回调拒绝未验签的${name}，不得读取或改写报销记录`, async () => {
    const h = harness();
    await assert.rejects(h.service.handleWeComCallback({}, body), /回调.*(加密|签名)/);
    assert.equal(h.reads(), 0);
    assert.equal(h.writes(), 0);
  });
}

test('错误签名不得解密或写入；真实签名的加密消息可正常更新', async () => {
  const h = harness();
  const { encrypted, query } = signedMessage();
  const body = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
  await assert.rejects(h.service.handleWeComCallback({ ...query, msg_signature: 'invalid' }, body), /签名/);
  assert.equal(h.reads(), 0);
  await h.service.handleWeComCallback(query, Buffer.from(body));
  assert.equal(h.reads(), 1);
  assert.equal(h.writes(), 1);
});

test('加密对象中的伪造明文字段不能覆盖验签后的审批内容', async () => {
  const h = harness();
  const { encrypted, query } = signedMessage();
  const result = await h.service.handleWeComCallback(query, { Encrypt: encrypted, sp_no: 'forged', sp_status: '4' });
  assert.equal(result.reimbursement.status, '2');
  assert.equal(h.writes(), 1);
});
