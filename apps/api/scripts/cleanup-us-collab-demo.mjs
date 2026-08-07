import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoCleanupUpdates } from "./lib/us-collab-demo-cleanup.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(__dirname, "..");
const APPLY = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  const env = readFileSync(join(apiRoot, ".env"), "utf8");
  process.env.DATABASE_URL = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
}
if (!process.env.DATABASE_URL) throw new Error("apps/api/.env 中未找到 DATABASE_URL");

const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ""; }
})();
const isLocalDatabase = ["localhost", "127.0.0.1", "::1"].includes(databaseHost);
if (process.env.ALLOW_DEMO_CLEANUP !== "1" && (!isLocalDatabase || process.env.NODE_ENV === "production")) {
  throw new Error(`拒绝清理：当前数据库主机为「${databaseHost || "未知"}」。仅允许本地测试库，特殊情况需显式设置 ALLOW_DEMO_CLEANUP=1。`);
}

const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const SETTING_KEYS = [
  "rdws.us-collab.taskCategories",
  "rdws.us-collab.people",
  "rdws.us-collab.taskProgressNotes",
  "rdws.us-collab.dailyReports",
  "rdws.us-collab.noteReads",
  "rdws.us-collab.knowledgeEntries",
  "rdws.us-collab.auditLogs",
  "rd.messages",
  "rdws.us-collab.directorDashboard",
];

async function inspect(client) {
  const rows = await client.systemSetting.findMany({
    where: { key: { in: SETTING_KEYS } },
    select: { key: true, value: true, description: true },
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const cleanup = buildDemoCleanupUpdates(values);
  const discussionThreads = await client.rdTaskDiscussionThread.findMany({
    where: { OR: [{ taskId: { startsWith: "ustask-" } }, { taskId: { startsWith: "pzdemo-" } }] },
    select: { id: true, workspace: true, taskId: true },
  });
  return { rows, ...cleanup, discussionThreads };
}

async function main() {
  const preview = await inspect(prisma);
  console.log(`${APPLY ? "应用" : "干跑"}清理计划：`);
  console.log(JSON.stringify({ ...preview.summary, discussionThreads: preview.discussionThreads.length }, null, 2));

  if (preview.discussionThreads.length > 0) {
    throw new Error("发现演示任务讨论线程。为避免不可恢复地删除关系数据，本脚本拒绝继续，请先人工核查。");
  }
  if (!APPLY) {
    console.log("未修改数据库。确认范围后使用 --apply 执行；执行时会先在数据库内创建完整备份。");
    return;
  }
  if (preview.summary.tasks === 0 && preview.summary.people === 0) {
    console.log("没有待清理的演示任务或演示人员，跳过写入。");
    return;
  }

  const backupKey = `maintenance.backup.us-collab-demo-cleanup.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await prisma.$transaction(async (tx) => {
    const current = await inspect(tx);
    if (JSON.stringify(current.summary) !== JSON.stringify(preview.summary)) {
      throw new Error("干跑后数据库内容发生变化，已中止。请重新执行干跑确认范围。");
    }
    await tx.systemSetting.create({
      data: {
        category: "maintenance-backup",
        key: backupKey,
        description: "执行协同演示数据清理前的可恢复快照",
        value: {
          created_at: new Date().toISOString(),
          reason: "Remove us-collab demo people/tasks and dependent records",
          summary: current.summary,
          settings: Object.fromEntries(current.rows.map((row) => [row.key, {
            value: row.value,
            description: row.description,
          }])),
        },
      },
    });
    for (const [key, value] of Object.entries(current.updates)) {
      const exists = current.rows.some((row) => row.key === key);
      if (!exists) continue;
      await tx.systemSetting.update({
        where: { key },
        data: {
          value,
          ...(["rdws.us-collab.people", "rdws.us-collab.taskProgressNotes"].includes(key)
            ? { description: `R&D module data store: ${key}` }
            : {}),
        },
      });
    }
  });
  console.log(`✓ 清理完成。可恢复备份：${backupKey}`);
}

main()
  .catch((error) => {
    console.error(`清理失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
