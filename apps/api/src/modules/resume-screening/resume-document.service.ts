import { BadRequestException, Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class ResumeDocumentService {
  async extractText(file: { originalname: string; buffer: Buffer }) {
    const extension = this.getExtension(file.originalname);

    if (extension === 'pdf') {
      const parser = new PDFParse({ data: file.buffer });
      try {
        const parsed = await parser.getText();
        return {
          fileType: 'PDF',
          text: this.normalizeText(parsed.text ?? ''),
        };
      } finally {
        await parser.destroy();
      }
    }

    if (extension === 'docx') {
      const parsed = await mammoth.extractRawText({ buffer: file.buffer });
      return {
        fileType: 'DOCX',
        text: this.normalizeText(parsed.value ?? ''),
      };
    }

    throw new BadRequestException(`暂不支持解析 ${extension.toUpperCase()} 文件，仅支持 PDF 和 DOCX。`);
  }

  isSupportedFile(fileName: string) {
    const extension = this.getExtension(fileName);
    return extension === 'pdf' || extension === 'docx';
  }

  private getExtension(fileName: string) {
    const normalized = fileName.trim().toLowerCase();
    const parts = normalized.split('.');
    return parts.length > 1 ? parts.pop() ?? '' : '';
  }

  private normalizeText(text: string) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
