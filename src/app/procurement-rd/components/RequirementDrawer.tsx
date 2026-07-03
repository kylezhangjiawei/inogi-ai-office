// 场景3 · 需求详情抽屉（右滑，720px）：步骤条 + 下一步操作卡（核心交互）+ 基本信息 +
// 报价区 + 样品测试区 + 操作日志。演示全流程状态自动流转，无需手动改状态。
import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, ChevronDown, ExternalLink, FlaskConical, PackageCheck, Send, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { procActions, useProc } from "../store";
import { REVIEW_ITEMS } from "../data/mockData";
import type { Requirement } from "../data/types";
import { PlaceholderImage, ReviewTag, SourceTag, StatusPill, StepBar, fmtMoney } from "./common";
import { QuotationList } from "./QuotationList";
import { PriceHistoryModal } from "./PriceHistoryModal";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-24 shrink-0 text-slate-400">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}

export function RequirementDrawer({ reqId, onClose }: { reqId: string; onClose: () => void }) {
  const { requirements } = useProc();
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [failing, setFailing] = useState(false);

  const req = requirements.find((r) => r.id === reqId);
  if (!req) return null;
  const selectedQuote = req.quotes.find((q) => q.id === req.selectedQuoteId);

  // 下一步操作卡：当前该做什么 + 谁来做 + 主/次按钮
  const next = (() => {
    switch (req.status) {
      case "draft":
        return { who: "采购负责人", desc: "补全需求信息后提交，进入询价环节。", primary: { label: "提交需求", icon: Send, onClick: () => procActions.submit(req.id) } };
      case "pending_inquiry":
        return { who: "采购负责人", desc: "向供应商询价，在下方报价区「录报价」录入各家报价。" };
      case "inquiring":
        return { who: "采购负责人", desc: "对比各供应商报价（含历史价格参考），选定一条「选定并要样」。" };
      case "pending_sample":
        return { who: "采购负责人 → 研发对接人", desc: "样品到货后点击「样品已到」，系统自动通知研发对接人安排测试。", primary: { label: "样品已到", icon: PackageCheck, onClick: () => procActions.sampleArrived(req.id) } };
      case "testing":
        return { who: "研发对接人", desc: "研发完成样品测试后反馈结果。", primary: { label: "测试通过", icon: FlaskConical, onClick: () => procActions.testPass(req.id) }, secondary: { label: "测试不通过", onClick: () => setFailing(true) } };
      case "priced":
        return { who: "采购负责人", desc: "已定价，可进入合同流程生成采购合同。", primary: { label: "进入合同流程", icon: ArrowRight, onClick: () => { procActions.toContract(req.id); navigate("/proc-contracts"); onClose(); } } };
      case "pending_contract":
        return { who: "采购负责人 / 财务", desc: "合同流程进行中（企微审批），前往合同台账查看审批与到货。", primary: { label: "前往合同台账", icon: ExternalLink, onClick: () => { navigate("/proc-contracts"); onClose(); } } };
      default:
        return { who: "—", desc: "" };
    }
  })();

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-full w-[720px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900">{req.code}</h3>
              <StatusPill status={req.status} />
              <SourceTag source={req.source} />
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {req.materialName} · {req.spec} · {req.quantity}
            {req.unit}
          </div>
          <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
            <StepBar current={req.status} />
            <ReviewTag item={REVIEW_ITEMS[1]} className="ml-2 shrink-0" />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* 下一步操作卡 */}
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-indigo-500">下一步 · 责任人：{next.who}</div>
            </div>
            <p className="mt-1 text-sm text-slate-700">{next.desc}</p>
            {(next.primary || next.secondary) && (
              <div className="mt-3 flex items-center gap-2">
                {next.primary && (
                  <button type="button" onClick={next.primary.onClick} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm">
                    {next.primary.icon && <next.primary.icon className="h-4 w-4" />}
                    {next.primary.label}
                  </button>
                )}
                {next.secondary && (
                  <button type="button" onClick={next.secondary.onClick} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                    {next.secondary.label}
                  </button>
                )}
              </div>
            )}
            {failing && (
              <div className="mt-3 flex items-end gap-2">
                <input value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="填写测试不通过原因" className="h-8 flex-1 rounded-md border border-slate-200 px-2 text-sm" />
                <button type="button" onClick={() => { procActions.testFail(req.id, failReason || "样品不达标"); setFailing(false); setFailReason(""); }} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">
                  记录
                </button>
              </div>
            )}
          </div>

          {/* 基本信息 */}
          <div className="rounded-xl border border-slate-100 p-4">
            <div className="mb-1 text-sm font-semibold text-slate-700">基本信息</div>
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <InfoRow label="需求编号" value={req.code} />
                <InfoRow label="物料名称" value={req.materialName} />
                <InfoRow label="规格" value={req.spec} />
                <InfoRow label="数量" value={`${req.quantity} ${req.unit}`} />
                <InfoRow label="期望到货" value={req.expectedDate} />
                <InfoRow label="用途说明" value={req.useDesc ?? "—"} />
              </div>
              <div>
                <InfoRow label="采购负责人" value={req.owner} />
                <InfoRow label="研发对接人" value={req.rdContact ?? "—"} />
                <InfoRow label="创建时间" value={req.createdAt} />
                <InfoRow label="更新时间" value={req.updatedAt} />
                {req.source === "rd" && req.relatedRdTaskId && (
                  <InfoRow
                    label="关联研发任务"
                    value={
                      <button type="button" onClick={() => { navigate(`/proc-rd-dashboard?task=${req.relatedRdTaskId}`); onClose(); }} className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                        查看任务 <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                )}
                {req.relatedContractId && (
                  <InfoRow
                    label="关联合同"
                    value={
                      <button type="button" onClick={() => { navigate("/proc-contracts"); onClose(); }} className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                        {req.relatedContractId} <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                )}
              </div>
            </div>
            {req.hasAttachment && (
              <div className="mt-3 flex items-center gap-3">
                <PlaceholderImage label="图纸附件.pdf" className="h-16 w-16" />
                <PlaceholderImage label="规格书.png" className="h-16 w-16" />
              </div>
            )}
          </div>

          {/* 报价区 */}
          <QuotationList req={req} onOpenHistory={() => setHistoryOpen(true)} />

          {/* 样品与测试区 */}
          {(req.status === "pending_sample" || req.status === "testing" || req.status === "priced" || req.status === "pending_contract") && (
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">样品与测试</div>
              <InfoRow label="打样报价" value={selectedQuote ? `${selectedQuote.supplier} · ${fmtMoney(selectedQuote.unitPrice)} · 交期${selectedQuote.leadDays}天` : "—"} />
              <InfoRow label="到样时间" value={req.sampleArrivedAt ?? "待到样"} />
              <InfoRow label="测试结论" value={req.testConclusion ?? "测试中"} />
            </div>
          )}

          {/* 操作日志（默认折叠） */}
          <div className="rounded-xl border border-slate-100">
            <button type="button" onClick={() => setLogsOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-slate-700">
              操作日志（{req.logs.length}）
              <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", logsOpen && "rotate-180")} />
            </button>
            {logsOpen && (
              <ul className="space-y-2 border-t border-slate-100 px-4 py-3">
                {req.logs.map((l) => (
                  <li key={l.id} className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 text-xs text-slate-400">{l.at}</span>
                    <span className="text-slate-600">{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <PriceHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
