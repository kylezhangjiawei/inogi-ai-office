import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRdTaskCategories, type RdCategory, type RdTask } from "../lib/rdApi";
import {
  buildCatStats,
  computePersonLoads,
  computeRisks,
  flattenTasks,
  type CatStat,
  type PersonLoad,
  type Risk,
} from "../lib/rdCockpitMetrics";

export type RDCockpitSummary = {
  /** 非归档任务总数 */
  totalActive: number;
  inProgress: number;
  done: number;
  /** 阻塞 + 待指派 */
  blocked: number;
  /** 完成率（已完成 / 活跃，百分比取整） */
  rate: number;
  riskCount: number;
};

export type RDCockpitData = {
  categories: RdCategory[];
  loading: boolean;
  error: string | null;
  /** 重新拉取任务树 */
  reload: () => void;
  risks: Risk[];
  catStats: CatStat[];
  personLoads: PersonLoad[];
  /** 全部任务（含归档），按最后活动时间倒序 —— 与桌面驾驶舱同口径 */
  allTasks: RdTask[];
  summary: RDCockpitSummary;
};

/**
 * 研发任务驾驶舱「移动只读视图」的数据层。
 *
 * 仅拉取一个 `fetchRdTaskCategories()`，其余 KPI / 风险 / 任务列表 / 人员负载
 * 全部由桌面页导出的纯函数（computeRisks / buildCatStats / computePersonLoads /
 * flattenTasks）就地计算，确保与桌面端「完全同口径」，且不重复实现取数/算法。
 */
export function useRDCockpitData(): RDCockpitData {
  const [categories, setCategories] = useState<RdCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchRdTaskCategories({ includeCovers: true, signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setCategories(next);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setCategories([]);
        setError(e instanceof Error ? e.message : "研发任务接口加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [reloadToken]);

  const risks = useMemo(() => computeRisks(categories), [categories]);
  const catStats = useMemo(() => buildCatStats(categories, risks), [categories, risks]);
  const personLoads = useMemo(() => computePersonLoads(categories), [categories]);

  const allTasks = useMemo(() => {
    const tasks = flattenTasks(categories.flatMap((c) => c.children.flatMap((s) => s.tasks)));
    // 与桌面同口径：按「最后活动时间」倒序（last_activity_at 退化到 updated_at）。
    return tasks.sort((a, b) => {
      const ta = a.last_activity_at ?? a.updated_at ?? "";
      const tb = b.last_activity_at ?? b.updated_at ?? "";
      if (tb > ta) return 1;
      if (tb < ta) return -1;
      return 0;
    });
  }, [categories]);

  const summary = useMemo<RDCockpitSummary>(() => {
    const active = allTasks.filter((t) => !t.archived);
    const done = active.filter((t) => t.status === "completed").length;
    return {
      totalActive: active.length,
      inProgress: active.filter((t) => t.status === "in_progress").length,
      done,
      blocked: active.filter((t) => t.status === "paused_blocked" || t.status === "pending_assign").length,
      rate: active.length > 0 ? Math.round((done / active.length) * 100) : 0,
      riskCount: risks.length,
    };
  }, [allTasks, risks]);

  return { categories, loading, error, reload, risks, catStats, personLoads, allTasks, summary };
}
