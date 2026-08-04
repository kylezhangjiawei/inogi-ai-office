import { BadRequestException, Injectable } from '@nestjs/common';
// 必须用 import-equals：本项目 tsconfig 只开了 allowSyntheticDefaultImports 而没开
// esModuleInterop，默认导入不会生成运行时互操作代码。jszip 是 CommonJS 模块
// （module.exports 直接是构造函数、没有 .default），写成 `import JSZip from 'jszip'`
// 编译期能过，运行时 jszip_1.default 却是 undefined，PPTX 解析会直接抛错。
import JSZip = require('jszip');
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';

import { OcrService } from '../ocr/ocr.service';

export type ExternalDocumentFile = {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
};

export type ExternalDocumentExtraction = {
  text: string;
  provider: string;
  ocrRequestId?: string;
  ocrConfidence?: number;
  metadata: Record<string, unknown>;
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'xml']);

/**
 * 扫描软件常在 PDF 文字层里塞页码分隔标记（如 `-- 3 of 14 --`、`第 3 页 / 共 14 页`），
 * 正文却全在图片里。这些标记必须在判断「有没有文字层」之前剔除，否则一份纯扫描件
 * 也能凑够字符数被误判为文本 PDF，导致 OCR 永不触发、比对出来永远零差异。
 */
const PDF_SCANNER_ARTIFACTS: RegExp[] = [
  /--\s*\d+\s*of\s*\d+\s*--/gi,
  /^\s*第\s*\d+\s*页\s*(?:[/／,，]\s*共\s*\d+\s*页)?\s*$/gim,
  /^\s*page\s*\d+\s*(?:of\s*\d+)?\s*$/gim,
  /^\s*[-–—]?\s*\d+\s*[-–—]?\s*$/gm,
];

/**
 * 每页有效字符数低于此值才认为文字层不可用、转走 OCR。
 *
 * 阈值取得保守：扫描件剔除页码标记后是 0 字/页，信号已经足够强；而卡证、封面这类
 * 文字稀疏但确实可用的 PDF 只有几十字/页（实测员工卡模板 45 字/页），阈值定高会把
 * 它们误送去 OCR，白花钱还更慢。实测参照：纯扫描件 0、员工卡 45、普通文本文件 439。
 */
const PDF_MIN_CHARS_PER_PAGE = 20;

/** 渲染倍数：1 倍是 72 DPI，中文 OCR 识别率不足；2 倍约 150 DPI，实测单页 ~257KB。 */
const PDF_RENDER_SCALE = 2;

/** 逐页 OCR 的并发度。腾讯 OCR 有 QPS 限制，过高会触发限频。 */
const PDF_OCR_CONCURRENCY = 3;

/**
 * Word 表单常用 Wingdings 2 的方块表示复选框。Mammoth 会把它们映射成
 * 普通几何方块（□ / ■），在网页正文中容易被误认为乱码；同时兼容部分
 * 旧解析器可能遗留的私有区码位，并统一补足与后续文字之间的间距。
 */
export function normalizeDocxCheckboxSymbols(text: string) {
  return text
    .replace(/[\u25A1\uF0A3]/g, '☐')
    .replace(/[\u25A0\uF052\uF0A2]/g, '☑')
    .replace(/\uF054/g, '☒')
    .replace(/(\S)([☐☑☒])/g, '$1 $2')
    .replace(/([☐☑☒])(?=[^\s\uFE0F])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ');
}

@Injectable()
export class ExternalDocumentExtractionService {
  constructor(private readonly ocrService: OcrService) {}

  async extract(file: ExternalDocumentFile): Promise<ExternalDocumentExtraction> {
    const extension = this.extension(file.originalname);

    if (extension === 'pdf') {
      const { text: nativeText, pageCount } = await this.extractPdf(file.buffer);
      const meaningful = this.meaningfulPdfText(nativeText);
      const perPage = pageCount > 0 ? meaningful.length / pageCount : meaningful.length;
      if (meaningful.length > 0 && perPage >= PDF_MIN_CHARS_PER_PAGE) {
        return {
          text: nativeText,
          provider: 'pdf_text_layer',
          metadata: {
            extension,
            native_text: true,
            page_count: pageCount,
            chars_per_page: Math.round(perPage),
          },
        };
      }
      // 文字层只有页码标记之类的噪声 → 按扫描件处理，逐页渲染后 OCR
      return this.extractScannedPdf(file, {
        extension,
        page_count: pageCount,
        native_text_length: nativeText.length,
        meaningful_text_length: meaningful.length,
      });
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
      return this.extractWithOcr(file, 'accurate_text', { image: true });
    }

    if (extension === 'docx') {
      try {
        const parsed = await mammoth.extractRawText({ buffer: file.buffer });
        return this.nativeResult(parsed.value, 'docx_text', extension);
      } catch (error) {
        throw new BadRequestException(`DOCX 文件解析失败，请确认文件未损坏且未加密：${(error as Error).message}`);
      }
    }

    if (extension === 'xlsx' || extension === 'xls') {
      const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
      const text = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        return `# ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`;
      }).join('\n\n');
      return this.nativeResult(text, 'spreadsheet_text', extension);
    }

    if (extension === 'pptx') {
      return this.nativeResult(await this.extractPptx(file.buffer), 'pptx_text', extension);
    }

    if (TEXT_EXTENSIONS.has(extension)) {
      return this.nativeResult(file.buffer.toString('utf8'), 'plain_text', extension);
    }

    throw new BadRequestException(
      `暂不支持解析 ${extension ? extension.toUpperCase() : '未知类型'} 文件。支持 PDF、DOCX、XLS/XLSX、PPTX、TXT/CSV/MD/JSON/XML 和常见图片。`,
    );
  }

  private async extractPdf(buffer: Buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return {
        text: this.normalizeText(parsed.text ?? ''),
        pageCount: Number(parsed.total) || 0,
      };
    } finally {
      await parser.destroy();
    }
  }

  /** 剔除扫描器页码标记后剩下的正文字符数，用于判断文字层是否可用。 */
  private meaningfulPdfText(text: string) {
    const stripped = PDF_SCANNER_ARTIFACTS.reduce(
      (result, pattern) => result.replace(pattern, ' '),
      text,
    );
    return stripped.replace(/\s+/g, '');
  }

  /**
   * 扫描件 PDF：逐页渲染成图片后分别 OCR，再按页拼接。
   *
   * 不能把整个 PDF 直接丢给 OCR：一是接口按 base64 收，7MB 的 PDF 编码后就超限；
   * 二是腾讯的 PDF 识别默认只认第 1 页，后面几十页会被静默丢弃。
   */
  private async extractScannedPdf(
    file: ExternalDocumentFile,
    metadata: Record<string, unknown>,
  ): Promise<ExternalDocumentExtraction> {
    const pages = await this.renderPdfPages(file.buffer);
    if (pages.length === 0) {
      throw new BadRequestException('PDF 没有可识别的页面，请确认文件未损坏');
    }

    const results = await this.mapWithConcurrency(pages, PDF_OCR_CONCURRENCY, async (page) => {
      // 渲染结果是 Uint8Array，必须转成 Buffer——否则 toString('base64') 走的是
      // Uint8Array 的实现，会得到逗号分隔的数字串，OCR 端报「图片解码失败」。
      const buffer = Buffer.from(page.data);
      const result = await this.ocrService.recognizeWithTencent(
        {
          originalname: `${file.originalname}#page${page.pageNumber}.png`,
          mimetype: 'image/png',
          buffer,
        },
        // 通用高精度识别。文档抽取(ExtractDocBasic)是票据结构化接口，
        // 对这类规程文件实测返回 0 行。
        { serviceKey: 'accurate_text' },
      );
      return { pageNumber: page.pageNumber, result };
    });

    results.sort((left, right) => left.pageNumber - right.pageNumber);
    const sections = results
      .map(({ pageNumber, result }) => {
        const pageText = this.normalizeText(result.text);
        return pageText ? `【第 ${pageNumber} 页】\n${pageText}` : '';
      })
      .filter(Boolean);

    if (sections.length === 0) {
      throw new BadRequestException('OCR 未能从文件中识别出可比对文字，请确认扫描件清晰且未损坏');
    }

    const confidences = results
      .map(({ result }) => result.confidence)
      .filter((value): value is number => typeof value === 'number');

    return {
      text: sections.join('\n\n'),
      provider: 'tencent_ocr:scanned_pdf',
      ocrRequestId: results[0]?.result.request_id,
      ocrConfidence: confidences.length
        ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(3))
        : undefined,
      metadata: {
        ...metadata,
        scanned_pdf: true,
        ocr_pages: results.length,
        recognized_pages: sections.length,
        render_scale: PDF_RENDER_SCALE,
      },
    };
  }

  private async renderPdfPages(buffer: Buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
      const shot = await parser.getScreenshot({ scale: PDF_RENDER_SCALE });
      return (shot.pages ?? []).map((page, index) => ({
        pageNumber: Number(page.pageNumber) || index + 1,
        data: page.data,
      }));
    } catch (error) {
      throw new BadRequestException(`扫描件 PDF 渲染失败：${(error as Error).message}`);
    } finally {
      await parser.destroy();
    }
  }

  /** 限流并发执行，保持入参顺序无关（调用方自行按页码排序）。 */
  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results.push(await task(items[index]!));
      }
    });
    await Promise.all(workers);
    return results;
  }

  private async extractPptx(buffer: Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((left, right) => this.slideNumber(left) - this.slideNumber(right));
    const slides: string[] = [];
    for (const [index, name] of slideNames.entries()) {
      const xml = await zip.file(name)?.async('string');
      if (!xml) continue;
      const lines = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
        .map((match) => this.decodeXml(match[1]))
        .filter(Boolean);
      slides.push(`# 幻灯片 ${index + 1}\n${lines.join('\n')}`);
    }
    return slides.join('\n\n');
  }

  private async extractWithOcr(
    file: ExternalDocumentFile,
    serviceKey: 'accurate_text' | 'document_extract',
    metadata: Record<string, unknown>,
  ): Promise<ExternalDocumentExtraction> {
    const result = await this.ocrService.recognizeWithTencent(file, { serviceKey });
    const text = this.normalizeText(result.text);
    if (!text) {
      throw new BadRequestException('OCR 未能从文件中识别出可比对文字，请确认文件清晰且未损坏');
    }
    return {
      text,
      provider: `tencent_ocr:${result.action}`,
      ocrRequestId: result.request_id,
      ocrConfidence: result.confidence,
      metadata: {
        ...metadata,
        service_key: result.service_key,
        service_label: result.service_label,
        line_count: result.lines.length,
      },
    };
  }

  private nativeResult(text: string, provider: string, extension: string): ExternalDocumentExtraction {
    const normalized = this.normalizeText(
      provider === 'docx_text' ? normalizeDocxCheckboxSymbols(text) : text,
    );
    if (!normalized) {
      throw new BadRequestException('文件中没有提取到可比对文字');
    }
    return {
      text: normalized,
      provider,
      metadata: { extension, native_text: true },
    };
  }

  private extension(fileName: string) {
    const normalized = fileName.trim().toLowerCase();
    const parts = normalized.split('.');
    return parts.length > 1 ? parts.pop() ?? '' : '';
  }

  private normalizeText(text: string) {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private slideNumber(name: string) {
    return Number(name.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
  }

  private decodeXml(value: string) {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();
  }
}
