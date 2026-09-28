import * as React from "react";

import { cn } from "./utils";

// forwardRef：@ 提及等需要读取光标位置/聚焦的场景要拿到底层 textarea ref。
// 对既有使用处向后兼容（不传 ref 时行为不变）。
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "resize-none border-input placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-[var(--radius-control)] border bg-input-background px-3 py-2 text-base leading-6 text-foreground outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
