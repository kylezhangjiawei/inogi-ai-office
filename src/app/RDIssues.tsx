import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Cpu,
  Factory,
  FileSearch,
  History,
  Inbox,
  ListFilter,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";

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
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

type IssueCategory = "hardware" | "software" | "production" | "configuration";
type QueueFilter = "all" | "urgent" | "normal" | "return";
type QueueLane = Exclude<QueueFilter, "all">;

type QueueCard = {
  id: string;
  title: string;
  submitter: string;
  category: string;
  submittedAt: string;
  lane: QueueLane;
};

const categoryOptions: Array<{
  id: IssueCategory;
  label: string;
  helper: string;
  icon: LucideIcon;
  color: string;
}> = [
  { id: "hardware", label: "硬件", helper: "电路 / 结构 / 物料", icon: Cpu, color: "border-blue-100 bg-blue-50 text-blue-700" },
  { id: "software", label: "软件", helper: "固件 / 通讯 / App", icon: Code2, color: "border-cyan-100 bg-cyan-50 text-cyan-700" },
  { id: "production", label: "生产", helper: "工艺 / 制程 / 设备", icon: Factory, color: "border-amber-100 bg-amber-50 text-amber-700" },
  { id: "configuration", label: "配置", helper: "参数 / 模板 / 环境", icon: FileSearch, color: "border-emerald-100 bg-emerald-50 text-emerald-700" },
];

const historicalMatches = [
  {
    id: "RD-2026-018",
    title: "OC-10 启动后串口握手失败",
    summary: "升级至 FW-1.4.3 后恢复稳定，建议同时校准主板串口参数。",
    confidence: "92%",
  },
  {
    id: "RD-2026-011",
    title: "主板传感器初始化延迟",
    summary: "替换 BOM V3.1 中的传感器批次并更新配置模板后解决。",
    confidence: "81%",
  },
];

const urgentQueue: QueueCard[] = [
  { id: "TRI-301", title: "OC-10 开机异常重启", submitter: "王工", category: "硬件", submittedAt: "今天 10:30", lane: "urgent" },
  { id: "TRI-298", title: "制氧模块压力波动", submitter: "陈工", category: "生产", submittedAt: "今天 09:15", lane: "urgent" },
];

const normalQueue: QueueCard[] = [
  { id: "TRI-289", title: "参数模板版本不一致", submitter: "李静", category: "配置", submittedAt: "昨天 16:10", lane: "normal" },
  { id: "TRI-284", title: "日志上传失败", submitter: "张越", category: "软件", submittedAt: "昨天 14:25", lane: "normal" },
];

const returnQueue: QueueCard[] = [
  { id: "TRI-277", title: "售后资料未齐全", submitter: "客服组", category: "待退回", submittedAt: "昨天 11:20", lane: "return" },
];

const allQueue = [...urgentQueue, ...normalQueue, ...returnQueue];

const queueLabels: Record<QueueFilter, string> = {
  all: "全部",
  urgent: "紧急",
  normal: "普通",
  return: "待退回",
};

const laneStyles: Record<QueueLane, string> = {
  urgent: "border-red-100 bg-red-50 text-red-700",
  normal: "border-blue-100 bg-blue-50 text-blue-700",
  return: "border-slate-200 bg-slate-100 text-slate-600",
};

export function RDIssues() {
  const [form, setForm] = useState({
    productModel: "",
    version: "",
    bomVersion: "",
    firmwareVersion: "",
    description: "",
    attachments: 0,
  });
  const [submitted, setSubmitted] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [urgency, setUrgency] = useState<"紧急" | "普通">("普通");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [queuePage, setQueuePage] = useState(1);
  const [selectedQueueItem, setSelectedQueueItem] = useState<QueueCard | null>(null);

  const fieldErrors = useMemo(
    () => ({
      productModel: form.productModel ? "" : "请输入产品型号。",
      version: form.version ? "" : "请输入产品版本号。",
      bomVersion: form.bomVersion ? "" : "请输入 BOM 版本。",
      firmwareVersion: form.firmwareVersion ? "" : "请输入固件版本。",
      description: form.description.trim().length >= 24 ? "" : "问题描述至少需要 24 个字。",
    }),
    [form],
  );

  const isValid = useMemo(() => Object.values(fieldErrors).every((error) => !error), [fieldErrors]);

  const detectedCategory = useMemo<IssueCategory>(() => {
    const text = form.description.toLowerCase();
    if (text.includes("串口") || text.includes("固件") || text.includes("日志")) return "software";
    if (text.includes("压力") || text.includes("主板") || text.includes("传感器")) return "hardware";
    if (text.includes("工艺") || text.includes("产线") || text.includes("制程")) return "production";
    return "configuration";
  }, [form.description]);

  const confidence = useMemo(() => {
    if (!form.description) return "0%";
    if (form.description.length > 60) return "91%";
    if (form.description.length > 30) return "84%";
    return "72%";
  }, [form.description]);

  const selectedCategory = categoryOptions.find((item) => item.id === detectedCategory)!;
  const queueSummary = useMemo(
    () => (queueFilter === "all" ? allQueue : allQueue.filter((item) => item.lane === queueFilter)),
    [queueFilter],
  );
  const queuePageSize = 2;
  const queueTotalPages = Math.max(1, Math.ceil(queueSummary.length / queuePageSize));
  const pagedQueueSummary = queueSummary.slice((queuePage - 1) * queuePageSize, queuePage * queuePageSize);

  function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setShowValidation(true);
    if (!isValid) return;
    setIsGenerating(true);
    window.setTimeout(() => {
      setIsGenerating(false);
      setSubmitted(true);
      setShowValidation(false);
      setUrgency(detectedCategory === "hardware" || detectedCategory === "production" ? "紧急" : "普通");
    }, 900);
  }

  function selectFilter(filter: QueueFilter) {
    setQueueFilter(filter);
    setQueuePage(1);
    setSelectedQueueItem(null);
  }

  function changeQueuePage(page: number) {
    setQueuePage(page);
    setSelectedQueueItem(null);
  }

  return (
    <div className="horizon-theme hz-page min-w-0 space-y-3 px-3 py-3 sm:px-4 lg:px-5">
      <HorizonPageHeader
        Icon={ListFilter}
        eyebrow="研发执行中心 / ISSUE TRIAGE"
        title="研发问题分流"
        description="集中录入问题上下文，由 AI 辅助识别归属、匹配历史方案，并将待办分流到对应处理队列。"
        meta={
          <>
            <span>今日更新 10:30</span>
            <span aria-hidden="true">·</span>
            <span>队列规则已启用</span>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={routePath("page:after-sales", "/after-sales")}>
                售后 Case
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild className="hz-primary-action">
              <Link to={routePath("page:ra-knowledge", "/ra-knowledge")}>
                法规知识库
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Inbox} label="待分流问题" value={allQueue.length} note="当前全部队列" tone="brand" />
        <HorizonMetric Icon={AlertTriangle} label="紧急队列" value={urgentQueue.length} note="建议 30 分钟内受理" tone="danger" />
        <HorizonMetric Icon={Clock3} label="普通队列" value={normalQueue.length} note="建议 4 小时内分类" tone="warning" />
        <HorizonMetric Icon={RotateCcw} label="待补充材料" value={returnQueue.length} note="当天完成补件" tone="neutral" />
      </HorizonMetricGrid>

      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(20rem,.92fr)]">
        <form className="hz-surface min-w-0 overflow-hidden" onSubmit={handleSubmit} noValidate>
          <HorizonSectionHeader
            Icon={Send}
            title="问题录入"
            description="完整的版本与复现信息有助于提高自动分类准确率。"
            trailing={
              <span
                className={cn(
                  "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
                  isValid ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700",
                )}
              >
                {isValid ? "信息完整" : "待完善"}
              </span>
            }
          />

          <div className="space-y-5 p-4 sm:p-5">
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <FormField id="issue-product-model" label="产品型号" error={showValidation ? fieldErrors.productModel : ""}>
                <Input
                  id="issue-product-model"
                  value={form.productModel}
                  onChange={(event) => updateForm("productModel", event.target.value)}
                  placeholder="例如：OC-10"
                  aria-invalid={showValidation && Boolean(fieldErrors.productModel)}
                  aria-describedby={showValidation && fieldErrors.productModel ? "issue-product-model-error" : undefined}
                />
              </FormField>
              <FormField id="issue-version" label="版本号" error={showValidation ? fieldErrors.version : ""}>
                <Input
                  id="issue-version"
                  value={form.version}
                  onChange={(event) => updateForm("version", event.target.value)}
                  placeholder="例如：V2.3.1"
                  aria-invalid={showValidation && Boolean(fieldErrors.version)}
                  aria-describedby={showValidation && fieldErrors.version ? "issue-version-error" : undefined}
                />
              </FormField>
              <FormField id="issue-bom-version" label="BOM 版本" error={showValidation ? fieldErrors.bomVersion : ""}>
                <Input
                  id="issue-bom-version"
                  value={form.bomVersion}
                  onChange={(event) => updateForm("bomVersion", event.target.value)}
                  placeholder="例如：BOM-3.2"
                  aria-invalid={showValidation && Boolean(fieldErrors.bomVersion)}
                  aria-describedby={showValidation && fieldErrors.bomVersion ? "issue-bom-version-error" : undefined}
                />
              </FormField>
              <FormField id="issue-firmware-version" label="固件版本" error={showValidation ? fieldErrors.firmwareVersion : ""}>
                <Input
                  id="issue-firmware-version"
                  value={form.firmwareVersion}
                  onChange={(event) => updateForm("firmwareVersion", event.target.value)}
                  placeholder="例如：FW-1.4.3"
                  aria-invalid={showValidation && Boolean(fieldErrors.firmwareVersion)}
                  aria-describedby={showValidation && fieldErrors.firmwareVersion ? "issue-firmware-version-error" : undefined}
                />
              </FormField>
            </div>

            <FormField id="issue-description" label="问题描述" error={showValidation ? fieldErrors.description : ""}>
              <Textarea
                id="issue-description"
                rows={6}
                className="min-h-36 resize-y"
                value={form.description}
                onChange={(event) => updateForm("description", event.target.value)}
                placeholder="请描述现象、发生条件、复现频率、影响范围与初步排查结果。"
                aria-invalid={showValidation && Boolean(fieldErrors.description)}
                aria-describedby={showValidation && fieldErrors.description ? "issue-description-error" : "issue-description-help"}
              />
              {!showValidation || !fieldErrors.description ? (
                <p id="issue-description-help" className="text-pretty text-xs text-slate-500">
                  当前 <span className="tabular-nums">{form.description.length}</span> 字，至少填写 24 字。
                </p>
              ) : null}
            </FormField>

            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary" aria-hidden="true">
                    <Paperclip className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800">日志与截图</div>
                    <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">
                      支持日志、截图和录像；当前使用模拟数据记录附件数量。
                    </p>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => updateForm("attachments", form.attachments + 1)}>
                  <Plus aria-hidden="true" />
                  添加附件
                </Button>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                已添加 <span className="font-semibold tabular-nums text-slate-700">{form.attachments}</span> 个附件
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className={cn("text-pretty text-xs", showValidation && !isValid ? "text-red-600" : "text-slate-500")} aria-live="polite">
                {showValidation && !isValid ? "请修正上方标注的必填项后再提交。" : "提交后将生成分类、建议队列和历史方案匹配。"}
              </p>
              <Button type="submit" className="hz-primary-action sm:min-w-48" disabled={isGenerating}>
                {isGenerating ? <Loader2 className="motion-safe:animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send aria-hidden="true" />}
                {isGenerating ? "正在执行 AI 分流" : "提交并执行 AI 分流"}
              </Button>
            </div>
          </div>
        </form>

        <article className="hz-surface min-w-0 overflow-hidden" aria-live="polite">
          <HorizonSectionHeader
            Icon={selectedCategory.icon}
            title="AI 分类研判"
            description="依据问题描述识别归属，并匹配历史处置方案。"
            trailing={
              <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", selectedCategory.color)}>
                {form.description ? selectedCategory.label : "待分析"}
              </span>
            }
          />

          <div className="space-y-4 p-4 sm:p-5">
            <div className="rounded-xl border border-blue-100 bg-[#f7f9ff] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-500">识别置信度</div>
                  <div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{confidence}</div>
                  <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">{selectedCategory.helper}</p>
                </div>
                <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl border", selectedCategory.color)} aria-hidden="true">
                  <selectedCategory.icon className="size-5" />
                </span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-blue-100" role="progressbar" aria-label="AI 分类置信度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number.parseInt(confidence, 10)}>
                <div className="h-full rounded-full bg-primary" style={{ width: confidence }} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-800">建议流向</div>
              <p className="mt-1.5 text-pretty text-sm leading-6 text-slate-600">
                {submitted
                  ? urgency === "紧急"
                    ? "建议直接进入紧急研发队列，并同步质量与售后负责人。"
                    : "建议进入普通研发任务池，等待主管确认优先级后分配。"
                  : "完成问题录入后，系统将结合类型与相似案例判断目标队列。"}
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <History className="size-4 text-primary" aria-hidden="true" />
                历史方案匹配
              </div>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {historicalMatches.map((item) => (
                  <div key={item.id} className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800">{item.title}</div>
                        <div className="mt-1 text-xs tabular-nums text-muted-foreground">{item.id}</div>
                      </div>
                      <span className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-blue-700">
                        {item.confidence}
                      </span>
                    </div>
                    <p className="mt-2 text-pretty text-xs leading-5 text-slate-500">{item.summary}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 p-3.5 text-amber-800">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold">建议补充材料</div>
                <p className="mt-1 text-pretty text-xs leading-5">复现视频、日志截图、产线环境参数。</p>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="hz-surface min-w-0 overflow-hidden">
        <HorizonSectionHeader
          Icon={Inbox}
          title="分流任务池"
          description="按优先级筛选队列，选择问题后在右侧查看上下文与处置建议。"
          trailing={<span className="text-xs tabular-nums text-slate-500">共 {queueSummary.length} 条</span>}
        />

        <div className="grid min-w-0 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="min-w-0 border-b border-slate-100 p-3 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap gap-1.5" aria-label="任务池筛选">
              {(Object.keys(queueLabels) as QueueFilter[]).map((filter) => {
                const count = filter === "all" ? allQueue.length : allQueue.filter((item) => item.lane === filter).length;
                return (
                  <Button
                    key={filter}
                    type="button"
                    size="sm"
                    variant={queueFilter === filter ? "default" : "outline"}
                    className={cn("h-8", queueFilter === filter && "bg-primary hover:bg-primary-hover")}
                    onClick={() => selectFilter(filter)}
                    aria-pressed={queueFilter === filter}
                  >
                    {queueLabels[filter]}
                    <span className="tabular-nums opacity-75">{count}</span>
                  </Button>
                );
              })}
            </div>

            <div className="mt-3 space-y-2">
              {pagedQueueSummary.length ? (
                pagedQueueSummary.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-auto w-full items-start justify-start whitespace-normal rounded-xl border p-3 text-left",
                      selectedQueueItem?.id === item.id
                        ? "border-primary/25 bg-accent hover:bg-accent"
                        : "border-slate-200 bg-white hover:border-primary/25 hover:bg-slate-50",
                    )}
                    onClick={() => setSelectedQueueItem(item)}
                    aria-pressed={selectedQueueItem?.id === item.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold text-slate-800">{item.title}</span>
                        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", laneStyles[item.lane])}>
                          {queueLabels[item.lane]}
                        </span>
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-slate-500">
                        <span className="tabular-nums">{item.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.category}</span>
                      </span>
                      <span className="mt-2 flex items-center justify-between gap-2 text-xs font-normal text-slate-500">
                        <span>{item.submitter}</span>
                        <span className="tabular-nums">{item.submittedAt}</span>
                      </span>
                    </span>
                  </Button>
                ))
              ) : (
                <HorizonEmptyState Icon={Inbox} title="当前筛选暂无问题" description="切换队列筛选条件查看其他待办。" />
              )}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs tabular-nums text-slate-500">
                {queuePage} / {queueTotalPages} 页
              </span>
              <div className="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => changeQueuePage(Math.max(1, queuePage - 1))} disabled={queuePage === 1}>
                  上一页
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => changeQueuePage(Math.min(queueTotalPages, queuePage + 1))} disabled={queuePage === queueTotalPages}>
                  下一页
                </Button>
              </div>
            </div>
          </aside>

          <div className="min-w-0 p-4 sm:p-5">
            {selectedQueueItem ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", laneStyles[selectedQueueItem.lane])}>
                        {queueLabels[selectedQueueItem.lane]}
                      </span>
                      <span className="text-xs tabular-nums text-slate-500">{selectedQueueItem.id}</span>
                    </div>
                    <h3 className="mt-2 text-balance text-lg font-semibold text-slate-900">{selectedQueueItem.title}</h3>
                    <p className="mt-1 text-pretty text-sm text-slate-500">查看问题来源、当前分类和建议处理节奏。</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedQueueItem(null)}>
                    收起详情
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <DetailDatum label="提交人" value={selectedQueueItem.submitter} />
                  <DetailDatum label="问题分类" value={selectedQueueItem.category} />
                  <DetailDatum label="提交时间" value={selectedQueueItem.submittedAt} tabular />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                      当前建议动作
                    </div>
                    <ol className="mt-3 space-y-2 text-pretty text-sm leading-6 text-slate-600">
                      <li>1. 先确认资料是否齐全，再正式指派归属队列。</li>
                      <li>2. 紧急问题同步售后与质量负责人，避免重复排查。</li>
                      <li>3. 命中历史方案时，将参考记录附到初始排查任务。</li>
                    </ol>
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                      <AlertTriangle className="size-4" aria-hidden="true" />
                      SLA 提醒
                    </div>
                    <p className="mt-3 text-pretty text-sm leading-6 text-amber-800">
                      {selectedQueueItem.lane === "urgent"
                        ? "紧急问题建议 30 分钟内完成受理，并立即指派责任人。"
                        : selectedQueueItem.lane === "return"
                          ? "待退回问题需在当天补充缺失材料，避免再次无效流转。"
                          : "普通问题建议 4 小时内给出分类结果和初步处理路径。"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <HorizonEmptyState
                Icon={FileSearch}
                title="选择一个问题查看详情"
                description="从左侧队列选择待办，系统会展示问题上下文、建议动作与 SLA。"
                action={
                  <Button type="button" size="sm" className="hz-primary-action" onClick={() => setSelectedQueueItem(pagedQueueSummary[0] ?? null)} disabled={!pagedQueueSummary.length}>
                    查看本页首条
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id} className="text-slate-700">
        {label}
        <span className="text-red-500" aria-hidden="true">*</span>
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-pretty text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DetailDatum({ label, value, tabular = false }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold text-slate-800", tabular && "tabular-nums")}>{value}</div>
    </div>
  );
}
