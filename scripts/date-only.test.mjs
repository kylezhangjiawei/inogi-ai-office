import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/lib/dateOnly.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { parseDateOnly, formatDateOnly } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('date filters round-trip local dates including leap days without a UTC shift', () => {
  for (const value of ['2024-02-29', '2026-09-29', '2026-12-31', '0099-01-01']) {
    const date = parseDateOnly(value);
    assert.ok(date);
    assert.equal(formatDateOnly(date), value);
    assert.equal(date.getHours(), 0);
  }
});
test('invalid and overflow dates cannot silently select another calendar day', () => {
  for (const value of ['', undefined, '0000-01-01', '2026-02-29', '2026-13-01', '2026-04-31', '2026-00-01', '2026-01-00', '2026-1-1', '2026-09-29T00:00:00Z']) {
    assert.equal(parseDateOnly(value), undefined);
  }
});
