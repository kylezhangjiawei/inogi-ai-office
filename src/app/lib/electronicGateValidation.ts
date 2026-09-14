import type { GateConfig, GateItem } from "./electronicGateApi";

export type GateValidationErrors = Record<string, string>;


function parameterProfilesError(text: string, plan = '', performanceClass = '', model = ''): string | null {
  let profiles: unknown;
  try { profiles = JSON.parse(text); } catch { return '型号参数方案必须为有效 JSON 数组'; }
  const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
  const names = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0
    && value.every(name => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 200)
    && new Set(value).size === value.length;
  const uint16 = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
  if (!Array.isArray(profiles) || !profiles.length) return '型号参数方案至少需要一条配置';
  const combinations = new Set<string>();
  for (const profile of profiles) {
    if (!object(profile) || Object.keys(profile).some(key => !['models', 'valveType', 'plan', 'performanceClass', 'slots'].includes(key))
      || !names(profile.models) || ![0, 1].includes(profile.valveType) || !['shipping', 'fixed-mac'].includes(profile.plan) || profile.performanceClass !== 'A'
      || !Array.isArray(profile.slots) || profile.slots.length < 1 || profile.slots.length > 8
      || profile.slots.some((slot: unknown) => !object(slot) || Object.keys(slot).some(key => !['gear', 'speed', 'duration'].includes(key))
        || !Number.isInteger(slot.gear) || slot.gear < 0 || slot.gear > 7 || !uint16(slot.speed) || !uint16(slot.duration))
      || new Set(profile.slots.map((slot: {gear: number}) => slot.gear)).size !== profile.slots.length) {
      return '型号参数须含唯一模型名、阀类型0/1、有效计划、性能级A及1～8个唯一开放档；STEP为0～7，转速/时长为0～65535整数，禁止未知字段';
    }
    for (const name of profile.models) {
      const key = JSON.stringify([name, profile.valveType, profile.plan, profile.performanceClass]);
      if (combinations.has(key)) return '同型号、阀类型、计划和性能级不能配置重叠参数方案';
      combinations.add(key);
    }
  }
  if (plan && performanceClass && !profiles.some(profile => profile.plan === plan && profile.performanceClass === performanceClass && (!model || profile.models.includes(model))))
    return '所选计划、性能级和适用机型没有匹配的参数方案';
  return null;
}

function gearPressureBoundsError(text: string, model = '', range = false): string | null {
  const label = range ? '档位压力范围' : '档位压力上限';
  let rows: unknown;
  try { rows = JSON.parse(text); } catch { return `${label}必须为有效 JSON 数组`; }
  const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!Array.isArray(rows) || !rows.length) return `${label}至少需要一条配置`;
  const prior: Array<{gear: number; models?: string[]}> = [];
  for (const row of rows) {
    if (!object(row) || Object.keys(row).some(key => !['gear', 'maximum', 'models', ...(range ? ['minimum'] : [])].includes(key))
      || !Number.isInteger(row.gear) || row.gear < 0 || row.gear > 7 || typeof row.maximum !== 'number' || !Number.isFinite(row.maximum) || row.maximum < 0 || row.maximum > 65535
      || (range && (typeof row.minimum !== 'number' || !Number.isFinite(row.minimum) || row.minimum < 0 || row.minimum > row.maximum))
      || (row.models !== undefined && (!Array.isArray(row.models) || !row.models.length
        || row.models.some((name: unknown) => typeof name !== 'string' || !name || name.trim() !== name || name.length > 200)
        || new Set(row.models).size !== row.models.length))) return `${label}须为STEP 0～7、0～65535有效压力范围及可选唯一模型名数组，禁止未知字段`;
    if (prior.some(previous => previous.gear === row.gear && (!previous.models || !row.models || previous.models.some(name => row.models.includes(name)))))
      return '同档位压力范围不能对同一机型重复或重叠配置';
    prior.push(row as {gear: number; models?: string[]});
  }
  if (model && !prior.some(row => !row.models || row.models.includes(model))) return `适用机型没有匹配的${label}`;
  return null;
}

export function validateGateConfig(item: GateItem, config: GateConfig, publishing = false): GateValidationErrors {
  const errors: GateValidationErrors = {};
  if (!config.displayName.trim()) errors.displayName = "请填写显示名称";
  const universalScope = (item.id === "built-in-parameters" && config.values.operator === "profile-slots") || (item.id === "sensor-pressure" && ["gear-upper", "gear-range"].includes(config.values.operator));
  if (publishing && item.category !== "connection" && !universalScope && !config.model.trim()) errors.model = "发布前请填写适用机型";
  if (publishing && item.category !== "connection" && !universalScope && !config.market.trim()) errors.market = "发布前请填写发货市场";
  if (Object.keys(config.values).some(key => !item.fields.some(field => field.key === key))) errors.values = "包含当前配置项不支持的字段";
  for (const field of item.fields) {
    const value = (config.values[field.key] ?? "").trim();
    if (value.length > 4096) errors[field.key] = "不能超过4096字";
    if (publishing && field.required && !value) errors[field.key] = `请填写${field.label}`;
    if (value && field.type === "number") {
      const numeric = Number(value);
      if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) || !Number.isFinite(numeric)) errors[field.key] = "请输入有效数字";
      else if (field.allowNegative !== true && numeric < 0) errors[field.key] = "不能填写负数";
      else if (["timeoutMs", "retrySeconds", "observationMs"].includes(field.key) && numeric <= 0) errors[field.key] = "必须大于 0";
      else if (["expected", "timeoutMs"].includes(field.key) && !Number.isSafeInteger(numeric)) errors[field.key] = "请输入有效整数";
      else if (field.integer && !Number.isSafeInteger(numeric)) errors[field.key] = "请输入有效整数";
      else if (field.min !== undefined && numeric < field.min) errors[field.key] = `不能小于 ${field.min}`;
      else if (field.max !== undefined && numeric > field.max) errors[field.key] = `不能大于 ${field.max}`;
      else if (field.precision !== undefined && (value.split(".")[1]?.length ?? 0) > field.precision) errors[field.key] = `最多保留 ${field.precision} 位小数`;
    }
    if (value && field.type === "select" && !field.options?.some(option => option.value === value)) errors[field.key] = "请选择有效选项";
  }
  if (publishing && ["device-model", "shipping-market", "firmware-version"].includes(item.id)
    && config.values.operator === "allowlist" && !config.values.allowedValues?.trim()) errors.allowedValues = "请填写允许清单中的完整值";
  const values = config.values;
  if (values.parameterProfiles?.trim()) {
    const error = parameterProfilesError(values.parameterProfiles, values.parameterPlan, values.performanceClass, config.model.trim());
    if (error) errors.parameterProfiles = error;
  }
  if (values.gearUpperBounds?.trim()) {
    const error = gearPressureBoundsError(values.gearUpperBounds, config.model.trim());
    if (error) errors.gearUpperBounds = error;
  }
  if (values.gearRanges?.trim()) {
    const error = gearPressureBoundsError(values.gearRanges, config.model.trim(), true);
    if (error) errors.gearRanges = error;
  }
  if (publishing) {
    const requireFields = (keys: string[]) => { for (const key of keys) if (!values[key]?.trim()) errors[key] = "发布前请填写本模式所需字段"; };
    const rejectFields = (keys: string[]) => { for (const key of keys) if (values[key]?.trim()) errors[key] ??= "请清空与当前模式冲突的兼容字段"; };
    if (item.id === "fpga-version") {
      if (values.operator === "equals") { requireFields(["expected"]); rejectFields(["allowedValues"]); }
      else { requireFields(["allowedValues"]); rejectFields(["expected"]); }
    }
    if (item.id === "built-in-parameters") {
      const legacy = ["time310", "time310Unit", "time210", "time210Unit", "compressorRpm"], profiles = ["parameterProfiles", "parameterPlan", "performanceClass"];
      if (values.operator === "profile-slots") { requireFields(profiles); rejectFields([...legacy, "parameterSlots"]); }
      else if (values.operator === "slots") { requireFields(["parameterSlots"]); rejectFields([...legacy, ...profiles]); }
      else { requireFields(legacy); rejectFields(["parameterSlots", ...profiles]); }
    }
    if (item.id === "sensor-pressure") {
      if (values.operator === "gear-range") {
        requireFields(["gearRanges", "boundary"]); rejectFields(["gear", "minimum", "maximum", "gearUpperBounds"]);
        if (values.boundary === "unconfirmed") errors.boundary = "档位压力范围须明确上下限包含方式";
        if (values.boundary === "exclusive" && values.gearRanges?.trim() && !errors.gearRanges
          && JSON.parse(values.gearRanges).some((row: {minimum: number; maximum: number}) => row.minimum === row.maximum)) errors.gearRanges = "档位压力开区间必须有有效范围";
      }
      else if (values.operator === "gear-upper") { requireFields(["gearUpperBounds", "boundary"]); rejectFields(["gear", "minimum", "maximum", "gearRanges"]); }
      else { requireFields(["gear", "minimum", "maximum", "boundary"]); rejectFields(["gearUpperBounds", "gearRanges"]); if (values.boundary === "unconfirmed") errors.boundary = "旧固定范围须明确边界包含方式"; }
    }
  }
  const { minimum, maximum } = config.values;
  if (minimum?.trim() && maximum?.trim() && Number(minimum) > Number(maximum)) errors.maximum = "上限不能小于下限";
  if (publishing && minimum?.trim() && maximum?.trim() && config.values.boundary === "exclusive" && Number(minimum) === Number(maximum)) errors.maximum = "不包含上下限时，上限必须大于下限";
  if (publishing && item.id === "serial-port" && config.values.mode === "fixed" && !config.values.port?.trim()) errors.port = "固定串口模式下请填写串口名称";
  if (item.id === "serial-port" && config.values.port?.trim() && (!/^COM[1-9][0-9]*$/i.test(config.values.port.trim()) || config.values.port.trim().length > 16)) errors.port = "请填写有效 COM 端口名称，例如 COM3";
  return errors;
}
