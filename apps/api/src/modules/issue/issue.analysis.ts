/**
 * 根因分析：AI 结构化输出（主）+ 启发式兜底（无模型/AI 失败时仍可用）。
 * 启发式逻辑与前端 mock（issueService.ts）保持同构，保证降级时体验一致。
 */
import {
  CAUSE_DIMENSIONS,
  type CauseDimension,
  type Likelihood,
  type PossibleCause,
  type RootCauseAnalysis,
  type Solution,
  type SolutionType,
} from './issue.constants';

export type MkId = (prefix: string) => string;

// ── 分词（中英混合，简易）─────────────────────────────────────────────────────
const STOP_TOKENS = new Set([
  '的', '了', '在', '与', '和', '及', '或', '对', '为', '是', '有', '无', '等',
  '导致', '出现', '存在', '怀疑', '疑似', '可能', '由于', '造成', '问题', '现象',
]);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const ascii = text.match(/[A-Za-z0-9][A-Za-z0-9.\-]*/g) || [];
  for (const w of ascii) {
    const t = w.toLowerCase();
    if (t.length >= 2) out.push(t);
  }
  const han = text.match(/[一-龥]+/g) || [];
  for (const seg of han) {
    if (seg.length <= 1) continue;
    for (let i = 0; i + 2 <= seg.length; i += 1) {
      const bi = seg.slice(i, i + 2);
      if (!STOP_TOKENS.has(bi)) out.push(bi);
    }
    if (seg.length <= 4 && !STOP_TOKENS.has(seg)) out.push(seg);
  }
  return out;
}

export function deriveKeywords(title: string, description: string): string[] {
  const tokens = tokenize(`${title} ${description}`);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    if (STOP_TOKENS.has(t)) continue;
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
    if (result.length >= 24) break;
  }
  return result;
}

/** 输入 token 集合 vs 某历史问题的关键词/标题重叠度，0~1。 */
export function overlapScore(
  inputTokens: Set<string>,
  target: { keywords?: string[]; title: string },
): number {
  if (inputTokens.size === 0) return 0;
  const set = new Set<string>();
  for (const k of target.keywords || []) set.add(k.toLowerCase());
  for (const t of tokenize(target.title)) set.add(t);
  if (set.size === 0) return 0;
  let hit = 0;
  for (const t of inputTokens) if (set.has(t)) hit += 1;
  return hit / Math.min(inputTokens.size, set.size);
}

// ── 启发式 cause 模板（兜底）──────────────────────────────────────────────────
interface CauseTemplate {
  match: string[];
  cause: string;
  dimension: CauseDimension;
  likelihood: Likelihood;
  evidence: string;
  solutions: Array<{ action: string; type: SolutionType; owner?: string }>;
}

const CAUSE_TEMPLATES: CauseTemplate[] = [
  {
    match: ['浓度', '氧浓度', '制氧', '分子筛', '粉化', '受潮', '吸附'],
    cause: '分子筛受潮/老化致吸附能力下降',
    dimension: '料',
    likelihood: 'high',
    evidence: '氧浓度衰减与分子筛吸附性能直接相关，进气端易受潮粉化。',
    solutions: [
      { action: '隔离可疑批次分子筛并复测浓度', type: 'contain', owner: '质量工程师' },
      { action: '前置增设干燥过滤并固化干燥工艺', type: 'correct', owner: '工艺工程师' },
      { action: '增加分子筛吸附指标来料验收', type: 'prevent', owner: 'SQE' },
    ],
  },
  {
    match: ['气路', '流量', '切换', 'psa'],
    cause: '气路/PSA 切换时序异常',
    dimension: '法',
    likelihood: 'medium',
    evidence: '浓度波动与产气流量相关，疑 PSA 切换时序或气路阻力异常。',
    solutions: [{ action: '复核 PSA 切换时序与气路压损', type: 'correct', owner: '研发工程师' }],
  },
  {
    match: ['噪音', '分贝', '嗡鸣', '共振', '风道'],
    cause: '压缩机减振不足/风道共振',
    dimension: '机',
    likelihood: 'high',
    evidence: '低频嗡鸣为典型减振或风道共振特征。',
    solutions: [
      { action: '更换减振垫并临时隔振观察噪音', type: 'contain', owner: '结构工程师' },
      { action: '优化减振结构与风道避开共振频段', type: 'correct', owner: '结构工程师' },
    ],
  },
  {
    match: ['电磁阀', '漏气', '气密', '泄漏', '密封'],
    cause: '电磁阀密封件不良致泄漏',
    dimension: '料',
    likelihood: 'high',
    evidence: '气密不良集中于阀口，密封件批次或材质存疑。',
    solutions: [
      { action: '隔离可疑密封件批次并全检', type: 'contain', owner: '质量工程师' },
      { action: '更换合格密封件并要求材质证明', type: 'correct', owner: 'SQE' },
    ],
  },
  {
    match: ['压缩机', '过热', '过温', '散热', '高温'],
    cause: '散热风道风量不足',
    dimension: '法',
    likelihood: 'high',
    evidence: '缸体温升异常，散热风道设计风量可能不足。',
    solutions: [
      { action: '临时加装导流罩观察温降', type: 'contain', owner: '结构工程师' },
      { action: '优化风道并提升风扇转速曲线', type: 'correct', owner: '结构工程师' },
    ],
  },
  {
    match: ['润滑', '脂', '碳化'],
    cause: '润滑脂耐温等级不足',
    dimension: '料',
    likelihood: 'medium',
    evidence: '高温运行后润滑脂碳化，疑耐温等级偏低。',
    solutions: [
      { action: '改用高温润滑脂并复测温升', type: 'correct', owner: '工艺工程师' },
      { action: '在 BOM 中锁定润滑脂耐温要求', type: 'prevent', owner: '研发' },
    ],
  },
  {
    match: ['pcba', '虚焊', '焊点', '回流', '锡膏', 'smt', 'aoi'],
    cause: '回流焊温度曲线偏离致虚焊',
    dimension: '机',
    likelihood: 'high',
    evidence: '虚焊集中在大热容区，疑回流峰值温度不足。',
    solutions: [
      { action: '停线复核并重打回流炉温曲线', type: 'contain', owner: 'SMT 工程师' },
      { action: '优化回流温区设定并固化炉温档案', type: 'correct', owner: 'SMT 工程师' },
      { action: '建立每班炉温点检与 SPC 监控', type: 'prevent', owner: '工艺工程师' },
    ],
  },
  {
    match: ['传感器', '漂移', '标定', '校准', '偏差'],
    cause: '标定基准设备漂移未及时校准',
    dimension: '测',
    likelihood: 'high',
    evidence: '多台样机方向一致偏移，强烈指向标定基准本身。',
    solutions: [
      { action: '暂停标定并送检基准设备', type: 'contain', owner: '计量员' },
      { action: '校准基准并重做受影响批次标定', type: 'correct', owner: '计量/工艺' },
      { action: '建立基准设备周期校准与到期提醒', type: 'prevent', owner: '计量室' },
    ],
  },
  {
    match: ['外壳', '缩水', '注塑', '保压', '壁厚', '成型', '模具'],
    cause: '注塑保压压力/时间不足',
    dimension: '法',
    likelihood: 'high',
    evidence: '缩水固定于厚壁区，典型保压不足特征。',
    solutions: [
      { action: '优化保压曲线（提高保压压力并延长保压时间）', type: 'correct', owner: '注塑工程师' },
      { action: '建立注塑参数档案与首件确认', type: 'prevent', owner: '工艺工程师' },
    ],
  },
  {
    match: ['高湿', '凝露', '湿度', '防潮', '环境'],
    cause: '高湿环境致面板凝露',
    dimension: '环',
    likelihood: 'high',
    evidence: '仅高湿环境复现，凝露出现在面板温差区。',
    solutions: [
      { action: '增加防潮垫片临时观察凝露', type: 'contain', owner: '结构工程师' },
      { action: '优化面板密封并增加防潮设计', type: 'correct', owner: '结构工程师' },
      { action: '在环境规格中明确使用湿度上限', type: 'prevent', owner: '研发' },
    ],
  },
  {
    match: ['漏装', '防错', '防呆', '装配', '作业指导', '培训'],
    cause: '装配工位缺乏防错措施',
    dimension: '人',
    likelihood: 'high',
    evidence: '漏装集中在特定班次，缺防错点检，依赖人工记忆。',
    solutions: [
      { action: '终检增加专项全检（临时遏制）', type: 'contain', owner: '终检班长' },
      { action: '增加防错治具与装配到位检测', type: 'prevent', owner: '工艺工程师' },
    ],
  },
  {
    match: ['电芯', '电池', '续航', '容量', '功耗'],
    cause: '电芯实际容量低于标称',
    dimension: '料',
    likelihood: 'high',
    evidence: '电芯放电容量低于标称且批次一致偏低。',
    solutions: [
      { action: '更换合格电芯供应商并按容量分档来料检验', type: 'correct', owner: 'SQE' },
      { action: '增加电芯容量来料抽检与放电校验', type: 'prevent', owner: 'IQC' },
    ],
  },
];

const FALLBACK_CAUSE: CauseTemplate = {
  match: [],
  cause: '工艺参数与作业一致性待核',
  dimension: '法',
  likelihood: 'medium',
  evidence: '暂无强指向证据，优先核对工艺参数与作业一致性。',
  solutions: [
    { action: '复核相关工艺参数与作业指导书', type: 'correct', owner: '工艺工程师' },
    { action: '建立关键参数点检与记录', type: 'prevent', owner: '工艺工程师' },
  ],
};

/** 启发式根因（兜底）：按关键词命中模板，至少 2 条、最多 4 条、尽量跨维度。 */
export function buildHeuristicCauses(text: string, mkId: MkId): PossibleCause[] {
  const haystack = text.toLowerCase();
  const matched: CauseTemplate[] = [];
  const usedDimensions = new Set<CauseDimension>();
  for (const tpl of CAUSE_TEMPLATES) {
    if (tpl.match.some((m) => haystack.includes(m.toLowerCase()))) matched.push(tpl);
  }
  const picked: CauseTemplate[] = [];
  for (const tpl of matched) {
    if (picked.length >= 4) break;
    picked.push(tpl);
    usedDimensions.add(tpl.dimension);
  }
  if (picked.length === 0) picked.push(FALLBACK_CAUSE);
  if (picked.length === 1) {
    const extra = CAUSE_TEMPLATES.find((t) => !usedDimensions.has(t.dimension)) || FALLBACK_CAUSE;
    picked.push(extra);
  }
  return picked.map((tpl, idx): PossibleCause => {
    const likelihood: Likelihood = idx === 0 ? tpl.likelihood : idx === 1 ? 'medium' : 'low';
    return {
      id: mkId('pc'),
      cause: tpl.cause,
      dimension: tpl.dimension,
      likelihood,
      evidence: tpl.evidence,
      solutions: tpl.solutions.map(
        (s): Solution => ({ id: mkId('sol'), action: s.action, type: s.type, owner: s.owner }),
      ),
    };
  });
}

export function summarize(causes: PossibleCause[]): string {
  if (causes.length === 0) return '暂无可用分析。';
  const top = causes[0];
  const order = causes.map((c) => `${c.dimension}·${c.cause}`).join(' → ');
  return `最可能方向：${top.dimension}（${top.cause}）。建议排查顺序：${order}。`;
}

// ── AI 结构化输出 ─────────────────────────────────────────────────────────────
const VALID_DIMENSIONS = new Set<string>(CAUSE_DIMENSIONS);
const VALID_LIKELIHOOD = new Set<string>(['high', 'medium', 'low']);
const VALID_SOLUTION_TYPE = new Set<string>(['contain', 'correct', 'prevent']);

export function buildAnalysisSystemPrompt(systemPrompt?: string): string {
  return [
    systemPrompt?.trim() ||
      '你是资深质量工程师，基于 6M（人机料法环测）对问题做根因论证并给出可执行方案。',
    '',
    '【输出要求 — 严格遵守】只输出一个 JSON 对象，不要任何额外文字、解释或 markdown 代码块围栏。结构如下：',
    '{',
    '  "possibleCauses": [',
    '    {',
    '      "cause": "原因标题（简洁）",',
    '      "dimension": "人|机|料|法|环|测 其中之一",',
    '      "likelihood": "high|medium|low",',
    '      "evidence": "为什么怀疑这个（结合现象/数据）",',
    '      "solutions": [',
    '        { "action": "可执行动作", "type": "contain|correct|prevent", "owner": "建议责任岗位" }',
    '      ]',
    '    }',
    '  ],',
    '  "summary": "一句话：最可能方向 + 建议排查顺序"',
    '}',
    '',
    '约束：possibleCauses 给 2~5 条、尽量跨不同 6M 维度、按可能性从高到低排列；每条至少 1 个 solution，覆盖临时遏制(contain)/长期纠正(correct)/预防(prevent)。dimension 必须是 6M 中文单字之一。',
  ].join('\n');
}

/** 把问题与历史/对话上下文拼成用户提示。 */
export function buildAnalysisUserPrompt(input: {
  title: string;
  description: string;
  source: string;
  product?: string | null;
  batch?: string | null;
  station?: string | null;
  severity: string;
  defectRate?: string | null;
  attachmentsText?: string;
  history?: string;
  followUp?: string;
}): string {
  const lines: string[] = ['【问题信息】'];
  lines.push(`标题：${input.title}`);
  lines.push(`描述：${input.description}`);
  lines.push(`来源：${input.source === 'production' ? '生产' : '研发'}`);
  if (input.product) lines.push(`产品：${input.product}`);
  if (input.batch) lines.push(`批次：${input.batch}`);
  if (input.station) lines.push(`工位/环节：${input.station}`);
  lines.push(`严重度：${input.severity}`);
  if (input.defectRate) lines.push(`不良率：${input.defectRate}`);
  if (input.attachmentsText) {
    lines.push('', '【附件提取内容】', input.attachmentsText);
  }
  if (input.history) {
    lines.push('', '【已有分析与沟通（按时间）】', input.history);
  }
  if (input.followUp) {
    lines.push('', '【本轮新增反馈/补充，请据此更新分析】', input.followUp);
  }
  lines.push('', '请基于以上信息，按系统要求输出 6M 根因分析 JSON。');
  return lines.join('\n');
}

/** 容错解析 AI 返回的 JSON 为 RootCauseAnalysis；非法/缺失字段被丢弃。解析不出任何 cause 返回 null。 */
export function parseAnalysisContent(raw: string, mkId: MkId): RootCauseAnalysis | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const rawCauses = Array.isArray(obj.possibleCauses) ? obj.possibleCauses : [];
  const possibleCauses: PossibleCause[] = [];
  for (const rc of rawCauses) {
    if (!rc || typeof rc !== 'object') continue;
    const c = rc as Record<string, unknown>;
    const cause = typeof c.cause === 'string' ? c.cause.trim() : '';
    const dimension = typeof c.dimension === 'string' ? c.dimension.trim() : '';
    if (!cause || !VALID_DIMENSIONS.has(dimension)) continue;
    const likelihood = VALID_LIKELIHOOD.has(String(c.likelihood)) ? (c.likelihood as Likelihood) : 'medium';
    const evidence = typeof c.evidence === 'string' ? c.evidence.trim() : '';
    const rawSolutions = Array.isArray(c.solutions) ? c.solutions : [];
    const solutions: Solution[] = [];
    for (const rs of rawSolutions) {
      if (!rs || typeof rs !== 'object') continue;
      const s = rs as Record<string, unknown>;
      const action = typeof s.action === 'string' ? s.action.trim() : '';
      if (!action) continue;
      const type = VALID_SOLUTION_TYPE.has(String(s.type)) ? (s.type as SolutionType) : 'correct';
      const owner = typeof s.owner === 'string' && s.owner.trim() ? s.owner.trim() : undefined;
      solutions.push({ id: mkId('sol'), action, type, owner });
    }
    if (solutions.length === 0) {
      solutions.push({ id: mkId('sol'), action: '复核相关工艺参数与作业指导书', type: 'correct' });
    }
    possibleCauses.push({
      id: mkId('pc'),
      cause,
      dimension: dimension as CauseDimension,
      likelihood,
      evidence,
      solutions,
    });
  }
  if (possibleCauses.length === 0) return null;
  const summary =
    typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : summarize(possibleCauses);
  return { possibleCauses, summary, referencedCases: [] };
}

/** 从 LLM 文本里抠出第一个完整 JSON 对象（容忍 ```json 围栏与前后噪声）。 */
function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
