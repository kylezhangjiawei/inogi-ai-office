/**
 * 问题记录与 AI 定位模块 — 页面外壳。
 * 单一数据源、单页：清单 ↔ 详情用模块内状态切换（非独立路由），用面包屑返回。
 * 数据全部经 IssueService 抽象（本期内存 mock，真实接入仅替换实现）。
 */
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { createIssueService } from "./lib/issue/issueService";
import { Mono } from "./issue-ai/badges";
import { ListView } from "./issue-ai/ListView";
import { DetailView } from "./issue-ai/DetailView";

export function IssueAiModule() {
  // 整个会话共享一个内存 service 实例（create/adopt/adjust 的变更跨清单↔详情保留）。
  const service = useMemo(() => createIssueService(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/60 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {selectedId ? (
        // 详情：整页可滚动
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] px-5 py-5 lg:px-7 lg:py-6">
            <DetailView service={service} issueId={selectedId} onBack={() => setSelectedId(null)} />
          </div>
        </div>
      ) : (
        // 清单：内容自然流动、整体可滚动（列表项卡片，数据少不撑空、分页紧跟列表）
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] px-5 py-5 lg:px-7 lg:py-6">
            <ListView service={service} onOpen={setSelectedId} />
          </div>
        </div>
      )}
    </div>
  );
}

export default IssueAiModule;
