import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function moduleUrl(path, replacements = []) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

const contextUrl = await moduleUrl("src/app/components/matechat/pageContext.ts");
const { createRdTaskPageContext, normalizeMateChatPageContext } = await import(contextUrl);
const eventUrl = await moduleUrl("src/app/components/matechat/openMateChat.ts", [["'./pageContext'", JSON.stringify(contextUrl)]]);
const { MATECHAT_OPEN_EVENT, normalizeOpenMateChatOptions, openMateChat } = await import(eventUrl);

function taskContext() {
  return {
    schemaVersion: 1,
    pageKey: "rd_task_detail",
    scope: "entity",
    refs: [{ entityType: "rd_task", entityId: "RD-001", workspace: "rd" }],
    capturedAt: "2026-09-08T08:00:00.000Z",
  };
}

test("page context carries one RD reference and strips untrusted snapshots", () => {
  const input = taskContext();
  const normalized = normalizeMateChatPageContext({
    ...input,
    title: "Forged task title",
    fields: { owner: "Unverified owner" },
    canonicalUrl: "https://untrusted.invalid/",
    refs: [{ ...input.refs[0], entityId: " RD-001 ", title: "Forged reference" }],
  });
  assert.deepEqual(normalized, input);
  assert.notEqual(normalized.refs, input.refs);

  const created = createRdTaskPageContext("RD-002");
  assert.equal(created.refs[0].entityId, "RD-002");
  assert.deepEqual(normalizeMateChatPageContext(created), created);
});

test("unsupported versions, workspaces, references and timestamps fall back safely", () => {
  const valid = taskContext();
  const invalid = [
    null, undefined, [], "rd_task_detail",
    { ...valid, schemaVersion: 2 },
    { ...valid, pageKey: "production_task_detail" },
    { ...valid, scope: "selection" },
    { ...valid, refs: [] },
    { ...valid, refs: [valid.refs[0], valid.refs[0]] },
    { ...valid, refs: [{ ...valid.refs[0], workspace: "production" }] },
    { ...valid, refs: [{ ...valid.refs[0], workspace: "us-collab" }] },
    { ...valid, refs: [{ ...valid.refs[0], entityType: "purchase_order" }] },
    { ...valid, refs: [{ ...valid.refs[0], entityId: " " }] },
    { ...valid, refs: [{ ...valid.refs[0], entityId: "RD\u0000001" }] },
    { ...valid, refs: [{ ...valid.refs[0], entityId: "A".repeat(101) }] },
    { ...valid, capturedAt: "not a date" },
    { ...valid, capturedAt: "2026-09-08" },
  ];
  for (const input of invalid) assert.equal(normalizeMateChatPageContext(input), null);
});

test("delivery entry requires valid context and optional prompt remains a draft", () => {
  const pageContext = taskContext();
  assert.deepEqual(normalizeOpenMateChatOptions({ pageContext, intent: "delivery_check", prompt: "  检查当前任务  ", autoSend: true }), {
    pageContext,
    intent: "delivery_check",
    prompt: "检查当前任务",
  });
  assert.deepEqual(normalizeOpenMateChatOptions({ intent: "delivery_check", pageContext: {}, prompt: "继续问答" }), { prompt: "继续问答" });
  assert.deepEqual(normalizeOpenMateChatOptions({ pageContext, intent: "auto_submit", prompt: 123 }), { pageContext });
  for (const input of [null, undefined, [], true, "open", { type: "click" }]) {
    assert.deepEqual(normalizeOpenMateChatOptions(input), {});
  }
});

test("opening MateChat preserves no-argument callers and emits only a sanitized open event", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const events = [];
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: (event) => events.push(event) } });
    Object.defineProperty(globalThis, "CustomEvent", {
      configurable: true,
      value: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    });
    openMateChat();
    openMateChat({ pageContext: taskContext(), intent: "delivery_check", autoSend: true });
    assert.equal(events.length, 2);
    assert.equal(events[0].type, MATECHAT_OPEN_EVENT);
    assert.deepEqual(events[0].detail, {});
    assert.equal(events[1].type, MATECHAT_OPEN_EVENT);
    assert.deepEqual(events[1].detail, { pageContext: taskContext(), intent: "delivery_check" });

    delete globalThis.window;
    assert.doesNotThrow(() => openMateChat());
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousCustomEvent) Object.defineProperty(globalThis, "CustomEvent", previousCustomEvent);
    else delete globalThis.CustomEvent;
  }
});
