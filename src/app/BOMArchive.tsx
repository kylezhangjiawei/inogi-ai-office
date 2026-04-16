import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  FileLock2,
  FileWarning,
  FolderArchive,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "./components/ui/utils";

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
      { target: "生产部", channel: "邮件", time: "2026-04-12 14:27", result: "已送达" },
      { target: "质量部", channel: "系统站内信", time: "2026-04-12 14:27", result: "已送达" },
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
      { target: "质量部", channel: "系统站内信", time: "2026-04-09 10:10", result: "待发送" },
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
      { target: "生产部", channel: "邮件", time: "2026-04-07 17:06", result: "已送达" },
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
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <span className="material-chip bg-blue-50 text-blue-700">Archive Workflow</span>
            <div>
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">BOM 确认存档</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                这一页已经从通用模块升级为独立流程页，覆盖 BOM 版本确认、差异说明、不可变更审计链和下游通知留痕，方便继续流转到设计变更和质量文件管理。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/design-changes" className="material-button-secondary">
              去设计变更
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/quality-dms" className="material-button-secondary">
              去质量 DMS
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">已归档记录</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">32</div>
          <div className="mt-2 text-sm text-slate-500">保留确认人与时间戳，不允许删除原始记录</div>
        </div>
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">待补充说明</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{pendingReasons}</div>
          <div className="mt-2 text-sm text-slate-500">当前选中版本仍有变更原因需要补录</div>
        </div>
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">待确认通知</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{pendingNotices}</div>
          <div className="mt-2 text-sm text-slate-500">采购、生产、法规等部门需确认收到变更</div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-4">
          <div className="material-card h-full p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">归档记录列表</h3>
                <p className="mt-1 text-sm text-slate-500">按版本、型号和状态筛选已确认或待处理记录。</p>
              </div>
              <FolderArchive className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-3">
              {bomRecords.map((record) => (
                <button
                  key={record.id}
                  onClick={() => setSelectedId(record.id)}
                  className={cn(
                    "w-full rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 text-left transition hover:-translate-y-0.5",
                    selected.id === record.id ? "ring-2 ring-blue-200 bg-white" : "",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{record.version}</div>
                      <div className="mt-1 text-sm text-slate-500">{record.model} / {record.owner}</div>
                    </div>
                    <span className={cn("material-chip", statusTone(record.status))}>{record.status}</span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-500">{record.summary}</div>
                  <div className="mt-3 text-xs text-slate-400">{record.confirmedAt}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card h-full space-y-5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">差异确认清单</h3>
                <p className="mt-1 text-sm text-slate-500">展示当前 BOM 版本中变更过的物料及其影响说明。</p>
              </div>
              <span className={cn("material-chip", statusTone(selected.status))}>{selected.status}</span>
            </div>

            <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-500">当前版本</div>
                  <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{selected.version}</div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-primary">
                  <FileLock2 className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-3 text-sm leading-6 text-slate-600">{selected.summary}</div>
            </div>

            <div className="space-y-3">
              {selected.changes.map((item) => (
                <div key={item.part} className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{item.part}</div>
                      <div className="mt-2 text-sm text-slate-500">变更前：{item.before}</div>
                      <div className="mt-1 text-sm text-slate-500">变更后：{item.after}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">{item.impact}</div>
                    </div>
                    <span className={cn("material-chip", changeTone(item.status))}>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-3">
          <div className="material-card h-full space-y-4 p-6">
            <div>
              <h3 className="text-slate-900">流程提醒</h3>
              <p className="mt-1 text-sm text-slate-500">帮助确认当前版本是否还能继续流转。</p>
            </div>

            <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800">版本已锁定</div>
                  <div className="text-sm text-slate-500">原始记录留痕保留</div>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", pendingReasons ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600")}>
                  {pendingReasons ? <FileWarning className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800">变更说明</div>
                  <div className="text-sm text-slate-500">
                    {pendingReasons ? `还有 ${pendingReasons} 项待补充` : "所有差异已说明"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", pendingNotices ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600")}>
                  <BellRing className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800">下游通知</div>
                  <div className="text-sm text-slate-500">
                    {pendingNotices ? `还有 ${pendingNotices} 个部门待确认` : "通知已全部送达"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-500">
              <div className="font-semibold text-slate-700">后续流转建议</div>
              <div className="mt-2">若涉及设计、标签、说明书或验证影响，建议继续同步到设计变更与质量文件模块。</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-6">
          <div className="material-card h-full p-6">
            <div className="mb-5">
              <h3 className="text-slate-900">审计留痕链</h3>
              <p className="mt-1 text-sm text-slate-500">每一次确认、补录和通知都保留时间戳，满足可追溯要求。</p>
            </div>

            <div className="space-y-4">
              {selected.auditTrail.map((item) => (
                <div key={item.title} className="flex gap-4 rounded-[20px] border border-slate-100 bg-slate-50/60 p-4">
                  <div className="pt-0.5">
                    {item.status === "done" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : item.status === "current" ? (
                      <Clock3 className="h-5 w-5 text-blue-600" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-slate-200" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-6">
          <div className="material-card h-full p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">通知记录</h3>
                <p className="mt-1 text-sm text-slate-500">记录系统向采购、生产、质量和法规发送的变更通知。</p>
              </div>
              <BellRing className="h-5 w-5 text-primary" />
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50">
                  <tr>
                    {["通知对象", "渠道", "时间", "结果"].map((column) => (
                      <th key={column} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.notifications.map((item) => (
                    <tr key={`${item.target}-${item.time}`} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-sm text-slate-700">{item.target}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{item.channel}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">{item.time}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={cn("material-chip", item.result === "已送达" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                          {item.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
