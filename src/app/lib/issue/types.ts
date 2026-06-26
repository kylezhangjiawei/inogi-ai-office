/**
 * 问题记录与 AI 定位模块 — 数据模型与服务契约（权威定义）。
 *
 * 设计原则（见开发规格 §2）：单一数据源（清单=问题库=知识库=概览，皆为同一份问题数据的视图）；
 * 留痕 append-only（messages / analyses 只增不改）；AI 输出结构化（6M 维度穷举）。
 * 代码用英文 key，UI 用中文标签（见 config.ts）。
 */

// ── 枚举 ───────────────────────────────────────────────────────────────────────
export type IssueSource = "rd" | "production"; // 研发 / 生产
export type Severity = "fatal" | "major" | "normal" | "minor"; // 致命/严重/一般/轻微
export type IssueStatus = "pending" | "analyzing" | "adjusting" | "adopted" | "archived";
// 待分析 / 分析中 / 调整中 / 已采纳 / 已归档
export type CauseDimension = "人" | "机" | "料" | "法" | "环" | "测"; // 6M，固定封闭集
export type SolutionType = "contain" | "correct" | "prevent"; // 临时遏制 / 长期纠正 / 预防
export type Likelihood = "high" | "medium" | "low"; // 可能性 高/中/低

/** 6M 维度的固定顺序（统计/展示永远按此序，永不增行）。 */
export const CAUSE_DIMENSIONS: CauseDimension[] = ["人", "机", "料", "法", "环", "测"];

// ── 主实体 ─────────────────────────────────────────────────────────────────────
export interface Issue {
  id: string; // 问题编号，如 "NCR-2406-018"
  title: string;
  description: string;
  source: IssueSource;

  // 人工初判字段（除 severity 外均可空，仅作记录字段）
  product?: string;
  batch?: string;
  station?: string;
  severity: Severity;
  defectRate?: string; // 不良率，如 "3.2%"

  status: IssueStatus;
  adopted?:
    | { kind: "analysis"; causeId: string; solutionId: string } // 采纳某次分析里的某条方案
    | { kind: "reuse"; reusedFrom: string }; // 直接复用某历史问题的方案

  keywords?: string[]; // 本期用于关键词重叠检索；真实环境改 embedding
  embedding?: number[];

  createdBy: string;
  createdAt: string; // ISO
  updatedAt: string;

  attachments: Attachment[];
  analyses: AnalysisVersion[]; // 分析版本快照（可对比、可采纳）
  messages: IssueMessage[]; // 对话留痕（append-only 审计流水）
}

export interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  extractedText?: string; // OCR / 解析出的文本，作为 AI 输入
  uploadedBy: string;
  uploadedAt: string;
}

/** 每次"生成 / 对话调整"都存一份结构化快照。 */
export interface AnalysisVersion {
  id: string;
  version: number; // 1, 2, 3...
  content: RootCauseAnalysis;
  summary: string;
  model: string;
  triggerType: "initial" | "adjustment";
  basedOnVersion?: number;
  createdBy: string; // 'system' 或操作人
  createdAt: string;
  isAdopted: boolean;
}

/** 对话留痕 = 审计流水，只增不改。 */
export interface IssueMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  operator?: string; // user 消息的操作人
  analysisVersionId?: string; // 若此消息产生了新的分析版本，则关联其 id
  createdAt: string;
}

// ── AI 结构化输出（§5.2）─────────────────────────────────────────────────────────
export interface RootCauseAnalysis {
  possibleCauses: PossibleCause[];
  summary: string; // 一句话：最可能方向 + 建议排查顺序
  referencedCases: string[]; // 命中并被参考的历史问题编号
}
export interface PossibleCause {
  id: string;
  cause: string; // 原因标题
  dimension: CauseDimension; // 6M 维度（强制归类）
  likelihood: Likelihood;
  evidence: string; // 为什么怀疑这个
  solutions: Solution[];
}
export interface Solution {
  id: string;
  action: string;
  type: SolutionType;
  owner?: string; // 建议责任岗位
}

// ── 派生视图（不是独立实体）────────────────────────────────────────────────────
/** "知识库" = 已解决（已采纳或已归档）的问题。 */
export function isReusableIssue(i: Issue): boolean {
  return i.status === "adopted" || i.status === "archived";
}

// ── 服务契约（§8）──────────────────────────────────────────────────────────────
export interface IssueQuery {
  /** 状态分段：all / pending / processing(分析中+调整中) / solved(已采纳+已归档) / reusable(可复用) */
  statusGroup?: "all" | "pending" | "processing" | "solved" | "reusable";
  severity?: Severity;
  source?: IssueSource;
  product?: string;
  /** 维度过滤：只看某 6M 维度下的问题。 */
  dimension?: CauseDimension;
  /** 具体根因过滤：精确到包含某条具体根因（按 cause 文本匹配）的问题。 */
  specificCause?: string;
  /** 搜索：标题 / 编号 / 产品 / 描述。 */
  search?: string;
  page?: number; // 从 1 开始
  pageSize?: number; // 默认 6
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NewIssueInput {
  title: string;
  description: string;
  source: IssueSource;
  severity: Severity;
  product?: string;
  batch?: string;
  station?: string;
  defectRate?: string;
  attachments?: Array<Pick<Attachment, "fileName" | "fileType" | "fileUrl" | "extractedText">>;
}

/** 查相似返回项：历史问题 + 匹配度 + 该问题的采纳方案摘要。 */
export interface SimilarMatch {
  issue: Issue;
  /** 0~1 匹配度。 */
  score: number;
  /** 该历史问题当前采纳的方案（用于"复用此方案"）。 */
  adoptedSolution?: { cause: string; action: string; type: SolutionType };
}

/** 概览统计带（§6.1）。 */
export interface IssueStats {
  total: number;
  pending: number; // 待处理（pending + analyzing + adjusting）
  solved: number; // 已解决（adopted + archived）
  reuseRate: number; // 方案复用率 0~1（reuse 采纳 / 已解决）
  avgLocateHours: number; // 平均定位时长（小时）
}

/** 某 6M 维度的统计 + 其下具体根因分布（§6.1 下钻）。 */
export interface DimensionStat {
  dimension: CauseDimension;
  count: number; // 该维度在所有已分析问题中出现的次数
  specifics: Array<{ cause: string; count: number }>; // 具体根因，按 count 降序
}

export interface IssueService {
  list(query: IssueQuery): Promise<Paged<Issue>>;
  get(id: string): Promise<Issue>;
  create(input: NewIssueInput): Promise<Issue>;
  findSimilar(input: NewIssueInput): Promise<SimilarMatch[]>; // 从 reusableIssues 检索
  analyze(id: string): Promise<AnalysisVersion>; // 触发 AI 根因分析（产出新版本）
  adjust(id: string, message: string): Promise<{ message: IssueMessage; analysis: AnalysisVersion }>; // 对话调整
  adopt(id: string, ref: Issue["adopted"]): Promise<Issue>; // 采纳 / 复用
  /** 概览统计（实时从全量数据算）。 */
  stats(): Promise<IssueStats>;
  /** 6M 维度分布 + 下钻（从所有已分析问题的 causes 真实统计）。 */
  dimensionStats(): Promise<DimensionStat[]>;
  /** 产品下拉选项（从数据去重）。 */
  productOptions(): Promise<string[]>;
}
