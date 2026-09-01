import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const files = {
  entry: readFileSync(new URL("../src/app/KnowledgeBaseEntryPage.tsx", import.meta.url), "utf8"),
  page: readFileSync(new URL("../src/app/RDKnowledgeBasePage.tsx", import.meta.url), "utf8"),
  app: readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8"),
};

test("知识库入口与共享页面 TSX 均可独立解析", () => {
  for (const [name, source] of Object.entries(files)) {
    const result = ts.transpileModule(source, {
      fileName: `${name}.tsx`,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(
      errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
      [],
      `${name} 存在 TSX 解析错误`,
    );
  }
});

test("研发、部门与美国协同知识库统一启用 Horizon 视觉", () => {
  assert.match(files.page, /const horizonVariant = visualVariant === "rd-horizon";/);
  assert.doesNotMatch(files.page, /visualVariant === "rd-horizon"\s*&&\s*!kbId/);
  assert.match(files.page, /horizon-theme hz-page rd-horizon-module rd-horizon-kb/);

  assert.match(
    files.entry,
    /kbScope=\{\{ kbId: activeDept\.id, label: labelOf\(activeDept\) \}\}[\s\S]{0,100}visualVariant="rd-horizon"/,
  );
  assert.match(files.entry, /key="kb-rd" visualVariant="rd-horizon" toolbarLeading=\{switcher\}/);
  assert.match(
    files.app,
    /path: "us-collab-kb"[^\n]+kbScope=\{\{ kbId: "us-collab", label: "协同" \}\} visualVariant="rd-horizon"[^\n]+"page:dept-kb-us-collab"/,
  );
});

test("kbId 的 API、权限隔离与页内切换器契约保持不变", () => {
  for (const contract of [
    /const kbId = kbScope\?\.kbId/,
    /const P = kbId[\s\S]{0,500}dept-kb:upload[\s\S]{0,500}rd-kb:upload/,
    /fetchKbCategories\(kbId\)/,
    /fetchKbEntries\(undefined, kbId\)/,
    /fetchKbEntries\(buildParams\(\), kbId\)/,
    /deleteKbEntry\(deletingEntry\.id, kbId\)/,
    /recordKbView\(entry\.id, kbId\)/,
    /<KbScopeContext\.Provider value=\{kbId\}>/,
  ]) {
    assert.match(files.page, contract);
  }

  for (const contract of [
    /const RD_KB_VALUE = "__rd__"/,
    /navigate\(value === RD_KB_VALUE \? rdPath : `\/dept-kb\/\$\{value\}`/,
    /onValueChange=\{\(value\) => goTo\(value\)\}/,
    /aria-label=\{t\("切换知识库"\)\}/,
    /toolbarLeading=\{switcher\}/,
  ]) {
    assert.match(files.entry, contract);
  }
});

test("RAG 重建使用标准 AlertDialog 并保留焦点、取消、确认与错误处理", () => {
  assert.doesNotMatch(files.page, /window\.confirm|(?<![\w.])confirm\(/);
  for (const contract of [
    /<AlertDialog\s+[\s\S]{0,120}open=\{showRagConfirm\}/,
    /<DropdownMenu open=\{showMoreMenu\} onOpenChange=\{setShowMoreMenu\}>/,
    /ref=\{ragMenuTriggerRef\}/,
    /onSelect=\{\(event\) => \{[\s\S]{0,180}setShowMoreMenu\(false\)[\s\S]{0,180}setShowRagConfirm\(true\)/,
    /onCloseAutoFocus=\{\(event\) =>[\s\S]{0,180}ragMenuTriggerRef\.current\?\.focus\(\)/,
    /<AlertDialogCancel type="button" disabled=\{backfillingRag\}>/,
    /<AlertDialogAction[\s\S]{0,180}disabled=\{backfillingRag\}/,
    /event\.preventDefault\(\);[\s\S]{0,80}void handleBackfillRag\(\)/,
    /await backfillKbToRag\(\)/,
    /setShowRagConfirm\(false\)/,
    /setRagBackfillError\(message\)/,
    /role="alert"/,
    /horizon-portal max-w-lg/,
  ]) {
    assert.match(files.page, contract);
  }
});
