import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Command, CommandInput, CommandItem, CommandList } from "../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import { listQuoteSuppliers, type SupplierOption } from "../../lib/procurementApi";
import { Button } from "../../components/ui/button";

export interface TplusSupplierSelectProps {
  id: string;
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  onValidityChange?: (valid: boolean) => void;
}

/** 只选择已同步的 T+ 供应商；搜索文本不作为供应商名称提交。 */
export function TplusSupplierSelect({ id, value, onChange, disabled, onValidityChange }: TplusSupplierSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const validityCallback = useRef(onValidityChange);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSuppliers([]);
    void listQuoteSuppliers(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setSuppliers(list.filter((supplier) => supplier.source === "tplus" && supplier.name.trim()));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : "";
        setError(/[\u3400-\u9fff]/.test(message) ? message : t("供应商目录加载失败，请检查网络后重试"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, t]);

  const valid = Boolean(value) && !loading && !error && suppliers.some((supplier) => supplier.name === value);
  useEffect(() => { validityCallback.current = onValidityChange; }, [onValidityChange]);
  useEffect(() => { validityCallback.current?.(valid); }, [valid, value]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return suppliers.filter((supplier) => `${supplier.name} ${supplier.shortName ?? ""}`.toLowerCase().includes(keyword));
  }, [search, suppliers]);
  const statusId = `${id}-status`;
  const unavailable = !loading && !error && Boolean(value) && !valid;

  return (
    <div className="min-w-0">
      <Popover modal open={open && !disabled} onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
      }}>
        <PopoverTrigger asChild>
          <Button variant="unstyled"
            id={id}
            type="button"
            role="combobox"
            aria-label={t("供应商")}
            aria-expanded={open && !disabled}
            aria-controls={`${id}-options`}
            aria-describedby={statusId}
            aria-invalid={unavailable || Boolean(error)}
            disabled={disabled || loading || Boolean(error) || suppliers.length === 0}
            className={cn("flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8] disabled:cursor-not-allowed disabled:opacity-60", unavailable ? "border-amber-300" : "border-slate-200")}
          >
            <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>{value || t("请选择畅捷通供应商")}</span>
            {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="horizon-theme horizon-portal proc-horizon-overlay w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch} disabled={disabled} placeholder={t("搜索供应商名称或简称")} aria-label={t("搜索供应商名称或简称")} />
            <CommandList id={`${id}-options`}>
              {filtered.length === 0 ? (
                <p role="status" className="px-3 py-6 text-center text-pretty text-sm text-slate-500">{t("没有匹配的供应商，请更换关键词")}</p>
              ) : filtered.map((supplier) => (
                <CommandItem key={supplier.id} value={supplier.id} disabled={disabled} onSelect={() => {
                  if (disabled) return;
                  onChange(supplier.name);
                  setOpen(false);
                }}>
                  <Check className={cn("size-4 shrink-0", supplier.name === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{supplier.name}</span>
                    {supplier.shortName && <span className="block truncate text-xs text-muted-foreground">{supplier.shortName}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <div id={statusId} className="mt-1 text-pretty text-xs">
        {loading ? <p role="status" className="text-slate-500">{t("正在读取畅捷通供应商目录…")}</p> : error ? (
          <div role="alert" className="text-rose-700">
            <p>{error}</p>
            <Button variant="unstyled" type="button" disabled={disabled} onClick={() => setReload((attempt) => attempt + 1)} className="mt-1 rounded px-1 py-1 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fa9e8] disabled:opacity-50">{t("重新加载供应商")}</Button>
          </div>
        ) : suppliers.length === 0 ? (
          <p role="status" className="text-amber-700">{t("暂无已同步的畅捷通供应商，请联系管理员先同步供应商目录")}</p>
        ) : <p className="text-slate-500">{t("供应商来自已同步的畅捷通 T+ 目录")}</p>}
        {unavailable && <p role="alert" className="mt-1 text-amber-700">{t("原供应商不在畅捷通目录中，请从目录重新选择")}</p>}
      </div>
    </div>
  );
}
