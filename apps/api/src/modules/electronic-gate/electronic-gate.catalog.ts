export type GateCategory = 'critical' | 'routine' | 'manual' | 'connection' | 'command';
export type FieldDef = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  precision?: number;
  allowNegative?: boolean;
};
export type GateConfig = {
  enabled: boolean;
  model: string;
  market: string;
  displayName: string;
  helpText: string;
  values: Record<string, string>;
  failureAction: 'block' | 'warn';
};
export type GateItem = {
  id: string;
  number: string;
  title: string;
  category: GateCategory;
  description: string;
  fields: FieldDef[];
  defaults: GateConfig;
  draft: GateConfig | null;
  active: GateConfig | null;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
};
export type GateDefinition = Pick<GateItem, 'id' | 'number' | 'title' | 'category' | 'description' | 'fields' | 'defaults'>;

const text = (key: string, label: string, help?: string): FieldDef => ({ key, label, type: 'text', required: true, help });
const number = (key: string, label: string, unit?: string): FieldDef => ({ key, label, type: 'number', required: true, unit });
const area = (key: string, label: string, help?: string): FieldDef => ({ key, label, type: 'textarea', required: true, help });
const select = (key: string, label: string, options: Array<[string, string]>): FieldDef => ({
  key, label, type: 'select', required: true, options: options.map(([value, label]) => ({ value, label })),
});
const evidence = area('evidence', '配置依据', '填写已确认的工艺文件、规范编号或验证记录；截图中的参考值不代表已批准标准。');
const source = text('readbackSource', '读取与验证依据', '填写目标固件的协议字段、寄存器与实机回读证据；字段来源提示可按已确认的新证据调整，持久保存需记录对应验证过程。');
const sourceWithHelp = (help: string): FieldDef => ({ ...source, help });
const equality = (label = '期望值'): FieldDef[] => [select('operator', '判定方式', [['equals', '等于']]), text('expected', label), source];
const allowed = (label: string): FieldDef[] => [select('operator', '判定方式', [['allowlist', '属于允许清单']]), area('allowedValues', label, '每行填写一个完整值，按完整值匹配。'), source];
const range = (unit?: string, allowNegative = false): FieldDef[] => [
  select('operator', '判定方式', [['range', '数值范围']]),
  { ...number('minimum', '下限', unit), ...(allowNegative ? { allowNegative: true } : {}) },
  { ...number('maximum', '上限', unit), ...(allowNegative ? { allowNegative: true } : {}) },
  select('boundary', '边界包含方式', [['inclusive', '包含上下限'], ['exclusive', '不包含上下限']]), source,
];

function definition(
  id: string, no: string, title: string, category: GateCategory, description: string,
  fields: FieldDef[], referenceValues: Record<string, string> = {},
): GateDefinition {
  const allFields = [...fields, category === 'connection' ? { ...evidence, required: false, help: '可选：记录串口规格或参数变更依据。' } : evidence];
  return {
    id, number: no, title, category, description, fields: allFields,
    defaults: {
      enabled: true, model: '', market: '', displayName: title, helpText: description,
      failureAction: 'block',
      values: Object.fromEntries(allFields.map((field) => [field.key, referenceValues[field.key] ?? ''])),
    },
  };
}

const checks: GateDefinition[] = [
  definition('startup-pressure', '22', '开机基础大气压', 'critical', '开机状态基线，独立采集；当前大气压不能自动作为开机基线。', range('kPa')),
  definition('debug-status', '06', 'Debug 状态', 'critical', '确认调试模式已关闭，协议字段与关闭值待确认。', equality('关闭状态字段值')),
  definition('alarm-status', '08', '异常报警', 'critical', '77 返回当前活动报警的数量与编号列表，当前最多 23 条；底层清除后下次查询消失。零报警不等于传感器数据有效或整机合格。', [...equality('允许的活动报警结果').slice(0, -1), sourceWithHelp('77：数量与编号列表；同帧不重复由固件保证，当前解析器不校验唯一性。依据目标固件的完整回包填写，不将历史报警或零报警当作完整质检结论。')]),
  definition('sensor-pressure', '09', '压力传感器数值', 'critical', '配置对应运行档位的压力范围。', [text('gear', '适用运行档位'), ...range('kPa')]),
  definition('internal-temperature', '10', '机器内部温度', 'critical', '允许温度范围由工艺标准确认。', range('°C', true)),
  definition('fan-status', '11', '风扇状态', 'critical', '7A 返回风扇实际反馈比例，非控制目标或 RPM；约 0～100 的描述不能直接作为合格阈值。', [text('feedbackMethod', '反馈方式', '已确认 7A 为实际反馈比例；如采用其他反馈来源，请提供对应固件与验证依据。'), ...equality('正常反馈值')]),
  definition('compressor-speed', '12', '压缩机实际转速', 'critical', '配置对应运行档位的转速范围。', [text('gear', '适用运行档位'), ...range('rpm')]),
  definition('compressor-recovery', '13', '压缩机停转 / 恢复', 'critical', '分别确认停转状态、恢复状态与观察窗口。', [text('stoppedValue', '停转状态值'), text('recoveredValue', '恢复状态值'), number('observationMs', '观察窗口', 'ms'), source]),
  definition('v-pressure', '14', '微压实时差值平均值', 'critical', '7D 为有符号 16 位微压实时差值平均值，允许负数；字节序、工程单位与换算仍需目标固件负值回包核对，合格范围不预设。', [text('measurementUnit', '测量单位', '工程单位尚未确认，请依据目标固件证据填写，不默认使用 kPa。'), ...range(undefined, true).slice(0, -1), sourceWithHelp('已确认来源为 7D、有符号 16 位补码；请补充目标固件、负值完整应答、字节序和工程换算依据，后续可按新证据调整。')]),
  definition('v-pressure-temperature', '15', 'V 压传感器温度', 'critical', '截图中的 57 °C 边界尚待确认，不预设为合格阈值。', range('°C', true)),
  definition('default-sensitivity', '16', '出厂灵敏度设置', 'critical', '目标 3 级已确认；7F 直接读取 EEPROM 灵敏度设置。该设置可修改，修改后需结合完全断电、重新上电回读验证保存。', [select('operator', '判定方式', [['equals', '等于']]), number('expected', '目标灵敏度（EEPROM）', '级'), sourceWithHelp('7F 直接回读 EEPROM；记录目标固件、设置值与修改后完全断电再上电的验证证据。可按已确认的新来源调整，不能把一次读数等同于完整保存验证。')], { expected: '3', operator: 'equals' }),
  definition('device-model', '01', '机器型号', 'routine', '配置允许型号与真实读取来源。', allowed('允许的机器型号')),
  definition('shipping-market', '02', '发货市场 / 区域', 'routine', '配置允许发货市场与区域编码。', allowed('允许的市场 / 区域编码')),
  definition('firmware-version', '03', '固件完整版本', 'routine', '按完整固件版本清单匹配，不使用模糊版本比较。', allowed('允许的固件完整版本')),
  definition('built-in-parameters', '04', '内置参数', 'routine', '73 为预留命令，当前未开发、无有效回包；310 时间、210 时间与压缩机转速的规则可保留草稿，不能据此声称已完成设备回读。', [number('time310', '310 时间'), text('time310Unit', '310 时间单位'), number('time210', '210 时间'), text('time210Unit', '210 时间单位'), number('compressorRpm', '压缩机转速', 'rpm'), sourceWithHelp('73 当前无有效读取协议；如后续固件实现或采用其他已确认来源，请填写该版本的完整字段布局和真实回包证据。')]),
  definition('valve-type', '05', '阀类型', 'routine', '配置目标机型允许的阀类型。', allowed('允许的阀类型')),
  definition('total-usage', '07', '总使用时长', 'routine', '配置累计使用时长上限，包含边界。', [select('operator', '判定方式', [['lte', '小于或等于']]), number('maximum', '累计时长上限', 'h'), source]),
  definition('button-volume', '17', '按键音量等级', 'routine', '80 直接读取 EEPROM 音量设置；合法等级仍待确认，不预填目标或允许范围。修改后的掉电保存需验证。', [select('operator', '判定方式', [['equals', '等于']]), number('expected', '目标音量等级（EEPROM）'), sourceWithHelp('80 直接回读 EEPROM；合法音量等级需产品标准确认，并记录修改后完全断电再上电的回读证据。')]),
  definition('default-gear', '18', '发货档位与保存验证', 'routine', '目标 3 档已确认；86 读取 RAM 当前档位。设置有 EEPROM 掉电保存机制，但单次 86=3 不证明保存成功，需完全断电、重新上电后回读。', [select('operator', '判定方式', [['equals', '等于']]), number('expected', '断电重启后目标档位', '档'), sourceWithHelp('当前 86 读取 RAM；记录修改、完全断电、重新上电后的回读证据。86 改为 EEPROM 直读尚属建议，只有获得新固件确认后才能调整来源说明。')], { expected: '3', operator: 'equals' }),
  definition('fpga-version', '19', 'FPGA 版本', 'routine', '以已确认版本清单判定。', allowed('允许的 FPGA 版本')),
  definition('calibration-230', '20', '230 状态', 'routine', '83 首字节为 230 标志：0 未完成 / 基线不可用，1 已完成；后两字节为 230 抹平值，其类型、单位、换算及完整有效性仍待确认。', [...equality('完成标志期望值（0 未完成 / 1 已完成）').slice(0, -1), sourceWithHelp('83 首字节为完成标志，后两字节为抹平值；清除对应校准数据后标志回到 0。填写目标固件与回包证据，不以完成标志单独证明校准数据完整有效。')]),
  definition('calibration-232', '21', '232 状态', 'routine', '84 为 232 标志：0 未完成，1 已完成；清除对应校准数据后回到 0。完整持久与失效条件仍需核实。', [...equality('完成标志期望值（0 未完成 / 1 已完成）').slice(0, -1), sourceWithHelp('84 回读 232 完成标志；记录目标固件、校准及清除后的回包证据，持久与失效条件按已确认资料补充。'), text('validityRule', '完成标志有效性规则', '请填写已确认的持久、失效及复测条件；0/1 状态含义不能替代完整有效性标准。')]),
];

const manualTitles = ['实体按键回弹正常', '各档位无共振异常抖动', '屏幕无花屏等异常', '风扇旋转正常', '鼻氧管吸气灵敏度正常'];
const manual = manualTitles.map((title, index) => definition(
  `manual-${index + 1}`, `M${String(index + 1).padStart(2, '0')}`, title, 'manual', '由操作员按明确标准逐项确认。',
  [area('confirmationText', '人工确认标准'), select('proofRequirement', '确认凭证', [['operator', '记录确认人和时间'], ['note', '同时填写确认说明']])],
));

const connection = [
  definition('serial-port', 'C01', '设备串口', 'connection', '自动发现唯一候选端口；多端口工位应指定实际 COM 名称。', [select('mode', '串口选择方式', [['auto', '自动发现'], ['fixed', '固定串口']]), { key: 'port', label: '固定串口名称', type: 'text', help: '固定串口时填写实际端口，例如 COM3。' }], { mode: 'auto' }),
  definition('baud-rate', 'C02', '串口波特率', 'connection', '客户端默认 115200；取值须同时被设备与串口驱动支持。', [{ ...number('baudRate', '波特率'), min: 300, max: 3000000, integer: true }], { baudRate: '115200' }),
  definition('response-timeout', 'C03', '响应超时', 'connection', '单条查询的完整响应等待时间，客户端默认 1500 毫秒。', [{ ...number('timeoutMs', '完整有效响应超时', 'ms'), min: 100, max: 10000, integer: true }], { timeoutMs: '1500' }),
  definition('retry-delay', 'C04', '重试间隔', 'connection', '连接失败后等待重试；后台按毫秒下发，客户端默认 5 秒。', [{ ...number('retrySeconds', '失败后重试间隔', 's'), min: 1, max: 300, precision: 3 }], { retrySeconds: '5' }),
  definition('data-bits', 'C05', '串口数据位', 'connection', '客户端默认 8 位。', [select('dataBits', '数据位', [['5', '5'], ['6', '6'], ['7', '7'], ['8', '8']])], { dataBits: '8' }),
  definition('serial-parity', 'C06', '串口校验', 'connection', '客户端默认无校验。', [select('parity', '校验方式', [['none', '无校验'], ['even', '偶校验'], ['odd', '奇校验'], ['mark', '标记校验'], ['space', '空格校验']])], { parity: 'none' }),
  definition('stop-bits', 'C07', '串口停止位', 'connection', '客户端默认 1 位；后台使用客户端约定的枚举名称下发。', [select('stopBits', '停止位', [['1', '1'], ['1.5', '1.5'], ['2', '2']])], { stopBits: '1' }),
  definition('auto-connect', 'C08', '自动连接', 'connection', '插入设备后自动连接并读取；主动断开后的恢复由工位控制。', [select('autoConnect', '自动连接', [['true', '开启'], ['false', '关闭']])], { autoConnect: 'true' }),
  definition('serial-handshake', 'C09', '串口流控制', 'connection', '客户端默认无流控制，请按设备与驱动要求设置。', [select('handshake', '流控制', [['None', '无'], ['XOnXOff', 'XOn / XOff'], ['RequestToSend', 'RTS / CTS'], ['RequestToSendXOnXOff', 'RTS / CTS 与 XOn / XOff']])], { handshake: 'None' }),
  definition('serial-dtr', 'C10', 'DTR 信号', 'connection', '数据终端就绪信号，客户端默认开启。', [select('dtrEnable', 'DTR', [['true', '开启'], ['false', '关闭']])], { dtrEnable: 'true' }),
  definition('serial-rts', 'C11', 'RTS 信号', 'connection', '请求发送信号，客户端默认关闭。', [select('rtsEnable', 'RTS', [['true', '开启'], ['false', '关闭']])], { rtsEnable: 'false' }),
  definition('scan-interval', 'C12', '串口扫描间隔', 'connection', '本机端口发现的扫描间隔，与后台配置同步周期不同。', [{ ...number('scanIntervalMs', '串口扫描间隔', 'ms'), min: 250, max: 60000, integer: true }], { scanIntervalMs: '1000' }),
];

const commandTitles: Array<[string, string]> = [
  ['关闭 Debug', '06'], ['清除异常报警', '08'], ['压力传感器校零', '09'], ['风扇 10% / 100% 测试', '11'],
  ['执行 230 校准', '20'], ['执行 232 校准', '21'], ['写入机型参数组', '04'], ['设置默认灵敏度', '16'],
  ['设置发货档位', '18'], ['按键音量设置', '17'],
];
const commands = commandTitles.map(([title, checkNo], index) => definition(
  `command-${index + 1}`, `A${String(index + 1).padStart(2, '0')}`, title, 'command', `对应检测项 ${checkNo}；此处只维护指令配置，不发送或执行硬件动作。`,
  [text('protocolCommand', '协议指令标识'), area('parameters', '指令参数说明', '按已确认协议填写具体参数；无参数时明确填写“无参数”。'), area('confirmationText', '执行前确认文案'), text('readbackSource', '执行后回读依据'), text('retestItem', '完成后复测项')],
  { retestItem: checkNo },
));

export const GATE_DEFINITIONS: GateDefinition[] = [...checks, ...manual, ...connection, ...commands];
export const GATE_SETTING_PREFIX = 'electronic-gate.item.';
export const GATE_SETTING_CATEGORY = 'electronic-gate';
