import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { OssService } from '../oss/oss.service';
import { JwtPayload } from './strategies/jwt.strategy';

const REFRESH_TOKEN_TTL_DAYS = 30;
const ACCESS_TOKEN_TTL = '15m';

type AuthUserProfile = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  /** OSS 上头像的签名 URL（30 天 TTL），无头像时为 null */
  avatarUrl: string | null;
};

/** OSS 头像签名 URL 的有效期：30 天（与 KB 附件等其他场景对齐） */
const AVATAR_SIGNED_URL_TTL_SECONDS = 30 * 24 * 3600;
/** 头像图片大小上限：10MB（前端也校验，后端兜底） */
const AVATAR_MAX_SIZE = 10 * 1024 * 1024;
const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly secureConfigService: SecureConfigService,
    private readonly ossService: OssService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') ?? 'change-me-jwt-secret';
  }

  // ─── 头像 ────────────────────────────────────────────────────────────────

  /**
   * 上传头像到 OSS，写 avatarObjectKey 到 DB，返回新签名 URL。
   * 超管也允许（与超管"仅可改头像"策略一致）。
   */
  async uploadAvatar(userId: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number }) {
    if (!file?.buffer || file.size <= 0) {
      throw new BadRequestException('未上传头像图片');
    }
    if (file.size > AVATAR_MAX_SIZE) {
      throw new BadRequestException('头像图片不能超过 10MB');
    }
    if (!AVATAR_ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
      throw new BadRequestException('仅支持 jpg / png / webp / gif 格式');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }

    const objectKey = await this.ossService.uploadBuffer(
      file.buffer,
      `avatars/${userId}`,
      file.originalname,
      file.mimetype,
    );
    if (!objectKey) {
      throw new BadRequestException('OSS 未配置或上传失败，请联系管理员');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarObjectKey: objectKey },
    });

    return { avatarUrl: this.ossService.getSignedUrl(objectKey, AVATAR_SIGNED_URL_TTL_SECONDS) };
  }

  /** 重置头像（清空 DB 字段，下次 me 返回 avatarUrl=null） */
  async resetAvatar(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarObjectKey: null },
    });
    return { ok: true };
  }

  /** 把 avatarObjectKey 转成 30 天签名 URL；无值或 OSS 未配置返回 null */
  private buildAvatarUrl(avatarObjectKey: string | null): string | null {
    if (!avatarObjectKey) return null;
    return this.ossService.getSignedUrl(avatarObjectKey, AVATAR_SIGNED_URL_TTL_SECONDS);
  }

  getLoginSecurityPublicKey() {
    return {
      algorithm: 'RSA-OAEP',
      public_key: this.secureConfigService.getPublicKey(),
    };
  }

  async login(
    account: string,
    password?: string,
    encryptedPassword?: string,
  ) {
    const resolvedPassword = this.resolveLoginPassword(password, encryptedPassword);
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: account }, { email: account }] },
      include: { role: true },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('账号或密码错误');
    }
    if (user.status === 'DISABLED') {
      throw new UnauthorizedException('账号已被禁用');
    }

    const valid = await argon2.verify(user.passwordHash, resolvedPassword);
    if (!valid) {
      throw new UnauthorizedException('账号或密码错误');
    }

    return this.issueTokens(this.toAuthUserProfile(user));
  }

  async refresh(rawToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { token: rawToken } });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedException('Refresh token 无效或已过期');
    }

    await this.prisma.refreshToken.delete({ where: { id: stored.id } });

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { role: true },
    });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }

    return this.issueTokens(this.toAuthUserProfile(user));
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }

    return { user: this.toAuthUserProfile(user) };
  }

  async updateCurrentUser(
    userId: string,
    payload: { name?: string; email?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }

    if (this.isSuperAdminRole(user.role?.permissions)) {
      throw new ForbiddenException('超级管理员仅允许修改头像，名称、邮箱和密码不允许在个人中心修改');
    }

    const name = payload.name?.trim();
    const email = payload.email?.trim();
    if (!name) throw new BadRequestException('名称不能为空');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }

    if (email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('邮箱已被其他账号使用');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name, email },
      include: { role: true },
    });

    return { user: this.toAuthUserProfile(updated) };
  }

  async logout(rawToken: string, userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { token: rawToken, userId } });
    return { ok: true };
  }

  async setPassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }
    if (this.isSuperAdminRole(user.role?.permissions)) {
      throw new ForbiddenException('超级管理员密码不允许在个人中心修改');
    }
    if (!oldPassword || !oldPassword.trim()) {
      throw new BadRequestException('请输入当前密码');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('新密码至少需要 8 位');
    }
    if (!user.passwordHash) {
      throw new BadRequestException('当前账号暂未设置密码，请联系管理员');
    }
    const valid = await argon2.verify(user.passwordHash, oldPassword);
    if (!valid) {
      throw new BadRequestException('当前密码不正确');
    }
    const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return { ok: true };
  }

  private isSuperAdminRole(permissions: unknown): boolean {
    return Array.isArray(permissions) && (permissions as string[]).includes('*');
  }

  private async issueTokens(user: AuthUserProfile) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
      permissions: user.permissions,
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: ACCESS_TOKEN_TTL,
    });

    const rawRefresh = randomBytes(48).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    await this.prisma.refreshToken.create({
      data: { token: rawRefresh, userId: user.id, expiresAt },
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: 900,
      user,
    };
  }

  private toAuthUserProfile(user: {
    id: string;
    name: string;
    username?: string | null;
    email: string;
    roleId: string | null;
    avatarObjectKey?: string | null;
    role?: { name: string; permissions: unknown } | null;
  }): AuthUserProfile {
    return {
      id: user.id,
      name: user.name,
      username: user.username ?? null,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role?.name ?? null,
      permissions: Array.isArray(user.role?.permissions)
        ? (user.role.permissions as string[])
        : [],
      // 每次返回都现签 URL，30 天 TTL 内长期可用
      avatarUrl: this.buildAvatarUrl(user.avatarObjectKey ?? null),
    };
  }

  private resolveLoginPassword(password?: string, encryptedPassword?: string) {
    if (typeof encryptedPassword === 'string' && encryptedPassword.trim()) {
      try {
        return this.secureConfigService.decryptTransportValue(encryptedPassword.trim());
      } catch {
        throw new BadRequestException('登录密码加密数据无效');
      }
    }

    if (typeof password === 'string' && password.length > 0) {
      return password;
    }

    throw new BadRequestException('缺少登录密码');
  }
}
