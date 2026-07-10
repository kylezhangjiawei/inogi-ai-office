// 扫描前端源码里的 t("中文", ...) 字面量，把 key 全集登记到后端（PUT /api/i18n/keys）。
// 每次 P1 铺量后重跑一次；管理页「缺失英文」清单与 AI 初翻输入都来自这份登记。
// 用法：node apps/api/scripts/extract-i18n-keys.mjs [--dry]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiRoot, "..", "..");
const srcRoot = join(repoRoot, "src", "app");

const env = readFileSync(join(apiRoot, ".env"), "utf8");
const SECRET = env.match(/^JWT_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1] ?? "change-me-jwt-secret";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64url({ alg: "HS256", typ: "JWT" });
const payload = b64url({ sub: "cmra7pb6w0026u7w411wrhk7w", permissions: ["*"], iat: now, exp: now + 3600 });
const TOKEN = `${head}.${payload}.${createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url")}`;
const BASE = process.env.API_BASE ?? "http://localhost:3000/api";
const dry = process.argv.includes("--dry");

/** 匹配 t("...") / t('...') / t(`...`)（无 ${} 插值的模板串）。含 {n} 占位符的模板 key 原样提取。 */
const CALL_RE = /\bt\(\s*(?:"((?:[^"\\]|\\.)+)"|'((?:[^'\\]|\\.)+)'|`((?:[^`\\$]|\\.)+)`)/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      yield* walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
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
    { file: "RDAuditTimeline.tsx", module: "RDAuditTimeline", re: /^\s+[\w.]+:\s*"([^"]+)",\s*$/gm },
    // 4) MessageCenterPage filterLabels 常量表 + 统计卡 label（渲染点是 t(变量)）
    { file: "MessageCenterPage.tsx", module: "MessageCenterPage", re: /(?:all|unread|review_request|review_result|label):\s*"([^"]+)"/g },
    // 5) 驾驶舱/工作台状态与优先级配置表（渲染点 t(cfg.label)）
    { file: "RDTaskManagementPage.tsx", module: "RDTaskManagementPage", re: /label:\s*"([^"]+)"/g },
    { file: "RDMyWorkspacePage.tsx", module: "RDMyWorkspacePage", re: /label:\s*"([^"]+)"/g },
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
  if (!text.includes("t(")) continue;
  let m;
  let hit = false;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(text))) {
    const key = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\\(["'`])/g, "$1").trim();
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
  for (const [k, mod] of Object.entries(keys)) console.log(`  [${mod}] ${k}`);
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
