import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  History,
  MessageSquare,
  Paperclip,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Wand2,
  XCircle,
} from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type Attachment = {
  id: string;
  name: string;
  type: "IMAGE" | "VIDEO" | "PDF";
  size: string;
  summary: string;
};

type DialogMode = "delete" | "task" | "analysis" | "attachment" | "upload" | null;

const attachmentsSeed: Attachment[] = [
  { id: "att-1", name: "S_N_照片.jpg", type: "IMAGE", size: "1.2MB", summary: "设备铭牌与序列号已完整拍摄。" },
  { id: "att-2", name: "故障现场视频.mp4", type: "VIDEO", size: "12.4MB", summary: "第三档运行 15 分钟后出现流量下降。" },
  { id: "att-3", name: "补充测试报告.pdf", type: "PDF", size: "450KB", summary: "包含电磁阀与压缩机联调结果。" },
];

const logItems = [
  {
    time: "2026-04-16 15:10",
    title: "工单流转到技术处理",
    desc: "当前责任人已切换为王工，等待拆机复核和替换验证。",
    user: "系统分发",
    isCurrent: true,
  },
  {
    time: "2026-04-16 14:24",
    title: "AI 摘要生成完成",
    desc: "系统已自动提取故障关键词，并生成初步排查建议。",
    user: "系统 AI",
  },
  {
    time: "2026-04-16 14:23",
    title: "工单创建",
    desc: "来源单号 MED-REQ-012，客户渠道为售后热线。",
    user: "李管理员",
  },
];

export function AfterSalesDetails() {
  const { id = "CS-2026-0892" } = useParams();
  const [status, setStatus] = useState("处理中");
  const [remarkInput, setRemarkInput] = useState("");
  const [remarks, setRemarks] = useState([
    { id: 1, author: "王工", content: "已安排拆机复核电磁阀与空压模块。", time: "刚刚" },
    { id: 2, author: "系统", content: "AI 摘要已同步到技术处理流。", time: "10 分钟前" },
  ]);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
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
      toast.error("请先输入备注内容");
      return;
    }
    setRemarks((prev) => [{ id: Date.now(), author: "当前用户", content: remarkInput, time: "刚刚" }, ...prev]);
    setRemarkInput("");
    toast.success("备注已添加");
  };

  const updateStatus = (next: string) => {
    setStatus(next);
    toast.success(`工单状态已切换为 ${next}`);
  };

  const confirmDelete = () => {
    closeDialog();
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
    setAttachments((prev) => [
      ...prev,
      {
        id: `att-${Date.now()}`,
        name: `补充附件_${nextIndex}.pdf`,
        type: "PDF",
        size: "320KB",
        summary: "新补充的客户回传检测附件。",
      },
    ]);
    closeDialog();
    toast.success("附件上传入口已打开，已追加演示文件");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <Link to="/after-sales" className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-800 group">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          返回列表
        </Link>
        <div className="flex gap-3">
          <button
            className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-4 py-2 text-xs font-bold text-gray-500 transition-all hover:bg-gray-50"
            onClick={() => setDialogMode("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
          <button
            className="flex items-center gap-2 rounded-xl bg-[#1976D2] px-4 py-2 text-xs font-bold text-white shadow-blue-900/10 transition-all hover:shadow-lg"
            onClick={() => setDialogMode("task")}
          >
            <UserPlus className="h-3.5 w-3.5" />
            新建相关任务
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 items-start">
        <div className="col-span-12 space-y-6 lg:col-span-8">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-mono font-bold tracking-tight text-gray-800">{id}</h2>
                  <button onClick={handleCopy} className="rounded-lg p-1.5 transition-colors hover:bg-gray-50 group">
                    <Copy className="h-4 w-4 text-gray-400 group-hover:text-blue-500" />
                  </button>
                </div>
                <div className="flex items-center gap-4 text-xs font-medium text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    创建时间: 2026-04-16 14:23
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    创建人: 李管理员
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-[#1976D2]">{status}</span>
                <span className="flex items-center gap-1.5 rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                  P2 中优先级
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 border-t border-gray-50 pt-6 md:grid-cols-4">
              <InfoItem label="客户" value="Medline International" />
              <InfoItem label="产品型号" value="OC-5" />
              <InfoItem label="序列号" value="20260315001" />
              <InfoItem label="报障日期" value="2026-04-16" />
              <InfoItem label="问题类型" value="出氧不稳定" />
              <InfoItem label="工作档位" value="3 档" />
              <InfoItem label="自查情况" value="已完成" />
              <InfoItem label="环境" value="室内 / 空调房" />
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-[#EBF3FB] p-8 shadow-sm">
            <div className="absolute right-0 top-0 p-4">
              <span className="flex items-center gap-1 rounded border border-blue-50 bg-white/80 px-2 py-1 text-[10px] font-bold text-[#1976D2] shadow-sm backdrop-blur">
                <Sparkles className="h-3 w-3" />
                AI 生成
              </span>
            </div>

            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-sm">
                <Wand2 className="h-5 w-5 text-[#1976D2]" />
              </div>
              <h3 className="text-lg font-bold text-[#1976D2]">AI 技术摘要评估</h3>
            </div>

            <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
              <AISummaryItem title="问题分类" content="输出异常 / 流量不足" detail="初步判断为电磁阀响应迟缓导致分流不均。" />
              <AISummaryItem title="复现条件" content="持续使用 3 档模式 1 小时后触发" detail="高温环境下传感器过热可能触发保护机制。" />
              <AISummaryItem title="自查核实" content="过滤棉清洗、电源检查已完成" detail="客户已排除基础外部因素干扰。" />
              <AISummaryItem title="缺失材料" content="氧浓度检测视频（建议补充）" detail="需要更具体的数据判断分子筛衰减情况。" isWarning />
              <div className="md:col-span-2 flex items-center justify-between border-t border-blue-200/50 pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-400" />
                  <p className="text-[10px] font-medium text-blue-500">由 AI 智能引擎生成，建议技术人员复核实机后再签收。</p>
                </div>
                <button className="text-[10px] font-bold uppercase tracking-wider text-[#1976D2] hover:underline" onClick={() => setDialogMode("analysis")}>
                  重新分析报告
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-gray-800">
                <Paperclip className="h-5 w-5 text-[#1976D2]" />
                相关附件
              </h3>
              <span className="text-xs font-bold text-gray-400">共 {attachments.length} 个文件</span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {attachments.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className="group relative rounded-xl border border-gray-50 bg-gray-50/50 p-3 text-left transition-all hover:border-blue-100 hover:bg-white hover:shadow-md"
                  onClick={() => {
                    setPreviewAttachment(file);
                    setDialogMode("attachment");
                  }}
                >
                  <div className="mb-3 flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-white">
                    <div
                      className={cn(
                        "flex h-full w-full items-center justify-center text-xs font-bold uppercase",
                        file.type === "IMAGE"
                          ? "bg-blue-50 text-[#1976D2]"
                          : file.type === "VIDEO"
                            ? "bg-orange-50 text-orange-600"
                            : "bg-purple-50 text-purple-600",
                      )}
                    >
                      {file.type}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <p className="truncate text-[11px] font-bold text-gray-700">{file.name}</p>
                    <p className="text-[9px] font-medium uppercase tracking-tighter text-gray-400">{file.size}</p>
                  </div>
                  <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded-lg border border-gray-100 bg-white p-1.5 shadow-sm">
                      <Download className="h-3.5 w-3.5 text-gray-400" />
                    </span>
                  </div>
                </button>
              ))}
              <button
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-100 bg-gray-50/50 text-gray-400 transition-all hover:border-blue-200 hover:bg-white hover:text-[#1976D2]"
                onClick={() => setDialogMode("upload")}
              >
                <Sparkles className="h-6 w-6" />
                <span className="text-[10px] font-bold uppercase">追加</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-8 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold text-gray-800">
                <History className="h-5 w-5 text-[#1976D2]" />
                操作日志
              </h3>
            </div>
            <div className="relative space-y-8 before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-gray-100">
              {logItems.map((item) => (
                <TimelineItem key={item.time} {...item} />
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 space-y-6 lg:col-span-4">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h3 className="mb-6 text-sm font-bold text-gray-800">工单状态流转</h3>
            <div className="space-y-6">
              <StepItem status="complete" label="新建工单" />
              <StepItem status="complete" label="AI 摘要生成" />
              <StepItem status={currentStep >= 2 ? "current" : "pending"} label="技术处理" sub={currentStep === 2 ? "王工正在检测实机..." : undefined} />
              <StepItem status={currentStep >= 3 ? "current" : "pending"} label="待客户确认" />
              <StepItem status={currentStep >= 4 ? "complete" : "pending"} label="工单完成 / 关闭" />
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <button
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#1976D2] py-3.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-xl"
              onClick={() => updateStatus("待客户")}
            >
              转交技术后待客户
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-100 bg-white py-3 text-sm font-bold text-gray-600 transition-all hover:bg-gray-50"
              onClick={() => updateStatus("待客户")}
            >
              <UserPlus className="h-4 w-4" />
              标记：待客户回复
            </button>
            <button
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-emerald-100 bg-white py-3 text-sm font-bold text-emerald-600 transition-all hover:bg-emerald-50"
              onClick={() => updateStatus("已完成")}
            >
              <CheckCircle2 className="h-4 w-4" />
              标记完成
            </button>
            <button
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-red-100 bg-white py-3 text-sm font-bold text-red-500 transition-all hover:bg-red-50"
              onClick={() => updateStatus("已关闭")}
            >
              <XCircle className="h-4 w-4" />
              关闭工单
            </button>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-orange-100 bg-orange-50 p-6 shadow-sm">
            <div className="relative z-10 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100">
                  <Clock className="h-4 w-4 text-orange-600" />
                </div>
                <h4 className="text-sm font-bold text-orange-800">响应时效提醒</h4>
              </div>
              <div className="space-y-2">
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-mono font-bold text-orange-700">08h 42m</span>
                  <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-orange-600">距离超时</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-orange-200">
                  <div className="h-full w-[30%] rounded-full bg-orange-500" />
                </div>
                <p className="text-[10px] font-medium text-orange-600">依据 P2 优先级规范，首次响应需在 24 小时内完成。</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-800">
              <MessageSquare className="h-4 w-4 text-gray-400" />
              内部备注
            </h3>
            <textarea
              rows={3}
              value={remarkInput}
              onChange={(event) => setRemarkInput(event.target.value)}
              placeholder="添加内部可见备注信息..."
              className="w-full resize-none rounded-xl border border-transparent bg-gray-50 p-4 text-xs font-medium outline-none transition-all focus:border-blue-100 focus:bg-white"
            />
            <button className="mt-4 w-full rounded-xl bg-gray-900 py-2.5 text-xs font-bold text-white transition-all hover:bg-gray-800" onClick={addRemark}>
              添加备注
            </button>
            <div className="mt-4 space-y-3">
              {remarks.map((remark) => (
                <div key={remark.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold text-gray-700">{remark.author}</div>
                    <div className="text-[10px] text-gray-400">{remark.time}</div>
                  </div>
                  <div className="mt-2 text-xs leading-6 text-gray-500">{remark.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialogMode === "delete"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>删除工单</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">删除不会直接生效，这里先模拟进入删除审批流，并保留日志追踪与回滚入口。</p>
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">当前工单 {id} 仍存在 3 条处理记录和 4 份附件，建议先完成归档再提交删除。</div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={confirmDelete}>
            提交删除审批
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "task"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>新建相关任务</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 text-sm text-slate-600">
            <p>将根据当前工单自动带出客户、机型、序列号和 AI 摘要，生成一个跨部门跟进任务。</p>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="font-semibold text-slate-900">任务预览</div>
              <div className="mt-3 space-y-2">
                <div>任务标题：复核 {id} 的电磁阀故障链路</div>
                <div>默认负责人：王工</div>
                <div>默认截止：2026-04-17 18:00</div>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={createRelatedTask}>
            创建任务
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "analysis"} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>重新分析报告</DialogTitle>
        <DialogContent dividers>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">本次补算内容</div>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <div>1. 重新计算故障分类置信度</div>
                <div>2. 重新匹配历史维修案例</div>
                <div>3. 补充缺失材料提醒</div>
              </div>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-blue-500">建议新增附件</div>
              <div className="mt-3 space-y-2 text-sm text-blue-900">
                <div>氧浓度实测视频</div>
                <div>客户现场温度记录</div>
                <div>传感器通道自检截图</div>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={regenerateAnalysis}>
            开始重算
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "attachment" && !!previewAttachment} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>附件预览</DialogTitle>
        <DialogContent dividers>
          {previewAttachment ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900">{previewAttachment.name}</div>
                  <span className="material-chip bg-slate-100 text-slate-600">{previewAttachment.type}</span>
                </div>
                <div className="mt-3 text-sm text-slate-600">文件大小：{previewAttachment.size}</div>
                <div className="mt-2 text-sm leading-7 text-slate-600">{previewAttachment.summary}</div>
              </div>
            </div>
          ) : null}
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success(`${previewAttachment?.name ?? "附件"} 已开始下载`);
            }}
          >
            下载附件
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "upload"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>追加附件</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-4 text-sm text-slate-600">
            <p>这里先模拟附件补传流程。确认后会向工单中追加一份 PDF 文件，并保留上传记录。</p>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div>默认文件名：补充附件_{attachments.length + 1}.pdf</div>
              <div className="mt-2">来源：客户回传 / 微信渠道</div>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={triggerUpload}>
            确认追加
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-sm font-bold text-gray-800">{value}</p>
    </div>
  );
}

function AISummaryItem({
  title,
  content,
  detail,
  isWarning = false,
}: {
  title: string;
  content: string;
  detail: string;
  isWarning?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">{title}</p>
      <div className="space-y-1">
        <p className={cn("text-sm font-bold", isWarning ? "text-red-500" : "text-blue-900")}>{content}</p>
        <p className="text-xs font-medium leading-relaxed text-blue-600/80">{detail}</p>
      </div>
    </div>
  );
}

function TimelineItem({
  time,
  title,
  desc,
  user,
  isCurrent = false,
}: {
  time: string;
  title: string;
  desc: string;
  user: string;
  isCurrent?: boolean;
}) {
  return (
    <div className="relative pl-8">
      <div className={cn("absolute left-1 top-1.5 h-4 w-4 rounded-full border-2 border-white shadow-sm ring-1", isCurrent ? "bg-[#1976D2] ring-[#1976D2]/20" : "bg-gray-200 ring-gray-100")} />
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-gray-800">{title}</p>
          <span className="text-[10px] font-mono text-gray-400">{time}</span>
        </div>
        <p className="text-xs font-medium text-gray-500">{desc}</p>
        <div className="flex items-center gap-1.5 pt-1">
          <User className="h-3 w-3 text-gray-300" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{user}</span>
        </div>
      </div>
    </div>
  );
}

function StepItem({ status, label, sub }: { status: "complete" | "current" | "pending"; label: string; sub?: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center gap-1">
        <div className={cn("flex h-6 w-6 items-center justify-center rounded-full border-2", status === "complete" ? "border-blue-500 bg-blue-500" : status === "current" ? "border-blue-500 bg-white" : "border-gray-100 bg-white")}>
          {status === "complete" ? <CheckCircle2 className="h-3.5 w-3.5 text-white" /> : null}
          {status === "current" ? <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" /> : null}
        </div>
        <div className="min-h-[20px] w-px bg-gray-100" />
      </div>
      <div className="pb-4">
        <p className={cn("text-sm font-bold", status === "pending" ? "text-gray-300" : "text-gray-800")}>{label}</p>
        {sub ? <p className="mt-1 text-xs font-medium text-blue-500">{sub}</p> : null}
      </div>
    </div>
  );
}
