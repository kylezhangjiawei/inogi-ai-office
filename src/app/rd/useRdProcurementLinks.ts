import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { listRdProcurementLinks, type ProcurementTask } from "../lib/procurementApi";
import { PROCUREMENT_REFRESH_EVENT } from "../procurement/data";

const REFRESH_INTERVAL_MS = 60_000;
const EMPTY_LINKS: Record<string, ProcurementTask> = Object.freeze({});

type LinkSnapshot = {
  scope: string;
  links: Record<string, ProcurementTask>;
  loading: boolean;
  error: string | null;
};

/** Only the current account's visible R&D task IDs are sent to the batch endpoint. */
export function useRdProcurementLinks(rdTaskIds: string[]): {
  links: Record<string, ProcurementTask>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const idsKey = JSON.stringify([...new Set(rdTaskIds.filter(Boolean))].sort());
  const scope = JSON.stringify([userId, idsKey]);
  const enabled = Boolean(userId) && idsKey !== "[]";
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const refreshRef = useRef<(() => void) | null>(null);
  const [snapshot, setSnapshot] = useState<LinkSnapshot>(() => ({
    scope, links: EMPTY_LINKS, loading: enabled, error: null,
  }));
  const refresh = useCallback(() => refreshRef.current?.(), []);

  useEffect(() => {
    setSnapshot((previous) => previous.scope === scope ? previous : {
      scope, links: EMPTY_LINKS, loading: enabled, error: null,
    });
    if (!enabled) return;

    const ids = JSON.parse(idsKey) as string[];
    const requestedIds = new Set(ids);
    let active = true;
    let inFlight = false;
    let queued = false;
    let controller: AbortController | null = null;
    const isCurrent = () => active && latestScope.current === scope;

    const load = async (queueIfBusy = false) => {
      if (!isCurrent() || document.visibilityState === "hidden") return;
      if (inFlight) {
        // A mutation can finish after this read began. Recheck once after the pending read.
        if (queueIfBusy) queued = true;
        return;
      }
      inFlight = true;
      const request = new AbortController();
      controller = request;
      setSnapshot((previous) => ({
        scope, links: previous.scope === scope ? previous.links : EMPTY_LINKS,
        loading: true, error: null,
      }));
      try {
        const tasks = await listRdProcurementLinks(ids, request.signal);
        if (!isCurrent() || request.signal.aborted) return;
        const links: Record<string, ProcurementTask> = Object.create(null);
        for (const task of tasks) {
          if (task.rdTaskId && requestedIds.has(task.rdTaskId)) links[task.rdTaskId] = task;
        }
        setSnapshot({ scope, links, loading: false, error: null });
      } catch (error) {
        if (!isCurrent() || request.signal.aborted) return;
        setSnapshot((previous) => ({
          scope, links: previous.scope === scope ? previous.links : EMPTY_LINKS,
          loading: false, error: error instanceof Error && error.message.trim() ? error.message : "采购关联状态加载失败",
        }));
      } finally {
        inFlight = false;
        if (isCurrent() && queued) {
          queued = false;
          void load();
        }
      }
    };

    const refreshScoped = () => { void load(true); };
    const refreshVisible = () => { void load(); };
    refreshRef.current = refreshScoped;
    refreshVisible();
    const interval = window.setInterval(refreshVisible, REFRESH_INTERVAL_MS);
    window.addEventListener(PROCUREMENT_REFRESH_EVENT, refreshScoped);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      queued = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener(PROCUREMENT_REFRESH_EVENT, refreshScoped);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      if (refreshRef.current === refreshScoped) refreshRef.current = null;
    };
  }, [scope, idsKey, enabled]);

  // Mask the old snapshot during render, before effect cleanup runs on an account/range change.
  const current = snapshot.scope === scope ? snapshot : {
    links: EMPTY_LINKS, loading: enabled, error: null,
  };
  return { links: current.links, loading: current.loading, error: current.error, refresh };
}
