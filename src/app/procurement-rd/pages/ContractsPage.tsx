// 场景5 · 采购合同台账：合同列表 + 剩余在途进度条 + 展开到货/付款明细 +
// 演示模拟按钮（企微审批通过 / 一批到货 / 付款审批通过）+ 待确认③④标签。
import { useState } from "react";
import { ChevronDown, Coins, FileCheck2, HelpCircle, ScrollText, Truck } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { procActions, useProc } from "../store";
import { REVIEW_ITEMS } from "../data/mockData";
import type { Contract } from "../data/types";
import { ContractApprovalPill, DemoControls, PageHeader, Pager, PaymentPill, ReviewTag, StatCard, fmtMoney } from "../components/common";

const PAGE_SIZE = 6;

function ProgressBar({ delivered, total }: { delivered: number; total: number }) {
  const pct = total ? Math.round((delivered / total) * 100) : 0;
  const remain = total - delivered;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500">在途 {remain}</span>
        <span className="tabular-nums text-slate-400">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** 演示模拟按钮：灰色小字，旁注"演示模拟"。 */
function SimButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded border border-dashed px-2 py-1 text-[11px] transition",
        disabled ? "cursor-not-allowed border-slate-200 text-slate-300" : "border-slate-300 text-slate-500 hover:bg-slate-50",
      )}
    >
      {label}
    </button>
  );
}

function ContractRow({ c }: { c: Contract }) {
  const [open, setOpen] = useState(false);
  const allDelivered = c.deliveryPlan.length === 0;
  return (
    <>
      <div className="grid grid-cols-[110px_90px_minmax(0,1fr)_80px_70px_120px_100px_170px_150px_40px] items-center gap-3 px-5 py-3 text-sm">
        <span className="font-medium text-slate-700">{c.code}</span>
        <span className="text-slate-600">{c.supplier}</span>
        <span className="truncate text-slate-600">{c.materialName}</span>
        <span className="tabular-nums text-slate-600">{c.quantity}</span>
        <span className="tabular-nums text-slate-600">{c.delivered}</span>
        <ProgressBar delivered={c.delivered} total={c.quantity} />
        <span className="tabular-nums font-medium text-slate-800">{fmtMoney(c.amount)}</span>
        <ContractApprovalPill status={c.contractApproval} />
        <PaymentPill status={c.paymentApproval} />
        <button type="button" onClick={() => setOpen((v) => !v)} className="justify-self-end rounded p-1 text-slate-400 hover:bg-slate-50">
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {/* 演示模拟按钮行 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-slate-100 bg-slate-50/40 px-5 py-2">
        <span className="text-[11px] text-slate-400">演示模拟（正式版由企微回调 / 入库录入触发）：</span>
        <SimButton label="模拟企微审批通过" onClick={() => procActions.simContractApproval(c.id)} disabled={c.contractApproval !== "approving"} />
        <SimButton label={allDelivered ? "已全部到货" : "模拟一批到货"} onClick={() => procActions.simDelivery(c.id)} disabled={allDelivered} />
        <SimButton label="模拟付款审批通过" onClick={() => procActions.simPayment(c.id)} disabled={c.paymentApproval === "approved"} />
      </div>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-x-8 gap-y-1 text-xs text-slate-500">
            <span>供应商：<b className="text-slate-700">{c.supplier}</b></span>
            <span>物料：<b className="text-slate-700">{c.materialName}</b></span>
            <span>合同数量：<b className="tabular-nums text-slate-700">{c.quantity}</b></span>
            <span>已到货：<b className="tabular-nums text-slate-700">{c.delivered}</b></span>
            <span>剩余在途：<b className="tabular-nums text-slate-700">{c.quantity - c.delivered}</b></span>
            <span>合同金额：<b className="tabular-nums text-slate-700">{fmtMoney(c.amount)}</b></span>
            {c.relatedRequirementId && <span>关联需求：<b className="text-slate-700">{c.relatedRequirementId}</b></span>}
          </div>
          <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="mb-2 text-xs font-semibold text-slate-500">到货记录</div>
            {c.deliveries.length === 0 ? (
              <div className="text-xs text-slate-400">暂无到货</div>
            ) : (
              <ul className="space-y-1.5">
                {c.deliveries.map((d, i) => (
                  <li key={i} className="flex items-center gap-3 text-xs text-slate-600">
                    <span className="rounded bg-white px-1.5 py-0.5 text-slate-500 ring-1 ring-slate-200">{d.batch}</span>
                    <span className="tabular-nums">{d.date}</span>
                    <span className="tabular-nums font-medium">+{d.qty}</span>
                    <span className="text-slate-400">{d.operator}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-slate-500">付款记录</div>
            {c.payments.length === 0 ? (
              <div className="text-xs text-slate-400">未发起付款</div>
            ) : (
              <ul className="space-y-1.5">
                {c.payments.map((p, i) => (
                  <li key={i} className="flex items-center gap-3 text-xs text-slate-600">
                    <span>{p.label}</span>
                    <span className="text-slate-400">{p.ratio}</span>
                    <span className="tabular-nums font-medium">{fmtMoney(p.amount)}</span>
                    <span className={cn("rounded px-1.5 py-0.5", p.status === "approved" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
                      {p.status === "approved" ? "已通过" : "审批中"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ContractsPage() {
  const { contracts } = useProc();
  const [page, setPage] = useState(1);
  const paged = contracts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <div className="mx-auto w-full max-w-[1600px] p-4">
      <DemoControls />
      <PageHeader
        Icon={ScrollText}
        badge="Contract Ledger"
        title="采购合同台账"
        description="合同审批（企微）、分批到货与付款审批统一台账。展开行可查看到货明细与付款记录。"
      />
      <div className="mb-3 grid grid-cols-4 gap-3">
        <StatCard label="合同总数" value={contracts.length} hint="全部采购合同" Icon={ScrollText} />
        <StatCard label="审批中" value={contracts.filter((c) => c.contractApproval === "approving").length} tone="amber" hint="待企微审批生效" Icon={FileCheck2} />
        <StatCard label="在途数量合计" value={contracts.reduce((s, c) => s + (c.quantity - c.delivered), 0)} tone="indigo" hint="合同数量 − 已到货" Icon={Truck} />
        <StatCard label="合同金额合计" value={fmtMoney(contracts.reduce((s, c) => s + c.amount, 0))} tone="emerald" Icon={Coins} />
      </div>
      <div className="material-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">合同列表</h2>
          <span className="text-xs text-slate-400">共 {contracts.length} 份合同</span>
        </div>

        <div className="grid grid-cols-[110px_90px_minmax(0,1fr)_80px_70px_120px_100px_170px_150px_40px] items-center gap-3 bg-slate-50/60 px-5 py-2 text-xs font-medium text-slate-400">
          <span>合同编号</span>
          <span>供应商</span>
          <span>物料</span>
          <span className="inline-flex items-center gap-1">
            合同数量
          </span>
          <span>已到货</span>
          <span className="inline-flex items-center gap-1">
            剩余在途
            <span className="group relative">
              <HelpCircle className="h-3 w-3 text-slate-300" />
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white group-hover:block">
                剩余在途 = 合同数量 − 已到货
              </span>
            </span>
            <ReviewTag item={REVIEW_ITEMS[3]} />
          </span>
          <span>合同金额</span>
          <span className="inline-flex items-center gap-1">
            合同审批
            <ReviewTag item={REVIEW_ITEMS[2]} />
          </span>
          <span>付款审批</span>
          <span />
        </div>

        <div className="divide-y divide-slate-100">
          {paged.map((c) => (
            <ContractRow key={c.id} c={c} />
          ))}
        </div>
        <Pager page={page} pageSize={PAGE_SIZE} total={contracts.length} onPage={setPage} />
      </div>
    </div>
  );
}
