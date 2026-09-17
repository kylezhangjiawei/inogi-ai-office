import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileText,
  Headphones,
  History,
  MessageSquare,
  Paperclip,
  Plus,
  Trash2,
  User,
  UserPlus,
  Wand2,
  XCircle,
} from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import {
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
// 页面路径以「页面路由管理」的配置为准，随主路径变更自动跟随
import { routePath } from "./lib/routePaths";

type Attachment = {
  id: string;
  name: string;
  type: "IMAGE" | "VIDEO" | "PDF";
  size: string;
  summary: string;
};

type DialogMode = "delete" | "task" | "analysis" | "attachment" | "upload" | null;
type ConfirmedStatus = "已完成" | "已关闭";

const attachmentsSeed: Attachment[] = [
  { id: "att-1", name: "S_N_照片.jpg", type: "IMAGE", size: "1.2MB", summary: "设备铭牌与序列号已完整拍摄。" },
  { id: "att-2", name: "故障现场视频.mp4", type: "VIDEO", size: "12.4MB", summary: "第三档运行 15 分钟后出现流量下降。" },
  { id: "att-3", name: "补充测试报告.pdf", type: "PDF", size: "450KB", summary: "包含电磁阀与压缩机联调结果。" },
];

const logItems = [
  { time: "2026-04-16 15:10", title: "工单流转到技术处理", desc: "当前责任人已切换为王工，等待拆机复核和替换验证。", user: "系统分发", isCurrent: true },
  { time: "2026-04-16 14:24", title: "AI 摘要生成完成", desc: "系统已自动提取故障关键词，并生成初步排查建议。", user: "系统 AI" },
  { time: "2026-04-16 14:23", title: "工单创建", desc: "来源单号 MED-REQ-012，客户渠道为售后热线。", user: "李管理员" },
];

const infoItems = [
  ["客户", "Medline International"],
  ["产品型号", "OC-5"],
  ["序列号", "20260315001"],
  ["报障日期", "2026-04-16"],
  ["问题类型", "出氧不稳定"],
  ["工作档位", "3 档"],
  ["自查情况", "已完成"],
  ["环境", "室内 / 空调房"],
];

export function AfterSalesDetails() {
  const { id = "CS-2026-0892" } = useParams();
  const [status, setStatus] = useState("处理中");
  const [remarkInput, setRemarkInput] = useState("");
  const [remarkError, setRemarkError] = useState("");
  const [remarks, setRemarks] = useState([
    { id: 1, author: "王工", content: "已安排拆机复核电磁阀与空压模块。", time: "刚刚" },
    { id: 2, author: "系统", content: "AI 摘要已同步到技术处理流。", time: "10 分钟前" },
  ]);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [statusConfirm, setStatusConfirm] = useState<ConfirmedStatus | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [attachments, setAttachments] = useState(attachmentsSeed);

  const currentStep = useMemo(() => {
    if (status === "已关闭") return 5;
    if (status === "已完成") return 4;
    if (status === "待客户") return 3;
    return 2;
  }, [status]);

  const closeDialog = () => {
    setDialogMode(null);
    setPreviewAttachment(null);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(id);
    toast.success("工单编号已复制");
  };

  const addRemark = () => {
    if (!remarkInput.trim()) {
      setRemarkError("请输入备注内容后再保存");
      return;
    }
    setRemarks((prev) => [{ id: Date.now(), author: "当前用户", content: remarkInput, time: "刚刚" }, ...prev]);
    setRemarkInput("");
    setRemarkError("");
    toast.success("备注已添加");
  };

  const updateStatus = (next: string) => {
    setStatus(next);
    toast.success(`工单状态已切换为 ${next}`);
  };

  const confirmStatus = () => {
    if (!statusConfirm) return;
    updateStatus(statusConfirm);
    setStatusConfirm(null);
  };

  const confirmDelete = () => {
    setDialogMode(null);
    toast.success("工单已加入删除审批队列");
  };

  const createRelatedTask = () => {
    closeDialog();
    toast.success("已创建相关跟进任务，并同步到首页待办");
  };

  const regenerateAnalysis = () => {
    closeDialog();
    toast.success("AI 报告已重新分析并更新结论");
  };

  const triggerUpload = () => {
    const nextIndex = attachments.length + 1;
    setAttachments((prev) => [...prev, { id: `att-${Date.now()}`, name: `补充附件_${nextIndex}.pdf`, type: "PDF", size: "320KB", summary: "新补充的客户回传检测附件。" }]);
    closeDialog();
    toast.success("附件上传入口已打开，已追加演示文件");
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Headphones}
        eyebrow="售后服务 · Case 详情"
        title={id}
        description="查看客户设备、AI 初判、处理时间线与后续动作。"
        meta={<><span>创建于 2026-04-16 14:23</span><span aria-hidden="true">·</span><span>创建人 李管理员</span></>}
        actions={
          <>
            <Button asChild variant="outline"><Link to={routePath("page:after-sales", "/after-sales")}><ArrowLeft className="size-4" />返回列表</Link></Button>
            <Button type="button" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setDialogMode("delete")}><Trash2 className="size-4" />删除</Button>
            <Button type="button" className="hz-primary-action" onClick={() => setDialogMode("task")}><UserPlus className="size-4" />新建相关任务</Button>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Activity} label="当前状态" value={status} note="王工正在技术处理" tone="brand" />
        <HorizonMetric Icon={AlertTriangle} label="优先级" value="P2" note="普通紧急" tone="warning" />
        <HorizonMetric Icon={Clock} label="距离响应超时" value="08h 42m" note="首次响应 SLA 24 小时" tone="warning" />
        <HorizonMetric Icon={Paperclip} label="附件" value={attachments.length} note="现场证据与检测记录" tone="neutral" />
      </HorizonMetricGrid>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-4">
          <section className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader
              Icon={FileText}
              title="Case 摘要"
              description="客户、设备与报障条件的核心信息。"
              trailing={<div className="flex items-center gap-2"><span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-primary">{status}</span><Button type="button" variant="ghost" size="icon" aria-label={`复制工单编号 ${id}`} onClick={handleCopy}><Copy className="size-4" /></Button></div>}
            />
            <dl className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
              {infoItems.map(([label, value]) => <div key={label} className="min-w-0 bg-white px-4 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 truncate text-sm font-semibold text-slate-800 tabular-nums" title={value}>{value}</dd></div>)}
            </dl>
          </section>

          <section className="hz-surface min-w-0 overflow-hidden border border-blue-100">
            <HorizonSectionHeader Icon={Wand2} title="AI 技术摘要评估" description="系统初判仅供辅助，签收前请结合实机检测复核。" trailing={<Button type="button" variant="outline" size="sm" onClick={() => setDialogMode("analysis")}><Wand2 className="size-4" />重新分析</Button>} />
            <div className="grid gap-px bg-blue-100 md:grid-cols-2">
              <AISummaryItem title="问题分类" content="输出异常 / 流量不足" detail="初步判断为电磁阀响应迟缓导致分流不均。" />
              <AISummaryItem title="复现条件" content="持续使用 3 档模式 1 小时后触发" detail="高温环境下传感器过热可能触发保护机制。" />
              <AISummaryItem title="自查核实" content="过滤棉清洗、电源检查已完成" detail="客户已排除基础外部因素干扰。" />
              <AISummaryItem title="缺失材料" content="氧浓度检测视频（建议补充）" detail="需要更具体的数据判断分子筛衰减情况。" isWarning />
            </div>
            <div className="flex items-start gap-2 border-t border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-pretty text-blue-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>AI 建议不替代技术签收结论；当前缺失氧浓度检测视频。</p></div>
          </section>

          <section className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader Icon={Paperclip} title="相关附件" description="现场图片、运行视频与检测文档。" trailing={<Button type="button" variant="outline" size="sm" onClick={() => setDialogMode("upload")}><Plus className="size-4" />追加附件</Button>} />
            <div className="divide-y divide-slate-100">
              {attachments.map((file) => (
                <Button variant="unstyled" key={file.id} type="button" className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#f7f9ff]" onClick={() => { setPreviewAttachment(file); setDialogMode("attachment"); }}>
                  <span className={cn("flex size-9 items-center justify-center rounded-lg text-xs font-semibold", file.type === "IMAGE" ? "bg-blue-50 text-primary" : file.type === "VIDEO" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700")} aria-hidden="true">{file.type.slice(0, 1)}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{file.name}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{file.summary}</span></span>
                  <span className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">{file.size}<Download className="size-4" aria-hidden="true" /></span>
                </Button>
              ))}
            </div>
          </section>

          <section className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader Icon={History} title="处理时间线" description="保留关键流转、分析与责任人变更记录。" />
            <ol className="px-4 py-2">
              {logItems.map((item, index) => <TimelineItem key={item.time} {...item} isLast={index === logItems.length - 1} />)}
            </ol>
          </section>
        </main>

        <aside className="min-w-0 space-y-4">
          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader Icon={Activity} title="状态与处理" description="当前 Case 的流转节点。" />
            <div className="px-4 py-3">
              <div className="space-y-1">
                <StepItem status="complete" label="新建工单" />
                <StepItem status="complete" label="AI 摘要生成" />
                <StepItem status={currentStep === 2 ? "current" : currentStep > 2 ? "complete" : "pending"} label="技术处理" sub={currentStep === 2 ? "王工正在检测实机" : undefined} />
                <StepItem status={currentStep === 3 ? "current" : currentStep > 3 ? "complete" : "pending"} label="待客户确认" />
                <StepItem status={currentStep >= 4 ? "complete" : "pending"} label="工单完成 / 关闭" isLast />
              </div>
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <Button type="button" className="w-full bg-primary hover:bg-primary-hover" onClick={() => updateStatus("待客户")}>转为待客户<ArrowRight className="size-4" /></Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => updateStatus("待客户")}><UserPlus className="size-4" />标记待客户回复</Button>
                <Button type="button" variant="outline" className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onClick={() => setStatusConfirm("已完成")}><CheckCircle2 className="size-4" />标记完成</Button>
                <Button type="button" variant="outline" className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setStatusConfirm("已关闭")}><XCircle className="size-4" />关闭工单</Button>
              </div>
            </div>
          </section>

          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader Icon={Clock} title="响应时效" description="依据 P2 规范计算。" />
            <div className="p-4"><div className="flex items-end justify-between gap-3"><span className="text-2xl font-semibold text-amber-700 tabular-nums">08h 42m</span><span className="text-xs text-amber-700">距离超时</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100" role="progressbar" aria-label="响应时效已使用比例" aria-valuenow={70} aria-valuemin={0} aria-valuemax={100}><div className="h-full w-[70%] rounded-full bg-amber-500" /></div><p className="mt-2 text-xs text-pretty text-slate-500">首次响应需在 24 小时内完成。</p></div>
          </section>

          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader Icon={MessageSquare} title="内部备注" description="仅团队成员可见。" />
            <div className="p-4">
              <Label htmlFor="case-remark">备注内容</Label>
              <Textarea id="case-remark" rows={3} value={remarkInput} onChange={(event) => { setRemarkInput(event.target.value); if (remarkError) setRemarkError(""); }} placeholder="补充检测结论或协同说明" aria-invalid={Boolean(remarkError)} className="mt-2 rounded-xl" />
              {remarkError ? <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600" role="alert"><AlertTriangle className="size-3.5" aria-hidden="true" />{remarkError}</p> : null}
              <Button type="button" className="mt-3 w-full bg-slate-900 hover:bg-slate-800" onClick={addRemark}>添加备注</Button>
              <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">{remarks.map((remark) => <div key={remark.id} className="py-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-slate-700">{remark.author}</span><time className="text-xs text-muted-foreground tabular-nums">{remark.time}</time></div><p className="mt-1 text-xs text-pretty leading-5 text-slate-600">{remark.content}</p></div>)}</div>
            </div>
          </section>
        </aside>
      </div>

      <AlertDialog open={dialogMode === "delete"} onOpenChange={(open) => !open && setDialogMode(null)}>
        <AlertDialogContent className="horizon-portal">
          <AlertDialogHeader><AlertDialogTitle className="text-balance text-slate-900">提交删除审批？</AlertDialogTitle><AlertDialogDescription className="text-pretty">当前工单 {id} 仍包含处理记录与附件。该操作会把工单送入删除审批队列，建议先完成归档。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={confirmDelete}>提交删除审批</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(statusConfirm)} onOpenChange={(open) => !open && setStatusConfirm(null)}>
        <AlertDialogContent className="horizon-portal">
          <AlertDialogHeader><AlertDialogTitle className="text-balance text-slate-900">确认将工单标记为“{statusConfirm}”？</AlertDialogTitle><AlertDialogDescription className="text-pretty">状态更新会写入操作日志并影响后续 SLA 与客户跟进。请确认当前处理记录已完整。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className={cn(statusConfirm === "已关闭" ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary-hover")} onClick={confirmStatus}>确认更新</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dialogMode === "task"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="horizon-portal sm:max-w-lg"><DialogHeader><DialogTitle className="text-balance text-slate-900">新建相关任务</DialogTitle><DialogDescription className="text-pretty">系统将带出客户、机型、序列号和 AI 摘要，生成跨部门跟进任务。</DialogDescription></DialogHeader><dl className="divide-y divide-slate-100 rounded-xl border border-slate-200"><DialogInfo label="任务标题" value={`复核 ${id} 的电磁阀故障链路`} /><DialogInfo label="默认负责人" value="王工" /><DialogInfo label="默认截止" value="2026-04-17 18:00" /></dl><DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>取消</Button><Button type="button" className="bg-primary hover:bg-primary-hover" onClick={createRelatedTask}>创建任务</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "analysis"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="horizon-portal sm:max-w-2xl"><DialogHeader><DialogTitle className="text-balance text-slate-900">重新分析报告</DialogTitle><DialogDescription className="text-pretty">补算故障置信度、历史案例匹配和缺失材料提醒。</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4"><div className="text-sm font-semibold text-slate-800">本次补算内容</div><ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-slate-600"><li>重新计算故障分类置信度</li><li>重新匹配历史维修案例</li><li>补充缺失材料提醒</li></ol></div><div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4"><div className="text-sm font-semibold text-primary">建议新增附件</div><ul className="mt-3 list-inside list-disc space-y-2 text-sm text-blue-900"><li>氧浓度实测视频</li><li>客户现场温度记录</li><li>传感器通道自检截图</li></ul></div></div><DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>取消</Button><Button type="button" className="bg-primary hover:bg-primary-hover" onClick={regenerateAnalysis}>开始重算</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "attachment" && Boolean(previewAttachment)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="horizon-portal sm:max-w-lg"><DialogHeader><DialogTitle className="text-balance text-slate-900">附件预览</DialogTitle><DialogDescription className="text-pretty">查看附件基本信息与系统摘要。</DialogDescription></DialogHeader>{previewAttachment ? <div className="rounded-xl border border-slate-200 p-4"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0 break-words font-semibold text-slate-900">{previewAttachment.name}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{previewAttachment.type}</span></div><div className="mt-3 text-sm text-slate-600 tabular-nums">文件大小：{previewAttachment.size}</div><p className="mt-2 text-sm text-pretty leading-6 text-slate-600">{previewAttachment.summary}</p></div> : null}<DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>关闭</Button><Button type="button" className="bg-primary hover:bg-primary-hover" onClick={() => { const name = previewAttachment?.name ?? "附件"; closeDialog(); toast.success(`${name} 已开始下载`); }}><Download className="size-4" />下载附件</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={dialogMode === "upload"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="horizon-portal sm:max-w-lg"><DialogHeader><DialogTitle className="text-balance text-slate-900">追加附件</DialogTitle><DialogDescription className="text-pretty">确认后将追加一份客户回传的 PDF 演示文件，并保留上传记录。</DialogDescription></DialogHeader><dl className="divide-y divide-slate-100 rounded-xl border border-slate-200"><DialogInfo label="默认文件名" value={`补充附件_${attachments.length + 1}.pdf`} /><DialogInfo label="来源" value="客户回传 / 微信渠道" /></dl><DialogFooter><Button type="button" variant="outline" onClick={closeDialog}>取消</Button><Button type="button" className="bg-primary hover:bg-primary-hover" onClick={triggerUpload}>确认追加</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function AISummaryItem({ title, content, detail, isWarning = false }: { title: string; content: string; detail: string; isWarning?: boolean }) {
  return <div className="min-w-0 bg-white p-4"><div className="text-xs font-semibold text-slate-500">{title}</div><div className={cn("mt-2 text-sm font-semibold", isWarning ? "text-red-700" : "text-slate-900")}>{content}</div><p className="mt-1 text-xs text-pretty leading-5 text-slate-600">{detail}</p></div>;
}

function TimelineItem({ time, title, desc, user, isCurrent = false, isLast = false }: { time: string; title: string; desc: string; user: string; isCurrent?: boolean; isLast?: boolean }) {
  return <li className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-3 py-3"><div className="relative flex justify-center"><span className={cn("relative z-10 mt-1 size-3 rounded-full ring-4 ring-white", isCurrent ? "bg-primary" : "bg-slate-300")} />{!isLast ? <span className="absolute bottom-[-0.75rem] top-4 w-px bg-slate-200" aria-hidden="true" /> : null}</div><div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-balance text-sm font-semibold text-slate-800">{title}</h3><time className="text-xs text-muted-foreground tabular-nums">{time}</time></div><p className="mt-1 text-xs text-pretty leading-5 text-slate-600">{desc}</p><div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><User className="size-3" aria-hidden="true" />{user}</div></div></li>;
}

function StepItem({ status, label, sub, isLast = false }: { status: "complete" | "current" | "pending"; label: string; sub?: string; isLast?: boolean }) {
  return <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3"><div className="relative flex justify-center"><span className={cn("relative z-10 flex size-6 items-center justify-center rounded-full border-2 bg-white", status === "complete" ? "border-primary bg-primary" : status === "current" ? "border-primary" : "border-slate-200")} aria-hidden="true">{status === "complete" ? <CheckCircle2 className="size-3.5 text-white" /> : status === "current" ? <span className="size-2 rounded-full bg-primary" /> : null}</span>{!isLast ? <span className="absolute bottom-0 top-6 w-px bg-slate-200" aria-hidden="true" /> : null}</div><div className="pb-5"><div className={cn("text-sm font-semibold", status === "pending" ? "text-muted-foreground" : "text-slate-800")}>{label}</div>{sub ? <p className="mt-1 text-xs text-pretty text-primary">{sub}</p> : null}</div></div>;
}

function DialogInfo({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 px-4 py-3 sm:grid-cols-[110px_minmax(0,1fr)]"><dt className="text-xs text-slate-500">{label}</dt><dd className="break-words text-sm font-medium text-slate-800 tabular-nums">{value}</dd></div>;
}
