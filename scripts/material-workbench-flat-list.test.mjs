import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/app/procurement/components/MaterialTable.tsx'), 'utf8');

test('material workbench renders one flat list without category tree controls', () => {
  assert.doesNotMatch(source, /viewMode|ToggleGroup|FolderTree|分类浏览|大类.*分类/);
  assert.doesNotMatch(source, /expanded|majorOf|categoryRows|ChevronDown|ChevronRight/);
  assert.match(source, /MaterialTable/);
  assert.match(source, /Pagination/);
});
