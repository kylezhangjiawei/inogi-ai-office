// Keep existing collapsed preferences when a business category is renamed.
const PREVIOUS_GROUP_LABELS: Record<string, string> = {
  '信息流转': '客户服务',
  '文件与知识': '注册与关务',
  '订单与库存': '订单与仓储',
  '质量与生产': '生产与质量',
};

export function initialCollapsedGroups(labels: string[], activeLabel: string | undefined, saved: string | null): Set<string> {
  if (saved !== null) {
    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) return new Set(parsed
        .filter((label): label is string => typeof label === 'string')
        .map(label => labels.includes(label) ? label : PREVIOUS_GROUP_LABELS[label] ?? label)
        .filter(label => labels.includes(label)));
    } catch { /* Invalid preferences fall back to the current workspace. */ }
  }
  return new Set(labels.filter(label => label !== activeLabel));
}
