import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchRdCockpitTaskCategories,
  fetchRdPeople,
  type RdCategory,
  type RdPersonLoad,
  type RdTask,
} from "../lib/rdApi";
import {
  buildCatStats,
  computePersonLoads,
  computeRisks,
  type CatStat,
  type PersonLoad,
  type Risk,
} from "../lib/rdCockpitMetrics";
import { rootTasksFromCategories } from "../lib/rdTaskTreeVisibility";

// 合并任务接口一次返回全部产品库的任务事实与卡片封面，移动端不再从主库二次回填。
const PEOPLE_DIRECTORY_REFRESH_INTERVAL_MS = 60_000;


export type RDCockpitSummary = {
  /** 活跃任务数：非归档**且未完成**。与个人工作台的 activeRoleTasks 同口径。 */
  totalActive: number;
  inProgress: number;
  done: number;
  /** 阻塞 + 待指派 */
  blocked: number;
  /** 完成率（已完成 / 非归档总数，百分比取整）。分母含已完成，否则完成率无意义。 */
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
  /** 驾驶舱根任务（含归档），按最后活动时间倒序；子任务只在父任务详情展示。 */
  allTasks: RdTask[];
  summary: RDCockpitSummary;
};

/**
 * 研发任务驾驶舱「移动只读视图」的数据层。
 *
 * 任务事实源使用 `fetchRdCockpitTaskCategories({ includeCovers: true })`，一次覆盖主库、
 * 全部产品库及其卡片封面。其余 KPI / 风险 / 任务列表 / 人员负载全部由
 * 共享纯函数（computeRisks / buildCatStats / computePersonLoads / 根任务提取）就地计算，
 * 确保与桌面端「完全同口径」，且不重复实现取数/算法。
 */
export function useRDCockpitData(): RDCockpitData {
  const [categories, setCategories] = useState<RdCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // 人员目录：computePersonLoads 必须拿到它才能只保留驾驶舱配置的成员（缺它则白名单失效）。
  const [peopleDirectory, setPeopleDirectory] = useState<RdPersonLoad[]>([]);
  const hasTaskSnapshotRef = useRef(false);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    if (!hasTaskSnapshotRef.current) setLoading(true);
    setError(null);
    fetchRdCockpitTaskCategories({ includeCovers: true, signal: controller.signal })
      .then((mergedCategories) => {
        if (!controller.signal.aborted) {
          setCategories(mergedCategories);
          hasTaskSnapshotRef.current = true;
        }
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        // 后台轮询失败时保留最后一次成功快照；首次加载仍由 error + 空列表展示阻断态。
        setError(e instanceof Error ? e.message : "研发任务接口加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [reloadToken]);

  // 人员目录低频独立刷新，避免跟随 15 秒任务轮询重复请求；失败时保留最后一次成功快照。
  useEffect(() => {
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;

    const refreshPeople = () => {
      if (!active || inFlight) return;
      controller = new AbortController();
      inFlight = true;
      fetchRdPeople({ signal: controller.signal })
        .then((people) => {
          if (active && !controller?.signal.aborted) setPeopleDirectory(people);
        })
        .catch(() => {
          // 目录刷新失败不清空已有人员，防止任务计数在短暂断网时整体消失。
        })
        .finally(() => {
          inFlight = false;
        });
    };

    refreshPeople();
    const interval = window.setInterval(refreshPeople, PEOPLE_DIRECTORY_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshPeople);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshPeople);
    };
  }, []);

  const risks = useMemo(() => computeRisks(categories), [categories]);
  const catStats = useMemo(() => buildCatStats(categories, risks), [categories, risks]);
  const personLoads = useMemo(
    () => computePersonLoads(categories, 8, peopleDirectory),
    [categories, peopleDirectory],
  );

  const allTasks = useMemo(() => {
    const tasks = rootTasksFromCategories(categories);
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
    // 「非归档」是完成率的分母；「活跃」再排除已完成，供活跃/进行中/阻塞计数使用。
    const nonArchived = allTasks.filter((t) => !t.archived && t.status !== "archived");
    const done = nonArchived.filter((t) => t.status === "completed").length;
    const active = nonArchived.filter((t) => t.status !== "completed");
    return {
      totalActive: active.length,
      inProgress: active.filter((t) => t.status === "in_progress").length,
      done,
      blocked: active.filter((t) => t.status === "paused_blocked" || t.status === "pending_assign").length,
      rate: nonArchived.length > 0 ? Math.round((done / nonArchived.length) * 100) : 0,
      riskCount: risks.length,
    };
  }, [allTasks, risks]);

  return { categories, loading, error, reload, risks, catStats, personLoads, allTasks, summary };
}
