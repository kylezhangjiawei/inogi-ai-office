import { useState } from "react";
import { CalendarDays, CalendarRange } from "lucide-react";
import { cn } from "./components/ui/utils";
import { RDDailyReportPanel } from "./RDDailyReportPanel";
import { RDMonthlyReportPanel } from "./RDMonthlyReportPanel";
import { t, useI18n } from "./lib/i18n";

type ReportTab = "daily" | "monthly";

const TABS: Array<{ key: ReportTab; label: string; icon: typeof CalendarDays }> = [
  { key: "daily", label: "日报", icon: CalendarDays },
  { key: "monthly", label: "月报", icon: CalendarRange },
];

/**
 * 研发报表面板（共享）：用 Tab 在「日报」与「月报」间切换。
 * Tab 渲染在子面板速览卡片「内部」顶部（tabSlot 注入），使右侧整体为单张卡片、
 * 顶端与左侧模块对齐。两个子面板各自独立取数；月报 Tab 内含「月绩效报表」入口。
 */
export function RDReportsPanel({ canRegenerate, spacious = false }: { canRegenerate: boolean; spacious?: boolean }) {
  useI18n();
  const [tab, setTab] = useState<ReportTab>("daily");

  // Tab 注入到子面板速览卡片「内部」顶部：右侧整体即为单张卡片，顶端与左侧模块对齐。
  const tabBar = (
    <div className="mb-3 inline-flex w-fit items-center gap-1 rounded-xl bg-white/80 p-1 shadow-sm ring-1 ring-slate-200/70">
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = tab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
              active
                ? key === "monthly"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "bg-violet-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(label)}
          </button>
        );
      })}
    </div>
  );

  return tab === "daily" ? (
    <RDDailyReportPanel canRegenerate={canRegenerate} tabSlot={tabBar} spacious={spacious} />
  ) : (
    <RDMonthlyReportPanel canRegenerate={canRegenerate} tabSlot={tabBar} spacious={spacious} />
  );
}
