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
const { isNonPersonTaskOwner, isSameMember, isTaskOwnerMember, memberIdentityKey } =
  await import(helperModuleUrl);

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

test("同名同事按 user_id 区分，不会被合并成一个人", () => {
  const zhangA = { name: "张伟", user_id: "user-a" };
  const zhangB = { name: "张伟", user_id: "user-b" };
  assert.notEqual(memberIdentityKey(zhangA.name, zhangA.user_id), memberIdentityKey(zhangB.name, zhangB.user_id));
  assert.equal(isSameMember(zhangA, zhangB), false);
  assert.equal(isSameMember(zhangA, { name: "张伟", user_id: "user-a" }), true);
  // 同一 user_id、显示名不同（改名）仍是同一个人
  assert.equal(isSameMember({ name: "张伟", user_id: "user-a" }, { name: "张小伟", user_id: "user-a" }), true);
});

test("无 user_id 的存量成员回退姓名，且与带 user_id 的键不混淆", () => {
  assert.equal(memberIdentityKey("杨工", null), memberIdentityKey("杨工", undefined));
  assert.equal(memberIdentityKey("杨工", ""), memberIdentityKey("杨工", "   "));
  assert.notEqual(memberIdentityKey("杨工", null), memberIdentityKey("杨工", "user-x"));
  // 姓名两侧空白归一，避免 " 杨工 " 与 "杨工" 各占一条
  assert.equal(memberIdentityKey(" 杨工 ", null), memberIdentityKey("杨工", null));
});

test("不传人员目录时白名单失效，必须视为调用方错误", () => {
  // isTaskOwnerMember 缺目录只挡黑名单占位值 —— 这是 computePersonLoads 必须传目录的原因
  assert.equal(isTaskOwnerMember("完全没配置的人", "ghost-1"), true);
  assert.equal(isTaskOwnerMember("完全没配置的人", "ghost-1", directory), false);
  assert.equal(isTaskOwnerMember("待指派", null), false);
});
