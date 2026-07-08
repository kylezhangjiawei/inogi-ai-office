// 清理所有标题以 qa- 开头的残留测试任务（两池），直连 DB 最彻底
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");
const env = readFileSync(join(apiRoot, ".env"), "utf8");
process.env.DATABASE_URL = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
const prisma = new PrismaClient();

let removed = 0;
for (const key of ["rd.taskCategories", "rdws.us-collab.taskCategories"]) {
  const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  if (!row) continue;
  const cats = row.value;
  const strip = (tasks) => (tasks ?? []).filter((t) => {
    const isQa = String(t.title ?? "").startsWith("qa-");
    if (isQa) removed += 1;
    return !isQa;
  }).map((t) => ({ ...t, subtasks: strip(t.subtasks) }));
  for (const c of cats ?? []) for (const s of c.children ?? []) s.tasks = strip(s.tasks);
  await prisma.systemSetting.update({ where: { key }, data: { value: cats } });
}
console.log(`✓ 清理 qa- 残留任务 ${removed} 条`);
await prisma.$disconnect();
