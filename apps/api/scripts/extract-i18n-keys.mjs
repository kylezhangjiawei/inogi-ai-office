// 扫描前端源码里的 t("中文", ...) 字面量，把 key 全集登记到后端（PUT /api/i18n/keys）。
// 每次 P1 铺量后重跑一次；管理页「缺失英文」清单与 AI 初翻输入都来自这份登记。
// 用法：node apps/api/scripts/extract-i18n-keys.mjs [--dry]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiRoot, "..", "..");
const srcRoot = join(repoRoot, "src", "app");

const env = readFileSync(join(apiRoot, ".env"), "utf8");
const envValue = (name) => env.match(new RegExp(`^${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"))?.[1]?.trim();
const SECRET = envValue("JWT_SECRET") ?? "change-me-jwt-secret";
const BASE = process.env.API_BASE ?? "http://localhost:3000/api";
const dry = process.argv.includes("--dry");
let TOKEN = "";

if (!dry) {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = envValue("DATABASE_URL");
  const require = createRequire(join(apiRoot, "package.json"));
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const actorCandidates = [
    envValue("SEED_ADMIN_EMAIL") ? { email: envValue("SEED_ADMIN_EMAIL") } : null,
    envValue("SEED_ADMIN_USERNAME") ? { username: envValue("SEED_ADMIN_USERNAME") } : null,
  ].filter(Boolean);
  if (actorCandidates.length === 0) throw new Error("apps/api/.env 中未配置 SEED_ADMIN_EMAIL 或 SEED_ADMIN_USERNAME");
  const actor = await prisma.user.findFirst({
    where: { status: "ACTIVE", OR: actorCandidates },
    include: { role: true },
  });
  await prisma.$disconnect();
  if (!actor) throw new Error("找不到可用于登记翻译 key 的启用管理员账号");

  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: actor.id,
    email: actor.email,
    roleId: actor.roleId,
    permissions: Array.isArray(actor.role?.permissions) ? actor.role.permissions : [],
    iat: now,
    exp: now + 3600,
  });
  TOKEN = `${head}.${payload}.${createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url")}`;
}

/** 匹配 t/translate 的字面量调用（无 ${} 插值的模板串）。含 {n} 占位符的模板 key 原样提取。 */
const CALL_RE = /\b(?:t|translate)\(\s*(?:"((?:[^"\\]|\\.)+)"|'((?:[^'\\]|\\.)+)'|`((?:[^`\\$]|\\.)+)`)/g;

/** 按 JavaScript 字符串字面量语义解码转义，保证 `\n` 等 key 与运行时传给 t() 的值一致。 */
function decodeJsString(raw) {
  let result = "";
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== "\\") {
      result += raw[i];
      continue;
    }
    const next = raw[++i];
    if (next == null) {
      result += "\\";
      break;
    }
    const simple = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", 0: "\0" };
    if (next in simple) {
      result += simple[next];
    } else if (next === "u") {
      if (raw[i + 1] === "{") {
        const close = raw.indexOf("}", i + 2);
        const hex = close >= 0 ? raw.slice(i + 2, close) : "";
        if (hex && /^[0-9a-f]+$/i.test(hex)) {
          result += String.fromCodePoint(Number.parseInt(hex, 16));
          i = close;
        } else {
          result += "u";
        }
      } else {
        const hex = raw.slice(i + 1, i + 5);
        if (/^[0-9a-f]{4}$/i.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else {
          result += "u";
        }
      }
    } else if (next === "x") {
      const hex = raw.slice(i + 1, i + 3);
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        result += String.fromCharCode(Number.parseInt(hex, 16));
        i += 2;
      } else {
        result += "x";
      }
    } else if (next === "\n") {
      // JavaScript 行续接：反斜杠 + 换行不进入字符串值。
    } else if (next === "\r" && raw[i + 1] === "\n") {
      i += 1;
    } else {
      result += next;
    }
  }
  return result;
}

/**
 * 不参与翻译登记的文件。
 * ManualPage.tsx：操作手册正文当前锁中文，它的 `t` 是文件内的恒等函数、不查字典（原因见该文件顶部）。
 * 语法上仍是 t("中文") 会被本脚本正则命中，登记进去会让翻译管理页凭空多出几百条「缺失英文」，
 * 淹掉真正待翻的条目。内容定稿要做英文时，把这条移除即可。
 */
const SKIP_FILES = new Set(["ManualPage.tsx"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      yield* walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !SKIP_FILES.has(name)) {
      yield full;
    }
  }
}

/** 模块归属：文件相对 src/app 的首段/文件名（管理页按模块过滤用） */
function moduleOf(file) {
  const rel = relative(srcRoot, file).replace(/\\/g, "/");
  const base = rel.split("/").pop().replace(/\.(tsx?|jsx?)$/, "");
  return rel.startsWith("components/") ? `components/${base}` : base;
}

const keys = {};
let files = 0;

// 专项：动态 t(x.label) 消费的常量表——正则抓不到调用点，从定义源提取
// 1) routesConfig 菜单/分组 label；2) auditLog 动作 verb（时间线动词）；
// 3) RDAuditTimeline 字段/值标签表（FIELD_LABELS / VALUE_LABELS）
{
  const sources = [
    { file: "routesConfig.tsx", module: "routesConfig", re: /label:\s*"([^"]+)"/g },
    { file: "lib/auditLog.ts", module: "auditLog", re: /verb:\s*"([^"]+)"/g },
    { file: "lib/auditLog.ts", module: "auditLog", re: /label:\s*"([^"]+)"/g },
    { file: "RDAuditTimeline.tsx", module: "RDAuditTimeline", re: /^\s+[\w.]+:\s*"([^"]+)",\s*$/gm },
    // 4) MessageCenterPage filterLabels 常量表 + 统计卡 label（渲染点是 t(变量)）
    { file: "MessageCenterPage.tsx", module: "MessageCenterPage", re: /(?:all|unread|review_request|review_result|label):\s*"([^"]+)"/g },
    // 5) 驾驶舱/工作台状态与优先级配置表（渲染点 t(cfg.label)）
    { file: "RDTaskManagementPage.tsx", module: "RDTaskManagementPage", re: /label:\s*"([^"]+)"/g },
    { file: "RDMyWorkspacePage.tsx", module: "RDMyWorkspacePage", re: /label:\s*"([^"]+)"/g },
    { file: "RDDirectorDashboardPage.tsx", module: "RDDirectorDashboardPage", re: /label:\s*"([^"]+)"/g },
    { file: "RDDailyReportPanel.tsx", module: "RDDailyReportPanel", re: /label:\s*"([^"]+)"/g },
    { file: "RDMonthlyReportPanel.tsx", module: "RDMonthlyReportPanel", re: /label:\s*"([^"]+)"/g },
    { file: "lib/issue/config.ts", module: "issue/config", re: /(?:label|full):\s*"([^"]+)"/g },
    // 6) 首页快捷入口、数据源和状态标签常量表（渲染点是 t(变量)）
    {
      file: "Dashboard.tsx",
      module: "Dashboard",
      re: /(?:title|health|rd|issues|expenses|orders|pending|analyzing|adjusting|adopted|archived):\s*"([^"]+)"/g,
    },
  ];
  for (const src of sources) {
    const text = readFileSync(join(srcRoot, src.file), "utf8");
    let m;
    while ((m = src.re.exec(text))) {
      const key = m[1].trim();
      if (key && /[一-鿿]/.test(key) && !keys[key]) keys[key] = src.module;
    }
  }
}

for (const file of walk(srcRoot)) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("t(") && !text.includes("translate(")) continue;
  let m;
  let hit = false;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(text))) {
    const key = decodeJsString(m[1] ?? m[2] ?? m[3] ?? "").trim();
    // 只登记含中文的 key（过滤掉误匹配的英文/变量场景）
    if (!key || !/[一-鿿]/.test(key)) continue;
    if (!keys[key]) keys[key] = moduleOf(file);
    hit = true;
  }
  if (hit) files += 1;
}

const total = Object.keys(keys).length;
console.log(`扫描完成：${files} 个文件，提取 ${total} 个中文 key`);
if (dry) {
  for (const [k, mod] of Object.entries(keys)) console.log(`  [${mod}] ${JSON.stringify(k)}`);
  process.exit(0);
}

const res = await fetch(`${BASE}/i18n/keys`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(keys),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("登记失败:", res.status, JSON.stringify(body));
  process.exit(1);
}
console.log(`✓ 已登记 ${body.count} 个 key 到 i18n.keys`);
