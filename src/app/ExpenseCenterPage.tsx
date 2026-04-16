import React, { useMemo, useState } from "react";
import { CreditCard, Receipt, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const expenses = [
  { id: "EXP-501", applicant: "张明", category: "差旅", amount: "4,820", status: "待审批", note: "德国展会往返机票与酒店" },
  { id: "EXP-497", applicant: "刘敏", category: "采购", amount: "1,260", status: "已打回", note: "发票抬头需修正" },
  { id: "EXP-488", applicant: "韩青", category: "售后", amount: "860", status: "已通过", note: "现场差旅补贴" },
  { id: "EXP-476", applicant: "王思远", category: "办公", amount: "540", status: "待审批", note: "样机包装与快递" },
];

const tone: Record<string, string> = {
  待审批: "bg-amber-50 text-amber-700",
  已打回: "bg-rose-50 text-rose-700",
  已通过: "bg-emerald-50 text-emerald-700",
};

export function ExpenseCenterPage() {
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState(expenses[0].id);
  const filtered = useMemo(() => expenses.filter((item) => !keyword || [item.id, item.applicant, item.category, item.note].join(" ").toLowerCase().includes(keyword.toLowerCase())), [keyword]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Expense Flow</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">费用报销</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">把报销单、票据摘要、审批意见和财务动作放到同一个视图里，方便部门和财务同步处理。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["待审批", "9", "本周新增 4 单"],
          ["已打回", "2", "需补票据"],
          ["本月通过", "18", "财务已入账"],
          ["预算占用", "68%", "差旅与市场较高"],
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
          <div className="relative mb-5 max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="material-input pl-11" placeholder="搜索报销单号、申请人、类别" />
          </div>
          <div className="space-y-4">
            {filtered.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.id}</div>
                    <div className="mt-2 text-sm text-slate-500">{item.applicant} · {item.category}</div>
                  </div>
                  <span className={cn("material-chip", tone[item.status])}>{item.status}</span>
                </div>
                <div className="mt-3 text-sm text-slate-600">{item.note}</div>
                <div className="mt-4 text-lg font-bold text-slate-900">¥ {item.amount}</div>
              </button>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <section className="material-card p-6">
            <h3 className="text-slate-900">报销详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.id}</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>申请人：{selected.applicant}</div>
                    <div>类别：{selected.category}</div>
                    <div>金额：¥ {selected.amount}</div>
                    <div>状态：{selected.status}</div>
                  </div>
                </div>
                {[
                  ["票据摘要", selected.note],
                  ["审批意见", selected.status === "已打回" ? "请补充正确抬头发票" : "票据与预算基本匹配"],
                  ["下一步", selected.status === "待审批" ? "提交部门主管与财务复核" : "等待申请人补件或入账完成"],
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
              <button type="button" onClick={() => toast.success("报销单已送审")} className="material-button-primary w-full justify-center">
                <Send className="h-4 w-4" />
                提交审批
              </button>
              <button type="button" onClick={() => toast.success("票据识别结果已更新")} className="material-button-secondary w-full justify-center">
                <Receipt className="h-4 w-4" />
                刷新票据识别
              </button>
              <button type="button" onClick={() => toast.success("预算占用校验完成")} className="material-button-secondary w-full justify-center">
                <CreditCard className="h-4 w-4" />
                校验预算
              </button>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
