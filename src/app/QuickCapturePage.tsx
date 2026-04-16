import React, { useMemo, useState } from "react";
import { MessageSquareText, Send, Sparkles, Tag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const notes = [
  { id: "QC-101", text: "客户反馈说明书中维护周期描述不清", channel: "微信", owner: "市场部", tag: "资料优化", status: "待分流" },
  { id: "QC-098", text: "售后建议增加现场图片上传入口", channel: "会议纪要", owner: "售后部", tag: "系统改进", status: "已转研发" },
  { id: "QC-094", text: "法务建议补充代理合同竞业条款", channel: "邮件", owner: "法务部", tag: "合同调整", status: "待分流" },
  { id: "QC-087", text: "研发记录泵头异常噪音复现条件", channel: "随手记", owner: "研发部", tag: "缺陷排查", status: "已归档" },
];

const activityFeed = [
  { time: "09:12", title: "微信反馈已同步到待分流池", detail: "来自客户群的说明书问题，自动打上“资料优化”标签" },
  { time: "10:26", title: "系统改进建议已转研发", detail: "售后上传入口需求已同步到 BUG 与迭代清单" },
  { time: "14:40", title: "法务建议待确认归属", detail: "合同竞业条款建议等待商务负责人选择去向" },
];

const statusTone: Record<string, string> = {
  待分流: "bg-amber-50 text-amber-700",
  已转研发: "bg-blue-50 text-blue-700",
  已归档: "bg-emerald-50 text-emerald-700",
};

export function QuickCapturePage() {
  const [status, setStatus] = useState("全部");
  const [selectedId, setSelectedId] = useState(notes[0].id);

  const filtered = useMemo(() => notes.filter((item) => status === "全部" || item.status === status), [status]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Quick Capture</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">随手记分流</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">把零散反馈、灵感记录和跨部门碎片信息快速归类，避免有价值的输入在群聊和便签里流失。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["待分流", "7", "需要人工确认去向"],
          ["今日新增", "4", "来自会议与微信群"],
          ["已转任务", "12", "同步研发/资料/法务"],
          ["已归档", "26", "可全文检索"],
        ].map(([label, value, helper]) => (
          <div key={label} className="material-card-flat p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{value}</div>
            <div className="mt-2 text-sm text-slate-500">{helper}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="material-card p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            {["全部", "待分流", "已转研发", "已归档"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStatus(item)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold",
                  status === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "w-full rounded-[24px] border p-5 text-left",
                  selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.text}</div>
                    <div className="mt-2 text-sm text-slate-500">{item.id} · {item.channel} · {item.owner}</div>
                  </div>
                  <span className={cn("material-chip", statusTone[item.status])}>{item.status}</span>
                </div>
                <div className="mt-3 text-sm text-slate-600">标签：{item.tag}</div>
              </button>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <section className="material-card p-6">
            <h3 className="text-slate-900">记录详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.text}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>编号：{selected.id}</div>
                    <div>来源：{selected.channel}</div>
                    <div>归属：{selected.owner}</div>
                    <div>标签：{selected.tag}</div>
                  </div>
                </div>
                {[
                  ["AI 建议去向", "资料库 / 研发 / 合同流程"],
                  ["处理建议", "先创建任务，再同步到对应模块"],
                  ["记录价值", "适合纳入持续改进清单"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                    <div className="mt-2 text-sm text-slate-700">{value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <section className="material-card p-6">
            <div className="space-y-3">
              <button type="button" onClick={() => toast.success("记录已转成任务")} className="material-button-primary w-full justify-center">
                <Send className="h-4 w-4" />
                转成任务
              </button>
              <button type="button" onClick={() => toast.success("已生成 AI 分类建议")} className="material-button-secondary w-full justify-center">
                <Sparkles className="h-4 w-4" />
                生成分类建议
              </button>
              <button type="button" onClick={() => toast.success("标签已更新")} className="material-button-secondary w-full justify-center">
                <Tag className="h-4 w-4" />
                更新标签
              </button>
            </div>
          </section>
        </aside>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="material-card p-6">
          <div className="mb-4">
            <h3 className="text-slate-900">最近活动</h3>
            <p className="mt-1 text-sm text-slate-500">显示随手记从采集到分流的最近处理记录。</p>
          </div>
          <div className="space-y-4">
            {activityFeed.map((item) => (
              <div key={item.time} className="rounded-[22px] border border-slate-100 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                  <span className="material-chip bg-white text-slate-500">{item.time}</span>
                </div>
                <div className="mt-2 text-sm text-slate-600">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <aside className="material-card p-6">
          <h3 className="text-slate-900">分流建议</h3>
          <div className="mt-4 space-y-3">
            {[
              "资料类记录优先同步到对外资料版本，并补一句可执行建议。",
              "系统改进类内容同时抄送研发问题分流，避免遗漏。",
              "合同与法务建议建议保留来源渠道，方便后续追溯。",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
