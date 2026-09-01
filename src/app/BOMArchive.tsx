import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  FileArchive,
  FileLock2,
  FileWarning,
  FolderArchive,
  ListChecks,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { cn } from "./components/ui/utils";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

type BomRecord = {
  id: string;
  version: string;
  model: string;
  owner: string;
  confirmedAt: string;
  status: "已锁定" | "待补充" | "待通知";
  summary: string;
  changes: Array<{
    part: string;
    before: string;
    after: string;
    impact: string;
    status: "已确认" | "需说明";
  }>;
  auditTrail: Array<{
    title: string;
    detail: string;
    status: "done" | "current" | "pending";
  }>;
  notifications: Array<{
    target: string;
    channel: string;
    time: string;
    result: string;
  }>;
};

const bomRecords: BomRecord[] = [
  {
    id: "ARC-301",
    version: "BOM-OC10-V3.2",
    model: "OC-10",
    owner: "韩琦",
    confirmedAt: "2026-04-12 14:20",
    status: "已锁定",
    summary: "主板电阻替代料与传感器批次切换均已确认，记录已进入不可删除留痕存档。",
    changes: [
      { part: "R-214 电阻", before: "Yageo 10K", after: "KOA 10K", impact: "替代料已验证通过", status: "已确认" },
      { part: "压力传感器", before: "Batch 24A", after: "Batch 25C", impact: "采购批次切换", status: "已确认" },
      { part: "连接器胶壳", before: "Black", after: "Gray", impact: "需补充颜色变更说明", status: "需说明" },
    ],
    auditTrail: [
      { title: "原始记录创建", detail: "韩琦 / 2026-04-12 10:05", status: "done" },
      { title: "替代料风险确认", detail: "质量部 / 2026-04-12 11:40", status: "done" },
      { title: "采购与生产通知", detail: "系统自动下发 / 2026-04-12 14:25", status: "current" },
      { title: "归档完成", detail: "等待系统夜间归档任务", status: "pending" },
    ],
    notifications: [
      { target: "采购部", channel: "企业微信", time: "2026-04-12 14:26", result: "已送达" },
      { target: "生产运营部", channel: "邮件", time: "2026-04-12 14:27", result: "已送达" },
      { target: "法规质量部", channel: "系统站内信", time: "2026-04-12 14:27", result: "已送达" },
    ],
  },
  {
    id: "ARC-295",
    version: "BOM-OC5-V2.6",
    model: "OC-5",
    owner: "李成",
    confirmedAt: "2026-04-09 09:35",
    status: "待补充",
    summary: "传感器批次切换已确认，但颜色件变更缺少书面原因说明，暂未完成最终归档。",
    changes: [
      { part: "温度传感器", before: "Batch 18B", after: "Batch 19A", impact: "替代批次已验证通过", status: "已确认" },
      { part: "结构件面盖", before: "White", after: "Ivory", impact: "需补充客户认可说明", status: "需说明" },
    ],
    auditTrail: [
      { title: "原始记录创建", detail: "李成 / 2026-04-09 09:35", status: "done" },
      { title: "变更原因补录", detail: "等待提交书面说明", status: "current" },
      { title: "通知下发", detail: "待原因说明补齐后执行", status: "pending" },
      { title: "归档完成", detail: "待执行", status: "pending" },
    ],
    notifications: [
      { target: "采购部", channel: "企业微信", time: "2026-04-09 10:10", result: "待发送" },
      { target: "法规质量部", channel: "系统站内信", time: "2026-04-09 10:10", result: "待发送" },
    ],
  },
  {
    id: "ARC-288",
    version: "BOM-HOME-V1.9",
    model: "家庭款",
    owner: "周宁",
    confirmedAt: "2026-04-07 17:05",
    status: "待通知",
    summary: "版本已锁定，但下游部门通知未全部完成，需要继续走设计与质量协同流程。",
    changes: [
      { part: "主控芯片", before: "MCU A2", after: "MCU A3", impact: "固件兼容性需同步确认", status: "已确认" },
      { part: "标签丝印", before: "CN", after: "CN/EN", impact: "外发资料需要同步改版", status: "已确认" },
    ],
    auditTrail: [
      { title: "原始记录创建", detail: "周宁 / 2026-04-07 13:30", status: "done" },
      { title: "版本锁定", detail: "系统加盖只读归档标识", status: "done" },
      { title: "通知下发", detail: "仍有 1 个部门未确认签收", status: "current" },
      { title: "归档完成", detail: "待所有通知确认", status: "pending" },
    ],
    notifications: [
      { target: "生产运营部", channel: "邮件", time: "2026-04-07 17:06", result: "已送达" },
      { target: "设计部", channel: "企业微信", time: "2026-04-07 17:06", result: "已送达" },
      { target: "法规组", channel: "系统站内信", time: "2026-04-07 17:07", result: "待确认" },
    ],
  },
];

function statusTone(status: BomRecord["status"]) {
  if (status === "已锁定") return "bg-emerald-50 text-emerald-700";
  if (status === "待补充") return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-blue-700";
}

function changeTone(status: BomRecord["changes"][number]["status"]) {
  return status === "已确认" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700";
}

export function BOMArchive() {
  const [selectedId, setSelectedId] = useState(bomRecords[0].id);
  const selected = useMemo(() => bomRecords.find((item) => item.id === selectedId) ?? bomRecords[0], [selectedId]);

  const pendingReasons = selected.changes.filter((item) => item.status === "需说明").length;
  const pendingNotices = selected.notifications.filter((item) => item.result !== "已送达").length;

  return (
    <div className="horizon-theme hz-page flex min-h-0 flex-col gap-3 overflow-x-hidden px-5 py-4">
      <HorizonPageHeader
        Icon={FolderArchive}
        eyebrow="生产配置 · 受控存档"
        title="BOM 确认存档"
        description="统一核对 BOM 版本、物料差异、确认状态和下游通知，保留完整且不可删除的过程留痕。"
        meta={<><span>{bomRecords.length} 个近期版本</span><span>·</span><span>归档记录保持只读</span></>}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link to={routePath("page:design-changes", "/design-changes")}>设计变更<ArrowRight className="size-4" /></Link>
            </Button>
            <Button asChild className="hz-primary-action">
              <Link to={routePath("page:quality-dms", "/quality-dms")}>质量 DMS<ArrowRight className="size-4" /></Link>
            </Button>
          </>
        )}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={FileArchive} label="已归档记录" value={32} note="确认人与时间戳完整" tone="brand" />
        <HorizonMetric Icon={FolderArchive} label="近期版本" value={bomRecords.length} note="当前工作区可查看" tone="neutral" />
        <HorizonMetric Icon={FileWarning} label="待补充说明" value={pendingReasons} note="基于当前选中版本" tone={pendingReasons ? "warning" : "success"} />
        <HorizonMetric Icon={BellRing} label="待确认通知" value={pendingNotices} note="采购、生产与法规" tone={pendingNotices ? "warning" : "success"} />
      </HorizonMetricGrid>

      <section className="grid min-w-0 gap-3 xl:grid-cols-[288px_minmax(0,1fr)]">
        <aside className="hz-surface min-w-0 overflow-hidden border bg-white">
          <HorizonSectionHeader Icon={FolderArchive} title="版本与文件记录" description="按版本查看确认结果和归档时间。" trailing={<span className="text-xs text-slate-500 tabular-nums">{bomRecords.length} 条</span>} />
          {bomRecords.length ? (
            <div className="space-y-2 p-3">
              {bomRecords.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  aria-pressed={selected.id === record.id}
                  onClick={() => setSelectedId(record.id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition-colors duration-150",
                    selected.id === record.id
                      ? "border-[#002fa7] bg-[#eef3ff]"
                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#1b2559]">{record.version}</div>
                      <div className="mt-1 text-xs text-slate-500">{record.id} · {record.model}</div>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold", statusTone(record.status))}>{record.status}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-pretty text-xs leading-5 text-slate-500">{record.summary}</p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span>{record.owner}</span>
                    <span className="tabular-nums">{record.confirmedAt}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <HorizonEmptyState Icon={FolderArchive} title="暂无 BOM 归档" description="完成版本确认后，归档记录会出现在这里。" action={<Button asChild size="sm" variant="outline"><Link to={routePath("page:design-changes", "/design-changes")}>前往设计变更</Link></Button>} />
          )}
        </aside>

        <div className="min-w-0 space-y-3">
          <section className="hz-surface min-w-0 overflow-hidden border bg-white">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef3ff] text-[#002fa7]" aria-hidden="true"><FileLock2 className="size-5" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-balance text-lg font-bold text-[#1b2559]">{selected.version}</h2>
                    <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", statusTone(selected.status))}>{selected.status}</span>
                  </div>
                  <p className="mt-1 text-pretty text-sm leading-6 text-slate-500">{selected.summary}</p>
                </div>
              </div>
              <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div><dt className="text-slate-400">适用型号</dt><dd className="mt-1 font-semibold text-slate-700">{selected.model}</dd></div>
                <div><dt className="text-slate-400">确认人</dt><dd className="mt-1 font-semibold text-slate-700">{selected.owner}</dd></div>
                <div className="col-span-2"><dt className="text-slate-400">确认时间</dt><dd className="mt-1 font-semibold text-slate-700 tabular-nums">{selected.confirmedAt}</dd></div>
              </dl>
            </div>

            <div className="grid min-w-0 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
                <HorizonSectionHeader Icon={ListChecks} title="差异确认清单" description="核对变更前后物料及影响说明。" trailing={<span className="text-xs text-slate-500 tabular-nums">{selected.changes.length} 项差异</span>} />
                {selected.changes.length ? (
                  <div className="divide-y divide-slate-100">
                    {selected.changes.map((item) => (
                      <div key={item.part} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(130px,.7fr)_minmax(0,1fr)_auto] sm:items-start">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-800">{item.part}</div>
                          <span className={cn("mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold", changeTone(item.status))}>{item.status}</span>
                        </div>
                        <div className="min-w-0 text-xs text-slate-500">
                          <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2"><span>变更前</span><span className="truncate font-medium text-slate-700">{item.before}</span></div>
                          <div className="mt-1 grid grid-cols-[48px_minmax(0,1fr)] gap-2"><span>变更后</span><span className="truncate font-medium text-slate-700">{item.after}</span></div>
                        </div>
                        <p className="max-w-48 text-pretty text-xs leading-5 text-slate-500">{item.impact}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <HorizonEmptyState Icon={ShieldCheck} title="本版本无物料差异" description="版本确认完成后可直接进入通知与归档。" action={<Button asChild size="sm" variant="outline"><Link to={routePath("page:quality-dms", "/quality-dms")}>查看质量文件</Link></Button>} />
                )}
              </div>

              <aside className="overflow-hidden rounded-xl border border-slate-200">
                <HorizonSectionHeader Icon={PackageCheck} title="流转就绪度" description="当前版本的归档前置项。" />
                <div className="divide-y divide-slate-100 px-3">
                  <div className="flex items-center gap-3 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><PackageCheck className="size-4" aria-hidden="true" /></span>
                    <div><div className="text-xs font-semibold text-slate-800">版本锁定</div><div className="mt-0.5 text-[11px] text-slate-500">原始记录已保留</div></div>
                  </div>
                  <div className="flex items-center gap-3 py-3">
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", pendingReasons ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600")}>{pendingReasons ? <FileWarning className="size-4" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}</span>
                    <div><div className="text-xs font-semibold text-slate-800">差异说明</div><div className="mt-0.5 text-[11px] text-slate-500">{pendingReasons ? `${pendingReasons} 项待补充` : "已全部确认"}</div></div>
                  </div>
                  <div className="flex items-center gap-3 py-3">
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", pendingNotices ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600")}><BellRing className="size-4" aria-hidden="true" /></span>
                    <div><div className="text-xs font-semibold text-slate-800">下游通知</div><div className="mt-0.5 text-[11px] text-slate-500">{pendingNotices ? `${pendingNotices} 个部门待确认` : "已全部送达"}</div></div>
                  </div>
                </div>
                <p className="border-t border-slate-100 bg-slate-50 px-3 py-3 text-pretty text-[11px] leading-5 text-slate-500">涉及设计、标签或验证影响时，请同步到设计变更与质量文件模块。</p>
              </aside>
            </div>
          </section>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(240px,.8fr)_minmax(0,1.2fr)]">
            <section className="hz-surface min-w-0 overflow-hidden border bg-white">
              <HorizonSectionHeader Icon={FileLock2} title="审计留痕链" description="确认、补录、通知和归档全程可追溯。" />
              {selected.auditTrail.length ? (
                <div className="divide-y divide-slate-100 px-4">
                  {selected.auditTrail.map((item, index) => (
                    <div key={item.title} className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 py-3">
                      <div className="pt-0.5">{item.status === "done" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : item.status === "current" ? <Clock3 className="size-4 text-[#002fa7]" aria-hidden="true" /> : <span className="block size-4 rounded-full border-2 border-slate-300" aria-hidden="true" />}</div>
                      <div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{index + 1}. {item.title}</div><p className="mt-1 text-pretty text-xs text-slate-500">{item.detail}</p></div>
                    </div>
                  ))}
                </div>
              ) : (
                <HorizonEmptyState Icon={FileLock2} title="暂无审计记录" description="确认 BOM 后，系统会自动建立留痕链。" action={<Button asChild size="sm" variant="outline"><Link to={routePath("page:design-changes", "/design-changes")}>处理设计变更</Link></Button>} />
              )}
            </section>

            <section className="hz-surface min-w-0 overflow-hidden border bg-white">
              <HorizonSectionHeader Icon={BellRing} title="下游通知记录" description="采购、生产、质量和法规的送达结果。" trailing={<span className="text-xs text-slate-500 tabular-nums">{selected.notifications.length} 条</span>} />
              {selected.notifications.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>{["通知对象", "渠道", "发送时间", "送达结果"].map((column) => <th key={column} className="px-4 py-3 font-semibold">{column}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selected.notifications.map((item) => (
                        <tr key={`${item.target}-${item.time}`} className="transition-colors duration-150 hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm font-medium text-slate-700">{item.target}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{item.channel}</td>
                          <td className="px-4 py-3 text-sm text-slate-500 tabular-nums">{item.time}</td>
                          <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", item.result === "已送达" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{item.result}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <HorizonEmptyState Icon={BellRing} title="暂无通知记录" description="完成差异说明后，可向相关部门发出版本变更通知。" action={<Button asChild size="sm" variant="outline"><Link to={routePath("page:design-changes", "/design-changes")}>检查变更单</Link></Button>} />
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
