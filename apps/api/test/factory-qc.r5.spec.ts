import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { validateProtocolCatalog, type FactoryCommand } from '../src/modules/electronic-gate/factory-qc.contract';
import { FACTORY_PROTOCOL_EXAMPLE } from '../src/modules/electronic-gate/factory-qc.example';
import {
  buildFactoryQcR5Draft, buildHistoricalFactoryQcCandidate,
  R5_PROFILE_ID, R5_PROTOCOL_NOTES, R5_REVIEW_NOTICE, R5_SOURCE,
} from '../src/modules/electronic-gate/factory-qc.r5';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
function commands(): Record<string, FactoryCommand> {
  return Object.fromEntries(buildFactoryQcR5Draft().profiles.find((profile) => profile.id === R5_PROFILE_ID)!.commands.map((command) => [command.id, command]));
}

test('历史候选内容与r5 ZIP原始JSON规范化摘要一致，未混入r5后续更正', () => {
  const candidate = buildHistoricalFactoryQcCandidate();
  // Independently calculated from the ZIP entry, with recursive ordinal key sorting; no DLL is executed.
  const digest = createHash('sha256').update(JSON.stringify(canonical(candidate))).digest('hex');
  assert.equal(digest, '0bb6ad9be2f08389118f98acdc1d853556d3d48d394dcf2e616ad0c037e0caa4');
  assert.equal(candidate.version, R5_SOURCE.historicalCandidateVersion);
  assert.equal(candidate.profiles.flatMap((profile) => profile.commands.flatMap((command) => command.samples)).length, 34);
  assert.equal(candidate.profiles[1].commands.find((command) => command.id === 'valve-pressure')!.fields[0].type, 'uint');
});

test('r5审核模板35个完整样例通过现有校验，但没有添加任何质检规则', () => {
  const template = buildFactoryQcR5Draft();
  assert.equal(template.version, 'review-r5-20260909');
  assert.equal(template.schemaVersion, 1);
  assert.deepEqual(validateProtocolCatalog(template), template);
  assert.equal(template.profiles.flatMap((profile) => profile.commands.flatMap((command) => command.samples)).length, 35);
  assert.equal(template.profiles[1].commands.filter((command) => command.enabled !== false).length, 21);
  for (const field of template.profiles.flatMap((profile) => profile.commands.flatMap((command) => command.fields))) assert.equal(field.rule, undefined);
  assert.match(R5_REVIEW_NOTICE, /不会自动保存或发布/);
  assert.match(R5_REVIEW_NOTICE, /不代表/);
});

test('原始v2与旧版profile完全保留，每次构建返回独立对象', () => {
  const original = structuredClone(FACTORY_PROTOCOL_EXAMPLE);
  const template = buildFactoryQcR5Draft();
  assert.deepEqual(template.profiles[0], original.profiles[0]);
  assert.deepEqual(template.profiles[1].commands[0], original.profiles[1].commands[0], '未伪造修正后的固件识别应答');
  template.profiles[1].name = 'mutated';
  assert.notEqual(buildFactoryQcR5Draft().profiles[1].name, 'mutated');
  assert.deepEqual(FACTORY_PROTOCOL_EXAMPLE, original);
  assert.equal(FACTORY_PROTOCOL_EXAMPLE.version, 'builtin-20260909-v2');
});

test('77数量与78/79类型换算及样例遵循历史候选，不再次除以10', () => {
  const all = commands();
  assert.equal(all.alarms.payloadLength, 24);
  assert.equal(all.alarms.fields.find((field) => field.id === 'codes')!.maxCount, 23);
  assert.equal(all.alarms.samples.length, 5);
  assert.match(all.alarms.name, /当前活动报警/);
  const pressure = all['pressure-check'].fields[0];
  assert.deepEqual([pressure.type, pressure.endian, pressure.scale, pressure.divisor, pressure.unit], ['uint', 'big', 1, 1, 'kPa']);
  assert.deepEqual(all['pressure-check'].samples.map((sample) => sample.expected.value), ['173', '300']);
  const temperature = all['temperature-check'].fields[0];
  assert.deepEqual([temperature.type, temperature.endian, temperature.scale, temperature.divisor, temperature.unit], ['int', 'big', 1, 1, '℃']);
  assert.deepEqual(all['temperature-check'].samples.map((sample) => sample.expected.value), ['35', '-5']);
});

test('7D仅更正有符号类型，未知单位省略，继承字节序及构造样例来源明确', () => {
  const command = commands()['valve-pressure'];
  assert.equal(command.fields[0].type, 'int');
  assert.equal(command.fields[0].endian, 'big');
  assert.equal(command.fields[0].unit, undefined);
  assert.deepEqual(command.samples[1], { frameHex: 'F5 06 F9 7D FF FB', expected: { value: '-5' } });
  const note = R5_PROTOCOL_NOTES['valve-pressure'];
  assert.match(note.pending.join(' '), /big.*继承.*并非.*确认/);
  assert.match(note.pending.join(' '), /单位及工程量换算仍未知/);
  assert.match(note.sampleSources!.join(' '), /构造.*不是实机/);
});

test('83/84字典与expected同步，抹平字段只更名并保留未确认原始布局提示', () => {
  const all = commands();
  assert.deepEqual(all.calibration230.fields[0].enumValues, { '0': '未完成 / 基线不可用', '1': '已完成' });
  assert.equal(all.calibration230.samples[0].expected.status, '已完成');
  assert.equal(all.calibration230.fields[1].name, '230 抹平值');
  assert.deepEqual([all.calibration230.fields[1].type, all.calibration230.fields[1].endian, all.calibration230.fields[1].unit], ['uint', 'big', undefined]);
  assert.deepEqual(all.calibration232.fields[0].enumValues, { '0': '未完成', '1': '已完成' });
  assert.equal(all.calibration232.samples[0].expected.value, '已完成');
  assert.match(R5_PROTOCOL_NOTES.calibration230.pending.join(' '), /raw.*继承.*尚未确认/);
});

test('状态名称、持久设置与RAM读取区分，73停用，76兼容语义不被扩大', () => {
  const all = commands();
  assert.equal(all.fan.name, '风扇实际反馈比例');
  assert.equal(all.fan.fields[0].unit, '%');
  assert.equal(all.restarts.name, '压缩机异常自动重启次数');
  assert.match(all.sensitivity.name, /EEPROM/);
  assert.match(all.volume.name, /EEPROM/);
  assert.match(all.delivery.name, /RAM/);
  assert.equal(all.parameters.enabled, false);
  assert.match(all.parameters.disabledReason!, /预留、未开发/);
  assert.deepEqual([all.parameters.fields, all.parameters.samples], [[], []]);
  assert.equal(all.usage.fields[0].divisor, 60);
  assert.equal(buildFactoryQcR5Draft().profiles[0].commands.find((command) => command.id === 'usage')!.fields[0].unit, '秒');
});

test('管理说明不进入客户端JSON，固件修正与同前缀风险仍明确保留', () => {
  const serialized = JSON.stringify(buildFactoryQcR5Draft());
  for (const key of ['confirmed', 'pending', 'sampleSources', 'packageName', 'historicalCandidateVersion']) assert.equal(serialized.includes(`"${key}":`), false);
  assert.match(R5_PROTOCOL_NOTES.firmware.pending.join(' '), /V4\.0UA81.*不能证明/);
  assert.match(R5_PROTOCOL_NOTES.firmware.pending.join(' '), /子版本.*无法区分/);
  assert.match(R5_PROTOCOL_NOTES['pressure-check'].pending.join(' '), /低 8 位.*85/);
});
