import React, { useMemo, useState } from "react";
import { CheckSquare, ClipboardList, FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const batches = [
  { id: "BPR-24016", product: "OC-10", line: "Line A", status: "待复核", operator: "王工", note: "电子签名缺 1 人" },
  { id: "BPR-24012", product: "OC-5", line: "Line B", status: "已签核", operator: "陈宇", note: "生产记录完整" },
  { id: "BPR-24009", product: "OC-3", line: "Line A", status: "进行中", operator: "李敏", note: "待补充清场记录" },
];

const processOverview = [
  { step: "投料与开批", state: "已完成", detail: "设备参数与批号已自动带入" },
  { step: "生产过程记录", state: "进行中", detail: "关键工序已完成 7/9 个节点" },
  { step: "电子签名", state: "待补录", detail: "制造主管签名待完成" },
  { step: "QA 复核与归档", state: "待开始", detail: "完成补录后进入 QA 复核" },
];

const tone: Record<string, string> = {
  待复核: "bg-amber-50 text-amber-700",
  已签核: "bg-emerald-50 text-emerald-700",
  进行中: "bg-blue-50 text-blue-700",
};

export function EBPRPage() {
  const [status, setStatus] = useState("全部");
  const [selectedId, setSelectedId] = useState(batches[0].id);
  const filtered = useMemo(() => batches.filter((item) => status === "全部" || item.status === status), [status]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">eBPR</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">电子批记录</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">集中追踪生产批次、电子签名、偏差补录和 QA 复核，方便生产与质量同步闭环。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["进行中", "5", "生产线持续录入"],
          ["待复核", "3", "QA 今日处理"],
          ["已签核", "18", "可归档放行"],
          ["待补记录", "2", "需补清场或偏差"],
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
            {["全部", "进行中", "待复核", "已签核"].map((item) => (
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
                    <div className="text-sm font-semibold text-slate-800">{item.id}</div>
                    <div className="mt-2 text-sm text-slate-500">{item.product} · {item.line} · 操作员 {item.operator}</div>
                  </div>
                  <span className={cn("material-chip", tone[item.status])}>{item.status}</span>
                </div>
                <div className="mt-3 text-sm text-slate-600">{item.note}</div>
              </button>
            ))}
          </div>
        </div>
        <aside className="space-y-6">
          <section className="material-card p-6">
            <h3 className="text-slate-900">批记录详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.id}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>产品：{selected.product}</div>
                    <div>产线：{selected.line}</div>
                    <div>状态：{selected.status}</div>
                    <div>操作员：{selected.operator}</div>
                  </div>
                </div>
                {[
                  ["缺失记录", selected.note],
                  ["电子签名", "制造主管 / QA 签核进度可追踪"],
                  ["下一步", "完成补录后进入 QA 复核"],
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
              <button type="button" onClick={() => toast.success("已提交 QA 复核")} className="material-button-primary w-full justify-center">
                <Send className="h-4 w-4" />
                提交复核
              </button>
              <button type="button" onClick={() => toast.success("清场记录模板已补入")} className="material-button-secondary w-full justify-center">
                <ClipboardList className="h-4 w-4" />
                补录记录
              </button>
              <button type="button" onClick={() => toast.success("批记录 PDF 已生成")} className="material-button-secondary w-full justify-center">
                <FileText className="h-4 w-4" />
                导出批记录
              </button>
            </div>
          </section>
        </aside>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="material-card p-6">
          <h3 className="text-slate-900">批次过程总览</h3>
          <div className="mt-4 space-y-4">
            {processOverview.map((item) => (
              <div key={item.step} className="rounded-[22px] border border-slate-100 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">{item.step}</div>
                  <span className={cn("material-chip", item.state === "已完成" ? "bg-emerald-50 text-emerald-700" : item.state === "进行中" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700")}>
                    {item.state}
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-600">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="material-card p-6">
          <h3 className="text-slate-900">待办提醒</h3>
          <div className="mt-4 space-y-3">
            {[
              "BPR-24016 需在 16:30 前补齐主管电子签名。",
              "Line A 的清场记录建议增加拍照上传证明。",
              "已签核批次可自动同步到检验放行模块继续流转。",
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
