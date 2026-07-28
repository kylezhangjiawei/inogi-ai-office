// 供应商报价新增/编辑抽屉：厂家（可选已有供应商或直接输入新厂家）+ 交期/币种/含税/有效期 + 阶梯价行编辑。
import { useEffect, useMemo, useState } from "react";
import { Input } from "../../components/ui/input";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "../../components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { ComboInput, DateInput } from "./common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useI18n } from "../../lib/i18n";
import {
  createSupplierQuote,
  listQuoteSuppliers,
  updateSupplierQuote,
  type SupplierOption,
  type SupplierQuote,
  type UpsertSupplierQuoteInput,
} from "../../lib/procurementApi";
import { AutoTranslatedText } from "../../components/TranslatableText";

interface TierRow {
  minQty: string;
  unitPrice: string;
}

const FIELD = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300";
const LABEL = "text-xs font-medium text-slate-500";

export function QuoteFormDrawer({
  material, quote, onClose, onSaved,
}: {
  material: { id: string; name: string; unit: string };
  /** 传 quote 为编辑，不传为新增厂家报价 */
  quote?: SupplierQuote;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [form, setForm] = useState(() => ({
    supplierName: quote?.supplierName ?? "",
    supplierModel: quote?.supplierModel ?? "",
    currency: quote?.currency ?? "CNY",
    taxIncluded: quote?.taxIncluded ?? true,
    leadTimeDays: quote != null && quote.leadTimeDays > 0 ? String(quote.leadTimeDays) : "",
    quoteDate: quote?.quoteDate ?? new Date().toISOString().slice(0, 10),
    validUntil: quote?.validUntil ?? "",
    note: quote?.note ?? "",
  }));
  const [tiers, setTiers] = useState<TierRow[]>(() =>
    quote && quote.tiers.length > 0
      ? quote.tiers.map((tier) => ({ minQty: tier.minQty > 0 ? String(tier.minQty) : "", unitPrice: String(tier.unitPrice) }))
      : [{ minQty: "", unitPrice: "" }],
  );
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    let alive = true;
    void listQuoteSuppliers().then((list) => { if (alive) setSuppliers(list); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // 输入的厂家名命中已有供应商时带上 id，避免同名重建
  const supplierId = useMemo(
    () => suppliers.find((s) => s.name === form.supplierName.trim())?.id,
    [suppliers, form.supplierName],
  );
  const supplierOptions = useMemo(() => suppliers.map((s) => s.name), [suppliers]);

  const setTier = (index: number, key: keyof TierRow, value: string) =>
    setTiers((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const submit = async () => {
    const supplierName = form.supplierName.trim();
    if (!supplierName) { toast.error(t("请填写厂家名称")); return; }
    const parsed: { minQty: number; unitPrice: number }[] = [];
    for (const row of tiers) {
      if (!row.minQty.trim() && !row.unitPrice.trim()) continue; // 整行留空 = 该档不报（对应报价单里的「/」）
      const minQty = row.minQty.trim() ? Number(row.minQty) : 0;
      const unitPrice = Number(row.unitPrice);
      if (!Number.isFinite(minQty) || minQty < 0) { toast.error(t("起订量必须是不小于 0 的数字")); return; }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) { toast.error(t("单价必须是大于 0 的数字")); return; }
      parsed.push({ minQty, unitPrice });
    }
    if (parsed.length === 0) { toast.error(t("请至少填写一档报价")); return; }
    const leadTimeDays = form.leadTimeDays.trim() ? Number(form.leadTimeDays) : 0;
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) { toast.error(t("交期天数必须是不小于 0 的数字")); return; }
    const input: UpsertSupplierQuoteInput = {
      materialId: material.id,
      supplierId,
      supplierName,
      supplierModel: form.supplierModel.trim() || undefined,
      currency: form.currency,
      taxIncluded: form.taxIncluded,
      leadTimeDays: Math.round(leadTimeDays),
      tiers: parsed,
      quoteDate: form.quoteDate || undefined,
      validUntil: form.validUntil || undefined,
      note: form.note.trim() || undefined,
    };
    setBusy(true);
    try {
      if (quote) await updateSupplierQuote(quote.id, input);
      else await createSupplierQuote(input);
      toast.success(t(quote ? "报价已更新" : "厂家报价已添加"));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("保存失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[560px] gap-0 p-0 sm:max-w-[560px]" aria-describedby={undefined}>
        <SheetHeader className="border-b border-slate-100 px-6 py-4">
          <SheetTitle className="text-base font-bold text-slate-900">{t(quote ? "编辑厂家报价" : "添加厂家报价")}</SheetTitle>
          <AutoTranslatedText as="p" className="mt-0.5 text-sm text-slate-500" text={material.name} />
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 block">
              <span className={LABEL}>{t("厂家名称")}<span className="ml-0.5 text-rose-500">*</span></span>
              <ComboInput value={form.supplierName} onChange={set("supplierName")} options={supplierOptions} placeholder={t("输入或从已有供应商中选")} className={FIELD} />
              {form.supplierName.trim() && !supplierId && <span className="mt-1 block text-[11px] text-amber-600">{t("新厂家：保存时将自动创建本地供应商")}</span>}
            </label>
            <label className="block"><span className={LABEL}>{t("厂家型号 / 品牌")}</span><Input value={form.supplierModel} onChange={(e) => set("supplierModel")(e.target.value)} className={FIELD} /></label>
            <div>
              <span className={LABEL}>{t("币种")}</span>
              <Select value={form.currency} onValueChange={set("currency")}>
                <SelectTrigger className="mt-1 h-9 rounded-lg border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CNY">CNY ¥</SelectItem>
                  <SelectItem value="USD">USD $</SelectItem>
                  <SelectItem value="EUR">EUR €</SelectItem>
                  <SelectItem value="JPY">JPY ¥</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="block"><span className={LABEL}>{t("交期（天）")}</span><Input value={form.leadTimeDays} onChange={(e) => set("leadTimeDays")(e.target.value)} inputMode="numeric" placeholder={t("如 7")} className={FIELD} /></label>
            <label className="mt-6 inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
              <Checkbox checked={form.taxIncluded} onCheckedChange={(v) => set("taxIncluded")(v === true)} />
              {t("含税价")}
            </label>
            <div><span className={LABEL}>{t("报价日期")}</span><DateInput value={form.quoteDate} onChange={set("quoteDate")} className="mt-1" /></div>
            <div><span className={LABEL}>{t("有效期至")}</span><DateInput value={form.validUntil} onChange={set("validUntil")} className="mt-1" placeholder={t("留空为长期有效")} /></div>
            <label className="col-span-2 block"><span className={LABEL}>{t("备注")}</span><Input value={form.note} onChange={(e) => set("note")(e.target.value)} placeholder={t("如：不含抛光费用")} className={FIELD} /></label>
          </div>

          {/* 阶梯报价：起订量 → 单价，档位可增删 */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">{t("阶梯报价")}</span>
              <button type="button" onClick={() => setTiers((rows) => [...rows, { minQty: "", unitPrice: "" }])} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100">
                <Plus className="h-3.5 w-3.5" />{t("加一档")}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{t("起订量留空表示不限起订量；某档不报价直接删除该行即可。")}</p>
            <div className="mt-2 space-y-2">
              {tiers.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input value={row.minQty} onChange={(e) => setTier(index, "minQty", e.target.value)} inputMode="numeric" placeholder={t("起订量，如 3000")} className="h-9 w-40 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
                  {material.unit && <span className="text-xs text-slate-400">{material.unit}</span>}
                  <span className="text-slate-300">→</span>
                  <Input value={row.unitPrice} onChange={(e) => setTier(index, "unitPrice", e.target.value)} inputMode="decimal" placeholder={t("单价，如 0.65")} className="h-9 w-36 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300" />
                  <button type="button" disabled={tiers.length <= 1} onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">{t("取消")}</button>
          <button type="button" disabled={busy} onClick={() => void submit()} className="material-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t("保存")}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
