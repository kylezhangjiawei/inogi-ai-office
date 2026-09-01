import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Files,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { cn } from "./components/ui/utils";

type FieldStatus = "ok" | "warning" | "missing";

type DocField = {
  label: string;
  value: string;
  status: FieldStatus;
};

const extractedFields: DocField[] = [
  { label: "收货人", value: "Medline International Inc.", status: "ok" },
  { label: "收货地址", value: "1 Medline Place, Mundelein, IL 60060, USA", status: "ok" },
  { label: "产品型号", value: "OC-5 x 20 / OC-10 x 10", status: "ok" },
  { label: "数量", value: "30 台", status: "ok" },
  { label: "箱数", value: "15 箱", status: "ok" },
  { label: "贸易条款", value: "FOB Shanghai", status: "ok" },
  { label: "发票金额", value: "USD 45,000.00", status: "warning" },
  { label: "HS Code", value: "", status: "missing" },
];

const validationRows = [
  { title: "收货人与地址一致", detail: "PI、CI、PL 与订单信息一致。", status: "ok" as const },
  { title: "产品型号一致", detail: "各单证均识别为 OC-5 / OC-10 组合发货。", status: "ok" as const },
  { title: "金额存在差异", detail: "PL 金额与 PI 存在 USD 150 差异，建议与财务复核。", status: "warning" as const },
  { title: "HS Code 缺失", detail: "需要人工补录后再导出正式模板。", status: "warning" as const },
];

function statusTone(status: FieldStatus) {
  if (status === "ok") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "warning") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-red-100 bg-red-50 text-red-700";
}

export function CustomsDocs() {
  const [keyword, setKeyword] = useState("");
  const [hsCode, setHsCode] = useState("9019.20.0000");
  const [hsError, setHsError] = useState("");
  const [uploadedCount, setUploadedCount] = useState(3);

  const filteredFields = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return extractedFields;
    return extractedFields.filter((field) => field.label.toLowerCase().includes(normalized));
  }, [keyword]);

  const warningCount = validationRows.filter((row) => row.status === "warning").length;
  const recognizedCount = extractedFields.filter((field) => field.status !== "missing").length;

  const exportTemplate = () => {
    if (!hsCode.trim()) {
      setHsError("请补录 HS Code 后再导出模板");
      return;
    }
    setHsError("");
    toast.success("已生成 CI / PL 模板草稿");
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Files}
        eyebrow="报关管理 · 单证处理"
        title="报关单证自动处理"
        description="集中完成字段抽取、异常校验、人工补录与 CI / PL 模板导出。"
        meta={<><span>当前批次 EXP-2026-0415</span><span aria-hidden="true">·</span><span>最近识别于 11:40</span></>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => { setUploadedCount((count) => count + 1); toast.success("已追加一份演示单证"); }}><Upload className="size-4" />上传单证</Button>
            <Button type="button" className="hz-primary-action" onClick={exportTemplate}><Download className="size-4" />导出模板</Button>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Files} label="已上传单证" value={uploadedCount} note="PI、CI 与 PL 文件" tone="brand" />
        <HorizonMetric Icon={FileCheck2} label="已识别字段" value={`${recognizedCount}/${extractedFields.length}`} note="1 项需要人工补录" tone="success" />
        <HorizonMetric Icon={AlertTriangle} label="待人工复核" value={warningCount} note="金额差异与编码缺失" tone="warning" />
        <HorizonMetric Icon={ShieldCheck} label="模板状态" value="就绪" note="补录后可正式导出" tone="neutral" />
      </HorizonMetricGrid>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={FileSpreadsheet}
            title="字段抽取与人工补录"
            description="核对识别字段，并补齐导出模板需要的信息。"
            trailing={<span className="text-xs text-slate-500 tabular-nums">显示 {filteredFields.length} / {extractedFields.length}</span>}
          />
          <div className="hz-toolbar border-b px-4 py-3">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                type="search"
                aria-label="搜索单证字段"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                className="h-10 rounded-xl bg-white pl-9"
                placeholder="搜索字段名称"
              />
            </div>
          </div>

          {filteredFields.length > 0 ? (
            <dl className="divide-y divide-slate-100">
              {filteredFields.map((field) => (
                <div key={field.label} className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[110px_minmax(0,1fr)_76px] sm:items-center sm:gap-4">
                  <dt className="text-sm font-medium text-slate-500">{field.label}</dt>
                  <dd className="min-w-0">
                    {field.status === "missing" ? (
                      <div className="space-y-2">
                        <Label htmlFor="customs-hs-code" className="sr-only">HS Code</Label>
                        <Input
                          id="customs-hs-code"
                          value={hsCode}
                          onChange={(event) => { setHsCode(event.target.value); if (hsError) setHsError(""); }}
                          aria-invalid={Boolean(hsError)}
                          className="h-10 rounded-xl font-mono tabular-nums"
                          placeholder="补录 HS Code"
                        />
                        {hsError ? <p className="flex items-center gap-1.5 text-xs text-red-600" role="alert"><AlertTriangle className="size-3.5" aria-hidden="true" />{hsError}</p> : null}
                      </div>
                    ) : (
                      <div className="break-words text-sm font-medium text-slate-800 tabular-nums">{field.value}</div>
                    )}
                  </dd>
                  <dd className="sm:text-right"><span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(field.status))}>{field.status === "ok" ? "正常" : field.status === "warning" ? "需复核" : "待补录"}</span></dd>
                </div>
              ))}
            </dl>
          ) : (
            <HorizonEmptyState Icon={Search} title="没有匹配字段" description="请更换搜索词或清空搜索条件。" action={<Button type="button" variant="outline" onClick={() => setKeyword("")}>清空搜索</Button>} />
          )}
        </section>

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={ShieldCheck} title="一致性校验" description="优先处理差异与缺失项。" />
          <div className="divide-y divide-slate-100 px-4">
            {validationRows.map((row) => (
              <div key={row.title} className="flex items-start gap-3 py-3">
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", row.status === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")} aria-hidden="true">
                  {row.status === "ok" ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
                </span>
                <div className="min-w-0"><h3 className="text-balance text-sm font-semibold text-slate-800">{row.title}</h3><p className="mt-1 text-xs text-pretty leading-5 text-slate-600">{row.detail}</p></div>
              </div>
            ))}
          </div>
          <div className="grid gap-2 border-t border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Button type="button" variant="outline" onClick={() => toast.success("已生成校验摘要")}><FileSpreadsheet className="size-4" />导出校验表</Button>
            <Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={() => toast.success("已同步回报关 AI 主流程")}><FileCheck2 className="size-4" />返回主流程</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
