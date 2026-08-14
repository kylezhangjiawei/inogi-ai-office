import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const qaSuite = await readFile(
  new URL("../apps/api/scripts/qa/qa-suite.mjs", import.meta.url),
  "utf8",
);
const qaPreview = await readFile(
  new URL("../apps/api/scripts/qa/qa-cleanup-preview.mjs", import.meta.url),
  "utf8",
);

test("R&D integration QA targets the dedicated API port and remains overrideable", () => {
  assert.match(qaSuite, /process\.env\.QA_BASE_URL/);
  assert.match(qaSuite, /http:\/\/127\.0\.0\.1:3011\/api/);
  assert.doesNotMatch(qaSuite, /const BASE = "http:\/\/localhost:3000\/api"/);
});

test("R&D integration QA uses temporary database-backed roles instead of forged token permissions", () => {
  assert.match(qaSuite, /async function setupQaActors/);
  assert.match(qaSuite, /prisma\.role\.create/);
  assert.match(qaSuite, /prisma\.user\.create/);
  assert.match(qaSuite, /await cleanupQaActors\(\)/);
  assert.doesNotMatch(qaSuite, /const USER_ID = "cmra7pb6w0026u7w411wrhk7w"/);
});

test("R&D integration QA cleans derived messages, notes, and scores after every run", () => {
  assert.match(qaSuite, /buildQaArtifactCleanupUpdates/);
  assert.match(qaSuite, /QA_CLEANUP_KEYS/);
  assert.match(qaSuite, /prisma\.systemSetting\.update/);
});

test("QA cleanup preview is structurally read-only", () => {
  assert.match(qaPreview, /systemSetting\.findMany/);
  assert.doesNotMatch(qaPreview, /systemSetting\.(?:update|delete|create|upsert)/);
  assert.doesNotMatch(qaPreview, /\$transaction/);
});
