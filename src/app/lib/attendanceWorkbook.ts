import { ATTENDANCE_TEMPLATE_BASE64 } from './attendanceTemplateBase64';
import type {
  AttendanceMonthlyItem,
  AttendanceMonthlyResponse,
  AttendanceRecord,
  AttendanceStatus,
} from './attendanceApi';
import { ATTENDANCE_SPECIAL_STATUS_LABELS, attendanceSpecialStatusLabel } from './attendanceStatusLabels';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CHINESE_DIGITS = '〇一二三四五六七八九';
const CHINESE_MONTHS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

const SPECIAL_STATUSES = new Set<AttendanceStatus>(
  Object.keys(ATTENDANCE_SPECIAL_STATUS_LABELS) as AttendanceStatus[],
);

type CellValue = string | number | null | { formula: string; result: number };

interface TemplateStyles {
  body: string;
  anomaly: string;
  plainSpecial: string;
  sickLeave: string;
  compensatoryLeave: string;
}

function dayDate(data: AttendanceMonthlyResponse, day: number) {
  return `${data.year}-${String(data.monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function weekday(data: AttendanceMonthlyResponse, day: number) {
  return WEEKDAYS[new Date(`${dayDate(data, day)}T00:00:00Z`).getUTCDay()];
}

function recordMap(item: AttendanceMonthlyItem) {
  return new Map(item.records.map((record) => [record.attendanceDate, record]));
}

function checkInAssessment(record?: AttendanceRecord) {
  if (!record) return '--';
  if (record.status === 'missing') return record.checkInTime ? '正常' : `缺卡（${record.scheduledStart}）`;
  if (record.status === 'late' || record.status === 'late_early') return `迟到${record.lateMinutes}分钟`;
  return record.checkInTime ? '正常' : '--';
}

function checkOutAssessment(record?: AttendanceRecord) {
  if (!record) return '--';
  if (record.status === 'missing') return record.checkOutTime ? '正常' : `缺卡（${record.scheduledEnd}）`;
  if (record.status === 'early' || record.status === 'late_early') return `早退${record.earlyLeaveMinutes}分钟`;
  return record.checkOutTime ? '正常' : '--';
}

function uniqueNotes(item: AttendanceMonthlyItem) {
  return [...new Set(item.records.map((record) => record.note.trim()).filter(Boolean))].join('；');
}

function excelColumn(index: number) {
  let value = index;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function excelColumnIndex(column: string) {
  return [...column].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}

function chineseYear(year: number) {
  return String(year).split('').map((digit) => CHINESE_DIGITS[Number(digit)]).join('');
}

function departmentName(data: AttendanceMonthlyResponse, departmentFilter?: string) {
  return departmentFilter
    || (data.items.length > 0 && data.items.every((item) => item.employee.department === data.items[0].employee.department)
      ? data.items[0].employee.department
      : '全部部门');
}

function layoutFor(dayEnd: number) {
  return {
    expectedStart: dayEnd + 1,
    expectedEnd: dayEnd + 2,
    normal: dayEnd + 3,
    rest: dayEnd + 4,
    holiday: dayEnd + 5,
    sick: dayEnd + 6,
    personal: dayEnd + 7,
    annual: dayEnd + 8,
    absent: dayEnd + 9,
    lateEarly: dayEnd + 10,
    paternity: dayEnd + 11,
    workdayOvertime: dayEnd + 12,
    sundayOvertime: dayEnd + 13,
    holidayOvertime: dayEnd + 14,
    signature: dayEnd + 15,
    previousSick: dayEnd + 16,
    entitledSick: dayEnd + 17,
    paidSick: dayEnd + 18,
    unpaidSick: dayEnd + 19,
    recoveredHelper: dayEnd + 20,
    invertedOffsetHelper: dayEnd + 21,
    inverted: dayEnd + 22,
    recovered: dayEnd + 23,
    remaining: dayEnd + 24,
    note: dayEnd + 25,
  };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateSheetNumber(daysInMonth: number) {
  if (daysInMonth === 28) return 2;
  if (daysInMonth === 30) return 4;
  return 1;
}

function templateStyles(sheetNumber: number): TemplateStyles {
  return sheetNumber === 1
    ? { body: '70', anomaly: '111', plainSpecial: '45', sickLeave: '100', compensatoryLeave: '90' }
    : { body: '79', anomaly: '51', plainSpecial: '76', sickLeave: '100', compensatoryLeave: '90' };
}

function base64Bytes(base64: string) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sourceRows(sheetXml: string) {
  const sheetData = sheetXml.match(/<sheetData>([\s\S]*?)<\/sheetData>/)?.[1];
  if (!sheetData) throw new Error('原始考勤模板缺少 sheetData');
  const rows = new Map<number, string>();
  for (const match of sheetData.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const rowNumber = Number(match[0].match(/<row\b[^>]*\br="(\d+)"/)?.[1]);
    if (rowNumber) rows.set(rowNumber, match[0]);
  }
  return rows;
}

function shiftFormulaRows(formula: string, delta: number) {
  if (delta === 0) return formula;
  return formula.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_, column: string, row: string) => `${column}${Number(row) + delta}`);
}

function cloneRow(source: string, targetRow: number) {
  const sourceRow = Number(source.match(/<row\b[^>]*\br="(\d+)"/)?.[1]);
  if (!sourceRow) throw new Error('原始考勤模板存在无效行');
  const delta = targetRow - sourceRow;
  let result = source.replace(/(<row\b[^>]*\br=")\d+("[^>]*>)/, `$1${targetRow}$2`);
  result = result.replace(/(\br="[A-Z]{1,3})\d+(")/g, `$1${targetRow}$2`);
  result = result.replace(/<f([^>]*)>([\s\S]*?)<\/f>/g, (_, attributes: string, formula: string) => (
    `<f${attributes}>${shiftFormulaRows(formula, delta)}</f>`
  ));
  return result;
}

function cellMarkup(reference: string, sourceAttributes: string, value: CellValue, style?: string) {
  const sourceStyle = sourceAttributes.match(/(?:^|\s)s="([^"]*)"/)?.[1];
  const effectiveStyle = style ?? sourceStyle;
  let attributes = sourceAttributes
    .replace(/(?:^|\s)r="[^"]*"/g, '')
    .replace(/(?:^|\s)t="[^"]*"/g, '')
    .replace(/(?:^|\s)s="[^"]*"/g, '')
    .trim();
  attributes = `r="${reference}"${effectiveStyle ? ` s="${effectiveStyle}"` : ''}${attributes ? ` ${attributes}` : ''}`;
  if (value === null || value === '') return `<c ${attributes}/>`;
  if (typeof value === 'number') return `<c ${attributes}><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  if (typeof value === 'object') {
    return `<c ${attributes}><f>${escapeXml(value.formula)}</f><v>${value.result}</v></c>`;
  }
  return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function setCell(rowXml: string, column: number, row: number, value: CellValue, style?: string) {
  const reference = `${excelColumn(column)}${row}`;
  const pattern = new RegExp(`<c\\s+([^>]*\\br="${escapeRegExp(reference)}"[^>]*)\\/>|<c\\s+([^>]*\\br="${escapeRegExp(reference)}"[^>]*)>[\\s\\S]*?<\\/c>`);
  const match = rowXml.match(pattern);
  const sourceAttributes = match?.[1] ?? match?.[2] ?? '';
  const markup = cellMarkup(reference, sourceAttributes, value, style);
  return match ? rowXml.replace(pattern, markup) : rowXml.replace('</row>', `${markup}</row>`);
}

function removeCellsAfter(rowXml: string, lastColumn: number) {
  return rowXml.replace(/<c\s+[^>]*\br="([A-Z]{1,3})\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g, (cell, column: string) => (
    excelColumnIndex(column) > lastColumn ? '' : cell
  ));
}

function shiftRangeRows(reference: string, delta: number) {
  return reference.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_, column: string, row: string) => `${column}${Number(row) + delta}`);
}

function rangeRows(reference: string) {
  const rows = [...reference.matchAll(/[A-Z]{1,3}(\d+)/g)].map((match) => Number(match[1]));
  return { first: Math.min(...rows), last: Math.max(...rows) };
}

function buildMergeReferences(sheetXml: string, topDelta: number, totalDelta: number) {
  const mergeXml = sheetXml.match(/<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/)?.[1] ?? '';
  const references = [...mergeXml.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((match) => match[1]);
  return references.flatMap((reference) => {
    const rows = rangeRows(reference);
    if (rows.last <= 5) return [reference];
    if (rows.first >= 6 && rows.last <= 9) return [shiftRangeRows(reference, topDelta)];
    if (rows.first >= 10 && rows.last <= 14) return [];
    if (rows.first >= 15) return [shiftRangeRows(reference, totalDelta)];
    return [];
  });
}

function specialStatusLabel(record: AttendanceRecord) {
  if (record.status === 'holiday' && record.note.trim() && record.note.trim().length <= 8) return record.note.trim();
  return attendanceSpecialStatusLabel(record.status);
}

function specialStatusStyle(status: AttendanceStatus, styles: TemplateStyles) {
  if (status === 'sick_leave') return styles.sickLeave;
  if (status === 'compensatory_leave') return styles.compensatoryLeave;
  if (status === 'absent') return styles.anomaly;
  return styles.plainSpecial;
}

function dayCount(value: number) {
  return value > 0 ? `${value}天` : null;
}

function safeSheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || '考勤表';
}

function workbookDefinedNames(
  sheetName: string,
  attendanceTitleRow: number,
  departmentRow: number,
  subHeaderRow: number,
  signatureRow: number,
  printEndColumn: number,
  filterEndColumn: number,
) {
  const formulaSheetName = sheetName.replace(/'/g, "''");
  const escapedSheetName = escapeXml(formulaSheetName);
  return `<definedNames>`
    + `<definedName name="_xlnm.Print_Area" localSheetId="0">&apos;${escapedSheetName}&apos;!$A$${attendanceTitleRow}:$${excelColumn(printEndColumn)}$${signatureRow}</definedName>`
    + `<definedName name="_xlnm.Print_Titles" localSheetId="0">&apos;${escapedSheetName}&apos;!$${attendanceTitleRow}:$${subHeaderRow}</definedName>`
    + `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">&apos;${escapedSheetName}&apos;!$A$${departmentRow}:$${excelColumn(filterEndColumn)}$${signatureRow}</definedName>`
    + `</definedNames>`;
}

function populateAttendanceBlock(
  source: Map<number, string>,
  item: AttendanceMonthlyItem | undefined,
  itemIndex: number,
  startRow: number,
  data: AttendanceMonthlyResponse,
  layout: ReturnType<typeof layoutFor>,
  styles: TemplateStyles,
  merges: string[],
) {
  const rows = [0, 1, 2, 3, 4].map((offset) => cloneRow(source.get(10 + offset) ?? '', startRow + offset));
  const endRow = startRow + 4;
  const dayStart = 4;
  const dayEnd = dayStart + data.daysInMonth - 1;

  for (let offset = 0; offset < rows.length; offset += 1) {
    const row = startRow + offset;
    rows[offset] = setCell(rows[offset], 1, row, null);
    rows[offset] = setCell(rows[offset], 2, row, null);
    rows[offset] = setCell(rows[offset], 3, row, ['上午', '上午', '下午', '下午', '倒挂\n扣时/分钟'][offset]);
    for (let column = dayStart; column <= dayEnd; column += 1) {
      rows[offset] = setCell(rows[offset], column, row, null, styles.body);
    }
    for (let column = layout.expectedStart; column <= layout.note; column += 1) {
      rows[offset] = setCell(rows[offset], column, row, null);
    }
  }

  merges.push(`A${startRow}:A${endRow}`, `B${startRow}:B${endRow}`);
  if (!item) {
    rows[0] = setCell(rows[0], 1, startRow, 1);
    rows[0] = setCell(rows[0], 2, startRow, '无考勤人员');
    return rows;
  }

  rows[0] = setCell(rows[0], 1, startRow, itemIndex + 1);
  rows[0] = setCell(rows[0], 2, startRow, item.employee.name);
  const byDate = recordMap(item);

  for (let day = 1; day <= data.daysInMonth; day += 1) {
    const column = dayStart + day - 1;
    const record = byDate.get(dayDate(data, day));
    if (record && SPECIAL_STATUSES.has(record.status)) {
      let lastDay = day;
      while (lastDay < data.daysInMonth) {
        const next = byDate.get(dayDate(data, lastDay + 1));
        if (!next || next.status !== record.status || next.note !== record.note) break;
        lastDay += 1;
      }
      const lastColumn = dayStart + lastDay - 1;
      rows[0] = setCell(rows[0], column, startRow, specialStatusLabel(record), specialStatusStyle(record.status, styles));
      for (let statusDay = day; statusDay <= lastDay; statusDay += 1) {
        const statusRecord = byDate.get(dayDate(data, statusDay));
        const statusColumn = dayStart + statusDay - 1;
        rows[4] = setCell(rows[4], statusColumn, endRow, statusRecord?.deductionMinutes || null, styles.body);
      }
      merges.push(`${excelColumn(column)}${startRow}:${excelColumn(lastColumn)}${startRow + 3}`);
      day = lastDay;
      continue;
    }

    const checkIn = record?.checkInTime || '--';
    const checkOut = record?.checkOutTime || '--';
    const inAssessment = checkInAssessment(record);
    const outAssessment = checkOutAssessment(record);
    const anomaly = Boolean(record && ['late', 'early', 'late_early', 'missing', 'absent'].includes(record.status));
    rows[0] = setCell(rows[0], column, startRow, checkIn, styles.body);
    rows[1] = setCell(rows[1], column, startRow + 1, inAssessment, anomaly ? styles.anomaly : styles.body);
    rows[2] = setCell(rows[2], column, startRow + 2, checkOut, styles.body);
    rows[3] = setCell(rows[3], column, startRow + 3, outAssessment, anomaly ? styles.anomaly : styles.body);
    rows[4] = setCell(rows[4], column, endRow, record?.deductionMinutes || null, styles.body);
  }

  const summaryValues: Array<[number, CellValue, number?]> = [
    [layout.expectedStart, `${item.summary.expectedDays}天`, layout.expectedEnd],
    [layout.normal, `${item.summary.normalDays}天`],
    [layout.rest, dayCount(item.summary.restDays)],
    [layout.holiday, dayCount(item.summary.holidayDays)],
    [layout.sick, dayCount(item.summary.sickLeaveDays)],
    [layout.personal, dayCount(item.summary.personalLeaveDays)],
    [layout.annual, dayCount(item.summary.annualLeaveDays)],
    [layout.absent, dayCount(item.summary.absentDays)],
    [layout.lateEarly, item.summary.lateEarlyCount || null],
    [layout.paternity, dayCount(item.summary.paternityLeaveDays)],
    [layout.workdayOvertime, item.summary.workdayOvertimeHours || null],
    [layout.sundayOvertime, item.summary.sundayOvertimeHours || null],
    [layout.holidayOvertime, item.summary.holidayOvertimeHours || null],
    [layout.signature, item.adjustment.signature || null],
    [layout.previousSick, item.adjustment.previousMonthSickLeaveDays || null],
    [layout.entitledSick, item.rules.annualPaidSickLeaveAllowanceDays],
    [layout.paidSick, item.adjustment.paidSickLeaveDays || null],
    [layout.unpaidSick, item.adjustment.unpaidSickLeaveDays || null],
    [layout.inverted, item.rules.startingInvertedHours || null],
    [layout.recovered, {
      formula: `ROUND(${excelColumn(layout.recoveredHelper)}${startRow}+${excelColumn(layout.invertedOffsetHelper)}${startRow},2)`,
      result: Number((item.adjustment.recoveredHours + item.rules.invertedOffsetHours).toFixed(2)),
    }],
    [layout.remaining, {
      formula: `MAX(0,${excelColumn(layout.inverted)}${startRow}-${excelColumn(layout.recovered)}${startRow})`,
      result: item.rules.remainingInvertedHours,
    }],
    [layout.note, item.rules.alerts.join('\n') || item.adjustment.note || uniqueNotes(item) || '无异常提醒'],
  ];

  rows[0] = setCell(rows[0], layout.recoveredHelper, startRow, item.adjustment.recoveredHours || 0);
  rows[0] = setCell(rows[0], layout.invertedOffsetHelper, startRow, item.rules.invertedOffsetHours || 0);
  for (const [column, value, mergeEnd] of summaryValues) {
    rows[0] = setCell(rows[0], column, startRow, value);
    merges.push(`${excelColumn(column)}${startRow}:${excelColumn(mergeEnd ?? column)}${endRow}`);
  }
  return rows;
}

export async function buildMonthlyAttendanceWorkbook(
  data: AttendanceMonthlyResponse,
  departmentFilter?: string,
) {
  if (![28, 29, 30, 31].includes(data.daysInMonth)) throw new Error('考勤模板只支持自然月');
  const templateDays = data.daysInMonth === 29 ? 28 : data.daysInMonth;
  if (data.daysInMonth === 29) throw new Error('闰年二月模板正在适配，请选择其他月份导出');

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(base64Bytes(ATTENDANCE_TEMPLATE_BASE64));
  const sheetNumber = templateSheetNumber(templateDays);
  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error('原始考勤模板工作表缺失');
  let sheetXml = await sheetFile.async('string');
  const source = sourceRows(sheetXml);
  const styles = templateStyles(sheetNumber);
  const department = departmentName(data, departmentFilter);
  const itemSlots = Math.max(data.items.length, 1);
  const topDelta = itemSlots - 1;
  const totalDelta = topDelta + (itemSlots - 1) * 5;
  const attendanceTitleRow = 6 + topDelta;
  const departmentRow = 7 + topDelta;
  const headerRow = 8 + topDelta;
  const subHeaderRow = 9 + topDelta;
  const attendanceDataStart = 10 + topDelta;
  const legendRow = 15 + totalDelta;
  const signatureRow = 17 + totalDelta;
  const dayStart = 4;
  const dayEnd = dayStart + data.daysInMonth - 1;
  const layout = layoutFor(dayEnd);
  const merges = buildMergeReferences(sheetXml, topDelta, totalDelta);
  const outputRows: string[] = [];

  let titleRow = cloneRow(source.get(1) ?? '', 1);
  titleRow = setCell(titleRow, 1, 1, `${department}工作人员${data.year}年${data.monthNumber}月份加班明细`);
  outputRows.push(titleRow);

  let topHeaderRow = cloneRow(source.get(2) ?? '', 2);
  let topWeekdayRow = cloneRow(source.get(3) ?? '', 3);
  for (let day = 1; day <= data.daysInMonth; day += 1) {
    const column = dayStart + day - 1;
    topHeaderRow = setCell(topHeaderRow, column, 2, day);
    topWeekdayRow = setCell(topWeekdayRow, column, 3, weekday(data, day));
  }
  outputRows.push(topHeaderRow, topWeekdayRow);

  for (let itemIndex = 0; itemIndex < itemSlots; itemIndex += 1) {
    const row = 4 + itemIndex;
    const item = data.items[itemIndex];
    let topDataRow = cloneRow(source.get(4) ?? '', row);
    if (itemIndex > 0) topDataRow = removeCellsAfter(topDataRow, layout.normal);
    topDataRow = setCell(topDataRow, 1, row, item ? itemIndex + 1 : 1);
    topDataRow = setCell(topDataRow, 2, row, item?.employee.title || '');
    topDataRow = setCell(topDataRow, 3, row, item?.employee.name || '无考勤人员');
    const byDate = item ? recordMap(item) : new Map<string, AttendanceRecord>();
    for (let day = 1; day <= data.daysInMonth; day += 1) {
      const overtimeMinutes = byDate.get(dayDate(data, day))?.overtimeMinutes || 0;
      topDataRow = setCell(topDataRow, dayStart + day - 1, row, overtimeMinutes ? Number((overtimeMinutes / 60).toFixed(2)) : null);
    }
    const previous = item?.adjustment.previousOvertimeBalance || 0;
    const total = Number((previous + (item?.summary.overtimeHours || 0)).toFixed(2));
    topDataRow = setCell(topDataRow, layout.expectedStart, row, previous || null);
    topDataRow = setCell(topDataRow, layout.expectedEnd, row, {
      formula: `ROUND(SUM(${excelColumn(dayStart)}${row}:${excelColumn(dayEnd)}${row})+${excelColumn(layout.expectedStart)}${row},2)`,
      result: total,
    });
    topDataRow = setCell(topDataRow, layout.normal, row, item && item.rules.annualSickLeaveDays > 0
      ? `${item.rules.annualSickLeaveDays}天`
      : '无病假');
    outputRows.push(topDataRow);
  }

  outputRows.push(cloneRow(source.get(5) ?? '', 5 + topDelta));
  let attendanceTitle = cloneRow(source.get(6) ?? '', attendanceTitleRow);
  attendanceTitle = setCell(attendanceTitle, 1, attendanceTitleRow, `${chineseYear(data.year)}年${CHINESE_MONTHS[data.monthNumber]}月份考勤表`);
  outputRows.push(attendanceTitle);

  let departmentLine = cloneRow(source.get(7) ?? '', departmentRow);
  departmentLine = setCell(departmentLine, 2, departmentRow, ` 部门：${department}`);
  outputRows.push(departmentLine);

  let mainHeader = cloneRow(source.get(8) ?? '', headerRow);
  let mainWeekday = cloneRow(source.get(9) ?? '', subHeaderRow);
  for (let day = 1; day <= data.daysInMonth; day += 1) {
    const column = dayStart + day - 1;
    mainHeader = setCell(mainHeader, column, headerRow, day);
    mainWeekday = setCell(mainWeekday, column, subHeaderRow, weekday(data, day));
  }
  const previousMonth = data.monthNumber === 1 ? 12 : data.monthNumber - 1;
  mainHeader = setCell(mainHeader, layout.previousSick, headerRow, `${previousMonth}月\n病假天数`);
  mainHeader = setCell(mainHeader, layout.paidSick, headerRow, `${previousMonth}月\n已休\n带薪病假`);
  mainHeader = setCell(mainHeader, layout.unpaidSick, headerRow, `${previousMonth}月\n非带薪病假/天`);
  outputRows.push(mainHeader, mainWeekday);

  for (let itemIndex = 0; itemIndex < itemSlots; itemIndex += 1) {
    outputRows.push(...populateAttendanceBlock(
      source,
      data.items[itemIndex],
      itemIndex,
      attendanceDataStart + itemIndex * 5,
      data,
      layout,
      styles,
      merges,
    ));
  }

  outputRows.push(cloneRow(source.get(15) ?? '', legendRow));
  outputRows.push(cloneRow(source.get(16) ?? '', legendRow + 1));
  let signature = cloneRow(source.get(17) ?? '', signatureRow);
  signature = setCell(signature, 1, signatureRow, '制表人：');
  signature = setCell(signature, 11, signatureRow, '复核人：');
  signature = setCell(signature, 23, signatureRow, '人事部审核：');
  signature = setCell(signature, layout.expectedStart, signatureRow, '副总经理审核：');
  outputRows.push(signature);

  const mergeMarkup = `<mergeCells count="${merges.length}">${merges.map((reference) => `<mergeCell ref="${reference}"/>`).join('')}</mergeCells>`;
  sheetXml = sheetXml.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="A1:${excelColumn(layout.note)}${signatureRow}"/>`);
  sheetXml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${outputRows.join('')}</sheetData>`);
  sheetXml = sheetXml.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, mergeMarkup);
  zip.file(sheetPath, sheetXml);

  const drawingPath = `xl/drawings/drawing${sheetNumber}.xml`;
  const drawingFile = zip.file(drawingPath);
  if (drawingFile) {
    const drawingXml = await drawingFile.async('string');
    zip.file(drawingPath, drawingXml.replace(/<xdr:row>(\d+)<\/xdr:row>/g, (_, row: string) => {
      const rowNumber = Number(row);
      return `<xdr:row>${rowNumber >= 7 ? rowNumber + topDelta : rowNumber}</xdr:row>`;
    }));
  }

  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) throw new Error('原始考勤模板缺少 workbook.xml');
  let workbookXml = await workbookFile.async('string');
  const originalSheet = workbookXml.match(new RegExp(`<sheet name="[^"]*" sheetId="([^"]+)" r:id="(rId${sheetNumber})"\\/>`));
  if (!originalSheet) throw new Error('原始考勤模板工作表关系缺失');
  const sheetName = safeSheetName(`${data.year}.${data.monthNumber}（${department}）`);
  workbookXml = workbookXml.replace(/<workbookView([^>]*)activeTab="[^"]*"([^>]*)\/>/, '<workbookView$1activeTab="0"$2/>');
  workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="${originalSheet[1]}" r:id="${originalSheet[2]}"/></sheets>`);
  workbookXml = workbookXml.replace(
    /<definedNames>[\s\S]*?<\/definedNames>/,
    workbookDefinedNames(
      sheetName,
      attendanceTitleRow,
      departmentRow,
      subHeaderRow,
      signatureRow,
      layout.remaining,
      layout.invertedOffsetHelper,
    ),
  );
  zip.file('xl/workbook.xml', workbookXml);

  const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { buffer, department };
}

export async function exportMonthlyAttendanceWorkbook(
  data: AttendanceMonthlyResponse,
  departmentFilter?: string,
) {
  const { buffer, department } = await buildMonthlyAttendanceWorkbook(data, departmentFilter);
  const blobBytes = buffer.buffer instanceof ArrayBuffer
    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    : Uint8Array.from(buffer).buffer;
  const blob = new Blob([blobBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${data.year}-${String(data.monthNumber).padStart(2, '0')}-${department || '全部部门'}考勤表.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
