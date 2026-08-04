import * as assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";

import { posixProcessGroupId, windowsProcessTreeKillArgs } from "./dev-process-tree.mjs";
import {
  assertDevPortAvailable,
  childHasExited,
  devApiTarget,
  isInogiApiHealth,
  resolveDevApiPort,
  unexpectedChildExitCode,
} from "./dev-runtime.mjs";

test("Windows 开发进程退出时终止整棵子进程树", () => {
  assert.deepEqual(windowsProcessTreeKillArgs(1234), ["/PID", "1234", "/T", "/F"]);
});

test("拒绝无效进程号，避免 taskkill 命中非预期目标", () => {
  for (const value of [undefined, null, "", 0, -1, 1.5, "abc"]) {
    assert.throws(() => windowsProcessTreeKillArgs(value), TypeError);
  }
});

test("POSIX 开发进程使用负 PID 终止整个进程组", () => {
  assert.equal(posixProcessGroupId(1234), -1234);
  assert.throws(() => posixProcessGroupId(0), TypeError);
});

test("组合启动默认使用独立的 3001 端口，避免误连其他项目的 3000 服务", () => {
  assert.equal(resolveDevApiPort({}), 3001);
  assert.equal(devApiTarget(resolveDevApiPort({ INOGI_DEV_API_PORT: "3100" })), "http://127.0.0.1:3100");
  assert.throws(() => resolveDevApiPort({ INOGI_DEV_API_PORT: "70000" }), TypeError);
});

test("只有当前 INOGI API 的健康响应才能放行前端启动", () => {
  assert.equal(isInogiApiHealth({ ok: true, service: "inogi-api" }), true);
  assert.equal(isInogiApiHealth({ ok: true, service: "another-project" }), false);
  assert.equal(isInogiApiHealth({ error: "not_found" }), false);
});

test("启动前拒绝已占用的 API 端口，避免误连遗留服务", async () => {
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = blocker.address();
  assert.ok(address && typeof address === "object");
  await assert.rejects(() => assertDevPortAvailable(address.port), /already in use/);
  await new Promise((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
  await assert.doesNotReject(() => assertDevPortAvailable(address.port));
});

test("任一服务意外退出都会让组合启动以失败状态收口", () => {
  assert.equal(childHasExited({ exitCode: null, signalCode: null }), false);
  assert.equal(childHasExited({ exitCode: 0, signalCode: null }), true);
  assert.equal(childHasExited({ exitCode: null, signalCode: "SIGTERM" }), true);
  assert.equal(unexpectedChildExitCode(2), 2);
  assert.equal(unexpectedChildExitCode(0), 1);
  assert.equal(unexpectedChildExitCode(null), 1);
});
