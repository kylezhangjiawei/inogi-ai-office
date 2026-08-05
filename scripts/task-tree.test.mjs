import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/app/lib/taskTree.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourceUrl.pathname,
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { buildTaskTree, collectTaskTreeIds, filterTaskTree } = await import(moduleUrl);

const compare = (left, right) => left.order - right.order;

test("task tree preserves nested order and promotes missing parents", () => {
  const tree = buildTaskTree([
    { task_id: "child", parent_task_id: "root", order: 2 },
    { task_id: "orphan", parent_task_id: "hidden", order: 3 },
    { task_id: "root", order: 1 },
  ], compare);

  assert.deepEqual(tree.map((node) => node.task.task_id), ["root", "orphan"]);
  assert.deepEqual(tree[0].children.map((node) => node.task.task_id), ["child"]);
});

test("task tree cuts self references and cycles without losing tasks", () => {
  const tree = buildTaskTree([
    { task_id: "self", parent_task_id: "self", order: 0 },
    { task_id: "a", parent_task_id: "b", order: 1 },
    { task_id: "b", parent_task_id: "a", order: 2 },
  ], compare);

  assert.deepEqual([...collectTaskTreeIds(tree)].sort(), ["a", "b", "self"]);
  assert.equal(tree[0].task.task_id, "self");
  assert.equal(tree[1].task.task_id, "a");
  assert.equal(tree[1].children[0].task.task_id, "b");
});

test("task tree emits duplicate ids only once", () => {
  const tree = buildTaskTree([
    { task_id: "root", title: "first", order: 1 },
    { task_id: "root", title: "duplicate", order: 2 },
  ], compare);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].task.title, "first");
});

test("active projection keeps a completed ancestor for its active child", () => {
  const fullTree = buildTaskTree([
    { task_id: "completed-parent", status: "completed", order: 1 },
    { task_id: "active-child", parent_task_id: "completed-parent", status: "in_progress", order: 2 },
    { task_id: "completed-leaf", parent_task_id: "completed-parent", status: "completed", order: 3 },
  ], compare);
  const activeTree = filterTaskTree(fullTree, (task) => task.status !== "completed");

  assert.equal(activeTree.length, 1);
  assert.equal(activeTree[0].task.task_id, "completed-parent");
  assert.deepEqual(activeTree[0].children.map((node) => node.task.task_id), ["active-child"]);
});
