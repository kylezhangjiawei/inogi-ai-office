import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compile(path, require) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(require, exports);
  return exports;
}

function apiFixture(authFetch = async () => new Response(JSON.stringify({ canEdit: true, documents: [] }))) {
  return compile('../src/app/lib/rdTechnicalDocumentsApi.ts', () => ({ authFetch, readErrorMessage: async (response, fallback) => (await response.json()).message || fallback }));
}

const attachment = (id, mime = 'image/png') => ({ id, name: `${id}.png`, mime, size: 123, preview_url: `/preview/${id}`, download_url: `/download/${id}` });
const note = (taskId, id, files) => ({ id, task_id: taskId, text: '', attachments: files, actor: { id: 'u1', name: '研发甲', role: '研发' }, created_at: '2026-09-09T02:00:00Z' });
const version = (id, number) => ({ id, documentId: 'doc-1', version: number, changeReason: '修正尺寸', previousVersionId: null, attachmentId: id, sourceNoteId: 'old-note', fileName: `${id}.png`, mimeType: 'image/png', fileSize: 123, fileUrl: `/file/${id}`, createdById: 'u1', createdByName: '研发甲', createdAt: '2026-09-09T02:00:00Z', attachment: attachment(id) });
const document = () => ({ id: 'doc-1', taskId: 'A', title: '阀体图纸', category: 'drawing', currentVersionId: 'v2', versions: [version('v2', 'B'), version('v1', 'A')] });
const choiceKey = (noteId = 'n1', fileId = 'new-file') => apiFixture().collectRdTechnicalAttachments('A', [note('A', noteId, [attachment(fileId)])])[0].key;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function panelFixture(overrides = {}, initialProps = {}) {
  let slots = [];
  let cursor = 0;
  let effects = [];
  let mountedKey;
  const changes = [];
  const previews = [];
  const requests = [];
  let props = { taskId: 'A', notes: [note('A', 'n1', [attachment('new-file')])], onPreview: (file) => previews.push(file), onDocumentsChange: (items) => changes.push(items), ...initialProps };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useMemo(compute) { return compute(); },
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
    },
  };
  const jsx = (type, nodeProps, key) => ({ type, props: nodeProps, key });
  const actualApi = apiFixture();
  const api = { ...actualApi, fetchRdTechnicalDocuments: async () => ({ canEdit: true, documents: [] }), createRdTechnicalDocument: async (taskId, input) => { requests.push({ taskId, input }); return { canEdit: true, documents: [document()] }; }, ...overrides };
  const exports = compile('../src/app/rd/TechnicalDocumentsPanel.tsx', (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('rdTechnicalDocumentsApi')) return api;
    if (name.endsWith('rdApi')) return { getAttachmentDownloadUrl: (file) => file.download_url || file.oss_url || '', createRdTaskProgressNote: overrides.createRdTaskProgressNote };
    if (name.endsWith('/ui/utils')) return { cn: (...classes) => classes.filter(Boolean).join(' ') };
    return new Proxy({}, { get: (_, key) => key });
  });
  const unmount = () => { slots.forEach((slot) => slot?.cleanup?.()); slots = []; mountedKey = undefined; };
  function render() {
    const root = exports.TechnicalDocumentsPanel(props);
    if (mountedKey !== undefined && mountedKey !== root.key) unmount();
    mountedKey = root.key; cursor = 0; effects = [];
    const tree = root.type(root.props);
    effects.forEach((effect) => effect());
    return tree;
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node.type === 'function') return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  function text(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    return text(node.props?.children);
  }
  const find = (predicate) => nodes(render()).find(predicate);
  const button = (label) => find((node) => node.type === 'Button' && text(node) === label);
  const click = (label) => { const target = button(label); assert.ok(target, `button ${label}`); assert.ok(!target.props.disabled, `${label} is enabled`); return target.props.onClick?.(); };
  const field = (label, value) => {
    const wrapper = find((node) => node.type === 'label' && text(node.props.children[0]) === label);
    assert.ok(wrapper, `field ${label}`);
    const target = nodes(wrapper).find((node) => ['Input', 'Textarea', 'select'].includes(node.type));
    target.props.onChange({ target: { value } });
  };
  return { render, find, button, click, field, changes, previews, requests, unmount, all: () => nodes(render()),
    update(next) { props = { ...props, ...next }; return render(); },
    text: () => text(render()),
    submit() { const form = find((node) => node.type === 'form'); assert.ok(form); form.props.onSubmit({ preventDefault() {} }); },
  };
}

test('merged feeds expose only this task files, including drawing images; duplicated notes do not duplicate choices', () => {
  const api = apiFixture();
  const own = note('A', 'n1', [attachment('drawing'), attachment('bom', 'application/vnd.ms-excel')]);
  const rows = api.collectRdTechnicalAttachments('A', [own, note('B', 'n2', [attachment('other-task')]), own]);
  assert.deepEqual(rows.map((row) => row.attachment.id), ['drawing', 'bom']);
});

test('historical versions preview their frozen file, even when that file is no longer in current notes', () => {
  const api = apiFixture();
  const old = version('original-file', 'A');
  assert.equal(api.technicalVersionAttachment(old).preview_url, '/preview/original-file');
  assert.equal(api.technicalVersionAttachment({ ...old, attachment: undefined }).id, 'original-file');
});

test('retry preserves request ID; changed payload creates a fresh ID without mutating the first request', () => {
  const api = apiFixture();
  let sequence = 0;
  const input = { title: '图纸', category: 'drawing', version: 'A', changeReason: '首次确认', sourceNoteId: 'n1', attachmentId: 'f1' };
  const first = api.prepareTechnicalDocumentRequest(null, input, () => `request-${++sequence}`);
  assert.equal(api.prepareTechnicalDocumentRequest(first, { ...input }, () => `request-${++sequence}`), first);
  const changed = api.prepareTechnicalDocumentRequest(first, { ...input, changeReason: '补充说明' }, () => `request-${++sequence}`);
  assert.equal(changed.input.requestId, 'request-2');
  assert.equal(first.input.changeReason, '首次确认');
});

test('API encodes task IDs, forwards stable IDs and cancellation, and rejects errors instead of empty data', async () => {
  const calls = [];
  const api = apiFixture(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ canEdit: true, documents: [] })); });
  const controller = new AbortController();
  await api.createRdTechnicalDocument('A/B', { requestId: 'stable' }, controller.signal);
  assert.equal(calls[0].url, '/api/research-development/tasks/A%2FB/technical-documents');
  assert.equal(JSON.parse(calls[0].init.body).requestId, 'stable');
  assert.equal(calls[0].init.method, 'POST');
  const errorApi = apiFixture(async () => new Response(JSON.stringify({ message: '已有更新版本' }), { status: 409 }));
  await assert.rejects(errorApi.fetchRdTechnicalDocuments('A'), (error) => error.status === 409 && error.message === '已有更新版本');
  const invalidApi = apiFixture(async () => new Response(JSON.stringify({ canEdit: true, documents: [document()] })));
  await assert.rejects(invalidApi.fetchRdTechnicalDocuments('B'), /返回内容不完整/);
});

test('GET failures render a retry state without a false empty list; retry restores records', async () => {
  let attempts = 0;
  const ui = panelFixture({ fetchRdTechnicalDocuments: async () => { if (++attempts === 1) throw new Error('网络中断'); return { canEdit: true, documents: [document()] }; } });
  ui.render(); await tick();
  assert.match(ui.text(), /网络中断/);
  assert.doesNotMatch(ui.text(), /暂无技术资料/);
  ui.click('重新加载'); ui.render(); await tick();
  assert.match(ui.text(), /阀体图纸/);
  ui.unmount();
});

test('task switching cancels the old request and ignores an old response even if transport resolves after abort', async () => {
  const old = deferred();
  let signal;
  const ui = panelFixture({ fetchRdTechnicalDocuments: async (taskId, currentSignal) => { if (taskId === 'A') { signal = currentSignal; return old.promise; } return { canEdit: false, documents: [] }; } });
  ui.render();
  ui.update({ taskId: 'B', notes: [] }); await tick();
  assert.equal(signal.aborted, true);
  old.resolve({ canEdit: true, documents: [document()] }); await tick();
  assert.doesNotMatch(ui.text(), /阀体图纸/);
  assert.equal(ui.changes.length, 1);
  assert.deepEqual(ui.changes[0], []);
  ui.unmount();
});

test('registration requires explicit confirmation; failed save keeps fields and reuses the event ID until payload changes', async () => {
  const attempts = [];
  const ui = panelFixture({ createRdTechnicalDocument: async (taskId, input) => { attempts.push(structuredClone(input)); throw new Error('连接中断'); } });
  ui.render(); await tick();
  ui.click('登记资料');
  ui.field('资料名称', '新图纸'); ui.field('资料类别', 'drawing'); ui.field('版本标识', 'A');
  ui.field('本任务已上传文件', choiceKey()); ui.field('登记说明（必填）', '已核对原图纸');
  ui.submit();
  assert.equal(attempts.length, 0);
  await ui.click('确认登记为当前版本');
  assert.match(ui.text(), /已核对原图纸/);
  await ui.click('重试确认登记');
  assert.equal(attempts[0].requestId, attempts[1].requestId);
  ui.click('返回修改'); ui.field('登记说明（必填）', '补充版本说明'); ui.submit();
  await ui.click('确认登记为当前版本');
  assert.notEqual(attempts[1].requestId, attempts[2].requestId);
  assert.equal(attempts[2].changeReason, '补充版本说明');
  ui.unmount();
});

test('new versions send the expected current version; readonly users can preview history but cannot register', async () => {
  const ui = panelFixture({ fetchRdTechnicalDocuments: async () => ({ canEdit: true, documents: [document()] }) });
  ui.render(); await tick(); ui.click('登记新版本');
  ui.field('版本标识', 'C'); ui.field('本任务已上传文件', choiceKey()); ui.field('变更原因（必填）', '修改接口尺寸'); ui.submit();
  await ui.click('确认登记为当前版本');
  assert.equal(ui.requests[0].input.documentId, 'doc-1');
  assert.equal(ui.requests[0].input.expectedCurrentVersionId, 'v2');
  assert.equal(ui.requests[0].input.expectedFileKey, '');
  assert.equal(ui.requests[0].input.expectedFileName, 'new-file.png');
  assert.equal(ui.requests[0].input.expectedFileSize, 123);
  ui.unmount();
  const read = panelFixture({ fetchRdTechnicalDocuments: async () => ({ canEdit: false, documents: [document()] }) });
  read.render(); await tick();
  assert.equal(read.button('登记资料'), undefined);
  assert.equal(read.button('登记新版本'), undefined);
  read.find((node) => node.props?.['aria-label'] === '查看历史版本 A').props.onClick();
  const preview = read.find((node) => node.props?.['aria-label'] === '预览 v1.png A');
  preview.props.onClick();
  assert.equal(read.previews[0].id, 'v1');
  read.unmount();
});

test('single-file upload creates only a note without progress, preselects its file, and version retries never upload again', async () => {
  const uploads = [];
  const noteChanges = [];
  const versions = [];
  const ui = panelFixture({
    createRdTaskProgressNote: async (input) => { uploads.push(input); return note('A', 'uploaded-note', [attachment('uploaded-image')]); },
    createRdTechnicalDocument: async (_, input) => { versions.push(input); throw new Error('暂时无法确认'); },
  }, { notes: [], onNotesChanged: (created) => noteChanges.push(created) });
  ui.render(); await tick(); ui.click('上传新文件');
  const picker = ui.find((node) => node.type === 'input' && node.props.type === 'file');
  assert.equal(picker.props.multiple, undefined);
  picker.props.onChange({ target: { files: [{ name: 'drawing.png' }], value: 'selected' } }); await tick();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].task_id, 'A');
  assert.equal(uploads[0].text, '上传技术资料：drawing.png');
  assert.equal(Object.hasOwn(uploads[0], 'progress'), false);
  assert.equal(noteChanges[0].id, 'uploaded-note');
  assert.equal(ui.find((node) => node.type === 'select' && node.props.value === choiceKey('uploaded-note', 'uploaded-image'))?.props.value, choiceKey('uploaded-note', 'uploaded-image'));
  ui.field('资料类别', 'drawing'); ui.field('版本标识', 'A'); ui.field('登记说明（必填）', '核对原件'); ui.submit();
  await ui.click('确认登记为当前版本'); await ui.click('重试确认登记');
  assert.equal(uploads.length, 1);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].requestId, versions[1].requestId);
  assert.equal(versions[0].attachmentId, 'uploaded-image');
  ui.unmount();
});

test('failed upload preserves an existing draft; a late upload after navigation cannot select files or notify the new task', async () => {
  const ui = panelFixture({ createRdTaskProgressNote: async () => { throw new Error('已完成任务不能追加留痕'); } });
  ui.render(); await tick(); ui.click('登记资料'); ui.field('资料名称', '保留标题'); ui.field('版本标识', 'B');
  ui.click('上传新文件');
  ui.find((node) => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'draft.png' }], value: 'selected' } }); await tick();
  assert.match(ui.text(), /已完成任务不能追加留痕/);
  assert.ok(ui.find((node) => node.type === 'Input' && node.props.value === '保留标题'));
  assert.ok(ui.find((node) => node.type === 'Input' && node.props.value === 'B'));
  ui.unmount();
  const late = deferred();
  const notes = [];
  const other = panelFixture({ createRdTaskProgressNote: () => late.promise }, { onNotesChanged: (item) => notes.push(item) });
  other.render(); await tick(); other.click('上传新文件');
  other.find((node) => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'late.png' }], value: 'selected' } });
  other.update({ taskId: 'B', notes: [] }); await tick();
  late.resolve(note('A', 'late-note', [attachment('late-file')])); await tick();
  assert.equal(notes.length, 0);
  assert.doesNotMatch(other.text(), /late-file|late.png/);
  other.unmount();
});

test('a version conflict refreshes history without discarding the draft and requires explicit adoption of the new base', async () => {
  const api = apiFixture();
  const inputs = [];
  let latest = document();
  const ui = panelFixture({
    RdTechnicalDocumentsError: api.RdTechnicalDocumentsError,
    fetchRdTechnicalDocuments: async () => ({ canEdit: true, documents: [latest] }),
    createRdTechnicalDocument: async (_, input) => {
      inputs.push(input);
      if (inputs.length === 1) {
        latest = { ...latest, currentVersionId: 'v3', versions: [version('v3', 'C'), ...latest.versions] };
        throw new api.RdTechnicalDocumentsError('已有更新版本', 409);
      }
      return { canEdit: true, documents: [latest] };
    },
  });
  ui.render(); await tick(); ui.click('登记新版本');
  ui.field('版本标识', 'D'); ui.field('本任务已上传文件', choiceKey()); ui.field('变更原因（必填）', '保留变更原因'); ui.submit();
  await ui.click('确认登记为当前版本');
  ui.click('读取最新版本，保留填写内容'); ui.render(); await tick();
  assert.ok(ui.find((node) => node.type === 'Input' && node.props.value === 'D'));
  assert.equal(ui.button('核对并确认').props.disabled, true);
  ui.click('基于此当前版本继续登记'); ui.submit();
  await ui.click('确认登记为当前版本');
  assert.equal(inputs[1].expectedCurrentVersionId, 'v3');
  assert.equal(inputs[1].changeReason, '保留变更原因');
  assert.notEqual(inputs[0].requestId, inputs[1].requestId);
  ui.unmount();
});

test('replacing a source file with the same attachment ID does not classify the new bytes as a registered version', () => {
  const api = apiFixture();
  const original = { ...attachment('drawing'), object_key: 'rd/original.png' };
  const stored = { ...version('v1', 'A'), sourceNoteId: 'n1', attachmentId: 'drawing', fileName: original.name, fileKey: original.object_key, attachment: original };
  const docs = [{ ...document(), versions: [stored] }];
  const old = api.collectRdTechnicalAttachments('A', [note('A', 'n1', [original])])[0];
  const replacement = api.collectRdTechnicalAttachments('A', [note('A', 'n1', [{ ...original, object_key: 'rd/replacement.png' }])])[0];
  assert.equal(api.isRegisteredTechnicalAttachment(old, docs), true);
  assert.equal(api.isRegisteredTechnicalAttachment(replacement, docs), false);
  assert.notEqual(old.key, replacement.key);
  const embedded = { ...attachment('drawing'), data_url: 'data:image/png;base64,AAAA' };
  const legacy = { ...stored, fileKey: null, fileUrl: embedded.data_url, attachment: embedded };
  const changed = { ...embedded, data_url: 'data:image/png;base64,BBBB' };
  const choice = api.collectRdTechnicalAttachments('A', [note('A', 'n1', [embedded])])[0];
  const newChoice = api.collectRdTechnicalAttachments('A', [note('A', 'n1', [changed])])[0];
  assert.equal(api.isRegisteredTechnicalAttachment(choice, [{ ...document(), versions: [legacy] }]), true);
  assert.equal(api.isRegisteredTechnicalAttachment(newChoice, [{ ...document(), versions: [legacy] }]), false);
  assert.notEqual(choice.key, newChoice.key);
});

test('a replaced source attachment invalidates the open confirmation instead of silently selecting the newer file', async () => {
  const original = { ...attachment('drawing'), object_key: 'rd/original.png' };
  const originalNote = note('A', 'n1', [original]);
  const ui = panelFixture({}, { notes: [originalNote] });
  ui.render(); await tick(); ui.click('登记资料');
  ui.field('资料名称', '图纸'); ui.field('资料类别', 'drawing'); ui.field('版本标识', 'A'); ui.field('登记说明（必填）', '已核对原文件');
  ui.field('本任务已上传文件', apiFixture().collectRdTechnicalAttachments('A', [originalNote])[0].key); ui.submit();
  ui.update({ notes: [note('A', 'n1', [{ ...original, object_key: 'rd/replacement.png' }])] });
  assert.equal(ui.button('确认登记为当前版本').props.disabled, true);
  assert.equal(ui.requests.length, 0);
  assert.match(ui.text(), /文件已不可用/);
  ui.unmount();
});

test('refreshed note files supersede the local upload candidate when the same attachment ID was replaced', async () => {
  const original = { ...attachment('uploaded-image'), object_key: 'rd/first.png' };
  const ui = panelFixture({ createRdTaskProgressNote: async () => note('A', 'uploaded-note', [original]) }, { notes: [] });
  ui.render(); await tick(); ui.click('上传新文件');
  ui.find((node) => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'drawing.png' }], value: 'selected' } }); await tick();
  ui.field('资料类别', 'drawing'); ui.field('版本标识', 'A'); ui.field('登记说明（必填）', '初次核对'); ui.submit();
  ui.update({ notes: [note('A', 'uploaded-note', [{ ...original, object_key: 'rd/replaced.png' }])] });
  assert.equal(ui.button('确认登记为当前版本').props.disabled, true);
  assert.equal(ui.requests.length, 0);
  ui.unmount();
});

test('category and document selection mount only the chosen file and reset history when moving between documents', async () => {
  const second = { ...document(), id: 'doc-2', title: '盖板图纸', currentVersionId: 'cover', versions: [{ ...version('cover', 'C'), documentId: 'doc-2' }] };
  const spec = { ...document(), id: 'doc-3', title: '检验规格', category: 'specification', currentVersionId: 'spec', versions: [{ ...version('spec', 'S1'), documentId: 'doc-3' }] };
  const ui = panelFixture({ fetchRdTechnicalDocuments: async () => ({ canEdit: false, documents: [document(), second, spec] }) }, { notes: [] });
  ui.render(); await tick();
  const selectedFiles = () => ui.all().filter((node) => node.type === 'TechnicalDocumentPreview').map((node) => node.props.attachment.id);
  assert.deepEqual(selectedFiles(), ['v2']);
  ui.find((node) => node.props?.['aria-label'] === '查看历史版本 A').props.onClick();
  assert.deepEqual(selectedFiles(), ['v1']);
  ui.find((node) => node.props?.['aria-label'] === '选择技术资料').props.onChange({ target: { value: 'doc-2' } });
  assert.deepEqual(selectedFiles(), ['cover']);
  ui.find((node) => node.props?.['aria-label'] === '选择技术资料').props.onChange({ target: { value: 'doc-1' } });
  assert.deepEqual(selectedFiles(), ['v2']);
  ui.find((node) => node.type === 'Tabs').props.onValueChange('specification');
  assert.deepEqual(selectedFiles(), ['spec']);
  assert.match(ui.text(), /检验规格/);
  ui.find((node) => node.type === 'Tabs').props.onValueChange('bom');
  assert.deepEqual(selectedFiles(), []);
  assert.match(ui.text(), /暂无BOM资料/);
  assert.equal(ui.button('登记该类资料'), undefined);
  ui.unmount();
});

test('a historical selection shows its frozen metadata and original download while retaining the actual current version', async () => {
  const record = document();
  record.versions[1] = { ...record.versions[1], title: '原始阀体图', category: 'other', changeReason: '首次尺寸确认', createdByName: '原登记人' };
  const ui = panelFixture({ fetchRdTechnicalDocuments: async () => ({ canEdit: false, documents: [record] }) }, { notes: [] });
  ui.render(); await tick();
  ui.find((node) => node.props?.['aria-label'] === '查看资料版本').props.onChange({ target: { value: 'v1' } });
  assert.match(ui.text(), /原始阀体图/);
  assert.match(ui.text(), /资料分类其他/);
  assert.match(ui.text(), /当前版本B/);
  assert.match(ui.text(), /原登记人/);
  assert.equal(ui.find((node) => node.props?.['aria-label'] === '下载 v1.png').props.href, '/download/v1');
  assert.equal(ui.find((node) => node.props?.['aria-label'] === '查看历史版本 A').props['aria-pressed'], true);
  assert.equal(ui.requests.length, 0);
  ui.unmount();
});

test('pending attachments can be browsed individually and registration selects that exact file without guessing its category or version', async () => {
  const pending = [note('A', 'n1', [attachment('drawing-A'), attachment('drawing-B')])];
  const ui = panelFixture({}, { notes: pending });
  ui.render(); await tick();
  const second = apiFixture().collectRdTechnicalAttachments('A', pending)[1];
  ui.find((node) => node.props?.['aria-label'] === '选择待确认附件').props.onChange({ target: { value: second.key } });
  assert.deepEqual(ui.all().filter((node) => node.type === 'TechnicalDocumentPreview').map((node) => node.props.attachment.id), ['drawing-B']);
  assert.match(ui.text(), /未分类/);
  assert.match(ui.text(), /版本待确认/);
  ui.click('登记版本');
  assert.ok(ui.find((node) => node.type === 'select' && node.props.value === second.key));
  assert.ok(ui.find((node) => node.type === 'Input' && node.props.value === 'drawing-B.png'));
  assert.ok(ui.find((node) => node.type === 'Input' && node.props.placeholder === '按资料实际标识填写' && node.props.value === ''));
  assert.equal(ui.requests.length, 0);
  ui.unmount();
});

test('empty states have one clear next action; entering an empty category preselects only that category', async () => {
  const empty = panelFixture({}, { notes: [] });
  empty.render(); await tick();
  assert.equal(empty.all().filter((node) => node.type === 'Button' && node.props.className?.includes('bg-primary')).length, 1);
  assert.ok(empty.button('上传新文件'));
  assert.equal(empty.button('登记资料'), undefined);
  assert.equal(empty.find((node) => node.type === 'TechnicalDocumentPreview'), undefined);
  empty.unmount();
  const ui = panelFixture({ fetchRdTechnicalDocuments: async () => ({ canEdit: true, documents: [document()] }) });
  ui.render(); await tick();
  ui.find((node) => node.type === 'Tabs').props.onValueChange('validation');
  ui.click('登记该类资料');
  assert.ok(ui.find((node) => node.type === 'select' && node.props.value === 'validation'));
  assert.ok(ui.find((node) => node.type === 'Input' && node.props.placeholder === '按资料实际标识填写' && node.props.value === ''));
  assert.equal(ui.requests.length, 0);
  ui.unmount();
});

function previewFixture(file) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const existingPreview = compile('../src/app/components/AttachmentPreviewDialog.tsx', () => new Proxy({}, { get: (_, key) => key }));
  const exports = compile('../src/app/rd/TechnicalDocumentPreview.tsx', (name) => {
    if (name === 'react') return {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: initial }; return [slots[index].value, (value) => { slots[index].value = value; }]; },
      useEffect(callback, deps) { const index = cursor++; const previous = slots[index]; if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return; effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); },
    };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('AttachmentPreviewDialog')) return existingPreview;
    if (name.endsWith('rdApi')) return { getAttachmentPreviewUrl: (attachment) => attachment.preview_url || attachment.data_url || '' };
    return new Proxy({}, { get: (_, key) => key });
  });
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node.type === 'function') return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  return { kind: exports.technicalPreviewKind, all() { cursor = 0; effects = []; const tree = nodes(exports.TechnicalDocumentPreview({ attachment: file })); effects.forEach((effect) => effect()); return tree; }, unmount() { slots.forEach((slot) => slot?.cleanup?.()); } };
}

test('inline preview supports bitmap drawings and generic-MIME PDFs, and falls back for active formats or unsafe sources', () => {
  const ui = previewFixture({ ...attachment('drawing'), preview_url: '/safe/drawing' });
  const image = ui.all().find((node) => node.type === 'MobileZoomableImage');
  assert.equal(image.props.src, '/safe/drawing');
  image.props.onError();
  assert.equal(ui.all().some((node) => node.type === 'MobileZoomableImage'), false);
  for (const name of ['active.svg', 'active.html', 'active.js']) assert.equal(ui.kind({ ...attachment('file'), name }), 'unsupported');
  assert.equal(ui.kind({ ...attachment('sheet'), name: 'sheet.xlsx', mime: 'application/octet-stream' }), 'unsupported');
  assert.equal(ui.kind({ ...attachment('file'), name: 'drawing.PDF', mime: 'application/octet-stream' }), 'pdf');
  for (const source of ['javascript:alert(1)', 'data:text/html,hello', '//outside.example/file']) {
    const unsafe = previewFixture({ ...attachment('unsafe'), preview_url: source });
    assert.equal(unsafe.all().some((node) => ['MobileZoomableImage', 'iframe'].includes(node.type)), false);
    unsafe.unmount();
  }
  const pdf = previewFixture({ ...attachment('pdf'), name: 'drawing.pdf', mime: 'application/pdf' });
  assert.equal(pdf.all().find((node) => node.type === 'iframe').props.src, '/preview/pdf#toolbar=0&navpanes=0&view=Fit');
  ui.unmount(); pdf.unmount();
});

test('embedded PDF preview releases temporary URLs and ignores a conversion response after unmount', async (t) => {
  const pending = deferred();
  let requestSignal;
  const created = [];
  const revoked = [];
  t.mock.method(globalThis, 'fetch', (_, init) => { requestSignal = init.signal; return pending.promise; });
  t.mock.method(URL, 'createObjectURL', () => { created.push('blob:document'); return 'blob:document'; });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const file = { ...attachment('embedded'), mime: 'application/pdf', name: 'drawing.pdf', preview_url: 'data:application/pdf;base64,JVBERg==' };
  const late = previewFixture(file);
  assert.equal(late.all().some((node) => node.type === 'iframe'), false);
  late.unmount();
  assert.equal(requestSignal.aborted, true);
  pending.resolve(new Response('pdf')); await tick();
  assert.deepEqual(created, []);
  t.mock.method(globalThis, 'fetch', async () => new Response('pdf'));
  const loaded = previewFixture(file);
  loaded.all(); await tick();
  assert.equal(loaded.all().find((node) => node.type === 'iframe').props.src, 'blob:document#toolbar=0&navpanes=0&view=Fit');
  loaded.unmount();
  assert.deepEqual(revoked, ['blob:document']);
});
