// 浏览器层 DOM 断言（CDP + 真实 dev 前端 5173 + 自签 token 真实 API）
// 桌面：协同驾驶舱三层页头 / 研发驾驶舱对照 / 点击直达全屏详情
// 移动：/m 与 /us-collab-m 标题与内容分池
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = readFileSync(join(apiRoot, ".env"), "utf8");
const JWT_SECRET = env.match(/^JWT_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1] ?? "change-me-jwt-secret";
const USER_ID = "cmra7pb6w0026u7w411wrhk7w";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64url({ alg: "HS256", typ: "JWT" });
const body = b64url({ sub: USER_ID, permissions: ["*"], iat: now, exp: now + 3600 });
const TOKEN = `${head}.${body}.${createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url")}`;

const PORT = 9224;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: Boolean(cond) });
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${cond ? "" : ` — ${detail}`}`);
};

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  "--headless=new",
  "--no-first-run",
  "--disable-gpu",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "qa-chrome-"))}`,
  "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(pathUrl) {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
      if (list.webSocketDebuggerUrl) break;
    } catch { await sleep(300); }
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  return { send, close: () => ws.close() };
}

async function newPage(c, { mobile = false } = {}) {
  const { result: { targetId } } = await c.send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await c.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => c.send(m, p, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  if (mobile) {
    await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await s("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" });
  } else {
    await s("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
  }
  // 注入真实 token（access+refresh 都塞，session/local 双写防 getStorage 分支）
  await s("Page.addScriptToEvaluateOnNewDocument", { source: `
    try {
      localStorage.setItem("inogi-access-token", ${JSON.stringify(TOKEN)});
      localStorage.setItem("inogi-refresh-token", ${JSON.stringify(TOKEN)});
      sessionStorage.setItem("inogi-access-token", ${JSON.stringify(TOKEN)});
      sessionStorage.setItem("inogi-refresh-token", ${JSON.stringify(TOKEN)});
    } catch (e) {}
  ` });
  const goto = async (url, settleMs = 3500) => {
    await s("Page.navigate", { url });
    await sleep(settleMs);
  };
  /** 在后续每次新文档注入额外脚本（须在 goto 前调用） */
  const evalOnNew = (source) => s("Page.addScriptToEvaluateOnNewDocument", { source });
  const evalJs = async (expr) => {
    const { result } = await s("Runtime.evaluate", { expression: expr, returnByValue: true });
    return result?.result?.value;
  };
  const close = () => c.send("Target.closeTarget", { targetId });
  return { goto, evalJs, evalOnNew, close };
}

const BASE = "http://localhost:5173";
try {
  const c = await cdp();

  // ── D1 协同驾驶舱（桌面）──
  console.log("\n══ D1 协同驾驶舱（桌面）══");
  {
    const p = await newPage(c);
    await p.goto(`${BASE}/us-collab-cockpit`, 5000);
    const state = await p.evalJs(`(() => {
      const text = document.body.innerText;
      return {
        title: text.includes("协同任务驾驶舱"),
        noRdHint: !text.includes("研发执行提示"),
        statStrip: text.includes("完成率") && text.includes("活跃"),
        digest: text.includes("今日日报") && text.includes("展开报表"),
        noAutoCollapse: !text.includes("自动收起"),
        noPanorama: !text.includes("子系统全景"),
        taskCards: document.querySelectorAll('[role="button"][tabindex="0"]').length,
      };
    })()`);
    check("页头条标题「协同任务驾驶舱」", state?.title);
    check("无旧「研发执行提示」卡", state?.noRdHint);
    check("Stat Strip 已渲染（活跃/完成率）", state?.statStrip);
    check("日报摘要条（今日日报 + 展开报表）", state?.digest);
    check("无「自动收起」控制条", state?.noAutoCollapse);
    check("无子系统全景", state?.noPanorama);
    check(`任务卡已渲染（${state?.taskCards} 张）`, (state?.taskCards ?? 0) > 0);

    // 点击第一张任务卡 → 直达全屏详情
    await p.evalJs(`document.querySelector('[role="button"][tabindex="0"]')?.click()`);
    await sleep(3000);
    const after = await p.evalJs(`(() => ({
      url: location.pathname,
      hasAudit: document.body.innerText.includes("操作记录"),
      hasBrief: document.body.innerText.includes("AI 任务小结"),
      hasExport: document.body.innerText.includes("导出过程报告"),
      noWorkItemAdd: !document.body.innerText.includes("添加工作项"),
    }))()`);
    check("点任务卡直达 /us-collab-task/", after?.url?.startsWith("/us-collab-task/"), `url=${after?.url}`);
    // 视口内布局回归：详情页根容器（inline height）底边不得超出视口（整页无滚动）
    const layout = await p.evalJs(`(() => {
      const el = document.querySelector('div[style*="height"]');
      if (!el) return { found: false };
      const rect = el.getBoundingClientRect();
      return { found: true, bottom: Math.round(rect.bottom), viewport: window.innerHeight };
    })()`);
    check("详情页锁定视口内（无页面滚动）", layout?.found && layout.bottom <= layout.viewport + 4, `bottom=${layout?.bottom} viewport=${layout?.viewport}`);
    check("详情页含操作记录 Tab", after?.hasAudit);
    check("详情页含 AI 任务小结按钮", after?.hasBrief);
    check("详情页含导出过程报告", after?.hasExport);
    check("详情页工作项无添加入口（只读）", after?.noWorkItemAdd);
    await p.close();
  }

  // ── D1.5 跨工作区 SPA 切换不串池（曾发生组件实例复用导致协同数据留在研发页）──
  console.log("\n══ D1.5 跨工作区切换隔离 ══");
  {
    const p = await newPage(c);
    await p.goto(`${BASE}/us-collab-cockpit`, 5000);
    const before = await p.evalJs(`document.body.innerText.includes("Field failure triage")`);
    check("切换前：协同驾驶舱已载入协同任务", before === true);
    // SPA 内点击侧边栏切到研发驾驶舱（不整页刷新，才能复现实例复用问题）
    await p.evalJs(`[...document.querySelectorAll("a,button,[role=button]")].find((el) => el.textContent.trim() === "研发任务驾驶舱")?.click()`);
    await sleep(4500);
    const after = await p.evalJs(`(() => ({
      url: location.pathname,
      leaked: /Field failure triage|Boston office demo|FDA 510\\(k\\)/.test(document.body.innerText),
    }))()`);
    check("SPA 切到研发驾驶舱（URL 正确）", after?.url === "/rd-task-management", `url=${after?.url}`);
    check("研发驾驶舱无协同池任务泄漏", after?.leaked === false, "协同任务标题出现在研发页");
    // 反向：再切回协同，不应残留研发任务
    await p.evalJs(`[...document.querySelectorAll("a,button,[role=button]")].find((el) => el.textContent.trim() === "协同任务驾驶舱")?.click()`);
    await sleep(4500);
    const back = await p.evalJs(`(() => ({
      url: location.pathname,
      hasCollab: document.body.innerText.includes("Field failure triage"),
    }))()`);
    check("切回协同驾驶舱数据正确", back?.url === "/us-collab-cockpit" && back?.hasCollab === true, `url=${back?.url}`);
    await p.close();
  }

  // ── D2 研发驾驶舱对照（必须零变化）──
  console.log("\n══ D2 研发驾驶舱（对照，须维持原样）══");
  {
    const p = await newPage(c);
    await p.goto(`${BASE}/rd-task-management`, 5000);
    const state = await p.evalJs(`(() => {
      const text = document.body.innerText;
      return {
        rdHint: text.includes("研发执行提示"),
        dailyCard: text.includes("今日日报速览"),
        autoCollapse: text.includes("自动收起") || text.includes("已钉住"),
        // 注意：侧边栏菜单天然含「协同任务驾驶舱」导航文字，只断言协同专属的摘要条文案
        noDigest: !text.includes("展开报表"),
        taskCards: document.querySelectorAll('[role="button"][tabindex="0"]').length,
      };
    })()`);
    check("原「研发执行提示」卡仍在", state?.rdHint);
    check("原「今日日报速览」完整面板仍在", state?.dailyCard);
    check("「自动收起/钉住」控制条仍在", state?.autoCollapse);
    check("无协同页头元素（日报摘要条）", state?.noDigest);
    check(`研发任务卡已渲染（${state?.taskCards} 张）`, (state?.taskCards ?? 0) > 0);

    // 点击任务卡 → 应打开抽屉而非跳转
    await p.evalJs(`document.querySelector('[role="button"][tabindex="0"]')?.click()`);
    await sleep(2500);
    const after = await p.evalJs(`(() => ({
      url: location.pathname,
      hasDrawer: document.body.innerText.includes("操作留痕") && document.body.innerText.includes("任务描述"),
    }))()`);
    check("点任务卡仍开抽屉（URL 不变）", after?.url === "/rd-task-management", `url=${after?.url}`);
    check("抽屉内容已渲染（操作留痕/任务描述）", after?.hasDrawer);
    await p.close();
  }

  // ── M1/M2 移动端 ──
  console.log("\n══ M 移动端（390x844 触屏）══");
  {
    const p = await newPage(c, { mobile: true });
    await p.goto(`${BASE}/m`, 5000);
    const rd = await p.evalJs(`(() => ({
      title: document.body.innerText.includes("研发任务驾驶舱"),
      overflowOk: document.documentElement.scrollWidth <= 400,
      body: document.body.innerText.slice(0, 4000),
    }))()`);
    check("移动端 /m 标题「研发任务驾驶舱」", rd?.title);
    check("移动端 /m 无横向溢出", rd?.overflowOk);

    await p.goto(`${BASE}/us-collab-m`, 5000);
    const co = await p.evalJs(`(() => ({
      title: document.body.innerText.includes("协同任务驾驶舱"),
      overflowOk: document.documentElement.scrollWidth <= 400,
      body: document.body.innerText.slice(0, 4000),
    }))()`);
    check("移动端 /us-collab-m 标题「协同任务驾驶舱」", co?.title);
    check("移动端 /us-collab-m 无横向溢出", co?.overflowOk);
    // 内容分池：协同移动端应出现协同池任务（Boston/FDA），研发移动端不应出现
    check("协同移动端渲染协同池任务", /Boston|FDA|Field failure/.test(co?.body ?? ""), (co?.body ?? "").slice(0, 200));
    check("研发移动端不含协同池任务", !/Boston office demo|Field failure triage/.test(rd?.body ?? ""));

    await p.close();

    // L2 自动跳的工作区感知：移动视口访问协同桌面路由必须落到 /us-collab-m（曾有跳错研发移动端的 bug）。
    // 视口判定用 min(innerWidth, screen.width)：全局 min-width:1024 会把 innerWidth 撑到 1024，
    // 判定靠 Emulation 模拟的 screen.width=390 生效——不再需要 override，验证的是真实逻辑。
    const pr = await newPage(c, { mobile: true });
    await pr.goto(`${BASE}/us-collab-cockpit`, 5000);
    const redirect = await pr.evalJs(`(() => ({ url: location.pathname, title: document.body.innerText.includes("协同任务驾驶舱") }))()`);
    check("移动视口访问协同驾驶舱 → 跳协同移动端", redirect?.url === "/us-collab-m" && redirect?.title, `url=${redirect?.url}`);
    await pr.goto(`${BASE}/rd-task-management`, 5000);
    const redirect2 = await pr.evalJs(`location.pathname`);
    check("移动视口访问研发驾驶舱 → 跳研发移动端", redirect2 === "/m", `url=${redirect2}`);
    await pr.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n════ 浏览器层汇总: ${results.length - fails.length}/${results.length} 通过 ════`);
  if (fails.length) for (const f of fails) console.log(`  FAIL: ${f.name}`);
  c.close();
  process.exitCode = fails.length ? 1 : 0;
} finally {
  chrome.kill();
}
