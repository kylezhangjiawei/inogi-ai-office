import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  ArchiveExternalComparisonDto,
  CreateExternalDocumentDto,
  ReplaceExternalCandidateDto,
  ReviewExternalDifferenceDto,
  UploadExternalDocumentVersionDto,
} from './dto/external-docs.dto';
import { ExternalDocsService } from './external-docs.service';

type RequestUser = { id?: string; sub?: string; name?: string; email?: string };
type UploadedDocument = { originalname: string; buffer: Buffer; mimetype: string; size: number };

@Controller('external-docs')
@Permissions('page:external-docs')
export class ExternalDocsController {
  constructor(private readonly service: ExternalDocsService) {}

  @Get('integration-status')
  integrationStatus() {
    return this.service.integrationStatus();
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  create(
    @Req() request: Request,
    @UploadedFile() file: UploadedDocument | undefined,
    @Body() input: CreateExternalDocumentDto,
  ) {
    if (!file) throw new BadRequestException('未上传文件');
    return this.service.createDocument(this.actor(request), file, input);
  }

  @Post(':id/versions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  uploadVersion(
    @Req() request: Request,
    @Param('id') documentId: string,
    @UploadedFile() file: UploadedDocument | undefined,
    @Body() input: UploadExternalDocumentVersionDto,
  ) {
    if (!file) throw new BadRequestException('未上传文件');
    return this.service.uploadVersion(this.actor(request), documentId, file, input);
  }

  @Put('comparisons/:id/review')
  reviewDifference(
    @Param('id') comparisonId: string,
    @Body() input: ReviewExternalDifferenceDto,
  ) {
    return this.service.reviewDifference(comparisonId, input.differenceId, input.reviewed);
  }

  @Put('comparisons/:id/review-all')
  reviewAll(@Param('id') comparisonId: string) {
    return this.service.reviewAll(comparisonId);
  }

  @Post('comparisons/:id/regenerate-summary')
  regenerateSummary(@Param('id') comparisonId: string) {
    return this.service.regenerateSummary(comparisonId);
  }

  @Post('comparisons/:id/archive')
  archive(
    @Req() request: Request,
    @Param('id') comparisonId: string,
    @Body() input: ArchiveExternalComparisonDto,
  ) {
    return this.service.archive(this.actor(request), comparisonId, input.summary);
  }

  @Post('comparisons/:id/retry')
  retry(@Param('id') comparisonId: string) {
    return this.service.retry(comparisonId);
  }

  /** 误传容错：替换尚未归档的候选文件，保留旧文件快照后重新启动比对。 */
  @Post('comparisons/:id/replace-candidate')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  replaceCandidate(
    @Req() request: Request,
    @Param('id') comparisonId: string,
    @UploadedFile() file: UploadedDocument | undefined,
    @Body() input: ReplaceExternalCandidateDto,
  ) {
    if (!file) throw new BadRequestException('未上传纠正文件');
    return this.service.replaceCandidate(this.actor(request), comparisonId, file, input.reason);
  }

  /** 历史版本原文件追溯：按需生成短效 OSS 签名地址，不在列表里持久化临时 URL。 */
  @Get('versions/:id/download')
  versionDownload(@Param('id') versionId: string, @Query('revision') revision?: string) {
    return this.service.versionDownload(versionId, revision);
  }

  /** 受控下载流：避免前端预开空白页，并支持当前文件与历史修订直接下载。 */
  @Get('versions/:id/download-content')
  async versionDownloadContent(
    @Param('id') versionId: string,
    @Query('revision') revision: string | undefined,
    @Res() response: Response,
  ) {
    const file = await this.service.versionDownloadContent(versionId, revision);
    response.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (file.size > 0) response.setHeader('Content-Length', String(file.size));

    file.stream.on('error', () => {
      if (response.headersSent) response.end();
      else response.status(500).end();
    });
    file.stream.pipe(response);
  }

  /**
   * 受控原文视觉预览：由已鉴权接口以内联方式回传原文件。
   * 前端按需在浏览器本地渲染 DOCX/PDF/图片，不把资料发送到第三方预览服务。
   */
  @Get('versions/:id/preview-content')
  async versionPreviewContent(
    @Param('id') versionId: string,
    @Res() response: Response,
  ) {
    const file = await this.service.versionPreviewContent(versionId);
    response.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (file.size > 0) response.setHeader('Content-Length', String(file.size));

    file.stream.on('error', () => {
      if (response.headersSent) response.end();
      else response.status(500).end();
    });
    file.stream.pipe(response);
  }

  @Get(':id')
  detail(@Param('id') documentId: string) {
    return this.service.detail(documentId);
  }

  private actor(request: Request) {
    const user = request.user as RequestUser | undefined;
    const id = user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException();
    return { id, name: user?.name?.trim() || user?.email?.trim() || '当前用户' };
  }
}
