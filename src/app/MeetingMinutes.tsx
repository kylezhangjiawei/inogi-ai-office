import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileText,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const steps = [
  { id: 1, label: "输入内容" },
  { id: 2, label: "AI 生成" },
  { id: 3, label: "确认发布" },
];

const initialActions = [
  { id: 1, action: "联系墨西哥客户确认演示排期", owner: "张明", deadline: "2026-04-18", status: "待开始", statusColor: "bg-blue-50 text-blue-600" },
  { id: 2, action: "完成售后工单系统 UI 评审", owner: "研发团队", deadline: "2026-04-20", status: "进行中", statusColor: "bg-orange-50 text-orange-600" },
  { id: 3, action: "补充 FDA 510(k) 资料清单", owner: "RA 专员李华", deadline: "2026-04-30", status: "待开始", statusColor: "bg-blue-50 text-blue-600" },
  { id: 4, action: "整理 Q1 销售数据并汇报", owner: "销售总监", deadline: "2026-04-12", status: "已完成", statusColor: "bg-green-50 text-green-600" },
  { id: 5, action: "确认越南市场合作条款修订", owner: "法务顾问", deadline: "2026-04-22", status: "进行中", statusColor: "bg-orange-50 text-orange-600" },
  { id: 6, action: "输出客户培训资料目录", owner: "市场部", deadline: "2026-04-25", status: "待开始", statusColor: "bg-blue-50 text-blue-600" },
];

const initialConclusions = [
  "决定 Q2 重点推进墨西哥市场，目标新增 3 家分销商。",
  "售后工单系统 MVP 计划 5 月 5 日前上线。",
  "认证资料需在 4 月 20 日前完成 FDA 文件补充。",
];

const attendees = ["张明", "王芳", "李华", "陈工", "刘敏", "赵倩"];
const pageSize = 3;

export function MeetingMinutes() {
  const [currentStep] = useState(2);
  const [editingConclusion, setEditingConclusion] = useState<number | null>(null);
  const [conclusionTexts, setConclusionTexts] = useState(initialConclusions);
  const [actions, setActions] = useState(initialActions);
  const [addingAction, setAddingAction] = useState(false);
  const [newAction, setNewAction] = useState({ action: "", owner: "", deadline: "", status: "待开始" });
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [page, setPage] = useState(1);
  const [selectedActionId, setSelectedActionId] = useState<number | null>(initialActions[0].id);

  const filteredActions = useMemo(() => {
    return actions.filter((item) => {
      const matchKeyword = !keyword || [item.action, item.owner, item.deadline].join(" ").toLowerCase().includes(keyword.toLowerCase());
      const matchStatus = statusFilter === "全部" || item.status === statusFilter;
      return matchKeyword && matchStatus;
    });
  }, [actions, keyword, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredActions.length / pageSize));
  const pagedActions = filteredActions.slice((page - 1) * pageSize, page * pageSize);
  const selectedAction = actions.find((item) => item.id === selectedActionId) ?? null;

  const handleAddAction = () => {
    if (!newAction.action || !newAction.owner || !newAction.deadline) {
      toast.error("请补全行动项、负责人和截止日期");
      return;
    }
    const created = {
      ...newAction,
      id: actions.length + 1,
      statusColor: newAction.status === "已完成" ? "bg-green-50 text-green-600" : newAction.status === "进行中" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600",
    };
    setActions((prev) => [...prev, created]);
    setSelectedActionId(created.id);
    setNewAction({ action: "", owner: "", deadline: "", status: "待开始" });
    setAddingAction(false);
    setPage(totalPages);
    toast.success("行动项已添加");
  };

  const handleDeleteAction = (id: number) => {
    setActions((prev) => prev.filter((item) => item.id !== id));
    if (selectedActionId === id) {
      setSelectedActionId(null);
    }
    toast.success("行动项已删除");
  };

  const handleStatusChange = (id: number) => {
    setActions((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (item.status === "待开始") return { ...item, status: "进行中", statusColor: "bg-orange-50 text-orange-600" };
        if (item.status === "进行中") return { ...item, status: "已完成", statusColor: "bg-green-50 text-green-600" };
        return { ...item, status: "待开始", statusColor: "bg-blue-50 text-blue-600" };
      }),
    );
    toast.success("行动项状态已切换");
  };

  const changeFilter = (nextFilter: string) => {
    setStatusFilter(nextFilter);
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24">
      <div className="material-card p-5">
        <div className="flex items-center justify-center gap-0">
          {steps.map((step, idx) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all",
                    currentStep > step.id
                      ? "bg-primary text-white"
                      : currentStep === step.id
                        ? "bg-primary text-white shadow-lg shadow-blue-900/20"
                        : "bg-slate-100 text-slate-400",
                  )}
                >
                  {currentStep > step.id ? <Check className="h-4 w-4" /> : step.id}
                </div>
                <span className={cn("text-[11px] font-bold", currentStep >= step.id ? "text-slate-800" : "text-slate-300")}>{step.label}</span>
              </div>
              {idx < steps.length - 1 && (
                <div className="relative -top-1 mb-5 mx-1 h-[2px] w-20 bg-slate-100">
                  <div className={cn("h-full transition-all", currentStep > step.id ? "w-full bg-primary" : "w-0")} />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="material-card flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-600">
            <span className="font-bold text-slate-800">已输入：</span>
            会议录音转写（3,240 字）与销售周报 2 份
          </p>
          <p className="mt-1 text-xs text-slate-400">2026-04-16 14:00 | 市场部周会 | AI 摘要已生成</p>
        </div>
        <button type="button" onClick={() => toast.success("原始转写内容已重新打开")} className="text-xs font-bold text-primary hover:underline">
          重新编辑
        </button>
      </div>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="material-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-blue-50/40 to-transparent px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">AI 生成纪要</h3>
                <p className="text-[11px] font-medium text-slate-400">2026-04-16 14:00 | 市场部周会</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => toast.success("纪要进入编辑模式")} className="rounded-lg p-2 transition-colors hover:bg-slate-50">
                <Edit3 className="h-4 w-4 text-slate-400" />
              </button>
              <button type="button" onClick={() => toast.info("正在导出文档...")} className="rounded-lg p-2 transition-colors hover:bg-slate-50">
                <Download className="h-4 w-4 text-slate-400" />
              </button>
            </div>
          </div>

          <div className="space-y-8 p-6">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <div className="h-5 w-1.5 rounded-full bg-primary" />
                <h4 className="text-sm font-bold text-slate-800">会议结论</h4>
              </div>
              <div className="space-y-2.5">
                {conclusionTexts.map((item, idx) => (
                  <div key={idx} className="group flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-primary">
                      {idx + 1}
                    </span>
                    {editingConclusion === idx ? (
                      <input
                        type="text"
                        defaultValue={item}
                        onBlur={(event) => {
                          const next = [...conclusionTexts];
                          next[idx] = event.target.value;
                          setConclusionTexts(next);
                          setEditingConclusion(null);
                        }}
                        autoFocus
                        className="flex-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-slate-700 outline-none"
                      />
                    ) : (
                      <p
                        className="flex-1 -ml-2 rounded-lg px-2 py-1 text-sm font-medium leading-relaxed text-slate-700 transition-colors hover:bg-slate-50"
                        onDoubleClick={() => setEditingConclusion(idx)}
                      >
                        {item}
                      </p>
                    )}
                    <button type="button" onClick={() => setEditingConclusion(idx)} className="rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-slate-100">
                      <Edit3 className="h-3 w-3 text-slate-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-1.5 rounded-full bg-orange-400" />
                  <h4 className="text-sm font-bold text-slate-800">行动项</h4>
                  <span className="text-[11px] font-bold text-slate-400">{filteredActions.length} 条</span>
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={keyword}
                      onChange={(event) => {
                        setKeyword(event.target.value);
                        setPage(1);
                      }}
                      placeholder="搜索行动项或负责人"
                      className="rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-medium outline-none transition focus:border-blue-200 focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["全部", "待开始", "进行中", "已完成"].map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => changeFilter(item)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-bold transition",
                          statusFilter === item
                            ? "border-blue-200 bg-blue-50 text-primary"
                            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-100">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50">
                      {["#", "行动项", "负责人", "截止", "状态", "操作"].map((title) => (
                        <th key={title} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pagedActions.map((item) => (
                      <tr
                        key={item.id}
                        className={cn("group cursor-pointer transition-colors hover:bg-slate-50/70", selectedActionId === item.id && "bg-blue-50/40")}
                        onClick={() => setSelectedActionId(item.id)}
                      >
                        <td className="px-4 py-3 text-[11px] font-mono text-slate-400">{item.id}</td>
                        <td className="px-4 py-3 text-xs font-medium text-slate-700">{item.action}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs font-medium text-slate-500">{item.owner}</td>
                        <td className="px-4 py-3 text-xs font-mono text-slate-500">{item.deadline}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleStatusChange(item.id);
                            }}
                            className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", item.statusColor)}
                          >
                            {item.status}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDeleteAction(item.id);
                            }}
                            className="rounded p-1 transition hover:bg-red-50"
                          >
                            <Trash2 className="h-3 w-3 text-red-400" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {pagedActions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                          当前筛选下没有行动项。
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-slate-500">
                  共 {filteredActions.length} 条，当前第 {page}/{totalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page === 1}
                    className="material-button-secondary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={page === totalPages}
                    className="material-button-secondary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {addingAction ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input
                        placeholder="行动项描述"
                        value={newAction.action}
                        onChange={(event) => setNewAction((prev) => ({ ...prev, action: event.target.value }))}
                        className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-medium outline-none"
                      />
                      <input
                        placeholder="负责人"
                        value={newAction.owner}
                        onChange={(event) => setNewAction((prev) => ({ ...prev, owner: event.target.value }))}
                        className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-medium outline-none"
                      />
                      <input
                        placeholder="截止日期 YYYY-MM-DD"
                        value={newAction.deadline}
                        onChange={(event) => setNewAction((prev) => ({ ...prev, deadline: event.target.value }))}
                        className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-medium outline-none"
                      />
                      <select
                        value={newAction.status}
                        onChange={(event) => setNewAction((prev) => ({ ...prev, status: event.target.value }))}
                        className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-medium outline-none"
                      >
                        <option value="待开始">待开始</option>
                        <option value="进行中">进行中</option>
                        <option value="已完成">已完成</option>
                      </select>
                    </div>
                    <div className="flex gap-3">
                      <button type="button" onClick={handleAddAction} className="material-button-primary">
                        确认添加
                      </button>
                      <button type="button" onClick={() => setAddingAction(false)} className="material-button-secondary">
                        取消
                      </button>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <button type="button" onClick={() => setAddingAction((prev) => !prev)} className="mt-4 flex items-center gap-2 px-1 text-xs font-bold text-primary hover:underline">
                <Plus className="h-3.5 w-3.5" />
                添加行动项
              </button>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="h-5 w-1.5 rounded-full bg-purple-400" />
                <h4 className="text-sm font-bold text-slate-800">参会人员</h4>
              </div>
              <div className="flex flex-wrap gap-2">
                {attendees.map((name, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold",
                      idx < 4 ? "border-blue-100 bg-blue-50 text-primary" : "border-slate-100 bg-slate-50 text-slate-500",
                    )}
                  >
                    <Users className="h-3 w-3" />
                    {name}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
                  <Calendar className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">下次会议</p>
                  <p className="text-sm font-bold text-slate-700">2026-04-23 14:00 | 市场部周会跟进</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toast.success("已添加到日历")}
                className="flex items-center gap-1.5 rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-blue-50"
              >
                <Calendar className="h-3 w-3" />
                添加到日历
              </button>
            </div>
          </div>
        </motion.div>

        <aside className="space-y-6">
          <section className="material-card p-6">
            <div className="mb-4">
              <h3 className="text-slate-900">行动详情</h3>
              <p className="mt-1 text-sm text-slate-500">点击左侧行动项后，在这里查看负责人、状态和下一步动作。</p>
            </div>
            {selectedAction ? (
              <div className="space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selectedAction.action}</div>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <div>负责人：{selectedAction.owner}</div>
                    <div>截止日期：{selectedAction.deadline}</div>
                    <div>当前状态：{selectedAction.status}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <button type="button" onClick={() => handleStatusChange(selectedAction.id)} className="material-button-primary w-full justify-center">
                    推进一步
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.success(`${selectedAction.owner} 已收到提醒`)}
                    className="material-button-secondary w-full justify-center"
                  >
                    发送提醒
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.success(`${selectedAction.action} 已同步到首页待办`)}
                    className="material-button-secondary w-full justify-center"
                  >
                    同步到首页
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center text-sm text-slate-500">
                先从左侧选择一条行动项。
              </div>
            )}
          </section>

          <section className="material-card p-6">
            <div className="mb-4">
              <h3 className="text-slate-900">快捷导出</h3>
              <p className="mt-1 text-sm text-slate-500">把当前纪要快速推送给团队或导出给外部参与者。</p>
            </div>
            <div className="space-y-3">
              <button type="button" onClick={() => toast.success("行动项已推送给各负责人")} className="material-button-primary w-full justify-center">
                <Send className="h-4 w-4" />
                推送行动项
              </button>
              <button type="button" onClick={() => toast.info("正在导出 Word...")} className="material-button-secondary w-full justify-center">
                <Download className="h-4 w-4" />
                导出 Word
              </button>
              <button type="button" onClick={() => toast.info("正在导出 PDF...")} className="material-button-secondary w-full justify-center">
                <FileText className="h-4 w-4" />
                导出 PDF
              </button>
              <button type="button" onClick={() => toast.success("分享链接已复制")} className="material-button-secondary w-full justify-center">
                <Share2 className="h-4 w-4" />
                分享链接
              </button>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
