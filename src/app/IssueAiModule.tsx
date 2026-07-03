/**
 * 问题记录与 AI 定位模块 — 页面外壳。
 * 单一数据源、单页：清单 ↔ 详情用模块内状态切换（非独立路由），用面包屑返回。
 * 数据全部经 IssueService 抽象；已接入真实后端（apps/api 的 issue 模块）。
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router";

import { createHttpIssueService } from "./lib/issue/issueHttpService";
import { ListView } from "./issue-ai/ListView";
import { DetailView } from "./issue-ai/DetailView";

export function IssueAiModule() {
  // 共享一个 HTTP service 实例（无状态，仅复用引用避免子组件 effect 反复重建）。
  const service = useMemo(() => createHttpIssueService(), []);
  // 选中项由 URL ?issue= 驱动：既支持模块内清单↔详情切换，也支持外部（如研发任务「生成问题」）直达某条问题。
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("issue");
  const setSelectedId = (id: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id) p.set("issue", id);
        else p.delete("issue");
        return p;
      },
      { replace: true },
    );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden  text-slate-900   ring-slate-200/70 dark:bg-slate-950 dark:bg-none dark:text-slate-100 dark:ring-slate-800">
      {selectedId ? (
        // 详情：窄屏整页滚动；xl+ 两栏各自定高、内部滚动（不超出视口）
        <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto xl:overflow-hidden">
          <div className="mx-auto flex min-h-full w-full max-w-[1520px] px-4 py-4 sm:px-5 lg:px-6 xl:h-full">
            <DetailView service={service} issueId={selectedId} onBack={() => setSelectedId(null)} />
          </div>
        </div>
      ) : (
        // 清单：内容自然流动、整体可滚动（列表项卡片，数据少不撑空、分页紧跟列表）
        <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1520px] px-4 py-4 sm:px-5 lg:px-6">
            <ListView service={service} onOpen={setSelectedId} />
          </div>
        </div>
      )}
    </div>
  );
}

export default IssueAiModule;
