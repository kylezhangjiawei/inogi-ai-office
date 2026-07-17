import { authFetch } from './authSession';

export type MateChatStreak = {
  /** 当前连续使用天数 */
  currentStreak: number;
  /** 历史最长连续天数 */
  bestStreak: number;
  /** 今天是否已提问打卡 */
  todayDone: boolean;
  /** 本周一~周日 7 天打卡情况 */
  weekActivity: boolean[];
  /** 累计提问次数 */
  totalQuestions: number;
  /** 当前连续天数是否达到里程碑 */
  milestone: boolean;
  /** AI 每日生成的趣味激励文案 */
  message: string;
  /** AI 每日生成的卡通动物吉祥物图（签名 URL）；未就绪为 null */
  mascotUrl: string | null;
};

export const chatStreakApi = {
  async getMyStreak(): Promise<MateChatStreak> {
    const res = await authFetch('/api/chat/me/streak');
    if (!res.ok) throw new Error('加载 MateChat 连续使用记录失败');
    return res.json() as Promise<MateChatStreak>;
  },
};
