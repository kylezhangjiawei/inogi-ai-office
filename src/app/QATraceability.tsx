import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Download, PackageSearch, Search, ShieldAlert } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

type TraceRow = {
  batch: string;
  material: string;
  iqc: string;
  status: "ok" | "warning";
};

const traceRows: TraceRow[] = [
  { batch: "DW-20240310", material: "压缩机总成", iqc: "IQC-240310", status: "ok" },
  { batch: "PCB-20240312", material: "主板 PCB", iqc: "IQC-240312", status: "warning" },
  { batch: "VAL-20240308", material: "阀组件", iqc: "IQC-240308", status: "ok" },
];

const processSteps = [
  { title: "组装", owner: "王师傅", time: "04-15 09:00", done: true },
  { title: "调试", owner: "李工", time: "04-15 14:00", done: true },
  { title: "FQC 检验", owner: "QA 陈检", time: "04-16 09:30", done: true },
  { title: "包装", owner: "包装组", time: "04-17 10:20", done: true },
  { title: "放行", owner: "QA 主管", time: "04-17 14:40", done: true },
];

const shipmentRows = [
  { sn: "OC5-2024-001", target: "Medline Mexico", status: "shipped" },
  { sn: "OC5-2024-002", target: "Medline Mexico", status: "shipped" },
  { sn: "OC5-2024-019", target: "库存", status: "stock" },
  { sn: "OC5-2024-020", target: "售后工单 CS-2024-0892", status: "after-sales" },
];

export function QATraceability() {
  const [query, setQuery] = useState("20240315-OC5-001");
  const [searched, setSearched] = useState(true);

  const warningCount = useMemo(() => traceRows.filter((row) => row.status === "warning").length, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="space-y-3">
          <span className="material-chip bg-blue-50 text-blue-700">QA Traceability</span>
          <div>
            <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">全链路追溯查询</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              这一页补齐了质量追溯能力，支持按批号查看原料、过程、出货和售后去向。
            </p>
          </div>
        </div>
      </section>

      <section className="material-card p-6">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="material-input pl-11" placeholder="输入批号 / SN / 订单号" />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearched(true);
              toast.success(`已查询批号 ${query}`);
            }}
            className="material-button-primary"
          >
            <PackageSearch className="h-4 w-4" />
            查询
          </button>
        </div>
      </section>

      {searched ? (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="material-card-flat p-5">
              <div className="text-sm font-medium text-slate-500">追溯批号</div>
              <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{query}</div>
            </div>
            <div className="material-card-flat p-5">
              <div className="text-sm font-medium text-slate-500">异常原料</div>
              <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{warningCount}</div>
            </div>
            <div className="material-card-flat p-5">
              <div className="text-sm font-medium text-slate-500">链路状态</div>
              <div className="mt-3 text-4xl font-bold tracking-tight text-emerald-600">可追溯</div>
            </div>
          </section>

          <section className="grid grid-cols-12 gap-6">
            <div className="col-span-12 xl:col-span-4">
              <div className="material-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <ArrowUp className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-slate-900">向上追溯原料</h3>
                </div>
                <div className="space-y-3">
                  {traceRows.map((row) => (
                    <div key={row.batch} className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-800">{row.material}</div>
                        {row.status === "ok" ? (
                          <span className="material-chip bg-emerald-50 text-emerald-700">正常</span>
                        ) : (
                          <span className="material-chip bg-amber-50 text-amber-700">关注</span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-slate-500">批次：{row.batch}</div>
                      <div className="mt-1 text-sm text-slate-500">来料检验：{row.iqc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="col-span-12 xl:col-span-4">
              <div className="material-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <h3 className="text-slate-900">生产过程</h3>
                </div>
                <div className="space-y-4">
                  {processSteps.map((step) => (
                    <div key={step.title} className="flex items-start gap-3 rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                      <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{step.title}</div>
                        <div className="mt-1 text-sm text-slate-500">{step.owner}</div>
                        <div className="mt-1 text-xs text-slate-400">{step.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="col-span-12 xl:col-span-4">
              <div className="material-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <ArrowDown className="h-5 w-5 text-primary" />
                  <h3 className="text-slate-900">向下追溯去向</h3>
                </div>
                <div className="space-y-3">
                  {shipmentRows.map((row) => (
                    <div key={row.sn} className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                      <div className="text-sm font-semibold text-slate-800">{row.sn}</div>
                      <div className="mt-1 text-sm text-slate-500">{row.target}</div>
                      {row.status === "after-sales" ? (
                        <Link to="/after-sales/CS-2024-0892" className="mt-3 inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600">
                          跳转售后工单
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="material-card p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-slate-900">追溯结论</h3>
                <p className="mt-1 text-sm text-slate-500">当前批号可完整追溯，但主板来料存在让步接收记录，建议重点关注。</p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => toast.success("已导出追溯 PDF")} className="material-button-secondary">
                  <Download className="h-4 w-4" />
                  导出报告
                </button>
                <button type="button" onClick={() => toast.warning("已发起召回评估流程")} className="material-button-primary">
                  <ShieldAlert className="h-4 w-4" />
                  发起评估
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
