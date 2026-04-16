import React, { useMemo, useState } from "react";
import { BadgeCheck, ClipboardCheck, PackageCheck, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const releases = [
  { id: "REL-8801", batch: "OC10-240416", result: "待放行", qa: "刘婧", note: "抽检合格，待主管签批" },
  { id: "REL-8798", batch: "OC5-240414", result: "已放行", qa: "周远", note: "已同步仓储与物流" },
  { id: "REL-8790", batch: "OC3-240412", result: "待复检", qa: "韩青", note: "外观抽样异常待复核" },
];

const releaseTimeline = [
  { time: "08:45", label: "抽检完成", detail: "功能、外观、标签项目已记录" },
  { time: "10:20", label: "QA 初审通过", detail: "REL-8801 等待主管签批" },
  { time: "11:35", label: "仓储预通知", detail: "已准备待放行批次库位" },
];

const tone: Record<string, string> = {
  待放行: "bg-amber-50 text-amber-700",
  已放行: "bg-emerald-50 text-emerald-700",
  待复检: "bg-blue-50 text-blue-700",
};

export function InspectionReleasePage() {
  const [result, setResult] = useState("全部");
  const [selectedId, setSelectedId] = useState(releases[0].id);
  const filtered = useMemo(() => releases.filter((item) => result === "全部" || item.result === result), [result]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Release QA</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">检验放行</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">统一查看批次检验结果、复检状态和放行动作，给 QA 和仓储一条清晰的放行链路。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["待放行", "4", "今日需签批"],
          ["待复检", "1", "外观异常待确认"],
          ["已放行", "16", "已同步物流"],
          ["抽检完成率", "96%", "本周稳定"],
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
            {["全部", "待放行", "待复检", "已放行"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setResult(item)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold",
                  result === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500",
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
                    <div className="text-sm font-semibold text-slate-800">{item.id}</div>
                    <div className="mt-2 text-sm text-slate-500">{item.batch} · QA {item.qa}</div>
                  </div>
                  <span className={cn("material-chip", tone[item.result])}>{item.result}</span>
                </div>
                <div className="mt-3 text-sm text-slate-600">{item.note}</div>
              </button>
            ))}
          </div>
        </div>
        <aside className="space-y-6">
          <section className="material-card p-6">
            <h3 className="text-slate-900">放行详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.id}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>批次：{selected.batch}</div>
                    <div>QA：{selected.qa}</div>
                    <div>结果：{selected.result}</div>
                    <div>备注：{selected.note}</div>
                  </div>
                </div>
                {[
                  ["检验摘要", "抽检、功能、外观三项已记录"],
                  ["关联动作", "放行后同步仓储、物流和销售"],
                  ["下一步", selected.result === "待复检" ? "安排复检并补录结论" : "完成主管签批"],
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
              <button type="button" onClick={() => toast.success("批次已提交放行")} className="material-button-primary w-full justify-center">
                <PackageCheck className="h-4 w-4" />
                执行放行
              </button>
              <button type="button" onClick={() => toast.success("复检任务已创建")} className="material-button-secondary w-full justify-center">
                <ClipboardCheck className="h-4 w-4" />
                创建复检
              </button>
              <button type="button" onClick={() => toast.success("放行通知已发送")} className="material-button-secondary w-full justify-center">
                <BadgeCheck className="h-4 w-4" />
                通知下游
              </button>
            </div>
          </section>
        </aside>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="material-card p-6">
          <h3 className="text-slate-900">今日放行时间线</h3>
          <div className="mt-4 space-y-4">
            {releaseTimeline.map((item) => (
              <div key={item.time} className="rounded-[22px] border border-slate-100 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">{item.label}</div>
                  <span className="material-chip bg-white text-slate-500">{item.time}</span>
                </div>
                <div className="mt-2 text-sm text-slate-600">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="material-card p-6">
          <h3 className="text-slate-900">风险提示</h3>
          <div className="mt-4 space-y-3">
            {[
              "待复检批次建议锁定库位，避免误发货。",
              "放行后需同步销售与客服，确保交付状态一致。",
              "若 2 小时内未签批，可自动触发主管提醒。",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
