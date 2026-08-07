import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const helperUrl = new URL("../src/app/lib/workspaceTaskPreview.ts", import.meta.url);
const helperSource = await readFile(helperUrl, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: helperUrl.pathname,
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { workspaceTaskPreview } = await import(moduleUrl);
const workspaceSource = await readFile(new URL("../src/app/RDMyWorkspacePage.tsx", import.meta.url), "utf8");

test("project tree labels a submitted progress comment as latest progress", () => {
  assert.deepEqual(
    workspaceTaskPreview({
      latest_progress_summary: { text: "@顾磊 请确认橡胶圈方案" },
      next_action: "推进当前节点并同步最新进展。",
    }),
    {
      label: "最新进展：",
      text: "@顾磊 请确认橡胶圈方案",
      source: "latest_progress",
    },
  );
});

test("project tree keeps the next-action fallback when no progress exists", () => {
  assert.deepEqual(
    workspaceTaskPreview({ latest_progress_summary: null, next_action: "推进当前节点" }),
    { label: "下一步：", text: "推进当前节点", source: "next_action" },
  );
});

test("project tree exposes a direct comments entry", () => {
  assert.match(workspaceSource, /onOpen\(task, "discussion"\)/);
  assert.match(workspaceSource, /<span>\{t\("评论"\)\}<\/span>/);
});
