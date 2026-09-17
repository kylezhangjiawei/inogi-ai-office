import { useId, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useI18n } from "../../lib/i18n";
import type { WorkspaceArrival } from "../procurementWorkspaceModel";
import { buildArrivalCalendar, isArrivalDay, isArrivalMonth, type ArrivalCalendarSelection } from "./arrivalCalendarModel";
import "./arrivalCalendar.css";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

export interface ArrivalCalendarProps {
  rows: WorkspaceArrival[];
  month: string;
  selection: ArrivalCalendarSelection;
  disabled?: boolean;
  onMonthChange: (month: string) => void;
  onSelect: (selection: ArrivalCalendarSelection) => void;
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function ArrivalCalendar({ rows, month, selection, disabled = false, onMonthChange, onSelect }: ArrivalCalendarProps) {
  const { t } = useI18n();
  const labelId = useId();
  const helpId = useId();
  const inputId = useId();
  const calendar = useMemo(() => isArrivalMonth(month) ? buildArrivalCalendar(rows, month) : null, [rows, month]);
  const today = new Date();
  const todayKey = `${String(today.getFullYear()).padStart(4, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (!calendar) return <p role="status" className="arrival-calendar-invalid">{t("请选择有效的到货月份。")}</p>;

  const selections = [
    { value: "all", label: t("全部关联"), count: calendar.totalCount },
    { value: "undated", label: t("日期待确认"), count: calendar.undatedCount },
    { value: "outside", label: t("月外日期"), count: calendar.outsideCount },
  ];
  const selectedCount = isArrivalDay(selection) ? calendar.days.find((day) => day.date === selection)?.rowCount : undefined;
  const selectDay = (date: string) => { if (!disabled) onSelect(date); };

  return <section className="arrival-calendar" aria-labelledby={labelId} aria-describedby={helpId}>
    <div className="arrival-calendar-heading">
      <div>
        <h3 id={labelId}>{t("任务关联到货日历")}</h3>
        <p>{t("本月 {count} 行 · 点击日期筛选下方列表", { count: calendar.inMonthCount })}</p>
      </div>
      <div className="arrival-calendar-month">
        <Button variant="unstyled" type="button" disabled={disabled || !calendar.previousMonth} aria-label={t("上一个到货月份")}
          onClick={() => { if (!disabled && calendar.previousMonth) onMonthChange(calendar.previousMonth); }}><ChevronLeft aria-hidden="true" size={16} /></Button>
        <label className="sr-only" htmlFor={inputId}>{t("到货日历月份")}</label>
        <Input id={inputId} type="month" value={month} min="0001-01" max="9999-12" disabled={disabled}
          onChange={(event) => { if (!disabled && isArrivalMonth(event.target.value)) onMonthChange(event.target.value); }} />
        <Button variant="unstyled" type="button" disabled={disabled || !calendar.nextMonth} aria-label={t("下一个到货月份")}
          onClick={() => { if (!disabled && calendar.nextMonth) onMonthChange(calendar.nextMonth); }}><ChevronRight aria-hidden="true" size={16} /></Button>
      </div>
    </div>
    <div className="arrival-calendar-selections" aria-label={t("到货日期范围")}>
      {selections.map((item) => <Button variant="unstyled" key={item.value} type="button" aria-pressed={selection === item.value} disabled={disabled}
        onClick={() => selectDay(item.value)}><span>{item.label}</span><strong>{item.count}</strong><span>{t("行")}</span></Button>)}
    </div>
    <div className="arrival-calendar-grid" role="group" aria-label={t("{month} 任务关联到货日期", { month })}>
      {WEEKDAYS.map((day, index) => <div key={day} className={`arrival-calendar-weekday${index >= 5 ? " is-weekend" : ""}`}>{t(day)}</div>)}
      {calendar.days.map((day, index) => day.date && day.inMonth ? <Button variant="unstyled"
        key={day.date} type="button" className={`arrival-calendar-day${day.isWeekend ? " is-weekend" : ""}${day.date === todayKey ? " is-today" : ""}`}
        aria-label={t("{date}，{weekday}，{count} 行{today}", { date: day.date, weekday: t(WEEKDAYS[index % 7]), count: day.rowCount, today: day.date === todayKey ? t("，今天") : "" })}
        aria-pressed={selection === day.date} aria-current={day.date === todayKey ? "date" : undefined} disabled={disabled}
        onClick={() => selectDay(day.date!)}>
        <span className="arrival-calendar-date">{day.day}{day.date === todayKey ? <span className="arrival-calendar-today">{t("今")}</span> : null}</span>
        <span className={day.rowCount ? "arrival-calendar-count" : "arrival-calendar-empty-count"}>{t("{count} 行", { count: day.rowCount })}</span>
      </Button> : <div key={day.date ?? `padding-${index}`} className="arrival-calendar-padding" aria-hidden="true">{day.day ?? ""}</div>)}
    </div>
    <p className="arrival-calendar-selection-status" role="status" aria-live="polite">
      {isArrivalDay(selection) ? t("已选 {date}：{count} 行", { date: selection, count: selectedCount ?? rows.filter((row) => row.etaDate === selection).length })
        : selection === "undated" ? t("正在查看日期待确认的关联记录。") : selection === "outside" ? t("正在查看到货日期在本月以外的关联记录。") : t("正在查看全部关联记录，包含月外和日期待确认。")}
    </p>
    <p id={helpId} className="arrival-calendar-help">{t("按任务关联预计到货归日，数字为订单行数；已收完或已取消的关联记录也保留。这是日期索引，不代表未到货义务。人工预计检验后可用日期请查看下方订单行。")}</p>
  </section>;
}
