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
/** 正在飞的请求之后要补发的那一次刷新（见 refreshProcurement 注释）。 */
let queued: Promise<void> | null = null;
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

/**
 * 用写接口返回的最新任务就地替换 store 里的那一条。
 *
 * 为什么必须有这一步：写成功后只做 `refreshProcurement()` 是「重拉全部任务和物料」，
 * 数据量一上来要好几秒。这几秒里详情抽屉、卡片上的「下一步」按钮显示的都还是旧状态，
 * 用户看到的就是「点了保存没反应」，于是再点一次——而按钮的含义此时可能已经变成下一个动作，
 * 于是任务一节一节往前窜，最后停在「已完成」。
 *
 * 写接口本来就返回了更新后的任务，直接用它即可让界面立刻正确；整体刷新照旧在后台跑。
 */
export function applyProcTaskUpdate(task: ProcurementTask): void {
  const idx = state.tasks.findIndex((item) => item.id === task.id);
  if (idx === -1) return;
  const tasks = state.tasks.slice();
  tasks[idx] = task;
  emit({ tasks });
  notifyProcurementRefreshed();
}

/**
 * 写操作后调用：重新拉取并广播给所有订阅组件。
 *
 * 关键点：**不能**直接复用正在飞的那次请求。调用方是在自己的写入落库之后才调进来的，
 * 而正在飞的请求可能早于该写入就发出了，它带回来的是写入之前的快照。之前的实现直接
 * `return inflight`，导致「保存成功但界面不动」——用户以为没生效就反复点，每一次其实
 * 都真的推进了一个节点，等某次刷新恰好拿到新数据时，任务已经窜到很后面甚至已完成。
 *
 * 所以这里只合并「还没开始发出的那一批」：有请求在飞就排一次后续刷新，保证返回的
 * promise 对应的读取一定发生在本次调用之后。
 */
export function refreshProcurement(): Promise<void> {
  if (!inflight) {
    inflight = load().finally(() => {
      inflight = null;
    });
    return inflight;
  }
  if (!queued) {
    queued = inflight
      .catch(() => undefined)
      .then(() => {
        // 先清空再发起：此刻之后进来的调用要另排一次，不能搭上这班已经出发的车
        queued = null;
        inflight = load().finally(() => {
          inflight = null;
        });
        return inflight;
      });
  }
  return queued;
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

/**
 * 统一采购逾期口径：下单前看 Deadline/需求日期，下单后看预计到货日。
 * 已完成/已取消的任务不再逾期——终态任务的日期已经没有催办意义，算进去会让驾驶舱
 * 的「逾期」数虚高（历史上 5 个任务能显示逾期 4），卡片上也会给已取消的任务挂红标。
 */
export function isProcurementTaskOverdue(task: ProcurementTask): boolean {
  if (task.status === "completed" || task.status === "cancelled") return false;
  return (taskMainDate(task).days ?? Number.POSITIVE_INFINITY) < 0;
}

/** 需求提出人：优先取显式 requester；研发流转回退研发对接人，自建回退采购负责人。 */
export function taskRequester(task: ProcurementTask): { name: string; dept: string } {
  return {
    name: task.requester ?? task.rdContact ?? task.buyer,
    dept: task.requesterDept ?? "",
  };
}

/**
 * 任务是否属于该物料。物料主档里存在同名不同 ID 的记录（T+ 同步而来，例如
 * 「【研发样品】丁腈密封圈」有 22 条），只按名称匹配会把它们的任务混在一起，
 * 在途量和任务数都会串。有 materialId 就按 ID 比；存量任务的 materialId 可能
 * 为空，这时才回落到名称 —— 与 ProcTask.materialId 上「为空时按物料名推导」的
 * 既有约定一致，不会让老任务掉出列表。
 */
export function isTaskOfMaterial(
  task: Pick<ProcurementTask, "materialId" | "materialName">,
  material: Pick<Material, "id" | "name">,
): boolean {
  return task.materialId ? task.materialId === material.id : task.materialName === material.name;
}

/** 物料汇总：在途量 / 关联任务数由任务实时计算，保证物料页与任务页自洽。 */
export function materialAggregates(
  tasks: ProcurementTask[],
  material: Pick<Material, "id" | "name">,
): { inTransit: number; taskCount: number } {
  let inTransit = 0;
  let taskCount = 0;
  for (const t of tasks) {
    if (!isTaskOfMaterial(t, material)) continue;
    taskCount += 1;
    if (t.status === "in_transit" || t.status === "partial_arrival") {
      inTransit += Math.max(0, t.quantity - t.arrivedQty);
    }
  }
  return { inTransit, taskCount };
}
