// 操作手册配图生成器：对中美协同三页（驾驶舱/工作台/知识库）按中英双语各截一套图，
// 输出到 public/manual-shots/。UI 改版后重跑本脚本即可刷新手册配图。
//
// 依赖：
//   1) 后端在 http://localhost:3000（读 apps/api/.env 的 JWT_SECRET 自签超管 token 免密登录）
//   2) 前端 dev server（必须是 dev，preview 不带 /api 代理）；默认 http://localhost:5290
//   3) 协同池已有演示数据：node apps/api/scripts/seed-us-collab-demo.mjs
//   4) 本机 Chrome
//
// 用法（仓库根目录）：
//   npx vite --port 5290 --strictPort &
//   node apps/api/scripts/seed-us-collab-demo.mjs
//   node apps/api/scripts/shoot-manual-screens.mjs
//   ORIGIN=http://localhost:5290 node apps/api/scripts/shoot-manual-screens.mjs   # 换端口
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiRoot, "..", "..");
const OUT_DIR = join(repoRoot, "public", "manual-shots");
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5290";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CDP_PORT = 9224;
const PROFILE = `${process.env.TEMP ?? "/tmp"}/manual-shots-${Date.now()}`;

// 超管自签 token：与 seed-i18n-en.mjs 同法，避免脚本依赖交互登录
const env = readFileSync(join(apiRoot, ".env"), "utf8");
const SECRET = env.match(/^JWT_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1] ?? "change-me-jwt-secret";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const nowSec = Math.floor(Date.now() / 1000);
const head = b64url({ alg: "HS256", typ: "JWT" });
const payload = b64url({ sub: "cmra7pb6w0026u7w411wrhk7w", permissions: ["*"], iat: nowSec, exp: nowSec + 3600 });
const TOKEN = `${head}.${payload}.${createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url")}`;

/**
 * 每张图 = 一个截图任务；marks 是叠加在图上的编号圆点，手册正文用同样的编号讲解。
 *
 * 坐标按 1600px 宽视口硬编码：中英两套布局位置完全一致（只有文案不同），故一套坐标通吃。
 * 改版后若标记错位，重跑本脚本看图微调 marks 的 x/y 即可——刻意不做选择器锚定：
 * 选择器同样会随改版失效，却更难一眼看出错在哪。
 */
const SHOTS = [
  {
    id: "cockpit-overview", route: "/us-collab-cockpit", wait: 4000, full: true, maxHeight: 1400,
    // ②③④⑤ 落在侧边栏与内容区之间的空白槽（x≈316），避免压住数字和图标
    marks: [
      { n: 1, x: 1042, y: 134 }, // 页头工具栏（导出 / 批量转派 / 人员管理 / AI 立项）
      { n: 2, x: 316, y: 220 },  // 六格统计
      { n: 3, x: 316, y: 309 },  // 今日日报
      { n: 4, x: 316, y: 406 },  // 按人筛选头像行
      { n: 5, x: 316, y: 500 },  // 任务卡片
    ],
  },
  {
    id: "workspace-overview", route: "/us-collab-workspace", wait: 4000, full: true, maxHeight: 1400,
    marks: [
      { n: 1, x: 316, y: 156 },  // 我的任务统计条
      { n: 2, x: 316, y: 230 },  // 搜索 + 视图/筛选
      { n: 3, x: 316, y: 300 },  // 任务卡片（最新进度 / 进度条）
      { n: 4, x: 1186, y: 228 }, // 通知中心
      { n: 5, x: 1380, y: 156 }, // AI 立项
    ],
  },
  {
    id: "kb-overview", route: "/us-collab-kb", wait: 4000, full: true, maxHeight: 1400,
    marks: [
      { n: 1, x: 316, y: 156 },  // 筛选（标题/类型/权限分）
      { n: 2, x: 1478, y: 122 }, // 上传文件
      { n: 3, x: 1352, y: 122 }, // 成员权限
      { n: 4, x: 316, y: 232 },  // 知识域（分类）
      { n: 5, x: 828, y: 482 },  // 条目卡片右下角的密级分（协同库特有，决定谁看得到）
    ],
  },

  // ── 弹窗 / 抽屉：手册「深入」小节的配图 ────────────────────────────────────
  // 这些图靠 actions 点开界面再截，并 clip 到弹窗自身范围（整页截会让弹窗只占一小块看不清）。
  // clickText 的候选文案按语言给：截 zh 用中文锚点，截 en 用英文锚点。
  {
    id: "workspace-progress",
    route: "/us-collab-workspace",
    wait: 4500,
    actions: [
      // 演示数据里第一张卡是进行中任务（标题是英文，中英两态一致，可直接当锚点）
      { click: { zh: ["Boston office demo unit setup"], en: ["Boston office demo unit setup"] }, wait: 2200 },
      { click: { zh: ["更新进度"], en: ["Update Progress"] }, wait: 1800 },
    ],
    clipTo: "drawer",
    // 坐标以抽屉左上角为原点（clip 后图里的位置 = 这里的值 + 10px 的 pad）
    relMarks: [
      { n: 1, x: 14, y: 96 },   // 四个 Tab
      { n: 2, x: 14, y: 150 },  // 三步流程条
      { n: 3, x: 14, y: 336 },  // 人工确认进度滑块
      { n: 4, x: 14, y: 434 },  // 进展说明（@提及 / 粘贴截图）
      { n: 5, x: 14, y: 546 },  // 附件区
      { n: 6, x: 434, y: 626 }, // AI 解析 / 保存进度
    ],
  },
  {
    id: "cockpit-kickoff",
    route: "/us-collab-cockpit",
    wait: 4500,
    actions: [{ click: { zh: ["AI 立项"], en: ["AI Kickoff"] }, wait: 2200 }],
    clipTo: "dialog",
    relMarks: [
      { n: 1, x: 380, y: 28 },  // 第 N/4 步
      { n: 2, x: 12, y: 100 },  // 标题（可留空）
      { n: 3, x: 12, y: 228 },  // 立项描述
      { n: 4, x: 12, y: 362 },  // 上传附件
    ],
  },
  {
    id: "cockpit-reassign",
    route: "/us-collab-cockpit",
    wait: 4500,
    actions: [{ click: { zh: ["批量转派"], en: ["Batch Reassign"] }, wait: 2200 }],
    clipTo: "dialog",
    relMarks: [
      { n: 1, x: 12, y: 122 },  // 搜索 + 负责人 / 优先级筛选
      { n: 2, x: 12, y: 200 },  // 勾选任务
      { n: 3, x: 12, y: 496 },  // 选目标负责人（负载显示）
      { n: 4, x: 372, y: 782 }, // 确认转派
    ],
  },
  {
    id: "kb-upload",
    route: "/us-collab-kb",
    wait: 4000,
    actions: [{ click: { zh: ["上传文件"], en: ["Upload Files"] }, wait: 2000 }],
    clipTo: "dialog",
  },
  {
    id: "kb-member-levels",
    route: "/us-collab-kb",
    wait: 4000,
    actions: [{ click: { zh: ["成员权限"], en: ["Member Access"] }, wait: 2000 }],
    clipTo: "dialog",
    relMarks: [
      { n: 1, x: 12, y: 48 },   // 规则说明（谁能看到什么）
      { n: 2, x: 12, y: 112 },  // 搜人
      { n: 3, x: 386, y: 176 }, // 每人的分值输入框
    ],
  },
  {
    // 任务全屏详情页：直接给路由，不用点（演示数据里的任务号）
    id: "task-detail",
    route: "/us-collab-task/ustask-001",
    wait: 5000,
    full: true,
    maxHeight: 1250,
  },
];

/**
 * 手册页当前锁定中文（见 src/app/ManualPage.tsx 顶部说明），故只出中文图。
 * 内容定稿要做英文时改回 ["zh", "en"] 重跑即可——脚本的双语能力（clickText 的 en 锚点）都还在。
 */
const LANGS = ["zh"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--no-first-run",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1600,1000",
  "about:blank",
], { stdio: "ignore" });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chrome 还没起来 */ }
    await sleep(250);
  }
  throw new Error("CDP 未就绪：确认 Chrome 路径是否正确（可用 CHROME=... 覆盖）");
}

const ws = new WebSocket(await getWsUrl());
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");

mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const lang of LANGS) {
  // 伪会话注入必须在导航前挂到「每个新文档」上：token 是真的，/api 走 dev server 代理打到真实后端
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
if (location.origin === '${ORIGIN}') {
  try {
    localStorage.setItem('inogi-access-token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('inogi-refresh-token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('inogi-lang', '${lang}');
  } catch {}
  // 强制桌面宽：手册配图要桌面版布局，避免窄屏被路由到移动端
  Object.defineProperty(window, 'innerWidth', { get: () => 1600 });
  // 只桩掉语言偏好这一个端点：initI18n() 拉服务端偏好会覆盖 localStorage 缓存，
  // 截图账号的服务端偏好是 zh，不桩的话英文那套会整页出中文。其余请求全部打真实后端。
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/i18n/preference')) {
      if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
        // 切语言的写请求同样拦下，避免脚本改掉真实账号的偏好
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ lang: '${lang}' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return _fetch(input, init);
  };
}`,
  });

  for (const shot of SHOTS) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${ORIGIN}${shot.route}` });

    // 等真实数据渲染（不是等固定时间：先等根节点有内容，再给数据请求补时间）
    for (let i = 0; i < 80; i++) {
      const len = await evalJs("document.querySelector('#root')?.innerText.length ?? 0");
      if (len > 300) break;
      await sleep(400);
    }
    await sleep(shot.wait ?? 3000);

    // 点开弹窗/抽屉。按可见文案找按钮——本项目按钮没有 data-testid，文案是唯一稳定锚点；
    // 找不到就直接报错而不是静默截一张没弹窗的图。
    let actionFailed = false;
    for (const act of shot.actions ?? []) {
      const cands = act.click[lang] ?? act.click.zh;
      const hit = await evalJs(`(() => {
        const cands = ${JSON.stringify(cands)};
        // 同样别用 offsetParent 判可见（fixed 容器里的元素会误判），用 rect
        const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const clickable = [...document.querySelectorAll('button, a, [role="tab"], [role="button"]')].filter(shown);
        for (const text of cands) {
          const el = clickable.find((e) => (e.innerText || '').trim().includes(text));
          if (el) { el.click(); return 'btn:' + text; }
          // 不是按钮的可点区域（如任务卡片）：找含该文案的最小元素，点它让事件冒泡到卡片的 onClick
          const any = [...document.querySelectorAll('h3, h4, div, span')]
            .filter((e) => shown(e) && (e.innerText || '').trim().includes(text))
            .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
          if (any) { any.click(); return 'el:' + text; }
        }
        return 'MISS';
      })()`);
      if (hit === "MISS") {
        console.error(`  ✗ ${shot.id}[${lang}] 点不到「${cands.join(" / ")}」——界面文案可能改了，跳过此图`);
        actionFailed = true;
        break;
      }
      await sleep(act.wait ?? 1500);
    }
    if (actionFailed) continue;

    // 弹窗类图的编号：坐标按「弹窗左上角为原点」给（relMarks），脚本换算成整页坐标再叠。
    // 弹窗每次弹出的位置由居中算法决定、随内容高度浮动，写死整页坐标会漂。
    if (shot.relMarks?.length) {
      const origin = await evalJs(`(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 80; };
        const radix = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
        let el = radix[radix.length - 1];
        if (!el) {
          const overlays = [...document.querySelectorAll('.fixed.inset-0')];
          for (const ov of overlays.reverse()) {
            const kid = [...ov.children].filter(visible)[0];
            if (kid) { el = kid; break; }
          }
        }
        if (!el) return 'NONE';
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.x, y: r.y });
      })()`);
      if (origin !== "NONE") {
        const o = JSON.parse(origin);
        shot.marks = shot.relMarks.map((m) => ({ n: m.n, x: Math.round(o.x + m.x), y: Math.round(o.y + m.y) }));
      }
    }

    // 叠编号圆点：position:fixed + 下面把视口高度设成整页高度，故 fixed 坐标即整页坐标
    if (shot.marks?.length) {
      await evalJs(`(() => {
        document.getElementById('__manual_marks')?.remove();
        const box = document.createElement('div');
        box.id = '__manual_marks';
        box.innerHTML = ${JSON.stringify(shot.marks)}.map((m) => \`
          <div style="position:fixed;left:\${m.x}px;top:\${m.y}px;z-index:2147483647;
            width:26px;height:26px;border-radius:50%;background:#e11d48;color:#fff;
            border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);
            font:700 14px/22px system-ui,sans-serif;text-align:center;">\${m.n}</div>\`).join('');
        document.body.appendChild(box);
      })()`);
    }

    let params = { format: "png" };
    if (shot.clipTo) {
      // 裁到弹窗/抽屉本身：整页截的话弹窗只占中间一小块，缩进正文后就看不清了。
      // Radix 的弹窗/抽屉都带 role=dialog；取可见的最后一个（最上层那个）。
      // ⚠️ 可见性不能用 offsetParent：position:fixed 元素的 offsetParent 恒为 null，
      // 弹窗全是 fixed，那样判会把它们全过滤掉。一律用 bounding rect。
      // 本项目弹窗有两种实现：Radix（有 role=dialog）和手写（.fixed.inset-0 遮罩里套内容卡）。
      const box = await evalJs(`(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 80; };
        const radix = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
        let el = radix[radix.length - 1];
        if (!el) {
          // 手写弹窗：取全屏遮罩里的内容卡（遮罩本身是整屏，截了没意义）
          const overlays = [...document.querySelectorAll('.fixed.inset-0')];
          for (const ov of overlays.reverse()) {
            const kid = [...ov.children].filter(visible)[0];
            if (kid) { el = kid; break; }
          }
        }
        if (!el) return 'NONE';
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
      })()`);
      if (box === "NONE") {
        console.error(`  ✗ ${shot.id}[${lang}] 没找到弹窗（点击后界面没弹出？），跳过`);
        continue;
      }
      const r = JSON.parse(box);
      const pad = 10;
      params.clip = {
        x: Math.max(0, r.x - pad),
        y: Math.max(0, r.y - pad),
        width: Math.min(1600 - Math.max(0, r.x - pad), r.width + pad * 2),
        height: r.height + pad * 2,
        scale: 1,
      };
      params.captureBeyondViewport = true;
    } else if (shot.full) {
      const height = Math.min(
        shot.maxHeight ?? 2400,
        (await evalJs("Math.max(document.body.scrollHeight, ...[...document.querySelectorAll('*')].map(e=>e.scrollHeight))")) || 1000,
      );
      await send("Emulation.setDeviceMetricsOverride", { width: 1600, height, deviceScaleFactor: 1, mobile: false });
      await sleep(700);
      params.captureBeyondViewport = true;
    } else if (shot.clip) {
      const box = await evalJs(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(shot.clip)})[${shot.nth ?? 0}];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
      })()`);
      if (box) {
        const r = JSON.parse(box);
        const pad = shot.pad ?? 0;
        params.clip = {
          x: Math.max(0, r.x - pad),
          y: Math.max(0, r.y - pad),
          width: Math.min(1600, r.width + pad * 2),
          height: r.height + pad * 2,
          scale: 1,
        };
      } else {
        console.warn(`  ! ${shot.id}[${lang}] 选择器未命中，退回首屏视口`);
      }
    }

    const res = await send("Page.captureScreenshot", params);
    if (!res.result?.data) {
      console.error(`  ✗ ${shot.id}[${lang}] 截图失败`);
      continue;
    }
    const file = join(OUT_DIR, `${shot.id}-${lang}.png`);
    const buf = Buffer.from(res.result.data, "base64");
    writeFileSync(file, buf);
    written += 1;
    console.log(`  ✓ ${shot.id}-${lang}.png  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

console.log(`\n完成：${written} 张图 → public/manual-shots/`);
chrome.kill();
process.exit(0);
