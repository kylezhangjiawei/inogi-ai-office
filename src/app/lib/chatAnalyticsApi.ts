import { authFetch } from './authSession';

export type ChatAnalyticsSummary = {
  activeUsers: number;
  eligibleUsers: number;
  coverageRate: number;
  repeatUsers: number;
  repeatRate: number;
  conversations: number;
  questions: number;
  answers: number;
  feedbackCount: number;
  positiveFeedback: number;
  negativeFeedback: number;
  helpfulRate: number;
  feedbackCoverage: number;
  avgResponseMs: number | null;
  p50ResponseMs: number | null;
  p95ResponseMs: number | null;
  /** 首答延迟分段（历史组装/改写/检索/首字/工具），老埋点没有该字段时为空数组 */
  phaseBreakdown: Array<{
    key: string;
    label: string;
    samples: number;
    p50Ms: number | null;
    p95Ms: number | null;
  }>;
  successRate: number | null;
  trackedAnswers: number;
  failedAnswers: number;
  copyCount: number;
  shareCount: number;
  regenerateCount: number;
  chatOpenCount: number;
  openUsers: number;
  openToQuestionRate: number;
  newUsers: number;
  returningUsers: number;
  openFeedback: number;
};

export type ChatFeedbackRow = {
  id: string;
  messageId: string;
  reaction: 'like' | 'dislike';
  reasons: string[];
  reasonLabels: string[];
  comment: string;
  status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  resolutionNote: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  user: string;
  department: string;
  role: string;
  model: string | null;
  question: string;
  answer: string;
};

export type ChatAnalyticsData = {
  range: { days: number; start: string; end: string };
  definitions: Record<string, string>;
  dataFreshness: {
    generatedAt: string;
    lastQuestionAt: string | null;
    trackingStartedAt: string | null;
    lastTrackedAt: string | null;
  };
  dataQuality: {
    status: 'healthy' | 'partial' | 'attention';
    answerTrackingStartedAt: string | null;
    checks: Array<{
      key: string;
      label: string;
      status: 'healthy' | 'partial' | 'attention';
      value: string;
      detail: string;
    }>;
    lineage: Array<{ action: string; capture: string; dashboard: string }>;
  };
  summary: ChatAnalyticsSummary;
  comparison: {
    range: { start: string; end: string };
    activeUsers: number;
    coverageRate: number;
    repeatUsers: number;
    repeatRate: number;
    questions: number;
  };
  trend: Array<{ date: string; activeUsers: number; questions: number; answers: number; feedback: number }>;
  departments: Array<{
    department: string;
    activeUsers: number;
    eligibleUsers: number;
    adoptionRate: number;
    previousActiveUsers: number;
    previousAdoptionRate: number;
    conversations: number;
    questions: number;
    questionsPerUser: number;
    helpfulRate: number;
    feedbackCount: number;
  }>;
  feedbackReasons: Array<{ reason: string; label: string; count: number }>;
  scenarios: Array<{
    key: string;
    label: string;
    questions: number;
    users: number;
    share: number;
    examples: string[];
  }>;
  adoptionSegments: Array<{ key: 'not_used' | 'one_time' | 'light' | 'frequent'; label: string; users: number }>;
  userAdoption: Array<{
    userId: string;
    name: string;
    department: string;
    role: string;
    questions: number;
    conversations: number;
    activeDays: number;
    lastActiveAt: string | null;
    firstUsedAt: string | null;
    isNew: boolean;
    usageLevel: 'not_used' | 'one_time' | 'light' | 'frequent';
    primaryScenario: string;
    feedbackCount: number;
    helpfulRate: number;
  }>;
  modelPerformance: Array<{
    model: string;
    answers: number;
    trackedAnswers: number;
    successRate: number | null;
    avgResponseMs: number | null;
    feedbackCount: number;
    helpfulRate: number | null;
  }>;
  sourceDistribution: Array<{ source: string; answers: number; share: number }>;
  feedbackStatus: Array<{ status: ChatFeedbackRow['status']; count: number }>;
  recentQuestions: Array<{
    id: string;
    conversationId: string;
    user: string;
    department: string;
    role: string;
    scenario: string;
    question: string;
    hasAttachments: boolean;
    createdAt: string;
  }>;
  recentFeedback: ChatFeedbackRow[];
};

export type ChatAnalyticsUserDetail = {
  range: { days: number; start: string; end: string };
  person: {
    userId: string;
    name: string;
    department: string;
    role: string;
    position: string;
  };
  summary: {
    questions: number;
    conversations: number;
    answers: number;
    activeDays: number;
    firstUsedAt: string | null;
    lastActiveAt: string | null;
    feedbackCount: number;
    positiveFeedback: number;
    negativeFeedback: number;
    helpfulRate: number;
    avgResponseMs: number | null;
    successRate: number | null;
    copyCount: number;
    shareCount: number;
    regenerateCount: number;
  };
  trend: Array<{ date: string; questions: number; answers: number }>;
  scenarios: Array<{ key: string; label: string; questions: number; share: number }>;
  models: Array<{ model: string; answers: number; share: number }>;
  sources: Array<{ source: string; answers: number; share: number }>;
  recentActivity: Array<{
    id: string;
    conversationId: string;
    question: string;
    scenario: string;
    hasAttachments: boolean;
    createdAt: string;
    answer: string;
    model: string | null;
    reaction: 'like' | 'dislike' | null;
  }>;
  feedback: Array<{
    id: string;
    reaction: 'like' | 'dislike';
    reasonLabels: string[];
    comment: string;
    status: ChatFeedbackRow['status'];
    resolutionNote: string;
    submittedAt: string;
    answer: string;
    model: string | null;
  }>;
};

async function readError(res: Response, fallback: string) {
  const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  if (Array.isArray(payload?.message)) return payload.message.join('；');
  return payload?.message || fallback;
}

export const chatAnalyticsApi = {
  async getDashboard(days: 7 | 30 | 90): Promise<ChatAnalyticsData> {
    const res = await authFetch(`/api/chat/analytics?days=${days}`);
    if (!res.ok) throw new Error(await readError(res, '加载 MateChat 使用数据失败'));
    return res.json() as Promise<ChatAnalyticsData>;
  },

  async getUserDetail(userId: string, days: 7 | 30 | 90): Promise<ChatAnalyticsUserDetail> {
    const res = await authFetch(`/api/chat/analytics/users/${encodeURIComponent(userId)}?days=${days}`);
    if (!res.ok) throw new Error(await readError(res, '加载人员使用详情失败'));
    return res.json() as Promise<ChatAnalyticsUserDetail>;
  },

  async updateFeedback(
    id: string,
    body: { status: ChatFeedbackRow['status']; resolutionNote?: string },
  ) {
    const res = await authFetch(`/api/chat/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res, '更新反馈状态失败'));
    return res.json() as Promise<{
      id: string;
      status: ChatFeedbackRow['status'];
      resolutionNote: string;
      resolvedAt: string | null;
      updatedAt: string;
    }>;
  },
};
