import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ChatDeliveryCheck, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { PermissionCatalogService } from '../permission-catalog/permission-catalog.service';
import type { RagUserContext } from '../rag/rag.service';
import { ResearchDevelopmentController } from '../research-development/research-development.controller';
import { isWorkspaceAllowed } from '../research-development/rd-workspace.context';
import { checkAgentPermission } from './agent-permission';
import { ChatArchiveService } from './chat-archive.service';
import { ChatFileCatalogService, CatalogFile, FileRef, fileRef, matchesFile, publicFile } from './chat-file-catalog.service';
import { ChatPageContextService } from './chat-page-context.service';
import { DEFAULT_DELIVERY_REQUIREMENTS, DELIVERY_SCOPE_NOTE, DELIVERY_TEMPLATE_LABEL, DeliveryChecklist, DeliveryCheckView, DeliveryRequirement, StoredDeliveryRow } from './chat-delivery.types';

const MAX_ROWS = 20;
const MAX_CANDIDATES = 20;
const MAX_EVIDENCE = 10;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const checklistOf = (row: ChatDeliveryCheck) => row.checklist as unknown as DeliveryChecklist;
// PostgreSQL JSONB does not preserve object key order. Compare content without treating a read as an edit.
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

const identifier = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new BadRequestException(`${label}无效`);
  return value;
};
const revisionOf = (raw: Record<string, unknown>) => {
  if (!Number.isInteger(raw?.revision) || Number(raw.revision) < 1) throw new BadRequestException('缺少有效的清单版本，请刷新后重试');
  return Number(raw.revision);
};
const conflict = () => new ConflictException('清单或证据已发生变化，请刷新清单后重新核对');
const idsOf = (value: unknown, limit: number, label: string) => {
  if (!Array.isArray(value) || !value.length || value.length > limit) throw new BadRequestException(`${label}需包含 1–${limit} 个编号`);
  const ids = value.map((item) => identifier(item, label));
  if (new Set(ids).size !== ids.length) throw new BadRequestException(`${label}不可重复`);
  return ids;
};
const sameDefinition = (a: DeliveryRequirement, b: DeliveryRequirement) => a.title === b.title && a.required === b.required && JSON.stringify(a.keywords) === JSON.stringify(b.keywords);

export function normalizeDeliveryRequirements(raw: unknown): DeliveryRequirement[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_ROWS) throw new BadRequestException(`清单需包含 1–${MAX_ROWS} 项`);
  const rows = raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('清单项目格式不正确');
    const row = item as Record<string, unknown>;
    if (typeof row.title !== 'string' || !row.title.trim() || row.title.trim().length > 120) throw new BadRequestException('项目名称需为 1–120 字');
    if (!Array.isArray(row.keywords) || !row.keywords.length || row.keywords.length > 10 || row.keywords.some((word) => typeof word !== 'string' || !word.trim() || word.trim().length > 80)) throw new BadRequestException('每项需提供 1–10 个检索词，每词不超过 80 字');
    if (row.required !== undefined && typeof row.required !== 'boolean') throw new BadRequestException('必需标记格式不正确');
    return { id: row.id === undefined ? randomUUID() : identifier(row.id, '项目编号'), title: row.title.trim(), keywords: [...new Set((row.keywords as string[]).map((word) => word.trim()))], required: row.required !== false };
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new BadRequestException('清单项目编号不可重复');
  return rows;
}

/** Metadata creates candidates only. A confirmed row always records the exact revision explicitly selected by its owner. */
@Injectable()
export class ChatDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ChatFileCatalogService,
    private readonly archives: ChatArchiveService,
    private readonly pageContext: ChatPageContextService,
    private readonly permissions: PermissionCatalogService,
    private readonly oss: OssService,
  ) {}

  private async currentUser(userId: string): Promise<RagUserContext> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: { select: { permissions: true } } } });
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('账号不可用');
    const permissions = await this.permissions.filterDisabled(Array.isArray(user.role?.permissions) ? user.role.permissions as string[] : []);
    if (!isWorkspaceAllowed('rd', permissions) || !checkAgentPermission(ResearchDevelopmentController, 'getTaskAttachments', permissions).allowed) throw new ForbiddenException('没有查看研发任务资料的权限，无法检查交付资料');
    return { userId, name: user.name, permissions };
  }

  private async owned(id: string, userId: string) {
    const row = await this.prisma.chatDeliveryCheck.findFirst({ where: { id: identifier(id, '检查编号'), userId } });
    if (!row || row.workspace !== 'rd') throw new NotFoundException('资料检查不存在');
    await this.archives.assertConversation(userId, row.conversationId);
    return row;
  }

  private async scan(taskId: string, user: RagUserContext) {
    const task = await this.pageContext.requireTask(taskId, user);
    const filter = { sources: ['task'] as ['task'], workspace: 'rd', task_ids: [taskId] };
    try {
      const result = await this.catalog.collect(user, filter);
      // Recheck scope even when a future catalog implementation changes its filtering strategy.
      return { task, files: result.files.filter((file) => file.source === 'task' && file.scope === 'rd' && matchesFile(file, filter)), warnings: result.warnings };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('资料来源暂时读取失败，本次没有生成检查结论，请稍后刷新');
    }
  }

  private build(requirements: DeliveryRequirement[], files: CatalogFile[], warnings: string[], previous?: DeliveryChecklist): DeliveryChecklist {
    const prior = new Map(previous?.rows.map((row) => [row.id, row]) ?? []);
    const rows: StoredDeliveryRow[] = requirements.map((requirement) => {
      const old = prior.get(requirement.id);
      const reusable = old && sameDefinition(old, requirement) ? old : undefined;
      const matches = files.filter((file) => requirement.keywords.some((word) => `${file.name} ${file.searchText ?? ''}`.toLocaleLowerCase().includes(word.toLocaleLowerCase())));
      const current = new Map(matches.map((file) => [file.id, file]));
      const evidence = reusable?.status === 'confirmed' ? reusable.evidenceFileIds : [];
      const confirmed = evidence.length > 0 && evidence.every((id) => current.get(id)?.revision === reusable!.candidates.find((file) => file.id === id)?.revision);
      // Preserve selected, still-current evidence when newer candidates push it beyond the preview window.
      const displayed = [...new Map([...(confirmed ? evidence.map((id) => current.get(id)!) : []), ...matches].map((file) => [file.id, file])).values()].slice(0, MAX_CANDIDATES);
      const invalidated = reusable?.status === 'confirmed' && !confirmed;
      return { ...requirement, status: reusable?.status === 'not_required' ? 'not_required' : confirmed ? 'confirmed' : matches.length ? 'candidate' : 'missing',
        candidates: displayed.map(fileRef), candidateCount: matches.length, evidenceFileIds: confirmed ? evidence : [], confirmedAt: confirmed ? reusable!.confirmedAt : null,
        ...(invalidated ? { notice: '原确认文件已变化、移出范围或不可访问，请重新核对。' } : reusable?.notice ? { notice: reusable.notice } : {}) };
    });
    return { schemaVersion: 1, rows, scannedFileCount: files.length, warnings: [...new Set(warnings)] };
  }

  private view(row: ChatDeliveryCheck): DeliveryCheckView {
    const report = checklistOf(row);
    const rows = report.rows.map(({ candidates, ...item }) => ({ ...item, candidates: candidates.map(publicFile) }));
    return { id: row.id, conversationId: row.conversationId, taskId: row.taskId, taskTitle: row.taskTitle, workspace: 'rd', revision: row.revision,
      checkedAt: row.checkedAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), templateLabel: DELIVERY_TEMPLATE_LABEL,
      scopeNote: DELIVERY_SCOPE_NOTE, warnings: report.warnings, scannedFileCount: report.scannedFileCount, rows,
      summary: { total: rows.length, required: rows.filter((item) => item.required).length, confirmed: rows.filter((item) => item.status === 'confirmed').length,
        candidate: rows.filter((item) => item.status === 'candidate').length, missing: rows.filter((item) => item.status === 'missing').length,
        notRequired: rows.filter((item) => item.status === 'not_required').length,
        unresolvedRequired: rows.filter((item) => item.required && !['confirmed', 'not_required'].includes(item.status)).length } };
  }

  private async save(row: ChatDeliveryCheck, checklist: DeliveryChecklist, taskTitle: string) {
    const checkedAt = new Date();
    const saved = await this.prisma.chatDeliveryCheck.updateMany({ where: { id: row.id, userId: row.userId, revision: row.revision },
      data: { checklist: json(checklist), taskTitle, checkedAt, updatedAt: checkedAt, revision: { increment: 1 } } });
    if (saved.count !== 1) throw conflict();
    return { ...row, checklist: json(checklist) as Prisma.JsonValue, taskTitle, checkedAt, updatedAt: checkedAt, revision: row.revision + 1 };
  }

  /** Also called by the chat tool; the conversation supplied by the server overrides untrusted model arguments. */
  async create(raw: Record<string, unknown>, user: RagUserContext, conversationId?: string) {
    const conversation = identifier(conversationId ?? raw?.conversationId, '会话编号');
    const taskId = identifier(raw?.taskId ?? raw?.task_id, '研发任务编号');
    const requirements = raw?.requirements === undefined ? DEFAULT_DELIVERY_REQUIREMENTS : normalizeDeliveryRequirements(raw.requirements);
    await this.archives.assertConversation(user.userId, conversation);
    const current = await this.currentUser(user.userId);
    const scan = await this.scan(taskId, current);
    const row = await this.prisma.chatDeliveryCheck.create({ data: { userId: user.userId, conversationId: conversation, taskId, workspace: 'rd', taskTitle: scan.task.title,
      checklist: json(this.build(requirements, scan.files, scan.warnings)) } });
    return this.view(row);
  }

  async check(raw: Record<string, unknown>, user: RagUserContext, conversationId: string) { return this.create(raw, user, conversationId); }

  async list(conversationId: string, user: RagUserContext) {
    await this.archives.assertConversation(user.userId, identifier(conversationId, '会话编号'));
    const current = await this.currentUser(user.userId);
    const rows = await this.prisma.chatDeliveryCheck.findMany({ where: { userId: user.userId, conversationId, workspace: 'rd' }, orderBy: { updatedAt: 'desc' }, take: 10 });
    const result: DeliveryCheckView[] = [];
    const scans = new Map<string, Awaited<ReturnType<ChatDeliveryService['scan']>>>();
    for (const row of rows) {
      let scan = scans.get(row.taskId);
      if (!scan) { scan = await this.scan(row.taskId, current); scans.set(row.taskId, scan); }
      const report = this.build(checklistOf(row).rows, scan.files, scan.warnings, checklistOf(row));
      const changed = row.taskTitle !== scan.task.title || stableJson(report) !== stableJson(row.checklist);
      result.push(this.view(changed ? await this.save(row, report, scan.task.title) : row));
    }
    return result;
  }

  async update(id: string, raw: Record<string, unknown>, user: RagUserContext) {
    const row = await this.owned(id, user.userId);
    if (row.revision !== revisionOf(raw)) throw conflict();
    if (raw.requirements === undefined && raw.updates === undefined) throw new BadRequestException('请提供清单修改或核对结果');
    const scan = await this.scan(row.taskId, await this.currentUser(user.userId));
    const previous = checklistOf(row);
    const requirements = raw.requirements === undefined ? previous.rows : normalizeDeliveryRequirements(raw.requirements);
    const report = this.build(requirements, scan.files, scan.warnings, previous);
    if (raw.updates !== undefined) {
      if (!Array.isArray(raw.updates) || !raw.updates.length || raw.updates.length > MAX_ROWS) throw new BadRequestException('核对更新格式不正确');
      const visited = new Set<string>();
      for (const value of raw.updates) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('核对更新格式不正确');
        const update = value as Record<string, unknown>;
        const target = report.rows.find((item) => item.id === update.id);
        if (!target || visited.has(target.id)) throw new BadRequestException('核对项目不存在或重复');
        visited.add(target.id);
        if (!['open', 'confirmed', 'not_required'].includes(String(update.status))) throw new BadRequestException('核对状态无效');
        if (update.status === 'confirmed') {
          const selected = idsOf(update.evidenceFileIds, MAX_EVIDENCE, '确认资料');
          const previousRow = previous.rows.find((item) => item.id === target.id);
          // A click confirms exactly what the user saw, never a replacement uploaded between display and save.
          if (selected.some((fileId) => {
            const before = previousRow?.candidates.find((file) => file.id === fileId);
            const now = target.candidates.find((file) => file.id === fileId);
            return !before || !now || before.revision !== now.revision;
          })) throw conflict();
          target.status = 'confirmed'; target.evidenceFileIds = selected; target.confirmedAt = new Date().toISOString(); delete target.notice;
        } else {
          if (update.evidenceFileIds !== undefined && (!Array.isArray(update.evidenceFileIds) || update.evidenceFileIds.length)) throw new BadRequestException('只有确认状态可以选择证据文件');
          target.status = update.status === 'not_required' ? 'not_required' : target.candidateCount ? 'candidate' : 'missing';
          target.evidenceFileIds = []; target.confirmedAt = null; delete target.notice;
        }
      }
    }
    // Persist the same evidence-first candidate order used by subsequent reads.
    return this.view(await this.save(row, this.build(report.rows, scan.files, scan.warnings, report), scan.task.title));
  }

  async refresh(id: string, raw: Record<string, unknown>, user: RagUserContext) {
    const row = await this.owned(id, user.userId);
    if (row.revision !== revisionOf(raw)) throw conflict();
    const scan = await this.scan(row.taskId, await this.currentUser(user.userId));
    return this.view(await this.save(row, this.build(checklistOf(row).rows, scan.files, scan.warnings, checklistOf(row)), scan.task.title));
  }

  async archive(id: string, raw: Record<string, unknown>, user: RagUserContext) {
    let row = await this.owned(id, user.userId);
    if (row.revision !== revisionOf(raw)) throw conflict();
    if (raw.filename !== undefined && (typeof raw.filename !== 'string' || raw.filename.length > 200)) throw new BadRequestException('压缩包名称无效');
    const current = await this.currentUser(user.userId);
    const scan = await this.scan(row.taskId, current);
    const previous = checklistOf(row);
    const report = this.build(previous.rows, scan.files, scan.warnings, previous);
    const requirementIds = raw.requirementIds === undefined ? previous.rows.filter((item) => item.status === 'confirmed').map((item) => item.id) : idsOf(raw.requirementIds, MAX_ROWS, '打包项目');
    if (!requirementIds.length) throw new BadRequestException('请先核对并确认至少一项资料');
    const selectedRows = requirementIds.map((requirementId) => report.rows.find((item) => item.id === requirementId));
    if (selectedRows.some((item) => !item || item.status !== 'confirmed')) {
      if (stableJson(report) !== stableJson(previous)) await this.save(row, report, scan.task.title);
      throw conflict();
    }
    const refs = [...new Map(selectedRows.flatMap((item) => item!.candidates.filter((file) => item!.evidenceFileIds.includes(file.id))).map((file) => [file.id, file])).values()];
    const selection = await this.archives.search({ sources: ['task'], workspace: 'rd', task_ids: [row.taskId] }, current, row.conversationId);
    if (!selection.selectionId) throw new BadRequestException('当前任务资料超过打包范围上限，请缩小任务范围后重试');
    // Compare the actual archive snapshot too: the source may change between scan and archive search.
    const snapshot = await this.prisma.chatFileSelection.findFirst({ where: { id: selection.selectionId, userId: user.userId, conversationId: row.conversationId, expiresAt: { gt: new Date() } } });
    const snapshotRefs = new Map(((snapshot?.files ?? []) as unknown as FileRef[]).map((file) => [file.id, file]));
    if (refs.some((file) => snapshotRefs.get(file.id)?.revision !== file.revision)) throw conflict();
    // Reserve this revision before enqueueing so a concurrently edited checklist cannot pass the same optimistic check.
    row = await this.save(row, report, scan.task.title);
    const archive = await this.archives.create({ selection_ids: [selection.selectionId], file_ids: refs.map((file) => file.id), grouping: 'source', filename: raw.filename ?? `${scan.task.title}-已确认交付资料` }, current, row.conversationId);
    return { check: this.view(row), archive };
  }

  async preview(id: string, fileId: string, raw: Record<string, unknown>, user: RagUserContext) {
    const row = await this.owned(id, user.userId);
    if (row.revision !== revisionOf(raw)) throw conflict();
    const stored = checklistOf(row).rows.flatMap((item) => item.candidates).find((file) => file.id === identifier(fileId, '文件编号'));
    if (!stored) throw new NotFoundException('资料不在当前检查范围内');
    const scan = await this.scan(row.taskId, await this.currentUser(user.userId));
    const file = scan.files.find((item) => item.id === stored.id);
    if (!file || file.revision !== stored.revision) throw conflict();
    if (file.objectKey) {
      const url = this.oss.getSignedUrl(file.objectKey, 60);
      if (!url) throw new ServiceUnavailableException('资料下载地址暂不可用，请稍后重试');
      return { url, name: file.name, mime: file.mime, expiresIn: 60, isTaskPage: false };
    }
    return { url: file.taskId ? `/rd-task/${encodeURIComponent(file.taskId)}` : scan.task.canonicalUrl, name: file.name, mime: file.mime, expiresIn: null, isTaskPage: true };
  }
}
