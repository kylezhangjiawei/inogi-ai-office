import React, { useMemo, useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Clock3, FileText, Filter, Search, ShieldCheck } from "lucide-react";
import { cn } from "./components/ui/utils";

type MessageStatus = "unread" | "read" | "handled";
type MessagePriority = "high" | "medium" | "low";

type MessageItem = {
  id: string;
  title: string;
  detail: string;
  source: string;
  time: string;
  status: MessageStatus;
  priority: MessagePriority;
};

const messages: MessageItem[] = [
  {
    id: "msg-001",
    title: "注册项目已 3 天未更新",
    detail: "OC-10 注册项目缺少最新里程碑状态，请跟进负责人补录。",
    source: "注册项目里程碑",
    time: "今天 09:20",
    status: "unread",
    priority: "high",
  },
  {
    id: "msg-002",
    title: "文件控制程序已更新至 V3.2",
    detail: "质量文件 DMS 已发布新版本，建议提醒相关部门替换旧版文件。",
    source: "质量文件 DMS",
    time: "今天 08:46",
    status: "unread",
    priority: "medium",
  },
  {
    id: "msg-003",
    title: "员工劳动合同将在 13 天后到期",
    detail: "员工罗成合同临近到期，请人事行政完成续签确认。",
    source: "员工入职归档",
    time: "昨天 17:10",
    status: "read",
    priority: "medium",
  },
  {
    id: "msg-004",
    title: "研发任务审核已通过",
    detail: "风扇噪声复核相关任务已进入执行状态，主管驾驶舱已同步。",
    source: "研发任务管理",
    time: "昨天 16:32",
    status: "handled",
    priority: "low",
  },
];

const statusLabel: Record<MessageStatus | "all", string> = {
  all: "全部",
  unread: "未读",
  read: "已读",
  handled: "已处理",
};

const priorityTone: Record<MessagePriority, string> = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

const statusTone: Record<MessageStatus, string> = {
  unread: "bg-blue-50 text-blue-700",
  read: "bg-slate-100 text-slate-600",
  handled: "bg-emerald-50 text-emerald-700",
};

export function MessageCenterPage() {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<MessageStatus | "all">("all");
  const filteredMessages = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return messages.filter((message) => {
      if (status !== "all" && message.status !== status) return false;
      if (!q) return true;
      return [message.title, message.detail, message.source].some((value) => value.toLowerCase().includes(q));
    });
  }, [keyword, status]);

  const unreadCount = messages.filter((message) => message.status === "unread").length;
  const highCount = messages.filter((message) => message.priority === "high").length;
  const handledCount = messages.filter((message) => message.status === "handled").length;

  return (
    <div className="space-y-5">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">Message Center</span>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">消息中心</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              汇总系统通知、流程提醒和需要跟进的协同事项，保持与顶部通知入口一致。
            </p>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-3">
            {[
              { label: "未读", value: unreadCount, Icon: BellRing, tone: "text-blue-600" },
              { label: "高优先级", value: highCount, Icon: AlertTriangle, tone: "text-red-500" },
              { label: "已处理", value: handledCount, Icon: CheckCircle2, tone: "text-emerald-600" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                <item.Icon className={cn("mb-2 h-4 w-4", item.tone)} />
                <div className="text-xl font-bold text-slate-900">{item.value}</div>
                <div className="text-xs text-slate-500">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="material-card p-5 md:p-6">
        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(260px,1fr)_220px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="material-input pl-11"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索消息标题、来源或内容..."
            />
          </label>
          <label className="relative block">
            <Filter className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select className="material-input cursor-pointer appearance-none pl-11" value={status} onChange={(event) => setStatus(event.target.value as MessageStatus | "all")}>
              {(Object.keys(statusLabel) as Array<MessageStatus | "all">).map((key) => (
                <option key={key} value={key}>{statusLabel[key]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <div className="divide-y divide-slate-100">
            {filteredMessages.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500">没有匹配的消息</div>
            ) : (
              filteredMessages.map((message) => (
                <article key={message.id} className="grid gap-4 px-5 py-4 transition-colors hover:bg-slate-50/80 lg:grid-cols-[1fr_180px_120px]">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={cn("material-chip", statusTone[message.status])}>{statusLabel[message.status]}</span>
                      <span className={cn("material-chip", priorityTone[message.priority])}>
                        {message.priority === "high" ? "高优先级" : message.priority === "medium" ? "中优先级" : "低优先级"}
                      </span>
                    </div>
                    <h3 className="truncate text-sm font-bold text-slate-900">{message.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{message.detail}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <span className="truncate">{message.source}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Clock3 className="h-4 w-4 text-slate-400" />
                    <span>{message.time}</span>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="material-card-flat flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-500" />
        <p className="text-sm leading-6 text-slate-600">
          消息中心当前展示系统级通知和流程提醒。后续接入后端消息表后，可在此基础上增加已读、归档和批量处理能力。
        </p>
      </section>
    </div>
  );
}
