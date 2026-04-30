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
  save(@Body() payload: SaveUserDto) {
    return this.usersService.save(payload);
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
   * - 用户可随时修改自己的密码（无需额外权限）。
   * - 修改他人密码需要 user:reset-password 权限。
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

    if (!isSelf && !hasAdminPerm) {
      throw new ForbiddenException('无权限修改其他用户的密码');
    }

    return this.usersService.adminResetPassword(id, body.newPassword, isSelf);
  }

  @Delete(':id')
  @Permissions('user:delete')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
