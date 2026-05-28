/**
 * 文本切块工具：把长文本按段落 + 字符数滑动窗口切成 chunk。
 * 中文场景下按 ~500 token / chunk（约 1500 中文字符）+ 80 token overlap。
 * 简化实现：用字符数近似 token 数（1 中文字 ≈ 1 token，1 英文词 ≈ 1.3 token）。
 */

const DEFAULT_MAX_CHARS = 1500; // 约 500 token（中文）
const DEFAULT_OVERLAP_CHARS = 240; // 约 80 token overlap，保留语义连续性
const MIN_CHUNK_CHARS = 50; // 太短的不入索引

export type TextChunk = {
  index: number;
  content: string;
};

/**
 * 按段落优先 + 字符窗口切块。
 * 1. 先按双换行/句号断句
 * 2. 累加直到接近 maxChars，作为一个 chunk
 * 3. 下一个 chunk 从上一个 chunk 末尾倒退 overlapChars 起始（保持上下文连续）
 */
export function chunkText(
  raw: string,
  opts: { maxChars?: number; overlapChars?: number; minChars?: number } = {},
): TextChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const minChars = opts.minChars ?? MIN_CHUNK_CHARS;

  const text = (raw ?? '').replace(/\r\n/g, '\n').trim();
  if (text.length < minChars) {
    return text.length > 0 ? [{ index: 0, content: text }] : [];
  }
  // 短文本直接一个 chunk
  if (text.length <= maxChars) {
    return [{ index: 0, content: text }];
  }

  // 1. 段落级切分（双换行）
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // 2. 段落仍可能超过 maxChars，再按句号切到 sentence 级
  const sentences: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      sentences.push(p);
      continue;
    }
    const parts = p
      .split(/(?<=[。！？!?\n])/)
      .map((s) => s.trim())
      .filter(Boolean);
    // 极少数仍超长的句子（如 SQL/JSON 长字符串），按硬窗口切
    for (const s of parts) {
      if (s.length <= maxChars) {
        sentences.push(s);
      } else {
        for (let i = 0; i < s.length; i += maxChars) {
          sentences.push(s.slice(i, i + maxChars));
        }
      }
    }
  }

  // 3. 用滑动窗口组装：累加 sentence 到 buffer，超过 maxChars 时输出
  const chunks: TextChunk[] = [];
  let buffer = '';

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed.length >= minChars || (chunks.length === 0 && trimmed.length > 0)) {
      chunks.push({ index: chunks.length, content: trimmed });
    }
  };

  for (const sentence of sentences) {
    // 当前 buffer + 新 sentence 仍在窗口内，继续累加
    if ((buffer + '\n' + sentence).length <= maxChars) {
      buffer = buffer ? buffer + '\n' + sentence : sentence;
      continue;
    }
    // 超窗口：输出当前 buffer，新 buffer 用 overlap + sentence 开始
    flush();
    const overlap = overlapChars > 0 && buffer.length > overlapChars
      ? buffer.slice(-overlapChars)
      : '';
    buffer = overlap ? overlap + '\n' + sentence : sentence;
  }
  flush();

  // index 重排（保险）
  return chunks.map((c, i) => ({ ...c, content: c.content, index: i }));
}

/**
 * 把多个字段组合成可索引文本（标题、描述、标签拼接，标题加权重复一次提升召回）
 */
export function buildIndexableText(parts: {
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  extraFields?: Record<string, string | undefined | null>;
}): string {
  const segments: string[] = [];
  const title = parts.title?.trim();
  if (title) {
    segments.push(`【标题】${title}`);
    // 标题重复，提升召回权重
    segments.push(title);
  }
  if (parts.description?.trim()) {
    segments.push(`【说明】${parts.description.trim()}`);
  }
  if (parts.tags && parts.tags.length > 0) {
    const cleanTags = parts.tags.map((t) => t.trim()).filter(Boolean);
    if (cleanTags.length > 0) {
      segments.push(`【标签】${cleanTags.join('、')}`);
    }
  }
  if (parts.extraFields) {
    for (const [key, value] of Object.entries(parts.extraFields)) {
      const text = value?.trim();
      if (text) segments.push(`【${key}】${text}`);
    }
  }
  return segments.join('\n\n');
}
