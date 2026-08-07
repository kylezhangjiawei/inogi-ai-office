// INOGI 研发 + 中美协同 自动化测试套件（API 级集成测试）
// 分组：G1 认证与池准入 / G2 研发核心链路回归 / G3 协同全链路 / G4 隔离性验证（含库快照对比）
// 测试数据统一 qa- 前缀，结束自动清理；rd.* 键（除全局 rd.messages）测试前后 hash 必须一致。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQaArtifactCleanupUpdates, QA_CLEANUP_KEYS } from "./qa-artifact-cleanup.mjs";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");

const env = readFileSync(join(apiRoot, ".env"), "utf8");
const envVal = (k) => env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, "m"))?.[1];
process.env.DATABASE_URL = envVal("DATABASE_URL");
const JWT_SECRET = envVal("JWT_SECRET");
if (!JWT_SECRET) throw new Error("apps/api/.env 中未配置 JWT_SECRET");
// 与 scripts/dev-all.mjs 的默认 API 端口保持一致，避免误连本机其他项目的 3000 服务。
// CI/预发布环境可通过 QA_BASE_URL 显式覆盖。
const BASE = (process.env.QA_BASE_URL || "http://127.0.0.1:3001/api").replace(/\/$/, "");
const prisma = new PrismaClient();

let USER_ID = "";
let USER_NAME = "QA 协同成员";
const QA_ROLE_IDS = [];
const QA_USER_IDS = [];
// 手写 HS256 JWT（jsonwebtoken 不在 api 直接依赖里，pnpm 严格树取不到）
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const sign = (userId, permissions) => {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ sub: userId, permissions, iat: now, exp: now + 3600 });
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};
let TOKENS = {};

async function setupQaActors() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const profiles = [
    { key: "admin", name: "QA 超级管理员", permissions: ["*"] },
    { key: "rdOnly", name: "QA 研发成员", permissions: ["page:rd-task-management", "page:rd-my-workspace"] },
    { key: "collabOnly", name: USER_NAME, permissions: ["page:us-collab-workspace"] },
    { key: "collabCockpit", name: "QA 协同主管", permissions: ["page:us-collab-cockpit"] },
    { key: "peopleOnly", name: "QA 人员管理员", permissions: ["rd-people:manage"] },
  ];
  const actors = {};
  for (const profile of profiles) {
    const role = await prisma.role.create({
      data: {
        name: `qa-role-${profile.key}-${suffix}`,
        description: "研发接口 QA 临时角色，测试结束自动删除",
        permissions: profile.permissions,
      },
    });
    QA_ROLE_IDS.push(role.id);
    const user = await prisma.user.create({
      data: {
        name: profile.name,
        englishName: `QA ${profile.key}`,
        username: `qa-${profile.key}-${suffix}`,
        email: `qa-${profile.key}-${suffix}@noemail.internal`,
        department: "QA",
        roleId: role.id,
      },
    });
    QA_USER_IDS.push(user.id);
    actors[profile.key] = { id: user.id, permissions: profile.permissions };
  }
  USER_ID = actors.collabOnly.id;
  TOKENS = Object.fromEntries(
    Object.entries(actors).map(([key, actor]) => [key, sign(actor.id, actor.permissions)]),
  );
}

async function cleanupQaActors() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: QA_CLEANUP_KEYS } },
    select: { key: true, value: true },
  });
  const { updates } = buildQaArtifactCleanupUpdates(
    Object.fromEntries(rows.map((row) => [row.key, row.value])),
  );
  await prisma.$transaction(
    Object.entries(updates).map(([key, value]) =>
      prisma.systemSetting.update({ where: { key }, data: { value } }),
    ),
  );
  if (QA_USER_IDS.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: QA_USER_IDS } } });
  }
  if (QA_ROLE_IDS.length > 0) {
    await prisma.role.deleteMany({ where: { id: { in: QA_ROLE_IDS } } });
  }
}

const results = [];
let currentGroup = "";
const group = (name) => { currentGroup = name; console.log(`\n══ ${name} ══`); };
const record = (name, pass, detail = "") => {
  results.push({ group: currentGroup, name, pass, detail });
  console.log(`${pass ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const check = (name, cond, detail = "") => record(name, Boolean(cond), cond ? "" : detail);

async function http(method, path, token, body, isForm = false) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

const flatten = (cats) => {
  const out = [];
  const walk = (tasks) => { for (const t of tasks ?? []) { out.push(t); walk(t.subtasks); } };
  for (const c of cats ?? []) for (const s of c.children ?? []) walk(s.tasks);
  return out;
};

// ── 库快照：rd.* 键（排除全局消息与跨池共享数据）内容 hash ────────────────────────
const SNAPSHOT_EXCLUDE = new Set(["rd.messages"]);
async function snapshotRd() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: "rd." } },
    select: { key: true, value: true },
    orderBy: { key: "asc" },
  });
  const map = {};
  for (const r of rows) {
    if (SNAPSHOT_EXCLUDE.has(r.key)) continue;
    map[r.key] = createHash("md5").update(JSON.stringify(r.value)).digest("hex");
  }
  return map;
}

const CREATED = { rd: [], collab: [] }; // task_ids 待清理
const ws = (path, workspace) => workspace ? `${path}${path.includes("?") ? "&" : "?"}workspace=${workspace}` : path;

async function createTask(token, workspace, title, extra = {}) {
  const cats = await http("GET", ws("/research-development/task-categories", workspace), token);
  const cat = cats.json?.[0];
  const sub = cat?.children?.[0];
  if (!cat || !sub) throw new Error("无可用分类");
  const res = await http("POST", ws("/research-development/task-categories/tasks", workspace), token, {
    category_id: cat.id,
    sub_project_id: sub.id,
    title,
    primary_owner: USER_NAME,
    primary_owner_user_id: USER_ID,
    status: "in_progress",
    progress: 10,
    final_priority: "medium",
    ...extra,
  });
  if (res.status >= 300) throw new Error(`建任务失败 ${res.status}: ${JSON.stringify(res.json)}`);
  const id = res.json?.task_id;
  CREATED[workspace === "us-collab" ? "collab" : "rd"].push(id);
  return id;
}
const patchTask = (token, workspace, id, patch) =>
  http("PATCH", ws(`/research-development/task-categories/tasks/${id}`, workspace), token, patch);
const readTree = async (token, workspace) =>
  flatten((await http("GET", ws("/research-development/task-categories", workspace), token)).json);
const findTask = async (token, workspace, id) => (await readTree(token, workspace)).find((t) => t.task_id === id);

async function main() {
  await setupQaActors();
  console.log("测试目标: " + BASE + " · 使用 5 个临时真实角色验证权限（结束自动清理）");
  const snapBefore = await snapshotRd();
  console.log(`研发池快照基线: ${Object.keys(snapBefore).length} 个 rd.* 键`);

  // ════ G1 认证与池准入 ════
  group("G1 认证与池准入");
  {
    let r = await http("GET", "/research-development/task-categories", null);
    check("无 token 访问 → 401", r.status === 401, `got ${r.status}`);
    r = await http("GET", "/research-development/task-categories", TOKENS.admin);
    check("admin 访问研发池 → 200", r.status === 200, `got ${r.status}`);
    r = await http("GET", ws("/research-development/task-categories", "us-collab"), TOKENS.admin);
    check("admin 访问协同池 → 200", r.status === 200, `got ${r.status}`);
    r = await http("GET", "/research-development/task-categories", TOKENS.collabOnly);
    check("仅协同工作台码访问研发池 → 403", r.status === 403, `got ${r.status}`);
    r = await http("GET", ws("/research-development/task-categories", "us-collab"), TOKENS.collabOnly);
    check("仅协同工作台码访问协同池 → 200", r.status === 200, `got ${r.status}`);
    r = await http("GET", ws("/research-development/task-categories", "us-collab"), TOKENS.rdOnly);
    check("仅研发页面码访问协同池 → 403", r.status === 403, `got ${r.status}`);
    r = await http("GET", "/research-development/people", TOKENS.peopleOnly);
    check("仅 rd-people:manage 访问研发人员 → 200（历史回归）", r.status === 200, `got ${r.status}`);
    r = await http("GET", ws("/research-development/people", "us-collab"), TOKENS.peopleOnly);
    check("仅 rd-people:manage 访问协同人员 → 200", r.status === 200, `got ${r.status}`);
    r = await http("GET", ws("/research-development/task-categories", "bad-ws"), TOKENS.admin);
    check("未知工作区 → 403", r.status === 403, `got ${r.status}`);
    // 消息端点豁免池校验：协同专属用户读消息应 200（全局用户级数据）
    r = await http("GET", "/research-development/messages?recipient_id=" + USER_ID, TOKENS.collabOnly);
    check("协同专属用户读消息（无 workspace）→ 200（豁免池校验）", r.status === 200, `got ${r.status}`);
  }

  // ════ G2 研发核心链路回归 ════
  group("G2 研发核心链路（上线模块回归）");
  let rdTaskId = null;
  {
    rdTaskId = await createTask(TOKENS.admin, undefined, "qa-rd-主链路任务");
    check("建任务", Boolean(rdTaskId), "no task_id");
    let t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("任务出现在研发树", Boolean(t));

    let r = await patchTask(TOKENS.admin, undefined, rdTaskId, { progress: 45 });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("PATCH 进度 45", r.status < 300 && t?.progress === 45, `status=${r.status} progress=${t?.progress}`);

    r = await patchTask(TOKENS.admin, undefined, rdTaskId, { final_priority: "high" });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("PATCH 优先级 high", t?.final_priority === "high", `got ${t?.final_priority}`);

    // 进度留痕（multipart）
    const form = new FormData();
    form.append("task_id", rdTaskId);
    form.append("text", "qa-rd 自动化测试留痕");
    form.append("progress", "50");
    r = await http("POST", "/research-development/task-progress-notes", TOKENS.admin, form, true);
    check("创建进度留痕", r.status < 300 && r.json?.id, `status=${r.status}`);
    r = await http("GET", `/research-development/task-progress-notes/${rdTaskId}`, TOKENS.admin);
    check("读回留痕含刚写入内容", r.status === 200 && r.json?.some?.((n) => n.text?.includes("qa-rd 自动化测试留痕")));

    // 阻塞时长钩子
    await patchTask(TOKENS.admin, undefined, rdTaskId, { status: "paused_blocked", blocked_reason: "qa 阻塞" });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("切入阻塞 → blocked_since 打点", typeof t?.blocked_since === "string" && t.blocked_since.length > 0, `blocked_since=${t?.blocked_since}`);
    await patchTask(TOKENS.admin, undefined, rdTaskId, { status: "in_progress" });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("离开阻塞 → blocked_since 清除", !t?.blocked_since, `blocked_since=${t?.blocked_since}`);

    // work_items 写入归一化（防污染）
    await patchTask(TOKENS.admin, undefined, rdTaskId, { work_items: { hacked: true } });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("work_items 非法形状被清洗为数组", Array.isArray(t?.work_items), `got ${JSON.stringify(t?.work_items)}`);
    await patchTask(TOKENS.admin, undefined, rdTaskId, { work_items: [{ id: "wi-qa-1", title: "qa 工作项", done: false }, { bad: 1 }] });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("work_items 合法项保留/非法项剔除", t?.work_items?.length === 1 && t.work_items[0].id === "wi-qa-1", `got ${JSON.stringify(t?.work_items)}`);

    // 审批链：提交审核 → 审核通过 → completed
    await patchTask(TOKENS.admin, undefined, rdTaskId, { status: "pending_review", pending_review_type: "result", progress: 100 });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("提交成果审核 → pending_review", t?.status === "pending_review", `got ${t?.status}`);
    check("提交时间戳 submitted_for_review_at 已记", Boolean(t?.submitted_for_review_at));
    await patchTask(TOKENS.admin, undefined, rdTaskId, { _review_action: "approve", _reviewer_name: "QA" });
    t = await findTask(TOKENS.admin, undefined, rdTaskId);
    check("审核通过 → completed 且待审字段清空", t?.status === "completed" && !t?.pending_review_type, `status=${t?.status} pending=${t?.pending_review_type}`);

    // 并发转派正确性（任务树写锁验证）：4 个任务并发改主责，全部生效
    const ids = [];
    for (let i = 1; i <= 4; i++) ids.push(await createTask(TOKENS.admin, undefined, `qa-rd-并发${i}`));
    await Promise.all(ids.map((id, i) =>
      patchTask(TOKENS.admin, undefined, id, { primary_owner: `qa-Owner${i + 1}`, primary_owner_user_id: null })));
    const tree = await readTree(TOKENS.admin, undefined);
    const owners = ids.map((id) => tree.find((t2) => t2.task_id === id)?.primary_owner);
    check("并发 4 路转派全部生效（无 lost update）", owners.every((o, i) => o === `qa-Owner${i + 1}`), `owners=${owners.join(",")}`);

    // 工作台与日报接口可用性
    r = await http("GET", "/research-development/workspace", TOKENS.admin);
    check("个人工作台接口 200", r.status === 200, `got ${r.status}`);
    r = await http("GET", "/research-development/daily-reports?limit=1", TOKENS.admin);
    check("日报列表接口 200", r.status === 200, `got ${r.status}`);
  }

  // ════ G3 协同全链路 ════
  group("G3 中美协同全链路");
  let coTaskId = null;
  {
    coTaskId = await createTask(TOKENS.admin, "us-collab", "qa-collab-主链路任务");
    check("协同池建任务", Boolean(coTaskId));
    let t = await findTask(TOKENS.admin, "us-collab", coTaskId);
    check("任务出现在协同树", Boolean(t));

    // 工作项全流程
    let r = await patchTask(TOKENS.admin, "us-collab", coTaskId, {
      work_items: [
        { id: "wi-qa-a", title: "qa 文档A", done: false },
        { id: "wi-qa-b", title: "qa 文档B", done: false },
      ],
    });
    t = await findTask(TOKENS.admin, "us-collab", coTaskId);
    check("协同任务写入 2 个工作项", t?.work_items?.length === 2, `got ${t?.work_items?.length}`);
    await patchTask(TOKENS.admin, "us-collab", coTaskId, {
      work_items: t.work_items.map((w) => (w.id === "wi-qa-a" ? { ...w, done: true } : w)),
    });
    t = await findTask(TOKENS.admin, "us-collab", coTaskId);
    check("工作项勾选完成持久化", t?.work_items?.find((w) => w.id === "wi-qa-a")?.done === true);

    // 留痕关联工作项
    const form = new FormData();
    form.append("task_id", coTaskId);
    form.append("text", "qa-collab 关联工作项留痕");
    form.append("work_item_id", "wi-qa-a");
    r = await http("POST", ws("/research-development/task-progress-notes", "us-collab"), TOKENS.admin, form, true);
    check("协同留痕创建（带 work_item_id）", r.status < 300 && r.json?.work_item_id === "wi-qa-a", `status=${r.status} wid=${r.json?.work_item_id}`);
    r = await http("GET", ws(`/research-development/task-progress-notes/${coTaskId}`, "us-collab"), TOKENS.admin);
    check("协同留痕读回含工作项标签", r.json?.some?.((n) => n.work_item_id === "wi-qa-a"));

    // AI 任务小结：admin 可用；参与人可用；非参与人（协同专属码）403 需另一任务
    r = await http("POST", ws(`/research-development/tasks/${coTaskId}/brief`, "us-collab"), TOKENS.admin);
    check("AI 小结（admin）→ 200 且有文本", r.status === 201 || r.status === 200, `got ${r.status}`);
    check("AI 小结返回 text 与 source", typeof r.json?.text === "string" && ["ai", "local"].includes(r.json?.source), `source=${r.json?.source}`);
    // Paul 是本任务主责 → collabOnly（同一真实用户）应 200
    r = await http("POST", ws(`/research-development/tasks/${coTaskId}/brief`, "us-collab"), TOKENS.collabOnly);
    check("AI 小结（工作台码·本人参与）→ 200", r.status === 201 || r.status === 200, `got ${r.status}`);
    // 建一个非 Paul 参与的任务验证越权 403
    const otherId = await createTask(TOKENS.admin, "us-collab", "qa-collab-他人任务", { primary_owner: "Mike Johnson", primary_owner_user_id: null });
    r = await http("POST", ws(`/research-development/tasks/${otherId}/brief`, "us-collab"), TOKENS.collabOnly);
    check("AI 小结（工作台码·非参与人）→ 403（越权防护）", r.status === 403, `got ${r.status}`);
    r = await http("POST", ws(`/research-development/tasks/${otherId}/brief`, "us-collab"), TOKENS.collabCockpit);
    check("AI 小结（驾驶舱码·可看全部）→ 200", r.status === 201 || r.status === 200, `got ${r.status}`);

    // 阻塞钩子（协同池）
    await patchTask(TOKENS.admin, "us-collab", coTaskId, { status: "paused_blocked", blocked_reason: "qa 阻塞" });
    t = await findTask(TOKENS.admin, "us-collab", coTaskId);
    check("协同任务切入阻塞 → blocked_since", Boolean(t?.blocked_since));
    await patchTask(TOKENS.admin, "us-collab", coTaskId, { status: "in_progress" });

    // 协同审批链
    await patchTask(TOKENS.admin, "us-collab", coTaskId, { status: "pending_review", pending_review_type: "result", progress: 100 });
    await patchTask(TOKENS.admin, "us-collab", coTaskId, { _review_action: "approve", _reviewer_name: "QA" });
    t = await findTask(TOKENS.admin, "us-collab", coTaskId);
    check("协同审批通过 → completed", t?.status === "completed", `got ${t?.status}`);

    // 协同工作台/日报接口
    r = await http("GET", ws("/research-development/workspace", "us-collab"), TOKENS.collabOnly);
    check("协同工作台接口（工作台码）200", r.status === 200, `got ${r.status}`);
    r = await http("GET", ws("/research-development/daily-reports?limit=1", "us-collab"), TOKENS.admin);
    check("协同日报接口 200", r.status === 200, `got ${r.status}`);
    // 协同知识库（部门库 us-collab）
    r = await http("GET", "/research-development/dept-knowledge/us-collab/entries", TOKENS.admin);
    check("协同知识库条目接口 200", r.status === 200, `got ${r.status}`);
    r = await http("GET", "/research-development/dept-knowledge/purchasing/entries", TOKENS.admin);
    check("采购知识库条目接口 200（分值过滤库）", r.status === 200, `got ${r.status}`);
  }

  // ════ G4 隔离性验证 ════
  group("G4 隔离性（研发 ⇄ 协同互不影响）");
  {
    const rdTree = await readTree(TOKENS.admin, undefined);
    const coTree = await readTree(TOKENS.admin, "us-collab");
    check("协同 qa 任务不出现在研发树", !rdTree.some((t) => CREATED.collab.includes(t.task_id)),
      `泄漏: ${rdTree.filter((t) => CREATED.collab.includes(t.task_id)).map((t) => t.task_id).join(",")}`);
    check("研发 qa 任务不出现在协同树", !coTree.some((t) => CREATED.rd.includes(t.task_id)),
      `泄漏: ${coTree.filter((t) => CREATED.rd.includes(t.task_id)).map((t) => t.task_id).join(",")}`);

    const rdPeople = (await http("GET", "/research-development/people", TOKENS.admin)).json ?? [];
    const coPeople = (await http("GET", ws("/research-development/people", "us-collab"), TOKENS.admin)).json ?? [];
    const rdNames = new Set(rdPeople.map((p) => p.name));
    const coOnly = coPeople.filter((p) => !rdNames.has(p.name)).length;
    check("人员池独立（协同存在研发没有的成员）", coPeople.length > 0 && coOnly > 0,
      `rd=${rdPeople.length} collab=${coPeople.length} collabOnly=${coOnly}`);

    // 留痕隔离：协同任务留痕在研发池读不到
    const r = await http("GET", `/research-development/task-progress-notes/${coTaskId}`, TOKENS.admin);
    check("协同任务留痕在研发池为空", Array.isArray(r.json) && r.json.length === 0, `got ${r.json?.length} 条`);
  }

  // ════ 清理 ════
  group("清理 qa 测试数据");
  {
    for (const id of CREATED.rd) await http("DELETE", `/research-development/task-categories/tasks/${id}`, TOKENS.admin);
    for (const id of CREATED.collab) await http("DELETE", ws(`/research-development/task-categories/tasks/${id}`, "us-collab"), TOKENS.admin);
    const rdLeft = (await readTree(TOKENS.admin, undefined)).filter((t) => CREATED.rd.includes(t.task_id)).length;
    const coLeft = (await readTree(TOKENS.admin, "us-collab")).filter((t) => CREATED.collab.includes(t.task_id)).length;
    check("qa 任务全部删除", rdLeft === 0 && coLeft === 0, `rd残留=${rdLeft} collab残留=${coLeft}`);
  }

  // ════ 快照对比（最硬核的互不影响证明）════
  group("G4+ 研发池库快照前后对比");
  {
    const snapAfter = await snapshotRd();
    const changed = [];
    for (const key of new Set([...Object.keys(snapBefore), ...Object.keys(snapAfter)])) {
      // 研发链路自己动过的键属预期变化（G2 建删任务/留痕/日报），排除后其余 rd.* 键必须纹丝不动
      if (["rd.taskCategories", "rd.taskProgressNotes", "rd.auditLogs", "rd.taskCompletionScores", "rd.directorDashboard", "rd.dailyReports", "rd.workspace", "rd.productTaskCategories"].includes(key)) continue;
      if (snapBefore[key] !== snapAfter[key]) changed.push(key);
    }
    check("协同全链路跑完后，研发池非预期键零变化", changed.length === 0, `变化键: ${changed.join(", ")}`);
  }

  // ════ 汇总 ════
  const fails = results.filter((r) => !r.pass);
  console.log(`\n════ 汇总: ${results.length - fails.length}/${results.length} 通过 ════`);
  if (fails.length) {
    console.log("失败清单:");
    for (const f of fails) console.log(`  [${f.group}] ${f.name} — ${f.detail}`);
  }
  process.exitCode = fails.length > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("套件执行异常:", err);
    process.exitCode = 2;
  })
  .finally(async () => {
    try {
      await cleanupQaActors();
    } finally {
      await prisma.$disconnect();
    }
  });
