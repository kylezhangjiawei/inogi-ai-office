export function isAliyunOpenAiEndpoint(baseUrl?: string | null) {
  const normalized = baseUrl?.trim();
  if (!normalized) {
    return false;
  }

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === 'aliyuncs.com' || hostname.endsWith('.aliyuncs.com');
  } catch {
    return false;
  }
}

export function usesDeepSeekChatCompletions(provider?: string | null, model?: string | null) {
  return /deepseek/i.test(`${provider ?? ''} ${model ?? ''}`);
}
