import { validateProtocolCatalog, type FactoryCommand, type FactoryProtocolCatalog } from './factory-qc.contract';
import { FACTORY_PROTOCOL_EXAMPLE } from './factory-qc.example';

/** Administrative provenance only. None of these notes is added to the client JSON. */
export const R5_SOURCE = {
  packageName: 'FactoryQc-backend-v0.4.1-r5.zip',
  publishedExampleVersion: 'builtin-20260909-v2',
  historicalCandidateVersion: 'candidate-20260909-v3',
  reviewVersion: 'review-r5-20260909',
} as const;
export const R5_PROFILE_ID = 'v4-20260908';
export const R5_REVIEW_NOTICE = 'r5 审核模板，仅供核对、编辑和保存草稿。解析与样例校验通过不代表已确认适用固件、测量有效或质检合格；模板不会自动保存或发布。';
export type R5ProtocolNote = { confirmed: string[]; pending: string[]; sampleSources?: string[] };

export const R5_PROTOCOL_NOTES: Record<string, R5ProtocolNote> = {
  firmware: {
    confirmed: ['沿用 9 字节应答：8 字节 ASCII 主版本及 1 字节子版本。业务 ID 保持稳定。'],
    pending: ['仍使用 V4.0UA81 前缀只是继承既有匹配条件，不能证明该版本已修正 78。请确认修正后的完整 72 回包及机型、硬件、固件适用范围。', '当前只按载荷长度和主版本前缀匹配；如果仅子版本不同，现有匹配能力无法区分。不能删除前缀、添加重叠兜底或仅改配置名称来规避。'],
    sampleSources: ['继承原 v2 示例的 72 报文；不是修正固件的新增实机证明。'],
  },
  alarms: {
    confirmed: ['77 返回当前活动报警：单字节数量及单字节编号列表，最多 23 条；最大有效载荷为 24 字节。', '编号字典保留未定义编号的可见占位名称，不能将未知编号视为无报警。'],
    pending: ['同帧编号不重复是固件约定，当前客户端不检查编号唯一性。解析成功不能替代质量部门的报警处置和放行规则。'],
    sampleSources: ['继承 r4 历史候选的 0、1、2、4、23 条报警样例。', '23 条最大帧是构造的边界校验样例，不是实机抓包。'],
  },
  'pressure-check': {
    confirmed: ['修正后 78 格式为两字节、大端、无符号整数 kPa；00 AD 显示 173，01 2C 显示 300。'],
    pending: ['研发反馈中的旧实现仅发送低 8 位且误用返回码 85；尚未证明目标固件已修复。必须确认修正后完整 72、78 实机报文及匹配条件。', '有效状态仍未确认；不能把可解析读数或数值范围当作传感器有效证据。'],
    sampleSources: ['继承 r4 候选的 173 示例；300 kPa 是验证高字节保留的构造边界样例，不是实机测量。'],
  },
  'temperature-check': {
    confirmed: ['79 为两字节、大端、16 位有符号补码、整数 ℃；00 23 为 35，FF FB 为 -5。固件发送前的除以 10 不应在客户端重复执行。'],
    pending: ['传感器无效、未就绪及测量失败状态仍未定义，不能仅凭数值范围证明有效。'],
    sampleSources: ['继承 r4 候选的正、负温度样例；用于解析校验，不作为批准的温度范围。'],
  },
  parameters: {
    confirmed: ['73 当前固件预留、未开发，无有效字段、组包及发送实现；继续停用，fields 和 samples 保持为空。'],
    pending: ['以后确定开发时再定义协议与样例，不能因收到回复就启用。'],
  },
  'valve-pressure': {
    confirmed: ['7D 为有符号 16 位微压实时差值平均值，负数使用补码；字段改为 int。'],
    pending: ['big 字节序继承原 v2 与历史候选，仅用于本审核模板，并非已被新回复确认。请用目标固件完整正、负值报文核实字节序。', '单位及工程量换算仍未知；不填 Pa/kPa。倍率 1、除数 1、偏移 0 也是继承值，不代表工程量换算已确认。'],
    sampleSources: ['00 23 = 35 继承历史示例。', 'F5 06 F9 7D FF FB → -5 是按继承的 big 字节序构造的负值解析样例，不是实机报文，也不能证明固件字节序或单位。'],
  },
  fan: {
    confirmed: ['7A 为实际风扇反馈比例，约 0～100；不是控制目标，也不是 RPM。名称改为风扇实际反馈比例。'],
    pending: ['约 0～100 不是批准的质检范围，也未定义所有异常值。不能仅凭反馈比例判定整项风扇测试通过。'],
    sampleSources: ['沿用历史比例显示样例，不新增转速换算或数值规则。'],
  },
  restarts: {
    confirmed: ['7C 为压缩机异常或转速不足触发自动重启的累计次数。'],
    pending: ['计数复位及掉电保存规则未说明，不能当作整机开机次数或完整停转恢复证据。'],
  },
  calibration230: {
    confirmed: ['83 首字节：0 为未完成或基线不可用，1 为已完成；后两字节称为 230 抹平值。'],
    pending: ['后两字节的 raw 布局仅继承既有 offset 1、length 2、uint、big 及 1 倍换算；数值类型、字节序、单位和换算尚未确认。当前显示不能视为已验证工程量。', '完成标志的完整持久性、失效条件及校准有效性仍需确认。'],
    sampleSources: ['沿用历史 01 00 0B 报文；只更新状态中文显示及抹平值名称，未新增实机验证。'],
  },
  calibration232: {
    confirmed: ['84 为 232 完成标志：0 未完成，1 已完成；清除对应校准数据后回到 0。'],
    pending: ['完成标志的完整掉电保存及失效条件仍未齐全，不能据此制造完整校准有效性结论。'],
    sampleSources: ['沿用历史状态样例，expected 同步为状态名称。'],
  },
  sensitivity: {
    confirmed: ['7F 直接读取 EEPROM 中可修改的持久灵敏度设置；目标为 3 级。'],
    pending: ['修改后完整断电、重上电回读验证属于工作流。读到 3 不能替代所需验证流程，也不自动形成合格判定。'],
  },
  volume: {
    confirmed: ['80 直接读取 EEPROM 中可修改的持久按键音量设置。'],
    pending: ['音量合法等级仍待确认，修改后的掉电验证流程尚未接入。'],
  },
  delivery: {
    confirmed: ['86 读取 RAM 中当前档位，目标为 3 档；设置具有 EEPROM 保存机制，但本查询不是独立的 EEPROM 默认值回读。'],
    pending: ['单次 86=3 不能证明掉电保存成功。完全断电、重上电验证需工作流；改为直接读 EEPROM 仍只是建议。'],
  },
  usage: {
    confirmed: ['本次回复对应固件的 76 按分钟返回，现有新版配置除以 60 显示小时，无需重复修改。'],
    pending: ['不能将结论扩大到旧三字节固件。legacy-v1 继续保留原秒单位，等待旧固件完整回包与单位对应证据。'],
  },
  pressure: {
    confirmed: ['85 是当前大气压读取项。'],
    pending: ['设备内部开机采样流程不等于可独立读取的开机基线。仍缺读取命令、有效状态和完整回包，不能把当前大气压直接作为开机基线。'],
  },
};

function command(catalog: FactoryProtocolCatalog, id: string): FactoryCommand {
  const result = catalog.profiles.find((profile) => profile.id === R5_PROFILE_ID)?.commands.find((entry) => entry.id === id);
  if (!result) throw new Error(`r5 模板来源缺少 ${id}，请核对原始示例`);
  return result;
}

/** Recreates the unchanged historical candidate in the r5 ZIP; it is a reference, not a release. */
export function buildHistoricalFactoryQcCandidate(): FactoryProtocolCatalog {
  const catalog = structuredClone(FACTORY_PROTOCOL_EXAMPLE);
  if (catalog.version !== R5_SOURCE.publishedExampleVersion) throw new Error('r5 模板需要原始 v2 示例作为可核对来源');
  catalog.version = R5_SOURCE.historicalCandidateVersion;
  catalog.profiles.find((profile) => profile.id === R5_PROFILE_ID)!.name = '修正固件联调候选（适用版本待核实）';

  // Reproduce the 77/78/79 changes in the historical candidate from the r5 ZIP.
  const alarms = command(catalog, 'alarms');
  alarms.name = '当前报警（数量与编号）';
  alarms.payloadLength = 24;
  const codes = alarms.fields.find((field) => field.id === 'codes')!;
  codes.maxCount = 23;
  const labels = (values: number[]) => values.map((value) => {
    const label = codes.enumValues?.[String(value)];
    if (label === undefined) throw new Error(`r5 模板缺少报警编号 ${value} 的来源名称`);
    return label;
  }).join('、');
  alarms.samples.push(
    { frameHex: 'F5 09 F6 77 04 01 05 13 16', expected: { count: '4', codes: labels([1, 5, 19, 22]) } },
    { frameHex: 'F5 1C E3 77 17 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 10 11 12 13 14 15 16 17', expected: { count: '23', codes: labels(Array.from({ length: 23 }, (_, index) => index + 1)) } },
  );
  const pressure = command(catalog, 'pressure-check');
  pressure.name = '压力查询（有效性未确认）';
  Object.assign(pressure.fields[0], { name: '返回值', type: 'uint', prefix: '', unit: 'kPa' });
  pressure.samples = [
    { frameHex: 'F5 06 F9 78 00 AD', expected: { value: '173' } },
    { frameHex: 'F5 06 F9 78 01 2C', expected: { value: '300' } },
  ];
  const temperature = command(catalog, 'temperature-check');
  temperature.name = '内部温度（有效性未确认）';
  Object.assign(temperature.fields[0], { name: '返回值', type: 'int', prefix: '', unit: '℃' });
  temperature.samples = [
    { frameHex: 'F5 06 F9 79 00 23', expected: { value: '35' } },
    { frameHex: 'F5 06 F9 79 FF FB', expected: { value: '-5' } },
  ];
  return validateProtocolCatalog(catalog);
}

/** Builds a fresh review-only catalog; does not save, publish, or change either source example. */
export function buildFactoryQcR5Draft(): FactoryProtocolCatalog {
  const catalog = buildHistoricalFactoryQcCandidate();
  catalog.version = R5_SOURCE.reviewVersion;
  catalog.profiles.find((profile) => profile.id === R5_PROFILE_ID)!.name = 'r5 审核模板（适用固件与有效性待核实）';
  command(catalog, 'alarms').name = '当前活动报警（数量与编号）';
  command(catalog, 'pressure-check').name = '压力查询（修正固件与有效性待核实）';
  const parameters = command(catalog, 'parameters');
  parameters.enabled = false;
  parameters.disabledReason = '当前固件预留、未开发，尚无有效参数回包。';
  parameters.fields = []; parameters.samples = [];
  const valve = command(catalog, 'valve-pressure');
  valve.name = '微压实时差值平均值（单位待核实）';
  Object.assign(valve.fields[0], { name: '有符号差值', type: 'int' });
  delete valve.fields[0].unit;
  // Constructed against the inherited big-endian layout, not firmware evidence; see management notes.
  valve.samples.push({ frameHex: 'F5 06 F9 7D FF FB', expected: { value: '-5' } });
  command(catalog, 'fan').name = '风扇实际反馈比例';
  command(catalog, 'fan').fields[0].name = '实际反馈比例';
  command(catalog, 'restarts').name = '压缩机异常自动重启次数';
  const calibration230 = command(catalog, 'calibration230');
  const status230 = { '0': '未完成 / 基线不可用', '1': '已完成' };
  calibration230.fields.find((field) => field.id === 'status')!.enumValues = status230;
  calibration230.fields.find((field) => field.id === 'value')!.name = '230 抹平值';
  for (const sample of calibration230.samples) sample.expected.status = status230[sample.expected.status as keyof typeof status230];
  const calibration232 = command(catalog, 'calibration232');
  const status232 = { '0': '未完成', '1': '已完成' };
  calibration232.fields[0].enumValues = status232;
  for (const sample of calibration232.samples) sample.expected.value = status232[sample.expected.value as keyof typeof status232];
  command(catalog, 'sensitivity').name = '持久灵敏度设置（EEPROM）';
  command(catalog, 'volume').name = '持久按键音量设置（EEPROM）';
  command(catalog, 'delivery').name = '当前档位（RAM）';

  // A parser/sample check is not an approval to publish, nor a quality verdict.
  return validateProtocolCatalog(catalog);
}
