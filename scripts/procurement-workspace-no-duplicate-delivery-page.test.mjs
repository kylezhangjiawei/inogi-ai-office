import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/procurement/ProcMyWorkspacePage.tsx'), 'utf8');

test('procurement workspace keeps one task list and handles arrivals in the original task detail', () => {
  assert.doesNotMatch(source, /ProcWorkspaceArrivals|ProcurementDeliverySchedule|proc-workspace-calendar-tab|proc-workspace-calendar-view/);
  assert.match(source, /<TaskDetailDrawer[^\n]*presentation="workspace"/);
  const detail = fs.readFileSync(path.join(process.cwd(), 'src/app/procurement/components/TaskDetailDrawer.tsx'), 'utf8');
  assert.match(detail, /aria-label=\{t\("采购与到货"\)\}/);
  assert.match(detail, /task\.arrivedQty\.toLocaleString\(\)/);
});
