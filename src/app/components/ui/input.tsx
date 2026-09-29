import * as React from "react";

import { cn } from "./utils";
import { DateInput } from './date-input';

// forwardRef：React 18 函数组件不透传 ref；Radix asChild（如 PopoverAnchor 包输入框）需要 DOM ref 测量定位
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(function Input(
  { className, type, ...props },
  ref,
) {
  const Control = type === 'date' ? DateInput : 'input';
  return (
    <Control
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        type === "hidden" ? "hidden" :
        type === "file" ? "max-w-full text-sm text-foreground file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-[var(--radius-control)] border px-3 py-1 text-base text-foreground bg-input-background outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
});

export { Input };
