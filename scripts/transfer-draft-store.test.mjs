import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/procurement/transferDraftStore.ts', import.meta.url), 'utf8');
function fixture() {
  const rows = new Map(), commits = []; let abort = false;
  const indexedDB = { open() { const request = {}; queueMicrotask(() => {
    request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction(_store, mode) {
      const tx = { objectStore: () => ({
        get(key) { return operation('get', key); }, put(value, key) { return operation('put', key, structuredClone(value)); }, delete(key) { return operation('delete', key); },
      }) };
      function operation(action, key, value) {
        const r = {};
        queueMicrotask(() => { r.result = action === 'get' ? rows.get(key) : undefined; r.onsuccess?.();
          setImmediate(() => { if (abort && mode === 'readwrite') { tx.onabort?.(); return; } if (action === 'put') rows.set(key, value); if (action === 'delete') rows.delete(key); commits.push(action); tx.oncomplete?.(); }); });
        return r;
      }
      return tx;
    } }; request.onsuccess();
  }); return request; } };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = {}; new Function('exports', 'indexedDB', code)(module, indexedDB);
  return { module, rows, commits, abort: () => { abort = true; } };
}
const snapshot = { form: { materialName: '零件', quantity: '12' }, files: [{ key: 'task-1', name: '图纸.pdf', source: 'task', fileUrl: 'https://private.invalid/signed', fileKey: 'secret' }] };
test('draft save waits for committed transaction and strips temporary attachment URLs', async () => {
  const f = fixture(); const saved = await f.module.saveTransferDraft('u1/task1/rd', snapshot);
  assert.equal(f.commits.at(-1), 'put'); assert.equal(saved.files[0].fileUrl, undefined); assert.equal(saved.files[0].fileKey, undefined);
  assert.equal((await f.module.loadTransferDraft('u1/task1/rd')).form.quantity, '12');
});
test('draft scopes isolate user, task and workspace; invalid records fail visibly', async () => {
  const f = fixture(); await f.module.saveTransferDraft('u1/task1/rd', snapshot);
  for (const key of ['u2/task1/rd', 'u1/task2/rd', 'u1/task1/production']) assert.equal(await f.module.loadTransferDraft(key), null);
  f.rows.set('bad', { ...snapshot, version: 2, scope: 'bad', savedAt: new Date().toISOString() });
  await assert.rejects(f.module.loadTransferDraft('bad'), /格式/);
});
test('pending saves cannot resurrect an explicitly discarded draft', async () => {
  const f = fixture(); const first = f.module.saveTransferDraft('key', snapshot); const second = f.module.saveTransferDraft('key', { ...snapshot, form: { quantity: '20' } });
  const clear = f.module.clearTransferDraft('key'); await Promise.all([first, second, clear]);
  assert.equal(await f.module.loadTransferDraft('key'), null); assert.deepEqual(f.commits.slice(0, 3), ['put', 'put', 'delete']);
});
test('transaction failure rejects save and does not report a durable draft', async () => {
  const f = fixture(); f.abort(); await assert.rejects(f.module.saveTransferDraft('key', snapshot), /保存失败/); assert.equal(f.rows.size, 0);
});
