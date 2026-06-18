import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * 按「登录用户」计数的限流守卫（替代默认按 IP 计数）。
 *
 * 背景：办公网常共用同一公网出口 IP（NAT），默认按 IP 限流会让全公司共享同一个
 * 100 次/60s 配额，多人同时使用研发驾驶舱等数据密集页面时极易被打满 → 附件/图片接口 429。
 * 改为按 user.id 计数后，每位登录用户各自独立配额；未登录请求（如登录接口）回退按 IP 计数，
 * 仍保留对暴力破解的防护。
 *
 * 注意：本守卫必须在 JwtAuthGuard 之后执行，req.user 才已就绪（见 app.module 守卫顺序）。
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.id;
    if (typeof userId === 'string' && userId) return `user:${userId}`;
    const ipFromList = Array.isArray(req?.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
    return ipFromList ?? req?.ip ?? 'unknown';
  }
}
