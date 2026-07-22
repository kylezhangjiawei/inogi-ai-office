import { BadRequestException, Injectable } from '@nestjs/common';
import JSZip from 'jszip';
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

@Injectable()
export class ExternalDocumentExtractionService {
  constructor(private readonly ocrService: OcrService) {}

  async extract(file: ExternalDocumentFile): Promise<ExternalDocumentExtraction> {
    const extension = this.extension(file.originalname);

    if (extension === 'pdf') {
      const nativeText = await this.extractPdf(file.buffer);
      if (nativeText.length >= 40) {
        return {
          text: nativeText,
          provider: 'pdf_text_layer',
          metadata: { extension, native_text: true },
        };
      }
      return this.extractWithOcr(file, 'document_extract', { native_text_length: nativeText.length });
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
      return this.normalizeText(parsed.text ?? '');
    } finally {
      await parser.destroy();
    }
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
    const normalized = this.normalizeText(text);
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
