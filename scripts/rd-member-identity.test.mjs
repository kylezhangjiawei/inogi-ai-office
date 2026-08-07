import assert from "node:assert/strict";
import { test } from "node:test";

import { isNonPersonTaskOwner, isTaskOwnerMember } from "../src/app/lib/rdMemberIdentity.ts";

const directory = [
  { name: "刘至远", user_id: "user-1", status: "active" },
  { name: "杨工", user_id: null, status: "active" },
  { name: "离职成员", user_id: null, status: "resigned" },
];

test("member cockpit rejects role and team placeholders", () => {
  for (const value of ["", "待指派", "采购", "研发团队", "外部机构", "系统"]) {
    assert.equal(isNonPersonTaskOwner(value), true, value);
    assert.equal(isTaskOwnerMember(value, null, directory), false, value);
  }
});

test("member cockpit accepts bound users and active legacy directory members", () => {
  assert.equal(isTaskOwnerMember("新账号成员", "user-2", directory), true);
  assert.equal(isTaskOwnerMember("刘至远", null, directory), true);
  assert.equal(isTaskOwnerMember("杨工", null, directory), true);
  assert.equal(isTaskOwnerMember("离职成员", null, directory), false);
  assert.equal(isTaskOwnerMember("Mike Johnson", null, directory), false);
});
