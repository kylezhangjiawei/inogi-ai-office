import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/lib/rdMeetingTodosApi.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace("import { authFetch, readErrorMessage } from './authSession';", `
  const authFetch = (...args) => globalThis.meetingTestFetch(...args);
  const readErrorMessage = async response => (await response.json()).message;
`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { meetingWeekStart, shiftMeetingDate, meetingWeekLabel, meetingTodosApi, MeetingRequestError } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('week navigation normalizes Sundays, leap days, year boundaries and invalid dates', () => {
  assert.equal(meetingWeekStart('2026-10-11'), '2026-10-05');
  assert.equal(meetingWeekStart('2026-01-01'), '2025-12-29');
  assert.equal(meetingWeekStart('2024-02-29'), '2024-02-26');
  assert.equal(meetingWeekStart('2026-02-29'), null);
  assert.equal(meetingWeekStart('2026-2-9'), null);
  assert.equal(meetingWeekStart('invalid'), null);
  assert.equal(shiftMeetingDate('2026-03-09', -7), '2026-03-02');
  assert.equal(meetingWeekLabel('2025-12-29'), '2025.12.29 — 01.04');
});

test('uncreated week is a valid JSON envelope; writes carry the revision without automatic replay', async () => {
  const calls = [];
  globalThis.meetingTestFetch = async (url, init) => { calls.push({ url, ...init }); return Response.json({ week: null }); };
  try {
    assert.equal(await meetingTodosApi.week('2026-10-05'), null);
    await meetingTodosApi.add({ weekStart: '2026-10-05', revision: 7 }, { title: '安排测试', memberId: 'p1', description: '', dueDate: null });
    assert.equal(calls[1].method, 'POST');
    assert.equal(JSON.parse(calls[1].body).revision, 7);
    globalThis.meetingTestFetch = async () => { calls.push('conflict'); return Response.json({ message: '版本冲突' }, { status: 409 }); };
    await assert.rejects(() => meetingTodosApi.remove({ weekStart: '2026-10-05', revision: 7 }, 'item1'), error => error instanceof MeetingRequestError && error.status === 409 && error.message === '版本冲突');
    assert.equal(calls.filter(call => call === 'conflict').length, 1);
  } finally { delete globalThis.meetingTestFetch; }
});

const pageSource = await readFile(new URL('../src/app/RDMeetingTodosPage.tsx', import.meta.url), 'utf8');
const pageAst = ts.createSourceFile('page.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = pageAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RDMeetingTodosPage');
const mutation = page.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mutate');
function evaluate(code, dependencies) {
  return new Function(...Object.keys(dependencies), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(dependencies));
}

test('conflict retains the draft and its original revision but blocks replay until the editor reloads', async () => {
  let editor = { item: { id: 'item1' }, draft: { title: '旧标题', description: '本人的修改' }, revision: 8 };
  let latestWeek;
  const busyRef = { current: false };
  const mutate = evaluate(`${mutation.getText(pageAst)}; return mutate;`, {
    busyRef, setBusy() {}, setFormError() {}, setLoadError() {}, selectedWeek: '2026-10-05',
    setEditor: updater => { editor = updater(editor); }, setWeek: week => { latestWeek = week; },
    api: { week: async () => ({ revision: 9 }) }, MeetingRequestError,
    toast: { error() {}, success() {} }, errorMessage: error => error.message,
  });
  assert.equal(await mutate(async () => { throw new MeetingRequestError('版本冲突', 409); }, '保存成功'), false);
  assert.equal(latestWeek.revision, 9);
  assert.equal(editor.revision, 8);
  assert.equal(editor.conflicted, true);
  assert.equal(editor.draft.description, '本人的修改');
  assert.equal(busyRef.current, false);
  let submit;
  const visit = node => {
    if (!submit && ts.isJsxAttribute(node) && node.name.getText(pageAst) === 'onSubmit') submit = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(page);
  const calls = [];
  const runSubmit = current => evaluate(`return (${submit.getText(pageAst)});`, {
    editor: current, record: { weekStart: '2026-10-05', revision: 9 },
    mutate: action => action(), api: { update: async (week, id, draft) => { calls.push({ week, id, draft }); return week; } }, setEditor() {},
  })({ preventDefault() {} });
  await runSubmit(editor);
  assert.equal(calls.length, 0, 'stale draft cannot be resubmitted after a conflict');
  await runSubmit({ ...editor, conflicted: false });
  assert.equal(calls[0].week.revision, 8, 'a refreshed list must not silently upgrade an open editor revision');
});
