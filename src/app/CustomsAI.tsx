import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSearch,
  FileText,
  Package,
  ScanSearch,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "./components/ui/utils";

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
  {
    title: "CI 模板回填",
    helper: "根据 PI 和识别字段自动生成可编辑商业发票草稿。",
    fields: ["收货人", "数量", "金额", "毛重"],
    status: "已生成",
  },
  {
    title: "PL 模板回填",
    helper: "自动回填装箱信息并提示需要人工复核的差异字段。",
    fields: ["箱数", "净重", "毛重", "包装说明"],
    status: "可生成",
  },
];

const processLogs = [
  { time: "09:22", title: "PI / CI / PL 文件已完成解析", helper: "AI 已抽取关键字段并生成第一轮比对结果" },
  { time: "10:05", title: "发现数量与箱数存在差异", helper: "建议回查装箱单最新版本和仓库出运记录" },
  { time: "11:40", title: "CI 模板已生成草稿", helper: "PL 模板等待人工确认差异字段后回填" },
];

function statusTone(status: SourceFile["status"] | FieldComparison["status"] | TemplateCard["status"]) {
  if (status === "已上传" || status === "一致" || status === "已生成") return "bg-emerald-50 text-emerald-700";
  if (status === "待复核" || status === "差异") return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-blue-700";
}

export function CustomsAI() {
  const [uploadedCount, setUploadedCount] = useState(sourceFiles.length);
  const [activeDoc, setActiveDoc] = useState<SourceFile["type"]>("PI");
  const [comparisonPage, setComparisonPage] = useState(1);
  const [previewFile, setPreviewFile] = useState<SourceFile | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateCard | null>(null);

  const mismatchCount = useMemo(
    () => comparisonRows.filter((item) => item.status === "差异").length,
    [],
  );

  const activeFiles = useMemo(
    () => sourceFiles.filter((item) => item.type === activeDoc),
    [activeDoc],
  );
  const comparisonPageSize = 3;
  const comparisonTotalPages = Math.max(1, Math.ceil(comparisonRows.length / comparisonPageSize));
  const pagedComparisonRows = comparisonRows.slice((comparisonPage - 1) * comparisonPageSize, comparisonPage * comparisonPageSize);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <span className="material-chip bg-blue-50 text-blue-700">Customs AI</span>
            <div>
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">报关单证 AI</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                这一页已经升级成独立流程页，覆盖单证上传、字段抽取、一致性比对和模板回填，让报关资料可以顺着流程继续流转到对外资料与注册项目模块。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/customs-docs" className="material-button-secondary">
              去单证处理详情
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/external-docs" className="material-button-secondary">
              去对外资料版本
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/registration-projects" className="material-button-secondary">
              去注册项目看板
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">已上传单证</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{uploadedCount}</div>
          <div className="mt-2 text-sm text-slate-500">支持 PDF、Word、Excel 的假数据上传演示</div>
        </div>
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">差异字段</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{mismatchCount}</div>
          <div className="mt-2 text-sm text-slate-500">需要人工复核后再回填到报关模板</div>
        </div>
        <div className="material-card-flat p-5">
          <div className="text-sm font-medium text-slate-500">模板状态</div>
          <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">2</div>
          <div className="mt-2 text-sm text-slate-500">CI 已生成，PL 可继续一键生成草稿</div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8">
          <div className="material-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">处理日志</h3>
                <p className="mt-1 text-sm text-slate-500">把 AI 处理流程拆成时间线，页面会更像真实工作流。</p>
              </div>
              <span className="material-chip bg-slate-100 text-slate-600">Workflow Trace</span>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              {processLogs.map((item) => (
                <div key={item.time} className="material-panel">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <span className="material-chip bg-white text-slate-500">{item.time}</span>
                  </div>
                  <div className="mt-3 text-sm text-slate-600">{item.helper}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="material-card p-6">
            <h3 className="text-slate-900">动作清单</h3>
            <div className="mt-4 space-y-3">
              {[
                "先确认差异字段，再导出正式 CI / PL。",
                "若字段与注册资料有关，可同步注册项目模块追加事项。",
                "若涉及对外文档版本变化，建议同步到对外资料版本页归档。",
              ].map((item) => (
                <div key={item} className="material-panel text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-4">
          <div className="material-card h-full space-y-5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">单证上传区</h3>
                <p className="mt-1 text-sm text-slate-500">切换 PI、CI、PL 查看已上传文件与状态。</p>
              </div>
              <Upload className="h-5 w-5 text-primary" />
            </div>

            <div className="flex flex-wrap gap-2">
              {(["PI", "CI", "PL"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setActiveDoc(type);
                    setComparisonPage(1);
                  }}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-medium transition",
                    activeDoc === type ? "bg-blue-600 text-white shadow-[0_10px_24px_rgba(25,118,210,0.28)]" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-primary">
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">模拟上传</div>
                    <div className="text-sm text-slate-500">点击后向当前分类追加一份演示文件。</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="material-button-secondary"
                  onClick={() => setUploadedCount((count) => count + 1)}
                >
                  <Upload className="h-4 w-4" />
                  上传文件
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {activeFiles.map((item) => (
                <button key={item.id} type="button" onClick={() => setPreviewFile(item)} className="w-full rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 text-left transition hover:border-blue-200">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.uploadedAt}</div>
                    </div>
                    <span className={cn("material-chip", statusTone(item.status))}>{item.status}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <div className="material-card h-full space-y-5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">字段抽取与比对</h3>
                <p className="mt-1 text-sm text-slate-500">自动抽取 PI、CI、PL 关键字段并标记不一致项。</p>
              </div>
              <ScanSearch className="h-5 w-5 text-primary" />
            </div>

            {mismatchCount ? (
              <div className="rounded-[20px] border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-700">
                当前发现 {mismatchCount} 个差异字段，建议人工复核后再导出正式报关单证。
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50">
                  <tr>
                    {["字段", "PI", "CI", "PL", "状态"].map((column) => (
                      <th key={column} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedComparisonRows.map((item) => (
                    <tr key={item.field} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{item.field}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{item.pi}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{item.ci}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{item.pl}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={cn("material-chip", statusTone(item.status))}>{item.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <div className="text-sm text-slate-500">
                第 {comparisonPage}/{comparisonTotalPages} 页
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setComparisonPage((current) => Math.max(1, current - 1))}
                  disabled={comparisonPage === 1}
                  className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setComparisonPage((current) => Math.min(comparisonTotalPages, current + 1))}
                  disabled={comparisonPage === comparisonTotalPages}
                  className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                AI 复核提示
              </div>
              <div className="text-sm leading-6 text-slate-500">
                当前主要差异集中在数量和箱数，建议优先回查装箱单最新版以及仓库发运记录。
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-3">
          <div className="material-card h-full space-y-4 p-6">
            <div>
              <h3 className="text-slate-900">模板回填</h3>
              <p className="mt-1 text-sm text-slate-500">把抽取结果直接回填进可编辑报关模板。</p>
            </div>

            {templateCards.map((item) => (
              <button key={item.title} type="button" onClick={() => setPreviewTemplate(item)} className="w-full rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 text-left transition hover:border-blue-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-500">{item.helper}</div>
                  </div>
                  <span className={cn("material-chip", statusTone(item.status))}>{item.status}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.fields.map((field) => (
                    <span key={field} className="material-chip bg-white text-slate-600">
                      {field}
                    </span>
                  ))}
                </div>
              </button>
            ))}

            <div className="rounded-[22px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-primary">
                  <WandSparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-800">下一步建议</div>
                  <div className="text-sm text-slate-500">复核差异后导出模板，并同步给对外资料模块归档版本。</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-6">
          <div className="material-card h-full p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">提取摘要</h3>
                <p className="mt-1 text-sm text-slate-500">概览 AI 已经识别出来的核心报关信息。</p>
              </div>
              <FileSearch className="h-5 w-5 text-primary" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {[
                ["收货人", "INOGI MEDICAL"],
                ["发货港", "Shanghai"],
                ["贸易方式", "General Trade"],
                ["预计出运", "2026-04-18"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[20px] border border-slate-100 bg-slate-50/70 p-4">
                  <div className="text-sm text-slate-500">{label}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-800">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-6">
          <div className="material-card h-full p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">流程去向</h3>
                <p className="mt-1 text-sm text-slate-500">让单证处理结果可以继续进入后续模块。</p>
              </div>
              <FileText className="h-5 w-5 text-primary" />
            </div>

            <div className="space-y-3">
              {[
                { title: "同步到对外资料版本", detail: "将最终模板和说明归档到版本管理中心。", to: "/external-docs" },
                { title: "同步到注册项目里程碑", detail: "把需要注册配合的单证事项挂到项目看板。", to: "/registration-projects" },
              ].map((item) => (
                <Link key={item.title} to={item.to} className="flex items-center justify-between rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 transition hover:-translate-y-0.5">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-primary">
                    <ArrowRight className="h-5 w-5" />
                  </div>
                </Link>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-700">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                演示流程可走通
              </div>
              <div>当前页面上的跳转按钮都已接入现有路由，可以继续串联整个业务流程。</div>
            </div>
          </div>
        </div>
      </section>

      {previewFile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">文件预览</h3>
                <p className="mt-1 text-sm text-slate-500">点击上传列表后显示的详情弹窗。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setPreviewFile(null)}>
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">File</div>
                <div className="mt-2 text-base font-semibold text-slate-900">{previewFile.name}</div>
                <div className="mt-2 text-sm text-slate-600">类型：{previewFile.type}</div>
                <div className="mt-1 text-sm text-slate-600">上传时间：{previewFile.uploadedAt}</div>
              </div>
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Status</div>
                <div className="mt-2">
                  <span className={cn("material-chip", statusTone(previewFile.status))}>{previewFile.status}</span>
                </div>
                <div className="mt-3 text-sm leading-6 text-slate-600">建议继续核对字段抽取结果，并确认该文件是否为最新外发版本。</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewTemplate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">模板详情</h3>
                <p className="mt-1 text-sm text-slate-500">模板卡片现在可以点击查看字段与动作说明。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setPreviewTemplate(null)}>
                关闭
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div className="material-panel">
                <div className="text-base font-semibold text-slate-900">{previewTemplate.title}</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">{previewTemplate.helper}</div>
              </div>
              <div className="material-panel">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Fields</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {previewTemplate.fields.map((field) => (
                    <span key={field} className="material-chip bg-white text-slate-600">
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
