/**
 * 研发数据表本地草稿（IndexedDB）：保存失败 / 页面意外关闭时的数据兜底。
 *
 * 为什么用 IndexedDB：快照可达数十 MB，localStorage（~5MB、同步阻塞）放不下；
 * IndexedDB 支持结构化克隆直接存对象，无需 JSON 序列化。
 *
 * 所有操作 fail-soft：隐私模式 / 存储被禁时静默降级为 no-op，绝不影响正常编辑保存流程。
 */

const DB_NAME = "inogi-rd-sheet";
const STORE = "drafts";
const DRAFT_KEY = "rd-sheet-workbook";

export type RdSheetDraft = {
  snapshot: Record<string, unknown>;
  /** 草稿落盘时间（ISO） */
  saved_at: string;
  /** 草稿基于的服务器版本（加载/上次保存成功时的 updated_at），用于恢复时判断是否已过期 */
  base_updated_at: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function saveRdSheetDraft(draft: RdSheetDraft): Promise<boolean> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      await requestToPromise(tx.objectStore(STORE).put(draft, DRAFT_KEY));
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export async function loadRdSheetDraft(): Promise<RdSheetDraft | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const value = await requestToPromise(tx.objectStore(STORE).get(DRAFT_KEY));
      if (
        value &&
        typeof value === "object" &&
        typeof (value as RdSheetDraft).saved_at === "string" &&
        (value as RdSheetDraft).snapshot &&
        typeof (value as RdSheetDraft).snapshot === "object"
      ) {
        return value as RdSheetDraft;
      }
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clearRdSheetDraft(): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      await requestToPromise(tx.objectStore(STORE).delete(DRAFT_KEY));
    } finally {
      db.close();
    }
  } catch {
    /* 清除失败无害：下次恢复提示时用户可选择放弃 */
  }
}
