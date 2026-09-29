import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/lib/pagination.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { pageTokens } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('large directories keep the current, adjacent, first and last pages in a bounded pager', () => {
  for (const total of [8, 57, 1000]) {
    for (let page = 1; page <= total; page++) {
      const tokens = pageTokens(page, total);
      const numbers = tokens.filter(token => typeof token === 'number');
      assert.ok(tokens.length <= 7);
      assert.equal(new Set(tokens).size, tokens.length);
      for (const required of [1, total, page, Math.max(1, page - 1), Math.min(total, page + 1)]) {
        assert.ok(numbers.includes(required));
      }
      assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
      assert.ok(numbers.every(value => value >= 1 && value <= total));
    }
  }
});

test('small directories retain every page without ellipses', () => {
  for (const total of [1, 2, 7]) {
    assert.deepEqual(pageTokens(1, total), Array.from({ length: total }, (_, i) => i + 1));
  }
});
