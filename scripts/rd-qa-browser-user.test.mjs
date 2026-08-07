import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../apps/api/scripts/qa/qa-browser-user.mjs", import.meta.url),
  "utf8",
);

test("browser QA account helper is local-only and deletes only exact prefixed records", () => {
  assert.match(source, /localhost/);
  assert.match(source, /username: \{ startsWith: "browser-qa-" \}/);
  assert.match(source, /name: \{ startsWith: "browser-qa-role-" \}/);
  assert.match(source, /where: \{ id: userId/);
  assert.match(source, /where: \{ id: roleId/);
});
