import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { OssService } from '../oss/oss.service';
import { DEPT_KB_OPS } from './dept-knowledge.constants';
import { DeptKbGuard, DeptKbOp } from './dept-kb.guard';
import { ResearchDevelopmentService } from './research-development.service';

type AuthedRequest = { user?: { id?: string; name?: string; role?: string; permissions?: string[] } };

/**
 * 部门知识库控制器：与研发知识库复用同一套 service CRUD，按路由 :kbId 切换存储域。
 *
 * 与研发知识库控制器（research-development.controller.ts 的 /knowledge/*）完全隔离——
 * 研发库端点一行不动；这里走独立路由 + DeptKbGuard 动态鉴权（见 dept-kb.guard.ts）。
 *
 * 可见性（一期决策）：部门成员默认全可见，故 viewer 一律 hasFullAccess=true，不做按人分值的行级过滤；
 * 但保留 permission_level 字段——dept-kb 管理员可在上传/编辑时设定（为后续启用过滤预留）。
 */
@Controller('research-development/dept-knowledge/:kbId')
@UseGuards(DeptKbGuard)
export class DeptKnowledgeController {
  constructor(
    private readonly rdService: ResearchDevelopmentService,
    private readonly ossService: OssService,
  ) {}

  /** 部门库 viewer：成员默认全可见（不做行级密级裁剪）。 */
  private viewer(req: AuthedRequest) {
    return { userId: req.user?.id, hasFullAccess: true };
  }

  private isManager(req: AuthedRequest): boolean {
    const perms = req.user?.permissions ?? [];
    return perms.includes('*') || perms.includes(DEPT_KB_OPS.MANAGE);
  }

  /**
   * 解析部门库上传/入库的权限分值（后端兜底）：
   * - dept-kb 管理员：用其请求值（0-100）；
   * - 普通部门成员：强制 0（公开）——部门库默认全可见，普通成员无权设定密级。
   */
  private resolveLevel(req: AuthedRequest, requested?: number): number {
    if (this.isManager(req) && typeof requested === 'number' && Number.isFinite(requested)) {
      return Math.max(0, Math.min(100, Math.round(requested)));
    }
    return 0;
  }

  // ── Categories ──────────────────────────────────────────────────────────────

  @Get('categories')
  getCategories(@Param('kbId') kbId: string) {
    return this.rdService.getKnowledgeCategories(kbId);
  }

  @Put('categories')
  @DeptKbOp(DEPT_KB_OPS.CATEGORY_CREATE, DEPT_KB_OPS.CATEGORY_EDIT, DEPT_KB_OPS.CATEGORY_DELETE)
  saveCategories(@Param('kbId') kbId: string, @Body() payload: unknown[]) {
    return this.rdService.saveKnowledgeCategories(payload, kbId);
  }

  @Post('categories')
  @DeptKbOp(DEPT_KB_OPS.CATEGORY_CREATE)
  createCategory(
    @Param('kbId') kbId: string,
    @Body() body: { label?: unknown; parent_id?: unknown; icon?: unknown; color?: unknown },
  ) {
    return this.rdService.createKnowledgeCategory(body, kbId);
  }

  @Patch('categories/:id')
  @DeptKbOp(DEPT_KB_OPS.CATEGORY_EDIT)
  updateCategory(
    @Param('kbId') kbId: string,
    @Param('id') id: string,
    @Body() body: { label?: unknown; icon?: unknown; color?: unknown },
  ) {
    return this.rdService.updateKnowledgeCategory(id, body, kbId);
  }

  @Delete('categories/:id')
  @DeptKbOp(DEPT_KB_OPS.CATEGORY_DELETE)
  deleteCategory(@Param('kbId') kbId: string, @Param('id') id: string) {
    return this.rdService.deleteKnowledgeCategory(id, kbId);
  }

  // ── Entries ─────────────────────────────────────────────────────────────────

  @Get('entries')
  getEntries(
    @Param('kbId') kbId: string,
    @Query('category_id') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('source') source?: string,
    @Query('file_type') fileType?: string,
    @Query('visibility') visibility?: string,
    @Query('permission_level') permissionLevelStr?: string,
    @Request() req?: AuthedRequest,
  ) {
    const permissionLevel = permissionLevelStr ? Number(permissionLevelStr) : undefined;
    return this.rdService.getKnowledgeEntries(
      { categoryId, keyword, source, fileType, visibility, permissionLevel: Number.isFinite(permissionLevel) ? permissionLevel : undefined },
      this.viewer(req ?? {}),
      kbId,
    );
  }

  @Post('classify-files')
  classifyFiles(@Param('kbId') kbId: string, @Body() body: { filenames?: string[] }) {
    const filenames = Array.isArray(body?.filenames) ? body.filenames.filter((f) => typeof f === 'string') : [];
    return this.rdService.classifyKbFiles(filenames, kbId);
  }

  /** 浏览器直传 OSS 第 1 步：返回预签名 PUT URL（对象前缀 deptkb/{kbId}）。 */
  @Post('presign-upload')
  @DeptKbOp(DEPT_KB_OPS.UPLOAD)
  presignUpload(
    @Param('kbId') kbId: string,
    @Body() body: { files?: Array<{ filename: string; content_type?: string }> },
  ) {
    if (!this.ossService.isEnabled) {
      return { enabled: false, files: [] };
    }
    const prefix = this.rdService.buildKbOssPrefix(kbId);
    const files = (body.files ?? []).map(({ filename, content_type }) => {
      const ct = content_type || 'application/octet-stream';
      const objectKey = this.ossService.buildObjectKey(prefix, filename);
      const putUrl = this.ossService.generatePutSignedUrl(objectKey, ct);
      return { objectKey, putUrl, contentType: ct };
    });
    return { enabled: true, files };
  }

  /** 浏览器直传 OSS 第 2 步：用已上传的对象键建条目。 */
  @Post('entries/from-oss-keys')
  @DeptKbOp(DEPT_KB_OPS.UPLOAD)
  async createEntriesFromOssKeys(
    @Param('kbId') kbId: string,
    @Body() body: {
      oss_files: Array<{ oss_key: string; filename: string; file_size?: number; content_type?: string }>;
      category_id?: string;
      description?: string;
      permission_level?: number;
      tags?: string;
      visibility?: string;
    },
    @Request() req: AuthedRequest,
  ) {
    const permissionLevel = this.resolveLevel(req, body.permission_level);
    return Promise.all((body.oss_files ?? []).map(async (f) => {
      const ext = f.filename.includes('.') ? f.filename.split('.').pop()!.toLowerCase() : '';
      const ossUrl = this.ossService.getSignedUrl(f.oss_key, 30 * 24 * 3600) ?? undefined;
      return this.rdService.createKnowledgeEntry({
        title: f.filename,
        description: body.description,
        category_id: body.category_id ?? 'kb-other',
        tags: body.tags ? String(body.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
        visibility: body.visibility ?? 'internal',
        permission_level: permissionLevel,
        source: 'manual',
        file_name: f.filename,
        file_type: ext,
        file_size: f.file_size,
        oss_url: ossUrl,
        created_by_id: req.user?.id,
        created_by_name: req.user?.name,
      }, kbId);
    }));
  }

  @Post('entries')
  @DeptKbOp(DEPT_KB_OPS.UPLOAD)
  @UseInterceptors(FilesInterceptor('files', 10))
  async createEntry(
    @Param('kbId') kbId: string,
    @UploadedFiles() files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }> | undefined,
    @Body() body: {
      title?: string;
      description?: string;
      category_id?: string;
      tags?: string;
      visibility?: string;
      permission_level?: string;
      external_url?: string;
    },
    @Request() req: AuthedRequest,
  ) {
    const uploadedFiles = files ?? [];
    const parsed = body.permission_level ? Number(body.permission_level) : undefined;
    const permissionLevel = this.resolveLevel(req, parsed);
    const prefix = this.rdService.buildKbOssPrefix(kbId);
    if (uploadedFiles.length > 0) {
      return Promise.all(uploadedFiles.map(async (f) => {
        const ext = f.originalname.includes('.') ? f.originalname.split('.').pop()!.toLowerCase() : '';
        const objectKey = await this.ossService.uploadBuffer(f.buffer, prefix, f.originalname, f.mimetype);
        const ossUrl = objectKey ? this.ossService.getSignedUrl(objectKey, 30 * 24 * 3600) : null;
        return this.rdService.createKnowledgeEntry({
          title: body.title || f.originalname,
          description: body.description,
          category_id: body.category_id ?? 'kb-other',
          tags: body.tags ? String(body.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
          visibility: body.visibility ?? 'internal',
          permission_level: permissionLevel,
          source: 'manual',
          file_name: f.originalname,
          file_type: ext,
          file_size: f.size ?? f.buffer.length,
          ...(ossUrl
            ? { oss_url: ossUrl }
            : { data_url: `data:${f.mimetype ?? 'application/octet-stream'};base64,${f.buffer.toString('base64')}` }
          ),
          created_by_id: req.user?.id,
          created_by_name: req.user?.name,
        }, kbId);
      }));
    }
    return this.rdService.createKnowledgeEntry({
      title: body.title ?? '未命名条目',
      description: body.description,
      category_id: body.category_id ?? 'kb-other',
      tags: body.tags ? String(body.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
      visibility: body.visibility ?? 'internal',
      permission_level: permissionLevel,
      source: 'manual',
      external_url: body.external_url,
      created_by_id: req.user?.id,
      created_by_name: req.user?.name,
    }, kbId);
  }

  @Get('entries/:id')
  async getEntry(@Param('kbId') kbId: string, @Param('id') id: string, @Request() req: AuthedRequest) {
    const entry = await this.rdService.getKnowledgeEntryById(id, this.viewer(req), kbId);
    if (!entry) throw new NotFoundException('条目不存在');
    return entry;
  }

  @Patch('entries/:id')
  @DeptKbOp(DEPT_KB_OPS.ENTRY_EDIT)
  updateEntry(
    @Param('kbId') kbId: string,
    @Param('id') id: string,
    @Body() body: Partial<{ title: string; description: string; category_id: string; tags: string[]; visibility: string; permission_level: number; archived: boolean }>,
    @Request() req: AuthedRequest,
  ) {
    // 非管理员不得修改权限分值（与研发库一致：防止经编辑接口绕过设密级）
    if (!this.isManager(req) && body.permission_level !== undefined) {
      delete body.permission_level;
    }
    return this.rdService.updateKnowledgeEntry(id, body, kbId);
  }

  @Patch('entries/:id/move')
  @DeptKbOp(DEPT_KB_OPS.ENTRY_MOVE, DEPT_KB_OPS.ENTRY_EDIT)
  moveEntry(@Param('kbId') kbId: string, @Param('id') id: string, @Body() body: { category_id?: string }) {
    return this.rdService.moveKnowledgeEntry(id, body.category_id ?? '', kbId);
  }

  @Delete('entries/:id')
  @DeptKbOp(DEPT_KB_OPS.ENTRY_DELETE)
  deleteEntry(@Param('kbId') kbId: string, @Param('id') id: string) {
    return this.rdService.deleteKnowledgeEntry(id, kbId);
  }

  @Post('entries/:id/view')
  incrementView(@Param('kbId') kbId: string, @Param('id') id: string) {
    return this.rdService.incrementKbEntryViewCount(id, kbId);
  }
}
