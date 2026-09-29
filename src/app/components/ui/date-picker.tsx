import { forwardRef, useState, type ComponentProps } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from './utils';
import { useI18n } from '../../lib/i18n';
import { formatDateOnly, parseDateOnly } from '../../lib/dateOnly';
import { Input } from './input';

type DatePickerProps = Omit<ComponentProps<typeof Button>, 'value' | 'defaultValue' | 'onChange' | 'children'> & {
  value: string;
  onValueChange: (value: string) => void;
  'aria-label'?: string;
  min?: string;
  max?: string;
  readOnly?: boolean;
};

/** Filters and form fields share the same calendar; typed dates support distant years. */
export const DatePicker = forwardRef<HTMLButtonElement, DatePickerProps>(function DatePicker({ value, onValueChange, min, max, disabled, readOnly, className, 'aria-label': label, ...triggerProps }, ref) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [typedDate, setTypedDate] = useState(value);
  const [typedError, setTypedError] = useState(false);
  const selected = parseDateOnly(value);
  const fromDate = parseDateOnly(min);
  const toDate = parseDateOnly(max);
  const calendarLabel = label || (lang === 'zh' ? '选择日期' : 'Select date');
  function changeOpen(next: boolean) {
    if (next && (disabled || readOnly)) return;
    if (next) { setTypedDate(value); setTypedError(false); }
    setOpen(next);
  }
  function applyTypedDate() {
    const date = parseDateOnly(typedDate);
    if (typedDate && (!date || (fromDate && date < fromDate) || (toDate && date > toDate))) { setTypedError(true); return; }
    onValueChange(typedDate);
    setOpen(false);
  }
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button {...triggerProps} ref={ref} type="button" variant="outline" data-slot="date-picker-trigger" disabled={disabled}
        aria-readonly={readOnly || undefined}
        aria-label={label ? `${label}${value ? `：${value}` : ''}` : undefined}
        className={cn('h-9 w-full min-w-0 justify-between gap-2 px-3 font-normal tabular-nums', !value && 'text-muted-foreground', className)}>
        <span className="truncate">{value || (lang === 'zh' ? '选择日期' : 'Select date')}</span><CalendarDays className="size-4 shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="horizon-portal w-auto p-0" aria-label={calendarLabel}>
      <Calendar mode="single" selected={selected} weekStartsOn={lang === 'zh' ? 1 : 0}
        formatters={{
          formatCaption: (date) => date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' }),
          formatWeekdayName: (date) => date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short' }),
        }}
        labels={{ labelPrevious: () => lang === 'zh' ? '上个月' : 'Previous month', labelNext: () => lang === 'zh' ? '下个月' : 'Next month',
          labelWeekday: (date) => date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long' }),
          labelDay: (date) => date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) }}
        defaultMonth={selected ?? fromDate ?? toDate} initialFocus fromDate={fromDate} toDate={toDate}
        disabled={[...(fromDate ? [{ before: fromDate }] : []), ...(toDate ? [{ after: toDate }] : [])]}
        onSelect={(date) => { onValueChange(date ? formatDateOnly(date) : ''); setOpen(false); }} />
      <div className="space-y-2 border-t px-3 py-2">
        <div className="flex items-center gap-2">
          <Input type="text" aria-label={lang === 'zh' ? '输入日期（年-月-日）' : 'Enter date (YYYY-MM-DD)'} placeholder="YYYY-MM-DD" maxLength={10}
            value={typedDate} aria-invalid={typedError} className="h-9 w-36 tabular-nums"
            onChange={(event) => { setTypedDate(event.target.value); setTypedError(false); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyTypedDate(); } }} />
          <Button type="button" variant="secondary" size="sm" onClick={applyTypedDate}>{lang === 'zh' ? '确定' : 'Apply'}</Button>
        </div>
        {typedError && <p role="alert" className="max-w-60 text-xs text-destructive">{lang === 'zh' ? '请输入有效日期，并遵守日期范围。' : 'Enter a valid date within the allowed range.'}</p>}
        <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => { onValueChange(''); setOpen(false); }}>
          {lang === 'zh' ? '清除日期' : 'Clear date'}
        </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>;
});
