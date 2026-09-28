import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cases = [
  {
    name: 'quality exceptions',
    tsx: 'src/app/procurement/quality/QualityExceptionsPreviewPage.tsx',
    css: 'src/app/procurement/quality/quality-exceptions-preview.css',
    oldClass: 'qep-progress',
    summaryClass: 'qep-status-summary',
    facts: ['当前状态', '检验数量', '不良数量'],
  },
  {
    name: 'ecn',
    tsx: 'src/app/production/ecn/EcnPreviewPage.tsx',
    css: 'src/app/production/ecn/ecn-preview.css',
    oldClass: 'ecn-stages',
    summaryClass: 'ecn-status-summary',
    facts: ['当前状态', 'ECN 编号', '执行验证'],
  },
  {
    name: 'production rd collaboration',
    tsx: 'src/app/production/rd-collaboration/ProductionRdPreviewPage.tsx',
    css: 'src/app/production/rd-collaboration/production-rd.css',
    oldClass: 'prd-steps',
    summaryClass: 'prd-status-summary',
    facts: ['当前状态', '当前负责人', '下一动作'],
  },
  {
    name: 'transfer',
    tsx: 'src/app/production/transfer/TransferPreviewPage.tsx',
    css: 'src/app/production/transfer/transfer-preview.css',
    oldClass: 'tp-workflow',
    summaryClass: 'tp-status-summary',
    facts: ['当前状态', '发布条件', '当前操作'],
  },
];

test('batch one preview pages use status summaries instead of process indicators', () => {
  for (const item of cases) {
    const tsx = fs.readFileSync(path.join(root, item.tsx), 'utf8');
    const css = fs.readFileSync(path.join(root, item.css), 'utf8');
    assert.doesNotMatch(tsx, new RegExp(`className=\\"${item.oldClass}\\"`), `${item.name} JSX still renders ${item.oldClass}`);
    assert.doesNotMatch(css, new RegExp(`\\.${item.oldClass}\\b`), `${item.name} CSS still defines ${item.oldClass}`);
    assert.match(tsx, new RegExp(item.summaryClass), `${item.name} is missing its status summary`);
    assert.match(css, new RegExp(`\\.${item.summaryClass}\\b`), `${item.name} is missing summary styling`);
    for (const fact of item.facts) assert.match(tsx, new RegExp(fact), `${item.name} lost fact: ${fact}`);
    assert.doesNotMatch(tsx, /S18|key-materials/i, `${item.name} unexpectedly touches the S18/key-materials surface`);
    assert.doesNotMatch(css, /S18|key-materials/i, `${item.name} unexpectedly touches the S18/key-materials surface`);
  }
});

test('batch one scope excludes S18/key-materials routes and files', () => {
  for (const item of cases) {
    assert.doesNotMatch(item.tsx, /S18|key-materials/i);
    assert.doesNotMatch(item.css, /S18|key-materials/i);
  }
  assert.deepEqual(cases.some((item) => /S18|key-materials/i.test(`${item.tsx} ${item.css}`)), false);
});
