// 供应商报价新增/编辑抽屉：厂家（可选已有供应商或直接输入新厂家）+ 交期/币种/含税/有效期 + 阶梯价行编辑。
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../../components/ui/input";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "../../components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../components/ui/utils";
import { ComboInput, DateInput, ImageLightbox } from "./common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useI18n } from "../../lib/i18n";
import {
  createSupplierQuote,
  listQuoteSuppliers,
  updateSupplierQuote,
  uploadProcurementAttachment,
  type SupplierOption,
  type SupplierQuote,
  type UpsertSupplierQuoteInput,
} from "../../lib/procurementApi";
import { AutoTranslatedText } from "../../components/TranslatableText";

interface TierRow {
  minQty: string;
  unitPrice: string;
}

type QuoteFormErrors = Partial<Record<"supplier" | "leadTime" | "tiers" | "image" | "submit", string>>;

const FIELD = "mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#8fa9e8]";
const LABEL = "text-xs font-medium text-slate-500";

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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
  const [formErrors, setFormErrors] = useState<QuoteFormErrors>({});
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [form, setForm] = useState(() => ({
    supplierName: quote?.supplierName ?? "",
    supplierModel: quote?.supplierModel ?? "",
    currency: quote?.currency ?? "CNY",
    taxIncluded: quote?.taxIncluded ?? true,
    leadTimeDays: quote != null && quote.leadTimeDays > 0 ? String(quote.leadTimeDays) : "",
    quoteDate: quote?.quoteDate ?? localToday(),
    validUntil: quote?.validUntil ?? "",
    note: quote?.note ?? "",
  }));
  const [tiers, setTiers] = useState<TierRow[]>(() =>
    quote && quote.tiers.length > 0
      ? quote.tiers.map((tier) => ({ minQty: tier.minQty > 0 ? String(tier.minQty) : "", unitPrice: String(tier.unitPrice) }))
      : [{ minQty: "", unitPrice: "" }],
  );
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  // 商品图片：undefined=保持不变；""=移除；其他=新上传的 OSS key
  const imageInputRef = useRef<HTMLInputElement>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const submitBusyRef = useRef(false);
  const [imageKeyPatch, setImageKeyPatch] = useState<string | undefined>(undefined);
  const [imagePreview, setImagePreview] = useState<string | null>(quote?.imageUrl ?? null);
  const [imageBusy, setImageBusy] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      const message = t("请选择图片文件");
      setFormErrors((current) => ({ ...current, image: message }));
      toast.error(message);
      return;
    }
    setFormErrors((current) => ({ ...current, image: undefined, submit: undefined }));
    setImageBusy(true);
    try {
      const uploaded = await uploadProcurementAttachment(file);
      setImageKeyPatch(uploaded.objectKey);
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
      const localPreviewUrl = uploaded.signedUrl ? null : URL.createObjectURL(file);
      localPreviewUrlRef.current = localPreviewUrl;
      setImagePreview(uploaded.signedUrl ?? localPreviewUrl);
      toast.success(t("图片已上传，点击下方「保存」后生效"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("图片上传失败");
      setFormErrors((current) => ({ ...current, image: message }));
      toast.error(message);
    } finally {
      setImageBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void listQuoteSuppliers().then((list) => { if (alive) setSuppliers(list); }).catch(() => undefined);
    return () => {
      alive = false;
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
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
    if (submitBusyRef.current) return;
    setFormErrors({});
    const supplierName = form.supplierName.trim();
    if (!supplierName) {
      const message = t("请填写厂家名称");
      setFormErrors({ supplier: message });
      toast.error(message);
      return;
    }
    const parsed: { minQty: number; unitPrice: number }[] = [];
    for (const [index, row] of tiers.entries()) {
      if (!row.minQty.trim() && !row.unitPrice.trim()) continue; // 整行留空 = 该档不报（对应报价单里的「/」）
      const minQty = row.minQty.trim() ? Number(row.minQty) : 0;
      const unitPrice = Number(row.unitPrice);
      if (!Number.isFinite(minQty) || minQty < 0) {
        const message = t("第 {index} 档起订量必须是不小于 0 的数字", { index: index + 1 });
        setFormErrors({ tiers: message });
        toast.error(message);
        return;
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        const message = t("第 {index} 档单价必须是大于 0 的数字", { index: index + 1 });
        setFormErrors({ tiers: message });
        toast.error(message);
        return;
      }
      parsed.push({ minQty, unitPrice });
    }
    if (parsed.length === 0) {
      const message = t("请至少填写一档报价");
      setFormErrors({ tiers: message });
      toast.error(message);
      return;
    }
    const leadTimeDays = form.leadTimeDays.trim() ? Number(form.leadTimeDays) : 0;
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) {
      const message = t("交期天数必须是不小于 0 的数字");
      setFormErrors({ leadTime: message });
      toast.error(message);
      return;
    }
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
      // undefined 不进 JSON → 后端保持原图不动
      imageKey: imageKeyPatch,
    };
    submitBusyRef.current = true;
    setBusy(true);
    try {
      if (quote) await updateSupplierQuote(quote.id, input);
      else await createSupplierQuote(input);
      toast.success(t(quote ? "报价已更新" : "厂家报价已添加"));
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("保存失败");
      setFormErrors({ submit: message });
      toast.error(message);
    } finally {
      submitBusyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !busy && !imageBusy) onClose(); }}>
      <SheetContent side="right" className="proc-horizon-drawer w-full max-w-full gap-0 p-0 pb-[env(safe-area-inset-bottom)] sm:w-[560px] sm:max-w-[560px]">
        <SheetHeader className="border-b border-slate-100 px-6 py-4">
          <SheetTitle className="text-balance text-base font-bold text-slate-900">{t(quote ? "编辑厂家报价" : "添加厂家报价")}</SheetTitle>
          <SheetDescription className="mt-0.5 text-pretty text-sm text-slate-500"><AutoTranslatedText text={material.name} /></SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
            {[
              t("1 供应商与条款"),
              t("2 阶梯报价"),
              t("3 保存生效"),
            ].map((step, index) => (
              <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums", index === 0 ? "border-[#002fa7] bg-[#002fa7] text-white" : "border-slate-200 bg-white text-slate-500")}>{index + 1}</span>
                <span className="truncate">{step.replace(/^\d\s/, "")}</span>
              </div>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-[#eef3ff] text-[10px] font-bold tabular-nums text-[#002fa7]">1</span><h3 className="text-balance text-sm font-semibold text-slate-800">{t("供应商与报价条款")}</h3></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="col-span-2 block">
              <span className={LABEL}>{t("厂家名称")}<span className="ml-0.5 text-rose-500">*</span></span>
              <ComboInput value={form.supplierName} onChange={(value) => { set("supplierName")(value); setFormErrors((current) => ({ ...current, supplier: undefined, submit: undefined })); }} options={supplierOptions} placeholder={t("输入或从已有供应商中选")} className={cn(FIELD, formErrors.supplier && "border-rose-300 focus:border-rose-400")} />
              {formErrors.supplier && <span role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{formErrors.supplier}</span>}
              {form.supplierName.trim() && !supplierId && <span className="mt-1 block text-[11px] text-amber-600">{t("新厂家：保存时将自动创建本地供应商")}</span>}
            </label>
            <label className="block"><span className={LABEL}>{t("厂家型号 / 品牌")}</span><Input value={form.supplierModel} onChange={(e) => set("supplierModel")(e.target.value)} className={FIELD} /></label>
            <div>
              <span className={LABEL}>{t("币种")}</span>
              <Select value={form.currency} onValueChange={set("currency")}>
                <SelectTrigger aria-label={t("币种")} className="mt-1 h-9 rounded-lg border-slate-200 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="proc-horizon-overlay">
                  <SelectItem value="CNY">CNY ¥</SelectItem>
                  <SelectItem value="USD">USD $</SelectItem>
                  <SelectItem value="EUR">EUR €</SelectItem>
                  <SelectItem value="JPY">JPY ¥</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="block"><span className={LABEL}>{t("交期（天）")}</span><Input aria-invalid={Boolean(formErrors.leadTime)} value={form.leadTimeDays} onChange={(e) => { set("leadTimeDays")(e.target.value); setFormErrors((current) => ({ ...current, leadTime: undefined, submit: undefined })); }} inputMode="numeric" placeholder={t("如 7")} className={cn(FIELD, "tabular-nums", formErrors.leadTime && "border-rose-300 focus:border-rose-400")} />{formErrors.leadTime && <span role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{formErrors.leadTime}</span>}</label>
            <label className="mt-6 inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
              <Checkbox checked={form.taxIncluded} onCheckedChange={(v) => set("taxIncluded")(v === true)} />
              {t("含税价")}
            </label>
            <div><span className={LABEL}>{t("报价日期")}</span><DateInput value={form.quoteDate} onChange={set("quoteDate")} ariaLabel={t("报价日期")} className="mt-1" /></div>
            <div><span className={LABEL}>{t("有效期至")}</span><DateInput value={form.validUntil} onChange={set("validUntil")} ariaLabel={t("有效期至")} className="mt-1" placeholder={t("留空为长期有效")} /></div>
            <label className="col-span-2 block"><span className={LABEL}>{t("备注")}</span><Input value={form.note} onChange={(e) => set("note")(e.target.value)} placeholder={t("如：不含抛光费用")} className={FIELD} /></label>
            {/* 商品图片：导入 .xlsx 可自动带图，这里支持手动上传/更换/移除 */}
            <div className="col-span-2">
              <span className={LABEL}>{t("商品图片")}</span>
              <Input ref={imageInputRef} type="file" accept="image/*" disabled={imageBusy} className="hidden" onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; void pickImage(picked); }} />
              <div className="mt-1 flex items-center gap-3">
                {imagePreview ? (
                  <button
                    type="button"
                    aria-label={t("预览商品图片")}
                    onClick={() => setLightboxOpen(true)}
                    className="size-16 cursor-zoom-in overflow-hidden rounded-lg border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8]"
                  >
                    <img src={imagePreview} alt="" className="size-full object-cover" />
                  </button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={imageBusy}
                    onClick={() => imageInputRef.current?.click()}
                    className="flex size-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:border-[#8fa9e8] hover:text-[#002fa7] disabled:opacity-60"
                  >
                    {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    <span className="text-[10px]">{t("上传")}</span>
                  </Button>
                )}
                {imagePreview && (
                  <div className="flex flex-col gap-1 text-xs">
                    <Button type="button" variant="link" disabled={imageBusy} onClick={() => imageInputRef.current?.click()} className="h-auto justify-start p-0 text-xs text-[#002fa7]">{imageBusy ? t("上传中…") : t("更换图片")}</Button>
                    <Button type="button" variant="ghost" disabled={imageBusy} onClick={() => { if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current); localPreviewUrlRef.current = null; setImageKeyPatch(""); setImagePreview(null); }} className="h-auto justify-start p-0 text-xs text-slate-400 hover:bg-transparent hover:text-rose-500 disabled:opacity-60">{t("移除图片")}</Button>
                  </div>
                )}
              </div>
              {formErrors.image && <p role="alert" className="mt-1 flex items-center gap-1 text-pretty text-[11px] text-rose-700"><AlertTriangle className="size-3 shrink-0" />{formErrors.image}</p>}
            </div>
          </div>

          {/* 阶梯报价：起订量 → 单价，档位可增删 */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><span className="flex size-5 items-center justify-center rounded-full bg-[#eef3ff] text-[10px] font-bold tabular-nums text-[#002fa7]">2</span>{t("阶梯报价")}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => { setTiers((rows) => [...rows, { minQty: "", unitPrice: "" }]); setFormErrors((current) => ({ ...current, tiers: undefined, submit: undefined })); }} className="h-7 rounded-lg border-[#cbd8f6] bg-[#eef3ff] px-2 text-xs text-[#002fa7] hover:bg-[#e3ebff] hover:text-[#002fa7]">
                <Plus className="h-3.5 w-3.5" />{t("加一档")}
              </Button>
            </div>
            <p className="mt-1 text-pretty text-[11px] text-slate-400">{t("起订量留空表示不限起订量；某档不报价直接删除该行即可。")}</p>
            <div className="mt-2 space-y-2">
              {tiers.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input aria-label={t("第 {index} 档起订量", { index: index + 1 })} aria-invalid={Boolean(formErrors.tiers)} value={row.minQty} onChange={(e) => { setTier(index, "minQty", e.target.value); setFormErrors((current) => ({ ...current, tiers: undefined, submit: undefined })); }} inputMode="numeric" placeholder={t("起订量，如 3000")} className={cn("h-9 w-40 rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-[#8fa9e8]", formErrors.tiers && "border-rose-300")} />
                  {material.unit && <span className="text-xs text-slate-400">{material.unit}</span>}
                  <span className="text-slate-300">→</span>
                  <Input aria-label={t("第 {index} 档单价", { index: index + 1 })} aria-invalid={Boolean(formErrors.tiers)} value={row.unitPrice} onChange={(e) => { setTier(index, "unitPrice", e.target.value); setFormErrors((current) => ({ ...current, tiers: undefined, submit: undefined })); }} inputMode="decimal" placeholder={t("单价，如 0.65")} className={cn("h-9 w-36 rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-[#8fa9e8]", formErrors.tiers && "border-rose-300")} />
                  <Button type="button" variant="ghost" size="icon" aria-label={t("删除第 {index} 档报价", { index: index + 1 })} disabled={tiers.length <= 1} onClick={() => { setTiers((rows) => rows.filter((_, i) => i !== index)); setFormErrors((current) => ({ ...current, tiers: undefined, submit: undefined })); }} className="size-8 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            {formErrors.tiers && <p role="alert" className="mt-2 flex items-center gap-1 text-pretty text-xs text-rose-700"><AlertTriangle className="size-3.5 shrink-0" />{formErrors.tiers}</p>}
          </div>
          {formErrors.submit && <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-pretty text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{formErrors.submit}</div>}
        </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <span className="hidden items-center gap-1.5 text-pretty text-xs text-slate-400 sm:flex"><CheckCircle2 className="size-3.5" />{t("3 核对供应商、币种、有效期与各档价格后保存")}</span>
          <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" disabled={busy || imageBusy} onClick={onClose} className="rounded-lg border-slate-200 px-4 py-2 text-sm text-slate-600">{t("取消")}</Button>
          <Button type="button" disabled={busy || imageBusy} onClick={() => void submit()} className="material-button-primary rounded-lg px-4 py-2 text-sm disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? t("正在保存报价…") : t(quote ? "更新厂家报价" : "保存厂家报价")}
          </Button>
          </div>
        </div>
        {lightboxOpen && imagePreview && <ImageLightbox url={imagePreview} onClose={() => setLightboxOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}
