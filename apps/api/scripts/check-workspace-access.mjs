// isWorkspaceAllowed 的纯逻辑回归（零依赖、不连库、不发请求，秒级）。
//
// 为什么单独一份：池级准入是隔离体系的最后一道闸，一旦放宽就是跨池越权，
// 而它的规则有反直觉的一条（跨池特殊码 rd-people:manage 只在「不属于其他池」时放行）。
// 本脚本把 rd-workspace.context.ts 的规则镜像一份并锁死各角色的期望结果。
// ⚠️ 改了 rd-workspace.context.ts 的 WORKSPACE_PAGE_CODES / isWorkspaceAllowed，这里要同步。
//
// 用法：node apps/api/scripts/check-workspace-access.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src/modules/research-development/rd-workspace.context.ts"),
  "utf8",
);

// 从源码里抠出两个常量，避免脚本与实现各写一份码表而悄悄分叉
function extractCodes(varName) {
  const at = src.indexOf(varName);
  if (at < 0) throw new Error(`源码里找不到 ${varName}`);
  const body = src.slice(at, src.indexOf("};", at));
  const out = {};
  for (const m of body.matchAll(/'?([\w-]+)'?\s*:\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return out;
}
const WORKSPACE_PAGE_CODES = extractCodes("WORKSPACE_PAGE_CODES: Record<string, string[]> = {");
// us-collab 的归属码在实现里由展开式拼成，这里显式镜像（含知识库码）
const OWNERSHIP = {
  rd: (WORKSPACE_PAGE_CODES.rd ?? []).filter((c) => c.startsWith("page:")),
  "us-collab": [
    ...(WORKSPACE_PAGE_CODES["us-collab"] ?? []).filter((c) => c.startsWith("page:")),
    "page:dept-kb-us-collab",
  ],
};

function isWorkspaceAllowed(workspace, permissions) {
  if (permissions.includes("*")) return true;
  const codes = WORKSPACE_PAGE_CODES[workspace] ?? [];
  const ownPages = codes.filter((c) => c.startsWith("page:"));
  if (ownPages.some((c) => permissions.includes(c))) return true;
  const specialCodes = codes.filter((c) => !c.startsWith("page:"));
  if (!specialCodes.some((c) => permissions.includes(c))) return false;
  const otherPages = Object.entries(OWNERSHIP)
    .filter(([ws]) => ws !== workspace)
    .flatMap(([, list]) => list);
  return !otherPages.some((c) => permissions.includes(c));
}

const CASES = [
  { who: "超级管理员（*）", perms: ["*"], rd: true, us: true },
  { who: "研发管理员（rd 页面码 + 人员管理）", perms: ["page:rd-task-management", "rd-people:manage"], rd: true, us: false },
  { who: "协同管理员（协同页面码 + 人员管理）", perms: ["page:us-collab-cockpit", "page:us-collab-ai-settings", "rd-people:manage"], rd: false, us: true },
  { who: "协同成员（仅协同页面码）", perms: ["page:us-collab-cockpit", "page:us-collab-workspace"], rd: false, us: true },
  { who: "协同知识库管理员（知识库码 + 人员管理）", perms: ["page:dept-kb-us-collab", "rd-people:manage"], rd: false, us: true },
  { who: "历史角色（仅 rd-people:manage，无任何页面码）", perms: ["rd-people:manage"], rd: true, us: true },
  { who: "只有操作码（无页面码、无特殊码）", perms: ["rd-task:edit", "rd-task:create"], rd: false, us: false },
  { who: "无关页面码（AI 模型管理）", perms: ["page:ai-model-management"], rd: false, us: false },
  { who: "两侧页面码都有", perms: ["page:rd-task-management", "page:us-collab-cockpit"], rd: true, us: true },
  { who: "协同知识库码 + 研发页面码（跨侧兼职）", perms: ["page:dept-kb-us-collab", "page:rd-task-management", "rd-people:manage"], rd: true, us: false },
];

let pass = 0, fail = 0;
console.log("角色".padEnd(40) + "研发池".padEnd(12) + "协同池");
console.log("─".repeat(64));
for (const c of CASES) {
  const rd = isWorkspaceAllowed("rd", c.perms);
  const us = isWorkspaceAllowed("us-collab", c.perms);
  const ok = rd === c.rd && us === c.us;
  ok ? pass++ : fail++;
  const fmt = (got, want) => `${got ? "放行" : "拒绝"}${got === want ? "" : ` ✗应${want ? "放行" : "拒绝"}`}`;
  console.log((ok ? "  " : "✗ ") + c.who.padEnd(38) + fmt(rd, c.rd).padEnd(12) + fmt(us, c.us));
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
