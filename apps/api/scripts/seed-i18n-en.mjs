// i18n 英文字典 seed（P0 试点条目 + 核心术语）。可重复执行（merge 模式，同 key 覆盖）。
// 用法：node apps/api/scripts/seed-i18n-en.mjs
// 术语以 docs/i18n-术语表.md 为准；人工调整请走翻译管理页或直接改本表后重放。
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(apiRoot, ".env"), "utf8");
const SECRET = env.match(/^JWT_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1] ?? "change-me-jwt-secret";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64url({ alg: "HS256", typ: "JWT" });
const payload = b64url({ sub: "cmra7pb6w0026u7w411wrhk7w", permissions: ["*"], iat: now, exp: now + 3600 });
const TOKEN = `${head}.${payload}.${createHmac("sha256", SECRET).update(`${head}.${payload}`).digest("base64url")}`;
const BASE = process.env.API_BASE ?? "http://localhost:3000/api";

/** { 中文原文: 英文 }。中文即 key；模板变量 {n}/{name} 原样保留。 */
const DICT = {
  // ── 协同驾驶舱页头（P0 试点）──
  "协同任务驾驶舱": "Collaboration Cockpit",
  "{n} 个活跃任务": "{n} active tasks",
  "{n} 个风险": "{n} at risk",
  "批量转派": "Batch Reassign",
  "人员管理": "Manage People",
  "清空数据": "Clear Data",
  "AI 立项": "AI Kickoff",
  "导出": "Export",
  // ── Stat Strip ──
  "活跃": "Active",
  "完成率": "Completion",
  "进行中": "In Progress",
  "完成": "Done",
  "阻塞/待派": "Blocked / Unassigned",
  "风险": "At Risk",
  // ── 核心术语（术语表初稿同步，冻结前可调）──
  "协同工作台": "Collab Workspace",
  "协同知识库": "Collab Knowledge Base",
  "个人工作台": "My Workspace",
  "任务": "Task",
  "工作项": "Work Item",
  "主责人": "Owner",
  "协作人": "Collaborator",
  "进展留痕": "Progress Log",
  "操作记录": "Activity",
  "附件库": "Attachments",
  "移交任务": "Hand Over",
  "标记完成": "Mark Done",
  "申请放弃": "Request Abandon",
  "待审核": "Pending Review",
  "已完成": "Completed",
  "已阻塞": "Blocked",
  "高优先": "High",
  "中优先": "Medium",
  "低优先": "Low",
  "截止日期": "Due Date",
  "优先级": "Priority",
  "状态": "Status",
  "立项": "Kickoff",
  "审批": "Approval",
  "日报": "Daily Report",
  "月报": "Monthly Report",
  "AI 任务小结": "AI Task Brief",
  "导出过程报告": "Export Report",
  "添加协作人": "Add Collaborator",
  "添加备注": "Add Note",
  "取消": "Cancel",
  "保存": "Save",
  "确认": "Confirm",
  "搜索任务、负责人...": "Search tasks, owners...",
};

const res = await fetch(`${BASE}/i18n/dict/en`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(DICT),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("写入失败:", res.status, JSON.stringify(body));
  process.exit(1);
}
console.log(`✓ 英文字典已写入（本次 ${Object.keys(DICT).length} 条，库中共 ${body.count} 条）`);
