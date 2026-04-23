import React from "react";
import { CalendarDays, LucideIcon } from "lucide-react";

import { cn } from "./ui/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type FieldShellProps = {
  label?: string;
  hint?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
};

function FieldShell({ label, hint, icon: Icon, children, className }: FieldShellProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
          <span>{label}</span>
        </div>
      ) : null}
      {children}
      {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

type MaterialInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  icon?: LucideIcon;
};

export function MaterialInput({ label, hint, icon, className, ...props }: MaterialInputProps) {
  return (
    <FieldShell label={label} hint={hint} icon={icon}>
      <input
        {...props}
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

export function MaterialTextarea({ label, hint, icon, className, ...props }: MaterialTextareaProps) {
  return (
    <FieldShell label={label} hint={hint} icon={icon}>
      <textarea
        {...props}
        className={cn("material-input min-h-[220px] py-4 leading-7", className)}
      />
    </FieldShell>
  );
}

type MaterialSelectOption = {
  label: string;
  value: string;
};

const EMPTY_SELECT_VALUE = "__material-empty__";

type MaterialSelectProps = {
  label?: string;
  hint?: string;
  icon?: LucideIcon;
  value: string;
  onValueChange: (value: string) => void;
  options: MaterialSelectOption[];
  placeholder?: string;
  className?: string;
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
}: MaterialSelectProps) {
  const normalizedValue = value === "" ? EMPTY_SELECT_VALUE : value;

  return (
    <FieldShell label={label} hint={hint} icon={icon}>
      <Select
        value={normalizedValue}
        onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)}
      >
        <SelectTrigger
          className={cn(
            "material-input h-11 justify-between rounded-2xl border-0 bg-white/75 px-4 py-0 shadow-[inset_0_0_0_1px_rgba(216,226,238,0.85)] focus:ring-0 focus-visible:ring-0",
            className,
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_18px_35px_rgba(15,23,42,0.12)]">
          {options.map((option) => (
            <SelectItem
              key={option.value || EMPTY_SELECT_VALUE}
              value={option.value === "" ? EMPTY_SELECT_VALUE : option.value}
              className="rounded-xl py-2 pl-3 pr-9 text-sm text-slate-700"
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
    <FieldShell label={label} hint={hint} icon={CalendarDays}>
      <input
        {...props}
        type="date"
        className={cn("material-input h-11", className)}
      />
    </FieldShell>
  );
}
