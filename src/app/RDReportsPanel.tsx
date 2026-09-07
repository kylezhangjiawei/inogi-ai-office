import { useState } from "react";
import { CalendarDays, CalendarRange } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { RDDailyReportPanel } from "./RDDailyReportPanel";
import { RDMonthlyReportPanel } from "./RDMonthlyReportPanel";
import { t, useI18n } from "./lib/i18n";
import type { RdDailyReport } from "./lib/rdApi";

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
export function RDReportsPanel({ canRegenerate, spacious = false, onDailyReportsLoaded }: {
  canRegenerate: boolean;
  spacious?: boolean;
  onDailyReportsLoaded?: (reports: RdDailyReport[]) => void;
}) {
  useI18n();
  const [tab, setTab] = useState<ReportTab>("daily");

  const activeTabLabel = TABS.find((item) => item.key === tab)?.label ?? "日报";

  // Tab 注入到子面板速览卡片「内部」顶部：右侧整体即为单张卡片，顶端与左侧模块对齐。
  const tabBar = (
    <div className="mb-3 flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 id="rd-report-panel-title" className="text-balance text-base font-semibold text-[#1b2559]">{t("研发工作报告")}</h2>
        <p className="mt-1 max-w-xl text-pretty text-xs leading-5 text-slate-500">{t("按日报或月报核对研发事实、进展与历史记录。")}</p>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as ReportTab)} className="w-full shrink-0 sm:w-fit">
        <TabsList aria-label={t("研发汇报周期")} className="h-auto w-full gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <TabsTrigger
              key={key}
              value={key}
              className="rd-horizon-report-tab flex-1 gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold text-slate-500 shadow-none transition-colors hover:text-slate-700 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-none sm:flex-none"
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {t(label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <span className="sr-only" aria-live="polite">{t("当前报告周期：{period}", { period: t(activeTabLabel) })}</span>
    </div>
  );

  return (
    <section className="horizon-theme rd-horizon-reports h-full min-w-0" aria-labelledby="rd-report-panel-title">
      {tab === "daily" ? (
        <RDDailyReportPanel canRegenerate={canRegenerate} tabSlot={tabBar} spacious={spacious} onDailyReportsLoaded={onDailyReportsLoaded} />
      ) : (
        <RDMonthlyReportPanel canRegenerate={canRegenerate} tabSlot={tabBar} spacious={spacious} />
      )}
    </section>
  );
}
