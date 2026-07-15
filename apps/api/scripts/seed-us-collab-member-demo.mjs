// 给指定登录用户灌「协同工作台」演示数据（中美协同池 rdws.us-collab.*）：
//   - 主责任务 8 条（进行中/待审核/已完成/挂起，含今日与近期截止 → 工作台主责/今日待办有内容）
//   - 现有任务 3 条追加其为协作人（工作台「协作任务」有内容）
//   - 进度留痕若干（含今天的留痕 → 可点「立即汇总」生成日报）
//   - 通知 3 条（通知中心/顶栏铃铛有内容；消息为全局池，任意页面可见）
//
// 用法（仓库根目录）：
//   node apps/api/scripts/seed-us-collab-member-demo.mjs                    # 默认 --username zhangshilin
//   node apps/api/scripts/seed-us-collab-member-demo.mjs --username xxx
//   node apps/api/scripts/seed-us-collab-member-demo.mjs --force            # 重灌（先清除本脚本旧数据）
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(__dirname, "..");
if (!process.env.DATABASE_URL) {
  const env = readFileSync(join(apiRoot, ".env"), "utf8");
  process.env.DATABASE_URL = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
}
// 生产闸门：演示数据只进本地库（同 seed-us-collab-demo.mjs，说明见彼处）
{
  const dbHost = (() => {
    try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ""; }
  })();
  const isLocalDb = dbHost === "localhost" || dbHost === "127.0.0.1" || dbHost === "::1";
  if (process.env.ALLOW_DEMO_SEED !== "1" && (!isLocalDb || process.env.NODE_ENV === "production")) {
    console.error(`✗ 拒绝执行：演示数据脚本只应写本地开发库（当前数据库主机「${dbHost || "未知"}」）。确认请加 ALLOW_DEMO_SEED=1。`);
    process.exit(1);
  }
}

const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const FORCE = process.argv.includes("--force");
const usernameArg = process.argv.indexOf("--username");
const USERNAME = usernameArg > -1 ? process.argv[usernameArg + 1] : "zhangshilin";

const TASK_PREFIX = "pzdemo-"; // 本脚本产生的任务/留痕/消息统一前缀，便于识别与重灌清理
const now = new Date();
const day = (offset) => { const d = new Date(now); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const iso = (offsetDays, hour = 10) => { const d = new Date(now); d.setDate(d.getDate() + offsetDays); d.setHours(hour, 15, 0, 0); return d.toISOString(); };

async function readKey(key) {
  const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}
async function writeKey(key, value) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { category: "research-development", key, value, description: `US-Collab member demo seed: ${key}` },
    update: { value },
  });
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { username: USERNAME },
    select: { id: true, name: true },
  });
  if (!user) throw new Error(`未找到用户名为 ${USERNAME} 的启用用户`);
  const OWNER = user.name;
  const OWNER_ID = user.id;
  console.log(`目标用户：${OWNER}（${OWNER_ID}）`);

  const collabOf = (name, role, userId = null) => ({ id: `co-${name}`, name, role, user_id: userId });
  const meAsCollab = collabOf(OWNER, "US Ops Support", OWNER_ID);

  const task = (n, title, status, progress, priority, dueOffset, extra = {}) => ({
    task_id: `${TASK_PREFIX}${String(n).padStart(3, "0")}`,
    title,
    description: extra.description ?? "",
    primary_owner: OWNER,
    primary_owner_user_id: OWNER_ID,
    collaborators: extra.collaborators ?? [],
    status,
    progress,
    ai_priority: priority,
    final_priority: priority,
    category_path: extra.category_path ?? "",
    archived: false,
    attachments: 0,
    start_date: day(dueOffset - 10),
    due_date: day(dueOffset),
    updated_at: iso(-1, 16),
    subtasks: [],
  });

  // ── 1. 主责任务：挂到新系统「Customer & Field Support」+ 现有两个系统 ─────────
  const supportTasks = [
    task(1, "Boston office demo unit setup", "in_progress", 55, "high", 0, {
      category_path: "Customer & Field Support / On-site",
      description: "Prepare two demo units for the Boston clinic visit. Due today.",
      collaborators: [collabOf("Mike Johnson", "Hardware Lead")],
    }),
    task(2, "Field failure triage workflow (draft SOP)", "in_progress", 30, "high", 1, {
      category_path: "Customer & Field Support / On-site",
      collaborators: [collabOf("王强", "结构支持")],
    }),
    task(3, "Customer feedback digest — June", "pending_review", 95, "medium", 2, {
      category_path: "Customer & Field Support / Feedback",
      description: "Monthly digest compiled, waiting for Emily's review.",
    }),
    task(4, "Spare parts inventory reconciliation", "in_progress", 40, "medium", 7, {
      category_path: "Customer & Field Support / Feedback",
    }),
    task(5, "Warranty policy localization (US)", "on_hold", 10, "low", 14, {
      category_path: "Customer & Field Support / Feedback",
      description: "On hold until legal review capacity frees up.",
    }),
  ];
  const fdaTasks = [
    task(6, "FDA facility registration renewal", "in_progress", 65, "high", 3, {
      category_path: "FDA Compliance / Documentation",
      collaborators: [collabOf("Emily Zhang", "PM")],
    }),
    task(7, "Adverse event reporting dry-run", "completed", 100, "medium", -3, {
      category_path: "FDA Compliance / Verification",
    }),
  ];
  const localTasks = [
    task(8, "US warehouse inbound QC checklist", "completed", 100, "medium", -6, {
      category_path: "US Market Localization / Hardware Adaptation",
    }),
  ];

  const cats = (await readKey("rdws.us-collab.taskCategories")) ?? [];
  if (!Array.isArray(cats) || cats.length === 0) {
    throw new Error("协同任务树为空，请先运行 seed-us-collab-demo.mjs");
  }
  const alreadySeeded = JSON.stringify(cats).includes(TASK_PREFIX);
  if (alreadySeeded && !FORCE) {
    console.log("检测到已有本脚本数据（pzdemo-*），--force 可重灌。跳过任务/留痕/消息写入。");
    return;
  }

  const stripMine = (tasks) => tasks.filter((t) => !String(t.task_id ?? "").startsWith(TASK_PREFIX));
  const stripCollab = (t) => ({
    ...t,
    collaborators: (t.collaborators ?? []).filter((c) => c?.user_id !== OWNER_ID && c?.name !== OWNER),
  });
  for (const cat of cats) {
    for (const sub of cat.children ?? []) {
      sub.tasks = stripMine(sub.tasks ?? []).map(stripCollab);
    }
  }
  // 移除旧的支持系统（重灌）后重建
  const withoutSupport = cats.filter((c) => c.id !== "uscat-support");
  const supportCategory = {
    id: "uscat-support",
    label: "Customer & Field Support",
    children: [
      { id: "uscat-support-onsite", label: "On-site", tasks: supportTasks.slice(0, 2) },
      { id: "uscat-support-feedback", label: "Feedback", tasks: supportTasks.slice(2) },
    ],
  };
  for (const cat of withoutSupport) {
    for (const sub of cat.children ?? []) {
      if (sub.id === "uscat-fda-doc") sub.tasks.push(fdaTasks[0]);
      if (sub.id === "uscat-fda-test") sub.tasks.push(fdaTasks[1]);
      if (sub.id === "uscat-local-hw") sub.tasks.push(localTasks[0]);
      // 追加为现有任务的协作人（协作任务视角）
      for (const t of sub.tasks) {
        if (["ustask-001", "ustask-004", "ustask-007"].includes(t.task_id)) {
          t.collaborators = [...(t.collaborators ?? []), meAsCollab];
        }
      }
    }
  }
  const nextCats = [...withoutSupport, supportCategory];
  await writeKey("rdws.us-collab.taskCategories", nextCats);
  console.log(`✓ 主责任务 8 条 + 协作任务 3 条（协同任务树）`);

  // ── 2. 进度留痕（含今天的 → 可立即汇总日报）────────────────────────────────
  const actor = { id: OWNER_ID, name: OWNER, role: "US Ops Support" };
  const note = (taskId, text, progress, offsetDays, hour) => ({
    id: `note-${TASK_PREFIX}${taskId}-${offsetDays}-${hour}`,
    task_id: taskId,
    text,
    progress,
    attachments: [],
    actor,
    created_at: iso(offsetDays, hour),
  });
  const noteMap = (await readKey("rdws.us-collab.taskProgressNotes")) ?? {};
  for (const key of Object.keys(noteMap)) {
    noteMap[key] = (noteMap[key] ?? []).filter((n) => !String(n?.id ?? "").includes(TASK_PREFIX));
    if (noteMap[key].length === 0) delete noteMap[key];
  }
  const newNotes = [
    note(`${TASK_PREFIX}001`, "Two demo units unpacked and firmware flashed to v2.3.1. Battery calibration in progress.", 55, 0, 9),
    note(`${TASK_PREFIX}001`, "Confirmed clinic visit schedule with Mike; transport booked.", 40, -1, 15),
    note(`${TASK_PREFIX}002`, "Drafted triage flow chart; waiting for 王强's structural failure categories.", 30, 0, 11),
    note(`${TASK_PREFIX}003`, "June digest compiled (42 feedback items, 5 escalations). Submitted for Emily's review.", 95, -1, 17),
    note(`${TASK_PREFIX}004`, "Counted rack A/B; 3 SKUs mismatch found against ERP records.", 40, -2, 14),
    note(`${TASK_PREFIX}006`, "Renewal forms filled; waiting for facility contact confirmation.", 65, -1, 10),
    note(`${TASK_PREFIX}007`, "Dry-run completed. Median reporting time 2.4h, all steps documented.", 100, -3, 16),
    note(`${TASK_PREFIX}008`, "QC checklist finalized and shared with warehouse team.", 100, -6, 13),
    note("ustask-001", `Reviewed submission package section 3 as collaborator (${OWNER}).`, undefined, 0, 12),
  ];
  for (const n of newNotes) {
    noteMap[n.task_id] = [n, ...(noteMap[n.task_id] ?? [])].slice(0, 100);
  }
  await writeKey("rdws.us-collab.taskProgressNotes", noteMap);
  console.log(`✓ 进度留痕 ${newNotes.length} 条（含今日 3 条）`);

  // ── 3. 通知（全局消息池 rd.messages，按 recipient_id 过滤）────────────────────
  const msg = (n, senderName, subject, body, offsetDays, hour) => ({
    id: `msg-${TASK_PREFIX}${n}`,
    sender_id: null,
    sender_name: senderName,
    sender_role: "协同成员",
    recipient_id: OWNER_ID,
    recipient_person_id: null,
    recipient_name: OWNER,
    subject,
    body,
    read: false,
    created_at: iso(offsetDays, hour),
  });
  const messages = ((await readKey("rd.messages")) ?? []).filter(
    (m) => !String(m?.id ?? "").includes(TASK_PREFIX),
  );
  const newMessages = [
    msg(1, "Emily Zhang", "Review reminder", "June customer feedback digest is pending your final numbers check before I sign off.", 0, 9),
    msg(2, "Mike Johnson", "Collaboration invite", "Added you as collaborator on '110V power module adaptation' — need ops input on field install constraints.", -1, 14),
    msg(3, "系统", "任务转派", "「FDA facility registration renewal」已指派给你，截止 " + day(3) + "。", -1, 9),
  ];
  await writeKey("rd.messages", [...newMessages, ...messages].slice(0, 5000));
  console.log(`✓ 通知 ${newMessages.length} 条（全局消息池）`);

  console.log(`完成。用 ${OWNER} 登录后打开 /us-collab-workspace 查看主责/协作/今日待办/通知。`);
}

main()
  .catch((err) => { console.error("seed 失败：", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
