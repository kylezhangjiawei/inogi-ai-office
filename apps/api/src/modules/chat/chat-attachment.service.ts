import { Injectable, Logger } from '@nestjs/common';
// 用命名空间导入：本项目 tsconfig 未开 esModuleInterop，CommonJS 包的默认导入
// 在运行时是 undefined（mammoth.extractRawText 会直接抛错）。
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
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
  /** 文档抽取出的纯文本（发送轮抽取后回写），供后续轮次"记住"附件内容继续追问 */
  extractedText?: string;
};

/** 返回给前端展示用：在 stored 基础上附带一个新鲜签名 URL */
export type ChatAttachmentView = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  url: string | null;
  thumbnailUrl: string | null;
  isImage: boolean;
};

/** 单个文档注入 LLM 的字符上限（超出截断） */
export const CHAT_DOC_TEXT_MAX_CHARS = 6000;
/** 用于视觉识别的图片大小上限（超出不内联，给文字提示） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 文档下载上限 */
const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** PDF 文本层低于该字符数视为扫描件（纯图 PDF），转 OCR 兜底 */
const SCANNED_PDF_TEXT_THRESHOLD = 40;
/** 扫描 PDF OCR 的页数上限（渲染+识别成本随页数线性增长） */
const SCANNED_PDF_MAX_PAGES = 3;
/** 扫描 PDF OCR 全程硬超时：腾讯 OCR fetch 无 AbortSignal，卡顿时会拖死同步调用方（issue 附件解析等） */
const SCANNED_PDF_OCR_TIMEOUT_MS = 60_000;

@Injectable()
export class ChatAttachmentService {
  private readonly logger = new Logger(ChatAttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
    private readonly ocrService: OcrService,
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
      const extractedText =
        typeof o.extractedText === 'string' && o.extractedText ? o.extractedText : undefined;
      out.push({
        fileId,
        objectKey,
        name: typeof o.name === 'string' ? o.name : '附件',
        mime: typeof o.mime === 'string' ? o.mime : 'application/octet-stream',
        size: typeof o.size === 'number' ? o.size : 0,
        ...(extractedText ? { extractedText } : {}),
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
    return this.normalizeStored(raw).map((a) => {
      const isImage = this.isImage(a.mime);
      return {
        fileId: a.fileId,
        name: a.name,
        mime: a.mime,
        size: a.size,
        isImage,
        url: this.buildPreviewUrl(a.objectKey),
        thumbnailUrl: isImage
          ? this.buildPreviewUrl(
              a.objectKey,
              'image/resize,m_lfit,w_480/format,webp/quality,q_80',
            )
          : null,
      };
    });
  }

  /**
   * 取图片附件的「外部可直连」OSS 签名 URL（供第三方服务如 DashScope 视频接口拉取首帧/参考图）。
   * 注意：不能用 signForDisplay 的同源代理 URL（外部访问不到），必须是公网直连签名 URL。
   * 仅返回图片类型且成功签名的项，顺序与入参一致。
   */
  buildExternalImageUrls(atts: StoredChatAttachment[], ttlSeconds = 7200): string[] {
    const urls: string[] = [];
    for (const a of atts) {
      if (!this.isImage(a.mime) || !a.objectKey) continue;
      const url = this.oss.getSignedUrl(a.objectKey, ttlSeconds);
      if (url) urls.push(url);
    }
    return urls;
  }

  /** 构造同源内联预览代理 URL（HMAC 令牌 24h 有效）；objectKey 为空或异常时返回 null。 */
  private buildPreviewUrl(objectKey: string, process?: string): string | null {
    if (!objectKey) return null;
    try {
      const cdnUrl = this.oss.getCdnReadUrl(objectKey, process, 'inline');
      if (cdnUrl) return cdnUrl;
      const tokenSubject = process ? `${objectKey}|process:${process}` : objectKey;
      const { exp, sig } = this.oss.signPreviewToken(tokenSubject, 24 * 3600);
      const params = new URLSearchParams({
        key: objectKey,
        exp: String(exp),
        sig,
        ...(process ? { process } : {}),
      });
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
        // 去掉 pdf-parse 的页码分隔标记（"-- 1 of 3 --"），避免纯图 PDF 被误判为有文本层
        const text = this.normalizeText(
          (parsed.text ?? '').replace(/^-+\s*\d+\s+of\s+\d+\s*-+\s*$/gm, ''),
        );
        // 文本层过薄 → 大概率是扫描件（整页是图片）：渲染前几页转 OCR 兜底
        if (text.length >= SCANNED_PDF_TEXT_THRESHOLD) return text;
        const ocrText = await this.ocrScannedPdf(parser);
        return ocrText || text;
      } finally {
        await parser.destroy();
      }
    }
    if (ext === 'pptx') {
      return this.extractPptxText(buffer);
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

  /**
   * 扫描版 PDF 兜底：渲染前几页为 PNG，走腾讯 OCR 识别文本（模型无关，任何主模型都能用）。
   * 未配置 OCR 或识别失败返回空串，调用方回退到原始文本层。
   */
  private async ocrScannedPdf(parser: PDFParse): Promise<string> {
    const ocrReady = await this.ocrService.hasTencentConfig().catch(() => false);
    if (!ocrReady) return '';
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(`扫描 PDF OCR 超时(${SCANNED_PDF_OCR_TIMEOUT_MS}ms)，放弃识别`);
        resolve('');
      }, SCANNED_PDF_OCR_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.ocrScannedPdfInner(parser), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async ocrScannedPdfInner(parser: PDFParse): Promise<string> {
    try {
      const shot = await parser.getScreenshot({ first: SCANNED_PDF_MAX_PAGES, scale: 2 });
      const parts: string[] = [];
      for (const page of shot.pages ?? []) {
        const dataUrl = (page as { dataUrl?: string }).dataUrl ?? '';
        const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : '';
        if (!base64) continue;
        const pageNo =
          (page as { pageNumber?: number }).pageNumber ?? parts.length + 1;
        const ocr = await this.ocrService.recognizeImageText({
          originalname: `pdf-page-${pageNo}.png`,
          buffer: Buffer.from(base64, 'base64'),
          mimetype: 'image/png',
        });
        const text = (ocr.text || ocr.lines.join('\n')).trim();
        if (text) parts.push(`# 第 ${pageNo} 页\n${text}`);
      }
      return parts.length
        ? `（扫描版 PDF，以下为 OCR 识别文本，可能存在识别误差）\n\n${parts.join('\n\n')}`
        : '';
    } catch (err) {
      this.logger.warn(`扫描 PDF OCR 失败: ${err instanceof Error ? err.message : err}`);
      return '';
    }
  }

  /** PPTX 是 zip 包：解出 ppt/slides/slideN.xml，抽取 <a:t> 文本节点，按幻灯片顺序拼接 */
  private async extractPptxText(buffer: Buffer): Promise<string> {
    // jszip 是 `export =` 的 CJS 模块：编译到 CommonJS 后动态 import 拿到的就是类本身（无 default）
    const jszipModule = (await import('jszip')) as unknown as {
      default?: typeof import('jszip');
    };
    const JSZip = jszipModule.default ?? (jszipModule as unknown as typeof import('jszip'));
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/(\d+)/)?.[1] ?? 0) - Number(b.match(/(\d+)/)?.[1] ?? 0));
    const parts: string[] = [];
    for (const path of slidePaths.slice(0, 60)) {
      const xml = await zip.files[path].async('string');
      const texts = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)]
        .map((m) => this.decodeXmlEntities(m[1]))
        .filter((s) => s.trim());
      if (texts.length) {
        parts.push(`# 幻灯片 ${path.match(/(\d+)/)?.[1]}\n${texts.join('\n')}`);
      }
    }
    return parts.join('\n\n');
  }

  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  private isExtractableExt(ext: string): boolean {
    return ['pdf', 'docx', 'pptx', 'xlsx', 'xls', 'txt', 'csv', 'tsv', 'md', 'log', 'json'].includes(ext);
  }

  private extOf(name: string, mime: string): string {
    const fromName = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase().trim() : '';
    if (fromName) return fromName;
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('wordprocessingml')) return 'docx';
    if (mime.includes('presentationml')) return 'pptx';
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
