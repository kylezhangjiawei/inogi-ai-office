import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { JwtPayload } from './strategies/jwt.strategy';

const REFRESH_TOKEN_TTL_DAYS = 30;
const ACCESS_TOKEN_TTL = '15m';

type AuthUserProfile = {
  id: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
};

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly secureConfigService: SecureConfigService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') ?? 'change-me-jwt-secret';
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

  async logout(rawToken: string, userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { token: rawToken, userId } });
    return { ok: true };
  }

  async setPassword(userId: string, newPassword: string) {
    const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return { ok: true };
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
    email: string;
    roleId: string | null;
    role?: { name: string; permissions: unknown } | null;
  }): AuthUserProfile {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role?.name ?? null,
      permissions: Array.isArray(user.role?.permissions)
        ? (user.role.permissions as string[])
        : [],
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
