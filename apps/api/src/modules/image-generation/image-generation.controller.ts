import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

import { GenerateImageDto } from './dto/generate-image.dto';
import { EditImageDto } from './dto/edit-image.dto';
import { CreatePromptChatSessionDto, PromptChatDto } from './dto/prompt-chat.dto';
import { ImageGenerationService } from './image-generation.service';

type RequestUser = {
  id?: string;
  sub?: string;
};

@Controller('image-generation')
export class ImageGenerationController {
  constructor(private readonly service: ImageGenerationService) {}

  @Post('generate')
  generate(@Req() req: Request, @Body() dto: GenerateImageDto) {
    const userId = this.getUserId(req);
    return this.service.generate(userId, dto);
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
  ) {
    const userId = this.getUserId(req);
    return this.service.listImages(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 48) : 12,
      favorite === 'true',
      dateFrom,
      dateTo,
    );
  }

  @Get('images/:id/conversation')
  getImageConversation(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.service.getImageConversation(userId, id);
  }

  @Post('images/:id/edit')
  editImage(@Req() req: Request, @Param('id') id: string, @Body() dto: EditImageDto) {
    const userId = this.getUserId(req);
    return this.service.editImage(userId, id, dto);
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

  private getUserId(req: Request) {
    const user = req.user as RequestUser | undefined;
    const userId = user?.id ?? user?.sub;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  }
}
