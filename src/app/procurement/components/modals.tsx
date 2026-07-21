// 采购模块弹窗/面板：AI建单 / 新建需求 / 批量导入 / 审核队列 / 分类管理。均为静态展示 + stageToast。
import { useState } from "react";
import { Sparkles, Upload, X } from "lucide-react";
import { cn } from "../../components/ui/utils";
import { MATERIALS } from "../../../mock/procurement";
import { stageToast } from "./common";
import { AutoTranslatedText } from "../../components/TranslatableText";
import { useI18n } from "../../lib/i18n";

function Shell({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cn("w-full overflow-hidden rounded-2xl bg-white shadow-2xl", wide ? "max-w-2xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-bold text-slate-900">{t(title)}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** AI 建单：粘贴文字/商品链接，AI 解析生成任务（静态）。 */
export function AiCreateModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  return (
    <Shell title={t("AI 建单")} onClose={onClose} footer={<><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button><button type="button" onClick={() => { stageToast(); onClose(); }} className="material-button-primary px-4 py-2 text-sm">{t('解析生成任务')}</button></>}>
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" />{t('粘贴文字或商品链接，AI 将解析生成采购任务（物料、规格、数量、方式等）。')}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={t('例：采购 减震垫 DZC-950 橡胶 50×20mm 2000 件，7 月中旬前到货；或粘贴电商商品链接…')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300" />
    </Shell>
  );
}

/** 新建需求：3 必填 + 折叠更多（静态）。 */
export function NewRequirementModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const field = (label: string, req?: boolean, ph = "") => (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{t(label)}{req && <span className="ml-0.5 text-rose-500">*</span>}</span>
      <input placeholder={ph ? t(ph) : ''} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
    </label>
  );
  return (
    <Shell title={t("新建采购需求")} onClose={onClose} footer={<><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button><button type="button" onClick={() => { stageToast(); onClose(); }} className="material-button-primary px-4 py-2 text-sm">{t('提交')}</button></>}>
      <div className="grid grid-cols-2 gap-3">
        {field("物料名称", true, "如 减震垫 DZC-950")}
        {field("数量", true, "如 2000")}
        {field("需求日期", true, "2026-07-16")}
      </div>
      <button type="button" onClick={() => setMore((v) => !v)} className="mt-3 text-xs font-medium text-indigo-600">{t(more ? "收起更多字段 ▲" : "展开更多字段 ▼")}</button>
      {more && <div className="mt-2 grid grid-cols-2 gap-3">{field("规格")}{field("单位")}{field("Deadline")}{field("采购方式（询价/直购）")}{field("商品链接（直购）")}{field("研发对接人")}</div>}
    </Shell>
  );
}

/** 批量导入物料：Excel 模板字段说明 + 上传区（静态）。 */
export function ImportMaterialsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Shell title={t("批量导入物料")} onClose={onClose} footer={<><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('取消')}</button><button type="button" onClick={() => { stageToast(); onClose(); }} className="material-button-primary px-4 py-2 text-sm">{t('确认导入')}</button></>}>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center hover:border-indigo-300">
        <Upload className="h-8 w-8 text-indigo-400" />
        <span className="text-sm font-medium text-slate-600">{t('点击或拖拽 Excel 文件到此处')}</span>
        <span className="text-[11px] text-slate-400">{t('支持 .xlsx，按下方模板字段解析')}</span>
        <input type="file" accept=".xlsx" className="hidden" onChange={stageToast} />
      </label>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">{t('模板列：物料名称 / 规格 / 单位 / 分类 / 产品线 / ERP编码 / 是否特殊物料 / 期初库存 / 最新报价 / 最新供应商')}</div>
    </Shell>
  );
}

/** 审核队列：列出 pending 物料 + 来源标签 + 通过/驳回（静态）。 */
export function ReviewQueueDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const pending = MATERIALS.filter((m) => m.reviewStatus === "pending");
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-full w-[560px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><h3 className="text-base font-bold text-slate-900">{t('物料审核队列（{count}）', { count: pending.length })}</h3><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button></div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
          {pending.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">{t('暂无待审核物料')}</div> : pending.map((m) => (
            <div key={m.id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
              <div className="flex items-center justify-between">
                <AutoTranslatedText className="text-sm font-semibold text-slate-800" text={`${m.name} · ${m.spec}`} />
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">{t(m.reviewSource === "import" ? "来源：导入" : "来源：任务沉淀")}</span>
              </div>
              <AutoTranslatedText as="div" className="mt-1 text-xs text-slate-500" text={`${m.category} · ${m.productLine} · ERP ${m.erpCode}`} />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={stageToast} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">{t('通过')}</button>
                <button type="button" onClick={stageToast} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">{t('驳回')}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 分类管理弹窗（纯展示分类列表）。 */
export function CategoryManageModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const byCat = new Map<string, number>();
  for (const m of MATERIALS) byCat.set(m.category, (byCat.get(m.category) ?? 0) + 1);
  return (
    <Shell title={t("分类管理")} onClose={onClose} footer={<button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t('关闭')}</button>}>
      <div className="grid grid-cols-2 gap-2">
        {Array.from(byCat.entries()).map(([c, n]) => (
          <div key={c} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"><AutoTranslatedText className="text-slate-700" text={c} /><span className="text-xs text-slate-400">{t('{count} 物料', { count: n })}</span></div>
        ))}
      </div>
    </Shell>
  );
}
