import { Bell, Search, User } from "lucide-react";
import { motion } from "motion/react";

export function Header() {
  const currentDate = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const currentTime = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <header className="relative z-20 border-b border-border bg-surface-container-lowest/95 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-1 bg-primary" />

      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:px-8 lg:py-0">
        <div className="flex min-w-0 items-center justify-between gap-4 lg:justify-start">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">INOGI Office</div>
            <h1 className="truncate text-xl font-semibold tracking-tight text-on-surface sm:text-2xl">数据看板</h1>
          </div>
          <span className="hidden shrink-0 rounded-[8px] border border-border bg-surface-container-low px-3 py-1.5 text-xs font-semibold text-on-surface-variant sm:inline-flex">
            {currentDate} {currentTime}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:flex-1 lg:justify-end">
          <div className="relative min-w-0 flex-1 lg:max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="搜索工单、文档..."
              className="h-10 w-full rounded-[8px] border border-border bg-surface-container-low px-10 text-sm text-on-surface outline-none transition placeholder:text-on-surface-variant/70 hover:bg-surface-container focus:border-primary/40 focus:bg-surface-container-lowest focus:ring-4 focus:ring-primary/10"
            />
          </div>

          <motion.button
            type="button"
            aria-label="查看通知"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            className="relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border bg-surface-container-lowest text-on-surface-variant transition-colors hover:border-primary/25 hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-surface-container-lowest" />
          </motion.button>

          <motion.button
            type="button"
            aria-label="打开用户菜单"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            className="flex min-w-0 shrink-0 cursor-pointer items-center gap-3 rounded-[10px] border border-border bg-surface-container-lowest p-1.5 pr-2.5 transition-colors hover:border-primary/25 hover:bg-primary-container focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(30,64,175,0.18)]">
              <User className="h-4 w-4" />
            </span>
            <span className="hidden min-w-0 text-left xl:block">
              <span className="block truncate text-sm font-semibold leading-5 text-on-surface">林云飞</span>
              <span className="block truncate text-xs leading-4 text-on-surface-variant">管理员</span>
            </span>
          </motion.button>
        </div>
      </div>
    </header>
  );
}
