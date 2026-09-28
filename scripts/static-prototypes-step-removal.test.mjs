import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const directions = ['direction-a', 'direction-b', 'direction-c'];

test('static prototype drawers use compact status and next-step summaries', () => {
  for (const direction of directions) {
    const app = fs.readFileSync(path.join(root, 'design-prototypes', direction, 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'design-prototypes', direction, 'styles.css'), 'utf8');

    assert.doesNotMatch(app, /class="progress-title"/);
    assert.doesNotMatch(app, /class="progress"/);
    assert.doesNotMatch(app, /class="progress-item/);
    assert.match(app, /当前状态/);
    assert.match(app, /下一步/);
    assert.doesNotMatch(css, /\.progress:before/);
    assert.doesNotMatch(css, /\.progress-item/);
    assert.match(css, /\.drawer-summary/);
    assert.match(css, /\.summary-item/);
  }
});

test('direction D task details do not render a timeline', () => {
  const source = fs.readFileSync(path.join(root, 'design-prototypes', 'direction-d', 'src', 'main.jsx'), 'utf8');

  assert.doesNotMatch(source, /d-timeline|FLOW/);
  assert.match(source, /当前状态|下一动作/);
});
