import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, Code2, Copy, FileJson, History, Info, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Switch } from "./components/ui/switch";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";
import { factoryQcApi, FactoryQcApiError, type FactoryQcApi, type FactoryCommand, type FactoryField, type FactoryProtocolCatalog, type FactoryQcCommandState, type FactoryQcHistoryVersion, type FactoryQcKind, type FactoryQcManagementState } from "./lib/factoryQcApi";
import { FACTORY_PROTOCOL_EXAMPLE } from "../../apps/api/src/modules/electronic-gate/factory-qc.example";
import { FACTORY_PROTOCOL_DEFAULT } from "../../apps/api/src/modules/electronic-gate/factory-qc.defaults";
import { parseProtocolJson, validateProtocolCatalog } from "../../apps/api/src/modules/electronic-gate/factory-qc.contract";
import { R5_SOURCE, R5_PROTOCOL_NOTES, type R5ProtocolNote } from "../../apps/api/src/modules/electronic-gate/factory-qc.r5";
import { protocolPublicationIssues } from "../../apps/api/src/modules/electronic-gate/factory-qc.release";
import "./factory-qc-panel.css";

type Pair = { key: string; value: string };
type FieldForm = {
  id: string; name: string; offset: string; length: string; type: FactoryField["type"]; endian: string;
  scale: string; divisor: string; bias: string; unit: string; prefix: string; countOffset: string; maxCount: string;
  min: string; max: string; equals: string; enumValues: Pair[];
};
type CommandForm = {
  id: string; name: string; enabled: boolean; disabledReason: string; queryCode: string; responseCode: string;
  payloadLength: string; timeoutMs: string; fields: FieldForm[]; samples: { frameHex: string; expected: Pair[] }[];
};
type Edit = { form: CommandForm; base: CommandForm; revision: number };
type Confirmation = { title: string; description: string; action: () => Promise<void> };
const fieldTypes: FactoryField["type"][] = ["uint", "int", "ascii", "hex", "enum", "bitset", "countedEnum"];
const labels: Record<FactoryField["type"], string> = { uint: "无符号整数", int: "有符号整数", ascii: "ASCII 文本", hex: "HEX 原值", enum: "枚举", bitset: "位集合", countedEnum: "计数枚举" };
const textNumber = (value: number | null | undefined) => value == null ? "" : String(value);
const pairs = (value: Record<string, string> | null | undefined): Pair[] => Object.entries(value ?? {}).map(([key, value]) => ({ key, value }));
const clone = <T,>(value: T): T => structuredClone(value);
const equals = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (profileId: string, commandId: string) => `${profileId}/${commandId}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作未完成，请稍后重试。";
const isConflict = (error: unknown) => error instanceof FactoryQcApiError && error.status === 409;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const CURRENT_PROFILE_ID = "v4-20260908";
const PRODUCTION_DOWNLOADS = {
  serial: "https://www.weoxymedical.com/api/factory-qc/serial",
  protocol: "https://www.weoxymedical.com/api/factory-qc/protocol",
} as const;
const CURRENT_PROTOCOL_NOTES: Record<string, R5ProtocolNote> = {
  firmware: {
    confirmed: ["沿用 9 字节应答：8 字节 ASCII 主版本及 1 字节子版本。当前默认配置匹配 V4.0UA81。"],
    pending: ["当前配置停用 78；启用前仍需修正固件的完整 72、78 回包及适用范围。主版本相同而子版本不同的固件，不能仅靠现有前缀判断已修正。"],
  },
  parameters: { confirmed: ["73 当前固件预留、未开发；默认停用，字段和样本为空。"], pending: ["新增实现后需补充完整协议及回包样本。"] },
  alarms: {
    confirmed: ["77 读取当前活动报警：单字节数量加单字节编号列表，最多 23 条。无报警数量为 0，故障清除后下次查询不再返回对应编号。", "未知编号保持可见；默认样本包括 0、1、2、4、23 条报警。"],
    pending: ["同帧编号不重复是固件约定，客户端未检查编号唯一性。报警处置与放行条件仍由检测规则确定。"],
    sampleSources: ["4 条样本 F5 09 F6 77 04 01 05 13 16 来自研发回复；23 条样本用于边界验证。"],
  },
  "pressure-check": {
    confirmed: ["v0.5.0 默认停用 78。研发反馈当前实现只返回低 8 位，且误用返回码 85。"],
    pending: ["修正后的目标格式为两字节、大端、无符号整数 kPa（00 AD = 173）。必须核实修正固件及完整回包后再配置启用。", "传感器有效状态尚未定义；读到数字或落在范围内不能证明测量有效。"],
  },
  "temperature-check": {
    confirmed: ["79 为两字节、大端、有符号补码、整数 ℃。00 23 = 35，FF FB = -5；客户端不再除以 10。"],
    pending: ["无效、未就绪和测量失败状态尚未定义，客户端显示有效性待确认。不能将 FFFF 自行解释为异常哨兵值。"],
  },
  "valve-pressure": {
    confirmed: ["7D 为有符号 16 位微压实时差值平均值；默认以有符号整数显示，不填写 Pa/kPa。"],
    pending: ["big 字节序及 1 倍换算沿用既有配置，研发新回复尚未确认。需要正、负值完整报文以及单位、换算关系。"],
    sampleSources: ["默认负值样本按继承的大端布局构造，用于解析验证，不能证明固件字节序或工程单位。"],
  },
  fan: { confirmed: ["7A 是实际风扇反馈比例，约 0～100，不是目标值或 RPM。"], pending: ["该范围不是批准的质检标准，异常值和风扇完整测试条件仍需确认。"] },
  restarts: { confirmed: ["7C 读取压缩机异常自动重启累计次数。"], pending: ["计数复位及掉电保存规则仍未说明。"] },
  calibration230: {
    confirmed: ["83 首字节：0 表示未完成或基线不可用，1 表示已完成。", "后两字节以 HEX 原始字节保留，例如 HEX 000B；不推断为已确认的工程数值。"],
    pending: ["抹平值的有符号性、字节序、单位及换算尚未确认；完成标志的全部持久性和失效条件仍待补充。"],
  },
  calibration232: { confirmed: ["84 为完成标志：0 未完成、1 已完成；清除对应校准数据后回到 0。"], pending: ["完整掉电保存及失效条件仍需确认。"] },
  sensitivity: { confirmed: ["7F 读取 EEPROM 中的持久灵敏度，目标 3 级。v0.5.0 已提供断电前后比对及原始回包记录。"], pending: ["实际断电及同一台设备由操作员确认；单次读到 3 不自动判定整机合格。"] },
  volume: { confirmed: ["80 读取 EEPROM 中的持久按键音量，已纳入 v0.5.0 断电前后比对。"], pending: ["合法音量等级和目标值仍待确认。前后一致只证明本次比对一致。"] },
  delivery: { confirmed: ["86 读取 RAM 当前档位，目标 3 档；已纳入 v0.5.0 断电前后比对。"], pending: ["本查询不是独立的 EEPROM 默认值回读。完全断电和设备身份由操作员确认。"] },
  usage: { confirmed: ["新版固件 76 按分钟返回，除以 60 显示小时。"], pending: ["旧三字节固件 legacy-v1 保留原秒单位，等待旧固件实机证据。"] },
  pressure: { confirmed: ["85 是当前大气压。"], pending: ["独立开机基线的读取命令、有效状态及回包仍未提供，不能将 85 直接当作开机基线。"] },
};
function toForm(command: FactoryCommand): CommandForm {
  return {
    id: command.id, name: command.name, enabled: command.enabled !== false, disabledReason: command.disabledReason ?? "",
    queryCode: command.queryCode, responseCode: command.responseCode, payloadLength: String(command.payloadLength), timeoutMs: textNumber(command.timeoutMs),
    fields: command.fields.map(field => ({
      id: field.id, name: field.name, offset: String(field.offset), length: String(field.length), type: field.type, endian: field.endian ?? "",
      scale: textNumber(field.scale), divisor: textNumber(field.divisor), bias: textNumber(field.bias), unit: field.unit ?? "", prefix: field.prefix ?? "",
      countOffset: textNumber(field.countOffset), maxCount: textNumber(field.maxCount), min: textNumber(field.rule?.min), max: textNumber(field.rule?.max), equals: textNumber(field.rule?.equals), enumValues: pairs(field.enumValues),
    })),
    samples: command.samples.map(sample => ({ frameHex: sample.frameHex, expected: pairs(sample.expected) })),
  };
}
function numeric(value: string, label: string, required = false): number | undefined {
  if (!value.trim()) { if (required) throw new Error(`请填写${label}。`); return undefined; }
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) || !Number.isFinite(Number(value))) throw new Error(`${label}必须是有效数值。`);
  return Number(value);
}
function record(rows: Pair[], label: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const row of rows) {
    if (!row.key.trim()) throw new Error(`${label}中的键不能为空。`);
    if (Object.prototype.hasOwnProperty.call(result, row.key)) throw new Error(`${label}存在重复键：${row.key}。`);
    result[row.key] = row.value;
  }
  return result;
}
function fromForm(form: CommandForm, original?: FactoryCommand): FactoryCommand {
  const originalForm = original ? toForm(original) : null;
  if (original && equals(form, originalForm)) return clone(original);
  const result: FactoryCommand = {
    id: form.id, name: form.name, operation: "read", enabled: form.enabled,
    ...(form.disabledReason ? { disabledReason: form.disabledReason } : {}),
    queryCode: form.queryCode, responseCode: form.responseCode,
    payloadLength: numeric(form.payloadLength, "载荷长度", true)!, ...(form.timeoutMs.trim() ? { timeoutMs: numeric(form.timeoutMs, "响应超时") } : {}),
    fields: form.fields.map(field => {
      const originalIndex = original?.fields.findIndex(previous => previous.id === field.id) ?? -1;
      const previous = originalIndex >= 0 ? original!.fields[originalIndex] : undefined;
      const previousForm = originalIndex >= 0 ? originalForm!.fields[originalIndex] : undefined;
      if (previous && equals(field, previousForm)) return clone(previous);
      const result: FactoryField = { id: field.id, name: field.name, type: field.type, offset: numeric(field.offset, `${field.name || field.id}偏移`, true)!, length: numeric(field.length, `${field.name || field.id}长度`, true)! };
      if (field.endian) result.endian = field.endian as FactoryField["endian"];
      for (const key of ["scale", "divisor", "bias", "countOffset", "maxCount"] as const) if (field[key].trim()) result[key] = numeric(field[key], key);
      if (field.unit) result.unit = field.unit;
      if (field.prefix) result.prefix = field.prefix;
      if (field.enumValues.length) result.enumValues = record(field.enumValues, `${field.name || field.id}枚举字典`);
      const rule: NonNullable<FactoryField["rule"]> = {};
      for (const key of ["min", "max", "equals"] as const) if (field[key].trim()) rule[key] = numeric(field[key], `${field.name || field.id} ${key}`);
      if (Object.keys(rule).length) result.rule = rule;
      if (previous && previousForm) {
        // Preserve absent/null/empty optional values unless that control changed.
        for (const key of ["endian", "scale", "divisor", "bias", "unit", "prefix", "countOffset", "maxCount", "enumValues"] as const) {
          if (equals(field[key], previousForm[key])) {
            if (Object.prototype.hasOwnProperty.call(previous, key)) Object.assign(result, { [key]: clone(previous[key]) });
            else delete result[key];
          }
        }
        if (["min", "max", "equals"].every(key => field[key] === previousForm[key])) {
          if (Object.prototype.hasOwnProperty.call(previous, "rule")) result.rule = clone(previous.rule);
          else delete result.rule;
        }
      }
      return result;
    }),
    samples: form.samples.map((sample, index) => original && equals(sample, originalForm?.samples[index]) ? clone(original.samples[index]) : ({ frameHex: sample.frameHex, expected: record(sample.expected, `样本 ${index + 1} 的期望值`) })),
  };
  if (original && originalForm) {
    for (const key of ["enabled", "disabledReason", "timeoutMs"] as const) {
      if (form[key] === originalForm[key]) {
        if (Object.prototype.hasOwnProperty.call(original, key)) Object.assign(result, { [key]: clone(original[key]) });
        else delete result[key];
      }
    }
  }
  return result;
}
function replaceCommand(catalog: FactoryProtocolCatalog, profileId: string, command: FactoryCommand): FactoryProtocolCatalog {
  return { ...catalog, profiles: catalog.profiles.map(profile => profile.id === profileId ? { ...profile, commands: profile.commands.map(current => current.id === command.id ? command : current) } : profile) };
}
function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : ""; }

function FormField({ label, children, wide = false, hint }: { label: string; children: React.ReactNode; wide?: boolean; hint?: string }) {
  return <label className={`fqc-field${wide ? " fqc-field--wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function TextControl({ label, value, onChange, hint, numeric: numberInput = false }: { label: string; value: string; onChange: (value: string) => void; hint?: string; numeric?: boolean }) {
  return <FormField label={label} hint={hint}><input value={value} onChange={event => onChange(event.target.value)} inputMode={numberInput ? "decimal" : undefined} maxLength={500} /></FormField>;
}
function PairEditor({ rows, onChange, keyLabel, valueLabel, label }: { rows: Pair[]; onChange: (rows: Pair[]) => void; keyLabel: string; valueLabel: string; label: string }) {
  return <div className="fqc-pairs">{rows.map((row, index) => <div className="fqc-pair" key={index}>
    <input aria-label={`${label} ${index + 1} ${keyLabel}`} placeholder={keyLabel} value={row.key} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />
    <input aria-label={`${label} ${index + 1} ${valueLabel}`} placeholder={valueLabel} value={row.value} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
    <Button variant="ghost" size="icon" aria-label={`删除${label} ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={14} /></Button>
  </div>)}<Button variant="ghost" size="sm" onClick={() => onChange([...rows, { key: "", value: "" }])}><Plus size={14} />添加{label}</Button></div>;
}
function CommandEditor({ form, onChange, disabled }: { form: CommandForm; onChange: (form: CommandForm) => void; disabled: boolean }) {
  const patch = (value: Partial<CommandForm>) => onChange({ ...form, ...value });
  const setField = (index: number, value: Partial<FieldForm>) => patch({ fields: form.fields.map((field, i) => i === index ? { ...field, ...value } : field) });
  return <fieldset className="fqc-command-editor" disabled={disabled}>
    <div className="fqc-editor-caption"><span>仅读取设备信息，不发送返工动作；这里的解析范围不能替代完整质检放行规则。</span><label className="fqc-switch">启用读取<Switch checked={form.enabled} onCheckedChange={enabled => patch({ enabled })} aria-label="启用读取" /></label></div>
    <div className="fqc-form-grid">
      <TextControl label="读取项名称" value={form.name} onChange={name => patch({ name })} />
      <TextControl label="查询码" value={form.queryCode} onChange={queryCode => patch({ queryCode })} hint="例如 72，两位 HEX 不含 0x，须属于只读白名单" />
      <TextControl label="返回码" value={form.responseCode} onChange={responseCode => patch({ responseCode })} hint="两位 HEX，不含 0x" />
      <TextControl label="载荷长度（字节）" numeric value={form.payloadLength} onChange={payloadLength => patch({ payloadLength })} />
      <TextControl label="响应超时（毫秒）" numeric value={form.timeoutMs} onChange={timeoutMs => patch({ timeoutMs })} hint="留空使用客户端缺省值" />
      <TextControl label="停用原因" value={form.disabledReason} onChange={disabledReason => patch({ disabledReason })} hint="停用时必须说明；不会作为失败读取放行" />
    </div>
    <div className="fqc-subheading"><strong>字段解析 <span>{form.fields.length}</span></strong><Button variant="outline" size="sm" onClick={() => patch({ fields: [...form.fields, { id: `field-${form.fields.length + 1}`, name: "新字段", offset: "0", length: "1", type: "uint", endian: "", scale: "", divisor: "", bias: "", unit: "", prefix: "", countOffset: "", maxCount: "", min: "", max: "", equals: "", enumValues: [] }] })}><Plus size={14} />添加字段</Button></div>
    {form.fields.map((field, index) => <details className="fqc-nested" key={index} open={form.fields.length === 1 ? true : undefined}>
      <summary><Code2 size={15} /><strong>{field.name || field.id || `字段 ${index + 1}`}</strong><span>{field.type} · 偏移 {field.offset || "—"} · 长度 {field.length || "—"}</span><ChevronDown size={15} /></summary>
      <div className="fqc-nested-body"><div className="fqc-form-grid">
        <TextControl label="字段标识" value={field.id} onChange={id => setField(index, { id })} />
        <TextControl label="字段名称" value={field.name} onChange={name => setField(index, { name })} />
        <FormField label="解析类型"><select value={field.type} onChange={event => setField(index, { type: event.target.value as FactoryField["type"] })}>{fieldTypes.map(type => <option key={type} value={type}>{type} · {labels[type]}</option>)}</select></FormField>
        <TextControl label="偏移（从载荷起，字节）" numeric value={field.offset} onChange={offset => setField(index, { offset })} />
        <TextControl label="长度（字节）" numeric value={field.length} onChange={length => setField(index, { length })} />
        <FormField label="字节序"><select value={field.endian} onChange={event => setField(index, { endian: event.target.value })}><option value="">客户端缺省</option><option value="big">大端 big</option><option value="little">小端 little</option></select></FormField>
        <TextControl label="乘数 scale" numeric value={field.scale} onChange={scale => setField(index, { scale })} />
        <TextControl label="除数 divisor" numeric value={field.divisor} onChange={divisor => setField(index, { divisor })} />
        <TextControl label="偏移量 bias" numeric value={field.bias} onChange={bias => setField(index, { bias })} />
        <TextControl label="单位（不写入样本期望值）" value={field.unit} onChange={unit => setField(index, { unit })} />
        <TextControl label="显示前缀 prefix" value={field.prefix} onChange={prefix => setField(index, { prefix })} />
        <div className="fqc-field-note">换算依次应用乘数、除数和偏移量；发布时按客户端规则验证完整样本。</div>
        {field.type === "countedEnum" && <><TextControl label="数量偏移 countOffset" numeric value={field.countOffset} onChange={countOffset => setField(index, { countOffset })} /><TextControl label="最大数量 maxCount" numeric value={field.maxCount} onChange={maxCount => setField(index, { maxCount })} /></>}
      </div>
      {["enum", "bitset", "countedEnum"].includes(field.type) && <div className="fqc-mini-section"><strong>枚举字典</strong><p>{field.type === "bitset" ? "键为十进制位索引。" : "键为十进制原始值。"}标签须与样本显示结果一致。</p><PairEditor rows={field.enumValues} onChange={enumValues => setField(index, { enumValues })} label="字典项" keyLabel="原始值 / 位索引" valueLabel="显示标签" /></div>}
      <div className="fqc-mini-section"><strong>字段判定（可选）</strong><div className="fqc-form-grid"><TextControl label="最小值 min" numeric value={field.min} onChange={min => setField(index, { min })} /><TextControl label="最大值 max" numeric value={field.max} onChange={max => setField(index, { max })} /><TextControl label="等于 equals" numeric value={field.equals} onChange={equals => setField(index, { equals })} /></div></div>
      <Button variant="ghost" size="sm" className="fqc-danger" onClick={() => patch({ fields: form.fields.filter((_, i) => i !== index) })}><Trash2 size={14} />移除此字段</Button>
      </div>
    </details>)}
    <div className="fqc-subheading"><strong>完整帧样本 <span>{form.samples.length}</span></strong><Button variant="outline" size="sm" onClick={() => patch({ samples: [...form.samples, { frameHex: "", expected: form.fields.map(field => ({ key: field.id, value: "" })) }] })}><Plus size={14} />添加样本</Button></div>
    <p className="fqc-help">样本须包含帧头、长度校验、返回码与完整载荷；每个字段都要填写实际显示字符串。只做解析验证，不会向设备发送帧。</p>
    {form.samples.map((sample, index) => <details className="fqc-nested" key={index} open={form.samples.length === 1 ? true : undefined}><summary><FileJson size={15} /><strong>样本 {index + 1}</strong><span>{sample.frameHex.slice(0, 46) || "待填写完整帧"}</span><ChevronDown size={15} /></summary><div className="fqc-nested-body">
      <FormField label={`样本 ${index + 1} 完整帧 HEX`}><textarea className="fqc-code" rows={2} value={sample.frameHex} maxLength={20000} onChange={event => patch({ samples: form.samples.map((item, i) => i === index ? { ...item, frameHex: event.target.value } : item) })} /></FormField>
      <div className="fqc-mini-section"><strong>字段期望显示值</strong><PairEditor rows={sample.expected} onChange={expected => patch({ samples: form.samples.map((item, i) => i === index ? { ...item, expected } : item) })} label={`样本 ${index + 1} 期望值`} keyLabel="字段标识" valueLabel="显示字符串（含前缀、不含单位）" /></div>
      <Button variant="ghost" size="sm" className="fqc-danger" onClick={() => patch({ samples: form.samples.filter((_, i) => i !== index) })}><Trash2 size={14} />移除此样本</Button>
    </div></details>)}
  </fieldset>;
}

function ProtocolReviewNotes({ commandId }: { commandId: string }) {
  const notes = CURRENT_PROTOCOL_NOTES[commandId];
  if (!notes) return null;
  const historical = R5_PROTOCOL_NOTES[commandId];
  return <div className="fqc-review-notes" aria-label="v0.5.0 默认配置说明">
    <p className="fqc-help">以下说明对应 v0.5.0 默认配置。请与本项实际字段核对；载入建议后仍需保存、发布才会更新后台下载内容。</p>
    <div className="fqc-review-columns">
      {!!notes.confirmed.length && <div><strong><Check size={14} />当前配置与已确认行为</strong><ul>{notes.confirmed.map(note => <li key={note}>{note}</li>)}</ul></div>}
      {!!notes.pending.length && <div><strong><AlertCircle size={14} />仍待核实</strong><ul>{notes.pending.map(note => <li key={note}>{note}</li>)}</ul></div>}
    </div>
    {!!notes.sampleSources?.length && <div className="fqc-review-sources"><strong>样本依据</strong><ul>{notes.sampleSources.map(note => <li key={note}>{note}</li>)}</ul></div>}
    {historical && <details className="fqc-historical-notes"><summary>r5 历史说明（已由 v0.5.0 更新）</summary><p className="fqc-help">以下为原始审核说明，仅供追溯。78 停用、83 原始字节显示及断电比对流程以本页上方说明为准。</p><ul>{[...historical.confirmed, ...historical.pending].map(note => <li key={note}>{note}</li>)}</ul></details>}
  </div>;
}

function DownloadAddress({ kind, version }: { kind: FactoryQcKind; version?: string | null }) {
  const address = PRODUCTION_DOWNLOADS[kind];
  async function copy() {
    try { await navigator.clipboard.writeText(address); toast.success("配置下载地址已复制"); }
    catch { toast.error("未能自动复制，请选中地址后复制。"); }
  }
  return <div className="fqc-download-address" aria-label={`${kind === "serial" ? "连接参数" : "读取协议"}下载地址`}>
    <div className="fqc-download-caption"><strong>生产配置下载</strong><span className={`fqc-badge${version ? " fqc-badge--published" : ""}`}>{version ? "已发布 · 可下载" : "尚未发布 · 暂不可下载"}</span><span className="fqc-muted">无需鉴权 · 返回 JSON</span></div>
    <div className="fqc-download-control"><input aria-label={`${kind === "serial" ? "连接参数" : "读取协议"} HTTPS 地址`} readOnly value={address} onFocus={event => event.target.select()} /><Button variant="outline" size="sm" onClick={() => void copy()}><Copy size={14} />复制地址</Button></div>
    <p className="fqc-help">{version ? <>当前生效版本：<strong>{version}</strong>。客户端下次下载时获取此版本，重新连接设备后应用；此状态不代表工位已完成下载。</> : "当前没有生效版本。默认参考和草稿不会作为客户端下载内容。"}</p>
  </div>;
}

function Confirm({ value, busy, onClose, onConfirm }: { value: Confirmation | null; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <AlertDialog open={!!value} onOpenChange={open => { if (!open && !busy) onClose(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{value?.title}</AlertDialogTitle><AlertDialogDescription>{value?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><Button disabled={busy} onClick={onConfirm}>{busy && <Loader2 className="fqc-spin" size={15} />}确认</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function VersionHistory({ kind, state, api, disabled, onChange }: { kind: FactoryQcKind; state: FactoryQcManagementState; api: FactoryQcApi; disabled?: boolean; onChange: (state: FactoryQcManagementState) => void }) {
  const status = state[kind];
  const [version, setVersion] = useState<FactoryQcHistoryVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const rollbackIssues = kind === "protocol" && version ? protocolPublicationIssues(version.content as FactoryProtocolCatalog) : [];
  async function view(id: string) { setBusy(true); setError(""); try { setVersion(await api.getHistory(kind, id)); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  async function rollback() {
    if (!confirm || busy) return;
    setBusy(true); setError("");
    try { await confirm.action(); setConfirm(null); setVersion(null); toast.success("已恢复历史原版本与原始配置"); }
    catch (error) { setError(errorText(error)); setConfirm(null); }
    finally { setBusy(false); }
  }
  return <details className="fqc-history"><summary><History size={15} /><span>历史版本与回滚</span><span className="fqc-muted">{status.history.length} 个版本</span><ChevronDown size={14} /></summary>
    <div className="fqc-history-body">{!status.history.length ? <p className="fqc-help">首次发布后，这里会保留版本与原始 JSON。</p> : <div className="fqc-history-list">{status.history.map(entry => <div className="fqc-history-row" key={entry.version}><span><strong>{entry.version}</strong>{entry.version === status.active?.version && <span className="fqc-badge fqc-badge--published">当前版本</span>}<small>{formatTime(entry.publishedAt)} · {entry.publishedBy || "管理员"}</small><small>{entry.reason}</small></span><Button variant="outline" size="sm" disabled={busy} onClick={() => void view(entry.version)}>查看原 JSON</Button></div>)}</div>}
    {error && <div role="alert" className="fqc-error">{error}</div>}
    {version && <div className="fqc-version-detail"><div className="fqc-subheading"><strong>版本 {version.version}</strong><Button variant="ghost" size="sm" onClick={() => setVersion(null)}>收起</Button></div><pre tabIndex={0}>{pretty(version.content)}</pre>{!!rollbackIssues.length && <div className="fqc-publication-notice"><AlertCircle size={17} /><div><strong>此历史内容不能直接恢复为生效版本</strong><ul>{rollbackIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></div></div>}<div className="fqc-version-actions"><span>恢复历史原版本与原 JSON，保留现有历史记录。</span><Button variant="outline" size="sm" disabled={busy || disabled || version.version === status.active?.version || rollbackIssues.length > 0} onClick={() => setConfirm({ title: `回滚${kind === "protocol" ? "读取协议" : "连接参数"}？`, description: `将当前生效内容恢复为历史原版本 ${version.version}。${kind === "protocol" ? "现有目录及单项草稿保留，后续发布仍需核对版本。" : "12 项连接参数同步恢复，已有草稿保留。"}客户端下次下载时获取该历史版本的原始内容。`, action: async () => onChange(await api.rollback(kind, version.version, status.revision)) })}>恢复此原版本</Button></div></div>}
    </div><Confirm value={confirm} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => void rollback()} /></details>;
}

function LoadState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="fqc-load-state">{error ? <><AlertCircle size={23} /><strong>暂时无法读取配置</strong><p role="alert">{error}</p><Button variant="outline" onClick={onRetry}><RefreshCw size={15} />重新加载</Button></> : <><Loader2 className="fqc-spin" size={23} /><p>正在读取协议配置…</p></>}</div>;
}

export function FactoryQcProtocolPanel({ api = factoryQcApi, onDirtyChange }: { api?: FactoryQcApi; onDirtyChange?: (dirty: boolean) => void }) {
  const [state, setState] = useState<FactoryQcManagementState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [profileId, setProfileId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [json, setJson] = useState("");
  const [jsonBaseline, setJsonBaseline] = useState("");
  const [validated, setValidated] = useState<FactoryProtocolCatalog | null>(null);
  const [importError, setImportError] = useState("");
  const [importRevision, setImportRevision] = useState<number | null>(null);
  const epoch = useRef(0);
  const mutationBusy = useRef(false);
  const catalog = state?.protocol.active ?? state?.protocol.draft ?? FACTORY_PROTOCOL_DEFAULT;
  const selectedProfile = catalog.profiles.find(profile => profile.id === profileId) ?? catalog.profiles.find(profile => profile.id === CURRENT_PROFILE_ID) ?? catalog.profiles[0];
  const commandStates = useMemo(() => new Map(state?.protocol.commands.map(command => [keyOf(command.profileId, command.commandId), command]) ?? []), [state]);
  const dirtyKeys = useMemo(() => Object.keys(edits).filter(key => !equals(edits[key].form, edits[key].base)), [edits]);
  const importDirty = json !== jsonBaseline;
  const dirty = dirtyKeys.length > 0 || importDirty;
  const publicationIssues = state?.protocol.draft ? protocolPublicationIssues(state.protocol.draft) : [];
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const load = useCallback(async () => { const current = ++epoch.current; setLoadError(""); try { const next = await api.getState(); if (current === epoch.current) setState(next); } catch (error) { if (current === epoch.current) setLoadError(errorText(error)); } }, [api]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  const currentCommand = (command: FactoryCommand) => {
    const commandState = commandStates.get(keyOf(selectedProfile.id, command.id));
    return commandState?.draft ?? commandState?.active ?? command;
  };
  function edit(command: FactoryCommand, form: CommandForm) {
    const key = keyOf(selectedProfile.id, command.id);
    setEdits(previous => ({ ...previous, [key]: { ...(previous[key] ?? { base: toForm(currentCommand(command)), revision: commandStates.get(key)?.revision ?? 0 }), form } }));
    setRowErrors(previous => ({ ...previous, [key]: "" }));
  }
  async function perform(action: () => Promise<void>) {
    if (mutationBusy.current) return;
    mutationBusy.current = true; setBusy(true);
    try { await action(); } finally { mutationBusy.current = false; setBusy(false); }
  }
  async function save(command: FactoryCommand) {
    const key = keyOf(selectedProfile.id, command.id);
    await perform(async () => {
      try {
        const draft = fromForm(edits[key]?.form ?? toForm(currentCommand(command)), currentCommand(command));
        validateProtocolCatalog(replaceCommand(catalog, selectedProfile.id, draft));
        const next = await api.saveCommandDraft(selectedProfile.id, command.id, edits[key]?.revision ?? commandStates.get(key)?.revision ?? 0, draft);
        setState(next); setEdits(previous => { const result = { ...previous }; delete result[key]; return result; });
        if (!next.protocol.active && next.protocol.draft && !importDirty) {
          const updatedJson = pretty(next.protocol.draft);
          setJson(updatedJson); setJsonBaseline(updatedJson); setImportRevision(next.protocol.revision); setValidated(null);
        }
        setRowErrors(previous => ({ ...previous, [key]: "" })); setConflicts(previous => ({ ...previous, [key]: false })); toast.success(`${draft.name}：单项草稿已保存`);
      } catch (error) { setRowErrors(previous => ({ ...previous, [key]: errorText(error) })); setConflicts(previous => ({ ...previous, [key]: isConflict(error) })); }
    });
  }
  function publish(command: FactoryCommand) {
    const key = keyOf(selectedProfile.id, command.id), saved = commandStates.get(key);
    if (!saved?.draft || !state?.protocol.active) return;
    setConfirm({ title: `发布「${command.name}」读取配置？`, description: `只发布本项已保存草稿，其他读取项保留原生效配置。完整目录会生成新版本；解析校验不证明固件已适配，也不代表设备质检通过。${selectedProfile.id === CURRENT_PROFILE_ID && command.id === "pressure-check" && saved.draft.enabled !== false ? "78 的修正固件与旧前缀区分仍待实机证据确认；沿用主版本前缀不能证明设备已修正。" : ""}`, action: async () => {
      try { setState(await api.publishCommand(selectedProfile.id, command.id, saved.revision)); setRowErrors(previous => ({ ...previous, [key]: "" })); toast.success("本项读取配置已发布"); }
      catch (error) { setRowErrors(previous => ({ ...previous, [key]: errorText(error) })); setConflicts(previous => ({ ...previous, [key]: isConflict(error) })); }
    } });
  }
  function reloadItem(key: string) {
    setConfirm({ title: "重新加载这项配置？", description: "本项未保存的输入将被丢弃，其他项的输入会保留。", action: async () => { try { setState(await api.getState()); setEdits(previous => { const next = { ...previous }; delete next[key]; return next; }); setRowErrors(previous => ({ ...previous, [key]: "" })); setConflicts(previous => ({ ...previous, [key]: false })); } catch (error) { setRowErrors(previous => ({ ...previous, [key]: errorText(error) })); } } });
  }
  function startImport() {
    if (!importOpen && !importDirty) { const source = state?.protocol.draft ? pretty(state.protocol.draft) : ""; setJson(source); setJsonBaseline(source); setImportRevision(state?.protocol.revision ?? 0); setValidated(null); }
    setImportOpen(!importOpen);
  }
  function loadImportTemplate(kind: "current" | "historical") {
    const apply = async () => {
      if (!importOpen && !importDirty) {
        setJsonBaseline(state?.protocol.draft ? pretty(state.protocol.draft) : "");
        setImportRevision(state?.protocol.revision ?? 0);
      }
      setJson(pretty(kind === "current" ? FACTORY_PROTOCOL_DEFAULT : FACTORY_PROTOCOL_EXAMPLE));
      setValidated(null); setImportError(""); setImportOpen(true);
    };
    if (importDirty) setConfirm({ title: "替换未保存的目录输入？", description: `将目录编辑器中的未保存内容替换为${kind === "current" ? "v0.5.0 默认配置" : "历史 v2 格式参考"}。只填入本地编辑器，已保存草稿和当前生效目录保持不变。`, action: apply });
    else void apply();
  }
  function loadCommandSuggestion(command: FactoryCommand) {
    if (selectedProfile.id !== CURRENT_PROFILE_ID || !state?.protocol.active) return;
    const suggestion = FACTORY_PROTOCOL_DEFAULT.profiles.find(profile => profile.id === CURRENT_PROFILE_ID)?.commands.find(item => item.id === command.id);
    if (!suggestion) return;
    const key = keyOf(selectedProfile.id, command.id);
    setConfirm({ title: `载入「${command.name}」的 v0.5.0 默认配置？`, description: `将替换本项本地输入，包括字段、样本与自定义枚举${dirtyKeys.includes(key) ? "；本项尚未保存的修改将被放弃" : ""}。载入后仍需检查、保存并发布。${command.id === "pressure-check" ? "此建议停用 78，等待修正固件与回包验证。" : "配置中的待核实事项仍然保留，不会自动成为质检放行依据。"}`, action: async () => {
      setEdits(previous => ({ ...previous, [key]: { base: previous[key]?.base ?? toForm(currentCommand(command)), revision: previous[key]?.revision ?? commandStates.get(key)?.revision ?? 0, form: toForm(suggestion) } }));
      setRowErrors(previous => ({ ...previous, [key]: "" }));
    } });
  }
  function validateImport() { try { const result = validateProtocolCatalog(parseProtocolJson(json)); setValidated(result); setImportError(""); return result; } catch (error) { setValidated(null); setImportError(errorText(error)); return null; } }
  function discardImport() {
    setConfirm({ title: "放弃目录未保存修改？", description: "仅恢复到本次编辑前的目录内容。已保存的目录草稿会保留，不会被删除。", action: async () => {
      setJson(jsonBaseline); setValidated(null); setImportError(""); setImportOpen(false);
    } });
  }
  async function saveImport() {
    if (!validateImport() || !state) return;
    await perform(async () => { try { const next = await api.saveCatalogDraft(importRevision ?? state.protocol.revision, json); setState(next); setJsonBaseline(json); setImportRevision(next.protocol.revision); setImportError(""); toast.success("完整目录草稿已保存，尚未发布"); } catch (error) { setImportError(errorText(error)); } });
  }
  function publishImport() {
    if (!state?.protocol.draft || publicationIssues.length) return;
    setConfirm({ title: state.protocol.active ? "发布完整读取目录？" : "发布首个读取目录？", description: `将明确发布 ${state.protocol.draft.profiles.length} 个固件配置及其所有读取项。${state.protocol.active ? "这将更新整个目录；请先确认各固件与样本。" : "审核模板不会自动生效，请确认完整帧样本、字段解释和适用固件均已审核。"}解析校验不证明实机固件已修正，尤其不能凭旧主版本前缀认定 78 已适配。发布后客户端可下载此版本。`, action: async () => { try { const next = await api.publishCatalog(state.protocol.revision); setState(next); setJson(""); setJsonBaseline(""); setValidated(null); setImportRevision(next.protocol.revision); setImportError(""); toast.success("完整读取目录已发布"); } catch (error) { setImportError(errorText(error)); } } });
  }
  const shown = selectedProfile?.commands.filter(command => `${command.id} ${command.name} ${command.queryCode}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  if (!state) return <section className="factory-qc-panel"><LoadState error={loadError} onRetry={() => void load()} /></section>;
  return <section className="factory-qc-panel" aria-label="读取协议配置">
    <div className="fqc-notice"><Info size={18} /><div><strong>{state.protocol.active ? `已发布目录 ${state.protocol.active.version}` : state.protocol.draft ? `首版草稿 ${state.protocol.draft.version} · 尚未发布` : "v0.5.0 默认参考 · 尚未初始化"}</strong><p>v0.5.0 默认目录（{FACTORY_PROTOCOL_DEFAULT.version}）已同步当前客户端：73、78 停用；79 支持负温度；83 保留原始抹平字节。载入默认配置只修改本地输入，发布后才更新下载内容。</p>{catalog.version === R5_SOURCE.publishedExampleVersion && <p>当前显示的是历史 v2 配置。可载入 v0.5.0 默认配置核对后发布；现有自定义内容不会自动覆盖。</p>}<p>质检放行标准在「检测规则」维护，硬件写入动作在「返工指令」维护。配置解析通过不代表传感器有效或整机合格。</p></div></div>
    <DownloadAddress kind="protocol" version={state.protocol.active?.version} />
    <div className="fqc-panel-actions"><span className="fqc-help">协议下载最低客户端版本 {catalog.minAppVersion} · 建议使用 v0.5.0 或更新版本完成断电比对</span><div className="fqc-template-actions"><Button variant="outline" size="sm" disabled={busy} onClick={() => loadImportTemplate("current")}><FileJson size={15} />载入 v0.5.0 默认配置</Button><Button variant="outline" size="sm" onClick={startImport}>完整目录导入{state.protocol.draft && <span className="fqc-dot" />}</Button></div></div>
    {importOpen && <div className="fqc-import"><div className="fqc-subheading"><strong>完整目录导入与首版发布</strong><Button variant="ghost" size="sm" disabled={busy} onClick={() => loadImportTemplate("historical")}>载入历史 v2 格式参考</Button></div><p className="fqc-help">先验证完整 JSON 并保存草稿，再逐项审核字段和样本；首版完成审核后发布完整目录。已有单项未保存内容请先处理。</p>
      <p className="fqc-help">当前默认目录为 {FACTORY_PROTOCOL_DEFAULT.version}。历史 v2（{R5_SOURCE.publishedExampleVersion}）、r4 候选（{R5_SOURCE.historicalCandidateVersion}）及 r5 审核说明均仅用于追溯，不能替代当前默认配置。</p>
      <FormField label="完整目录 JSON"><textarea className="fqc-code fqc-import-json" rows={10} spellCheck={false} value={json} onChange={event => { setJson(event.target.value); setValidated(null); setImportError(""); }} /></FormField>
      {validated && <div className="fqc-validation"><Check size={16} /><span>结构与样本解析校验通过：{validated.profiles.length} 个固件配置，{validated.profiles.reduce((count, profile) => count + profile.commands.length, 0)} 项读取，目录版本 {validated.version}。这不代表目标固件已修正或质检通过。</span></div>}
      {importError && <div className="fqc-error" role="alert">{importError}<Button variant="ghost" size="sm" disabled={busy} onClick={() => void perform(async () => { try { const next = await api.getState(); setState(next); setImportRevision(next.protocol.revision); setImportError("已刷新版本，输入已保留。请核对最新目录后重新验证保存。"); } catch (error) { setImportError(errorText(error)); } })}>刷新版本并保留输入</Button></div>}
      {!!publicationIssues.length && <div className="fqc-publication-notice"><AlertCircle size={17} /><div><strong>已保存草稿暂不可发布</strong><ul>{publicationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></div></div>}
      <div className="fqc-editor-actions"><span>{importDirty ? "目录输入未保存" : state.protocol.draft ? "完整目录草稿已保存，未发布" : "模板不会自动生效"}</span><Button variant="ghost" size="sm" disabled={busy || !importDirty} onClick={discardImport}>放弃目录修改</Button><Button variant="outline" size="sm" disabled={busy || !json.trim()} onClick={validateImport}>校验目录</Button><Button variant="outline" size="sm" disabled={busy || !json.trim() || dirtyKeys.length > 0} onClick={() => void saveImport()}>保存目录草稿</Button><Button size="sm" disabled={busy || importDirty || !state.protocol.draft || dirtyKeys.length > 0 || publicationIssues.length > 0} onClick={publishImport}>发布完整目录</Button></div>
    </div>}
    <div className="fqc-list"><div className="fqc-list-toolbar"><div className="fqc-profiles" aria-label="固件配置">{catalog.profiles.map(profile => <button key={profile.id} aria-pressed={profile.id === selectedProfile?.id} onClick={() => { setProfileId(profile.id); setOpenId(null); setSearch(""); }}><strong>{profile.name}</strong><small>{profile.firmwarePrefix || "默认后备协议"}</small></button>)}</div><label className="fqc-search"><Search size={15} /><input aria-label="搜索读取项" placeholder="搜索名称、标识或查询码" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      {dirty && <p className="fqc-unsaved">{dirtyKeys.length > 0 ? `${dirtyKeys.length} 项读取配置未保存；切换固件或分类会保留输入。` : "目录导入内容未保存。"}</p>}
      {state.protocol.draft && <p className="fqc-help fqc-list-tip">{state.protocol.active ? "另有完整目录草稿；单项发布后，完整目录草稿需重新核对再保存发布。" : "首版草稿已保存，可在下方逐项编辑并独立保存；暂不下发，首版必须发布完整目录。"}</p>}
      <div className="fqc-column-head"><span>读取项</span><span>查询 → 返回</span><span>解析与样本</span><span>状态</span><span>操作</span></div>
      {shown.map(command => { const key = keyOf(selectedProfile.id, command.id), saved = commandStates.get(key), form = edits[key]?.form ?? toForm(currentCommand(command)), itemDirty = dirtyKeys.includes(key), open = openId === command.id; const status = itemDirty ? "未保存" : saved?.draft ? "草稿待发布" : saved?.active ? (saved.active.enabled === false ? "已发布 · 停用" : "已发布") : "默认参考 · 未发布";
        return <article className={`fqc-command${open ? " fqc-command--open" : ""}`} key={key}><div className="fqc-command-row"><button className="fqc-command-name" onClick={() => setOpenId(open ? null : command.id)} aria-expanded={open}><strong>{form.name}</strong><small>{command.id}</small></button><span className="fqc-code">{form.queryCode} → {form.responseCode}</span><span>{form.fields.length} 字段 · {form.samples.length} 样本</span><span className={`fqc-badge${saved?.active && !saved.draft && !itemDirty ? " fqc-badge--published" : ""}`}>{status}</span><button className="fqc-configure" onClick={() => setOpenId(open ? null : command.id)} aria-label={`${open ? "收起" : "配置"}${command.name}`}>{open ? "收起" : "配置"}{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></div>
          {open && <div className="fqc-inline">{selectedProfile.id === CURRENT_PROFILE_ID && <ProtocolReviewNotes commandId={command.id} />}
            {state.protocol.active && selectedProfile.id === CURRENT_PROFILE_ID && FACTORY_PROTOCOL_DEFAULT.profiles.find(profile => profile.id === CURRENT_PROFILE_ID)?.commands.some(item => item.id === command.id) && <div className="fqc-suggestion-action"><span>默认配置会替换本项字段与样本；请核对已有自定义配置。</span><Button variant="outline" size="sm" disabled={busy} onClick={() => loadCommandSuggestion(command)}>载入 v0.5.0 本项默认</Button></div>}
            <CommandEditor form={form} onChange={value => edit(command, value)} disabled={busy || (!state.protocol.active && !state.protocol.draft)} />
            {rowErrors[key] && <div className="fqc-error" role="alert">{rowErrors[key]}{conflicts[key] && <Button variant="ghost" size="sm" onClick={() => reloadItem(key)}>重新加载本项</Button>}</div>}
            <div className="fqc-editor-actions"><span>{!state.protocol.active ? state.protocol.draft ? "本项单独保存到首版草稿；审核完成后统一发布完整目录。" : "只读审核：先载入并保存目录草稿，即可逐项编辑。" : saved?.active ? "保存草稿不会改变当前生效版本。" : "该项尚无已发布配置。"}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => { if (itemDirty) setConfirm({ title: "放弃本项未保存修改？", description: "本项输入将恢复到已保存内容，其他读取项保持不变。", action: async () => { setEdits(previous => { const next = { ...previous }; delete next[key]; return next; }); setOpenId(null); } }); else setOpenId(null); }}>取消</Button><Button variant="outline" size="sm" disabled={busy || (!state.protocol.active && !state.protocol.draft)} onClick={() => void save(command)}>保存本项草稿</Button><Button size="sm" disabled={busy || itemDirty || !saved?.draft || !state.protocol.active} onClick={() => publish(command)}>发布本项</Button></div>
          </div>}
        </article>;
      })}
      {!shown.length && <p className="fqc-empty">没有匹配的读取项。<button onClick={() => setSearch("")}>清空搜索</button></p>}
    </div>
    <VersionHistory kind="protocol" state={state} api={api} disabled={dirty || busy} onChange={next => { setState(next); setEdits({}); }} />
    <Confirm value={confirm} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => void perform(async () => { if (confirm) { await confirm.action(); setConfirm(null); } })} />
  </section>;
}

export function FactoryQcConnectionStatus({ api = factoryQcApi, refreshKey, onChanged }: { api?: FactoryQcApi; refreshKey?: number; onChanged?: () => void }) {
  const [state, setState] = useState<FactoryQcManagementState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setError(""); try { setState(await api.getState()); } catch (error) { setError(errorText(error)); } }, [api]);
  useEffect(() => { let active = true; setError(""); api.getState().then(next => { if (active) setState(next); }, error => { if (active) setError(errorText(error)); }); return () => { active = false; }; }, [api, refreshKey]);
  if (!state) return <section className="factory-qc-panel"><LoadState error={error} onRetry={() => void load()} /></section>;
  return <section className="factory-qc-panel fqc-connection-status" aria-label="连接参数发布状态"><div className="fqc-notice"><Info size={18} /><div><strong>连接参数 {state.serial.readyCount} / {state.serial.totalCount} 项已发布就绪</strong><p>{state.serial.readyCount === state.serial.totalCount && state.serial.active ? "全部连接项已就绪，当前生效配置可供客户端下载。" : "完成全部连接项的独立发布后，才能生成新的完整串口配置；已有生效版本继续保留。"}</p></div><Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw size={14} />刷新</Button></div><DownloadAddress kind="serial" version={state.serial.active?.version} />{error && <div className="fqc-error" role="alert">{error}</div>}<VersionHistory kind="serial" state={state} api={api} onChange={next => { setState(next); onChanged?.(); }} /></section>;
}
