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
} from '@nestjs/common';
import { Request } from 'express';

import { GenerateImageDto } from './dto/generate-image.dto';
import { ImageGenerationService } from './image-generation.service';

@Controller('image-generation')
export class ImageGenerationController {
  constructor(private readonly service: ImageGenerationService) {}

  @Post('generate')
  generate(@Req() req: Request, @Body() dto: GenerateImageDto) {
    const userId = (req.user as { sub: string }).sub;
    return this.service.generate(userId, dto);
  }

  @Get('images')
  listImages(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('favorite') favorite?: string,
  ) {
    const userId = (req.user as { sub: string }).sub;
    return this.service.listImages(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? Math.min(parseInt(pageSize, 10), 48) : 12,
      favorite === 'true',
    );
  }

  @Patch('images/:id/favorite')
  toggleFavorite(@Req() req: Request, @Param('id') id: string) {
    const userId = (req.user as { sub: string }).sub;
    return this.service.toggleFavorite(id, userId);
  }

  @Delete('images/:id')
  deleteImage(@Req() req: Request, @Param('id') id: string) {
    const userId = (req.user as { sub: string }).sub;
    return this.service.deleteImage(id, userId);
  }
}
