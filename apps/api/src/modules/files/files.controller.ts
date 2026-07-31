import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

import { AbortFileUploadDto, PresignFileUploadDto, RegisterFileUploadDto } from './dto/direct-file-upload.dto';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';

type RequestUser = { id?: string; sub?: string };

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Req() req: Request,
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string; size: number } | undefined,
    @Body() dto: UploadFileDto,
  ) {
    const userId = this.getUserId(req);
    if (!file) throw new BadRequestException('未上传文件');
    return this.filesService.uploadFile(userId, file, dto.businessType, dto.businessId);
  }

  @Post('presign-upload')
  presignUpload(@Req() req: Request, @Body() dto: PresignFileUploadDto) {
    return this.filesService.presignUpload(this.getUserId(req), dto);
  }

  @Post('register-upload')
  registerUpload(@Req() req: Request, @Body() dto: RegisterFileUploadDto) {
    return this.filesService.registerUpload(this.getUserId(req), dto);
  }

  @Post('abort-upload')
  abortUpload(@Req() req: Request, @Body() dto: AbortFileUploadDto) {
    return this.filesService.abortUpload(this.getUserId(req), dto);
  }

  @Get(':id/signed-url')
  async getSignedUrl(@Req() req: Request, @Param('id') fileId: string) {
    const userId = this.getUserId(req);
    return this.filesService.getSignedUrl(userId, fileId);
  }

  @Delete(':id')
  async deleteFile(@Req() req: Request, @Param('id') fileId: string) {
    const userId = this.getUserId(req);
    return this.filesService.deleteFile(userId, fileId);
  }

  private getUserId(req: Request): string {
    const user = req.user as RequestUser | undefined;
    const userId = user?.id ?? user?.sub;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }
}
