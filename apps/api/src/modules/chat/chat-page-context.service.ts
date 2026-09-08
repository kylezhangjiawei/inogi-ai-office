import { ForbiddenException, Injectable } from '@nestjs/common';
import { ResearchDevelopmentController } from '../research-development/research-development.controller';
import { ResearchDevelopmentService } from '../research-development/research-development.service';
import { isWorkspaceAllowed, runInRdWorkspace } from '../research-development/rd-workspace.context';
import type { RagUserContext } from '../rag/rag.service';
import { isISO8601 } from 'class-validator';
import { checkAgentPermission } from './agent-permission';

export type PageContextRefV1 = {
  schemaVersion: 1; pageKey: 'rd_task_detail'; scope: 'entity';
  refs: [{ entityType: 'rd_task'; entityId: string; workspace: 'rd' }];
  capturedAt: string;
};
export type ResolvedPageContext = {
  schemaVersion: 1; status: 'resolved' | 'unavailable'; ref?: PageContextRefV1;
  entity?: { id: string; title: string; workspace: 'rd'; canonicalUrl: string; fields: Record<string, unknown> };
  resolvedAt: string; shareBlocked: true;
};

/** Build a fresh allowlisted object; display hints/URLs/prompt text never persist. */
export function normalizePageContext(raw: unknown): PageContextRefV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.pageKey !== 'rd_task_detail' || value.scope !== 'entity'
    || !Array.isArray(value.refs) || value.refs.length !== 1
    || typeof value.capturedAt !== 'string' || value.capturedAt.length > 40
    || !/^\d{4}-\d{2}-\d{2}T/.test(value.capturedAt) || !isISO8601(value.capturedAt, { strict: true })) return null;
  const ref = value.refs[0];
  if (!ref || typeof ref !== 'object' || ref.entityType !== 'rd_task' || ref.workspace !== 'rd'
    || typeof ref.entityId !== 'string' || !ref.entityId.trim() || ref.entityId.length > 100 || /[\u0000-\u001f\u007f]/.test(ref.entityId)) return null;
  return { schemaVersion: 1, pageKey: 'rd_task_detail', scope: 'entity', refs: [{ entityType: 'rd_task', entityId: ref.entityId.trim(), workspace: 'rd' }], capturedAt: value.capturedAt };
}

export const unavailablePageContext = (raw?: unknown): ResolvedPageContext => ({
  schemaVersion: 1, status: 'unavailable', ...(normalizePageContext(raw) ? { ref: normalizePageContext(raw)! } : {}),
  resolvedAt: new Date().toISOString(), shareBlocked: true,
});

@Injectable()
export class ChatPageContextService {
  constructor(private readonly rd: ResearchDevelopmentService) {}

  /** Shared resource gate for page context and delivery checks. Missing and denied are indistinguishable. */
  async requireTask(taskId: string, user: RagUserContext) {
    const permissions = user.permissions ?? [];
    if (!isWorkspaceAllowed('rd', permissions)
      || !checkAgentPermission(ResearchDevelopmentController, 'getTaskAttachments', permissions).allowed) {
      throw new ForbiddenException('当前任务不可读取，请确认任务范围与访问权限');
    }
    const full = permissions.includes('*') || permissions.includes('rd-task:reassign');
    const task = await runInRdWorkspace('rd', () => this.rd.resolveChatTask(taskId, {
      userId: user.userId, userName: user.name, hasFullAccess: full,
      canReadAll: full || permissions.includes('rd-task:view-all'),
    }));
    return { ...task, workspace: 'rd' as const, canonicalUrl: `/rd-task/${encodeURIComponent(task.taskId)}` };
  }

  async resolve(raw: unknown, user: RagUserContext): Promise<ResolvedPageContext> {
    const ref = normalizePageContext(raw);
    if (!ref) return unavailablePageContext();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const task = await Promise.race([
        this.requireTask(ref.refs[0].entityId, user),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('page context timeout')), 1500); }),
      ]);
      return { schemaVersion: 1, status: 'resolved', ref, entity: { id: task.taskId, title: task.title,
        workspace: task.workspace, canonicalUrl: task.canonicalUrl, fields: task.fields },
      resolvedAt: new Date().toISOString(), shareBlocked: true };
    } catch {
      return unavailablePageContext(ref);
    } finally { if (timer) clearTimeout(timer); }
  }

  /** The controller only calls this after loading the stored, unscoped answer and active recipient. */
  sharePlainAnswer(user: RagUserContext, recipient: { id: string; name: string | null }, content: string) {
    return this.rd.createMessage({ sender: { id: user.userId, name: user.name, role: user.roleName },
      recipient_id: recipient.id, recipient_name: recipient.name, source: 'rd',
      subject: 'MateChat 回答分享', body: content });
  }
}
