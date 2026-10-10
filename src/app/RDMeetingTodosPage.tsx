import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, History, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './components/ui/button';
import { Checkbox } from './components/ui/checkbox';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { NativeSelect } from './components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog';
import { useConfirmation } from './components/ui/use-confirmation';
import { routePath } from './lib/routePaths';
import { todayLocalDateStr } from './lib/taskDue';
import { meetingTodosApi as api, MeetingRequestError, meetingWeekStart, meetingWeekLabel, shiftMeetingDate,
  type MeetingDraft, type MeetingHistory, type MeetingMember, type MeetingTodo, type MeetingWeek } from './lib/rdMeetingTodosApi';
import '../styles/rd-meeting-todos.css';

const timestamp = (date: string) => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

export function RDMeetingTodosPage() {
  const [params, setParams] = useSearchParams();
  const currentWeek = meetingWeekStart(todayLocalDateStr())!;
  const selectedWeek = meetingWeekStart(params.get('week') ?? '') ?? currentWeek;
  const [week, setWeek] = useState<MeetingWeek | null>(null);
  const [members, setMembers] = useState<MeetingMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [memberId, setMemberId] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('all');
  const [editor, setEditor] = useState<{ item?: MeetingTodo; draft: MeetingDraft; revision: number; conflicted?: boolean } | null>(null);
  const [formError, setFormError] = useState('');
  const [newWeek, setNewWeek] = useState<string | null>(null);
  const [copyPrevious, setCopyPrevious] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<MeetingHistory>({ weeks: [], nextBefore: null });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    Promise.all([api.week(selectedWeek, controller.signal), api.members(controller.signal)])
      .then(([record, people]) => { if (!controller.signal.aborted) { setWeek(record); setMembers(people); } })
      .catch(error => { if (!controller.signal.aborted) { setWeek(null); setLoadError(errorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedWeek, reload]);

  function selectWeek(date: string) {
    setParams({ week: date }); setMemberId('all'); setStatus('all'); setKeyword(''); setEditor(null);
  }
  async function mutate(action: () => Promise<MeetingWeek>, success: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setFormError('');
    try {
      const saved = await action();
      setWeek(saved); toast.success(success); return true;
    } catch (error) {
      let message = errorMessage(error);
      if (error instanceof MeetingRequestError && error.status === 409) {
        setEditor(current => current?.item ? { ...current, conflicted: true } : current);
        try { setWeek(await api.week(selectedWeek)); message += '。已加载最新记录，请核对后再操作。'; }
        catch { setLoadError('最新记录加载失败，请刷新后重试'); }
      }
      setFormError(message); toast.error(message); return false;
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function loadHistory(before?: string) {
    setHistoryLoading(true); setHistoryError('');
    try { const result = await api.history(before); setHistory(previous => ({ ...result, weeks: before ? [...previous.weeks, ...result.weeks] : result.weeks })); }
    catch (error) { setHistoryError(errorMessage(error)); }
    finally { setHistoryLoading(false); }
  }
  function openCreate(date: string) { setNewWeek(date); setCopyPrevious(false); setFormError(''); }
  function openEditor(item?: MeetingTodo, personId?: string) {
    setFormError('');
    setEditor({ item, revision: week?.revision ?? 1, draft: item ? { memberId: item.memberId, title: item.title, description: item.description, dueDate: item.dueDate }
      : { memberId: personId ?? (memberId === 'all' ? '' : memberId), title: '', description: '', dueDate: todayLocalDateStr() } });
  }
  const record = week?.weekStart === selectedWeek ? week : null;
  const items = record?.items ?? [];
  const activeItems = items.filter(item => !item.deletedAt);
  const doneCount = activeItems.filter(item => item.status === 'done').length;
  const people = new Map(members.map(person => [person.id, person]));
  for (const item of items) if (!people.has(item.memberId)) people.set(item.memberId, { id: item.memberId, name: item.memberName, department: '历史成员', position: '' });
  const visibleItems = items.filter(item => (status === 'deleted' ? !!item.deletedAt : !item.deletedAt)
    && (memberId === 'all' || item.memberId === memberId)
    && (status === 'all' || status === 'deleted' || item.status === status)
    && `${item.title} ${item.description} ${item.memberName}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()));
  const selectedPerson = people.get(memberId);
  const editable = !!record && !loading && !loadError && !busy;

  return <div className="horizon-theme rd-meeting-page">
    <header className="rd-meeting-heading">
      <div className="rd-meeting-title-group">
        <Button variant="outline" size="icon" asChild><Link to={routePath('page:rd-task-management', '/rd-task-management')} aria-label="返回研发任务驾驶舱" title="返回研发任务驾驶舱"><ArrowLeft size={18} aria-hidden /></Link></Button>
        <div><h1>会议待办 <span>管理员专用</span></h1>
          <p>按周安排分工，按成员跟进。</p></div>
      </div>
      <div className="rd-meeting-actions">
        <Button variant="outline" disabled={busy} onClick={() => { setHistoryOpen(true); void loadHistory(); }}><History size={16} aria-hidden />历史周清单</Button>
        <Button disabled={busy || loading || !!loadError} onClick={() => openCreate(record ? shiftMeetingDate(selectedWeek, 7) : selectedWeek)}><Plus size={16} aria-hidden />新建周清单</Button>
      </div>
    </header>

    <section className="rd-meeting-weekbar" aria-label="选择周清单">
      <div className="rd-meeting-week-controls">
        <Button variant="outline" size="icon" aria-label="上一周" disabled={busy} onClick={() => selectWeek(shiftMeetingDate(selectedWeek, -7))}><ChevronLeft size={18} /></Button>
        <div className="rd-meeting-week-label"><CalendarDays size={20} aria-hidden /><div><strong>{meetingWeekLabel(selectedWeek)}</strong><span>{selectedWeek === currentWeek ? '本周' : selectedWeek < currentWeek ? '历史周' : '计划周'} · 周一至周日</span></div></div>
        <Button variant="outline" size="icon" aria-label="下一周" disabled={busy} onClick={() => selectWeek(shiftMeetingDate(selectedWeek, 7))}><ChevronRight size={18} /></Button>
        {selectedWeek !== currentWeek && <Button variant="ghost" disabled={busy} onClick={() => selectWeek(currentWeek)}>回到本周</Button>}
      </div>
      <div className="rd-meeting-week-summary" aria-live="polite">
        {record && !loading && <><span>待办 <b>{activeItems.length - doneCount}</b></span><span>已完成 <b>{doneCount}</b></span><span>共 <b>{activeItems.length}</b> 项</span></>}
        <Button variant="ghost" size="icon" disabled={busy || loading} aria-label="刷新清单" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /></Button>
      </div>
    </section>

    {loading ? <div className="rd-meeting-empty" role="status">正在加载周清单…</div>
      : loadError ? <div className="rd-meeting-empty" role="alert"><p>{loadError}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></div>
      : !record ? <div className="rd-meeting-empty"><ClipboardList size={38} aria-hidden /><h2>这一周还没有清单</h2><p>创建后即可按成员记录会议分工，也可手动复制上周未完成项。</p><Button onClick={() => openCreate(selectedWeek)}>创建这一周清单</Button></div>
      : <div className="rd-meeting-workspace">
        <aside className="rd-meeting-members" aria-label="按成员筛选">
          <h2>成员 <span>{people.size}</span></h2>
          <div className="rd-meeting-member-options">
          <Button variant="unstyled" type="button" className={memberId === 'all' ? 'is-selected' : ''} aria-pressed={memberId === 'all'} onClick={() => setMemberId('all')}><span className="rd-meeting-member-name">全部成员</span><b>{activeItems.length}</b></Button>
          {[...people.values()].map(person => {
            const personal = activeItems.filter(item => item.memberId === person.id);
            return <Button variant="unstyled" type="button" key={person.id} className={memberId === person.id ? 'is-selected' : ''} aria-pressed={memberId === person.id} onClick={() => setMemberId(person.id)}>
              <span className="rd-meeting-member-avatar" aria-hidden>{person.name.slice(0, 1)}</span><span className="rd-meeting-member-name"><strong>{person.name}</strong><small>{person.department || person.position || '研发成员'}</small></span><b>{personal.filter(item => item.status === 'todo').length}<small>待办</small></b>
            </Button>;
          })}
          </div>
        </aside>
        <section className="rd-meeting-list" aria-label="会议待办清单">
          <div className="rd-meeting-list-heading"><div><h2>{selectedPerson?.name ?? '全部成员'}的待办</h2><p>{selectedWeek === currentWeek ? '本周会议分工' : '每周独立保留，可继续补充记录'} · {visibleItems.length} 项</p></div>
            <Button disabled={!editable || members.length === 0} onClick={() => openEditor()}><Plus size={16} aria-hidden />添加待办</Button></div>
          <div className="rd-meeting-filters">
            <label className="rd-meeting-search"><Search size={16} aria-hidden /><Input aria-label="搜索待办或成员" placeholder="搜索待办内容、成员…" value={keyword} onChange={event => setKeyword(event.target.value)} /></label>
            <NativeSelect aria-label="待办状态" value={status} onValueChange={setStatus}><option value="all">全部状态</option><option value="todo">未完成</option><option value="done">已完成</option><option value="deleted">已删除记录</option></NativeSelect>
          </div>
          {members.length === 0 && <p className="rd-meeting-notice">暂无可分派成员，请先在研发人员管理中添加成员。</p>}
          {visibleItems.length === 0 ? <div className="rd-meeting-empty rd-meeting-list-empty"><ClipboardList size={30} aria-hidden /><h3>{keyword || status !== 'all' ? '没有符合条件的待办' : '还没有安排待办'}</h3><p>{keyword || status !== 'all' ? '试试其他关键词或状态。' : '点击“添加待办”，记录本周会议分工。'}</p></div>
            : <ul className="rd-meeting-items">{visibleItems.map(item => <li key={item.id} className={item.deletedAt ? 'is-deleted' : item.status === 'done' ? 'is-done' : ''}>
              <Checkbox checked={item.status === 'done'} disabled={!editable || !!item.deletedAt} aria-label={`${item.status === 'done' ? '重新打开' : '完成'}待办：${item.title}`} onCheckedChange={() => { void mutate(() => api.update(record, item.id, { status: item.status === 'done' ? 'todo' : 'done' }), item.status === 'done' ? '已重新打开待办' : '已标记完成'); }} />
              <div className="rd-meeting-item-copy"><div className="rd-meeting-item-title"><h3>{item.title}</h3><span className="rd-meeting-status">{!item.deletedAt && item.status === 'done' && <Check size={14} strokeWidth={3} aria-hidden />}{item.deletedAt ? '已删除' : item.status === 'done' ? '已完成' : '未完成'}</span></div>
                <div className="rd-meeting-item-meta"><strong>{item.memberName}</strong>{item.dueDate && <span className={!item.deletedAt && item.status === 'todo' && item.dueDate < todayLocalDateStr() ? 'is-overdue' : ''}>截止 {item.dueDate}</span>}
                  {item.carriedFrom && <Button variant="unstyled" type="button" disabled={busy} onClick={() => selectWeek(item.carriedFrom!.weekStart)}>来自 {item.carriedFrom.weekStart} 周</Button>}</div>
                {item.description && <p className="rd-meeting-description">{item.description}</p>}
                <p className="rd-meeting-stamp">{item.deletedAt ? `${item.deletedBy?.name ?? '管理员'} · ${timestamp(item.deletedAt)} 删除` : `${item.updatedBy.name} · ${timestamp(item.updatedAt)} 更新`}</p>
              </div>
              {!item.deletedAt && <div className="rd-meeting-item-actions"><Button variant="ghost" size="icon" disabled={!editable} aria-label={`编辑待办：${item.title}`} onClick={() => openEditor(item)}><Pencil size={16} /></Button>
                <Button variant="ghost" size="icon" disabled={!editable} aria-label={`删除待办：${item.title}`} onClick={async () => {
                  if (await confirm({ title: '删除这条待办？', description: `${item.memberName} · ${item.title}\n删除后仍可在“已删除记录”和操作记录中追溯。`, actionLabel: '删除待办', destructive: true })) await mutate(() => api.remove(record, item.id), '待办已删除');
                }}><Trash2 size={16} /></Button></div>}
            </li>)}</ul>}
          <footer className="rd-meeting-list-footer">清单创建于 {timestamp(record.createdAt)} · {record.createdBy.name}</footer>
        </section>
      </div>}

    <Dialog open={!!editor} onOpenChange={open => { if (!open && !busy) setEditor(null); }}>
      <DialogContent className="horizon-theme horizon-portal rd-meeting-dialog"><DialogHeader><DialogTitle>{editor?.item ? '编辑待办' : '添加待办'}</DialogTitle><DialogDescription>{meetingWeekLabel(selectedWeek)} · 记录成员的会议分工</DialogDescription></DialogHeader>
        {editor && <form onSubmit={async event => { event.preventDefault(); if (!record || editor.conflicted) return; if (await mutate(() => editor.item ? api.update({ ...record, revision: editor.revision }, editor.item.id, editor.draft) : api.add(record, editor.draft), editor.item ? '待办已更新' : '待办已添加')) setEditor(null); }}>
          <fieldset disabled={busy} className="rd-meeting-fields">
            <label htmlFor="meeting-member">分派成员 <span>*</span></label><NativeSelect id="meeting-member" required value={editor.draft.memberId} onValueChange={value => setEditor({ ...editor, draft: { ...editor.draft, memberId: value } })}><option value="" disabled>请选择成员</option>{editor.item && !members.some(person => person.id === editor.item!.memberId) && <option value={editor.item.memberId}>{editor.item.memberName}（历史成员）</option>}{members.map(person => <option key={person.id} value={person.id}>{person.name}{person.department ? ` · ${person.department}` : ''}</option>)}</NativeSelect>
            <label htmlFor="meeting-title">待办内容 <span>*</span></label><Input id="meeting-title" required maxLength={200} value={editor.draft.title} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, title: event.target.value } })} placeholder="例如：整理样机测试问题清单" />
            <label htmlFor="meeting-due">截止日期</label><Input id="meeting-due" type="date" value={editor.draft.dueDate ?? ''} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, dueDate: event.target.value || null } })} />
            <label htmlFor="meeting-description">补充说明</label><Textarea id="meeting-description" maxLength={2000} rows={4} value={editor.draft.description} onChange={event => setEditor({ ...editor, draft: { ...editor.draft, description: event.target.value } })} placeholder="记录交付内容、会议备注等" />
            {formError && <p role="alert" className="rd-meeting-error">{formError}</p>}
            {editor.conflicted && <div className="rd-meeting-conflict"><p className="rd-meeting-notice">当前草稿未保存。载入最新内容会替换上方草稿，请先核对或复制需要保留的文字。</p><Button variant="outline" type="button" disabled={!!loadError || !record?.items.some(item => item.id === editor.item?.id && !item.deletedAt)} onClick={() => { const latest = record?.items.find(item => item.id === editor.item?.id && !item.deletedAt); if (latest) openEditor(latest); }}>载入最新内容</Button></div>}
            <div className="rd-meeting-dialog-actions"><Button variant="outline" type="button" onClick={() => setEditor(null)}>取消</Button><Button type="submit" disabled={!!loadError || editor.conflicted || !editor.draft.title.trim() || !editor.draft.memberId}>{busy ? '保存中…' : '保存待办'}</Button></div>
          </fieldset>
        </form>}
      </DialogContent>
    </Dialog>

    <Dialog open={newWeek !== null} onOpenChange={open => { if (!open && !busy) setNewWeek(null); }}><DialogContent className="horizon-theme horizon-portal rd-meeting-dialog"><DialogHeader><DialogTitle>新建周清单</DialogTitle><DialogDescription>每周独立保存，历史清单会一直保留。</DialogDescription></DialogHeader>
      <form onSubmit={async event => { event.preventDefault(); const target = newWeek && meetingWeekStart(newWeek); if (!target) return; if (await mutate(() => api.createWeek(target, copyPrevious ? shiftMeetingDate(target, -7) : undefined), '周清单已创建')) { setNewWeek(null); selectWeek(target); } }}>
        <fieldset disabled={busy} className="rd-meeting-fields"><label htmlFor="meeting-week-date">选择该周任意一天</label><Input id="meeting-week-date" type="date" required value={newWeek ?? ''} onChange={event => setNewWeek(event.target.value)} />
          {newWeek && meetingWeekStart(newWeek) && <p className="rd-meeting-notice">周范围：{meetingWeekLabel(meetingWeekStart(newWeek)!)}</p>}
          <label className="rd-meeting-check"><Checkbox checked={copyPrevious} onCheckedChange={checked => setCopyPrevious(checked === true)} />复制上周未完成项</label><p className="rd-meeting-notice">默认创建空白清单。复制会保留原成员、截止日期，并标注来源周。</p>
          {formError && <p role="alert" className="rd-meeting-error">{formError}</p>}
          <div className="rd-meeting-dialog-actions"><Button variant="outline" type="button" onClick={() => setNewWeek(null)}>取消</Button><Button type="submit" disabled={!newWeek || !meetingWeekStart(newWeek)}>{busy ? '创建中…' : '创建清单'}</Button></div>
        </fieldset>
      </form></DialogContent></Dialog>

    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="horizon-theme horizon-portal rd-meeting-dialog"><DialogHeader><DialogTitle>历史周清单</DialogTitle><DialogDescription>选择一周查看当时的分派与完成情况。</DialogDescription></DialogHeader>
      <label className="rd-meeting-fields">按日期跳转<Input type="date" aria-label="历史周日期" onChange={event => { const date = meetingWeekStart(event.target.value); if (date) { selectWeek(date); setHistoryOpen(false); } }} /></label>
      <div className="rd-meeting-history">{history.weeks.map(entry => <Button variant="unstyled" type="button" key={entry.weekStart} onClick={() => { selectWeek(entry.weekStart); setHistoryOpen(false); }}><span><strong>{meetingWeekLabel(entry.weekStart)}</strong><small>共 {entry.total} 项 · 已完成 {entry.completed} 项</small></span><ChevronRight size={18} aria-hidden /></Button>)}</div>
      {!historyLoading && !historyError && !history.weeks.length && <p className="rd-meeting-notice">尚未创建任何周清单。</p>}
      {historyError && <p role="alert" className="rd-meeting-error">{historyError}</p>}
      {(historyLoading || history.nextBefore || historyError) && <Button variant="outline" disabled={historyLoading} onClick={() => { void loadHistory(history.nextBefore ?? undefined); }}>{historyLoading ? '加载中…' : historyError ? '重新加载' : '加载更早的周'}</Button>}
    </DialogContent></Dialog>
    {confirmationDialog}
  </div>;
}
