import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = {
  field: ['src/app/production/field-tasks/FieldPreviewPage.tsx', 'src/app/production/field-tasks/field-preview.css'],
  inspection: ['src/app/production/inspections/InspectionPreviewPage.tsx', 'src/app/production/inspections/inspection-preview.css'],
  archive: ['src/app/production/batch-archives/BatchArchivePreviewPage.tsx', 'src/app/production/batch-archives/batch-archive-preview.css'],
  readiness: ['src/app/procurement/monthly-readiness/MonthlyReadinessPreviewPage.tsx', 'src/app/procurement/monthly-readiness/monthly-readiness.css'],
};

const read = (path) => fs.readFileSync(path, 'utf8');

test('batch two previews use facts summaries/lists instead of process indicators', () => {
  const sources = Object.fromEntries(Object.entries(files).map(([name, paths]) => [name, paths.map(read).join('\n')]));
  assert.doesNotMatch(sources.field, /ft-workflow/);
  assert.doesNotMatch(sources.inspection, /ip-workflow/);
  assert.doesNotMatch(sources.archive, /bap-timeline/);
  assert.doesNotMatch(sources.readiness, /mr-timeline/);

  assert.match(sources.field, /现场执行概况|执行摘要|累计报工/);
  assert.match(sources.inspection, /质量跟进状态|质量摘要|首次检验/);
  assert.match(sources.archive, /生产流程与证据|证据记录|原单据待补齐/);
  assert.match(sources.readiness, /result\.timeline|预测记录|历史快照/);
});

