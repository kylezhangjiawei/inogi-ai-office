import React from 'react';

import { MateChatStreakCard, type MateChatStreakCardProps } from './MateChatStreakCard';
import { useMateChatStreak } from './useMateChatStreak';

export type MateChatStreakCardConnectedProps = Pick<MateChatStreakCardProps, 'variant' | 'onGoChat' | 'className'>;

/**
 * 自取数版本：内部拉取当前用户的连续使用数据，其他页面直接
 * `<MateChatStreakCardConnected variant="compact" />` 即可接入。
 * 加载失败时静默不渲染，不影响宿主页面。
 */
export function MateChatStreakCardConnected(props: MateChatStreakCardConnectedProps) {
  const { data, loading, error } = useMateChatStreak();
  if (error && !data) return null;
  return <MateChatStreakCard data={data} loading={loading} {...props} />;
}
