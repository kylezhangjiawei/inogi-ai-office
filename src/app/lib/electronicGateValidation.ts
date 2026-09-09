import type { GateConfig, GateItem } from "./electronicGateApi";

export type GateValidationErrors = Record<string, string>;

export function validateGateConfig(item: GateItem, config: GateConfig, publishing = false): GateValidationErrors {
  const errors: GateValidationErrors = {};
  if (!config.displayName.trim()) errors.displayName = "请填写显示名称";
  if (publishing && item.category !== "connection" && !config.model.trim()) errors.model = "发布前请填写适用机型";
  if (publishing && item.category !== "connection" && !config.market.trim()) errors.market = "发布前请填写发货市场";
  for (const field of item.fields) {
    const value = (config.values[field.key] ?? "").trim();
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
  const { minimum, maximum } = config.values;
  if (minimum?.trim() && maximum?.trim() && Number(minimum) > Number(maximum)) errors.maximum = "上限不能小于下限";
  if (publishing && minimum?.trim() && maximum?.trim() && config.values.boundary === "exclusive" && Number(minimum) === Number(maximum)) errors.maximum = "不包含上下限时，上限必须大于下限";
  if (publishing && item.id === "serial-port" && config.values.mode === "fixed" && !config.values.port?.trim()) errors.port = "固定串口模式下请填写串口名称";
  if (item.id === "serial-port" && config.values.port?.trim() && (!/^COM[1-9][0-9]*$/i.test(config.values.port.trim()) || config.values.port.trim().length > 16)) errors.port = "请填写有效 COM 端口名称，例如 COM3";
  return errors;
}
