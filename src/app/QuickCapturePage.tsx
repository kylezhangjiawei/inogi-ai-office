import React, { useState } from "react";
import {
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Mic,
  Plus,
  Sparkles,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type ItemCategory = "紧急待办" | "会议安排" | "项目事项" | "想法存档" | "需分配任务";
type TaskStatus = "待确认" | "进行中" | "已完成";
type Priority = "高" | "普通";

interface CapturedItem {
  id: number;
  text: string;
  category: ItemCategory;
}

interface AssignedTask {
  id: number;
  content: string;
  assignee: string;
  deadline: string;
  priority: Priority;
  status: TaskStatus;
}

const categoryConfig: Record<ItemCategory, { color: string; bg: string; headerBg: string }> = {
  "紧急待办":   { color: "text-red-700",    bg: "bg-red-50",    headerBg: "bg-red-100" },
  "会议安排":   { color: "text-blue-700",   bg: "bg-blue-50",   headerBg: "bg-blue-100" },
  "项目事项":   { color: "text-green-700",  bg: "bg-green-50",  headerBg: "bg-green-100" },
  "想法存档":   { color: "text-gray-600",   bg: "bg-gray-50",   headerBg: "bg-gray-100" },
  "需分配任务": { color: "text-orange-700", bg: "bg-orange-50", headerBg: "bg-orange-100" },
};

const teamMembers = ["张明", "王芳", "李华", "陈工", "刘敏", "赵倩"];

const mockParsed: CapturedItem[] = [
  { id: 1, text: "客户墨西哥总部要求下周二前提交报价单，非常紧急", category: "紧急待办" },
  { id: 2, text: "周五下午 3 点与 RA 团队开 FDA 资料补充讨论会", category: "会议安排" },
  { id: 3, text: "Q2 目标市场需要重新梳理优先级，东南亚 vs 中东", category: "项目事项" },
  { id: 4, text: "想到一个功能：可以在工单里直接触发维修备件申请", category: "想法存档" },
  { id: 5, text: "销售培训资料需要更新产品对比图，让市场部来做", category: "需分配任务" },
  { id: 6, text: "合同里的赔偿条款有歧义，需要法务部确认后出修订版", category: "需分配任务" },
];

const initialTasks: AssignedTask[] = [
  { id: 1, content: "更新产品对比图（销售培训资料）", assignee: "王芳", deadline: "2026-04-20", priority: "普通", status: "进行中" },
  { id: 2, content: "确认合同赔偿条款歧义并出修订意见", assignee: "李华", deadline: "2026-04-18", priority: "高", status: "待确认" },
];

const statusColors: Record<TaskStatus, string> = {
  "待确认": "bg-amber-50 text-amber-700",
  "进行中": "bg-blue-50 text-blue-700",
  "已完成": "bg-green-50 text-green-600",
};

const demoText = "客户墨西哥总部要求下周二前提交报价单，非常紧急。\n周五下午3点与RA团队开FDA资料补充讨论会。\nQ2目标市场需要重新梳理优先级，东南亚vs中东。\n想到一个功能：可以在工单里直接触发维修备件申请。\n销售培训资料需要更新产品对比图，让市场部来做。\n合同里的赔偿条款有歧义，需要法务部确认后出修订版。";

export function QuickCapturePage() {
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedItems, setParsedItems] = useState<CapturedItem[] | null>(null);
  const [tasks, setTasks] = useState<AssignedTask[]>(initialTasks);
  const [taskForm, setTaskForm] = useState<Record<number, { assignee: string; deadline: string; priority: Priority }>>({});

  const handleMic = () => {
    setIsRecording(true);
    setTimeout(() => {
      setInputText(demoText);
      setIsRecording(false);
      toast.success("语音转写完成（模拟）");
    }, 1500);
  };

  const handleParse = () => {
    if (!inputText.trim()) { toast.error("请先输入或语音录入内容"); return; }
    setIsParsing(true);
    setTimeout(() => {
      setParsedItems(mockParsed);
      setIsParsing(false);
      toast.success("AI 解析完成，已分类 6 条");
    }, 1000);
  };

  const groupedItems = parsedItems
    ? (Object.keys(categoryConfig) as ItemCategory[]).reduce<Record<ItemCategory, CapturedItem[]>>((acc, cat) => {
        acc[cat] = parsedItems.filter((i) => i.category === cat);
        return acc;
      }, {} as Record<ItemCategory, CapturedItem[]>)
    : null;

  const handleAssign = (item: CapturedItem) => {
    const form = taskForm[item.id];
    if (!form?.assignee || !form?.deadline) { toast.error("请选择负责人和截止日期"); return; }
    const newTask: AssignedTask = {
      id: Date.now(),
      content: item.text,
      assignee: form.assignee,
      deadline: form.deadline,
      priority: form.priority ?? "普通",
      status: "待确认",
    };
    setTasks((prev) => [newTask, ...prev]);
    toast.success(`任务已分配给 ${form.assignee}`);
  };

  const cycleStatus = (taskId: number) => {
    const order: TaskStatus[] = ["待确认", "进行中", "已完成"];
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      const idx = order.indexOf(t.status);
      return { ...t, status: order[(idx + 1) % order.length] };
    }));
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="flex flex-col gap-4 p-4 bg-gray-50 min-h-full">
      {/* Input Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-orange-500" />
          <h2 className="font-semibold text-gray-800 text-sm">随手记 · AI 解析分流</h2>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <textarea
              className="w-full h-28 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 placeholder:text-gray-300 leading-relaxed"
              placeholder="输入文字或点击麦克风语音输入…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleMic}
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                isRecording ? "bg-red-500 text-white animate-pulse" : "bg-orange-50 text-orange-500 hover:bg-orange-100"
              )}
            >
              <Mic className="w-5 h-5" />
            </button>
            <button
              onClick={handleParse}
              disabled={isParsing}
              className="flex-1 flex flex-col items-center justify-center gap-1 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-xl px-3 transition-colors min-h-[56px]"
            >
              {isParsing ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span className="text-xs font-medium">AI 解析</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Classified Items */}
      {groupedItems && (
        <div className="grid grid-cols-5 gap-3">
          {(Object.keys(categoryConfig) as ItemCategory[]).map((cat) => {
            const cfg = categoryConfig[cat];
            const items = groupedItems[cat];
            return (
              <div key={cat} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className={cn("px-3 py-2 flex items-center justify-between", cfg.headerBg)}>
                  <span className={cn("text-xs font-semibold", cfg.color)}>{cat}</span>
                  <span className={cn("text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center", cfg.bg, cfg.color)}>
                    {items.length}
                  </span>
                </div>
                <div className="p-2 space-y-1.5 min-h-[80px]">
                  {items.map((item) => (
                    <div key={item.id} className={cn("rounded-lg p-2.5 text-xs text-gray-700 leading-relaxed", cfg.bg)}>
                      {item.text}
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className="text-xs text-gray-300 text-center py-4">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task Assignment Panel */}
      {groupedItems && groupedItems["需分配任务"].length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-orange-500" />
            <h3 className="font-semibold text-gray-800 text-sm">任务分配</h3>
          </div>
          <div className="space-y-3">
            {groupedItems["需分配任务"].map((item) => (
              <div key={item.id} className="border border-orange-100 bg-orange-50/40 rounded-xl p-4">
                <p className="text-sm text-gray-700 mb-3">{item.text}</p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">负责人</label>
                    <select
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
                      value={taskForm[item.id]?.assignee ?? ""}
                      onChange={(e) => setTaskForm((p) => ({ ...p, [item.id]: { ...p[item.id], assignee: e.target.value } }))}
                    >
                      <option value="">选择负责人</option>
                      {teamMembers.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">截止日期</label>
                    <input type="date" min={today}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      value={taskForm[item.id]?.deadline ?? ""}
                      onChange={(e) => setTaskForm((p) => ({ ...p, [item.id]: { ...p[item.id], deadline: e.target.value } }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">优先级</label>
                    <div className="flex gap-1">
                      {(["高", "普通"] as Priority[]).map((pr) => (
                        <button key={pr} onClick={() => setTaskForm((p) => ({ ...p, [item.id]: { ...p[item.id], priority: pr } }))}
                          className={cn("text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors",
                            (taskForm[item.id]?.priority ?? "普通") === pr
                              ? "bg-orange-500 text-white border-orange-500"
                              : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"
                          )}>
                          {pr}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => handleAssign(item)}
                    className="flex items-center gap-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white px-3.5 py-1.5 rounded-lg font-medium transition-colors">
                    <Bell className="w-3.5 h-3.5" /> 推送通知
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Task Board */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-orange-500" />
            <h3 className="font-semibold text-gray-800 text-sm">任务追踪台账</h3>
          </div>
          <span className="text-xs text-gray-400">{tasks.filter((t) => t.status !== "已完成").length} 条进行中</span>
        </div>
        <div className="space-y-2">
          {tasks.map((task) => {
            const overdue = task.status !== "已完成" && task.deadline < today;
            return (
              <div key={task.id} className={cn("flex items-center gap-4 p-3 rounded-xl border",
                overdue ? "border-red-100 bg-red-50/30" : "border-gray-100 hover:bg-gray-50"
              )}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800 truncate">{task.content}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{task.assignee}</span>
                    <span className={cn("flex items-center gap-1", overdue && "text-red-500 font-medium")}>
                      <Calendar className="w-3 h-3" />{task.deadline}
                      {overdue && " (已超期)"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium",
                    task.priority === "高" ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-500"
                  )}>
                    {task.priority}
                  </span>
                  <button onClick={() => cycleStatus(task.id)}
                    className={cn("text-xs px-2 py-1 rounded-full font-medium transition-colors cursor-pointer", statusColors[task.status])}>
                    {task.status}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
