import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const previewRoot = dirname(fileURLToPath(import.meta.url));
const { build } = createRequire(import.meta.resolve("vite"))("esbuild");
const bundled = await build({
  stdin: { contents: `export * from './factory-qc-preview-api.ts'; export { FACTORY_PROTOCOL_EXAMPLE } from '../../apps/api/src/modules/electronic-gate/factory-qc.example.ts'; export { GATE_DEFINITIONS } from '../../apps/api/src/modules/electronic-gate/electronic-gate.catalog.ts'; export { buildFactoryQcR5Draft, buildHistoricalFactoryQcCandidate, R5_PROFILE_ID } from '../../apps/api/src/modules/electronic-gate/factory-qc.r5.ts';`, resolveDir: previewRoot, loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env": "{}" }, logLevel: "silent",
});
const module = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const { previewFactoryQcApi: api, syncPreviewSerial, setPreviewSerialRollbackHandler, FACTORY_PROTOCOL_EXAMPLE: example, GATE_DEFINITIONS: definitions, buildFactoryQcR5Draft, buildHistoricalFactoryQcCandidate, R5_PROFILE_ID } = module;
const protocolKey = "inogi.factory-qc.interactive-preview.v1";
const gateKey = "inogi.electronic-gate.interactive-preview.v1";
const data = new Map();
let failNextWrite = "";
globalThis.localStorage = {
  getItem: key => data.get(key) ?? null,
  setItem: (key, value) => { if (key === failNextWrite) { failNextWrite = ""; throw new Error("quota simulation"); } data.set(key, value); },
  removeItem: key => data.delete(key),
};
globalThis.window = { setTimeout: callback => setTimeout(callback, 0), location: { search: "" } };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (_key, operation) => operation() } } });
const copy = value => structuredClone(value);

// Compile the component's pure codec in memory; no source or browser state is changed.
const componentSource = readFileSync(resolve(previewRoot, "../../src/app/FactoryQcProtocolPanel.tsx"), "utf8");
const codecSource = componentSource.slice(componentSource.indexOf("type Pair ="), componentSource.indexOf("function FormField("))
  .replace("function toForm(", "export function toForm(")
  .replace("function fromForm(", "export function fromForm(");
const codecBundle = await build({
  stdin: { contents: `import { buildFactoryQcR5Draft } from '../../apps/api/src/modules/electronic-gate/factory-qc.r5.ts';\n${codecSource}`, resolveDir: previewRoot, loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
});
const { toForm, fromForm } = await import(`data:text/javascript;base64,${Buffer.from(codecBundle.outputFiles[0].text).toString("base64")}`);

test("factory protocol preview uses explicit publication, isolated revisions and immutable historical content", async () => {
  data.clear();
  let state = await api.getState();
  assert.equal(state.protocol.active, null);
  assert.equal(state.protocol.draft, null);
  const profile = example.profiles[0], first = profile.commands[0], second = profile.commands[1];
  await assert.rejects(api.saveCommandDraft(profile.id, first.id, 0, first), error => error.status === 400);
  await assert.rejects(api.saveCatalogDraft(0, '{"schemaVersion":1,"schemaVersion":1}'), error => error.status === 400);
  assert.equal((await api.getState()).protocol.revision, 0);

  state = await api.saveCatalogDraft(0, JSON.stringify(example));
  assert.equal(state.protocol.active, null, "saving a catalogue must not publish it");
  state = await api.publishCatalog(state.protocol.revision);
  assert.deepEqual(state.protocol.active, example);
  const original = await api.getHistory("protocol", example.version);
  assert.deepEqual(original.content, example);

  const revision = id => state.protocol.commands.find(item => item.profileId === profile.id && item.commandId === id).revision;
  const firstRevision = revision(first.id);
  state = await api.saveCommandDraft(profile.id, first.id, firstRevision, { ...first, name: "单项修改 A" });
  state = await api.saveCommandDraft(profile.id, second.id, revision(second.id), { ...second, name: "单项草稿 B" });
  await assert.rejects(api.saveCommandDraft(profile.id, first.id, firstRevision, first), error => error.status === 409);
  state = await api.publishCommand(profile.id, first.id, revision(first.id));
  assert.equal(state.protocol.active.profiles[0].commands[0].name, "单项修改 A");
  assert.equal(state.protocol.active.profiles[0].commands[1].name, second.name, "publishing A must not activate B's draft");
  assert.equal(state.protocol.commands.find(item => item.commandId === second.id && item.profileId === profile.id).draft.name, "单项草稿 B");
  assert.equal(state.protocol.commands.find(item => item.commandId === first.id && item.profileId === profile.id).draft, null);

  state = await api.rollback("protocol", example.version, state.protocol.revision);
  assert.deepEqual(state.protocol.active, example, "rollback must preserve original version and JSON");
  assert.deepEqual((await api.getHistory("protocol", example.version)).content, original.content);
  assert.equal(state.protocol.commands.find(item => item.commandId === second.id && item.profileId === profile.id).draft.name, "单项草稿 B");
});

test("catalogue draft detects changes to its active base and rejects duplicate historical versions", async () => {
  data.clear();
  let state = await api.saveCatalogDraft(0, JSON.stringify(example));
  state = await api.publishCatalog(state.protocol.revision);
  const revised = { ...copy(example), version: "reviewed-catalogue-v2" };
  state = await api.saveCatalogDraft(state.protocol.revision, JSON.stringify(revised));
  const command = state.protocol.commands[0];
  state = await api.saveCommandDraft(command.profileId, command.commandId, command.revision, { ...command.active, name: "另一项已更新" });
  const saved = state.protocol.commands[0];
  state = await api.publishCommand(saved.profileId, saved.commandId, saved.revision);
  await assert.rejects(api.publishCatalog(state.protocol.revision), error => error.status === 409);
  state = await api.saveCatalogDraft(state.protocol.revision, JSON.stringify(example));
  await assert.rejects(api.publishCatalog(state.protocol.revision), error => error.status === 409);
});

test("serial preview requires all 12 explicit published values and restores both stores on write failure", async () => {
  data.clear();
  const connections = definitions.filter(item => item.category === "connection");
  const items = Object.fromEntries(connections.map(item => [item.id, copy(item.defaults)]));
  const missing = { ...items }; delete missing[connections[0].id];
  syncPreviewSerial(missing);
  let state = await api.getState();
  assert.equal(state.serial.readyCount, 11);
  assert.equal(state.serial.active, null, "11 items cannot be completed with defaults");
  syncPreviewSerial(items);
  state = await api.getState();
  assert.equal(state.serial.readyCount, 12);
  const original = copy(state.serial.active);
  items["baud-rate"].values.baudRate = "230400";
  syncPreviewSerial(items);
  state = await api.getState();
  assert.equal(state.serial.active.baudRate, 230400);
  setPreviewSerialRollbackHandler(config => localStorage.setItem(gateKey, JSON.stringify(config)));
  localStorage.setItem(gateKey, "original-gate-store");
  const savedProtocol = localStorage.getItem(protocolKey);
  failNextWrite = protocolKey;
  await assert.rejects(api.rollback("serial", original.version, state.serial.revision), error => error.status === 500);
  assert.equal(localStorage.getItem(gateKey), "original-gate-store");
  assert.equal(localStorage.getItem(protocolKey), savedProtocol);
  state = await api.rollback("serial", original.version, state.serial.revision);
  assert.deepEqual(state.serial.active, original);
  assert.deepEqual(JSON.parse(localStorage.getItem(gateKey)), original);
});

test("r5 draft permits independent pre-publication edits but never activates the review template", async () => {
  data.clear();
  const template = buildFactoryQcR5Draft();
  assert.equal(data.size, 0, "building a review template must not write storage");
  let state = await api.saveCatalogDraft(0, JSON.stringify(template));
  assert.equal(state.protocol.active, null);
  assert.equal(state.protocol.commands.length, template.profiles.reduce((count, profile) => count + profile.commands.length, 0));
  assert.ok(state.protocol.commands.every(command => command.active === null && command.draft && command.revision === 1));
  const target = state.protocol.commands.find(command => command.profileId === R5_PROFILE_ID && command.commandId === "valve-pressure");
  const other = state.protocol.commands.find(command => command.profileId === R5_PROFILE_ID && command.commandId === "fan");
  const unchanged = copy(other);
  const modified = { ...copy(target.draft), name: "微压差值审核记录" };
  state = await api.saveCommandDraft(target.profileId, target.commandId, target.revision, modified);
  assert.deepEqual(state.protocol.draft.profiles.find(profile => profile.id === R5_PROFILE_ID).commands.find(command => command.id === target.commandId), modified);
  assert.deepEqual(state.protocol.commands.find(command => command.profileId === other.profileId && command.commandId === other.commandId), unchanged);
  assert.equal(state.protocol.active, null);
  await assert.rejects(api.saveCommandDraft(target.profileId, target.commandId, target.revision, target.draft), error => error.status === 409);
  await assert.rejects(api.publishCommand(target.profileId, target.commandId, target.revision + 1), error => error.status === 400);
  await assert.rejects(api.publishCatalog(state.protocol.revision), error => error.status === 400);
  assert.equal((await api.getState()).protocol.history.length, 0);
});

test("whole initial catalogue replacements preserve revision tombstones and first publication clears initial drafts", async () => {
  data.clear();
  const catalogue = { ...copy(example), version: "initial-preview-fixture" };
  let state = await api.saveCatalogDraft(0, JSON.stringify(catalogue));
  const profile = catalogue.profiles[1], removed = profile.commands.at(-1);
  const firstRevision = state.protocol.commands.find(item => item.profileId === profile.id && item.commandId === removed.id).revision;
  const reduced = copy(catalogue); reduced.profiles[1].commands.pop();
  state = await api.saveCatalogDraft(state.protocol.revision, JSON.stringify(reduced));
  const tombstone = state.protocol.commands.find(item => item.profileId === profile.id && item.commandId === removed.id);
  assert.equal(tombstone.draft, null); assert.equal(tombstone.revision, firstRevision + 1);
  state = await api.saveCatalogDraft(state.protocol.revision, JSON.stringify(catalogue));
  const restored = state.protocol.commands.find(item => item.profileId === profile.id && item.commandId === removed.id);
  assert.equal(restored.revision, firstRevision + 2);
  await assert.rejects(api.saveCommandDraft(profile.id, removed.id, firstRevision, removed), error => error.status === 409);
  state = await api.saveCommandDraft(profile.id, removed.id, restored.revision, { ...removed, name: "预览首版的单项修订" });
  state = await api.publishCatalog(state.protocol.revision);
  assert.ok(state.protocol.commands.every(item => item.active && item.draft === null));
  assert.equal(state.protocol.active.profiles[1].commands.at(-1).name, "预览首版的单项修订");
});

test("known historical candidate and r5 content cannot be published by changing only version", async () => {
  data.clear();
  let state = await api.getState();
  for (const candidate of [buildHistoricalFactoryQcCandidate(), buildFactoryQcR5Draft()]) {
    const renamed = { ...copy(candidate), version: "only-renamed-preview-fixture" };
    state = await api.saveCatalogDraft(state.protocol.revision, JSON.stringify(renamed));
    await assert.rejects(api.publishCatalog(state.protocol.revision), error => error.status === 400);
    state = await api.getState();
    assert.equal(state.protocol.active, null); assert.equal(state.protocol.history.length, 0);
  }
});

test("known review content is protected on individual publication and old-history rollback", async () => {
  data.clear();
  const review = buildFactoryQcR5Draft(), fixture = copy(review);
  fixture.version = "changed-local-test-fixture";
  const selected = fixture.profiles.find(profile => profile.id === R5_PROFILE_ID).commands.find(command => command.id === "fan");
  selected.name = "本地测试不同内容";
  let state = await api.saveCatalogDraft(0, JSON.stringify(fixture));
  state = await api.publishCatalog(state.protocol.revision);
  const originalFan = review.profiles.find(profile => profile.id === R5_PROFILE_ID).commands.find(command => command.id === "fan");
  const target = state.protocol.commands.find(command => command.profileId === R5_PROFILE_ID && command.commandId === "fan");
  state = await api.saveCommandDraft(R5_PROFILE_ID, "fan", target.revision, originalFan);
  const draft = state.protocol.commands.find(command => command.profileId === R5_PROFILE_ID && command.commandId === "fan");
  await assert.rejects(api.publishCommand(R5_PROFILE_ID, "fan", draft.revision), error => error.status === 400);
  const stored = JSON.parse(localStorage.getItem(protocolKey));
  stored.snapshots[JSON.stringify(["protocol", review.version])] = { kind: "protocol", version: review.version, revision: 0, content: review, publishedAt: "2026-09-09T00:00:00Z", publishedBy: "历史测试", reason: "历史存储兼容测试" };
  localStorage.setItem(protocolKey, JSON.stringify(stored));
  await assert.rejects(api.rollback("protocol", review.version, state.protocol.revision), error => error.status === 400);
  assert.equal((await api.getState()).protocol.active.version, fixture.version);
});

test("structured editor preserves unchanged optional JSON keys and does not turn a no-op save into a content change", () => {
  const template = buildFactoryQcR5Draft();
  for (const profile of template.profiles) for (const command of profile.commands) {
    assert.deepEqual(fromForm(toForm(command), command), command);
    const changedName = toForm(command); changedName.name = `${command.name} · 审核`;
    assert.deepEqual(fromForm(changedName, command), { ...command, name: changedName.name });
  }
  const command = copy(template.profiles.find(profile => profile.id === R5_PROFILE_ID).commands.find(item => item.id === "valve-pressure"));
  command.disabledReason = null; command.timeoutMs = null;
  command.fields[0].unit = null; command.fields[0].prefix = ""; command.fields[0].rule = null;
  const form = toForm(command); form.fields[0].name = "更明确的字段名称";
  const changed = fromForm(form, command);
  assert.deepEqual(changed, { ...command, fields: [{ ...command.fields[0], name: form.fields[0].name }] });
});
