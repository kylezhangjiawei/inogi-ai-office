import { useCallback, useEffect, useState } from 'react';

import { chatStreakApi, type MateChatStreak } from '../../lib/chatStreakApi';
import { MATECHAT_ACTIVITY_EVENT } from './openMateChat';

/**
 * 自取数 hook：拉取当前用户的 MateChat 连续使用打卡数据。
 * 供 MateChatStreakCardConnected 及任意需要「快速对接」的页面复用。
 */
export function useMateChatStreak() {
  const [data, setData] = useState<MateChatStreak | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await chatStreakApi.getMyStreak(force ? { force: true } : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // MateChat 产生使用行为后自动刷新（使缓存失效并强制取最新），无需刷新页面
  useEffect(() => {
    const onActivity = () => {
      chatStreakApi.invalidate();
      void refresh(true);
    };
    window.addEventListener(MATECHAT_ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(MATECHAT_ACTIVITY_EVENT, onActivity);
  }, [refresh]);

  return { data, loading, error, refresh };
}
