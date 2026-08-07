import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildRdTaskAttachmentPayload } from '../../../src/app/lib/rdAttachmentPayload.ts';

test('legacy fallback keeps the full attachment count while limiting only card previews', () => {
  const olderFiles = Array.from({ length: 4 }, (_, index) => ({
    id: `file-${index}`,
    name: `document-${index}.pdf`,
    mime: 'application/pdf',
    size: 1000 + index,
    preview_url: `/preview/file-${index}`,
    extracted_text: `must not leak ${index}`,
  }));
  const newerImages = Array.from({ length: 4 }, (_, index) => ({
    id: `image-${index}`,
    name: `image-${index}.png`,
    mime: 'image/png',
    size: 2000 + index,
    thumb_url: `/thumb/image-${index}`,
    preview_url: `/preview/image-${index}`,
    extracted_text: `must not leak ${index}`,
  }));

  const preview = buildRdTaskAttachmentPayload([
    { created_at: '2026-07-01T00:00:00.000Z', attachments: olderFiles },
    { created_at: '2026-07-31T00:00:00.000Z', attachments: newerImages },
  ], 5);

  assert.equal(preview.attachment_count, 8);
  assert.equal(preview.attachments.length, 5);
  assert.deepEqual(preview.attachments.slice(0, 4).map((item) => item.id), [
    'image-0',
    'image-1',
    'image-2',
    'image-3',
  ]);
  for (const attachment of preview.attachments) {
    assert.equal('extracted_text' in attachment, false);
  }

  const full = buildRdTaskAttachmentPayload([
    { created_at: '2026-07-31T00:00:00.000Z', attachments: newerImages },
    { created_at: '2026-07-01T00:00:00.000Z', attachments: olderFiles },
  ]);
  assert.equal(full.attachment_count, 8);
  assert.equal(full.attachments.length, 8);
});

test('cockpit pagination cannot stall when the first six cards do not create a scrollbar', async () => {
  const source = await readFile(
    new URL('../../../src/app/RDTaskManagementPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /if \(scrollEl\.scrollHeight - scrollEl\.clientHeight >= 120\) return;/,
    'underfilled task feeds must proactively add another page',
  );
  assert.match(
    source,
    /loadNextTaskPage\(activeTab, totalTasks\);/,
    'the underfilled-feed effect must advance the active tab',
  );
  assert.match(
    source,
    /onClick=\{\(\) => loadNextTaskPage\("all", allActiveTasks\.length\)\}/,
    'the all-task footer must provide a clickable pagination fallback',
  );
  // 成员页签改为主责/协助分段后，分页只驱动主责段：兜底按钮与补页判断都必须用主责数
  assert.match(
    source,
    /onClick=\{\(\) => loadNextTaskPage\(p\.key, primaryTasks\.length\)\}/,
    'each person-task footer must provide a clickable pagination fallback',
  );
  assert.match(
    source,
    /: \(personTasksMap\.get\(activeTab\)\?\.primary\.length \?\? 0\);/,
    'the underfilled-feed effect must measure the primary segment only',
  );
});
