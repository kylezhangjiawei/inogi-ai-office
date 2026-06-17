import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
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
  /**
   * 头像签名 URL。永不为 null（除非 OSS 未配置/预置库为空）：
   * 未设自定义头像时按 user_id 稳定派发预置库里的一张默认头像。
   */
  avatarUrl: string | null;
  /** 是否设过自定义头像（avatarObjectKey 非空）。false 表示当前展示的是自动派发的默认头像。 */
  hasCustomAvatar: boolean;
};

/** OSS 头像签名 URL 的有效期：30 天（与 KB 附件等其他场景对齐） */
const AVATAR_SIGNED_URL_TTL_SECONDS = 30 * 24 * 3600;
/** 预置头像 key 列表的内存缓存有效期：10 分钟（管理员极少增删预置图）。 */
const AVATAR_PRESET_CACHE_TTL_MS = 10 * 60 * 1000;
/**
 * 预置库列举为空/失败时的冷却窗口：60 秒。
 * 防止 OSS 异常或预置库为空时，登录 / /me 等高频鉴权路径每次都重打一遍 OSS 列举。
 */
const AVATAR_PRESET_EMPTY_COOLDOWN_MS = 60 * 1000;
/** 头像图片大小上限：10MB（前端也校验，后端兜底） */
const AVATAR_MAX_SIZE = 10 * 1024 * 1024;
const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** 预置头像库在 OSS 上的相对前缀（完整前缀 = prod/avatars/presets/）。管理员手动上传到此目录。 */
const AVATAR_PRESET_PREFIX = 'avatars/presets/';
/** key 是否指向预置头像库（决定签名时是否套缩放处理）。 */
const AVATAR_IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
/**
 * 预置头像被设为正式头像后的图片处理参数：等比缩放到 256px + 转 webp。
 * 预置原图最大可达 ~15MB，若不处理会被全站（驾驶舱等）按原图加载，故必须压。
 * 仅对预置 key 生效，用户自传头像保持原样（避免动图 gif 被转静态）。
 */
const PRESET_AVATAR_PROCESS = 'image/resize,m_lfit,w_256/format,webp/quality,q_85';
/** 预置头像库网格缩略图：更小，列表加载更快。 */
const PRESET_THUMB_PROCESS = 'image/resize,m_lfit,w_160/format,webp/quality,q_80';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly jwtSecret: string;
  /** 预置头像 key 列表的内存缓存（用于给无头像用户稳定派发默认头像，避免每次请求都列 OSS）。 */
  private presetAvatarKeys: string[] = [];
  private presetAvatarKeysExpiresAt = 0;
  /** 进行中的列举 Promise，去重并发刷新（启动预热 + 首批请求共用一次 OSS 调用）。 */
  private presetLoadPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly secureConfigService: SecureConfigService,
    private readonly ossService: OssService,
  ) {
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') ?? 'change-me-jwt-secret';
  }

  onModuleInit() {
    // 启动即后台预热预置头像缓存，使首批登录 / /me 在鉴权路径上无需等待 OSS。
    void this.loadPresetAvatarKeys();
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

  /**
   * 返回所有「未禁用」用户的签名头像 URL，供驾驶舱等多用户界面按 user_id / 姓名解析
   * 「他人」头像（/auth/me 只返回当前用户自己的头像）。
   * 无自定义头像的用户也返回——按 user_id 稳定派发的默认头像，保证全站头像不缺位。
   * 仅暴露 id / name / 头像 URL，不含敏感信息；任意登录用户可读。
   */
  async listUserAvatars(): Promise<Array<{ id: string; name: string; avatarUrl: string }>> {
    await this.refreshPresetAvatarKeysIfStale();
    const users = await this.prisma.user.findMany({
      where: { status: { not: 'DISABLED' } },
      select: { id: true, name: true, avatarObjectKey: true },
    });
    const out: Array<{ id: string; name: string; avatarUrl: string }> = [];
    for (const u of users) {
      const url = this.buildAvatarUrl(u.id, u.avatarObjectKey ?? null);
      if (url) out.push({ id: u.id, name: u.name, avatarUrl: url });
    }
    return out;
  }

  /**
   * 列出预置头像库（OSS prod/avatars/presets/ 下的全部图片），返回缩略图签名 URL。
   * 任意登录用户可读，用于个人中心「默认头像」选择网格。
   */
  async listAvatarPresets(): Promise<Array<{ key: string; url: string }>> {
    await this.refreshPresetAvatarKeysIfStale();
    const out: Array<{ key: string; url: string }> = [];
    for (const key of this.presetAvatarKeys) {
      const url = this.ossService.getSignedUrl(key, AVATAR_SIGNED_URL_TTL_SECONDS, PRESET_THUMB_PROCESS);
      if (url) out.push({ key, url });
    }
    return out;
  }

  /**
   * 选择某个预置头像作为正式头像：把 avatarObjectKey 设成该预置 key。
   * 严格校验 key 必须属于预置库前缀且确实存在，杜绝把任意 OSS 对象设成头像。
   */
  async setAvatarPreset(userId: string, presetKey: string) {
    const key = (presetKey ?? '').trim();
    const fullPrefix = this.ossService.resolveKeyPrefix(AVATAR_PRESET_PREFIX);
    if (!key || !key.startsWith(fullPrefix) || key.includes('..')) {
      throw new BadRequestException('无效的头像选项');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status === 'DISABLED') {
      throw new UnauthorizedException();
    }

    const validKeys = await this.ossService.listObjects(fullPrefix);
    if (!validKeys.includes(key)) {
      throw new BadRequestException('头像选项不存在');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarObjectKey: key },
    });

    return { avatarUrl: this.buildAvatarUrl(userId, key) };
  }

  /**
   * 刷新预置头像 key 缓存（懒加载，10 分钟有效）。OSS 列举失败时**保留旧缓存**，
   * 避免一次网络抖动让全站默认头像集体消失。
   */
  private async refreshPresetAvatarKeysIfStale(): Promise<void> {
    if (Date.now() < this.presetAvatarKeysExpiresAt) return;
    if (this.presetAvatarKeys.length) {
      // 有旧缓存：乐观顺延有效期（兼作并发去重），后台刷新，**绝不阻塞**鉴权路径（stale-while-revalidate）。
      this.presetAvatarKeysExpiresAt = Date.now() + AVATAR_PRESET_CACHE_TTL_MS;
      void this.loadPresetAvatarKeys();
      return;
    }
    // 冷启动且暂无缓存：等待一次，否则首批用户拿不到默认头像。
    await this.loadPresetAvatarKeys();
  }

  /** 实际列举 OSS 预置库并刷新缓存；用 presetLoadPromise 去重并发调用。空/失败保留旧缓存并设短冷却。 */
  private loadPresetAvatarKeys(): Promise<void> {
    if (this.presetLoadPromise) return this.presetLoadPromise;
    this.presetLoadPromise = (async () => {
      const fullPrefix = this.ossService.resolveKeyPrefix(AVATAR_PRESET_PREFIX);
      const keys = (await this.ossService.listObjects(fullPrefix)).filter((k) => AVATAR_IMAGE_EXT.test(k));
      if (keys.length) {
        this.presetAvatarKeys = keys;
        this.presetAvatarKeysExpiresAt = Date.now() + AVATAR_PRESET_CACHE_TTL_MS;
      } else {
        // 空/失败：保留旧缓存（一次抖动不致全站默认头像消失），但设短冷却避免反复重打 OSS。
        this.presetAvatarKeysExpiresAt = Date.now() + AVATAR_PRESET_EMPTY_COOLDOWN_MS;
      }
    })().finally(() => { this.presetLoadPromise = null; });
    return this.presetLoadPromise;
  }

  /**
   * 按 user_id 稳定哈希映射到预置库里的一张（同一用户恒定、跨用户近似随机分布）。
   * 缓存为空（OSS 未配置/无预置图）时返回 null → 上层回退文字首字母。
   */
  private defaultAvatarKeyFor(userId: string): string | null {
    const keys = this.presetAvatarKeys;
    if (!keys.length) return null;
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) >>> 0;
    return keys[h % keys.length];
  }

  /**
   * 把头像 key 转成 30 天签名 URL。avatarObjectKey 为空时按 user_id 派发默认预置头像。
   * 预置头像（presets/ 前缀，含默认派发）额外套缩放处理，避免原图过大被全站加载；
   * 用户自传头像保持原样。调用前需先 await refreshPresetAvatarKeysIfStale() 暖好缓存。
   */
  private buildAvatarUrl(userId: string, avatarObjectKey: string | null): string | null {
    const key = avatarObjectKey ?? this.defaultAvatarKeyFor(userId);
    if (!key) return null;
    const presetPrefix = this.ossService.resolveKeyPrefix(AVATAR_PRESET_PREFIX);
    const process = key.startsWith(presetPrefix) ? PRESET_AVATAR_PROCESS : undefined;
    return this.ossService.getSignedUrl(key, AVATAR_SIGNED_URL_TTL_SECONDS, process);
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

    await this.refreshPresetAvatarKeysIfStale();
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

    await this.refreshPresetAvatarKeysIfStale();
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

    await this.refreshPresetAvatarKeysIfStale();
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

    await this.refreshPresetAvatarKeysIfStale();
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
      // 每次返回都现签 URL，30 天 TTL 内长期可用；无自定义头像时按 user_id 派发默认预置头像
      avatarUrl: this.buildAvatarUrl(user.id, user.avatarObjectKey ?? null),
      hasCustomAvatar: Boolean(user.avatarObjectKey),
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
