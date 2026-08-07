// Create or delete an isolated local account used by browser QA.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = readFileSync(join(apiRoot, ".env"), "utf8");
process.env.DATABASE_URL ||= env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing from apps/api/.env");

const databaseHost = (() => {
  try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ""; }
})();
if (!["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
  throw new Error(`Refusing browser QA account changes on non-local database host: ${databaseHost || "unknown"}`);
}

const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");
const prisma = new PrismaClient();

async function createAccount() {
  const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const username = `browser-qa-${suffix}`;
  const password = `Qa!${randomBytes(15).toString("base64url")}`;
  const role = await prisma.role.create({
    data: {
      name: `browser-qa-role-${suffix}`,
      description: "Temporary local browser QA role; delete after the test run.",
      permissions: ["*"],
    },
  });
  try {
    const user = await prisma.user.create({
      data: {
        name: "浏览器回归测试管理员",
        englishName: "Browser QA Administrator",
        username,
        email: `${username}@noemail.internal`,
        department: "QA",
        roleId: role.id,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    console.log(JSON.stringify({ userId: user.id, roleId: role.id, username, password }));
  } catch (error) {
    await prisma.role.delete({ where: { id: role.id } });
    throw error;
  }
}

async function deleteAccount(userId, roleId) {
  if (!userId || !roleId) throw new Error("Usage: qa-browser-user.mjs --delete <userId> <roleId>");
  const [deletedUsers, deletedRoles] = await prisma.$transaction([
    prisma.user.deleteMany({ where: { id: userId, username: { startsWith: "browser-qa-" } } }),
    prisma.role.deleteMany({ where: { id: roleId, name: { startsWith: "browser-qa-role-" } } }),
  ]);
  console.log(JSON.stringify({
    deleted: deletedUsers.count === 1 && deletedRoles.count === 1,
    deletedUsers: deletedUsers.count,
    deletedRoles: deletedRoles.count,
    userId,
    roleId,
  }));
}

try {
  if (process.argv[2] === "--delete") {
    await deleteAccount(process.argv[3], process.argv[4]);
  } else {
    await createAccount();
  }
} finally {
  await prisma.$disconnect();
}
