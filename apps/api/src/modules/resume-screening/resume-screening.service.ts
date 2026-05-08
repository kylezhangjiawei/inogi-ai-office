import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { ApplyCandidateAiUpdateDto } from './dto/apply-candidate-ai-update.dto';
import { CreateJobRuleDto } from './dto/create-job-rule.dto';
import { ListCandidatesQueryDto } from './dto/list-candidates-query.dto';
import { RunMailSyncDto } from './dto/run-mail-sync.dto';
import { AskCandidateAiDto } from './dto/ask-candidate-ai.dto';
import { IterateCandidateFilterDto } from './dto/iterate-candidate-filter.dto';
import { SaveMailConfigDto } from './dto/save-mail-config.dto';
import { SaveMailSyncScheduleDto } from './dto/save-mail-sync-schedule.dto';
import { SaveOpenAiConfigDto } from './dto/save-openai-config.dto';
import { UploadResumeFilesDto } from './dto/upload-resume-files.dto';
import { MailIngestionService } from './mail-ingestion.service';
import { OpenAiScreeningService } from './openai-screening.service';
import { ResumeDocumentService } from './resume-document.service';
import { ResumeParserService } from './resume-parser.service';
import { PROMPT_VERSION } from './resume-screening.constants';
import { CandidateProfile, InterviewQaItem, ScreeningResult } from './resume-screening.types';

type ScreeningStatusValue = 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'PENDING_CONFIG';

type OpenAiRuntimeConfig = {
  id: string | null;
  name?: string | null;
  provider?: string | null;
  apiKey?: string | null;
  model?: string | null;
  baseUrl?: string | null;
};

type FileScreeningTaskPayload = {
  uniqueKey: string;
  fileName: string;
  fileBuffer?: Buffer | null;
  mimeType?: string | null;
  rawText?: string | null;
  jobRuleId: string;
  jdText: string;
  jobRuleName: string;
  uploadedSource: {
    mailbox: string;
    imapUid: null;
    messageId: string;
    uniqueKey: string;
    subject: string;
    senderName: string;
    senderEmail: string;
    receivedAt: Date;
    contentText: string;
  };
  openAiConfig: OpenAiRuntimeConfig;
  fileExtractConfig?: OpenAiRuntimeConfig | null;
};

type ScreeningTaskPayload = {
  candidateId: string;
  uniqueKey: string;
  jobRuleId: string;
  jdText: string;
  profile: CandidateProfile;
  mail: {
    mailbox?: string | null;
    imapUid: number | null;
    messageId: string;
    uniqueKey: string;
    subject: string;
    senderName: string;
    senderEmail: string;
    receivedAt: Date;
    contentText: string;
  };
  openAiConfig: OpenAiRuntimeConfig;
};

type ScheduleMetadata = {
  runAt: string;
  sinceHours: number;
  limit: number;
  mailConfigId: string | null;
  openAiConfigId: string | null;
  lastTriggeredOn: string;
  lastRunAt: string | null;
  lastRunResult: string;
};

const SCHEDULE_CONFIG_NAME = 'mail-sync-schedule';
const ITERATIVE_FILTER_PROMPT_PREFIX = 'iterative-filter:';

@Injectable()
export class ResumeScreeningService implements OnModuleInit {
  private scheduleRunning = false;
  private screeningQueue: ScreeningTaskPayload[] = [];
  private screeningActiveCount = 0;
  private readonly screeningConcurrency: number;
  private fileScreeningQueue: FileScreeningTaskPayload[] = [];
  private fileScreeningActiveCount = 0;
  private aiFailureCache = new Map<string, { message: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
    private readonly mailIngestionService: MailIngestionService,
    private readonly resumeDocumentService: ResumeDocumentService,
    private readonly resumeParserService: ResumeParserService,
    private readonly openAiScreeningService: OpenAiScreeningService,
  ) {
    const configuredConcurrency = Number(process.env.AI_SCREENING_CONCURRENCY ?? 2);
    this.screeningConcurrency = Number.isFinite(configuredConcurrency)
      ? Math.min(10, Math.max(1, configuredConcurrency))
      : 3;
  }

  onModuleInit() {
    void this.checkAndRunScheduledSync({ allowCatchUp: true });
  }

  // Health

  async getHealth() {
    const [mailCount, openAiCount] = await Promise.all([
      this.prisma.integrationConfig.count({ where: { kind: 'mail', isActive: true } }),
      this.prisma.integrationConfig.count({ where: { kind: 'openai', isActive: true } }),
    ]);

    return {
      ok: true,
      mail_configured: mailCount > 0 || Boolean(process.env.MAIL_IMAP_HOST && process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD),
      openai_configured: openAiCount > 0 || this.openAiScreeningService.isConfigured(),
      database_path: 'postgresql',
    };
  }

  // Security

  getSecurityPublicKey() {
    return {
      algorithm: 'RSA-OAEP',
      public_key: this.secureConfigService.getPublicKey(),
    };
  }

  // Mail integrations

  async listMailConfigs() {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'mail' },
      orderBy: { updatedAt: 'desc' },
    });

    return configs.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      email: c.accountIdentifier ?? '',
      enabled: c.isActive,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    }));
  }

  async saveMailConfig(payload: SaveMailConfigDto) {
    const email = payload.email?.trim();
    if (!email) throw new BadRequestException('email is required.');

    if (payload.id) {
      const existing = await this.prisma.integrationConfig.findFirst({
        where: { id: payload.id, kind: 'mail' },
      });
      if (!existing) throw new NotFoundException('Mail config not found.');

      const encryptedSecret = this.resolveIncomingStoredSecret(
        {
          encryptedSecret: payload.encrypted_secret,
          plainSecret: payload.plain_secret,
        },
        existing.encryptedSecret,
      );

      const updated = await this.prisma.integrationConfig.update({
        where: { id: payload.id },
        data: {
          name: email,
          accountIdentifier: email,
          isActive: Boolean(payload.enabled),
          encryptedSecret,
          metadata: ((existing.metadata ?? {}) as Record<string, unknown>) as any,
        },
      });

      return this.toMailConfigResponse(updated);
    }

    const encryptedSecret = this.resolveIncomingStoredSecret({
      encryptedSecret: payload.encrypted_secret,
      plainSecret: payload.plain_secret,
    });
    if (!encryptedSecret) {
      throw new BadRequestException('encrypted_secret is required when creating a mail config.');
    }
    const created = await this.prisma.integrationConfig.create({
      data: {
        kind: 'mail',
        name: email,
        accountIdentifier: email,
        encryptedSecret,
        isActive: Boolean(payload.enabled),
        metadata: {},
      },
    });

    return this.toMailConfigResponse(created);
  }

  // OpenAI integrations

  async listOpenAiConfigs() {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai' },
      orderBy: { updatedAt: 'desc' },
    });

    return configs.map((c) => ({
      id: c.id,
      kind: c.kind,
      provider: c.provider ?? 'openai',
      name: c.name,
      model: c.model ?? '',
      enabled: c.isActive,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    }));
  }

  async saveOpenAiConfig(payload: SaveOpenAiConfigDto) {
    const name = payload.name?.trim();
    const model = payload.model?.trim();
    if (!name || !model) throw new BadRequestException('name and model are required.');

    if (payload.id) {
      const existing = await this.prisma.integrationConfig.findFirst({
        where: { id: payload.id, kind: 'openai' },
      });
      if (!existing) throw new NotFoundException('OpenAI config not found.');

      const encryptedSecret = this.resolveIncomingStoredSecret(
        {
          encryptedSecret: payload.encrypted_secret,
          plainSecret: payload.plain_secret,
        },
        existing.encryptedSecret,
      );

      const updated = await this.prisma.integrationConfig.update({
        where: { id: payload.id },
        data: {
          name,
          provider: 'openai',
          model,
          isActive: Boolean(payload.enabled),
          encryptedSecret,
          metadata: ((existing.metadata ?? {}) as Record<string, unknown>) as any,
        },
      });

      return this.toOpenAiConfigResponse(updated);
    }

    const encryptedSecret = this.resolveIncomingStoredSecret({
      encryptedSecret: payload.encrypted_secret,
      plainSecret: payload.plain_secret,
    });
    if (!encryptedSecret) {
      throw new BadRequestException('encrypted_secret is required when creating an OpenAI config.');
    }
    const created = await this.prisma.integrationConfig.create({
      data: {
        kind: 'openai',
        provider: 'openai',
        name,
        model,
        encryptedSecret,
        isActive: Boolean(payload.enabled),
        metadata: {},
      },
    });

    return this.toOpenAiConfigResponse(created);
  }

  async deleteIntegrationConfig(configId: string) {
    const config = await this.prisma.integrationConfig.findUnique({ where: { id: configId } });
    if (!config) throw new NotFoundException('Integration config not found.');
    await this.prisma.integrationConfig.delete({ where: { id: configId } });
    return { id: configId };
  }

  // Job rules

  async listJobRules() {
    const jobRules = await this.prisma.jobRule.findMany({ orderBy: { updatedAt: 'desc' } });
    return jobRules.map((jobRule) => this.toJobRuleResponse(jobRule));
  }

  async saveJobRule(payload: CreateJobRuleDto) {
    const parsedRule = await this.resolveJobRuleDraft(payload.jd_text, payload.name);

    if (payload.id) {
      const jobRule = await this.prisma.jobRule.update({
        where: { id: payload.id },
        data: { name: parsedRule.name, jdText: parsedRule.jdText, enabled: payload.enabled },
      });
      return this.toJobRuleResponse(jobRule);
    }
    const jobRule = await this.prisma.jobRule.create({
      data: { name: parsedRule.name, jdText: parsedRule.jdText, enabled: payload.enabled },
    });
    return this.toJobRuleResponse(jobRule);
  }

  async deleteJobRule(jobRuleId: string) {
    const jobRule = await this.prisma.jobRule.findUnique({ where: { id: jobRuleId } });
    if (!jobRule) throw new NotFoundException('Job rule not found.');

    await this.prisma.candidate.updateMany({
      where: { jobRuleId },
      data: { jobRuleId: null },
    });
    await this.prisma.candidateScreening.updateMany({
      where: { jobRuleId },
      data: { jobRuleId: null },
    });
    await this.prisma.jobRule.delete({ where: { id: jobRuleId } });
    return { id: jobRuleId };
  }

  // Mail sync schedule

  async getMailSyncSchedule() {
    const config = await this.prisma.integrationConfig.findFirst({
      where: { kind: 'sync_schedule', name: SCHEDULE_CONFIG_NAME },
      orderBy: { updatedAt: 'desc' },
    });
    return this.toScheduleResponse(config);
  }

  async saveMailSyncSchedule(payload: SaveMailSyncScheduleDto) {
    const runAt = this.normalizeScheduleRunAt(payload.run_at);
    if (!runAt || !/^\d{2}:\d{2}$/.test(runAt)) {
      throw new BadRequestException('执行时间格式不正确，请使用 HH:mm。');
    }

    const sinceHours = Math.max(1, Number(payload.since_hours || 72));
    const limit = Math.max(1, Number(payload.limit || 20));

    const existing = await this.prisma.integrationConfig.findFirst({
      where: { kind: 'sync_schedule', name: SCHEDULE_CONFIG_NAME },
    });
    const fallbackJobRule = await this.prisma.jobRule.findFirst({
      where: { enabled: true },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const nextJobRuleId =
      payload.job_rule_id?.trim() ||
      existing?.accountIdentifier?.trim() ||
      fallbackJobRule?.id ||
      null;
    const currentMeta = this.parseScheduleMetadata(existing?.metadata);
    const nextMailConfigId = payload.mail_config_id?.trim() || null;
    const nextOpenAiConfigId = payload.openai_config_id?.trim() || null;
    const nextEnabled = Boolean(payload.enabled);
    const executionConfigChanged =
      !existing ||
      existing.isActive !== nextEnabled ||
      (existing.accountIdentifier?.trim() || null) !== nextJobRuleId ||
      currentMeta.runAt !== runAt ||
      currentMeta.sinceHours !== sinceHours ||
      currentMeta.limit !== limit ||
      currentMeta.mailConfigId !== nextMailConfigId ||
      currentMeta.openAiConfigId !== nextOpenAiConfigId;

    const newMeta = {
      ...currentMeta,
      runAt,
      sinceHours,
      limit,
      mailConfigId: nextMailConfigId,
      openAiConfigId: nextOpenAiConfigId,
      lastTriggeredOn: executionConfigChanged ? '' : currentMeta.lastTriggeredOn,
      lastRunAt: executionConfigChanged ? null : currentMeta.lastRunAt,
      lastRunResult: executionConfigChanged ? '' : currentMeta.lastRunResult,
    };

    const saved = existing
      ? await this.prisma.integrationConfig.update({
          where: { id: existing.id },
          data: {
            isActive: nextEnabled,
            accountIdentifier: nextJobRuleId,
            metadata: newMeta,
          },
        })
      : await this.prisma.integrationConfig.create({
          data: {
            kind: 'sync_schedule',
            name: SCHEDULE_CONFIG_NAME,
            encryptedSecret: '',
            isActive: nextEnabled,
            accountIdentifier: nextJobRuleId,
            metadata: newMeta,
          },
        });

    if (saved.isActive) {
      void this.checkAndRunScheduledSync({ allowCatchUp: true });
    }

    return this.toScheduleResponse(saved);
  }

  // Mail sync run

  async runMailSync(payload: RunMailSyncDto) {
    const requestedJobRuleId = payload.job_rule_id?.trim() || null;
    const enabledJobRules = requestedJobRuleId
      ? await this.prisma.jobRule.findMany({
          where: { id: requestedJobRuleId, enabled: true },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        })
      : await this.prisma.jobRule.findMany({
          where: { enabled: true },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        });

    if (!enabledJobRules.length) {
      throw new BadRequestException('请先创建并启用至少一条岗位规则。');
    }

    const preferredJobRule = requestedJobRuleId
      ? enabledJobRules.find((item) => item.id === requestedJobRuleId) ?? null
      : null;
    if (requestedJobRuleId && !preferredJobRule) {
      throw new BadRequestException('当前选择的岗位规则不存在或未启用。');
    }

    // Resolve mail credentials: DB config takes priority over env vars
    const mailCredentials = await this.resolveMailCredentials(payload.mail_config_id);

    const mailbox = mailCredentials?.mailbox || process.env.MAIL_FOLDER || 'INBOX';
    const runtimeState = await this.prisma.runtimeState.findUnique({
      where: { key: `resume-sync:last-uid:${mailbox}` },
    });
    const lastUid = payload.ignore_last_uid ? null : runtimeState ? Number(runtimeState.value) : null;

    const { mails, latestUid, scannedCount } = await this.mailIngestionService.fetchCandidateEmails({
      sinceHours: payload.since_hours,
      limit: payload.limit,
      lastUid,
      credentials: mailCredentials ?? undefined,
    });

    // Resolve OpenAI credentials
    const openAiCreds = await this.resolveOpenAiCredentials(payload.openai_config_id);

    let processed = 0;
    let createdCandidates = 0;
    let skipped = 0;
    let failed = 0;
    let queuedForAi = 0;
    let sharedAiFailureMessage: string | null = null;
    const mailPreviews: Array<{
      unique_key: string;
      candidate_id?: string;
      subject: string;
      sender_name: string;
      sender_email: string;
      received_at: string;
      preview: string;
      candidate_name: string;
      status: string;
      error_message?: string;
    }> = [];

    for (const mail of mails) {
      const preview = mail.contentText.replace(/\s+/g, ' ').trim().slice(0, 800);
      const existingLog = await this.prisma.emailIngestionLog.findUnique({
        where: { uniqueKey: mail.uniqueKey },
      });
      const shouldRescreenExisting = Boolean(payload.ignore_last_uid);
      if (existingLog && !shouldRescreenExisting) {
        skipped += 1;
        mailPreviews.push({
          unique_key: mail.uniqueKey,
          subject: mail.subject,
          sender_name: mail.senderName,
          sender_email: mail.senderEmail,
          received_at: mail.receivedAt.toISOString(),
          preview,
          candidate_name: '',
          status: '已存在',
          error_message: '该邮件此前已同步，无需重复处理。',
        });
        continue;
      }

      processed += 1;
      const profile = this.resumeParserService.extractCandidateProfile(mail.contentText, {
        senderEmail: mail.senderEmail,
        senderName: mail.senderName,
        subject: mail.subject,
        html: mail.contentHtml,
      });
      const screeningPrecheck = this.resumeParserService.shouldAttemptScreening(profile);
      const jobRulesToMatch = enabledJobRules;
      const matchedJobRule = this.findMatchingJobRuleForMail(profile, mail, jobRulesToMatch, preferredJobRule?.id);
      let candidateId: string | null = null;

      if (!matchedJobRule) {
        const mismatchMessage = preferredJobRule
          ? `当前邮件未匹配到所选岗位“${preferredJobRule.name}”，未提交 AI 分析。`
          : '邮件主题与简历内容未匹配到任何已启用岗位规则，未提交 AI 分析。';
        skipped += 1;
        await this.createIngestionLog(mail, null, 'skipped', mismatchMessage);
        mailPreviews.push({
          unique_key: mail.uniqueKey,
          subject: mail.subject,
          sender_name: mail.senderName,
          sender_email: mail.senderEmail,
          received_at: mail.receivedAt.toISOString(),
          preview,
          candidate_name: profile.name,
          status: '不符合岗位',
          error_message: mismatchMessage,
        });
        continue;
      }

      try {
        const candidate = await this.prisma.candidate.upsert({
          where: { uniqueKey: mail.uniqueKey },
          create: this.buildCandidateCreateInput(mail.uniqueKey, matchedJobRule.id, profile, mail),
          update: this.buildCandidateUpdateInput(matchedJobRule.id, profile, mail),
        });
        candidateId = candidate.id;
        if (!existingLog) {
          createdCandidates += 1;
        }

        if (!screeningPrecheck.allowed) {
          await this.createScreeningRecord(candidate.id, matchedJobRule.id, profile, matchedJobRule.jdText, {
            status: 'SKIPPED',
            errorMessage: screeningPrecheck.reason,
          });
          await this.createIngestionLog(mail, candidate.id, 'skipped', screeningPrecheck.reason ?? undefined);
          skipped += 1;
          mailPreviews.push({
            unique_key: mail.uniqueKey,
            candidate_id: candidate.id,
            subject: mail.subject,
            sender_name: mail.senderName,
            sender_email: mail.senderEmail,
            received_at: mail.receivedAt.toISOString(),
            preview,
            candidate_name: profile.name,
            status: '已获取',
            error_message: screeningPrecheck.reason ?? undefined,
          });
          continue;
        }

        if (!this.openAiScreeningService.isConfigured(openAiCreds?.apiKey, openAiCreds?.provider)) {
          const message = '未配置 AI 模型 Key，已保存候选人，但尚未执行 AI 初筛。';
          await this.createScreeningRecord(candidate.id, matchedJobRule.id, profile, matchedJobRule.jdText, {
            status: 'PENDING_CONFIG',
            errorMessage: message,
          });
          await this.createIngestionLog(mail, candidate.id, 'pending_config', message);
          mailPreviews.push({
            unique_key: mail.uniqueKey,
            candidate_id: candidate.id,
            subject: mail.subject,
            sender_name: mail.senderName,
            sender_email: mail.senderEmail,
            received_at: mail.receivedAt.toISOString(),
            preview,
            candidate_name: profile.name,
            status: '已获取，待初筛',
            error_message: message,
          });
          continue;
        }

        const cachedAiFailure = this.getCachedAiFailure(openAiCreds?.id);
        if (cachedAiFailure) {
          failed += 1;
          await this.createScreeningRecord(candidate.id, matchedJobRule.id, profile, matchedJobRule.jdText, {
            status: 'FAILED',
            errorMessage: cachedAiFailure,
          });
          await this.createIngestionLog(mail, candidate.id, 'failed', cachedAiFailure);
          mailPreviews.push({
            unique_key: mail.uniqueKey,
            candidate_id: candidate.id,
            subject: mail.subject,
            sender_name: mail.senderName,
            sender_email: mail.senderEmail,
            received_at: mail.receivedAt.toISOString(),
            preview,
            candidate_name: profile.name,
            status: '处理失败',
            error_message: cachedAiFailure,
          });
          continue;
        }

        await this.createIngestionLog(mail, candidate.id, 'queued');
        this.enqueueScreeningTask({
          candidateId: candidate.id,
          uniqueKey: mail.uniqueKey,
          jobRuleId: matchedJobRule.id,
          jdText: matchedJobRule.jdText,
          profile,
          mail,
          openAiConfig: {
            id: openAiCreds?.id ?? null,
            provider: openAiCreds?.provider ?? null,
            apiKey: openAiCreds?.apiKey ?? null,
            model: openAiCreds?.model ?? null,
            baseUrl: openAiCreds?.baseUrl ?? null,
          },
        });
        queuedForAi += 1;
        mailPreviews.push({
          unique_key: mail.uniqueKey,
          candidate_id: candidate.id,
          subject: mail.subject,
          sender_name: mail.senderName,
          sender_email: mail.senderEmail,
          received_at: mail.receivedAt.toISOString(),
          preview,
          candidate_name: profile.name,
          status: `已入队，后台 AI 筛选中（${matchedJobRule.name}）`,
        });
      } catch (error) {
        failed += 1;
        const sourceErrorMessage = this.getSourceErrorMessage(error);
        if (candidateId) {
          await this.createScreeningRecord(candidateId, matchedJobRule.id, profile, matchedJobRule.jdText, {
            status: 'FAILED',
            errorMessage: sourceErrorMessage,
          });
        }
        await this.createIngestionLog(mail, candidateId, 'failed', sourceErrorMessage);
        mailPreviews.push({
          unique_key: mail.uniqueKey,
          candidate_id: candidateId ?? undefined,
          subject: mail.subject,
          sender_name: mail.senderName,
          sender_email: mail.senderEmail,
          received_at: mail.receivedAt.toISOString(),
          preview,
          candidate_name: profile.name,
          status: '处理失败',
          error_message: sourceErrorMessage,
        });
      }
    }

    if (latestUid) {
      await this.prisma.runtimeState.upsert({
        where: { key: `resume-sync:last-uid:${mailbox}` },
        create: { key: `resume-sync:last-uid:${mailbox}`, value: String(latestUid) },
        update: { value: String(latestUid) },
      });
    }

    return {
      scanned_count: scannedCount,
      matched_count: mails.length,
      processed,
      created_candidates: createdCandidates,
      skipped,
      failed,
      queued_for_ai: queuedForAi,
      latest_uid: latestUid,
      job_rule_id: preferredJobRule?.id ?? (enabledJobRules.length === 1 ? enabledJobRules[0].id : null),
      mail_config_id: payload.mail_config_id ?? null,
      openai_config_id: openAiCreds?.id ?? payload.openai_config_id ?? null,
      actual_screening_model: openAiCreds?.model ?? null,
      mail_previews: mailPreviews,
      message:
        mails.length > 0
          ? `同步完成，共匹配到 ${mails.length} 封邮件，新增 ${createdCandidates} 位候选人，跳过 ${skipped} 封，失败 ${failed} 封。`
          : `本次已检查 ${scannedCount} 封邮件，未发现符合条件的新邮件。`,
    };
  }

  // Uploaded resumes

  async uploadResumeFiles(
    files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }>,
    payload: UploadResumeFilesDto,
  ) {
    return this.uploadResumeFilesDirect(files, payload);
  }

  async uploadResumeFilesDirect(
    files: Array<{ originalname: string; buffer: Buffer; mimetype?: string }>,
    payload: UploadResumeFilesDto,
  ) {
    if (!files.length) {
      throw new BadRequestException('请至少选择一个 PDF 或 DOCX 简历文件。');
    }

    const requestedJobRuleId = payload.job_rule_id?.trim() || null;
    const enabledJobRules = await this.prisma.jobRule.findMany({
      where: { enabled: true },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!enabledJobRules.length) {
      throw new BadRequestException(
        requestedJobRuleId ? '当前选择的岗位规则不存在或未启用。' : '请先至少启用一条岗位规则，再上传简历文件夹。',
      );
    }
    const preferredJobRule = requestedJobRuleId
      ? enabledJobRules.find((item) => item.id === requestedJobRuleId) ?? null
      : null;
    if (requestedJobRuleId && !preferredJobRule) {
      throw new BadRequestException('当前选择的岗位规则不存在或未启用。');
    }

    const openAiCreds = await this.resolveOpenAiCredentials(payload.openai_config_id);
    const fileExtractCreds = await this.resolveFileExtractCredentials(openAiCreds);
    const supportsDirectAiFileScreening = Boolean(fileExtractCreds);

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let queuedForAi = 0;
    let unsupportedCount = 0;
    let unmatchedJobRuleCount = 0;
    let duplicateCount = 0;
    const filePreviews: Array<{
      unique_key: string;
      file_name: string;
      file_type: string;
      received_at: string;
      preview: string;
      candidate_name: string;
      status: string;
      error_message?: string;
    }> = [];

    for (const file of files) {
      const fileName = this.normalizeUploadedFileName(file.originalname);
      const uniqueKey = this.buildUploadedResumeUniqueKey(fileName, file.buffer);
      const receivedAt = new Date();
      const matchedJobRule = this.matchUploadedFileToJobRule(fileName, enabledJobRules, preferredJobRule?.id);

      if (!this.resumeDocumentService.isSupportedFile(fileName)) {
        skipped += 1;
        unsupportedCount += 1;
        filePreviews.push({
          unique_key: uniqueKey,
          file_name: fileName,
          file_type: this.getFileExtensionLabel(fileName),
          received_at: receivedAt.toISOString(),
          preview: '',
          candidate_name: '',
          status: '格式不支持',
          error_message: '当前仅支持 PDF 和 DOCX 简历。',
        });
        continue;
      }

      if (!matchedJobRule) {
        skipped += 1;
        unmatchedJobRuleCount += 1;
        filePreviews.push({
          unique_key: uniqueKey,
          file_name: fileName,
          file_type: this.getFileExtensionLabel(fileName),
          received_at: receivedAt.toISOString(),
          preview: '',
          candidate_name: '',
          status: '不符合岗位',
          error_message: '文件名未匹配到任何已启用岗位规则，未提交 AI 分析。',
        });
        continue;
      }

      const existingLog = await this.prisma.emailIngestionLog.findUnique({
        where: { uniqueKey },
        select: {
          status: true,
          candidateId: true,
        },
      });
      const shouldSkipDuplicate =
        existingLog &&
        (existingLog.status === 'queued' ||
          existingLog.status === 'completed' ||
          (existingLog.status === 'skipped' && Boolean(existingLog.candidateId)));
      if (shouldSkipDuplicate) {
        skipped += 1;
        duplicateCount += 1;
        filePreviews.push({
          unique_key: uniqueKey,
          file_name: fileName,
          file_type: this.getFileExtensionLabel(fileName),
          received_at: receivedAt.toISOString(),
          preview: '',
          candidate_name: '',
          status: '已存在',
          error_message: '该简历文件此前已上传处理，无需重复分析。',
        });
        continue;
      }

      processed += 1;
      const uploadedSource = {
        mailbox: 'UPLOAD',
        imapUid: null as null,
        messageId: uniqueKey,
        uniqueKey,
        subject: fileName,
        senderName: '文件上传',
        senderEmail: '',
        receivedAt,
        contentText: '',
      };

      try {
        const fallbackExtraction = supportsDirectAiFileScreening ? null : await this.resumeDocumentService.extractText(file);
        const preview = fallbackExtraction?.text.replace(/\s+/g, ' ').trim().slice(0, 800) ?? '';
        uploadedSource.contentText = fallbackExtraction?.text ?? '';

        if (!this.openAiScreeningService.isConfigured(openAiCreds?.apiKey, openAiCreds?.provider)) {
          const message = '未配置 AI 模型 Key，无法执行简历分析，请先配置 AI 模型。';
          await this.createIngestionLog(uploadedSource, null, 'pending_config', message);
          failed += 1;
          filePreviews.push({
            unique_key: uniqueKey,
            file_name: fileName,
            file_type: fallbackExtraction?.fileType ?? this.getFileExtensionLabel(fileName),
            received_at: receivedAt.toISOString(),
            preview,
            candidate_name: '',
            status: '待配置 AI',
            error_message: message,
          });
          continue;
        }

        const cachedAiFailure = this.getCachedAiFailure(openAiCreds?.id);
        if (cachedAiFailure) {
          failed += 1;
          await this.createIngestionLog(uploadedSource, null, 'failed', cachedAiFailure);
          filePreviews.push({
            unique_key: uniqueKey,
            file_name: fileName,
            file_type: fallbackExtraction?.fileType ?? this.getFileExtensionLabel(fileName),
            received_at: receivedAt.toISOString(),
            preview,
            candidate_name: '',
            status: '处理失败',
            error_message: cachedAiFailure,
          });
          continue;
        }

        await this.createIngestionLog(uploadedSource, null, 'queued');
        this.enqueueFileScreeningTask({
          uniqueKey,
          fileName,
          fileBuffer: file.buffer,
          mimeType: typeof file.mimetype === 'string' ? file.mimetype : null,
          rawText: fallbackExtraction?.text ?? null,
          jobRuleId: matchedJobRule.id,
          jdText: matchedJobRule.jdText,
          jobRuleName: matchedJobRule.name,
          uploadedSource,
          openAiConfig: {
            id: openAiCreds?.id ?? null,
            provider: openAiCreds?.provider ?? null,
            apiKey: openAiCreds?.apiKey ?? null,
            model: openAiCreds?.model ?? null,
            baseUrl: openAiCreds?.baseUrl ?? null,
          },
          fileExtractConfig: fileExtractCreds,
        });
        queuedForAi += 1;
        filePreviews.push({
          unique_key: uniqueKey,
          file_name: fileName,
          file_type: fallbackExtraction?.fileType ?? this.getFileExtensionLabel(fileName),
          received_at: receivedAt.toISOString(),
          preview,
          candidate_name: '',
          status: supportsDirectAiFileScreening
            ? `已入队，AI 正在读取文件并筛选（${matchedJobRule.name}）`
            : `已入队，AI 正在分析（${matchedJobRule.name}）`,
        });
      } catch (error) {
        failed += 1;
        const sourceErrorMessage = this.getSourceErrorMessage(error);
        await this.createIngestionLog(uploadedSource, null, 'failed', sourceErrorMessage);
        filePreviews.push({
          unique_key: uniqueKey,
          file_name: fileName,
          file_type: this.getFileExtensionLabel(fileName),
          received_at: receivedAt.toISOString(),
          preview: '',
          candidate_name: '',
          status: '处理失败',
          error_message: sourceErrorMessage,
        });
      }
    }

    return {
      uploaded_count: files.length,
      processed,
      created_candidates: 0,
      skipped,
      failed,
      queued_for_ai: queuedForAi,
      job_rule_id: preferredJobRule?.id ?? null,
      openai_config_id: openAiCreds?.id ?? payload.openai_config_id ?? null,
      actual_extract_model: fileExtractCreds?.model ?? null,
      actual_screening_model: openAiCreds?.model ?? null,
      file_previews: filePreviews,
      message:
        queuedForAi > 0
          ? supportsDirectAiFileScreening
            ? `已将 ${queuedForAi} 份简历按文件名匹配岗位后提交给 AI 文档能力读取文件，再由所选模型完成评分与结论，跳过 ${skipped} 份，失败 ${failed} 份。`
            : `已将 ${queuedForAi} 份简历按文件名匹配岗位后提交给 AI 进行筛选，跳过 ${skipped} 份，失败 ${failed} 份。`
          : `本次共接收 ${files.length} 份文件，未成功入队。格式不支持 ${unsupportedCount} 份，岗位未匹配 ${unmatchedJobRuleCount} 份，重复文件 ${duplicateCount} 份，请查看下方文件结果。`,
    };
  }

  async getResumeUploadStatuses(uniqueKeys: string[]) {
    const normalizedKeys = Array.from(
      new Set(
        uniqueKeys
          .map((item) => item?.trim())
          .filter((item): item is string => Boolean(item)),
      ),
    );

    if (!normalizedKeys.length) {
      return [] as Array<{
        unique_key: string;
        candidate_id: string | null;
        status: string;
        error_message?: string;
      }>;
    }

    const logs = await this.prisma.emailIngestionLog.findMany({
      where: {
        uniqueKey: { in: normalizedKeys },
      },
      select: {
        uniqueKey: true,
        candidateId: true,
        status: true,
        errorMessage: true,
      },
    });

    return logs.map((log) => ({
      unique_key: log.uniqueKey,
      candidate_id: log.candidateId ?? null,
      status: log.status,
      error_message: log.errorMessage ?? undefined,
    }));
  }

  async listCandidates(query: ListCandidatesQueryDto) {
    const keyword = query.keyword?.trim().toLowerCase() ?? '';
    const pageSize = this.clampNumber(query.page_size, 10, 1, 100);
    const requestedPage = this.clampNumber(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const minAge = typeof query.min_age === 'number' && Number.isFinite(query.min_age) ? query.min_age : null;
    const maxAge = typeof query.max_age === 'number' && Number.isFinite(query.max_age) ? query.max_age : null;
    const screeningVersion = query.screening_version?.trim() ?? '';
    const candidates = await this.prisma.candidate.findMany({
      where: { jobRuleId: query.job_rule_id },
      include: {
        jobRule: true,
        screenings: screeningVersion
          ? {
              where: { promptVersion: this.buildIterativeFilterPromptVersion(screeningVersion) },
              orderBy: { createdAt: 'desc' },
              take: 1,
            }
          : { orderBy: { createdAt: 'desc' }, take: 20 },
      },
      orderBy: { receivedAt: 'desc' },
    });

    const filteredCandidates = candidates
      .map((candidate) => {
        const screening = screeningVersion
          ? this.pickScreeningForVersion(candidate.screenings, screeningVersion)
          : this.pickPreferredScreening(candidate.screenings);
        if (screeningVersion && !screening) {
          return null;
        }
        const latestScreening = candidate.screenings[0] ?? null;
        const parsedProfile = this.buildDisplayProfile(candidate);
        const structuredResponse =
          screening && screening.responsePayload && typeof screening.responsePayload === 'object'
            ? ((screening.responsePayload as Record<string, unknown>).structured_output as Record<string, unknown> | undefined)
            : undefined;
        return {
          id: candidate.id,
          unique_key: candidate.uniqueKey,
          job_rule_id: candidate.jobRuleId,
          job_rule_name: candidate.jobRule?.name ?? null,
          name: parsedProfile.name || candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          gender: parsedProfile.gender ?? '',
          birth_or_age: parsedProfile.birth_or_age ?? '',
          city: parsedProfile.city || candidate.city,
          hukou: parsedProfile.hukou ?? '',
          education: parsedProfile.education || candidate.education,
          status: parsedProfile.status || candidate.status,
          target_job: parsedProfile.target_job || candidate.targetJob,
          ai_job: typeof structuredResponse?.ai_job === 'string' ? structuredResponse.ai_job : null,
          received_at: candidate.receivedAt.toISOString(),
          source_subject: this.isUploadedResumeSource(candidate)
            ? this.normalizeUploadedFileName(candidate.sourceSubject)
            : candidate.sourceSubject,
          source_sender_email: candidate.sourceSenderEmail,
          avatar_url: parsedProfile.avatar_url ?? '',
          score: screening?.score ?? null,
          decision: screening?.decision ? screening.decision.toLowerCase() : null,
          summary: screening?.summary ?? null,
          next_step: screening?.nextStep ?? null,
          active_screening_status: screening?.status.toLowerCase() ?? null,
          screening_status: latestScreening?.status.toLowerCase() ?? null,
          screening_error_message: latestScreening?.errorMessage ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => {
        if (keyword) {
          const searchableText = [
            item.name,
            item.email,
            item.phone,
            item.gender,
            item.birth_or_age,
            item.city,
            item.hukou,
            item.education,
            item.status,
            item.target_job,
            item.ai_job,
            item.job_rule_name,
            item.source_subject,
            item.summary,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!searchableText.includes(keyword)) return false;
        }
        if (query.decision && item.decision !== query.decision) return false;
        if (typeof query.min_score === 'number' && (item.score ?? 0) < query.min_score) return false;
        if (minAge !== null || maxAge !== null) {
          const age = this.parseAgeFromBirthOrAge(item.birth_or_age);
          if (age !== null) {
            if (minAge !== null && age < minAge) return false;
            if (maxAge !== null && age > maxAge) return false;
          }
        }
        return true;
      });

    const total = filteredCandidates.length;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const page = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
    const start = (page - 1) * pageSize;
    const items = filteredCandidates.slice(start, start + pageSize);

    return {
      items,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages,
        has_next: totalPages > 0 && page < totalPages,
        has_previous: totalPages > 0 && page > 1,
      },
    };
  }

  async listCandidateFilterSessions(jobRuleId?: string) {
    const normalizedJobRuleId = jobRuleId?.trim();
    const screenings = await this.prisma.candidateScreening.findMany({
      where: {
        promptVersion: { startsWith: ITERATIVE_FILTER_PROMPT_PREFIX },
        ...(normalizedJobRuleId ? { jobRuleId: normalizedJobRuleId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        promptVersion: true,
        decision: true,
        createdAt: true,
        requestPayload: true,
        responsePayload: true,
      },
    });

    const grouped = new Map<
      string,
      {
        version_id: string;
        label: string;
        instruction: string;
        answer: string;
        filter_summary: string;
        criteria: string[];
        created_at: string;
        total_count: number;
        recommend_count: number;
        hold_count: number;
        reject_count: number;
      }
    >();

    for (const screening of screenings) {
      const versionId = this.extractIterativeFilterVersionId(screening.promptVersion);
      if (!versionId) continue;

      const requestPayload = this.asRecord(screening.requestPayload);
      const responsePayload = this.asRecord(screening.responsePayload);
      const filterSession = this.asRecord(responsePayload.filter_session);
      const instruction = this.toTrimmedString(filterSession.instruction) || this.toTrimmedString(requestPayload.instruction);
      const answer = this.toTrimmedString(filterSession.answer);
      const filterSummary =
        this.toTrimmedString(filterSession.filter_summary) ||
        this.toTrimmedString(requestPayload.filter_summary) ||
        this.toTrimmedString(requestPayload.instruction);

      let item = grouped.get(versionId);
      if (!item) {
        item = {
          version_id: versionId,
          label: instruction ? `筛选版本：${instruction.slice(0, 24)}` : `筛选版本 ${versionId.slice(-6)}`,
          instruction,
          answer,
          filter_summary: filterSummary,
          criteria: this.normalizeStringArray(filterSession.criteria),
          created_at: screening.createdAt.toISOString(),
          total_count: 0,
          recommend_count: 0,
          hold_count: 0,
          reject_count: 0,
        };
        grouped.set(versionId, item);
      }

      item.total_count += 1;
      const decision = screening.decision?.toLowerCase();
      if (decision === 'recommend') item.recommend_count += 1;
      if (decision === 'hold') item.hold_count += 1;
      if (decision === 'reject') item.reject_count += 1;
    }

    return Array.from(grouped.values()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  async iterateCandidateFilter(payload: IterateCandidateFilterDto) {
    const instruction = payload.instruction?.trim();
    if (!instruction) {
      throw new BadRequestException('请输入本轮希望 AI 重新筛选的条件。');
    }

    const jobRuleId = payload.job_rule_id?.trim() ?? '';
    const jobRule = jobRuleId ? await this.prisma.jobRule.findUnique({ where: { id: jobRuleId } }) : null;
    if (jobRuleId && !jobRule) {
      throw new NotFoundException('岗位规则不存在。');
    }
    if (jobRuleId && !jobRule?.jdText?.trim()) {
      throw new BadRequestException('当前岗位规则没有 JD 内容，无法进行二次筛选。');
    }

    const candidateIds = (payload.candidate_ids ?? [])
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));
    const limit = this.clampNumber(payload.limit, 50, 1, 80);
    const baseVersion = payload.base_version?.trim() ?? '';

    const candidates = await this.prisma.candidate.findMany({
      where: {
        ...(jobRuleId ? { jobRuleId } : {}),
        ...(candidateIds.length ? { id: { in: candidateIds } } : {}),
      },
      include: {
        jobRule: true,
        screenings: { orderBy: { createdAt: 'desc' }, take: 80 },
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });

    if (!candidates.length) {
      throw new BadRequestException('当前岗位下没有可筛选的候选人。');
    }

    const openAiCreds = await this.resolveOpenAiCredentials();
    if (!this.openAiScreeningService.isConfigured(openAiCreds?.apiKey, openAiCreds?.provider)) {
      throw new BadRequestException('未配置 AI 模型 Key，无法进行候选人列表二次筛选。');
    }

    const history = (payload.history ?? [])
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && item.content?.trim())
      .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 4000) }))
      .slice(-10);

    const candidateSnapshots = candidates.map((candidate) => {
      const profile = this.buildDisplayProfile(candidate);
      const activeScreening = baseVersion
        ? this.pickScreeningForVersion(candidate.screenings, baseVersion) ?? this.pickPreferredScreening(candidate.screenings)
        : this.pickPreferredScreening(candidate.screenings);
      const activeScreeningResponse = activeScreening ? this.toCandidateScreeningResponse(activeScreening) : null;
      return {
        candidate_id: candidate.id,
        job_rule_id: candidate.jobRuleId,
        job_rule_name: candidate.jobRule?.name ?? '',
        name: profile.name || candidate.name,
        city: profile.city || candidate.city,
        education: profile.education || candidate.education,
        age_or_birth: profile.birth_or_age,
        target_job: profile.target_job || candidate.targetJob,
        ai_job: activeScreeningResponse?.ai_job ?? null,
        salary_expectation: profile.salary_expectation || candidate.salaryExpectation,
        years_experience: profile.years_experience || candidate.yearsExperience,
        recent_company: profile.recent_company || candidate.recentCompany,
        recent_title: profile.recent_title || candidate.recentTitle,
        current_score: activeScreening?.score ?? null,
        current_decision: activeScreening?.decision?.toLowerCase() ?? null,
        current_summary: activeScreening?.summary ?? null,
        current_tags: this.normalizeStringArray(activeScreeningResponse?.tags),
        current_matched_points: this.normalizeStringArray(activeScreeningResponse?.matched_points),
        current_risks: this.normalizeStringArray(activeScreeningResponse?.risks),
        resume_excerpt: this.pickBetterString(profile.work_summary, profile.raw_text, candidate.rawEmailText).slice(0, 1400),
      };
    });
    const jobContext = {
      scope: jobRuleId ? 'single_job' : 'all_jobs',
      job_rules: Array.from(
        new Map(
          candidates
            .map((candidate) => candidate.jobRule)
            .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule?.id))
            .map((rule) => [
              rule.id,
              {
                id: rule.id,
                name: rule.name,
                jd_text: rule.jdText.slice(0, jobRuleId ? 12000 : 3000),
              },
            ]),
        ).values(),
      ),
    };

    let result: Awaited<ReturnType<OpenAiScreeningService['iterateCandidateFilter']>>;
    try {
      result = await this.openAiScreeningService.iterateCandidateFilter(
        jobContext,
        candidateSnapshots,
        instruction,
        history,
        openAiCreds?.apiKey ?? undefined,
        openAiCreds?.model ?? undefined,
        openAiCreds?.baseUrl ?? undefined,
        openAiCreds?.provider ?? undefined,
      );

      await this.updateOpenAiModelRuntime(openAiCreds?.id, {
        success: true,
        baseUrl: openAiCreds?.baseUrl,
        durationMs: result.durationMs,
        totalTokens: result.usage.totalTokens,
      });
    } catch (error) {
      const message = this.getSourceErrorMessage(error);
      await this.updateOpenAiModelRuntime(openAiCreds?.id, {
        success: false,
        baseUrl: openAiCreds?.baseUrl,
        errorMessage: message,
      });
      throw new BadRequestException(`AI 迭代筛选失败：${message}`);
    }

    if (result.result.action !== 'filter') {
      return {
        action: 'clarify' as const,
        answer: result.result.answer,
        clarification_question: result.result.clarification_question,
        filter_summary: result.result.filter_summary,
        criteria: result.result.criteria,
        total_count: candidates.length,
        recommend_count: 0,
        hold_count: 0,
        reject_count: 0,
        model_name: result.modelName,
        duration_ms: result.durationMs,
      };
    }

    const versionId = this.createIterativeFilterVersionId();
    const promptVersion = this.buildIterativeFilterPromptVersion(versionId);
    const updatesByCandidateId = new Map(
      result.result.candidate_updates
        .map((item) => [this.toTrimmedString(item.candidate_id), item] as const)
        .filter(([candidateId]) => Boolean(candidateId)),
    );
    const rawOutputExcerpt =
      typeof result.responsePayload.raw_output === 'string' ? result.responsePayload.raw_output.slice(0, 12000) : '';
    const sessionMetadata = {
      source: 'candidate_iterative_filter',
      action: 'filter',
      version_id: versionId,
      base_version: baseVersion || null,
      job_rule_id: jobRuleId || null,
      instruction,
      answer: result.result.answer,
      filter_summary: result.result.filter_summary,
      criteria: result.result.criteria,
      model_name: result.modelName,
      created_at: new Date().toISOString(),
    };

    const created = await this.prisma.$transaction(
      candidates.map((candidate) => {
        const activeScreening = baseVersion
          ? this.pickScreeningForVersion(candidate.screenings, baseVersion) ?? this.pickPreferredScreening(candidate.screenings)
          : this.pickPreferredScreening(candidate.screenings);
        const activeScreeningResponse = activeScreening ? this.toCandidateScreeningResponse(activeScreening) : null;
        const rawUpdate = updatesByCandidateId.get(candidate.id) ?? {};
        const patch = this.buildIterativeFilterPatch(
          rawUpdate,
          activeScreeningResponse
            ? {
                ...activeScreeningResponse,
                tags: this.normalizeStringArray(activeScreeningResponse.tags),
                matched_points: this.normalizeStringArray(activeScreeningResponse.matched_points),
                risks: this.normalizeStringArray(activeScreeningResponse.risks),
              }
            : null,
        );
        const responsePayload = {
          raw_output: rawOutputExcerpt,
          structured_output: {
            ...this.asRecord(activeScreening?.responsePayload && this.asRecord(activeScreening.responsePayload).structured_output),
            ...patch,
          },
          filter_session: sessionMetadata,
          change_reason: this.toTrimmedString(rawUpdate.change_reason),
        };

        return this.prisma.candidateScreening.create({
          data: {
            candidateId: candidate.id,
            jobRuleId: candidate.jobRuleId || jobRuleId || null,
            promptVersion,
            modelName: result.modelName,
            requestPayload: {
              source: 'candidate_iterative_filter',
              action: 'filter',
              version_id: versionId,
              base_version: baseVersion || null,
              job_rule_id: jobRuleId || null,
              instruction,
              history,
              candidate_snapshot: candidateSnapshots.find((item) => item.candidate_id === candidate.id) ?? null,
              previous_screening_id: activeScreening?.id ?? null,
              filter_summary: result.result.filter_summary,
            } as any,
            responsePayload: responsePayload as any,
            score: typeof patch.score === 'number' ? patch.score : null,
            decision: patch.decision ? this.mapDecision(patch.decision) : null,
            matchedPoints: (patch.matched_points ?? []) as any,
            risks: (patch.risks ?? []) as any,
            summary: patch.summary ?? null,
            nextStep: typeof patch.next_step === 'boolean' ? patch.next_step : null,
            durationMs: result.durationMs,
            status: 'COMPLETED',
            errorMessage: null,
          },
        });
      }),
    );

    const counts = created.reduce(
      (acc, item) => {
        const decision = item.decision?.toLowerCase();
        if (decision === 'recommend') acc.recommend_count += 1;
        if (decision === 'hold') acc.hold_count += 1;
        if (decision === 'reject') acc.reject_count += 1;
        return acc;
      },
      { recommend_count: 0, hold_count: 0, reject_count: 0 },
    );

    return {
      action: 'filter' as const,
      version_id: versionId,
      prompt_version: promptVersion,
      answer: result.result.answer,
      filter_summary: result.result.filter_summary,
      criteria: result.result.criteria,
      total_count: created.length,
      ...counts,
      model_name: result.modelName,
      duration_ms: result.durationMs,
    };
  }

  private clampNumber(value: unknown, fallback: number, min: number, max: number) {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(numericValue)));
  }

  private parseAgeFromBirthOrAge(value?: string | null): number | null {
    if (!value) return null;
    const normalized = value.trim();
    const ageMatch = normalized.match(/^(\d{1,3})\s*岁?$/);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      if (age >= 1 && age <= 120) return age;
    }

    const yearMatch = normalized.match(/^(19|20)(\d{2})/);
    if (yearMatch) {
      const year = parseInt(normalized.slice(0, 4), 10);
      const age = new Date().getFullYear() - year;
      if (age >= 1 && age <= 120) return age;
    }

    return null;
  }

  async getCandidateDetail(candidateId: string, screeningVersion?: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        jobRule: true,
        screenings: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!candidate) throw new NotFoundException('Candidate not found.');

    const parsedProfile = this.buildDisplayProfile(candidate);
    const activeScreening = screeningVersion?.trim()
      ? this.pickScreeningForVersion(candidate.screenings, screeningVersion)
      : this.pickPreferredScreening(candidate.screenings);
    const interviewQa = await this.resolveCandidateInterviewQa(candidate, parsedProfile, activeScreening);

    return {
      id: candidate.id,
      unique_key: candidate.uniqueKey,
      job_rule_id: candidate.jobRuleId,
      job_rule_name: candidate.jobRule?.name ?? null,
      source_subject: this.isUploadedResumeSource(candidate)
        ? this.normalizeUploadedFileName(candidate.sourceSubject)
        : candidate.sourceSubject,
      source_sender_name: this.isUploadedResumeSource(candidate) ? '' : candidate.sourceSenderName,
      source_sender_email: candidate.sourceSenderEmail,
      received_at: candidate.receivedAt.toISOString(),
      raw_email_text: candidate.rawEmailText,
      parsed_candidate_profile: parsedProfile,
      interview_qa: interviewQa,
      active_screening: activeScreening ? this.toCandidateScreeningResponse(activeScreening) : null,
      screenings: candidate.screenings.map((s) => ({
        ...this.toCandidateScreeningResponse(s),
      })),
    };
  }

  async askCandidateAi(candidateId: string, payload: AskCandidateAiDto) {
    const question = payload.question?.trim();
    if (!question) {
      throw new BadRequestException('请输入要追问 AI 的问题。');
    }

    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        jobRule: true,
        screenings: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found.');
    if (!candidate.jobRule?.jdText?.trim()) {
      throw new BadRequestException('当前候选人没有关联岗位 JD，暂时无法进行追问。');
    }

    const profile = this.buildDisplayProfile(candidate);
    const activeScreening = this.pickPreferredScreening(candidate.screenings);
    const openAiCreds = await this.resolveOpenAiCredentials();
    if (!this.openAiScreeningService.isConfigured(openAiCreds?.apiKey, openAiCreds?.provider)) {
      throw new BadRequestException('未配置 AI 模型 Key，无法进行候选人追问。');
    }

    const screeningContext = activeScreening ? this.toCandidateScreeningResponse(activeScreening) : null;
    const history = (payload.history ?? [])
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && item.content?.trim())
      .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 4000) }))
      .slice(-8);

    const result = await this.openAiScreeningService.discussCandidate(
      profile,
      candidate.jobRule.jdText,
      screeningContext,
      question,
      history,
      openAiCreds?.apiKey ?? undefined,
      openAiCreds?.model ?? undefined,
      openAiCreds?.baseUrl ?? undefined,
      openAiCreds?.provider ?? undefined,
    );

    await this.updateOpenAiModelRuntime(openAiCreds?.id, {
      success: true,
      baseUrl: openAiCreds?.baseUrl,
      durationMs: result.durationMs,
      totalTokens: result.usage.totalTokens,
    });

    return {
      answer: result.result.answer,
      suggested_tags: result.result.suggested_tags,
      recommended_action: result.result.recommended_action,
      confidence: result.result.confidence,
      profile_patch: this.normalizeCandidateProfilePatch(result.result.profile_patch),
      screening_patch: this.normalizeCandidateScreeningPatch(result.result.screening_patch),
      update_reason: result.result.update_reason,
      model_name: result.modelName,
      duration_ms: result.durationMs,
    };
  }

  async applyCandidateAiUpdate(candidateId: string, payload: ApplyCandidateAiUpdateDto) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        jobRule: true,
        screenings: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!candidate) throw new NotFoundException('Candidate not found.');

    const profilePatch = this.normalizeCandidateProfilePatch(payload.profile_patch);
    const screeningPatch = this.normalizeCandidateScreeningPatch(payload.screening_patch);
    if (!Object.keys(profilePatch).length && !Object.keys(screeningPatch).length) {
      throw new BadRequestException('没有可应用到候选人详情的 AI 建议。');
    }

    const beforeProfile = this.buildDisplayProfile(candidate);
    const activeScreening = this.pickPreferredScreening(candidate.screenings);
    const beforeScreening = activeScreening ? this.toCandidateScreeningResponse(activeScreening) : null;
    const appliedAt = new Date().toISOString();

    if (Object.keys(profilePatch).length) {
      const storedProfile =
        candidate.parsedCandidateProfile &&
        typeof candidate.parsedCandidateProfile === 'object' &&
        !Array.isArray(candidate.parsedCandidateProfile)
          ? (candidate.parsedCandidateProfile as Record<string, unknown>)
          : {};
      const previousOverrides =
        storedProfile.ai_overrides && typeof storedProfile.ai_overrides === 'object' && !Array.isArray(storedProfile.ai_overrides)
          ? (storedProfile.ai_overrides as Record<string, unknown>)
          : {};
      const previousProfileAudits = Array.isArray(storedProfile.ai_applied_updates) ? storedProfile.ai_applied_updates : [];
      const nextProfile = {
        ...storedProfile,
        ...profilePatch,
        ai_overrides: {
          ...previousOverrides,
          ...profilePatch,
        },
        ai_applied_updates: [
          ...previousProfileAudits,
          {
            source: 'candidate_ai_chat',
            applied_at: appliedAt,
            reason: payload.reason?.trim() || '',
            source_answer: payload.source_answer?.trim().slice(0, 4000) || '',
            profile_patch: profilePatch,
            before: beforeProfile,
          },
        ].slice(-20),
      };

      await this.prisma.candidate.update({
        where: { id: candidateId },
        data: {
          ...this.buildCandidateProfilePatchUpdateInput(profilePatch),
          parsedCandidateProfile: nextProfile as any,
        },
      });
    }

    if (Object.keys(screeningPatch).length) {
      const auditEntry = {
        source: 'candidate_ai_chat',
        applied_at: appliedAt,
        reason: payload.reason?.trim() || '',
        source_answer: payload.source_answer?.trim().slice(0, 4000) || '',
        profile_patch: profilePatch,
        screening_patch: screeningPatch,
        before: {
          profile: beforeProfile,
          screening: beforeScreening,
        },
      };

      if (activeScreening) {
        const responsePayload = this.mergeAiPatchIntoScreeningPayload(activeScreening.responsePayload, screeningPatch, auditEntry);
        await this.prisma.candidateScreening.update({
          where: { id: activeScreening.id },
          data: {
            ...this.buildCandidateScreeningPatchUpdateInput(screeningPatch),
            responsePayload: responsePayload as any,
            status: 'COMPLETED',
            errorMessage: null,
          },
        });
      } else if (candidate.jobRuleId) {
        await this.prisma.candidateScreening.create({
          data: {
            candidateId,
            jobRuleId: candidate.jobRuleId,
            promptVersion: PROMPT_VERSION,
            modelName: 'candidate-ai-chat',
            requestPayload: { source: 'candidate_ai_chat_apply', candidate_profile: beforeProfile } as any,
            responsePayload: this.mergeAiPatchIntoScreeningPayload({}, screeningPatch, auditEntry) as any,
            score: typeof screeningPatch.score === 'number' ? screeningPatch.score : null,
            decision: screeningPatch.decision ? this.mapDecision(screeningPatch.decision) : null,
            matchedPoints: (screeningPatch.matched_points ?? []) as any,
            risks: (screeningPatch.risks ?? []) as any,
            summary: screeningPatch.summary ?? null,
            nextStep: typeof screeningPatch.next_step === 'boolean' ? screeningPatch.next_step : null,
            status: 'COMPLETED',
            errorMessage: null,
          },
        });
      }
    }

    return this.getCandidateDetail(candidateId);
  }

  async clearCandidates() {
    const hasActiveBackgroundWork =
      this.scheduleRunning ||
      this.screeningActiveCount > 0 ||
      this.fileScreeningActiveCount > 0 ||
      this.screeningQueue.length > 0 ||
      this.fileScreeningQueue.length > 0;

    if (hasActiveBackgroundWork) {
      throw new ConflictException('当前仍有后台筛选任务在执行，请等待完成后再清空候选人数据。');
    }

    const [deletedScreenings, deletedLogs, deletedCandidates] = await this.prisma.$transaction([
      this.prisma.candidateScreening.deleteMany(),
      this.prisma.emailIngestionLog.deleteMany(),
      this.prisma.candidate.deleteMany(),
    ]);

    this.aiFailureCache.clear();

    return {
      deleted_candidates: deletedCandidates.count,
      deleted_screenings: deletedScreenings.count,
      deleted_logs: deletedLogs.count,
    };
  }

  private toCandidateScreeningResponse(s: {
    id: string;
    responsePayload: Prisma.JsonValue | null;
    score: number | null;
    decision: string | null;
    matchedPoints: Prisma.JsonValue;
    risks: Prisma.JsonValue;
    summary: string | null;
    nextStep: boolean | null;
    status: string;
    errorMessage: string | null;
    modelName: string;
    promptVersion: string;
    createdAt: Date;
    durationMs: number | null;
    requestPayload: Prisma.JsonValue | null;
  }) {
    const structured =
      s.responsePayload && typeof s.responsePayload === 'object' && !Array.isArray(s.responsePayload)
        ? ((s.responsePayload as Record<string, unknown>).structured_output as Record<string, unknown> | undefined)
        : undefined;

    return {
      id: s.id,
      ai_job: typeof structured?.ai_job === 'string' ? structured.ai_job : null,
      score: s.score,
      decision: s.decision?.toLowerCase() ?? null,
      tags: this.normalizeStringArray(structured?.tags),
      dimensions: this.normalizeScreeningDimensions(structured?.dimensions),
      matched_points: Array.isArray(s.matchedPoints) ? s.matchedPoints : [],
      risks: Array.isArray(s.risks) ? s.risks : [],
      summary: s.summary,
      next_step: s.nextStep,
      status: s.status.toLowerCase(),
      error_message: s.errorMessage,
      model_name: s.modelName,
      prompt_version: s.promptVersion,
      created_at: s.createdAt.toISOString(),
      duration_ms: s.durationMs,
      request_payload: s.requestPayload ?? null,
      response_payload: s.responsePayload ?? null,
    };
  }

  private normalizeStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [] as string[];
    }
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 12);
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private toTrimmedString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private createIterativeFilterVersionId() {
    return `filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private buildIterativeFilterPromptVersion(versionId: string) {
    return `${ITERATIVE_FILTER_PROMPT_PREFIX}${versionId.trim()}`;
  }

  private extractIterativeFilterVersionId(promptVersion?: string | null) {
    const normalized = promptVersion?.trim() ?? '';
    return normalized.startsWith(ITERATIVE_FILTER_PROMPT_PREFIX)
      ? normalized.slice(ITERATIVE_FILTER_PROMPT_PREFIX.length)
      : '';
  }

  private normalizeCandidateProfilePatch(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {} as Partial<CandidateProfile>;
    }

    const source = value as Record<string, unknown>;
    const stringFields: Array<keyof CandidateProfile> = [
      'name',
      'gender',
      'birth_or_age',
      'education',
      'status',
      'city',
      'hukou',
      'target_job',
      'target_city',
      'salary_expectation',
      'recent_company',
      'recent_title',
      'years_experience',
      'work_summary',
      'email',
      'phone',
    ];
    const patch: Partial<CandidateProfile> = {};
    for (const field of stringFields) {
      const raw = source[field];
      if (typeof raw !== 'string') continue;
      const normalized = raw.trim().slice(0, field === 'work_summary' ? 2000 : 240);
      if (normalized) {
        patch[field] = normalized as never;
      }
    }

    if (Array.isArray(source.language_skills)) {
      const languageSkills = source.language_skills
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 12);
      if (languageSkills.length) {
        patch.language_skills = languageSkills;
      }
    }

    return patch;
  }

  private normalizeCandidateScreeningPatch(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {} as Partial<ScreeningResult>;
    }

    const source = value as Record<string, unknown>;
    const patch: Partial<ScreeningResult> = {};
    const score = Number(source.score);
    if (Number.isFinite(score)) {
      patch.score = Math.max(0, Math.min(100, Math.round(score)));
    }
    const normalizedDecision = typeof source.decision === 'string' ? source.decision.trim().toLowerCase() : '';
    if (normalizedDecision === 'recommend' || normalizedDecision === 'hold' || normalizedDecision === 'reject') {
      patch.decision = normalizedDecision;
    }
    if (typeof source.ai_job === 'string' && source.ai_job.trim()) {
      patch.ai_job = source.ai_job.trim().slice(0, 240);
    }
    if (typeof source.summary === 'string' && source.summary.trim()) {
      patch.summary = source.summary.trim().slice(0, 4000);
    }
    if (typeof source.next_step === 'boolean') {
      patch.next_step = source.next_step;
    }

    const tags = this.normalizeStringArray(source.tags);
    if (tags.length) patch.tags = tags;
    const matchedPoints = this.normalizeStringArray(source.matched_points).slice(0, 20);
    if (matchedPoints.length) patch.matched_points = matchedPoints;
    const risks = this.normalizeStringArray(source.risks).slice(0, 20);
    if (risks.length) patch.risks = risks;
    const dimensions = this.normalizeScreeningDimensions(source.dimensions);
    if (Object.keys(dimensions).length) patch.dimensions = dimensions;

    return patch;
  }

  private buildIterativeFilterPatch(
    value: Record<string, unknown>,
    previous:
      | {
          ai_job?: string | null;
          score?: number | null;
          decision?: string | null;
          tags?: string[];
          dimensions?: Record<string, { score: number; label: string; reason: string }>;
          matched_points?: string[];
          risks?: string[];
          summary?: string | null;
          next_step?: boolean | null;
        }
      | null,
  ) {
    const patch = this.normalizeCandidateScreeningPatch(value);
    if (!patch.ai_job && previous?.ai_job) patch.ai_job = previous.ai_job;
    if (typeof patch.score !== 'number') patch.score = typeof previous?.score === 'number' ? previous.score : 0;
    if (!patch.decision) {
      patch.decision =
        previous?.decision === 'recommend' || previous?.decision === 'hold' || previous?.decision === 'reject'
          ? previous.decision
          : 'hold';
    }
    if (!patch.tags?.length && previous?.tags?.length) patch.tags = previous.tags.slice(0, 12);
    if (!patch.matched_points?.length && previous?.matched_points?.length) {
      patch.matched_points = previous.matched_points.slice(0, 20);
    }
    if (!patch.risks?.length && previous?.risks?.length) patch.risks = previous.risks.slice(0, 20);
    if (!patch.dimensions && previous?.dimensions && Object.keys(previous.dimensions).length) {
      patch.dimensions = previous.dimensions;
    }
    if (!patch.summary) {
      patch.summary =
        previous?.summary?.trim() ||
        this.toTrimmedString(value.change_reason) ||
        '本轮 AI 未返回该候选人的详细说明，已沿用上一轮筛选结果。';
    }
    if (typeof patch.next_step !== 'boolean') {
      patch.next_step = patch.decision === 'recommend';
    }
    return patch;
  }

  private buildCandidateProfilePatchUpdateInput(patch: Partial<CandidateProfile>) {
    const data: Prisma.CandidateUpdateInput = {};
    if (typeof patch.name === 'string') data.name = patch.name;
    if (typeof patch.email === 'string') data.email = patch.email;
    if (typeof patch.phone === 'string') data.phone = patch.phone;
    if (typeof patch.city === 'string') data.city = patch.city;
    if (typeof patch.education === 'string') data.education = patch.education;
    if (typeof patch.status === 'string') data.status = patch.status;
    if (typeof patch.target_job === 'string') data.targetJob = patch.target_job;
    if (typeof patch.target_city === 'string') data.targetCity = patch.target_city;
    if (typeof patch.salary_expectation === 'string') data.salaryExpectation = patch.salary_expectation;
    if (typeof patch.recent_company === 'string') data.recentCompany = patch.recent_company;
    if (typeof patch.recent_title === 'string') data.recentTitle = patch.recent_title;
    if (typeof patch.years_experience === 'string') data.yearsExperience = patch.years_experience;
    return data;
  }

  private buildCandidateScreeningPatchUpdateInput(patch: Partial<ScreeningResult>) {
    const data: Prisma.CandidateScreeningUpdateInput = {};
    if (typeof patch.score === 'number') data.score = patch.score;
    if (patch.decision) data.decision = this.mapDecision(patch.decision);
    if (Array.isArray(patch.matched_points)) data.matchedPoints = patch.matched_points as any;
    if (Array.isArray(patch.risks)) data.risks = patch.risks as any;
    if (typeof patch.summary === 'string') data.summary = patch.summary;
    if (typeof patch.next_step === 'boolean') data.nextStep = patch.next_step;
    return data;
  }

  private mergeAiPatchIntoScreeningPayload(
    payload: Prisma.JsonValue | Record<string, unknown> | null,
    patch: Partial<ScreeningResult>,
    auditEntry: Record<string, unknown>,
  ) {
    const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...(payload as Record<string, unknown>) } : {};
    const structured =
      base.structured_output && typeof base.structured_output === 'object' && !Array.isArray(base.structured_output)
        ? { ...(base.structured_output as Record<string, unknown>) }
        : {};
    const previousAudits = Array.isArray(base.ai_applied_updates) ? base.ai_applied_updates : [];

    base.structured_output = {
      ...structured,
      ...patch,
    };
    base.ai_applied_updates = [...previousAudits, auditEntry].slice(-20);
    return base;
  }

  private normalizeScreeningDimensions(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {} as Record<string, { score: number; label: string; reason: string }>;
    }

    const result: Record<string, { score: number; label: string; reason: string }> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        continue;
      }
      const source = raw as Record<string, unknown>;
      const score = Number(source.score);
      result[key] = {
        score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        label: typeof source.label === 'string' ? source.label.trim() : '',
        reason: typeof source.reason === 'string' ? source.reason.trim() : '',
      };
    }
    return result;
  }

  private async resolveCandidateInterviewQa(
    candidate: {
      id: string;
      jobRule: { jdText: string } | null;
      jobRuleId: string | null;
    },
    profile: CandidateProfile,
    activeScreening:
      | {
          id: string;
          responsePayload: Prisma.JsonValue | null;
        }
      | null,
  ) {
    const cached = this.extractInterviewQaFromPayload(activeScreening?.responsePayload);
    if (cached.length) {
      return cached;
    }

    if (!candidate.jobRule?.jdText?.trim()) {
      return [] as InterviewQaItem[];
    }

    try {
      const openAiCreds = await this.resolveOpenAiCredentials();
      if (!this.openAiScreeningService.isConfigured(openAiCreds?.apiKey, openAiCreds?.provider)) {
        return [] as InterviewQaItem[];
      }

      const generated = await this.openAiScreeningService.generateInterviewQa(
        profile,
        candidate.jobRule.jdText,
        openAiCreds?.apiKey ?? undefined,
        openAiCreds?.model ?? undefined,
        openAiCreds?.baseUrl ?? undefined,
        openAiCreds?.provider ?? undefined,
      );
      const normalized = this.normalizeInterviewQaItems(generated.result.interview_qa);
      if (!normalized.length) {
        return [] as InterviewQaItem[];
      }

      if (activeScreening?.id) {
        await this.prisma.candidateScreening.update({
          where: { id: activeScreening.id },
          data: {
            responsePayload: this.mergeInterviewQaIntoResponsePayload(activeScreening.responsePayload, normalized) as any,
          },
        });
      }

      return normalized;
    } catch {
      return [] as InterviewQaItem[];
    }
  }

  // Scheduled sync

  private pickBetterString(...values: Array<string | null | undefined>) {
    for (const value of values) {
      const normalized = typeof value === 'string' ? value.trim() : '';
      if (normalized) {
        return normalized;
      }
    }
    return '';
  }

  private isUploadedResumeSource(source: {
    uniqueKey?: string | null;
    sourceSenderName?: string | null;
    sourceSenderEmail?: string | null;
  }) {
    return (source.uniqueKey ?? '').startsWith('upload:') || ((source.sourceSenderName ?? '').trim() === '鏂囦欢涓婁紶' && !(source.sourceSenderEmail ?? '').trim());
  }

  private sanitizeUploadedCandidateName(value?: string | null) {
    const normalized = value?.trim() ?? '';
    return normalized === '鏂囦欢涓婁紶' ? '' : normalized;
  }

  private buildDisplayProfile(candidate: {
    uniqueKey: string;
    name: string;
    email: string;
    phone: string;
    city: string;
    education: string;
    status: string;
    targetJob: string;
    targetCity: string;
    salaryExpectation: string;
    recentCompany: string;
    recentTitle: string;
    yearsExperience: string;
    rawEmailText: string;
    sourceSubject: string;
    sourceSenderName: string;
    sourceSenderEmail: string;
    parsedCandidateProfile: Prisma.JsonValue;
  }): CandidateProfile {
    const isUploadedSource = this.isUploadedResumeSource(candidate);
    const normalizedSourceSubject = isUploadedSource ? this.normalizeUploadedFileName(candidate.sourceSubject) : candidate.sourceSubject;
    const storedProfile =
      candidate.parsedCandidateProfile && typeof candidate.parsedCandidateProfile === 'object' && !Array.isArray(candidate.parsedCandidateProfile)
        ? (candidate.parsedCandidateProfile as unknown as CandidateProfile)
        : ({} as CandidateProfile);
    const aiOverrides = this.normalizeCandidateProfilePatch((storedProfile as unknown as Record<string, unknown>).ai_overrides);

    const reparsedProfile = this.resumeParserService.extractCandidateProfile(candidate.rawEmailText, {
      senderEmail: candidate.sourceSenderEmail,
      senderName: isUploadedSource ? '' : candidate.sourceSenderName,
      subject: normalizedSourceSubject,
    });

    return {
      ...storedProfile,
      ...reparsedProfile,
      name: this.pickBetterString(
        reparsedProfile.name,
        this.sanitizeUploadedCandidateName(storedProfile.name),
        this.sanitizeUploadedCandidateName(candidate.name),
      ),
      gender: this.pickBetterString(reparsedProfile.gender, storedProfile.gender),
      birth_or_age: this.pickBetterString(reparsedProfile.birth_or_age, storedProfile.birth_or_age),
      education: this.pickBetterString(reparsedProfile.education, storedProfile.education, candidate.education),
      status: this.pickBetterString(reparsedProfile.status, storedProfile.status, candidate.status),
      city: this.pickBetterString(reparsedProfile.city, storedProfile.city, candidate.city),
      hukou: this.pickBetterString(reparsedProfile.hukou, storedProfile.hukou),
      target_job: this.pickBetterString(reparsedProfile.target_job, storedProfile.target_job, candidate.targetJob),
      target_city: this.pickBetterString(reparsedProfile.target_city, storedProfile.target_city, candidate.targetCity),
      salary_expectation: this.pickBetterString(
        reparsedProfile.salary_expectation,
        storedProfile.salary_expectation,
        candidate.salaryExpectation,
      ),
      recent_company: this.pickBetterString(reparsedProfile.recent_company, storedProfile.recent_company, candidate.recentCompany),
      recent_title: this.pickBetterString(reparsedProfile.recent_title, storedProfile.recent_title, candidate.recentTitle),
      years_experience: this.pickBetterString(
        reparsedProfile.years_experience,
        storedProfile.years_experience,
        candidate.yearsExperience,
      ),
      work_summary: this.pickBetterString(reparsedProfile.work_summary, storedProfile.work_summary),
      email: this.pickBetterString(reparsedProfile.email, storedProfile.email, candidate.email, candidate.sourceSenderEmail),
      phone: this.pickBetterString(reparsedProfile.phone, storedProfile.phone, candidate.phone),
      raw_text: this.pickBetterString(reparsedProfile.raw_text, storedProfile.raw_text, candidate.rawEmailText),
      avatar_url: this.pickBetterString(reparsedProfile.avatar_url, storedProfile.avatar_url),
      ...aiOverrides,
      language_skills:
        aiOverrides.language_skills?.length
          ? aiOverrides.language_skills
          : reparsedProfile.language_skills?.length
            ? reparsedProfile.language_skills
            : storedProfile.language_skills ?? [],
    };
  }

  private pickPreferredScreening<T extends { status: string; score: number | null; decision: string | null; summary: string | null }>(
    screenings: T[],
  ) {
    return (
      screenings.find(
        (screening) =>
          screening.status === 'COMPLETED' &&
          (screening.score !== null || Boolean(screening.decision) || Boolean(screening.summary?.trim())),
      ) ??
      screenings[0] ??
      null
    );
  }

  private pickScreeningForVersion<
    T extends {
      promptVersion: string;
      status: string;
      score: number | null;
      decision: string | null;
      summary: string | null;
    },
  >(screenings: T[], versionId?: string | null) {
    const normalizedVersionId = versionId?.trim();
    if (!normalizedVersionId) {
      return this.pickPreferredScreening(screenings);
    }

    const promptVersion = this.buildIterativeFilterPromptVersion(normalizedVersionId);
    return (
      screenings.find(
        (screening) =>
          screening.promptVersion === promptVersion &&
          screening.status === 'COMPLETED' &&
          (screening.score !== null || Boolean(screening.decision) || Boolean(screening.summary?.trim())),
      ) ??
      screenings.find((screening) => screening.promptVersion === promptVersion) ??
      null
    );
  }

  @Interval(30_000)
  private handleScheduledSyncTick() {
    void this.checkAndRunScheduledSync({ allowCatchUp: true });
  }

  private async checkAndRunScheduledSync(options?: { allowCatchUp?: boolean }) {
    if (this.scheduleRunning) return;

    const config = await this.prisma.integrationConfig.findFirst({
      where: { kind: 'sync_schedule', name: SCHEDULE_CONFIG_NAME, isActive: true },
    });
    if (!config) return;

    const meta = this.parseScheduleMetadata(config.metadata);
    if (!meta.runAt) return;

    const now = this.getShanghaiDateParts(new Date());
    if (!this.isScheduledSyncDue(meta, now, Boolean(options?.allowCatchUp))) return;

    this.scheduleRunning = true;
    try {
      const result = await this.runMailSync({
        job_rule_id: config.accountIdentifier ?? undefined,
        mail_config_id: meta.mailConfigId ?? undefined,
        openai_config_id: meta.openAiConfigId ?? undefined,
        since_hours: meta.sinceHours,
        limit: meta.limit,
      });

      await this.prisma.integrationConfig.update({
        where: { id: config.id },
        data: {
          metadata: { ...meta, lastTriggeredOn: now.date, lastRunAt: new Date().toISOString(), lastRunResult: result.message },
        },
      });
    } catch (error) {
      await this.prisma.integrationConfig.update({
        where: { id: config.id },
        data: {
          metadata: {
            ...meta,
            lastTriggeredOn: now.date,
            lastRunAt: new Date().toISOString(),
            lastRunResult: error instanceof Error ? error.message : '定时同步执行失败。',
          },
        },
      });
    } finally {
      this.scheduleRunning = false;
    }
  }

  // Private helpers

  private async resolveMailCredentials(configId?: string | null) {
    const config = configId
      ? await this.prisma.integrationConfig.findFirst({
          where: { id: configId, kind: 'mail' },
        })
      : await this.prisma.integrationConfig.findFirst({
          where: { kind: 'mail', isActive: true },
          orderBy: { updatedAt: 'desc' },
        });
    if (configId && !config) {
      throw new NotFoundException('所选企业邮箱配置不存在。');
    }
    if (!config) return null;

    const pass = this.decryptStoredIntegrationSecret(
      config.encryptedSecret,
      '当前企业邮箱配置已失效，请重新保存邮箱密码后再试。',
    );
    const meta = config.metadata as Record<string, unknown>;

    return {
      host: (meta.host as string) || (process.env.MAIL_IMAP_HOST ?? ''),
      port: Number(meta.port ?? process.env.MAIL_IMAP_PORT ?? 993),
      user: config.accountIdentifier ?? '',
      pass,
      mailbox: (meta.mailbox as string) || (process.env.MAIL_FOLDER ?? 'INBOX'),
      keywords: ((meta.keywords as string) || process.env.MAIL_SOURCE_KEYWORDS || 'zhaopin,zhaopinmail.com,智联招聘')
        .split(',')
        .map((s: string) => s.trim().toLowerCase())
        .filter(Boolean),
    };
  }

  private async resolveOpenAiCredentials(configId?: string | null) {
    const config = configId
      ? await this.prisma.integrationConfig.findFirst({
          where: { id: configId, kind: 'openai' },
        })
      : await this.resolveDefaultTextOpenAiConfig();
    if (configId && !config) {
      throw new NotFoundException('所选 AI 模型配置不存在。');
    }
    if (!config) return null;

    const metadata =
      config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
        ? (config.metadata as Record<string, unknown>)
        : {};

    const configuredModel = config.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

    return {
      id: config.id,
      name: config.name,
      provider: config.provider ?? 'openai',
      apiKey: this.decryptStoredIntegrationSecret(
        config.encryptedSecret,
        '当前 AI 模型配置已失效，请重新保存 API Key 后再试。',
      ),
      model: this.resolveTextCompletionModelName(configuredModel),
      baseUrl:
        typeof metadata.base_url === 'string' && metadata.base_url.trim()
          ? metadata.base_url.trim()
          : process.env.OPENAI_BASE_URL ?? null,
    };
  }

  private async resolveDefaultTextOpenAiConfig() {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    return configs.find((config) => !this.isImageGenerationModel(config.model)) ?? configs[0] ?? null;
  }

  private resolveTextCompletionModelName(model?: string | null) {
    const normalizedModel = model?.trim();
    if (!normalizedModel || this.isImageGenerationModel(normalizedModel)) {
      const envModel = process.env.OPENAI_MODEL?.trim();
      return envModel && !this.isImageGenerationModel(envModel) ? envModel : 'gpt-4.1-mini';
    }
    return normalizedModel;
  }

  private isImageGenerationModel(model?: string | null) {
    const normalizedModel = model?.trim().toLowerCase() ?? '';
    return (
      normalizedModel.startsWith('gpt-image') ||
      normalizedModel.startsWith('chatgpt-image') ||
      normalizedModel.startsWith('dall-e') ||
      normalizedModel.includes('image-to-image') ||
      normalizedModel.includes('image2image')
    );
  }

  private async resolveFileExtractCredentials(screeningConfig?: OpenAiRuntimeConfig | null) {
    const docConfig = await this.prisma.integrationConfig.findFirst({
      where: {
        kind: 'openai',
        isActive: true,
        model: { equals: 'qwen-doc-turbo', mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (docConfig) {
      return this.toOpenAiRuntimeConfig(
        docConfig,
        '当前 qwen-doc-turbo 文件读取模型配置已失效，请在 AI 模型管理中重新保存 API Key 后再试。',
      );
    }

    if (
      screeningConfig &&
      this.supportsDirectAiFileScreening(
        screeningConfig.provider,
        screeningConfig.baseUrl,
        screeningConfig.model,
      )
    ) {
      return screeningConfig;
    }

    return null;
  }

  private toOpenAiRuntimeConfig(config: {
    id: string;
    name: string;
    provider: string | null;
    encryptedSecret: string;
    model: string | null;
    metadata: Prisma.JsonValue;
  }, failureMessage: string): OpenAiRuntimeConfig {
    const metadata =
      config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
        ? (config.metadata as Record<string, unknown>)
        : {};

    return {
      id: config.id,
      name: config.name,
      provider: config.provider ?? 'openai',
      apiKey: this.decryptStoredIntegrationSecret(config.encryptedSecret, failureMessage),
      model: config.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
      baseUrl:
        typeof metadata.base_url === 'string' && metadata.base_url.trim()
          ? metadata.base_url.trim()
          : process.env.OPENAI_BASE_URL ?? null,
    };
  }

  private supportsDirectAiFileScreening(
    provider?: string | null,
    baseUrl?: string | null,
    model?: string | null,
  ) {
    const normalizedProvider = provider?.trim().toLowerCase() ?? '';
    const normalizedBaseUrl = baseUrl?.trim().toLowerCase() ?? '';
    const normalizedModel = model?.trim().toLowerCase() ?? '';

    return (
      normalizedProvider.includes('qwen') ||
      normalizedProvider.includes('dashscope') ||
      normalizedProvider.includes('tongyi') ||
      normalizedBaseUrl.includes('dashscope.aliyuncs.com') ||
      normalizedModel.includes('qwen')
    );
  }

  private parseScheduleMetadata(raw?: unknown): ScheduleMetadata {
    const source = (raw ?? {}) as Record<string, unknown>;
    return {
      runAt: typeof source.runAt === 'string' ? source.runAt : '09:00',
      sinceHours: Number.isFinite(Number(source.sinceHours)) ? Math.max(1, Number(source.sinceHours)) : 72,
      limit: Number.isFinite(Number(source.limit)) ? Math.max(1, Number(source.limit)) : 20,
      mailConfigId: typeof source.mailConfigId === 'string' ? source.mailConfigId : null,
      openAiConfigId: typeof source.openAiConfigId === 'string' ? source.openAiConfigId : null,
      lastTriggeredOn: typeof source.lastTriggeredOn === 'string' ? source.lastTriggeredOn : '',
      lastRunAt: typeof source.lastRunAt === 'string' ? source.lastRunAt : null,
      lastRunResult: typeof source.lastRunResult === 'string' ? source.lastRunResult : '',
    };
  }

  private buildUploadedResumeUniqueKey(fileName: string, buffer: Buffer) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    const normalizedName = fileName.trim().toLowerCase();
    return `upload:${hash}:${normalizedName}`;
  }

  private normalizeUploadedFileName(fileName?: string | null) {
    const trimmed = fileName?.trim() ?? '';
    if (!trimmed) {
      return '未命名简历';
    }
    if (/[\u4e00-\u9fff]/u.test(trimmed) || !/[\u00C0-\u00FF\uFFFD]/u.test(trimmed)) {
      return trimmed;
    }

    try {
      const decoded = Buffer.from(trimmed, 'latin1').toString('utf8').trim();
      if (!decoded || decoded.includes('\u0000')) {
        return trimmed;
      }
      return decoded;
    } catch {
      return trimmed;
    }
  }

  private findMatchingJobRuleForUpload(
    profile: CandidateProfile,
    fileName: string,
    jobRules: Array<{ id: string; name: string; jdText: string; enabled: boolean }>,
    preferredJobRuleId?: string | null,
  ) {
    if (!jobRules.length) {
      return null;
    }

    const searchableText = [
      profile.target_job,
      profile.target_city,
      profile.recent_title,
      profile.recent_company,
      profile.work_summary,
      profile.raw_text.slice(0, 1600),
      fileName,
    ]
      .filter(Boolean)
      .join('\n')
      .replace(/\s+/g, '')
      .toLowerCase();

    const scored = jobRules
      .map((jobRule) => ({
        jobRule,
        score: this.scoreUploadedResumeAgainstJobRule(jobRule.name, searchableText, preferredJobRuleId === jobRule.id),
      }))
      .sort((a, b) => b.score - a.score);

    return (scored[0]?.score ?? 0) >= 4 ? scored[0].jobRule : null;
  }

  private findMatchingJobRuleForMail(
    _profile: CandidateProfile,
    mail: { subject: string; senderName: string; senderEmail: string; contentText: string },
    jobRules: Array<{ id: string; name: string; jdText: string; enabled: boolean }>,
    preferredJobRuleId?: string | null,
  ) {
    if (!jobRules.length) {
      return null;
    }

    const normalizedSubject = mail.subject.replace(/\s+/g, '').toLowerCase();

    const exactMatches = jobRules
      .map((jobRule) => {
        const normalizedRuleName = this.normalizeJobRuleName(jobRule.name).replace(/\s+/g, '').toLowerCase();
        if (!normalizedRuleName || !normalizedSubject.includes(normalizedRuleName)) {
          return null;
        }
        return { jobRule, nameLength: normalizedRuleName.length };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.nameLength - a.nameLength || (b.jobRule.id === preferredJobRuleId ? 1 : 0) - (a.jobRule.id === preferredJobRuleId ? 1 : 0));

    return exactMatches[0]?.jobRule ?? null;
  }

  private scoreUploadedResumeAgainstJobRule(jobRuleName: string, searchableText: string, isPreferred: boolean) {
    const normalizedJobRuleName = this.normalizeJobRuleName(jobRuleName).replace(/\s+/g, '').toLowerCase();
    if (!normalizedJobRuleName) {
      return 0;
    }

    let score = isPreferred ? 0.5 : 0;
    if (searchableText.includes(normalizedJobRuleName)) {
      score += 12 + normalizedJobRuleName.length;
    }

    const keywords = this.extractJobRuleKeywords(normalizedJobRuleName);
    let keywordHits = 0;
    for (const keyword of keywords) {
      if (searchableText.includes(keyword)) {
        keywordHits += 1;
        score += keyword.length >= 4 ? 4 : 2;
      }
    }

    if (keywordHits >= 2) {
      score += 3;
    }

    return score;
  }

  private extractJobRuleKeywords(jobRuleName: string) {
    const collapsed = jobRuleName.replace(/[\s()（）]/g, '').toLowerCase();
    const keywords = new Set<string>();
    if (collapsed.length >= 2) {
      keywords.add(collapsed);
    }

    for (const segment of collapsed.split(/[\/、,，+-]+/).filter(Boolean)) {
      if (segment.length >= 2) {
        keywords.add(segment);
      }
    }

    const commonKeywords = ['采购', '助理', '专员', '机械', '结构', '工程师', '设计', '行政', '财务', '销售', '招商主管', '文员'];
    for (const keyword of commonKeywords) {
      if (collapsed.includes(keyword)) {
        keywords.add(keyword);
        const remainder = collapsed.replace(keyword, '');
        if (remainder.length >= 2) {
          keywords.add(remainder);
        }
      }
    }

    return Array.from(keywords).filter((keyword) => keyword.length >= 2);
  }

  private matchUploadedFileToJobRule(
    fileName: string,
    jobRules: Array<{ id: string; name: string; jdText: string }>,
    preferredJobRuleId?: string | null,
  ) {
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const normalizedFileName = this.normalizeUploadedFileMatchText(baseName);
    if (!normalizedFileName) {
      return null;
    }

    const exactMatches = jobRules
      .map((jobRule) => {
        const normalizedRuleName = this.normalizeUploadedFileMatchText(jobRule.name);
        if (!normalizedRuleName || !normalizedFileName.includes(normalizedRuleName)) {
          return null;
        }
        return { jobRule, nameLength: normalizedRuleName.length };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.nameLength - a.nameLength || (b.jobRule.id === preferredJobRuleId ? 1 : 0) - (a.jobRule.id === preferredJobRuleId ? 1 : 0));

    return exactMatches[0]?.jobRule ?? null;
  }

  private normalizeUploadedFileMatchText(value: string) {
    return value.replace(/[\s_.\-()\[\]{}|]/g, '').toLowerCase();
  }

  private getFileExtensionLabel(fileName: string) {
    const extension = fileName.trim().split('.').pop()?.toUpperCase() ?? '';
    return extension || 'FILE';
  }

  private normalizeScheduleRunAt(runAt?: string | null) {
    const value = runAt?.trim() ?? '';
    const minutes = this.parseScheduleTimeToMinutes(value);
    if (minutes === null) {
      throw new BadRequestException('执行时间格式不正确，请使用 00:00-23:59 的 HH:mm。');
    }

    const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mins = String(minutes % 60).padStart(2, '0');
    return `${hours}:${mins}`;
  }

  private parseScheduleTimeToMinutes(value?: string | null) {
    if (!value) return null;

    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
      return null;
    }

    return hours * 60 + minutes;
  }

  private isScheduledSyncDue(
    meta: ScheduleMetadata,
    current: { date: string; time: string },
    allowCatchUp: boolean,
  ) {
    if (meta.lastTriggeredOn === current.date) return false;

    const scheduledMinutes = this.parseScheduleTimeToMinutes(meta.runAt);
    const currentMinutes = this.parseScheduleTimeToMinutes(current.time);
    if (scheduledMinutes === null || currentMinutes === null) return false;

    if (currentMinutes === scheduledMinutes) return true;
    return allowCatchUp && currentMinutes > scheduledMinutes;
  }

  private extractInterviewQaFromPayload(payload: Prisma.JsonValue | null | undefined) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return [] as InterviewQaItem[];
    }

    const root = payload as Record<string, unknown>;
    const structured =
      root.structured_output && typeof root.structured_output === 'object' && !Array.isArray(root.structured_output)
        ? (root.structured_output as Record<string, unknown>)
        : null;

    const source = structured?.interview_qa ?? root.interview_qa;
    return this.normalizeInterviewQaItems(source);
  }

  private normalizeInterviewQaItems(value: unknown) {
    if (!Array.isArray(value)) {
      return [] as InterviewQaItem[];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }
        const source = item as Record<string, unknown>;
        const question = typeof source.question === 'string' ? source.question.trim() : '';
        const answer = typeof source.answer === 'string' ? source.answer.trim() : '';
        if (!question || !answer) {
          return null;
        }
        return {
          question,
          answer,
        } satisfies InterviewQaItem;
      })
      .filter((item): item is InterviewQaItem => Boolean(item))
      .slice(0, 5);
  }

  private mergeInterviewQaIntoResponsePayload(
    payload: Prisma.JsonValue | null | undefined,
    interviewQa: InterviewQaItem[],
  ) {
    const base =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...(payload as Record<string, unknown>) }
        : {};
    const structured =
      base.structured_output && typeof base.structured_output === 'object' && !Array.isArray(base.structured_output)
        ? { ...(base.structured_output as Record<string, unknown>) }
        : {};

    structured.interview_qa = interviewQa;
    base.interview_qa = interviewQa;
    base.structured_output = structured;
    return base;
  }

  private toScheduleResponse(config: { isActive: boolean; accountIdentifier: string | null; metadata: unknown } | null) {
    const meta = this.parseScheduleMetadata(config?.metadata);
    return {
      enabled: config?.isActive ?? false,
      run_at: meta.runAt,
      since_hours: meta.sinceHours,
      limit: meta.limit,
      job_rule_id: config?.accountIdentifier ?? null,
      mail_config_id: meta.mailConfigId,
      openai_config_id: meta.openAiConfigId,
      last_run_at: meta.lastRunAt,
      last_run_result: meta.lastRunResult,
    };
  }

  private toMailConfigResponse(c: { id: string; kind: string; name: string; accountIdentifier: string | null; isActive: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      email: c.accountIdentifier ?? '',
      enabled: c.isActive,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    };
  }

  private toOpenAiConfigResponse(c: { id: string; kind: string; provider: string | null; name: string; model: string | null; isActive: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: c.id,
      kind: c.kind,
      provider: c.provider ?? 'openai',
      name: c.name,
      model: c.model ?? '',
      enabled: c.isActive,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    };
  }

  private toJobRuleResponse(jobRule: {
    id: string;
    name: string;
    jdText: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: jobRule.id,
      name: jobRule.name,
      jd_text: jobRule.jdText,
      enabled: jobRule.enabled,
      created_at: jobRule.createdAt.toISOString(),
      updated_at: jobRule.updatedAt.toISOString(),
    };
  }

  private getSourceErrorMessage(error: unknown) {
    if (error instanceof Error) {
      const details = error as Error & {
        status?: number;
        code?: string;
        type?: string;
        request_id?: string;
      };

      const meta = [
        typeof details.status === 'number' ? `status=${details.status}` : '',
        typeof details.code === 'string' ? `code=${details.code}` : '',
        typeof details.type === 'string' ? `type=${details.type}` : '',
        typeof details.request_id === 'string' ? `request_id=${details.request_id}` : '',
      ]
        .filter(Boolean)
        .join(', ');

      return meta ? `${error.message} (${meta})` : error.message;
    }

    return '未知处理错误';
  }

  private isFatalOpenAiConnectivityError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    const text = `${error.name} ${error.message}`.toLowerCase();
    return [
      'request timed out',
      'timeout',
      'fetch failed',
      'network',
      'econnrefused',
      'econnreset',
      'enotfound',
      'socket hang up',
    ].some((keyword) => text.includes(keyword));
  }

  private decryptStoredIntegrationSecret(payload: string, failureMessage: string) {
    try {
      return this.secureConfigService.decryptFromStorage(payload);
    } catch {
      throw new BadRequestException(failureMessage);
    }
  }

  private resolveIncomingTransportSecret(payload: { encryptedSecret?: string; plainSecret?: string }) {
    const encryptedSecret = payload.encryptedSecret?.trim();
    if (encryptedSecret) {
      return this.secureConfigService.decryptTransportValue(encryptedSecret);
    }

    const plainSecret = payload.plainSecret?.trim();
    return plainSecret || '';
  }

  private resolveIncomingStoredSecret(
    payload: { encryptedSecret?: string; plainSecret?: string },
    fallback?: string,
  ) {
    const secret = this.resolveIncomingTransportSecret(payload);
    if (secret) {
      return this.secureConfigService.encryptForStorage(secret);
    }
    return fallback;
  }

  private async updateOpenAiModelRuntime(
    configId: string | null | undefined,
    payload: {
      success: boolean;
      baseUrl?: string | null;
      durationMs?: number | null;
      totalTokens?: number | null;
      errorMessage?: string | null;
    },
  ) {
    if (!configId) {
      return;
    }

    const config = await this.prisma.integrationConfig.findFirst({
      where: { id: configId, kind: 'openai' },
    });
    if (!config) {
      return;
    }

    const metadata =
      config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
        ? ({ ...(config.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    const today = this.getShanghaiDateParts(new Date()).date;
    const usageDate = typeof metadata.today_usage_date === 'string' ? metadata.today_usage_date : '';
    const currentRequests =
      usageDate === today && typeof metadata.today_requests === 'number' ? metadata.today_requests : 0;
    const currentTokens =
      usageDate === today && typeof metadata.today_tokens === 'number' ? metadata.today_tokens : 0;
    const addedTokens = Math.max(0, payload.totalTokens ?? 0);
    const nextTodayRequests = currentRequests + 1;
    const nextTodayTokens = currentTokens + addedTokens;
    const currentTotalTokens = typeof metadata.total_tokens === 'number' ? metadata.total_tokens : 0;
    const dailyTokenUsage = this.upsertOpenAiDailyTokenUsage(metadata.daily_token_usage, {
      date: today,
      requests: nextTodayRequests,
      tokens: nextTodayTokens,
    });

    await this.prisma.integrationConfig.update({
      where: { id: configId },
      data: {
        metadata: {
          ...metadata,
          ...(typeof payload.baseUrl === 'string' ? { base_url: payload.baseUrl } : {}),
          current_status: payload.success ? '运行正常' : '连接异常',
          last_success_at:
            payload.success
              ? new Date().toISOString()
              : typeof metadata.last_success_at === 'string'
                ? metadata.last_success_at
                : null,
          last_failure_at:
            payload.success
              ? typeof metadata.last_failure_at === 'string'
                ? metadata.last_failure_at
                : null
              : new Date().toISOString(),
          last_latency_ms:
            typeof payload.durationMs === 'number'
              ? payload.durationMs
              : typeof metadata.last_latency_ms === 'number'
                ? metadata.last_latency_ms
                : null,
          today_requests: nextTodayRequests,
          today_tokens: nextTodayTokens,
          total_tokens: currentTotalTokens + addedTokens,
          daily_token_usage: dailyTokenUsage,
          today_usage_date: today,
          last_error_message: payload.success ? null : payload.errorMessage ?? '未知错误',
        } as Prisma.InputJsonValue,
      },
    });
  }

  private enqueueScreeningTask(task: ScreeningTaskPayload) {
    this.screeningQueue.push(task);
    queueMicrotask(() => {
      void this.processScreeningQueue();
    });
  }

  private enqueueFileScreeningTask(task: FileScreeningTaskPayload) {
    this.fileScreeningQueue.push(task);
    queueMicrotask(() => {
      void this.processFileScreeningQueue();
    });
  }

  private async processScreeningQueue() {
    while (this.screeningActiveCount < this.screeningConcurrency && this.screeningQueue.length > 0) {
      const task = this.screeningQueue.shift();
      if (!task) {
        return;
      }

      this.screeningActiveCount += 1;
      void this.runScreeningTask(task).finally(() => {
        this.screeningActiveCount = Math.max(0, this.screeningActiveCount - 1);
        void this.processScreeningQueue();
      });
    }
  }

  private async processFileScreeningQueue() {
    while (this.fileScreeningActiveCount < this.screeningConcurrency && this.fileScreeningQueue.length > 0) {
      const task = this.fileScreeningQueue.shift();
      if (!task) {
        return;
      }

      this.fileScreeningActiveCount += 1;
      void this.runFileScreeningTaskV2(task).finally(() => {
        this.fileScreeningActiveCount = Math.max(0, this.fileScreeningActiveCount - 1);
        void this.processFileScreeningQueue();
      });
    }
  }

  private async runScreeningTask(task: ScreeningTaskPayload) {
    const cachedAiFailure = this.getCachedAiFailure(task.openAiConfig.id);
    if (cachedAiFailure) {
      await this.createScreeningRecord(task.candidateId, task.jobRuleId, task.profile, task.jdText, {
        status: 'FAILED',
        errorMessage: cachedAiFailure,
      });
      await this.createIngestionLog(task.mail, task.candidateId, 'failed', cachedAiFailure);
      return;
    }

    try {
      const evaluation = await this.openAiScreeningService.evaluateCandidate(
        task.profile,
        task.jdText,
        task.openAiConfig.apiKey ?? undefined,
        task.openAiConfig.model ?? undefined,
        task.openAiConfig.baseUrl ?? undefined,
        task.openAiConfig.provider ?? undefined,
      );
      await this.updateOpenAiModelRuntime(task.openAiConfig.id, {
        success: true,
        baseUrl: task.openAiConfig.baseUrl,
        durationMs: evaluation.durationMs,
        totalTokens: evaluation.usage.totalTokens,
      });
      await this.createScreeningRecord(task.candidateId, task.jobRuleId, task.profile, task.jdText, {
        status: 'COMPLETED',
        screening: evaluation.result,
        modelName: evaluation.modelName,
        requestPayload: evaluation.requestPayload,
        responsePayload: evaluation.responsePayload,
        durationMs: evaluation.durationMs,
      });
      await this.createIngestionLog(task.mail, task.candidateId, 'completed');
    } catch (error) {
      const sourceErrorMessage = this.getSourceErrorMessage(error);
      await this.updateOpenAiModelRuntime(task.openAiConfig.id, {
        success: false,
        baseUrl: task.openAiConfig.baseUrl,
        errorMessage: sourceErrorMessage,
      });
      if (this.isFatalOpenAiConnectivityError(error)) {
        this.setCachedAiFailure(task.openAiConfig.id, sourceErrorMessage);
      }
      await this.createScreeningRecord(task.candidateId, task.jobRuleId, task.profile, task.jdText, {
        status: 'FAILED',
        errorMessage: sourceErrorMessage,
      });
      await this.createIngestionLog(task.mail, task.candidateId, 'failed', sourceErrorMessage);
    }
  }

  private async runFileScreeningTaskV2(task: FileScreeningTaskPayload) {
    const cachedAiFailure = this.getCachedAiFailure(task.openAiConfig.id);
    if (cachedAiFailure) {
      await this.prisma.emailIngestionLog.updateMany({
        where: { uniqueKey: task.uniqueKey },
        data: { status: 'failed', errorMessage: cachedAiFailure },
      });
      return;
    }

    try {
      const fileExtractConfig = task.fileExtractConfig ?? null;
      let extractionResult:
        | Awaited<ReturnType<OpenAiScreeningService['extractCandidateProfileFromFile']>>
        | Awaited<ReturnType<OpenAiScreeningService['screenResumeFromText']>>;
      let usedDirectFileScreening = Boolean(fileExtractConfig?.apiKey && task.fileBuffer);

      if (usedDirectFileScreening && fileExtractConfig && task.fileBuffer) {
        try {
          extractionResult = await this.openAiScreeningService.extractCandidateProfileFromFile(
            {
              buffer: task.fileBuffer,
              originalname: task.fileName,
              mimeType: task.mimeType ?? undefined,
            },
            task.jdText,
            task.jobRuleName,
            fileExtractConfig.apiKey ?? undefined,
            fileExtractConfig.baseUrl ?? undefined,
            fileExtractConfig.provider ?? undefined,
            fileExtractConfig.model ?? undefined,
          );
        } catch (directFileError) {
          const fallbackExtraction = await this.resumeDocumentService.extractText({
            originalname: task.fileName,
            buffer: task.fileBuffer,
          });
          const fallbackText = fallbackExtraction.text.trim();
          if (!fallbackText) {
            throw directFileError;
          }

          task.rawText = fallbackText;
          task.uploadedSource.contentText = fallbackText;
          usedDirectFileScreening = false;
          extractionResult = await this.openAiScreeningService.screenResumeFromText(
            fallbackText,
            task.fileName,
            task.jdText,
            task.jobRuleName,
            task.openAiConfig.apiKey ?? undefined,
            task.openAiConfig.model ?? undefined,
            task.openAiConfig.baseUrl ?? undefined,
            task.openAiConfig.provider ?? undefined,
          );
        }
      } else {
        extractionResult = await this.openAiScreeningService.screenResumeFromText(
          task.rawText ?? '',
          task.fileName,
          task.jdText,
          task.jobRuleName,
          task.openAiConfig.apiKey ?? undefined,
          task.openAiConfig.model ?? undefined,
          task.openAiConfig.baseUrl ?? undefined,
          task.openAiConfig.provider ?? undefined,
        );
      }

      await this.updateOpenAiModelRuntime(task.openAiConfig.id, {
        success: true,
        baseUrl: task.openAiConfig.baseUrl,
        durationMs: extractionResult.durationMs,
        totalTokens: extractionResult.usage.totalTokens,
      });

      if (!extractionResult.is_relevant) {
        const skipReason = extractionResult.relevance_reason
          ? `AI 判断不符合岗位规则“${task.jobRuleName}”：${extractionResult.relevance_reason}`
          : `AI 判断不符合岗位规则“${task.jobRuleName}”，已跳过。`;
        await this.prisma.emailIngestionLog.updateMany({
          where: { uniqueKey: task.uniqueKey },
          data: { status: 'skipped', errorMessage: skipReason },
        });
        return;
      }

      const profile = extractionResult.candidate_profile;
      task.uploadedSource.contentText = profile.raw_text || task.uploadedSource.contentText;

      let evaluation:
        | Awaited<ReturnType<OpenAiScreeningService['evaluateCandidate']>>
        | {
            result: ScreeningResult;
            requestPayload: unknown;
            responsePayload: unknown;
            modelName: string;
            durationMs: number;
            usage: { totalTokens: number | null };
          };

      if (usedDirectFileScreening) {
        evaluation = await this.openAiScreeningService.evaluateCandidate(
          profile,
          task.jdText,
          task.openAiConfig.apiKey ?? undefined,
          task.openAiConfig.model ?? undefined,
          task.openAiConfig.baseUrl ?? undefined,
          task.openAiConfig.provider ?? undefined,
        );
      } else if ('screening_result' in extractionResult) {
        evaluation = {
          result: extractionResult.screening_result,
          requestPayload: extractionResult.requestPayload,
          responsePayload: extractionResult.responsePayload,
          modelName: extractionResult.modelName,
          durationMs: extractionResult.durationMs,
          usage: { totalTokens: extractionResult.usage.totalTokens },
        };
      } else {
        throw new Error('文件解析已完成，但未产出筛选结果。');
      }

      if (usedDirectFileScreening) {
        await this.updateOpenAiModelRuntime(task.openAiConfig.id, {
          success: true,
          baseUrl: task.openAiConfig.baseUrl,
          durationMs: extractionResult.durationMs + evaluation.durationMs,
          totalTokens: (extractionResult.usage.totalTokens ?? 0) + (evaluation.usage.totalTokens ?? 0),
        });
      }

      const candidate = await this.prisma.candidate.upsert({
        where: { uniqueKey: task.uniqueKey },
        create: this.buildCandidateCreateInput(task.uniqueKey, task.jobRuleId, profile, task.uploadedSource),
        update: this.buildCandidateUpdateInput(task.jobRuleId, profile, task.uploadedSource),
      });

      await this.createScreeningRecord(candidate.id, task.jobRuleId, profile, task.jdText, {
        status: 'COMPLETED',
        screening: evaluation.result,
        modelName: evaluation.modelName,
        requestPayload: usedDirectFileScreening
          ? {
              extraction_model: extractionResult.modelName,
              extraction_request: extractionResult.requestPayload,
              evaluation_model: evaluation.modelName,
              evaluation_request: evaluation.requestPayload,
            }
          : evaluation.requestPayload,
        responsePayload: usedDirectFileScreening
          ? {
              extraction_model: extractionResult.modelName,
              extraction_response: extractionResult.responsePayload,
              evaluation_model: evaluation.modelName,
              evaluation_response: evaluation.responsePayload,
            }
          : evaluation.responsePayload,
        durationMs: usedDirectFileScreening
          ? extractionResult.durationMs + evaluation.durationMs
          : evaluation.durationMs,
      });

      await this.prisma.emailIngestionLog.updateMany({
        where: { uniqueKey: task.uniqueKey },
        data: { status: 'completed', candidateId: candidate.id, errorMessage: null },
      });
    } catch (error) {
      const sourceErrorMessage = this.getSourceErrorMessage(error);
      await this.updateOpenAiModelRuntime(task.openAiConfig.id, {
        success: false,
        baseUrl: task.openAiConfig.baseUrl,
        errorMessage: sourceErrorMessage,
      });
      if (this.isFatalOpenAiConnectivityError(error)) {
        this.setCachedAiFailure(task.openAiConfig.id, sourceErrorMessage);
      }
      await this.prisma.emailIngestionLog.updateMany({
        where: { uniqueKey: task.uniqueKey },
        data: { status: 'failed', errorMessage: sourceErrorMessage },
      });
    }
  }

  private async runFileScreeningTask(task: FileScreeningTaskPayload) {
    const cachedAiFailure = this.getCachedAiFailure(task.openAiConfig.id);
    if (cachedAiFailure) {
      await this.prisma.emailIngestionLog.updateMany({
        where: { uniqueKey: task.uniqueKey },
        data: { status: 'failed', errorMessage: cachedAiFailure },
      });
      return;
    }

    try {
      const result = await this.openAiScreeningService.screenResumeFromText(
        task.rawText ?? '',
        task.fileName,
        task.jdText,
        task.jobRuleName,
        task.openAiConfig.apiKey ?? undefined,
        task.openAiConfig.model ?? undefined,
        task.openAiConfig.baseUrl ?? undefined,
        task.openAiConfig.provider ?? undefined,
      );

      await this.updateOpenAiModelRuntime(task.openAiConfig.id, {
        success: true,
        baseUrl: task.openAiConfig.baseUrl,
        durationMs: result.durationMs,
        totalTokens: result.usage.totalTokens,
      });

      if (!result.is_relevant) {
        const skipReason = result.relevance_reason
          ? `AI 判断不符合岗位规则“${task.jobRuleName}”：${result.relevance_reason}`
          : `AI 判断不符合岗位规则“${task.jobRuleName}”，已跳过。`;
        await this.prisma.emailIngestionLog.updateMany({
          where: { uniqueKey: task.uniqueKey },
          data: { status: 'skipped', errorMessage: skipReason },
        });
        return;
      }

      const profile = result.candidate_profile;
      const candidate = await this.prisma.candidate.upsert({
        where: { uniqueKey: task.uniqueKey },
        create: this.buildCandidateCreateInput(task.uniqueKey, task.jobRuleId, profile, task.uploadedSource),
        update: this.buildCandidateUpdateInput(task.jobRuleId, profile, task.uploadedSource),
      });

      await this.createScreeningRecord(candidate.id, task.jobRuleId, profile, task.jdText, {
        status: 'COMPLETED',
        screening: result.screening_result,
        modelName: result.modelName,
        requestPayload: result.requestPayload,
        responsePayload: result.responsePayload,
        durationMs: result.durationMs,
      });

      await this.prisma.emailIngestionLog.updateMany({
        where: { uniqueKey: task.uniqueKey },
        data: { status: 'completed', candidateId: candidate.id, errorMessage: null },
      });
    } catch (error) {
      const sourceErrorMessage = this.getSourceErrorMessage(error);
      await this.updateOpenAiModelRuntime(task.openAiConfig.id, {
        success: false,
        baseUrl: task.openAiConfig.baseUrl,
        errorMessage: sourceErrorMessage,
      });
      if (this.isFatalOpenAiConnectivityError(error)) {
        this.setCachedAiFailure(task.openAiConfig.id, sourceErrorMessage);
      }
      await this.prisma.emailIngestionLog.updateMany({
        where: { uniqueKey: task.uniqueKey },
        data: { status: 'failed', errorMessage: sourceErrorMessage },
      });
    }
  }

  private getCachedAiFailure(configId: string | null | undefined) {
    if (!configId) {
      return null;
    }

    const cached = this.aiFailureCache.get(configId);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.aiFailureCache.delete(configId);
      return null;
    }

    return cached.message;
  }

  private setCachedAiFailure(configId: string | null | undefined, message: string) {
    if (!configId) {
      return;
    }

    this.aiFailureCache.set(configId, {
      message,
      expiresAt: Date.now() + 2 * 60 * 1000,
    });
  }

  private async resolveJobRuleDraft(jdText: string, explicitName?: string | null) {
    const parsedByCode = this.parseJobRuleDraftByCode(jdText, explicitName);
    if (parsedByCode.confidence === 'high') {
      return {
        name: parsedByCode.name,
        jdText: parsedByCode.jdText,
      };
    }

    const openAiCreds = await this.resolveOpenAiCredentials();
    if (!this.openAiScreeningService.isConfigured(openAiCreds?.apiKey, openAiCreds?.provider)) {
      return {
        name: parsedByCode.name,
        jdText: parsedByCode.jdText,
      };
    }

    try {
      const extracted = await this.openAiScreeningService.extractJobRuleDraft(
        jdText,
        openAiCreds?.apiKey,
        openAiCreds?.model,
        openAiCreds?.baseUrl ?? undefined,
        openAiCreds?.provider,
      );
      const aiName = this.normalizeJobRuleName(extracted.result.name);
      const aiJdText = extracted.result.jd_text.replace(/\r\n/g, '\n').trim();

      if (aiName && aiJdText) {
        return {
          name: aiName,
          jdText: aiJdText,
        };
      }
    } catch {
      // Fall back to deterministic parsing when AI extraction is unavailable or fails.
    }

    return {
      name: parsedByCode.name,
      jdText: parsedByCode.jdText,
    };
  }

  private parseJobRuleDraftByCode(jdText: string, explicitName?: string | null) {
    const normalized = jdText.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      throw new BadRequestException('jd_text is required.');
    }

    const rawLines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const titlePattern = /^(?:岗位名称|职位名称|招聘岗位|应聘岗位|岗位|职位|job\s*title|title)\s*[:：]\s*(.+)$/i;
    const bodyStartPattern = /^(?:岗位职责|工作职责|职责描述|职位描述|岗位描述|职位要求|岗位要求|任职要求|job\s*description)\s*[:：]?\s*(.*)$/i;

    let name = explicitName?.trim() || '';
    let titleLineIndex = -1;
    let bodyStartIndex = -1;
    let bodyFirstLine = '';
    let confidence: 'high' | 'medium' | 'low' = explicitName?.trim() ? 'high' : 'low';

    for (let index = 0; index < Math.min(rawLines.length, 6); index += 1) {
      const line = rawLines[index];
      const titleMatch = line.match(titlePattern);
      if (titleMatch?.[1]?.trim()) {
        name = this.normalizeJobRuleName(titleMatch[1]);
        titleLineIndex = index;
        confidence = 'high';
        continue;
      }

      const bodyMatch = line.match(bodyStartPattern);
      if (bodyMatch) {
        bodyStartIndex = index;
        bodyFirstLine = bodyMatch[1]?.trim() ?? '';
        break;
      }
    }

    if (!name && rawLines.length > 0) {
      const firstLine = rawLines[0];
      const shortHeadingCandidate =
        firstLine.length <= 40 &&
        !/[，。；;?？]/.test(firstLine) &&
        !/^(岗位职责|工作职责|职位描述|岗位描述|职位要求|岗位要求|任职要求)$/i.test(firstLine);

      if (shortHeadingCandidate) {
        name = this.normalizeJobRuleName(firstLine);
        titleLineIndex = 0;
        confidence = bodyStartIndex >= 0 ? 'high' : 'medium';
      }
    }

    if (!name) {
      name = this.normalizeJobRuleName(rawLines[0] ?? normalized);
      confidence = 'low';
    }

    let cleanedLines = [...rawLines];
    if (titleLineIndex >= 0) {
      cleanedLines = cleanedLines.filter((_, index) => index !== titleLineIndex);
      if (bodyStartIndex > titleLineIndex) {
        bodyStartIndex -= 1;
      }
    }

    let normalizedJdText = normalized;
    if (bodyStartIndex >= 0) {
      normalizedJdText = [bodyFirstLine, ...cleanedLines.slice(bodyStartIndex + 1)]
        .filter(Boolean)
        .join('\n')
        .trim();
    } else if (titleLineIndex === 0 && cleanedLines.length > 0) {
      normalizedJdText = cleanedLines.join('\n').trim();
    }

    if (!normalizedJdText) {
      normalizedJdText = normalized;
    }

    return {
      name,
      jdText: normalizedJdText,
      confidence,
    };
  }

  private normalizeJobRuleName(value: string) {
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (!collapsed) return '未命名岗位';
    return collapsed.slice(0, 100);
  }

  private getShanghaiDateParts(date: Date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    return {
      date: `${map.get('year')}-${map.get('month')}-${map.get('day')}`,
      time: `${map.get('hour')}:${map.get('minute')}`,
    };
  }

  private upsertOpenAiDailyTokenUsage(
    value: unknown,
    next: { date: string; requests: number; tokens: number },
  ) {
    const current = Array.isArray(value)
      ? value
          .map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              return null;
            }

            const record = item as Record<string, unknown>;
            const date = typeof record.date === 'string' ? record.date.trim() : '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
              return null;
            }

            return {
              date,
              requests: typeof record.requests === 'number' ? Math.max(0, Math.floor(record.requests)) : 0,
              tokens: typeof record.tokens === 'number' ? Math.max(0, Math.floor(record.tokens)) : 0,
            };
          })
          .filter((item): item is { date: string; requests: number; tokens: number } => Boolean(item))
      : [];

    const withoutToday = current.filter((item) => item.date !== next.date);
    return [...withoutToday, next].sort((left, right) => left.date.localeCompare(right.date)).slice(-366);
  }

  private buildCandidateCreateInput(
    uniqueKey: string,
    jobRuleId: string,
    profile: CandidateProfile,
    mail: { subject: string; senderName: string; senderEmail: string; receivedAt: Date },
  ) {
    return {
      uniqueKey, jobRuleId,
      name: profile.name, email: profile.email, phone: profile.phone,
      city: profile.city, education: profile.education, status: profile.status,
      targetJob: profile.target_job, targetCity: profile.target_city,
      salaryExpectation: profile.salary_expectation,
      recentCompany: profile.recent_company, recentTitle: profile.recent_title,
      yearsExperience: profile.years_experience, rawEmailText: profile.raw_text,
      parsedCandidateProfile: profile as any,
      receivedAt: mail.receivedAt, sourceSubject: mail.subject,
      sourceSenderName: mail.senderName, sourceSenderEmail: mail.senderEmail,
    };
  }

  private buildCandidateUpdateInput(
    jobRuleId: string,
    profile: CandidateProfile,
    mail: { subject: string; senderName: string; senderEmail: string; receivedAt: Date },
  ) {
    return {
      jobRuleId,
      name: profile.name, email: profile.email, phone: profile.phone,
      city: profile.city, education: profile.education, status: profile.status,
      targetJob: profile.target_job, targetCity: profile.target_city,
      salaryExpectation: profile.salary_expectation,
      recentCompany: profile.recent_company, recentTitle: profile.recent_title,
      yearsExperience: profile.years_experience, rawEmailText: profile.raw_text,
      parsedCandidateProfile: profile as any,
      receivedAt: mail.receivedAt, sourceSubject: mail.subject,
      sourceSenderName: mail.senderName, sourceSenderEmail: mail.senderEmail,
    };
  }

  private async createScreeningRecord(
    candidateId: string,
    jobRuleId: string,
    profile: CandidateProfile,
    jdText: string,
    params: {
      status: ScreeningStatusValue;
      errorMessage?: string | null;
      screening?: ScreeningResult;
      modelName?: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
      durationMs?: number;
    },
  ) {
    return this.prisma.candidateScreening.create({
      data: {
        candidateId, jobRuleId,
        promptVersion: PROMPT_VERSION,
        modelName: params.modelName ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
        requestPayload: (params.requestPayload ?? { candidate_profile: profile, job_description: jdText }) as any,
        responsePayload: (params.responsePayload ?? {}) as any,
        score: params.screening?.score ?? null,
        decision: params.screening ? this.mapDecision(params.screening.decision) : null,
        matchedPoints: (params.screening?.matched_points ?? []) as any,
        risks: (params.screening?.risks ?? []) as any,
        summary: params.screening?.summary ?? null,
        nextStep: params.screening?.next_step ?? null,
        durationMs: params.durationMs ?? null,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
      },
    });
  }

  private createIngestionLog(
    mail: {
      mailbox?: string | null;
      imapUid: number | null;
      messageId: string;
      uniqueKey: string;
      subject: string;
      senderName: string;
      senderEmail: string;
      receivedAt: Date;
    },
    candidateId: string | null,
    status: string,
    errorMessage?: string,
  ) {
    const mailbox = mail.mailbox || process.env.MAIL_FOLDER || 'INBOX';
    return this.prisma.emailIngestionLog.upsert({
      where: { uniqueKey: mail.uniqueKey },
      create: {
        mailbox,
        imapUid: mail.imapUid, messageId: mail.messageId, uniqueKey: mail.uniqueKey,
        subject: mail.subject, senderName: mail.senderName, senderEmail: mail.senderEmail,
        receivedAt: mail.receivedAt, status,
        candidateId: candidateId ?? undefined,
        errorMessage,
      },
      update: {
        mailbox,
        imapUid: mail.imapUid,
        messageId: mail.messageId,
        subject: mail.subject,
        senderName: mail.senderName,
        senderEmail: mail.senderEmail,
        receivedAt: mail.receivedAt,
        status,
        candidateId: candidateId ?? undefined,
        errorMessage,
      },
    });
  }

  private mapDecision(decision: ScreeningResult['decision']) {
    const map = { recommend: 'RECOMMEND', hold: 'HOLD', reject: 'REJECT' } as const;
    return map[decision];
  }
}
