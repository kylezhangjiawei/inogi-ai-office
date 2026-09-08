import { BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { shanghaiDayStart } from './chat-streak.service';
import { withChatStateLock } from './chat-state';

type Modality = 'image' | 'video';
type Reservation = { id: string; refId?: string };
type Ledger = { day: string; entries: Reservation[] };

export class ChatMediaQuotaExceeded extends BadRequestException {
  constructor(modality: Modality) {
    super(`今日${modality === 'image' ? '生图' : '生视频'}额度已用完（含正在执行的请求），请明天再试。`);
  }
}

/** 配额预占持久化，模型/媒体调用在事务外执行；不同实例也不能重复拿到最后一个额度。 */
export class ChatMediaQuota {
  private readonly logger = new Logger(ChatMediaQuota.name);
  constructor(private readonly prisma: PrismaService) {}

  private key(userId: string, modality: Modality): string {
    return `chat.mediaQuota:${modality}:${userId}`;
  }

  private async read(tx: Pick<Prisma.TransactionClient, 'systemSetting'>, key: string, day: string): Promise<Ledger> {
    const row = await tx.systemSetting.findUnique({ where: { key }, select: { value: true } });
    const value = row?.value as Ledger | undefined;
    return value?.day === day && Array.isArray(value.entries)
      ? value
      : { day, entries: [] };
  }

  private async count(tx: Pick<Prisma.TransactionClient, 'aiUsageLog'>, userId: string, modality: Modality, start: Date, ledger: Ledger): Promise<number> {
    const refIds = ledger.entries.flatMap((entry) => entry.refId ? [entry.refId] : []);
    // 成功请求即使尚未异步写入用量，也占额度；用量入账后按业务 id 排除，不能重复计数。
    const otherUsage = await tx.aiUsageLog.count({
      where: {
        userId, modality, createdAt: { gte: start },
        ...(refIds.length ? { OR: [{ refId: null }, { refId: { notIn: refIds } }] } : {}),
      },
    });
    return otherUsage + ledger.entries.length;
  }

  async usage(userId: string, modality: Modality): Promise<number> {
    const start = shanghaiDayStart(new Date());
    const ledger = await this.read(this.prisma, this.key(userId, modality), start.toISOString());
    return this.count(this.prisma, userId, modality, start, ledger);
  }

  async run<T extends { id?: unknown }>(userId: string, modality: Modality, limit: number, operation: () => Promise<T>): Promise<T> {
    const key = this.key(userId, modality);
    const start = shanghaiDayStart(new Date());
    const day = start.toISOString();
    const id = randomUUID();
    await withChatStateLock(this.prisma, key, async (tx) => {
      const ledger = await this.read(tx, key, day);
      if (await this.count(tx, userId, modality, start, ledger) >= limit) throw new ChatMediaQuotaExceeded(modality);
      ledger.entries.push({ id });
      await tx.systemSetting.upsert({
        where: { key },
        create: { key, category: 'matechat', value: ledger as unknown as Prisma.InputJsonValue },
        update: { value: ledger as unknown as Prisma.InputJsonValue },
      });
    });

    const settle = async (refId: string | undefined, failed: boolean) => {
      try {
        await withChatStateLock(this.prisma, key, async (tx) => {
          const ledger = await this.read(tx, key, day);
          const entry = ledger.entries.find((entry) => entry.id === id);
          if (!entry) return; // 已跨自然日，不能用昨天的完成结果覆盖今天的额度。
          if (failed) ledger.entries = ledger.entries.filter((entry) => entry.id !== id);
          else if (refId) entry.refId = refId;
          await tx.systemSetting.upsert({
            where: { key }, create: { key, category: 'matechat', value: ledger as unknown as Prisma.InputJsonValue },
            update: { value: ledger as unknown as Prisma.InputJsonValue },
          });
        });
      } catch (error) {
        // 不把已生成的结果变成失败重试；结算失败时保留预占，成本控制保守关闭。
        this.logger.warn(`媒体额度结算失败，保留预占: ${error instanceof Error ? error.message : error}`);
      }
    };

    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await settle(undefined, true);
      throw error;
    }
    await settle(typeof result.id === 'string' ? result.id : undefined, false);
    return result;
  }
}
