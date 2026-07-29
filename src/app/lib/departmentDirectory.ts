import { useEffect, useMemo, useState } from "react";

import { authFetch } from "./authSession";

export type DepartmentDirectoryItem = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
};

export type DepartmentChange = {
  id: string;
  previousName: string;
  name: string;
  previousCode: string;
  code: string;
};

const DEPARTMENT_CHANGE_EVENT = "inogi-department-directory-changed";
const DEPARTMENT_CHANGE_STORAGE_KEY = "inogi-department-directory-change";
const EMPLOYEE_ROSTER_STORAGE_KEY = "employee-archive-roster";

let directoryCache: DepartmentDirectoryItem[] | null = null;
let directoryPromise: Promise<DepartmentDirectoryItem[]> | null = null;

async function fetchDepartmentDirectory() {
  const response = await authFetch("/api/departments/directory");
  if (!response.ok) throw new Error("获取部门目录失败");
  return response.json() as Promise<DepartmentDirectoryItem[]>;
}

export function invalidateDepartmentDirectory() {
  directoryCache = null;
  directoryPromise = null;
}

export function loadDepartmentDirectory() {
  if (directoryCache) return Promise.resolve(directoryCache);
  if (!directoryPromise) {
    directoryPromise = fetchDepartmentDirectory()
      .then((items) => {
        directoryCache = items;
        return items;
      })
      .finally(() => {
        directoryPromise = null;
      });
  }
  return directoryPromise;
}

function migrateBrowserDepartmentSnapshots(change: DepartmentChange) {
  if (typeof window === "undefined" || change.previousName === change.name) return;
  try {
    const raw = window.localStorage.getItem(EMPLOYEE_ROSTER_STORAGE_KEY);
    if (!raw) return;
    const records = JSON.parse(raw) as unknown;
    if (!Array.isArray(records)) return;
    let changed = false;
    const next = records.map((record) => {
      if (
        record &&
        typeof record === "object" &&
        !Array.isArray(record) &&
        (record as { department?: unknown }).department === change.previousName
      ) {
        changed = true;
        return { ...record, department: change.name };
      }
      return record;
    });
    if (changed) {
      window.localStorage.setItem(EMPLOYEE_ROSTER_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // 损坏或不可访问的本地缓存交由对应页面自己的容错逻辑处理。
  }
}

export function publishDepartmentChange(change: DepartmentChange) {
  if (typeof window === "undefined") return;
  invalidateDepartmentDirectory();
  migrateBrowserDepartmentSnapshots(change);
  window.dispatchEvent(
    new CustomEvent<DepartmentChange>(DEPARTMENT_CHANGE_EVENT, { detail: change }),
  );
  try {
    window.localStorage.setItem(
      DEPARTMENT_CHANGE_STORAGE_KEY,
      JSON.stringify({ ...change, emittedAt: Date.now(), nonce: window.crypto?.randomUUID?.() }),
    );
  } catch {
    // 同页事件已经发出；隐私模式或存储配额问题只影响跨标签页通知。
  }
}

export function subscribeDepartmentChanges(listener: (change: DepartmentChange) => void) {
  if (typeof window === "undefined") return () => undefined;

  const onLocalChange = (event: Event) => {
    const change = (event as CustomEvent<DepartmentChange>).detail;
    if (change) listener(change);
  };
  const onStorageChange = (event: StorageEvent) => {
    if (event.key !== DEPARTMENT_CHANGE_STORAGE_KEY || !event.newValue) return;
    try {
      const change = JSON.parse(event.newValue) as DepartmentChange;
      if (!change?.id || !change.name) return;
      invalidateDepartmentDirectory();
      migrateBrowserDepartmentSnapshots(change);
      listener(change);
    } catch {
      // 忽略其它标签页写入的无效通知。
    }
  };

  window.addEventListener(DEPARTMENT_CHANGE_EVENT, onLocalChange);
  window.addEventListener("storage", onStorageChange);
  return () => {
    window.removeEventListener(DEPARTMENT_CHANGE_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorageChange);
  };
}

export function useDepartmentDirectory() {
  const [items, setItems] = useState<DepartmentDirectoryItem[]>(directoryCache ?? []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadDepartmentDirectory()
        .then((next) => {
          if (active) setItems(next);
        })
        .catch(() => {
          // 目录不可用时保留已有名称，避免影响页面主体功能。
        });
    };

    refresh();
    const unsubscribe = subscribeDepartmentChanges(() => {
      invalidateDepartmentDirectory();
      refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return useMemo(() => {
    const byCode = new Map(items.map((item) => [item.code, item]));
    const byId = new Map(items.map((item) => [item.id, item]));
    return {
      items,
      byCode,
      byId,
      nameByCode: (code: string | null | undefined, fallback = "") =>
        (code ? byCode.get(code)?.name : undefined) ?? fallback,
    };
  }, [items]);
}
