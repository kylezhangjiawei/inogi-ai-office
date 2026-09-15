import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const source = await readFile(new URL("../apps/api/src/main.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const bootstrap = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "bootstrap");
assert.ok(bootstrap, "main.ts must retain an identifiable bootstrap boundary");
// Run the actual process policy without importing AppModule or starting databases/jobs.
const policy = parsed.statements
  .filter((node) => node.pos < bootstrap.pos && !ts.isImportDeclaration(node))
  .map((node) => node.getText(parsed)).join("\n");
const compiled = ts.transpileModule(policy, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const prelude = `const { Logger } = require(${JSON.stringify(apiRequire.resolve("@nestjs/common"))});\n${compiled}`;

for (const [name, trigger] of [
  ["uncaught exception", "setImmediate(() => { throw new Error('synthetic-process-failure'); });"],
  ["unhandled rejection", "Promise.reject(new Error('synthetic-process-failure'));"],
]) {
  test(`${name} exits nonzero instead of continuing in the failed process`, () => {
    const result = spawnSync(process.execPath, ["--unhandled-rejections=throw", "-e",
      `${prelude}\n${trigger}\nsetTimeout(() => console.log('continued-after-failure'), 40);`,
    ], { encoding: "utf8", timeout: 5_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /continued-after-failure/);
    assert.match(result.stderr, /synthetic-process-failure/);
  });
}

test("a handled request failure does not terminate the process", () => {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=throw", "-e",
    `${prelude}\nPromise.reject(new Error('handled')).catch(() => console.log('request-handled'));`,
  ], { encoding: "utf8", timeout: 5_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /request-handled/);
});
