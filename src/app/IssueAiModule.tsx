/**
 * 问题记录与 AI 定位模块 — 页面外壳。
 * 单一数据源、单页：清单 ↔ 详情用模块内状态切换（非独立路由），用面包屑返回。
 * 数据全部经 IssueService 抽象；已接入真实后端（apps/api 的 issue 模块）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { createHttpIssueService } from "./lib/issue/issueHttpService";
import { ListView } from "./issue-ai/ListView";
import { DetailView } from "./issue-ai/DetailView";
import { t, useI18n } from "./lib/i18n";

export function IssueAiModule() {
  useI18n();
  // 共享一个 HTTP service 实例（无状态，仅复用引用避免子组件 effect 反复重建）。
  const service = useMemo(() => createHttpIssueService(), []);
  // 选中项由 URL ?issue= 驱动：既支持模块内清单↔详情切换，也支持外部（如研发任务「生成问题」）直达某条问题。
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("issue");
  const lastOpenedIssueIdRef = useRef<string | null>(null);
  const focusDetailOnNextRenderRef = useRef(false);
  const detailContextRef = useRef<HTMLDivElement | null>(null);
  const [restoreFocusIssueId, setRestoreFocusIssueId] = useState<string | null>(null);

  const setSelectedId = useCallback((id: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id) p.set("issue", id);
        else p.delete("issue");
        return p;
      },
      { replace: true },
    ), [setParams]);

  const openIssue = useCallback((id: string) => {
    lastOpenedIssueIdRef.current = id;
    focusDetailOnNextRenderRef.current = true;
    setRestoreFocusIssueId(null);
    setSelectedId(id);
  }, [setSelectedId]);

  const returnToList = useCallback(() => {
    setRestoreFocusIssueId(lastOpenedIssueIdRef.current ?? selectedId);
    setSelectedId(null);
  }, [selectedId, setSelectedId]);

  // 清单与详情是条件渲染：进入详情后将焦点落在新页上下文，避免原卡片卸载后焦点丢失。
  useEffect(() => {
    if (!selectedId || !focusDetailOnNextRenderRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (detailContextRef.current) {
        detailContextRef.current.scrollTop = 0;
        detailContextRef.current.focus({ preventScroll: true });
      }
      focusDetailOnNextRenderRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  return (
    <div className="horizon-theme hz-page rd-horizon-module rd-horizon-issue-ai flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {selectedId ? (
        // 详情：窄屏整页滚动；xl+ 两栏各自定高、内部滚动（不超出视口）
        <div
          ref={detailContextRef}
          role="region"
          aria-label={t("问题详情")}
          tabIndex={-1}
          className="rd-horizon-issue-detail-viewport material-scrollbar min-h-0 flex-1 overflow-y-auto outline-none xl:overflow-hidden"
        >
          <div className="rd-horizon-issue-detail-shell mx-auto flex min-h-full w-full max-w-[1520px] px-4 py-4 sm:px-5 lg:px-6 xl:h-full">
            <DetailView service={service} issueId={selectedId} onBack={returnToList} />
          </div>
        </div>
      ) : (
        // 清单：内容自然流动、整体可滚动（列表项卡片，数据少不撑空、分页紧跟列表）
        <div className="rd-horizon-issue-list-viewport material-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="rd-horizon-issue-list-shell mx-auto w-full max-w-[1520px] px-4 py-4 sm:px-5 lg:px-6">
            <ListView
              service={service}
              onOpen={openIssue}
              restoreFocusIssueId={restoreFocusIssueId}
              onFocusRestored={() => setRestoreFocusIssueId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default IssueAiModule;
