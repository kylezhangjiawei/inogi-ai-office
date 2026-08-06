import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const builtin = await readFile(new URL("../src/app/lib/i18n.ts", import.meta.url), "utf8");
const seed = await readFile(new URL("../apps/api/scripts/seed-i18n-en.mjs", import.meta.url), "utf8");
const workspaceKeys = [
  "按项目文件夹查看",
  "查看全部任务",
  "返回项目文件夹",
  "该项目下没有匹配的任务",
  "项目文件夹",
  "已完成任务",
  "整体进度",
  "我的项目",
  "先进入项目文件夹，再查看和处理分任务",
  "项目任务",
  "没有匹配的项目文件夹",
  "节点立项",
  "当前节点立项",
  "在当前节点下发起立项",
  "任务树最多支持 5 层",
  "本次创建的任务将作为当前节点的直接子任务，并自动继承其产品与分类。",
];

test("project-folder workspace strings have built-in and seeded English translations", () => {
  for (const key of workspaceKeys) {
    const quoted = JSON.stringify(key);
    assert.ok(builtin.includes(quoted), `missing built-in English fallback for: ${key}`);
    assert.ok(seed.includes(quoted), `missing English seed entry for: ${key}`);
  }
});
