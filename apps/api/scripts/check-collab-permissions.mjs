// 协同模块权限矩阵实测：用「携带某角色权限码」的真实 JWT 打真实端点，断言不再 403。
//
// 可行性依据：jwt.strategy.validate 的 permissions 取自 token payload（DB 只校验用户存在/状态），
// 故无需在库里造账号即可模拟任意角色 —— 零数据改动。
// 写类端点一律送空/非法 body：期望 400（校验失败＝权限已放行），既证明授权又不产生脏数据。
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const apiRoot = "E:/workCoding/inogi-ai-office/apps/api";
const env = readFileSync(join(apiRoot, ".env"), "utf8");
const SECRET = env.match(/^JWT_SECRET\s*=\s*"?([^"\r\n]+)"?/m)[1];
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
}
const BASE = "http://localhost:3000/api";
// 任一在库的 ACTIVE 用户即可（strategy 只校验存在性/状态，权限完全取 payload）
const SUB = "cmo8exnfm0002u7s4hs4hmtz0";

const require2 = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require2("@prisma/client");
const db = new PrismaClient();

/**
 * 按候选名逐个探测取角色权限码 —— 角色名会被人在「角色权限」页改（实际发生过：
 * 「波士顿人员」被改成「波士顿成员」），写死单一名字会让本检查直接崩掉而不是给出结论。
 */
async function roleCodes(candidates) {
  for (const name of candidates) {
    const r = await db.role.findUnique({ where: { name }, select: { permissions: true } });
    if (r) return { name, codes: Array.isArray(r.permissions) ? r.permissions.map(String) : [] };
  }
  throw new Error(`找不到角色（试过：${candidates.join(" / ")}）——若线上改过角色名，请把新名字加进候选`);
}

function tokenFor(perms) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ sub: SUB, permissions: perms, iat: now, exp: now + 3600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

const WS = "workspace=us-collab";

/**
 * 端点声明的 @Permissions（OR 语义；方法级 override 类级，见 roles.guard.ts）。
 * ⚠️ 改了 controller 的 @Permissions 要同步这里。
 */
const RD_READ = [
  "page:rd-task-management", "page:rd-my-workspace", "page:rd-director-dashboard",
  "page:rd-approval-flow", "page:rd-audit-log", "page:rd-ai-settings",
  "page:us-collab-cockpit", "page:us-collab-workspace",
  "page:us-collab-approval-flow", "page:us-collab-audit-log", "page:us-collab-ai-settings",
];
const TASK_MANAGER = [
  "rd-task:edit", "rd-task:create", "rd-task:reassign",
  "rd-project:direct", "rd-project:review-l1", "rd-project:review-l2", "rd-people:manage",
];
const PROPOSAL = ["rd-project:propose", "rd-project:direct", "page:rd-director-dashboard"];

/**
 * 期望**从角色实际持码推导**，而不是写死 allow/deny —— 后者锁的是「角色该配什么码」
 * （产品策略，随时会在角色权限页被改：实测「波士顿人员」曾被改名并加成管理员超集，
 * 导致一堆写死的 deny 全红，但那不是 bug）。本检查要锁的是**授权机制**：
 * 守卫是否忠实执行 @Permissions，以及跨池红线是否永远关着。
 * need: 端点要求的码（OR）；deny: true = 安全红线，不论持码一律必须 403。
 */
const CASES = [
  // ── 用户报障过的两条链路（AI 配置 / 立项）──
  { name: "AI 配置·读", method: "GET", url: `/research-development/ai-settings?${WS}`, need: [...RD_READ, "page:ai-model-management", "rd-ai:configure"] },
  // ⚠️ 写端点一律不实打：PUT {} 会把配置/审批流整份覆盖成默认或空（首版实打过，已恢复数据）
  { name: "AI 配置·保存", method: "PUT", url: `/research-development/ai-settings?${WS}`, need: ["rd-ai:configure", "page:ai-model-management"], skipRun: true },
  { name: "AI 立项·文本抽取", method: "POST", url: `/research-development/ai/extract-tasks?${WS}`, body: {}, need: PROPOSAL },
  { name: "AI 立项·润色", method: "POST", url: `/research-development/ai/refine-proposal?${WS}`, body: {}, need: PROPOSAL },
  { name: "立项·建任务", method: "POST", url: `/research-development/task-categories/tasks?${WS}`, body: {}, need: ["rd-task:create"] },
  { name: "立项·存草稿", method: "POST", url: `/research-development/proposal-drafts?${WS}`, need: PROPOSAL, skipRun: true },
  // ── 三个配置页 ──
  { name: "审批流·读", method: "GET", url: `/research-development/approval-flows?${WS}`, need: RD_READ },
  { name: "审批流·保存", method: "PUT", url: `/research-development/approval-flows?${WS}`, need: ["rd-approval-flow:manage"], skipRun: true },
  { name: "审批流·候选人", method: "GET", url: `/research-development/approval-candidates?${WS}`, need: ["rd-approval-flow:manage"] },
  { name: "审批池", method: "GET", url: `/research-development/approval-pools?permissions=rd-project:review-l1&${WS}`, need: RD_READ },
  { name: "留痕·读", method: "GET", url: `/research-development/audit-logs?${WS}`, need: RD_READ },
  { name: "留痕·清空", method: "DELETE", url: `/research-development/audit-logs?${WS}`, need: ["rd-audit:clear"], skipRun: true },
  // ── 驾驶舱 / 工作台核心取数 ──
  { name: "驾驶舱·快照", method: "GET", url: `/research-development/snapshot?${WS}`, need: RD_READ },
  { name: "任务树", method: "GET", url: `/research-development/task-categories?${WS}`, need: RD_READ },
  { name: "工作区", method: "GET", url: `/research-development/workspace?${WS}`, need: RD_READ },
  { name: "人员池·读", method: "GET", url: `/research-development/people?${WS}`, need: [...RD_READ, "rd-people:manage"] },
  // ⚠️ POST {} 会真建出「未命名成员」（后端填默认值，不会 400）—— 不实打
  { name: "人员·新增", method: "POST", url: `/research-development/people?${WS}`, need: ["rd-people:manage"], skipRun: true },
  { name: "主管驾驶舱数据", method: "GET", url: `/research-development/director-dashboard?${WS}`, need: RD_READ },
  { name: "消息", method: "GET", url: `/research-development/messages?recipient_id=x&${WS}`, need: RD_READ },
  { name: "日报·读", method: "GET", url: `/research-development/daily-reports?${WS}`, need: RD_READ },
  { name: "日报·生成", method: "POST", url: `/research-development/daily-reports?${WS}`, need: ["page:rd-my-workspace", "page:us-collab-workspace", "rd-task:edit", "rd-task:create"], skipRun: true },
  { name: "月报·读", method: "GET", url: `/research-development/monthly-reports?${WS}`, need: RD_READ },
  { name: "留痕笔记·写", method: "POST", url: `/research-development/task-progress-notes?${WS}`, body: {}, need: ["page:rd-my-workspace", "page:us-collab-workspace", ...TASK_MANAGER] },
  { name: "AI 评估进度", method: "POST", url: `/research-development/ai/assess-progress?${WS}`, body: {}, need: ["page:rd-my-workspace", "page:us-collab-workspace", "rd-task:edit", "rd-task:create", "page:rd-director-dashboard"] },
  { name: "清空协同数据", method: "DELETE", url: `/research-development/task-data?${WS}`, need: ["rd-data:clear"], skipRun: true },
  // ── 协同知识库（DeptKbGuard：页面码 + 操作码；dept-kb:manage 隐含全部操作）──
  { name: "知识库·类目", method: "GET", url: `/research-development/dept-knowledge/us-collab/categories`, need: ["page:dept-kb-us-collab"] },
  { name: "知识库·条目", method: "GET", url: `/research-development/dept-knowledge/us-collab/entries`, need: ["page:dept-kb-us-collab"] },
  { name: "知识库·成员分值读", method: "GET", url: `/research-development/dept-knowledge/us-collab/member-levels`, need: ["dept-kb:manage"] },
  { name: "知识库·成员分值写", method: "PUT", url: `/research-development/dept-knowledge/us-collab/member-levels`, need: ["dept-kb:manage"], skipRun: true },
  { name: "知识库·建类目", method: "POST", url: `/research-development/dept-knowledge/us-collab/categories`, body: {}, need: ["dept-kb:category:create", "dept-kb:manage"] },
  { name: "知识库·预签上传", method: "POST", url: `/research-development/dept-knowledge/us-collab/presign-upload`, body: {}, need: ["dept-kb:upload", "dept-kb:manage"] },
  // ── 安全红线：不论持什么操作码，协同角色都不得碰研发池 / 别的部门库 ──
  { name: "🔒 研发池·快照", method: "GET", url: `/research-development/snapshot`, deny: true },
  { name: "🔒 研发池·任务树", method: "GET", url: `/research-development/task-categories`, deny: true },
  { name: "🔒 财务知识库", method: "GET", url: `/research-development/dept-knowledge/finance/entries`, deny: true },
];

async function hit(token, c) {
  const init = { method: c.method, headers: { Authorization: `Bearer ${token}` } };
  if (c.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(c.body);
  }
  const res = await fetch(BASE + c.url, init);
  return res.status;
}

const adminRole = await roleCodes(["波士顿管理员", "协同管理员"]);
const memberRole = await roleCodes(["波士顿成员", "波士顿人员", "协同成员"]);
const roles = [
  { key: "admin", label: adminRole.name, codes: adminRole.codes },
  { key: "member", label: memberRole.name, codes: memberRole.codes },
];
for (const r of roles) console.log(`${r.label}: ${r.codes.length} 码`);
console.log();

/** 期望：红线恒 deny；否则按「角色是否持有端点要求的任一码」推导 */
const expectAllow = (c, codes) =>
  c.deny ? false : codes.includes("*") || (c.need ?? []).some((code) => codes.includes(code));

let pass = 0, fail = 0;
const rows = [];
for (const c of CASES) {
  const cells = [];
  for (const r of roles) {
    const want = expectAllow(c, r.codes) ? "allow" : "deny";
    // skipRun：会覆盖配置（PUT {}）或产生业务记录（POST {}）的端点不实打——
    // 验证本身绝不该改数据。这类只做「持码 → 期望」的静态核对。
    let got, ok;
    if (c.skipRun) {
      got = want === "allow" ? "有权(静态)" : "无权(静态)";
      ok = true; // 静态分支下 want 即由持码推出，此处仅展示，不构成断言
    } else {
      const status = await hit(tokenFor(r.codes), c);
      got = String(status);
      ok = want === "allow" ? status !== 403 : status === 403;
      if (ok) pass++; else fail++;
    }
    cells.push({ label: r.label, want, got, ok, static: !!c.skipRun });
  }
  rows.push({ name: c.name, cells, deny: c.deny });
}

const mark = (c) => (c.static ? `－${c.got}` : `${c.ok ? "✓" : "✗"}${c.got}`);
console.log("端点".padEnd(24) + roles.map((r) => r.label.padEnd(20)).join(""));
console.log("─".repeat(66));
for (const r of rows) {
  const bad = r.cells.some((c) => !c.ok);
  console.log(
    (bad ? "✗ " : r.deny ? "🔒" : "  ") + r.name.padEnd(22) + mark(r.cells[0]).padEnd(20) + mark(r.cells[1]),
  );
}
console.log("\n判定口径：期望由「角色实际持码 vs 端点 @Permissions」推导——本检查锁的是");
console.log("『守卫忠实执行声明』与『🔒 跨池红线恒关』，不锁『角色该配什么码』（那是产品策略）。");
console.log("数字为实际 HTTP 状态；400/404 代表权限已放行。「－」= 写端点不实打（避免改数据），仅静态核对。");
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
