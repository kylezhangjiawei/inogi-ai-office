import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileWarning,
  Flag,
  FolderOpen,
  Landmark,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { cn } from "./components/ui/utils";

type Market = "FDA" | "CE" | "NMPA";

type Project = {
  id: string;
  name: string;
  market: Market;
  owner: string;
  deadline: string;
  remainingDays: number;
  stageIndex: number;
  staleDays: number;
  milestones: Array<{
    title: string;
    owner: string;
    date: string;
    status: "done" | "current" | "pending";
  }>;
  docs: Array<{
    name: string;
    status: "已有" | "缺失" | "待更新";
  }>;
  reminders: Array<{
    time: string;
    recipient: string;
    message: string;
  }>;
};

const stages = ["资料提交", "补充", "审评反馈", "整改", "获批"];

const projects: Project[] = [
  {
    id: "REG-001",
    name: "OC-10 FDA 注册",
    market: "FDA",
    owner: "韩青",
    deadline: "2026-05-08",
    remainingDays: 23,
    stageIndex: 2,
    staleDays: 4,
    milestones: [
      { title: "资料提交", owner: "韩青", date: "2026-02-15", status: "done" },
      { title: "补充资料", owner: "刘畅", date: "2026-03-11", status: "done" },
      { title: "审评反馈", owner: "韩青", date: "2026-04-09", status: "current" },
      { title: "整改闭环", owner: "法规质量部", date: "待排期", status: "pending" },
      { title: "获批归档", owner: "RA 团队", date: "待排期", status: "pending" },
    ],
    docs: [
      { name: "风险管理报告", status: "已有" },
      { name: "软件验证报告", status: "待更新" },
      { name: "临床评价摘要", status: "缺失" },
      { name: "标签与说明书", status: "已有" },
    ],
    reminders: [
      { time: "2026-04-14 09:30", recipient: "韩青", message: "提醒确认 FDA 审评反馈回复口径" },
      { time: "2026-04-13 16:20", recipient: "法规质量部", message: "请补充软件验证报告新版本" },
    ],
  },
  {
    id: "REG-002",
    name: "OC-5 CE 更新",
    market: "CE",
    owner: "周宁",
    deadline: "2026-04-24",
    remainingDays: 9,
    stageIndex: 1,
    staleDays: 16,
    milestones: [
      { title: "资料提交", owner: "周宁", date: "2026-03-18", status: "done" },
      { title: "补充资料", owner: "周宁", date: "2026-04-12", status: "current" },
      { title: "审评反馈", owner: "RA 团队", date: "待启动", status: "pending" },
      { title: "整改闭环", owner: "法规质量部", date: "待启动", status: "pending" },
      { title: "获批归档", owner: "RA 团队", date: "待启动", status: "pending" },
    ],
    docs: [
      { name: "可用性工程文件", status: "已有" },
      { name: "生物相容性补充", status: "缺失" },
      { name: "电气安全报告", status: "待更新" },
      { name: "UDI 信息", status: "已有" },
    ],
    reminders: [
      { time: "2026-04-12 11:00", recipient: "周宁", message: "CE 项目已 16 天未更新，请尽快补充资料状态" },
      { time: "2026-04-10 15:45", recipient: "法规组", message: "请确认生物相容性补充计划" },
    ],
  },
  {
    id: "REG-003",
    name: "家庭版 NMPA 申报",
    market: "NMPA",
    owner: "刘晨",
    deadline: "2026-04-19",
    remainingDays: 4,
    stageIndex: 3,
    staleDays: 2,
    milestones: [
      { title: "资料提交", owner: "刘晨", date: "2026-02-08", status: "done" },
      { title: "补充资料", owner: "刘晨", date: "2026-03-02", status: "done" },
      { title: "审评反馈", owner: "审评沟通组", date: "2026-03-28", status: "done" },
      { title: "整改闭环", owner: "研发注册部", date: "2026-04-15", status: "current" },
      { title: "获批归档", owner: "法规组", date: "待启动", status: "pending" },
    ],
    docs: [
      { name: "注册送检报告", status: "已有" },
      { name: "整改对照表", status: "待更新" },
      { name: "说明书注册稿", status: "已有" },
      { name: "临床豁免说明", status: "已有" },
    ],
    reminders: [
      { time: "2026-04-15 08:40", recipient: "研发注册部", message: "请在 4 天内完成 NMPA 整改闭环并上传对照表" },
      { time: "2026-04-14 17:10", recipient: "刘晨", message: "项目临近截止，请确认获批归档准备情况" },
    ],
  },
];

function marketTone(market: Market) {
  if (market === "FDA") return "bg-blue-50 text-blue-700";
  if (market === "CE") return "bg-emerald-50 text-emerald-700";
  return "bg-red-50 text-red-700";
}

function docTone(status: Project["docs"][number]["status"]) {
  if (status === "已有") return "bg-emerald-50 text-emerald-700";
  if (status === "缺失") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

export function RegistrationProjects() {
  const [selectedId, setSelectedId] = useState(projects[0].id);
  const [marketFilter, setMarketFilter] = useState<"全部" | Market>("全部");
  const [page, setPage] = useState(1);
  const [activeReminder, setActiveReminder] = useState<Project["reminders"][number] | null>(null);
  const filteredProjects = useMemo(
    () => projects.filter((item) => marketFilter === "全部" || item.market === marketFilter),
    [marketFilter],
  );
  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / 3));
  const pagedProjects = filteredProjects.slice((page - 1) * 3, page * 3);
  const selected = useMemo(() => filteredProjects.find((item) => item.id === selectedId) ?? filteredProjects[0] ?? projects[0], [filteredProjects, selectedId]);

  const staleWarning = selected.staleDays >= 14;
  const missingDocs = selected.docs.filter((item) => item.status !== "已有");
  const urgentProjects = projects.filter((item) => item.remainingDays <= 9).length;
  const totalMissingDocs = projects.reduce(
    (total, project) => total + project.docs.filter((item) => item.status !== "已有").length,
    0,
  );
  const totalReminders = projects.reduce((total, project) => total + project.reminders.length, 0);

  return (
    <div className="horizon-theme hz-page flex min-h-0 flex-col gap-3 overflow-x-hidden px-5 py-4">
      <HorizonPageHeader
        Icon={Landmark}
        eyebrow="法规注册 · 里程碑控制"
        title="注册项目里程碑"
        description="集中跟踪各市场注册项目的当前阶段、临期节点、资料缺口与跨部门提醒。"
        meta={<><span>{projects.length} 个在管项目</span><span>·</span><span>数据更新至 2026-04-15</span></>}
        actions={(
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setMarketFilter("全部");
              setPage(1);
            }}
          >
            <FolderOpen className="size-4" />
            查看全部项目
          </Button>
        )}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={FolderOpen} label="在管项目" value={projects.length} note="FDA、CE 与 NMPA" tone="brand" />
        <HorizonMetric Icon={CalendarClock} label="9 天内到期" value={urgentProjects} note="需要优先排定责任人" tone="danger" />
        <HorizonMetric Icon={FileWarning} label="资料缺口" value={totalMissingDocs} note="缺失或等待更新" tone="warning" />
        <HorizonMetric Icon={BellRing} label="提醒已发出" value={totalReminders} note="覆盖法规、质量与研发" tone="success" />
      </HorizonMetricGrid>

      <section className="grid min-w-0 gap-3 xl:grid-cols-[288px_minmax(0,1fr)]">
        <aside className="hz-surface min-w-0 overflow-hidden border bg-white">
          <HorizonSectionHeader
            Icon={FolderOpen}
            title="项目清单"
            description={`共 ${filteredProjects.length} 个项目 · 第 ${page}/${totalPages} 页`}
          />
          <div className="hz-toolbar flex flex-wrap gap-1.5 border-b p-3">
            {(["全部", "FDA", "CE", "NMPA"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={marketFilter === item ? "default" : "outline"}
                aria-pressed={marketFilter === item}
                className={cn(marketFilter === item && "hz-primary-action")}
                onClick={() => {
                  setMarketFilter(item);
                  setPage(1);
                }}
              >
                {item}
              </Button>
            ))}
          </div>

          <div className="space-y-2 p-3">
            {pagedProjects.length ? pagedProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                aria-pressed={selected.id === project.id}
                onClick={() => setSelectedId(project.id)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-colors duration-150",
                  selected.id === project.id
                    ? "border-[#002fa7] bg-[#eef3ff]"
                    : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1b2559]">{project.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{project.id} · {project.owner}</div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", marketTone(project.market))}>
                    {project.market}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">当前：{stages[project.stageIndex]}</span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", project.remainingDays <= 7 ? "text-red-600" : "text-slate-700")}>
                    {project.remainingDays > 0 ? `${project.remainingDays} 天` : "已超期"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1" aria-label={`已完成 ${project.stageIndex + 1} 个阶段，共 ${stages.length} 个阶段`}>
                  {stages.map((stage, index) => (
                    <span key={stage} className={cn("h-1.5 rounded-full", index <= project.stageIndex ? "bg-[#002fa7]" : "bg-slate-200")} />
                  ))}
                </div>
              </button>
            )) : (
              <HorizonEmptyState
                Icon={FolderOpen}
                title="没有匹配项目"
                description="清除市场筛选后可查看全部注册项目。"
                action={<Button type="button" size="sm" variant="outline" onClick={() => setMarketFilter("全部")}><RotateCcw className="size-4" />清除筛选</Button>}
              />
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
              上一页
            </Button>
            <span className="text-xs text-slate-500 tabular-nums">{page} / {totalPages}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>
              下一页
            </Button>
          </div>
        </aside>

        <div className="min-w-0 space-y-3">
          <section className="hz-surface min-w-0 overflow-hidden border bg-white">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-balance text-lg font-bold text-[#1b2559]">{selected.name}</h2>
                  <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", marketTone(selected.market))}>{selected.market}</span>
                  <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", staleWarning ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>
                    {staleWarning ? "需要跟进" : "进度正常"}
                  </span>
                </div>
                <p className="mt-1 text-pretty text-sm text-slate-500">负责人 {selected.owner} · 截止 {selected.deadline} · 已停滞 {selected.staleDays} 天</p>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2 text-right text-xs text-slate-500">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div>剩余时间</div>
                  <div className={cn("mt-1 text-base font-bold tabular-nums", selected.remainingDays <= 7 ? "text-red-600" : "text-[#1b2559]")}>{selected.remainingDays} 天</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <div>阶段进度</div>
                  <div className="mt-1 text-base font-bold text-[#1b2559] tabular-nums">{selected.stageIndex + 1}/{stages.length}</div>
                </div>
              </div>
            </div>

            {staleWarning ? (
              <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="text-pretty">该项目已超过 14 天未更新，建议今天内确认当前里程碑，并同步资料责任人。</p>
              </div>
            ) : null}

            <div className="p-4">
              <div className="grid grid-cols-5 gap-1.5">
                {stages.map((stage, index) => (
                  <div key={stage} className="min-w-0">
                    <div className={cn("h-2 rounded-full", index <= selected.stageIndex ? "bg-[#002fa7]" : "bg-slate-200")} />
                    <div className={cn("mt-2 truncate text-center text-[11px]", index === selected.stageIndex ? "font-semibold text-[#002fa7]" : "text-slate-500")}>{stage}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(250px,.9fr)]">
            <section className="hz-surface min-w-0 overflow-hidden border bg-white">
              <HorizonSectionHeader Icon={Flag} title="关键里程碑" description="从资料提交到获批归档的责任人与计划节点。" trailing={<span className="text-xs text-slate-500 tabular-nums">{selected.stageIndex + 1}/{stages.length}</span>} />
              <div className="divide-y divide-slate-100 px-4">
                {selected.milestones.map((item, index) => (
                  <div key={item.title} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 py-3">
                    <div className="pt-0.5">
                      {item.status === "done" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : item.status === "current" ? <Clock3 className="size-4 text-[#002fa7]" aria-hidden="true" /> : <span className="block size-4 rounded-full border-2 border-slate-300" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800">{index + 1}. {item.title}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">负责人：{item.owner}</div>
                    </div>
                    <div className="text-right text-xs text-slate-500 tabular-nums">{item.date}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="hz-surface min-w-0 overflow-hidden border bg-white">
              <HorizonSectionHeader Icon={FileWarning} title="资料完整性" description="当前市场核心资料及缺口状态。" trailing={<span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", missingDocs.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{missingDocs.length} 项待处理</span>} />
              <div className="divide-y divide-slate-100 px-4">
                {selected.docs.length ? selected.docs.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {item.status === "已有" ? <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <FileWarning className={cn("size-4 shrink-0", item.status === "缺失" ? "text-red-600" : "text-amber-600")} aria-hidden="true" />}
                      <span className="truncate text-sm text-slate-700">{item.name}</span>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", docTone(item.status))}>{item.status}</span>
                  </div>
                )) : (
                  <HorizonEmptyState Icon={ShieldCheck} title="暂无资料清单" description="先为当前项目配置申报资料模板。" action={<Button type="button" size="sm" variant="outline">配置模板</Button>} />
                )}
              </div>
            </section>
          </div>

          <section className="hz-surface min-w-0 overflow-hidden border bg-white">
            <HorizonSectionHeader Icon={BellRing} title="提醒与协作记录" description="点击记录查看完整通知内容和发送时间。" trailing={<span className="text-xs text-slate-500 tabular-nums">{selected.reminders.length} 条记录</span>} />
            {selected.reminders.length ? (
              <div className="grid gap-2 p-3 md:grid-cols-2">
                {selected.reminders.map((item) => (
                  <button
                    type="button"
                    key={`${item.time}-${item.recipient}`}
                    onClick={() => setActiveReminder(item)}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors duration-150 hover:border-blue-200 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-slate-800">{item.recipient}</span>
                      <span className="shrink-0 text-xs text-slate-400 tabular-nums">{item.time}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-pretty text-xs leading-5 text-slate-500">{item.message}</p>
                  </button>
                ))}
              </div>
            ) : (
              <HorizonEmptyState Icon={BellRing} title="暂无提醒记录" description="当前项目无需催办；临近节点时可发起提醒。" action={<Button type="button" size="sm" variant="outline">创建提醒</Button>} />
            )}
          </section>
        </div>
      </section>

      <Dialog open={Boolean(activeReminder)} onOpenChange={(open) => { if (!open) setActiveReminder(null); }}>
        <DialogContent className="horizon-portal sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-balance text-[#1b2559]">提醒详情</DialogTitle>
            <DialogDescription className="text-pretty">查看提醒对象、通知内容和系统发送时间。</DialogDescription>
          </DialogHeader>
          {activeReminder ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">接收对象</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{activeReminder.recipient}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">提醒内容</div>
                <p className="mt-1 text-pretty text-sm leading-6 text-slate-700">{activeReminder.message}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">发送时间</div>
                <div className="mt-1 text-sm text-slate-700 tabular-nums">{activeReminder.time}</div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setActiveReminder(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
