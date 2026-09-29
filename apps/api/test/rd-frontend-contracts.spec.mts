import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'node:test';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

test('image gallery controls are excluded before the swipe surface captures a pointer', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../src/app/RDProgressEvidence.tsx'),
    'utf8',
  );
  const controlGuard = source.indexOf('event.target instanceof Element && event.target.closest("button, a")');
  const pointerCapture = source.indexOf('event.currentTarget.setPointerCapture(event.pointerId)');

  assert.ok(controlGuard >= 0, 'gallery pointer handling must ignore button and link controls');
  assert.ok(pointerCapture > controlGuard, 'interactive-control guard must run before pointer capture');
});

test('non-main product UI renders the server-confirmed tree instead of an optimistic copy', () => {
  const pageSource = readFileSync(
    resolve(__dirname, '../../../src/app/RDTaskManagementPage.tsx'),
    'utf8',
  );
  const apiSource = readFileSync(resolve(__dirname, '../../../src/app/lib/rdApi.ts'), 'utf8');
  const treeSource = readFileSync(resolve(__dirname, '../../../src/app/rd/CategoryTree.tsx'), 'utf8');

  assert.match(
    pageSource,
    /const result = await saveProductTaskCategories\(boardProductId, nextCategories\);\s*(?:\/\/[^\n]*\n\s*)?saved = result\.categories \?\? await fetchProductTaskCategories\(boardProductId\);/,
  );
  assert.match(
    apiSource,
    /requestJson<\{ ok: boolean; categories\?: RdCategory\[\] \}>\(`/,
  );

  function actionButton(mode: string) {
    const action = treeSource.lastIndexOf(`mode: "${mode}"`);
    const start = treeSource.lastIndexOf('<Button', action);
    const end = treeSource.indexOf('</Button>', action);
    assert.ok(action >= 0 && start >= 0 && end > action, `${mode} must have a rendered Button`);
    assert.equal(treeSource.indexOf('</Button>', start), end, `${mode} must belong to the selected Button`);
    return treeSource.slice(start, end);
  }
  const childRenameButton = actionButton('edit-sub');
  assert.doesNotMatch(childRenameButton, /disabled=/, 'a populated child must remain renameable');

  const childDeleteButton = actionButton('delete-sub');
  assert.match(childDeleteButton, /aria-disabled=\{subTaskTotal > 0\}/);
  assert.match(childDeleteButton, /if \(subTaskTotal === 0\)/);

  const systemDeleteButton = actionButton('delete-system');
  assert.match(systemDeleteButton, /aria-disabled=\{subTaskCount > 0\}/);
  assert.match(systemDeleteButton, /if \(subTaskCount === 0\)/);
});
