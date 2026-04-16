import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileWarning,
  FolderOpen,
  ShieldCheck,
} from "lucide-react";
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
      { title: "整改闭环", owner: "质量部", date: "待排期", status: "pending" },
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
      { time: "2026-04-13 16:20", recipient: "质量部", message: "请补充软件验证报告新版本" },
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
      { title: "整改闭环", owner: "质量部", date: "待启动", status: "pending" },
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
      { title: "整改闭环", owner: "研发部", date: "2026-04-15", status: "current" },
      { title: "获批归档", owner: "法规组", date: "待启动", status: "pending" },
    ],
    docs: [
      { name: "注册送检报告", status: "已有" },
      { name: "整改对照表", status: "待更新" },
      { name: "说明书注册稿", status: "已有" },
      { name: "临床豁免说明", status: "已有" },
    ],
    reminders: [
      { time: "2026-04-15 08:40", recipient: "研发部", message: "请在 4 天内完成 NMPA 整改闭环并上传对照表" },
      { time: "2026-04-14 17:10", recipient: "刘晨", message: "项目临近截止，请确认获批归档准备情况" },
    ],
  },
];

const marketHighlights = [
  { label: "本周待跟进", value: "2", helper: "CE 与 NMPA 项目更紧急" },
  { label: "资料缺口", value: "4", helper: "主要集中在软件验证与生物相容性" },
  { label: "提醒已发出", value: "6", helper: "已同步法规、质量与研发负责人" },
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
  const missingDocs = selected.docs.filter((item) => item.status !== "宸叉湁");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <span className="material-chip bg-blue-50 text-blue-700">Milestone Dashboard</span>
            <div>
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">注册项目里程碑</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                这页已经从通用占位升级成独立业务页面，包含项目卡片、里程碑步骤、资料缺口检查和提醒日志，符合你文档里“注册项目看板”的流程要求。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="material-button-secondary">
              <FolderOpen className="h-4 w-4" />
              项目总数 {projects.length}
            </div>
            <div className="material-button-secondary">
              <CalendarClock className="h-4 w-4" />
              本周待跟进 2 项
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="md:col-span-2 xl:col-span-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(["全部", "FDA", "CE", "NMPA"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMarketFilter(item);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition",
                  marketFilter === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="text-sm text-slate-500">
            共 {filteredProjects.length} 个项目，当前第 {page}/{totalPages} 页
          </div>
        </div>
        {pagedProjects.map((project) => (
          <button
            key={project.id}
            onClick={() => setSelectedId(project.id)}
            className={cn(
              "material-card-flat space-y-4 p-5 text-left transition hover:-translate-y-0.5",
              selected.id === project.id ? "ring-2 ring-blue-200" : "",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">{project.name}</div>
                <div className="mt-1 text-sm text-slate-500">负责人：{project.owner}</div>
              </div>
              <span className={cn("material-chip", marketTone(project.market))}>{project.market}</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>截止日期 {project.deadline}</span>
                <span className={cn("font-semibold", project.remainingDays <= 7 ? "text-red-600" : "text-slate-700")}>
                  {project.remainingDays > 0 ? `${project.remainingDays} 天` : "已超期"}
                </span>
              </div>

              <div className="flex gap-2">
                {stages.map((stage, index) => (
                  <div key={stage} className="flex-1 space-y-2">
                    <div className={cn("h-2 rounded-full", index <= project.stageIndex ? "bg-blue-500" : "bg-slate-200")} />
                    <div className="text-[10px] text-slate-400">{stage}</div>
                  </div>
                ))}
              </div>
            </div>
          </button>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {marketHighlights.map((item) => (
          <div key={item.label} className="material-card-flat p-5">
            <div className="text-sm text-slate-500">{item.label}</div>
            <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{item.value}</div>
            <div className="mt-2 text-sm text-slate-500">{item.helper}</div>
          </div>
        ))}
      </section>

      {staleWarning ? (
        <section className="rounded-[24px] border border-amber-100 bg-amber-50/80 px-5 py-4 text-sm text-amber-700">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" />
            <div>
              当前选中项目已经超过 14 天未更新，请尽快推进里程碑并同步资料状态。
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-5">
          <div className="material-card h-full p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">里程碑时间线</h3>
                <p className="mt-1 text-sm text-slate-500">展示当前项目从资料提交到获批归档的完整阶段。</p>
              </div>
              <span className={cn("material-chip", marketTone(selected.market))}>{selected.market}</span>
            </div>

            <div className="space-y-4">
              {selected.milestones.map((item) => (
                <div key={item.title} className="flex gap-4 rounded-[20px] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="pt-0.5">
                    {item.status === "done" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : item.status === "current" ? (
                      <Clock3 className="h-5 w-5 text-blue-600" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-slate-200" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <div className="text-sm text-slate-500">负责人：{item.owner}</div>
                    <div className="text-sm text-slate-400">{item.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="material-card h-full p-6">
            <div className="mb-5">
              <h3 className="text-slate-900">资料缺口检查</h3>
              <p className="mt-1 text-sm text-slate-500">自动生成所选市场需要的核心资料，并标记已有、缺失和待更新状态。</p>
            </div>

            <div className="space-y-3">
              {selected.docs.map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-[20px] border border-slate-100 bg-slate-50/70 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", item.status === "已有" ? "bg-emerald-50 text-emerald-600" : item.status === "缺失" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600")}>
                      {item.status === "已有" ? <ShieldCheck className="h-5 w-5" /> : <FileWarning className="h-5 w-5" />}
                    </div>
                    <div className="text-sm font-medium text-slate-700">{item.name}</div>
                  </div>
                  <span className={cn("material-chip", docTone(item.status))}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-3">
          <div className="material-card h-full p-6">
            <div className="mb-5 flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              <div>
                <h3 className="text-slate-900">提醒日志</h3>
                <p className="mt-1 text-sm text-slate-500">展示最近发出的提醒与通知记录。</p>
              </div>
            </div>

            <div className="space-y-3">
              {selected.reminders.map((item) => (
                <button
                  type="button"
                  key={`${item.time}-${item.recipient}`}
                  onClick={() => setActiveReminder(item)}
                  className="w-full rounded-[20px] border border-slate-100 bg-slate-50/70 p-4 text-left transition hover:border-blue-200"
                >
                  <div className="text-sm font-semibold text-slate-800">{item.recipient}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">{item.message}</div>
                  <div className="mt-3 text-xs text-slate-400">{item.time}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-between">
        <div className="text-sm text-slate-500">切换分页后会保留市场筛选条件。</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page === totalPages}
            className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <div className="material-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">项目风险与缺口</h3>
                <p className="mt-1 text-sm text-slate-500">把当前项目最需要补齐的内容直接聚合出来。</p>
              </div>
              <span className={cn("material-chip", staleWarning ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>
                {staleWarning ? "Need Follow-up" : "On Track"}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="material-panel">
                <div className="text-sm font-semibold text-slate-800">当前风险判断</div>
                <div className="mt-3 space-y-3 text-sm text-slate-600">
                  <div>项目：{selected.name}</div>
                  <div>剩余时长：{selected.remainingDays} 天</div>
                  <div>停滞时长：{selected.staleDays} 天</div>
                  <div>{staleWarning ? "建议今天内更新里程碑并同步缺失资料责任人。" : "当前节奏可控，建议继续跟进现阶段节点。"}</div>
                </div>
              </div>
              <div className="material-panel">
                <div className="text-sm font-semibold text-slate-800">待补资料</div>
                <div className="mt-3 space-y-3">
                  {missingDocs.map((item) => (
                    <div key={item.name} className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                      <div className="text-sm font-medium text-slate-800">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-500">状态：{item.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card p-6">
            <h3 className="text-slate-900">协作建议</h3>
            <div className="mt-4 space-y-3">
              {[
                "法规负责人建议每次提醒后同步一条项目纪要，方便跨部门追踪。",
                "若资料缺失超过 2 项，可直接发起专项补件任务而不是单条催办。",
                "接近截止日期的项目建议联动质量与研发负责人共同确认闭环路径。",
              ].map((item) => (
                <div key={item} className="material-panel text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {activeReminder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">提醒详情</h3>
                <p className="mt-1 text-sm text-slate-500">把列表提醒改成可点击的详情弹窗。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setActiveReminder(null)}>
                关闭
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Recipient</div>
                <div className="mt-2 text-base font-semibold text-slate-900">{activeReminder.recipient}</div>
              </div>
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Message</div>
                <div className="mt-2 text-sm leading-6 text-slate-700">{activeReminder.message}</div>
              </div>
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Time</div>
                <div className="mt-2 text-sm text-slate-700">{activeReminder.time}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
