import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, ChevronRight, Download, Plus, Search, Paperclip, ExternalLink, ListChecks } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { NativeSelect } from '../components/ui/native-select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge as UiBadge } from '../components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { HorizonEmptyState, HorizonSectionHeader } from '../components/horizon/HorizonPage';
import { csvText, hrModules, type HrProps, type HrRecord } from '../../mocks/hrPreview';
import { canManageModule, ganttDateRanges, nextRecurringTask, numericFields, recurrenceOptions, validateHrRecord } from './hrLogic';
import { intakeErrors } from './recruitmentLogic';

export function Badge({ children }: { children: React.ReactNode }) {
  const s = String(children);
  return <UiBadge variant="secondary" className="hr-badge" data-tone={/已完成|已通过|已确认|已批准|有效|已齐全|已归档/.test(s) ? 'success' : /待|审核|回收|修订|评价中/.test(s) ? 'warning' : 'neutral'}>{children}</UiBadge>;
}
export function Notice({ children }: { children: React.ReactNode }) { return <p className="hr-notice">{children}</p>; }
export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <span className="hr-select-label"><NativeSelect aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o}>{o}</option>)}</NativeSelect></span>;
}
export function ViewSwitch({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void;
  options: (string | { value: string; label: React.ReactNode })[];
}) {
  return <ToggleGroup type="single" role="radiogroup" className="hr-view-switch" aria-label={label} value={value} onValueChange={next => { if (next) onChange(next); }}>
    {options.map(option => { const item = typeof option === 'string' ? { value: option, label: option } : option;
      return <ToggleGroupItem key={item.value} value={item.value}>{item.label}</ToggleGroupItem>;
    })}
  </ToggleGroup>;
}
export function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Facts({ row, fields }: { row: HrRecord; fields?: string[] }) {
  const keys = fields ?? Object.keys(row.fields).filter(k => !/记录JSON|阶段记录|配置JSON|行动项JSON|能力模型JSON|个人进度/.test(k));
  return <dl className="hr-facts">{keys.map(k => <div key={k}><dt>{k}</dt><dd>{row.fields[k] || '待填写'}</dd></div>)}</dl>;
}
export function Timeline({ row }: { row: HrRecord }) {
  return <details className="hr-history" open={row.history.length < 4}><summary>操作记录 · {row.history.length} 条</summary><ol>{row.history.map((h, i) => <li key={i}>{h}</li>)}</ol></details>;
}

type LocalAttachment = { name: string; url: string; file: File };
const sessionAttachments = new Map<string, LocalAttachment>();
export function getSessionAttachment(key: string) { return sessionAttachments.get(key); }
export function copySessionAttachment(fromKey: string, toKey: string) {
  const source = sessionAttachments.get(fromKey);
  if (!source) return false;
  if (fromKey === toKey) return true;
  const previous = sessionAttachments.get(toKey);
  if (previous) URL.revokeObjectURL(previous.url);
  sessionAttachments.set(toKey, { ...source, url: URL.createObjectURL(source.file) });
  return true;
}
export function Attachment({ label = '选择 PDF 材料', accept = '.pdf', onChange, storageKey }: {
  label?: string; accept?: string; storageKey?: string; onChange: (name: string, file?: File) => void;
}) {
  const localId = useId(); const key = storageKey || localId;
  const [attachment, setAttachment] = useState<LocalAttachment | undefined>(() => sessionAttachments.get(key));
  const [error, setError] = useState('');
  useEffect(() => { setAttachment(sessionAttachments.get(key)); setError(''); }, [key]);
  return <div className="hr-attachment">
    <label><span className="hr-attachment-label"><Paperclip size={15} />{label}</span><Input type="file" aria-label={label} accept={accept} onChange={e => {
      const f = e.target.files?.[0]; if (!f) return;
      if (f.size > 20 * 1024 * 1024) { setError('文件不能超过 20 MB'); e.target.value = ''; return; }
      if (!accept.split(',').some(ext => f.name.toLowerCase().endsWith(ext.trim().toLowerCase()))) { setError('文件类型不符合要求'); e.target.value = ''; return; }
      const previous = sessionAttachments.get(key); if (previous) URL.revokeObjectURL(previous.url);
      const next = { name: f.name, file: f, url: URL.createObjectURL(f) };
      sessionAttachments.set(key, next); setAttachment(next); setError(''); onChange(f.name, f);
    }} /></label>
    {attachment && <div className="hr-attachment-actions"><span>{attachment.name}</span><a href={attachment.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />查看</a><a href={attachment.url} download={attachment.name}><Download size={13} />下载本地材料</a></div>}
    <small>{storageKey ? '材料保留在当前浏览器会话，可切换记录后查看；刷新清除。' : '仅在当前选择窗口本地预览。'}尚未上传服务器。</small>
    {error && <p role="alert" className="hr-error">{error}</p>}
  </div>;
}

function fieldOptions(p: HrProps, field: string, row: HrRecord) {
  if (field === '循环周期') return recurrenceOptions;
  if (field === '任务类型') return ['周期任务', '专项项目'];
  if (field === '会议室') return ['大会议室', '电影院（报告厅）', '小会议室·老板办旁', '小会议室·研发对面'];
  if (field === '入离职状态') return ['待入职', '在职', '已离职'];
  if (field === '用工类型') return ['正式', '劳务', '实习', '外包'];
  if (field === '上级部门') return ['总经办', ...p.all.org.filter(r => r.id !== row.id).map(r => r.title)];
  return null;
}
export function RecordForm({ p, row, onClose, onSaved }: { p: HrProps; row: HrRecord | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const returnFocus = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [draft, setDraft] = useState<HrRecord>(() => row ? { ...row, fields: { ...row.fields } } : {
    id: '', title: '', dept: p.department || '人事行政部', owner: '', status: p.module.statuses[0], date: '2026-10-16', detail: '',
    fields: { ...Object.fromEntries(p.module.fields.map(f => [f, ''])), ...(p.module.id === 'tasks' ? { '任务类型': '专项项目', '开始日期': '2026-10-09', '循环周期': '不重复' } : {}) }, history: [],
  });
  const [error, setError] = useState('');
  const initialDraft = useRef(draft);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => {
    if (JSON.stringify(draft) !== JSON.stringify(initialDraft.current)) setConfirmClose(true);
    else onClose();
  };
  const setField = (field: string, value: string) => setDraft(d => ({ ...d, fields: { ...d.fields, [field]: value } }));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const issue = validateHrRecord(p.module.id, draft, p.all);
    if (issue) { setError(issue); return; }
    if (p.module.id === 'apply' || p.module.id === 'collect') {
      const intakeIssue = intakeErrors(draft.fields, p.module.id).find(message => !message.startsWith('待补充：'));
      if (intakeIssue) { setError(intakeIssue); return; }
    }
    let savedId = row?.id;
    if (row) p.update(row.id, draft, '编辑并保存资料');
    else { const { id, history, ...newRow } = draft; savedId = p.add(p.module.id, newRow); }
    if (savedId) onSaved?.(savedId);
    onClose();
  }
  return <><Dialog open onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className="sm:max-w-[800px] hr-dialog" onCloseAutoFocus={event => {
    if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); }
  }}>
    <DialogHeader><DialogTitle>{row ? '编辑' : '新建'}{p.module.title}</DialogTitle><DialogDescription>更改仅保存在本次演示会话中。已批准内容的关键字段变更后需重新审批。</DialogDescription></DialogHeader>
    <form onSubmit={submit} onChange={() => setError('')}>
      <div className="hr-form-fields"><div className="hr-form-grid">
        <label>名称<Input required maxLength={100} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></label>
        <label>所属部门<Input required value={draft.dept} onChange={e => setDraft(d => ({ ...d, dept: e.target.value }))} /></label>
        <label>负责人<Input required value={draft.owner} onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))} /></label>
        <label>{p.module.id === 'room' ? '预约日期' : '截止／计划日期'}<Input required type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></label>
        {p.module.fields.map(field => {
          const options = fieldOptions(p, field, draft);
          const multiline = /职责|要求|评价|依据|说明|初稿|反馈|目标|任务|原因|结论|意见|摘要|行动|适配|经历|家庭|证书|技能|竞业|发展通道|兼岗|核心职能/.test(field);
          const value = draft.fields[field] || '';
          return <label key={field} className={multiline ? 'hr-wide' : undefined}>{field}
            {options ? <NativeSelect aria-label={field} value={value} onChange={e => setField(field, e.target.value)}><option value="">请选择</option>{options.map(option => <option key={option}>{option}</option>)}</NativeSelect>
              : /日期$|到岗时间$|有效期$|到期日$/.test(field) ? <Input aria-label={field} type="date" value={value} onChange={e => setField(field, e.target.value)} />
              : field === '开始时间' || field === '结束时间' ? <Input aria-label={field} type="time" value={value} onChange={e => setField(field, e.target.value)} />
              : numericFields.includes(field) ? <Input aria-label={field} type="number" min="0" step={/人数|考试次数/.test(field) ? '1' : 'any'} value={value} onChange={e => setField(field, e.target.value)} />
              : multiline ? <Textarea aria-label={field} rows={3} maxLength={10000} value={value} onChange={e => setField(field, e.target.value)} />
              : <Input aria-label={field} readOnly={Boolean(row?.fields['人员编号']) && field === '人员编号' && ['archive','collect'].includes(p.module.id)} maxLength={500} value={value} onChange={e => setField(field, e.target.value)} />}
          </label>;
        })}
      </div></div>
      {error && <p className="hr-error" role="alert">{error}</p>}
      <div className="hr-actions hr-form-actions"><Button type="button" variant="outline" onClick={requestClose}>取消</Button><Button type="submit">保存本次演示</Button></div>
    </form>
  </DialogContent></Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle><AlertDialogDescription>关闭后，本次尚未保存的输入将丢失。可以继续编辑并保存。</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmClose(false)}>继续编辑</AlertDialogCancel><AlertDialogAction onClick={onClose}>放弃修改</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}

export function Desk({ p, children, allowNew = true, allowEdit = true, view, tools, month = '2026-10', exportData, onRecordSaved }: {
  p: HrProps; children?: (row: HrRecord) => React.ReactNode; allowNew?: boolean; allowEdit?: boolean; view?: 'board' | 'gantt'; tools?: React.ReactNode; month?: string;
  exportData?: (rows: HrRecord[]) => { headers: string[]; rows: string[][] };
  onRecordSaved?: (id: string) => void;
}) {
  const [query, setQuery] = useState(''); const [dept, setDept] = useState('全部部门'); const [status, setStatus] = useState('全部状态');
  const [selected, setSelected] = useState(p.rows[0]?.id); const [editing, setEditing] = useState<HrRecord | null | undefined>();
  const [detailRevision, setDetailRevision] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const recordsRef = useRef<HTMLElement>(null);
  const matches = (r: HrRecord, search: string, department: string, state: string) => (department === '全部部门' || r.dept === department) && (state === '全部状态' || r.status === state) && [r.title, r.id, r.owner, ...Object.values(r.fields)].join(' ').toLowerCase().includes(search.trim().toLowerCase());
  const filtered = p.rows.filter(r => matches(r, query, dept, status));
  const ganttRanges = view === 'gantt' ? ganttDateRanges(month) : [];
  const row = filtered.find(r => r.id === selected) ?? filtered[0];
  const hasFilters = Boolean(query || dept !== '全部部门' || status !== '全部状态');
  const applyFilters = (search: string, department: string, state: string) => {
    const next = p.rows.filter(r => matches(r, search, department, state));
    setSelected(next.find(r => r.id === row?.id)?.id ?? next[0]?.id);
    setQuery(search); setDept(department); setStatus(state);
  };
  const clearFilters = () => applyFilters('', '全部部门', '全部状态');
  const editable = canManageModule(p.module.id, p.role) || (p.module.id === 'collect' && p.role === '员工本人');
  const scrollToDetail = () => {
    const detail = detailRef.current, records = recordsRef.current;
    if (detail && records && detail.getBoundingClientRect().top >= records.getBoundingClientRect().bottom - 1) {
      detail.scrollIntoView({ behavior: 'instant', block: 'start' });
      detail.focus({ preventScroll: true });
    }
  };
  const select = (id: string) => {
    setSelected(id);
    requestAnimationFrame(scrollToDetail);
  };
  const saved = (id: string) => {
    setSelected(id); setQuery(''); setDept('全部部门'); setStatus('全部状态');
    setDetailRevision(v => v + 1);
    onRecordSaved?.(id);
    requestAnimationFrame(scrollToDetail);
  };
  const exportRows = () => {
    const data = exportData ? exportData(filtered) : {
      headers: ['编号', '名称', '部门', '负责人', '状态', '计划日期', ...p.module.fields],
      rows: filtered.map(r => [r.id, r.title, r.dept, r.owner, r.status, r.date, ...p.module.fields.map(f => r.fields[f] || '')]),
    };
    download(`${p.module.title}-演示.csv`, csvText(data.headers, data.rows));
  };
  return <>
    <div className="hr-toolbar">
      <label className="hr-search"><Search size={16} /><Input aria-label="搜索记录" placeholder="搜索名称、编号或关键词" value={query} onChange={e => applyFilters(e.target.value, dept, status)} /></label>
      <Select label="部门筛选" value={dept} onChange={value => applyFilters(query, value, status)} options={['全部部门', ...new Set(p.rows.map(r => r.dept))]} />
      <Select label="状态筛选" value={status} onChange={value => applyFilters(query, dept, value)} options={['全部状态', ...new Set([...p.module.statuses, ...p.rows.map(r => r.status)])]} />
      {tools}<div className="hr-toolbar-end"><Button variant="outline" size="sm" onClick={exportRows} disabled={!filtered.length}><Download size={15} />导出</Button>{allowNew && editable && p.role !== '员工本人' && <Button size="sm" onClick={() => setEditing(null)}><Plus size={15} />新建</Button>}{allowNew && editable && p.role === '员工本人' && ['tasks', 'room', 'meeting', 'expense'].includes(p.module.id) && <Button size="sm" onClick={() => setEditing(null)}><Plus size={15} />新建</Button>}</div>
    </div>
    {hasFilters && filtered.length > 0 && <div className="hr-filter-summary"><span role="status">筛选出 {filtered.length} / {p.rows.length} 条记录</span><Button variant="ghost" size="sm" onClick={clearFilters}>清除筛选</Button></div>}
    <div className={view ? 'hr-workspace hr-workspace-wide' : 'hr-workspace'}>
      <section className="hr-panel hr-records" ref={recordsRef} tabIndex={-1} aria-label={`${p.module.title}记录列表`}><HorizonSectionHeader title={`${p.module.title} · ${filtered.length}`} trailing={<span className="hr-subtle">演示数据</span>} />
        {filtered.length > 0 && view && <p className="hr-table-hint">左右滚动查看{view === 'gantt' ? '完整时间轴' : '全部任务状态'}。</p>}
        {!filtered.length ? <HorizonEmptyState Icon={Search} title="没有符合条件的记录" description={p.role === '员工本人' ? '当前仅显示所选演示员工可见的数据；新员工资料需由 HR 建立。' : '调整关键词、部门或状态后重试，也可新建记录。'} action={<Button variant="outline" onClick={clearFilters}>清除筛选</Button>} />
          : view === 'board' ? <div className="hr-board">{p.module.statuses.map(s => <section key={s}><h3>{s}<span>{filtered.filter(r => r.status === s).length}</span></h3>{filtered.filter(r => r.status === s).map(r => <button key={r.id} className="hr-task-card" aria-pressed={row?.id === r.id} onClick={() => select(r.id)}><small>{r.id} · {r.fields['任务类型']}</small><strong>{r.title}</strong><p>{r.owner} · {r.date}</p><Badge>{r.fields['循环周期']}</Badge></button>)}</section>)}</div>
          : view === 'gantt' ? <div className="hr-table-scroll"><table className="hr-table hr-gantt"><thead><tr><th>任务 / {month}</th>{ganttRanges.map(range => <th key={range.start}>{range.label}</th>)}</tr></thead><tbody>{filtered.map(r => {
            const start = Date.parse(r.fields['开始日期'] || r.date); const end = Date.parse(r.date);
            return <tr key={r.id}><td><button onClick={() => select(r.id)}>{r.title}</button></td>{ganttRanges.map(range => <td key={range.start}><span className={start <= range.end && end >= range.start ? 'hr-gantt-bar' : ''} /></td>)}</tr>;
          })}</tbody></table></div>
          : <><Table containerClassName="hr-desktop-records" className="hr-table hr-record-table" aria-label={`${p.module.title}记录`}><TableHeader><TableRow><TableHead>名称 / 编号</TableHead><TableHead>部门 / 负责人</TableHead><TableHead>状态 / 计划日期</TableHead></TableRow></TableHeader><TableBody>{filtered.map(r => <TableRow key={r.id} data-state={row?.id === r.id ? 'selected' : undefined}><TableCell><Button variant="unstyled" className="hr-record-link" aria-pressed={row?.id === r.id} onClick={() => select(r.id)}>{r.title}</Button><small>{r.id}</small></TableCell><TableCell>{r.dept}<small>{r.owner}</small></TableCell><TableCell><Badge>{r.status}</Badge><small>{r.date}</small></TableCell></TableRow>)}</TableBody></Table>
            <div className="hr-mobile-records">{filtered.map(r => <Button key={r.id} variant="unstyled" className="hr-mobile-record" aria-label={r.title} aria-pressed={row?.id === r.id} onClick={() => select(r.id)}><span className="hr-mobile-record-top"><strong>{r.title}</strong><ChevronRight size={16} aria-hidden="true" /></span><span className="hr-mobile-record-id">{r.id}</span><span className="hr-mobile-record-meta">{r.dept} · {r.owner}</span><span className="hr-mobile-record-bottom"><Badge>{r.status}</Badge><span>计划 {r.date}</span></span></Button>)}</div></>}
      </section>
      {row && <aside className="hr-panel hr-detail" ref={detailRef} key={`${row.id}-${detailRevision}`} tabIndex={-1} aria-label={`${row.title}详情`}><Button variant="ghost" size="sm" className="hr-back-to-records" onClick={() => { recordsRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' }); recordsRef.current?.focus({ preventScroll: true }); }}><ArrowLeft size={14} />返回记录列表</Button><div className="hr-detail-heading"><div><small>{row.id}</small><h2>{row.title}</h2><Badge>{row.status}</Badge></div>{allowEdit && editable && <Button variant="outline" size="sm" onClick={() => setEditing(row)}>编辑</Button>}</div>{children ? children(row) : <Facts row={row} />}<Timeline row={row} /></aside>}
    </div>
    {editing !== undefined && <RecordForm p={p} row={editing} onSaved={saved} onClose={() => setEditing(undefined)} />}
  </>;
}

function TaskDetail({ p, row }: { p: HrProps; row: HrRecord }) {
  const [check, setCheck] = useState(false);
  const next = p.module.statuses[p.module.statuses.indexOf(row.status) + 1];
  const recurring = recurrenceOptions.includes(row.fields['循环周期']) && row.fields['循环周期'] !== '不重复';
  return <><Facts row={row} />
    {row.status === '待验收' && <label className="hr-check-item"><Checkbox checked={check} onCheckedChange={value => setCheck(value === true)} />已核对验收标准与交付结果</label>}
    {next && <Button disabled={row.status === '待验收' && !check} onClick={() => { p.update(row.id, { status: next }, `任务进入${next}`); setCheck(false); }}>标记为{next}<ArrowRight size={15} /></Button>}
    {row.status === '已完成' && recurring && <Button variant="outline" disabled={Boolean(row.fields['已生成下期'])} onClick={() => {
      try { const id = p.add('tasks', nextRecurringTask(row)); p.update(row.id, { fields: { ...row.fields, '已生成下期': id } }, '已生成下一周期任务（演示）'); }
      catch (error) { p.notify(error instanceof Error ? error.message : '生成失败，请核对任务日期与周期。'); }
    }}>生成下一周期任务</Button>}
    {row.fields['已生成下期'] && <Notice>已生成下期：{row.fields['已生成下期']}，可通过编号搜索查看。</Notice>}
  </>;
}
export function WorkViews({ p }: { p: HrProps }) {
  const [view, setView] = useState('列表'); const [month, setMonth] = useState('2026-10');
  return <><Notice><ListChecks size={15} />周期任务按设置推进；进入已完成前需核对验收标准。生成下期会保留原任务周期和持续时间。</Notice><Desk p={p} month={month} view={view === '看板' ? 'board' : view === '甘特图' ? 'gantt' : undefined} tools={<><ViewSwitch label="任务视图" value={view} onChange={setView} options={['列表', '看板', '甘特图']} />{view === '甘特图' && <Input aria-label="甘特月份" type="month" value={month} onChange={e => setMonth(e.target.value || '2026-10')} className="w-40" />}</>}>{r => <TaskDetail p={p} row={r} />}</Desk></>;
}
export function Coverage() {
  return <section className="hr-panel"><HorizonSectionHeader title="需求核对清单" description="25 条需求逐项对应页面。交互流程与真实服务分别验收。" /><div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>需求 / 页面</th><th>来源</th><th>存量能力与补齐范围</th><th>预览</th></tr></thead><tbody>{hrModules.map(m => <tr key={m.id}><td>{m.title}<small>{m.group}</small></td><td>{m.source}</td><td className="hr-wrap">{m.gap}</td><td><Link className="hr-text-link" to={`/__preview/hr/${m.id}`}>打开<ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div></section>;
}
