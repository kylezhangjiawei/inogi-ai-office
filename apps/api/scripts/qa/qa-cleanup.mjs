// 清理研发/协同 API QA 套件产生的测试任务及派生记录。默认只干跑，--apply 才写库。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQaArtifactCleanupUpdates, QA_CLEANUP_KEYS, qaCleanupTotal } from "./qa-artifact-cleanup.mjs";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = readFileSync(join(apiRoot, ".env"), "utf8");
process.env.DATABASE_URL ||= env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!process.env.DATABASE_URL) throw new Error("apps/api/.env 中未找到 DATABASE_URL");

const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ""; }
})();
if (process.env.ALLOW_QA_CLEANUP !== "1" && !["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
  throw new Error(`拒绝清理：当前数据库主机为「${databaseHost || "未知"}」，仅允许本地测试库。`);
}

const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function inspect(client) {
  const rows = await client.systemSetting.findMany({
    where: { key: { in: QA_CLEANUP_KEYS } },
    select: { key: true, value: true, description: true },
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return { rows, ...buildQaArtifactCleanupUpdates(values) };
}

async function main() {
  const preview = await inspect(prisma);
  console.log(`${APPLY ? "应用" : "干跑"} QA 残留清理计划：`);
  console.log(JSON.stringify(preview.summary, null, 2));
  if (!APPLY) {
    console.log("未修改数据库。确认范围后使用 --apply，执行时会先建立完整可恢复快照。");
    return;
  }
  if (qaCleanupTotal(preview.summary) === 0) {
    console.log("没有 QA 测试残留，跳过写入。");
    return;
  }
  const backupKey = `maintenance.backup.rd-qa-artifact-cleanup.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await prisma.$transaction(async (tx) => {
    const current = await inspect(tx);
    if (JSON.stringify(current.summary) !== JSON.stringify(preview.summary)) {
      throw new Error("干跑后数据库内容发生变化，已中止。请重新执行确认范围。");
    }
    await tx.systemSetting.create({
      data: {
        category: "maintenance-backup",
        key: backupKey,
        description: "研发 API QA 残留清理前的可恢复快照",
        value: {
          created_at: new Date().toISOString(),
          summary: current.summary,
          settings: Object.fromEntries(current.rows.map((row) => [row.key, {
            value: row.value,
            description: row.description,
          }])),
        },
      },
    });
    for (const [key, value] of Object.entries(current.updates)) {
      await tx.systemSetting.update({ where: { key }, data: { value } });
    }
  });
  console.log(`✓ QA 残留已清理。可恢复备份：${backupKey}`);
}

main()
  .catch((error) => {
    console.error(`清理失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
