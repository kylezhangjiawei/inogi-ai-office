import React, { useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { moduleConfigs } from "./ModulePage";

const sectionPageSize = 4;

function matchesKeyword(keyword: string, values: string[]) {
  if (!keyword) return true;
  return values.join(" ").toLowerCase().includes(keyword.toLowerCase());
}

function cycleStatus(status: "done" | "current" | "pending") {
  if (status === "pending") return "current";
  if (status === "current") return "done";
  return "pending";
}

export function EnhancedModulePage() {
  const location = useLocation();
  const moduleId = location.pathname.replace(/^\//, "");
  const config = moduleConfigs[moduleId];
  const [keyword, setKeyword] = useState("");
  const [pageBySection, setPageBySection] = useState<Record<string, number>>({});
  const [selectedDetail, setSelectedDetail] = useState<{ title: string; detail: string; tag?: string } | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<string, "done" | "current" | "pending">>({});
  const [selectedRecords, setSelectedRecords] = useState<Record<string, boolean>>({});

  if (!config) return <Navigate to="/" replace />;

  const filteredSections = useMemo(() => {
    return config.sections.map((section) => {
      if (section.type === "cards") {
        return {
          ...section,
          items: section.items.filter((item) => matchesKeyword(keyword, [item.title, item.subtitle, item.tag ?? ""])),
        };
      }
      if (section.type === "table") {
        return {
          ...section,
          rows: section.rows.filter((row) => matchesKeyword(keyword, row)),
        };
      }
      if (section.type === "steps") {
        return {
          ...section,
          items: section.items.filter((item) => matchesKeyword(keyword, [item.title, item.detail])),
        };
      }
      return {
        ...section,
        columns: section.columns.map((column) => ({
          ...column,
          cards: column.cards.filter((card) => matchesKeyword(keyword, [card.title, card.detail, column.title])),
        })),
      };
    });
  }, [config.sections, keyword]);

  const selectedCount = Object.values(selectedRecords).filter(Boolean).length;

  const toggleRecord = (recordKey: string) => {
    setSelectedRecords((prev) => ({ ...prev, [recordKey]: !prev[recordKey] }));
  };

  const clearSelection = () => {
    setSelectedRecords({});
    toast.success("已清空当前批量选择");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <span className="material-chip bg-blue-50 text-blue-700">{config.badge}</span>
            <div>
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">{config.title}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{config.subtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {config.actions.map((action) => (
              <Link key={action.to} to={action.to} className="material-button-secondary">
                {action.label}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {config.metrics.map((metric) => (
          <div key={metric.label} className="material-card-flat p-5">
            <div className="text-sm font-medium text-slate-500">{metric.label}</div>
            <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{metric.value}</div>
            <div className="mt-2 text-sm text-slate-500">{metric.helper}</div>
          </div>
        ))}
      </section>

      <section className="material-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPageBySection({});
              }}
              placeholder="搜索当前模块中的记录、条款、任务或说明..."
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="material-chip bg-slate-100 text-slate-600">{keyword ? `筛选中：${keyword}` : "全部记录"}</span>
            <span className="material-chip bg-blue-50 text-blue-700">已选择 {selectedCount}</span>
            <button
              type="button"
              onClick={() => {
                setKeyword("");
                setPageBySection({});
                toast.success("筛选条件已重置");
              }}
              className="material-button-secondary"
            >
              <Sparkles className="h-4 w-4" />
              重置筛选
            </button>
          </div>
        </div>
      </section>

      {selectedCount > 0 ? (
        <section className="material-card p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-slate-900">批量操作</h3>
              <p className="mt-1 text-sm text-slate-500">已选 {selectedCount} 条记录，可直接进入批量流转演示。</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => toast.success(`已将 ${selectedCount} 条记录提交到复核队列`)} className="material-button-primary">
                批量提交复核
              </button>
              <button type="button" onClick={() => toast.success(`已为 ${selectedCount} 条记录生成跟进任务`)} className="material-button-secondary">
                批量生成任务
              </button>
              <button type="button" onClick={clearSelection} className="material-button-secondary">
                清空选择
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-1 gap-6">
          {filteredSections.map((section) => {
            const currentPage = pageBySection[section.title] ?? 1;
            const totalItems =
              section.type === "cards"
                ? section.items.length
                : section.type === "table"
                  ? section.rows.length
                  : section.type === "steps"
                    ? section.items.length
                    : section.columns.reduce((sum, column) => sum + column.cards.length, 0);
            const totalPages = Math.max(1, Math.ceil(totalItems / sectionPageSize));

            const setSectionPage = (page: number) => {
              setPageBySection((prev) => ({ ...prev, [section.title]: Math.max(1, Math.min(totalPages, page)) }));
            };

            const paginatedSection =
              section.type === "cards"
                ? { ...section, items: section.items.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize) }
                : section.type === "table"
                  ? { ...section, rows: section.rows.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize) }
                  : section.type === "steps"
                    ? { ...section, items: section.items.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize) }
                    : {
                        ...section,
                        columns: section.columns.map((column) => ({
                          ...column,
                          cards: column.cards.slice((currentPage - 1) * sectionPageSize, currentPage * sectionPageSize),
                        })),
                      };

            return (
              <div key={section.title} className="material-card overflow-hidden p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-slate-900">{section.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">{section.description}</p>
                  </div>
                  <span className="material-chip bg-slate-100 text-slate-600">{totalItems} Items</span>
                </div>

                {paginatedSection.type === "cards" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {paginatedSection.items.map((item) => {
                      const recordKey = `${section.title}-${item.title}`;
                      return (
                        <div key={item.title} className="rounded-[22px] border border-slate-100 bg-slate-50/80 p-4 transition hover:-translate-y-0.5">
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => setSelectedDetail({ title: item.title, detail: item.subtitle, tag: item.tag })}
                              className="flex-1 text-left"
                            >
                              <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                              <div className="mt-2 text-sm leading-6 text-slate-500">{item.subtitle}</div>
                            </button>
                            <div className="flex items-center gap-2">
                              {item.tag ? <span className="material-chip bg-white text-slate-600">{item.tag}</span> : null}
                              <button
                                type="button"
                                onClick={() => toggleRecord(recordKey)}
                                className={cn(
                                  "flex h-8 w-8 items-center justify-center rounded-xl border transition",
                                  selectedRecords[recordKey]
                                    ? "border-blue-200 bg-blue-50 text-primary"
                                    : "border-slate-200 bg-white text-slate-400 hover:border-blue-200",
                                )}
                              >
                                {selectedRecords[recordKey] ? "✓" : "+"}
                              </button>
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                            <span className="text-xs text-slate-400">点击查看详情</span>
                            <button type="button" onClick={() => toast.success(`${item.title} 已加入本模块跟进列表`)} className="text-xs font-semibold text-primary">
                              加入跟进
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {paginatedSection.type === "table" ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">选择</th>
                          {paginatedSection.columns.map((column) => (
                            <th key={column} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {column}
                            </th>
                          ))}
                          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">动作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedSection.rows.map((row, index) => {
                          const recordKey = `${section.title}-${row[0]}`;
                          return (
                            <tr key={`${section.title}-${index}`} className="cursor-pointer hover:bg-slate-50/70" onClick={() => setSelectedDetail({ title: row[0], detail: row.slice(1).join(" / ") })}>
                              <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => toggleRecord(recordKey)}
                                  className={cn(
                                    "flex h-8 w-8 items-center justify-center rounded-xl border transition",
                                    selectedRecords[recordKey]
                                      ? "border-blue-200 bg-blue-50 text-primary"
                                      : "border-slate-200 bg-white text-slate-400 hover:border-blue-200",
                                  )}
                                >
                                  {selectedRecords[recordKey] ? "✓" : "+"}
                                </button>
                              </td>
                              {row.map((cell, cellIndex) => (
                                <td key={`${cell}-${cellIndex}`} className="px-4 py-3 text-sm text-slate-700">
                                  {cell}
                                </td>
                              ))}
                              <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                                <button type="button" onClick={() => toast.success(`${row[0]} 已推送到下游流程`)} className="text-xs font-semibold text-primary">
                                  推进
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {paginatedSection.type === "steps" ? (
                  <div className="space-y-4">
                    {paginatedSection.items.map((item) => {
                      const stepKey = `${section.title}-${item.title}`;
                      const currentStatus = stepStatuses[stepKey] ?? item.status;
                      return (
                        <button
                          type="button"
                          key={item.title}
                          onClick={() => {
                            const next = cycleStatus(currentStatus);
                            setStepStatuses((prev) => ({ ...prev, [stepKey]: next }));
                            toast.success(`${item.title} 已切换为 ${next}`);
                          }}
                          className="flex w-full gap-4 rounded-[20px] border border-slate-100 bg-slate-50/60 p-4 text-left transition hover:-translate-y-0.5"
                        >
                          <div className="pt-0.5">
                            {currentStatus === "done" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : currentStatus === "current" ? <Clock3 className="h-5 w-5 text-blue-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                            <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                            <div className="mt-2 flex items-center justify-between gap-3">
                              <span className="text-xs text-slate-400">点击切换该步骤状态</span>
                              <span className="material-chip bg-white text-slate-500">
                                {currentStatus === "done" ? "已完成" : currentStatus === "current" ? "处理中" : "待开始"}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {paginatedSection.type === "kanban" ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {paginatedSection.columns.map((column) => (
                      <div key={column.title} className="rounded-[22px] border border-slate-100 bg-slate-50/60 p-4">
                        <div className={cn("mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold", column.tone)}>{column.title}</div>
                        <div className="space-y-3">
                          {column.cards.map((card) => {
                            const recordKey = `${section.title}-${column.title}-${card.title}`;
                            return (
                              <div key={card.title} className="rounded-2xl bg-white p-4 shadow-sm transition hover:-translate-y-0.5">
                                <div className="flex items-start justify-between gap-3">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedDetail({ title: card.title, detail: `${column.title} / ${card.detail}` })}
                                    className="flex-1 text-left"
                                  >
                                    <div className="text-sm font-semibold text-slate-800">{card.title}</div>
                                    <div className="mt-2 text-sm text-slate-500">{card.detail}</div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleRecord(recordKey)}
                                    className={cn(
                                      "flex h-8 w-8 items-center justify-center rounded-xl border transition",
                                      selectedRecords[recordKey]
                                        ? "border-blue-200 bg-blue-50 text-primary"
                                        : "border-slate-200 bg-white text-slate-400 hover:border-blue-200",
                                    )}
                                  >
                                    {selectedRecords[recordKey] ? "✓" : "+"}
                                  </button>
                                </div>
                                <div className="mt-3 border-t border-slate-100 pt-3 text-right">
                                  <button type="button" onClick={() => toast.success(`${card.title} 已指派到 ${column.title}`)} className="text-xs font-semibold text-primary">
                                    指派流转
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {totalItems === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-10 text-center text-sm text-slate-500">
                    当前筛选条件下没有内容，换个关键词或点击上方重置筛选试试。
                  </div>
                ) : null}

                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                  <div className="text-sm text-slate-500">第 {currentPage} / {totalPages} 页</div>
                  <div className="flex gap-2">
                    <button className="material-button-secondary !px-3 !py-2" onClick={() => setSectionPage(currentPage - 1)} disabled={currentPage === 1}>
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button className="material-button-secondary !px-3 !py-2" onClick={() => setSectionPage(currentPage + 1)} disabled={currentPage === totalPages}>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="space-y-6">
          <section className="material-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">详情侧栏</h3>
                <p className="mt-1 text-sm text-slate-500">点击卡片、表格或任务后，在这里查看详情与下一步动作。</p>
              </div>
              {selectedDetail ? (
                <button type="button" onClick={() => setSelectedDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200">
                  ×
                </button>
              ) : null}
            </div>
            {selectedDetail ? (
              <div className="space-y-4">
                <div className="rounded-[22px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-lg font-semibold text-slate-900">{selectedDetail.title}</div>
                    {selectedDetail.tag ? <span className="material-chip bg-white text-slate-600">{selectedDetail.tag}</span> : null}
                  </div>
                  <div className="mt-3 text-sm leading-7 text-slate-600">{selectedDetail.detail}</div>
                </div>
                <div className="space-y-3">
                  {["加入重点关注", "创建跟进任务", "推送到下游"].map((action) => (
                    <button key={action} type="button" onClick={() => toast.success(`${selectedDetail.title}：${action}`)} className="material-button-secondary w-full justify-center">
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center text-sm text-slate-500">
                先点击任意卡片、表格行或任务项，这里就会显示对应内容。
              </div>
            )}
          </section>

          <section className="material-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">快捷工具</h3>
                <p className="mt-1 text-sm text-slate-500">给通用模块补上常用操作入口。</p>
              </div>
              <button className="material-button-secondary" onClick={() => toast.success("当前模块列表已刷新")}>
                <Sparkles className="h-4 w-4" />
                刷新状态
              </button>
            </div>
            <div className="space-y-3">
              {["导出当前筛选结果", "生成模块周报", "同步到首页待办"].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => toast.success(`${item} 已执行`)}
                  className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
