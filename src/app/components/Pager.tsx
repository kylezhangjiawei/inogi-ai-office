import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "./ui/utils";
import { Button } from "./ui/button";

function buildPageList(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

/** Numbered pager in the glass visual language; renders nothing for a single page. */
export function Pager({
  page,
  totalPages,
  onChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  if (totalPages <= 1) return null;
  const base =
    "flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-[12px] border px-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";
  const inactive = "border-border bg-surface-container-lowest text-slate-600 hover:border-primary/30 hover:text-primary";
  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5" aria-label="分页">
      <Button variant="unstyled"
        type="button"
        className={cn(base, inactive)}
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="上一页"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {buildPageList(page, totalPages).map((entry, index) =>
        entry === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="flex h-9 min-w-9 items-center justify-center text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <Button variant="unstyled"
            key={entry}
            type="button"
            aria-current={entry === page ? "page" : undefined}
            className={cn(base, entry === page ? "border-transparent bg-primary text-primary-foreground shadow-sm" : inactive)}
            disabled={disabled}
            onClick={() => onChange(entry)}
          >
            {entry}
          </Button>
        ),
      )}
      <Button variant="unstyled"
        type="button"
        className={cn(base, inactive)}
        disabled={disabled || page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="下一页"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
