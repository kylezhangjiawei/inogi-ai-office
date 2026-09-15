import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachments, initialTasks } from './fixtures.mjs';
const base = 'http://127.0.0.1:4185';
async function request(path, method = 'GET', input) {
  const response = await fetch(base + path, { method, headers: input ? { 'Content-Type': 'application/json' } : undefined, body: input ? JSON.stringify(input) : undefined });
  return { status: response.status, data: await response.json() };
}
const configure = (input) => request('/__qa/config', 'POST', input);
const transferInput = {
  productId: initialTasks.fresh.productId, rdTaskId: initialTasks.fresh.taskId, rdTaskTitle: initialTasks.fresh.taskTitle,
  rdContact: initialTasks.fresh.owner, rdContactUserId: initialTasks.fresh.ownerUserId,
  materialName: '本地契约探针', spec: 'QA only', quantity: 2, unit: '件', method: 'inquiry', businessLine: 'rd',
  attachments: attachments.map((file) => ({ fileName: file.name, fileUrl: file.fileUrl, fileKey: file.fileKey, fileSize: file.size, mimeType: file.mimeType, kind: 'drawing' })),
};
try {
  assert.equal((await request('/__qa/reset', 'POST')).status, 200);
  const html = await fetch(base + '/__qa/s02-transfer-guard'); assert.equal(html.status, 200); assert.match(await html.text(), /preview\.tsx/);
  const pdf = await fetch(base + '/__qa/files/drawing.pdf'); assert.equal(pdf.status, 200); assert.match(await pdf.text(), /^%PDF-1.4/);
  const products = await request('/api/research-development/products'); assert.equal(products.status, 200); assert.equal(products.data.length, 2);
  await configure({ documentsMode: 'error-once' });
  const documentsPath = `/api/research-development/tasks/${initialTasks.fresh.taskId}/technical-documents`;
  assert.equal((await request(documentsPath)).status, 503);
  const documents = await request(documentsPath); assert.equal(documents.status, 200); assert.deepEqual(documents.data, { canEdit: false, documents: [] });
  assert.equal((await request('/api/research-development/tasks/not-a-fixture/technical-documents')).status, 404);
  const bytes = readFileSync('artifacts/qa/s02-transfer-guard/harness/manual-upload-QA.txt');
  const descriptor = { fileName: 'manual-upload-QA.txt', fileSize: bytes.length, mimeType: 'text/plain', businessType: 'assets' };
  await configure({ uploadMode: 'error-once' });
  assert.equal((await request('/api/files/presign-upload', 'POST', descriptor)).status, 503);
  const presign = await request('/api/files/presign-upload', 'POST', descriptor); assert.equal(presign.status, 200); assert.match(presign.data.putUrl, /^\/__qa\/upload\//);
  const put = await fetch(base + presign.data.putUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': presign.data.contentType } }); assert.equal(put.status, 200);
  const registered = await request('/api/files/register-upload', 'POST', { ...descriptor, objectKey: presign.data.objectKey }); assert.equal(registered.status, 200); assert.equal(registered.data.fileSize, bytes.length);
  assert.deepEqual(Buffer.from(await (await fetch(base + registered.data.signedUrl)).arrayBuffer()), bytes);
  await configure({ transferMode: 'error-once' });
  assert.equal((await request('/api/procurement/tasks/transfer', 'POST', transferInput)).status, 503);
  const success = await request('/api/procurement/tasks/transfer', 'POST', transferInput); assert.equal(success.status, 200); assert.equal(success.data.rdTaskId, transferInput.rdTaskId); assert.equal(success.data.attachmentList.length, 2);
  const resubmit = await request('/api/procurement/tasks/transfer', 'POST', { ...transferInput, rdTaskId: initialTasks.resubmit.taskId }); assert.equal(resubmit.status, 200); assert.equal(resubmit.data.id, 'qa-s02-existing-proc-task');
  await configure({ transferMode: 'slow' });
  const started = Date.now(); assert.equal((await request('/api/procurement/tasks/transfer', 'POST', transferInput)).status, 200); assert.ok(Date.now() - started >= 2800);
  assert.equal((await request('/api/unregistered')).status, 404);
  assert.equal((await request('/api/procurement/tasks/real-id', 'DELETE')).status, 405);
  const health = await request('/__qa/health');
  assert.equal(health.data.counts.submit, 4); assert.equal(health.data.counts.upload, 2); assert.equal(health.data.counts.put, 1); assert.equal(health.data.counts.register, 1);
  assert.ok(health.data.requests.every((entry) => entry.authorization === false));
  const transform = await fetch(base + '/@fs' + process.cwd() + '/artifacts/qa/s02-transfer-guard/harness/preview.tsx'); assert.equal(transform.status, 200); assert.match(await transform.text(), /TransferToProcurementModal/);
  const component = await fetch(base + '/src/app/procurement/components/rdInsertion.tsx'); assert.equal(component.status, 200); assert.match(await component.text(), /s02-transfer-guard\/harness\/auth-preview/);
  console.log('PASS: real component transform and tokenless auth alias; local PDF; product and technical-document contracts; document/upload/transfer one-shot failures; exact presign/PUT/register byte flow; resubmit identity; 3-second delay; call counts; unknown API and write rejection.');
} finally {
  assert.equal((await request('/__qa/reset', 'POST')).status, 200);
  console.log('Fixture returned to success modes with zero counters and no probe uploads/submissions.');
}
