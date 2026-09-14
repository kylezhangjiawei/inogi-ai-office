import { Body, Controller, Get, NotFoundException, Param, Post, Query, Request, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OssService } from '../oss/oss.service';
import { canInlineAttachment, isActiveAttachmentContent } from './attachment-security';
import { RdTechnicalDocumentsService, type ConfirmRdDocumentInput } from './rd-technical-documents.service';
import { RdWorkspaceInterceptor } from './rd-workspace.context';

type DocumentRequest = { user?: { id?: string; name?: string; permissions?: string[] } };
const actorOf = (request: DocumentRequest) => ({ userId: request.user?.id, userName: request.user?.name, permissions: request.user?.permissions ?? [] });

@Controller('research-development/tasks/:taskId/technical-documents')
@Permissions('page:rd-task-management', 'page:rd-my-workspace', 'rd-task:view-all', 'rd-task:reassign', 'rd-people:manage', 'rd-project:direct', 'rd-project:review-l1', 'rd-project:review-l2')
@UseInterceptors(RdWorkspaceInterceptor)
export class RdTechnicalDocumentsController {
  constructor(private readonly documents: RdTechnicalDocumentsService) {}

  @Get()
  list(@Param('taskId') taskId: string, @Request() request: DocumentRequest) {
    return this.documents.list(taskId, actorOf(request));
  }

  @Post()
  confirm(@Param('taskId') taskId: string, @Body() body: ConfirmRdDocumentInput, @Request() request: DocumentRequest) {
    return this.documents.confirm(taskId, body, actorOf(request));
  }
}

/** Embedded legacy versions use short-lived read capabilities issued only after task authorization. */
@Controller('research-development/technical-document-files')
export class RdTechnicalDocumentFilesController {
  constructor(private readonly documents: RdTechnicalDocumentsService, private readonly ossService: OssService) {}

  @Public()
  @Permissions()
  @Get(':versionId')
  async file(
    @Param('versionId') versionId: string, @Query('exp') exp: string, @Query('sig') sig: string,
    @Query('dl') download: string | undefined, @Res() response: Response,
  ) {
    if (!sig || !this.ossService.verifyPreviewToken(`rd-tech-doc:${versionId}`, Number(exp), sig)) throw new NotFoundException();
    const file = await this.documents.readEmbeddedVersion(versionId);
    if (!file) throw new NotFoundException();
    const active = isActiveAttachmentContent(file.name, file.mime);
    response.setHeader('Content-Type', active ? 'application/octet-stream' : file.mime);
    response.setHeader('Content-Disposition', !download && canInlineAttachment(file.name, file.mime)
      ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(file.name.replace(/["\r\n]/g, '_').slice(0, 180))}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'private, max-age=600, immutable');
    response.setHeader('Content-Length', String(file.buffer.length));
    response.end(file.buffer);
  }
}
