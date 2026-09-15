import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { GATE_DEFINITIONS } from '../src/modules/electronic-gate/electronic-gate.catalog';

test('Debug draft template uses the confirmed blocking zero target for every model and market', () => {
  const definition = GATE_DEFINITIONS.find(item => item.id === 'debug-status')!;
  const rule = definition.defaults;
  assert.equal(definition.number, '06');
  assert.equal(rule.enabled, true);
  assert.equal(rule.model, '');
  assert.equal(rule.market, '');
  assert.equal(rule.failureAction, 'block');
  assert.equal(rule.values.operator, 'equals');
  assert.equal(rule.values.expected, '0');
  assert.equal(rule.values.approval, 'confirmed');
  assert.match(rule.values.readbackSource, /75.*00.*01/);
  assert.match(rule.values.evidence, /用户明确确认.*全机型正式标准/);
  assert.doesNotMatch(rule.helpText, /待确认|建议/);
});
