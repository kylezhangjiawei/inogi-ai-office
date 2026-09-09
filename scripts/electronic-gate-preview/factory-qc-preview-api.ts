import { FactoryQcApiError, type FactoryQcApi, type FactoryCommand, type FactoryProtocolCatalog, type FactoryQcCommandState, type FactoryQcHistoryVersion, type FactoryQcKind, type FactoryQcManagementState, type FactorySerialConfig } from "../../src/app/lib/factoryQcApi";
import type { GateConfig } from "../../src/app/lib/electronicGateApi";
import { parseProtocolJson, validateProtocolCatalog, validateSerialConfig } from "../../apps/api/src/modules/electronic-gate/factory-qc.contract";
import { FACTORY_SERIAL_ITEM_IDS, serialFromItems } from "../../apps/api/src/modules/electronic-gate/factory-qc.serial";
import { protocolPublicationIssues } from "../../apps/api/src/modules/electronic-gate/factory-qc.release";

const STORE_KEY = "inogi.factory-qc.interactive-preview.v1";
const LOCK_KEY = "inogi.factory-qc.interactive-preview.write";
type PreviewStore = { schemaVersion: 1; state: FactoryQcManagementState; snapshots: Record<string, FactoryQcHistoryVersion> };
const copy = <T,>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const commandKey = (profileId: string, commandId: string) => JSON.stringify([profileId, commandId]);
const snapshotKey = (kind: FactoryQcKind, version: string) => JSON.stringify([kind, version]);
const delay = () => new Promise<void>(resolve => window.setTimeout(resolve, 140));
let rollbackSerial: ((config: FactorySerialConfig) => void) | undefined;

export function setPreviewSerialRollbackHandler(handler: (config: FactorySerialConfig) => void) { rollbackSerial = handler; }
function initial(): PreviewStore {
  return { schemaVersion: 1, state: {
    protocol: { revision: 0, active: null, draft: null, draftBaseVersion: null, commands: [], history: [] },
    serial: { revision: 0, active: null, readyCount: 0, totalCount: FACTORY_SERIAL_ITEM_IDS.length, history: [] },
  }, snapshots: {} };
}
function readStore(): PreviewStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return initial();
    const result = JSON.parse(raw) as PreviewStore;
    if (result.schemaVersion !== 1 || !result.state || !Array.isArray(result.state.protocol?.commands) || !Array.isArray(result.state.protocol?.history) || !Array.isArray(result.state.serial?.history) || !result.snapshots || !Number.isSafeInteger(result.state.protocol.revision) || !Number.isSafeInteger(result.state.serial.revision)) throw new Error("shape");
    return result;
  } catch { throw new FactoryQcApiError("无法读取本地协议预览数据，请检查站点存储权限或清除此预览站点数据后重试。", 500); }
}
function writeStore(store: PreviewStore) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch { throw new FactoryQcApiError("本地协议预览未保存，请检查浏览器存储权限或空间后重试。", 500); }
}
function assertRevision(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || actual !== expected) throw new FactoryQcApiError("配置已在另一窗口更新，请重新加载并核对后操作；本次输入未写入。", 409);
}
function validate<T>(operation: () => T): T {
  try { return operation(); } catch (error) { throw new FactoryQcApiError(error instanceof Error ? error.message : "配置校验失败。", 400); }
}
function addSnapshot(store: PreviewStore, kind: FactoryQcKind, content: FactoryProtocolCatalog | FactorySerialConfig, reason: string) {
  const key = snapshotKey(kind, content.version), status = store.state[kind];
  if (store.snapshots[key]) throw new FactoryQcApiError("该版本已有不可变快照，请使用新的版本号；恢复旧内容请使用回滚。", 409);
  const entry = { version: content.version, revision: status.revision, publishedAt: new Date().toISOString(), publishedBy: "示例管理员", reason };
  store.snapshots[key] = { ...entry, kind, content: copy(content) };
  status.history.unshift(entry);
}
function nextVersion(store: PreviewStore, kind: FactoryQcKind): string {
  const base = `preview-${kind}-${store.state[kind].revision}`;
  let version = base, suffix = 1;
  while (store.snapshots[snapshotKey(kind, version)]) version = `${base}-${suffix++}`;
  return version;
}
function syncCommands(previous: FactoryQcCommandState[], catalog: FactoryProtocolCatalog, clearDraftKey?: string): FactoryQcCommandState[] {
  const remaining = new Map(previous.map(item => [commandKey(item.profileId, item.commandId), item]));
  const result: FactoryQcCommandState[] = [];
  for (const profile of catalog.profiles) for (const command of profile.commands) {
    const key = commandKey(profile.id, command.id), old = remaining.get(key);
    result.push({ profileId: profile.id, commandId: command.id, active: copy(command), revision: old ? old.revision + (!same(old.active, command) || key === clearDraftKey ? 1 : 0) : 1, draft: key === clearDraftKey ? null : old?.draft ?? null });
    remaining.delete(key);
  }
  for (const old of remaining.values()) if (old.draft) result.push({ ...old, active: null, revision: old.revision + 1 });
  return result;
}
function initialDraftCommands(previous: FactoryQcCommandState[], catalog: FactoryProtocolCatalog): FactoryQcCommandState[] {
  const remaining = new Map(previous.map(item => [commandKey(item.profileId, item.commandId), item]));
  const commands: FactoryQcCommandState[] = [];
  for (const profile of catalog.profiles) for (const command of profile.commands) {
    const key = commandKey(profile.id, command.id), old = remaining.get(key);
    commands.push({ profileId: profile.id, commandId: command.id, revision: (old?.revision ?? 0) + 1, active: null, draft: copy(command) });
    remaining.delete(key);
  }
  for (const old of remaining.values()) commands.push({ ...old, active: null, draft: null, revision: old.revision + 1 });
  return commands;
}
function ensureInitialDraftCommands(state: FactoryQcManagementState["protocol"]) {
  if (state.active || !state.draft) return;
  for (const profile of state.draft.profiles) for (const command of profile.commands) {
    if (!state.commands.some(item => item.profileId === profile.id && item.commandId === command.id)) state.commands.push({ profileId: profile.id, commandId: command.id, revision: 0, active: null, draft: copy(command) });
  }
}
function assertPublishable(catalog: FactoryProtocolCatalog) {
  const issues = protocolPublicationIssues(catalog);
  if (issues.length) throw new FactoryQcApiError(issues.join("；"), 400);
}
function locate(store: PreviewStore, profileId: string, commandId: string, allowInitial = false) {
  const state = store.state.protocol;
  if (!state.active && !allowInitial) throw new FactoryQcApiError("首版须先发布完整目录，不能单独发布读取项。", 400);
  if (!state.active && !state.draft) throw new FactoryQcApiError("请先保存完整目录草稿，再逐项维护读取配置。", 400);
  ensureInitialDraftCommands(state);
  const catalog = state.active ?? state.draft!;
  const exists = catalog.profiles.some(profile => profile.id === profileId && profile.commands.some(command => command.id === commandId));
  const item = state.commands.find(item => item.profileId === profileId && item.commandId === commandId && (item.active || (allowInitial && !state.active && item.draft)));
  if (!exists || !item) throw new FactoryQcApiError("当前目录中不存在该读取项，新增固件或读取项请使用完整目录导入。", 404);
  return item;
}
function withCommand(catalog: FactoryProtocolCatalog, profileId: string, commandId: string, command: FactoryCommand) {
  if (command.id !== commandId) throw new FactoryQcApiError("单项配置不能更改读取项标识。", 400);
  return validate(() => validateProtocolCatalog({ ...catalog, profiles: catalog.profiles.map(profile => profile.id === profileId ? { ...profile, commands: profile.commands.map(item => item.id === commandId ? command : item) } : profile) }));
}
async function mutate(operation: (store: PreviewStore) => void): Promise<FactoryQcManagementState> {
  await delay();
  const execute = () => {
    const store = readStore();
    const gateKey = "inogi.electronic-gate.interactive-preview.v1";
    const original = [STORE_KEY, gateKey].map(key => ({ key, value: localStorage.getItem(key) }));
    try { operation(store); writeStore(store); return copy(store.state); }
    catch (error) {
      try { for (const entry of original) { if (localStorage.getItem(entry.key) !== entry.value) { if (entry.value === null) localStorage.removeItem(entry.key); else localStorage.setItem(entry.key, entry.value); } } }
      catch { throw new FactoryQcApiError("预览存储写入失败，恢复原数据也未完成。请清除此预览站点数据后重新验收。", 500); }
      throw error;
    }
  };
  return navigator.locks ? navigator.locks.request(LOCK_KEY, execute) : execute();
}

/** Called inside the shared preview write lock after a single explicit serial publication. */
export function syncPreviewSerial(items: Record<string, GateConfig>): void {
  const store = readStore(), serial = store.state.serial;
  serial.revision++;
  serial.readyCount = FACTORY_SERIAL_ITEM_IDS.filter(id => items[id]?.enabled === true).length;
  const content = validate(() => serialFromItems(items, nextVersion(store, "serial")));
  if (content) { addSnapshot(store, "serial", content, "独立连接参数发布（本地示例）"); serial.active = content; }
  writeStore(store);
}

export const previewFactoryQcApi: FactoryQcApi = {
  async getState() {
    await delay();
    if (["load-error", "protocol-error"].includes(new URLSearchParams(window.location.search).get("scenario") || "")) throw new FactoryQcApiError("示例协议加载失败。移除地址中的 scenario 参数后可恢复。", 503);
    const state = readStore().state; ensureInitialDraftCommands(state.protocol);
    return copy(state);
  },
  saveCatalogDraft: (expectedRevision, json) => mutate(store => {
    const state = store.state.protocol; assertRevision(state.revision, expectedRevision);
    state.draft = validate(() => validateProtocolCatalog(parseProtocolJson(json)));
    state.draftBaseVersion = state.active?.version ?? null; state.revision++;
    if (!state.active) state.commands = initialDraftCommands(state.commands, state.draft);
  }),
  publishCatalog: expectedRevision => mutate(store => {
    const state = store.state.protocol; assertRevision(state.revision, expectedRevision);
    if (!state.draft) throw new FactoryQcApiError("请先导入并校验完整目录草稿。", 400);
    if (state.draftBaseVersion !== (state.active?.version ?? null)) throw new FactoryQcApiError("已发布目录已变化，请重新核对并保存完整目录草稿。", 409);
    const content = validate(() => validateProtocolCatalog(state.draft)); assertPublishable(content); state.revision++;
    addSnapshot(store, "protocol", content, "完整目录明确发布（本地示例）");
    const wasInitial = !state.active;
    state.commands = syncCommands(state.commands, content);
    if (wasInitial) state.commands = state.commands.map(command => ({ ...command, draft: null }));
    state.active = content; state.draft = null; state.draftBaseVersion = null;
  }),
  saveCommandDraft: (profileId, commandId, expectedRevision, command) => mutate(store => {
    const state = store.state.protocol, target = locate(store, profileId, commandId, true); assertRevision(target.revision, expectedRevision);
    const catalog = withCommand(state.active ?? state.draft!, profileId, commandId, command);
    target.draft = catalog.profiles.find(profile => profile.id === profileId)!.commands.find(item => item.id === commandId)!;
    target.revision++; state.revision++;
    if (!state.active) state.draft = catalog;
  }),
  publishCommand: (profileId, commandId, expectedRevision) => mutate(store => {
    const state = store.state.protocol, target = locate(store, profileId, commandId); assertRevision(target.revision, expectedRevision);
    if (!target.draft) throw new FactoryQcApiError("请先保存本项草稿。", 400);
    const content = withCommand(state.active!, profileId, commandId, target.draft); state.revision++;
    content.version = nextVersion(store, "protocol"); assertPublishable(content); addSnapshot(store, "protocol", content, `单项读取 ${profileId}/${commandId} 发布`);
    state.commands = syncCommands(state.commands, content, commandKey(profileId, commandId)); state.active = content;
  }),
  async getHistory(kind, version) {
    await delay(); const snapshot = readStore().snapshots[snapshotKey(kind, version)];
    if (!snapshot) throw new FactoryQcApiError("未找到该历史版本。", 404);
    return copy(snapshot);
  },
  rollback: (kind, version, expectedRevision) => mutate(store => {
    const state = store.state[kind]; assertRevision(state.revision, expectedRevision);
    const snapshot = store.snapshots[snapshotKey(kind, version)];
    if (!snapshot) throw new FactoryQcApiError("未找到该历史版本。", 404);
    if (kind === "protocol") {
      const content = validate(() => validateProtocolCatalog(snapshot.content));
      assertPublishable(content);
      store.state.protocol.commands = syncCommands(store.state.protocol.commands, content);
      store.state.protocol.active = content; store.state.protocol.revision++;
    } else {
      const content = validate(() => validateSerialConfig(snapshot.content));
      if (!rollbackSerial) throw new FactoryQcApiError("预览连接项恢复功能尚未就绪，请刷新页面后重试。", 503);
      rollbackSerial(copy(content));
      store.state.serial.active = content; store.state.serial.readyCount = FACTORY_SERIAL_ITEM_IDS.length; store.state.serial.revision++;
    }
  }),
};
