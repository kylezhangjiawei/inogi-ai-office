export type Product = 'Q7' | 'Q5' | 'all';
export type Scope = 'all' | 'owned';
export type Filter = 'all' | 'buy' | 'shortage' | 'unverified';
export type Category = 'valve' | 'electronics' | 'power' | 'package' | 'plastic' | 'silicone' | 'bom';
export const categoryLabels: Record<Category, string> = { valve: '阀与气路', electronics: '电控、传感与交互', power: '动力、供电与耗材', package: '包材与附件', plastic: '塑料明细', silicone: '硅胶明细', bom: '非重点 BOM 料' };
export interface Clue { id: string; name: string; position: string; check: string; group: Category | 'range'; kind: 'key' | 'candidate' | 'range'; materialIds: string[]; inclusion: 'pending' | 'included' | 'excluded'; }
export interface Supply { id: string; name: string; status: string; }
export interface MonthlyStock { demandQ7: number | null; demandQ5: number | null; qualified: number | null; lineSide: number | null; orderRemaining: number | null; inTransit: number | null; quarantine: number | null; defective: number | null; usableDate: string | null; neededDate: string; }
export interface Material { id: string; name: string; spec: string; revision: string; unit: string; category: Category; products: ('Q7' | 'Q5')[]; supplierIds: string[]; owner: string; verifiedAt: string | null; source: string; monthly: Record<string, MonthlyStock>; monthlySources?: Record<string, { source: string; verifiedAt: string | null }>; }
export interface CheckRecord { id: string; clueId: string; before: string[]; after: string[]; inclusion: Clue['inclusion']; actor: string; note: string; at: string; }
export interface ImportHistory { id: string; materialId: string; month: string; before: MonthlyStock | null; after: MonthlyStock; actor: string; note: string; at: string; }
export interface KeyMaterialsState { version: number; clues: Clue[]; materials: Material[]; suppliers: Supply[]; history: CheckRecord[]; importHistory: ImportHistory[]; importKeys: string[]; lastSuccess: string | null; }
export const ambiguousTerms = ['CFO', '西安美'];
export function validMonth(value: string) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
export function validDate(value: string) { const time = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value; }
export function parseContext(params: URLSearchParams): { month: string; product: Product; scope: Scope; rawProduct: string; productKnown: boolean; monthKnown: boolean; scopeKnown: boolean } {
  const rawProduct = params.get('product') ?? 'all';
  return { month: validMonth(params.get('month') ?? '') ? params.get('month')! : '2026-09', product: ['Q7', 'Q5'].includes(rawProduct) ? rawProduct as Product : 'all', rawProduct, productKnown: ['Q7', 'Q5', 'all'].includes(rawProduct), monthKnown: !params.has('month') || validMonth(params.get('month')!), scopeKnown: !params.has('scope') || ['all', 'owned'].includes(params.get('scope')!), scope: params.get('scope') === 'owned' ? 'owned' : 'all' };
}
const clueData: [string, string, string, Category | 'range'][] = [
  ['210阀', '11:55／14:11／18:04', '核对正式料号、规格版本及适用产品', 'valve'],
  ['310阀', '11:55／14:11／18:04', '核对正式料号、规格版本及适用产品', 'valve'],
  ['左三通塑料件', '14:11／18:04', '核对是否与口述左三通阀座为同一料号', 'valve'],
  ['右三通塑料件', '14:11／18:04', '核对是否与口述右三通阀座为同一料号', 'valve'],
  ['两通塑料件', '14:11／18:04', '按不同规格展开正式料号', 'valve'],
  ['方阀（单阀）', '18:04—18:38', '转写为“方法／单法”，名称及结构待核', 'valve'],
  ['方阀（双阀）', '18:04—18:38', '转写为“方法／双法”，名称及结构待核', 'valve'],
  ['机加进气阀（单阀）', '18:38', '按机加工相关口述暂列，名称与单／双阀对应待核', 'valve'],
  ['机加出气阀（单阀）', '18:38', '按机加工相关口述暂列，名称与单／双阀对应待核', 'valve'],
  ['机加进气阀（双阀）', '18:38', '按机加工相关口述暂列，不额外推断出气阀双阀', 'valve'],
  ['压缩机', '12:21／18:38', '按产品型号、规格及合格供应关系展开', 'power'],
  ['分子筛', '12:21', '区分原料分子筛与筛筒组件，单位及用量按 BOM 确认', 'power'],
  ['主PCB', '18:38', '核对板号、版本及适用产品', 'electronics'],
  ['“矿板PCB”', '18:38', '保留转写原词，名称待核；不自行改成副板或扩展板', 'electronics'],
  ['“第二版PCB”', '18:38', '名称与版本待核，不能默认是独立物料', 'electronics'],
  ['连接板', '19:23', '核对是否 PCB、具体板号及版本', 'electronics'],
  ['传感器', '12:21／25:21', '具体类型及料号待核；25:21 转写“无压传感器”保留核对', 'electronics'],
  ['风扇', '18:38', '按电压、尺寸等实际规格展开料号', 'power'],
  ['车充', '18:38', '按适用产品与电气规格展开料号', 'power'],
  ['适配器', '18:38', '核对规格、插头版本及适用产品', 'power'],
  ['“704”电池', '18:38', '口述型号待核，不能作为正式型号直接入主数据', 'power'],
  ['“408”电池', '18:38', '口述型号待核，不能作为正式型号直接入主数据', 'power'],
  ['显示屏', '19:23', '按尺寸、接口与版本展开料号', 'electronics'],
  ['屏保玻璃组件', '19:23', '核对正式名称、规格及组件边界', 'electronics'],
  ['按键', '19:23', '按形态、材质、颜色及版本展开料号', 'electronics'],
  ['“金色包”', '18:38', '名称待核；不自行改为其他包类名称', 'package'],
  ['拼色皮包', '18:38', '核对正式名称与颜色、规格版本', 'package'],
  ['背带', '19:23', '核对配套包型、规格及正式料号', 'package'],
  ['网格包', '18:38', '原话“网格包不需要？”；保留候选，是否纳入由业务确认', 'package'],
  ['其他塑料件', '19:23', '导入 ERP 全部在管塑料件明细并关联适用 BOM；去除与 K03—K05 重复的正式料号', 'range'],
  ['其他硅胶件', '19:23', '导入 ERP 全部在管硅胶件明细并关联适用 BOM；不得以一个分类标签代替明细', 'range'],
];
export function createKeyMaterialsState(): KeyMaterialsState {
  const specs: [string, string, string, Category, string[], number, number, number][] = [
    ['V210', '210 电磁阀', 'DC 12V', 'valve', ['K01'], 300, 220, 60],
    ['V310', '310 电磁阀', 'DC 24V', 'valve', ['K02'], 200, 240, 0],
    ['PL-L', '三通阀座左件', '左 · 注塑', 'plastic', ['K03'], 300, 250, 50],
    ['PL-R', '三通阀座右件', '右 · 注塑', 'plastic', ['K04'], 300, 260, 40],
    ['PL-2A', '两通连接件', '口径 6 mm', 'plastic', ['K05'], 300, 300, 0],
    ['PL-2B', '两通连接件', '口径 8 mm', 'plastic', ['K05'], 0, 120, 0],
    ['CP-Q7', '压缩机组件', 'Q7 专用', 'power', ['K11'], 300, 230, 70],
    ['CP-Q5', '压缩机组件', 'Q5 专用', 'power', ['K11'], 100, 100, 0],
    ['MS-01', '分子筛原料', 'BOM 原料口径', 'power', ['K12'], 75, 60, 15],
    ['PCB-Q7', '主控制板', 'PCB-Q7', 'electronics', ['K13'], 300, 300, 0],
    ['FAN-12', '散热风扇', '12V / 40 mm', 'power', ['K18'], 300, 320, 0],
    ['CAR-12', '车载充电器', '12V', 'power', ['K19'], 0, 60, 0],
    ['AC-01', '电源适配器', '国标插头', 'power', ['K20'], 300, 280, 20],
    ['LCD-Q7', '显示屏模组', 'Q7 接口', 'electronics', ['K23'], 300, 295, 5],
    ['GL-Q7', '屏保玻璃组件', 'Q7 / 透明', 'electronics', ['K24'], 300, 300, 0],
    ['KEY-01', '操作按键', '灰色 / ABS', 'electronics', ['K25'], 300, 300, 0],
    ['BAG-02', '拼色皮包', '灰黑 / Q7', 'package', ['K27'], 0, 50, 0],
    ['STRAP-01', '可调背带', '25 mm / 黑', 'package', ['K28'], 0, 80, 0],
    ['PL-COVER', '上壳塑料件', 'Q7 上壳', 'plastic', ['K30'], 300, 310, 0],
    ['PL-BASE', '底座塑料件', 'Q7 底座', 'plastic', ['K30'], 300, 295, 0],
    ['SI-SEAL', '阀座密封圈', '内径 6 mm', 'silicone', ['K31'], 600, 600, 0],
    ['SI-TUBE', '硅胶连接管', '内径 4 mm', 'silicone', ['K31'], 150, 145, 0],
    ['BOM-SCREW', '装配螺钉', 'M3 × 8', 'bom', [], 1200, 1100, 0],
  ];
  const materials: Material[] = specs.map(([code, name, spec, category, , demand, qualified, order], index) => {
    const q5 = code === 'CP-Q5';
    return { id: `DEMO-${code}`, name, spec, revision: 'A', unit: code === 'MS-01' ? 'kg' : code === 'SI-TUBE' ? 'm' : '件', category, products: q5 ? ['Q5'] : code === 'V310' ? ['Q7', 'Q5'] : ['Q7'], supplierIds: index === 0 ? ['SUP-DEMO-A', 'SUP-DEMO-B'] : [index % 2 ? 'SUP-DEMO-B' : 'SUP-DEMO-A'], owner: index % 3 ? '王晴' : '陈敏', verifiedAt: index === 8 ? null : '2026-09-11 09:30', source: 'S18 前端样例快照；未连接企业 ERP', monthly: { '2026-09': { demandQ7: q5 ? 0 : demand, demandQ5: q5 ? demand : code === 'V310' ? 20 : 0, qualified: index === 8 ? null : qualified, lineSide: index === 0 ? 20 : 0, orderRemaining: order, inTransit: order ? Math.min(order, 20) : 0, quarantine: index === 0 ? 8 : 0, defective: index === 0 ? 4 : 0, usableDate: order ? index === 6 ? '2026-09-28' : '2026-09-20' : null, neededDate: '2026-09-22' }, '2026-10': { demandQ7: q5 ? 0 : Math.round(demand * .5), demandQ5: q5 ? 60 : 0, qualified: null, lineSide: null, orderRemaining: null, inTransit: null, quarantine: null, defective: null, usableDate: null, neededDate: '2026-10-20' } } };
  });
  const clues: Clue[] = clueData.map(([name, position, check, group], i) => { const id = `K${String(i + 1).padStart(2, '0')}`; return { id, name, position, check, group, kind: i < 28 ? 'key' : i === 28 ? 'candidate' : 'range', materialIds: specs.filter((row) => row[4].includes(id)).map((row) => `DEMO-${row[0]}`), inclusion: i === 28 ? 'pending' : 'included' }; });
  return { version: 1, clues, materials, suppliers: [{ id: 'SUP-DEMO-A', name: '供应商 A（演示）', status: '供货关系样例 · 待业务复核' }, { id: 'SUP-DEMO-B', name: '供应商 B（演示）', status: '备选供货关系样例 · 待业务复核' }], history: [], importHistory: [], importKeys: [], lastSuccess: null };
}
export function materialNumbers(material: Material, month: string, product: Product) {
  const stock = material.monthly[month];
  const demand = !stock ? null : product === 'Q7' ? stock.demandQ7 : product === 'Q5' ? stock.demandQ5 : stock.demandQ7 === null || stock.demandQ5 === null ? null : stock.demandQ7 + stock.demandQ5;
  const current = stock?.qualified == null || stock.lineSide == null ? null : stock.qualified + stock.lineSide;
  const gap = current === null || demand === null ? null : Math.max(0, demand - current);
  // In-transit is a subset of remaining order quantity, never an additional supply bucket.
  const onTimeOrder = !stock || stock.orderRemaining === null ? null : stock.orderRemaining === 0 ? 0 : stock.usableDate && stock.usableDate <= stock.neededDate ? stock.orderRemaining : 0;
  const onTimeGap = gap === null || onTimeOrder === null ? null : Math.max(0, gap - onTimeOrder);
  const missing = !stock || demand === null || current === null || stock.orderRemaining === null || stock.inTransit === null || stock.quarantine === null || stock.defective === null || (stock.orderRemaining > 0 && !stock.usableDate);
  return { stock, demand, current, gap, onTimeOrder, onTimeGap, missing: Boolean(missing), needsBuy: !missing && onTimeGap !== null && onTimeGap > 0 };
}
export function selectMaterials(state: KeyMaterialsState, options: { month: string; product: Product; scope: Scope; filter: Filter; query: string; criticalOnly?: boolean }) {
  const critical = new Set(state.clues.filter((clue) => clue.inclusion === 'included').flatMap((clue) => clue.materialIds));
  const query = options.query.trim().toLocaleLowerCase();
  return state.materials.filter((material) => {
    const numbers = materialNumbers(material, options.month, options.product);
    const names = state.suppliers.filter((supplier) => material.supplierIds.includes(supplier.id)).map((supplier) => supplier.name).join(' ');
    const clues = state.clues.filter((clue) => clue.materialIds.includes(material.id)).map((clue) => `${clue.id} ${clue.name}`).join(' ');
    return (options.criticalOnly === false || critical.has(material.id)) && (options.product === 'all' || material.products.includes(options.product)) && (options.scope !== 'owned' || material.owner === '王晴') && `${material.id} ${material.name} ${material.spec} ${names} ${clues}`.toLocaleLowerCase().includes(query) && (options.filter === 'all' || options.filter === 'buy' && numbers.needsBuy || options.filter === 'shortage' && (numbers.gap ?? 0) > 0 || options.filter === 'unverified' && (numbers.missing || !material.verifiedAt));
  });
}
export function confirmClue(state: KeyMaterialsState, version: number, clueId: string, input: { materialIds: string[]; inclusion: Clue['inclusion']; actor: string; note: string }, at: string) {
  if (version !== state.version) throw new Error('来源版本已更新，请重新核对后保存；填写内容已保留。');
  const clue = state.clues.find((row) => row.id === clueId);
  if (!clue) throw new Error('核对记录不存在。');
  if (!input.actor.trim() || !input.note.trim()) throw new Error('请填写核对人和核对依据。');
  if (input.actor.length > 80 || input.note.length > 600) throw new Error('核对人限 80 字，依据限 600 字。');
  if (!['included', 'pending', 'excluded'].includes(input.inclusion)) throw new Error('纳入状态无效。');
  if (clue.kind !== 'candidate' && input.inclusion !== 'included') throw new Error('固定目录线索不能移除；仅网格包可确认是否纳入。');
  const ids = [...new Set(input.materialIds)];
  if (ids.some((id) => !state.materials.some((material) => material.id === id))) throw new Error('含未匹配料号，请先导入明细或选择目录中的料号。');
  if (input.inclusion === 'included' && !ids.length) throw new Error('请至少选择一个核对料号。');
  if (clue.kind === 'range' && ids.some((id) => state.materials.find((row) => row.id === id)?.category !== (clue.id === 'K30' ? 'plastic' : 'silicone'))) throw new Error('明细范围须匹配对应材质料号。');
  return { ...state, version: state.version + 1, clues: state.clues.map((row) => row.id === clueId ? { ...row, materialIds: ids, inclusion: input.inclusion } : row), history: [...state.history, { id: `CHECK-${state.version + 1}`, clueId, before: [...clue.materialIds], after: ids, inclusion: input.inclusion, actor: input.actor.trim(), note: input.note.trim(), at }] };
}
export const importColumns = ['materialId', 'name', 'spec', 'revision', 'unit', 'category', 'products', 'supplierIds', 'owner', 'clueIds', 'month', 'demandQ7', 'demandQ5', 'qualified', 'lineSide', 'orderRemaining', 'inTransit', 'quarantine', 'defective', 'usableDate', 'neededDate'] as const;
export interface ImportRow { line: number; material: Material; clueIds: string[]; month: string; }
export interface ImportPreview { rows: ImportRow[]; errors: { line: number; message: string }[]; key: string; version: number; }
export function csvTemplate() { return `${importColumns.join(',')}\nERP-PL-1001,塑料侧盖,Q7 侧盖,A,件,plastic,Q7,SUP-DEMO-A,王晴,K30,2026-09,300,0,280,0,20,10,0,0,2026-09-20,2026-09-22`; }
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, closed = false;
  const csv = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') { if (quoted && csv[i + 1] === '"') { value += '"'; i++; } else if (!quoted && (value || closed)) throw new Error('CSV 引号位置无效。'); else { quoted = !quoted; closed = !quoted; } }
    else if ((char === ',' || char === '\n') && !quoted) { row.push(value.trim()); value = ''; closed = false; if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; } }
    else { if (closed && char.trim()) throw new Error('CSV 闭合引号后只能有分隔符。'); value += char; }
  }
  if (quoted) throw new Error('CSV 引号未闭合。');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function previewImport(state: KeyMaterialsState, text: string): ImportPreview {
  const result: ImportPreview = { rows: [], errors: [], key: '', version: state.version };
  if (text.length > 500000) { result.errors.push({ line: 0, message: '文件超过 500 KB，请拆分后导入。' }); return result; }
  let table: string[][]; try { table = parseCsv(text); } catch (error) { result.errors.push({ line: 0, message: (error as Error).message }); return result; }
  const [headers, ...rows] = table;
  if (!headers || headers.length !== importColumns.length || new Set(headers).size !== headers.length || importColumns.some((key) => !headers.includes(key))) { result.errors.push({ line: 1, message: '字段不匹配，请下载模板；列顺序可调整，所有模板字段须保留。' }); return result; }
  if (!rows.length || rows.length > 500) { result.errors.push({ line: 2, message: '请提供 1 至 500 行明细。' }); return result; }
  const numberFields = ['demandQ7', 'demandQ5', 'qualified', 'lineSide', 'orderRemaining', 'inTransit', 'quarantine', 'defective'] as const;
  rows.forEach((cells, index) => {
    const line = index + 2;
    try {
      if (cells.length !== headers.length) throw new Error('列数与表头不一致。');
      const data = Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
      for (const key of ['materialId', 'name', 'spec', 'revision', 'unit', 'owner']) if (!data[key] || data[key].length > 120) throw new Error(`${key} 必填，且不超过 120 字。`);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(data.materialId)) throw new Error('materialId 仅允许字母、数字、点、下划线及连字符。');
      if (!Object.hasOwn(categoryLabels, data.category) || data.category === 'bom') throw new Error('category 须为 valve/electronics/power/package/plastic/silicone；BOM 由专用来源导入。');
      if (!validMonth(data.month)) throw new Error('month 格式须为 YYYY-MM。');
      const products = [...new Set(data.products.split('|'))] as ('Q7' | 'Q5')[];
      if (products.some((id) => id !== 'Q7' && id !== 'Q5')) throw new Error('products 尚未匹配：仅支持 Q7、Q5，用 | 分隔。');
      const supplierIds = [...new Set(data.supplierIds.split('|'))];
      if (supplierIds.some((id) => !state.suppliers.some((supplier) => supplier.id === id))) throw new Error('supplierIds 含未匹配供应商，请使用已核对供应商 ID。');
      if (!['王晴', '陈敏'].includes(data.owner)) throw new Error('owner 未匹配演示人员：王晴、陈敏。');
      const clueIds = [...new Set(data.clueIds.split('|'))];
      if (clueIds.some((id) => !state.clues.some((clue) => clue.id === id))) throw new Error('clueIds 含未知核对号。');
      if (clueIds.includes('K30') && data.category !== 'plastic' || clueIds.includes('K31') && data.category !== 'silicone') throw new Error('K30/K31 须分别对应 plastic/silicone 明细。');
      const numbers = {} as Pick<MonthlyStock, typeof numberFields[number]>;
      for (const key of numberFields) {
        if (data[key] === '') numbers[key] = null;
        else if (!/^\d+(\.\d{1,3})?$/.test(data[key]) || !Number.isFinite(Number(data[key])) || Number(data[key]) > 1e9) throw new Error(`${key} 须为非负数量，最多 3 位小数；未知请留空。`);
        else numbers[key] = Number(data[key]);
      }
      if (!products.includes('Q7') && (numbers.demandQ7 ?? 0) > 0 || !products.includes('Q5') && (numbers.demandQ5 ?? 0) > 0) throw new Error('需求产品须包含在 products 适用范围中。');
      if (numbers.inTransit !== null && numbers.orderRemaining !== null && numbers.inTransit > numbers.orderRemaining) throw new Error('在途是订单剩余的子集，不能大于订单剩余。');
      if (!validDate(data.neededDate) || data.neededDate.slice(0, 7) !== data.month) throw new Error('neededDate 须为本月有效日期。');
      if (data.usableDate && !validDate(data.usableDate)) throw new Error('usableDate 须为有效日期或留空。');
      const material: Material = { id: data.materialId, name: data.name, spec: data.spec, revision: data.revision, unit: data.unit, category: data.category as Category, products, supplierIds, owner: data.owner, verifiedAt: null, source: '本地 CSV 导入草稿；待人工确认', monthly: { [data.month]: { ...numbers, neededDate: data.neededDate, usableDate: data.usableDate || null } } };
      const old = state.materials.find((item) => item.id === material.id);
      if (old && (old.unit !== material.unit || old.revision !== material.revision || old.spec !== material.spec || old.category !== material.category || old.name !== material.name)) throw new Error('同料号的名称、规格、版本、单位或类别冲突，请核对原主数据；不能覆盖转换库存。');
      if (old && (old.owner !== material.owner || [...old.products].sort().join('|') !== [...material.products].sort().join('|'))) throw new Error('同料号适用产品或经办变更须单独核对主数据；库存 CSV 不能覆盖，避免历史月份归属丢失。');
      const prior = result.rows.find((row) => row.material.id === material.id);
      if (prior) {
        const signature = (item: Material) => JSON.stringify({ ...item, supplierIds: [] });
        if (prior.month !== data.month || signature(prior.material) !== signature(material)) throw new Error('同文件同料号出现冲突快照，请合并为一行；不得累计。');
        prior.material.supplierIds = [...new Set([...prior.material.supplierIds, ...supplierIds])]; prior.clueIds = [...new Set([...prior.clueIds, ...clueIds])];
      } else result.rows.push({ line, material, clueIds, month: data.month });
    } catch (error) { result.errors.push({ line, message: (error as Error).message }); }
  });
  // Exact normalized content is retained in memory to make retries idempotent without hash collisions.
  result.key = JSON.stringify(result.rows.map(({ material, clueIds, month }) => ({ material, clueIds: [...clueIds].sort(), month })).sort((a, b) => a.material.id.localeCompare(b.material.id)));
  return result;
}
export function confirmImport(state: KeyMaterialsState, preview: ImportPreview, actor: string, note: string, at: string): KeyMaterialsState {
  if (preview.errors.length || !preview.rows.length) throw new Error('请先修复逐行错误并重新校验。');
  if (!actor.trim() || !note.trim()) throw new Error('请填写核对人和导入依据。');
  if (actor.length > 80 || note.length > 600) throw new Error('核对人限 80 字，依据限 600 字。');
  if (preview.version !== state.version) throw new Error('来源版本已更新，请重新校验导入草稿。');
  const stillCurrent = preview.rows.every((row) => {
    const current = state.materials.find((material) => material.id === row.material.id);
    const snapshot = current?.monthly[row.month], incoming = row.material.monthly[row.month];
    return current && snapshot && Object.entries(incoming).every(([key, value]) => snapshot[key as keyof MonthlyStock] === value)
      && row.material.supplierIds.every((id) => current.supplierIds.includes(id))
      && row.clueIds.every((id) => state.clues.find((clue) => clue.id === id)?.materialIds.includes(row.material.id));
  });
  // An old file may be a deliberate correction after a newer snapshot; only unchanged retries are no-ops.
  if (state.importKeys.includes(preview.key) && stillCurrent) return state;
  const materials = [...state.materials], importHistory = [...state.importHistory];
  for (const row of preview.rows) {
    const oldIndex = materials.findIndex((item) => item.id === row.material.id);
    const old = materials[oldIndex];
    importHistory.push({ id: `SNAPSHOT-${state.version + 1}-${row.material.id}`, materialId: row.material.id, month: row.month, before: old?.monthly[row.month] ? { ...old.monthly[row.month] } : null, after: { ...row.material.monthly[row.month] }, actor: actor.trim(), note: note.trim(), at });
    const source = `本地导入确认 · ${actor.trim()} · ${note.trim()}`;
    const previousSources = old?.monthlySources ?? Object.fromEntries(Object.keys(old?.monthly ?? {}).map((month) => [month, { source: old!.source, verifiedAt: old!.verifiedAt }]));
    const material = { ...row.material, verifiedAt: at, source, supplierIds: [...new Set([...(old?.supplierIds ?? []), ...row.material.supplierIds])], monthly: { ...old?.monthly, ...row.material.monthly }, monthlySources: { ...previousSources, [row.month]: { source, verifiedAt: at } } };
    if (oldIndex < 0) materials.push(material); else materials[oldIndex] = material;
  }
  const history: CheckRecord[] = [], clues = state.clues.map((clue) => {
    const ids = preview.rows.filter((row) => row.clueIds.includes(clue.id)).map((row) => row.material.id);
    if (!ids.length) return clue;
    const after = [...new Set([...clue.materialIds, ...ids])];
    history.push({ id: `IMPORT-${state.version + 1}-${clue.id}`, clueId: clue.id, before: [...clue.materialIds], after, inclusion: clue.inclusion, actor: actor.trim(), note: note.trim(), at });
    return { ...clue, materialIds: after };
  });
  return { ...state, version: state.version + 1, materials, clues, history: [...state.history, ...history], importHistory, importKeys: [...new Set([...state.importKeys, preview.key])], lastSuccess: at };
}
