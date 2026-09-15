import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ast = (source) => ts.createSourceFile('test.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functionSource(source, name) {
  const tree = ast(source);
  return tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree).replace(/^export\s+/, '');
}
function evaluate(source, names, bindings = {}) {
  const code = ts.transpileModule(`${source}\nreturn {${names.join(',')}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}
const api = read('src/app/lib/rdTechnicalDocumentsApi.ts');
const helper = read('src/app/lib/rdProcurementTransfer.ts');
const { technicalVersionAttachment } = evaluate(functionSource(api, 'technicalVersionAttachment'), ['technicalVersionAttachment']);
const { mergeRdTransferAttachments } = evaluate(['fileIdentity', 'mergeRdTransferAttachments'].map((name) => functionSource(helper, name)).join('\n'), ['mergeRdTransferAttachments'], { technicalVersionAttachment });
const version = (id, key, tag) => ({ id, documentId: 'doc', attachmentId: 'same-attachment', sourceNoteId: 'note', fileName: `${tag}.pdf`, version: tag, category: 'drawing', fileKey: key, fileUrl: `/preview?key=${key}`, fileSize: 100, mimeType: 'application/pdf', attachment: { id: 'same-attachment', name: `${tag}.pdf`, object_key: key, preview_url: `/preview?key=${key}` } });
const document = { id: 'doc', taskId: 'rd-1', title: '图纸', category: 'drawing', currentVersionId: 'v2', versions: [version('v2', 'rd/new.pdf', 'B'), version('v1', 'rd/old.pdf', 'A')] };

test('已登记文件与研发原附件按 ID 和文件 key 去重，旧 key 绝不标为新版', () => {
  const choices = mergeRdTransferAttachments([{ id: 'same-attachment', name: 'old.pdf', fileKey: 'rd/old.pdf', fileUrl: '/old' }], [document]);
  assert.equal(choices.length, 2);
  assert.equal(choices.find((choice) => choice.fileKey === 'rd/old.pdf').technicalDocumentVersionId, 'v1');
  assert.equal(choices.find((choice) => choice.fileKey === 'rd/new.pdf').technicalDocumentVersionId, 'v2');
});

test('同 ID 的未登记旧文件保留原始身份，不能只凭 ID 猜成技术新版本', () => {
  const choices = mergeRdTransferAttachments([{ id: 'same-attachment', name: 'unregistered.pdf', fileKey: 'rd/another.pdf', fileUrl: '/another' }], [document]);
  assert.equal(choices.length, 3);
  assert.equal(choices.find((choice) => choice.fileKey === 'rd/another.pdf').technicalDocumentVersionId, undefined);
});

test('旧预览地址能解析同一 key 时去重，不因临时 URL 换签重复交付', () => {
  const choices = mergeRdTransferAttachments([{ id: 'same-attachment', name: 'old.pdf', fileUrl: '/preview?key=rd%2Fold.pdf&sig=old' }], [document]);
  assert.equal(choices.length, 2);
});

test('历史资料类型使用该版本快照，不能跟随文档当前类型变化', () => {
  const changed = { ...document, category: 'specification', versions: [
    { ...version('v2', 'rd/new.pdf', 'B'), category: 'specification' },
    { ...version('v1', 'rd/old.pdf', 'A'), category: 'drawing' },
  ] };
  const choices = mergeRdTransferAttachments([], [changed]);
  assert.equal(choices.find((choice) => choice.technicalDocumentVersionId === 'v1').category, 'drawing');
  assert.equal(choices.find((choice) => choice.technicalDocumentVersionId === 'v2').category, 'specification');
});

test('同一底层文件的多个确认版本均可明确选择，原附件不作为额外无版本项出现', () => {
  const sameFile = { ...document, versions: [version('v2', 'rd/shared.pdf', 'B'), version('v1', 'rd/shared.pdf', 'A')] };
  const choices = mergeRdTransferAttachments([
    { id: 'same-attachment', name: 'original.pdf', fileKey: 'rd/shared.pdf', fileUrl: '/original' },
    { id: 'same-attachment', name: 'original.pdf', fileKey: 'rd/shared.pdf', fileUrl: '/original?new=1' },
  ], [sameFile]);
  assert.deepEqual(choices.map((choice) => choice.technicalDocumentVersionId), ['v2', 'v1']);
  assert.match(choices[1].versionName, /A.*历史/);
});

const insertion = read('src/app/procurement/components/rdInsertion.tsx');
const translate = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? key);
function activity(user, permissions, workspace = null) {
  return evaluate(functionSource(insertion, 'ProcurementActivitySection'), ['ProcurementActivitySection'], {
    React, useI18n: () => ({ t: translate }), useAuth: () => ({ user }), useNavigate: () => () => {},
    currentRdWorkspace: () => workspace,
    usePermission: (key) => permissions.includes(key), PROC_STATUS_META: { testing: { label: '测试中' }, pending_sample: { label: '待到样' } },
    FlaskConical: () => null, ExternalLink: () => null, Paperclip: () => null,
    AutoTranslatedText: ({ text }) => React.createElement('span', null, text),
  }).ProcurementActivitySection;
}
const sampleTask = { id: 'p1', code: 'PR-1', status: 'testing', needSample: true, logs: [], sampleTest: { testerUserId: 'rd-1', testerName: '研发甲', result: null, note: null } };

test('研发详情样品摘要显示真实测试人，指定本人可进入现有确认入口', () => {
  const markup = renderToStaticMarkup(React.createElement(activity({ id: 'rd-1' }, ['page:rd-my-workspace']), { task: sampleTask }));
  assert.match(markup, /研发甲/);
  assert.match(markup, /填写测试结论/);
  assert.match(markup, /待本人确认测试结论/);
});

test('其他研发成员能看样品摘要但没有代确认入口；改样显示旧结论和当前待到样', () => {
  const markup = renderToStaticMarkup(React.createElement(activity({ id: 'rd-2' }, ['page:rd-my-workspace']), { task: { ...sampleTask, status: 'pending_sample', sampleTest: { ...sampleTask.sampleTest, result: 'failed_resample', note: '需改孔径' } } }));
  assert.doesNotMatch(markup, /填写测试结论|查看样品记录/);
  assert.match(markup, /重新送样/);
  assert.match(markup, /需改孔径/);
  assert.match(markup, /当前采购节点.*待到样/);
});

test('转采购入口显式选择附件，技术资料读取失败不能静默降级提交', () => {
  assert.match(insertion, /useState<TransferAttachmentRow\[\]>\(\(\) => isResearchWorkspace \? \[\] : taskRows\)/);
  assert.match(insertion, /fetchRdTechnicalDocuments\(taskId, controller.signal\)/);
  assert.match(insertion, /disabled=\{files.length === 0 \|\| submitting \|\| documentsLoading \|\| Boolean\(documentsError\)\}/);
  assert.match(insertion, /technicalDocumentVersionId: row.technicalDocumentVersionId/);
  assert.match(insertion, /unit: form.unit.trim\(\)/);
});

test('生产和美国协作工作区保持原采购动态，不新增研发样品和交付版本区域', () => {
  for (const workspace of ['production', 'us-collab']) {
    const markup = renderToStaticMarkup(React.createElement(activity({ id: 'rd-1' }, ['page:rd-my-workspace'], workspace), { task: sampleTask }));
    assert.match(markup, /采购动态/);
    assert.doesNotMatch(markup, /样品验证|交付资料|交付版本快照|填写测试结论/);
  }
});
