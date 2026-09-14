import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, dependencies = {}) {
  const code = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}

const primitive = new Proxy({}, { get: (_target, name) => name });
const jsx = (type, props, key) => ({ type, props, key });
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
const text = (node) => Array.isArray(node) ? node.map(text).join(' ') : node == null || typeof node === 'boolean' ? ''
  : typeof node === 'object' ? text(node.props?.children) : String(node);
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object'
  ? [node, ...nodes(node.props?.children)] : [];
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const documentApi = load('src/app/lib/rdTechnicalDocumentsApi.ts', {
  './authSession': { authFetch() { assert.fail('No real API is allowed in this fixture'); }, readErrorMessage() {} },
  './rdApi': { RD_MUTATED_EVENT: 'rd-mutated' },
});
const attachmentModel = load('src/app/lib/rdProcurementTransfer.ts', { './rdTechnicalDocumentsApi': documentApi });
const attachments = [
  { id: 'drawing-a', name: 'A图纸.pdf', fileKey: 'rd/a.pdf', fileUrl: '/preview/a', size: 100, mimeType: 'application/pdf' },
  { id: 'drawing-b', name: 'B图纸.pdf', fileKey: 'rd/b.pdf', fileUrl: '/preview/b', size: 200, mimeType: 'application/pdf' },
];
const manual = (name = '手选图纸.pdf') => new File(['drawing'], name, { type: 'application/pdf' });
const success = { id: 'proc-1', code: 'PR-001', status: 'pending', materialName: 'M8' };

// Execute the complete real modal and its event handlers. Hooks only supply a
// controlled render lifecycle; API calls are recorded in memory, never sent.
function fixture(t, { workspace = null, props: overrides = {}, documents = async () => ({ documents: [] }),
  transfer = async () => success,
  upload = async (file) => ({ signedUrl: '/signed/manual', objectKey: 'uploaded/manual', fileName: file.name, fileSize: file.size, mimeType: file.type }),
} = {}) {
  const slots = [], effects = [];
  let cursor = 0, dirty = false, tree, unmounted = false, transferReply = transfer, uploadReply = upload;
  let currentWorkspace = workspace, currentUser = { id: 'user-1', name: '研发甲', department: '研发' };
  const changed = (a, b) => !a || !b || a.length !== b.length || b.some((value, index) => !Object.is(value, a[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { if (unmounted) return; const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++, before = slots[index]; if (changed(before?.deps, deps)) {
      const next = { deps }; slots[index] = next; effects.push(() => { before?.cleanup?.(); next.cleanup = fn(); });
    } },
  };
  const calls = { close: 0, transfer: [], upload: [], transferred: [], refresh: 0, success: [], errors: [], documents: [] };
  let props = {
    taskId: 'rd-1', taskTitle: 'M8测试', productId: 'product-1', owner: '研发甲', ownerUserId: 'user-1',
    dueDate: '2026-09-21', attachments, ...overrides,
    onClose: () => { calls.close++; }, onTransferred: (value) => calls.transferred.push(value),
  };
  const products = [{ id: 'product-1', name: '产品一' }, { id: 'product-2', name: '产品二' }];
  const dependencies = {
    react: hooks, 'react/jsx-runtime': runtime, 'react-router': { useNavigate: () => () => {} },
    'lucide-react': primitive, '../../components/ui/input': primitive, '../../components/ui/dialog': primitive,
    '../../components/ui/alert-dialog': primitive, '../../components/ui/select': primitive,
    '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    sonner: { toast: { success: (value) => calls.success.push(value), error: (value) => calls.errors.push(value) } },
    '../../auth': { useAuth: () => ({ user: currentUser }) },
    '../../components/TranslatableText': primitive,
    '../../lib/i18n': { useI18n: () => ({ t: translate }) },
    '../../lib/procurementApi': {
      transferProcTask: async (input) => { calls.transfer.push(input); return transferReply(input); },
      uploadProcurementAttachment: async (file) => { calls.upload.push(file); return uploadReply(file); },
    },
    '../../RDProgressEvidence': { formatRdFileSize: (size) => `${size} B` },
    '../data': { announceProcurementRefresh: () => { calls.refresh++; }, DEFAULT_PROCUREMENT_PRODUCT_ID: 'product-1',
      PROCUREMENT_REFRESH_EVENT: 'procurement-refresh', useProcurementProducts: () => products },
    './common': { DateInput: 'DateInput', PROC_STATUS_META: {} },
    '../../hooks/usePermission': { usePermission: () => true },
    '../../lib/rdApi': { currentRdWorkspace: () => currentWorkspace },
    '../../lib/rdTechnicalDocumentsApi': { fetchRdTechnicalDocuments: async (taskId, signal) => {
      calls.documents.push({ taskId, signal }); return documents(taskId, signal);
    } },
    '../../lib/rdProcurementTransfer': attachmentModel,
    './TransferDraftSupport': { TransferDraftSupport: 'TransferDraftSupport' },
    '../transferDraftStore': { clearTransferDraft: async () => {} },
  };
  const { ScopedTransferToProcurementModal: TransferToProcurementModal, TransferToProcurementModal: ScopedRoot } = load('src/app/procurement/components/rdInsertion.tsx', dependencies);
  const f = {
    calls,
    scopeKey: () => ScopedRoot(props).key,
    render() {
      assert.equal(unmounted, false, 'Cannot render an unmounted modal');
      for (let count = 0; count < 20; count++) {
        cursor = 0; dirty = false; tree = TransferToProcurementModal(props);
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      assert.fail('Transfer modal did not settle');
    },
    async flush() { this.render(); await new Promise(setImmediate); return this.render(); },
    find(predicate) { return nodes(this.render()).find(predicate); },
    button(label) { return this.find((node) => ['button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type)
      && (node.props['aria-label'] === label || text(node).trim().replace(/\s+/g, ' ') === label)); },
    field(label) { return this.find((node) => node.props?.['aria-label'] === label || node.props?.ariaLabel === label
      || (label === '低值易耗品备注' && node.type === 'Input' && node.props.placeholder === '如为低值易耗品可备注按年用量备货')); },
    select() { return this.find((node) => node.type === 'Select'); },
    fileInput() { return this.find((node) => node.type === 'Input' && node.props.type === 'file'); },
    checkbox(name = 'A图纸.pdf') { return this.find((node) => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-label'].includes(name)); },
    dialog() { return this.find((node) => node.type === 'Dialog'); },
    alert() { return this.find((node) => node.type === 'AlertDialog' && node.props.open); },
    pointerOutside() {
      const originalEvent = new Event('pointerdown', { cancelable: true });
      const event = new CustomEvent('dismissableLayer.pointerDownOutside', { cancelable: true, detail: { originalEvent } });
      this.find((node) => node.type === 'DialogContent').props.onPointerDownOutside(event);
      this.render(); return event;
    },
    change(label, value) { const node = this.field(label); assert.ok(node, label);
      node.props.onChange(node.type === 'DateInput' ? value : { target: { value } }); return this.render(); },
    choose(name = 'A图纸.pdf', checked = true) { const node = this.checkbox(name); assert.ok(node, name);
      node.props.onChange({ target: { checked } }); return this.render(); },
    add(file = manual()) { this.fileInput().props.onChange({ target: { files: [file], value: file.name } }); return this.render(); },
    continue() { const alert = this.alert(); assert.ok(alert, 'Close confirmation must be open');
      const button = nodes(alert).find((node) => ['button', 'AlertDialogCancel'].includes(node.type) && text(node).trim() === '继续填写');
      assert.ok(button, 'Continue editing action');
      if (button.props.onClick) button.props.onClick({ preventDefault() {} });
      else alert.props.onOpenChange(false); // Radix Cancel requests Root.onOpenChange(false).
      return this.render(); },
    discard() { const alert = this.alert(); assert.ok(alert, 'Close confirmation must be open');
      const button = nodes(alert).find((node) => ['button', 'AlertDialogAction'].includes(node.type) && text(node).trim() === '放弃并关闭');
      assert.ok(button, 'Discard and close action'); button.props.onClick({ preventDefault() {} }); return this.render(); },
    setTransfer(fn) { transferReply = fn; },
    setUpload(fn) { uploadReply = fn; },
    setProps(next) { props = { ...props, ...next }; return this.render(); },
    setUser(next) { currentUser = next; return this.render(); },
    setWorkspace(next) { currentWorkspace = next; return this.render(); },
    unmount() { if (unmounted) return; unmounted = true; for (const slot of slots) slot?.cleanup?.(); },
  };
  t.after(() => f.unmount());
  f.render(); return f;
}

test('未编辑初始内容时，取消与根 Dialog 关闭均直接退出，不弹草稿确认', async (t) => {
  for (const workspace of [null, 'production']) for (const close of ['cancel', 'dialog']) {
    const f = fixture(t, { workspace }); await f.flush();
    if (close === 'cancel') f.button('取消').props.onClick(); else f.dialog().props.onOpenChange(false);
    assert.equal(f.calls.close, 1, `${workspace}/${close}`); assert.equal(f.alert(), undefined);
    assert.equal(f.calls.transfer.length, 0); assert.equal(f.calls.upload.length, 0);
  }
});

test('每个表单字段变更都需要确认，继续填写保留原输入，放弃后才退出', async (t) => {
  const changes = [['物料名称', '新的物料'], ['规格', 'M10'], ['数量', '12'], ['数量单位', '套'],
    ['需求日期', '2026-09-22'], ['Deadline', '2026-09-23'], ['购买链接（选填）', 'https://supplier.invalid/item'],
    ['研发对接人', '研发乙'], ['低值易耗品备注', '按年备货']];
  for (const [label, value] of changes) {
    const f = fixture(t); await f.flush(); f.change(label, value); f.button('取消').props.onClick();
    assert.ok(f.alert(), label); assert.equal(f.calls.close, 0, label);
    f.continue(); assert.equal(f.alert(), undefined, label); assert.equal(f.field(label).props.value, value, label);
    f.dialog().props.onOpenChange(false); f.discard(); assert.equal(f.calls.close, 1, label);
  }
  const product = fixture(t); await product.flush(); product.select().props.onValueChange('product-2'); product.render();
  product.button('取消').props.onClick(); assert.ok(product.alert()); product.continue();
  assert.equal(product.select().props.value, 'product-2');
});

test('根 Dialog 关闭保护覆盖 Esc/遮罩，关闭确认本身不放弃原草稿', async (t) => {
  const f = fixture(t); await f.flush(); f.change('规格', '保留规格');
  f.dialog().props.onOpenChange(false); assert.ok(f.alert()); assert.equal(f.calls.close, 0);
  f.alert().props.onOpenChange(false); assert.equal(f.alert(), undefined);
  assert.equal(f.field('规格').props.value, '保留规格'); assert.equal(f.calls.close, 0);
  f.dialog().props.onOpenChange(true); assert.equal(f.alert(), undefined);
  f.dialog().props.onOpenChange(false); f.discard(); assert.equal(f.calls.close, 1);
});

test('脏草稿点击遮罩阻止自定义与原生 pointer 默认动作，并打开确认而不关闭原表单', async (t) => {
  const f = fixture(t); await f.flush(); f.change('规格', '遮罩点击前的规格');
  const event = f.pointerOutside();
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.detail.originalEvent.defaultPrevented, true, 'Native pointer default must not move focus back to body');
  assert.ok(f.alert()); assert.equal(f.calls.close, 0);
  assert.equal(f.field('规格').props.value, '遮罩点击前的规格');
});

test('真实转采购和放弃确认 Content 显式向 Radix 传递 aria-modal，不依赖 mock 默认值', async (t) => {
  const f = fixture(t); await f.flush(); f.change('规格', '待确认的规格'); f.dialog().props.onOpenChange(false);
  const forwardRef = (render) => (props) => render(props, props.ref ?? null);
  const primitives = (prefix) => new Proxy({}, { get: (_target, name) => `${prefix}.${String(name)}` });
  const shared = { react: { forwardRef }, 'react/jsx-runtime': runtime, './utils': { cn: (...values) => values.filter(Boolean).join(' ') } };
  const dialog = load('src/app/components/ui/dialog.tsx', { ...shared, '@radix-ui/react-dialog': primitives('DialogPrimitive'), 'lucide-react': primitive });
  const alert = load('src/app/components/ui/alert-dialog.tsx', { ...shared, '@radix-ui/react-alert-dialog': primitives('AlertDialogPrimitive'), './button': { buttonVariants: () => '' } });
  const expand = (node) => Array.isArray(node) ? node.map(expand) : node && typeof node === 'object'
    ? typeof node.type === 'function' ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props?.children) } } : node;
  for (const [name, component, primitiveType] of [
    ['DialogContent', dialog.DialogContent, 'DialogPrimitive.Content'],
    ['AlertDialogContent', alert.AlertDialogContent, 'AlertDialogPrimitive.Content'],
  ]) {
    const content = f.find((node) => node.type === name); assert.ok(content, name);
    const forwarded = nodes(expand(component(content.props))).find((node) => node.type === primitiveType);
    assert.ok(forwarded, `${name} forwards to real wrapper's Radix Content`);
    assert.equal(forwarded.props['aria-modal'], 'true', name);
  }
});

test('字段与产品恢复初始值后不再警告，重提以其实际回填内容为初值', async (t) => {
  const f = fixture(t, { props: { resubmitFrom: { ...success, productId: 'product-2', spec: '原规格', quantity: 6,
    unit: '套', needDate: '2026-09-25', deadline: '2026-09-26', purchaseLink: 'https://supplier.invalid/old', rdContact: '研发甲', consumableNote: '原备注' } } });
  await f.flush();
  for (const label of ['物料名称', '规格', '数量', '数量单位', '需求日期', 'Deadline', '购买链接（选填）', '研发对接人', '低值易耗品备注']) {
    const initial = f.field(label).props.value;
    f.change(label, label.includes('日期') || label === 'Deadline' ? '2026-10-01' : `${initial}更改`); f.change(label, initial);
  }
  f.select().props.onValueChange('product-1'); f.render(); f.select().props.onValueChange('product-2'); f.render();
  f.button('取消').props.onClick(); assert.equal(f.calls.close, 1); assert.equal(f.alert(), undefined);
});

test('研发附件选中与移除保护草稿，恢复初始空选择后可以直接关闭', async (t) => {
  const f = fixture(t); await f.flush(); f.choose(); f.dialog().props.onOpenChange(false);
  assert.ok(f.alert()); assert.equal(f.calls.close, 0); f.continue(); assert.equal(f.checkbox().props.checked, true);
  f.button('移除附件：A图纸.pdf').props.onClick(); f.render(); assert.equal(f.checkbox().props.checked, false);
  f.dialog().props.onOpenChange(false); assert.equal(f.calls.close, 1); assert.equal(f.alert(), undefined);
  const original = fixture(t, { workspace: 'production' }); await original.flush();
  original.button('移除附件：A图纸.pdf').props.onClick(); original.render(); original.button('取消').props.onClick();
  assert.ok(original.alert()); assert.equal(original.calls.close, 0);
});

test('勾选后再取消恢复初始选择，不把资料读取完成当作用户编辑', async (t) => {
  const gate = deferred(); const f = fixture(t, { documents: () => gate.promise });
  gate.resolve({ documents: [] }); await f.flush(); f.choose(); f.choose('A图纸.pdf', false);
  f.button('取消').props.onClick(); assert.equal(f.calls.close, 1); assert.equal(f.alert(), undefined);
});

test('手选文件只留在内存，添加需保护，移除恢复初值；提交前不上传', async (t) => {
  const f = fixture(t); await f.flush(); f.add(); assert.equal(f.calls.upload.length, 0); assert.equal(f.calls.transfer.length, 0);
  f.button('取消').props.onClick(); assert.ok(f.alert()); f.continue();
  assert.ok(f.button('移除附件：手选图纸.pdf')); f.button('移除附件：手选图纸.pdf').props.onClick(); f.render();
  f.button('取消').props.onClick(); assert.equal(f.calls.close, 1); assert.equal(f.alert(), undefined);
  assert.equal(f.calls.upload.length, 0);
});

test('提交即时锁阻止渲染前双击，上传与请求等待时拒绝关闭及旧处理器修改', async (t) => {
  const uploadGate = deferred(), transferGate = deferred();
  const f = fixture(t, { upload: () => uploadGate.promise, transfer: () => transferGate.promise });
  await f.flush(); f.choose(); const file = manual(); f.add(file); f.change('规格', '提交规格');
  const submit = f.button('确认生成采购任务').props.onClick;
  const stale = { cancel: f.button('取消').props.onClick, close: f.dialog().props.onOpenChange,
    spec: f.field('规格').props.onChange, date: f.field('需求日期').props.onChange,
    note: f.field('低值易耗品备注').props.onChange, product: f.select().props.onValueChange,
    file: f.fileInput().props.onChange, check: f.checkbox().props.onChange,
    remove: f.button('移除附件：A图纸.pdf').props.onClick };
  submit(); submit(); // No render between clicks: React state alone cannot guard this.
  stale.spec({ target: { value: '不能改' } }); stale.date('2026-10-30'); stale.note({ target: { value: '不能改备注' } });
  stale.product('product-2'); stale.file({ target: { files: [manual('不能添加.pdf')], value: 'file' } });
  stale.check({ target: { checked: false } }); stale.remove(); stale.cancel(); stale.close(false);
  f.render(); assert.equal(f.calls.upload.length, 1); assert.equal(f.calls.transfer.length, 0);
  assert.equal(f.calls.close, 0); assert.equal(f.alert(), undefined);
  const outside = f.pointerOutside();
  assert.equal(outside.defaultPrevented, true); assert.equal(outside.detail.originalEvent.defaultPrevented, true);
  assert.equal(f.calls.close, 0); assert.equal(f.alert(), undefined, 'Pending upload must not open discard confirmation');
  assert.equal(f.field('规格').props.value, '提交规格'); assert.equal(f.field('需求日期').props.value, '2026-09-21');
  assert.equal(f.field('低值易耗品备注').props.value, ''); assert.equal(f.select().props.value, 'product-1');
  assert.equal(f.checkbox().props.checked, true); assert.ok(f.button('移除附件：A图纸.pdf'));
  assert.equal(f.button('移除附件：不能添加.pdf'), undefined);
  for (const label of ['物料名称', '规格', '数量', '数量单位', '需求日期', 'Deadline', '购买链接（选填）', '研发对接人', '低值易耗品备注']) {
    assert.equal(f.field(label).props.disabled, true, label);
  }
  for (const node of [f.select(), f.fileInput(), f.checkbox(), f.button('移除附件：A图纸.pdf'), f.button('取消'), f.button('正在生成…')]) {
    assert.equal(node.props.disabled, true, node.type);
  }
  uploadGate.resolve({ signedUrl: '/uploaded', objectKey: 'manual/key', fileName: file.name, fileSize: file.size, mimeType: file.type });
  await f.flush(); assert.equal(f.calls.transfer.length, 1); assert.equal(f.calls.transfer[0].spec, '提交规格');
  assert.equal(f.calls.transfer[0].attachments.length, 2); assert.equal(f.calls.close, 0);
  f.dialog().props.onOpenChange(false); assert.equal(f.calls.close, 0);
  transferGate.resolve(success); await f.flush();
  assert.equal(f.calls.close, 1); assert.equal(f.alert(), undefined); assert.deepEqual(f.calls.transferred, [success]);
  assert.equal(f.calls.refresh, 1); assert.equal(f.calls.success.length, 1);
});

test('提交失败保留字段与附件并解锁，可继续填写或重新提交，成功不弹放弃确认', async (t) => {
  const f = fixture(t, { transfer: async () => { throw new Error('采购服务暂不可用'); } });
  await f.flush(); f.choose(); f.change('数量', '7'); f.change('规格', '失败后保留');
  f.button('确认生成采购任务').props.onClick(); await f.flush();
  assert.equal(f.calls.close, 0); assert.equal(f.field('数量').props.value, '7'); assert.equal(f.field('规格').props.value, '失败后保留');
  assert.equal(f.checkbox().props.checked, true); assert.equal(f.field('规格').props.disabled, false);
  assert.equal(f.button('确认生成采购任务').props.disabled, false); assert.match(text(f.render()), /采购服务暂不可用/);
  f.button('取消').props.onClick(); assert.ok(f.alert()); f.continue(); f.change('规格', '重新提交');
  f.setTransfer(async () => success); f.button('确认生成采购任务').props.onClick(); await f.flush();
  assert.equal(f.calls.transfer.length, 2); assert.equal(f.calls.transfer[1].spec, '重新提交');
  assert.equal(f.calls.close, 1); assert.equal(f.alert(), undefined);
});

test('上传失败也保留手选文件并解锁，不生成采购任务，可明确放弃', async (t) => {
  const f = fixture(t, { upload: async () => { throw new Error('图纸上传失败'); } });
  await f.flush(); f.add(); f.button('确认生成采购任务').props.onClick(); await f.flush();
  assert.equal(f.calls.transfer.length, 0); assert.equal(f.calls.close, 0); assert.match(text(f.render()), /图纸上传失败/);
  assert.ok(f.button('移除附件：手选图纸.pdf')); assert.equal(f.fileInput().props.disabled, false);
  f.button('取消').props.onClick(); f.discard(); assert.equal(f.calls.close, 1);
});

test('上传等待中卸载后即使上传完成，也不继续生成采购任务或通知父页面', async (t) => {
  const gate = deferred(), file = manual();
  const f = fixture(t, { upload: () => gate.promise });
  await f.flush(); f.add(file); f.button('确认生成采购任务').props.onClick();
  assert.equal(f.calls.upload.length, 1); assert.equal(f.calls.transfer.length, 0);
  f.unmount();
  gate.resolve({ signedUrl: '/uploaded', objectKey: 'manual/key', fileName: file.name, fileSize: file.size, mimeType: file.type });
  await new Promise(setImmediate);
  assert.equal(f.calls.transfer.length, 0); assert.equal(f.calls.close, 0);
  assert.deepEqual(f.calls.transferred, []); assert.equal(f.calls.refresh, 0);
  assert.deepEqual(f.calls.success, []); assert.deepEqual(f.calls.errors, []);
});

test('采购请求已发出后卸载，成功或失败响应都不再关闭、回调或显示通知', async (t) => {
  for (const outcome of ['success', 'failure']) {
    const gate = deferred(); const f = fixture(t, { transfer: () => gate.promise });
    await f.flush(); f.choose(); f.button('确认生成采购任务').props.onClick(); await f.flush();
    assert.equal(f.calls.transfer.length, 1); f.unmount();
    if (outcome === 'success') gate.resolve(success); else gate.reject(new Error('卸载后的采购失败'));
    await new Promise(setImmediate);
    assert.equal(f.calls.close, 0, outcome); assert.deepEqual(f.calls.transferred, [], outcome);
    assert.equal(f.calls.refresh, 0, outcome); assert.deepEqual(f.calls.success, [], outcome); assert.deepEqual(f.calls.errors, [], outcome);
  }
});

test('已有有效采购关联时显示准确单号，生成被禁用且旧处理器不能提交，草稿仍需明确放弃', async (t) => {
  const f = fixture(t); await f.flush(); f.choose(); f.change('规格', '关联出现前的规格');
  const previousSubmit = f.button('确认生成采购任务').props.onClick;
  const tree = f.setProps({ blockingTask: { id: 'another-proc', code: 'PR-EXISTING-42' } });
  assert.match(text(tree), /PR-EXISTING-42/); assert.equal(f.button('确认生成采购任务').props.disabled, true);
  assert.equal(f.field('规格').props.value, '关联出现前的规格'); assert.equal(f.checkbox().props.checked, true);
  previousSubmit(); await f.flush(); assert.equal(f.calls.transfer.length, 0); assert.equal(f.calls.upload.length, 0);
  f.dialog().props.onOpenChange(false); assert.ok(f.alert()); assert.equal(f.calls.close, 0);
  f.continue(); assert.equal(f.field('规格').props.value, '关联出现前的规格');
  f.button('取消').props.onClick(); f.discard(); assert.equal(f.calls.close, 1);
});

test('上传期间异步发现有效采购关联，上传完成后不再发出 transfer，填写内容保留', async (t) => {
  const gate = deferred(), file = manual(); const f = fixture(t, { upload: () => gate.promise });
  await f.flush(); f.add(file); f.change('规格', '等待上传的规格'); f.button('确认生成采购任务').props.onClick();
  assert.equal(f.calls.upload.length, 1);
  f.setProps({ blockingTask: { id: 'created-elsewhere', code: 'PR-CONCURRENT' } });
  assert.equal(f.field('规格').props.value, '等待上传的规格'); assert.equal(f.calls.close, 0);
  gate.resolve({ signedUrl: '/uploaded', objectKey: 'manual/key', fileName: file.name, fileSize: file.size, mimeType: file.type });
  await f.flush();
  assert.equal(f.calls.transfer.length, 0); assert.deepEqual(f.calls.transferred, []); assert.equal(f.calls.close, 0);
  assert.equal(f.calls.refresh, 0); assert.deepEqual(f.calls.success, []);
  assert.match(text(f.render()), /PR-CONCURRENT/); assert.equal(f.button('确认生成采购任务').props.disabled, true);
  assert.equal(f.field('规格').props.value, '等待上传的规格'); assert.ok(f.button('移除附件：手选图纸.pdf'));
  f.button('取消').props.onClick(); assert.ok(f.alert()); f.continue(); assert.equal(f.calls.close, 0);
});

const scopeChanges = [
  ['研发任务', (f) => f.setProps({ taskId: 'rd-2', taskTitle: '另一研发任务' })],
  ['账号', (f) => f.setUser({ id: 'user-2', name: '研发乙', department: '研发' })],
  ['工作区', (f) => f.setWorkspace('production')],
];

test('上传期间切换任务、账号或工作区，旧上传返回不在新范围继续生成采购', async (t) => {
  for (const [label, changeScope] of scopeChanges) for (const outcome of ['success', 'failure']) {
    const gate = deferred(), file = manual(); const f = fixture(t, { upload: () => gate.promise });
    await f.flush(); f.add(file); f.button('确认生成采购任务').props.onClick(); assert.equal(f.calls.upload.length, 1);
    changeScope(f);
    if (outcome === 'success') gate.resolve({ signedUrl: '/uploaded', objectKey: 'manual/key', fileName: file.name, fileSize: file.size, mimeType: file.type });
    else gate.reject(new Error(`旧${label}上传失败`));
    await f.flush(); const context = `${label}/${outcome}`;
    assert.equal(f.calls.transfer.length, 0, context); assert.equal(f.calls.close, 0, context);
    assert.deepEqual(f.calls.transferred, [], context); assert.equal(f.calls.refresh, 0, context);
    assert.deepEqual(f.calls.success, [], context); assert.deepEqual(f.calls.errors, [], context);
    assert.equal(f.field('规格').props.disabled, false, `${context}: upload lock released`);
    assert.equal(f.button('确认生成采购任务').props.disabled, false, context);
    f.change('规格', '新范围继续填写'); assert.equal(f.field('规格').props.value, '新范围继续填写', context);
  }
});

test('采购请求发出后切换任务、账号或工作区，旧结果不能回调、关闭或通知新范围', async (t) => {
  for (const [label, changeScope] of scopeChanges) for (const outcome of ['success', 'failure']) {
    const gate = deferred(); const f = fixture(t, { transfer: () => gate.promise });
    await f.flush(); f.choose(); f.button('确认生成采购任务').props.onClick(); await f.flush();
    assert.equal(f.calls.transfer.length, 1); changeScope(f);
    if (outcome === 'success') gate.resolve(success); else gate.reject(new Error(`旧${label}采购失败`));
    await f.flush(); const context = `${label}/${outcome}`;
    assert.equal(f.calls.transfer.length, 1, context); assert.equal(f.calls.close, 0, context);
    assert.deepEqual(f.calls.transferred, [], context); assert.equal(f.calls.refresh, 0, context);
    assert.deepEqual(f.calls.success, [], context); assert.deepEqual(f.calls.errors, [], context);
    assert.equal(f.field('规格').props.disabled, false, `${context}: transfer lock released`);
    assert.equal(f.button('确认生成采购任务').props.disabled, false, context);
    f.change('规格', '新范围继续填写'); assert.equal(f.field('规格').props.value, '新范围继续填写', context);
  }
});

function workspaceLayerFixture(role = 'alertdialog') {
  const code = source('src/app/RDMyWorkspacePage.tsx');
  const ast = ts.createSourceFile('RDMyWorkspacePage.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['focusBelongsToNestedWorkspacePortal', 'hasExternalModalDialog', 'canRestoreWorkspaceFocus', 'useWorkspaceModalLayer'];
  const extracted = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(ast) === 'WORKSPACE_NESTED_PORTAL_SELECTOR'))
    .map((node) => node.getText(ast)).join('\n');
  const listeners = new Set(), frames = [], focus = [];
  let cleanup, dismissed = 0;
  class Element {
    constructor(name, modalRole = null) { this.name = name; this.modalRole = modalRole; this.isConnected = true; this.visible = true; this.children = []; }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    closest(selector) {
      if (this.modalRole && selector.includes(`[role="${this.modalRole}"]`) && selector.includes('[aria-modal="true"]')) return this;
      return null;
    }
    hasAttribute() { return false; }
    getClientRects() { return this.visible ? [{}] : []; }
    focus() { doc.activeElement = this; focus.push(this.name); }
  }
  const opener = new Element('opener'), layer = new Element('workspace-layer'), input = new Element('workspace-input');
  const nested = new Element('nested-modal-focus', role); layer.children.push(input);
  const doc = {
    activeElement: opener,
    querySelectorAll: (selector) => selector.includes(`[role="${role}"]`) ? [nested] : [],
    addEventListener: (name, handler) => { assert.equal(name, 'keydown'); listeners.add(handler); },
    removeEventListener: (name, handler) => { assert.equal(name, 'keydown'); listeners.delete(handler); },
  };
  const bindings = {
    document: doc, HTMLElement: Element, window: { requestAnimationFrame: (fn) => frames.push(fn) },
    useRef: (value) => ({ current: value }), React: { useLayoutEffect: (fn) => { cleanup = fn(); } },
    workspaceModalLayers: [], workspaceFocusableElements: () => [input], workspaceBackgroundBranches: () => [],
    workspaceScrollContainers: () => [], retainWorkspaceInert() {}, releaseWorkspaceInert() {}, retainWorkspaceScrollLock() {}, releaseWorkspaceScrollLock() {},
  };
  const compiled = ts.transpileModule(`${extracted}\nreturn { useWorkspaceModalLayer };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { useWorkspaceModalLayer } = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  useWorkspaceModalLayer({ current: layer }, { current: input }, () => { dismissed++; });
  return {
    doc, nested, input, focus, listeners,
    get dismissed() { return dismissed; },
    key(key) {
      const event = { key, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      for (const handler of listeners) handler(event); return event;
    },
    unmount() { cleanup(); layer.isConnected = false; while (frames.length) frames.shift()(); },
  };
}

test('工作台底层弹层不抢嵌套 alertdialog 的 Escape/Tab，正常返回底层后仍可关闭', () => {
  for (const role of ['alertdialog', 'dialog']) {
    const f = workspaceLayerFixture(role); f.doc.activeElement = f.nested;
    const initialFocusCalls = f.focus.length;
    for (const key of ['Escape', 'Tab']) {
      const event = f.key(key); assert.equal(event.defaultPrevented, false, `${role}/${key}`);
      assert.equal(event.stopped, false); assert.equal(f.dismissed, 0);
    }
    assert.equal(f.focus.length, initialFocusCalls, role);
    f.doc.activeElement = f.input;
    assert.equal(f.key('Escape').defaultPrevented, true); assert.equal(f.dismissed, 1);
    f.unmount(); assert.equal(f.listeners.size, 0);
  }
});

test('工作台弹层卸载时保留外部 alertdialog 焦点，外部模态已关闭才还原原入口', () => {
  for (const visible of [true, false]) {
    const f = workspaceLayerFixture(); f.nested.visible = visible; f.doc.activeElement = f.nested;
    f.unmount(); assert.equal(f.listeners.size, 0);
    assert.equal(f.focus.at(-1), visible ? 'workspace-input' : 'opener');
    if (visible) assert.equal(f.doc.activeElement, f.nested);
  }
});

test('草稿保存锁与父提交共用互斥，旧按钮不能在保存期间提交或关闭', async (t) => {
  const f = fixture(t); await f.flush(); f.choose();
  const draft = f.find(node => node.type === 'TransferDraftSupport');
  const staleSubmit = f.button('确认生成采购任务').props.onClick;
  assert.equal(draft.props.onWritingChange(true), true); f.render();
  assert.equal(f.button('确认生成采购任务').props.disabled, true);
  staleSubmit(); f.dialog().props.onOpenChange(false);
  assert.equal(f.calls.transfer.length, 0); assert.equal(f.calls.close, 0);
  assert.equal(f.field('规格').props.disabled, true);
  draft.props.onWritingChange(false); f.render();
  assert.equal(f.button('确认生成采购任务').props.disabled, false);
});

test('公开弹窗按账号、任务和工作区重挂，旧字段与附件不会自动写入新范围草稿', async (t) => {
  for (const [, changeScope] of scopeChanges) {
    const f = fixture(t); await f.flush(); const before = f.scopeKey();
    f.change('规格', '仅属于原范围'); f.add(); changeScope(f);
    assert.notEqual(f.scopeKey(), before);
  }
});
