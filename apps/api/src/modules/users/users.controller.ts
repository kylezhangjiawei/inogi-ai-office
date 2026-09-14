import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { SaveUserDto } from './dto/save-user.dto';
import { UsersService } from './users.service';

type AuthedRequest = { user: { id: string; permissions: string[] } };

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('page:users')
  list() {
    return this.usersService.list();
  }

  @Get(':id')
  @Permissions('page:users')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @Permissions('user:create', 'user:edit')
  save(@Body() payload: SaveUserDto, @Request() req: AuthedRequest) {
    return this.usersService.save(payload, req.user);
  }

  @Patch(':id/status')
  @Permissions('user:disable')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'DISABLED' | 'INVITED' },
  ) {
    return this.usersService.updateStatus(id, body.status);
  }

  /**
   * 重置密码。
   * 管理重置始终需要专项权限；普通用户通过 /auth/me/password 校验旧密码后改密。
   */
  @Post(':id/reset-password')
  resetPassword(
    @Param('id') id: string,
    @Body() body: { newPassword: string },
    @Request() req: AuthedRequest,
  ) {
    const isSelf = req.user.id === id;
    const hasAdminPerm =
      req.user.permissions.includes('*') ||
      req.user.permissions.includes('user:reset-password');

    if (!hasAdminPerm) {
      throw new ForbiddenException('无密码重置权限，请在个人中心验证当前密码后修改');
    }

    return this.usersService.adminResetPassword(id, body.newPassword, isSelf);
  }

  @Delete(':id')
  @Permissions('user:delete')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
