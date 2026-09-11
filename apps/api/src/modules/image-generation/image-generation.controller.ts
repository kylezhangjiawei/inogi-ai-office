import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { GenerateImageDto } from './dto/generate-image.dto';
import { EditImageDto } from './dto/edit-image.dto';
import {
  AssignImageCategoryDto,
  CreateImageCategoryDto,
  UpdateImageCategoryDto,
} from './dto/image-category.dto';
import { CreatePromptChatSessionDto, PromptChatDto } from './dto/prompt-chat.dto';
import { UploadImageDto } from './dto/upload-image.dto';
import { ImageGenerationService } from './image-generation.service';

type RequestUser = {
  id?: string;
  sub?: string;
  permissions?: string[];
};

const SUPER_ADMIN_PERMISSION = '*';

@Controller('image-generation')
export class ImageGenerationController {
  constructor(private readonly service: ImageGenerationService) {}

  @Post('generate')
  generate(@Req() req: Request, @Body() dto: GenerateImageDto) {
    const userId = this.getUserId(req);
    return this.service.generate(userId, dto);
  }

  @Post('generate/async')
  createGenerateTask(@Req() req: Request, @Body() dto: GenerateImageDto) {
    const userId = this.getUserId(req);
    return this.service.createGenerationTask(userId, dto);
  }

  @Get('tasks/:taskId')
  @Header('Cache-Control', 'no-store')
  getImageTask(@Req() req: Request, @Param('taskId') taskId: string) {
    const userId = this.getUserId(req);
    return this.service.getImageTask(userId, taskId);
  }

  @Post('prompt-chat')
  chatPrompt(@Req() req: Request, @Body() dto: PromptChatDto) {
    const userId = this.getUserId(req);
    return this.service.chatPrompt(userId, dto);
  }

  @Get('prompt-sessions')
  listPromptSessions(@Req() req: Request) {
    const userId = this.getUserId(req);
    return this.service.listPromptSessions(userId);
  }

  @Post('prompt-sessions')
  createPromptSession(@Req() req: Request, @Body() dto: CreatePromptChatSessionDto) {
    const userId = this.getUserId(req);
    return this.service.createPromptSession(userId, dto);
  }

  @Get('prompt-sessions/:id')
  getPromptSession(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.service.getPromptSession(userId, id);
  }

  @Get('usage')
  getUsage(@Req() req: Request, @Query('date') date?: string) {
    const userId = this.getUserId(req);
    return this.service.getUsage(userId, date);
  }

  @Get('images')
  listImages(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('favorite') favorite?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('query') query?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const userId = this.getUserId(req);
    return this.service.listImages(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 48) : 12,
      favorite === 'true',
      dateFrom,
      dateTo,
      query,
      categoryId,
    );
  }

  /** 本地图片入库：文件已经由 /api/files 直传 OSS，这里只登记成作品库记录。 */
  @Post('images/upload')
  @Permissions('image-library:upload')
  uploadImage(@Req() req: Request, @Body() dto: UploadImageDto) {
    const userId = this.getUserId(req);
    return this.service.uploadImage(userId, dto);
  }

  // ── 作品库分类 ──────────────────────────────────────────────────────────────
  // 「查」跟随页面权限 page:image-library；增删改各自独立动作码。

  @Get('categories')
  @Permissions('page:image-library')
  listCategories(@Req() req: Request) {
    const userId = this.getUserId(req);
    return this.service.listCategories(userId);
  }

  @Post('categories')
  @Permissions('image-category:create')
  createCategory(@Req() req: Request, @Body() dto: CreateImageCategoryDto) {
    const userId = this.getUserId(req);
    return this.service.createCategory(userId, dto);
  }

  @Patch('categories/:id')
  @Permissions('image-category:edit')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateImageCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Permissions('image-category:delete')
  deleteCategory(@Param('id') id: string) {
    return this.service.deleteCategory(id);
  }

  /** 归类自己的作品：不额外要求分类管理权限，能看到作品库即可整理自己的图。 */
  @Patch('images/:id/category')
  assignImageCategory(@Req() req: Request, @Param('id') id: string, @Body() dto: AssignImageCategoryDto) {
    const userId = this.getUserId(req);
    return this.service.assignImageCategory(userId, id, dto.categoryId);
  }

  @Get('images/:id/conversation')
  getImageConversation(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.service.getImageConversation(userId, id);
  }

  @Get('images/:id/read-urls')
  @Header('Cache-Control', 'no-store')
  getImageReadUrls(@Req() req: Request, @Param('id') id: string) {
    return this.service.getImageReadUrls(this.getUserId(req), id);
  }

  @Post('images/:id/edit')
  editImage(@Req() req: Request, @Param('id') id: string, @Body() dto: EditImageDto) {
    const userId = this.getUserId(req);
    return this.service.editImage(userId, id, dto);
  }

  @Post('images/:id/edit/async')
  createEditTask(@Req() req: Request, @Param('id') id: string, @Body() dto: EditImageDto) {
    const userId = this.getUserId(req);
    return this.service.createEditTask(userId, id, dto);
  }

  @Patch('images/:id/favorite')
  toggleFavorite(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.service.toggleFavorite(id, userId);
  }

  @Delete('images/:id')
  deleteImage(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.service.deleteImage(id, userId);
  }

  /**
   * 全量重建作品库向量索引（接入索引前生成/上传的存量作品用）。仅超管。
   * 与问题库的 rag-backfill 同口径，避免为存量数据写一次性脚本。
   */
  @Post('rag-backfill')
  ragBackfill(@Req() req: Request) {
    this.getUserId(req);
    const perms = (req.user as RequestUser | undefined)?.permissions ?? [];
    if (!perms.includes(SUPER_ADMIN_PERMISSION)) {
      throw new ForbiddenException('仅超级管理员可重建索引');
    }
    return this.service.backfillImagesToRag();
  }

  private getUserId(req: Request) {
    const user = req.user as RequestUser | undefined;
    const userId = user?.id ?? user?.sub;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  }
}
