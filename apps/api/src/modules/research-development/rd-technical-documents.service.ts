import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RdTechnicalDocumentVersion } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { resolveAttachmentMime } from './attachment-security';
import { ResearchDevelopmentService } from './research-development.service';
import { currentRdWorkspace } from './rd-workspace.context';

export type RdDocumentActor = { userId?: string; userName?: string; permissions?: string[] };
export const RD_DOCUMENT_CATEGORIES = ['drawing', 'specification', 'bom', 'validation', 'other'] as const;
export type ConfirmRdDocumentInput = {
  requestId: string;
  documentId?: string;
  expectedCurrentVersionId?: string;
  title: string;
  category: string;
  version: string;
  changeReason: string;
  sourceNoteId: string;
  attachmentId: string;
  expectedFileKey?: string;
  expectedFileName?: string;
  expectedFileSize?: number;
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** Keep only supported business fields, so retries cannot change an already confirmed version. */
export function normalizeRdDocumentInput(input: ConfirmRdDocumentInput): ConfirmRdDocumentInput {
  const output: ConfirmRdDocumentInput = {
    requestId: text(input?.requestId), documentId: text(input?.documentId) || undefined,
    expectedCurrentVersionId: text(input?.expectedCurrentVersionId) || undefined,
    title: text(input?.title), category: text(input?.category), version: text(input?.version),
    changeReason: text(input?.changeReason), sourceNoteId: text(input?.sourceNoteId), attachmentId: text(input?.attachmentId),
    ...(typeof input?.expectedFileKey === 'string' ? { expectedFileKey: input.expectedFileKey.trim() } : {}),
    ...(typeof input?.expectedFileName === 'string' ? { expectedFileName: input.expectedFileName } : {}),
    ...(typeof input?.expectedFileSize === 'number' ? { expectedFileSize: input.expectedFileSize } : {}),
  };
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(output.requestId)) throw new BadRequestException('缺少有效的提交编号，请重新打开版本登记');
  if (!output.title || output.title.length > 200) throw new BadRequestException('请填写 200 字以内的资料名称');
  if (!(RD_DOCUMENT_CATEGORIES as readonly string[]).includes(output.category)) throw new BadRequestException('请选择资料类型');
  if (!output.version || output.version.length > 60) throw new BadRequestException('请填写 60 字以内的版本号');
  if (!output.changeReason || output.changeReason.length > 2000) throw new BadRequestException('请填写 2000 字以内的登记或变更原因');
  if (!output.sourceNoteId || !output.attachmentId || output.sourceNoteId.length > 200 || output.attachmentId.length > 200) throw new BadRequestException('请选择本任务已上传的附件');
  if (output.documentId && !output.expectedCurrentVersionId) throw new BadRequestException('缺少原版本信息，请刷新后重试');
  if (!output.documentId && output.expectedCurrentVersionId) throw new BadRequestException('新资料不能指定原版本');
  return output;
}

@Injectable()
export class RdTechnicalDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rdService: ResearchDevelopmentService,
    private readonly ossService: OssService,
  ) {}

  private requireRdWorkspace() {
    if (currentRdWorkspace() !== 'rd') throw new NotFoundException('该工作区没有研发技术资料');
  }

  private fileAttachment(version: RdTechnicalDocumentVersion) {
    let preview = version.fileUrl;
    let download = version.fileUrl;
    if (version.fileKey) {
      preview = this.ossService.buildInlinePreviewUrl(version.fileKey) ?? version.fileUrl;
      download = this.ossService.getArchiveDownloadUrl(version.fileKey, version.fileName) ?? preview;
    } else if (version.fileUrl.startsWith('data:')) {
      const { exp, sig } = this.ossService.signPreviewToken(`rd-tech-doc:${version.id}`, 600);
      const params = new URLSearchParams({ exp: String(exp), sig });
      preview = `/api/research-development/technical-document-files/${encodeURIComponent(version.id)}?${params}`;
      download = `${preview}&dl=1`;
    }
    return {
      id: version.attachmentId, name: version.fileName, mime: version.mimeType, size: version.fileSize,
      ...(version.fileKey ? { object_key: version.fileKey } : {}),
      preview_url: preview, download_url: download,
    };
  }

  async list(taskId: string, actor: RdDocumentActor) {
    this.requireRdWorkspace();
    await this.rdService.requireTaskReadAccess(taskId, actor);
    let canEdit = true;
    try { await this.rdService.requireTaskDocumentWriteAccess(taskId, actor); }
    catch (error) { if (error instanceof ForbiddenException) canEdit = false; else throw error; }
    const documents = await this.prisma.rdTechnicalDocument.findMany({
      where: { taskId }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: { versions: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] } },
    });
    return { canEdit, documents: documents.map((document) => ({
      ...document,
      versions: document.versions.map(({ requestHash: _hash, requestId: _request, ...version }) => ({
        ...version,
        // Never return large embedded file bytes in the document list.
        fileUrl: this.fileAttachment({ ...version, requestHash: _hash, requestId: _request }).preview_url,
        attachment: this.fileAttachment({ ...version, requestHash: _hash, requestId: _request }),
      })),
    })) };
  }

  async confirm(taskId: string, rawInput: ConfirmRdDocumentInput, actor: RdDocumentActor) {
    return this.rdService.withTaskDocumentWriteLock(() => this.confirmLocked(taskId, rawInput, actor));
  }

  private async confirmLocked(taskId: string, rawInput: ConfirmRdDocumentInput, actor: RdDocumentActor) {
    this.requireRdWorkspace();
    if (!actor.userId) throw new ForbiddenException('请登录后确认资料版本');
    await this.rdService.requireTaskDocumentWriteAccess(taskId, actor);
    const input = normalizeRdDocumentInput(rawInput);
    const requestHash = createHash('sha256').update(JSON.stringify({ taskId, userId: actor.userId, ...input })).digest('hex');
    const retry = await this.prisma.rdTechnicalDocumentVersion.findUnique({ where: { requestId: input.requestId } });
    if (retry) {
      if (retry.requestHash !== requestHash) throw new ConflictException('提交编号已用于其他资料，请重新确认');
      return this.list(taskId, actor);
    }

    const notes = await this.rdService.getTaskDocumentSourceNotes(taskId, actor);
    const note = notes.find((item) => text(item.id) === input.sourceNoteId && text(item.task_id) === taskId);
    const attachment = (Array.isArray(note?.attachments) ? note.attachments : []).find((item) => record(item) && text(item.id) === input.attachmentId);
    if (!record(attachment)) throw new BadRequestException('附件已移除或不属于本任务，请刷新附件列表');
    let fileKey = text(attachment.object_key) || null;
    if (!fileKey && text(attachment.oss_url)) {
      try { fileKey = decodeURIComponent(new URL(text(attachment.oss_url)).pathname).replace(/^\/+/, '') || null; } catch { /* Embedded legacy file. */ }
    }
    const fileUrl = text(attachment.data_url) || text(attachment.oss_url) || text(attachment.preview_url);
    if (!fileKey && !fileUrl.startsWith('data:')) throw new BadRequestException('该附件缺少可保存的原文件，请重新上传后登记版本');
    const fileName = text(attachment.name) || 'attachment';
    const fileSize = Number(attachment.size);
    if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > 2147483647) throw new BadRequestException('附件大小无效');
    if ((input.expectedFileKey !== undefined && input.expectedFileKey !== text(attachment.object_key))
      || (input.expectedFileName !== undefined && input.expectedFileName !== fileName)
      || (input.expectedFileSize !== undefined && input.expectedFileSize !== fileSize)) {
      throw new ConflictException('所选附件已被替换，请刷新附件并重新核对后登记');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const document = input.documentId
          ? await tx.rdTechnicalDocument.findFirst({ where: { id: input.documentId, taskId } })
          : await tx.rdTechnicalDocument.create({ data: { taskId, title: input.title, category: input.category } });
        if (!document) throw new NotFoundException('资料不存在或不属于本任务');
        if (input.documentId && document.currentVersionId !== input.expectedCurrentVersionId) throw new ConflictException('该资料已有新版本，请刷新后核对');
        const version = await tx.rdTechnicalDocumentVersion.create({ data: {
          documentId: document.id, requestId: input.requestId, requestHash,
          version: input.version, title: input.title, category: input.category, changeReason: input.changeReason,
          previousVersionId: document.currentVersionId,
          attachmentId: input.attachmentId, sourceNoteId: input.sourceNoteId,
          fileName, mimeType: resolveAttachmentMime(fileName, text(attachment.mime)), fileSize, fileKey, fileUrl,
          createdById: actor.userId!, createdByName: actor.userName || '',
        } });
        const updated = await tx.rdTechnicalDocument.updateMany({
          where: { id: document.id, currentVersionId: document.currentVersionId },
          data: { currentVersionId: version.id, title: input.title, category: input.category },
        });
        if (updated.count !== 1) throw new ConflictException('该资料已被其他人更新，请刷新后核对');
        await tx.auditLog.create({ data: {
          userId: actor.userId, actorName: actor.userName, module: 'rd', source: 'web',
          action: 'task.document_version_confirmed', resource: 'task', resourceId: taskId,
          resourceName: input.title, summary: `确认技术资料「${input.title}」版本 ${input.version}：${input.changeReason}`,
          meta: { document_id: document.id, version_id: version.id, previous_version_id: document.currentVersionId, attachment_id: input.attachmentId },
        } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.rdTechnicalDocumentVersion.findUnique({ where: { requestId: input.requestId } });
        if (existing?.requestHash === requestHash) return this.list(taskId, actor);
        throw new ConflictException('版本号或提交编号已使用，请刷新后核对');
      }
      throw error;
    }
    return this.list(taskId, actor);
  }

  /** Procurement receives trusted immutable file/version metadata, never client-provided version labels. */
  async resolveTransferVersions(taskId: string, versionIds: string[], actor: RdDocumentActor) {
    this.requireRdWorkspace();
    await this.rdService.requireTaskReadAccess(taskId, actor);
    const ids = [...new Set(versionIds)];
    if (ids.length > 100) throw new BadRequestException('一次最多选择 100 份资料');
    if (!ids.length) return [];
    const rows = await this.prisma.rdTechnicalDocumentVersion.findMany({
      where: { id: { in: ids }, document: { taskId } }, include: { document: true },
    });
    if (rows.length !== ids.length) throw new BadRequestException('所选资料版本不存在或不属于当前研发任务');
    return rows.map((row) => ({
      id: row.id, documentId: row.documentId, version: row.version, category: row.category,
      title: row.title, fileName: row.fileName, fileKey: row.fileKey, fileUrl: row.fileUrl,
      fileSize: row.fileSize, mimeType: row.mimeType, attachmentId: row.attachmentId,
      sourceNoteId: row.sourceNoteId, createdAt: row.createdAt,
    }));
  }

  async readEmbeddedVersion(versionId: string) {
    const row = await this.prisma.rdTechnicalDocumentVersion.findUnique({ where: { id: versionId } });
    if (!row || row.fileKey) return null;
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(row.fileUrl);
    if (!match || match[3].length > 140 * 1024 * 1024) return null;
    try {
      return { name: row.fileName, mime: row.mimeType, buffer: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8') };
    } catch { return null; }
  }
}
