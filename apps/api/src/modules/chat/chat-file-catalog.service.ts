import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { ResearchDevelopmentService } from '../research-development/research-development.service';
import { ResearchDevelopmentController } from '../research-development/research-development.controller';
import { DEPT_KBS, DEPT_KB_OPS, LEVEL_FILTERED_DEPT_KB_IDS, deptKbPageCode } from '../research-development/dept-knowledge.constants';
import { isWorkspaceAllowed, runInRdWorkspace } from '../research-development/rd-workspace.context';
import { checkAgentPermission } from './agent-permission';
import type { RagUserContext } from '../rag/rag.service';

export const FILE_SOURCES = ['task', 'knowledge', 'image', 'video', 'chat'] as const;
export type FileSource = typeof FILE_SOURCES[number];
export type FileFilter = {
  sources: FileSource[]; workspace?: string; project?: string; task_ids?: string[];
  query?: string; types?: string[]; uploaded_by?: string; date_from?: string; date_to?: string;
};
export type CatalogFile = {
  id: string; source: FileSource; scope: string; resourceId: string; name: string; mime: string;
  size: number; createdAt: string; uploader: string; folder: string; revision: string;
  taskId?: string; ancestorIds?: string[]; searchText?: string;
  objectKey?: string; dataUrl?: string;
};
export type FileRef = Omit<CatalogFile, 'objectKey' | 'dataUrl' | 'searchText' | 'ancestorIds'>;
type RecordValue = Record<string, unknown>;
const text = (v: unknown) => typeof v === 'string' ? v : '';
const has = (user: RagUserContext, code: string) => user.permissions?.includes('*') || user.permissions?.includes(code);
export const fileRef = ({ objectKey, dataUrl, searchText, ancestorIds, ...ref }: CatalogFile): FileRef => ref;
export const publicFile = (file: FileRef) => ({ id: file.id, name: file.name, source: file.source, folder: file.folder, size: file.size, mime: file.mime, createdAt: file.createdAt, uploader: file.uploader });

export function normalizeFileFilter(raw: Record<string, unknown>): FileFilter {
  const strings = (v: unknown, max: number) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > max || v.some((s) => typeof s !== 'string' || s.length > 200)) throw new BadRequestException('筛选列表格式不正确或过长');
    return [...new Set((v as string[]).map((s) => s.trim()).filter(Boolean))];
  };
  const sources = strings(raw.sources, 5) ?? (raw.project || raw.task_ids || raw.workspace ? ['task'] : [...FILE_SOURCES]);
  if (!sources.length || sources.some((s) => !FILE_SOURCES.includes(s as FileSource))) throw new BadRequestException('不支持的文件来源');
  const out: FileFilter = { sources: sources as FileSource[], task_ids: strings(raw.task_ids, 100), types: strings(raw.types, 30)?.map((s) => s.toLowerCase().replace(/^\./, '')) };
  for (const key of ['query', 'project', 'uploaded_by', 'workspace', 'date_from', 'date_to'] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'string' || (raw[key] as string).length > 300) throw new BadRequestException(`${key} 格式不正确`);
      out[key] = (raw[key] as string).trim();
    }
  }
  if (out.workspace && !['rd', 'us-collab', 'production'].includes(out.workspace)) throw new BadRequestException('未知的工作区');
  if ((out.project || out.task_ids?.length || out.workspace) && sources.some((s) => s !== 'task')) throw new BadRequestException('项目/任务/工作区筛选只适用于 task 来源；其他资料请另行检索后合并打包');
  for (const key of ['date_from', 'date_to'] as const) {
    if (!out[key]) continue;
    const date = new Date(`${out[key]}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out[key]!) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== out[key]) throw new BadRequestException('日期须为有效的 YYYY-MM-DD，按上海自然日筛选');
  }
  if (out.date_from && out.date_to && out.date_from > out.date_to) throw new BadRequestException('开始日期不能晚于结束日期');
  return out;
}

export function matchesFile(file: CatalogFile, filter: FileFilter): boolean {
  if (filter.query && !filter.query.toLowerCase().split(/\s+/).every((word) => `${file.name} ${file.searchText ?? ''}`.toLowerCase().includes(word))) return false;
  if (filter.project && !`${file.folder} ${file.taskId ?? ''}`.toLowerCase().includes(filter.project.toLowerCase())) return false;
  if (filter.task_ids?.length && !filter.task_ids.some((id) => file.ancestorIds?.includes(id))) return false;
  if (filter.uploaded_by && !file.uploader.toLowerCase().includes(filter.uploaded_by.toLowerCase())) return false;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kind = file.mime.split('/')[0];
  const docs = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'rtf', 'odt'];
  if (filter.types?.length && !filter.types.some((t) => t === ext || t === kind || (t === 'document' && docs.includes(ext)) || (t === 'image' && ['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'tif', 'tiff', 'bmp'].includes(ext)) || (t === 'video' && ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) || (t === 'audio' && ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)))) return false;
  if (filter.date_from || filter.date_to) {
    const time = new Date(file.createdAt).getTime();
    if (!Number.isFinite(time)) return false;
    if (filter.date_from && time < new Date(`${filter.date_from}T00:00:00+08:00`).getTime()) return false;
    if (filter.date_to && time >= new Date(`${filter.date_to}T00:00:00+08:00`).getTime() + 86400000) return false;
  }
  return true;
}

/** 原始资料只在可信服务端解析；模型只获得来源 ID / 名称 / 统计，不获得对象键或下载签名。 */
@Injectable()
export class ChatFileCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly rd: ResearchDevelopmentService, private readonly oss: OssService) {}

  private describe(source: FileSource, scope: string, resourceId: string, data: RecordValue, extra: Partial<CatalogFile> = {}): CatalogFile {
    const objectKey = this.oss.extractObjectKey(text(data.object_key) || text(data.oss_url));
    const dataUrl = objectKey ? undefined : text(data.data_url) || undefined;
    const name = text(data.name) || text(data.file_name) || '未命名文件';
    const createdAt = text(data.created_at);
    const revision = createHash('sha256').update(JSON.stringify([objectKey, dataUrl ? createHash('sha256').update(dataUrl).digest('hex') : null, name, data.size ?? data.file_size, data.updated_at ?? createdAt])).digest('hex');
    return { id: createHash('sha256').update(`${source}:${scope}:${resourceId}`).digest('hex').slice(0, 32), source, scope, resourceId,
      name, mime: text(data.mime) || 'application/octet-stream', size: Math.max(0, Number(data.size ?? data.file_size) || 0),
      createdAt, uploader: text(data.created_by_name), folder: scope, revision, ...extra,
      ...(objectKey ? { objectKey } : {}), ...(dataUrl ? { dataUrl } : {}) };
  }

  private async kbViewer(user: RagUserContext, scope: string) {
    if (scope === 'rd') {
      if (!isWorkspaceAllowed('rd', user.permissions ?? []) || !checkAgentPermission(ResearchDevelopmentController, 'getKnowledgeEntries', user.permissions ?? []).allowed) return null;
      return { userId: user.userId, hasFullAccess: Boolean(has(user, 'rd-kb:manage')) };
    }
    if (!DEPT_KBS.some((kb) => kb.id === scope) || !has(user, deptKbPageCode(scope))) return null;
    const full = has(user, DEPT_KB_OPS.MANAGE) || !LEVEL_FILTERED_DEPT_KB_IDS.has(scope);
    return { userId: user.userId, hasFullAccess: Boolean(full), ...(!full ? { levelOverride: await this.rd.resolveDeptKbViewerLevel(scope, user.userId) } : {}) };
  }

  async collect(user: RagUserContext, filter: FileFilter, only?: FileRef[]): Promise<{ files: CatalogFile[]; warnings: string[] }> {
    const files: CatalogFile[] = [];
    const warnings: string[] = [];
    const wanted = only ? new Set(only.map((f) => f.id)) : null;
    const scopes = (source: FileSource, defaults: string[]) => only ? [...new Set(only.filter((f) => f.source === source).map((f) => f.scope))] : defaults;
    let scanned = 0;
    const add = (file: CatalogFile) => {
      if (++scanned > 50000) throw new BadRequestException('当前检索范围超过五万份资料，请按来源或项目缩小范围；本次未生成不完整的检索结果');
      if ((!wanted || wanted.has(file.id)) && matchesFile(file, filter)) files.push(file);
    };
    if (filter.sources.includes('task')) {
      for (const workspace of scopes('task', filter.workspace ? [filter.workspace] : ['rd', 'us-collab', 'production'])) {
        if (!isWorkspaceAllowed(workspace, user.permissions ?? []) || !checkAgentPermission(ResearchDevelopmentController, 'getTaskAttachments', user.permissions ?? []).allowed) continue;
        const full = has(user, 'rd-task:reassign');
        const rows = await runInRdWorkspace(workspace, () => this.rd.listChatTaskFiles({ userId: user.userId, userName: user.name, hasFullAccess: Boolean(full), canReadAll: Boolean(full || has(user, 'rd-task:view-all')) }));
        for (const row of rows) add(this.describe('task', workspace, `${row.taskId}/${row.noteId}/${row.attachment.id}`, { ...row.attachment, created_at: row.createdAt }, {
          taskId: row.taskId, ancestorIds: row.ancestorIds, uploader: row.uploader, folder: `${workspace}/${row.path || row.taskTitle} [${row.taskId}]`,
        }));
      }
    }
    if (filter.sources.includes('knowledge')) {
      for (const scope of scopes('knowledge', ['rd', ...DEPT_KBS.map((kb) => kb.id)])) {
        const viewer = await this.kbViewer(user, scope);
        if (!viewer) continue;
        const kbId = scope === 'rd' ? undefined : scope;
        const rows = await runInRdWorkspace('rd', () => this.rd.getKnowledgeEntries(undefined, viewer, kbId));
        for (const value of rows) {
          const row = value as RecordValue;
          if (!row.oss_url && !row.has_data_file) continue;
          const file = this.describe('knowledge', scope, text(row.id), row, { folder: scope === 'rd' ? '研发知识库' : DEPT_KBS.find((kb) => kb.id === scope)!.label, searchText: `${row.title ?? ''} ${row.description ?? ''} ${Array.isArray(row.tags) ? row.tags.join(' ') : ''}` });
          if (wanted && wanted.has(file.id) && !file.objectKey && row.has_data_file) {
            const detail = await runInRdWorkspace('rd', () => this.rd.getKnowledgeEntryById(text(row.id), viewer, kbId));
            // 嵌入式老文件的 revision 以列表元数据为准，内容仅在执行阶段取出。
            file.dataUrl = text(detail?.data_url) || undefined;
          }
          add(file);
        }
      }
    }
    if (filter.sources.includes('image')) {
      let cursor: string | undefined;
      do {
        const rows = await this.prisma.generatedImage.findMany({ where: { userId: user.userId, ...(only ? { id: { in: only.filter((f) => f.source === 'image').map((f) => f.resourceId) } } : {}) },
          orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, prompt: true, imageUrl: true, createdAt: true, category: { select: { name: true } } } });
        for (const row of rows) {
          const ext = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i.exec(this.oss.extractObjectKey(row.imageUrl) ?? '')?.[1]?.toLowerCase() ?? 'png';
          const file = this.describe('image', 'personal', row.id, { name: `${row.prompt.slice(0, 70) || '图片'}-${row.id}.${ext}`, oss_url: row.imageUrl, created_at: row.createdAt.toISOString(), mime: `image/${ext === 'jpg' ? 'jpeg' : ext}` }, { folder: `图片作品/${row.category?.name ?? '未分类'}`, uploader: user.name ?? '', searchText: row.prompt });
          if (wanted?.has(file.id) && !file.objectKey) file.dataUrl = (await this.prisma.generatedImage.findUnique({ where: { id: row.id }, select: { imageData: true } }))?.imageData;
          add(file);
        }
        cursor = rows.length === 200 ? rows.at(-1)!.id : undefined;
      } while (cursor);
    }
    if (filter.sources.includes('video')) {
      let cursor: string | undefined;
      do {
        const rows = await this.prisma.videoGeneration.findMany({ where: { userId: user.userId, status: 'succeeded', ...(only ? { id: { in: only.filter((f) => f.source === 'video').map((f) => f.resourceId) } } : {}) }, orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, prompt: true, videoObjectKey: true, createdAt: true, category: { select: { name: true } } } });
        for (const row of rows) {
          const ext = /\.(mp4|mov|webm|avi|mkv)$/i.exec(row.videoObjectKey)?.[1]?.toLowerCase() ?? 'mp4';
          add(this.describe('video', 'personal', row.id, { name: `${row.prompt.slice(0, 70) || '视频'}-${row.id}.${ext}`, object_key: row.videoObjectKey, mime: `video/${ext}`, created_at: row.createdAt.toISOString() }, { folder: `视频作品/${row.category?.name ?? '未分类'}`, uploader: user.name ?? '', searchText: row.prompt }));
        }
        cursor = rows.length === 200 ? rows.at(-1)!.id : undefined;
      } while (cursor);
    }
    if (filter.sources.includes('chat')) {
      let cursor: string | undefined;
      do {
        const rows = await this.prisma.chatMessage.findMany({ where: { conversation: { userId: user.userId }, ...(only ? { id: { in: only.filter((f) => f.source === 'chat').map((f) => f.resourceId.split('/')[0]) } } : {}) }, orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, attachments: true, createdAt: true, conversation: { select: { title: true } } } });
        const assetIds = rows.flatMap((row) => Array.isArray(row.attachments) ? row.attachments.map((att) => text((att as RecordValue)?.fileId)).filter(Boolean) : []);
        const assets = await this.prisma.fileAsset.findMany({ where: { id: { in: [...new Set(assetIds)] }, uploadedBy: user.userId, status: 'active', businessType: { not: 'chat-referenced' } } });
        const byId = new Map(assets.map((asset) => [asset.id, asset]));
        for (const row of rows) for (const attachment of Array.isArray(row.attachments) ? row.attachments : []) {
          const att = attachment as RecordValue;
          if (!att?.fileId) continue;
          // 只允许本人上传/生成的文件；共享聊天中的历史引用不变成绕过原业务权限的出口。
          const asset = byId.get(text(att.fileId));
          if (asset) add(this.describe('chat', 'personal', `${row.id}/${asset.id}`, { name: asset.fileName, object_key: asset.objectKey, mime: asset.mimeType, size: asset.fileSize, created_at: asset.createdAt.toISOString(), updated_at: asset.updatedAt.toISOString() }, { folder: `聊天附件/${row.conversation.title}`, uploader: user.name ?? '' }));
        }
        cursor = rows.length === 200 ? rows.at(-1)!.id : undefined;
      } while (cursor);
    }
    const deduped = [...new Map(files.map((file) => [file.id, file])).values()];
    if (!deduped.length) warnings.push('未找到符合条件且当前有权访问的文件；这不表示其他权限范围或未接入资料源不存在文件。');
    return { files: deduped.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)), warnings };
  }

  async resolve(refs: FileRef[], user: RagUserContext): Promise<Map<string, CatalogFile>> {
    const result = await this.collect(user, { sources: [...new Set(refs.map((f) => f.source))] }, refs);
    return new Map(result.files.map((f) => [f.id, f]));
  }
}
