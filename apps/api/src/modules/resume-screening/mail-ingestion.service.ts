import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createHash } from 'crypto';

import { IngestedMail } from './resume-screening.types';

export interface MailCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  mailbox: string;
  keywords: string[];
}

@Injectable()
export class MailIngestionService {
  constructor(private readonly configService: ConfigService) {}

  async fetchCandidateEmails(params: {
    sinceHours: number;
    limit: number;
    lastUid: number | null;
    credentials?: MailCredentials;
  }): Promise<{ mails: IngestedMail[]; latestUid: number | null; scannedCount: number }> {
    const creds = params.credentials ?? this.resolveEnvCredentials();

    if (!creds.host || !creds.user || !creds.pass) {
      throw new BadRequestException('未配置企业邮箱连接信息，请先完善邮箱配置。');
    }

    const client = new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: true,
      auth: { user: creds.user, pass: creds.pass },
      logger: false,
      connectionTimeout: 20000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });
    try {
      await client.connect();
      let latestUid = params.lastUid;
      await client.mailboxOpen(creds.mailbox);
      const searchQuery =
        params.lastUid && params.lastUid > 0
          ? { uid: `${params.lastUid + 1}:*` }
          : { since: new Date(Date.now() - params.sinceHours * 60 * 60 * 1000) };

      const uids = (await client.search(searchQuery)) || [];
      const selectedUids = Array.isArray(uids) ? uids.slice(-params.limit) : [];
      const mails: IngestedMail[] = [];
      const scannedCount = selectedUids.length;

      for await (const message of client.fetch(selectedUids, {
        uid: true,
        source: true,
        envelope: true,
        internalDate: true,
      })) {
        latestUid = latestUid ? Math.max(latestUid, message.uid) : message.uid;
        const parsed = await simpleParser(message.source);
        const subject = parsed.subject ?? message.envelope?.subject ?? '';
        const senderName = parsed.from?.value?.[0]?.name ?? '';
        const senderEmail = parsed.from?.value?.[0]?.address ?? '';
        const contentText =
          parsed.text?.trim() || this.stripHtml(parsed.html ? String(parsed.html) : '');
        const contentHtml = parsed.html ? String(parsed.html) : '';

        const target = [subject, senderName, senderEmail, contentText].join('\n').toLowerCase();
        if (!creds.keywords.some((kw) => target.includes(kw))) {
          continue;
        }

        const receivedAt = parsed.date ?? message.internalDate ?? new Date();
        const messageId = parsed.messageId ?? `uid-${message.uid}`;
        const uniqueKey = createHash('sha256')
          .update(`${messageId}|${creds.mailbox}|${receivedAt.toISOString()}`)
          .digest('hex');

        mails.push({
          imapUid: message.uid,
          messageId,
          uniqueKey,
          subject,
          senderName,
          senderEmail,
          receivedAt,
          contentText,
          contentHtml,
        });
      }

      return { mails, latestUid, scannedCount };
    } catch (error) {
      throw this.toMailConnectionException(error);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private resolveEnvCredentials(): MailCredentials {
    return {
      host: this.configService.get<string>('MAIL_IMAP_HOST') ?? '',
      port: Number(this.configService.get<string>('MAIL_IMAP_PORT') ?? 993),
      user: this.configService.get<string>('MAIL_USERNAME') ?? '',
      pass: this.configService.get<string>('MAIL_PASSWORD') ?? '',
      mailbox: this.configService.get<string>('MAIL_FOLDER') ?? 'INBOX',
      keywords: (
        this.configService.get<string>('MAIL_SOURCE_KEYWORDS') ??
        'zhaopin,zhaopinmail.com,智联招聘'
      )
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    };
  }

  private stripHtml(html: string) {
    return html.replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private toMailConnectionException(error: unknown) {
    if (error instanceof BadRequestException) {
      return error;
    }

    if (error instanceof Error) {
      const details = error as Error & {
        responseText?: string;
        authenticationFailed?: boolean;
        code?: string;
      };

      if (details.authenticationFailed || details.responseText) {
        return new BadRequestException(
          `企业邮箱登录失败：${details.responseText || '请检查 IMAP 是否开启、账号状态或邮箱密码是否正确。'}`,
        );
      }

      if (details.code === 'ETIMEOUT') {
        return new BadRequestException('连接企业邮箱超时，请检查 IMAP 服务、网络状态或邮箱服务商限制。');
      }
    }

    return new BadRequestException('连接企业邮箱失败，请检查邮箱配置或稍后重试。');
  }
}
