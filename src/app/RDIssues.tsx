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
  Loader2,
  Plus,
  Send,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "./components/ui/utils";

type IssueCategory = "hardware" | "software" | "production" | "configuration";

type QueueCard = {
  id: string;
  title: string;
  submitter: string;
  category: string;
  submittedAt: string;
};

const categoryOptions: Array<{
  id: IssueCategory;
  label: string;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = [
  { id: "hardware", label: "硬件", helper: "电路 / 结构 / 物料", icon: Cpu, color: "text-blue-700 bg-blue-50" },
  { id: "software", label: "软件", helper: "固件 / 通讯 / App", icon: Code2, color: "text-violet-700 bg-violet-50" },
  { id: "production", label: "生产", helper: "工艺 / 制程 / 设备", icon: Factory, color: "text-amber-700 bg-amber-50" },
  { id: "configuration", label: "配置", helper: "参数 / 模板 / 环境", icon: FileSearch, color: "text-emerald-700 bg-emerald-50" },
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
  { id: "TRI-301", title: "OC-10 开机异常重启", submitter: "王工", category: "硬件", submittedAt: "今天 10:30" },
  { id: "TRI-298", title: "制氧模块压力波动", submitter: "陈工", category: "生产", submittedAt: "今天 09:15" },
];

const normalQueue: QueueCard[] = [
  { id: "TRI-289", title: "参数模板版本不一致", submitter: "李静", category: "配置", submittedAt: "昨天 16:10" },
  { id: "TRI-284", title: "日志上传失败", submitter: "张越", category: "软件", submittedAt: "昨天 14:25" },
];

const returnQueue: QueueCard[] = [
  { id: "TRI-277", title: "售后资料未齐全", submitter: "客服组", category: "待退回", submittedAt: "昨天 11:20" },
];

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
  const [urgency, setUrgency] = useState<"紧急" | "普通">("普通");
  const [queueFilter, setQueueFilter] = useState<"all" | "urgent" | "normal" | "return">("all");
  const [queuePage, setQueuePage] = useState(1);
  const [selectedQueueItem, setSelectedQueueItem] = useState<QueueCard | null>(null);

  const isValid = useMemo(
    () =>
      Boolean(
        form.productModel &&
          form.version &&
          form.bomVersion &&
          form.firmwareVersion &&
          form.description.trim().length >= 24,
      ),
    [form],
  );

  const detectedCategory = useMemo(() => {
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
  const queueSummary = useMemo(() => {
    if (queueFilter === "urgent") return urgentQueue;
    if (queueFilter === "normal") return normalQueue;
    if (queueFilter === "return") return returnQueue;
    return [...urgentQueue, ...normalQueue, ...returnQueue];
  }, [queueFilter]);
  const queuePageSize = 2;
  const queueTotalPages = Math.max(1, Math.ceil(queueSummary.length / queuePageSize));
  const pagedQueueSummary = queueSummary.slice((queuePage - 1) * queuePageSize, queuePage * queuePageSize);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isValid) return;
    setIsGenerating(true);
    window.setTimeout(() => {
      setIsGenerating(false);
      setSubmitted(true);
      setUrgency(detectedCategory === "hardware" || detectedCategory === "production" ? "紧急" : "普通");
    }, 900);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <span className="material-chip bg-blue-50 text-blue-700">Issue Triage</span>
            <div>
              <h2 className="text-[2rem] font-bold tracking-tight text-slate-900">研发问题分流</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                按照文档中的 Prompt 细化为“问题提交 + AI 分类 + 历史方案匹配 + 任务池流转”的完整页面，可继续流转到售后工单、法规知识库和质量模块。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/after-sales" className="material-button-secondary">
              查看售后 Case
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link to="/ra-knowledge" className="material-button-secondary">
              打开法规知识库
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-5">
          <form className="material-card space-y-5 p-6" onSubmit={handleSubmit}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">问题提交表单</h3>
                <p className="mt-1 text-sm text-slate-500">先补齐必填项，再触发 AI 进行自动分类。</p>
              </div>
              <span className={cn("material-chip", isValid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                {isValid ? "可提交" : "待完善"}
              </span>
            </div>

            {!isValid ? (
              <div className="rounded-[20px] border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm text-amber-700">
                必填项包括：产品型号、版本号、BOM 版本、固件版本和不少于 24 字的问题描述。
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-600">产品型号</span>
                <input
                  className="material-input"
                  value={form.productModel}
                  onChange={(event) => setForm((prev) => ({ ...prev, productModel: event.target.value }))}
                  placeholder="例如：OC-10"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-600">版本号</span>
                <input
                  className="material-input"
                  value={form.version}
                  onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))}
                  placeholder="例如：V2.3.1"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-600">BOM 版本</span>
                <input
                  className="material-input"
                  value={form.bomVersion}
                  onChange={(event) => setForm((prev) => ({ ...prev, bomVersion: event.target.value }))}
                  placeholder="例如：BOM-3.2"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-600">固件版本</span>
                <input
                  className="material-input"
                  value={form.firmwareVersion}
                  onChange={(event) => setForm((prev) => ({ ...prev, firmwareVersion: event.target.value }))}
                  placeholder="例如：FW-1.4.3"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-600">问题描述</span>
              <textarea
                rows={6}
                className="material-input min-h-[144px] resize-none"
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="请描述现象、发生条件、复现频率、影响范围与初步排查结果。"
              />
              <div className="text-xs text-slate-400">当前 {form.description.length} 字，建议详细描述以提高分类命中率。</div>
            </label>

            <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-primary">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">日志 / 截图附件</div>
                    <div className="text-sm text-slate-500">支持日志、截图和录像。这里用假数据模拟上传。</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="material-button-secondary"
                  onClick={() => setForm((prev) => ({ ...prev, attachments: prev.attachments + 1 }))}
                >
                  <Plus className="h-4 w-4" />
                  添加附件
                </button>
              </div>
              <div className="mt-4 text-sm text-slate-500">已添加附件：{form.attachments} 个</div>
            </div>

            <button type="submit" className="material-button-primary w-full" disabled={!isValid || isGenerating}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isGenerating ? "AI 正在分类..." : "提交并执行 AI 分流"}
            </button>
          </form>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="material-card h-full space-y-5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">AI 分类结果</h3>
                <p className="mt-1 text-sm text-slate-500">根据描述自动判断归属类型、相似案例与建议处理路径。</p>
              </div>
              <span className={cn("material-chip", selectedCategory.color)}>{selectedCategory.label}</span>
            </div>

            <div className="rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-500">识别置信度</div>
                  <div className="mt-2 text-4xl font-bold tracking-tight text-slate-900">{confidence}</div>
                </div>
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", selectedCategory.color)}>
                  <selectedCategory.icon className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/80">
                <div className="h-2 rounded-full bg-[linear-gradient(90deg,#42a5f5_0%,#1976d2_60%,#0f766e_100%)]" style={{ width: confidence }} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="text-sm font-semibold text-slate-800">建议流向</div>
                <div className="mt-2 text-sm text-slate-500">
                  {submitted
                    ? urgency === "紧急"
                      ? "建议直接进入紧急研发队列，并同步质量与售后负责人。"
                      : "建议进入普通研发任务池，等待主管确认优先级后分配。"
                    : "提交后将根据类型与相似案例自动判断是否进入紧急队列。"}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <History className="h-4 w-4 text-slate-400" />
                  历史方案匹配
                </div>
                <div className="space-y-3">
                  {historicalMatches.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                        <span className="material-chip bg-blue-50 text-blue-700">{item.confidence}</span>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-500">{item.summary}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 text-sm text-amber-700">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <ShieldAlert className="h-4 w-4" />
                  缺失材料提示
                </div>
                <div>当前建议补充：复现视频、日志截图、产线环境参数。材料越完整，AI 分类越稳定。</div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-3">
          <div className="material-card h-full space-y-4 p-6">
            <div>
              <h3 className="text-slate-900">任务池</h3>
              <p className="mt-1 text-sm text-slate-500">紧急队列、普通队列与退回队列分开展示，方便主管快速处理。</p>
            </div>

            <QueueColumn title="紧急队列" tone="bg-red-50 text-red-700" items={urgentQueue} />
            <QueueColumn title="普通队列" tone="bg-blue-50 text-blue-700" items={normalQueue} />
            <QueueColumn title="退回队列" tone="bg-slate-100 text-slate-600" items={returnQueue} />

            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-500">
              <div className="font-semibold text-slate-700">本页后续流程</div>
              <div className="mt-2">紧急问题可继续进入质量、售后或法规模块协同处理。</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8">
          <div className="material-card p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-slate-900">分流看板明细</h3>
                <p className="mt-1 text-sm text-slate-500">补上筛选列表，让负责人能快速扫一遍当前进入各队列的条目。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "全部"],
                  ["urgent", "紧急"],
                  ["normal", "普通"],
                  ["return", "退回"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setQueueFilter(key as "all" | "urgent" | "normal" | "return");
                      setQueuePage(1);
                    }}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-semibold transition",
                      queueFilter === key ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {pagedQueueSummary.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedQueueItem(item)} className="material-panel text-left transition hover:border-blue-200">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.12em] text-slate-400">{item.id}</div>
                    </div>
                    <span className="material-chip bg-white text-slate-600">{item.category}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
                    <div>
                      <div className="text-xs text-slate-400">提交人</div>
                      <div className="mt-1">{item.submitter}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">提交时间</div>
                      <div className="mt-1">{item.submittedAt}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <div className="text-sm text-slate-500">
                第 {queuePage}/{queueTotalPages} 页
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setQueuePage((current) => Math.max(1, current - 1))}
                  disabled={queuePage === 1}
                  className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setQueuePage((current) => Math.min(queueTotalPages, current + 1))}
                  disabled={queuePage === queueTotalPages}
                  className="material-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="material-card space-y-5 p-6">
            <div>
              <h3 className="text-slate-900">处理建议</h3>
              <p className="mt-1 text-sm text-slate-500">把 AI 分析后的动作项和 SLA 提醒也放到右侧，页面更完整。</p>
            </div>

            <div className="material-panel">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                当前建议动作
              </div>
              <div className="mt-3 space-y-3 text-sm text-slate-600">
                <div>1. 先补齐复现视频、日志截图和产线参数，再锁定归属模块。</div>
                <div>2. 若识别为硬件或生产问题，优先抄送质量 DMS 与检验放行负责人。</div>
                <div>3. 已有历史方案命中时，建议直接生成初始排查任务并附上参考记录。</div>
              </div>
            </div>

            <div className="material-panel">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                SLA 提醒
              </div>
              <div className="mt-3 space-y-3 text-sm text-slate-600">
                <div>紧急问题建议 30 分钟内完成受理并指派责任人。</div>
                <div>普通问题建议 4 小时内给出分类结果和初步处理路径。</div>
                <div>退回问题需在当天补充缺失材料，避免再次进入无效流转。</div>
              </div>
            </div>

            <div className="material-panel">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Clock3 className="h-4 w-4 text-blue-600" />
                今日队列概况
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ["紧急", `${urgentQueue.length}`],
                  ["普通", `${normalQueue.length}`],
                  ["退回", `${returnQueue.length}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-white px-3 py-4 text-center shadow-sm">
                    <div className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</div>
                    <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {selectedQueueItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/28 px-4">
          <div className="material-card w-full max-w-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-slate-900">队列详情</h3>
                <p className="mt-1 text-sm text-slate-500">把分流卡片改成可点击的详情弹窗。</p>
              </div>
              <button type="button" className="material-button-secondary px-3 py-2" onClick={() => setSelectedQueueItem(null)}>
                关闭
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="material-panel">
                <div className="text-base font-semibold text-slate-900">{selectedQueueItem.title}</div>
                <div className="mt-3 text-sm text-slate-600">编号：{selectedQueueItem.id}</div>
                <div className="mt-2 text-sm text-slate-600">提交人：{selectedQueueItem.submitter}</div>
                <div className="mt-2 text-sm text-slate-600">提交时间：{selectedQueueItem.submittedAt}</div>
              </div>
              <div className="material-panel">
                <div className="text-sm font-semibold text-slate-800">处理建议</div>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <div>1. 先确认资料是否齐全，再正式指派归属队列。</div>
                  <div>2. 若是紧急问题，建议同步售后和质量负责人。</div>
                  <div>3. 可继续进入对应模块生成正式任务或补件提醒。</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QueueColumn({ title, tone, items }: { title: string; tone: string; items: QueueCard[] }) {
  return (
    <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
      <div className={cn("mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold", tone)}>{title}</div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-800">{item.title}</div>
            <div className="mt-2 text-xs text-slate-400">{item.id}</div>
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>{item.submitter}</span>
              <span>{item.category}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <Clock3 className="h-3.5 w-3.5" />
              {item.submittedAt}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
