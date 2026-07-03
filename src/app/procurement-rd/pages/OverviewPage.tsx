// 场景0 · 流程总览（协同驾驶舱）：跨模块 KPI + 数据驱动流程图（各节点在办数量、可点跳转）
// + 协同待办/瓶颈清单 + 最近协同动态时间线 + 责任人分工 + 补充意见。待确认①②⑥。
import { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Boxes,
  Building2,
  ClipboardList,
  Coins,
  FileSignature,
  FlaskConical,
  ListTodo,
  Play,
  ScrollText,
  ShoppingCart,
  Truck,
  UserCog,
  Waypoints,
} from "lucide-react";
import { cn } from "../../components/ui/utils";
import { useProc } from "../store";
import { REVIEW_ITEMS } from "../data/mockData";
import { DemoControls, PageHeader, ReviewTag, StatCard, StatusPill } from "../components/common";
import type { ReqStatus } from "../data/types";

interface FlowNode {
  name: string;
  role: string;
  page: string;
  to?: string;
  current?: boolean;
  count?: number;
  countLabel?: string;
}

const ROLES = [
  { role: "研发负责人", duty: "提出需求、出图、评审转采购", icon: FlaskConical, tone: "text-indigo-600 bg-indigo-50" },
  { role: "采购负责人", duty: "询价、打样、定价、发起合同", icon: ShoppingCart, tone: "text-violet-600 bg-violet-50" },
  { role: "研发对接人", duty: "接收样品、组织测试并反馈", icon: FlaskConical, tone: "text-cyan-600 bg-cyan-50" },
  { role: "财务", duty: "合同 / 付款企微审批", icon: Coins, tone: "text-emerald-600 bg-emerald-50" },
];

export function OverviewPage() {
  const navigate = useNavigate();
  const { requirements, contracts, rdTasks, suppliers } = useProc();

  const byStatus = (s: ReqStatus) => requirements.filter((r) => r.status === s).length;

  const nodes: FlowNode[] = useMemo(
    () => [
      { name: "研发提出需求", role: "研发负责人", page: "研发任务驾驶舱", to: "/proc-rd-dashboard", count: rdTasks.length, countLabel: "在办任务" },
      { name: "研发出图", role: "研发负责人", page: "研发任务驾驶舱", to: "/proc-rd-dashboard" },
      { name: "转采购询价", role: "研发负责人 → 采购负责人", page: "采购工作台", to: "/proc-workbench", current: true, count: requirements.filter((r) => r.source === "rd").length, countLabel: "研发流转" },
      { name: "到样通知研发", role: "采购负责人 → 研发对接人", page: "采购工作台", to: "/proc-workbench", count: byStatus("pending_sample"), countLabel: "待到样" },
      { name: "研发测试", role: "研发对接人", page: "需求详情", to: "/proc-workbench", count: byStatus("testing"), countLabel: "测试中" },
      { name: "定价", role: "采购负责人", page: "采购工作台", to: "/proc-workbench", count: byStatus("priced"), countLabel: "已定价" },
      { name: "合同签订（企微）", role: "采购负责人 · 财务", page: "采购合同台账", to: "/proc-contracts", count: contracts.filter((c) => c.contractApproval === "approving").length, countLabel: "待审批" },
      { name: "付款（企微）", role: "财务", page: "采购合同台账", to: "/proc-contracts", count: contracts.filter((c) => c.paymentApproval !== "approved" && c.paymentApproval !== "none").length, countLabel: "付款中" },
      { name: "分批到货", role: "仓管 · 采购", page: "采购合同台账", to: "/proc-contracts", count: contracts.filter((c) => c.deliveryPlan.length > 0).length, countLabel: "在途合同" },
      { name: "完成", role: "—", page: "—", count: contracts.filter((c) => c.delivered >= c.quantity).length, countLabel: "已到齐" },
    ],
    [requirements, contracts, rdTasks],
  );

  // 协同待办 / 瓶颈桶
  const buckets = useMemo(
    () => [
      { key: "pending_inquiry" as ReqStatus, label: "待录报价", to: "/proc-workbench", items: requirements.filter((r) => r.status === "pending_inquiry") },
      { key: "inquiring" as ReqStatus, label: "待选定报价", to: "/proc-workbench", items: requirements.filter((r) => r.status === "inquiring") },
      { key: "pending_sample" as ReqStatus, label: "待到样", to: "/proc-workbench", items: requirements.filter((r) => r.status === "pending_sample") },
      { key: "testing" as ReqStatus, label: "研发测试中", to: "/proc-workbench", items: requirements.filter((r) => r.status === "testing") },
    ],
    [requirements],
  );
  const contractApproving = contracts.filter((c) => c.contractApproval === "approving");
  const paymentPending = contracts.filter((c) => c.contractApproval === "effective" && c.paymentApproval !== "approved");

  // 最近协同动态（聚合需求日志 + 研发时间线采购回传 + 合同到货）
  const activity = useMemo(() => {
    const items: Array<{ date: string; tag: string; text: string; kind: "req" | "proc" | "contract" }> = [];
    for (const r of requirements) for (const l of r.logs) items.push({ date: l.at, tag: r.code, text: l.text, kind: "req" });
    for (const t of rdTasks) for (const it of t.timeline) if (it.kind === "proc") items.push({ date: it.at, tag: t.title, text: it.text.replace("采购动态：", ""), kind: "proc" });
    for (const c of contracts) for (const d of c.deliveries) items.push({ date: d.date, tag: c.code, text: `${d.batch} 到货 +${d.qty}`, kind: "contract" });
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  }, [requirements, rdTasks, contracts]);

  const inTransit = contracts.reduce((s, c) => s + (c.quantity - c.delivered), 0);
  const todoTotal = buckets.reduce((s, b) => s + b.items.length, 0) + contractApproving.length + paymentPending.length;

  const kindDot = (k: "req" | "proc" | "contract") => (k === "proc" ? "bg-violet-500" : k === "contract" ? "bg-emerald-500" : "bg-indigo-400");

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <DemoControls />
      <PageHeader
        Icon={Waypoints}
        badge="采购与研发协同 · 总览"
        title="协同流程驾驶舱"
        description="研发提出需求到分批到货完成的全链路总览。下方流程图各节点显示实时在办数量、可点击进入对应页面。"
        right={
          <button type="button" onClick={() => navigate("/proc-rd-dashboard")} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
            <Play className="h-4 w-4" />
            开始演示
          </button>
        }
      />

      {/* KPI 概览 */}
      <div className="mb-3 grid grid-cols-6 gap-3">
        <StatCard label="研发在办任务" value={rdTasks.length} Icon={ListTodo} />
        <StatCard label="采购需求" value={requirements.length} tone="indigo" hint={`研发流转 ${requirements.filter((r) => r.source === "rd").length}`} Icon={ShoppingCart} />
        <StatCard label="流程进行中" value={requirements.filter((r) => ["inquiring", "pending_sample", "testing"].includes(r.status)).length} tone="violet" hint="询价/打样/测试" Icon={FlaskConical} />
        <StatCard label="合同" value={contracts.length} tone="amber" hint={`审批中 ${contractApproving.length}`} Icon={ScrollText} />
        <StatCard label="在途数量" value={inTransit} tone="emerald" hint="合同−已到货" Icon={Truck} />
        <StatCard label="供应商" value={suppliers.length} hint={`协同待办 ${todoTotal}`} Icon={Building2} />
      </div>

      {/* 全流程图 */}
      <div className="material-card mb-3 p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900">全流程与实时在办</h2>
          <ReviewTag item={REVIEW_ITEMS[0]} />
          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-slate-400">
            <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" /> 当前主线节点 · 点节点跳转对应页面
          </span>
        </div>
        <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
          {nodes.map((n, i) => (
            <div key={n.name} className="flex items-center">
              <button
                type="button"
                disabled={!n.to}
                onClick={() => n.to && navigate(n.to)}
                className={cn(
                  "flex w-40 shrink-0 flex-col rounded-xl border p-3 text-left transition",
                  n.current ? "border-indigo-400 bg-indigo-50 shadow-sm ring-2 ring-indigo-200" : "border-slate-200 bg-white",
                  n.to ? "cursor-pointer hover:border-indigo-300 hover:shadow-sm" : "cursor-default",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold", n.current ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-500")}>{i + 1}</span>
                  <span className={cn("text-sm font-semibold", n.current ? "text-indigo-700" : "text-slate-800")}>{n.name}</span>
                </div>
                {typeof n.count === "number" && (
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className={cn("text-xl font-bold tabular-nums", n.current ? "text-indigo-600" : "text-slate-800")}>{n.count}</span>
                    <span className="text-[10px] text-slate-400">{n.countLabel}</span>
                  </div>
                )}
                <div className="mt-2 space-y-0.5 text-[11px] leading-tight text-slate-400">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-300">责任</span>
                    <span className="text-slate-500">{n.role}</span>
                    {i === 0 && <ReviewTag item={REVIEW_ITEMS[1]} className="scale-90" />}
                  </div>
                  <div>
                    <span className="text-slate-300">页面</span> {n.page}
                  </div>
                </div>
              </button>
              {i < nodes.length - 1 && <ArrowRight className="mx-0.5 h-4 w-4 shrink-0 text-slate-300" />}
            </div>
          ))}
        </div>
      </div>

      {/* 待办/瓶颈 + 最近动态 */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        {/* 协同待办 */}
        <div className="material-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-indigo-500" />
            <h2 className="text-base font-bold text-slate-900">协同待办 / 瓶颈</h2>
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">{todoTotal}</span>
          </div>
          <div className="space-y-2">
            {buckets.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => navigate(b.to)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
              >
                <div className="flex items-center gap-2">
                  <StatusPill status={b.key} />
                  <span className="text-sm text-slate-600">{b.label}</span>
                  {b.items[0] && <span className="truncate text-xs text-slate-400">· {b.items[0].materialName}{b.items.length > 1 ? ` 等${b.items.length}项` : ""}</span>}
                </div>
                <span className="flex items-center gap-1 text-sm font-semibold text-slate-700">
                  {b.items.length}
                  <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                </span>
              </button>
            ))}
            <button type="button" onClick={() => navigate("/proc-contracts")} className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left transition hover:border-amber-200 hover:bg-amber-50/40">
              <div className="flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-slate-600">合同待企微审批</span>
                {contractApproving[0] && <span className="truncate text-xs text-slate-400">· {contractApproving[0].code}{contractApproving.length > 1 ? ` 等${contractApproving.length}项` : ""}</span>}
              </div>
              <span className="flex items-center gap-1 text-sm font-semibold text-slate-700">{contractApproving.length}<ArrowRight className="h-3.5 w-3.5 text-slate-300" /></span>
            </button>
            <button type="button" onClick={() => navigate("/proc-contracts")} className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-emerald-500" />
                <span className="text-sm text-slate-600">付款待审批</span>
              </div>
              <span className="flex items-center gap-1 text-sm font-semibold text-slate-700">{paymentPending.length}<ArrowRight className="h-3.5 w-3.5 text-slate-300" /></span>
            </button>
          </div>
        </div>

        {/* 最近协同动态 */}
        <div className="material-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-violet-500" />
            <h2 className="text-base font-bold text-slate-900">最近协同动态</h2>
          </div>
          <ul className="space-y-2.5">
            {activity.length === 0 && <li className="text-sm text-slate-400">暂无动态</li>}
            {activity.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", kindDot(a.kind))} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-slate-600">
                    <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{a.tag}</span>
                    {a.text}
                  </div>
                  <div className="text-[11px] text-slate-400">{a.date}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 责任人分工 */}
      <div className="material-card mb-3 p-5">
        <div className="mb-3 flex items-center gap-2">
          <UserCog className="h-4 w-4 text-indigo-500" />
          <h2 className="text-base font-bold text-slate-900">节点责任人分工</h2>
          <ReviewTag item={REVIEW_ITEMS[1]} />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {ROLES.map((r) => (
            <div key={r.role} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center gap-2">
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", r.tone)}>
                  <r.icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-slate-800">{r.role}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{r.duty}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 补充意见 */}
      <div className="material-card p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900">补充意见</h2>
          <ReviewTag item={REVIEW_ITEMS[5]} />
        </div>
        <p className="mt-1 text-xs text-slate-400">会上口头收集各部门对流程 / 字段 / 对接系统的补充意见（演示原型不做录入）。</p>
        <div className="mt-3 flex min-h-[96px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-300">此处留白，供会议记录补充</div>
      </div>
    </div>
  );
}
