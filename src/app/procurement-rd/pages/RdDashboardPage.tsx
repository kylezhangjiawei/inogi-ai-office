// 场景1 · 研发任务驾驶舱（演示版）+ 场景6 状态回传：任务卡流 + 主线任务详情 +
// 「转采购询价」AI 预填弹窗 + 采购动态回传时间线/关联采购 chip。支持 ?task= 直达打开详情。
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRightLeft, FileText, FlaskConical, LayoutDashboard, ListTodo, Search, Send, Sparkles, Waypoints, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { procActions, useProc } from "../store";
import type { RdTask } from "../data/types";
import { DemoControls, PageHeader, PersonAvatar, PlaceholderImage, PriorityBadge, REQ_STATUS_META, StatCard } from "../components/common";

export function RdDashboardPage() {
  const { rdTasks, requirements } = useProc();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<"all" | "high" | "medium" | "low">("all");
  const [linkedOnly, setLinkedOnly] = useState(false);

  const openTaskId = params.get("task");
  const openTask = rdTasks.find((t) => t.id === openTaskId) ?? null;
  const setOpenTask = (id: string | null) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id) p.set("task", id);
        else p.delete("task");
        return p;
      },
      { replace: true },
    );
  };

  const stats = [
    { label: "研发任务", value: rdTasks.length },
    { label: "进行中", value: rdTasks.filter((t) => t.statusText === "进行中").length },
    { label: "测试中", value: rdTasks.filter((t) => t.statusText === "测试中").length },
    { label: "已转采购", value: rdTasks.filter((t) => t.relatedRequirementId).length },
  ];

  const relatedReqOf = (task: RdTask | null) => (task?.relatedRequirementId ? requirements.find((r) => r.id === task.relatedRequirementId) : undefined);

  const kw = search.trim().toLowerCase();
  const filteredTasks = rdTasks.filter(
    (t) =>
      (!kw || `${t.title} ${t.owner}`.toLowerCase().includes(kw)) &&
      (priority === "all" || t.priority === priority) &&
      (!linkedOnly || !!t.relatedRequirementId),
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <DemoControls />
      <PageHeader
        Icon={LayoutDashboard}
        badge="演示版 · 研发侧"
        title="研发任务驾驶舱"
        description="研发任务推进与协同入口。打开主线任务「新压缩机950减震垫选型」，可将需求一键转采购询价。"
      />
      {/* 统计条 */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard label={stats[0].label} value={stats[0].value} hint="全部研发任务" Icon={ListTodo} />
        <StatCard label={stats[1].label} value={stats[1].value} tone="indigo" hint="进行中任务" Icon={LayoutDashboard} />
        <StatCard label={stats[2].label} value={stats[2].value} tone="amber" hint="测试阶段" Icon={FlaskConical} />
        <StatCard label={stats[3].label} value={stats[3].value} tone="violet" hint="已转采购流转" Icon={Waypoints} />
      </div>

      {/* 工具栏：搜索 + 筛选 */}
      <div className="material-card mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索任务、负责人…" className="w-full bg-transparent text-slate-700 outline-none placeholder:text-slate-400" />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400">优先级</span>
          {(["all", "high", "medium", "low"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={cn("rounded-full border px-2.5 py-1 font-medium transition", priority === p ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}
            >
              {p === "all" ? "全部" : p === "high" ? "高" : p === "medium" ? "中" : "低"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLinkedOnly((v) => !v)}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", linkedOnly ? "border-violet-300 bg-violet-50 text-violet-600" : "border-slate-200 text-slate-500 hover:bg-slate-50")}
        >
          仅看已转采购
        </button>
        <span className="ml-auto text-xs text-slate-400">{filteredTasks.length} / {rdTasks.length} 个任务</span>
      </div>

      {/* 任务卡流 */}
      <div className="grid grid-cols-3 gap-3">
        {filteredTasks.length === 0 && <div className="col-span-3 rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">没有符合条件的任务</div>}
        {filteredTasks.map((t) => {
          const req = relatedReqOf(t);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenTask(t.id)}
              className={cn(
                "material-card relative overflow-hidden p-4 text-left transition hover:shadow-md",
                t.isMain && "ring-1 ring-indigo-200",
              )}
            >
              <span className={cn("absolute inset-y-0 left-0 w-1", t.priority === "high" ? "bg-red-400" : t.priority === "medium" ? "bg-amber-400" : "bg-slate-300")} />
              <div className="flex items-start justify-between gap-2">
                <h3 className="pr-2 text-sm font-semibold text-slate-900">{t.title}</h3>
                <PriorityBadge priority={t.priority} />
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <PersonAvatar name={t.owner} />
                {t.owner}
                <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{t.statusText}</span>
              </div>
              <div className="mt-2 text-xs text-slate-400">截止 {t.due}</div>
              {req && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                  关联采购：{REQ_STATUS_META[req.status].label}
                </div>
              )}
              {t.isMain && <div className="mt-2 text-[11px] font-medium text-indigo-500">▶ 演示主线</div>}
            </button>
          );
        })}
      </div>

      {/* 任务详情抽屉 */}
      {openTask && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={(e) => { if (e.target === e.currentTarget) setOpenTask(null); }}>
          <div className="flex h-full w-[640px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{openTask.title}</h3>
                <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                  <PersonAvatar name={openTask.owner} />
                  {openTask.owner} · 截止 {openTask.due} · {openTask.statusText}
                </div>
              </div>
              <button type="button" onClick={() => setOpenTask(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              {(() => {
                const req = relatedReqOf(openTask);
                return req ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/proc-workbench?req=${req.id}`)}
                    className="flex w-full items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium text-indigo-700">关联采购需求 {req.code}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-xs font-medium text-indigo-600">
                      {REQ_STATUS_META[req.status].label} →
                    </span>
                  </button>
                ) : null;
              })()}

              {openTask.desc && (
                <div className="rounded-xl border border-slate-100 p-4">
                  <div className="mb-1 text-sm font-semibold text-slate-700">任务描述</div>
                  <p className="text-sm leading-6 text-slate-600">{openTask.desc}</p>
                  <div className="mt-3 flex gap-3">
                    <PlaceholderImage label={openTask.isMain ? "减震垫结构图.dwg" : "结构图纸.dwg"} className="h-16 w-20" />
                    <PlaceholderImage label={openTask.isMain ? "振动测试报告.pdf" : "相关记录.pdf"} className="h-16 w-20" />
                  </div>
                </div>
              )}

              {/* 时间线（含采购动态回传） */}
              <div className="rounded-xl border border-slate-100 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-700">时间线</div>
                <ul className="space-y-2.5">
                  {openTask.timeline.length === 0 && <li className="text-sm text-slate-400">暂无动态</li>}
                  {openTask.timeline.map((it) => (
                    <li key={it.id} className="flex gap-3 text-sm">
                      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", it.kind === "proc" ? "bg-violet-500" : "bg-slate-300")} />
                      <div>
                        <div className={cn(it.kind === "proc" ? "font-medium text-violet-700" : "text-slate-600")}>{it.text}</div>
                        <div className="text-xs text-slate-400">{it.at}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 底部动作 */}
            <div className="flex items-center gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" disabled className="cursor-not-allowed rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <ArrowRightLeft className="h-4 w-4" />
                  转派
                </span>
              </button>
              {openTask.isMain && (
                <button
                  type="button"
                  disabled={!!openTask.relatedRequirementId}
                  onClick={() => setPrefillOpen(true)}
                  className={cn(
                    "material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm",
                    openTask.relatedRequirementId && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Send className="h-4 w-4" />
                  {openTask.relatedRequirementId ? "已转采购询价" : "转采购询价"}
                </button>
              )}
            </div>
          </div>

          {/* AI 预填弹窗 */}
          {prefillOpen && openTask && (
            <PrefillModal
              task={openTask}
              onClose={() => setPrefillOpen(false)}
              onConfirm={(prefill) => {
                procActions.generateFromRdTask(openTask.id, prefill);
                setPrefillOpen(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PrefillModal({
  task,
  onClose,
  onConfirm,
}: {
  task: RdTask;
  onClose: () => void;
  onConfirm: (p: { materialName: string; spec: string; quantity: number; expectedDate: string; rdContact: string; useDesc: string }) => void;
}) {
  const [f, setF] = useState({
    materialName: "减震垫 DZ-950",
    spec: "50×20mm 橡胶",
    quantity: "50",
    expectedDate: "2026-07-17",
    rdContact: task.owner,
    useDesc: task.title,
  });
  const field = (k: keyof typeof f, label: string, full?: boolean) => (
    <label className={cn("block", full && "col-span-2")}>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">转采购询价 · 生成采购需求</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            AI 已从任务标题、描述与附件中提取以下信息，请确认或修改
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("materialName", "物料名称")}
            {field("spec", "规格")}
            {field("quantity", "数量")}
            {field("expectedDate", "期望到货日期")}
            {field("rdContact", "研发对接人")}
            <label className="block">
              <span className="text-xs font-medium text-slate-500">图纸附件</span>
              <div className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
                <FileText className="h-4 w-4 shrink-0 text-indigo-500" />
                <span className="flex-1 truncate">减震垫结构图.dwg</span>
                <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-500">已自动带入</span>
              </div>
            </label>
            {field("useDesc", "用途说明", true)}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button type="button" onClick={() => onConfirm({ ...f, quantity: Number(f.quantity) || 0 })} className="material-button-primary px-4 py-2 text-sm">
            确认生成需求单
          </button>
        </div>
      </div>
    </div>
  );
}
