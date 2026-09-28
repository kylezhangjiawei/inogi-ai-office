import React from "react";
import { CalendarDays, LucideIcon } from "lucide-react";

import { cn } from "./ui/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";

type FieldShellProps = {
  id: string;
  label?: string;
  hint?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
};

function FieldShell({ id, label, hint, icon: Icon, children, className }: FieldShellProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <Label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-foreground">
          {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
          <span>{label}</span>
        </Label>
      ) : null}
      {children}
      {hint ? <div id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

type MaterialInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  icon?: LucideIcon;
};

export function MaterialInput({ label, hint, icon, className, id, ...props }: MaterialInputProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} icon={icon}>
      <Input
        {...props}
        id={fieldId}
        aria-describedby={[props['aria-describedby'], hint && `${fieldId}-hint`].filter(Boolean).join(' ') || undefined}
        className={cn("material-input h-11", className)}
      />
    </FieldShell>
  );
}

type MaterialTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  icon?: LucideIcon;
};

export function MaterialTextarea({ label, hint, icon, className, id, ...props }: MaterialTextareaProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} icon={icon}>
      <Textarea
        {...props}
        id={fieldId}
        aria-describedby={[props['aria-describedby'], hint && `${fieldId}-hint`].filter(Boolean).join(' ') || undefined}
        className={cn("material-input min-h-[220px] py-4 leading-7", className)}
      />
    </FieldShell>
  );
}

type MaterialSelectOption = {
  label: string;
  value: string;
  description?: string;
};

const EMPTY_SELECT_VALUE = "__material-empty__";

type MaterialSelectProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  label?: string;
  hint?: string;
  icon?: LucideIcon;
  value: string;
  onValueChange: (value: string) => void;
  options: MaterialSelectOption[];
  placeholder?: string;
  className?: string;
  /** 透传到下拉浮层(SelectContent)。放进 MUI Dialog 等高层级容器时，传 z-[1400] 之类盖过它 */
  contentClassName?: string;
};

export function MaterialSelect({
  label,
  hint,
  icon,
  value,
  onValueChange,
  options,
  placeholder,
  className,
  contentClassName,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: MaterialSelectProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const normalizedValue = value === "" ? EMPTY_SELECT_VALUE : value;

  return (
    <FieldShell id={fieldId} label={label} hint={hint} icon={icon}>
      <Select
        value={normalizedValue}
        onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)}
      >
        <SelectTrigger
          id={fieldId}
          aria-invalid={invalid}
          aria-describedby={[describedBy, hint && `${fieldId}-hint`].filter(Boolean).join(' ') || undefined}
          className={cn(
            "material-input h-11 w-full justify-between px-3",
            className,
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          className={cn(
            "rounded-[var(--m3-shape-large)] border border-slate-200 bg-white p-1 shadow-[var(--m3-elevation-3)]",
            contentClassName,
          )}
        >
          {options.map((option) => (
            <SelectItem
              key={option.value || EMPTY_SELECT_VALUE}
              value={option.value === "" ? EMPTY_SELECT_VALUE : option.value}
              description={option.description}
              className="rounded-[var(--m3-shape-small)] py-2 pl-3 pr-9 text-sm text-slate-700"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

type MaterialDateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
  hint?: string;
};

export function MaterialDateInput({ label, hint, className, ...props }: MaterialDateInputProps) {
  return (
    <MaterialInput {...props} type="date" label={label} hint={hint} icon={CalendarDays} className={className} />
  );
}
