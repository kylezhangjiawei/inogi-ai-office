import { GATE_DEFINITIONS } from "../../apps/api/src/modules/electronic-gate/electronic-gate.catalog";
import { validateGateConfig } from "../../src/app/lib/electronicGateValidation";
import { syncPreviewSerial, setPreviewSerialRollbackHandler } from "./factory-qc-preview-api";
import { serialToItemValues } from "../../apps/api/src/modules/electronic-gate/factory-qc.serial";
import { GateApiError, type ElectronicGateApi, type GateConfig, type GateItem } from "../../src/app/lib/electronicGateApi";

const STORAGE_KEY = "inogi.electronic-gate.interactive-preview.v1";
const FACTORY_STORAGE_KEY = "inogi.factory-qc.interactive-preview.v1";
const LOCK_KEY = "inogi.factory-qc.interactive-preview.write";
type SavedState = Pick<GateItem, "draft" | "active" | "revision" | "updatedAt" | "updatedBy" | "publishedAt">;
type PreviewStore = { version: 1; items: Record<string, SavedState> };
const copy = <T,>(value: T): T => structuredClone(value);
const pause = () => new Promise<void>(resolve => window.setTimeout(resolve, 180));

function initialStore(): PreviewStore {
  const defaults = GATE_DEFINITIONS.find(item => item.id === "default-sensitivity")!.defaults;
  return { version: 1, items: {
    "default-sensitivity": {
      draft: { ...copy(defaults), values: { ...defaults.values, operator: "equals", readbackSource: "持久默认值回读" } },
      active: null, revision: 1, updatedAt: null, updatedBy: "示例管理员", publishedAt: null,
    },
  } };
}

function isConfig(value: unknown): value is GateConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as GateConfig;
  return typeof config.enabled === "boolean" && [config.model, config.market, config.displayName, config.helpText].every(value => typeof value === "string") &&
    ["block", "warn"].includes(config.failureAction) && !!config.values && typeof config.values === "object" && !Array.isArray(config.values) && Object.values(config.values).every(value => typeof value === "string");
}

function readStore(): PreviewStore {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return initialStore();
    const result = JSON.parse(stored) as PreviewStore;
    if (result.version !== 1 || !result.items || typeof result.items !== "object" || Array.isArray(result.items)) throw new Error("shape");
    for (const item of Object.values(result.items)) {
      if (!item || !Number.isSafeInteger(item.revision) || item.revision < 0 || (item.draft !== null && !isConfig(item.draft)) || (item.active !== null && !isConfig(item.active))) throw new Error("shape");
    }
    return result;
  } catch {
    throw new GateApiError("无法读取本地预览数据。请允许本站存储，或清除此预览站点的数据后重试。", 500);
  }
}

function itemFromStore(id: string, store: PreviewStore): GateItem {
  const definition = GATE_DEFINITIONS.find(item => item.id === id);
  if (!definition) throw new GateApiError("未找到该配置项。", 404);
  const state = store.items[id] ?? { draft: null, active: null, revision: 0, updatedAt: null, updatedBy: null, publishedAt: null };
  return copy({ ...definition, ...state });
}

function validate(item: GateItem, config: GateConfig, publishing: boolean) {
  const fail = (message: string) => { throw new GateApiError(message, 400); };
  if (!isConfig(config)) fail("配置格式不正确。");
  const errors = validateGateConfig(item, config, publishing);
  if (Object.keys(errors).length) fail(Object.values(errors)[0]);
  if (publishing && item.category === "connection" && !config.enabled) fail("串口参数不能单项停用，请使用自动连接开关。");
}

async function mutate(id: string, expectedRevision: number, change: (item: GateItem) => void): Promise<GateItem> {
  await pause();
  const operation = () => {
    const beforeItems = localStorage.getItem(STORAGE_KEY);
    const beforeFactory = localStorage.getItem(FACTORY_STORAGE_KEY);
    const store = readStore();
    const item = itemFromStore(id, store);
    if (expectedRevision !== item.revision) throw new GateApiError("本项配置已在另一窗口更新。请重新加载本项后再保存。", 409);
    change(item);
    item.revision += 1;
    item.updatedAt = new Date().toISOString();
    item.updatedBy = "示例管理员";
    store.items[id] = { draft: item.draft, active: item.active, revision: item.revision, updatedAt: item.updatedAt, updatedBy: item.updatedBy, publishedAt: item.publishedAt };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      if (item.category === "connection" && item.active && !item.draft) {
        syncPreviewSerial(Object.fromEntries(GATE_DEFINITIONS.filter(entry => entry.category === "connection").flatMap(entry => {
          const active = store.items[entry.id]?.active;
          return active?.enabled ? [[entry.id, active]] : [];
        })));
      }
    }
    catch {
      for (const [key, value] of [[STORAGE_KEY, beforeItems], [FACTORY_STORAGE_KEY, beforeFactory]] as const) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      throw new GateApiError("本地预览数据未保存，请检查浏览器存储权限或空间后重试。", 500);
    }
    return copy(item);
  };
  return navigator.locks ? navigator.locks.request(LOCK_KEY, operation) : operation();
}

export const previewApi: ElectronicGateApi = {
  async list() {
    await pause();
    if (new URLSearchParams(window.location.search).get("scenario") === "load-error") throw new GateApiError("示例加载失败。移除地址中的 scenario=load-error 后可恢复正常预览。", 503);
    const store = readStore();
    return { items: GATE_DEFINITIONS.map(item => itemFromStore(item.id, store)) };
  },
  saveDraft: (id, expectedRevision, draft) => mutate(id, expectedRevision, item => {
    validate(item, draft, false);
    item.draft = copy(draft);
  }),
  publish: (id, expectedRevision) => mutate(id, expectedRevision, item => {
    if (!item.draft) throw new GateApiError("本项没有可发布的已保存草稿。", 400);
    validate(item, item.draft, true);
    item.active = copy(item.draft);
    item.draft = null;
    item.publishedAt = new Date().toISOString();
  }),
};


setPreviewSerialRollbackHandler(config => {
  const store = readStore();
  for (const [id, values] of Object.entries(serialToItemValues(config))) {
    const item = itemFromStore(id, store);
    const previous = item.active ?? item.defaults;
    item.active = { ...copy(previous), enabled: true, values: { ...previous.values, ...values } };
    item.revision++;
    item.updatedAt = new Date().toISOString();
    item.publishedAt = item.updatedAt;
    item.updatedBy = "示例管理员";
    store.items[id] = { draft: item.draft, active: item.active, revision: item.revision, updatedAt: item.updatedAt, updatedBy: item.updatedBy, publishedAt: item.publishedAt };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
});
