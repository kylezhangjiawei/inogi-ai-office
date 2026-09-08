import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChatArchiveJob, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip = require('jszip');
import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { PermissionCatalogService } from '../permission-catalog/permission-catalog.service';
import type { RagUserContext } from '../rag/rag.service';
import { ChatFileCatalogService, CatalogFile, FileRef, fileRef, publicFile, normalizeFileFilter } from './chat-file-catalog.service';
import { archiveLimits, csv, safeArchiveName, stringIds, uniqueArchivePath } from './chat-archive.utils';
import { withChatStateLock } from './chat-state';

type ReportRow = { id: string; name: string; source: string; path: string; status: 'ok' | 'duplicate' | 'failed'; bytes: number; sha256?: string; error?: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const refsOf = (value: unknown) => value as FileRef[];
const rowsOf = (value: unknown) => (Array.isArray(value) ? value : []) as ReportRow[];
const LEASE_MS = 90000;
const ACTIVE = ['queued', 'running'];

@Injectable()
export class ChatArchiveService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatArchiveService.name);
  private readonly running = new Map<string, AbortController>();
  private ticking = false;
  private cleaning = false;
  private stopped = false;
  constructor(private readonly prisma: PrismaService, private readonly catalog: ChatFileCatalogService,
    private readonly oss: OssService, private readonly permissions: PermissionCatalogService) {}

  onModuleDestroy() { this.stopped = true; for (const controller of this.running.values()) controller.abort(new Error('服务重启，任务将自动恢复')); }

  async assertConversation(userId: string, conversationId: string) {
    if (!await this.prisma.chatConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } })) throw new NotFoundException('会话不存在');
  }

  private async currentUser(userId: string): Promise<RagUserContext> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { permissions: true } } } });
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('账号不可用');
    const permissions = await this.permissions.filterDisabled(Array.isArray(user.role?.permissions) ? user.role.permissions as string[] : []);
    return { userId, name: user.name, permissions };
  }

  async search(raw: Record<string, unknown>, user: RagUserContext, conversationId: string) {
    await this.assertConversation(user.userId, conversationId);
    const filter = normalizeFileFilter(raw);
    const { files, warnings } = await this.catalog.collect(await this.currentUser(user.userId), filter);
    const limits = archiveLimits();
    // 绝不把截断后的结果伪装成“全部”。超限时只给预览，不能发出可执行快照。
    if (files.length > limits.maxFiles) return { selectionId: null, total: files.length, tooMany: true,
      files: files.slice(0, 30).map(publicFile), warnings: [...warnings, `命中超过 ${limits.maxFiles} 个文件，请按项目、日期或类型拆分检索。`], limits };
    const selection = await this.prisma.chatFileSelection.create({ data: {
      userId: user.userId, conversationId, filter: json(filter), files: json(files.map(fileRef)), warnings: json(warnings), expiresAt: new Date(Date.now() + 3600000),
    } });
    return { selectionId: selection.id, total: files.length, knownBytes: files.reduce((sum, file) => sum + file.size, 0),
      unknownSizes: files.filter((file) => !file.size).length, files: files.slice(0, 30).map(publicFile), hasMore: files.length > 30,
      expiresAt: selection.expiresAt.toISOString(), warnings, limits };
  }

  async selection(id: string, userId: string, conversationId: string, offset = 0) {
    await this.assertConversation(userId, conversationId);
    const selection = await this.prisma.chatFileSelection.findFirst({ where: { id, userId, conversationId, expiresAt: { gt: new Date() } } });
    if (!selection) throw new NotFoundException('检索结果已过期，请重新查找');
    const files = refsOf(selection.files);
    return { selectionId: id, total: files.length, files: files.slice(offset, offset + 100).map(publicFile), nextOffset: offset + 100 < files.length ? offset + 100 : null, warnings: selection.warnings };
  }

  async recentSelections(userId: string, conversationId: string) {
    await this.assertConversation(userId, conversationId);
    const selections = await this.prisma.chatFileSelection.findMany({ where: { userId, conversationId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 5 });
    return selections.map((item) => ({ selectionId: item.id, total: refsOf(item.files).length, createdAt: item.createdAt.toISOString() }));
  }

  async create(raw: Record<string, unknown>, user: RagUserContext, conversationId: string) {
    await this.assertConversation(user.userId, conversationId);
    if (!this.oss.isEnabled) throw new BadRequestException('文件存储未配置，暂时无法生成压缩包');
    const selectionIds = stringIds(raw.selection_ids, 20);
    const selectedIds = raw.file_ids === undefined ? undefined : stringIds(raw.file_ids, archiveLimits().maxFiles);
    const grouping = raw.grouping ?? 'source';
    if (!['source', 'type', 'flat'].includes(String(grouping))) throw new BadRequestException('分组方式须为 source、type 或 flat');
    if (raw.filename !== undefined && (typeof raw.filename !== 'string' || raw.filename.length > 200)) throw new BadRequestException('压缩包名称过长或无效');
    const filename = safeArchiveName(String(raw.filename || '项目资料').replace(/\.zip$/i, '')) + '.zip';
    const selections = await this.prisma.chatFileSelection.findMany({ where: { id: { in: selectionIds }, userId: user.userId, conversationId, expiresAt: { gt: new Date() } } });
    if (selections.length !== selectionIds.length) throw new NotFoundException('检索结果不存在、已过期或不属于当前会话');
    const all = new Map(selections.flatMap((s) => refsOf(s.files)).map((file) => [file.id, file]));
    if (selectedIds?.some((id) => !all.has(id))) throw new BadRequestException('只能打包检索结果中已有的文件编号');
    const files = (selectedIds ? selectedIds.map((id) => all.get(id)!) : [...all.values()]).sort((a, b) => a.id.localeCompare(b.id));
    const limits = archiveLimits();
    if (!files.length || files.length > limits.maxFiles) throw new BadRequestException(`每包需包含 1–${limits.maxFiles} 个文件，请拆分范围`);
    if (files.reduce((sum, file) => sum + file.size, 0) > limits.maxBytes || files.some((file) => file.size > limits.maxFileBytes)) throw new BadRequestException('文件总量或单文件大小超过打包上限，请按项目、日期或类型拆分');
    const requestKey = createHash('sha256').update(JSON.stringify([user.userId, conversationId, selectionIds.sort(), files.map((f) => f.id), filename, grouping])).digest('hex');
    const job = await withChatStateLock(this.prisma, 'archives:queue', async (tx) => {
      const existing = await tx.chatArchiveJob.findUnique({ where: { requestKey } });
      if (existing) return existing;
      if (await tx.chatArchiveJob.count({ where: { userId: user.userId, status: { in: ACTIVE } } }) >= limits.perUser) throw new BadRequestException('进行中的打包任务较多，请等待完成或取消后再试');
      return tx.chatArchiveJob.create({ data: { userId: user.userId, conversationId, requestKey, filename, grouping: String(grouping), files: json(files),
        warnings: json(selections.flatMap((s) => Array.isArray(s.warnings) ? s.warnings : [])), total: files.length,
        expiresAt: new Date(Date.now() + limits.retentionMs) } });
    });
    return this.view(job);
  }

  private view(job: ChatArchiveJob) {
    return { id: job.id, filename: job.filename, status: job.expiresAt.getTime() <= Date.now() ? 'expired' : job.status, total: job.total,
      processed: job.processed, succeeded: job.succeeded, failed: job.failed, bytes: Number(job.bytes), error: job.error,
      cancelRequested: job.cancelRequested, warnings: job.warnings, createdAt: job.createdAt.toISOString(), expiresAt: job.expiresAt.toISOString() };
  }
  async list(userId: string, conversationId: string) {
    await this.assertConversation(userId, conversationId);
    const jobs = await this.prisma.chatArchiveJob.findMany({ where: { userId, conversationId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return jobs.map((job) => this.view(job));
  }
  private async owned(id: string, userId: string) {
    const job = await this.prisma.chatArchiveJob.findFirst({ where: { id, userId } });
    if (!job) throw new NotFoundException('打包任务不存在');
    await this.assertConversation(userId, job.conversationId);
    return job;
  }
  async report(id: string, userId: string, offset: number) {
    const job = await this.owned(id, userId);
    const rows = rowsOf(job.report);
    return { ...this.view(job), rows: rows.slice(offset, offset + 100), nextOffset: offset + 100 < rows.length ? offset + 100 : null };
  }
  async cancel(id: string, userId: string) {
    await this.owned(id, userId);
    await this.prisma.chatArchiveJob.updateMany({ where: { id, userId, status: 'queued' }, data: { status: 'canceled', cancelRequested: true } });
    await this.prisma.chatArchiveJob.updateMany({ where: { id, userId, status: 'running' }, data: { cancelRequested: true } });
    this.running.get(id)?.abort(new Error('用户取消打包'));
    return this.view(await this.owned(id, userId));
  }
  async retry(id: string, userId: string) {
    const job = await this.owned(id, userId);
    if (job.expiresAt.getTime() <= Date.now()) throw new BadRequestException('任务已过期，请重新检索');
    await withChatStateLock(this.prisma, 'archives:queue', async (tx) => {
      if (await tx.chatArchiveJob.count({ where: { userId, status: { in: ACTIVE } } }) >= archiveLimits().perUser) throw new BadRequestException('进行中的打包任务较多');
      const updated = await tx.chatArchiveJob.updateMany({ where: { id, userId, status: { in: ['failed', 'partial', 'canceled'] }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
        data: { status: 'queued', cancelRequested: false, error: null, attempts: 0 } });
      if (!updated.count) throw new BadRequestException('当前任务不可重试，或上次执行正在结束');
    });
    return this.view(await this.owned(id, userId));
  }

  async download(id: string, userId: string) {
    const job = await this.owned(id, userId);
    if (!['succeeded', 'partial'].includes(job.status) || !job.objectKey || job.expiresAt.getTime() <= Date.now()) throw new BadRequestException('压缩包尚未就绪或已过期');
    const included = new Set(rowsOf(job.report).filter((row) => row.status !== 'failed').map((row) => row.id));
    const refs = refsOf(job.files).filter((f) => included.has(f.id));
    const current = await this.catalog.resolve(refs, await this.currentUser(userId));
    if (refs.some((ref) => current.get(ref.id)?.revision !== ref.revision)) throw new ForbiddenException('部分源文件已变更或访问权限已调整，请重新检索打包');
    const url = this.oss.getArchiveDownloadUrl(job.objectKey, job.filename);
    if (!url) throw new BadRequestException('下载地址暂时不可用');
    return { url, filename: job.filename, expiresIn: 60 };
  }

  /** DB 队列全局并发受限；过期租约自动接管，三次进程中断后转为可见失败。 */
  @Interval(5000)
  async tick() {
    if (this.stopped || this.ticking || this.running.size >= archiveLimits().concurrency) return;
    this.ticking = true;
    try {
      const job = await withChatStateLock(this.prisma, 'archives:queue', async (tx) => {
        const now = new Date();
        await tx.chatArchiveJob.updateMany({ where: { status: 'running', leaseUntil: { lte: now }, attempts: { gte: 3 } }, data: { status: 'failed', error: '后台任务多次中断，请手动重试', claimToken: null, leaseUntil: null } });
        const running = await tx.chatArchiveJob.count({ where: { status: 'running', leaseUntil: { gt: now } } });
        if (running >= archiveLimits().concurrency) return null;
        const candidate = await tx.chatArchiveJob.findFirst({ where: { expiresAt: { gt: now }, OR: [{ status: 'queued' }, { status: 'running', leaseUntil: { lte: now } }] }, orderBy: { createdAt: 'asc' } });
        if (!candidate) return null;
        return tx.chatArchiveJob.update({ where: { id: candidate.id }, data: { status: 'running', claimToken: randomUUID(), leaseUntil: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 }, processed: 0, succeeded: 0, failed: 0, bytes: 0, report: Prisma.DbNull, error: null } });
      });
      if (job) void this.process(job).catch((error) => this.logger.error(`打包后台执行异常: ${error instanceof Error ? error.message : error}`));
    } catch (error) { this.logger.error(`打包队列暂不可用: ${error instanceof Error ? error.message : error}`); }
    finally { this.ticking = false; }
  }

  private async stage(file: CatalogFile, path: string, signal: AbortSignal, remaining: number): Promise<{ bytes: number; hash: string }> {
    const max = Math.min(archiveLimits().maxFileBytes, remaining);
    let source: Readable;
    if (file.objectKey) {
      const object = await this.oss.getObjectStream(file.objectKey);
      if (!object) throw new Error('原文件不存在或暂时无法读取');
      source = object.stream as Readable;
      if (object.size > max) { source.destroy(); throw new Error('文件超过大小上限'); }
    } else if (file.dataUrl && /^data:[^,]*;base64,/.test(file.dataUrl)) {
      const encoded = file.dataUrl.slice(file.dataUrl.indexOf(',') + 1);
      if (encoded.length * 0.75 > max + 3) throw new Error('文件超过大小上限');
      source = Readable.from([Buffer.from(encoded, 'base64')]);
    } else throw new Error('缺少可下载原文件；外部网址不参与打包');
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > max) return done(new Error('文件或压缩包总量超过上限'));
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(source, meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
    return { bytes, hash: hash.digest('hex') };
  }

  async process(job: ChatArchiveJob) {
    const controller = new AbortController();
    this.running.set(job.id, controller);
    const timeout = setTimeout(() => controller.abort(new Error('打包超时，请拆分范围后重试')), archiveLimits().timeoutMs);
    let renewing = false;
    const renew = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.prisma.chatArchiveJob.updateMany({ where: { id: job.id, claimToken: job.claimToken, status: 'running', cancelRequested: false, expiresAt: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
        .then((result) => { if (!result.count) controller.abort(new Error('任务已取消或执行权已转移')); })
        .catch(() => controller.abort(new Error('数据库连接中断，暂停打包'))).finally(() => { renewing = false; });
    }, 15000);
    const signal = controller.signal;
    let directory: string | undefined;
    let outputKey: string | undefined;
    let published = false;
    const report: ReportRow[] = [];
    try {
      if (!await this.prisma.chatArchiveJob.count({ where: { id: job.id, claimToken: job.claimToken, status: 'running' } })) return;
      if (job.cancelRequested) throw new Error('用户取消打包');
      await this.assertConversation(job.userId, job.conversationId);
      const user = await this.currentUser(job.userId);
      const refs = refsOf(job.files);
      const accessible = await this.catalog.resolve(refs, user);
      directory = await mkdtemp(join(tmpdir(), 'matechat-archive-'));
      await writeFile(join(directory, '.owner.json'), JSON.stringify({ jobId: job.id, claimToken: job.claimToken }), { mode: 0o600 });
      if (job.objectKey) await this.oss.deleteArchiveObject(job.objectKey);
      const used = new Set<string>(['文件清单.csv', '打包说明.txt']);
      const hashPaths = new Map<string, string>();
      const entries: Array<{ local: string; path: string }> = [];
      let totalBytes = 0;
      for (const [index, ref] of refs.entries()) {
        signal.throwIfAborted();
        const local = join(directory, String(index));
        try {
          const file = accessible.get(ref.id);
          if (!file || file.revision !== ref.revision) throw new Error('源文件已变更或当前无权访问');
          const result = await this.stage(file, local, AbortSignal.any([signal, AbortSignal.timeout(120000)]), archiveLimits().maxBytes - totalBytes);
          const duplicate = hashPaths.get(result.hash);
          if (duplicate) {
            await rm(local, { force: true });
            report.push({ id: ref.id, name: ref.name, source: ref.folder, path: duplicate, status: 'duplicate', bytes: result.bytes, sha256: result.hash });
          } else {
            const folder = job.grouping === 'flat' ? '' : job.grouping === 'type' ? ref.name.split('.').pop() || '其他' : ref.folder;
            const path = uniqueArchivePath(folder, ref.name, used);
            totalBytes += result.bytes;
            hashPaths.set(result.hash, path); entries.push({ local, path });
            report.push({ id: ref.id, name: ref.name, source: ref.folder, path, status: 'ok', bytes: result.bytes, sha256: result.hash });
          }
        } catch (error) {
          signal.throwIfAborted();
          await rm(local, { force: true });
          report.push({ id: ref.id, name: ref.name, source: ref.folder, path: '', status: 'failed', bytes: 0, error: error instanceof Error ? error.message.slice(0, 180) : '文件读取失败' });
        }
        const updated = await this.prisma.chatArchiveJob.updateMany({ where: { id: job.id, claimToken: job.claimToken, status: 'running', cancelRequested: false },
          data: { processed: report.length, succeeded: report.filter((r) => r.status !== 'failed').length, failed: report.filter((r) => r.status === 'failed').length, bytes: BigInt(totalBytes) } });
        if (!updated.count) throw new Error('任务已取消或执行权已转移');
      }
      if (!entries.length) throw new Error('没有可打包的文件，请查看失败清单后重新检索');
      const zip = new JSZip();
      for (const entry of entries) zip.file(entry.path, Readable.from((async function* () { yield* createReadStream(entry.local); })()), { binary: true });
      zip.file('文件清单.csv', csv([['文件编号', '原文件名', '来源', '包内路径', '结果', '字节数', 'SHA256', '原因'], ...report.map((r) => [r.id, r.name, r.source, r.path, r.status === 'ok' ? '已打包' : r.status === 'duplicate' ? '内容相同，复用包内文件' : '未打包', r.bytes, r.sha256, r.error])]));
      zip.file('打包说明.txt', `MateChat 项目资料\n生成时间：${new Date().toISOString()}\n选择 ${refs.length} 个文件，实际 ${entries.length} 个去重文件，失败 ${report.filter((r) => r.status === 'failed').length} 个。\n文件按原始字节保存；相同 SHA256 内容去重。详细来源及未打包原因请查看文件清单.csv。\n此压缩包仅限有权访问原资料的人员使用，请勿随意转发。\n${Array.isArray(job.warnings) ? job.warnings.join('\n') : ''}`);
      const zipPath = join(directory, 'archive.zip');
      await pipeline(zip.generateNodeStream({ streamFiles: true, compression: 'STORE' }), createWriteStream(zipPath, { flags: 'wx', mode: 0o600 }), { signal });
      outputKey = this.oss.buildObjectKey('chat-archives', `${job.id}-${job.claimToken}.zip`);
      // 保留所有尝试的键：即使旧进程在丢失租约后才完成上传，过期清理仍能找到该对象。
      const outputKeys = [...(Array.isArray(job.outputKeys) ? job.outputKeys.filter((key): key is string => typeof key === 'string') : []), outputKey];
      const reserved = await this.prisma.chatArchiveJob.updateMany({ where: { id: job.id, claimToken: job.claimToken, status: 'running', cancelRequested: false }, data: { objectKey: outputKey, outputKeys } });
      if (!reserved.count) throw new Error('任务已取消或执行权已转移');
      await this.oss.uploadArchiveFile(outputKey, zipPath, signal);
      signal.throwIfAborted();
      const final = await this.prisma.chatArchiveJob.updateMany({ where: { id: job.id, claimToken: job.claimToken, status: 'running', cancelRequested: false, expiresAt: { gt: new Date() } },
        data: { status: report.some((r) => r.status === 'failed') ? 'partial' : 'succeeded', report: json(report), objectKey: outputKey, bytes: BigInt((await stat(zipPath)).size), leaseUntil: null, claimToken: null } });
      published = final.count === 1;
    } catch (error) {
      const latest = await this.prisma.chatArchiveJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } }).catch(() => null);
      await this.prisma.chatArchiveJob.updateMany({ where: { id: job.id, claimToken: job.claimToken, status: 'running' },
        data: { status: this.stopped && !latest?.cancelRequested ? 'queued' : latest?.cancelRequested ? 'canceled' : 'failed', report: json(report),
          error: latest?.cancelRequested ? null : (error instanceof Error ? error.message.slice(0, 300) : '打包失败'), leaseUntil: null, claimToken: null } }).catch(() => undefined);
    } finally {
      clearTimeout(timeout); clearInterval(renew); this.running.delete(job.id);
      if (outputKey && !published) await this.oss.deleteArchiveObject(outputKey).catch((error) => this.logger.warn(String(error)));
      if (directory) await rm(directory, { recursive: true, force: true }).catch((error) => this.logger.warn(String(error)));
    }
  }

  @Interval(60000)
  async cleanup() {
    if (this.cleaning || this.stopped) return;
    this.cleaning = true;
    try {
      const now = new Date();
      await this.cleanupLocalFiles();
      const expired = await this.prisma.chatArchiveJob.findMany({ where: { expiresAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, take: 100 });
      for (const job of expired) {
        const keys = new Set([job.objectKey, ...(Array.isArray(job.outputKeys) ? job.outputKeys : [])].filter((key): key is string => typeof key === 'string' && Boolean(key)));
        for (const key of keys) await this.oss.deleteArchiveObject(key);
        await this.prisma.chatArchiveJob.deleteMany({ where: { id: job.id, expiresAt: { lte: now } } });
      }
      await this.prisma.chatFileSelection.deleteMany({ where: { expiresAt: { lte: now } } });
    } catch (error) { this.logger.warn(`打包过期清理稍后重试: ${error instanceof Error ? error.message : error}`); }
    finally { this.cleaning = false; }
  }

  private async cleanupLocalFiles() {
    for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^matechat-archive-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
      const directory = join(tmpdir(), entry.name);
      const info = await stat(directory).catch(() => null);
      if (!info || Date.now() - info.mtimeMs < 10 * 60000 || (process.getuid && info.uid !== process.getuid())) continue;
      const owner = await readFile(join(directory, '.owner.json'), 'utf8').then((value) => JSON.parse(value) as { jobId?: string; claimToken?: string }).catch(() => null);
      if (!owner?.jobId || !owner.claimToken) continue;
      const job = await this.prisma.chatArchiveJob.findUnique({ where: { id: owner.jobId }, select: { claimToken: true, status: true, leaseUntil: true } });
      // 不清理未知数据库/其他应用留下的目录；只处理当前库能确认归属的任务。
      if (!job) continue;
      const active = job.claimToken === owner.claimToken && job.status === 'running' && job.leaseUntil && job.leaseUntil.getTime() > Date.now();
      if (!active) await rm(directory, { recursive: true, force: true });
    }
  }
}
