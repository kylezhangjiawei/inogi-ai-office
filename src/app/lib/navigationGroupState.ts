export function initialCollapsedGroups(labels: string[], activeLabel: string | undefined, saved: string | null): Set<string> {
  if (saved !== null) {
    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) return new Set(parsed.filter((label): label is string => typeof label === 'string' && labels.includes(label)));
    } catch { /* Invalid preferences fall back to the current workspace. */ }
  }
  return new Set(labels.filter(label => label !== activeLabel));
}
