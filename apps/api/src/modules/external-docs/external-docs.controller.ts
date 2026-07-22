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
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

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
