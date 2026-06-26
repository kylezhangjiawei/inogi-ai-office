/**
 * 问题记录与 AI 定位模块 — 内存实现的 IssueService。
 *
 * 由 MODULE-LEVEL 可变 store（从 SEED_ISSUES 深拷贝）支撑，
 * 故 create/adopt/adjust/analyze 等变更会在整个会话内、清单↔详情来回导航间持久保留。
 *
 * 约束：纯 TS，无新依赖；模块顶层不调用 Date.now()/new Date()/Math.random()。
 * id 用确定性计数器；create/analyze/adjust 内的时间戳取自 store 中已有的最新时间戳并自增，
 * 以避免在脚本/SSR 环境调用 new Date()。
 */
import { SEED_ISSUES } from "./mockData";
import {
  CAUSE_DIMENSIONS,
  isReusableIssue,
  type AnalysisVersion,
  type CauseDimension,
  type DimensionStat,
  type Issue,
  type IssueMessage,
  type IssueQuery,
  type IssueService,
  type IssueStats,
  type Likelihood,
  type NewIssueInput,
  type Paged,
  type PossibleCause,
  type RootCauseAnalysis,
  type SimilarMatch,
  type Solution,
  type SolutionType,
} from "./types";
import { SEVERITY_WEIGHT, statusGroupOf } from "./config";

// ── module-level mutable store ───────────────────────────────────────────────
const store: Issue[] = deepClone(SEED_ISSUES);

// 编号自增计数器（基于种子里最大的 NCR-2406-0NN 序号推导）。
let issueSeq = computeMaxIssueSeq(store);
// 各类 id 的单调自增计数器（确定性）。
let idCounter = 1000;

// ── 工具函数 ─────────────────────────────────────────────────────────────────
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function computeMaxIssueSeq(items: Issue[]): number {
  let max = 0;
  for (const it of items) {
    const m = /NCR-\d{4}-(\d+)/.exec(it.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function nextIssueId(): string {
  issueSeq += 1;
  return `NCR-2406-${String(issueSeq).padStart(3, "0")}`;
}

/**
 * 取当前 store 里最新的时间戳并 +N 分钟，得到一个新的 ISO 字符串。
 * 避免顶层/方法内调用 new Date()（满足"脚本不能 new Date()"约束）。
 */
function nextTimestamp(addMinutes = 1): string {
  let latestMs = 0;
  for (const it of store) {
    const t = Date.parse(it.updatedAt);
    if (!Number.isNaN(t)) latestMs = Math.max(latestMs, t);
    const c = Date.parse(it.createdAt);
    if (!Number.isNaN(c)) latestMs = Math.max(latestMs, c);
  }
  if (latestMs === 0) latestMs = Date.parse("2026-06-24T00:00:00+08:00");
  return new Date(latestMs + addMinutes * 60_000).toISOString();
}

function latestAnalysis(issue: Issue): AnalysisVersion | undefined {
  if (issue.analyses.length === 0) return undefined;
  return issue.analyses.reduce((a, b) => (b.version > a.version ? b : a));
}

// ── 关键词分词（简易，中英文混合）─────────────────────────────────────────────
const STOP_TOKENS = new Set([
  "的", "了", "在", "与", "和", "及", "或", "对", "为", "是", "有", "无", "等",
  "导致", "出现", "存在", "怀疑", "疑似", "可能", "由于", "造成", "问题", "现象",
]);

function tokenize(text: string): string[] {
  const out: string[] = [];
  // 英文/数字串
  const ascii = text.match(/[A-Za-z0-9][A-Za-z0-9.\-]*/g) || [];
  for (const w of ascii) {
    const t = w.toLowerCase();
    if (t.length >= 2) out.push(t);
  }
  // 中文：以 2-gram 切分（落地用关键词重叠足够）
  const han = text.match(/[一-龥]+/g) || [];
  for (const seg of han) {
    if (seg.length <= 1) continue;
    for (let i = 0; i + 2 <= seg.length; i += 1) {
      const bi = seg.slice(i, i + 2);
      if (!STOP_TOKENS.has(bi)) out.push(bi);
    }
    // 也保留 3-4 字常见词整体
    if (seg.length <= 4 && !STOP_TOKENS.has(seg)) out.push(seg);
  }
  return out;
}

function deriveKeywords(title: string, description: string): string[] {
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

// ── 相似度评分 ───────────────────────────────────────────────────────────────
function overlapScore(inputTokens: Set<string>, issue: Issue): number {
  if (inputTokens.size === 0) return 0;
  const target = new Set<string>();
  for (const k of issue.keywords || []) target.add(k.toLowerCase());
  for (const t of tokenize(issue.title)) target.add(t);
  if (target.size === 0) return 0;
  let hit = 0;
  for (const t of inputTokens) if (target.has(t)) hit += 1;
  // 以 min(集合大小) 归一，避免长描述稀释
  return hit / Math.min(inputTokens.size, target.size);
}

function adoptedSolutionSummary(
  issue: Issue,
): { cause: string; action: string; type: SolutionType } | undefined {
  const ad = issue.adopted;
  if (!ad) return undefined;
  if (ad.kind === "reuse") {
    const src = store.find((i) => i.id === ad.reusedFrom);
    if (src) return adoptedSolutionSummary(src);
    return undefined;
  }
  const av = issue.analyses.find((a) => a.isAdopted) || latestAnalysis(issue);
  if (!av) return undefined;
  const cause = av.content.possibleCauses.find((c) => c.id === ad.causeId);
  if (!cause) return undefined;
  const sol = cause.solutions.find((s) => s.id === ad.solutionId) || cause.solutions[0];
  if (!sol) return undefined;
  return { cause: cause.cause, action: sol.action, type: sol.type };
}

// ── 启发式：keyword → (dimension, cause, solutions) 映射，用于 analyze 仿真 ───────
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
    match: ["浓度", "氧浓度", "制氧", "分子筛", "粉化", "受潮", "吸附"],
    cause: "分子筛受潮/老化致吸附能力下降",
    dimension: "料",
    likelihood: "high",
    evidence: "氧浓度衰减与分子筛吸附性能直接相关，进气端易受潮粉化。",
    solutions: [
      { action: "隔离可疑批次分子筛并复测浓度", type: "contain", owner: "质量工程师" },
      { action: "前置增设干燥过滤并固化干燥工艺", type: "correct", owner: "工艺工程师" },
      { action: "增加分子筛吸附指标来料验收", type: "prevent", owner: "SQE" },
    ],
  },
  {
    match: ["气路", "流量", "切换", "psa"],
    cause: "气路/PSA 切换时序异常",
    dimension: "法",
    likelihood: "medium",
    evidence: "浓度波动与产气流量相关，疑 PSA 切换时序或气路阻力异常。",
    solutions: [
      { action: "复核 PSA 切换时序与气路压损", type: "correct", owner: "研发工程师" },
    ],
  },
  {
    match: ["噪音", "分贝", "嗡鸣", "共振", "风道"],
    cause: "压缩机减振不足/风道共振",
    dimension: "机",
    likelihood: "high",
    evidence: "低频嗡鸣为典型减振或风道共振特征。",
    solutions: [
      { action: "更换减振垫并临时隔振观察噪音", type: "contain", owner: "结构工程师" },
      { action: "优化减振结构与风道避开共振频段", type: "correct", owner: "结构工程师" },
    ],
  },
  {
    match: ["电磁阀", "漏气", "气密", "泄漏", "密封"],
    cause: "电磁阀密封件不良致泄漏",
    dimension: "料",
    likelihood: "high",
    evidence: "气密不良集中于阀口，密封件批次或材质存疑。",
    solutions: [
      { action: "隔离可疑密封件批次并全检", type: "contain", owner: "质量工程师" },
      { action: "更换合格密封件并要求材质证明", type: "correct", owner: "SQE" },
    ],
  },
  {
    match: ["压缩机", "过热", "过温", "散热", "高温"],
    cause: "散热风道风量不足",
    dimension: "法",
    likelihood: "high",
    evidence: "缸体温升异常，散热风道设计风量可能不足。",
    solutions: [
      { action: "临时加装导流罩观察温降", type: "contain", owner: "结构工程师" },
      { action: "优化风道并提升风扇转速曲线", type: "correct", owner: "结构工程师" },
    ],
  },
  {
    match: ["润滑", "脂", "碳化"],
    cause: "润滑脂耐温等级不足",
    dimension: "料",
    likelihood: "medium",
    evidence: "高温运行后润滑脂碳化，疑耐温等级偏低。",
    solutions: [
      { action: "改用高温润滑脂并复测温升", type: "correct", owner: "工艺工程师" },
      { action: "在 BOM 中锁定润滑脂耐温要求", type: "prevent", owner: "研发" },
    ],
  },
  {
    match: ["pcba", "虚焊", "焊点", "回流", "锡膏", "smt", "aoi"],
    cause: "回流焊温度曲线偏离致虚焊",
    dimension: "机",
    likelihood: "high",
    evidence: "虚焊集中在大热容区，疑回流峰值温度不足。",
    solutions: [
      { action: "停线复核并重打回流炉温曲线", type: "contain", owner: "SMT 工程师" },
      { action: "优化回流温区设定并固化炉温档案", type: "correct", owner: "SMT 工程师" },
      { action: "建立每班炉温点检与 SPC 监控", type: "prevent", owner: "工艺工程师" },
    ],
  },
  {
    match: ["传感器", "漂移", "标定", "校准", "偏差"],
    cause: "标定基准设备漂移未及时校准",
    dimension: "测",
    likelihood: "high",
    evidence: "多台样机方向一致偏移，强烈指向标定基准本身。",
    solutions: [
      { action: "暂停标定并送检基准设备", type: "contain", owner: "计量员" },
      { action: "校准基准并重做受影响批次标定", type: "correct", owner: "计量/工艺" },
      { action: "建立基准设备周期校准与到期提醒", type: "prevent", owner: "计量室" },
    ],
  },
  {
    match: ["外壳", "缩水", "注塑", "保压", "壁厚", "成型", "模具"],
    cause: "注塑保压压力/时间不足",
    dimension: "法",
    likelihood: "high",
    evidence: "缩水固定于厚壁区，典型保压不足特征。",
    solutions: [
      { action: "优化保压曲线（提高保压压力并延长保压时间）", type: "correct", owner: "注塑工程师" },
      { action: "建立注塑参数档案与首件确认", type: "prevent", owner: "工艺工程师" },
    ],
  },
  {
    match: ["高湿", "凝露", "湿度", "防潮", "环境"],
    cause: "高湿环境致面板凝露",
    dimension: "环",
    likelihood: "high",
    evidence: "仅高湿环境复现，凝露出现在面板温差区。",
    solutions: [
      { action: "增加防潮垫片临时观察凝露", type: "contain", owner: "结构工程师" },
      { action: "优化面板密封并增加防潮设计", type: "correct", owner: "结构工程师" },
      { action: "在环境规格中明确使用湿度上限", type: "prevent", owner: "研发" },
    ],
  },
  {
    match: ["漏装", "防错", "防呆", "装配", "作业指导", "培训"],
    cause: "装配工位缺乏防错措施",
    dimension: "人",
    likelihood: "high",
    evidence: "漏装集中在特定班次，缺防错点检，依赖人工记忆。",
    solutions: [
      { action: "终检增加专项全检（临时遏制）", type: "contain", owner: "终检班长" },
      { action: "增加防错治具与装配到位检测", type: "prevent", owner: "工艺工程师" },
    ],
  },
  {
    match: ["电芯", "电池", "续航", "容量", "功耗"],
    cause: "电芯实际容量低于标称",
    dimension: "料",
    likelihood: "high",
    evidence: "电芯放电容量低于标称且批次一致偏低。",
    solutions: [
      { action: "更换合格电芯供应商并按容量分档来料检验", type: "correct", owner: "SQE" },
      { action: "增加电芯容量来料抽检与放电校验", type: "prevent", owner: "IQC" },
    ],
  },
];

const FALLBACK_CAUSE: CauseTemplate = {
  match: [],
  cause: "工艺参数与作业一致性待核",
  dimension: "法",
  likelihood: "medium",
  evidence: "暂无强指向证据，优先核对工艺参数与作业一致性。",
  solutions: [
    { action: "复核相关工艺参数与作业指导书", type: "correct", owner: "工艺工程师" },
    { action: "建立关键参数点检与记录", type: "prevent", owner: "工艺工程师" },
  ],
};

function buildCauses(issue: Issue): PossibleCause[] {
  const haystack = `${issue.title} ${issue.description} ${(issue.keywords || []).join(" ")}`.toLowerCase();
  const matched: CauseTemplate[] = [];
  const usedDimensions = new Set<CauseDimension>();
  for (const tpl of CAUSE_TEMPLATES) {
    if (tpl.match.some((m) => haystack.includes(m.toLowerCase()))) {
      matched.push(tpl);
    }
  }
  // 至少 2 条，最多 4 条，尽量跨维度
  const picked: CauseTemplate[] = [];
  for (const tpl of matched) {
    if (picked.length >= 4) break;
    picked.push(tpl);
    usedDimensions.add(tpl.dimension);
  }
  if (picked.length === 0) picked.push(FALLBACK_CAUSE);
  // 若只命中 1 条，补一个不同维度的兜底，保证多维展示
  if (picked.length === 1) {
    const extra = CAUSE_TEMPLATES.find((t) => !usedDimensions.has(t.dimension)) || FALLBACK_CAUSE;
    picked.push(extra);
  }

  return picked.map((tpl, idx): PossibleCause => {
    const likelihood: Likelihood = idx === 0 ? tpl.likelihood : idx === 1 ? "medium" : "low";
    const cid = nextId("pc");
    return {
      id: cid,
      cause: tpl.cause,
      dimension: tpl.dimension,
      likelihood,
      evidence: tpl.evidence,
      solutions: tpl.solutions.map((s): Solution => ({
        id: nextId("sol"),
        action: s.action,
        type: s.type,
        owner: s.owner,
      })),
    };
  });
}

function summarize(causes: PossibleCause[]): string {
  const top = causes[0];
  const order = causes.map((c) => `${c.dimension}·${c.cause}`).join(" → ");
  return `最可能方向：${top.dimension}（${top.cause}）。建议排查顺序：${order}。`;
}

// ── service 实现 ─────────────────────────────────────────────────────────────
export function createIssueService(): IssueService {
  const list = async (query: IssueQuery): Promise<Paged<Issue>> => {
    const q = query || {};
    let items = store.slice();

    // statusGroup
    if (q.statusGroup && q.statusGroup !== "all") {
      if (q.statusGroup === "reusable") {
        items = items.filter((i) => isReusableIssue(i));
      } else {
        items = items.filter((i) => statusGroupOf(i.status) === q.statusGroup);
      }
    }
    if (q.severity) items = items.filter((i) => i.severity === q.severity);
    if (q.source) items = items.filter((i) => i.source === q.source);
    if (q.product) items = items.filter((i) => i.product === q.product);

    if (q.dimension) {
      items = items.filter((i) => {
        const av = latestAnalysis(i);
        return !!av && av.content.possibleCauses.some((c) => c.dimension === q.dimension);
      });
    }
    if (q.specificCause) {
      items = items.filter((i) => {
        const av = latestAnalysis(i);
        return !!av && av.content.possibleCauses.some((c) => c.cause === q.specificCause);
      });
    }
    if (q.search && q.search.trim()) {
      const s = q.search.trim().toLowerCase();
      items = items.filter((i) =>
        i.id.toLowerCase().includes(s) ||
        i.title.toLowerCase().includes(s) ||
        (i.product || "").toLowerCase().includes(s) ||
        i.description.toLowerCase().includes(s),
      );
    }

    // 排序：最新 updatedAt 优先；并列时按严重度权重降序
    items.sort((a, b) => {
      const ta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      if (ta !== 0) return ta;
      return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    });

    const page = Math.max(1, q.page || 1);
    const pageSize = Math.max(1, q.pageSize || 6);
    const total = items.length;
    const start = (page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    return { items: deepClone(slice), total, page, pageSize };
  };

  const get = async (id: string): Promise<Issue> => {
    const found = store.find((i) => i.id === id);
    if (!found) throw new Error(`Issue not found: ${id}`);
    return deepClone(found);
  };

  const create = async (input: NewIssueInput): Promise<Issue> => {
    const id = nextIssueId();
    const ts = nextTimestamp(1);
    const issue: Issue = {
      id,
      title: input.title,
      description: input.description,
      source: input.source,
      product: input.product,
      batch: input.batch,
      station: input.station,
      severity: input.severity,
      defectRate: input.defectRate,
      status: "pending",
      keywords: deriveKeywords(input.title, input.description),
      createdBy: "当前用户",
      createdAt: ts,
      updatedAt: ts,
      attachments: (input.attachments || []).map((a) => ({
        id: nextId("att"),
        fileName: a.fileName,
        fileUrl: a.fileUrl,
        fileType: a.fileType,
        extractedText: a.extractedText,
        uploadedBy: "当前用户",
        uploadedAt: ts,
      })),
      analyses: [],
      messages: [],
    };
    store.unshift(issue);
    return deepClone(issue);
  };

  const findSimilar = async (input: NewIssueInput): Promise<SimilarMatch[]> => {
    const inputTokens = new Set(tokenize(`${input.title} ${input.description}`));
    const reusable = store.filter((i) => isReusableIssue(i));
    const scored: SimilarMatch[] = [];
    for (const issue of reusable) {
      const score = overlapScore(inputTokens, issue);
      if (score >= 0.18) {
        scored.push({
          issue: deepClone(issue),
          score: Math.round(score * 100) / 100,
          adoptedSolution: adoptedSolutionSummary(issue),
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5);
  };

  const analyze = async (id: string): Promise<AnalysisVersion> => {
    const issue = store.find((i) => i.id === id);
    if (!issue) throw new Error(`Issue not found: ${id}`);

    await new Promise((r) => setTimeout(r, 700));

    const causes = buildCauses(issue);
    // 参考相似的可复用历史问题
    const inputTokens = new Set(tokenize(`${issue.title} ${issue.description}`));
    const referencedCases = store
      .filter((i) => i.id !== issue.id && isReusableIssue(i))
      .filter((i) => overlapScore(inputTokens, i) >= 0.18)
      .slice(0, 3)
      .map((i) => i.id);

    const hadAnalyses = issue.analyses.length > 0;
    const prev = latestAnalysis(issue);
    const version = (prev?.version || 0) + 1;
    const content: RootCauseAnalysis = {
      possibleCauses: causes,
      summary: summarize(causes),
      referencedCases,
    };
    const ts = nextTimestamp(1);
    const av: AnalysisVersion = {
      id: nextId("av"),
      version,
      content,
      summary: content.summary,
      model: "gpt-4o-mock",
      triggerType: hadAnalyses ? "adjustment" : "initial",
      basedOnVersion: hadAnalyses ? prev?.version : undefined,
      createdBy: "system",
      createdAt: ts,
      isAdopted: false,
    };
    issue.analyses.push(av);
    issue.status = hadAnalyses ? "adjusting" : "analyzing";
    issue.updatedAt = ts;

    const seq = (issue.messages[issue.messages.length - 1]?.seq || 0) + 1;
    issue.messages.push({
      id: nextId("msg"),
      seq,
      role: "assistant",
      content: hadAnalyses
        ? `已重新生成分析（v${version}）：${content.summary}`
        : `已生成初版根因分析（v${version}）：${content.summary}`,
      analysisVersionId: av.id,
      createdAt: ts,
    });

    return deepClone(av);
  };

  const adjust = async (
    id: string,
    message: string,
  ): Promise<{ message: IssueMessage; analysis: AnalysisVersion }> => {
    const issue = store.find((i) => i.id === id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    const prev = latestAnalysis(issue);
    if (!prev) throw new Error(`No analysis to adjust for: ${id}`);

    await new Promise((r) => setTimeout(r, 700));

    // 1) 追加 user 留痕
    const tsUser = nextTimestamp(1);
    const seqUser = (issue.messages[issue.messages.length - 1]?.seq || 0) + 1;
    const userMessage: IssueMessage = {
      id: nextId("msg"),
      seq: seqUser,
      role: "user",
      content: message,
      operator: "当前用户",
      createdAt: tsUser,
    };
    issue.messages.push(userMessage);

    // 2) 克隆上一版内容并施加一个合理的小变更（由 message 驱动）
    const cloned = deepClone(prev.content);
    const msgTokens = new Set(tokenize(message));
    let mutated = false;

    // a) 若 message 命中某条已有 cause 的关键词，则提升其 likelihood
    for (const c of cloned.possibleCauses) {
      const cTokens = new Set(tokenize(`${c.cause} ${c.evidence}`));
      let hit = false;
      for (const t of msgTokens) if (cTokens.has(t)) { hit = true; break; }
      if (hit && c.likelihood !== "high") {
        c.likelihood = c.likelihood === "low" ? "medium" : "high";
        c.evidence = `${c.evidence}（依据反馈"${message}"上调可能性）`;
        mutated = true;
        break;
      }
    }

    // b) 若 message 引出新的模板维度，则追加一条新 cause
    const haystack = message.toLowerCase();
    const existingDims = new Set(cloned.possibleCauses.map((c) => c.dimension));
    const newTpl = CAUSE_TEMPLATES.find(
      (t) => t.match.some((m) => haystack.includes(m.toLowerCase())) && !existingDims.has(t.dimension),
    );
    if (newTpl) {
      cloned.possibleCauses.push({
        id: nextId("pc"),
        cause: newTpl.cause,
        dimension: newTpl.dimension,
        likelihood: "medium",
        evidence: `${newTpl.evidence}（据用户补充"${message}"新增）`,
        solutions: newTpl.solutions.map((s): Solution => ({
          id: nextId("sol"),
          action: s.action,
          type: s.type,
          owner: s.owner,
        })),
      });
      mutated = true;
    }

    // c) 兜底：未触发任何变更时，给最高可能性的 cause 追加一条预防方案
    if (!mutated && cloned.possibleCauses.length > 0) {
      const target = cloned.possibleCauses[0];
      target.solutions.push({
        id: nextId("sol"),
        action: `结合反馈"${message}"补充预防措施并固化到作业文件`,
        type: "prevent",
        owner: "工艺工程师",
      });
    }
    cloned.summary = summarize(cloned.possibleCauses);

    // 3) 产生新的 AnalysisVersion
    const ts = nextTimestamp(2);
    const av: AnalysisVersion = {
      id: nextId("av"),
      version: prev.version + 1,
      content: cloned,
      summary: cloned.summary,
      model: "gpt-4o-mock",
      triggerType: "adjustment",
      basedOnVersion: prev.version,
      createdBy: "system",
      createdAt: ts,
      isAdopted: false,
    };
    issue.analyses.push(av);
    issue.status = "adjusting";
    issue.updatedAt = ts;

    // 4) 追加 assistant 留痕（关联新版本）
    const assistantMessage: IssueMessage = {
      id: nextId("msg"),
      seq: seqUser + 1,
      role: "assistant",
      content: `已根据反馈更新分析（v${av.version}）：${cloned.summary}`,
      analysisVersionId: av.id,
      createdAt: ts,
    };
    issue.messages.push(assistantMessage);

    return { message: deepClone(assistantMessage), analysis: deepClone(av) };
  };

  const adopt = async (id: string, ref: Issue["adopted"]): Promise<Issue> => {
    const issue = store.find((i) => i.id === id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    if (!ref) throw new Error(`adopt requires a ref`);

    const ts = nextTimestamp(1);
    issue.adopted = ref;
    issue.status = "adopted";
    issue.updatedAt = ts;

    let content: string;
    if (ref.kind === "analysis") {
      // 标记被引用版本为已采纳。
      // 注意：调整版本会沿用上一版的 cause id，故同一 causeId 可能存在于多个版本；
      // 优先认定"最新且包含该 cause 的版本"为采纳版本，符合用户当前查看的语义。
      const matching = issue.analyses.filter((a) =>
        a.content.possibleCauses.some((c) => c.id === ref.causeId),
      );
      const av =
        matching.length > 0
          ? matching.reduce((x, y) => (y.version > x.version ? y : x))
          : latestAnalysis(issue);
      if (av) {
        for (const a of issue.analyses) a.isAdopted = false;
        av.isAdopted = true;
      }
      const summary = adoptedSolutionSummary(issue);
      content = summary
        ? `已采纳方案：${summary.cause} → ${summary.action}`
        : `已采纳方案。`;
    } else {
      const src = store.find((i) => i.id === ref.reusedFrom);
      const summary = src ? adoptedSolutionSummary(src) : undefined;
      content = summary
        ? `复用自 ${ref.reusedFrom}：${summary.cause} → ${summary.action}`
        : `复用自 ${ref.reusedFrom}。`;
    }

    const seq = (issue.messages[issue.messages.length - 1]?.seq || 0) + 1;
    issue.messages.push({
      id: nextId("msg"),
      seq,
      role: "assistant",
      content,
      createdAt: ts,
    });

    return deepClone(issue);
  };

  const stats = async (): Promise<IssueStats> => {
    const total = store.length;
    let pending = 0;
    let solved = 0;
    let reuseAdopted = 0;
    let locateHoursSum = 0;
    let solvedWithTime = 0;
    for (const i of store) {
      if (i.status === "pending" || i.status === "analyzing" || i.status === "adjusting") pending += 1;
      if (i.status === "adopted" || i.status === "archived") {
        solved += 1;
        if (i.adopted?.kind === "reuse") reuseAdopted += 1;
        const c = Date.parse(i.createdAt);
        const u = Date.parse(i.updatedAt);
        if (!Number.isNaN(c) && !Number.isNaN(u) && u >= c) {
          locateHoursSum += (u - c) / 3_600_000;
          solvedWithTime += 1;
        }
      }
    }
    const reuseRate = solved > 0 ? reuseAdopted / solved : 0;
    const avgLocateHours = solvedWithTime > 0
      ? Math.round((locateHoursSum / solvedWithTime) * 10) / 10
      : 0;
    return {
      total,
      pending,
      solved,
      reuseRate: Math.round(reuseRate * 100) / 100,
      avgLocateHours,
    };
  };

  const dimensionStats = async (): Promise<DimensionStat[]> => {
    const dimCount = new Map<CauseDimension, number>();
    const dimSpecifics = new Map<CauseDimension, Map<string, number>>();
    for (const d of CAUSE_DIMENSIONS) {
      dimCount.set(d, 0);
      dimSpecifics.set(d, new Map());
    }
    for (const issue of store) {
      const av = latestAnalysis(issue);
      if (!av) continue;
      for (const c of av.content.possibleCauses) {
        dimCount.set(c.dimension, (dimCount.get(c.dimension) || 0) + 1);
        const m = dimSpecifics.get(c.dimension)!;
        m.set(c.cause, (m.get(c.cause) || 0) + 1);
      }
    }
    return CAUSE_DIMENSIONS.map((d): DimensionStat => {
      const specifics = Array.from(dimSpecifics.get(d)!.entries())
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count);
      return { dimension: d, count: dimCount.get(d) || 0, specifics };
    });
  };

  const productOptions = async (): Promise<string[]> => {
    const set = new Set<string>();
    for (const i of store) if (i.product && i.product.trim()) set.add(i.product);
    return Array.from(set).sort();
  };

  // ── 沟通与 AI（mock；真实接入仅替换以下实现，对外接口保持不变）──────────────────
  // AI 配置（模块内单例 mock；真实接入由后端集成管理提供模型/OCR）。
  let aiConfig: AiConfig = {
    model: "gpt-4o-mini",
    temperature: 0.3,
    systemPrompt:
      "你是资深质量工程师，基于 6M（人机料法环测）对问题做根因论证并给出可执行方案。",
    attachmentMode: "ai",
  };

  /** 发送沟通消息（多用户共用同一会话、连续上下文；可带附件）。【真实 AI 接入点】 */
  const sendChat = async (id: string, input: SendChatInput): Promise<SendChatResult> => {
    const issue = store.find((i) => i.id === id);
    if (!issue) throw new Error(`Issue not found: ${id}`);

    const tsUser = nextTimestamp();
    const userMessage: IssueMessage = {
      id: nextId("msg"),
      seq: issue.messages.length + 1,
      role: "user",
      content: input.content,
      author: input.author,
      operator: input.author.name,
      attachments: input.attachments,
      createdAt: tsUser,
    };
    issue.messages.push(userMessage);

    const attachNote = input.attachments?.length
      ? `（已识别 ${input.attachments.length} 个附件的内容）`
      : "";

    // mock：本轮沟通推进论证，可能催生新分析版本（左侧结论据此更新）
    const prev = latestAnalysis(issue);
    let analysis: AnalysisVersion | undefined;
    if (prev) {
      const ts = nextTimestamp();
      const added: PossibleCause[] = [
        {
          id: nextId("pc"),
          cause: "需结合本轮沟通进一步确认",
          dimension: "法",
          likelihood: "low",
          evidence: `「${input.author.name}」补充：「${input.content}」${attachNote}`,
          solutions: [{ id: nextId("sol"), action: "按沟通要点复核并采集数据", type: "contain" }],
        },
      ];
      const merged = [...prev.content.possibleCauses, ...added];
      analysis = {
        id: nextId("av"),
        version: issue.analyses.length + 1,
        content: {
          possibleCauses: merged,
          summary: summarize(merged),
          referencedCases: prev.content.referencedCases,
        },
        summary: summarize(merged),
        model: aiConfig.model,
        triggerType: "adjustment",
        basedOnVersion: prev.version,
        createdBy: "AI",
        createdAt: ts,
        isAdopted: false,
      };
      issue.analyses.push(analysis);
      issue.status = "adjusting";
    }

    const aiMessage: IssueMessage = {
      id: nextId("msg"),
      seq: issue.messages.length + 1,
      role: "assistant",
      content: analysis
        ? `收到${attachNote}。已结合上下文更新论证（v${analysis.version}）。`
        : `收到${attachNote}。已记录，请继续补充信息以便定位。`,
      analysisVersionId: analysis?.id,
      createdAt: nextTimestamp(),
    };
    issue.messages.push(aiMessage);

    return {
      userMessage: deepClone(userMessage),
      aiMessage: deepClone(aiMessage),
      analysis: analysis ? deepClone(analysis) : undefined,
    };
  };

  /** 对问题定性（是否已解决）。权限校验由调用方（前端）负责。 */
  const resolveIssue = async (
    id: string,
    input: { resolved: boolean; by: ChatUser; note?: string },
  ): Promise<Issue> => {
    const issue = store.find((i) => i.id === id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    const ts = nextTimestamp();
    issue.resolution = { resolved: input.resolved, by: input.by, at: ts, note: input.note };
    if (input.resolved) issue.status = "archived"; // 已解决 → 进知识库可复用
    issue.messages.push({
      id: nextId("msg"),
      seq: issue.messages.length + 1,
      role: "user",
      content: `判定问题${input.resolved ? "已解决" : "未解决"}${input.note ? `：${input.note}` : ""}`,
      author: input.by,
      operator: input.by.name,
      createdAt: ts,
    });
    return deepClone(issue);
  };

  /** 上传附件（mock 占位 URL）。【真实接入点：OSS/文件服务】 */
  const uploadAttachment = async (file: UploadFileInput): Promise<Attachment> => {
    return {
      id: nextId("att"),
      fileName: file.fileName,
      fileUrl: file.dataUrl ?? `mock://attachment/${nextId("f")}`,
      fileType: file.fileType,
      uploadedBy: "我",
      uploadedAt: nextTimestamp(),
    };
  };

  /** 附件识别适配：mode=ai 走多模态、ocr 走 OCR；回填 extractedText。【真实 AI/OCR 接入点】 */
  const processAttachment = async (
    att: Attachment,
    mode: AiConfig["attachmentMode"],
  ): Promise<Attachment> => {
    const extractedText =
      mode === "ocr"
        ? `[OCR 提取] ${att.fileName} 的文本内容（mock）`
        : `[AI 识别] ${att.fileName} 的语义理解（mock）`;
    return { ...att, extractedText };
  };

  const getAiConfig = async (): Promise<AiConfig> => ({ ...aiConfig });
  const setAiConfig = async (cfg: AiConfig): Promise<AiConfig> => {
    aiConfig = { ...cfg };
    return { ...aiConfig };
  };

  return {
    list,
    get,
    create,
    findSimilar,
    analyze,
    adjust,
    adopt,
    stats,
    dimensionStats,
    productOptions,
    sendChat,
    resolveIssue,
    uploadAttachment,
    processAttachment,
    getAiConfig,
    setAiConfig,
  };
}
