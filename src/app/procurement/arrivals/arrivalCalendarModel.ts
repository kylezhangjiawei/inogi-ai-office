import type { WorkspaceArrival } from "../procurementWorkspaceModel";

export type ArrivalCalendarSelection = "all" | "undated" | "outside" | string;

export interface ArrivalCalendarDay {
  /** Null only for padding beyond supported years 0001–9999. */
  date: string | null;
  day: number | null;
  inMonth: boolean;
  isWeekend: boolean;
  rowCount: number;
}

export interface ArrivalCalendarModel {
  month: string;
  previousMonth: string | null;
  nextMonth: string | null;
  /** Six complete Monday-first weeks, including adjacent-month context. */
  days: ArrivalCalendarDay[];
  inMonthCount: number;
  undatedCount: number;
  outsideCount: number;
  totalCount: number;
}

export function isArrivalMonth(value: unknown): value is string {
  return typeof value === "string" && /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
}

export function isArrivalDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= lastDay;
}

export function isArrivalSelection(value: unknown): value is ArrivalCalendarSelection {
  return value === "all" || value === "undated" || value === "outside" || isArrivalDay(value);
}

function assertMonth(month: string) {
  if (!isArrivalMonth(month)) throw new RangeError("Arrival month must be a calendar month between 0001-01 and 9999-12.");
}

function adjacentMonth(month: string, offset: -1 | 1): string | null {
  const [year, number] = month.split("-").map(Number);
  const index = (year - 1) * 12 + number - 1 + offset;
  if (index < 0 || index >= 9999 * 12) return null;
  return `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}

/** Index the full already-resolved task association list; never sum mixed units or deduplicate it again. */
export function buildArrivalCalendar(rows: readonly WorkspaceArrival[], month: string): ArrivalCalendarModel {
  assertMonth(month);
  const byDay = new Map<string, number>();
  let inMonthCount = 0;
  let undatedCount = 0;
  let outsideCount = 0;
  for (const row of rows) {
    if (!isArrivalDay(row.etaDate)) {
      undatedCount += 1;
      continue;
    }
    byDay.set(row.etaDate, (byDay.get(row.etaDate) ?? 0) + 1);
    if (row.etaDate.slice(0, 7) === month) inMonthCount += 1;
    else outsideCount += 1;
  }
  // Parsing an ISO year avoids Date.UTC's special 1900 offset for years 00–99.
  const first = new Date(`${month}-01T00:00:00Z`);
  const leading = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index): ArrivalCalendarDay => {
    const cursor = new Date(first.getTime() + (index - leading) * 86_400_000);
    const candidate = cursor.toISOString().slice(0, 10);
    const date = isArrivalDay(candidate) ? candidate : null;
    return {
      date,
      day: date ? Number(date.slice(8)) : null,
      inMonth: date?.slice(0, 7) === month,
      isWeekend: index % 7 >= 5,
      rowCount: date ? byDay.get(date) ?? 0 : 0,
    };
  });
  return {
    month, previousMonth: adjacentMonth(month, -1), nextMonth: adjacentMonth(month, 1), days,
    inMonthCount, undatedCount, outsideCount, totalCount: rows.length,
  };
}

/** Preserve input ordering, identifiers, status, quantities and object identity in every selection. */
export function selectArrivalRows(
  rows: readonly WorkspaceArrival[], month: string, selection: ArrivalCalendarSelection,
): WorkspaceArrival[] {
  assertMonth(month);
  if (selection === "all") return [...rows];
  if (selection === "undated") return rows.filter((row) => !isArrivalDay(row.etaDate));
  if (selection === "outside") return rows.filter((row) => isArrivalDay(row.etaDate) && row.etaDate.slice(0, 7) !== month);
  if (!isArrivalDay(selection)) return [];
  return rows.filter((row) => row.etaDate === selection);
}
