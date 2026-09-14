import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApplicantFormsService } from './applicant-forms.service';

@Controller('applicant-forms')
export class ApplicantFormsController {
  constructor(private readonly service: ApplicantFormsService) {}

  @Get('templates') @Permissions('page:applicant-forms') @Header('Cache-Control', 'no-store')
  listTemplates() { return this.service.listTemplates(); }

  @Post('templates') @Permissions('applicant-form:edit') @Header('Cache-Control', 'no-store')
  createTemplate(@Body() body: unknown, @Req() req: { user: { id: string } }) { return this.service.createTemplate(body, req.user.id); }

  @Get('templates/:id') @Permissions('page:applicant-forms') @Header('Cache-Control', 'no-store')
  getTemplate(@Param('id') id: string) { return this.service.getTemplate(id); }

  @Patch('templates/:id') @Permissions('applicant-form:edit') @Header('Cache-Control', 'no-store')
  updateDraft(@Param('id') id: string, @Body() body: unknown) { return this.service.updateDraft(id, body); }

  @Post('templates/:id/publish') @Permissions('applicant-form:publish') @Header('Cache-Control', 'no-store')
  publish(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: { id: string } }) { return this.service.publish(id, body, req.user.id); }

  @Get('templates/:id/versions') @Permissions('page:applicant-forms') @Header('Cache-Control', 'no-store')
  versions(@Param('id') id: string) { return this.service.listVersions(id); }

  @Post('ai-suggest') @Permissions('applicant-form:edit') @Throttle({ default: { limit: 6, ttl: 60000 } }) @Header('Cache-Control', 'no-store')
  suggest(@Body() body: unknown) { return this.service.suggest(body); }

  @Get('templates/:id/submissions') @Permissions('applicant-form:records') @Header('Cache-Control', 'no-store')
  submissions(@Param('id') id: string, @Query() query: unknown) { return this.service.listSubmissions(id, query); }

  @Get('submissions/:id') @Permissions('applicant-form:records') @Header('Cache-Control', 'no-store')
  detail(@Param('id') id: string) { return this.service.getSubmission(id); }

  @Patch('submissions/:id') @Permissions('applicant-form:records') @Header('Cache-Control', 'no-store')
  updateRecord(@Param('id') id: string, @Body() body: unknown) { return this.service.updateSubmission(id, body); }

  @Get('files/:id/download') @Permissions('applicant-form:records') @Header('Cache-Control', 'no-store')
  download(@Param('id') id: string) { return this.service.downloadFile(id); }
}

@Public()
@Controller('public/applicant-forms')
export class PublicApplicantFormsController {
  constructor(private readonly service: ApplicantFormsService) {}

  @Get(':slug') @Throttle({ default: { limit: 20, ttl: 60000 } }) @Header('Cache-Control', 'no-store') @Header('Referrer-Policy', 'no-referrer')
  form(@Param('slug') slug: string, @Req() req: { ip?: string }) { return this.service.getPublicForm(slug, req.ip ?? 'unknown'); }

  @Post(':slug') @Throttle({ default: { limit: 10, ttl: 60000 } }) @Header('Cache-Control', 'no-store')
  submit(@Param('slug') slug: string, @Body() body: unknown) { return this.service.submit(slug, body); }

  @Post(':slug/files') @Throttle({ default: { limit: 10, ttl: 60000 } }) @Header('Cache-Control', 'no-store')
  upload(@Param('slug') slug: string, @Body() body: unknown) { return this.service.upload(slug, body); }
}
