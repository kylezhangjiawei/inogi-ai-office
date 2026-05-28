import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

type UploadedAvatarFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('security/public-key')
  getLoginPublicKey() {
    return this.authService.getLoginSecurityPublicKey();
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.account, dto.password, dto.encryptedPassword);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  me(@Request() req: { user: { id: string } }) {
    return this.authService.getCurrentUser(req.user.id);
  }

  @Patch('me')
  updateMe(
    @Request() req: { user: { id: string } },
    @Body() body: { name?: string; email?: string },
  ) {
    return this.authService.updateCurrentUser(req.user.id, body);
  }

  @Post('logout')
  logout(
    @Request() req: { user: { id: string } },
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.logout(dto.refreshToken, req.user.id);
  }

  @Post('me/password')
  setPassword(
    @Request() req: { user: { id: string } },
    @Body('oldPassword') oldPassword: string,
    @Body('newPassword') newPassword: string,
  ) {
    return this.authService.setPassword(req.user.id, oldPassword, newPassword);
  }

  /**
   * 上传当前用户头像到 OSS。前端用 FormData：字段名 `file`。
   * 超管也允许（截图里说"仅可改头像"），所以不走 updateMe 的超管拦截。
   */
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @Request() req: { user: { id: string } },
    @UploadedFile() file: UploadedAvatarFile,
  ) {
    if (!file) throw new BadRequestException('请选择头像图片');
    return this.authService.uploadAvatar(req.user.id, file);
  }

  /** 重置头像（清空 avatarObjectKey） */
  @Delete('me/avatar')
  resetAvatar(@Request() req: { user: { id: string } }) {
    return this.authService.resetAvatar(req.user.id);
  }
}
