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
const optional = (field: FieldDef): FieldDef => ({ ...field, required: false });
const equality = (label = '期望值'): FieldDef[] => [select('operator', '判定方式', [['equals', '等于']]), text('expected', label), source];
const allowed = (label: string): FieldDef[] => [select('operator', '判定方式', [['allowlist', '属于允许清单']]), area('allowedValues', label, '每行填写一个完整值，按完整值匹配。'), source];
const displayOrAllowed = (label: string): FieldDef[] => [
  select('operator', '判定方式', [['display', '仅显示（旧规则）'], ['allowlist', '属于允许清单'], ['present', '有效读取即通过']]),
  optional(area('allowedValues', label, '选择属于允许清单时必填，每行一个完整值；仅显示时不进行清单比较。')), source,
];
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
  const isCheck = category === 'critical' || category === 'routine';
  const approval = optional(select('approval', '单项条件确认状态', [['tentative', '暂定：只作参考比较'], ['confirmed', '已确认单项条件']]));
  const allFields = [...fields, ...(isCheck ? [approval] : []), category === 'connection' ? { ...evidence, required: false, help: '可选：记录串口规格或参数变更依据。' } : evidence];
  return {
    id, number: no, title, category, description, fields: allFields,
    defaults: {
      enabled: id !== 'startup-pressure', model: '', market: '', displayName: title, helpText: description,
      failureAction: 'block',
      values: Object.fromEntries(allFields.map((field) => [field.key, referenceValues[field.key] ?? (field.key === 'approval' ? (CONFIRMED_MAIN_SHEET_CHECKS.has(id) ? 'confirmed' : 'tentative') : '')])),
    },
  };
}

const CONFIRMED_MAIN_SHEET_CHECKS = new Set(['debug-status', 'device-model', 'shipping-market', 'firmware-version', 'valve-type', 'fpga-version', 'compressor-speed', 'alarm-status', 'sensor-pressure', 'internal-temperature', 'fan-status', 'compressor-recovery', 'v-pressure', 'v-pressure-temperature', 'default-sensitivity', 'total-usage', 'button-volume', 'default-gear', 'calibration-230', 'calibration-232', 'current-pressure']);

const checks: GateDefinition[] = [
  definition('startup-pressure', '22', '开机基础大气压', 'critical', '仅兼容历史配置，新模板默认停用；当前检测使用第 23 项当前大气压。85 不能作为独立开机基线的采集证据。', range('kPa')),
  definition('current-pressure', '23', '当前大气压', 'critical', '85 为当前环境大气压，主表明确 98～105 kPa，包含上下限；当前检测使用本项，不将其追溯为独立开机基线。', range('kPa'), { operator: 'range', minimum: '98', maximum: '105', boundary: 'inclusive', approval: 'confirmed' }),
  definition('debug-status', '06', 'Debug 状态', 'critical', '75：00为正常模式，01为调试模式；出货检测实测0为PASS、实测1为NG，适用于所有机型。', equality('正常模式字段值'), { operator: 'equals', expected: '0', approval: 'confirmed', readbackSource: '75：00为正常模式，01为调试模式；串口查询命令表_0910-1.xlsx 命令表_整理!C10', evidence: '串口查询命令表_0910-1.xlsx 命令表_整理!D10；用户明确确认出货检测实测0为PASS、实测1为NG，作为全机型正式标准' }),
  definition('alarm-status', '08', '异常报警', 'critical', '77 返回当前活动报警的数量与编号列表，当前最多 23 条；底层清除后下次查询消失。零报警不等于传感器数据有效或整机合格。', [...equality('允许的活动报警结果').slice(0, -1), sourceWithHelp('77：数量与编号列表；同帧不重复由固件保证，当前解析器不校验唯一性。依据目标固件的完整回包填写，不将历史报警或零报警当作完整质检结论。')], { operator: 'equals', expected: '0' }),
  definition('sensor-pressure', '09', '压力传感器数值', 'critical', "喷气 1 分钟后，状态00有效时，按同次当前档位比较压力PASS范围，包含上下限；低于下限或高于上限为NG，不减8或换算。状态01等待重读，02为NG。适用所有机型，A档沿用6档200～300kPa；单次读值不证明喷气时长。", [select('operator', '判定方式', [['range', '固定范围（旧规则）'], ['gear-upper', '按档位压力上限（旧规则）'], ['gear-range', '按档位压力范围']]), optional(text('gear', '旧固定范围适用档位')), optional(number('minimum', '旧固定范围下限', 'kPa')), optional(number('maximum', '旧固定范围上限', 'kPa')), select('boundary', '边界包含方式', [['inclusive', '包含边界'], ['exclusive', '不包含边界'], ['unconfirmed', '等于边界时待判定']]), optional(area('gearUpperBounds', '旧各档压力上限 JSON', '旧上限模式使用 gear、maximum 和可选 models；切换到压力范围时须清空此字段。')), optional(area('gearRanges', '各档压力范围 JSON', '数组项为 gear、minimum、maximum，可选 models 非空精确型号数组；gear 为 0～7，上下限为 0～65535 有限数值，下限不能高于上限。同档机型范围不可重叠；此模式须清空旧档位、固定上下限和档位上限字段。')), source], {"operator":"gear-range","gearRanges":"[{\"gear\":0,\"minimum\":200,\"maximum\":300},{\"gear\":1,\"minimum\":120,\"maximum\":175},{\"gear\":2,\"minimum\":135,\"maximum\":205},{\"gear\":3,\"minimum\":140,\"maximum\":240},{\"gear\":4,\"minimum\":160,\"maximum\":270},{\"gear\":5,\"minimum\":180,\"maximum\":285},{\"gear\":6,\"minimum\":200,\"maximum\":300},{\"gear\":7,\"minimum\":210,\"maximum\":305}]","boundary":"inclusive","approval":"confirmed","readbackSource":"串口查询命令表_0910-1.xlsx 命令表_整理!C13；同次7B运行档位与86核对","evidence":"用户2026-09-11最新更新压力PASS区间：1档120～175、2档135～205、3档140～240、4档160～270、5档180～285、6档200～300、S档210～305kPa；沿用已确认的上下限均包含、所有机型和A档使用6档范围。"}),
  definition('internal-temperature', '10', '机器内部温度', 'critical', '新版 79 状态 00 有效时按 15～55 °C 比较；01 待测量、02 传感器异常，不使用其数值判通过。', range('°C', true), { operator: 'range', minimum: '15', maximum: '55', boundary: 'inclusive' }),
  definition('fan-status', '11', '风扇实际反馈比例', 'critical', '7A 按反馈比例大于 0 且不超过 100% 判断；返回整数 1～100 为 PASS，0 或超过 100 为 NG。本项不等于 10%/100% 两阶段测试通过。旧等值配置继续兼容。', [text('feedbackMethod', '反馈方式'), select('operator', '判定方式', [['range', '反馈比例范围'], ['equals', '等于（旧规则）']]), optional(text('expected', '旧版正常反馈值（兼容）')), ...range('%').slice(1, -1).map(optional), source], { operator: 'range', minimum: '1', maximum: '100', boundary: 'inclusive', feedbackMethod: '反馈比例' }),
  definition('compressor-speed', '12', '压缩机实际转速', 'critical', '新版按 73 同档位当前设定转速与 7B 实际转速比较；误差不超过 15% 为 PASS，否则 NG。旧固定范围配置继续兼容。', [select('operator', '判定方式', [['relative', '相对同档设定转速'], ['range', '固定转速范围（旧规则）']]), optional(text('gear', '限定档位（可选）')), optional({ ...number('tolerancePercent', '允许误差', '%'), min: 0, max: 100 }), optional(select('targetSource', '目标来源', [['parameters', '73 同档位设定转速']])), ...range('rpm').slice(1, -1).map(optional), source], { operator: 'relative', tolerancePercent: '15', targetSource: 'parameters', approval: 'confirmed' }),
  definition('compressor-recovery', '13', '压缩机异常自动重启次数', 'critical', '7C 为压缩机异常自动重启计数，按主表规定当前返回次数不超过 3 比较。新计数规则须清空旧停转/恢复字段。', [optional(select('operator', '判定方式', [['lte', '小于或等于']])), optional({ ...number('maximum', '重启次数上限', '次'), integer: true, max: 65535 }), optional(text('stoppedValue', '旧版停转状态值（兼容）')), optional(text('recoveredValue', '旧版恢复状态值（兼容）')), optional(number('observationMs', '旧版观察窗口（兼容）', 'ms')), source], { operator: 'lte', maximum: '3', approval: 'confirmed' }),
  definition('v-pressure', '14', '微压实时差值平均值', 'critical', '新版 7D 已明确为大端 int16 原始值，无物理单位；按原始值 16～38 比较，不标作 Pa/kPa。旧工程单位规则保留。', [text('measurementUnit', '测量单位', '填写 raw 表示无单位原始值；旧规则可保留已确认的工程单位。'), ...range(undefined, true).slice(0, -1), sourceWithHelp('新版 7D：有符号 16 位大端原始值；原始值比较不再要求物理量换算。')], { operator: 'range', minimum: '16', maximum: '38', boundary: 'inclusive', measurementUnit: 'raw' }),
  definition('v-pressure-temperature', '15', 'V 压传感器温度', 'critical', '新版表明确 10～57 °C，包含上下限；稳定采样流程仍需按工艺执行。', range('°C', true), { operator: 'range', minimum: '10', maximum: '57', boundary: 'inclusive' }),
  definition('default-sensitivity', '16', '出厂灵敏度设置', 'critical', '目标 3 级已确认；7F 直接读取 EEPROM 灵敏度设置。该设置可修改，修改后需结合完全断电、重新上电回读验证保存。', [select('operator', '判定方式', [['equals', '等于']]), number('expected', '目标灵敏度（EEPROM）', '级'), sourceWithHelp('7F 直接回读 EEPROM；记录目标固件、设置值与修改后完全断电再上电的验证证据。可按已确认的新来源调整，不能把一次读数等同于完整保存验证。')], { expected: '3', operator: 'equals' }),
  definition('device-model', '01', '机器型号', 'routine', "有效读取到型号、市场或完整固件版本即判 PASS；读取失败、空值及无法识别值不判通过。", displayOrAllowed('允许的机器型号'), {"operator":"present","readbackSource":"串口查询命令表_0910.xlsx 命令表_整理!C5","evidence":"串口查询命令表_0910.xlsx 命令表_整理!D5","approval":"confirmed"}),
  definition('shipping-market', '02', '发货市场 / 区域', 'routine', "有效读取到型号、市场或完整固件版本即判 PASS；读取失败、空值及无法识别值不判通过。", displayOrAllowed('允许的市场 / 区域编码'), {"operator":"present","readbackSource":"串口查询命令表_0910.xlsx 命令表_整理!C6","evidence":"串口查询命令表_0910.xlsx 命令表_整理!D6","approval":"confirmed"}),
  definition('firmware-version', '03', '固件完整版本', 'routine', "有效读取到型号、市场或完整固件版本即判 PASS；读取失败、空值及无法识别值不判通过。", displayOrAllowed('允许的固件完整版本'), {"operator":"present","readbackSource":"串口查询命令表_0910.xlsx 命令表_整理!C7","evidence":"串口查询命令表_0910.xlsx 命令表_整理!D7","approval":"confirmed"}),
  definition('built-in-parameters', '04', '当前实际生效参数', 'routine', '新版73返回当前生效参数；按型号、阀类型、方案及性能级匹配开放档标准，固定档列表即已开放档，不补造未列档数值。旧八槽及更早参数字段继续兼容；切换模式须清空冲突字段。', [optional(select('operator', '判定方式', [['slots', '旧八槽比较'], ['profile-slots', '按型号与阀类型方案比较']])), optional(select('parameterPlan', '参数方案', [['shipping', '出货方案'], ['fixed-mac', '固定 MAC 方案']])), optional(select('performanceClass', '性能级', [['A', 'A级']])), optional(area('parameterProfiles', '型号与阀类型参数方案 JSON', '数组项为 models、valveType、plan、performanceClass、slots；models为非空精确型号数组，valveType为0或1，plan为shipping/fixed-mac，性能级为A。每方案slots含1～8个唯一开放档，gear为0～7，speed/duration为0～65535整数。方案匹配范围不可重叠。')), optional(area('parameterSlots', '旧8槽标准参数 JSON', '旧模式须含完整0～7八槽；enabled可选布尔值。型号方案模式须清空此字段。')), ...[number('time310', '旧版310时间（兼容）'), text('time310Unit', '旧版310时间单位（兼容）'), number('time210', '旧版210时间（兼容）'), text('time210Unit', '旧版210时间单位（兼容）'), number('compressorRpm', '旧版压缩机转速（兼容）', 'rpm')].map(optional), sourceWithHelp('新版73每开放槽为STEP、SPEED_H/L、R210A_H/L；标准来源须提供，禁止从机器读数反填标准。')], { operator: 'profile-slots', parameterPlan: 'shipping', performanceClass: 'A', parameterProfiles: "[{\"models\":[\"Q5\"],\"valveType\":1,\"plan\":\"shipping\",\"performanceClass\":\"A\",\"slots\":[{\"gear\":0,\"speed\":2800,\"duration\":550},{\"gear\":1,\"speed\":1050,\"duration\":210},{\"gear\":2,\"speed\":1500,\"duration\":350},{\"gear\":3,\"speed\":1900,\"duration\":430},{\"gear\":4,\"speed\":2350,\"duration\":490},{\"gear\":5,\"speed\":2800,\"duration\":550}]},{\"models\":[\"Q6\",\"Q7\"],\"valveType\":1,\"plan\":\"shipping\",\"performanceClass\":\"A\",\"slots\":[{\"gear\":0,\"speed\":3200,\"duration\":510},{\"gear\":1,\"speed\":1000,\"duration\":180},{\"gear\":2,\"speed\":1500,\"duration\":290},{\"gear\":3,\"speed\":1800,\"duration\":350},{\"gear\":4,\"speed\":2250,\"duration\":400},{\"gear\":5,\"speed\":2700,\"duration\":450},{\"gear\":6,\"speed\":3200,\"duration\":510},{\"gear\":7,\"speed\":3650,\"duration\":550}]},{\"models\":[\"Q5\"],\"valveType\":0,\"plan\":\"shipping\",\"performanceClass\":\"A\",\"slots\":[{\"gear\":0,\"speed\":2800,\"duration\":450},{\"gear\":1,\"speed\":1000,\"duration\":190},{\"gear\":2,\"speed\":1500,\"duration\":310},{\"gear\":3,\"speed\":1900,\"duration\":350},{\"gear\":4,\"speed\":2350,\"duration\":400},{\"gear\":5,\"speed\":2800,\"duration\":450}]},{\"models\":[\"Q6\",\"Q7\"],\"valveType\":0,\"plan\":\"shipping\",\"performanceClass\":\"A\",\"slots\":[{\"gear\":0,\"speed\":3200,\"duration\":490},{\"gear\":1,\"speed\":1000,\"duration\":170},{\"gear\":2,\"speed\":1500,\"duration\":300},{\"gear\":3,\"speed\":1800,\"duration\":330},{\"gear\":4,\"speed\":2250,\"duration\":380},{\"gear\":5,\"speed\":2700,\"duration\":420},{\"gear\":6,\"speed\":3200,\"duration\":490},{\"gear\":7,\"speed\":3650,\"duration\":520}]},{\"models\":[\"Q5\"],\"valveType\":0,\"plan\":\"fixed-mac\",\"performanceClass\":\"A\",\"slots\":[{\"gear\":0,\"speed\":2800,\"duration\":420},{\"gear\":1,\"speed\":1050,\"duration\":170},{\"gear\":2,\"speed\":1500,\"duration\":290},{\"gear\":3,\"speed\":1900,\"duration\":330},{\"gear\":4,\"speed\":2350,\"duration\":380},{\"gear\":5,\"speed\":2800,\"duration\":420}]},{\"models\":[\"Q6\",\"Q7\"],\"valveType\":0,\"plan\":\"fixed-mac\",\"performanceClass\":\"A\",\"slots\":[{\"gear\":0,\"speed\":3000,\"duration\":430},{\"gear\":1,\"speed\":1000,\"duration\":170},{\"gear\":2,\"speed\":1500,\"duration\":260},{\"gear\":3,\"speed\":1800,\"duration\":310},{\"gear\":4,\"speed\":2250,\"duration\":370},{\"gear\":5,\"speed\":2700,\"duration\":400},{\"gear\":6,\"speed\":3000,\"duration\":430},{\"gear\":7,\"speed\":3200,\"duration\":460}]}]", approval: 'confirmed' }),
  definition('valve-type', '05', '阀类型', 'routine', '74 配置状态有效且能读取 MAC 阀或方阀为 PASS；未配置、配置冲突或无有效类型为 NG。', allowed('允许的阀类型'), { operator: 'allowlist', allowedValues: 'MAC 阀\n方阀' }),
  definition('total-usage', '07', '总使用时长', 'routine', '累计使用时长不超过 20.5 小时为 PASS；1230 分钟包含在内，超过则 NG。已有严格小于规则仍可保留。', [select('operator', '判定方式', [['lt', '小于'], ['lte', '小于或等于']]), number('maximum', '累计时长上限', 'h'), source], { operator: 'lte', maximum: '20.5' }),
  definition('button-volume', '17', '按键音量等级', 'routine', '80 回读 EEPROM 保存的音量等级，合法范围为 0～3；目标为最高等级 3，其余不符合目标。0xFF 等越界值无效，不能映射为当前运行的 1 级；具体原因需结合固件确认。修改后的掉电保存需另行验证。', [select('operator', '判定方式', [['equals', '等于']]), number('expected', '目标音量等级（EEPROM）'), sourceWithHelp('80 直接读取 EEPROM 保存值，合法等级 0～3，目标 3；当前运行音量须另行核对，0xFF 不转换为 1，也不直接断言为未初始化。')], { operator: 'equals', expected: '3' }),
  definition('default-gear', '18', '发货档位与保存验证', 'routine', '目标 3 档已确认；86 读取 RAM 当前档位。设置有 EEPROM 掉电保存机制，但单次 86=3 不证明保存成功，需完全断电、重新上电后回读。', [select('operator', '判定方式', [['equals', '等于']]), number('expected', '断电重启后目标档位', '档'), sourceWithHelp('当前 86 读取 RAM；记录修改、完全断电、重新上电后的回读证据。86 改为 EEPROM 直读尚属建议，只有获得新固件确认后才能调整来源说明。')], { expected: '3', operator: 'equals' }),
  definition('fpga-version', '19', 'FPGA 版本', 'routine', 'FPGA 返回数值为 37 时 PASS，其他为 NG；该数值由固件完成 BCD 转换，不重复转换。', [select('operator', '判定方式', [['allowlist', '属于允许清单（旧规则）'], ['equals', '等于']]), optional(area('allowedValues', '允许的 FPGA 版本')), optional(text('expected', '期望 FPGA 版本')), source], {"operator":"equals","readbackSource":"串口查询命令表_0910.xlsx 命令表_整理!C22","evidence":"串口查询命令表_0910.xlsx 命令表_整理!D22","expected":"37","approval":"confirmed"}),
  definition('calibration-230', '20', '230 状态', 'routine', '83 首字节为 230 标志：0 未完成 / 基线不可用，1 已完成；后两字节为 230 抹平值，其类型、单位、换算及完整有效性仍待确认。', [...equality('完成标志期望值（0 未完成 / 1 已完成）').slice(0, -1), sourceWithHelp('83 首字节为完成标志，后两字节为抹平值；清除对应校准数据后标志回到 0。填写目标固件与回包证据，不以完成标志单独证明校准数据完整有效。')], { operator: 'equals', expected: '1' }),
  definition('calibration-232', '21', '232 状态', 'routine', '84 为 232 标志：0 未完成，1 已完成；按主表以 1 判断完成。清除对应校准数据后回到 0。', [...equality('完成标志期望值（0 未完成 / 1 已完成）').slice(0, -1), sourceWithHelp('84 回读 232 完成标志；记录目标固件、校准及清除后的回包证据，持久与失效条件按已确认资料补充。'), optional(text('validityRule', '完成标志有效性补充（可选）', '可补充工艺复测条件；主表完成标志为 1，不额外索取附表条件。'))], { operator: 'equals', expected: '1' }),
];

const manualTitles = ['实体按键回弹正常', '各档位无共振异常抖动', '屏幕无花屏等异常', '风扇旋转正常', '鼻氧管吸气灵敏度正常'];
const manual = manualTitles.map((title, index) => definition(
  `manual-${index + 1}`, `M${String(index + 1).padStart(2, '0')}`, title, 'manual', '由操作员按明确标准逐项确认。',
  [area('confirmationText', '人工确认标准'), select('proofRequirement', '确认凭证', [['operator', '记录确认人和时间'], ['note', '同时填写确认说明']])],
));

const connection = [
  definition('serial-port', 'C01', '设备串口', 'connection', '默认自动发现唯一候选端口；有多个候选时可按工位实际端口选择固定串口。', [select('mode', '串口选择方式', [['auto', '自动发现'], ['fixed', '固定串口']]), { key: 'port', label: '固定串口名称', type: 'text', help: '固定串口时填写实际端口，例如 COM3。' }], { mode: 'auto', port: '' }),
  definition('baud-rate', 'C02', '串口波特率', 'connection', '客户端默认 9600；取值须同时被设备与串口驱动支持。', [{ ...number('baudRate', '波特率'), min: 300, max: 3000000, integer: true }], { baudRate: '9600' }),
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
