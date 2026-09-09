/** Browser/Node shared contract matching the FactoryQc 0.5.1 download parsers. */
export type FactorySerialConfig = {
  schemaVersion: 1;
  version: string;
  autoConnect?: boolean;
  portName?: string;
  baudRate?: number;
  dataBits?: number;
  parity?: string;
  stopBits?: string;
  handshake?: string;
  dtrEnable?: boolean;
  rtsEnable?: boolean;
  queryTimeoutMs?: number;
  scanIntervalMs?: number;
  retryDelayMs?: number;
};
export type FactoryField = {
  id: string;
  name: string;
  offset: number;
  length: number;
  type: 'uint' | 'int' | 'ascii' | 'hex' | 'enum' | 'bitset' | 'countedEnum';
  endian?: 'big' | 'little';
  scale?: number;
  divisor?: number;
  bias?: number;
  unit?: string | null;
  prefix?: string;
  enumValues?: Record<string, string> | null;
  countOffset?: number | null;
  maxCount?: number | null;
  rule?: { min?: number | null; max?: number | null; equals?: number | null } | null;
};
export type FactorySample = { frameHex: string; expected: Record<string, string> };
export type FactoryCommand = {
  id: string;
  name: string;
  operation: 'read';
  enabled?: boolean;
  disabledReason?: string | null;
  queryCode: string;
  responseCode: string;
  payloadLength: number;
  timeoutMs?: number | null;
  fields: FactoryField[];
  samples: FactorySample[];
};
export type FactoryProfile = { id: string; name: string; firmwarePrefix?: string | null; commands: FactoryCommand[] };
export type FactoryProtocolCatalog = { schemaVersion: 1; minAppVersion: string; version: string; profiles: FactoryProfile[] };

export const FACTORY_PROTOCOL_MAX_BYTES = 1_048_576;
export const FACTORY_SERIAL_MAX_BYTES = 65_536;
export const FACTORY_CLIENT_VERSION = '0.5.1';

type JsonObject = Record<string, unknown>;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
function fail(path: string, message: string): never { throw new Error(`${path}：${message}`); }
function object(value: unknown, path: string, keys?: string[]): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是 JSON 对象');
  const result = value as JsonObject;
  if (keys) for (const key of Object.keys(result)) if (!keys.includes(key)) fail(`${path}.${key}`, '不支持此字段');
  return result;
}
function text(value: unknown, path: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || CONTROL.test(value)) {
    fail(path, `必须为最长 ${max} 字符的${empty ? '' : '非空'}文本，且不含控制字符`);
  }
  return value;
}
function numeric(value: unknown, path: string, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `必须是 ${min}～${max} 内的 JSON 数字`);
  if (value !== 0 && Math.abs(value) < 1e-28) fail(path, '数值小于客户端 decimal 可可靠表达的范围');
  return value;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  const result = numeric(value, path, min, max);
  if (!Number.isSafeInteger(result)) fail(path, '必须是整数');
  return result;
}
function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(value)) fail(path, '必须为小写英文字母开头的 1～64 位字母、数字、下划线或连字符');
  return value;
}
function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `必须包含 ${min}～${max} 项`);
  return value;
}
function jsonText(value: unknown, limit: number): string {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { fail('$', '必须是可序列化的 JSON，不能含循环引用'); }
  if (!serialized || new TextEncoder().encode(serialized).length > limit) fail('$', `JSON 不得为空或超过 ${limit} 字节`);
  return serialized;
}

/** Scan the original JSON before JSON.parse can erase duplicate keys or numeric precision. */
function parseStrictJson(input: string, maxBytes: number, maxDepth: number, ignoreKeyCase = false): unknown {
  if (typeof input !== 'string' || !input.length || new TextEncoder().encode(input).length > maxBytes) fail('$', `JSON 必须为 1～${maxBytes} 字节`);
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { fail('$', 'JSON 格式不正确'); }
  let at = 0;
  const whitespace = () => { while (/\s/.test(input[at] ?? '') && at < input.length) at++; };
  const stringToken = (): string => {
    const start = at++;
    while (at < input.length) {
      if (input[at] === '\\') at += 2;
      else if (input[at++] === '"') break;
    }
    return JSON.parse(input.slice(start, at)) as string;
  };
  const scan = (depth: number, path: string): void => {
    whitespace();
    const token = input[at];
    if (token === '{' || token === '[') {
      if (depth >= maxDepth) fail(path, `JSON 嵌套超过 ${maxDepth} 层`);
      at++;
      whitespace();
      const close = token === '{' ? '}' : ']';
      const seen = new Set<string>();
      let index = 0;
      while (input[at] !== close) {
        if (token === '{') {
          const key = stringToken();
          const normalized = ignoreKeyCase ? key.toLowerCase() : key;
          if (seen.has(normalized)) fail(path, `JSON 字段 ${key} 重复`);
          seen.add(normalized);
          whitespace();
          at++; // colon; JSON.parse has already checked syntax
          scan(depth + 1, `${path}.${key}`);
        } else scan(depth + 1, `${path}[${index++}]`);
        whitespace();
        if (input[at] === ',') { at++; whitespace(); }
      }
      at++;
    } else if (token === '"') stringToken();
    else {
      const start = at;
      while (at < input.length && !/[\s,}\]]/.test(input[at])) at++;
      const literal = input.slice(start, at);
      if (/^-?\d/.test(literal)) {
        if (literal.length > 128) fail(path, '数字文本超出可可靠验证的精度范围');
        const value = Number(literal);
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail(path, '数值超出本后台可可靠验证的精度范围');
        const original = decimalFraction(literal);
        const converted = decimalFraction(String(value));
        if (original.n * converted.d !== converted.n * original.d) fail(path, '数值精度超过 JSON 数字可可靠表示的范围');
      }
    }
  };
  scan(0, '$');
  return parsed;
}

export function parseProtocolJson(input: string): FactoryProtocolCatalog {
  return validateProtocolCatalog(parseStrictJson(input, FACTORY_PROTOCOL_MAX_BYTES, 32));
}
export function parseSerialJson(input: string): FactorySerialConfig {
  return validateSerialConfig(parseStrictJson(input, FACTORY_SERIAL_MAX_BYTES, 16, true));
}

export function validateSerialConfig(input: unknown): FactorySerialConfig {
  jsonText(input, FACTORY_SERIAL_MAX_BYTES);
  const data = object(input, '$', ['schemaVersion', 'version', 'autoConnect', 'portName', 'baudRate', 'dataBits', 'parity', 'stopBits', 'handshake', 'dtrEnable', 'rtsEnable', 'queryTimeoutMs', 'scanIntervalMs', 'retryDelayMs']);
  if (data.schemaVersion !== 1) fail('schemaVersion', '只支持整数 1');
  text(data.version, 'version', 128);
  for (const key of ['autoConnect', 'dtrEnable', 'rtsEnable']) if (key in data && typeof data[key] !== 'boolean') fail(key, '必须是 JSON 布尔值');
  for (const [key, min, max] of [['baudRate', 300, 3000000], ['dataBits', 5, 8], ['queryTimeoutMs', 100, 10000], ['scanIntervalMs', 250, 60000], ['retryDelayMs', 1000, 300000]] as const) {
    if (key in data) integer(data[key], key, min, max);
  }
  if ('portName' in data) {
    const port = text(data.portName, 'portName', 16).trim();
    if (!/^(?:auto|COM[1-9][0-9]*)$/i.test(port)) fail('portName', '必须为 auto 或有效 COM 端口名称');
  }
  const enums = {
    parity: ['none', 'odd', 'even', 'mark', 'space'],
    stopBits: ['one', 'two', 'onepointfive'],
    handshake: ['none', 'xonxoff', 'requesttosend', 'requesttosendxonxoff'],
  };
  for (const [key, names] of Object.entries(enums)) {
    if (key in data && (typeof data[key] !== 'string' || !names.includes((data[key] as string).toLowerCase()))) fail(key, '必须使用客户端支持的枚举名称，不能使用数字');
  }
  return structuredClone(input) as FactorySerialConfig;
}

const FIELD_KEYS = ['id', 'name', 'offset', 'length', 'type', 'endian', 'scale', 'divisor', 'bias', 'unit', 'prefix', 'enumValues', 'countOffset', 'maxCount', 'rule'];
const FIELD_TYPES = ['uint', 'int', 'ascii', 'hex', 'enum', 'bitset', 'countedEnum'];
const NUMERIC_TYPES = ['uint', 'int', 'enum', 'bitset'];
const UINT64_MAX = (1n << 64n) - 1n;

function validateField(input: unknown, payloadLength: number, path: string): FactoryField {
  const field = object(input, path, FIELD_KEYS);
  id(field.id, `${path}.id`);
  text(field.name, `${path}.name`, 80);
  if (typeof field.type !== 'string' || !FIELD_TYPES.includes(field.type)) fail(`${path}.type`, '不支持此字段类型');
  const offset = integer(field.offset, `${path}.offset`, 0, 250);
  const length = integer(field.length, `${path}.length`, 1, 251);
  if (offset + length > payloadLength) fail(path, '字段超出有效载荷');
  const isNumeric = NUMERIC_TYPES.includes(field.type);
  if ((isNumeric || field.type === 'countedEnum') && length > 8) fail(path, '整数字段长度必须为 1～8 字节');
  if ('endian' in field && !['big', 'little'].includes(field.endian as string)) fail(`${path}.endian`, '必须为 big 或 little');
  const scale = 'scale' in field ? numeric(field.scale, `${path}.scale`, -1000000, 1000000) : 1;
  const divisor = 'divisor' in field ? numeric(field.divisor, `${path}.divisor`, 1, 1000000000000) : 1;
  const bias = 'bias' in field ? numeric(field.bias, `${path}.bias`, -1000000000000, 1000000000000) : 0;
  if ('unit' in field && field.unit !== null) text(field.unit, `${path}.unit`, 40, true);
  if ('prefix' in field) text(field.prefix, `${path}.prefix`, 40, true);
  if (!isNumeric && (scale !== 1 || divisor !== 1 || bias !== 0 || field.rule != null)) fail(path, 'ASCII、HEX、列表字段不能设置数值换算或数值规则');
  if (['enum', 'bitset', 'countedEnum'].includes(field.type)) {
    const entries = object(field.enumValues, `${path}.enumValues`);
    if (Object.keys(entries).length < 1 || Object.keys(entries).length > 256) fail(`${path}.enumValues`, '必须包含 1～256 项');
    for (const [key, label] of Object.entries(entries)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || key.length > 20) fail(`${path}.enumValues`, '键必须为无前导零的十进制无符号整数');
      const value = BigInt(key);
      if (value > UINT64_MAX || (field.type === 'bitset' ? value >= BigInt(length * 8) : value >= (1n << BigInt(length * 8)))) fail(`${path}.enumValues.${key}`, '键超出字段位宽');
      text(label, `${path}.enumValues.${key}`, 120);
    }
  } else if (field.enumValues != null) fail(path, '当前字段类型不支持 enumValues');
  if (field.type === 'countedEnum') {
    const countOffset = integer(field.countOffset, `${path}.countOffset`, 0, offset - 1);
    const maxCount = integer(field.maxCount, `${path}.maxCount`, 1, 64);
    if (countOffset >= offset || offset + length * maxCount > payloadLength) fail(path, '数量字节须位于列表前，列表不能超出载荷');
  } else if (field.countOffset != null || field.maxCount != null) fail(path, '只有 countedEnum 可设置 countOffset/maxCount');
  if (field.rule != null) {
    const rule = object(field.rule, `${path}.rule`, ['min', 'max', 'equals']);
    for (const key of ['min', 'max', 'equals']) if (key in rule && rule[key] !== null) numeric(rule[key], `${path}.rule.${key}`);
    if (rule.min == null && rule.max == null && rule.equals == null) fail(`${path}.rule`, '至少提供 min、max、equals 之一');
    if ((rule.min != null && rule.max != null && (rule.min as number) > (rule.max as number)) ||
      (rule.equals != null && rule.min != null && (rule.equals as number) < (rule.min as number)) ||
      (rule.equals != null && rule.max != null && (rule.equals as number) > (rule.max as number))) fail(`${path}.rule`, '数值条件互相矛盾');
  }
  return field as FactoryField;
}

function code(input: unknown, path: string): number {
  if (typeof input !== 'string' || !/^[0-9a-fA-F]{2}$/.test(input)) fail(path, '必须为不含 0x 的两位 HEX');
  return Number.parseInt(input, 16);
}
function frameBytes(input: unknown, path: string): number[] {
  if (typeof input !== 'string' || input.length < 10 || input.length > 764 || !/^[0-9a-fA-F ]+$/.test(input)) fail(path, '完整帧只允许 HEX 与空格，最多 255 字节');
  const hex = input.replace(/ /g, '');
  if (hex.length % 2 || hex.length / 2 > 255) fail(path, 'HEX 必须成对且不超过 255 字节');
  return hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16));
}

type Fraction = { n: bigint; d: bigint };
const DECIMAL_MAX = 79228162514264337593543950335n;
const pow10 = (power: number) => 10n ** BigInt(power);
function decimalFraction(input: string): Fraction {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(input);
  if (!match) fail('$', '数值无法转换为客户端十进制格式');
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) fail('$', '数值指数超出可验证范围');
  const shift = exponent - (match[3]?.length ?? 0);
  const n = BigInt(`${match[1]}${match[2]}${match[3] ?? ''}`);
  return shift >= 0 ? { n: n * pow10(shift), d: 1n } : { n, d: pow10(-shift) };
}
function decimalRound(input: Fraction): { coefficient: bigint; scale: number } {
  // .NET decimal: 96-bit coefficient, scale 0..28, midpoint-to-even at each arithmetic step.
  const sign = input.n < 0n ? -1n : 1n;
  const magnitude = input.n < 0n ? -input.n : input.n;
  for (let scale = 28; scale >= 0; scale--) {
    const scaled = magnitude * pow10(scale);
    let quotient = scaled / input.d;
    const remainder = scaled % input.d;
    if (remainder * 2n > input.d || (remainder * 2n === input.d && quotient % 2n !== 0n)) quotient++;
    if (quotient <= DECIMAL_MAX) {
      while (scale > 0 && quotient % 10n === 0n) { quotient /= 10n; scale--; }
      return { coefficient: sign * quotient, scale };
    }
  }
  fail('$', '数值换算超过客户端 decimal 范围');
}
function roundedFraction(value: Fraction): Fraction {
  const rounded = decimalRound(value);
  return { n: rounded.coefficient, d: pow10(rounded.scale) };
}
function numberFraction(value: number): Fraction { return decimalFraction(String(value)); }
function scaledNumber(raw: bigint, field: FactoryField): Fraction {
  const scale = numberFraction(field.scale ?? 1);
  const divisor = numberFraction(field.divisor ?? 1);
  const bias = numberFraction(field.bias ?? 0);
  const product = roundedFraction({ n: raw * scale.n, d: scale.d });
  const divided = roundedFraction({ n: product.n * divisor.d, d: product.d * divisor.n });
  return roundedFraction({ n: divided.n * bias.d + bias.n * divided.d, d: divided.d * bias.d });
}
function decimalDisplay(input: Fraction): string {
  const { coefficient, scale } = decimalRound(input);
  if (coefficient === 0n) return '0';
  const sign = coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString();
  const exponent = digits.length - scale - 1;
  if (exponent < -4) return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}E-${String(-exponent).padStart(2, '0')}`;
  if (scale === 0) return sign + digits;
  return sign + (digits.length > scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : `0.${'0'.repeat(scale - digits.length)}${digits}`);
}
function unsigned(bytes: number[], endian: string): bigint {
  let result = 0n;
  for (const byte of endian === 'little' ? [...bytes].reverse() : bytes) result = (result << 8n) | BigInt(byte);
  return result;
}
function decodeField(payload: number[], field: FactoryField, path: string): string {
  let totalLength = field.length;
  if (field.type === 'countedEnum') {
    const count = payload[field.countOffset!];
    if (count === undefined || count > field.maxCount!) fail(path, '样例的列表数量缺失或超过上限');
    totalLength = count * field.length;
    if (payload.length !== field.offset + totalLength) fail(path, '列表数量与样例帧长度不一致');
  }
  if (field.offset + totalLength > payload.length) fail(path, '字段超出样例载荷');
  const bytes = payload.slice(field.offset, field.offset + totalLength);
  let display: string;
  if (field.type === 'ascii') {
    if (bytes.some((byte) => byte < 0x20 || byte > 0x7e)) fail(path, '样例包含不可打印的 ASCII');
    display = String.fromCharCode(...bytes);
  } else if (field.type === 'hex') display = bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join('');
  else if (field.type === 'countedEnum') {
    const labels: string[] = [];
    for (let index = 0; index < bytes.length; index += field.length) {
      const key = unsigned(bytes.slice(index, index + field.length), field.endian ?? 'big').toString();
      const label = field.enumValues?.[key];
      if (label === undefined) fail(path, `样例包含未定义的编号 ${key}`);
      labels.push(label);
    }
    display = labels.length ? labels.join('、') : '无';
  } else {
    const raw = unsigned(bytes, field.endian ?? 'big');
    const signed = field.type === 'int' && (raw & (1n << BigInt(field.length * 8 - 1))) !== 0n ? raw - (1n << BigInt(field.length * 8)) : raw;
    const converted = scaledNumber(signed, field);
    if (field.type === 'enum') {
      const label = field.enumValues?.[raw.toString()];
      if (label === undefined) fail(path, `样例包含未定义的枚举值 ${raw}`);
      display = label;
    } else if (field.type === 'bitset') {
      const labels: string[] = [];
      for (let bit = 0; bit < field.length * 8; bit++) if ((raw & (1n << BigInt(bit))) !== 0n) {
        const label = field.enumValues?.[String(bit)];
        if (label === undefined) fail(path, `样例包含未定义的位 ${bit}`);
        labels.push(label);
      }
      display = labels.length ? labels.join('、') : '无';
    } else display = decimalDisplay(converted);
  }
  return (field.prefix ?? '') + display;
}

function validateSamples(command: FactoryCommand, path: string): Record<string, string>[] {
  const samples = array(command.samples, `${path}.samples`, 1, 16);
  return samples.map((input, index) => {
    const samplePath = `${path}.samples[${index}]`;
    const sample = object(input, samplePath, ['frameHex', 'expected']);
    const expected = object(sample.expected, `${samplePath}.expected`, command.fields.map((field) => field.id));
    if (Object.keys(expected).length !== command.fields.length) fail(samplePath, 'expected 必须逐项断言全部字段');
    const frame = frameBytes(sample.frameHex, `${samplePath}.frameHex`);
    if (frame.length < 5 || frame[0] !== 0xf5 || frame[1] !== frame.length || frame[2] !== 0xff - frame[1]) fail(samplePath, '帧头、总长度或长度补数不正确');
    if (frame[3] !== code(command.responseCode, `${path}.responseCode`)) fail(samplePath, '返回码与当前指令不一致');
    const payload = frame.slice(4);
    const counted = command.fields.find((field) => field.type === 'countedEnum');
    if (payload.length < (counted?.offset ?? command.payloadLength) || payload.length > command.payloadLength) fail(samplePath, '样例有效载荷长度与协议不一致');
    const decoded: Record<string, string> = {};
    for (const field of command.fields) {
      const value = decodeField(payload, field, `${samplePath}.${field.id}`);
      if (!Object.prototype.hasOwnProperty.call(expected, field.id) || typeof expected[field.id] !== 'string' || expected[field.id] !== value) fail(`${samplePath}.expected.${field.id}`, `与实际显示值不一致，实际值为 ${value}`);
      decoded[field.id] = value;
    }
    return decoded;
  });
}

export function validateProtocolCatalog(input: unknown): FactoryProtocolCatalog {
  const serialized = jsonText(input, FACTORY_PROTOCOL_MAX_BYTES);
  // Applies byte/depth/precision checks to programmatic callers as well as imported text.
  parseStrictJson(serialized, FACTORY_PROTOCOL_MAX_BYTES, 32);
  const catalog = object(input, '$', ['schemaVersion', 'minAppVersion', 'version', 'profiles']);
  if (catalog.schemaVersion !== 1) fail('schemaVersion', '只支持整数 1');
  text(catalog.version, 'version', 80);
  if (typeof catalog.minAppVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(catalog.minAppVersion)) fail('minAppVersion', '必须为三段版本号');
  const version = catalog.minAppVersion.split('.').map(Number);
  const supportedVersion = FACTORY_CLIENT_VERSION.split('.').map(Number);
  const differingPart = version.findIndex((part, index) => part !== supportedVersion[index]);
  if (version.some((part) => !Number.isSafeInteger(part) || part > 2147483647) || (differingPart >= 0 && version[differingPart] > supportedVersion[differingPart])) fail('minAppVersion', `当前仅支持应用 ${FACTORY_CLIENT_VERSION}`);
  const profiles = array(catalog.profiles, 'profiles', 1, 16);
  const profileIds = new Set<string>();
  const accepted: FactoryProfile[] = [];
  for (const [profileIndex, inputProfile] of profiles.entries()) {
    const path = `profiles[${profileIndex}]`;
    const profile = object(inputProfile, path, ['id', 'name', 'firmwarePrefix', 'commands']);
    const profileId = id(profile.id, `${path}.id`);
    text(profile.name, `${path}.name`, 80);
    if (profileIds.has(profileId)) fail(path, '协议 ID 重复');
    profileIds.add(profileId);
    if (profile.firmwarePrefix != null) {
      const prefix = text(profile.firmwarePrefix, `${path}.firmwarePrefix`, 64);
      if (!/^[\x20-\x7e]+$/.test(prefix)) fail(path, 'firmwarePrefix 只允许可打印 ASCII');
    }
    const commands = array(profile.commands, `${path}.commands`, 1, 32);
    const ids = new Set<string>();
    const queries = new Set<number>();
    const responses = new Set<number>();
    let timeoutBudget = 0;
    let firmwareSamples: Record<string, string>[] = [];
    for (const [commandIndex, inputCommand] of commands.entries()) {
      const commandPath = `${path}.commands[${commandIndex}]`;
      const data = object(inputCommand, commandPath, ['id', 'name', 'operation', 'enabled', 'disabledReason', 'queryCode', 'responseCode', 'payloadLength', 'timeoutMs', 'fields', 'samples']);
      const commandId = id(data.id, `${commandPath}.id`);
      text(data.name, `${commandPath}.name`, 80);
      if (ids.has(commandId)) fail(commandPath, '指令 ID 重复');
      ids.add(commandId);
      if (data.operation !== 'read') fail(commandPath, '只允许 operation=read，不允许写入或执行脚本');
      if ('enabled' in data && typeof data.enabled !== 'boolean') fail(`${commandPath}.enabled`, '必须是 JSON 布尔值');
      const query = code(data.queryCode, `${commandPath}.queryCode`);
      const response = code(data.responseCode, `${commandPath}.responseCode`);
      if (query < 0x70 || query > 0x86 || query === 0x81) fail(commandPath, '查询码必须位于只读范围 70～80、82～86');
      if (queries.has(query) || responses.has(response)) fail(commandPath, '同一协议内查询码或返回码重复');
      queries.add(query); responses.add(response);
      const payloadLength = integer(data.payloadLength, `${commandPath}.payloadLength`, 1, 251);
      if (data.timeoutMs != null) integer(data.timeoutMs, `${commandPath}.timeoutMs`, 100, 10000);
      if (data.enabled === false) {
        text(data.disabledReason, `${commandPath}.disabledReason`, 500);
        array(data.fields, `${commandPath}.fields`, 0, 0);
        array(data.samples, `${commandPath}.samples`, 0, 0);
        if (commandIndex === 0) fail(commandPath, '第一条 firmware 指令不能停用');
        continue;
      }
      if (data.disabledReason != null) fail(commandPath, '已启用指令不能设置 disabledReason');
      timeoutBudget += (data.timeoutMs as number | undefined) ?? 10000;
      const fields = array(data.fields, `${commandPath}.fields`, 1, 32).map((field, index) => validateField(field, payloadLength, `${commandPath}.fields[${index}]`));
      const fieldIds = new Set<string>();
      const usedBytes = new Set<number>();
      let counted: FactoryField | undefined;
      for (const field of fields) {
        if (fieldIds.has(field.id)) fail(commandPath, '字段 ID 重复');
        fieldIds.add(field.id);
        if (field.type === 'countedEnum') {
          if (counted) fail(commandPath, '最多包含一个 countedEnum');
          counted = field;
        }
        const end = field.offset + field.length * (field.type === 'countedEnum' ? field.maxCount! : 1);
        for (let byte = field.offset; byte < end; byte++) {
          if (usedBytes.has(byte)) fail(commandPath, '字段字节范围重叠');
          usedBytes.add(byte);
        }
      }
      if (counted && (counted !== fields[fields.length - 1] || counted.offset + counted.length * counted.maxCount! !== payloadLength || fields.slice(0, -1).some((field) => field.offset + field.length > counted!.offset))) fail(commandPath, '变长列表必须位于末尾，最大列表边界必须等于 payloadLength');
      const decoded = validateSamples(data as FactoryCommand, commandPath);
      if (commandIndex === 0) {
        if (commandId !== 'firmware' || query !== 0x72 || response !== 0x72 || counted) fail(commandPath, '第一条必须是固定长度 firmware，查询码和返回码均为 72');
        firmwareSamples = decoded;
      }
    }
    if (timeoutBudget > 120000) fail(path, '启用指令总超时预算超过 120000 毫秒；省略超时按 10000 毫秒计');
    const typed = profile as FactoryProfile;
    const firmware = typed.commands[0];
    if (typed.firmwarePrefix != null) {
      const first = firmware.fields[0];
      if (first.type !== 'ascii' || first.offset !== 0 || (first.prefix ?? '') !== '' || typed.firmwarePrefix.length > first.length) fail(path, '固件前缀要求首字段为 offset 0、无额外前缀且长度足够的 ASCII');
      if (!firmwareSamples.some((sample) => sample[first.id].startsWith(typed.firmwarePrefix!))) fail(path, '没有固件样例能匹配 firmwarePrefix');
    }
    for (const other of accepted) {
      if (other.commands[0].payloadLength === firmware.payloadLength && (other.firmwarePrefix == null || typed.firmwarePrefix == null || other.firmwarePrefix.startsWith(typed.firmwarePrefix) || typed.firmwarePrefix.startsWith(other.firmwarePrefix))) fail(path, `固件识别条件与协议 ${other.id} 重叠`);
    }
    accepted.push(typed);
  }
  return structuredClone(input) as FactoryProtocolCatalog;
}
