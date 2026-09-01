import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  FileCheck2,
  FileSearch,
  FileText,
  Files,
  ScanSearch,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { cn } from "./components/ui/utils";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

type SourceFile = {
  id: string;
  name: string;
  type: "PI" | "CI" | "PL";
  uploadedAt: string;
  status: "已上传" | "待复核";
};

type FieldComparison = {
  field: string;
  pi: string;
  ci: string;
  pl: string;
  status: "一致" | "差异";
};

type TemplateCard = {
  title: string;
  helper: string;
  fields: string[];
  status: "已生成" | "可生成";
};

const sourceFiles: SourceFile[] = [
  { id: "DOC-201", name: "OC10_PI_20260415.pdf", type: "PI", uploadedAt: "2026-04-15 09:20", status: "已上传" },
  { id: "DOC-202", name: "OC10_CI_20260415.docx", type: "CI", uploadedAt: "2026-04-15 09:21", status: "已上传" },
  { id: "DOC-203", name: "OC10_PL_20260415.xlsx", type: "PL", uploadedAt: "2026-04-15 09:22", status: "待复核" },
];

const comparisonRows: FieldComparison[] = [
  { field: "产品型号", pi: "OC-10", ci: "OC-10", pl: "OC-10", status: "一致" },
  { field: "数量", pi: "120", ci: "120", pl: "118", status: "差异" },
  { field: "毛重", pi: "-", ci: "86 KG", pl: "86 KG", status: "一致" },
  { field: "收货人", pi: "INOGI MEDICAL", ci: "INOGI MEDICAL", pl: "INOGI MEDICAL", status: "一致" },
  { field: "箱数", pi: "12", ci: "-", pl: "11", status: "差异" },
];

const templateCards: TemplateCard[] = [
  { title: "CI 模板回填", helper: "根据 PI 和识别字段自动生成可编辑商业发票草稿。", fields: ["收货人", "数量", "金额", "毛重"], status: "已生成" },
  { title: "PL 模板回填", helper: "自动回填装箱信息并提示需要人工复核的差异字段。", fields: ["箱数", "净重", "毛重", "包装说明"], status: "可生成" },
];

const processLogs = [
  { time: "09:22", title: "PI / CI / PL 文件解析完成", helper: "AI 已抽取关键字段并生成第一轮比对结果" },
  { time: "10:05", title: "发现数量与箱数差异", helper: "建议回查装箱单最新版本和仓库出运记录" },
  { time: "11:40", title: "CI 模板草稿已生成", helper: "PL 模板等待人工确认差异字段后回填" },
];

function statusTone(status: SourceFile["status"] | FieldComparison["status"] | TemplateCard["status"]) {
  if (status === "已上传" || status === "一致" || status === "已生成") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "待复核" || status === "差异") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-blue-100 bg-blue-50 text-[#002fa7]";
}

export function CustomsAI() {
  const [uploadedCount, setUploadedCount] = useState(sourceFiles.length);
  const [activeDoc, setActiveDoc] = useState<SourceFile["type"]>("PI");
  const [comparisonPage, setComparisonPage] = useState(1);
  const [previewFile, setPreviewFile] = useState<SourceFile | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateCard | null>(null);

  const mismatchCount = useMemo(() => comparisonRows.filter((item) => item.status === "差异").length, []);
  const activeFiles = useMemo(() => sourceFiles.filter((item) => item.type === activeDoc), [activeDoc]);
  const comparisonPageSize = 3;
  const comparisonTotalPages = Math.max(1, Math.ceil(comparisonRows.length / comparisonPageSize));
  const pagedComparisonRows = comparisonRows.slice((comparisonPage - 1) * comparisonPageSize, comparisonPage * comparisonPageSize);

  const uploadDemo = () => {
    setUploadedCount((count) => count + 1);
    toast.success(`已向 ${activeDoc} 分类追加一份演示文件`);
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={ScanSearch}
        eyebrow="报关管理 · AI 工作台"
        title="报关单证 AI"
        description="沿着上传识别、差异复核和模板回填的流程完成报关资料处理。"
        meta={<><span>当前批次 EXP-2026-0415</span><span aria-hidden="true">·</span><span>最后处理于 11:40</span></>}
        actions={
          <>
            <Button asChild variant="outline"><Link to={routePath("page:customs-docs", "/customs-docs")}>单证处理详情<ArrowRight className="size-4" /></Link></Button>
            <Button asChild variant="outline"><Link to={routePath("page:external-docs", "/external-docs")}>对外资料版本<ArrowRight className="size-4" /></Link></Button>
            <Button asChild className="hz-primary-action"><Link to={routePath("page:registration-projects", "/registration-projects")}>注册项目看板<ArrowRight className="size-4" /></Link></Button>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Files} label="已上传单证" value={uploadedCount} note="支持 PDF、Word、Excel" tone="brand" />
        <HorizonMetric Icon={AlertTriangle} label="差异字段" value={mismatchCount} note="数量与箱数待复核" tone="warning" />
        <HorizonMetric Icon={FileCheck2} label="已生成模板" value="1/2" note="CI 已生成，PL 待确认" tone="success" />
        <HorizonMetric Icon={Clock3} label="处理阶段" value="人工复核" note="完成后即可导出归档" tone="neutral" />
      </HorizonMetricGrid>

      <section className="hz-surface min-w-0 overflow-hidden">
        <HorizonSectionHeader Icon={Clock3} title="处理轨迹" description="当前批次的识别、复核与模板处理记录。" />
        <ol className="grid divide-y divide-slate-100 px-4 lg:grid-cols-3 lg:divide-x lg:divide-y-0 lg:px-0">
          {processLogs.map((item, index) => (
            <li key={item.time} className="flex min-w-0 gap-3 py-3 lg:px-4">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums", index === processLogs.length - 1 ? "bg-[#002fa7] text-white" : "bg-[#eef3ff] text-[#002fa7]")} aria-hidden="true">{index + 1}</span>
              <div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-slate-800">{item.title}</h3><time className="text-xs text-slate-500 tabular-nums">{item.time}</time></div><p className="mt-1 text-xs text-pretty leading-5 text-slate-600">{item.helper}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={Upload} title="单证文件" description="按 PI、CI、PL 分类查看。" trailing={<span className="text-xs text-slate-500 tabular-nums">{activeFiles.length} 个文件</span>} />
          <div className="hz-toolbar flex flex-wrap gap-2 border-b px-4 py-3" role="tablist" aria-label="单证类型">
            {(["PI", "CI", "PL"] as const).map((type) => (
              <Button key={type} type="button" size="sm" variant={activeDoc === type ? "default" : "ghost"} role="tab" aria-selected={activeDoc === type} className={cn(activeDoc === type && "bg-[#002fa7] hover:bg-[#002581]")} onClick={() => { setActiveDoc(type); setComparisonPage(1); }}>{type}</Button>
            ))}
          </div>
          <div className="border-b border-slate-100 p-4">
            <Button type="button" variant="outline" className="h-auto w-full justify-start whitespace-normal rounded-xl border-dashed px-3 py-3 text-left" onClick={uploadDemo}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#eef3ff] text-[#002fa7]" aria-hidden="true"><Upload className="size-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">上传 {activeDoc} 文件</span><span className="mt-0.5 block text-xs text-pretty text-slate-500">追加一份演示单证并进入识别队列</span></span>
            </Button>
          </div>
          {activeFiles.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {activeFiles.map((item) => (
                <button key={item.id} type="button" onClick={() => setPreviewFile(item)} className="w-full min-w-0 px-4 py-3 text-left transition-colors hover:bg-[#f7f9ff]">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-800" title={item.name}>{item.name}</div><time className="mt-1 block text-xs text-slate-500 tabular-nums">{item.uploadedAt}</time></div><span className={cn("shrink-0 rounded-full border px-2 py-1 text-xs font-semibold", statusTone(item.status))}>{item.status}</span></div>
                </button>
              ))}
            </div>
          ) : (
            <HorizonEmptyState Icon={FileText} title={`尚未上传 ${activeDoc} 文件`} description="上传文件后将自动进入字段识别。" action={<Button type="button" variant="outline" onClick={uploadDemo}>上传文件</Button>} />
          )}
        </section>

        <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader Icon={ScanSearch} title="字段抽取与比对" description="跨 PI、CI、PL 核对关键报关字段。" trailing={<span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 tabular-nums">{mismatchCount} 项差异</span>} />
            <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-3 text-xs text-pretty text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>当前差异集中在数量和箱数，请回查装箱单最新版及仓库发运记录。</p></div>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="bg-slate-50/80"><tr>{["字段", "PI", "CI", "PL", "状态"].map((column) => <th key={column} scope="col" className="px-4 py-3 text-xs font-semibold text-slate-500">{column}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{pagedComparisonRows.map((item) => <tr key={item.field} className="hover:bg-[#f7f9ff]"><td className="px-4 py-3 text-sm font-semibold text-slate-800">{item.field}</td><td className="px-4 py-3 text-sm text-slate-600 tabular-nums">{item.pi}</td><td className="px-4 py-3 text-sm text-slate-600 tabular-nums">{item.ci}</td><td className="px-4 py-3 text-sm text-slate-600 tabular-nums">{item.pl}</td><td className="px-4 py-3"><span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(item.status))}>{item.status}</span></td></tr>)}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3"><span className="text-xs text-slate-500 tabular-nums">第 {comparisonPage} / {comparisonTotalPages} 页</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setComparisonPage((current) => Math.max(1, current - 1))} disabled={comparisonPage === 1}>上一页</Button><Button type="button" variant="outline" size="sm" onClick={() => setComparisonPage((current) => Math.min(comparisonTotalPages, current + 1))} disabled={comparisonPage === comparisonTotalPages}>下一页</Button></div></div>
          </section>

          <section className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader Icon={WandSparkles} title="模板回填" description="确认差异后生成可编辑草稿。" />
            <div className="divide-y divide-slate-100">
              {templateCards.map((item) => (
                <button key={item.title} type="button" onClick={() => setPreviewTemplate(item)} className="w-full min-w-0 px-4 py-3 text-left transition-colors hover:bg-[#f7f9ff]">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-balance text-sm font-semibold text-slate-800">{item.title}</h3><p className="mt-1 text-xs text-pretty leading-5 text-slate-600">{item.helper}</p></div><span className={cn("shrink-0 rounded-full border px-2 py-1 text-xs font-semibold", statusTone(item.status))}>{item.status}</span></div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{item.fields.map((field) => <span key={field} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{field}</span>)}</div>
                </button>
              ))}
            </div>
            <div className="flex items-start gap-2 border-t border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-pretty text-blue-900"><WandSparkles className="mt-0.5 size-4 shrink-0 text-[#002fa7]" aria-hidden="true" /><p>下一步：完成差异复核，导出模板并同步到对外资料归档。</p></div>
          </section>
        </div>
      </div>

      <section className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={FileSearch} title="提取摘要" description="AI 已识别的核心报关信息。" />
          <dl className="grid gap-px bg-slate-100 sm:grid-cols-2">{[["收货人", "INOGI MEDICAL"], ["发货港", "Shanghai"], ["贸易方式", "General Trade"], ["预计出运", "2026-04-18"]].map(([label, value]) => <div key={label} className="min-w-0 bg-white px-4 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-800 tabular-nums" title={value}>{value}</dd></div>)}</dl>
        </div>
        <div className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader Icon={FileText} title="流程去向" description="将确认后的模板送入后续业务模块。" />
          <div className="divide-y divide-slate-100">
            {[{ title: "同步到对外资料版本", detail: "将最终模板和说明归档到版本管理中心。", to: routePath("page:external-docs", "/external-docs") }, { title: "同步到注册项目里程碑", detail: "把需要注册配合的单证事项挂到项目看板。", to: routePath("page:registration-projects", "/registration-projects") }].map((item) => <Link key={item.title} to={item.to} className="flex min-w-0 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[#f7f9ff]"><div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{item.title}</div><p className="mt-1 text-xs text-pretty text-slate-600">{item.detail}</p></div><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#eef3ff] text-[#002fa7]" aria-hidden="true"><ArrowRight className="size-4" /></span></Link>)}
          </div>
        </div>
      </section>

      <Dialog open={Boolean(previewFile)} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="horizon-portal sm:max-w-xl">
          <DialogHeader><DialogTitle className="text-balance text-slate-900">文件预览</DialogTitle><DialogDescription className="text-pretty">核对文件类型、上传时间和识别状态。</DialogDescription></DialogHeader>
          {previewFile ? <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200"><DialogInfo label="文件名" value={previewFile.name} /><DialogInfo label="单证类型" value={previewFile.type} /><DialogInfo label="上传时间" value={previewFile.uploadedAt} /><div className="grid gap-1 px-4 py-3 sm:grid-cols-[100px_minmax(0,1fr)]"><dt className="text-xs text-slate-500">识别状态</dt><dd><span className={cn("inline-flex rounded-full border px-2 py-1 text-xs font-semibold", statusTone(previewFile.status))}>{previewFile.status}</span></dd></div></dl> : null}
          <p className="text-sm text-pretty leading-6 text-slate-600">建议继续核对字段抽取结果，并确认该文件是否为最新外发版本。</p>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPreviewFile(null)}>关闭</Button><Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={() => { setPreviewFile(null); toast.success("文件已进入人工复核队列"); }}><FileCheck2 className="size-4" />进入复核</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="horizon-portal sm:max-w-xl">
          <DialogHeader><DialogTitle className="text-balance text-slate-900">{previewTemplate?.title ?? "模板详情"}</DialogTitle><DialogDescription className="text-pretty">查看回填字段与当前生成状态。</DialogDescription></DialogHeader>
          {previewTemplate ? <div className="space-y-4"><p className="text-sm text-pretty leading-6 text-slate-600">{previewTemplate.helper}</p><div><div className="text-sm font-semibold text-slate-800">回填字段</div><div className="mt-2 flex flex-wrap gap-2">{previewTemplate.fields.map((field) => <span key={field} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{field}</span>)}</div></div><div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3"><span className="text-sm text-slate-500">模板状态</span><span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(previewTemplate.status))}>{previewTemplate.status}</span></div></div> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPreviewTemplate(null)}>关闭</Button><Button type="button" className="bg-[#002fa7] hover:bg-[#002581]" onClick={() => { const action = previewTemplate?.status === "已生成" ? "模板草稿已打开" : "模板草稿已生成"; setPreviewTemplate(null); toast.success(action); }}><WandSparkles className="size-4" />{previewTemplate?.status === "已生成" ? "打开草稿" : "生成草稿"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DialogInfo({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 px-4 py-3 sm:grid-cols-[100px_minmax(0,1fr)]"><dt className="text-xs text-slate-500">{label}</dt><dd className="break-words text-sm font-medium text-slate-800 tabular-nums">{value}</dd></div>;
}
