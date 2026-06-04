import { Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';

/** 前端发送时携带的附件入参（只信任 fileId） */
export type ChatAttachmentInput = {
  fileId: string;
  name?: string;
  mime?: string;
  size?: number;
};

/** 持久化到 ChatMessage.attachments 的结构 */
export type StoredChatAttachment = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  objectKey: string;
};

/** 返回给前端展示用：在 stored 基础上附带一个新鲜签名 URL */
export type ChatAttachmentView = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  url: string | null;
  isImage: boolean;
};

/** 单个文档注入 LLM 的字符上限（超出截断） */
export const CHAT_DOC_TEXT_MAX_CHARS = 6000;
/** 用于视觉识别的图片大小上限（超出不内联，给文字提示） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 文档下载上限 */
const MAX_DOC_BYTES = 20 * 1024 * 1024;

@Injectable()
export class ChatAttachmentService {
  private readonly logger = new Logger(ChatAttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
  ) {}

  isImage(mime: string): boolean {
    return /^image\//i.test(mime ?? '');
  }

  /**
   * 据前端传入的 fileId 列表回查 FileAsset，仅返回当前用户拥有的、仍有效的文件。
   * name/mime/size/objectKey 以 DB 记录为权威来源，避免信任前端伪造的元信息。
   * 返回顺序与输入一致。
   */
  async resolveOwned(
    userId: string,
    inputs: ChatAttachmentInput[],
  ): Promise<StoredChatAttachment[]> {
    const ids = [...new Set(inputs.map((a) => a.fileId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return [];

    const assets = await this.prisma.fileAsset.findMany({
      where: { id: { in: ids }, status: 'active' },
    });
    const byId = new Map(assets.map((a) => [a.id, a]));

    const result: StoredChatAttachment[] = [];
    for (const input of inputs) {
      const asset = byId.get(input.fileId);
      if (!asset) continue;
      // 越权（上传者非当前用户）跳过
      if (asset.uploadedBy && asset.uploadedBy !== userId) continue;
      result.push({
        fileId: asset.id,
        name: asset.fileName,
        mime: asset.mimeType,
        size: asset.fileSize,
        objectKey: asset.objectKey,
      });
    }
    return result;
  }

  /** 把任意 JSON 还原成 StoredChatAttachment[]（防御性解析 DB 里的 attachments 列） */
  normalizeStored(raw: unknown): StoredChatAttachment[] {
    if (!Array.isArray(raw)) return [];
    const out: StoredChatAttachment[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const fileId = typeof o.fileId === 'string' ? o.fileId : '';
      const objectKey = typeof o.objectKey === 'string' ? o.objectKey : '';
      if (!fileId || !objectKey) continue;
      out.push({
        fileId,
        objectKey,
        name: typeof o.name === 'string' ? o.name : '附件',
        mime: typeof o.mime === 'string' ? o.mime : 'application/octet-stream',
        size: typeof o.size === 'number' ? o.size : 0,
      });
    }
    return out;
  }

  /**
   * 把已存储的附件转成带"同源内联预览代理 URL"的视图（getMessages 返回给前端展示）。
   * 注意不用 OSS 签名直链：bucket 设了 x-oss-force-download，直链会强制下载导致图片无法内联渲染；
   * 这里复用 research-development 的 oss-preview 代理（Content-Disposition: inline + HMAC 短期令牌）。
   */
  signForDisplay(raw: unknown): ChatAttachmentView[] {
    return this.normalizeStored(raw).map((a) => ({
      fileId: a.fileId,
      name: a.name,
      mime: a.mime,
      size: a.size,
      isImage: this.isImage(a.mime),
      url: this.buildPreviewUrl(a.objectKey),
    }));
  }

  /** 构造同源内联预览代理 URL（HMAC 令牌 24h 有效）；objectKey 为空或异常时返回 null。 */
  private buildPreviewUrl(objectKey: string): string | null {
    if (!objectKey) return null;
    try {
      const { exp, sig } = this.oss.signPreviewToken(objectKey, 24 * 3600);
      const params = new URLSearchParams({ key: objectKey, exp: String(exp), sig });
      return `/api/research-development/oss-preview?${params.toString()}`;
    } catch {
      return null;
    }
  }

  /**
   * 下载图片并转成 base64 data URL，供视觉模型 image_url 使用。
   * 超过大小上限或下载失败返回 null（调用方退化为文字提示）。
   */
  async buildImageDataUrl(att: StoredChatAttachment): Promise<string | null> {
    const buffer = await this.download(att.objectKey, MAX_IMAGE_BYTES);
    if (!buffer) return null;
    const mime = att.mime || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  /**
   * 下载文档并抽取纯文本（PDF/DOCX/XLSX/XLS/TXT/CSV/TSV/MD 等）。失败或不支持返回 null。
   * 单文档截断到 CHAT_DOC_TEXT_MAX_CHARS。
   */
  async extractDocumentText(att: StoredChatAttachment): Promise<string | null> {
    const ext = this.extOf(att.name, att.mime);
    if (!this.isExtractableExt(ext)) return null;
    const buffer = await this.download(att.objectKey, MAX_DOC_BYTES);
    if (!buffer) return null;
    try {
      const text = await this.extractByExt(ext, buffer);
      const normalized = this.normalizeText(text);
      if (!normalized) return null;
      return normalized.length > CHAT_DOC_TEXT_MAX_CHARS
        ? normalized.slice(0, CHAT_DOC_TEXT_MAX_CHARS) + `\n…（${att.name} 内容过长，已截断）`
        : normalized;
    } catch (err) {
      this.logger.warn(`附件文本抽取失败(${att.name}): ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  private async download(objectKey: string, maxBytes: number): Promise<Buffer | null> {
    const obj = await this.oss.getObjectStream(objectKey);
    if (!obj) return null;
    if (obj.size && obj.size > maxBytes) return null;

    const stream = obj.stream as NodeJS.ReadableStream & { destroy?: () => void };
    const chunks: Buffer[] = [];
    let total = 0;
    return await new Promise<Buffer | null>((resolve) => {
      stream.on('data', (c: Buffer | string) => {
        const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy?.();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (e: Error) => {
        this.logger.warn(`OSS 下载流出错(${objectKey}): ${e?.message ?? e}`);
        resolve(null);
      });
    });
  }

  private async extractByExt(ext: string, buffer: Buffer): Promise<string> {
    if (ext === 'pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        return parsed.text ?? '';
      } finally {
        await parser.destroy();
      }
    }
    if (ext === 'docx') {
      const parsed = await mammoth.extractRawText({ buffer });
      return parsed.value ?? '';
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const xlsx = (await import('xlsx')) as typeof import('xlsx');
      const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
      const parts: string[] = [];
      for (const sheetName of workbook.SheetNames.slice(0, 5)) {
        const rows = xlsx.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], {
          header: 1,
          raw: false,
          defval: '',
        });
        const text = rows
          .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')).join(' ') : ''))
          .filter((line) => line.trim())
          .join('\n');
        if (text.trim()) parts.push(`# 工作表：${sheetName}\n${text}`);
      }
      return parts.join('\n\n');
    }
    // txt / csv / tsv / md / log / json 等纯文本
    return buffer.toString('utf8');
  }

  private isExtractableExt(ext: string): boolean {
    return ['pdf', 'docx', 'xlsx', 'xls', 'txt', 'csv', 'tsv', 'md', 'log', 'json'].includes(ext);
  }

  private extOf(name: string, mime: string): string {
    const fromName = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase().trim() : '';
    if (fromName) return fromName;
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('wordprocessingml')) return 'docx';
    if (mime.includes('spreadsheetml') || mime.includes('ms-excel')) return 'xlsx';
    if (mime.startsWith('text/')) return 'txt';
    return '';
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\x00/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
