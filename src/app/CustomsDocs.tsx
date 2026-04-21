import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Search, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
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
  if (status === "ok") return "bg-emerald-50 text-emerald-700";
  if (status === "warning") return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-600";
}

export function CustomsDocs() {
  const [keyword, setKeyword] = useState("");
  const [hsCode, setHsCode] = useState("9019.20.0000");
  const [uploadedCount, setUploadedCount] = useState(3);

  const filteredFields = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return extractedFields;
    return extractedFields.filter((field) => field.label.toLowerCase().includes(normalized));
  }, [keyword]);

  const warningCount = validationRows.filter((row) => row.status === "warning").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <span className="material-chip bg-blue-50 text-blue-700">Customs Workflow</span>
            <div>
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">报关单证自动处理</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                这页补齐了报关单证明细处理能力，包含字段抽取、异常校验、人工补录和模板导出。
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setUploadedCount((count) => count + 1)} className="material-button-secondary">
              <Upload className="h-4 w-4" />
              上传单证
            </button>
            <button type="button" onClick={() => toast.success("已生成 CI / PL 模板草稿")} className="material-button-primary">
              <Download className="h-4 w-4" />
              导出模板
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">已上传单证</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{uploadedCount}</div>
        </div>
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">待人工复核</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{warningCount}</div>
        </div>
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">模板状态</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">就绪</div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <div className="material-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">字段抽取结果</h3>
                <p className="mt-1 text-sm text-slate-500">支持搜索字段、人工补录和异常标记。</p>
              </div>
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="material-input pl-11" placeholder="搜索字段" />
            </div>
            <div className="space-y-3">
              {filteredFields.map((field) => (
                <div key={field.label} className="flex items-center gap-4 rounded-[22px] border border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="w-24 text-sm font-semibold text-slate-500">{field.label}</div>
                  <div className="flex-1">
                    {field.status === "missing" ? (
                      <input value={hsCode} onChange={(e) => setHsCode(e.target.value)} className="material-input" placeholder="补录 HS Code" />
                    ) : (
                      <div className="text-sm font-medium text-slate-800">{field.value}</div>
                    )}
                  </div>
                  <span className={cn("material-chip", statusTone(field.status))}>
                    {field.status === "ok" ? "正常" : field.status === "warning" ? "需复核" : "缺失"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">一致性校验</h3>
                <p className="mt-1 text-sm text-slate-500">重点关注差异项和缺失项。</p>
              </div>
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-3">
              {validationRows.map((row) => (
                <div key={row.title} className={cn("rounded-[22px] border px-4 py-4", row.status === "ok" ? "border-emerald-100 bg-emerald-50/70" : "border-amber-100 bg-amber-50/70")}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {row.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                    {row.title}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">{row.detail}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <button type="button" onClick={() => toast.success("已生成校验摘要")} className="material-button-secondary">
                <FileSpreadsheet className="h-4 w-4" />
                导出校验表
              </button>
              <button type="button" onClick={() => toast.success("已同步回报关 AI 主流程")} className="material-button-primary">
                返回主流程
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
