import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

test("standalone Vite development uses the dedicated INOGI API port", () => {
  assert.match(source, /process\.env\.VITE_DEV_API_TARGET \|\| 'http:\/\/127\.0\.0\.1:3011'/);
  assert.doesNotMatch(source, /process\.env\.VITE_DEV_API_TARGET \|\| 'http:\/\/localhost:3000'/);
});

test("Vite SPA removes React server directives before Rollup sourcemap reporting", () => {
  assert.match(source, /name: 'strip-spa-client-directives'/);
  assert.match(source, /blankedDirective = match\[0\]\.replace\(\/\[\^\\r\\n\]\/g, ' '\)/);
  assert.doesNotMatch(source, /SOURCEMAP_ERROR|MODULE_LEVEL_DIRECTIVE/);
});

test("Univer is split by package boundary instead of hiding the large chunk warning", () => {
  assert.match(source, /name: 'enforce-javascript-chunk-budget'/);
  assert.match(source, /enforceJavaScriptChunkBudget\(maxBytes = 2_000_000\)/);
  assert.match(source, /onlyExplicitManualChunks: true/);
  assert.match(source, /return `univer-hyphenation-\$\{hyphenationModule\}`/);
  assert.match(source, /return `univer-\$\{univerPackage\}`/);
  assert.match(source, /return 'univer-font-parser'/);
  assert.match(source, /return 'univer-language-detection'/);
  assert.match(source, /return 'univer-unicode-text'/);
  assert.match(source, /chunkSizeWarningLimit: 2000/);
  assert.doesNotMatch(source, /chunkSizeWarningLimit:\s*(?:[3-9]\d{3}|\d{5,})/);
});
