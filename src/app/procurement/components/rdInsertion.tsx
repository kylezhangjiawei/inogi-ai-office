// 研发侧「转采购」静态插入组件：AI 预填弹窗 / 无附件阻断弹窗 / 关联采购 chip / 采购动态时间线。
// 供 RDTaskManagementPage 挂载，全部静态 + stageToast，不改研发驾驶舱既有逻辑。
import { useState } from "react";
import { AlertTriangle, ExternalLink, Sparkles, Upload, X } from "lucide-react";
import { stageToast } from "./common";

/** 已关联采购的研发任务（按标题映射到采购任务，静态演示钩子）。 */
export const PROC_LINK_MAP: Record<string, { procTaskId: string; code: string; statusLabel: string; events: { at: string; text: string }[] }> = {
  "新压缩机950减震垫选型": {
    procTaskId: "PR-001",
    code: "PR-20260703-001",
    statusLabel: "部分到货",
    events: [
      { at: "2026-06-18", text: "已生成采购任务 PR-20260703-001" },
      { at: "2026-06-24", text: "样品已到，研发测试" },
      { at: "2026-06-26", text: "测试通过，已定价" },
      { at: "2026-06-28", text: "已下单（预计到货 07-15），第1批到货 +800" },
    ],
  },
};

/** 关联采购 chip：点击跳采购驾驶舱对应任务。 */
export function ProcurementLinkChip({ title, onJump }: { title: string; onJump: (procTaskId: string) => void }) {
  const link = PROC_LINK_MAP[title];
  if (!link) return null;
  return (
    <button type="button" onClick={() => onJump(link.procTaskId)} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100">
      关联采购：{link.statusLabel}
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}

/** 采购动态时间线（已关联任务）。 */
export function ProcurementActivitySection({ title }: { title: string }) {
  const link = PROC_LINK_MAP[title];
  if (!link) return null;
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="mb-2 text-sm font-semibold text-indigo-700">采购动态</div>
      <ul className="space-y-2">
        {link.events.map((e, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
            <div><div className="text-slate-600">{e.text}</div><div className="text-[11px] text-slate-400">{e.at}</div></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 无附件阻断弹窗。 */
export function AttachmentBlockModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50/70 px-6 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600"><AlertTriangle className="h-5 w-5" /></span>
          <div><h3 className="text-base font-bold text-slate-900">转采购需携带图纸</h3><p className="mt-0.5 text-sm text-slate-500">转采购必须携带二维/三维图纸，请先上传附件</p></div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center hover:border-indigo-300">
            <Upload className="h-8 w-8 text-indigo-400" />
            <span className="text-sm font-medium text-slate-600">上传二维/三维图纸</span>
            <span className="text-[11px] text-slate-400">支持 PDF / DWG / STEP 等</span>
            <input type="file" className="hidden" onChange={stageToast} />
          </label>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-6 py-3"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">关闭</button></div>
      </div>
    </div>
  );
}

/** 转采购 AI 预填弹窗。 */
export function TransferToProcurementModal({ taskTitle, owner, onClose }: { taskTitle: string; owner: string; onClose: () => void }) {
  const [f, setF] = useState({ materialName: taskTitle.replace(/选型|测试|复核|反馈|核查|调整|完善|沟通/g, "").trim() || taskTitle, spec: "", quantity: "", needDate: "2026-07-20", deadline: "2026-07-18", link: "", rdContact: owner, note: "" });
  const field = (k: keyof typeof f, label: string, ph = "", hint?: string) => (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={ph} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><h3 className="text-base font-bold text-slate-900">转采购 · 生成采购任务</h3><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button></div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" />AI 已从任务标题、描述与附件中提取以下信息，请确认或修改</div>
          <div className="grid grid-cols-2 gap-3">
            {field("materialName", "物料名称")}
            {field("spec", "规格", "如 50×20mm 橡胶")}
            {field("quantity", "数量", "如 2000")}
            {field("needDate", "需求日期")}
            {field("deadline", "Deadline")}
            {field("link", "购买链接（选填）", "https://…", "填写后自动转为电商直购")}
            {field("rdContact", "研发对接人")}
            <label className="block">
              <span className="text-xs font-medium text-slate-500">图纸附件</span>
              <div className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600"><input type="checkbox" checked readOnly className="accent-indigo-600" />已勾选带入图纸附件</div>
            </label>
            <label className="col-span-2 block">
              <span className="text-xs font-medium text-slate-500">低值易耗品备注</span>
              <input value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} placeholder="如为低值易耗品可备注按年用量备货" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3"><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button><button type="button" onClick={() => { stageToast(); onClose(); }} className="material-button-primary px-4 py-2 text-sm">确认生成采购任务</button></div>
      </div>
    </div>
  );
}
