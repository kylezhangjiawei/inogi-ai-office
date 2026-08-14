// 采购模块共享数据源与日期/汇总助手。
//
// 采购任务与物料被三个页面和多个卡片/抽屉同时消费，这里用一个模块级 store
// （useSyncExternalStore 订阅）保证：无论多少组件调用，一次会话只拉一次接口，
// 且任一处写操作后 refreshProcurement() 能让所有订阅者同步刷新。
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  listMaterials,
  listProcTasks,
  type Material,
  type ProcStatus,
  type ProcurementTask,
} from "../lib/procurementApi";
import { fetchRdProducts, type RdProductStatus } from "../lib/rdApi";

export type {
  BusinessLine,
  Material,
  MaterialReviewSource,
  MaterialReviewStatus,
  PaymentStatus,
  ProcLog,
  ProcMethod,
  ProcSource,
  ProcStatus,
  ProcurementTask,
  Quotation,
} from "../lib/procurementApi";

/** 产品线取值来自物料数据（BOM 导入回填：R1 / R2 / 通用），动态派生而非写死。 */
export function useProductLines(): string[] {
  const { materials } = useProcurementData();
  return useMemo(
    () => Array.from(new Set(materials.map((m) => m.productLine).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [materials],
  );
}

// ── 模块级 store ──────────────────────────────────────────────────────────────

interface ProcState {
  tasks: ProcurementTask[];
  materials: Material[];
  loading: boolean;
  error: string | null;
}

let state: ProcState = { tasks: [], materials: [], loading: true, error: null };
let started = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** 研发任务详情用它感知采购侧的创建、审核、打回删除等变更。 */
export const PROCUREMENT_REFRESH_EVENT = "inogi:procurement-refreshed";
const procurementRefreshChannel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel(PROCUREMENT_REFRESH_EVENT)
  : null;

function notifyProcurementRefreshed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROCUREMENT_REFRESH_EVENT));
  procurementRefreshChannel?.postMessage({ refreshedAt: Date.now() });
}

/** 研发侧只需要通知关联状态重查，不应为此读取整套采购任务与物料数据。 */
export function announceProcurementRefresh() {
  notifyProcurementRefreshed();
}

if (procurementRefreshChannel && typeof window !== "undefined") {
  procurementRefreshChannel.addEventListener("message", () => {
    window.dispatchEvent(new Event(PROCUREMENT_REFRESH_EVENT));
  });
}

function emit(next: Partial<ProcState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function load() {
  emit({ loading: true, error: null });
  try {
    const [tasks, materials] = await Promise.all([listProcTasks(), listMaterials()]);
    emit({ tasks, materials, loading: false, error: null });
    notifyProcurementRefreshed();
  } catch (err) {
    emit({ loading: false, error: err instanceof Error ? err.message : "采购数据加载失败" });
  }
}

/** 写操作后调用：重新拉取并广播给所有订阅组件。并发调用会合并成一次请求。 */
export function refreshProcurement(): Promise<void> {
  if (!inflight) {
    inflight = load().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * 采购数据（任务 + 物料）。首个挂载的组件触发加载，其余共享同一份结果。
 */
export function useProcurementData() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  useEffect(() => {
    if (!started) {
      started = true;
      void refreshProcurement();
    }
  }, []);
  const refresh = useCallback(() => refreshProcurement(), []);
  return { ...snapshot, refresh };
}

// ── 日期助手（以真实今天为基准）────────────────────────────────────────────────

const ONE_DAY = 24 * 3600 * 1000;

/** 相对今天的天数差：正=未来剩 N 天，负=已逾期 N 天。 */
export function daysFromToday(dateStr?: string): number | null {
  if (!dateStr) return null;
  const t = Date.parse(`${dateStr.slice(0, 10)}T00:00:00`);
  const base = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
  if (Number.isNaN(t) || Number.isNaN(base)) return null;
  return Math.round((t - base) / ONE_DAY);
}

/** 已下单及之后显示「预计到货」，之前显示「Deadline / 需求日期」。 */
const ARRIVAL_STATUSES: ProcStatus[] = ["in_transit", "partial_arrival", "completed"];
export function taskMainDate(task: ProcurementTask): {
  label: string;
  date?: string;
  days: number | null;
} {
  if (ARRIVAL_STATUSES.includes(task.status)) {
    return {
      label: "预计到货",
      date: task.expectedArrivalDate,
      days: daysFromToday(task.expectedArrivalDate),
    };
  }
  const date = task.deadline ?? task.needDate;
  return { label: task.deadline ? "Deadline" : "需求日期", date, days: daysFromToday(date) };
}

export type ProcurementProduct = {
  id: string;
  name: string;
  status: RdProductStatus;
};

export const DEFAULT_PROCUREMENT_PRODUCT_ID = "prod-portable-o2";

const DEFAULT_PROCUREMENT_PRODUCTS: ProcurementProduct[] = [
  { id: DEFAULT_PROCUREMENT_PRODUCT_ID, name: "便携式制氧机", status: "active" },
  { id: "prod-5l-dc-o2", name: "5L直流式制氧机", status: "developing" },
  { id: "prod-positive-pressure-respirator", name: "正压式呼吸器", status: "developing" },
];

/** 采购系统与研发驾驶舱共用产品定义；缺少默认产品时补齐，避免配置接口短暂失败导致全景不可用。 */
export function useProcurementProducts(): ProcurementProduct[] {
  const [products, setProducts] = useState<ProcurementProduct[]>(DEFAULT_PROCUREMENT_PRODUCTS);

  useEffect(() => {
    let active = true;
    void fetchRdProducts()
      .then((items) => {
        if (!active) return;
        const merged = DEFAULT_PROCUREMENT_PRODUCTS.map((fallback) => {
          const configured = items.find((item) => item.id === fallback.id || item.name.trim() === fallback.name);
          return configured
            ? { id: configured.id, name: configured.name.trim(), status: configured.status ?? fallback.status }
            : fallback;
        });
        for (const item of items) {
          if (merged.some((product) => product.id === item.id || product.name === item.name.trim())) continue;
          merged.push({ id: item.id, name: item.name.trim(), status: item.status ?? "developing" });
        }
        setProducts(merged);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return products;
}

/** 统一采购逾期口径：下单前看 Deadline/需求日期，下单后看预计到货日。 */
export function isProcurementTaskOverdue(task: ProcurementTask): boolean {
  return (taskMainDate(task).days ?? Number.POSITIVE_INFINITY) < 0;
}

/** 需求提出人：优先取显式 requester；研发流转回退研发对接人，自建回退采购负责人。 */
export function taskRequester(task: ProcurementTask): { name: string; dept: string } {
  return {
    name: task.requester ?? task.rdContact ?? task.buyer,
    dept: task.requesterDept ?? "",
  };
}

/** 物料汇总：在途量 / 关联任务数由任务实时计算，保证物料页与任务页自洽。 */
export function materialAggregates(
  tasks: ProcurementTask[],
  materialName: string,
): { inTransit: number; taskCount: number } {
  let inTransit = 0;
  let taskCount = 0;
  for (const t of tasks) {
    if (t.materialName !== materialName) continue;
    taskCount += 1;
    if (t.status === "in_transit" || t.status === "partial_arrival") {
      inTransit += Math.max(0, t.quantity - t.arrivedQty);
    }
  }
  return { inTransit, taskCount };
}
