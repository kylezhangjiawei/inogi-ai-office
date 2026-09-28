import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/lib/procurementApi.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('procurementApi.ts', source, ts.ScriptTarget.Latest, true);
const functions = parsed.statements.filter((node) => ['listRdProcurementLinks', 'getProcTaskByRdTask'].includes(node.name?.text))
  .map((node) => node.getText(parsed)).join('\n');
const compiled = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api(request) {
  const exports = {};
  new Function('exports', 'request', compiled)(exports, request);
  return exports;
}

test('没有研发任务时不发请求，空白与重复 ID 在发送前规范化', async () => {
  const calls = [];
  const client = api(async (path, options) => { calls.push({ path, options }); return { items: [] }; });
  assert.deepEqual(await client.listRdProcurementLinks([]), []);
  assert.deepEqual(await client.listRdProcurementLinks(['', '  ']), []);
  assert.equal(calls.length, 0);
  await client.listRdProcurementLinks([' rd-1 ', 'rd-1', '', 'rd-2']);
  const query = new URL(calls[0].path, 'https://local.invalid').searchParams;
  assert.equal(query.get('rdTaskIds'), 'rd-1,rd-2');
  assert.equal(query.get('rdLink'), 'true');
  assert.equal(query.get('pageSize'), '200');
});

test('超过50项分批完整合并，所有批次传递取消信号并禁用缓存', async () => {
  const ids = Array.from({ length: 112 }, (_, index) => `rd-${index + 1}`);
  const calls = [];
  const signal = new AbortController().signal;
  const client = api(async (path, options) => {
    const query = new URL(path, 'https://local.invalid').searchParams;
    const batch = query.get('rdTaskIds').split(',');
    calls.push({ batch, query, options });
    return { items: batch.map((rdTaskId) => ({ id: `proc-${rdTaskId}`, rdTaskId })) };
  });
  const result = await client.listRdProcurementLinks([...ids, ' rd-1 '], signal);
  assert.deepEqual(calls.map((call) => call.batch.length), [50, 50, 12]);
  assert.deepEqual(result.map((row) => row.rdTaskId), ids);
  for (const call of calls) {
    assert.equal(call.query.get('pageSize'), '200');
    assert.equal(call.query.get('rdLink'), 'true');
    assert.equal(call.options.signal, signal);
    assert.equal(call.options.cache, 'no-store');
  }
});

test('研发任务 ID 中的 URL 保留字符安全编码，缺少关联的任务不造数据', async () => {
  const client = api(async (path) => {
    const query = new URL(path, 'https://local.invalid').searchParams;
    assert.equal(query.get('rdTaskIds'), '研发/甲&状态=1,rd-2');
    assert.equal(query.get('状态'), null);
    return { items: [{ id: 'proc-2', rdTaskId: 'rd-2' }] };
  });
  assert.deepEqual(await client.listRdProcurementLinks(['研发/甲&状态=1', 'rd-2']), [{ id: 'proc-2', rdTaskId: 'rd-2' }]);
});

test('批次失败或取消时向上抛出，既不返回不完整列表，也不继续发剩余批次', async () => {
  for (const error of [new Error('没有读取权限'), new DOMException('取消请求', 'AbortError')]) {
    let calls = 0;
    const client = api(async () => {
      calls++;
      if (calls === 2) throw error;
      return { items: [{ id: 'proc-1', rdTaskId: 'rd-1' }] };
    });
    await assert.rejects(() => client.listRdProcurementLinks(Array.from({ length: 101 }, (_, i) => `rd-${i}`)), (caught) => caught === error);
    assert.equal(calls, 2);
  }
});

test('原单任务查询继续使用原接口并透传信号', async () => {
  const signal = new AbortController().signal;
  const client = api(async (path, options) => {
    assert.equal(path, '/tasks?rdTaskId=rd%2F1&rdLink=true&pageSize=1');
    assert.equal(options.signal, signal);
    return { items: [{ id: 'proc-1' }] };
  });
  assert.deepEqual(await client.getProcTaskByRdTask('rd/1', signal), { id: 'proc-1' });
});
