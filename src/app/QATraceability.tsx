import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  Link2,
  PackageCheck,
  PackageSearch,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

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

const sampleQuery = "20240315-OC5-001";

export function QATraceability() {
  const [query, setQuery] = useState(sampleQuery);
  const [activeQuery, setActiveQuery] = useState(sampleQuery);
  const [searched, setSearched] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [evaluationOpen, setEvaluationOpen] = useState(false);

  const warningCount = useMemo(() => traceRows.filter((row) => row.status === "warning").length, []);
  const evidenceCount = traceRows.length + processSteps.length + shipmentRows.length;

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) {
      setSearchError("请输入批号、序列号或订单号。");
      setSearched(false);
      return;
    }
    setSearchError("");
    setActiveQuery(normalized);
    setSearched(true);
    toast.success(`已查询标识 ${normalized}`);
  }

  function restoreSample() {
    setQuery(sampleQuery);
    setActiveQuery(sampleQuery);
    setSearchError("");
    setSearched(true);
  }

  return (
    <div className="horizon-theme hz-page min-w-0 space-y-3 px-3 py-3 sm:px-4 lg:px-5">
      <HorizonPageHeader
        Icon={PackageSearch}
        eyebrow="质量体系 / END-TO-END TRACEABILITY"
        title="全链路追溯查询"
        description="按生产批次、序列号或订单号串联原料检验、生产过程、出货及售后去向证据。"
        meta={
          <>
            <span>证据链最后更新 2026-04-17 14:40</span>
            <span aria-hidden="true">·</span>
            <span>数据状态：已同步</span>
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link to={routePath("page:quality-dms", "/quality-dms")}>
              <FileCheck2 aria-hidden="true" />
              质量文件库
            </Link>
          </Button>
        }
      />

      <form className="hz-surface min-w-0 overflow-hidden" onSubmit={handleSearch} noValidate>
        <HorizonSectionHeader Icon={Search} title="批次与订单检索" description="支持批号、产品 SN、生产订单号与销售订单号。" />
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="trace-query" className="text-slate-700">批号 / SN / 订单号</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="trace-query"
                value={query}
                onChange={(event) => { setQuery(event.target.value); if (searchError) setSearchError(""); }}
                className="pl-9"
                placeholder="例如：20240315-OC5-001"
                aria-invalid={Boolean(searchError)}
                aria-describedby={searchError ? "trace-query-error" : "trace-query-help"}
              />
            </div>
            {searchError ? (
              <p id="trace-query-error" className="text-pretty text-xs text-red-600" role="alert">{searchError}</p>
            ) : (
              <p id="trace-query-help" className="text-pretty text-xs text-slate-500">系统将返回与该标识关联的全部上下游证据。</p>
            )}
          </div>
          <Button type="submit" className="hz-primary-action sm:mt-6 sm:min-w-28">
            <PackageSearch aria-hidden="true" />
            查询
          </Button>
        </div>
      </form>

      {searched ? (
        <>
          <HorizonMetricGrid>
            <HorizonMetric
              Icon={Link2}
              label="追溯标识"
              value={<span className="break-all text-base">{activeQuery}</span>}
              note="匹配生产批次"
              tone="brand"
            />
            <HorizonMetric Icon={PackageCheck} label="上游物料" value={traceRows.length} note="均有关联 IQC 记录" tone="neutral" />
            <HorizonMetric Icon={AlertTriangle} label="关注证据" value={warningCount} note="主板来料让步接收" tone="warning" />
            <HorizonMetric Icon={CheckCircle2} label="链路状态" value="可追溯" note={`${evidenceCount} 条证据已关联`} tone="success" />
          </HorizonMetricGrid>

          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="hz-surface min-w-0 overflow-hidden">
              <HorizonSectionHeader
                Icon={ClipboardCheck}
                title="链路证据时间轴"
                description="从原料批次向下串联到生产、放行、出货与售后记录。"
                trailing={<span className="text-xs tabular-nums text-slate-500">{evidenceCount} 条证据</span>}
              />
              <ol className="p-4 sm:p-5" aria-label="产品全链路追溯证据">
                <TraceStage Icon={ArrowUp} title="上游原料与来料检验" meta={`${traceRows.length} 个物料批次`}>
                  <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[560px] text-sm">
                      <caption className="sr-only">上游原料批次与来料检验证据</caption>
                      <thead className="bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                          <th scope="col" className="px-3 py-2.5 font-semibold">物料</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">批次</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">来料检验</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {traceRows.map((row) => (
                          <tr key={row.batch}>
                            <td className="px-3 py-3 font-semibold text-slate-800">{row.material}</td>
                            <td className="px-3 py-3 font-mono text-xs tabular-nums text-slate-600">{row.batch}</td>
                            <td className="px-3 py-3 font-mono text-xs tabular-nums text-slate-600">{row.iqc}</td>
                            <td className="px-3 py-3">
                              <span className={row.status === "ok" ? "inline-flex rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700" : "inline-flex rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"}>
                                {row.status === "ok" ? "正常" : "关注"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TraceStage>

                <TraceStage Icon={Wrench} title="生产过程与质量放行" meta={`${processSteps.length} 个完成节点`}>
                  <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="生产过程节点">
                    {processSteps.map((step, index) => (
                      <li key={step.title} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex size-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden="true">
                            <CheckCircle2 className="size-4" />
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        </div>
                        <div className="mt-3 text-sm font-semibold text-slate-800">{step.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{step.owner}</div>
                        <time className="mt-2 block text-xs tabular-nums text-muted-foreground">{step.time}</time>
                      </li>
                    ))}
                  </ol>
                </TraceStage>

                <TraceStage Icon={ArrowDown} title="下游出货与售后去向" meta={`${shipmentRows.length} 个产品序列号`} last>
                  <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[520px] text-sm">
                      <caption className="sr-only">产品序列号出货及售后去向</caption>
                      <thead className="bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                          <th scope="col" className="px-3 py-2.5 font-semibold">产品 SN</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">当前去向</th>
                          <th scope="col" className="px-3 py-2.5 font-semibold">证据</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {shipmentRows.map((row) => (
                          <tr key={row.sn}>
                            <td className="px-3 py-3 font-mono text-xs tabular-nums text-slate-700">{row.sn}</td>
                            <td className="px-3 py-3 text-slate-600">{row.target}</td>
                            <td className="px-3 py-3">
                              {row.status === "after-sales" ? (
                                <Button asChild variant="outline" size="sm" className="border-red-100 text-red-600 hover:bg-red-50">
                                  <Link to="/after-sales/CS-2024-0892">查看售后工单</Link>
                                </Button>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                                  已关联
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TraceStage>
              </ol>
            </section>

            <aside className="hz-surface min-w-0 overflow-hidden xl:self-start">
              <HorizonSectionHeader Icon={FileCheck2} title="追溯摘要" description="当前查询的链路完整性与风险结论。" />
              <div className="space-y-4 p-4">
                <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
                  <SummaryDatum label="匹配类型" value="生产批次" />
                  <SummaryDatum label="产品型号" value="OC-5" />
                  <SummaryDatum label="链路证据" value={`${evidenceCount} 条`} tabular />
                  <SummaryDatum label="完成节点" value={`${processSteps.filter((step) => step.done).length} / ${processSteps.length}`} tabular />
                </dl>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    链路完整
                  </div>
                  <p className="mt-2 text-pretty text-xs leading-5 text-emerald-800">原料、生产、放行和产品去向记录均可关联至当前批次。</p>
                </div>

                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    关注主板来料
                  </div>
                  <p className="mt-2 text-pretty text-xs leading-5 text-amber-800">主板 PCB 存在让步接收记录，建议在风险评估中重点复核。</p>
                </div>

                <div className="grid gap-2">
                  <Button type="button" variant="outline" onClick={() => toast.success("已导出追溯 PDF")}>
                    <Download aria-hidden="true" />
                    导出追溯报告
                  </Button>
                  <Button type="button" className="hz-primary-action" onClick={() => setEvaluationOpen(true)}>
                    <ShieldAlert aria-hidden="true" />
                    发起风险评估
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <section className="hz-surface">
          <HorizonEmptyState
            Icon={PackageSearch}
            title="尚未生成追溯链路"
            description="输入有效的批号、序列号或订单号后执行查询。"
            action={<Button type="button" className="hz-primary-action" size="sm" onClick={restoreSample}>恢复示例批次</Button>}
          />
        </section>
      )}

      <AlertDialog open={evaluationOpen} onOpenChange={setEvaluationOpen}>
        <AlertDialogContent className="horizon-portal">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance">确认发起风险评估？</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              将基于追溯标识 {activeQuery} 与当前关联证据创建模拟评估流程，请确认已复核主板来料异常记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-primary text-white hover:bg-primary-hover" onClick={() => toast.warning("已发起召回评估流程")}>
              确认发起
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TraceStage({
  Icon,
  title,
  meta,
  last = false,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  meta: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
      {!last ? <span className="absolute bottom-0 left-[17px] top-9 w-px bg-blue-200" aria-hidden="true" /> : null}
      <span className="relative z-10 flex size-9 items-center justify-center rounded-xl bg-primary text-white" aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-balance text-sm font-semibold text-slate-900">{title}</h3>
          <span className="text-xs tabular-nums text-slate-500">{meta}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

function SummaryDatum({ label, value, tabular = false }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className={tabular ? "font-semibold tabular-nums text-slate-800" : "font-semibold text-slate-800"}>{value}</dd>
    </div>
  );
}
