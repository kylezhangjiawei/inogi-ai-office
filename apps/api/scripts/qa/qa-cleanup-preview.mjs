// Read-only inventory of artifacts left by the R&D API QA suite.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQaArtifactCleanupUpdates, QA_CLEANUP_KEYS } from "./qa-artifact-cleanup.mjs";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = readFileSync(join(apiRoot, ".env"), "utf8");
process.env.DATABASE_URL ||= env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing from apps/api/.env");

const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ""; }
})();
if (!["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
  throw new Error(`Refusing to inspect non-local database host: ${databaseHost || "unknown"}`);
}

const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

try {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: QA_CLEANUP_KEYS } },
    select: { key: true, value: true },
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const { summary } = buildQaArtifactCleanupUpdates(values);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prisma.$disconnect();
}
