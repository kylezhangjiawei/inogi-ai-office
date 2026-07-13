import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { StoredChatAttachment } from './chat-attachment.service';

/**
 * 对话内文件生成：模型按协议在回答末尾输出 ```file-export 代码块（JSON 规格），
 * 本服务负责解析 → 渲染成真实 xlsx/docx → 传 OSS + 建 FileAsset → 返回可挂到
 * assistant 消息 attachments 的结构（前端复用现有附件卡展示与下载）。
 */

export type FileExportSpec =
  | {
      type: 'xlsx';
      filename: string;
      sheets: Array<{ name?: string; rows: unknown[][] }>;
    }
  | {
      type: 'docx';
      filename: string;
      blocks: Array<{ kind: 'heading' | 'paragraph' | 'table'; text?: string; rows?: unknown[][] }>;
    };

export const FILE_EXPORT_BLOCK_RE = /```file-export\s*\n([\s\S]*?)```/;
/** 流式抑制检测：出现该标记即停止向前端转发 delta（结束后由 content_final 修正） */
export const FILE_EXPORT_MARKER = '```file-export';

// 防滥用上限（超出直接报错，不静默截断）
const MAX_SHEETS = 5;
const MAX_ROWS = 2000;
const MAX_CELLS_PER_ROW = 50;
const MAX_CELL_CHARS = 2000;
const MAX_DOC_BLOCKS = 300;

@Injectable()
export class ChatFileExportService {
  private readonly logger = new Logger(ChatFileExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
  ) {}

  /**
   * 从完整回答中提取 file-export 块。只要块存在就一定从正文剔除（协议 JSON 绝不裸露给用户）；
   * JSON 非法时 spec=null 并带出 rawJson，调用方可尝试 LLM 修复后再 parseSpec。
   */
  parse(
    fullContent: string,
  ): { spec: FileExportSpec | null; rawJson: string; cleaned: string } | null {
    const m = FILE_EXPORT_BLOCK_RE.exec(fullContent);
    if (!m) return null;
    const cleaned = fullContent.replace(FILE_EXPORT_BLOCK_RE, '').trimEnd();
    const spec = this.parseSpec(m[1]);
    if (!spec) this.logger.warn('file-export 块 JSON 解析失败，待修复');
    return { spec, rawJson: m[1], cleaned };
  }

  /** 解析并校验规格 JSON；非法返回 null。 */
  parseSpec(jsonText: string): FileExportSpec | null {
    try {
      const spec = JSON.parse(jsonText) as FileExportSpec;
      return spec?.type === 'xlsx' || spec?.type === 'docx' ? spec : null;
    } catch {
      return null;
    }
  }

  /** 渲染规格为文件 Buffer。规格非法/超限抛错（调用方转为对话内失败提示）。 */
  async render(spec: FileExportSpec): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    if (spec.type === 'xlsx') {
      const buffer = await this.renderXlsx(spec.sheets ?? []);
      return {
        buffer,
        filename: this.safeFilename(spec.filename, '.xlsx', '导出数据'),
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    const buffer = await this.renderDocx(spec.blocks ?? []);
    return {
      buffer,
      filename: this.safeFilename(spec.filename, '.docx', '导出文档'),
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  /** 上传 OSS + 建 FileAsset，返回可存入 ChatMessage.attachments 的结构。 */
  async persist(
    userId: string,
    file: { buffer: Buffer; filename: string; mime: string },
    conversationId?: string,
  ): Promise<StoredChatAttachment> {
    // 专属 businessType：这是聊天历史的永久附件，不能与 uploads-temp（待清理语义）混池——
    // 将来任何按 temp 前缀做的清理/OSS 生命周期规则都会把历史消息附件打成 404
    const objectKey = await this.oss.uploadBuffer(
      file.buffer,
      'chat-generated',
      file.filename,
      file.mime,
    );
    if (!objectKey) throw new Error('OSS 未配置或上传失败');
    const asset = await this.prisma.fileAsset.create({
      data: {
        bucket: 'default',
        objectKey,
        fileName: file.filename,
        mimeType: file.mime,
        fileSize: file.buffer.length,
        fileHash: createHash('sha256').update(file.buffer).digest('hex'),
        businessType: 'chat-generated',
        businessId: conversationId ?? null,
        uploadedBy: userId,
        status: 'active',
      },
    });
    return {
      fileId: asset.id,
      name: file.filename,
      mime: file.mime,
      size: file.buffer.length,
      objectKey,
    };
  }

  // ── 渲染器 ──────────────────────────────────────────────────────────────

  private async renderXlsx(sheets: Array<{ name?: string; rows: unknown[][] }>): Promise<Buffer> {
    if (!Array.isArray(sheets) || sheets.length === 0) throw new Error('缺少工作表数据');
    if (sheets.length > MAX_SHEETS) throw new Error(`工作表数超过上限 ${MAX_SHEETS}`);
    const xlsx = (await import('xlsx')) as typeof import('xlsx');
    const wb = xlsx.utils.book_new();
    sheets.forEach((sheet, i) => {
      const rows = this.normalizeRows(sheet.rows);
      const ws = xlsx.utils.aoa_to_sheet(rows);
      // 列宽自适应（按内容长度粗估，封顶 60 字符）
      const colWidths: number[] = [];
      for (const row of rows) {
        row.forEach((cell, c) => {
          colWidths[c] = Math.min(60, Math.max(colWidths[c] ?? 8, String(cell).length + 2));
        });
      }
      ws['!cols'] = colWidths.map((wch) => ({ wch }));
      const name = (sheet.name ?? '').trim().slice(0, 28).replace(/[\\/?*[\]:]/g, ' ') || `Sheet${i + 1}`;
      xlsx.utils.book_append_sheet(wb, ws, name);
    });
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private async renderDocx(
    blocks: Array<{ kind: string; text?: string; rows?: unknown[][] }>,
  ): Promise<Buffer> {
    if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('缺少文档内容');
    if (blocks.length > MAX_DOC_BLOCKS) throw new Error(`文档块数超过上限 ${MAX_DOC_BLOCKS}`);
    const docx = await import('docx');
    const children: InstanceType<typeof docx.Paragraph | typeof docx.Table>[] = [];
    for (const block of blocks) {
      if (block.kind === 'heading') {
        children.push(
          new docx.Paragraph({
            text: String(block.text ?? '').slice(0, MAX_CELL_CHARS),
            heading: docx.HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
          }),
        );
      } else if (block.kind === 'table' && Array.isArray(block.rows)) {
        const rows = this.normalizeRows(block.rows);
        children.push(
          new docx.Table({
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
            rows: rows.map(
              (row, r) =>
                new docx.TableRow({
                  children: row.map(
                    (cell) =>
                      new docx.TableCell({
                        children: [
                          new docx.Paragraph({
                            children: [
                              new docx.TextRun({ text: String(cell), bold: r === 0 }),
                            ],
                          }),
                        ],
                      }),
                  ),
                }),
            ),
          }),
        );
      } else {
        children.push(
          new docx.Paragraph({
            text: String(block.text ?? '').slice(0, MAX_CELL_CHARS),
            spacing: { after: 120 },
          }),
        );
      }
    }
    const doc = new docx.Document({ sections: [{ children }] });
    return Buffer.from(await docx.Packer.toBuffer(doc));
  }

  // ── 工具 ────────────────────────────────────────────────────────────────

  private normalizeRows(rows: unknown[][]): string[][] {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('表格数据为空');
    if (rows.length > MAX_ROWS) throw new Error(`行数超过上限 ${MAX_ROWS}`);
    return rows.map((row) => {
      const cells = Array.isArray(row) ? row : [row];
      if (cells.length > MAX_CELLS_PER_ROW) throw new Error(`列数超过上限 ${MAX_CELLS_PER_ROW}`);
      return cells.map((c) => String(c ?? '').slice(0, MAX_CELL_CHARS));
    });
  }

  private safeFilename(raw: string, ext: string, fallback: string): string {
    const base = String(raw ?? '')
      .replace(/\.[a-z0-9]+$/i, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
      .trim()
      .slice(0, 80);
    return `${base || fallback}${ext}`;
  }
}
