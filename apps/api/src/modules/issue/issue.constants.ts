/**
 * 问题记录与 AI 定位（issue-ai）后端常量与共享类型。
 * 代码用英文 key，与前端 src/app/lib/issue/types.ts 的契约保持一致。
 */

export type IssueSource = 'rd' | 'production';
export type Severity = 'fatal' | 'major' | 'normal' | 'minor';
export type IssueStatus = 'pending' | 'analyzing' | 'adjusting' | 'adopted' | 'archived';
export type CauseDimension = '人' | '机' | '料' | '法' | '环' | '测';
export type SolutionType = 'contain' | 'correct' | 'prevent';
export type Likelihood = 'high' | 'medium' | 'low';

/** 6M 维度固定顺序（统计/展示永远按此序）。 */
export const CAUSE_DIMENSIONS: CauseDimension[] = ['人', '机', '料', '法', '环', '测'];

/** 严重度权重（排序用，越大越靠前）。 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  fatal: 4,
  major: 3,
  normal: 2,
  minor: 1,
};

/** 状态分段映射（与前端 config.ts 的 statusGroupOf 一致）。 */
export function statusGroupOf(status: string): 'pending' | 'processing' | 'solved' {
  if (status === 'pending') return 'pending';
  if (status === 'analyzing' || status === 'adjusting') return 'processing';
  return 'solved'; // adopted | archived
}

/** 「知识库」= 已解决（已采纳或已归档）的问题。 */
export function isReusableStatus(status: string): boolean {
  return status === 'adopted' || status === 'archived';
}

// ── 结构化分析契约（与前端 RootCauseAnalysis 对齐）──────────────────────────────
export interface Solution {
  id: string;
  action: string;
  type: SolutionType;
  owner?: string;
}
export interface PossibleCause {
  id: string;
  cause: string;
  dimension: CauseDimension;
  likelihood: Likelihood;
  evidence: string;
  solutions: Solution[];
}
export interface RootCauseAnalysis {
  possibleCauses: PossibleCause[];
  summary: string;
  referencedCases: string[];
}

/** 附件存储结构（attachments JSON 列）：fileId 引用 FileAsset，其余为展示字段。 */
export interface IssueAttachment {
  id: string; // = FileAsset.id（兼作 fileId）
  fileName: string;
  fileUrl: string; // 同源预览代理 URL（展示用，过期可重签）
  fileType: string; // mime
  extractedText?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ChatUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

/** AI 配置（存 SystemSetting key=issue.aiConfig）。 */
export interface IssueAiConfig {
  model: string;
  temperature?: number;
  systemPrompt?: string;
  attachmentMode: 'ai' | 'ocr';
}

export const ISSUE_AI_CONFIG_KEY = 'issue.aiConfig';

/**
 * 单次根因分析 AI 调用超时（ms）。已改异步 taskId+轮询，无反代单请求超时压力，
 * 故给足时间让模型一次跑完（实测 70-95s 波动）；真超时再降级启发式。
 */
export const ISSUE_AI_TIMEOUT_MS = Number(process.env.ISSUE_AI_TIMEOUT_MS) || 240_000;
/** 结构化分析输出 token 上限（限长降低延迟；6M JSON 通常 <1.5k tokens）。 */
export const ISSUE_AI_MAX_TOKENS = Number(process.env.ISSUE_AI_MAX_TOKENS) || 2000;
/** 异步分析任务结果在内存中的保留时长（ms）；超时清理。前端轮询应在此窗口内取走结果。 */
export const ISSUE_TASK_TTL_MS = Number(process.env.ISSUE_TASK_TTL_MS) || 30 * 60 * 1000;

export const DEFAULT_ISSUE_AI_CONFIG: IssueAiConfig = {
  model: '',
  temperature: 0.3,
  systemPrompt:
    '你是资深质量工程师，基于 6M（人机料法环测）对问题做根因论证并给出可执行方案。',
  attachmentMode: 'ai',
};
