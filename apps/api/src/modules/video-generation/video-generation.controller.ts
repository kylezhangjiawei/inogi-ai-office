import {
  Body,
  Controller,
  Delete,
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
import { CreateVideoDto } from './dto/create-video.dto';
import { SaveCostGateDto } from './dto/save-cost-gate.dto';
import { UploadVideoDto } from './dto/upload-video.dto';
import {
  AssignVideoCategoryDto,
  CreateVideoCategoryDto,
  UpdateVideoCategoryDto,
} from './dto/video-category.dto';
import { VideoGenerationService, estimateVideoCostYuan } from './video-generation.service';

type RequestUser = {
  id?: string;
  sub?: string;
};

@Controller('video-generation')
export class VideoGenerationController {
  constructor(private readonly service: VideoGenerationService) {}

  /** 提交视频生成任务（异步）：立即返回任务，后台轮询上游 */
  @Post('tasks')
  createTask(@Req() req: Request, @Body() dto: CreateVideoDto) {
    const userId = this.getUserId(req);
    return this.service.submit(userId, dto);
  }

  /** 查询单个任务状态（轮询用） */
  @Get('tasks/:id')
  @Header('Cache-Control', 'no-store')
  getTask(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.service.getTask(userId, id);
  }

  /** 历史视频库 */
  @Get('videos')
  listVideos(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const userId = this.getUserId(req);
    return this.service.listVideos(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 12,
      categoryId,
    );
  }

  /** 本地视频入库：文件已经由 /api/files 直传 OSS，这里只登记成作品库记录。 */
  @Post('videos/upload')
  @Permissions('video-library:upload')
  uploadVideo(@Req() req: Request, @Body() dto: UploadVideoDto) {
    const userId = this.getUserId(req);
    return this.service.uploadVideo(userId, dto);
  }

  /** 删除自己的视频（生成件与上传件同一入口）。 */
  @Delete('videos/:id')
  deleteVideo(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.service.deleteVideo(userId, id);
  }

  // ── 作品库分类 ──────────────────────────────────────────────────────────────
  // 「查」跟随页面权限 page:video-library；增删改各自独立动作码。

  @Get('categories')
  @Permissions('page:video-library')
  listCategories(@Req() req: Request) {
    const userId = this.getUserId(req);
    return this.service.listCategories(userId);
  }

  @Post('categories')
  @Permissions('video-category:create')
  createCategory(@Req() req: Request, @Body() dto: CreateVideoCategoryDto) {
    const userId = this.getUserId(req);
    return this.service.createCategory(userId, dto);
  }

  @Patch('categories/:id')
  @Permissions('video-category:edit')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateVideoCategoryDto) {
    return this.service.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Permissions('video-category:delete')
  deleteCategory(@Param('id') id: string) {
    return this.service.deleteCategory(id);
  }

  /** 归类自己的视频：不额外要求分类管理权限，能看到作品库即可整理自己的视频。 */
  @Patch('videos/:id/category')
  assignVideoCategory(@Req() req: Request, @Param('id') id: string, @Body() dto: AssignVideoCategoryDto) {
    const userId = this.getUserId(req);
    return this.service.assignVideoCategory(userId, id, dto.categoryId);
  }

  /** 成本预估（前端确认卡展示用）：按分辨率×时长计算 */
  @Get('estimate')
  estimate(@Query('resolution') resolution = '720P', @Query('duration') duration = '5') {
    const seconds = Number.parseInt(duration, 10) || 5;
    return {
      resolution,
      duration: seconds,
      cost_yuan: estimateVideoCostYuan(resolution, seconds),
    };
  }

  /** 成本闸门评估：预估成本 + 是否需确认 + 是否超预算被拦（确认卡 / 管理端展示用） */
  @Get('cost-gate')
  costGate(@Query('resolution') resolution = '720P', @Query('duration') duration = '5') {
    const seconds = Number.parseInt(duration, 10) || 5;
    return this.service.evaluateGate(resolution, seconds);
  }

  /** 当前成本闸门配置（管理端读取） */
  @Get('cost-gate/config')
  costGateConfig() {
    return this.service.getCostGateConfig();
  }

  /** 保存成本闸门配置（管理端） */
  @Post('cost-gate/config')
  saveCostGateConfig(@Body() dto: SaveCostGateDto) {
    return this.service.saveCostGateConfig(dto);
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
