import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { Public } from '../auth/decorators/public.decorator';
import { CreateJobRuleDto } from './dto/create-job-rule.dto';
import { ListCandidatesQueryDto } from './dto/list-candidates-query.dto';
import { RunMailSyncDto } from './dto/run-mail-sync.dto';
import { ResumeUploadStatusQueryDto } from './dto/resume-upload-status-query.dto';
import { SaveMailConfigDto } from './dto/save-mail-config.dto';
import { SaveMailSyncScheduleDto } from './dto/save-mail-sync-schedule.dto';
import { SaveOpenAiConfigDto } from './dto/save-openai-config.dto';
import { UploadResumeFilesDto } from './dto/upload-resume-files.dto';
import { ResumeScreeningService } from './resume-screening.service';

@Controller('recruitment')
export class ResumeScreeningController {
  constructor(private readonly resumeScreeningService: ResumeScreeningService) {}

  @Public()
  @Get('health')
  getHealth() {
    return this.resumeScreeningService.getHealth();
  }

  @Public()
  @Get('security/public-key')
  getSecurityPublicKey() {
    return this.resumeScreeningService.getSecurityPublicKey();
  }

  // ── Integrations ────────────────────────────────────────────────────────────

  @Get('integrations/mail')
  listMailConfigs() {
    return this.resumeScreeningService.listMailConfigs();
  }

  @Post('integrations/mail')
  saveMailConfig(@Body() payload: SaveMailConfigDto) {
    return this.resumeScreeningService.saveMailConfig(payload);
  }

  @Get('integrations/openai')
  listOpenAiConfigs() {
    return this.resumeScreeningService.listOpenAiConfigs();
  }

  @Post('integrations/openai')
  saveOpenAiConfig(@Body() payload: SaveOpenAiConfigDto) {
    return this.resumeScreeningService.saveOpenAiConfig(payload);
  }

  @Delete('integrations/:configId')
  deleteIntegrationConfig(@Param('configId') configId: string) {
    return this.resumeScreeningService.deleteIntegrationConfig(configId);
  }

  // ── Job rules ───────────────────────────────────────────────────────────────

  @Get('job-rules')
  listJobRules() {
    return this.resumeScreeningService.listJobRules();
  }

  @Post('job-rules')
  saveJobRule(@Body() payload: CreateJobRuleDto) {
    return this.resumeScreeningService.saveJobRule(payload);
  }

  @Delete('job-rules/:jobRuleId')
  deleteJobRule(@Param('jobRuleId') jobRuleId: string) {
    return this.resumeScreeningService.deleteJobRule(jobRuleId);
  }

  // ── Mail sync ───────────────────────────────────────────────────────────────

  @Post('mail-sync/run')
  runMailSync(@Body() payload: RunMailSyncDto) {
    return this.resumeScreeningService.runMailSync(payload);
  }

  @Post('resume-upload/run')
  @UseInterceptors(FilesInterceptor('files', 200))
  uploadResumeFiles(
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }>,
    @Body() payload: UploadResumeFilesDto,
  ) {
    return this.resumeScreeningService.uploadResumeFilesDirect(files ?? [], payload);
  }

  @Post('resume-upload/statuses')
  getResumeUploadStatuses(@Body() payload: ResumeUploadStatusQueryDto) {
    return this.resumeScreeningService.getResumeUploadStatuses(payload.unique_keys ?? []);
  }

  @Get('mail-sync/schedule')
  getMailSyncSchedule() {
    return this.resumeScreeningService.getMailSyncSchedule();
  }

  @Post('mail-sync/schedule')
  saveMailSyncSchedule(@Body() payload: SaveMailSyncScheduleDto) {
    return this.resumeScreeningService.saveMailSyncSchedule(payload);
  }

  // ── Candidates ──────────────────────────────────────────────────────────────

  @Get('candidates')
  listCandidates(@Query() query: ListCandidatesQueryDto) {
    return this.resumeScreeningService.listCandidates(query);
  }

  @Get('candidates/:candidateId')
  getCandidateDetail(@Param('candidateId') candidateId: string) {
    return this.resumeScreeningService.getCandidateDetail(candidateId);
  }
}
