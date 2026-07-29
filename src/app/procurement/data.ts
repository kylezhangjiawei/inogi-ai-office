// 采购模块共享数据源与日期/汇总助手。
//
// 采购任务与物料被三个页面和多个卡片/抽屉同时消费，这里用一个模块级 store
// （useSyncExternalStore 订阅）保证：无论多少组件调用，一次会话只拉一次接口，
// 且任一处写操作后 refreshProcurement() 能让所有订阅者同步刷新。
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  listMaterials,
  listProcTasks,
  type Material,
  type ProcStatus,
  type ProcurementTask,
} from "../lib/procurementApi";

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
