import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";

const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

test("application and preview servers cannot replace each other's optimized dependencies", async () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const configPaths = [
    "vite.config.ts",
    "scripts/ui-preview/vite.config.ts",
    "scripts/electronic-gate-preview/vite.config.ts",
    "scripts/device-inspection-records-preview/vite.config.ts",
  ];
  const caches = [];
  for (const configPath of configPaths) {
    const config = await resolveConfig({ root: repositoryRoot, configFile: resolve(repositoryRoot, configPath), logLevel: "silent" }, "serve");
    caches.push(resolve(config.cacheDir));
  }
  assert.equal(new Set(caches).size, configPaths.length, "each Vite server must own a separate dependency cache");
  assert.notEqual(caches[0], resolve(repositoryRoot, "node_modules/.vite"), "temporary previews using Vite defaults must not overwrite the application's cache");
  for (let index = 1; index < caches.length; index += 1) {
    assert.equal(dirname(caches[index]), resolve(repositoryRoot, dirname(configPaths[index])), "preview caches must stay within their own preview directories");
  }
});

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
