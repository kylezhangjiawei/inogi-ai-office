// /api/settings 与 /api/dictionaries 的守卫回归。
//
// 背景：这两个控制器此前**全端点无 @Permissions**，而 RolesGuard 是「无声明即放行」，
// 于是任何登录用户都能：GET /api/settings 读走全部 systemSetting（研发任务树/审批流/
// AI 策略/留痕全在里面，一次绕开工作区隔离与页面码定池），POST 覆写任意存储键；
// 以及随意增删字典主数据。收紧后本脚本锁死结果，并确认没误伤既有页面。
//
// 前置：后端跑在 3000。用法：node apps/api/scripts/check-settings-guard.mjs
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(apiRoot, ".env"), "utf8");
const SECRET = env.match(/^JWT_SECRET\s*=\s*"?([^"\r\n]+)"?/m)[1];
const BASE = "http://localhost:3000/api";
// 任一在库 ACTIVE 用户即可：权限完全取 JWT payload（jwt.strategy 只用 DB 校验存在性/状态）
const SUB = "cmo8exnfm0002u7s4hs4hmtz0";

function tokenFor(perms) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ sub: SUB, permissions: perms, iat: now, exp: now + 3600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

const ROLES = [
  { key: "collab", label: "协同成员", perms: ["page:us-collab-cockpit", "page:us-collab-workspace"] },
  { key: "dict", label: "字典页管理员", perms: ["page:settings"] },
  { key: "aimodel", label: "AI模型管理员", perms: ["page:ai-model-management"] },
];

// 只打读端点：写端点会改主数据，按守卫规则静态判定即可（要什么码写在 staticCode）
const CASES = [
  { name: "系统设置·读全部", method: "GET", url: "/settings", collab: "deny", dict: "allow", aimodel: "deny" },
  { name: "系统设置·覆写任意键", method: "POST", url: "/settings", collab: "deny", dict: "allow", aimodel: "deny", staticCode: "page:settings" },
  { name: "字典·类型列表（AI模型页也要用）", method: "GET", url: "/dictionaries/types", collab: "deny", dict: "allow", aimodel: "allow" },
  { name: "字典·新建类型", method: "POST", url: "/dictionaries/types", collab: "deny", dict: "allow", aimodel: "deny", staticCode: "page:settings" },
  { name: "字典·删除类型", method: "DELETE", url: "/dictionaries/types/x", collab: "deny", dict: "allow", aimodel: "deny", staticCode: "page:settings" },
  { name: "字典·删除条目", method: "DELETE", url: "/dictionaries/items/x", collab: "deny", dict: "allow", aimodel: "deny", staticCode: "page:settings" },
];

let pass = 0, fail = 0;
console.log("端点".padEnd(30) + ROLES.map((r) => r.label.padEnd(14)).join(""));
console.log("─".repeat(74));
for (const c of CASES) {
  const cells = [];
  for (const r of ROLES) {
    const want = c[r.key];
    let got, ok;
    if (c.staticCode) {
      const has = r.perms.includes("*") || r.perms.includes(c.staticCode);
      got = has ? "有权" : "403";
      ok = has === (want === "allow");
    } else {
      const res = await fetch(BASE + c.url, { headers: { Authorization: `Bearer ${tokenFor(r.perms)}` } });
      got = String(res.status);
      ok = want === "allow" ? res.status !== 403 : res.status === 403;
    }
    ok ? pass++ : fail++;
    cells.push(`${ok ? "✓" : "✗"}${got}`);
  }
  const bad = cells.some((x) => x.startsWith("✗"));
  console.log((bad ? "✗ " : "  ") + c.name.padEnd(28) + cells.map((x) => x.padEnd(14)).join(""));
}
console.log("\n（allow=不得 403；deny=必须 403。写端点按守卫规则静态判定，不实打以免改主数据）");
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
