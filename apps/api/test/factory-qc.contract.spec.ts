import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseProtocolJson, parseSerialJson, validateProtocolCatalog, validateSerialConfig,
  type FactoryCommand, type FactoryField, type FactoryProtocolCatalog,
} from '../src/modules/electronic-gate/factory-qc.contract';
import { FACTORY_PROTOCOL_EXAMPLE, FACTORY_SERIAL_DEFAULTS } from '../src/modules/electronic-gate/factory-qc.example';

const example = () => structuredClone(FACTORY_PROTOCOL_EXAMPLE);

test('客户端版本上限随当前0.5.1更新，按数值比较并保留较早版本兼容', () => {
  for (const version of ['0.4.2', '0.4.99', '0.5.0', '0.5.1']) {
    const catalog = example(); catalog.minAppVersion = version;
    assert.equal(validateProtocolCatalog(catalog).minAppVersion, version);
  }
  for (const version of ['0.5.2', '0.6.0', '1.0.0']) {
    const catalog = example(); catalog.minAppVersion = version;
    assert.throws(() => validateProtocolCatalog(catalog), /0\.5\.1/);
  }
});
const frame = (payload: number[], response = 0x74) => [0xf5, payload.length + 4, 0xff - payload.length - 4, response, ...payload].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
function numericCatalog(payload: number[], expected: string, field: Partial<FactoryField> = {}): FactoryProtocolCatalog {
  const command: FactoryCommand = {
    id: 'value', name: '数值解析测试', operation: 'read', queryCode: '74', responseCode: '74', payloadLength: payload.length,
    fields: [{ id: 'value', name: '数值', offset: 0, length: payload.length, type: 'uint', ...field }],
    samples: [{ frameHex: frame(payload), expected: { value: expected } }],
  };
  return { schemaVersion: 1, minAppVersion: '0.4.0', version: 'test', profiles: [{ id: 'test', name: '测试协议', commands: [structuredClone(FACTORY_PROTOCOL_EXAMPLE.profiles[0].commands[0]), command] }] };
}

test('交付原始示例通过完整解析校验；30份sample全部断言且不增加质检规则', () => {
  const validated = validateProtocolCatalog(FACTORY_PROTOCOL_EXAMPLE);
  assert.deepEqual(validated, FACTORY_PROTOCOL_EXAMPLE);
  assert.notEqual(validated, FACTORY_PROTOCOL_EXAMPLE);
  assert.deepEqual(validated.profiles.map((profile) => profile.commands.length), [7, 22]);
  assert.equal(validated.profiles.flatMap((profile) => profile.commands.flatMap((command) => command.samples)).length, 30);
  assert.equal(validated.profiles.flatMap((profile) => profile.commands.flatMap((command) => command.fields)).filter((field) => field.rule != null).length, 0);
  assert.deepEqual(parseProtocolJson(JSON.stringify(FACTORY_PROTOCOL_EXAMPLE)), FACTORY_PROTOCOL_EXAMPLE);
  assert.deepEqual(validateSerialConfig(FACTORY_SERIAL_DEFAULTS), FACTORY_SERIAL_DEFAULTS);
});

test('串口schema/version必填，保留省略语义，运行字段不暗中填默认值', () => {
  const partial = { schemaVersion: 1 as const, version: 'partial' };
  assert.deepEqual(validateSerialConfig(partial), partial);
  for (const data of [{ version: 'v1' }, { schemaVersion: 1 }, { ...partial, schemaVersion: '1' }, { ...partial, version: ' ' }, { ...partial, version: 'bad\nversion' }]) assert.throws(() => validateSerialConfig(data));
});

test('串口完整字段边界与枚举名称、数字布尔类型按客户端限制校验', () => {
  for (const [key, min, max] of [['baudRate', 300, 3000000], ['dataBits', 5, 8], ['queryTimeoutMs', 100, 10000], ['scanIntervalMs', 250, 60000], ['retryDelayMs', 1000, 300000]] as const) {
    for (const value of [min, max]) assert.doesNotThrow(() => validateSerialConfig({ ...FACTORY_SERIAL_DEFAULTS, [key]: value }));
    for (const value of [min - 1, max + 1, min + 0.5, String(min), null]) assert.throws(() => validateSerialConfig({ ...FACTORY_SERIAL_DEFAULTS, [key]: value }));
  }
  for (const key of ['autoConnect', 'dtrEnable', 'rtsEnable']) for (const value of [0, 1, 'true', null]) assert.throws(() => validateSerialConfig({ ...FACTORY_SERIAL_DEFAULTS, [key]: value }));
  assert.doesNotThrow(() => validateSerialConfig({ ...FACTORY_SERIAL_DEFAULTS, parity: 'Mark', stopBits: 'OnePointFive', handshake: 'RequestToSendXOnXOff', portName: 'com12' }));
  for (const patch of [{ parity: '0' }, { stopBits: '1' }, { stopBits: 'None' }, { handshake: 0 }, { portName: 'COM0' }, { portName: 'COM01' }, { portName: 'COM1;exit' }]) assert.throws(() => validateSerialConfig({ ...FACTORY_SERIAL_DEFAULTS, ...patch }));
});

test('本地地址凭据、未知管理字段、重复JSON键均不能进入下载契约', () => {
  for (const key of ['remoteConfigUrl', 'protocolConfigUrl', 'refreshIntervalSeconds', 'bearerTokenEnvironmentVariable', 'data', 'publishedAt']) assert.throws(() => validateSerialConfig({ ...FACTORY_SERIAL_DEFAULTS, [key]: 'unexpected' }));
  assert.throws(() => parseSerialJson('{"schemaVersion":1,"version":"a","version":"b"}'), /重复/);
  assert.throws(() => parseProtocolJson('{"schemaVersion":1,"version":"a","ver\\u0073ion":"b"}'), /重复/);
  const duplicateNested = JSON.stringify(FACTORY_PROTOCOL_EXAMPLE).replace('"offset":0', '"offset":0,"offset":1');
  assert.throws(() => parseProtocolJson(duplicateNested), /重复/);
  assert.throws(() => parseProtocolJson(JSON.stringify({ ...FACTORY_PROTOCOL_EXAMPLE, executeScript: 'forbidden' })), /不支持/);
});

test('原始JSON按UTF8字节/深度限制检查，拒绝精度已丢失的数值和非法类型', () => {
  assert.throws(() => parseProtocolJson(` ${' '.repeat(1_048_576)}{}`), /字节/);
  assert.throws(() => parseSerialJson(`{"schemaVersion":1,"version":"${'中'.repeat(23000)}"}`), /字节/);
  assert.throws(() => parseProtocolJson('['.repeat(33) + '0' + ']'.repeat(33)), /嵌套/);
  const source = JSON.stringify(FACTORY_PROTOCOL_EXAMPLE);
  assert.throws(() => parseProtocolJson(source.replace('"scale":1', '"scale":0.100000000000000005')), /精度/);
  assert.throws(() => parseProtocolJson(source.replace('"scale":1', '"scale":1e999')), /精度/);
  assert.throws(() => parseProtocolJson(source.replace('"scale":1', '"scale":"1"')), /JSON 数字/);
});

test('完整帧严格验证帧头、长度补数、返回码、实际载荷和expected显示值', () => {
  for (const replacement of ['F4 07 F8 72 01 02 03', 'F5 06 F9 72 01 02 03', 'F5 07 F7 72 01 02 03', 'F5 07 F8 74 01 02 03', 'F5 06 F9 72 01 02']) {
    const catalog = example();
    catalog.profiles[0].commands[0].samples[0].frameHex = replacement;
    assert.throws(() => validateProtocolCatalog(catalog));
  }
  const wrong = example();
  wrong.profiles[0].commands[0].samples[0].expected.value = 'V010204';
  assert.throws(() => validateProtocolCatalog(wrong), /实际值为 V010203/);
  const missing = example();
  missing.profiles[1].commands[0].samples[0].expected = { main: 'V4.0UA81' };
  assert.throws(() => validateProtocolCatalog(missing), /全部字段/);
});

test('64位整数、大小端、有符号数、decimal循环小数与G29显示使用精确计算', () => {
  for (const catalog of [
    numericCatalog([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], '18446744073709551615'),
    numericCatalog([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], '-1', { type: 'int' }),
    numericCatalog([0x34, 0x12], '4660', { endian: 'little' }),
    numericCatalog([0xff, 0xff], '0.9', { type: 'int', scale: 0.1, bias: 1 }),
    numericCatalog([1], '0.1666666666666666666666666667', { divisor: 6 }),
    numericCatalog([1], '1E-06', { divisor: 1000000 }),
    numericCatalog([0x80], '-128', { type: 'int' }),
  ]) assert.doesNotThrow(() => validateProtocolCatalog(catalog));
  assert.throws(() => validateProtocolCatalog(numericCatalog([1], '0.16666666666666666', { divisor: 6 })), /实际显示值/);
});

test('ASCII必须可打印、HEX和prefix保持原值，expected不包含unit', () => {
  assert.doesNotThrow(() => validateProtocolCatalog(numericCatalog([0x41, 0x42], '版本 AB', { type: 'ascii', prefix: '版本 ' })));
  assert.doesNotThrow(() => validateProtocolCatalog(numericCatalog([0, 0x23], 'HEX 0023', { type: 'hex', prefix: 'HEX ' })));
  assert.throws(() => validateProtocolCatalog(numericCatalog([0], '\0', { type: 'ascii' })), /ASCII/);
  assert.throws(() => validateProtocolCatalog(numericCatalog([1], '1 kPa', { unit: 'kPa' })), /实际显示值/);
});

test('枚举和位图必须完整定义样例中的值，位图键是位索引且受位宽约束', () => {
  assert.doesNotThrow(() => validateProtocolCatalog(numericCatalog([5], 'A、C', { type: 'bitset', enumValues: { '0': 'A', '2': 'C' } })));
  assert.doesNotThrow(() => validateProtocolCatalog(numericCatalog([0], '无', { type: 'bitset', enumValues: { '0': 'A' } })));
  assert.throws(() => validateProtocolCatalog(numericCatalog([2], 'B', { type: 'enum', enumValues: { '1': 'A' } })), /未定义/);
  assert.throws(() => validateProtocolCatalog(numericCatalog([2], 'B', { type: 'bitset', enumValues: { '0': 'A' } })), /未定义的位/);
  for (const enumValues of [{ '01': 'A' }, { '256': 'A' }] as Array<Record<string, string>>) assert.throws(() => validateProtocolCatalog(numericCatalog([1], 'A', { type: 'enum', enumValues })));
});

test('报警计数列表校验计数、实际长度、最大容量和字段冲突', () => {
  const base = example();
  const alarms = base.profiles[1].commands.find((command) => command.queryCode === '77')!;
  assert.equal(alarms.samples[0].expected.codes, '无');
  const mutations: Array<(command: FactoryCommand) => void> = [
    (command) => { command.samples[1].frameHex = 'F5 06 F9 77 02 13'; },
    (command) => { command.fields[1].countOffset = 1; },
    (command) => { command.fields[1].maxCount = 65; },
    (command) => { command.payloadLength = 66; },
    (command) => { command.fields.reverse(); },
    (command) => { command.fields[1].offset = 0; },
  ];
  for (const mutate of mutations) {
    const catalog = example();
    mutate(catalog.profiles[1].commands.find((command) => command.queryCode === '77')!);
    assert.throws(() => validateProtocolCatalog(catalog));
  }
});

test('字段不重叠、未知字段拒绝，HEX不允许暗中增加数值判定', () => {
  const overlap = example();
  overlap.profiles[1].commands[0].fields[1].offset = 7;
  assert.throws(() => validateProtocolCatalog(overlap), /重叠/);
  assert.throws(() => validateProtocolCatalog(numericCatalog([1], '01', { type: 'hex', rule: { equals: 1 } })), /不能设置数值/);
  assert.throws(() => validateProtocolCatalog(numericCatalog([1], '1', { enumValues: { '1': 'one' } })), /不支持 enumValues/);
  const unknown = example();
  (unknown.profiles[0].commands[0].fields[0] as any).conditionScript = 'true';
  assert.throws(() => validateProtocolCatalog(unknown), /不支持此字段/);
});

test('简单数值规则校验矛盾和类型；失败样例仍是合法解析样例，不被强制改为通过', () => {
  assert.doesNotThrow(() => validateProtocolCatalog(numericCatalog([10], '10', { rule: { max: 5 } })));
  for (const rule of [{}, { min: 2, max: 1 }, { min: 2, equals: 1 }, { max: 1, equals: 2 }, { equals: '1' }, { min: null, max: null, equals: null }, { min: 0, exclusive: true }]) {
    assert.throws(() => validateProtocolCatalog(numericCatalog([1], '1', { rule: rule as any })));
  }
});

test('固件探测指令、适用前缀、同长度profile选择不能歧义', () => {
  const mutations: Array<(catalog: FactoryProtocolCatalog) => void> = [
    (catalog) => { catalog.profiles[0].commands.reverse(); },
    (catalog) => { catalog.profiles[0].firmwarePrefix = 'V'; },
    (catalog) => { catalog.profiles[1].firmwarePrefix = 'OTHER'; },
    (catalog) => { const cloned = structuredClone(catalog.profiles[1]); cloned.id = 'overlap'; cloned.firmwarePrefix = 'V4'; catalog.profiles.push(cloned); },
    (catalog) => { catalog.profiles[1].id = catalog.profiles[0].id; },
    (catalog) => { catalog.minAppVersion = '0.5.2'; },
  ];
  for (const mutate of mutations) { const catalog = example(); mutate(catalog); assert.throws(() => validateProtocolCatalog(catalog)); }
});

test('只读命令、启停约束、重复码和总超时预算强制检查', () => {
  const mutations: Array<(catalog: FactoryProtocolCatalog) => void> = [
    (catalog) => { (catalog.profiles[0].commands[1] as any).operation = 'write'; },
    (catalog) => { catalog.profiles[0].commands[1].queryCode = '81'; },
    (catalog) => { catalog.profiles[0].commands[1].queryCode = '72'; },
    (catalog) => { catalog.profiles[0].commands[1].responseCode = '72'; },
    (catalog) => { catalog.profiles[0].commands[1].enabled = false; },
    (catalog) => { catalog.profiles[0].commands[1].disabledReason = 'not allowed while enabled'; },
    (catalog) => { catalog.profiles[0].commands[1].timeoutMs = 10001; },
    (catalog) => { catalog.profiles[1].commands.forEach((command) => { delete command.timeoutMs; }); },
  ];
  for (const mutate of mutations) { const catalog = example(); mutate(catalog); assert.throws(() => validateProtocolCatalog(catalog)); }
});
