import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const helperUrl = new URL("../src/app/lib/rdMemberIdentity.ts", import.meta.url);
const helperSource = await readFile(helperUrl, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: helperUrl.pathname,
}).outputText;
const helperModuleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { isNonPersonTaskOwner, isTaskOwnerMember } = await import(helperModuleUrl);

const directory = [
  { name: "刘至远", user_id: "user-1", status: "active" },
  { name: "新账号成员", user_id: "user-2", status: "active" },
  { name: "杨工", user_id: null, status: "active" },
  { name: "离职成员", user_id: null, status: "resigned" },
];

test("member cockpit rejects role and team placeholders", () => {
  for (const value of ["", "待指派", "采购", "研发团队", "外部机构", "系统"]) {
    assert.equal(isNonPersonTaskOwner(value), true, value);
    assert.equal(isTaskOwnerMember(value, null, directory), false, value);
  }
});

test("member cockpit only accepts configured users that own visible tasks", () => {
  assert.equal(isTaskOwnerMember("新账号成员", "user-2", directory), true);
  assert.equal(isTaskOwnerMember("协同独有成员", "collab-user-1", directory), false);
  assert.equal(isTaskOwnerMember("刘至远", "collab-user-2", directory), false);
  assert.equal(isTaskOwnerMember("刘至远", null, directory), true);
  assert.equal(isTaskOwnerMember("杨工", null, directory), true);
  assert.equal(isTaskOwnerMember("离职成员", null, directory), false);
  assert.equal(isTaskOwnerMember("Mike Johnson", null, directory), false);
});
