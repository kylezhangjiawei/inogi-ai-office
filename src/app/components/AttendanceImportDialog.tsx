import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  UserX,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  confirmAttendanceImport,
  previewAttendanceImport,
  type AttendanceImportGroup,
  type AttendanceImportPreview,
} from '../lib/attendanceApi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { cn } from './ui/utils';
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

const STATUS_LABEL: Record<string, string> = {
  normal: '正常',
  late: '迟到',
  early: '早退',
  late_early: '迟到/早退',
  missing: '缺卡',
  absent: '旷工',
  leave: '休假',
  business_trip: '市内出差',
  rest: '轮休',
  holiday: '休假',
  sick_leave: '病假',
  personal_leave: '事假',
  annual_leave: '年假',
  paternity_leave: '陪产假',
  compensatory_leave: '调休',
  study: '学习',
};

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}

export function AttendanceImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (month: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AttendanceImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /** 解析中或写库中不接受新文件，避免覆盖掉正在确认的预览 */
  const busy = parsing || importing;

  const allGroups = useMemo(
    () => (preview ? [...preview.groups, ...preview.noPunchGroups] : []),
    [preview],
  );

  // 服务端汇总是按「默认勾选」算的，实际写库量随勾选变化，这里按勾选实时重算。
  const impact = useMemo(() => {
    const picked = allGroups.filter((group) => selected.has(group.employeeId));
    return picked.reduce(
      (total, group) => ({
        employeeCount: total.employeeCount + 1,
        createCount: total.createCount + group.createCount,
        overwriteCount: total.overwriteCount + group.overwriteCount,
        manualSkipCount: total.manualSkipCount + group.manualSkipCount,
      }),
      { employeeCount: 0, createCount: 0, overwriteCount: 0, manualSkipCount: 0 },
    );
  }, [allGroups, selected]);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSelected(new Set());
    setError('');
    setDragging(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleFile = async (picked: File) => {
    setFile(picked);
    setPreview(null);
    setError('');
    setParsing(true);
    try {
      const result = await previewAttendanceImport(picked);
      setPreview(result);
      // 有打卡的默认勾选；整月无打卡的（多为不用企微打卡的外包人员）交由人工决定。
      setSelected(new Set(result.groups.map((group) => group.employeeId)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '解析考勤文件失败');
      setPreview(null);
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const dropped = event.dataTransfer.files?.[0];
    if (!dropped) return;
    // 先在前端挡掉明显不对的后缀，省一次上传往返
    if (!/\.(xlsx|xls)$/i.test(dropped.name)) {
      toast.error('请拖入企业微信导出的 .xlsx / .xls 日报文件');
      return;
    }
    void handleFile(dropped);
  };

  const toggle = (employeeId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const toggleAll = (groups: AttendanceImportGroup[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      groups.forEach((group) => (checked ? next.add(group.employeeId) : next.delete(group.employeeId)));
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!file || !preview || selected.size === 0) return;
    setImporting(true);
    try {
      const result = await confirmAttendanceImport(file, [...selected]);
      toast.success(
        `已导入 ${result.startDate} ~ ${result.endDate} 考勤：${result.employeeCount} 人 ${result.importedCount} 条` +
          (result.manualSkipCount > 0 ? `，跳过 ${result.manualSkipCount} 条手工修改` : '') +
          (result.linkedAccountCount > 0 ? `，已为 ${result.linkedAccountCount} 人绑定企微账号` : ''),
      );
      onImported(result.month);
      reset();
      onClose();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '导入考勤数据失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      {/* 拖拽落在弹窗里但没对准上传区时，浏览器默认会直接打开这个 xlsx、把弹窗顶掉，这里兜底吃掉 */}
      <DialogContent
        className="horizon-theme horizon-portal border-slate-200 p-0 sm:max-w-4xl"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); setDragging(false); }}
      >
        <DialogHeader className="border-b border-slate-100 bg-slate-50/80 px-6 py-5 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-white">
              <Upload className="h-4.5 w-4.5" />
            </span>
            <div>
              <DialogTitle className="text-balance">导入考勤数据</DialogTitle>
              <DialogDescription className="mt-1 text-pretty">
                企业微信后台 → 打卡 → 统计 → 导出「上下班打卡 日报」，选择导出的 .xlsx 文件
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[62vh] overflow-y-auto px-6 py-5">
          <Input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) void handleFile(picked);
            }}
          />
          {/* 点击或拖拽上传：dragOver 必须 preventDefault 才能触发 drop */}
          <div
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy}
            onClick={() => { if (!busy) inputRef.current?.click(); }}
            onKeyDown={(event) => {
              if (busy) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(event) => { if (busy) return; event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'flex items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 transition',
              busy
                ? 'cursor-not-allowed border-slate-200 bg-slate-50'
                : dragging
                  ? 'cursor-copy border-primary/40 bg-accent'
                  : 'cursor-pointer border-slate-300 hover:border-primary/40 hover:bg-accent',
            )}
          >
            {parsing ? (
              <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
            ) : (
              <FileSpreadsheet className={cn('size-5 shrink-0', dragging ? 'text-primary' : 'text-muted-foreground')} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">
                {dragging ? '松开鼠标即可导入' : file ? file.name : '点击选择或拖拽企业微信日报文件到此处'}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {parsing
                  ? '正在解析…'
                  : preview
                    ? `${preview.startDate} ~ ${preview.endDate} · 共 ${preview.parsedRows} 行`
                    : '支持 .xlsx / .xls'}
              </p>
            </div>
            {file && !busy ? <span className="shrink-0 text-xs font-semibold text-primary">重新选择</span> : null}
          </div>

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {preview ? (
            <div className="mt-5 space-y-5">
              {preview.months.length > 1 ? (
                <p className="rounded-xl bg-sky-50 px-4 py-3 text-xs text-sky-800">
                  文件跨月，{preview.months.map((item) => `${monthLabel(item.month)}（${item.rowCount} 行）`).join('、')}
                  将一并导入；覆盖只发生在 {preview.startDate} ~ {preview.endDate} 区间内，区间外的历史记录不受影响。
                </p>
              ) : null}

              <GroupSection
                title="将导入的人员"
                icon={<Users className="h-4 w-4" />}
                tone="text-slate-700"
                groups={preview.groups}
                selected={selected}
                onToggle={toggle}
                onToggleAll={(checked) => toggleAll(preview.groups, checked)}
              />

              {preview.noPunchGroups.length > 0 ? (
                <GroupSection
                  title="整月无有效打卡"
                  hint="这些人企业微信里整月没有任何打卡记录，导入后当月会全部记为旷工。多为不使用企业微信打卡的外包/派遣人员，默认不勾选。"
                  icon={<UserX className="h-4 w-4" />}
                  tone="text-amber-700"
                  groups={preview.noPunchGroups}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={(checked) => toggleAll(preview.noPunchGroups, checked)}
                />
              ) : null}

              {preview.ambiguous.length > 0 ? (
                <section>
                  <h4 className="text-sm font-semibold text-amber-700">同名多人，需人工处理（{preview.ambiguous.length}）</h4>
                  <p className="mt-1 text-xs text-slate-500">企业微信日报没有工号，只能按姓名匹配；档案里同名的无法判断归属，本次不导入。</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {preview.ambiguous.map((item) => (
                      <li key={item.name} className="rounded-lg bg-amber-50 px-3 py-2">
                        <span className="font-semibold">{item.name}</span>
                        ：{item.candidates.map((candidate) => `${candidate.rosterNo || '无工号'}／${candidate.department || '无部门'}`).join('　vs　')}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {preview.unmatched.length > 0 ? (
                <section>
                  <h4 className="text-sm font-semibold text-slate-700">未匹配到员工档案（{preview.unmatched.length}）</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    这些姓名在「员工入职归档」中不存在或已离职，本次不导入。如需导入请先补齐档案。
                  </p>
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                    {preview.unmatched.join('、')}
                  </p>
                </section>
              ) : null}

              {preview.halfDayLeaves.length > 0 ? (
                <section>
                  <h4 className="text-sm font-semibold text-slate-700">不足一天的请假（{preview.halfDayLeaves.length}）</h4>
                  <p className="mt-1 text-xs text-slate-500">已按 0.5 天计入假期统计，无需手工调整；列在这里供你核对。</p>
                  <ul className="mt-2 space-y-1">
                    {preview.halfDayLeaves.map((item) => (
                      <li key={`${item.employeeName}-${item.attendanceDate}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <span className="font-mono text-slate-500">{item.attendanceDate}</span>
                        　<span className="font-semibold text-slate-800">{item.employeeName}</span>
                        　{STATUS_LABEL[item.status] ?? item.status}
                        {item.note ? <span className="text-muted-foreground">　{item.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">加班处理</p>
                <p className="mt-1 leading-relaxed">
                  企业微信把「实际在岗 − 标准工时」记为加班，早到十几分钟也会计入。本次文件中
                  <span className="font-semibold text-slate-800">
                    {' '}{preview.summary.overtimeRows + preview.summary.filteredOvertimeRows} 行有加班
                  </span>
                  ，其中 {preview.summary.filteredOvertimeRows} 行不足 1 小时（合计 {preview.summary.filteredOvertimeHours} 小时）已按打卡毛刺过滤，
                  实际导入 {preview.summary.overtimeRows} 行 / {preview.summary.overtimeHours} 小时。
                  加班类型判定顺序：法定节假日 → 节假日加班（计入调休）；企微排班为休息 → 休息日加班；其余 → 工作日加班。
                  {preview.yearsMissingHolidayCalendar.length > 0 ? (
                    <span className="font-semibold text-amber-700">
                      　⚠️ 系统未登记 {preview.yearsMissingHolidayCalendar.join('、')} 年的法定节假日安排，
                      该年度的节假日加班会被记成休息日加班，影响调休入账，请先补充节假日日历。
                    </span>
                  ) : null}
                </p>
              </section>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <p className="text-xs text-slate-600">
            {preview ? (
              <>
                已选 <span className="font-semibold text-slate-900">{impact.employeeCount}</span> 人 ·
                新增 <span className="font-semibold text-emerald-700">{impact.createCount}</span> 条 ·
                覆盖 <span className="font-semibold text-amber-700">{impact.overwriteCount}</span> 条
                {impact.manualSkipCount > 0 ? (
                  <> · 保留手工修改 <span className="font-semibold tabular-nums text-primary">{impact.manualSkipCount}</span> 条</>
                ) : null}
              </>
            ) : (
              '选择文件后可预览导入影响'
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="unstyled" type="button" onClick={handleClose} disabled={importing} className="material-button-secondary px-4 py-2 text-xs disabled:opacity-50">
              取消
            </Button>
            <Button variant="unstyled"
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!preview || selected.size === 0 || importing || parsing}
              className="material-button-primary px-4 py-2 text-xs disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              确认导入
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupSection({
  title,
  hint,
  icon,
  tone,
  groups,
  selected,
  onToggle,
  onToggleAll,
}: {
  title: string;
  hint?: string;
  icon: React.ReactNode;
  tone: string;
  groups: AttendanceImportGroup[];
  selected: Set<string>;
  onToggle: (employeeId: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  if (groups.length === 0) {
    return (
      <section>
        <h4 className={cn('flex items-center gap-1.5 text-sm font-semibold', tone)}>{icon}{title}（0）</h4>
        <p className="mt-1 text-xs text-slate-500">没有可导入的人员，请确认文件中的姓名与员工档案一致。</p>
      </section>
    );
  }

  const allChecked = groups.every((group) => selected.has(group.employeeId));
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h4 className={cn('flex items-center gap-1.5 text-sm font-semibold', tone)}>{icon}{title}（{groups.length}）</h4>
        <Button variant="unstyled" type="button" onClick={() => onToggleAll(!allChecked)} className="text-xs font-semibold text-primary hover:underline">
          {allChecked ? '全部取消' : '全部选中'}
        </Button>
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2">姓名 / 工号</th>
              <th className="px-3 py-2">部门</th>
              <th className="px-3 py-2 text-center">打卡</th>
              <th className="px-3 py-2 text-center">旷工</th>
              <th className="px-3 py-2 text-center">请假</th>
              <th className="px-3 py-2 text-center">轮休</th>
              <th className="px-3 py-2 text-center">加班</th>
              <th className="px-3 py-2 text-center">写入影响</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {groups.map((group) => {
              const checked = selected.has(group.employeeId);
              return (
                <tr key={group.employeeId} className={cn('transition', checked ? 'bg-white' : 'bg-slate-50/60 text-muted-foreground')}>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(group.employeeId)}
                      className="size-3.5 cursor-pointer accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-slate-800">{group.employeeName}</span>
                    <span className="ml-1.5 text-muted-foreground">{group.rosterNo || '无工号'}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {group.department || '—'}
                    {group.wecomDepartment && group.wecomDepartment !== group.department ? (
                      <span className="ml-1 text-muted-foreground" title="企业微信中的部门">（企微：{group.wecomDepartment}）</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{group.punchedDays}</td>
                  <td className={cn('px-3 py-2 text-center tabular-nums', group.absentDays > 0 && checked && 'font-semibold text-red-600')}>
                    {group.absentDays || '—'}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{group.leaveDays || '—'}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{group.restDays || '—'}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{group.overtimeHours > 0 ? `${group.overtimeHours}h` : '—'}</td>
                  <td className="px-3 py-2 text-center text-[11px]">
                    <span className="text-emerald-700">+{group.createCount}</span>
                    {group.overwriteCount > 0 ? <span className="ml-1 text-amber-700">改{group.overwriteCount}</span> : null}
                    {group.manualSkipCount > 0 ? <span className="ml-1 tabular-nums text-primary">留{group.manualSkipCount}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
