/**
 * 法定节假日日历，用于把节假日加班与普通休息日加班区分开。
 *
 * 为什么需要它：企业微信打卡日报里没有任何字段能标出法定节假日——节假日和周末在
 * 「班次」列里同样显示「休息」。而本系统的加班规则里，节假日加班计入调休（
 * compTimeEarnedHours），休息日加班计入可统计加班，两者去向不同，认错会直接影响
 * 员工的调休余额。
 *
 * ⚠️ 需要每年手工更新：国务院办公厅通常在前一年 11 月发布次年安排。缺失的年份不会
 * 报错，只会退化成「按休息日处理」（即当前不带日历时的行为），不会写错数据。
 *
 * 口径：这里登记的是通知里的完整放假区间。如果贵司按劳动法只把法定节假日当日
 * （元旦1天、春节初一至初三、清明当日、劳动节5月1日、端午当日、中秋当日、国庆
 * 10月1至3日）算 3 倍工资，其余调休日算休息日，把下面区间收窄成对应日期即可。
 */

/** 放假区间，[起, 止] 闭区间，YYYY-MM-DD。 */
type HolidayRange = readonly [string, string];

/** 数据来源：国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7号）。 */
const HOLIDAY_RANGES_BY_YEAR: Readonly<Record<number, readonly HolidayRange[]>> = {
  2026: [
    ['2026-01-01', '2026-01-03'], // 元旦
    ['2026-02-15', '2026-02-23'], // 春节
    ['2026-04-04', '2026-04-06'], // 清明节
    ['2026-05-01', '2026-05-05'], // 劳动节
    ['2026-06-19', '2026-06-21'], // 端午节
    ['2026-09-25', '2026-09-27'], // 中秋节
    ['2026-10-01', '2026-10-07'], // 国庆节
  ],
};

const holidayCache = new Map<number, Set<string>>();

function holidaysOf(year: number) {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const dates = new Set<string>();
  for (const [start, end] of HOLIDAY_RANGES_BY_YEAR[year] ?? []) {
    for (let cursor = new Date(`${start}T00:00:00Z`); ; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const value = cursor.toISOString().slice(0, 10);
      dates.add(value);
      if (value >= end) break;
    }
  }
  holidayCache.set(year, dates);
  return dates;
}

/** 该日期是否为法定节假日。未登记的年份一律返回 false。 */
export function isStatutoryHoliday(attendanceDate: string) {
  const year = Number(attendanceDate.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return holidaysOf(year).has(attendanceDate);
}

/** 是否登记过该年度的节假日安排，用于在导入预览里提示日历需要更新。 */
export function hasHolidayCalendar(year: number) {
  return Boolean(HOLIDAY_RANGES_BY_YEAR[year]);
}
