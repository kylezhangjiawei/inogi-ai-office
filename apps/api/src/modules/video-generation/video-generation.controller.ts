import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

import { CreateVideoDto } from './dto/create-video.dto';
import { SaveCostGateDto } from './dto/save-cost-gate.dto';
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
  listVideos(@Req() req: Request, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const userId = this.getUserId(req);
    return this.service.listVideos(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 12,
    );
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
