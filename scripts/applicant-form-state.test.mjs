import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function loadModule(path, dependencies = {}, expose = []) {
  const exports = {};
  new Function('exports', 'require', `${transpile(read(path))}\n${expose.map((name) => `exports.${name} = ${name};`).join('\n')}`)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    if (name in dependencies) return dependencies[name];
    if (name.endsWith('.css')) return {};
    throw new Error(`Unexpected test dependency: ${name}`);
  });
  return exports;
}
const helpers = loadModule('src/app/applicant-forms/form-state.ts');
const { fieldIsVisible, pruneFormAnswers, validateFormAnswers, formSections, publicFields } = helpers;
const field = (id, patch = {}) => ({ id, label: id, type: 'text', required: false, visible: true, stage: 'application', section: '基本资料', ...patch });
const schema = (fields) => ({ title: '应聘登记表', description: '', fields });
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const backend = loadModule('apps/api/src/modules/applicant-forms/schema.ts', {
  '@nestjs/common': apiRequire('@nestjs/common'),
  './types': loadModule('apps/api/src/modules/applicant-forms/types.ts'),
});

test('submission projection strips hidden, onboarding, internal and unknown values, including inside repeat rows', () => {
  const fields = [field('name', { required: true }), field('hidden', { visible: false }), field('onboarding', { stage: 'onboarding' }), field('approval', { stage: 'internal' }), field('education', { type: 'repeat', children: [field('school'), field('private', { stage: 'internal' })] })];
  const answers = { name: '测试人员', hidden: '旧答案', onboarding: '证件', approval: '内部意见', unknown: 'unknown', education: [{ school: '测试学校', private: '内部值', other: true }] };
  const projected = pruneFormAnswers(fields, answers);
  assert.deepEqual(projected, { name: '测试人员', education: [{ school: '测试学校' }] });
  assert.deepEqual(backend.validateAnswers(schema(fields), projected).answers, projected);
  assert.deepEqual(answers.education[0], { school: '测试学校', private: '内部值', other: true }, 'projection does not mutate source answers');
});

test('conditional descendants disappear after their upstream answer changes, even if stale child answers remain', () => {
  const fields = [field('hasWork', { type: 'select', options: ['有', '无'] }), field('workedAbroad', { condition: { fieldId: 'hasWork', equals: '有' } }), field('country', { required: true, condition: { fieldId: 'workedAbroad', equals: '有' } })];
  const changed = { hasWork: '无', workedAbroad: '有', country: '旧地点' };
  assert.equal(fieldIsVisible(fields[2], changed, fields), false);
  assert.deepEqual(pruneFormAnswers(fields, changed), { hasWork: '无' });
  assert.deepEqual(validateFormAnswers(fields, changed), {});
  assert.deepEqual(validateFormAnswers(fields, { hasWork: '有', workedAbroad: '有' }), { country: '请填写country' });
});

test('a condition in a later section resolves against the full sibling scope', () => {
  const fields = [field('hasWork', { section: '基础', type: 'select', options: ['有', '无'] }), field('employer', { section: '经历', required: true, condition: { fieldId: 'hasWork', equals: '有' } })];
  assert.deepEqual(validateFormAnswers([fields[1]], { hasWork: '有' }, '', fields), { employer: '请填写employer' });
  assert.deepEqual(validateFormAnswers([fields[1]], { hasWork: '无' }, '', fields), {});
  assert.deepEqual(pruneFormAnswers(fields, { hasWork: '有', employer: '测试单位' }), { hasWork: '有', employer: '测试单位' });
});

test('conditional repeat children resolve within each row and do not borrow another row’s answer', () => {
  const children = [field('current', { type: 'select', options: ['是', '否'] }), field('endDate', { type: 'date', required: true, condition: { fieldId: 'current', equals: '否' } })];
  const fields = [field('jobs', { type: 'repeat', children })];
  assert.deepEqual(validateFormAnswers(fields, { jobs: [{ current: '是', endDate: '' }, { current: '否', endDate: '' }] }), { 'jobs.1.endDate': '请填写endDate' });
  assert.deepEqual(pruneFormAnswers(fields, { jobs: [{ current: '是', endDate: '2020-01-01' }, { current: '否', endDate: '2022-03-01' }] }), { jobs: [{ current: '是' }, { current: '否', endDate: '2022-03-01' }] });
});

test('repeat limits and row-level required fields match backend acceptance', () => {
  const required = field('jobs', { type: 'repeat', required: true, minItems: 1, maxItems: 2, children: [field('employer', { required: true })] });
  for (const answers of [{}, { jobs: [] }, { jobs: [{}] }, { jobs: [{ employer: 'A' }, { employer: 'B' }, { employer: 'C' }] }]) {
    assert.ok(Object.keys(validateFormAnswers([required], answers)).length);
    assert.throws(() => backend.validateAnswers(schema([required]), answers));
  }
  const accepted = { jobs: [{ employer: '测试单位' }] };
  assert.deepEqual(validateFormAnswers([required], accepted), {});
  assert.deepEqual(backend.validateAnswers(schema([required]), accepted).answers, accepted);
  const optional = { ...required, required: false, minItems: 2 };
  assert.deepEqual(validateFormAnswers([optional], {}), {}, 'optional untouched group does not force entry');
  assert.deepEqual(backend.validateAnswers(schema([optional]), {}).answers, {});
});

test('optional false checkbox stays false; required consent must be true', () => {
  const fields = [field('optionalConsent', { type: 'checkbox' }), field('declaration', { type: 'checkbox', required: true })];
  const accepted = { optionalConsent: false, declaration: true };
  assert.deepEqual(validateFormAnswers(fields, accepted), {});
  assert.deepEqual(pruneFormAnswers(fields, accepted), accepted);
  assert.deepEqual(backend.validateAnswers(schema(fields), accepted).answers, accepted);
  assert.ok(validateFormAnswers(fields, { optionalConsent: false, declaration: false }).declaration);
  assert.throws(() => backend.validateAnswers(schema(fields), { optionalConsent: false, declaration: false }));
});

test('date, contact, number, file and select validation agree with backend at relevant boundaries', () => {
  const cases = [
    [field('value', { type: 'date' }), ['2026-02-28', '2024-02-29'], ['2026-02-29', '2026-02-31', '2026-13-01']],
    [field('value', { type: 'phone' }), ['13800138000', '+86 13800138000'], ['abc', '(123)4567']],
    [field('value', { type: 'email' }), ['test@example.com'], ['not-mail']],
    [field('value', { type: 'number' }), [0, 1e12], ['3', 1e13, Infinity]],
    [field('value', { type: 'file' }), [{ fileId: 'file_12345678' }], [{ fileId: '' }, { fileId: '../x' }, 'file_12345678']],
    [field('value', { type: 'select', options: ['行政', '研发'] }), ['行政'], ['采购']],
    [field('value', { type: 'multiselect', options: ['行政', '研发'] }), [['行政', '研发']], [['行政', '行政'], ['采购']]],
    [field('value'), ['a'.repeat(1000)], ['a'.repeat(1001)]],
  ];
  for (const [item, valid, invalid] of cases) {
    for (const value of valid) { assert.deepEqual(validateFormAnswers([item], { value }), {}, `${item.type} accepts ${JSON.stringify(value).slice(0, 50)}`); assert.doesNotThrow(() => backend.validateAnswers(schema([item]), { value })); }
    for (const value of invalid) { assert.ok(validateFormAnswers([item], { value }).value, `${item.type} rejects ${JSON.stringify(value).slice(0, 50)}`); assert.throws(() => backend.validateAnswers(schema([item]), { value })); }
  }
});

test('empty private repeat groups produce no public section or mandatory empty step', () => {
  const fields = [field('name'), field('privateGroup', { type: 'repeat', required: true, section: '内部', children: [field('approval', { stage: 'internal' })] })];
  assert.deepEqual(publicFields(fields).map((item) => item.id), ['name']);
  assert.deepEqual(formSections(schema(fields)).map((section) => section.name), ['基本资料']);
  assert.deepEqual(validateFormAnswers(fields, { name: '测试' }), {});
  assert.deepEqual(pruneFormAnswers(fields, { name: '测试', privateGroup: [{ approval: '旧意见' }] }), { name: '测试' });
});

test('invalid missing and cyclic condition references fail closed', () => {
  const a = field('a', { condition: { fieldId: 'b', equals: 'yes' } });
  const b = field('b', { condition: { fieldId: 'a', equals: 'yes' } });
  assert.equal(fieldIsVisible(a, { a: 'yes', b: 'yes' }, [a, b]), false);
  assert.equal(fieldIsVisible(a, { b: 'yes' }, [a]), false);
});

// Execute the real component event handlers with a small hook host; DOM focus and layout are browser checks.
function componentHost(path, name, dependencies = {}) {
  const values = []; const effects = []; let cursor = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial; return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useId() { return `test-id-${cursor++}`; },
    useMemo(factory) { cursor++; return factory(); },
    useEffect(effect, deps) { const index = cursor++; const old = values[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) { values[index] = { deps }; effects.push(() => { old?.cleanup?.(); values[index].cleanup = effect(); }); } },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const component = loadModule(path, { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {}, ...dependencies }, [name])[name];
  const render = (props = {}) => { cursor = 0; return component(props); };
  const nodes = (tree) => tree && typeof tree === 'object' ? Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)] : [];
  return { render, nodes, flushEffects: () => { effects.splice(0).forEach((effect) => effect()); } };
}

test('starting an attachment upload freezes all fields and step navigation until upload settles', () => {
  const host = componentHost('src/app/applicant-forms/ApplicantFormRenderer.tsx', 'ApplicantFormRenderer', { './form-state': helpers });
  const props = { schema: schema([field('name'), field('resume', { type: 'file' })]) };
  let inputs = host.nodes(host.render(props)).filter((node) => typeof node.type === 'function' && node.props.field);
  assert.equal(inputs.every((node) => !node.props.disabled), true);
  inputs[1].props.onUploading(1);
  const uploadingTree = host.render(props);
  assert.equal(host.nodes(uploadingTree).filter((node) => node.props.field).every((node) => node.props.disabled), true);
  assert.equal(host.nodes(uploadingTree).find((node) => node.type === "Button" && node.props.type === 'submit').props.disabled, true);
  inputs = host.nodes(uploadingTree).filter((node) => node.props.field);
  inputs[1].props.onUploading(-1);
  assert.equal(host.nodes(host.render(props)).filter((node) => node.props.field).every((node) => !node.props.disabled), true);
});

test('photo and document selectors reject disallowed files before uploading and use their respective limits', async () => {
  const uploadCalls = []; const changes = []; const counts = [];
  const propsFor = (kind) => {
    const item = field('attachment', { type: 'file', fileKind: kind });
    return { field: item, siblings: [item], answers: {}, path: item.id, errors: {}, disabled: false, preview: false,
      onUpload: async (field, file) => { uploadCalls.push({ field, file }); return { id: 'upload_12345678', fieldId: field.id, fileName: file.name, size: file.size, mimeType: file.type }; },
      onChange: (value) => changes.push(value), onUploading: (delta) => counts.push(delta) };
  };
  const photoHost = componentHost('src/app/applicant-forms/ApplicantFormRenderer.tsx', 'FieldInput', { './form-state': helpers });
  const photo = propsFor('photo');
  let input = photoHost.nodes(photoHost.render(photo)).find((node) => node.type === "Input" && node.props.type === 'file');
  assert.equal(input.props.accept, 'image/jpeg,image/png,image/webp');
  input.props.onChange({ target: { files: [{ name: 'large.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }] } });
  assert.equal(uploadCalls.length, 0);
  assert.ok(photoHost.nodes(photoHost.render(photo)).some((node) => node.props.role === 'alert' && node.props.children.includes('5 MB')));
  const docHost = componentHost('src/app/applicant-forms/ApplicantFormRenderer.tsx', 'FieldInput', { './form-state': helpers });
  const document = propsFor('document');
  input = docHost.nodes(docHost.render(document)).find((node) => node.type === "Input" && node.props.type === 'file');
  assert.equal(input.props.accept, '.pdf,.doc,.docx');
  input.props.onChange({ target: { files: [{ name: 'image.png', type: 'image/png', size: 100 }] } });
  assert.equal(uploadCalls.length, 0, 'document field does not send an image the backend will reject');
  input.props.onChange({ target: { files: [{ name: 'large.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }] } });
  assert.equal(uploadCalls.length, 0);
  input.props.onChange({ target: { files: [{ name: 'resume.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 }] } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(uploadCalls.length, 1);
  assert.deepEqual(changes, [{ fileId: 'upload_12345678' }]);
  assert.deepEqual(counts, [1, -1]);
});

test('public submit retries keep the original version, fill token and idempotency key', async () => {
  const calls = []; let attempt = 0;
  const form = { slug: 'template', versionId: 'version-1', version: 1, schema: schema([field('name')]), fillToken: 'fill-token-1', expiresAt: '2030-01-01', uploadLimits: { maxFileBytes: 1024, maxSessionBytes: 2048, maxFiles: 2 } };
  const oldWindow = globalThis.window; globalThis.window = { scrollTo() {} };
  try {
    const host = componentHost('src/app/applicant-forms/PublicApplicantFormPage.tsx', 'PublicApplicantFormPage', {
      'react-router': { useParams: () => ({ slug: 'template' }) },
      '../lib/applicantFormsApi': { ApplicantFormsError: class extends Error {}, getPublicApplicantForm: async () => form, submitPublicApplicantForm: async (slug, payload) => { calls.push({ slug, ...payload }); if (++attempt === 1) throw new Error('connection lost'); return { id: 'record-1', version: 1, submittedAt: '2026-09-08T01:00:00Z', duplicate: true }; } },
      './ApplicantFormRenderer': { ApplicantFormRenderer: 'Renderer' },
    });
    host.render(); host.flushEffects(); await Promise.resolve(); await Promise.resolve();
    const first = host.nodes(host.render()).find((node) => node.type === 'Renderer');
    const answers = { name: '测试人员' };
    await assert.rejects(first.props.onSubmit(answers), /connection lost/);
    const second = host.nodes(host.render()).find((node) => node.type === 'Renderer');
    await second.props.onSubmit(answers);
    assert.equal(calls.length, 2);
    assert.match(calls[0].idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(calls[1].versionId, 'version-1');
    assert.equal(calls[1].fillToken, 'fill-token-1');
  } finally { globalThis.window = oldWindow; }
});

function textContent(node) { return node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(textContent).join('') : typeof node === 'object' ? textContent(node.props?.children) : String(node); }
async function adminHost(overrides = {}) {
  const initial = { id: 'template-1', name: '测试模板', slug: 'stable-slug', schema: schema([field('name', { label: '姓名' })]), revision: 3, publishedVersionId: null, publishedVersion: null, submissionCount: 0, createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', publicPath: null };
  const calls = { saves: [], publishes: [], notifications: [], confirmations: [] };
  class FormsError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const ui = (names) => Object.fromEntries(names.map((name) => [name, name]));
  const dependencies = {
    './components/ui/use-confirmation': { useConfirmation: () => ({ confirmationDialog: null, confirm: async (request) => { calls.confirmations.push(request); return overrides.confirmed ?? false; } }) },
    'react-router': { useBlocker: () => ({ state: 'unblocked' }) },
    sonner: { toast: Object.fromEntries(['success', 'error', 'info'].map((level) => [level, (message) => calls.notifications.push({ level, message })])) },
    './auth': { useAuth: () => ({ user: { permissions: ['*'] } }) },
    './lib/permissions': { hasPermission: () => true },
    './components/ui/tabs': ui(['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent']),
    './components/ui/toggle-group': ui(['ToggleGroup', 'ToggleGroupItem']),
    './components/ui/button': ui(['Button']), './components/ui/switch': ui(['Switch']),
    './components/ui/alert-dialog': ui(['AlertDialog', 'AlertDialogCancel', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle']),
    './components/ui/dialog': ui(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle']),
    './applicant-forms/ApplicantFormRenderer': ui(['ApplicantFormRenderer']),
    './applicant-forms/FieldEditor': { FieldEditor: 'FieldEditor', FIELD_TYPE_LABELS: { text: '单行文字' }, STAGE_LABELS: { application: '应聘填写', onboarding: '入职补填', internal: '内部审核' }, newFormField: () => field('new') },
    './applicant-forms/SubmissionRecords': ui(['SubmissionRecords']),
    './lib/applicantFormsApi': {
      ApplicantFormsError: FormsError, listApplicantTemplates: async () => ({ items: [initial] }), getApplicantTemplate: async () => overrides.getTemplate?.(initial) ?? initial, listApplicantVersions: async () => ({ items: overrides.getVersions?.() ?? [] }),
      saveApplicantTemplate: async (id, payload) => { calls.saves.push({ id, ...payload }); if (overrides.saveError) throw new FormsError('其他人已修改草稿', 409); return { ...initial, ...payload, revision: payload.expectedRevision + 1 }; },
      publishApplicantTemplate: async (id, expectedRevision) => { calls.publishes.push({ id, expectedRevision }); const saved = calls.saves.at(-1); const reverseKeys = (value) => value && typeof value === 'object' ? Array.isArray(value) ? value.map(reverseKeys) : Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value; return { template: { ...initial, schema: reverseKeys(saved?.schema ?? initial.schema), revision: expectedRevision + 1, publishedVersionId: 'version-1', publishedVersion: 1, publicPath: '/apply/stable-slug' }, version: { id: 'version-1', templateId: id, version: 1, schema: saved?.schema ?? initial.schema, publishedAt: '2026-09-08T01:00:00Z', submissionCount: 0 }, publicPath: '/apply/stable-slug' }; },
    },
  };
  const host = componentHost('src/app/ApplicantFormsPage.tsx', 'ApplicantFormsPage', dependencies);
  for (let index = 0; index < 6; index++) { host.render(); host.flushEffects(); await Promise.resolve(); }
  return { ...host, calls, button: (label) => host.nodes(host.render()).find((node) => node.type === 'Button' && textContent(node) === label) };
}

test('admin cannot publish unsaved edits; saving and confirming publish use successive revisions', async () => {
  const oldWindow = globalThis.window; globalThis.window = { location: { origin: 'http://localhost' }, addEventListener() {}, removeEventListener() {} };
  try {
    const host = await adminHost();
    const toggle = host.nodes(host.render()).find((node) => node.type === 'Switch' && node.props['aria-label'] === '姓名必填');
    assert.ok(toggle);
    toggle.props.onCheckedChange(true);
    assert.equal(host.button('发布表单').props.disabled, true);
    assert.equal(host.calls.publishes.length, 0);
    await host.button('保存草稿').props.onClick();
    assert.equal(host.calls.saves[0].expectedRevision, 3);
    assert.equal(host.calls.saves[0].schema.fields[0].required, true);
    assert.equal(host.button('发布表单').props.disabled, false);
    host.button('发布表单').props.onClick();
    assert.equal(host.calls.publishes.length, 0, 'opening confirmation does not publish');
    await host.button('确认发布').props.onClick();
    assert.deepEqual(host.calls.publishes, [{ id: 'template-1', expectedRevision: 4 }]);
    const link = host.nodes(host.render()).find((node) => node.type === "Input" && node.props['aria-label'] === '公开填写链接');
    assert.equal(link.props.value, 'http://localhost/apply/stable-slug');
    assert.equal(host.button('发布表单').props.disabled, true, 'JSONB object key order does not count as a new edit after publishing');
  } finally { globalThis.window = oldWindow; }
});

test('entering records and versions refreshes counts while preserving dirty schema, name and expected revision', async () => {
  const oldWindow = globalThis.window; globalThis.window = { location: { origin: 'http://localhost' }, addEventListener() {}, removeEventListener() {} };
  try {
    let count = 0;
    const version = () => ({ id: 'version-1', templateId: 'template-1', version: 1, schema: schema([field('name', { label: '姓名' })]), publishedAt: '2026-09-08T00:00:00Z', submissionCount: count });
    const host = await adminHost({ getTemplate: (initial) => ({ ...initial, submissionCount: count, ...(count ? { name: '别处的新名字', revision: 99 } : {}) }), getVersions: () => [version()] });
    host.nodes(host.render()).find((node) => node.type === 'Switch' && node.props['aria-label'] === '姓名必填').props.onCheckedChange(true);
    count = 1;
    host.nodes(host.render()).find((node) => node.type === 'Tabs').props.onValueChange('records');
    for (let i = 0; i < 5; i++) { host.render(); host.flushEffects(); await Promise.resolve(); }
    assert.equal(textContent(host.nodes(host.render()).find((node) => node.type === 'TabsTrigger' && textContent(node).startsWith('登记记录'))), '登记记录1');
    const records = host.nodes(host.render()).find((node) => node.type === 'SubmissionRecords');
    assert.equal(records.props.versions[0].submissionCount, 1);
    count = 2;
    await records.props.onRefreshMetadata();
    assert.equal(host.nodes(host.render()).find((node) => node.type === 'SubmissionRecords').props.versions[0].submissionCount, 2);
    count = 3;
    host.nodes(host.render()).find((node) => node.type === 'Tabs').props.onValueChange('versions');
    for (let i = 0; i < 5; i++) { host.render(); host.flushEffects(); await Promise.resolve(); }
    assert.ok(textContent(host.render()).includes('3 条登记'));
    host.nodes(host.render()).find((node) => node.type === 'Tabs').props.onValueChange('builder');
    assert.equal(host.nodes(host.render()).find((node) => node.type === 'ApplicantFormRenderer').props.schema.fields[0].required, true);
    await host.button('保存草稿').props.onClick();
    assert.equal(host.calls.saves[0].name, '测试模板');
    assert.equal(host.calls.saves[0].expectedRevision, 3, 'metadata refresh must not claim the newer draft revision');
  } finally { globalThis.window = oldWindow; }
});

test('records refresh and review update refresh parent metadata, and record timestamps use Beijing time', async () => {
  let metadataRefreshes = 0;
  const record = { id: 'record-1', templateId: 'template-1', versionId: 'version-1', version: 1, status: 'new', revision: 1, submittedAt: '2026-09-08T16:30:00Z', updatedAt: '2026-09-08T16:30:00Z', answers: { name: '测试人员' } };
  const version = { id: 'version-1', templateId: 'template-1', version: 1, schema: schema([field('name', { label: '姓名' })]), publishedAt: '2026-09-08T00:00:00Z', submissionCount: 1 };
  const ui = (names) => Object.fromEntries(names.map((name) => [name, name]));
  const host = componentHost('src/app/applicant-forms/SubmissionRecords.tsx', 'SubmissionRecords', {
    '../components/ui/use-confirmation': { useConfirmation: () => ({ confirmationDialog: null, confirm: async () => false }) },
    '../components/ui/date-picker': ui(['DatePicker']),
    sonner: { toast: { success() {}, error() {} } }, '../components/ui/button': ui(['Button']),
    '../components/ui/sheet': ui(['Sheet', 'SheetContent', 'SheetDescription', 'SheetHeader', 'SheetTitle']),
    '../lib/applicantFormsApi': { ApplicantFormsError: class extends Error {}, listApplicantSubmissions: async () => ({ items: [record], total: 1, page: 1, pageSize: 20 }) },
  });
  const props = { templateId: 'template-1', versions: [version], onRefreshMetadata: () => { metadataRefreshes++; } };
  for (let i = 0; i < 4; i++) { host.render(props); host.flushEffects(); await Promise.resolve(); }
  let tree = host.render(props);
  assert.ok(textContent(tree).includes('2026/9/9 00:30:00'), 'UTC 16:30 belongs to next Beijing calendar day');
  assert.ok(textContent(tree).includes('提交日期从（北京时间）'));
  host.nodes(tree).find((node) => node.type === 'Button' && textContent(node) === '刷新').props.onClick();
  assert.equal(metadataRefreshes, 1);
  for (let i = 0; i < 4; i++) { host.render(props); host.flushEffects(); await Promise.resolve(); }
  tree = host.render(props);
  host.nodes(tree).find((node) => node.type === 'Button' && textContent(node) === '查看详情').props.onClick();
  host.nodes(host.render(props)).find((node) => typeof node.type === 'function' && node.type.name === 'SubmissionDrawer').props.onUpdated();
  assert.equal(metadataRefreshes, 2);
});

test('canceling new-template confirmation retains dirty draft; accepting opens creation', async () => {
  const oldWindow = globalThis.window;
  globalThis.window = { location: { origin: 'http://localhost' }, addEventListener() {}, removeEventListener() {} };
  try {
    for (const confirmed of [false, true]) {
      const host = await adminHost({ confirmed });
      host.nodes(host.render()).find((node) => node.type === 'Switch' && node.props['aria-label'] === '姓名必填').props.onCheckedChange(true);
      await host.button('新建模板').props.onClick();
      assert.equal(host.calls.confirmations.length, 1);
      assert.equal(host.calls.saves.length, 0);
      assert.equal(host.nodes(host.render()).find((node) => node.type === 'ApplicantFormRenderer').props.schema.fields[0].required, true);
      assert.equal(host.nodes(host.render()).some((node) => node.type === 'Dialog' && node.props.open === true), confirmed);
    }
  } finally { globalThis.window = oldWindow; }
});

test('admin revision conflict retains edited draft and blocks overwrite and publish', async () => {
  const oldWindow = globalThis.window; globalThis.window = { location: { origin: 'http://localhost' }, addEventListener() {}, removeEventListener() {} };
  try {
    const host = await adminHost({ saveError: true });
    host.nodes(host.render()).find((node) => node.type === 'Switch' && node.props['aria-label'] === '姓名必填').props.onCheckedChange(true);
    await host.button('保存草稿').props.onClick();
    assert.equal(host.button('保存草稿').props.disabled, true);
    assert.equal(host.button('发布表单').props.disabled, true);
    const preview = host.nodes(host.render()).find((node) => node.type === 'ApplicantFormRenderer');
    assert.equal(preview.props.schema.fields[0].required, true);
    assert.ok(host.button('复制当前草稿'));
    assert.equal(host.calls.publishes.length, 0);
  } finally { globalThis.window = oldWindow; }
});
