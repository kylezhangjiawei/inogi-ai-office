import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

test("standalone Vite development uses the dedicated INOGI API port", () => {
  assert.match(source, /process\.env\.VITE_DEV_API_TARGET \|\| 'http:\/\/127\.0\.0\.1:3001'/);
  assert.doesNotMatch(source, /process\.env\.VITE_DEV_API_TARGET \|\| 'http:\/\/localhost:3000'/);
});
