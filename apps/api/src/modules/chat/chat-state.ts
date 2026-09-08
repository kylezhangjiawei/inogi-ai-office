import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/** 短事务中的数据库锁：协调多个实例的同一份聊天状态；锁内不得调用外部模型。 */
export function withChatStateLock<T>(
  prisma: PrismaService,
  key: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`matechat:${key}`}))`;
    return run(tx);
  });
}
