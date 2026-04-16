import React, { useMemo, useState } from "react";
import { BookOpen, FileSearch, Link2, Tag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const clauses = [
  { id: "RA-820", title: "FDA 21 CFR 820", module: "QMS / 设计变更", status: "现行", detail: "适用于质量体系与设计历史文件管理" },
  { id: "RA-MDR2", title: "CE MDR Annex II", module: "技术文档 / 注册", status: "现行", detail: "适用于欧盟技术文档与标签说明" },
  { id: "RA-NMPA5", title: "NMPA 注册申报资料要求", module: "注册项目", status: "现行", detail: "适用于中国注册资料编制与提交" },
  { id: "RA-ISO14971", title: "ISO 14971 风险管理", module: "风险评估 / 合同", status: "历史版本", detail: "适用于风险识别与残余风险控制" },
];

const tone: Record<string, string> = {
  现行: "bg-emerald-50 text-emerald-700",
  历史版本: "bg-slate-100 text-slate-600",
};

export function RAKnowledgePage() {
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState(clauses[0].id);
  const filtered = useMemo(() => clauses.filter((item) => !keyword || [item.id, item.title, item.module, item.detail].join(" ").toLowerCase().includes(keyword.toLowerCase())), [keyword]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Regulatory</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">法规知识库</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">把法规条款、适用模块、历史版本和知识映射统一起来，帮助研发、质量、法务快速复用。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          ["法规文档", "36", "FDA / CE / NMPA"],
          ["高相关条款", "14", "关联当前模块"],
          ["历史版本", "5", "可追溯查询"],
          ["知识映射", "22", "已标注产品模块"],
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
            <FileSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="material-input pl-11" placeholder="搜索条款、模块、关键词" />
          </div>
          <div className="space-y-4">
            {filtered.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <div className="mt-2 text-sm text-slate-500">{item.id} · {item.module}</div>
                  </div>
                  <span className={cn("material-chip", tone[item.status])}>{item.status}</span>
                </div>
                <div className="mt-3 text-sm text-slate-600">{item.detail}</div>
              </button>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <section className="material-card p-6">
            <h3 className="text-slate-900">条款详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.title}</div>
                  <div className="mt-3 text-sm leading-7 text-slate-600">{selected.detail}</div>
                </div>
                {[
                  ["关联模块", selected.module],
                  ["推荐动作", "同步到设计变更 / 质量 DMS / 合同审查"],
                  ["维护人", "RA 团队与质量部联合维护"],
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
              <button type="button" onClick={() => toast.success("条款已加入知识映射")} className="material-button-primary w-full justify-center">
                <Tag className="h-4 w-4" />
                标记模块映射
              </button>
              <button type="button" onClick={() => toast.success("法规摘要已导出")} className="material-button-secondary w-full justify-center">
                <BookOpen className="h-4 w-4" />
                导出法规摘要
              </button>
              <button type="button" onClick={() => toast.success("已生成条款引用链接")} className="material-button-secondary w-full justify-center">
                <Link2 className="h-4 w-4" />
                生成引用链接
              </button>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
