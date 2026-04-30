import { Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SaveUserDto } from './dto/save-user.dto';

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  department: true,
  status: true,
  roleId: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true, permissions: true } },
};

function isSuperAdminRole(permissions: unknown): boolean {
  return Array.isArray(permissions) && (permissions as string[]).includes('*');
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  async save(payload: SaveUserDto) {
    if (payload.id) {
      const existing = await this.prisma.user.findUnique({
        where: { id: payload.id },
        include: { role: true },
      });
      if (existing && isSuperAdminRole(existing.role?.permissions)) {
        throw new Error('超级管理员账号信息不允许修改');
      }

      return this.prisma.user.update({
        where: { id: payload.id },
        data: {
          name: payload.name,
          ...(payload.email ? { email: payload.email } : {}),
          username: payload.username ?? undefined,
          department: payload.department ?? undefined,
          roleId: payload.roleId ?? null,
          status: payload.status ?? 'ACTIVE',
        },
        select: USER_SELECT,
      });
    }

    // 未提供邮箱时自动生成唯一占位邮箱，避免 UNIQUE 约束冲突
    const email =
      payload.email?.trim() ||
      `u-${randomBytes(8).toString('hex')}@noemail.internal`;

    const createData: Parameters<typeof this.prisma.user.create>[0]['data'] = {
      name: payload.name,
      email,
      username: payload.username ?? undefined,
      department: payload.department ?? undefined,
      roleId: payload.roleId ?? null,
      status: payload.status ?? 'ACTIVE',
    };

    if (payload.password) {
      createData.passwordHash = await argon2.hash(payload.password, {
        type: argon2.argon2id,
      });
    }

    return this.prisma.user.create({ data: createData, select: USER_SELECT });
  }

  async updateStatus(id: string, status: 'ACTIVE' | 'DISABLED' | 'INVITED') {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    if (isSuperAdminRole(user.role?.permissions) && status === 'DISABLED') {
      throw new Error('超级管理员账号不允许被停用');
    }

    return this.prisma.user.update({
      where: { id },
      data: { status },
      select: USER_SELECT,
    });
  }

  /**
   * 重置用户密码。
   * isSelf = true 时跳过超管身份校验（允许超管自行修改密码）。
   * isSelf = false 时禁止修改超管账号密码。
   */
  async adminResetPassword(id: string, newPassword: string, isSelf = false) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    if (!isSelf && isSuperAdminRole(user.role?.permissions)) {
      throw new Error('超级管理员账号密码不允许被其他人修改');
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { ok: true };
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');

    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
