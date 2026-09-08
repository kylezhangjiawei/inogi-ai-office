import { useMemo, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import { useI18n } from "../../lib/i18n";
import { DateInput } from "./common";

const EMPTY_SELECTION = "__stock_plan_empty__";

type StockPlanSelectProps = {
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  emptyLabel?: string;
  disabled?: boolean;
  required?: boolean;
  searchable?: boolean;
  className?: string;
};

// 只组合项目现有控件；空选项仅在 UI 层编码，表单和 API 始终使用空串。
export function StockPlanSelect({ id, label, value, onValueChange, options, emptyLabel, disabled, required, searchable, className }: StockPlanSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedLabel = options.find((option) => option.value === value)?.label;
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return options.filter((option) => !keyword || option.label.toLowerCase().includes(keyword)).slice(0, 100);
  }, [options, search]);

  if (searchable) return (
    <Popover modal open={!disabled && open} onOpenChange={(next) => { setOpen(next); if (next) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} aria-label={label}
          className={cn("w-full min-w-0 justify-between bg-input-background px-3 font-normal", className)} title={selectedLabel}>
          <span className="min-w-0 truncate">{selectedLabel || value || emptyLabel || t("请选择")}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="horizon-theme horizon-portal w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1.5rem)] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} aria-label={t("搜索{label}", { label })} placeholder={t("搜索名称、编码或规格")} />
          <CommandList className="max-h-64">
            <CommandEmpty>{t("没有匹配的选项")}</CommandEmpty>
            {emptyLabel && !search && <CommandItem value={EMPTY_SELECTION} onSelect={() => { onValueChange(""); setOpen(false); }}>{emptyLabel}</CommandItem>}
            {filtered.map((option) => <CommandItem key={option.value} value={option.value}
              onSelect={() => { onValueChange(option.value); setOpen(false); }}>
              <span className="min-w-0 whitespace-normal break-words">{option.label}</span>
              {value === option.value && <Check aria-hidden="true" className="ml-auto size-4 shrink-0" />}
            </CommandItem>)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  return (
    <Select value={value || (required ? "" : EMPTY_SELECTION)} disabled={disabled} required={required}
      onValueChange={(next) => onValueChange(next === EMPTY_SELECTION ? "" : next)}>
      <SelectTrigger id={id} aria-label={label} className={className}><SelectValue placeholder={emptyLabel || t("请选择")} /></SelectTrigger>
      <SelectContent className="horizon-theme horizon-portal">
        {!required && emptyLabel && <SelectItem value={EMPTY_SELECTION}>{emptyLabel}</SelectItem>}
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function StockPlanDateInput({ id, label, value, onChange, disabled }: {
  id?: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  return <DateInput id={id} ariaLabel={label} value={value} onChange={onChange} disabled={disabled} />;
}

// 月份筛选沿用 YYYY-MM / 空串协议，用项目 Popover 与 Button 呈现月份选择。
export function StockPlanMonthInput({ id, label, value, onChange, className }: {
  id?: string; label: string; value: string; onChange: (value: string) => void; className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());
  return (
    <Popover open={open} onOpenChange={(next) => { if (next) setYear(Number(value.slice(0, 4)) || new Date().getFullYear()); setOpen(next); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" aria-label={label} className={cn("justify-between bg-input-background font-normal tabular-nums", className)}>
          {value || t("全部月份")}<CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="horizon-theme horizon-portal w-64 max-w-[calc(100vw-1.5rem)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="icon" disabled={year <= 1} aria-label={t("上一年")} onClick={() => setYear((current) => current - 1)}><ChevronLeft className="size-4" /></Button>
          <span aria-live="polite" className="text-sm font-semibold tabular-nums">{year}</span>
          <Button type="button" variant="ghost" size="icon" disabled={year >= 9999} aria-label={t("下一年")} onClick={() => setYear((current) => current + 1)}><ChevronRight className="size-4" /></Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, index) => {
            const month = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
            return <Button key={month} type="button" variant={value === month ? "secondary" : "ghost"} aria-pressed={value === month} aria-label={month}
              onClick={() => { onChange(month); setOpen(false); }}>{t("{month}月", { month: index + 1 })}</Button>;
          })}
        </div>
        <Button type="button" variant="ghost" className="mt-3 w-full" onClick={() => { onChange(""); setOpen(false); }}>{t("全部月份")}</Button>
      </PopoverContent>
    </Popover>
  );
}
