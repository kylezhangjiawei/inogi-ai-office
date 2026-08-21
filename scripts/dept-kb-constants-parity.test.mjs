import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 部门知识库的常量在前后端各有一份：后端是事实源，前端是镜像。
 * 靠注释约定同步已经失败过两次——先是 DEPT_KBS 的 departmentCode 漏填导致部门改名后
 * 标签对不上，后是 LEVEL_FILTERED_DEPT_KB_IDS 漏了 2026-08 新增的 6 个库，
 * 造成「后端按成员分值过滤、前端却不显示『成员权限』按钮」，管理员无从登记分值。
 *
 * 这里把「镜像必须等于源」变成断言：改了后端不同步前端，npm test 直接红。
 */

const backend = readFileSync(
  new URL("../apps/api/src/modules/research-development/dept-knowledge.constants.ts", import.meta.url),
  "utf8",
);
const frontendRoutes = readFileSync(new URL("../src/app/routesConfig.tsx", import.meta.url), "utf8");
const frontendApi = readFileSync(new URL("../src/app/lib/rdApi.ts", import.meta.url), "utf8");

/** 取出 `export const NAME ... [ ... ];` 之间的数组体，并去掉行注释（注释里常有 id 样式的文字）。 */
function arrayBody(source, name) {
  const match = source.match(new RegExp(`export const ${name}\\b[\\s\\S]*?\\[([\\s\\S]*?)\\]\\s*\\)?\\s*;`));
  assert.ok(match, `未能在源码中定位 ${name}`);
  return match[1].replace(/\/\/[^\n]*/g, "");
}

/** 解析 { id, label, departmentCode } 三元组，两边引号风格不同故不限定引号种类。 */
function parseDeptKbs(source) {
  const entries = [];
  const re = /\bid:\s*['"]([^'"]+)['"]\s*,\s*label:\s*['"]([^'"]+)['"]\s*,\s*departmentCode:\s*['"]([^'"]+)['"]/g;
  for (const [, id, label, departmentCode] of arrayBody(source, "DEPT_KBS").matchAll(re)) {
    entries.push(`${id} | ${label} | ${departmentCode}`);
  }
  return entries;
}

function parseIdSet(source, name) {
  return [...arrayBody(source, name).matchAll(/['"]([^'"]+)['"]/g)].map(([, id]) => id);
}

test("前端 DEPT_KBS 与后端逐条一致（id / label / departmentCode）", () => {
  const backendKbs = parseDeptKbs(backend);
  const frontendKbs = parseDeptKbs(frontendRoutes);

  assert.ok(backendKbs.length >= 13, `后端 DEPT_KBS 只解析出 ${backendKbs.length} 条，正则可能已失效`);
  assert.deepEqual(frontendKbs, backendKbs);
});

test("前端 LEVEL_FILTERED_DEPT_KB_IDS 与后端一致，否则该库管理员看不到「成员权限」入口", () => {
  const backendIds = parseIdSet(backend, "LEVEL_FILTERED_DEPT_KB_IDS");
  const frontendIds = parseIdSet(frontendApi, "LEVEL_FILTERED_DEPT_KB_IDS");

  assert.ok(backendIds.length >= 2, `后端只解析出 ${backendIds.length} 个 id，正则可能已失效`);
  assert.deepEqual([...frontendIds].sort(), [...backendIds].sort());
});

test("启用按人分值过滤的库必须都是真实存在的部门库或协同库", () => {
  const deptKbIds = new Set(parseDeptKbs(backend).map((row) => row.split(" | ")[0]));
  for (const id of parseIdSet(backend, "LEVEL_FILTERED_DEPT_KB_IDS")) {
    // us-collab 是中美协同库，不在 DEPT_KBS 里，但同样走部门库那套接口与权限
    assert.ok(deptKbIds.has(id) || id === "us-collab", `LEVEL_FILTERED_DEPT_KB_IDS 含未知库 id：${id}`);
  }
});
