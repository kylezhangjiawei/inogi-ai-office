// 中美协同模块演示数据 seed 脚本。
// 往协同工作区（rdws.us-collab.*）与协同知识库（deptkb.us-collab.*）灌 mock 数据：
//   - 人员池：美方成员 4 名 + 中方支持 2 名（含知识库分值）
//   - 任务树：2 个系统 × 2 子项，共 8 条任务（覆盖进行中/待审核/已完成/阻塞/待指派/逾期）
//   - 知识库：3 个分类 + 4 条链接型条目（含不同密级，配合成员分值过滤演示）
//
// 用法（在仓库根目录）：
//   node apps/api/scripts/seed-us-collab-demo.mjs          # 目标键已有数据时跳过
//   node apps/api/scripts/seed-us-collab-demo.mjs --force  # 覆盖已有演示数据
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(__dirname, "..");

// 从 apps/api/.env 读取 DATABASE_URL（prisma client 依赖该环境变量）
if (!process.env.DATABASE_URL) {
  const env = readFileSync(join(apiRoot, ".env"), "utf8");
  const match = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!match) throw new Error("apps/api/.env 中未找到 DATABASE_URL");
  process.env.DATABASE_URL = match[1];
}

const require = createRequire(join(apiRoot, "package.json"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const FORCE = process.argv.includes("--force");
const CATEGORY = "research-development";
const now = new Date();
const day = (offset) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const iso = (offsetDays) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
};

// ── 人员池（美方 4 + 中方支持 2）────────────────────────────────────────────────
const people = [
  { id: "uscp-mike", name: "Mike Johnson", position: "Hardware Lead", department: "US Team", max_tasks: 8, kb_level: 80, kb_level_scale: "score", status: "active" },
  { id: "uscp-sarah", name: "Sarah Chen", position: "Firmware Engineer", department: "US Team", max_tasks: 8, kb_level: 60, kb_level_scale: "score", status: "active" },
  { id: "uscp-david", name: "David Miller", position: "Test Engineer", department: "US Team", max_tasks: 6, kb_level: 40, kb_level_scale: "score", status: "active" },
  { id: "uscp-emily", name: "Emily Zhang", position: "Product Manager", department: "US Team", max_tasks: 6, kb_level: 60, kb_level_scale: "score", status: "active" },
  { id: "uscp-wangqiang", name: "王强", position: "结构工程师（中方支持）", department: "中国研发支持", max_tasks: 8, kb_level: 60, kb_level_scale: "score", status: "active" },
  { id: "uscp-lixue", name: "李雪", position: "电子工程师（中方支持）", department: "中国研发支持", max_tasks: 8, kb_level: 60, kb_level_scale: "score", status: "active" },
];

// ── 任务树（RdCategory[] → children RdSubProject[] → tasks RdTask[]）────────────
const task = (id, title, owner, status, progress, priority, dueOffset, extra = {}) => ({
  task_id: id,
  title,
  description: extra.description ?? "",
  primary_owner: owner,
  primary_owner_user_id: null,
  collaborators: extra.collaborators ?? [],
  status,
  progress,
  ai_priority: priority,
  final_priority: priority,
  category_path: extra.category_path ?? "",
  archived: false,
  attachments: 0,
  start_date: day(dueOffset - 14),
  due_date: day(dueOffset),
  updated_at: iso(-1),
  subtasks: [],
});

const collabOf = (name, role) => ({ id: `co-${name}`, name, role, user_id: null });

const taskCategories = [
  {
    id: "uscat-fda",
    label: "FDA Compliance",
    children: [
      {
        id: "uscat-fda-doc",
        label: "Documentation",
        tasks: [
          task("ustask-001", "FDA 510(k) submission package review", "Emily Zhang", "in_progress", 60, "high", 6, {
            category_path: "FDA Compliance / Documentation",
            description: "Compile and review the 510(k) premarket submission package with the China regulatory team.",
            collaborators: [collabOf("王强", "结构支持")],
          }),
          task("ustask-002", "IEC 60601-1 test report localization", "David Miller", "pending_review", 90, "medium", 2, {
            category_path: "FDA Compliance / Documentation",
            description: "Translate and adapt the safety test reports for FDA reviewers.",
          }),
        ],
      },
      {
        id: "uscat-fda-test",
        label: "Verification",
        tasks: [
          task("ustask-003", "EMC pre-scan at US lab (FCC Part 15)", "David Miller", "in_progress", 30, "high", -2, {
            category_path: "FDA Compliance / Verification",
            description: "Overdue: waiting for lab slot confirmation.",
          }),
          task("ustask-004", "Altitude performance validation (5000ft)", "Sarah Chen", "paused_blocked", 20, "medium", 10, {
            category_path: "FDA Compliance / Verification",
            description: "Blocked on compressor sample shipment from Suzhou.",
            collaborators: [collabOf("李雪", "电子支持")],
          }),
        ],
      },
    ],
  },
  {
    id: "uscat-local",
    label: "US Market Localization",
    children: [
      {
        id: "uscat-local-hw",
        label: "Hardware Adaptation",
        tasks: [
          task("ustask-005", "110V power module adaptation", "Mike Johnson", "in_progress", 45, "high", 8, {
            category_path: "US Market Localization / Hardware Adaptation",
            collaborators: [collabOf("李雪", "电子支持")],
          }),
          task("ustask-006", "UL-listed enclosure material sourcing", "Mike Johnson", "completed", 100, "medium", -5, {
            category_path: "US Market Localization / Hardware Adaptation",
          }),
        ],
      },
      {
        id: "uscat-local-fw",
        label: "Firmware & UI",
        tasks: [
          task("ustask-007", "English voice prompt package v2", "Sarah Chen", "in_progress", 70, "medium", 4, {
            category_path: "US Market Localization / Firmware & UI",
          }),
          task("ustask-008", "Imperial units display toggle", "Sarah Chen", "pending_assign", 0, "low", 15, {
            category_path: "US Market Localization / Firmware & UI",
          }),
        ],
      },
    ],
  },
];

// ── 协同知识库（分类 + 链接型条目；密级配合成员分值过滤演示）────────────────────
const kbCategories = [
  { id: "kb-other", label: "其他", icon: "FolderOpen", color: "#94a3b8", order: 1, children: [] },
  { id: "uskb-reg", label: "Regulatory / 法规", icon: "ShieldCheck", color: "#0ea5e9", order: 2, children: [] },
  { id: "uskb-eng", label: "Engineering / 工程", icon: "Cpu", color: "#8b5cf6", order: 3, children: [] },
  { id: "uskb-meeting", label: "Sync Minutes / 例会纪要", icon: "FileText", color: "#f59e0b", order: 4, children: [] },
];

const kbEntry = (id, title, categoryId, level, description, url) => ({
  id,
  title,
  description,
  category_id: categoryId,
  tags: [],
  permission_level: level,
  visibility: level >= 50 ? "restricted" : level > 0 ? "internal" : "public",
  source: "manual",
  source_task_id: null,
  source_task_title: null,
  file_name: null,
  file_type: null,
  file_size: null,
  data_url: null,
  oss_url: null,
  external_url: url,
  view_count: 0,
  download_count: 0,
  created_by_id: null,
  created_by_name: "Emily Zhang",
  created_at: iso(-3),
  updated_at: iso(-3),
});

const kbEntries = [
  kbEntry("uskb-e1", "FDA 510(k) Submission Checklist", "uskb-reg", 0, "Public checklist for the premarket submission workflow.", "https://www.fda.gov/medical-devices/premarket-submissions/premarket-notification-510k"),
  kbEntry("uskb-e2", "US-CN Weekly Sync Minutes (latest)", "uskb-meeting", 20, "Internal weekly sync notes between US team and China R&D support.", "https://example.com/us-collab/minutes/latest"),
  kbEntry("uskb-e3", "110V Power Module Design Spec v1.2", "uskb-eng", 40, "Engineering spec for the 110V adaptation (internal).", "https://example.com/us-collab/specs/power-110v"),
  kbEntry("uskb-e4", "Core Compressor Cost Breakdown (confidential)", "uskb-eng", 80, "Restricted: cost structure shared with leads only.", "https://example.com/us-collab/confidential/compressor-cost"),
];

// ── 写入 ───────────────────────────────────────────────────────────────────────
const SEEDS = [
  { key: "rdws.us-collab.people", value: people, label: "协同人员池（6 人）" },
  { key: "rdws.us-collab.taskCategories", value: taskCategories, label: "协同任务树（2 系统 / 8 任务）" },
  { key: "deptkb.us-collab.knowledgeCategories", value: kbCategories, label: "协同知识库分类（4 类）" },
  { key: "deptkb.us-collab.knowledgeEntries", value: kbEntries, label: "协同知识库条目（4 条）" },
];

async function main() {
  for (const seed of SEEDS) {
    const existing = await prisma.systemSetting.findUnique({ where: { key: seed.key }, select: { value: true } });
    const hasData = Array.isArray(existing?.value) && existing.value.length > 0;
    if (hasData && !FORCE) {
      console.log(`跳过 ${seed.key}（已有 ${existing.value.length} 条数据，--force 可覆盖）`);
      continue;
    }
    await prisma.systemSetting.upsert({
      where: { key: seed.key },
      create: { category: CATEGORY, key: seed.key, value: seed.value, description: `US-Collab demo seed: ${seed.key}` },
      update: { category: CATEGORY, value: seed.value },
    });
    console.log(`✓ 写入 ${seed.label} → ${seed.key}`);
  }
  console.log("完成。打开 /us-collab-cockpit、/us-collab-workspace、/us-collab-kb 查看演示数据。");
}

main()
  .catch((err) => {
    console.error("seed 失败：", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
