import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const appDirectory = new URL("../src/app/", import.meta.url);

function callsAuditActorHook(sourceFile) {
  let found = false;

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "useAuditActor"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function importsAuditActorHook(sourceFile) {
  return sourceFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (!statement.moduleSpecifier.text.endsWith("/lib/auditLog")) return false;

    const bindings = statement.importClause?.namedBindings;
    return ts.isNamedImports(bindings)
      && bindings.elements.some((element) => (element.propertyName ?? element.name).text === "useAuditActor");
  });
}

test("every useAuditActor call has an explicit auditLog import", async () => {
  const entries = await readdir(appDirectory, { withFileTypes: true });
  const offenders = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;

    const fileUrl = new URL(entry.name, appDirectory);
    const source = await readFile(fileUrl, "utf8");
    const sourceFile = ts.createSourceFile(entry.name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    if (callsAuditActorHook(sourceFile) && !importsAuditActorHook(sourceFile)) offenders.push(entry.name);
  }

  assert.deepEqual(offenders, []);
});
