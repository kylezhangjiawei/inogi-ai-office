/** 模拟数据库事务锁、提交与回滚；多个服务实例共享此存储，不连接真实数据库。 */
export function fakeChatState() {
  const settings = new Map<string, any>();
  const locks = new Map<string, Promise<void>>();
  const usage: Array<{ userId: string; modality: string; refId: string | null; createdAt: Date }> = [];
  let activeTransactions = 0;
  const database = {
    settings, usage, activeTransactions: () => activeTransactions,
    systemSetting: {
      findUnique: async ({ where }: any) => settings.has(where.key) ? { value: structuredClone(settings.get(where.key)) } : null,
    },
    aiUsageLog: {
      count: async ({ where }: any) => usage.filter((row) =>
        row.userId === where.userId && row.modality === where.modality && row.createdAt >= where.createdAt.gte
        && (!where.OR || row.refId === null || !where.OR[1].refId.notIn.includes(row.refId)),
      ).length,
    },
    $transaction: async (run: (tx: any) => Promise<unknown>) => {
      const writes = new Map<string, any>();
      let release: (() => void) | undefined;
      const tx = {
        $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
          const previous = locks.get(key) ?? Promise.resolve();
          const lock = new Promise<void>((resolve) => { release = resolve; });
          locks.set(key, previous.then(() => lock));
          await previous;
          activeTransactions += 1;
        },
        systemSetting: {
          findUnique: async ({ where }: any) => {
            const value = writes.has(where.key) ? writes.get(where.key) : settings.get(where.key);
            return value === undefined ? null : { value: structuredClone(value) };
          },
          upsert: async ({ where, create, update }: any) => {
            const exists = settings.has(where.key) || writes.has(where.key);
            writes.set(where.key, structuredClone((exists ? update : create).value));
            return {};
          },
        },
        aiUsageLog: database.aiUsageLog,
      };
      try {
        const result = await run(tx);
        for (const [key, value] of writes) settings.set(key, value);
        return result;
      } finally {
        if (release) { activeTransactions -= 1; release(); }
      }
    },
  };
  return database;
}
