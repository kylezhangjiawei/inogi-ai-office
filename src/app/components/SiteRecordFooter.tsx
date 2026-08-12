import { cn } from "./ui/utils";

const ICP_RECORD_URL = "https://beian.miit.gov.cn/#/Integrated/index";

export function SiteRecordFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "flex shrink-0 items-center justify-center border-t border-slate-200/70 bg-white/85 px-4 py-2 text-center text-[11px] text-slate-500 backdrop-blur-sm",
        className,
      )}
    >
      <a
        href={ICP_RECORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        苏ICP备2021046412号-3
      </a>
    </footer>
  );
}
