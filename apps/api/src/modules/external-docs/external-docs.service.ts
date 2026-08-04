import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { OSS_BUSINESS_TYPES, SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';
import { OssService } from '../oss/oss.service';
import {
  ExternalDocumentAiService,
  type ExternalDifference,
} from './external-document-ai.service';
import {
  ExternalDocumentExtractionService,
  normalizeDocxCheckboxSymbols,
  type ExternalDocumentExtraction,
  type ExternalDocumentFile,
} from './external-document-extraction.service';

type RequestActor = { id: string; name: string };
type CreateDocumentInput = {
  name: string;
  category?: string;
  version: string;
  notes?: string;
  allowSend?: boolean;
};
type UploadVersionInput = { version: string; notes?: string };
type VersionUploadDocument = {
  currentVersionId: string | null;
  versions: Array<{ version: string }>;
  comparisons: Array<unknown>;
};
type ReplacementHistoryEntry = {
  revision: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  objectKey: string;
  uploadedById: string | null;
  uploadedByName: string;
  uploadedAt: string;
  replacedAt: string;
  replacedById: string;
  replacedByName: string;
  reason: string;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'xls', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'json', 'xml',
  'png', 'jpg', 'jpeg', 'webp', 'bmp',
]);

@Injectable()
export class ExternalDocsService implements OnModuleInit {
  private readonly logger = new Logger(ExternalDocsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
    private readonly extraction: ExternalDocumentExtractionService,
    private readonly ai: ExternalDocumentAiService,
  ) {}

  async onModuleInit() {
    try {
      const interrupted = await this.prisma.externalDocumentComparison.findMany({
        where: { status: 'comparing' },
        select: { id: true },
        take: 20,
      });
      interrupted.forEach((item) => this.launchComparison(item.id));
    } catch (error) {
      this.logger.warn(`暂未恢复资料比对任务，请确认数据库迁移已执行: ${(error as Error).message}`);
    }
  }

  integrationStatus() {
    return this.ai.integrationStatus();
  }

  async list() {
    const documents = await this.prisma.externalDocument.findMany({
      include: {
        versions: { orderBy: { createdAt: 'desc' } },
        comparisons: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      items: documents.map((document) => this.documentResponse(document)),
      total: documents.length,
      integration: await this.integrationStatus(),
    };
  }

  async detail(documentId: string) {
    const document = await this.prisma.externalDocument.findUnique({
      where: { id: documentId },
      include: {
        versions: { orderBy: { createdAt: 'desc' } },
        comparisons: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!document) throw new NotFoundException('资料不存在');
    const latestComparison = document.comparisons[0] ?? null;
    return {
      document: this.documentResponse(document),
      versions: document.versions.map((version) => this.versionResponse(
        version,
        document.comparisons.find((comparison) => comparison.candidateVersionId === version.id),
      )),
      comparison: latestComparison
        ? this.comparisonResponse(latestComparison, document.versions)
        : null,
      integration: await this.integrationStatus(),
    };
  }

  async createDocument(
    actor: RequestActor,
    file: ExternalDocumentFile,
    input: CreateDocumentInput,
  ) {
    this.validateFile(file);
    const name = input.name?.trim();
    const versionLabel = input.version?.trim();
    if (!name) throw new BadRequestException('资料名称不能为空');
    if (!versionLabel) throw new BadRequestException('版本号不能为空');

    const stored = await this.storeFile(file);
    let createdVersionId = '';
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const document = await tx.externalDocument.create({
          data: {
            code: this.documentCode(),
            name,
            category: input.category?.trim() || '未分类',
            ownerId: actor.id,
            ownerName: actor.name,
            status: 'current',
            allowSend: Boolean(input.allowSend),
          },
        });
        const version = await tx.externalDocumentVersion.create({
          data: {
            documentId: document.id,
            version: versionLabel,
            fileName: file.originalname,
            mimeType: file.mimetype || 'application/octet-stream',
            fileSize: file.size,
            fileHash: stored.fileHash,
            objectKey: stored.objectKey,
            status: 'current',
            notes: input.notes?.trim() || '',
            uploadedById: actor.id,
            uploadedByName: actor.name,
          },
        });
        await tx.externalDocument.update({
          where: { id: document.id },
          data: { currentVersionId: version.id },
        });
        createdVersionId = version.id;
        return document.id;
      });
      // 基准版文本提取放后台：扫描件要逐页 OCR，十几页就得几十秒，不该卡住上传请求。
      // 失败也不影响建档——真正比对时 ensureExtraction 会再提取一次。
      this.warmUpExtraction(createdVersionId, file);
      return this.detail(created);
    } catch (error) {
      await this.oss.deleteObject(stored.objectKey);
      throw error;
    }
  }

  async uploadVersion(
    actor: RequestActor,
    documentId: string,
    file: ExternalDocumentFile,
    input: UploadVersionInput,
  ) {
    this.validateFile(file);
    const versionLabel = input.version?.trim();
    if (!versionLabel) throw new BadRequestException('版本号不能为空');

    const preflight = await this.prisma.externalDocument.findUnique({
      where: { id: documentId },
      include: {
        versions: true,
        comparisons: { where: { status: { in: ['comparing', 'review'] } }, take: 1 },
      },
    });
    this.assertVersionUploadAllowed(preflight, versionLabel);

    const stored = await this.storeFile(file);
    let comparisonId = '';
    try {
      comparisonId = await this.prisma.$transaction(async (tx) => {
        await this.lockDocument(tx, documentId);
        const document = await tx.externalDocument.findUnique({
          where: { id: documentId },
          include: {
            versions: true,
            comparisons: { where: { status: { in: ['comparing', 'review'] } }, take: 1 },
          },
        });
        this.assertVersionUploadAllowed(document, versionLabel);

        const candidate = await tx.externalDocumentVersion.create({
          data: {
            documentId,
            version: versionLabel,
            fileName: file.originalname,
            mimeType: file.mimetype || 'application/octet-stream',
            fileSize: file.size,
            fileHash: stored.fileHash,
            objectKey: stored.objectKey,
            status: 'pending',
            notes: input.notes?.trim() || '',
            uploadedById: actor.id,
            uploadedByName: actor.name,
          },
        });
        const comparison = await tx.externalDocumentComparison.create({
          data: {
            jobCode: this.comparisonCode(),
            documentId,
            baselineVersionId: document.currentVersionId as string,
            candidateVersionId: candidate.id,
            status: 'comparing',
          },
        });
        await tx.externalDocument.update({ where: { id: documentId }, data: { status: 'comparing' } });
        return comparison.id;
      });
    } catch (error) {
      await this.oss.deleteObject(stored.objectKey);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException('当前资料已有其他版本上传或比对任务，请刷新后重试');
      }
      throw error;
    }

    this.launchComparison(comparisonId, file.buffer);
    return this.detail(documentId);
  }

  async reviewDifference(comparisonId: string, differenceId: string, reviewed: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const comparison = await this.lockComparison(tx, comparisonId);
      if (comparison.status !== 'review') throw new ConflictException('当前比对任务不处于人工复核阶段');
      const differences = this.differences(comparison.differences);
      if (!differences.some((item) => item.id === differenceId)) throw new NotFoundException('差异项不存在');
      const updated = differences.map((item) => item.id === differenceId ? { ...item, reviewed } : item);
      await tx.externalDocumentComparison.update({
        where: { id: comparisonId },
        data: { differences: updated as unknown as Prisma.InputJsonValue },
      });
      return { differences: updated, reviewedCount: updated.filter((item) => item.reviewed).length };
    });
  }

  async reviewAll(comparisonId: string) {
    return this.prisma.$transaction(async (tx) => {
      const comparison = await this.lockComparison(tx, comparisonId);
      if (comparison.status !== 'review') throw new ConflictException('当前比对任务不处于人工复核阶段');
      const differences = this.differences(comparison.differences).map((item) => ({ ...item, reviewed: true }));
      await tx.externalDocumentComparison.update({
        where: { id: comparisonId },
        data: { differences: differences as unknown as Prisma.InputJsonValue },
      });
      return { differences, reviewedCount: differences.length };
    });
  }

  async regenerateSummary(comparisonId: string) {
    const comparison = await this.findComparison(comparisonId);
    if (comparison.status !== 'review') throw new ConflictException('当前比对任务不处于人工复核阶段');
    const versions = await this.prisma.externalDocumentVersion.findMany({
      where: { id: { in: [comparison.baselineVersionId, comparison.candidateVersionId] } },
    });
    const baseline = versions.find((item) => item.id === comparison.baselineVersionId);
    const candidate = versions.find((item) => item.id === comparison.candidateVersionId);
    if (!baseline || !candidate) throw new NotFoundException('比对版本不存在');
    const generated = await this.ai.regenerateSummary({
      baselineVersion: baseline.version,
      candidateVersion: candidate.version,
      differences: this.differences(comparison.differences),
    });
    const updated = await this.prisma.externalDocumentComparison.updateMany({
      where: { id: comparisonId, status: 'review', updatedAt: comparison.updatedAt },
      data: {
        summary: generated.summary,
        aiModel: generated.model,
        aiProvider: generated.provider,
        aiGenerationMode: generated.generationMode,
        aiWarning: generated.warning ?? null,
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('复核状态已被其他用户更新，请刷新后重新生成摘要');
    }
    return generated;
  }

  async archive(actor: RequestActor, comparisonId: string, summary?: string) {
    await this.prisma.$transaction(async (tx) => {
      const comparison = await this.lockComparison(tx, comparisonId);
      if (comparison.status !== 'review') throw new ConflictException('当前比对任务不能归档');
      const differences = this.differences(comparison.differences);
      const unreviewed = differences.filter((item) => !item.reviewed).length;
      if (unreviewed) throw new ConflictException(`还有 ${unreviewed} 处差异未复核`);

      await tx.externalDocumentVersion.updateMany({
        where: { documentId: comparison.documentId, status: 'current' },
        data: { status: 'superseded' },
      });
      await tx.externalDocumentVersion.update({
        where: { id: comparison.candidateVersionId },
        data: { status: 'current' },
      });
      await tx.externalDocument.update({
        where: { id: comparison.documentId },
        data: {
          currentVersionId: comparison.candidateVersionId,
          status: 'current',
          allowSend: true,
        },
      });
      await tx.externalDocumentComparison.update({
        where: { id: comparisonId },
        data: {
          status: 'archived',
          summary: summary?.trim() || comparison.summary,
          confirmedById: actor.id,
          confirmedByName: actor.name,
          archivedAt: new Date(),
        },
      });
    });
    const comparison = await this.findComparison(comparisonId);
    return this.detail(comparison.documentId);
  }

  async retry(comparisonId: string) {
    let documentId = '';
    try {
      await this.prisma.$transaction(async (tx) => {
        const comparison = await this.lockComparison(tx, comparisonId);
        if (comparison.status !== 'failed') throw new ConflictException('仅失败的比对任务可以重试');
        await this.lockDocument(tx, comparison.documentId);
        const active = await tx.externalDocumentComparison.findFirst({
          where: {
            documentId: comparison.documentId,
            status: { in: ['comparing', 'review'] },
            NOT: { id: comparisonId },
          },
          select: { id: true },
        });
        if (active) throw new ConflictException('当前资料已有其他待处理的版本比对，不能重试旧任务');

        const startedAt = new Date();
        await tx.externalDocumentComparison.update({
          where: { id: comparisonId },
          data: {
            status: 'comparing',
            summary: '',
            differences: [],
            aiModel: null,
            aiProvider: null,
            aiGenerationMode: null,
            aiWarning: null,
            errorMessage: null,
            startedAt,
            completedAt: null,
          },
        });
        await tx.externalDocumentVersion.update({
          where: { id: comparison.candidateVersionId },
          data: { status: 'pending' },
        });
        await tx.externalDocument.update({
          where: { id: comparison.documentId },
          data: { status: 'comparing' },
        });
        documentId = comparison.documentId;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException('当前资料已有其他待处理的版本比对，请刷新后重试');
      }
      throw error;
    }
    this.launchComparison(comparisonId);
    return this.detail(documentId);
  }

  /**
   * 候选文件误传纠正：业务版本号与 comparison jobCode 均不变；旧文件固化到
   * replacementHistory 且保留 OSS 原件，新文件成为当前候选 revision 并重新比对。
   */
  async replaceCandidate(
    actor: RequestActor,
    comparisonId: string,
    file: ExternalDocumentFile,
    reason?: string,
  ) {
    this.validateFile(file);
    const comparison = await this.prisma.externalDocumentComparison.findUnique({
      where: { id: comparisonId },
    });
    // Prisma schema 没有声明版本关系，按 candidateVersionId 显式读取。
    if (!comparison) throw new NotFoundException('比对任务不存在');
    if (comparison.status === 'archived') throw new ConflictException('已归档版本不可替换候选文件');
    const candidate = await this.prisma.externalDocumentVersion.findUnique({
      where: { id: comparison.candidateVersionId },
    });
    if (!candidate) throw new NotFoundException('候选版本不存在');

    const stored = await this.storeFile(file);
    const now = new Date();
    const history = this.replacementHistory(candidate.replacementHistory);
    history.push({
      revision: candidate.uploadRevision,
      fileName: candidate.fileName,
      mimeType: candidate.mimeType,
      fileSize: candidate.fileSize,
      fileHash: candidate.fileHash,
      objectKey: candidate.objectKey,
      uploadedById: candidate.uploadedById,
      uploadedByName: candidate.uploadedByName,
      uploadedAt: candidate.fileUploadedAt.toISOString(),
      replacedAt: now.toISOString(),
      replacedById: actor.id,
      replacedByName: actor.name,
      reason: reason?.trim() || '候选文件上传纠正',
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.externalDocumentVersion.update({
          where: { id: candidate.id },
          data: {
            fileName: file.originalname,
            mimeType: file.mimetype || 'application/octet-stream',
            fileSize: file.size,
            fileHash: stored.fileHash,
            objectKey: stored.objectKey,
            status: 'pending',
            notes: reason?.trim() || candidate.notes,
            extractedText: null,
            extractionProvider: null,
            ocrRequestId: null,
            ocrConfidence: null,
            extractionMetadata: {},
            uploadRevision: { increment: 1 },
            replacementHistory: history as unknown as Prisma.InputJsonValue,
            fileUploadedAt: now,
            uploadedById: actor.id,
            uploadedByName: actor.name,
          },
        });
        await tx.externalDocumentComparison.update({
          where: { id: comparisonId },
          data: {
            status: 'comparing',
            summary: '',
            differences: [],
            aiModel: null,
            aiProvider: null,
            aiGenerationMode: null,
            aiWarning: null,
            ocrProvider: null,
            ocrConfidence: null,
            errorMessage: null,
            startedAt: now,
            completedAt: null,
          },
        });
        await tx.externalDocument.update({
          where: { id: comparison.documentId },
          data: { status: 'comparing' },
        });
      });
    } catch (error) {
      await this.oss.deleteObject(stored.objectKey);
      throw error;
    }

    this.launchComparison(comparisonId, file.buffer);
    return this.detail(comparison.documentId);
  }

  async versionDownload(versionId: string, revisionInput?: string) {
    const resolved = await this.resolveVersionFile(versionId, revisionInput);
    const url = this.oss.getSignedUrl(resolved.source.objectKey, SIGNED_URL_TTL_SECONDS.DEFAULT);
    if (!url) throw new BadRequestException('OSS 未配置，暂时无法读取原文件');
    return {
      versionId: resolved.versionId,
      revision: resolved.revision,
      fileName: resolved.source.fileName,
      hash: resolved.source.fileHash,
      url,
      expiresIn: SIGNED_URL_TTL_SECONDS.DEFAULT,
    };
  }

  async versionDownloadContent(versionId: string, revisionInput?: string) {
    const resolved = await this.resolveVersionFile(versionId, revisionInput);
    const object = await this.oss.getObjectStream(resolved.source.objectKey);
    if (!object) throw new NotFoundException('资料原文件暂时无法读取');
    return {
      ...object,
      fileName: resolved.source.fileName,
      revision: resolved.revision,
      versionId: resolved.versionId,
    };
  }

  private async resolveVersionFile(versionId: string, revisionInput?: string) {
    const version = await this.prisma.externalDocumentVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        objectKey: true,
        fileHash: true,
        uploadRevision: true,
        replacementHistory: true,
      },
    });
    if (!version) throw new NotFoundException('资料版本不存在');
    const requestedRevision = revisionInput == null || revisionInput === ''
      ? version.uploadRevision
      : Number(revisionInput);
    if (!Number.isInteger(requestedRevision) || requestedRevision < 1) {
      throw new BadRequestException('文件修订号不正确');
    }
    const historical = requestedRevision === version.uploadRevision
      ? null
      : this.replacementHistory(version.replacementHistory).find((item) => item.revision === requestedRevision);
    if (requestedRevision !== version.uploadRevision && !historical) {
      throw new NotFoundException('文件修订记录不存在');
    }
    const source = historical ?? version;
    if (!this.oss.isKeyUnderBusinessType(source.objectKey, OSS_BUSINESS_TYPES.EXTERNAL_DOCS)) {
      throw new BadRequestException('资料原文件存储路径不合法');
    }
    return {
      versionId: version.id,
      revision: requestedRevision,
      source,
    };
  }

  async versionPreviewContent(versionId: string) {
    const version = await this.prisma.externalDocumentVersion.findUnique({
      where: { id: versionId },
      select: {
        fileName: true,
        objectKey: true,
      },
    });
    if (!version) throw new NotFoundException('资料版本不存在');
    if (!this.oss.isKeyUnderBusinessType(version.objectKey, OSS_BUSINESS_TYPES.EXTERNAL_DOCS)) {
      throw new BadRequestException('资料原文件存储路径不合法');
    }
    const object = await this.oss.getObjectStream(version.objectKey);
    if (!object) throw new NotFoundException('资料原文件暂时无法读取');
    return {
      ...object,
      fileName: version.fileName,
    };
  }

  private launchComparison(comparisonId: string, candidateBuffer?: Buffer) {
    setImmediate(() => {
      void this.runComparison(comparisonId, candidateBuffer).catch((error) => {
        this.logger.error(`资料比对任务异常 ${comparisonId}: ${(error as Error).message}`, (error as Error).stack);
      });
    });
  }

  /**
   * 后台预提取基准版文本并回填。纯预热：失败只记日志，不改版本状态，
   * 后续比对走 ensureExtraction 会自行重试，不会因为这里失败而丢数据。
   */
  private warmUpExtraction(versionId: string, file: ExternalDocumentFile) {
    if (!versionId) return;
    setImmediate(() => {
      void (async () => {
        const extraction = await this.extraction.extract(file);
        // 只在还没有文本时回填：比对流程可能已经抢先提取过，别覆盖它的结果
        await this.prisma.externalDocumentVersion.updateMany({
          where: { id: versionId, OR: [{ extractedText: null }, { extractedText: '' }] },
          data: this.extractionData(extraction),
        });
      })().catch((error) => {
        this.logger.warn(`基准版文本预提取失败 ${versionId}: ${(error as Error).message}`);
      });
    });
  }

  private async runComparison(comparisonId: string, candidateBuffer?: Buffer) {
    const comparison = await this.prisma.externalDocumentComparison.findUnique({ where: { id: comparisonId } });
    if (!comparison || comparison.status !== 'comparing') return;
    try {
      const versions = await this.prisma.externalDocumentVersion.findMany({
        where: { id: { in: [comparison.baselineVersionId, comparison.candidateVersionId] } },
      });
      const baseline = versions.find((item) => item.id === comparison.baselineVersionId);
      const candidate = versions.find((item) => item.id === comparison.candidateVersionId);
      if (!baseline || !candidate) throw new Error('比对所需版本不存在');

      const baselineExtraction = await this.ensureExtraction(baseline, undefined);
      const candidateExtraction = await this.ensureExtraction(candidate, candidateBuffer);
      const analysis = await this.ai.analyze({
        baselineText: baselineExtraction.text,
        candidateText: candidateExtraction.text,
        baselineProvider: baselineExtraction.provider,
        candidateProvider: candidateExtraction.provider,
        baselineVersion: baseline.version,
        candidateVersion: candidate.version,
        notes: candidate.notes,
      });
      const ocrExtraction = [baselineExtraction, candidateExtraction].find((item) => item.provider.startsWith('tencent_ocr'));
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.externalDocumentComparison.updateMany({
          where: { id: comparisonId, status: 'comparing', startedAt: comparison.startedAt },
          data: {
            status: 'review',
            summary: analysis.summary,
            differences: analysis.differences as unknown as Prisma.InputJsonValue,
            aiModel: analysis.model,
            aiProvider: analysis.provider,
            aiGenerationMode: analysis.generationMode,
            aiWarning: analysis.warning ?? null,
            ocrProvider: ocrExtraction ? 'tencent_ocr' : 'native_text',
            ocrConfidence: ocrExtraction?.ocrConfidence ?? null,
            errorMessage: null,
            completedAt: new Date(),
          },
        });
        // 文件被再次纠正或任务已重试时，旧异步请求不得覆盖新一轮结果。
        if (updated.count === 0) return;
        await tx.externalDocument.update({
          where: { id: comparison.documentId },
          data: { status: 'review' },
        });
      });
    } catch (error) {
      const message = (error as Error).message || 'AI/OCR 比对失败';
      this.logger.error(`资料比对失败 ${comparison.jobCode}: ${message}`);
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.externalDocumentComparison.updateMany({
          where: { id: comparisonId, status: 'comparing', startedAt: comparison.startedAt },
          data: { status: 'failed', errorMessage: message, completedAt: new Date() },
        });
        if (updated.count === 0) return;
        await tx.externalDocumentVersion.update({
          where: { id: comparison.candidateVersionId },
          data: { status: 'failed' },
        });
        await tx.externalDocument.update({
          where: { id: comparison.documentId },
          data: { status: 'failed' },
        });
      });
    }
  }

  private async ensureExtraction(
    version: {
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      objectKey: string;
      extractedText: string | null;
      extractionProvider: string | null;
      ocrRequestId: string | null;
      ocrConfidence: number | null;
      extractionMetadata: Prisma.JsonValue;
    },
    suppliedBuffer?: Buffer,
  ): Promise<ExternalDocumentExtraction> {
    if (version.extractedText && version.extractionProvider) {
      return {
        text: version.extractionProvider === 'docx_text'
          ? normalizeDocxCheckboxSymbols(version.extractedText)
          : version.extractedText,
        provider: version.extractionProvider,
        ocrRequestId: version.ocrRequestId ?? undefined,
        ocrConfidence: version.ocrConfidence ?? undefined,
        metadata: this.record(version.extractionMetadata),
      };
    }
    const buffer = suppliedBuffer ?? await this.readObject(version.objectKey);
    const extracted = await this.extraction.extract({
      originalname: version.fileName,
      mimetype: version.mimeType,
      size: version.fileSize,
      buffer,
    });
    await this.prisma.externalDocumentVersion.updateMany({
      where: { id: version.id, objectKey: version.objectKey },
      data: this.extractionData(extracted),
    });
    return extracted;
  }

  private async storeFile(file: ExternalDocumentFile) {
    if (!this.oss.isEnabled) throw new BadRequestException('OSS 未配置，无法保存和追溯原始资料');
    const objectKey = await this.oss.uploadBuffer(file.buffer, OSS_BUSINESS_TYPES.EXTERNAL_DOCS, file.originalname, file.mimetype);
    if (!objectKey) throw new BadRequestException('原始资料上传 OSS 失败');
    return {
      objectKey,
      fileHash: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  private async readObject(objectKey: string) {
    const object = await this.oss.getObjectStream(objectKey);
    if (!object) throw new BadRequestException('无法读取归档原文件');
    const chunks: Buffer[] = [];
    for await (const chunk of object.stream as unknown as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private validateFile(file: ExternalDocumentFile) {
    if (!file?.buffer?.length) throw new BadRequestException('未上传文件');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('文件不能超过 25 MB');
    const extension = file.originalname.toLowerCase().split('.').pop() ?? '';
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException('文件类型不支持，请上传 PDF、Office 文档、文本文件或常见图片');
    }
  }

  private extractionData(extraction: ExternalDocumentExtraction) {
    return {
      extractedText: extraction.text,
      extractionProvider: extraction.provider,
      ocrRequestId: extraction.ocrRequestId ?? null,
      ocrConfidence: extraction.ocrConfidence ?? null,
      extractionMetadata: extraction.metadata as Prisma.InputJsonValue,
    };
  }

  private assertVersionUploadAllowed(
    document: VersionUploadDocument | null,
    versionLabel: string,
  ): asserts document is VersionUploadDocument & { currentVersionId: string } {
    if (!document) throw new NotFoundException('资料不存在');
    if (!document.currentVersionId) throw new ConflictException('当前资料尚未建立有效基准版本');
    if (document.comparisons.length) {
      throw new ConflictException('当前资料已有待处理的版本比对，请先完成或重试该任务');
    }
    if (document.versions.some((item) => item.version.toLowerCase() === versionLabel.toLowerCase())) {
      throw new ConflictException(`版本号 ${versionLabel} 已存在`);
    }
  }

  private async lockDocument(tx: Prisma.TransactionClient, documentId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ExternalDocument"
      WHERE "id" = ${documentId}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('资料不存在');
  }

  private async lockComparison(tx: Prisma.TransactionClient, comparisonId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ExternalDocumentComparison"
      WHERE "id" = ${comparisonId}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('比对任务不存在');
    const comparison = await tx.externalDocumentComparison.findUnique({ where: { id: comparisonId } });
    if (!comparison) throw new NotFoundException('比对任务不存在');
    return comparison;
  }

  private async findComparison(comparisonId: string) {
    const comparison = await this.prisma.externalDocumentComparison.findUnique({ where: { id: comparisonId } });
    if (!comparison) throw new NotFoundException('比对任务不存在');
    return comparison;
  }

  private differences(value: Prisma.JsonValue): ExternalDifference[] {
    const differences = Array.isArray(value) ? value.filter((item): item is ExternalDifference => {
      return Boolean(item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string');
    }) : [];
    return differences.map((item) => {
      if (
        typeof item.source !== 'string' ||
        !item.source.includes('docx_text') ||
        typeof item.before !== 'string' ||
        typeof item.after !== 'string'
      ) return item;
      return {
        ...item,
        before: normalizeDocxCheckboxSymbols(item.before),
        after: normalizeDocxCheckboxSymbols(item.after),
      };
    });
  }

  private documentResponse(document: {
    id: string;
    code: string;
    name: string;
    category: string;
    ownerName: string;
    currentVersionId: string | null;
    status: string;
    allowSend: boolean;
    updatedAt: Date;
    versions: Array<{
      id: string;
      version: string;
      fileName: string;
      createdAt: Date;
    }>;
    comparisons: Array<{ status: string; differences: Prisma.JsonValue }>;
  }) {
    const current = document.versions.find((item) => item.id === document.currentVersionId) ?? document.versions[0];
    const latestComparison = document.comparisons[0];
    const differences = latestComparison ? this.differences(latestComparison.differences) : [];
    return {
      id: document.id,
      code: document.code,
      name: document.name,
      category: document.category,
      owner: document.ownerName,
      currentVersion: current?.version ?? '—',
      currentFile: current?.fileName ?? '—',
      updatedAt: document.updatedAt.toISOString(),
      totalVersions: document.versions.length,
      status: document.status,
      pendingCount: latestComparison?.status === 'review'
        ? differences.filter((item) => !item.reviewed).length
        : 0,
      allowSend: document.allowSend,
    };
  }

  private versionResponse(version: {
    id: string;
    version: string;
    fileName: string;
    fileSize: number;
    uploadedByName: string;
    createdAt: Date;
    status: string;
    fileHash: string;
    uploadRevision: number;
    replacementHistory: Prisma.JsonValue;
    fileUploadedAt: Date;
  }, comparison?: { id: string; jobCode: string }) {
    const replacements = this.replacementHistory(version.replacementHistory);
    return {
      id: version.id,
      version: version.version,
      fileName: version.fileName,
      fileSize: version.fileSize,
      uploadedBy: version.uploadedByName,
      uploadedAt: version.fileUploadedAt.toISOString(),
      status: version.status,
      hash: version.fileHash,
      compareId: comparison?.jobCode,
      comparisonId: comparison?.id,
      uploadRevision: version.uploadRevision,
      replacementHistory: replacements.map((item) => ({
        revision: item.revision,
        fileName: item.fileName,
        fileSize: item.fileSize,
        hash: item.fileHash,
        uploadedBy: item.uploadedByName,
        uploadedAt: item.uploadedAt,
        replacedAt: item.replacedAt,
        replacedBy: item.replacedByName,
        reason: item.reason,
      })),
    };
  }

  private comparisonResponse(comparison: {
    id: string;
    jobCode: string;
    baselineVersionId: string;
    candidateVersionId: string;
    status: string;
    summary: string;
    differences: Prisma.JsonValue;
    aiModel: string | null;
    aiProvider: string | null;
    aiGenerationMode: string | null;
    aiWarning: string | null;
    ocrProvider: string | null;
    ocrConfidence: number | null;
    errorMessage: string | null;
    completedAt: Date | null;
    archivedAt: Date | null;
  }, versions: Array<{
    id: string;
    version: string;
    fileName: string;
    fileSize: number;
  }>) {
    const baseline = versions.find((item) => item.id === comparison.baselineVersionId);
    const candidate = versions.find((item) => item.id === comparison.candidateVersionId);
    return {
      id: comparison.id,
      jobCode: comparison.jobCode,
      status: comparison.status,
      baseline: baseline ? {
        id: baseline.id,
        version: baseline.version,
        fileName: baseline.fileName,
        fileSize: baseline.fileSize,
      } : null,
      candidate: candidate ? {
        id: candidate.id,
        version: candidate.version,
        fileName: candidate.fileName,
        fileSize: candidate.fileSize,
      } : null,
      summary: comparison.summary,
      differences: this.differences(comparison.differences),
      aiModel: comparison.aiModel,
      aiProvider: comparison.aiProvider,
      aiGenerationMode: comparison.aiGenerationMode === 'ai' ? 'ai' : 'fallback',
      aiWarning: comparison.aiWarning,
      ocrProvider: comparison.ocrProvider,
      ocrConfidence: comparison.ocrConfidence == null ? null : Math.round(comparison.ocrConfidence * 1000) / 10,
      errorMessage: comparison.errorMessage,
      completedAt: comparison.completedAt?.toISOString() ?? null,
      archivedAt: comparison.archivedAt?.toISOString() ?? null,
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private replacementHistory(value: Prisma.JsonValue): ReplacementHistoryEntry[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ReplacementHistoryEntry => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return Number.isInteger(row.revision) && typeof row.fileName === 'string' &&
        typeof row.fileHash === 'string' && typeof row.objectKey === 'string';
    });
  }

  private documentCode() {
    return `DOC-${this.dateCode()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private comparisonCode() {
    return `CMP-${this.dateCode()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private dateCode() {
    return new Date().toISOString().slice(0, 10).replaceAll('-', '');
  }
}
