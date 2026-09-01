import React, { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  Fingerprint,
  HeartPulse,
  Loader2,
  PencilLine,
  RefreshCw,
  Search,
  Settings2,
  Table2,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { useAuth } from './auth';
import { hasPermission } from './lib/permissions';
import { AttendanceImportDialog } from './components/AttendanceImportDialog';
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from './components/horizon/HorizonPage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './components/ui/alert-dialog';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { cn } from './components/ui/utils';
import {
  deleteAttendanceRecord,
  clockAttendance,
  getAttendanceEmployeeDetail,
  getAttendanceOvertime,
  getMonthlyAttendance,
  saveAttendanceRecord,
  saveAttendanceMonth,
  type AttendanceEmployee,
  type AttendanceManualStatus,
  type AttendanceMonthAdjustment,
  type AttendanceMonthlyItem,
  type AttendanceMonthlyResponse,
  type AttendanceEmployeeDetailResponse,
  type AttendanceOvertimeResponse,
  type AttendanceOvertimeType,
  type AttendanceRecord,
  type AttendanceStatus,
  type SaveAttendancePayload,
  type SaveAttendanceMonthPayload,
} from './lib/attendanceApi';
import { exportMonthlyAttendanceWorkbook } from './lib/attendanceWorkbook';
import { routePath } from './lib/routePaths';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const statusMeta: Record<AttendanceStatus, { label: string; short: string; tone: string }> = {
  normal: { label: '正常', short: '正常', tone: 'text-emerald-700 bg-emerald-50' },
  late: { label: '迟到', short: '迟到', tone: 'text-amber-700 bg-amber-50' },
  early: { label: '早退', short: '早退', tone: 'text-orange-700 bg-orange-50' },
  late_early: { label: '迟到/早退', short: '迟早', tone: 'text-red-700 bg-red-50' },
  missing: { label: '缺卡', short: '缺卡', tone: 'text-red-700 bg-red-50' },
  absent: { label: '旷工', short: '旷工×', tone: 'text-red-700 bg-red-50' },
  leave: { label: '休假', short: '休假', tone: 'text-sky-700 bg-sky-50' },
  business_trip: { label: '市内出差', short: '出差▲', tone: 'text-lime-800 bg-lime-50' },
  rest: { label: '排班轮休', short: '轮休', tone: 'text-slate-600 bg-slate-100' },
  holiday: { label: '休假', short: '休假', tone: 'text-sky-700 bg-sky-50' },
  sick_leave: { label: '病假', short: '病假☆', tone: 'text-cyan-800 bg-cyan-50' },
  personal_leave: { label: '事假', short: '事假○', tone: 'text-amber-700 bg-amber-50' },
  annual_leave: { label: '年假', short: '年假', tone: 'text-blue-700 bg-blue-50' },
  paternity_leave: { label: '陪产假', short: '陪产假', tone: 'text-blue-700 bg-blue-50' },
  compensatory_leave: { label: '调休', short: '调休●', tone: 'text-cyan-700 bg-cyan-50' },
  study: { label: '学习', short: '学习△', tone: 'text-teal-700 bg-teal-50' },
};

const manualStatusOptions: Array<{ value: AttendanceManualStatus; label: string }> = [
  { value: 'auto', label: '按打卡时间自动判定' },
  { value: 'rest', label: '排班轮休' },
  { value: 'holiday', label: '休假' },
  { value: 'sick_leave', label: '病假' },
  { value: 'personal_leave', label: '事假' },
  { value: 'annual_leave', label: '年假' },
  { value: 'paternity_leave', label: '陪产假' },
  { value: 'compensatory_leave', label: '调休' },
  { value: 'business_trip', label: '市内出差' },
  { value: 'study', label: '学习' },
  { value: 'absent', label: '旷工' },
];

const manualStatusSet = new Set<AttendanceStatus>([
  ...manualStatusOptions
    .map((item) => item.value)
    .filter((value): value is Exclude<AttendanceManualStatus, 'auto'> => value !== 'auto'),
  'leave',
]);

const emptyMonthlyData: AttendanceMonthlyResponse = {
  month: '',
  year: 0,
  monthNumber: 0,
  daysInMonth: 0,
  departments: [],
  items: [],
  total: 0,
  summary: {
    employeeCount: 0,
    expectedDays: 0,
    normalDays: 0,
    leaveDays: 0,
    exceptionCount: 0,
    overtimeHours: 0,
    countableOvertimeHours: 0,
    compTimeEarnedHours: 0,
    sickLeaveAlertCount: 0,
    completedDays: 0,
  },
};

type AttendanceDraft = SaveAttendancePayload & {
  manualStatus: AttendanceManualStatus;
  deductionMinutes: number;
  overtimeMinutes: number;
  overtimeType: AttendanceOvertimeType;
};

function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function moveMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}

function dateForDay(month: string, day: number) {
  return `${month}-${String(day).padStart(2, '0')}`;
}

function weekdayForDay(month: string, day: number) {
  return WEEKDAYS[new Date(`${dateForDay(month, day)}T00:00:00Z`).getUTCDay()];
}

function createEmptyRecord(employee: AttendanceEmployee, attendanceDate: string): AttendanceRecord {
  return {
    id: null,
    employeeId: employee.id,
    attendanceDate,
    shiftName: '标准班',
    scheduledStart: '08:00',
    scheduledEnd: '18:00',
    checkInTime: '',
    checkOutTime: '',
    status: 'missing',
    workMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    deductionMinutes: 0,
    overtimeMinutes: 0,
    overtimeType: '',
    leaveDayFraction: 1,
    source: '',
    note: '',
    employee,
  };
}

function createDraft(record: AttendanceRecord): AttendanceDraft {
  return {
    employeeId: record.employeeId,
    attendanceDate: record.attendanceDate,
    shiftName: record.shiftName,
    scheduledStart: record.scheduledStart,
    scheduledEnd: record.scheduledEnd,
    checkInTime: record.checkInTime || undefined,
    checkOutTime: record.checkOutTime || undefined,
    manualStatus: record.status === 'leave'
      ? 'holiday'
      : manualStatusSet.has(record.status)
        ? record.status as AttendanceManualStatus
        : 'auto',
    deductionMinutes: record.deductionMinutes,
    overtimeMinutes: record.overtimeMinutes,
    overtimeType: record.overtimeType || 'workday',
    note: record.note,
  };
}

function checkInAssessment(record?: AttendanceRecord) {
  if (!record?.id) return '--';
  if (record.status === 'missing') return record.checkInTime ? '正常' : `缺卡（${record.scheduledStart}）`;
  if (record.status === 'late' || record.status === 'late_early') return `迟到${record.lateMinutes}分钟`;
  return record.checkInTime ? '正常' : '--';
}

function checkOutAssessment(record?: AttendanceRecord) {
  if (!record?.id) return '--';
  if (record.status === 'missing') return record.checkOutTime ? '正常' : `缺卡（${record.scheduledEnd}）`;
  if (record.status === 'early' || record.status === 'late_early') return `早退${record.earlyLeaveMinutes}分钟`;
  return record.checkOutTime ? '正常' : '--';
}

function AttendanceEditor({
  record,
  saving,
  deleting,
  onClose,
  onSaved,
  onDeleted,
}: {
  record: AttendanceRecord | null;
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSaved: (draft: AttendanceDraft) => void;
  onDeleted: (record: AttendanceRecord) => void;
}) {
  const [draft, setDraft] = useState<AttendanceDraft | null>(record ? createDraft(record) : null);

  useEffect(() => {
    setDraft(record ? createDraft(record) : null);
  }, [record]);

  const update = <K extends keyof AttendanceDraft>(key: K, value: AttendanceDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };
  const usesClockTimes = draft?.manualStatus === 'auto';

  return (
    <Dialog open={Boolean(record)} onOpenChange={(open) => { if (!open && !saving && !deleting) onClose(); }}>
      <DialogContent className="horizon-portal max-h-[92vh] overflow-y-auto border-slate-200 p-0 sm:max-w-2xl">
        {record && draft ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSaved({
                ...draft,
                checkInTime: usesClockTimes ? draft.checkInTime : undefined,
                checkOutTime: usesClockTimes ? draft.checkOutTime : undefined,
                overtimeType: draft.overtimeMinutes > 0 ? draft.overtimeType : undefined,
              });
            }}
          >
            <DialogHeader className="border-b border-slate-100 bg-slate-50/80 px-6 py-5 pr-14">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white"><PencilLine className="h-4.5 w-4.5" /></span>
                <div>
                  <DialogTitle>考勤补录与修正</DialogTitle>
                  <DialogDescription className="mt-1">{record.employee.name} · {record.employee.department} · {record.attendanceDate}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-5 px-6 py-5">
              <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">考勤类型
                  <select value={draft.manualStatus} onChange={(event) => update('manualStatus', event.target.value as AttendanceManualStatus)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                    {manualStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">应上班
                  <input type="time" required value={draft.scheduledStart ?? ''} onChange={(event) => update('scheduledStart', event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                </label>
                <label className="text-xs font-semibold text-slate-600">应下班
                  <input type="time" required value={draft.scheduledEnd ?? ''} onChange={(event) => update('scheduledEnd', event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                </label>
              </section>

              <section className={cn('grid gap-4 rounded-2xl border p-4 sm:grid-cols-2', usesClockTimes ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-100 bg-slate-50 opacity-65')}>
                <label className="text-xs font-semibold text-slate-600">上午打卡
                  <input type="time" disabled={!usesClockTimes} value={draft.checkInTime ?? ''} onChange={(event) => update('checkInTime', event.target.value || undefined)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none disabled:bg-slate-100" />
                </label>
                <label className="text-xs font-semibold text-slate-600">下午打卡
                  <input type="time" disabled={!usesClockTimes} value={draft.checkOutTime ?? ''} onChange={(event) => update('checkOutTime', event.target.value || undefined)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none disabled:bg-slate-100" />
                </label>
                <p className="text-xs leading-5 text-slate-500 sm:col-span-2">选择“自动判定”时按班次计算正常、迟到和早退；选择请假、轮休等类型时不要求打卡。</p>
              </section>

              <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">倒挂扣时（分钟）
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    disabled={!record.employee.deductsInvertedHours}
                    value={draft.deductionMinutes}
                    onChange={(event) => update('deductionMinutes', Number(event.target.value) || 0)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">加班（分钟）
                  <input type="number" min={0} max={1440} value={draft.overtimeMinutes} onChange={(event) => update('overtimeMinutes', Number(event.target.value) || 0)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                </label>
                <label className="text-xs font-semibold text-slate-600">加班类型
                  <select disabled={draft.overtimeMinutes <= 0} value={draft.overtimeType} onChange={(event) => update('overtimeType', event.target.value as AttendanceOvertimeType)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none disabled:bg-slate-100">
                    <option value="workday">工作日加班</option>
                    <option value="sunday">周日加班</option>
                    <option value="holiday">法定节假日加班</option>
                  </select>
                </label>
                <p className="text-xs leading-5 text-slate-500 sm:col-span-3">
                  仅填写公司安排少做、后续需要补回的工时；迟到和早退只记考勤异常，不会自动计入倒挂。
                  {!record.employee.deductsInvertedHours ? ' 该员工未开启倒挂抵扣，本项不可填写。' : ''}
                </p>
              </section>

              <label className="block text-xs font-semibold text-slate-600">备注说明
                <textarea rows={3} maxLength={500} value={draft.note ?? ''} onChange={(event) => update('note', event.target.value)} placeholder="补卡原因、审批单号或其他说明" className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
              </label>
            </div>

            <DialogFooter className="border-t border-slate-100 bg-white px-6 py-4 sm:justify-between">
              <div>
                {record.id ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" disabled={saving || deleting} className="rounded-xl text-red-600 hover:bg-red-50 hover:text-red-700">
                        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        {deleting ? '清除中' : '清除本日记录'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="horizon-portal">
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认清除本日考勤记录？</AlertDialogTitle>
                        <AlertDialogDescription>
                          将清除 {record.employee.name} 在 {record.attendanceDate} 的打卡、状态与补录信息。此操作无法直接撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>保留记录</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={deleting}
                          onClick={() => onDeleted(record)}
                          className="bg-red-600 text-white hover:bg-red-700"
                        >
                          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                          确认清除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} disabled={saving || deleting} className="material-button-secondary px-4 py-2.5 text-sm">取消</button>
                <button type="submit" disabled={saving || deleting} className="material-button-primary min-w-28 px-4 py-2.5 text-sm disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {saving ? '保存中' : '保存考勤'}
                </button>
              </div>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MonthAdjustmentEditor({
  item,
  month,
  saving,
  onClose,
  onSaved,
}: {
  item: AttendanceMonthlyItem | null;
  month: string;
  saving: boolean;
  onClose: () => void;
  onSaved: (payload: SaveAttendanceMonthPayload) => void;
}) {
  const [draft, setDraft] = useState<AttendanceMonthAdjustment | null>(item?.adjustment ?? null);
  // 人员长期属性，存在员工档案上，不属于本月结余；放这里是因为紧邻倒挂工时，改起来顺手
  const [deductsInverted, setDeductsInverted] = useState(false);

  useEffect(() => {
    setDraft(item?.adjustment ?? null);
    setDeductsInverted(item?.employee.deductsInvertedHours ?? false);
  }, [item]);

  const updateNumber = (key: keyof AttendanceMonthAdjustment, value: string) => {
    setDraft((current) => current ? { ...current, [key]: Number(value) || 0 } : current);
  };
  const numberFields: Array<{ key: keyof AttendanceMonthAdjustment; label: string; unit: string; hint?: string }> = [
    { key: 'previousOvertimeBalance', label: '上月加班结余', unit: '小时' },
    { key: 'previousCompTimeBalanceHours', label: '上月调休结余', unit: '小时' },
    { key: 'previousMonthSickLeaveDays', label: '上月病假', unit: '天' },
    { key: 'paidSickLeaveDays', label: '已休带薪病假', unit: '天' },
    { key: 'unpaidSickLeaveDays', label: '非带薪病假', unit: '天' },
    {
      key: 'invertedHours',
      label: '倒挂工时',
      unit: '小时',
      hint: !deductsInverted
        ? '该员工未参与倒挂抵扣，不记倒挂扣时'
        : item
          ? `留 0 则按当月明确录入的倒挂扣时自动算得 ${item.rules.autoInvertedHours} 小时；填非 0 则以填写值为准`
          : undefined,
    },
    { key: 'recoveredHours', label: '已补工时', unit: '小时' },
  ];

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="horizon-portal border-slate-200 p-0 sm:max-w-2xl">
        {item && draft ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSaved({
                employeeId: item.employee.id,
                month,
                previousOvertimeBalance: draft.previousOvertimeBalance,
                previousCompTimeBalanceHours: draft.previousCompTimeBalanceHours,
                previousMonthSickLeaveDays: draft.previousMonthSickLeaveDays,
                entitledSickLeaveDays: draft.entitledSickLeaveDays,
                paidSickLeaveDays: draft.paidSickLeaveDays,
                unpaidSickLeaveDays: draft.unpaidSickLeaveDays,
                invertedHours: draft.invertedHours,
                recoveredHours: draft.recoveredHours,
                signature: draft.signature,
                note: draft.note,
                deductsInvertedHours: deductsInverted,
              });
            }}
          >
            <DialogHeader className="border-b border-slate-100 bg-slate-50/80 px-6 py-5 pr-14">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-2xl bg-[#002fa7] text-white"><Settings2 className="size-4" /></span>
                <div><DialogTitle>月度结余与审核字段</DialogTitle><DialogDescription className="mt-1">{item.employee.name} · {monthLabel(month)} · 保存后同步到正式导出表</DialogDescription></div>
              </div>
            </DialogHeader>
            <div className="space-y-5 px-6 py-5">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <input
                  type="checkbox"
                  checked={deductsInverted}
                  onChange={(event) => setDeductsInverted(event.target.checked)}
                  disabled={saving}
                  className="mt-0.5 size-4 cursor-pointer accent-[#002fa7]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-800">参与倒挂抵扣</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                    生产没任务时工资照发，公司安排少做且后续需要补回的工时可单独记为倒挂扣时，后续加班优先冲抵。
                    这是<span className="font-semibold text-slate-700">人员长期设置</span>（保存到员工档案），不只影响本月；
                    未勾选的人不记倒挂扣时，迟到和早退也不会自动计入。
                  </span>
                </span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {numberFields.map((field) => (
                  <label key={field.key} className="text-xs font-semibold text-slate-600">{field.label}
                    <span className="relative mt-1.5 block"><input type="number" min={0} step="0.01" value={Number(draft[field.key]) || 0} onChange={(event) => updateNumber(field.key, event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 px-3 pr-12 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-normal text-slate-400">{field.unit}</span></span>
                    {field.hint ? <span className="mt-1 block text-[10px] font-normal leading-tight text-slate-400">{field.hint}</span> : null}
                  </label>
                ))}
              </div>
              <label className="block text-xs font-semibold text-slate-600">员工签字
                <input value={draft.signature} onChange={(event) => setDraft((current) => current ? { ...current, signature: event.target.value } : current)} placeholder="可留空，打印后手写" className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-500" />
              </label>
              <label className="block text-xs font-semibold text-slate-600">月度备注
                <textarea rows={3} maxLength={500} value={draft.note} onChange={(event) => setDraft((current) => current ? { ...current, note: event.target.value } : current)} placeholder="结余说明、倒挂原因或其他月度备注" className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
              <div className="rounded-xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">年度带薪病假额度固定为 5 天。生产部门人员的工作日加班会自动抵扣剩余倒挂工时；法定节假日加班自动计入调休余额。此处只维护期初结余和人工调整。</div>
            </div>
            <DialogFooter className="border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={onClose} disabled={saving} className="material-button-secondary px-4 py-2.5 text-sm">取消</button>
              <button type="submit" disabled={saving} className="material-button-primary min-w-32 px-4 py-2.5 text-sm disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{saving ? '保存中' : '保存月度字段'}</button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function dayCellValue(record: AttendanceRecord | undefined, rowIndex: number) {
  if (rowIndex === 0) return record?.checkInTime || '--';
  if (rowIndex === 1) return checkInAssessment(record);
  if (rowIndex === 2) return record?.checkOutTime || '--';
  if (rowIndex === 3) return checkOutAssessment(record);
  return record?.deductionMinutes || '';
}

function specialRecord(record?: AttendanceRecord) {
  return Boolean(record && manualStatusSet.has(record.status));
}

function EmployeeAttendanceDetailDialog({
  open,
  loading,
  detail,
  onClose,
  onEdit,
}: {
  open: boolean;
  loading: boolean;
  detail: AttendanceEmployeeDetailResponse | null;
  onClose: () => void;
  onEdit: (employee: AttendanceEmployee, day: number, record?: AttendanceRecord) => void;
}) {
  const recordByDate = new Map(detail?.records.map((record) => [record.attendanceDate, record]) ?? []);
  const rules = detail?.rules;
  const sickProgress = rules
    ? Math.min(100, Math.round((rules.annualSickLeaveDays / rules.annualPaidSickLeaveAllowanceDays) * 100))
    : 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="horizon-portal max-h-[92vh] overflow-y-auto border-slate-200 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-slate-100 bg-slate-950 px-6 py-5 pr-14 text-white">
          <DialogTitle className="text-white">人员考勤详情</DialogTitle>
          <DialogDescription className="text-slate-300">月度考勤、加班规则、调休余额与年度病假额度集中查看</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在读取人员考勤详情</div>
        ) : detail && rules ? (
          <div className="space-y-5 px-6 py-5">
            <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-base font-bold text-white">{detail.employee.name.slice(0, 1)}</span>
                <div><h3 className="font-semibold text-slate-950">{detail.employee.name}</h3><p className="mt-0.5 text-xs text-slate-500">{detail.employee.rosterNo} · {detail.employee.department} · {detail.employee.title}</p></div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={cn('rounded-full px-3 py-1.5 font-semibold', rules.ruleType === 'production_inverted' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>{rules.ruleType === 'production_inverted' ? `${detail.employee.department}倒挂抵扣` : '常规加班统计'}</span>
                <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-600 shadow-sm">{monthLabel(detail.month)}</span>
              </div>
            </section>

            {rules.alerts.length > 0 ? <section className="grid gap-2 sm:grid-cols-2">{rules.alerts.map((alert) => <div key={alert} className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" />{alert}</div>)}</section> : null}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold text-slate-500">可统计加班</p><strong className="mt-1 block text-2xl text-slate-950">{rules.countableOvertimeHours}h</strong><p className="mt-1 text-[11px] text-slate-400">已排除倒挂抵扣与调休入账</p></div>
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4"><p className="text-xs font-semibold text-amber-700">倒挂抵扣 / 剩余</p><strong className="mt-1 block text-2xl text-amber-950">{rules.invertedOffsetHours} / {rules.remainingInvertedHours}h</strong><p className="mt-1 text-[11px] text-amber-700/70">仅生产部门倒挂人员适用</p></div>
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4"><p className="text-xs font-semibold text-cyan-700">调休增加 / 余额</p><strong className="mt-1 block text-2xl text-cyan-950">+{rules.compTimeEarnedHours} / {rules.compTimeBalanceHours}h</strong><p className="mt-1 text-[11px] text-cyan-700/70">法定节假日加班自动入账</p></div>
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-cyan-800">年度带薪病假</p><HeartPulse className="size-4 text-cyan-600" /></div><strong className="mt-1 block text-2xl text-cyan-950 tabular-nums">{rules.annualSickLeaveDays} / {rules.annualPaidSickLeaveAllowanceDays}天</strong><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-100"><div className={cn('h-full rounded-full', rules.excessSickLeaveDays > 0 ? 'bg-red-500' : 'bg-cyan-600')} style={{ width: `${sickProgress}%` }} /></div></div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between"><div><h4 className="text-sm font-semibold text-slate-900">每日考勤</h4><p className="mt-0.5 text-xs text-slate-500">点击日期可直接补录或修改</p></div><span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">可编辑</span></div>
              <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-10">
                {Array.from({ length: detail.daysInMonth }, (_, index) => index + 1).map((day) => {
                  const date = dateForDay(detail.month, day);
                  const record = recordByDate.get(date);
                  const meta = record ? statusMeta[record.status] : null;
                  return <button key={day} type="button" onClick={() => onEdit(detail.employee, day, record)} className={cn('rounded-xl border px-2 py-2 text-left transition hover:border-blue-200 hover:shadow-sm', record ? 'border-transparent' : 'border-dashed border-slate-200 bg-slate-50', meta?.tone)}><span className="block text-[10px] font-semibold opacity-70">{day}日 · 周{weekdayForDay(detail.month, day)}</span><span className="mt-1 block truncate text-xs font-bold">{record ? meta?.short : '未录入'}</span><span className="mt-0.5 block truncate font-mono text-[10px] opacity-70">{record?.checkInTime || '--'} / {record?.checkOutTime || '--'}</span></button>;
                })}
              </div>
            </section>
          </div>
        ) : (
          <div className="flex min-h-72 items-center justify-center text-sm text-slate-500">暂无人员考勤详情</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OvertimeLedger({
  data,
  loading,
  error,
  onDetail,
}: {
  data: AttendanceOvertimeResponse | null;
  loading: boolean;
  error: string;
  onDetail: (employee: AttendanceEmployee) => void;
}) {
  if (loading && !data) return <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在计算加班时长</div>;
  if (error) return <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-red-600"><AlertTriangle className="h-4 w-4" />{error}</div>;
  if (!data || data.items.length === 0) return <div className="flex min-h-72 items-center justify-center text-sm text-slate-500">当前月份暂无加班人员</div>;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['原始加班', `${data.summary.rawOvertimeHours}h`, '每日记录合计'],
          ['倒挂抵扣', `${data.summary.invertedOffsetHours}h`, '生产部门工作日加班'],
          ['计入调休', `${data.summary.compTimeEarnedHours}h`, '法定节假日加班'],
          ['可统计加班', `${data.summary.countableOvertimeHours}h`, '抵扣与调休分流后'],
        ].map(([label, value, helper], index) => <div key={label} className={cn('rounded-2xl border p-4', index === 3 ? 'border-slate-900 bg-slate-950 text-white' : 'border-slate-200 bg-white')}><p className={cn('text-xs font-semibold', index === 3 ? 'text-slate-300' : 'text-slate-500')}>{label}</p><strong className="mt-1 block text-2xl">{value}</strong><p className={cn('mt-1 text-[11px]', index === 3 ? 'text-slate-400' : 'text-slate-400')}>{helper}</p></div>)}
      </section>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <caption className="sr-only">{monthLabel(data.month)}人员加班时长与调休结余</caption>
          <thead className="bg-slate-50 text-slate-500"><tr>{['人员', '规则', '工作日加班', '倒挂抵扣', '可计工作日', '周日加班', '节假日→调休', '调休使用', '调休余额', '可统计合计', '操作'].map((label) => <th key={label} scope="col" className="border-b border-slate-200 px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody>{data.items.map((item) => <tr key={item.employee.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"><td className="px-4 py-3"><p className="font-semibold text-slate-900">{item.employee.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.employee.department} · {item.employee.title}</p></td><td className="px-4 py-3"><span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold', item.rules.ruleType === 'production_inverted' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>{item.rules.ruleType === 'production_inverted' ? '倒挂抵扣' : '常规统计'}</span></td><td className="px-4 py-3 font-mono">{item.summary.workdayOvertimeHours}h</td><td className="px-4 py-3 font-mono text-amber-700">-{item.rules.invertedOffsetHours}h</td><td className="px-4 py-3 font-mono">{item.rules.countableWorkdayOvertimeHours}h</td><td className="px-4 py-3 font-mono">{item.rules.sundayOvertimeHours}h</td><td className="px-4 py-3 font-mono text-cyan-700">+{item.rules.compTimeEarnedHours}h</td><td className="px-4 py-3 font-mono">-{item.rules.compTimeUsedHours}h</td><td className={cn('px-4 py-3 font-mono font-semibold', item.rules.compTimeBalanceHours < 0 ? 'text-red-600' : 'text-cyan-800')}>{item.rules.compTimeBalanceHours}h</td><td className="px-4 py-3 font-mono text-sm font-bold text-slate-950">{item.rules.countableOvertimeHours}h</td><td className="px-4 py-3"><button type="button" onClick={() => onDetail(item.employee)} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-200"><Eye className="h-3.5 w-3.5" />详情</button></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function AttendancePage() {
  const today = useMemo(shanghaiToday, []);
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [activeView, setActiveView] = useState<'attendance' | 'overtime'>('attendance');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [data, setData] = useState<AttendanceMonthlyResponse>({ ...emptyMonthlyData, month: currentMonth });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorRecord, setEditorRecord] = useState<AttendanceRecord | null>(null);
  const [adjustmentItem, setAdjustmentItem] = useState<AttendanceMonthlyItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [clockingEmployeeId, setClockingEmployeeId] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { user } = useAuth();
  // 导入会批量覆盖考勤，权限独立于「查看考勤页」，没授权就不显示入口
  const canImport = hasPermission(user?.permissions ?? [], 'attendance:import');
  const [overtimeData, setOvertimeData] = useState<AttendanceOvertimeResponse | null>(null);
  const [overtimeLoading, setOvertimeLoading] = useState(false);
  const [overtimeError, setOvertimeError] = useState('');
  const [detailEmployee, setDetailEmployee] = useState<AttendanceEmployee | null>(null);
  const [employeeDetail, setEmployeeDetail] = useState<AttendanceEmployeeDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadError('');
      getMonthlyAttendance({ month, search: search.trim(), department }, controller.signal)
        .then(setData)
        .catch((error) => {
          if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : '读取月度考勤失败');
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [month, search, department, refreshKey]);

  useEffect(() => {
    if (activeView !== 'overtime') return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setOvertimeLoading(true);
      setOvertimeError('');
      getAttendanceOvertime({ month, search: search.trim(), department }, controller.signal)
        .then(setOvertimeData)
        .catch((error) => {
          if (!controller.signal.aborted) setOvertimeError(error instanceof Error ? error.message : '读取加班时长表失败');
        })
        .finally(() => { if (!controller.signal.aborted) setOvertimeLoading(false); });
    }, search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeView, month, search, department, refreshKey]);

  useEffect(() => {
    if (!detailEmployee) {
      setEmployeeDetail(null);
      return undefined;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    getAttendanceEmployeeDetail(detailEmployee.id, month, controller.signal)
      .then(setEmployeeDetail)
      .catch((error) => {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : '读取人员考勤详情失败');
      })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [detailEmployee, month, refreshKey]);

  const reload = () => setRefreshKey((value) => value + 1);

  const openEditor = (employee: AttendanceEmployee, day: number, record?: AttendanceRecord) => {
    setEditorRecord(record ?? createEmptyRecord(employee, dateForDay(month, day)));
  };

  const openEditorFromDetail = (employee: AttendanceEmployee, day: number, record?: AttendanceRecord) => {
    setDetailEmployee(null);
    openEditor(employee, day, record);
  };

  const handleSave = async (draft: AttendanceDraft) => {
    setSaving(true);
    try {
      await saveAttendanceRecord(draft);
      setEditorRecord(null);
      reload();
      toast.success('考勤记录已保存，月度汇总已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存考勤记录失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: AttendanceRecord) => {
    if (!record.id) return;
    setDeleting(true);
    try {
      await deleteAttendanceRecord(record.id);
      setEditorRecord(null);
      reload();
      toast.success('本日考勤记录已清除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清除考勤记录失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveAdjustment = async (payload: SaveAttendanceMonthPayload) => {
    setSavingAdjustment(true);
    try {
      await saveAttendanceMonth(payload);
      setAdjustmentItem(null);
      reload();
      toast.success('月度结余与审核字段已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存月度结余失败');
    } finally {
      setSavingAdjustment(false);
    }
  };

  const handleClock = async (item: AttendanceMonthlyItem, type: 'check-in' | 'check-out') => {
    setClockingEmployeeId(item.employee.id);
    try {
      await clockAttendance(item.employee.id, type);
      reload();
      toast.success(`${item.employee.name}${type === 'check-in' ? '上班' : '下班'}打卡成功`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打卡失败');
    } finally {
      setClockingEmployeeId('');
    }
  };

  const handleExport = async () => {
    if (data.items.length === 0) {
      toast.error('当前没有可导出的考勤人员');
      return;
    }
    setExporting(true);
    try {
      await exportMonthlyAttendanceWorkbook(data, department);
      toast.success(`已按正式模板导出 ${monthLabel(month)}考勤表`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出考勤表失败');
    } finally {
      setExporting(false);
    }
  };

  const dayColumns = Array.from({ length: data.daysInMonth }, (_, index) => index + 1);
  const rowLabels = ['上午打卡', '上午判定', '下午打卡', '下午判定', '倒挂扣时'];

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full w-full max-w-[1800px] min-w-0 flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5 xl:h-full xl:min-h-0">
      <HorizonPageHeader
        Icon={CalendarDays}
        eyebrow="HR OPERATIONS · ATTENDANCE"
        title="人员考勤"
        description="把月度打卡、异常补录、倒挂抵扣与调休结余集中在同一工作台。"
        meta={<><span>{monthLabel(month)}</span><span aria-hidden="true">·</span><span>上海时区</span><span aria-hidden="true">·</span><span>{activeView === 'attendance' ? '考勤明细' : '加班核算'}</span></>}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link to={routePath('page:employee-archive', '/employee-archive')}><Users className="size-4" />员工档案</Link>
            </Button>
            {canImport ? <Button type="button" variant="outline" onClick={() => setImportOpen(true)}><Upload className="size-4" />导入考勤数据</Button> : null}
            <Button type="button" onClick={() => void handleExport()} disabled={exporting} className="hz-primary-action">
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              导出正式考勤表
            </Button>
          </>
        )}
      />

      <HorizonMetricGrid className="!grid-cols-2 lg:!grid-cols-3 2xl:!grid-cols-6">
        <HorizonMetric Icon={Users} label="考勤人数" value={data.summary.employeeCount} note="来自员工入职归档" />
        <HorizonMetric Icon={CheckCircle2} label="正常出勤" value={`${data.summary.normalDays}天`} note="含已打卡的迟到早退" tone="success" />
        <HorizonMetric Icon={AlertTriangle} label="异常待处理" value={data.summary.exceptionCount} note="缺卡、旷工、迟到早退" tone={data.summary.exceptionCount > 0 ? 'danger' : 'success'} />
        <HorizonMetric Icon={Clock3} label="可统计加班" value={`${data.summary.countableOvertimeHours}h`} note="倒挂与调休分流后" tone="brand" />
        <HorizonMetric Icon={CalendarDays} label="调休增加" value={`${data.summary.compTimeEarnedHours}h`} note="来自法定节假日加班" tone="brand" />
        <HorizonMetric Icon={HeartPulse} label="病假超额" value={data.summary.sickLeaveAlertCount} note="年度带薪额度为 5 天" tone={data.summary.sickLeaveAlertCount > 0 ? 'warning' : 'neutral'} />
      </HorizonMetricGrid>

      <section className="hz-surface flex min-h-[36rem] flex-none flex-col overflow-hidden xl:min-h-0 xl:flex-1">
        <HorizonSectionHeader
          Icon={activeView === 'attendance' ? Table2 : Clock3}
          title={activeView === 'attendance' ? '月度考勤矩阵' : '加班时长核算'}
          description={activeView === 'attendance' ? '点击日期单元格补录或修正，点击姓名查看完整人员详情。' : '自动执行生产部门倒挂抵扣、节假日调休入账和常规加班统计。'}
          trailing={<span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">{activeView === 'attendance' ? '可编辑' : '规则自动核算'}</span>}
        />

        <div className="hz-toolbar flex shrink-0 flex-col gap-3 border-b px-4 py-3 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
          <div role="tablist" aria-label="考勤视图" className="flex w-fit items-center rounded-xl bg-slate-100 p-1">
            <button type="button" role="tab" aria-selected={activeView === 'attendance'} aria-controls="attendance-view-panel" onClick={() => setActiveView('attendance')} className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition', activeView === 'attendance' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800')}><Table2 className="size-3.5" />考勤明细</button>
            <button type="button" role="tab" aria-selected={activeView === 'overtime'} aria-controls="attendance-view-panel" onClick={() => setActiveView('overtime')} className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition', activeView === 'overtime' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800')}><Clock3 className="size-3.5" />加班时长</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
              <button type="button" aria-label="查看上个月" onClick={() => setMonth(moveMonth(month, -1))} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"><ChevronLeft className="size-4" /></button>
              <label htmlFor="attendance-month" className="sr-only">考勤月份</label>
              <input id="attendance-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-8 w-[130px] border-0 bg-transparent px-2 text-sm font-semibold text-slate-700 outline-none" />
              <button type="button" aria-label="查看下个月" onClick={() => setMonth(moveMonth(month, 1))} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"><ChevronRight className="size-4" /></button>
            </div>
            {month !== currentMonth ? <Button type="button" size="sm" variant="outline" onClick={() => setMonth(currentMonth)}>回到本月</Button> : null}
            <Button type="button" size="sm" variant="outline" onClick={reload} disabled={loading}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />刷新</Button>
          </div>
        </div>

        <div className="grid shrink-0 gap-2 border-b border-slate-100 bg-white px-4 py-3 sm:px-5 md:grid-cols-[minmax(260px,1fr)_220px]">
          <label className="relative block">
            <span className="sr-only">搜索考勤人员</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名、工号、部门或岗位" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="block">
            <span className="sr-only">筛选部门</span>
            <select value={department} onChange={(event) => setDepartment(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500"><option value="">全部部门</option>{data.departments.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          </label>
        </div>

        {activeView === 'overtime' ? (
          <div id="attendance-view-panel" role="tabpanel" className="contents"><OvertimeLedger data={overtimeData} loading={overtimeLoading} error={overtimeError} onDetail={setDetailEmployee} /></div>
        ) : <div id="attendance-view-panel" role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          {loadError ? (
            <HorizonEmptyState Icon={AlertTriangle} title="月度考勤读取失败" description={loadError} action={<Button type="button" variant="outline" onClick={reload}><RefreshCw className="size-4" />重新加载</Button>} />
          ) : loading && data.items.length === 0 ? (
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在生成月度考勤矩阵</div>
          ) : data.items.length === 0 ? (
            <HorizonEmptyState Icon={Users} title="暂无考勤人员" description="请先在员工入职归档中维护在职人员，再回来生成月度考勤矩阵。" action={<Button asChild variant="outline"><Link to={routePath('page:employee-archive', '/employee-archive')}>前往员工档案</Link></Button>} />
          ) : (
            <table className="border-separate border-spacing-0 text-center text-[11px]" style={{ minWidth: `${280 + data.daysInMonth * 72 + 13 * 86}px` }}>
              <caption className="sr-only">{monthLabel(month)}人员每日考勤与月度汇总矩阵</caption>
              <thead className="sticky top-0 z-30 bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" rowSpan={2} className="sticky left-0 z-40 w-12 min-w-12 border-b border-r border-slate-200 bg-slate-50 px-2 py-2">序号</th>
                  <th scope="col" rowSpan={2} className="sticky left-12 z-40 w-40 min-w-40 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">姓名 / 岗位</th>
                  <th scope="col" rowSpan={2} className="sticky left-52 z-40 w-20 min-w-20 border-b border-r border-slate-200 bg-slate-50 px-2 py-2">考勤项</th>
                  {dayColumns.map((day) => <th key={day} scope="col" className={cn('min-w-[72px] border-b border-r border-slate-200 px-1 py-1.5', weekdayForDay(month, day) === '日' && 'bg-amber-50 text-amber-700')}>{day}</th>)}
                  {['应出勤', '正常', '轮休', '休假', '病假', '事假', '年假', '旷工', '迟到早退', '陪产假', '工作日加班', '周日加班', '节假日加班'].map((label) => <th key={label} scope="col" rowSpan={2} className="min-w-[86px] border-b border-r border-slate-200 px-2 py-2">{label}</th>)}
                </tr>
                <tr>{dayColumns.map((day) => <th key={day} scope="col" className={cn('border-b border-r border-slate-200 px-1 py-1', weekdayForDay(month, day) === '日' && 'bg-amber-50 text-amber-700')}>{weekdayForDay(month, day)}</th>)}</tr>
              </thead>
              <tbody className="bg-white">
                {data.items.map((item, itemIndex) => {
                  const byDate = new Map(item.records.map((record) => [record.attendanceDate, record]));
                  const summary = item.summary;
                  const todayRecord = byDate.get(today);
                  const todayClockType = month === currentMonth && (!todayRecord?.checkInTime || !todayRecord?.checkOutTime)
                    && !specialRecord(todayRecord)
                    ? todayRecord?.checkInTime ? 'check-out' : 'check-in'
                    : null;
                  const summaryValues = [summary.expectedDays, summary.normalDays, summary.restDays, summary.holidayDays, summary.sickLeaveDays, summary.personalLeaveDays, summary.annualLeaveDays, summary.absentDays, summary.lateEarlyCount, summary.paternityLeaveDays, summary.workdayOvertimeHours, summary.sundayOvertimeHours, summary.holidayOvertimeHours];
                  return (
                    <Fragment key={item.employee.id}>
                      {rowLabels.map((rowLabel, rowIndex) => (
                        <tr key={rowLabel} className={cn(rowIndex === 4 && 'border-b-2 border-slate-300')}>
                          {rowIndex === 0 ? <td rowSpan={5} className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-2 font-semibold text-slate-500">{itemIndex + 1}</td> : null}
                          {rowIndex === 0 ? <th scope="rowgroup" rowSpan={5} className="sticky left-12 z-20 border-b border-r border-slate-200 bg-white px-3 py-2 text-left"><button type="button" onClick={() => setDetailEmployee(item.employee)} className="font-semibold text-slate-900 hover:text-blue-700 hover:underline">{item.employee.name}</button><p className="mt-1 text-[10px] font-normal text-slate-400">{item.employee.rosterNo || '未设置工号'}</p><p className="mt-0.5 text-[10px] font-normal text-slate-500">{item.employee.department} · {item.employee.title}</p>{item.rules.alerts.length > 0 ? <p className="mt-1 truncate text-[10px] font-semibold text-red-600">{item.rules.alerts[0]}</p> : null}<div className="mt-2 flex flex-wrap gap-1"><button type="button" onClick={() => setDetailEmployee(item.employee)} className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-200"><Eye className="size-3" />详情</button><button type="button" onClick={() => setAdjustmentItem(item)} className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100"><Settings2 className="size-3" />月度结余</button>{todayClockType ? <button type="button" disabled={clockingEmployeeId === item.employee.id} onClick={() => void handleClock(item, todayClockType)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">{clockingEmployeeId === item.employee.id ? <Loader2 className="size-3 animate-spin" /> : <Fingerprint className="size-3" />}{todayClockType === 'check-in' ? '上班打卡' : '下班打卡'}</button> : null}</div></th> : null}
                          <th scope="row" className={cn('sticky left-52 z-20 border-b border-r border-slate-200 px-2 py-1.5 font-medium', rowIndex === 4 ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600')}>{rowLabel}</th>
                          {dayColumns.map((day) => {
                            const record = byDate.get(dateForDay(month, day));
                            const isSpecial = specialRecord(record);
                            if (isSpecial && rowIndex > 0) return null;
                            const tone = record ? statusMeta[record.status].tone : 'text-slate-300 bg-white';
                            return (
                              <td key={day} rowSpan={isSpecial ? 5 : 1} className={cn('border-b border-r border-slate-200 p-0', tone)}>
                                <button type="button" onClick={() => openEditor(item.employee, day, record)} title={`${item.employee.name} ${dateForDay(month, day)}：${record ? statusMeta[record.status].label : '未录入'}`} className={cn('flex h-full min-h-7 w-full items-center justify-center px-1 py-1 leading-tight transition hover:ring-2 hover:ring-inset hover:ring-blue-300', rowIndex === 0 && !isSpecial && 'font-mono font-semibold')}>
                                  {isSpecial && record ? statusMeta[record.status].short : dayCellValue(record, rowIndex)}
                                </button>
                              </td>
                            );
                          })}
                          {rowIndex === 0 ? summaryValues.map((value, index) => <td key={index} rowSpan={5} className="border-b border-r border-slate-200 bg-slate-50/60 px-2 font-semibold text-slate-700">{value || ''}</td>) : null}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>}

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-xs text-slate-500">
          <span>{activeView === 'attendance' ? '出勤√　事假○　病假☆　学习△　旷工×　迟到※　早退◇　市内出差▲　调休●' : '工作日加班先抵扣生产部门倒挂工时；法定节假日加班进入调休余额'}</span>
          <span>{monthLabel(month)} · 共 {activeView === 'attendance' ? data.total : overtimeData?.total ?? 0} 人 · {activeView === 'attendance' ? '点击单元格编辑' : '点击详情查看个人记录'}</span>
        </footer>
      </section>

      <AttendanceEditor record={editorRecord} saving={saving} deleting={deleting} onClose={() => setEditorRecord(null)} onSaved={(draft) => void handleSave(draft)} onDeleted={(record) => void handleDelete(record)} />
      <MonthAdjustmentEditor item={adjustmentItem} month={month} saving={savingAdjustment} onClose={() => setAdjustmentItem(null)} onSaved={(payload) => void handleSaveAdjustment(payload)} />
      <EmployeeAttendanceDetailDialog open={Boolean(detailEmployee)} loading={detailLoading} detail={employeeDetail} onClose={() => setDetailEmployee(null)} onEdit={openEditorFromDetail} />
      <AttendanceImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(importedMonth) => {
          // 导入的月份可能不是当前查看的月份，切过去才看得到结果
          if (importedMonth !== month) setMonth(importedMonth);
          reload();
        }}
      />
    </div>
  );
}
